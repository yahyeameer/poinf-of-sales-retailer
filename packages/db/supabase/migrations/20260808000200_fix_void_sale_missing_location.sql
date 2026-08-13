-- void_sale was missed when stock_movements.location_id became NOT NULL in
-- 20260805000300_locations.sql, so every void has failed on the constraint
-- since. Stock goes back to the location it left, which the sale records.
--
-- Worth naming the class of bug: making a column NOT NULL is a change to every
-- writer of that table, and a writer only reached from a rarely-pressed button
-- will not announce itself. This surfaced by voiding a test sale, not by
-- anything failing at deploy time.

create or replace function public.void_sale(
  p_sale_id uuid,
  p_reason  text default null
)
returns public.sales
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_uid       uuid := auth.uid();
  v_role      text := public.current_shop_role();
  v_sale      public.sales;
  v_window    interval := interval '5 minutes';
begin
  select * into v_sale
  from public.sales
  where id = p_sale_id and tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception 'Sale not found' using errcode = 'PS404';
  end if;

  if v_sale.status = 'voided' then
    return v_sale;  -- idempotent
  end if;

  -- A refund is its own document; undoing one is a fresh sale, not a void.
  if v_sale.kind = 'refund' then
    raise exception 'Void the original sale, not the refund' using errcode = 'PS422';
  end if;

  if v_role = 'cashier' then
    if v_sale.cashier_id is distinct from v_uid then
      raise exception 'You can only void your own sales' using errcode = 'PS403';
    end if;
    if now() - v_sale.created_at > v_window then
      raise exception 'That sale is older than 5 minutes - ask the owner'
        using errcode = 'PS405';
    end if;
  elsif v_role not in ('owner', 'manager') then
    raise exception 'Not permitted' using errcode = 'PS403';
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, delta, reason, reference_id, created_by, note
  )
  select v_tenant_id, v_sale.location_id, si.product_id, si.quantity,
         'void', v_sale.id, v_uid, p_reason
  from public.sale_items si
  where si.sale_id = v_sale.id;

  update public.sales
  set status    = 'voided',
      voided_at = now(),
      voided_by = v_uid,
      note      = coalesce(p_reason, note)
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.void_sale(uuid, text) from public;
grant execute on function public.void_sale(uuid, text) to authenticated;
