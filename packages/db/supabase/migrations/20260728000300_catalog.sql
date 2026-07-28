-- Product catalog, images, and CLIP embeddings.

set search_path = public, extensions;

create type public.product_unit as enum ('each', 'kg', 'g', 'l', 'ml', 'pack');

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index categories_tenant_id_idx on public.categories (tenant_id);

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,

  sku         text,
  name        text not null check (length(btrim(name)) between 1 and 200),
  description text,

  -- EAN-13, UPC-A, Code-128 … digits and dashes only, normalised on write.
  barcode     text check (barcode ~ '^[0-9A-Za-z\-]{4,64}$'),

  -- Money is integer minor units everywhere. No floats touch a price, ever.
  price_cents integer not null check (price_cents >= 0),

  -- Weighted average cost, recomputed by the stock ledger on every restock.
  -- Not owner-editable directly; it is derived.
  cost_cents  integer not null default 0 check (cost_cents >= 0),

  unit        public.product_unit not null default 'each',

  -- numeric, not integer: shops sell rice by the kilo.
  stock_on_hand  numeric(14,3) not null default 0,
  reorder_point  numeric(14,3) not null default 0 check (reorder_point >= 0),

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.products.stock_on_hand is
  'Cache of sum(delta) over stock_movements, maintained by trigger. The ledger '
  'is the truth; call recompute_stock_on_hand() if they ever diverge.';

comment on column public.products.cost_cents is
  'Weighted average cost, derived from restock movements. Do not set by hand.';

-- Barcodes and SKUs are unique per shop, but plenty of products have neither,
-- so these are partial indexes rather than table constraints.
create unique index products_tenant_barcode_key on public.products (tenant_id, barcode)
  where barcode is not null;
create unique index products_tenant_sku_key on public.products (tenant_id, sku)
  where sku is not null;

create index products_tenant_active_idx on public.products (tenant_id, is_active)
  where is_active;
create index products_tenant_category_idx on public.products (tenant_id, category_id);

-- Type-ahead in the sale screen when barcode and vision both miss.
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);

-- Drives the low-stock report; partial so it stays small.
create index products_low_stock_idx on public.products (tenant_id)
  where is_active and stock_on_hand <= reorder_point;

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- Barcode scanners emit stray whitespace often enough to be worth normalising
-- once here rather than in three call sites.
create or replace function public.normalize_product_identifiers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.barcode := nullif(btrim(new.barcode), '');
  new.sku     := nullif(btrim(new.sku), '');
  new.name    := btrim(new.name);
  return new;
end;
$$;

create trigger products_normalize_identifiers
  before insert or update on public.products
  for each row execute function public.normalize_product_identifiers();

-- ---------------------------------------------------------------------------
-- Images
-- ---------------------------------------------------------------------------

create table public.product_images (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index product_images_product_idx on public.product_images (product_id);
create unique index product_images_one_primary on public.product_images (product_id)
  where is_primary;

-- ---------------------------------------------------------------------------
-- Embeddings
--
-- CLIP ViT-B/32, 512 dims, L2-normalised at write time so cosine distance and
-- inner product agree and the app can compare vectors locally without
-- renormalising on every frame.
-- ---------------------------------------------------------------------------

create table public.product_embeddings (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  image_id   uuid references public.product_images (id) on delete cascade,
  embedding  vector(512) not null,
  model      text not null default 'clip-vit-b-32',
  created_at timestamptz not null default now(),
  unique (product_id, image_id)
);

create index product_embeddings_tenant_idx on public.product_embeddings (tenant_id);

-- HNSW over the whole table rather than per tenant: pgvector has no partitioned
-- ANN index, and one index of a few million vectors still answers in single-digit
-- milliseconds. RLS filters the tenant afterwards, which means the scan may need
-- to look past the first k neighbours — hence the iterative-scan setting in
-- match_products(). Revisit by partitioning `product_embeddings` on tenant_id if
-- p95 recall drops.
create index product_embeddings_hnsw_idx
  on public.product_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

comment on table public.product_embeddings is
  'Cloud copy of the vectors. The phone matches against its own SQLite mirror; '
  'this is the fallback for when that mirror is stale.';
