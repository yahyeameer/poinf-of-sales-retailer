-- Verification for 20260908000200_report_stats_location_scope.sql
--
--   psql -f packages/db/verification/report_location_scope.sql
--
-- weekly_report_stats() is SECURITY DEFINER, so RLS does not constrain it and
-- the location scoping has to be written into the function itself. That makes
-- it exactly the kind of code where a test is worth more than a comment: the
-- policies on public.sales can be perfect and this function still hand a
-- warehouse picker the shop's takings.
--
-- Three claims:
--   1. a location-pinned caller sees only their own location's figures
--   2. an unpinned caller (owner) sees the whole business, unchanged
--   3. service_role — the emailed digest, which has no JWT and so no
--      location — also still sees the whole business
--
-- Claim 2 matters as much as claim 1. A scoping fix that quietly halves the
-- owner's revenue would pass a test that only checked the cashier.

\set ON_ERROR_STOP off
\pset pager off

begin;

\set TENANT '''aaaaaaaa-0000-0000-0000-000000000001'''
\set OTHER  '''bbbbbbbb-0000-0000-0000-000000000002'''
\set OWNER  '''11111111-1111-1111-1111-111111111111'''
\set SHOPPY '''22222222-2222-2222-2222-222222222222'''
\set WHSE   '''44444444-4444-4444-4444-444444444444'''
\set LOC_S  '''cccccccc-0000-0000-0000-00000000000a'''
\set LOC_W  '''cccccccc-0000-0000-0000-00000000000b'''
\set PROD_A '''dddddddd-0000-0000-0000-00000000000a'''
\set PROD_B '''dddddddd-0000-0000-0000-00000000000b'''

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, label;
end $$;

-- Calls the report as a given actor and returns one figure from it.
--
-- `ask` is separate from `tenant` on purpose. The first version passed one
-- value as both the caller's tenant claim and the function's argument, so the
-- cross-tenant check asked a shop for its own figures and the guard — quite
-- correctly — let it through. The test reported a hole in the guard that was
-- not there. Reading another shop means claiming to be in one shop and asking
-- about a different one, which needs two values.
create or replace function pg_temp.stat(
  actor uuid, shop_role text, tenant uuid, key text,
  jwt_role text default 'authenticated', ask uuid default null
) returns text language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', jwt_role,
                      'tenant_id', tenant, 'shop_role', shop_role)::text, true);
  v := public.weekly_report_stats(coalesce(ask, tenant), current_date + 1);
  return v ->> key;
exception when others then
  return 'ERR:' || sqlstate;
end $$;

-- --------------------------------------------------------------------------
-- Fixtures: one shop, two locations, takings in both.
-- --------------------------------------------------------------------------

insert into public.tenants (id, name, currency, tax_rate, timezone)
values (:TENANT, 'Scope Test Shop', 'KES', 0, 'Africa/Nairobi')
on conflict (id) do update set timezone = 'Africa/Nairobi';

insert into public.locations (id, tenant_id, name, kind, is_default, is_active) values
  (:LOC_S, :TENANT, 'Front Shop', 'shop',      true,  true),
  (:LOC_W, :TENANT, 'Back Store', 'warehouse', false, true)
on conflict (id) do nothing;

insert into auth.users (id) values (:OWNER), (:SHOPPY), (:WHSE) on conflict do nothing;

insert into public.users (id, tenant_id, name, role, is_active, login_enabled, location_id) values
  (:OWNER,  :TENANT, 'Owner',     'owner',   true, true, null),
  (:SHOPPY, :TENANT, 'Shop Till', 'cashier', true, true, :LOC_S),
  (:WHSE,   :TENANT, 'Picker',    'manager', true, true, :LOC_W)
on conflict (id) do update set location_id = excluded.location_id, role = excluded.role;

insert into public.products (id, tenant_id, name, price_cents, cost_cents, unit, is_active) values
  (:PROD_A, :TENANT, 'Shop Rice',  1000, 600, 'each', true),
  (:PROD_B, :TENANT, 'Store Rice', 2000, 900, 'each', true)
on conflict (id) do nothing;

-- Three sales at the shop worth 3000, one at the warehouse worth 5000.
insert into public.sales (id, tenant_id, location_id, client_id, subtotal_cents,
                          total_cents, payment_method, status, created_at)
