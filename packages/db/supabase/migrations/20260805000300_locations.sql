-- Locations: the one-way door.
--
-- Until now a tenant was a shop, and stock was a single number on the product.
-- That assumption blocks warehouses, second branches and the trade network all
-- at once, and it is far cheaper to undo at 44 products than at 4,000 shops.
--
-- What this deliberately does NOT do is rename tenants to organisations. That
-- would churn every policy and function in the schema for a cosmetic gain;
-- tenant_id is a perfectly good name for the isolation boundary, and it stays.
--
-- products.stock_on_hand survives as an ORG-WIDE total, maintained by the same
-- trigger as before. Five functions and a view already read it and answer a
-- genuinely useful question — "how many do we have anywhere" — so it keeps
-- earning its place. location_stock.on_hand is the per-location truth.

set search_path = public, extensions;

create type public.location_kind as enum ('shop', 'warehouse', 'van');
create type public.org_type      as enum ('retailer', 'distributor', 'both');

alter table public.tenants
  add column org_type public.org_type not null default 'retailer';

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------

create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,

  kind       public.location_kind not null default 'shop',
  name       text not null check (length(btrim(name)) between 1 and 80),
  -- Short human handle for pick lists and transfer notes: MAIN, WH1, VAN2.
  code       text check (code ~ '^[A-Z0-9-]{1,12}$'),

  address    text,
  phone      text,

  is_default boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index locations_one_default_per_tenant
  on public.locations (tenant_id) where is_default;
create unique index locations_code_per_tenant
  on public.locations (tenant_id, code) where code is not null;
create index locations_tenant_idx on public.locations (tenant_id, kind) where is_active;

create trigger locations_touch_updated_at
  before update on public.locations
  for each row execute function public.touch_updated_at();

comment on table public.locations is
  'A place stock can sit: a shop floor, a warehouse, or a delivery van. A van '
  'is a location because load-out and reconcile-on-return is the same problem '
  'as any other transfer.';

-- ---------------------------------------------------------------------------
-- Per-location balances
-- ---------------------------------------------------------------------------

