-- Verification for 20260909000100_secondary_currency.sql
--
--   psql -f packages/db/verification/secondary_currency.sql
--
-- Two claims worth testing rather than asserting in a comment:
--
--   1. The rate is a daily job a manager can do, and a cashier cannot. It is
--      set through a SECURITY DEFINER function precisely so that letting a
--      manager near it does not also let them near tax_rate, so the function's
--      authorisation matrix IS the permission.
--   2. Settling in shillings changes what is recorded about the payment and
--      nothing at all about the sale. If amount_cents ever moves because a
--      customer paid in a different note, every report in the product is wrong.

\set ON_ERROR_STOP off
\pset pager off

begin;

\set TENANT '''aaaaaaaa-0000-0000-0000-000000000001'''
\set OWNER  '''11111111-1111-1111-1111-111111111111'''
\set CASH   '''22222222-2222-2222-2222-222222222222'''
\set MGR    '''44444444-4444-4444-4444-444444444444'''
\set LOC    '''cccccccc-0000-0000-0000-00000000000a'''
\set PROD   '''dddddddd-0000-0000-0000-00000000000a'''

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, label;
end $$;

create or replace function pg_temp.attempt(
  actor uuid, shop_role text, tenant uuid, stmt text
) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated',
                      'tenant_id', tenant, 'shop_role', shop_role)::text, true);
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Prices in dollars, takes shillings. allow_oversell so the test is about
-- money rather than about stock.
insert into public.tenants (id, name, currency, tax_rate, timezone, allow_oversell)
values (:TENANT, 'Hargeisa Mini-Mart', 'USD', 0, 'Africa/Mogadishu', true)
on conflict (id) do update
  set currency = 'USD', allow_oversell = true, tax_rate = 0;

insert into public.locations (id, tenant_id, name, kind, is_default, is_active)
values (:LOC, :TENANT, 'Front Shop', 'shop', true, true)
on conflict (id) do nothing;

insert into auth.users (id) values (:OWNER), (:CASH), (:MGR) on conflict do nothing;
insert into public.users (id, tenant_id, name, role, is_active, login_enabled) values
  (:OWNER, :TENANT, 'Owner',   'owner',   true, true),
  (:MGR,   :TENANT, 'Manager', 'manager', true, true),
  (:CASH,  :TENANT, 'Cashier', 'cashier', true, true)
on conflict (id) do update set role = excluded.role, tenant_id = excluded.tenant_id;

insert into public.products (id, tenant_id, name, price_cents, cost_cents, unit, is_active)
values (:PROD, :TENANT, 'Rice 5kg', 1200, 700, 'each', true)
on conflict (id) do nothing;

\echo ''
\echo '--- who may set the rate ---'

