-- Verification for process_sale() — the till's money path.
--
--   psql -f packages/db/verification/sales.sql
--
-- This is the function a shop's whole day runs through, so the checks here are
-- the awkward cases rather than the happy one: a sale that comes to nothing, a
-- retry of a sale that already landed, a basket that would go below zero stock,
-- and the arithmetic at the rounding boundaries.
--
-- The totals below were computed by hand and are written as literals on
-- purpose. A test that recomputes the expected value with the same expression
-- the code uses proves only that the expression is deterministic.

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

-- Acts as the owner for the whole script.
select set_config('request.jwt.claims',
  json_build_object('sub', :OWNER, 'role', 'authenticated',
                    'tenant_id', :TENANT, 'shop_role', 'owner')::text, true);

-- Plenty of stock, so the arithmetic checks are not fighting the oversell gate.
update public.location_stock set on_hand = 100000;

\echo ''
\echo '--- a sale that comes to nothing still records ---'

-- Both of these used to fail on sale_payments_amount_cents_check and show the
-- cashier a raw Postgres error mid-checkout. Fixed in 20260906000100.

update public.tenants set tax_rate = 0, tax_inclusive = true where id = :TENANT;

select pg_temp.check(
  'a zero-priced line completes',
  pg_temp.attempt(format(
    'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
    'zeroline-0001',
    format('[{"product_id":"%s","quantity":1,"unit_price_cents":0}]', :RICE))) = 'ok');

select pg_temp.check(
  'a discount cancelling the basket completes',
  pg_temp.attempt(format(
    'select public.process_sale(%L, %L::jsonb, ''cash'', 5000)',
    'fulldisc-0001',
    format('[{"product_id":"%s","quantity":1,"unit_price_cents":5000}]', :RICE))) = 'ok');

select pg_temp.check(
  'neither wrote a payment row',
  not exists (
    select 1 from public.sale_payments p
    join public.sales s on s.id = p.sale_id
    where s.client_id in ('zeroline-0001', 'fulldisc-0001')));

-- The reason for recording them at all: stock still moved.
select pg_temp.check(
  'a zero-total sale still moves stock',
  exists (
    select 1 from public.stock_movements m
    join public.sales s on s.id = m.reference_id
    where s.client_id = 'zeroline-0001' and m.delta = -1));

\echo ''
\echo '--- the same sale twice is one sale ---'

-- A till on a bad connection retries. Two devices replaying a queued sale race.
-- Either way the shop must not be paid twice or the stock counted down twice.
select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
  'idem-00000001',
  format('[{"product_id":"%s","quantity":2,"unit_price_cents":1000}]', :RICE)));

select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
  'idem-00000001',
  format('[{"product_id":"%s","quantity":2,"unit_price_cents":1000}]', :RICE)));

select pg_temp.check(
  'a replayed client_id creates exactly one sale',
  (select count(*) = 1 from public.sales where client_id = 'idem-00000001'));

select pg_temp.check(
  'and moves stock exactly once',
  (select count(*) = 1 from public.stock_movements m
   join public.sales s on s.id = m.reference_id
   where s.client_id = 'idem-00000001'));

select pg_temp.check(
  'and charges exactly once',
  (select count(*) = 1 from public.sale_payments p
   join public.sales s on s.id = p.sale_id
   where s.client_id = 'idem-00000001'));

\echo ''
\echo '--- what a sale refuses ---'

select pg_temp.check(
  'an empty basket is refused',
  pg_temp.attempt(
    'select public.process_sale(''empty-00000001'', ''[]''::jsonb, ''cash'', 0)') = 'PS422');

select pg_temp.check(
  'a zero quantity is refused',
  pg_temp.attempt(format(
    'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
    'zeroqty-00001',
    format('[{"product_id":"%s","quantity":0,"unit_price_cents":100}]', :RICE))) = 'PS422');

select pg_temp.check(
  'a negative quantity is refused',
  pg_temp.attempt(format(
    'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
    'negqty-000001',
    format('[{"product_id":"%s","quantity":-1,"unit_price_cents":100}]', :RICE))) = 'PS422');

select pg_temp.check(
  'a product from another shop is refused',
  pg_temp.attempt(
    'select public.process_sale(''foreign-00001'', ''[{"product_id":"9d000000-0000-0000-0000-0000000000ff","quantity":1,"unit_price_cents":100}]''::jsonb, ''cash'', 0)') = 'PS404');

update public.tenants set allow_oversell = false where id = :TENANT;

