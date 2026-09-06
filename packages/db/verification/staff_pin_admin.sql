-- Verification for 20260905000100_staff_pin_admin.sql
--
-- Run against a database with all migrations applied:
--   psql -f packages/db/verification/staff_pin_admin.sql
--
-- Lives here rather than in supabase/tests/ because that directory is scanned
-- by pgTAP, which is not installable in every environment this has to run in.
-- Each check prints PASS or FAIL and the whole thing rolls back.
--
-- The point of these is the authorisation matrix. A PIN decides whose name a
-- sale is rung under, so "a manager cannot touch an owner's PIN" is a claim
-- worth a test rather than a comment.

\set ON_ERROR_STOP off
\timing off
\pset pager off

begin;

-- --------------------------------------------------------------------------
-- Fixtures: an owner, a manager and a cashier in one shop.
-- --------------------------------------------------------------------------

\set TENANT '''aaaaaaaa-0000-0000-0000-000000000001'''
\set OWNER  '''11111111-1111-1111-1111-111111111111'''
\set CASH   '''22222222-2222-2222-2222-222222222222'''
\set MGR    '''44444444-4444-4444-4444-444444444444'''

-- Both roles are asserted, not assumed.
--
-- An earlier version created the manager but took the cashier's role from
-- whatever the database happened to hold. Run against a copy where that user
-- was a manager, nine checks failed — correctly, because a manager may not
-- manage another manager's PIN, which is the rule under test. The suite has to
-- state the roles it is testing or it reports on the fixture instead of on the
-- code.
insert into auth.users (id) values (:MGR) on conflict do nothing;
insert into public.users (id, tenant_id, name, role, is_active, login_enabled)
values (:MGR, :TENANT, 'Manager', 'manager', true, true)
on conflict (id) do update set role = 'manager', is_active = true, tenant_id = :TENANT;

insert into auth.users (id) values (:CASH) on conflict do nothing;
insert into public.users (id, tenant_id, name, role, is_active, login_enabled)
values (:CASH, :TENANT, 'Cashier', 'cashier', true, true)
on conflict (id) do update set role = 'cashier', is_active = true, tenant_id = :TENANT;

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  raise notice '%  %', case when ok then 'PASS' else 'FAIL' end, label;
end $$;

-- Runs a statement as a given actor and reports whether it raised.
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

-- --------------------------------------------------------------------------
-- Who may issue a PIN
-- --------------------------------------------------------------------------

\echo ''
\echo '--- authorisation matrix ---'

select pg_temp.check(
  'owner may issue a cashier PIN',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    format('select public.set_staff_pin(%L, %L)', :CASH, '4817')) = 'ok');

select pg_temp.check(
  'manager may issue a cashier PIN',
  pg_temp.attempt(:MGR, 'manager', :TENANT,
    format('select public.set_staff_pin(%L, %L)', :CASH, '4818')) = 'ok');

select pg_temp.check(
  'manager may NOT issue an owner PIN',
  pg_temp.attempt(:MGR, 'manager', :TENANT,
    format('select public.set_staff_pin(%L, %L)', :OWNER, '9999')) = 'PS403');

select pg_temp.check(
  'cashier may NOT issue anyone a PIN',
  pg_temp.attempt(:CASH, 'cashier', :TENANT,
    format('select public.set_staff_pin(%L, %L)', :CASH, '9999')) = 'PS403');

select pg_temp.check(
  'a PIN outside 4-8 digits is refused',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    format('select public.set_staff_pin(%L, %L)', :CASH, '12')) = 'PS422');

-- --------------------------------------------------------------------------
-- One-time PINs
-- --------------------------------------------------------------------------

\echo ''
\echo '--- issued-by-someone-else becomes one-time ---'

select pg_temp.attempt(:OWNER, 'owner', :TENANT,
  format('select public.set_staff_pin(%L, %L)', :CASH, '4817'));

select pg_temp.check(
  'a PIN issued by someone else must be changed',
  (select must_change_pin from public.users where id = :CASH));

select pg_temp.check(
  'issuing records when it happened',
  (select pin_set_at is not null and pin_last_used_at is null
   from public.users where id = :CASH));

-- --------------------------------------------------------------------------
-- Self-service
-- --------------------------------------------------------------------------

\echo ''
\echo '--- self-service ---'

select pg_temp.check(
  'wrong current PIN is refused',
  pg_temp.attempt(:CASH, 'cashier', :TENANT,
    format('select public.change_own_staff_pin(%L, %L, %L)', :CASH, '0000', '5555'))
  = 'PS403');