select pg_temp.check(
  'an owner may set the rate',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.set_exchange_rate(''SLS'', 8500)') = 'ok');

select pg_temp.check(
  'a manager may set the rate (it is a daily job)',
  pg_temp.attempt(:MGR, 'manager', :TENANT,
    'select public.set_exchange_rate(''SLS'', 8600)') = 'ok');

select pg_temp.check(
  'a cashier may NOT set the rate',
  pg_temp.attempt(:CASH, 'cashier', :TENANT,
    'select public.set_exchange_rate(''SLS'', 1)') = 'PS403');

-- The reason set_exchange_rate exists instead of a widened tenants policy.
select pg_temp.check(
  'setting the rate does not let a manager reach the tax rate',
  pg_temp.attempt(:MGR, 'manager', :TENANT,
    format('update public.tenants set tax_rate = 0.99 where id = %L', :TENANT)) <> 'ok'
  or (select tax_rate from public.tenants where id = :TENANT) = 0);

\echo ''
\echo '--- what the rate will accept ---'

select pg_temp.check(
  'a zero rate is refused',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.set_exchange_rate(''SLS'', 0)') = 'PS422');

select pg_temp.check(
  'a negative rate is refused',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.set_exchange_rate(''SLS'', -5)') = 'PS422');

-- SLSH is the code people write and the one that breaks Intl. It must not
-- reach the column, and char(3) alone would silently truncate it to "SLS".
select pg_temp.check(
  'a four-letter code (SLSH) is refused rather than truncated',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.set_exchange_rate(''SLSH'', 8500)') = 'PS422');

select pg_temp.check(
  'settling in the shop''s own currency is refused',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.set_exchange_rate(''USD'', 1)') <> 'ok');

-- Two statements, not one expression. SQL does not promise to evaluate the
-- call before the read, so an `attempt(...) = 'ok' and (select ...)` here read
-- the row before the clear had run and reported a failure that was not there —
-- the same trap staff_pin_admin.sql documents.
select pg_temp.check(
  'clearing the pair is allowed',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.set_exchange_rate(null, null)') = 'ok');

select pg_temp.check(
  'clearing the pair returns the shop to one currency',
  (select secondary_currency is null and exchange_rate is null
   from public.tenants where id = :TENANT));

\echo ''
\echo '--- a sale settled in shillings ---'

select public.set_exchange_rate('SLS', 8500)
from (select set_config('request.jwt.claims',
        json_build_object('sub', :OWNER, 'role','authenticated',
                          'tenant_id', :TENANT, 'shop_role','owner')::text, true)) _;

-- $12.00 at 8,500 = 102,000 SLSH. USD is 1/100, SLSH is whole shillings, so
-- this is also the case that catches a cents-times-rate mistake.
select public.process_sale(
  'fx-test-sale-0001',
  jsonb_build_array(jsonb_build_object(
    'product_id', :PROD, 'quantity', 1, 'unit_price_cents', 1200)),
  'cash', 0, now(), null, null,
  jsonb_build_array(jsonb_build_object(
    'method', 'cash',
    'amount_cents', 1200,
    'tendered_cents', 1200,
    'paid_currency', 'SLS',
    'paid_amount_minor', 102000,
    'fx_rate', 8500)),
  :LOC, :OWNER);

select pg_temp.check(
  'the sale total is still the shop currency (1200, not 102000)',
  (select total_cents from public.sales where client_id = 'fx-test-sale-0001') = 1200);

select pg_temp.check(
  'the payment amount is still the shop currency',
  (select amount_cents from public.sale_payments p
   join public.sales s on s.id = p.sale_id
   where s.client_id = 'fx-test-sale-0001') = 1200);

select pg_temp.check(
  'what crossed the counter is recorded in shillings',
  (select paid_currency = 'SLS' and paid_amount_minor = 102000 and fx_rate = 8500
   from public.sale_payments p join public.sales s on s.id = p.sale_id
   where s.client_id = 'fx-test-sale-0001'));

\echo ''
\echo '--- a sale settled normally is untouched ---'

select public.process_sale(
  'fx-test-sale-0002',
  jsonb_build_array(jsonb_build_object(
    'product_id', :PROD, 'quantity', 1, 'unit_price_cents', 1200)),
  'cash', 0, now(), null, null,
  jsonb_build_array(jsonb_build_object(
    'method', 'cash', 'amount_cents', 1200, 'tendered_cents', 1500)),
  :LOC, :OWNER);

select pg_temp.check(
  'a payment with no currency keys records none',
  (select paid_currency is null and paid_amount_minor is null and fx_rate is null
   from public.sale_payments p join public.sales s on s.id = p.sale_id
   where s.client_id = 'fx-test-sale-0002'));

\echo ''
\echo '--- a half-filled record is refused ---'
-- A currency with no amount cannot be reconciled; an amount with no rate
-- cannot be checked against the day's board.

select pg_temp.check(
  'currency without amount or rate is rejected',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    format('insert into public.sale_payments (tenant_id, sale_id, method, amount_cents, paid_currency) '
           'select %L, id, ''cash'', 100, ''SLS'' from public.sales where client_id = ''fx-test-sale-0002''',
           :TENANT)) <> 'ok');

rollback;
