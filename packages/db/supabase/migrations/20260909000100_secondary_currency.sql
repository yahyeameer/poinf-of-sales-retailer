-- Take payment in a second currency: the shilling at the counter.
--
-- A shop in Hargeisa prices in dollars and is handed Somaliland shillings. One
-- in Mogadishu may price in dollars and take Somali shillings. The books want
-- one currency; the drawer holds another. Until now this product had room for
-- only the first of those.
--
-- WHAT THIS DOES NOT DO
-- It does not make the ledger multi-currency. Every price, sale total, report
-- and margin stays in `tenants.currency`, and `sale_payments.amount_cents` is
-- still that currency. Multi-currency accounting is a different and much
-- larger thing, and getting it half-right would corrupt every figure the shop
-- relies on.
--
-- What it adds is a second currency for *settlement*: the rate the shop is
-- trading at today, so the till can tell a cashier how many shillings to
-- collect and how much to give back, and a record on each payment of what
-- physically changed hands and at what rate.
--
-- WHY THE RATE IS STORED PER PAYMENT
-- The rate moves. The Somaliland shilling has run at several thousand to the
-- dollar and does not hold still, so a rate read from `tenants` a month later
-- will not reprice last month's sale. Storing it on the row is what lets a
-- drawer be reconciled against the day it was actually counted.
--
-- WHY A MANAGER MAY SET IT AND THE tenants POLICY IS UNTOUCHED
-- The rate is a daily number, often set before opening; making it owner-only
-- would mean a shop cannot trade until the owner wakes up. But UPDATE on
-- `tenants` is deliberately owner-only — that is what stops a manager editing
-- the tax rate — so widening the policy to let a manager in would hand them
-- every other setting on the row as well. Hence set_exchange_rate(): one
-- SECURITY DEFINER function that writes exactly two columns and nothing else.
--
-- ON THE CODE `SLS`
-- The Somaliland shilling has no ISO 4217 code; Somaliland is not a UN member.
-- `SLSH`, which is what a price list says, is four letters, and
-- `Intl.NumberFormat` throws RangeError on anything that is not three — so a
-- stored "SLSH" would break every screen in the app that formats money, and it
-- does not fit char(3) either. The stored code is `SLS`, the unofficial
-- three-letter code, displayed as `SLSH`. See packages/shared/src/money.ts.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The shop's trading rate
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column if not exists secondary_currency char(3),
  add column if not exists exchange_rate numeric(18,6),
  add column if not exists exchange_rate_updated_at timestamptz;

-- Major units of secondary per one major unit of `currency` — the number on a
-- bureau board ("1 USD = 8,500 SLSH"), not a minor-unit ratio. Anything else
-- would need every reader to know both exponents to make sense of it.
comment on column public.tenants.exchange_rate is
  'Major units of secondary_currency per 1 major unit of currency, as an owner '
  'would read it off a board. Null when the shop takes only its own currency.';