values
  (gen_random_uuid(), :TENANT, :LOC_S, 'scope-test-c1', 1000, 1000, 'cash', 'completed', now() - interval '1 day'),
  (gen_random_uuid(), :TENANT, :LOC_S, 'scope-test-c2', 1000, 1000, 'cash', 'completed', now() - interval '2 day'),
  (gen_random_uuid(), :TENANT, :LOC_S, 'scope-test-c3', 1000, 1000, 'cash', 'completed', now() - interval '3 day'),
  (gen_random_uuid(), :TENANT, :LOC_W, 'scope-test-c4', 5000, 5000, 'cash', 'completed', now() - interval '1 day');

insert into public.sale_items (tenant_id, sale_id, product_id, quantity,
                               unit_price_cents, line_total_cents, name_at_sale, unit_cost_cents)
select s.tenant_id, s.id,
       case when s.location_id = :LOC_S::uuid then :PROD_A::uuid else :PROD_B::uuid end,
       1,
       s.total_cents, s.total_cents,
       case when s.location_id = :LOC_S::uuid then 'Shop Rice' else 'Store Rice' end,
       case when s.location_id = :LOC_S::uuid then 600 else 900 end
from public.sales s where s.tenant_id = :TENANT::uuid;

set local role authenticated;

\echo ''
\echo '--- a location-pinned caller sees only their own location ---'

select pg_temp.check(
  'the shop till sees the shop takings only (3000, not 8000)',
  pg_temp.stat(:SHOPPY, 'cashier', :TENANT, 'revenue_this_week') = '3000');

select pg_temp.check(
  'the shop till counts its own baskets only (3, not 4)',
  pg_temp.stat(:SHOPPY, 'cashier', :TENANT, 'transactions_this_week') = '3');

select pg_temp.check(
  'the warehouse sees the warehouse takings only (5000)',
  pg_temp.stat(:WHSE, 'manager', :TENANT, 'revenue_this_week') = '5000');

select pg_temp.check(
  'the warehouse counts its own baskets only (1)',
  pg_temp.stat(:WHSE, 'manager', :TENANT, 'transactions_this_week') = '1');

-- The leak that prompted this migration: top movers came from a whole-tenant
-- view, so the shop's list named the warehouse's product.
select pg_temp.check(
  'the shop till is not shown the warehouse product in top movers',
  pg_temp.stat(:SHOPPY, 'cashier', :TENANT, 'top_5_movers') not like '%Store Rice%');

select pg_temp.check(
  'the warehouse is not shown the shop product in top movers',
  pg_temp.stat(:WHSE, 'manager', :TENANT, 'top_5_movers') not like '%Shop Rice%');

\echo ''
\echo '--- an unpinned caller still sees the whole business ---'
-- The regression this fix could plausibly have caused.

select pg_temp.check(
  'the owner sees every location (8000)',
  pg_temp.stat(:OWNER, 'owner', :TENANT, 'revenue_this_week') = '8000');

select pg_temp.check(
  'the owner counts every basket (4)',
  pg_temp.stat(:OWNER, 'owner', :TENANT, 'transactions_this_week') = '4');

select pg_temp.check(
  'the owner sees both products in top movers',
  pg_temp.stat(:OWNER, 'owner', :TENANT, 'top_5_movers') like '%Store Rice%'
  and pg_temp.stat(:OWNER, 'owner', :TENANT, 'top_5_movers') like '%Shop Rice%');

\echo ''
\echo '--- the emailed digest is unaffected ---'
-- The edge function calls this as service_role, which carries no location.

select pg_temp.check(
  'service_role sees every location (8000)',
  pg_temp.stat(:OWNER, 'owner', :TENANT, 'revenue_this_week', 'service_role') = '8000');

\echo ''
\echo '--- the tenant guard still holds ---'

select pg_temp.check(
  'another shop is refused with PS403',
  pg_temp.stat(:SHOPPY, 'cashier', :TENANT, 'revenue_this_week',
               'authenticated', :OTHER::uuid) = 'ERR:PS403');

-- The location scoping must not be reachable by lying about the location
-- either: current_location_id() reads public.users, not the JWT.
select pg_temp.check(
  'a pinned caller cannot widen their own scope via the claim',
  pg_temp.stat(:SHOPPY, 'owner', :TENANT, 'revenue_this_week') = '3000');

reset role;

rollback;
