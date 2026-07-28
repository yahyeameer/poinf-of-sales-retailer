-- The write paths the apps actually call.
--
-- These are SECURITY INVOKER: RLS still applies, so a cashier cannot post a
-- sale into someone else's shop by passing a different id. The functions exist
-- for atomicity and idempotency, not to escape the policies.
--
-- Custom SQLSTATEs the clients branch on:
--   PS401 not authenticated          PS404 not found
--   PS403 not permitted              PS409 conflict / already exists
--   PS422 would oversell             PS405 not allowed (append-only, expired void)

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- process_sale
--
-- Idempotent on (tenant_id, client_id). The device generates client_id before
-- the first attempt and reuses it on every retry, so a response lost to a dead
-- connection replays into the same row instead of charging twice.
--
-- p_items: [{ "product_id": uuid, "quantity": number, "unit_price_cents": int }]
-- ---------------------------------------------------------------------------

create or replace function public.process_sale(
  p_client_id      text,
  p_items          jsonb,
  p_payment_method public.payment_method,
  p_discount_cents integer default 0,
  p_created_at     timestamptz default now(),
  p_note           text default null
)
returns public.sales
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id   uuid := public.current_tenant_id();
  v_uid         uuid := auth.uid();
  v_tenant      public.tenants;
  v_sale        public.sales;
  v_item        jsonb;
  v_product     public.products;
  v_qty         numeric(14,3);
  v_unit_price  integer;
  v_line_total  integer;
  v_subtotal    integer := 0;
  v_taxable     integer;
  v_tax         integer;
  v_total       integer;
  v_oversell    boolean := false;
  v_item_count  integer;
  -- Lines accumulate here rather than in a temp table: two sales in one
  -- transaction would collide on the table name, and PL/pgSQL caches plans
  -- against a temp table that no longer exists on the next call.
  v_lines       jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;

  -- Idempotency check first, and cheaply. The vast majority of duplicate calls
  -- are retries of a sale that already landed.
  select * into v_sale
  from public.sales
  where tenant_id = v_tenant_id and client_id = p_client_id;

  if found then
    return v_sale;
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  v_item_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_item_count = 0 then
    raise exception 'A sale needs at least one line' using errcode = 'PS422';
  end if;

  -- Pass 1: lock every product row, validate, and total up.
  --
  -- Locking in product_id order matters. Two cashiers ringing up the same two
  -- products in opposite order will deadlock otherwise, and on a shared phone
  -- in a busy shop that is not a hypothetical.
  for v_item in
    select value
    from jsonb_array_elements(p_items) as t(value)
    order by (value ->> 'product_id')::uuid
  loop
    v_qty        := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unit_price_cents')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line quantity must be positive' using errcode = 'PS422';
    end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and tenant_id = v_tenant_id
    for update;

    if not found then
      raise exception 'Product % is not in this shop', v_item ->> 'product_id'
        using errcode = 'PS404';
    end if;

    -- The device's price wins, not the catalog's. The customer was quoted that
    -- number, possibly hours ago on a phone that had not synced a price change,
    -- and rewriting it here would silently overcharge them.
    if v_unit_price is null then
      v_unit_price := v_product.price_cents;
    end if;

    if v_product.stock_on_hand - v_qty < 0 then
      if not v_tenant.allow_oversell then
        raise exception
          'Only % of "%" left in stock', v_product.stock_on_hand, v_product.name
          using errcode = 'PS422',
                detail  = v_product.id::text;
      end if;
      v_oversell := true;
    end if;

    v_line_total := round(v_qty * v_unit_price)::integer;
    v_subtotal   := v_subtotal + v_line_total;

    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_product.id,
      'quantity',         v_qty,
      'unit_price_cents', v_unit_price,
      'line_total_cents', v_line_total,
      'name_at_sale',     v_product.name,
      'unit_cost_cents',  v_product.cost_cents
    );
  end loop;

  p_discount_cents := least(greatest(coalesce(p_discount_cents, 0), 0), v_subtotal);
  v_taxable := v_subtotal - p_discount_cents;

  if v_tenant.tax_inclusive then
    -- Tax is already inside the shelf price: back it out rather than add it on.
    v_tax   := round(v_taxable * v_tenant.tax_rate / (1 + v_tenant.tax_rate))::integer;
    v_total := v_taxable;
  else
    v_tax   := round(v_taxable * v_tenant.tax_rate)::integer;
    v_total := v_taxable + v_tax;
  end if;

  insert into public.sales (
    tenant_id, cashier_id, client_id,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    payment_method, tax_inclusive, has_oversell, note, created_at
  )
  values (
    v_tenant_id, v_uid, p_client_id,
    v_subtotal, p_discount_cents, v_tax, v_total,
    p_payment_method, v_tenant.tax_inclusive, v_oversell, p_note,
    coalesce(p_created_at, now())
  )
  returning * into v_sale;

  insert into public.sale_items (
    tenant_id, sale_id, product_id, quantity,
    unit_price_cents, line_total_cents, name_at_sale, unit_cost_cents
  )
  select v_tenant_id, v_sale.id, l.product_id, l.quantity,
         l.unit_price_cents, l.line_total_cents, l.name_at_sale, l.unit_cost_cents
  from jsonb_to_recordset(v_lines) as l(
    product_id uuid, quantity numeric, unit_price_cents integer,
    line_total_cents integer, name_at_sale text, unit_cost_cents integer
  );

  -- The ledger trigger decrements products.stock_on_hand from here.
  insert into public.stock_movements (
    tenant_id, product_id, delta, reason, reference_id, created_by
  )
  select v_tenant_id, l.product_id, -l.quantity, 'sale', v_sale.id, v_uid
  from jsonb_to_recordset(v_lines) as l(product_id uuid, quantity numeric);

  return v_sale;

