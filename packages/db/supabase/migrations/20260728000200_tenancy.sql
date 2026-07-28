-- Tenants, users, and the auth hook that puts tenant_id into the JWT.

create type public.shop_role as enum ('owner', 'manager', 'cashier');
create type public.plan_tier as enum ('free', 'starter', 'pro', 'self_hosted');

create table public.tenants (
  id           uuid primary key default extensions.gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 120),

  -- ISO 4217. Single currency per tenant in v1; multi-currency is deferred.
  currency     char(3) not null default 'USD',

  -- Stored as a rate, not a percentage: 0.15 is 15%.
  tax_rate     numeric(6,4) not null default 0 check (tax_rate >= 0 and tax_rate < 1),

  -- Prices on the shelf usually already include tax in these markets, so the
  -- receipt shows the tax component rather than adding it on top. Owners in
  -- add-on jurisdictions flip this at setup.
  tax_inclusive boolean not null default true,

  plan         public.plan_tier not null default 'free',

  -- Restock alerts the owner when a purchase price pushes margin under this.
  min_margin_pct numeric(5,2) not null default 0 check (min_margin_pct >= 0 and min_margin_pct < 100),

  -- Off by default: a sale that would take stock negative is rejected, and the
  -- device flags it for the owner. Shops that sell faster than they can be
  -- bothered to restock turn it on and reconcile later.
  allow_oversell boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.tenants is 'One shop. The unit of isolation for every RLS policy.';

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Users
--
-- Mirrors auth.users with the shop-specific bits. tenant_id is nullable for
-- exactly one window: between signing up and calling provision_tenant().
-- ---------------------------------------------------------------------------

create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  tenant_id  uuid references public.tenants (id) on delete cascade,
  email      text,
  name       text,
  role       public.shop_role not null default 'owner',

  -- bcrypt. Staff never type the shop's email password; the PIN unlocks a
  -- device-scoped session on an already-authenticated device.
  pin_hash   text,

  is_active  boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_tenant_id_idx on public.users (tenant_id) where tenant_id is not null;

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

-- A shop must always retain at least one owner, or nobody can manage staff.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining int;
begin
  if old.role <> 'owner' or old.tenant_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' and new.is_active then
    return new;
  end if;

  select count(*) into v_remaining
  from public.users u
  where u.tenant_id = old.tenant_id
    and u.role = 'owner'
    and u.is_active
    and u.id <> old.id;

  if v_remaining = 0 then
    raise exception 'A shop must keep at least one active owner'
      using errcode = 'PS403';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger users_guard_last_owner
  before update or delete on public.users
  for each row execute function public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Signup: auth.users insert -> public.users row with no tenant yet
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Onboarding step 1: create the shop and attach the caller as its owner.
--
-- SECURITY DEFINER because the caller has no tenant_id claim yet, so RLS would
-- block the insert. Guarded: it refuses if the caller already has a tenant.
-- ---------------------------------------------------------------------------

create or replace function public.provision_tenant(
  p_name     text,
  p_currency char(3) default 'USD',
  p_tax_rate numeric default 0
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_existing  uuid;
  v_tenant    public.tenants;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PS401';
  end if;

  select tenant_id into v_existing from public.users where id = v_uid;

  if v_existing is not null then
    raise exception 'This account already belongs to a shop'
      using errcode = 'PS409';
  end if;

  insert into public.tenants (name, currency, tax_rate)
  values (btrim(p_name), upper(p_currency), p_tax_rate)
  returning * into v_tenant;

  update public.users
  set tenant_id = v_tenant.id,
      role      = 'owner'
  where id = v_uid;

  return v_tenant;
end;
$$;

comment on function public.provision_tenant(text, char, numeric) is
  'Creates a shop and makes the calling user its owner. The client must refresh '
  'its session afterwards — the tenant_id claim is minted at token issue, so the '
  'JWT held at call time still has no tenant and every query would return empty.';

revoke all on function public.provision_tenant(text, char, numeric) from public;
grant execute on function public.provision_tenant(text, char, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- The auth hook. Runs on every token issue and refresh.
-- ---------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_role      public.shop_role;
  v_claims    jsonb;
begin
  select u.tenant_id, u.role
  into v_tenant_id, v_role
  from public.users u
  where u.id = (event ->> 'user_id')::uuid
    and u.is_active;

  v_claims := event -> 'claims';

  if v_tenant_id is not null then
    v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    v_claims := jsonb_set(v_claims, '{shop_role}', to_jsonb(v_role::text));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

-- The auth service runs the hook as supabase_auth_admin, which otherwise has no
-- reach into public. Grant exactly what the hook body touches, nothing wider.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.users to supabase_auth_admin;

create policy "auth admin reads users for the token hook"
  on public.users for select
  to supabase_auth_admin
  using (true);
