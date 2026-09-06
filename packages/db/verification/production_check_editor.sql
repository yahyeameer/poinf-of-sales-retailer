-- Read-only production check — for the Supabase SQL editor.
--
-- Paste the whole file into the SQL editor and run it. One query, one result
-- grid, one row per check.
--
-- This is the same set of checks as production_check.sql, which is written for
-- psql and uses \echo and \pset — backslash commands are a psql feature and do
-- nothing in the SQL editor, so that file cannot be pasted there. This one is a
-- single statement with no client-side syntax at all.
--
-- It reads catalog metadata and one small table. It creates nothing, changes
-- nothing, and is safe to run on a live shop mid-trading.
--
-- Every row should read PASS. Run it before the push to see the leak, and
-- after to confirm it is closed.

with checks as (

  -- ---------------------------------------------------------------------
  -- 1. THE SECURITY ONE
  --
  -- A view without security_invoker reads its base tables as its OWNER
  -- (postgres here), so no RLS applies at all: one shop can read another's
  -- takings, and a cashier can read the wage bill by selecting the view
  -- instead of the table.
  -- ---------------------------------------------------------------------
  select
    1 as sort,
    'Every view runs as the caller' as item,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
    case when count(*) = 0
      then 'no view bypasses RLS'
      else count(*) || ' leaking: ' || string_agg(relname, ', ' order by relname)
    end as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'off') <> 'on'

  union all

  -- ---------------------------------------------------------------------
  -- 2. Did each migration land?
  -- ---------------------------------------------------------------------
  select 2, 'Migration 20260905000100 (PIN admin + audit)',
    case when to_regclass('public.staff_pin_events') is not null then 'PASS' else 'FAIL' end,
    'staff_pin_events table'

  union all
  select 3, 'Migration 20260905000200 (expenses)',
    case when to_regclass('public.expenses') is not null then 'PASS' else 'FAIL' end,
    'expenses table'

  union all
  select 4, 'Migration 20260906000100 (zero-total sales)',
    case when exists (
      select 1 from pg_proc p
      where p.proname = 'process_sale'
        and pg_get_functiondef(p.oid) like '%elsif v_total <> 0%'
    ) then 'PASS' else 'FAIL' end,
    'process_sale skips the payment row when the total is zero'

  union all
  select 5, 'Migration 20260907000100 (shop timezone)',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants' and column_name = 'timezone'
    ) then 'PASS' else 'FAIL' end,
    'tenants.timezone column'

  union all
  select 6, 'Migration 20260907000100 (current_shop_date)',
    case when exists (select 1 from pg_proc where proname = 'current_shop_date')
      then 'PASS' else 'FAIL' end,
    'current_shop_date() function'

  union all

  -- ---------------------------------------------------------------------
  -- 3. The audit log must not be client-writable.
  --
  -- This schema grants select/insert/update/delete on every NEW table to
  -- `authenticated` automatically (ALTER DEFAULT PRIVILEGES, 20260817000100),
  -- so an append-only table needs an explicit revoke. Without it the PIN trail
  -- can be forged or erased by anyone signed in.
  -- ---------------------------------------------------------------------
  select
    7,
    'PIN audit log is append-only',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0
      then 'no client holds insert/update/delete'
      else 'writable by: ' || string_agg(distinct grantee, ', ')
    end
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'staff_pin_events'
    and grantee in ('authenticated', 'anon')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')

  union all

  -- ---------------------------------------------------------------------
  -- 4. The PIN hash must not be readable by anyone.
  -- ---------------------------------------------------------------------
  select
    8,
    'PIN hashes are unreadable',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0
      then 'no client grant covers users.pin_hash'
      else 'exposed to: ' || string_agg(distinct grantee, ', ')
    end
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'users'
    and column_name = 'pin_hash'
    and grantee in ('authenticated', 'anon')

  union all

  -- ---------------------------------------------------------------------
  -- 5. Every table needs RLS on, with at least one policy.
  -- ---------------------------------------------------------------------
  select
    9,
    'Every table has RLS and a policy',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0
      then 'all tables protected'
      else 'unprotected: ' || string_agg(relname, ', ' order by relname)
    end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (not c.relrowsecurity
         or (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) = 0)

  union all

  -- ---------------------------------------------------------------------
  -- 6. Which shops are still on UTC?
  --
  -- Not a failure — UTC is the default and is right for a shop actually on
  -- UTC. It is a REVIEW because a shop trading past local midnight, or
  -- anywhere west of Greenwich, will have its daily figures land on the wrong
  -- day until this is set.
  -- ---------------------------------------------------------------------
  select
    10,
    'Shop timezones set',
    case
      when not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'tenants'
                         and column_name = 'timezone') then 'FAIL'
      when (select count(*) from public.tenants where timezone = 'UTC') = 0 then 'PASS'
      else 'REVIEW'
    end,
    case
      when not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'tenants'
                         and column_name = 'timezone')
        then 'column missing - apply 20260907000100 first'
      else coalesce(
        (select 'still on UTC: ' || string_agg(name, ', ' order by name)
         from public.tenants where timezone = 'UTC'),
        'every shop has a timezone')
    end
)

select item, status, detail
from checks
order by sort;