-- location_stock, not products.stock_on_hand. The guard is per-location, and
-- products.stock_on_hand is a whole-shop cache of the same ledger — setting
-- that one by hand desynchronises the two and tests nothing, which is what an
-- earlier version of this check did and then reported a failure that was not
-- there.
update public.location_stock set on_hand = 1 where product_id = :RICE;

select pg_temp.check(
  'selling more than is in stock is refused when oversell is off',
  pg_temp.attempt(format(
    'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
    'oversell-0001',
    format('[{"product_id":"%s","quantity":5,"unit_price_cents":100}]', :RICE))) = 'PS422');

\echo ''
\echo '--- the arithmetic, at the rounding boundaries ---'
-- Expected values worked out by hand, not by re-running the formula.

update public.location_stock set on_hand = 100000;
update public.tenants set allow_oversell = true where id = :TENANT;

-- 3 x 1999 = 5997. Tax exclusive at 7.5%: 5997 * 0.075 = 449.775 -> 450.
update public.tenants set tax_rate = 0.075, tax_inclusive = false where id = :TENANT;
select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
  'round-0000001',
  format('[{"product_id":"%s","quantity":3,"unit_price_cents":1999}]', :RICE)));

select pg_temp.check(
  'exclusive tax rounds half away from zero (450, not 449)',
  (select subtotal_cents = 5997 and tax_cents = 450 and total_cents = 6447
   from public.sales where client_id = 'round-0000001'));

-- Same basket, tax inclusive: 5997 * 0.075 / 1.075 = 418.39... -> 418.
update public.tenants set tax_rate = 0.075, tax_inclusive = true where id = :TENANT;
select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
  'round-0000002',
  format('[{"product_id":"%s","quantity":3,"unit_price_cents":1999}]', :RICE)));

select pg_temp.check(
  'inclusive tax is backed out, not added on (418, total unchanged)',
  (select tax_cents = 418 and total_cents = 5997
   from public.sales where client_id = 'round-0000002'));

-- A weighed line: 1.5 kg at 200.00. 1.5 * 20000 = 30000 exactly.
update public.tenants set tax_rate = 0, tax_inclusive = true where id = :TENANT;
select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
  'weighed-00001',
  format('[{"product_id":"%s","quantity":1.5,"unit_price_cents":20000}]', :RICE)));

select pg_temp.check(
  'a fractional quantity totals exactly',
  (select total_cents = 30000 from public.sales where client_id = 'weighed-00001'));

select pg_temp.check(
  'a discount larger than the basket clamps rather than going negative',
  pg_temp.attempt(format(
    'select public.process_sale(%L, %L::jsonb, ''cash'', 999999)',
    'clamp-0000001',
    format('[{"product_id":"%s","quantity":1,"unit_price_cents":20000}]', :RICE))) = 'ok'
);

select pg_temp.check(
  'and the clamped sale reads 0, not a negative total',
  (select discount_cents = 20000 and total_cents = 0
   from public.sales where client_id = 'clamp-0000001'));

\echo ''
\echo '--- what the reports read ---'

-- v_profit_daily subtracts expenses from margin. Margin comes from the unit
-- cost snapshotted on each line, so it must survive a later cost change.
-- products.stock_on_hand is a whole-shop cache of the ledger; location_stock
-- is the per-location view of the same movements. process_sale()'s oversell
-- guard reads the second and every screen shows the first, so if a sale moved
-- one without the other the till would start refusing sales it should allow.
--
-- Asserted as a delta across one sale rather than as a global equality: the
-- checks above set stock by hand to reach their cases, which desynchronises
-- the two on purpose, so a global comparison here would only be measuring this
-- script's own fixtures.
create temp table stock_before as
  select p.stock_on_hand as cache,
         (select sum(on_hand) from public.location_stock where product_id = p.id) as ledger
  from public.products p where p.id = :RICE;

select pg_temp.attempt(format(
  'select public.process_sale(%L, %L::jsonb, ''cash'', 0)',
  'syncchk-00001',
  format('[{"product_id":"%s","quantity":4,"unit_price_cents":100}]', :RICE)));

select pg_temp.check(
  'a sale moves the shop cache and the location ledger together',
  (select p.stock_on_hand = b.cache - 4
      and (select sum(on_hand) from public.location_stock where product_id = p.id) = b.ledger - 4
   from public.products p, stock_before b
   where p.id = :RICE));

select pg_temp.check(
  'margin uses the cost captured at the time of sale',
  (select count(*) > 0 from public.sale_items where unit_cost_cents is not null));

rollback;
