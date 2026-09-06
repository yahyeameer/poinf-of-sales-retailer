-- Schema drift: is each unrecorded migration ACTUALLY applied?
--
-- Read-only. Paste into the SQL editor.
--
-- The pre-flight found 21 migrations in the repo with no row in this database's
-- migration history. That does not mean the work is missing: the history here
-- was written with different version numbers (20260803145544
-- extensions_and_helpers, where the repo calls the same migration
-- 20260728000100), so the two lineages arrived at the same schema by different
-- routes. Marking the repo's versions as applied would be right for those.
--
-- It would be very wrong for any migration whose work is genuinely absent.
-- Production's history stops at 20260819091643 and then jumps to the ones
-- applied this week, so suppliers, purchase orders and the weekly report
-- schedule may never have been applied at all — and the app has pages for all
-- three.
--
-- So: check the objects, not the bookkeeping. Each row names something the
-- migration definitively creates and reports whether this database has it.
--
--   PRESENT  the work is here. Safe to record the repo's version as applied.
--   MISSING  the work is not here. This migration must actually be run.

with sig(version, name, signature, present) as (
  values
    ('20260728000100', 'extensions_and_helpers', 'function current_tenant_id', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='current_tenant_id'))),
    ('20260728000200', 'tenancy', 'table tenants', (to_regclass('public.tenants') is not null)),
    ('20260728000300', 'catalog', 'table products', (to_regclass('public.products') is not null)),
    ('20260728000400', 'sales_and_ledger', 'table sales', (to_regclass('public.sales') is not null)),
    ('20260728000500', 'rls', 'policy products', (exists (select 1 from pg_policies where schemaname='public' and tablename='products'))),
    ('20260728000600', 'rpc', 'function process_sale', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='process_sale'))),
    ('20260728000700', 'reporting', 'function weekly_report_stats', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='weekly_report_stats'))),
    ('20260728000800', 'tenant_claim_fallback', 'function current_shop_role', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='current_shop_role'))),
    ('20260728000900', 'lock_down_function_grants', 'function handle_new_auth_user', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='handle_new_auth_user'))),
    ('20260805000100', 'phase1_shifts_tender_refunds', 'table shifts', (to_regclass('public.shifts') is not null)),
    ('20260805000200', 'phase1_rpcs', 'function open_shift', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='open_shift'))),
    ('20260805000300', 'locations', 'table locations', (to_regclass('public.locations') is not null)),
    ('20260806000100', 'warehouse_ops', 'function transfer_stock_batch', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transfer_stock_batch'))),
    ('20260807000100', 'shop_branding', 'column tenants.logo_path', (exists (select 1 from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='logo_path'))),
    ('20260808000100', 'staff_without_logins', 'function till_staff', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='till_staff'))),
    ('20260808000200', 'fix_void_sale_missing_location', 'function void_sale', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='void_sale'))),
    ('20260817000100', 'reconcile_with_production', 'function set_staff_pin', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='set_staff_pin'))),
    ('20260817000200', 'location_isolation', 'function current_location_kind', (exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='current_location_kind'))),
    ('20260903000100', 'suppliers', 'table suppliers', (to_regclass('public.suppliers') is not null)),
    ('20260903000200', 'purchase_orders', 'table purchase_orders', (to_regclass('public.purchase_orders') is not null)),
    ('20260903000300', 'weekly_report_schedule', 'table report_deliveries', (to_regclass('public.report_deliveries') is not null))
)
select
  version,
  name,
  signature,
  case when present then 'PRESENT' else 'MISSING' end as state
from sig
order by version;
