-- A sale that comes to nothing should still record.
--
-- Found by running the till's own arithmetic through process_sale(): two
-- ordinary situations both failed with a raw constraint violation rather than
-- a message anyone could act on.
--
--   * A zero-priced line. Shops ring these up so the stock movement still
--     happens — a carrier bag, a sample, something bundled in.
--   * A discount that cancels the basket. On the house, a staff meal, a
--     damaged item written off in front of the customer.
--
-- In both cases the sale total is zero, and process_sale() unconditionally
-- inserted a sale_payments row for that amount. sale_payments checks
-- amount_cents <> 0, so the insert failed, the transaction rolled back, and
-- the cashier saw "new row for relation sale_payments violates check
-- constraint" mid-checkout.
--
-- The constraint is right: zero is not a tender. The fix is to not write the
-- row. Everything else about the sale — the lines, the stock movements, the
-- attribution — is unchanged and still recorded.
--
-- Only the payment block differs from the previous definition; the rest is
-- carried over verbatim so this cannot quietly change the arithmetic.

set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.process_sale(p_client_id text, p_items jsonb, p_payment_method payment_method, p_discount_cents integer DEFAULT 0, p_created_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text, p_shift_id uuid DEFAULT NULL::uuid, p_payments jsonb DEFAULT NULL::jsonb, p_location_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid)
 RETURNS sales
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant_id   uuid := public.current_tenant_id();
  v_uid         uuid := auth.uid();
  v_cashier     uuid;
  v_location    uuid := coalesce(p_location_id, public.default_location_id());
  v_tenant      public.tenants;
  v_sale        public.sales;
  v_item        jsonb;
  v_product     public.products;
  v_on_hand     numeric(14,3);
  v_qty         numeric(14,3);
  v_unit_price  integer;
  v_line_total  integer;
  v_subtotal    integer := 0;
  v_taxable     integer;
  v_tax         integer;
  v_total       integer;
  v_oversell    boolean := false;
  v_lines       jsonb := '[]'::jsonb;
  v_paid        integer;
  v_method      public.payment_method;
  v_shift       public.shifts;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;
  if v_location is null then
    raise exception 'This shop has no location set up' using errcode = 'PS422';
  end if;

  -- A caller may name any active staff member in their own shop, and nobody
  -- outside it. Falling back to the session's own user keeps existing callers
  -- working unchanged.
  if p_cashier_id is not null then
    select id into v_cashier from public.users
    where id = p_cashier_id and tenant_id = v_tenant_id and is_active;
    if not found then
      raise exception 'That cashier is not on this shop''s staff' using errcode = 'PS404';
    end if;
  else
    v_cashier := v_uid;
  end if;

  select * into v_sale
  from public.sales
  where tenant_id = v_tenant_id and client_id = p_client_id;

  if found then
    return v_sale;
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A sale needs at least one line' using errcode = 'PS422';
  end if;

  if p_shift_id is not null then
    select * into v_shift from public.shifts
    where id = p_shift_id and tenant_id = v_tenant_id;
    if not found then
      raise exception 'Shift not found' using errcode = 'PS404';
    end if;
    if v_shift.status <> 'open' then
      raise exception 'That shift is closed - open a new one' using errcode = 'PS405';
    end if;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items) as t(value)
    order by (value ->> 'product_id')::uuid
  loop
    v_qty        := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unit_price_cents')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line quantity must be positive' using errcode = 'PS422';
    end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid and tenant_id = v_tenant_id;

    if not found then
      raise exception 'Product % is not in this shop', v_item ->> 'product_id'
        using errcode = 'PS404';
    end if;

    select ls.on_hand into v_on_hand
    from public.location_stock ls
    where ls.location_id = v_location and ls.product_id = v_product.id
    for update;

    v_on_hand := coalesce(v_on_hand, 0);

    if v_unit_price is null then
      v_unit_price := v_product.price_cents;
    end if;

    if v_on_hand - v_qty < 0 then
      if not v_tenant.allow_oversell then
        raise exception 'Only % of "%" left here', v_on_hand, v_product.name
          using errcode = 'PS422', detail = v_product.id::text;
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
    v_tax   := round(v_taxable * v_tenant.tax_rate / (1 + v_tenant.tax_rate))::integer;
    v_total := v_taxable;
  else
    v_tax   := round(v_taxable * v_tenant.tax_rate)::integer;
    v_total := v_taxable + v_tax;
  end if;

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    select coalesce(sum((e ->> 'amount_cents')::integer), 0) into v_paid
    from jsonb_array_elements(p_payments) as t(e);

    if v_paid <> v_total then
      raise exception 'Payments total % but the sale is %', v_paid, v_total
        using errcode = 'PS422';
    end if;

    if jsonb_array_length(p_payments) = 1 then
      v_method := (p_payments -> 0 ->> 'method')::public.payment_method;
    else
      v_method := 'mixed';
    end if;
  else
    v_method := coalesce(p_payment_method, 'cash');
  end if;

  insert into public.sales (
    tenant_id, location_id, cashier_id, client_id, shift_id, kind,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    payment_method, tax_inclusive, has_oversell, note, created_at
  )
  values (
    v_tenant_id, v_location, v_cashier, p_client_id, p_shift_id, 'sale',
    v_subtotal, p_discount_cents, v_tax, v_total,
    v_method, v_tenant.tax_inclusive, v_oversell, p_note,
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

  -- A sale can legitimately come to nothing: a zero-priced line (a carrier bag
  -- rung up so stock still moves) or a discount that cancels the whole basket
  -- (on the house, a staff meal, a damaged item written off). Those still need
  -- to be recorded, because the stock movement and the audit trail are the
  -- point of ringing them up at all.
  --
  -- What they must not do is write a payment row. sale_payments checks
  -- amount_cents <> 0, deliberately — zero is not a tender, and a row saying
  -- someone paid nothing is noise in every report that reads the table. Before
  -- this, the fallback below inserted v_total unconditionally, so both cases
  -- died on that constraint and the cashier got a raw Postgres error in the
  -- middle of a checkout.
  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents, tendered_cents, reference)
    select v_tenant_id, v_sale.id,
           (e ->> 'method')::public.payment_method,
           (e ->> 'amount_cents')::integer,
           nullif(e ->> 'tendered_cents', '')::integer,
           nullif(e ->> 'reference', '')
    from jsonb_array_elements(p_payments) as t(e)
    -- A split-tender payload can carry a zero leg for a method the cashier
    -- opened and left empty. It is not a payment either.
    where (e ->> 'amount_cents')::integer <> 0;
  elsif v_total <> 0 then
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents)
    values (v_tenant_id, v_sale.id, v_method, v_total);
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, delta, reason, reference_id, created_by
  )
  select v_tenant_id, v_location, l.product_id, -l.quantity, 'sale', v_sale.id, v_cashier
  from jsonb_to_recordset(v_lines) as l(product_id uuid, quantity numeric);

  return v_sale;

exception
  when unique_violation then
    select * into v_sale from public.sales
    where tenant_id = v_tenant_id and client_id = p_client_id;
    if found then
      return v_sale;
    end if;
    raise;
end;
$function$;