exception
  -- Two devices replaying the same queued sale at the same moment both miss the
  -- lookup above and race to insert. The unique index catches the loser; return
  -- the row the winner wrote so both devices agree the sale is done.
  when unique_violation then
    select * into v_sale
    from public.sales
    where tenant_id = v_tenant_id and client_id = p_client_id;

    if found then
      return v_sale;
    end if;
    raise;
end;
$$;

comment on function public.process_sale is
  'Records a sale atomically and idempotently on (tenant_id, client_id). Raises '
  'PS422 with the product id in DETAIL when stock is insufficient and the shop '
  'does not allow overselling.';

revoke all on function public.process_sale from public;
grant execute on function public.process_sale to authenticated;

-- ---------------------------------------------------------------------------
-- void_sale
--
-- v1 has no partial refunds. A cashier can undo the sale they just rang up for
-- a short window; anything older is the owner's problem to sort out with an
-- adjustment, because a void that far back is usually a mistake or a fiddle.
-- ---------------------------------------------------------------------------

create or replace function public.void_sale(
  p_sale_id uuid,
  p_reason  text default null
)
returns public.sales
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_uid       uuid := auth.uid();
  v_role      text := public.current_shop_role();
  v_sale      public.sales;
  v_window    interval := interval '5 minutes';
begin
  select * into v_sale
  from public.sales
  where id = p_sale_id and tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception 'Sale not found' using errcode = 'PS404';
  end if;

  if v_sale.status = 'voided' then
    return v_sale;  -- idempotent
  end if;

  -- Owners and managers are trusted with the whole day; cashiers get 5 minutes.
  if v_role = 'cashier' then
    if v_sale.cashier_id is distinct from v_uid then
      raise exception 'You can only void your own sales' using errcode = 'PS403';
    end if;
    if now() - v_sale.created_at > v_window then
      raise exception 'That sale is older than 5 minutes — ask the owner'
        using errcode = 'PS405';
    end if;
  elsif v_role not in ('owner', 'manager') then
    raise exception 'Not permitted' using errcode = 'PS403';
  end if;

  -- Compensating entries, never a delete. The ledger keeps both halves.
  insert into public.stock_movements (
    tenant_id, product_id, delta, reason, reference_id, created_by, note
  )
  select v_tenant_id, si.product_id, si.quantity, 'void', v_sale.id, v_uid, p_reason
  from public.sale_items si
  where si.sale_id = v_sale.id;

  update public.sales
  set status    = 'voided',
      voided_at = now(),
      voided_by = v_uid,
      note      = coalesce(p_reason, note)
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.void_sale from public;
grant execute on function public.void_sale to authenticated;

-- ---------------------------------------------------------------------------
-- restock
--
-- Flow C. Note what this deliberately does not do: change the selling price.
-- Auto-repricing on a cost change is how a shop wakes up to a shelf that
-- contradicts the till. It warns instead.
-- ---------------------------------------------------------------------------

