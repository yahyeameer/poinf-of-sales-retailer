-- weekly_report_stats() ignored location isolation.
--
-- 20260817000200 scoped every table that carries a location, so a cashier
-- pinned to one shop can no longer read another's takings from public.sales.
-- This function walked straight past that: it is SECURITY DEFINER, so RLS does
-- not apply to it at all, and every figure it built was a whole-tenant
-- aggregate. Any signed-in staff member could call
--
--     /rest/v1/rpc/weekly_report_stats
--
-- and read the revenue, basket count and top movers of every location in the
-- business, including ones their own policies refuse them row by row.
--
-- The /reports/weekly page does hide itself from warehouse staff, but
-- nav-items.ts is explicit that this is "presentation, not enforcement" — the
-- RPC is reachable whether or not the page links to it. The tenant guard below
-- was already right and is untouched; what was missing was the location half.
--
-- The fix is can_see_location() on each subquery that reads sales. That
-- function is `current_location_id() is null or current_location_id() = $1`,
-- so it is true for everyone unpinned — an owner sees the whole business
-- exactly as before, and the emailed digest, which runs as service_role with
-- no JWT and therefore no location, is likewise unchanged.
--
-- WHAT IS DELIBERATELY STILL ORG-WIDE
-- dead_stock_30d reads v_dead_stock, which is product-level: it has no
-- location column because it reports products.stock_on_hand and cost. That
-- matches the line 20260817000200 already drew — "products, categories,
-- product_images. Catalog is org-wide by design" — so it is left alone rather
-- than half-scoped against a column that does not exist.
--
-- WHY top_5_movers IS REWRITTEN RATHER THAN FILTERED
-- It read v_product_performance, which is grouped by (tenant, product, day)
-- and carries no location_id. Adding one would have changed that view's grain
-- for every other consumer — v_profit_daily, the dashboard and the analytics
-- page all read it — so the movers are computed here from sale_items instead,
-- where the sale's own location_id is in reach. No view changes; nothing else
-- that reads v_product_performance is affected.
--
-- WHILE HERE: the week boundaries now honour the shop's timezone.
-- 20260907000100 moved every daily figure onto the shop's own day, but this
-- function still compared a timestamptz against a bare date, which buckets by
-- UTC. That was invisible while every tenant sat on the UTC default and turns
-- into real misplacement the moment one does not: at UTC+3 a sale rung at
-- 01:00 on Monday falls into the previous week's report.

set search_path = public, extensions;

create or replace function public.weekly_report_stats(
  p_tenant_id uuid,
  p_week_end  date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tenant     public.tenants;
  v_this_start date := p_week_end - 7;
  v_last_start date := p_week_end - 14;
  v_tz         text;
  v_result     jsonb;
begin
  -- Unchanged: one shop cannot ask for another's week.
  if p_tenant_id is distinct from public.current_tenant_id()
     and auth.role() <> 'service_role' then
    raise exception 'Not permitted for this tenant' using errcode = 'PS403';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  v_tz := coalesce(v_tenant.timezone, 'UTC');

  select jsonb_build_object(
    'shop_name', v_tenant.name,
    'currency',  v_tenant.currency,

    'revenue_this_week', coalesce((
      select sum(s.total_cents) from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
    ), 0),

    'revenue_last_week', coalesce((
      select sum(s.total_cents) from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_last_start
        and (s.created_at at time zone v_tz)::date <  v_this_start
    ), 0),

    'transactions_this_week', coalesce((
      select count(*) from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
    ), 0),

    -- Same figures v_product_performance would have given, restricted to the
    -- locations the caller is allowed to see.
    'top_5_movers', coalesce((
      select jsonb_agg(t) from (
        select p.name,
               sum(si.quantity)         as units,
               sum(si.line_total_cents) as revenue
        from public.sale_items si
        join public.sales s    on s.id = si.sale_id
        join public.products p on p.id = si.product_id
        where si.tenant_id = p_tenant_id and s.status = 'completed'
          and public.can_see_location(s.location_id)
          and (s.created_at at time zone v_tz)::date >= v_this_start
          and (s.created_at at time zone v_tz)::date <  p_week_end
        group by p.name
        order by sum(si.line_total_cents) desc
        limit 5
      ) t
    ), '[]'::jsonb),

    -- Product-level and intentionally org-wide; see the migration header.
    'dead_stock_30d', coalesce((
      select jsonb_agg(t) from (
        select name, stock_on_hand, days_since_last_sale
        from public.v_dead_stock
        where tenant_id = p_tenant_id
        order by tied_up_cents desc
        limit 5
      ) t
    ), '[]'::jsonb),

    -- v_low_stock is per location, so this one can be scoped directly.
    'low_stock_alerts', coalesce((
      select jsonb_agg(t) from (
        select name, stock_on_hand, reorder_point
        from public.v_low_stock
        where tenant_id = p_tenant_id
          and public.can_see_location(location_id)
        order by stock_on_hand
        limit 10
      ) t
    ), '[]'::jsonb),

    'busiest_day', (
      select to_char(s.created_at at time zone v_tz, 'FMDay')
      from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
      group by to_char(s.created_at at time zone v_tz, 'FMDay')
      order by sum(s.total_cents) desc
      limit 1
    ),

    'busiest_hour', (
      select extract(hour from s.created_at at time zone v_tz)::integer
      from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
      group by extract(hour from s.created_at at time zone v_tz)
      order by count(*) desc
      limit 1
    )
  ) into v_result;

  return v_result;
end;
$fn$;

comment on function public.weekly_report_stats(uuid, date) is
  'Weekly digest figures. SECURITY DEFINER, so it enforces both halves of '
  'access itself: the tenant guard raises PS403 for another shop, and '
  'can_see_location() keeps a location-pinned caller to their own takings - '
  'RLS cannot do it here because a definer function bypasses it. Unpinned '
  'callers (owners, and service_role for the emailed digest) are unaffected. '
  'Buckets by the shop timezone, not UTC.';

-- 20260728000900 already revoked this from anon; the grants survive
-- create-or-replace, and are restated only so a fresh read of this file shows
-- who can call it.
revoke all on function public.weekly_report_stats(uuid, date) from public;
grant execute on function public.weekly_report_stats(uuid, date) to authenticated, service_role;
