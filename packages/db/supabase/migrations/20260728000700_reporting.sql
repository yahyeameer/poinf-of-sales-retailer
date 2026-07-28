-- Reporting views.
--
-- security_invoker = on so each view runs with the caller's permissions and the
-- underlying RLS policies still apply. Without it these would be a tidy way to
-- hand every shop everyone else's numbers.
--
-- Voided sales are excluded everywhere. A void is not a sale that happened.

create view public.v_sales_daily
with (security_invoker = on) as
select
  s.tenant_id,
  (s.created_at at time zone 'UTC')::date       as day,
  count(*)                                      as transactions,
  sum(s.total_cents)                            as revenue_cents,
  sum(s.tax_cents)                              as tax_cents,
  sum(s.discount_cents)                         as discount_cents,
  count(*) filter (where s.payment_method = 'cash')         as cash_count,
  sum(s.total_cents) filter (where s.payment_method = 'cash')         as cash_cents,
  sum(s.total_cents) filter (where s.payment_method = 'mobile_money') as mobile_money_cents,
  sum(s.total_cents) filter (where s.payment_method = 'card')         as card_cents
from public.sales s
where s.status = 'completed'
group by s.tenant_id, day;

comment on view public.v_sales_daily is
  'Grouped on created_at (when the sale happened on the device), not synced_at. '
  'A day offline still lands on the right day once it syncs.';

create view public.v_product_performance
with (security_invoker = on) as
select
  si.tenant_id,
  si.product_id,
  p.name,
  p.category_id,
  (s.created_at at time zone 'UTC')::date as day,
  sum(si.quantity)                        as units,
  sum(si.line_total_cents)                as revenue_cents,
  -- Cost snapshotted at sale time, so margin is what it actually was, not what
  -- it would be at today's purchase price.
  sum(si.line_total_cents) - sum(round(si.quantity * si.unit_cost_cents))::bigint
                                          as margin_cents
from public.sale_items si
join public.sales s on s.id = si.sale_id
join public.products p on p.id = si.product_id
where s.status = 'completed'
group by si.tenant_id, si.product_id, p.name, p.category_id, day;

create view public.v_low_stock
with (security_invoker = on) as
select
  p.tenant_id,
  p.id as product_id,
  p.name,
  p.stock_on_hand,
  p.reorder_point,
  p.price_cents,
  (select max(s.created_at)
   from public.sale_items si
   join public.sales s on s.id = si.sale_id and s.status = 'completed'
   where si.product_id = p.id) as last_sold_at
from public.products p
where p.is_active
  and p.stock_on_hand <= p.reorder_point;

create view public.v_dead_stock
with (security_invoker = on) as
select
  p.tenant_id,
  p.id as product_id,
  p.name,
  p.stock_on_hand,
  p.cost_cents,
  round(p.stock_on_hand * p.cost_cents)::bigint as tied_up_cents,
  ls.last_sold_at,
  case
    when ls.last_sold_at is null then null
    else extract(day from now() - ls.last_sold_at)::integer
  end as days_since_last_sale
from public.products p
left join lateral (
  select max(s.created_at) as last_sold_at
  from public.sale_items si
  join public.sales s on s.id = si.sale_id and s.status = 'completed'
  where si.product_id = p.id
) ls on true
where p.is_active
  and p.stock_on_hand > 0
  and (ls.last_sold_at is null or ls.last_sold_at < now() - interval '30 days');

comment on view public.v_dead_stock is
  'Stock that has not moved in 30 days, with the cash it is sitting on. Feeds '
  'the weekly owner insight (prompt 3.4).';

create view public.v_cashier_performance
with (security_invoker = on) as
select
  s.tenant_id,
  s.cashier_id,
  u.name as cashier_name,
  (s.created_at at time zone 'UTC')::date as day,
  count(*)                                as transactions,
  sum(s.total_cents)                      as revenue_cents,
  count(*) filter (where s.status = 'voided') as voids
from public.sales s
left join public.users u on u.id = s.cashier_id
group by s.tenant_id, s.cashier_id, u.name, day;

-- ---------------------------------------------------------------------------
-- The weekly digest, assembled server-side.
--
-- The LLM that writes the email never sees a sales row — only these aggregates.
-- ---------------------------------------------------------------------------

create or replace function public.weekly_report_stats(
  p_tenant_id uuid,
  p_week_end  date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant     public.tenants;
  v_this_start date := p_week_end - 7;
  v_last_start date := p_week_end - 14;
  v_result     jsonb;
begin
  if p_tenant_id is distinct from public.current_tenant_id()
     and auth.role() <> 'service_role' then
    raise exception 'Not permitted for this tenant' using errcode = 'PS403';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;

  select jsonb_build_object(
    'shop_name', v_tenant.name,
    'currency',  v_tenant.currency,

    'revenue_this_week', coalesce((
      select sum(total_cents) from public.sales
      where tenant_id = p_tenant_id and status = 'completed'
        and created_at >= v_this_start and created_at < p_week_end
    ), 0),

    'revenue_last_week', coalesce((
      select sum(total_cents) from public.sales
      where tenant_id = p_tenant_id and status = 'completed'
        and created_at >= v_last_start and created_at < v_this_start
    ), 0),

    'transactions_this_week', coalesce((
      select count(*) from public.sales
      where tenant_id = p_tenant_id and status = 'completed'
        and created_at >= v_this_start and created_at < p_week_end
    ), 0),

    'top_5_movers', coalesce((
      select jsonb_agg(t) from (
        select name, sum(units) as units, sum(revenue_cents) as revenue
        from public.v_product_performance
        where tenant_id = p_tenant_id and day >= v_this_start and day < p_week_end
        group by name
        order by sum(revenue_cents) desc
        limit 5
      ) t
    ), '[]'::jsonb),

    'dead_stock_30d', coalesce((
      select jsonb_agg(t) from (
        select name, stock_on_hand, days_since_last_sale
        from public.v_dead_stock
        where tenant_id = p_tenant_id
        order by tied_up_cents desc
        limit 5
      ) t
    ), '[]'::jsonb),

    'low_stock_alerts', coalesce((
      select jsonb_agg(t) from (
        select name, stock_on_hand, reorder_point
        from public.v_low_stock
        where tenant_id = p_tenant_id
        order by stock_on_hand
        limit 10
      ) t
    ), '[]'::jsonb),

    'busiest_day', (
      select to_char(created_at, 'FMDay')
      from public.sales
      where tenant_id = p_tenant_id and status = 'completed'
        and created_at >= v_this_start and created_at < p_week_end
      group by to_char(created_at, 'FMDay')
      order by sum(total_cents) desc
      limit 1
    ),

    'busiest_hour', (
      select extract(hour from created_at)::integer
      from public.sales
      where tenant_id = p_tenant_id and status = 'completed'
        and created_at >= v_this_start and created_at < p_week_end
      group by extract(hour from created_at)
      order by count(*) desc
      limit 1
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.weekly_report_stats(uuid, date) is
  'Aggregates only. Deliberately the whole surface the weekly-report LLM sees — '
  'it cannot invent a number it was never given, and no customer-level data '
  'leaves the database.';

revoke all on function public.weekly_report_stats(uuid, date) from public;
grant execute on function public.weekly_report_stats(uuid, date) to authenticated, service_role;