create or replace function public.restock_product(
  p_product_id     uuid,
  p_quantity       numeric,
  p_unit_cost_cents integer,
  p_note           text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_tenant    public.tenants;
  v_product   public.products;
  v_margin    numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Restock quantity must be positive' using errcode = 'PS422';
  end if;

  if public.current_shop_role() not in ('owner', 'manager', 'cashier') then
    raise exception 'Not permitted' using errcode = 'PS403';
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  insert into public.stock_movements (
    tenant_id, product_id, delta, reason, unit_cost_cents, created_by, note
  )
  values (
    v_tenant_id, p_product_id, p_quantity, 'restock', p_unit_cost_cents,
    auth.uid(), p_note
  );

  -- Read back after the trigger has folded in the new weighted average.
  select * into v_product from public.products where id = p_product_id;

  v_margin := case
    when v_product.price_cents > 0
    then round(100.0 * (v_product.price_cents - v_product.cost_cents) / v_product.price_cents, 2)
    else 0
  end;

  return jsonb_build_object(
    'product_id',      v_product.id,
    'stock_on_hand',   v_product.stock_on_hand,
    'avg_cost_cents',  v_product.cost_cents,
    'price_cents',     v_product.price_cents,
    'margin_pct',      v_margin,
    'margin_alert',    v_margin < v_tenant.min_margin_pct
  );
end;
$$;

revoke all on function public.restock_product from public;
grant execute on function public.restock_product to authenticated;

-- ---------------------------------------------------------------------------
-- match_products — cloud fallback for the on-device vector search
-- ---------------------------------------------------------------------------

create or replace function public.match_products(
  p_embedding vector(512),
  p_limit     integer default 3,
  p_threshold double precision default 0.75
)
returns table (
  product_id  uuid,
  name        text,
  price_cents integer,
  barcode     text,
  similarity  double precision
)
language plpgsql
stable
-- extensions, not '', because the `<=>` cosine operator lives there and an
-- operator cannot be schema-qualified inline the way a function call can.
set search_path = 'extensions'
as $$
begin
  -- HNSW is a single index across all tenants and RLS filters afterwards, so a
  -- plain top-k can come back short for a small shop. Iterative scan lets the
  -- index keep walking until k rows survive the filter.
  set local hnsw.iterative_scan = 'relaxed_order';
  set local hnsw.ef_search = 100;

  return query
  select p.id,
         p.name,
         p.price_cents,
         p.barcode,
         1 - (e.embedding <=> p_embedding) as similarity
  from public.product_embeddings e
  join public.products p on p.id = e.product_id
  where p.is_active
    and 1 - (e.embedding <=> p_embedding) >= p_threshold
  order by e.embedding <=> p_embedding
  limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.match_products from public;
grant execute on function public.match_products to authenticated;

-- ---------------------------------------------------------------------------
-- Staff PINs
--
-- The PIN does not authenticate against the server; the device is already
-- signed in as the shop. It picks which cashier is standing at the till, so
-- sales are attributed correctly. Four digits is fine for that and wrong for
-- anything more, which is why cashiers cannot change prices or void old sales.
-- ---------------------------------------------------------------------------

create or replace function public.set_staff_pin(
  p_user_id uuid,
  p_pin     text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_shop_role() <> 'owner' then
    raise exception 'Only an owner can set staff PINs' using errcode = 'PS403';
  end if;

  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits' using errcode = 'PS422';
  end if;

  update public.users
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
  where id = p_user_id
    and tenant_id = public.current_tenant_id();

  if not found then
    raise exception 'No such staff member in this shop' using errcode = 'PS404';
  end if;
end;
$$;

revoke all on function public.set_staff_pin from public;
grant execute on function public.set_staff_pin to authenticated;

create or replace function public.verify_staff_pin(
  p_user_id uuid,
  p_pin     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash
  from public.users
  where id = p_user_id
    and tenant_id = public.current_tenant_id()
    and is_active;

  if v_hash is null then
    return false;
  end if;

  if extensions.crypt(p_pin, v_hash) = v_hash then
    update public.users set last_seen_at = now() where id = p_user_id;
    return true;
  end if;

  return false;
end;
$$;

comment on function public.verify_staff_pin is
  'SECURITY DEFINER so pin_hash never has to be selectable by a client. Still '
  'tenant-scoped: it will not verify a PIN belonging to another shop.';

revoke all on function public.verify_staff_pin from public;
grant execute on function public.verify_staff_pin to authenticated;
