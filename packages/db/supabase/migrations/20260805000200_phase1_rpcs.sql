-- Phase 1 write paths: shift lifecycle, split-tender sales, refunds, X/Z.
--
-- Custom SQLSTATEs the clients branch on, continuing the existing scheme:
--   PS401 not authenticated     PS404 not found
--   PS403 not permitted         PS409 conflict / already exists
--   PS422 unprocessable         PS405 not allowed

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Shift lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.open_shift(
  p_opening_float_cents integer default 0
)
returns public.shifts
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift     public.shifts;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;

  insert into public.shifts (tenant_id, opened_by, opening_float_cents)
  values (v_tenant_id, auth.uid(), greatest(coalesce(p_opening_float_cents, 0), 0))
  returning * into v_shift;

  return v_shift;

exception
  -- shifts_one_open_per_tenant. Two tills opening at once is a race worth
  -- resolving quietly: hand back the shift that won rather than erroring.
  when unique_violation then
    select * into v_shift
    from public.shifts
    where tenant_id = v_tenant_id and status = 'open';

    if found then
      return v_shift;
    end if;
    raise;
end;
$$;

revoke all on function public.open_shift from public;
grant execute on function public.open_shift to authenticated;

-- What the drawer should hold right now. Used mid-shift by the X report and at
-- close to compute variance, so both agree by construction.
create or replace function public.shift_expected_cash(p_shift_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select
      s.opening_float_cents
    + coalesce((
        select sum(sp.amount_cents)
        from public.sale_payments sp
        join public.sales sa on sa.id = sp.sale_id
        where sa.shift_id = s.id
          and sa.status = 'completed'
          and sp.method = 'cash'
      ), 0)
    + coalesce((
        select sum(case when cm.kind = 'pay_in' then cm.amount_cents
                        else -cm.amount_cents end)
        from public.cash_movements cm
        where cm.shift_id = s.id
      ), 0)
  from public.shifts s
  where s.id = p_shift_id
$$;

comment on function public.shift_expected_cash(uuid) is
  'Float + cash tendered (refunds are negative rows, so they subtract) + pay-ins '
  '- pay-outs and drops. Voided sales are excluded via status.';

create or replace function public.close_shift(
  p_shift_id           uuid,
  p_counted_cash_cents integer,
  p_note               text default null
)
returns public.shifts
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift     public.shifts;
  v_expected  integer;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id and tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception 'Shift not found' using errcode = 'PS404';
  end if;

  if v_shift.status = 'closed' then
    return v_shift;  -- idempotent
  end if;

  if p_counted_cash_cents is null or p_counted_cash_cents < 0 then
    raise exception 'Enter the cash you counted in the drawer' using errcode = 'PS422';
  end if;

  v_expected := public.shift_expected_cash(p_shift_id);

  update public.shifts
  set status              = 'closed',
      closed_at           = now(),
      closed_by           = auth.uid(),
      counted_cash_cents  = p_counted_cash_cents,
      expected_cash_cents = v_expected,
      -- Negative means short. That is the number an owner actually looks at.
      variance_cents      = p_counted_cash_cents - v_expected,
      note                = coalesce(p_note, note)
  where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;

revoke all on function public.close_shift from public;
grant execute on function public.close_shift to authenticated;

create or replace function public.record_cash_movement(
  p_shift_id     uuid,
  p_kind         public.cash_movement_kind,
  p_amount_cents integer,
  p_reason       text
)
returns public.cash_movements
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift     public.shifts;
  v_row       public.cash_movements;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id and tenant_id = v_tenant_id;

  if not found then
    raise exception 'Shift not found' using errcode = 'PS404';
  end if;

  if v_shift.status <> 'open' then
    raise exception 'That shift is already closed' using errcode = 'PS405';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Amount must be more than zero' using errcode = 'PS422';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say what the money was for' using errcode = 'PS422';
  end if;

  insert into public.cash_movements (
    tenant_id, shift_id, kind, amount_cents, reason, created_by
  )
  values (v_tenant_id, p_shift_id, p_kind, p_amount_cents, btrim(p_reason), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_cash_movement from public;
grant execute on function public.record_cash_movement to authenticated;

-- ---------------------------------------------------------------------------
-- process_sale, now with a shift and several tenders
--
-- Same idempotency contract as before: (tenant_id, client_id).
--
-- Dropped rather than replaced. Adding parameters changes the signature, so
-- CREATE OR REPLACE leaves two overloads behind and every later GRANT — and
-- every PostgREST call — becomes ambiguous. The new parameters carry defaults,
-- so a device still passing only the original six keeps working.
-- ---------------------------------------------------------------------------

drop function if exists public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text);

create function public.process_sale(
  p_client_id      text,
  p_items          jsonb,
  p_payment_method public.payment_method,
  p_discount_cents integer default 0,
  p_created_at     timestamptz default now(),
  p_note           text default null,
  p_shift_id       uuid default null,
  -- [{ "method": "cash", "amount_cents": 500, "tendered_cents": 1000 }, ...]
  p_payments       jsonb default null
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
  v_lines       jsonb := '[]'::jsonb;
  v_paid        integer;
  v_method      public.payment_method;
  v_shift       public.shifts;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
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
    select * into v_shift
    from public.shifts
    where id = p_shift_id and tenant_id = v_tenant_id;

    if not found then
      raise exception 'Shift not found' using errcode = 'PS404';
    end if;
    if v_shift.status <> 'open' then
      raise exception 'That shift is closed — open a new one' using errcode = 'PS405';
    end if;
  end if;

  -- Locking in product_id order: two cashiers ringing the same two products in
  -- opposite order would otherwise deadlock, which on a shared phone in a busy
  -- shop is not hypothetical.
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
    where id = (v_item ->> 'product_id')::uuid and tenant_id = v_tenant_id
    for update;

    if not found then
      raise exception 'Product % is not in this shop', v_item ->> 'product_id'
        using errcode = 'PS404';
    end if;

    -- The device's price wins. The customer was quoted that number, possibly
    -- hours ago on a phone that had not synced, and silently overcharging them
    -- to match the catalog is worse than being briefly out of date.
    if v_unit_price is null then
      v_unit_price := v_product.price_cents;
    end if;

    if v_product.stock_on_hand - v_qty < 0 then
      if not v_tenant.allow_oversell then
        raise exception 'Only % of "%" left in stock', v_product.stock_on_hand, v_product.name
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

  -- Tenders must cover the total exactly. Overpayment is change, which belongs
  -- in tendered_cents, not in the amount recorded against the sale.
  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    select coalesce(sum((e ->> 'amount_cents')::integer), 0)
    into v_paid
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
    tenant_id, cashier_id, client_id, shift_id, kind,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    payment_method, tax_inclusive, has_oversell, note, created_at
  )
  values (
    v_tenant_id, v_uid, p_client_id, p_shift_id, 'sale',
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

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents, tendered_cents, reference)
    select v_tenant_id, v_sale.id,
           (e ->> 'method')::public.payment_method,
           (e ->> 'amount_cents')::integer,
           nullif(e ->> 'tendered_cents', '')::integer,
           nullif(e ->> 'reference', '')
    from jsonb_array_elements(p_payments) as t(e);
  else
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents)
    values (v_tenant_id, v_sale.id, v_method, v_total);
  end if;

  insert into public.stock_movements (
    tenant_id, product_id, delta, reason, reference_id, created_by
  )
  select v_tenant_id, l.product_id, -l.quantity, 'sale', v_sale.id, v_uid
  from jsonb_to_recordset(v_lines) as l(product_id uuid, quantity numeric);

  return v_sale;

