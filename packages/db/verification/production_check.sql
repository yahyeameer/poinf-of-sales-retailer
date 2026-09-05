-- Read-only. Safe to run against the hosted project at any time.
--
--   psql "$SUPABASE_DB_URL" -f packages/db/verification/production_check.sql
--
-- Answers one question: has this database had the 20260906/20260907 migrations
-- applied, and is the cross-tenant leak closed?
--
-- Reads catalog metadata only. It creates nothing, changes nothing, and takes
-- no locks worth the name, so it is safe on a live shop mid-trading.
--
-- Run it BEFORE pushing to see what is missing, and AFTER to confirm.

\pset pager off
\timing off

\echo ''
\echo '=========================================================='
\echo ' Production readiness check'
\echo '=========================================================='

\echo ''
\echo '--- 1. THE SECURITY ONE ---'
\echo 'Every view must run as the caller. A view without security_invoker'
\echo 'reads its base tables as its OWNER, which is postgres here — no RLS at'
\echo 'all. Any row below is a view through which one shop can read another'
\echo 'shop''s data, and through which a cashier can read the wage bill.'
\echo ''

select
  c.relname as leaking_view,
  pg_get_userbyid(c.relowner) as runs_as
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and coalesce(
        (select option_value from pg_options_to_table(c.reloptions)
         where option_name = 'security_invoker'), 'off') <> 'on'
order by 1;

\echo '(no rows above = fixed)'

\echo ''
\echo '--- 2. Has each migration landed? ---'
\echo ''

select
  m.what,
  case when m.present then 'YES' else 'NO  <-- not applied' end as applied
from (
  values
    ('20260906000100  zero-total sales',
     exists (select 1 from pg_proc p
             where p.proname = 'process_sale'
               and pg_get_functiondef(p.oid) like '%elsif v_total <> 0%')),
    ('20260906000200  views run as caller',
     not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'v'
                   and coalesce((select option_value from pg_options_to_table(c.reloptions)
                                 where option_name = 'security_invoker'), 'off') <> 'on')),
    ('20260907000100  shop timezone',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tenants'
               and column_name = 'timezone')),
    ('20260907000100  current_shop_date()',
     exists (select 1 from pg_proc where proname = 'current_shop_date')),
    ('20260905000100  PIN admin + audit',
     exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'staff_pin_events')),
    ('20260905000200  expenses',
     exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'expenses'))
) as m(what, present)
order by 1;

\echo ''
\echo '--- 3. The audit log must not be writable by a client ---'
\echo 'The schema grants select/insert/update/delete on every new table to'
\echo '`authenticated` by default, so this needs an explicit revoke. Rows below'
\echo 'mean the PIN trail can be forged or erased by anyone signed in.'
\echo ''

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'staff_pin_events'
  and grantee in ('authenticated', 'anon')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
order by 1, 2;

\echo '(no rows above = fixed)'

\echo ''
\echo '--- 4. The PIN hash must not be readable ---'
\echo 'A row below means `authenticated` holds a grant covering pin_hash.'
\echo ''

select grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'users'
  and column_name = 'pin_hash'
  and grantee in ('authenticated', 'anon')
order by 1, 2;

\echo '(no rows above = fixed)'

\echo ''
\echo '--- 5. Every table must have RLS on, with at least one policy ---'
\echo ''

select c.relname as table_without_protection,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and (not c.relrowsecurity
       or (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname) = 0)
order by 1;

\echo '(no rows above = fixed)'

\echo ''
\echo '--- 6. What timezone is each shop on? ---'
\echo 'UTC is the default and is correct only for a shop actually on UTC.'
\echo 'A shop that trades past local midnight, or anywhere west of Greenwich,'
\echo 'will have its daily figures land on the wrong day until this is set.'
\echo ''

select name, currency, timezone
from public.tenants
order by name;

\echo ''
\echo '=========================================================='
\echo ' Done. Sections 1, 3, 4 and 5 must all print no rows.'
\echo '=========================================================='