create table public.location_stock (
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  location_id   uuid not null references public.locations (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,

  on_hand       numeric(14,3) not null default 0,
  -- Null falls back to products.reorder_point. A warehouse and a shop front
  -- want very different thresholds for the same product.
  reorder_point numeric(14,3) check (reorder_point >= 0),

  updated_at    timestamptz not null default now(),
  primary key (location_id, product_id)
);

create index location_stock_tenant_product_idx
  on public.location_stock (tenant_id, product_id);
create index location_stock_low_idx
  on public.location_stock (tenant_id, location_id) where on_hand <= 0;

comment on table public.location_stock is
  'Cache of sum(delta) from stock_movements for one product at one location. '
  'The ledger is still the truth; recompute_stock_on_hand() rebuilds both this '
  'and the org-wide total on products.';

-- ---------------------------------------------------------------------------
-- Everything that moves stock or money now says where
-- ---------------------------------------------------------------------------

alter table public.stock_movements add column location_id uuid references public.locations (id);
alter table public.sales           add column location_id uuid references public.locations (id);

-- Which shop a member of staff stands in. Null means every location, which is
-- what an owner gets.
alter table public.users add column location_id uuid references public.locations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

insert into public.locations (tenant_id, kind, name, code, is_default)
select t.id, 'shop', t.name, 'MAIN', true
from public.tenants t;

insert into public.location_stock (tenant_id, location_id, product_id, on_hand)
select p.tenant_id, l.id, p.id, p.stock_on_hand
from public.products p
join public.locations l on l.tenant_id = p.tenant_id and l.is_default;

-- stock_movements is append-only by trigger, which is exactly what we want in
-- normal operation and exactly what blocks a backfill. Lift it for the update
-- and put it straight back.
alter table public.stock_movements disable trigger stock_movements_append_only;

update public.stock_movements m
set location_id = l.id
from public.locations l
where l.tenant_id = m.tenant_id and l.is_default and m.location_id is null;

alter table public.stock_movements enable trigger stock_movements_append_only;

update public.sales s
set location_id = l.id
from public.locations l
where l.tenant_id = s.tenant_id and l.is_default and s.location_id is null;

-- Now that every row has one, require it.
alter table public.stock_movements alter column location_id set not null;
alter table public.sales           alter column location_id set not null;

create index stock_movements_location_idx
  on public.stock_movements (location_id, product_id, created_at desc);
create index sales_location_idx on public.sales (location_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Location scoping for RLS
-- ---------------------------------------------------------------------------

create or replace function public.current_location_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select location_id from public.users where id = auth.uid() and is_active
$$;

comment on function public.current_location_id() is
  'The one location this user is pinned to, or NULL for someone who sees all of '
  'them. SECURITY DEFINER for the same reason current_tenant_id() is: the '
  'policies on public.users call it.';

grant execute on function public.current_location_id() to authenticated;
revoke execute on function public.current_location_id() from anon, public;

-- Reads as: this row is in my shop, or I am not pinned to one.
create or replace function public.can_see_location(p_location_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.current_location_id() is null
      or public.current_location_id() = p_location_id
$$;

grant execute on function public.can_see_location(uuid) to authenticated;

create or replace function public.default_location_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    public.current_location_id(),
    (select id from public.locations
     where tenant_id = public.current_tenant_id() and is_default limit 1)
  )
$$;

grant execute on function public.default_location_id() to authenticated;

-- ---------------------------------------------------------------------------
-- The trigger now maintains both caches
-- ---------------------------------------------------------------------------

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Per-location balance. Upsert because a product that has never been at this
  -- location has no row yet, which is the normal case for a new branch.
  insert into public.location_stock (tenant_id, location_id, product_id, on_hand, updated_at)
  values (new.tenant_id, new.location_id, new.product_id, new.delta, now())
  on conflict (location_id, product_id) do update
    set on_hand = public.location_stock.on_hand + excluded.on_hand,
        updated_at = now();

  -- Org-wide total, plus the weighted average cost. Cost is deliberately not
  -- per-location: a shop buys at one price and moves goods between its own
  -- sites without that changing what they cost the business.
  update public.products p
  set
    stock_on_hand = p.stock_on_hand + new.delta,
    cost_cents = case
      when new.reason = 'restock'
       and new.delta > 0
       and new.unit_cost_cents is not null
      then (
        case
          when greatest(p.stock_on_hand, 0) + new.delta > 0 then
            round(
              ( (greatest(p.stock_on_hand, 0) * p.cost_cents)
              + (new.delta * new.unit_cost_cents) )
              / (greatest(p.stock_on_hand, 0) + new.delta)
            )::integer
          else new.unit_cost_cents
        end
      )
      else p.cost_cents
    end,
    updated_at = now()
  where p.id = new.product_id
    and p.tenant_id = new.tenant_id;

  if not found then
    raise exception 'Product % does not belong to tenant %', new.product_id, new.tenant_id
      using errcode = 'PS404';
  end if;

  return new;
end;
$$;

-- A transfer is two movements, not a new concept: out of one location, into
-- another, both against the same reference.
create or replace function public.transfer_stock(
  p_product_id  uuid,
  p_from_location uuid,
  p_to_location   uuid,
  p_quantity    numeric,
  p_note        text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_ref       uuid := extensions.gen_random_uuid();
  v_available numeric;
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can move stock between locations'
      using errcode = 'PS403';
  end if;
  if p_from_location = p_to_location then
    raise exception 'Pick two different locations' using errcode = 'PS422';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be more than zero' using errcode = 'PS422';
  end if;

  select coalesce(on_hand, 0) into v_available
  from public.location_stock
  where location_id = p_from_location and product_id = p_product_id
  for update;

  if coalesce(v_available, 0) < p_quantity then
    raise exception 'Only % there to move', coalesce(v_available, 0)
      using errcode = 'PS422';
  end if;

  insert into public.stock_movements
    (tenant_id, location_id, product_id, delta, reason, reference_id, created_by, note)
  values
    (v_tenant_id, p_from_location, p_product_id, -p_quantity, 'adjustment', v_ref, auth.uid(),
     coalesce(p_note, '') || ' (transfer out)'),
    (v_tenant_id, p_to_location,   p_product_id,  p_quantity, 'adjustment', v_ref, auth.uid(),
     coalesce(p_note, '') || ' (transfer in)');

  return jsonb_build_object('reference_id', v_ref, 'quantity', p_quantity);
end;
$$;

revoke all on function public.transfer_stock(uuid, uuid, uuid, numeric, text) from public;
grant execute on function public.transfer_stock(uuid, uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rebuild both caches from the ledger
-- ---------------------------------------------------------------------------

create or replace function public.recompute_stock_on_hand(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
  v_loc     integer;
begin
  if p_tenant_id is distinct from public.current_tenant_id()
     and auth.role() <> 'service_role' then
    raise exception 'Not permitted for this tenant' using errcode = 'PS403';
  end if;

  with truth as (
    select m.location_id, m.product_id, sum(m.delta) as actual
    from public.stock_movements m
    where m.tenant_id = p_tenant_id
    group by m.location_id, m.product_id
  )
  update public.location_stock ls
  set on_hand = t.actual, updated_at = now()
  from truth t
  where ls.location_id = t.location_id
    and ls.product_id = t.product_id
    and ls.on_hand is distinct from t.actual;

  get diagnostics v_loc = row_count;

  with truth as (
    select p.id, coalesce(sum(m.delta), 0) as actual
    from public.products p
    left join public.stock_movements m on m.product_id = p.id
    where p.tenant_id = p_tenant_id
    group by p.id
  )
  update public.products p
  set stock_on_hand = t.actual, updated_at = now()
  from truth t
  where p.id = t.id
    and p.stock_on_hand is distinct from t.actual;

  get diagnostics v_updated = row_count;
  return v_updated + v_loc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Low stock is a per-location question now: a product can be plentiful in the
-- warehouse and empty on the shelf, and only the second one loses a sale.
drop view if exists public.v_low_stock;

create view public.v_low_stock
with (security_invoker = on) as
select
  p.tenant_id,
  l.id            as location_id,
  l.name          as location_name,
  p.id            as product_id,
  p.name,
  ls.on_hand      as stock_on_hand,
  coalesce(ls.reorder_point, p.reorder_point) as reorder_point,
  p.price_cents,
  (select max(s.created_at)
     from public.sale_items si
     join public.sales s on s.id = si.sale_id and s.status = 'completed'
    where si.product_id = p.id) as last_sold_at
from public.location_stock ls
join public.products  p on p.id = ls.product_id
join public.locations l on l.id = ls.location_id
where p.is_active
  and l.is_active
  and ls.on_hand <= coalesce(ls.reorder_point, p.reorder_point);

create view public.v_location_stock
with (security_invoker = on) as
select
  ls.tenant_id,
  ls.location_id,
  l.name  as location_name,
  l.kind  as location_kind,
  ls.product_id,
  p.name  as product_name,
  p.barcode,
  ls.on_hand,
  coalesce(ls.reorder_point, p.reorder_point) as reorder_point,
  p.price_cents,
  p.cost_cents
from public.location_stock ls
join public.products  p on p.id = ls.product_id
join public.locations l on l.id = ls.location_id
where p.is_active and l.is_active;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.locations      enable row level security;
alter table public.location_stock enable row level security;
alter table public.location_stock force row level security;

create policy "members read locations"
  on public.locations for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "owners manage locations"
  on public.locations for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() = 'owner'
  );

-- A cashier pinned to one shop sees that shop's balances. An owner sees all.
create policy "members read stock for their locations"
  on public.location_stock for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.can_see_location(location_id)
  );

create policy "managers set reorder points"
  on public.location_stock for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  )
  with check (tenant_id = public.current_tenant_id());

-- Balances are otherwise written only by the ledger trigger, which runs as the
-- table owner and is not subject to these policies.
--
-- That was the intent, but apply_stock_movement() is created above without
-- SECURITY DEFINER, so it ran as the caller and every ledger write was refused.
-- 20260817000100 makes it true.