select pg_temp.check(
  'reusing the same PIN is refused',
  pg_temp.attempt(:CASH, 'cashier', :TENANT,
    format('select public.change_own_staff_pin(%L, %L, %L)', :CASH, '4817', '4817'))
  = 'PS422');

select pg_temp.check(
  'a cashier may change their own PIN with the current one',
  pg_temp.attempt(:CASH, 'cashier', :TENANT,
    format('select public.change_own_staff_pin(%L, %L, %L)', :CASH, '4817', '5555'))
  = 'ok');

select pg_temp.check(
  'changing it yourself clears the must-change flag',
  (select not must_change_pin from public.users where id = :CASH));

select pg_temp.check(
  'the new PIN verifies and the old one does not',
  public.verify_staff_pin(:CASH, '5555') and not public.verify_staff_pin(:CASH, '4817'));

select pg_temp.check(
  'a successful unlock records last use',
  (select pin_last_used_at is not null from public.users where id = :CASH));

-- --------------------------------------------------------------------------
-- Forcing a reset, and clearing
-- --------------------------------------------------------------------------

\echo ''
\echo '--- forced reset and clearing ---'

-- Two statements, not one expression: SQL does not promise to evaluate the
-- call before the read, and an earlier version of this check read the flag
-- first and reported a failure that was not there.
select pg_temp.check(
  'a manager may force a cashier to re-pick',
  pg_temp.attempt(:MGR, 'manager', :TENANT,
    format('select public.require_staff_pin_change(%L)', :CASH)) = 'ok');

select pg_temp.check(
  'forcing a reset sets the flag',
  (select must_change_pin from public.users where id = :CASH));

select pg_temp.check(
  'the till is told a new PIN is owed',
  (select must_change_pin from public.till_staff(null) where id = :CASH));

select pg_temp.check(
  'a manager may clear a cashier PIN',
  pg_temp.attempt(:MGR, 'manager', :TENANT,
    format('select public.clear_staff_pin(%L)', :CASH)) = 'ok');

select pg_temp.check(
  'a cleared PIN leaves nothing behind',
  (select not has_pin and pin_set_at is null and not must_change_pin
   from public.users where id = :CASH));

select pg_temp.check(
  'forcing a reset on someone with no PIN is refused',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    format('select public.require_staff_pin_change(%L)', :CASH)) = 'PS404');

-- --------------------------------------------------------------------------
-- The trail
-- --------------------------------------------------------------------------

\echo ''
\echo '--- audit trail ---'

select pg_temp.check(
  'every change was recorded',
  (select count(*) >= 6 from public.staff_pin_events where target_id = :CASH));

select pg_temp.check(
  'the trail names who did it',
  (select actor_id = :MGR from public.staff_pin_events
   where target_id = :CASH and action = 'cleared'
   order by created_at desc limit 1));

select pg_temp.check(
  'a self-change is recorded as one',
  exists (select 1 from public.staff_pin_events
          where target_id = :CASH and action = 'changed_by_self' and actor_id = :CASH));

-- The log is written only by the SECURITY DEFINER functions above. A client
-- holding insert would be able to forge or bury an entry.
set local role authenticated;
select pg_temp.check(
  'a client cannot write to the trail',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    format('insert into public.staff_pin_events (tenant_id, target_id, action) values (%L, %L, %L)',
           :TENANT, :CASH, 'issued')) <> 'ok');

-- Checked as a privilege, not as an error. An UPDATE that RLS filters down to
-- zero rows reports success, so "it did not raise" would have passed here even
-- with the grant in place — which is exactly how the missing revoke was found.
select pg_temp.check(
  'a client holds no write privilege on the trail',
  not exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'staff_pin_events'
      and grantee in ('authenticated', 'anon')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')));

select pg_temp.check(
  'a client cannot edit the trail',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'update public.staff_pin_events set action = ''cleared''') <> 'ok');

-- The marker change_own_staff_pin() sets is not a permission. Setting it by
-- hand and then writing pin_hash directly must still fail, because
-- `authenticated` holds no update privilege on that column at all.
select pg_temp.check(
  'setting the self-change marker by hand grants nothing',
  pg_temp.attempt(:CASH, 'cashier', :TENANT,
    format('select set_config(''app.self_pin_change'', %L, true); '
           'update public.users set pin_hash = ''forged'' where id = %L',
           :CASH, :CASH)) <> 'ok');

select pg_temp.check(
  'the hash is still unreadable',
  pg_temp.attempt(:OWNER, 'owner', :TENANT,
    'select pin_hash from public.users') <> 'ok');
reset role;

rollback;
