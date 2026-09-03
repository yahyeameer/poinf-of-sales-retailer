-- Suppliers: who the stock was bought from.
--
-- products.cost_cents is a weighted average maintained by the ledger trigger,
-- and until now it had no memory of where any of it came from. That makes two
-- ordinary questions unanswerable: "who did we buy this from last time, and
-- what did they charge?" and "this supplier keeps putting prices up — by how
-- much?". Both need the supplier recorded on the movement that set the cost,
-- not on the product, because a product is bought from different people over
-- its life and the average is the only thing the product row remembers.
--
-- So: a suppliers table, and supplier_id on stock_movements. The ledger stays
-- the single record of what happened; this just adds a column to it.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id         uuid primary key default extensions.gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,

  name         text not null check (length(btrim(name)) between 1 and 200),
  contact_name text,
  phone        text,
  email        text,
  address      text,
  note         text,

  -- How long they usually take. Drives "order this now or you'll run out",
  -- which is the whole point of knowing a reorder point.
  lead_time_days integer not null default 0
    check (lead_time_days >= 0 and lead_time_days <= 365),

  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive, because "Nairobi Wholesalers" and "nairobi wholesalers"
-- being two suppliers is a data-entry accident, not a decision. Scoped to the
-- tenant: two shops may of course use the same wholesaler.
create unique index suppliers_tenant_name_idx
  on public.suppliers (tenant_id, lower(btrim(name)));

create index suppliers_tenant_active_idx
  on public.suppliers (tenant_id, is_active, name);

create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

comment on table public.suppliers is
  'Who stock is bought from. Referenced by restock movements, which is where '
  'the cost history actually lives.';

-- ---------------------------------------------------------------------------
-- 2. Hang it off the ledger
-- ---------------------------------------------------------------------------

alter table public.stock_movements
  add column supplier_id uuid references public.suppliers (id) on delete set null;

-- on delete set null, not cascade: deleting a supplier must never delete a
-- ledger row. The stock still moved. Losing that would change every balance
-- computed from it.

-- A supplier only means anything on a restock. A sale, a void or a stocktake
-- has no vendor, and letting one be set there would produce purchase history
-- that never happened.
alter table public.stock_movements
  add constraint stock_movements_supplier_only_on_restock
  check (supplier_id is null or reason = 'restock');

create index stock_movements_supplier_idx
  on public.stock_movements (supplier_id, created_at desc)
  where supplier_id is not null;

comment on column public.stock_movements.supplier_id is
  'Who this restock was bought from. Null on every other kind of movement, and '
  'on restocks recorded before suppliers existed.';

-- ---------------------------------------------------------------------------
-- 3. RLS
--
-- Read for every member, write for owners and managers. Deliberately wider
-- than locations (owner-only): a manager doing the ordering needs to add the
-- wholesaler they just started using, and a supplier's name and phone number
-- is not takings data.
--
-- Not location-scoped. A supplier belongs to the shop, not to a building, and
-- a pinned manager placing an order has to be able to name the vendor. What
-- they can read about *stock* stays scoped by the policies on the ledger.
-- ---------------------------------------------------------------------------

alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;

create policy "members read suppliers"
  on public.suppliers for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "managers manage suppliers"
  on public.suppliers for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  );

grant select on public.suppliers to authenticated;
grant insert, update, delete on public.suppliers to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Teach restock_product about suppliers
--
-- This DROPs before CREATEing rather than using `create or replace`. Adding a
-- defaulted parameter does not replace a function in Postgres, it overloads
-- it — and PostgREST resolves a named-argument call against every candidate,
-- so the old five-argument call would then match both and fail as ambiguous.
-- The existing callers pass named arguments, so they keep working against the
-- new signature with p_supplier_id defaulted.
-- ---------------------------------------------------------------------------

drop function if exists public.restock_product(uuid, numeric, integer, text, uuid);

create or replace function public.restock_product(
  p_product_id      uuid,
  p_quantity        numeric,
  p_unit_cost_cents integer,
  p_note            text default null,
  p_location_id     uuid default null,
  p_supplier_id     uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_location  uuid := coalesce(p_location_id, public.default_location_id());
  v_tenant    public.tenants;
  v_product   public.products;
  v_on_hand   numeric(14,3);
  v_margin    numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Restock quantity must be positive' using errcode = 'PS422';
  end if;

  if public.current_shop_role() not in ('owner', 'manager', 'cashier') then
    raise exception 'Not permitted' using errcode = 'PS403';
  end if;

  if v_location is null then
    raise exception 'This shop has no location set up' using errcode = 'PS422';
  end if;

  -- Checked here rather than left to the foreign key, so naming another shop's
  -- supplier reads as "no such supplier" instead of a raw constraint violation.
  if p_supplier_id is not null
     and not exists (
       select 1 from public.suppliers
       where id = p_supplier_id and tenant_id = v_tenant_id
     ) then
    raise exception 'No such supplier in this shop' using errcode = 'PS404';
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, delta, reason, unit_cost_cents,
    supplier_id, created_by, note
  )
  values (
    v_tenant_id, v_location, p_product_id, p_quantity, 'restock', p_unit_cost_cents,
    p_supplier_id, auth.uid(), p_note
  );

  -- Read back after the trigger has folded in the new weighted average.
  select * into v_product from public.products where id = p_product_id;

  -- stock_on_hand is the balance *at this location*, which is what the person
  -- doing the restock is standing in front of. The org-wide figure is still
  -- returned, named for what it is.
  select on_hand into v_on_hand from public.location_stock
   where location_id = v_location and product_id = p_product_id;

  v_margin := case
    when v_product.price_cents > 0
    then round(100.0 * (v_product.price_cents - v_product.cost_cents) / v_product.price_cents, 2)
    else 0
  end;

  return jsonb_build_object(
    'product_id',      v_product.id,
    'location_id',     v_location,
    'stock_on_hand',   coalesce(v_on_hand, 0),
    'total_on_hand',   v_product.stock_on_hand,
    'avg_cost_cents',  v_product.cost_cents,
    'price_cents',     v_product.price_cents,
    'margin_pct',      v_margin,
    'margin_alert',    v_margin < v_tenant.min_margin_pct
  );
end;
$$;

revoke all on function public.restock_product(uuid, numeric, integer, text, uuid, uuid) from public, anon;
grant execute on function public.restock_product(uuid, numeric, integer, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What a supplier has actually cost
--
-- The question an owner asks before placing the next order. security_invoker
-- so the caller's RLS applies — a pinned cashier sees only movements at their
-- own location, exactly as they do on the ledger itself.
-- ---------------------------------------------------------------------------

create view public.v_supplier_purchases
with (security_invoker = on) as
select
  s.tenant_id,
  s.id                                    as supplier_id,
  s.name                                  as supplier_name,
  count(m.id)                             as deliveries,
  coalesce(sum(m.delta), 0)               as units,
  coalesce(sum(m.delta * coalesce(m.unit_cost_cents, 0)), 0)::bigint as spend_cents,
  max(m.created_at)                       as last_delivery_at
from public.suppliers s
left join public.stock_movements m
       on m.supplier_id = s.id
      and m.reason = 'restock'
group by s.tenant_id, s.id, s.name;

comment on view public.v_supplier_purchases is
  'Per-supplier totals from the ledger. A supplier with no deliveries still '
  'appears, with zeroes — the list is of suppliers, not of purchases.';
