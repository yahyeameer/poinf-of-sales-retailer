-- The role matrix, tested against the database rather than the buttons.
--
--   psql -f packages/db/verification/permissions.sql
--
-- The web app writes to several tables directly with the caller's own session
-- (products, tenants, locations, suppliers, expenses, parked_sales), so what
-- stops a cashier changing a price is the RLS policy, not the fact that the
-- screen has no button. This checks the policies, by attempting each action as
-- each role and as another shop entirely.
--
-- Hiding a control is not a permission. Every check here bypasses the UI.

\set ON_ERROR_STOP off
\pset pager off

begin;

\set TENANT_A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set TENANT_B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set OWNER_A  '''11111111-1111-1111-1111-111111111111'''
\set CASH_A   '''22222222-2222-2222-2222-222222222222'''
\set OWNER_B  '''33333333-3333-3333-3333-333333333333'''
\set MGR_A    '''44444444-4444-4444-4444-444444444444'''
\set RICE     '''9d000000-0000-0000-0000-000000000001'''

insert into auth.users (id) values (:MGR_A) on conflict do nothing;
insert into public.users (id, tenant_id, name, role, is_active, login_enabled)
values (:MGR_A, :TENANT_A, 'Manager', 'manager', true, true)
on conflict (id) do update set role = 'manager', is_active = true;

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, label;
end $$;

-- Runs a statement as an actor and reports whether it changed anything.
-- "Did not raise" is not the same as "was allowed": RLS filters an UPDATE or
-- DELETE down to zero rows and reports success, so this returns the row count
-- and the callers below assert on that.
create or replace function pg_temp.rows_touched(
  actor uuid, shop_role text, tenant uuid, stmt text
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated',
                      'tenant_id', tenant, 'shop_role', shop_role)::text, true);
  execute stmt;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;  -- refused outright
end $$;

-- Counts rows of `other_tenant` that `actor` can see in `tbl`.
--
-- other_tenant is a parameter interpolated with %L rather than concatenated
-- into the statement. An earlier version built the WHERE clause by string
-- concatenation with a psql variable that already carried its own quotes; the
-- quotes were consumed as SQL delimiters, the UUID arrived bare, and Postgres
-- read it as a column name. Every cross-tenant check then "failed" on a
-- syntax error while isolation was in fact working — a test that reports the
-- right verdict for the wrong reason is worse than no test.
create or replace function pg_temp.can_see(
  actor uuid, shop_role text, tenant uuid, tbl text, other_tenant uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated',
                      'tenant_id', tenant, 'shop_role', shop_role)::text, true);
  execute format('select count(*) from %s where tenant_id = %L', tbl, other_tenant) into n;
  return n;
exception when others then
  raise notice 'can_see(%) raised %: %', tbl, sqlstate, sqlerrm;
  return -1;
end $$;

set local role authenticated;

\echo ''
\echo '--- a cashier cannot change what things cost ---'

select pg_temp.check(
  'a cashier cannot change a price',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('update public.products set price_cents = 1 where id = %L', :RICE)) <= 0);

select pg_temp.check(
  'a cashier cannot change a cost',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('update public.products set cost_cents = 1 where id = %L', :RICE)) <= 0);

select pg_temp.check(
  'a cashier cannot add a product',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('insert into public.products (tenant_id, name, price_cents, cost_cents, unit) values (%L, ''x'', 1, 1, ''each'')', :TENANT_A)) <= 0);

select pg_temp.check(
  'a cashier cannot delete a product',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('delete from public.products where id = %L', :RICE)) <= 0);

\echo ''
\echo '--- a cashier cannot change how the shop runs ---'

select pg_temp.check(
  'a cashier cannot change the tax rate',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('update public.tenants set tax_rate = 0 where id = %L', :TENANT_A)) <= 0);

select pg_temp.check(
  'a cashier cannot turn on overselling',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('update public.tenants set allow_oversell = true where id = %L', :TENANT_A)) <= 0);

select pg_temp.check(
  'a cashier cannot promote themselves',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('update public.users set role = ''owner'' where id = %L', :CASH_A)) <= 0);

select pg_temp.check(
  'a cashier cannot move themselves to another shop',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('update public.users set tenant_id = %L where id = %L', :TENANT_B, :CASH_A)) <= 0);

select pg_temp.check(
  'a cashier cannot create a location',
  pg_temp.rows_touched(:CASH_A, 'cashier', :TENANT_A,
    format('insert into public.locations (tenant_id, name, kind) values (%L, ''x'', ''shop'')', :TENANT_A)) <= 0);

\echo ''
\echo '--- a manager runs the floor but not the business ---'

select pg_temp.check(
  'a manager may change a price',
  pg_temp.rows_touched(:MGR_A, 'manager', :TENANT_A,
    format('update public.products set price_cents = 12345 where id = %L', :RICE)) = 1);

select pg_temp.check(
  'a manager may not change the tax rate',
  pg_temp.rows_touched(:MGR_A, 'manager', :TENANT_A,
    format('update public.tenants set tax_rate = 0.99 where id = %L', :TENANT_A)) <= 0);

select pg_temp.check(
  'a manager may not promote a cashier to owner',
  pg_temp.rows_touched(:MGR_A, 'manager', :TENANT_A,
    format('update public.users set role = ''owner'' where id = %L', :CASH_A)) <= 0);

\echo ''
\echo '--- one shop cannot reach another ---'
-- The claim the whole multi-tenant design rests on. Shop B is a different
-- business; its owner is a full owner, just not of this shop.

select pg_temp.check(
  'another shop sees none of these products',
  pg_temp.can_see(:OWNER_B, 'owner', :TENANT_B, 'public.products', :TENANT_A) = 0);

select pg_temp.check(
  'another shop sees none of these sales',
  pg_temp.can_see(:OWNER_B, 'owner', :TENANT_B, 'public.sales', :TENANT_A) = 0);

select pg_temp.check(
  'another shop sees none of these staff',
  pg_temp.can_see(:OWNER_B, 'owner', :TENANT_B, 'public.users', :TENANT_A) = 0);

select pg_temp.check(
  'another shop sees none of these expenses',
  pg_temp.can_see(:OWNER_B, 'owner', :TENANT_B, 'public.expenses', :TENANT_A) = 0);

select pg_temp.check(
  'another shop sees none of these stock movements',
  pg_temp.can_see(:OWNER_B, 'owner', :TENANT_B, 'public.stock_movements', :TENANT_A) = 0);

select pg_temp.check(
  'another shop sees none of these PIN events',
  pg_temp.can_see(:OWNER_B, 'owner', :TENANT_B, 'public.staff_pin_events', :TENANT_A) = 0);

select pg_temp.check(
  'another shop cannot edit this shop''s prices',
  pg_temp.rows_touched(:OWNER_B, 'owner', :TENANT_B,
    format('update public.products set price_cents = 1 where id = %L', :RICE)) <= 0);

select pg_temp.check(
  'another shop cannot delete this shop''s staff',
  pg_temp.rows_touched(:OWNER_B, 'owner', :TENANT_B,
    format('delete from public.users where id = %L', :CASH_A)) <= 0);

\echo ''
\echo '--- the PIN hash is not readable by anyone ---'

select pg_temp.check(
  'an owner cannot read pin_hash',
  pg_temp.rows_touched(:OWNER_A, 'owner', :TENANT_A,
    'create temp table leak as select pin_hash from public.users') = -1);

reset role;

rollback;