exception
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

revoke all on function public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb) from public;
grant execute on function public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_sale
--
-- Writes a second sale row carrying negative signs, linked to the original.
-- Nothing is ever edited: the original stands, the refund offsets it, and every
-- revenue figure stays a plain sum that nets out on its own.
-- ---------------------------------------------------------------------------

-- 'mixed' is a summary label on sales, never a real tender. Copying it onto a
-- refund's sale_payments row makes the refund invisible to
-- shift_expected_cash(), which counts only method = 'cash' — so cash handed
-- back out of the drawer reads as a surplus at close rather than reducing it.
create or replace function public.refund_tender_method(
  p_requested public.payment_method,
  p_original_sale_id uuid
)
returns public.payment_method
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(p_requested, 'mixed'),
    -- A split original has no single method to give back on, so fall through.
    (select nullif(s.payment_method, 'mixed')
     from public.sales s where s.id = p_original_sale_id),
    'cash'
  )
$$;

grant execute on function public.refund_tender_method(public.payment_method, uuid) to authenticated;

create or replace function public.refund_sale(
  p_original_sale_id uuid,
  p_client_id        text,
  -- [{ "sale_item_id": uuid, "quantity": 2 }, ...]; null refunds the lot
  p_lines            jsonb default null,
  p_reason           text default null,
  p_method           public.payment_method default null,
  p_shift_id         uuid default null,
  p_restock          boolean default true
)
returns public.sales
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_uid       uuid := auth.uid();
  v_role      text := public.current_shop_role();
  v_original  public.sales;
  v_refund    public.sales;
  v_lines     jsonb := '[]'::jsonb;
  v_item      record;
  v_qty       numeric(14,3);
  v_subtotal  integer := 0;
  v_tax       integer;
  v_total     integer;
  v_ratio     numeric;
  v_already   numeric;
  v_method    public.payment_method;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;

  -- Refunds move money out of the drawer, so they sit with the same people who
  -- can void. A cashier handing back cash unsupervised is the classic shrink.
  if v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can refund a sale' using errcode = 'PS403';
  end if;

  select * into v_refund
  from public.sales
  where tenant_id = v_tenant_id and client_id = p_client_id;

  if found then
    return v_refund;  -- idempotent, same contract as process_sale
  end if;

  select * into v_original
  from public.sales
  where id = p_original_sale_id and tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception 'Sale not found' using errcode = 'PS404';
  end if;
  if v_original.kind = 'refund' then
    raise exception 'That is already a refund' using errcode = 'PS422';
  end if;
  if v_original.status = 'voided' then
    raise exception 'That sale was voided, so there is nothing to refund'
      using errcode = 'PS422';
  end if;

  v_method := public.refund_tender_method(p_method, v_original.id);

  for v_item in
    select si.id, si.product_id, si.quantity, si.unit_price_cents,
           si.name_at_sale, si.unit_cost_cents
    from public.sale_items si
    where si.sale_id = v_original.id
    order by si.product_id
  loop
    if p_lines is null then
      v_qty := v_item.quantity;
    else
      select coalesce((e ->> 'quantity')::numeric, 0)
      into v_qty
      from jsonb_array_elements(p_lines) as t(e)
      where (e ->> 'sale_item_id')::uuid = v_item.id;

      v_qty := coalesce(v_qty, 0);
    end if;

    if v_qty <= 0 then
      continue;
    end if;

    -- Partial refunds accumulate. Without this check a line could be refunded
    -- three times over and the shop would hand back triple the money.
    select coalesce(sum(-ri.quantity), 0)
    into v_already
    from public.sale_items ri
    join public.sales r on r.id = ri.sale_id
    where r.original_sale_id = v_original.id
      and r.status = 'completed'
      and ri.product_id = v_item.product_id;

    if v_already + v_qty > v_item.quantity then
      raise exception 'Only % of "%" left to refund on this sale',
        v_item.quantity - v_already, v_item.name_at_sale
        using errcode = 'PS422';
    end if;

    v_subtotal := v_subtotal - round(v_qty * v_item.unit_price_cents)::integer;

    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_item.product_id,
      'quantity',         -v_qty,
      'unit_price_cents', v_item.unit_price_cents,
      'line_total_cents', -round(v_qty * v_item.unit_price_cents)::integer,
      'name_at_sale',     v_item.name_at_sale,
      'unit_cost_cents',  v_item.unit_cost_cents
    );
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'Nothing selected to refund' using errcode = 'PS422';
  end if;

  -- Carry tax back at the same proportion the original charged, rather than
  -- recomputing from today's rate, which may have changed since.
  v_ratio := case when v_original.subtotal_cents <> 0
                  then v_subtotal::numeric / v_original.subtotal_cents
                  else 0 end;
  v_tax   := -round(abs(v_original.tax_cents) * abs(v_ratio))::integer;

  if v_original.tax_inclusive then
    v_total := v_subtotal;
  else
    v_total := v_subtotal + v_tax;
  end if;

  insert into public.sales (
    tenant_id, cashier_id, client_id, shift_id, kind, original_sale_id,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    payment_method, tax_inclusive, note
  )
  values (
    v_tenant_id, v_uid, p_client_id, p_shift_id, 'refund', v_original.id,
    v_subtotal, 0, v_tax, v_total,
    v_method, v_original.tax_inclusive, p_reason
  )
  returning * into v_refund;

  insert into public.sale_items (
    tenant_id, sale_id, product_id, quantity,
    unit_price_cents, line_total_cents, name_at_sale, unit_cost_cents
  )
  select v_tenant_id, v_refund.id, l.product_id, l.quantity,
         l.unit_price_cents, l.line_total_cents, l.name_at_sale, l.unit_cost_cents
  from jsonb_to_recordset(v_lines) as l(
    product_id uuid, quantity numeric, unit_price_cents integer,
    line_total_cents integer, name_at_sale text, unit_cost_cents integer
  );

  insert into public.sale_payments (tenant_id, sale_id, method, amount_cents)
  values (v_tenant_id, v_refund.id, v_method, v_total);

  -- Damaged goods come back as a refund but must not go back on the shelf, so
  -- restocking is a decision the cashier makes, not an automatic consequence.
  if p_restock then
    insert into public.stock_movements (
      tenant_id, product_id, delta, reason, reference_id, created_by, note
    )
    select v_tenant_id, l.product_id, -l.quantity, 'refund', v_refund.id, v_uid, p_reason
    from jsonb_to_recordset(v_lines) as l(product_id uuid, quantity numeric);
  end if;

  return v_refund;

