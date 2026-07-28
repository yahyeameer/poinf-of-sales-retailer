-- Row-Level Security.
--
-- Every table below carries tenant_id and every policy compares it against the
-- tenant_id JWT claim. current_tenant_id() returns NULL when the claim is absent,
-- and NULL never equals a NOT NULL column, so an unprovisioned or anonymous
-- request sees nothing rather than everything. Policies fail closed.
--
-- Role capabilities:
--   cashier  read catalog, ring up sales
--   manager  + product CRUD, restock, adjustments
--   owner    + staff, shop settings, voids

alter table public.tenants            enable row level security;
alter table public.users              enable row level security;
alter table public.categories         enable row level security;
alter table public.products           enable row level security;
alter table public.product_images     enable row level security;
alter table public.product_embeddings enable row level security;
alter table public.sales              enable row level security;
alter table public.sale_items         enable row level security;
alter table public.stock_movements    enable row level security;

-- Belt and braces: force RLS so even a table owner connecting directly is
-- subject to it. service_role still bypasses, which is the intent.
alter table public.products        force row level security;
alter table public.sales           force row level security;
alter table public.sale_items      force row level security;
alter table public.stock_movements force row level security;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

create policy "members read their own shop"
  on public.tenants for select
  to authenticated
  using (id = public.current_tenant_id());

create policy "owners update their own shop"
  on public.tenants for update
  to authenticated
  using (id = public.current_tenant_id() and public.current_shop_role() = 'owner')
  with check (id = public.current_tenant_id());

-- No insert or delete policy by design. Shops are created through
-- provision_tenant() and closed by support, not by a stray client call.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create policy "members read staff in their shop"
  on public.users for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- The row created at signup has tenant_id NULL, so the policy above can't see
-- it. Without this an owner cannot read their own profile between signing up
-- and calling provision_tenant.
create policy "users always read themselves"
  on public.users for select
  to authenticated
  using (id = (select auth.uid()));

create policy "users update their own profile"
  on public.users for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    -- Nobody promotes themselves. Role and tenant changes go through an owner.
    and role = (select u.role from public.users u where u.id = (select auth.uid()))
    and tenant_id is not distinct from
        (select u.tenant_id from public.users u where u.id = (select auth.uid()))
  );

create policy "owners manage staff"
  on public.users for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() = 'owner'
  );

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create policy "members read categories"
  on public.categories for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "managers write categories"
  on public.categories for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  );

-- ---------------------------------------------------------------------------
-- products
--
-- Cashiers read but never write. Stock changes reach products only through the
-- ledger trigger, which runs as the table owner and is not subject to these.
-- ---------------------------------------------------------------------------

create policy "members read products"
  on public.products for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "managers write products"
  on public.products for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  );

-- ---------------------------------------------------------------------------
-- product_images / product_embeddings
-- ---------------------------------------------------------------------------

create policy "members read product images"
  on public.product_images for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "managers write product images"
  on public.product_images for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  );

create policy "members read embeddings"
  on public.product_embeddings for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Embeddings are written by the embed-product edge function under service_role,
-- which bypasses RLS. No client-side write path, so no write policy.

-- ---------------------------------------------------------------------------
-- sales / sale_items
--
-- Insert is allowed so an offline device can replay its queue directly. Update
-- is limited to voiding, and deletes are refused outright: a sale that happened
-- stays on the record.
-- ---------------------------------------------------------------------------

create policy "members read sales"
  on public.sales for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "staff record sales"
  on public.sales for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  );

create policy "owners and managers void sales"
  on public.sales for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  )
  with check (tenant_id = public.current_tenant_id());

create policy "members read sale items"
  on public.sale_items for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "staff record sale items"
  on public.sale_items for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  );

-- ---------------------------------------------------------------------------
-- stock_movements
--
-- Insert-and-read only. The append-only trigger blocks the rest regardless,
-- but there is no reason to hand out the grant in the first place.
-- ---------------------------------------------------------------------------

create policy "members read stock movements"
  on public.stock_movements for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "staff record stock movements"
  on public.stock_movements for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  );

-- ---------------------------------------------------------------------------
-- Storage: product-images bucket
--
-- Object paths are <tenant_id>/<product_id>/<uuid>.jpg, so the first path
-- segment is the tenant and can be checked directly.
-- ---------------------------------------------------------------------------

create policy "product images are world readable"
  on storage.objects for select
  to public
  using (bucket_id = 'product-images');

create policy "managers upload product images for their shop"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_shop_role() in ('owner', 'manager')
  );

create policy "managers replace product images for their shop"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_shop_role() in ('owner', 'manager')
  );

create policy "managers delete product images for their shop"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_shop_role() in ('owner', 'manager')
  );
