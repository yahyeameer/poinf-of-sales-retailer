-- Report a shop's day, not Greenwich's.
--
-- Three views bucketed sales with (created_at AT TIME ZONE 'UTC')::date, and
-- nothing recorded where the shop actually is. So "today's takings" meant
-- today in UTC, which is only the same thing as the shop's today for a shop
-- in UTC and for the part of the day the two happen to overlap elsewhere.
--
-- Concretely, before this:
--
--   * Nairobi (UTC+3): a sale at 01:30 on Tuesday is 22:30 UTC Monday, so it
--     lands in Monday's figures. A shop that closes before midnight never
--     notices; one that trades late is quietly wrong every night.
--   * Anywhere west of Greenwich it is worse and constant: in UTC-5, every
--     sale after 19:00 local is already tomorrow in UTC, so the evening trade
--     — often the busiest part of the day — is reported on the wrong day.
--
-- The number an owner checks when they cash up is this one. If it disagrees
-- with the drawer they stop trusting the product, and they are right to.
--
-- Default 'UTC', so a shop that never sets this behaves exactly as it does
-- today and this migration changes no existing figure.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Where the shop is
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column timezone text not null default 'UTC';

comment on column public.tenants.timezone is
  'IANA name, e.g. Africa/Nairobi. Decides where a shop''s day starts and ends '
  'for every daily report. Defaults to UTC, which is what the reports assumed '
  'before this column existed.';

-- A CHECK constraint cannot consult pg_timezone_names — the lookup is not
-- immutable — so the guard is a trigger. Worth having: a typo like
-- 'Africa/Nairobbi' would not error anywhere, it would silently fall back and
-- put the shop's day back on UTC, which is exactly the bug being fixed.
create or replace function public.validate_tenant_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone)
  then
    raise exception '% is not a known timezone name', coalesce(new.timezone, '(null)')
      using errcode = 'PS422',
            hint = 'Use an IANA name such as Africa/Nairobi or America/New_York.';
  end if;
  return new;
end;
$$;

create trigger tenants_validate_timezone
  before insert or update of timezone on public.tenants
  for each row execute function public.validate_tenant_timezone();

-- ---------------------------------------------------------------------------
-- 2. The three daily views
--
-- Each gains a join to tenants for the zone. tenants holds one row per shop,
-- so this is a lookup, not a scan. security_invoker is carried over — losing
-- it here would reopen the cross-tenant leak 20260906000200 closed.
-- ---------------------------------------------------------------------------

create or replace view public.v_sales_daily
with (security_invoker = on) as
  select
    s.tenant_id,
    (s.created_at at time zone t.timezone)::date as day,
    count(*) filter (where s.kind = 'sale') as transactions,
    count(*) filter (where s.kind = 'refund') as refunds,
    sum(s.total_cents) as revenue_cents,
    sum(s.tax_cents) as tax_cents,
    sum(s.discount_cents) as discount_cents,
    coalesce(sum(p.cash), 0::numeric) as cash_cents,
    coalesce(sum(p.mobile), 0::numeric) as mobile_money_cents,
    coalesce(sum(p.card), 0::numeric) as card_cents
  from public.sales s
  join public.tenants t on t.id = s.tenant_id
  left join lateral (
    select
      sum(sp.amount_cents) filter (where sp.method = 'cash') as cash,
      sum(sp.amount_cents) filter (where sp.method = 'mobile_money') as mobile,
      sum(sp.amount_cents) filter (where sp.method = 'card') as card
    from public.sale_payments sp
    where sp.sale_id = s.id
  ) p on true
  where s.status = 'completed'
  group by s.tenant_id, ((s.created_at at time zone t.timezone)::date);

create or replace view public.v_product_performance
with (security_invoker = on) as
  select
    si.tenant_id,
    si.product_id,
    p.name,
    p.category_id,
    (s.created_at at time zone t.timezone)::date as day,
    sum(si.quantity) as units,
    sum(si.line_total_cents) as revenue_cents,
    sum(si.line_total_cents)
      - sum(round(si.quantity * si.unit_cost_cents::numeric))::bigint as margin_cents
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  join public.products p on p.id = si.product_id
  join public.tenants t on t.id = si.tenant_id
  where s.status = 'completed'
  group by si.tenant_id, si.product_id, p.name, p.category_id,
           ((s.created_at at time zone t.timezone)::date);

create or replace view public.v_cashier_performance
with (security_invoker = on) as
  select
    s.tenant_id,
    s.cashier_id,
    u.name as cashier_name,
    (s.created_at at time zone t.timezone)::date as day,
    count(*) as transactions,
    sum(s.total_cents) as revenue_cents,
    count(*) filter (where s.status = 'voided') as voids
  from public.sales s
  join public.tenants t on t.id = s.tenant_id
  left join public.users u on u.id = s.cashier_id
  group by s.tenant_id, s.cashier_id, u.name,
           ((s.created_at at time zone t.timezone)::date);

-- ---------------------------------------------------------------------------
-- 3. "Today" for the shop
--
-- v_profit_daily joins margin (from v_product_performance, now the shop's
-- local day) against expenses (from spent_on, which was always a local day
-- the owner typed). Those two were on different bases until now; they agree
-- from here.
-- ---------------------------------------------------------------------------

create or replace function public.current_shop_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select t.timezone from public.tenants t where t.id = public.current_tenant_id()),
    'UTC'))::date
$$;

comment on function public.current_shop_date is
  'Today where the shop is. The date every "is this in the future" check and '
  'every default date should be measured against, rather than the server''s '
  'own idea of today.';

revoke all on function public.current_shop_date() from public;
grant execute on function public.current_shop_date() to authenticated;

-- record_expense() carried a one-day slack because it had no way to know the
-- shop's date and had to tolerate any offset. With the zone recorded it can
-- ask directly, so the guard goes back to being exact: a date after the shop's
-- own today is a typo, and nothing else.
create or replace function public.record_expense(
  p_category    public.expense_category,
  p_amount_cents bigint,
  p_spent_on    date default null,
  p_note        text default null,
  p_location_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_today date := public.current_shop_date();
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can record expenses'
      using errcode = 'PS403';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'An expense must be more than zero' using errcode = 'PS422';
  end if;

  if coalesce(p_spent_on, v_today) > v_today then
    raise exception 'An expense cannot be dated in the future'
      using errcode = 'PS422';
  end if;

  insert into public.expenses
    (tenant_id, location_id, category, amount_cents, note, spent_on, created_by)
  values (
    public.current_tenant_id(),
    p_location_id,
    p_category,
    p_amount_cents,
    nullif(btrim(p_note), ''),
    coalesce(p_spent_on, v_today),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_expense(public.expense_category, bigint, date, text, uuid) from public;
grant execute on function public.record_expense(public.expense_category, bigint, date, text, uuid) to authenticated;
