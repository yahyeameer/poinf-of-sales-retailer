-- Verification for 20260907000100_shop_timezone.sql
--
--   psql -f packages/db/verification/timezone.sql
--
-- The claim is that a shop's daily figures follow the shop's own day. The way
-- to test that is a sale placed deliberately either side of local midnight,
-- read back through the views, in two zones that fall on opposite sides of
-- UTC — because the bug is not symmetric. East of Greenwich a late-evening
-- sale lands on the previous UTC day; west of it, on the next one.

\set ON_ERROR_STOP off
\pset pager off

begin;

\set TENANT '''aaaaaaaa-0000-0000-0000-000000000001'''
\set OWNER  '''11111111-1111-1111-1111-111111111111'''
\set RICE   '''9d000000-0000-0000-0000-000000000001'''

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, label;
end $$;

create or replace function pg_temp.attempt(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', :OWNER, 'role', 'authenticated',
                    'tenant_id', :TENANT, 'shop_role', 'owner')::text, true);

update public.location_stock set on_hand = 100000;
update public.tenants set allow_oversell = true, tax_rate = 0, tax_inclusive = true
  where id = :TENANT;

\echo ''
\echo '--- the column will not take a typo ---'
-- 'Africa/Nairobbi' would not raise anywhere without the trigger; it would
-- quietly leave the shop on UTC, which is the bug this migration exists to
-- fix, reintroduced by a slip of the finger.

select pg_temp.check(
  'a real IANA name is accepted',
  pg_temp.attempt(format(
    'update public.tenants set timezone = %L where id = %L', 'Africa/Nairobi', :TENANT)) = 'ok');

select pg_temp.check(
  'a misspelt zone is refused',
  pg_temp.attempt(format(
    'update public.tenants set timezone = %L where id = %L', 'Africa/Nairobbi', :TENANT)) = 'PS422');

select pg_temp.check(
  'an empty zone is refused',
  pg_temp.attempt(format(
    'update public.tenants set timezone = %L where id = %L', '', :TENANT)) = 'PS422');

\echo ''
\echo '--- east of Greenwich: a late sale stays on its own day ---'
-- Nairobi is UTC+3. 01:30 local on the 12th is 22:30 UTC on the 11th.
-- Under UTC bucketing this sale was reported on the 11th; the shop rang it up
-- in the small hours of the 12th and counts it on the 12th.

update public.tenants set timezone = 'Africa/Nairobi' where id = :TENANT;

select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0, %L::timestamptz)',
  'tz-nairobi-001',
  format('[{"product_id":"%s","quantity":1,"unit_price_cents":1000}]', :RICE),
  '2026-03-11 22:30:00+00'));

select pg_temp.check(
  'a 01:30 Nairobi sale reports on the 12th, not the 11th',
  (select day = date '2026-03-12' from public.v_sales_daily
   where tenant_id = :TENANT and revenue_cents = 1000
     and day in (date '2026-03-11', date '2026-03-12')));

select pg_temp.check(
  'the product report agrees with the sales report',
  (select day = date '2026-03-12' from public.v_product_performance
   where tenant_id = :TENANT and revenue_cents = 1000
     and day in (date '2026-03-11', date '2026-03-12')));

select pg_temp.check(
  'and so does the cashier report',
  exists (select 1 from public.v_cashier_performance
          where tenant_id = :TENANT and day = date '2026-03-12'));

\echo ''
\echo '--- west of Greenwich: an evening sale does not roll into tomorrow ---'
-- New York in March is UTC-4. 20:00 local on the 12th is 00:00 UTC on the
-- 13th. Under UTC bucketing the whole evening trade was reported a day late.

update public.tenants set timezone = 'America/New_York' where id = :TENANT;

select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0, %L::timestamptz)',
  'tz-newyork-001',
  format('[{"product_id":"%s","quantity":1,"unit_price_cents":2500}]', :RICE),
  '2026-03-13 00:00:00+00'));

select pg_temp.check(
  'an 8pm New York sale reports on the 12th, not the 13th',
  (select day = date '2026-03-12' from public.v_sales_daily
   where tenant_id = :TENANT and revenue_cents = 2500
     and day in (date '2026-03-12', date '2026-03-13')));

\echo ''
\echo '--- the default changes nothing ---'
-- A shop that never sets this must behave exactly as it did before the column
-- existed, or this migration silently moved somebody's figures.

update public.tenants set timezone = 'UTC' where id = :TENANT;

select pg_temp.check(
  'on UTC, the Nairobi sale reports on the 11th again',
  (select day = date '2026-03-11' from public.v_sales_daily
   where tenant_id = :TENANT and revenue_cents = 1000
     and day in (date '2026-03-11', date '2026-03-12')));

select pg_temp.check(
  'a new shop defaults to UTC',
  (select timezone = 'UTC' from public.tenants where id = :TENANT));

\echo ''
\echo '--- today, where the shop is ---'

update public.tenants set timezone = 'Pacific/Auckland' where id = :TENANT;

select pg_temp.check(
  'current_shop_date follows the shop, not the server',
  public.current_shop_date() = (now() at time zone 'Pacific/Auckland')::date);

-- The slack that 20260906000300 added is no longer needed: with the zone
-- known, the guard can be exact again.
select pg_temp.check(
  'the shop''s own today is accepted',
  pg_temp.attempt(format(
    'select public.record_expense(''rent'', 100, %L, null, null)',
    (now() at time zone 'Pacific/Auckland')::date)) = 'ok');

select pg_temp.check(
  'a day past the shop''s today is refused',
  pg_temp.attempt(format(
    'select public.record_expense(''rent'', 100, %L, null, null)',
    ((now() at time zone 'Pacific/Auckland')::date + 1)) ) = 'PS422');

\echo ''
\echo '--- the leak stayed closed ---'
-- Rewriting a view drops its options unless they are restated. Losing
-- security_invoker here would reopen what 20260906000200 fixed.

select pg_temp.check(
  'every view still runs as the caller',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'off') <> 'on'));

rollback;