do $$
begin
  -- A rate without a currency is meaningless and a currency without a rate
  -- cannot be converted, so the pair travels together or not at all.
  if not exists (select 1 from pg_constraint where conname = 'tenants_secondary_currency_pair') then
    alter table public.tenants add constraint tenants_secondary_currency_pair check (
      (secondary_currency is null and exchange_rate is null)
      or (secondary_currency is not null and exchange_rate is not null and exchange_rate > 0)
    );
  end if;

  -- Settling in the currency you already price in is not a second currency,
  -- and would make the till offer the same money twice.
  if not exists (select 1 from pg_constraint where conname = 'tenants_secondary_currency_distinct') then
    alter table public.tenants add constraint tenants_secondary_currency_distinct check (
      secondary_currency is null or secondary_currency <> currency
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. What actually crossed the counter
-- ---------------------------------------------------------------------------

alter table public.sale_payments
  add column if not exists paid_currency char(3),
  add column if not exists paid_amount_minor bigint,
  add column if not exists fx_rate numeric(18,6);

comment on column public.sale_payments.paid_amount_minor is
  'What the customer settled this tender with, in paid_currency minor units. '
  'amount_cents remains the shop-currency figure and is what every report '
  'reads; this column exists so the drawer can be counted in the money it '
  'actually holds.';

do $$
begin
  -- All three or none. A currency with no amount cannot be reconciled, and an
  -- amount with no rate cannot be checked against the day's board.
  if not exists (select 1 from pg_constraint where conname = 'sale_payments_fx_complete') then
    alter table public.sale_payments add constraint sale_payments_fx_complete check (
      (paid_currency is null and paid_amount_minor is null and fx_rate is null)
      or (paid_currency is not null and paid_amount_minor is not null
          and fx_rate is not null and fx_rate > 0)
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Setting the rate, without handing over the rest of the row
-- ---------------------------------------------------------------------------

create or replace function public.set_exchange_rate(
  p_secondary_currency text,
  p_rate numeric
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role      text := public.current_shop_role();
  v_code      text := upper(nullif(btrim(coalesce(p_secondary_currency, '')), ''));
  v_row       public.tenants;
begin
  if v_tenant_id is null then
    raise exception 'Not signed in' using errcode = 'PS401';
  end if;

  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager may set the exchange rate'
      using errcode = 'PS403';
  end if;

  -- Clearing the pair is how a shop goes back to taking only its own money.
  if v_code is null then
    update public.tenants
    set secondary_currency = null,
        exchange_rate = null,
        exchange_rate_updated_at = now(),
        updated_at = now()
    where id = v_tenant_id
    returning * into v_row;
    return v_row;
  end if;

  if v_code !~ '^[A-Z]{3}$' then
    raise exception 'Currency code must be three letters (SLS, SOS, KES)'
      using errcode = 'PS422';
  end if;

  if p_rate is null or p_rate <= 0 then
    raise exception 'The exchange rate must be greater than zero'
      using errcode = 'PS422';
  end if;

  update public.tenants
  set secondary_currency = v_code,
      exchange_rate = p_rate,
      exchange_rate_updated_at = now(),
      updated_at = now()
  where id = v_tenant_id
  returning * into v_row;

  return v_row;
end;
$fn$;

comment on function public.set_exchange_rate(text, numeric) is
  'Sets the counter currency and today''s rate. SECURITY DEFINER because UPDATE '
  'on tenants is owner-only and the rate is a daily job a manager has to be '
  'able to do; it writes those two columns and nothing else, so it does not '
  'become a way for a manager to reach tax_rate or allow_oversell.';

revoke all on function public.set_exchange_rate(text, numeric) from public, anon;
grant execute on function public.set_exchange_rate(text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. process_sale carries the settlement details through
--
-- Only the sale_payments insert differs from the previous definition. The rest
-- is the live function body, extracted with pg_get_functiondef and left
-- untouched, so this cannot quietly change the arithmetic of a sale.
--
-- The new keys are optional: a caller that omits them — the mobile app, an
-- offline queue replaying yesterday's basket — writes NULLs and behaves
-- exactly as before.
-- ---------------------------------------------------------------------------

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
    insert into public.sale_payments (
      tenant_id, sale_id, method, amount_cents, tendered_cents, reference,
      paid_currency, paid_amount_minor, fx_rate
    )
    select v_tenant_id, v_sale.id,
           (e ->> 'method')::public.payment_method,
           (e ->> 'amount_cents')::integer,
           nullif(e ->> 'tendered_cents', '')::integer,
           nullif(e ->> 'reference', ''),
           -- Absent on every existing caller, and on any tender settled in the
           -- shop's own money. Present only when the cash that crossed the
           -- counter was a different currency.
           upper(nullif(e ->> 'paid_currency', '')),
           nullif(e ->> 'paid_amount_minor', '')::bigint,
           nullif(e ->> 'fx_rate', '')::numeric
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


comment on function public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb, uuid, uuid) is
  'Rings up a sale. Idempotent on client_id. p_payments entries may carry '
  'paid_currency/paid_amount_minor/fx_rate to record settlement in a second '
  'currency; amount_cents stays the shop-currency figure regardless, so every '
  'total and report is unaffected by how the customer chose to pay.';
