-- Location isolation: make can_see_location() actually mean something.
--
-- 20260805000300_locations.sql built the whole mechanism — users.location_id,
-- current_location_id(), can_see_location() — and then wired it into exactly
-- ONE policy: select on location_stock. Every other table stayed scoped to the
-- tenant alone, so a cashier pinned to the Hargeisa shop could read the takings
-- of every other shop and of the warehouse. The pin was decorative.
--
-- This migration finishes the job. The rule, everywhere:
--
--     tenant_id = current_tenant_id() and can_see_location(<the row's location>)
--
-- and can_see_location() is true for everyone whose users.location_id is NULL,
-- which is what an owner gets. So: staff see their own location, owners see all.
--
-- Two tables could not be scoped because they had no location to scope by.
-- shifts and parked_sales get one here, backfilled to each tenant's default.
--
-- Deliberately NOT scoped:
--   * locations itself. A pinned manager doing a transfer has to be able to
--     name the other end of it, and a location's name is not takings data.
--     What they can read *out* of the other location is what matters, and that
--     is now closed.
--   * products, categories, product_images. Catalog is org-wide by design;
--     location_stock is where the per-location numbers live and it was already
--     scoped.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Give shifts and parked_sales a location
-- ---------------------------------------------------------------------------

alter table public.shifts
  add column location_id uuid references public.locations (id);
alter table public.parked_sales
  add column location_id uuid references public.locations (id);

-- Everything that exists today was rung up somewhere, and before locations
-- existed that somewhere was the tenant's single shop — the same default the
-- sales and stock_movements backfill used.
update public.shifts s
set location_id = l.id
from public.locations l
where l.tenant_id = s.tenant_id and l.is_default and s.location_id is null;

update public.parked_sales p
set location_id = l.id
from public.locations l
where l.tenant_id = p.tenant_id and l.is_default and p.location_id is null;

-- A tenant with rows but no default location would fail the NOT NULL below.
-- 20260817000100 already guarantees onboarding creates one, but a database
-- that predates it can still be in that state, so say so usefully.
do $$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans
  from (
    select 1 from public.shifts where location_id is null
    union all
    select 1 from public.parked_sales where location_id is null
  ) x;

  if v_orphans > 0 then
    raise exception
      'location_isolation: % shift/parked_sale row(s) have no location because '
      'their tenant has no default location. Create one per tenant '
      '(insert into public.locations (tenant_id, kind, name, code, is_default) '
      '...) and re-run.', v_orphans;
  end if;
end $$;

alter table public.shifts       alter column location_id set not null;
alter table public.parked_sales alter column location_id set not null;

create index shifts_location_idx       on public.shifts (location_id, opened_at desc);
create index parked_sales_location_idx on public.parked_sales (location_id, created_at desc);

comment on column public.shifts.location_id is
  'Which till drawer this shift was opened on. Required: a shift with no '
  'location cannot be scoped, and an unscoped shift leaks its Z-report.';

-- ---------------------------------------------------------------------------
-- 2. Reads: scope every table that carries a location
-- ---------------------------------------------------------------------------

drop policy "members read sales" on public.sales;
create policy "members read sales"
  on public.sales for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.can_see_location(location_id)
  );

drop policy "members read stock movements" on public.stock_movements;
create policy "members read stock movements"
  on public.stock_movements for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.can_see_location(location_id)
  );

drop policy "members read shifts" on public.shifts;
create policy "members read shifts"
  on public.shifts for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.can_see_location(location_id)
  );

-- sale_items and sale_payments have no location of their own; the sale they
-- hang off does. EXISTS rather than a join so the policy stays a filter.
drop policy "members read sale items" on public.sale_items;
create policy "members read sale items"
  on public.sale_items for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.sales s
      where s.id = sale_items.sale_id
        and public.can_see_location(s.location_id)
    )
  );

drop policy "members read sale payments" on public.sale_payments;
create policy "members read sale payments"
  on public.sale_payments for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and public.can_see_location(s.location_id)
    )
  );

-- cash_movements hang off a shift, which now has a location.
drop policy "members read cash movements" on public.cash_movements;
create policy "members read cash movements"
  on public.cash_movements for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.shifts sh
      where sh.id = cash_movements.shift_id
        and public.can_see_location(sh.location_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Writes: a pinned user may not record activity somewhere else
--
-- Reads were the leak, but an insert with someone else's location_id would
-- write a row the writer then cannot see — corruption that only shows up in
-- the other shop's till report. Close both directions.
-- ---------------------------------------------------------------------------

drop policy "staff record sales" on public.sales;
create policy "staff record sales"
  on public.sales for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
    and public.can_see_location(location_id)
  );

drop policy "owners and managers void sales" on public.sales;
create policy "owners and managers void sales"
  on public.sales for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
    and public.can_see_location(location_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.can_see_location(location_id)
  );

drop policy "staff record stock movements" on public.stock_movements;
create policy "staff record stock movements"
  on public.stock_movements for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
    and public.can_see_location(location_id)
  );

-- These two were already role-gated; the location check is added to that, not
-- swapped for it. Dropping the role clause here would hand a future non-staff
-- role the till drawer.
drop policy "staff run shifts" on public.shifts;
create policy "staff run shifts"
  on public.shifts for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
    and public.can_see_location(location_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
    and public.can_see_location(location_id)
  );

drop policy "staff manage parked sales" on public.parked_sales;
create policy "staff manage parked sales"
  on public.parked_sales for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
    and public.can_see_location(location_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
    and public.can_see_location(location_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Which location kind a user stands in, for the UI to route on
--
-- The web app needs this on every request to decide whether to send someone to
-- the retail dashboard or the warehouse one. Doing it as a function keeps the
-- answer next to current_location_id(), which is the thing it derives from.
-- ---------------------------------------------------------------------------

create or replace function public.current_location_kind()
returns public.location_kind
language sql
stable
security definer
set search_path = ''
as $$
  select l.kind
  from public.locations l
  where l.id = public.current_location_id()
$$;

comment on function public.current_location_kind() is
  'The kind of location this user is pinned to, or NULL for someone who sees '
  'all of them. NULL means "owner", not "unknown" — the caller routes on that.';

grant execute on function public.current_location_kind() to authenticated;
revoke execute on function public.current_location_kind() from anon, public;