exception
  when unique_violation then
    select * into v_refund
    from public.sales
    where tenant_id = v_tenant_id and client_id = p_client_id;

    if found then
      return v_refund;
    end if;
    raise;
end;
$$;

revoke all on function public.refund_sale from public;
grant execute on function public.refund_sale to authenticated;

-- ---------------------------------------------------------------------------
-- X / Z report
--
-- X is the mid-shift read, Z is the close-out. Same numbers; the difference is
-- only whether the shift is still open, so one function serves both.
-- ---------------------------------------------------------------------------

create or replace function public.shift_report(p_shift_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_shift     public.shifts;
  v_result    jsonb;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id and tenant_id = v_tenant_id;

  if not found then
    raise exception 'Shift not found' using errcode = 'PS404';
  end if;

  select jsonb_build_object(
    'shift_id',        v_shift.id,
    'status',          v_shift.status,
    'opened_at',       v_shift.opened_at,
    'closed_at',       v_shift.closed_at,
    'opened_by',       (select name from public.users where id = v_shift.opened_by),
    'opening_float_cents', v_shift.opening_float_cents,

    'sales_count', (
      select count(*) from public.sales
      where shift_id = v_shift.id and kind = 'sale' and status = 'completed'
    ),
    'refunds_count', (
      select count(*) from public.sales
      where shift_id = v_shift.id and kind = 'refund' and status = 'completed'
    ),
    'gross_sales_cents', coalesce((
      select sum(total_cents) from public.sales
      where shift_id = v_shift.id and kind = 'sale' and status = 'completed'
    ), 0),
    'refunds_cents', coalesce((
      select sum(total_cents) from public.sales
      where shift_id = v_shift.id and kind = 'refund' and status = 'completed'
    ), 0),
    'net_sales_cents', coalesce((
      select sum(total_cents) from public.sales
      where shift_id = v_shift.id and status = 'completed'
    ), 0),
    'tax_cents', coalesce((
      select sum(tax_cents) from public.sales
      where shift_id = v_shift.id and status = 'completed'
    ), 0),
    'voided_count', (
      select count(*) from public.sales
      where shift_id = v_shift.id and status = 'voided'
    ),

    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', m.method, 'amount_cents', m.amt)
                       order by m.amt desc)
      from (
        select sp.method::text as method, sum(sp.amount_cents) as amt
        from public.sale_payments sp
        join public.sales sa on sa.id = sp.sale_id
        where sa.shift_id = v_shift.id and sa.status = 'completed'
        group by sp.method
      ) m
    ), '[]'::jsonb),

    'cash_movements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', cm.kind, 'amount_cents', cm.amount_cents,
               'reason', cm.reason, 'created_at', cm.created_at)
             order by cm.created_at)
      from public.cash_movements cm where cm.shift_id = v_shift.id
    ), '[]'::jsonb),

    'expected_cash_cents', coalesce(v_shift.expected_cash_cents,
                                    public.shift_expected_cash(v_shift.id)),
    'counted_cash_cents',  v_shift.counted_cash_cents,
    'variance_cents',      v_shift.variance_cents
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.shift_report from public;
grant execute on function public.shift_report to authenticated;

