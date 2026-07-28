-- Extensions and the small helpers every later migration leans on.

create extension if not exists "pgcrypto"  with schema extensions;  -- gen_random_uuid, bcrypt for staff PINs
create extension if not exists "vector"    with schema extensions;  -- CLIP embeddings + HNSW
create extension if not exists "pg_trgm"   with schema extensions;  -- fuzzy product-name search fallback

-- ---------------------------------------------------------------------------
-- Tenant resolution
--
-- `tenant_id` is injected into the JWT by custom_access_token_hook (next
-- migration). Every RLS policy in this schema funnels through these two
-- functions, so the claim is read in exactly one place.
--
-- These are STABLE, not IMMUTABLE: the claim is constant within a statement but
-- not across a connection, and marking them IMMUTABLE would let the planner
-- cache one tenant's value into a plan reused by another.
-- ---------------------------------------------------------------------------

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id',
    ''
  )::uuid
$$;

comment on function public.current_tenant_id() is
  'Tenant of the current request, from the tenant_id JWT claim. NULL for anon '
  'and for a signed-in user who has not been provisioned into a tenant yet. '
  'NULL never matches a NOT NULL tenant_id column, so policies fail closed.';

create or replace function public.current_shop_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'shop_role', ''),
    'none'
  )
$$;

comment on function public.current_shop_role() is
  'owner | manager | cashier | none. Coarse capability check inside RLS policies.';

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
