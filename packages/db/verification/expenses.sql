-- Verification for 20260905000200_expenses.sql
--
--   psql -f packages/db/verification/expenses.sql
--
-- The claim worth testing is the one that differs from every other table in
-- this schema: expenses hold wages, so a cashier must not be able to read
-- them. Everything else here is ordinary, and the last two checks are about
-- the arithmetic being honest when one side of the join is missing.

\set ON_ERROR_STOP off
\pset pager off

begin;

\set TENANT '''aaaaaaaa-0000-0000-0000-000000000001'''
\set OWNER  '''11111111-1111-1111-1111-111111111111'''
\set CASH   '''22222222-2222-2222-2222-222222222222'''
\set MGR    '''44444444-4444-4444-4444-444444444444'''

insert into auth.users (id) values (:MGR) on conflict do nothing;
insert into public.users (id, tenant_id, name, role, is_active, login_enabled)
values (:MGR, :TENANT, 'Manager', 'manager', true, true)
on conflict (id) do update set role = 'manager', is_active = true;

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

-- Counts rows visible to a given actor, under that actor's RLS.
create or replace function pg_temp.visible(
  actor uuid, shop_role text, tenant uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated',
                      'tenant_id', tenant, 'shop_role', shop_role)::text, true);
  select count(*) into n from public.expenses;
  return n;
end $$;

create or replace function pg_temp.visible_expenses_view(
  actor uuid, shop_role text, tenant uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated',
                      'tenant_id', tenant, 'shop_role', shop_role)::text, true);
  select count(*) into n from public.v_expenses_daily;
  return n;
end $$;

create or replace function pg_temp.visible_profit_view(
  actor uuid, shop_role text, tenant uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated',
                      'tenant_id', tenant, 'shop_role', shop_role)::text, true);
  select count(*) into n from public.v_profit_daily where revenue_cents <> 0 or expenses_cents <> 0;
  return n;
end $$;

\echo ''
\echo '--- recording ---'

select pg_temp.check(
  'an owner can record an expense',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.record_expense(''rent'', 250000, current_date, ''March'', null)') = 'ok');

select pg_temp.check(
  'a manager can record an expense',
  pg_temp.attempt(:MGR, 'manager', :TENANT,
    'select public.record_expense(''wages'', 90000, current_date, null, null)') = 'ok');

select pg_temp.check(
  'a cashier cannot record an expense',
  pg_temp.attempt(:CASH, 'cashier', :TENANT,
    'select public.record_expense(''wages'', 1, current_date, null, null)') = 'PS403');

select pg_temp.check(
  'zero and negative amounts are refused',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.record_expense(''fees'', 0, current_date, null, null)') = 'PS422'
);

-- Measured against the shop's own today, not the server's.
--
-- 20260906000300 gave this a day of slack because nothing recorded where the
-- shop was, so it had to tolerate any offset. 20260907000100 records the zone,
-- so current_shop_date() can answer exactly and the guard is back to meaning
-- what it says. The zone-aware behaviour is covered in verification/timezone.sql;
-- here the shop is on UTC, so the shop's today and the server's coincide.
select pg_temp.check(
  'the shop''s own today is accepted',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.record_expense(''fees'', 500, public.current_shop_date(), null, null)') = 'ok');

select pg_temp.check(
  'a date past the shop''s today is refused',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select public.record_expense(''fees'', 500, public.current_shop_date() + 1, null, null)') = 'PS422');

select pg_temp.check(
  'the recorder is remembered',
  (select created_by = :MGR from public.expenses where category = 'wages' limit 1));

\echo ''
\echo '--- wages stay away from the floor ---'

-- RLS does not apply to a superuser or to the table's owner, and this script
-- connects as postgres. Without dropping to `authenticated` first, every check
-- below reads every row and reports a pass it has not earned — which is what
-- an earlier version of this file did.
set local role authenticated;

select pg_temp.check(
  'an owner sees the expenses',
  pg_temp.visible(:OWNER, 'owner', :TENANT) >= 2);

select pg_temp.check(
  'a manager sees the expenses',
  pg_temp.visible(:MGR, 'manager', :TENANT) >= 2);

-- The one that matters. Not "the UI hides it" — the rows are not returned.
select pg_temp.check(
  'a cashier sees no expenses at all',
  pg_temp.visible(:CASH, 'cashier', :TENANT) = 0);

select pg_temp.check(
  'another shop sees none of them',
  pg_temp.visible(:OWNER, 'owner', 'bbbbbbbb-0000-0000-0000-000000000002') = 0);

select pg_temp.check(
  'a cashier cannot delete what they cannot see',
  (select pg_temp.attempt(:CASH, 'cashier', :TENANT, 'delete from public.expenses') = 'ok'
   and pg_temp.visible(:OWNER, 'owner', :TENANT) >= 2));

-- A view does not run as the caller unless it is told to. Postgres evaluates
-- a view against its OWNER, and RLS on the tables underneath with it, unless
-- the view carries security_invoker = on. These views are owned by postgres,
-- so without it they read every shop's rows as a superuser — which is how a
-- cashier could read the wage bill by selecting the view instead of the table,
-- and how one shop could read another's takings. Checked as a property of
-- every view in the schema, not just these three, so the next one added cannot
-- reintroduce it quietly.
select pg_temp.check(
  'every view runs as the caller, not as its owner',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'off') <> 'on'));

select pg_temp.check(
  'a cashier cannot read the wage bill through the daily view either',
  pg_temp.visible_expenses_view(:CASH, 'cashier', :TENANT) = 0);

select pg_temp.check(
  'another shop cannot read this shop''s profit through the view',
  pg_temp.visible_profit_view(:OWNER, 'owner', 'bbbbbbbb-0000-0000-0000-000000000002') = 0);

select pg_temp.check(
  'the shop''s own manager still sees the daily view',
  pg_temp.visible_expenses_view(:MGR, 'manager', :TENANT) >= 1);

reset role;

\echo ''
\echo '--- the arithmetic ---'

-- A day with spending and no sales must still appear, with the loss showing.
-- An inner join would drop it and quietly overstate the month.
select pg_temp.attempt(:OWNER, 'owner', :TENANT,
  'select public.record_expense(''utilities'', 4000, current_date - 400, ''old bill'', null)');

select pg_temp.check(
  'a day with expenses and no sales still reports',
  exists (select 1 from public.v_profit_daily where day = current_date - 400));

select pg_temp.check(
  'that day shows a loss, not a zero',
  (select net_profit_cents = -4000 and revenue_cents = 0
   from public.v_profit_daily where day = current_date - 400));

select pg_temp.check(
  'daily spend is grouped by category',
  (select amount_cents = 4000 from public.v_expenses_daily
   where day = current_date - 400 and category = 'utilities'));

rollback;