-- ---------------------------------------------------------------------------
-- Reporting view, rebuilt on sale_payments
--
-- It previously read sales.payment_method and attributed the whole total to it,
-- so a 'mixed' sale vanished from all three columns. Split tender would have
-- made that the common case rather than the rare one.
-- ---------------------------------------------------------------------------

drop view if exists public.v_sales_daily;

create view public.v_sales_daily
with (security_invoker = on) as
select
  s.tenant_id,
  (s.created_at at time zone 'UTC')::date as day,
  count(*) filter (where s.kind = 'sale')   as transactions,
  count(*) filter (where s.kind = 'refund') as refunds,
  sum(s.total_cents)    as revenue_cents,
  sum(s.tax_cents)      as tax_cents,
  sum(s.discount_cents) as discount_cents,
  coalesce(sum(p.cash),   0) as cash_cents,
  coalesce(sum(p.mobile), 0) as mobile_money_cents,
  coalesce(sum(p.card),   0) as card_cents
from public.sales s
left join lateral (
  select
    sum(sp.amount_cents) filter (where sp.method = 'cash')         as cash,
    sum(sp.amount_cents) filter (where sp.method = 'mobile_money') as mobile,
    sum(sp.amount_cents) filter (where sp.method = 'card')         as card
  from public.sale_payments sp
  where sp.sale_id = s.id
) p on true
where s.status = 'completed'
group by s.tenant_id, ((s.created_at at time zone 'UTC')::date);

comment on view public.v_sales_daily is
  'Daily totals. Payment mix comes from sale_payments so split tenders are '
  'attributed to each method rather than being lost to a "mixed" label.';
