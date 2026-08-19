-- Bring a freshly built database in line with the one that is actually running.
--
-- The migrations in this directory are a rewritten history. The live project
-- records 34 migrations under different names, and several fixes that only ever
-- landed there were lost in the rewrite - including one named
-- `locations_trigger_security_definer`, which is why `supabase db reset` has
-- been dying in the seed.
--
-- Nothing caught the divergence, because nothing compared the two: no generated
-- types are checked in, so every supabase.rpc() call is untyped, and db:reset -
-- the one thing that would have noticed - was itself broken.
--
-- Closed below in the order a fresh database trips over them. The last one is
-- not drift - it is a bug the live project shares and has simply never hit.

-- ---------------------------------------------------------------------------
-- 1. Table privileges for `authenticated`.
--
-- This schema was written assuming RLS is the gate: every policy is
-- `to authenticated`, process_sale() is SECURITY INVOKER, and all seven
-- reporting views are `security_invoker = on`. What it never says out loud is
-- that `authenticated` also needs plain SQL privileges on the tables, because
-- hosted Supabase grants those by default and the assumption held for free.
--
-- It does not hold anywhere else. The hosted project hands anon, authenticated
-- and service_role the full `arwdDxtm` set on every table in public. The local
-- CLI image's default privileges for this schema grant only `Dxtm` - TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN - and none of SELECT, INSERT, UPDATE, DELETE.
-- Enough to look granted in an ACL dump, not enough to read a row. The seed
-- fails on its first statement after `set role authenticated`:
--
--   LegacyMigrationSeedError: failed to send batch: ERROR: permission denied
--   for table categories (SQLSTATE 42501)
--
-- Granting the same set the platform grants, rather than a hand-tightened
-- per-table matrix, is deliberate. A narrower grant here would reintroduce
-- exactly the fresh-database-behaves-differently problem this migration exists
-- to remove. RLS - `force row level security` on the seven write-heavy tables -
-- is still what actually decides who sees which row.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- service_role needs the same, for the same reason. The edge functions in
-- supabase/functions read and write tables directly through it -
-- weekly-report selects public.tenants and public.users, embed-product writes
-- public.product_embeddings - and BYPASSRLS does not supply a table privilege,
-- it only skips the policies once you already have one.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- `anon` is deliberately left without DML, which is the one place this
-- migration does *not* copy production. Hosted Supabase hands anon the same
-- blanket grant, but every policy in this schema is `to authenticated`, so anon
-- matches no row on any table either way - and 20260728000900 already settled
-- that keeping anon off the API surface is how this schema is built. Nothing
-- signed-out reads a table here: the anon *key* is only an API key, and once a
-- user signs in their JWT carries role=authenticated, so the only true anon
-- requests are the login and onboarding pages, which touch auth and RPCs alone.
-- Read the absence as a decision, not an omission.

-- ---------------------------------------------------------------------------
-- 2. The ledger trigger has to run privileged.
--
-- 20260805000300 says, under the location_stock policies:
--
--   "Balances are otherwise written only by the ledger trigger, which runs as
--    the table owner and is not subject to these policies."
--
-- True of the running database, false of this one. A trigger function runs as
-- the *invoking* role unless it is SECURITY DEFINER, and the version created
-- there is not. So the upsert into location_stock - a table with
-- `force row level security` and only SELECT and UPDATE policies - is refused
-- for every caller, and with it every insert into stock_movements: the seed's
-- opening stock, every sale, every restock.
--
-- ALTER rather than a recreate on purpose. The body is 45 lines that would
-- otherwise exist twice and drift apart; the security property is the whole
-- change, so it is the only thing stated.
alter function public.apply_stock_movement() security definer;

-- Same reasoning. set_staff_pin() writes users.pin_hash on someone else's row,
-- which only an owner may do - it checks that itself, on the line above the
-- update - but under the caller's own privileges the write is then filtered by
-- RLS a second time and silently matches nothing.
alter function public.set_staff_pin(uuid, text) security definer;

-- ---------------------------------------------------------------------------
-- 3. One process_sale, not two.
--
-- 20260808000100 adds the ten-argument process_sale and drops "the previous
-- one" - except it names a nine-argument signature that does not exist in this
-- history. The eight-argument version from 20260805000200 is still there, so a
-- call that supplies only the arguments they share matches both:
--
--   42725: function public.process_sale(p_client_id => text, ...) is not unique
--
-- which is every call the seed makes, and every PostgREST call that omits the
-- optional arguments. The live project has exactly one process_sale; this is
-- the drop that went missing in the rewrite.
drop function if exists public.process_sale(
  text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb
);

-- ---------------------------------------------------------------------------
-- 4. restock_product() never learned about locations.
--
-- 20260805000300 gave stock_movements a location_id and made every other write
-- path location-aware. This one was missed, so it still has the pre-locations
-- four-argument signature while apps/web/src/app/actions.ts calls it with five.
-- Against a fresh database, restocking fails outright:
--
--   PGRST202: Could not find the function public.restock_product(...)
--
-- Replacing the signature, so drop the old one rather than leaving a stale
-- overload that PostgREST could still resolve against.
drop function if exists public.restock_product(uuid, numeric, integer, text);

create or replace function public.restock_product(
  p_product_id      uuid,
  p_quantity        numeric,
  p_unit_cost_cents integer,
  p_note            text default null,
  p_location_id     uuid default null
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

  select * into v_tenant from public.tenants where id = v_tenant_id;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, delta, reason, unit_cost_cents, created_by, note
  )
  values (
    v_tenant_id, v_location, p_product_id, p_quantity, 'restock', p_unit_cost_cents,
    auth.uid(), p_note
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

-- The grants from the old signature died with it. PUBLIC still gets EXECUTE at
-- creation and has to be named explicitly; anon and authenticated do not,
-- because 20260728000900 revoked that default - which is also why the grant
-- below is required rather than redundant.
revoke all on function public.restock_product(uuid, numeric, integer, text, uuid) from public, anon;
grant execute on function public.restock_product(uuid, numeric, integer, text, uuid) to authenticated;

comment on function public.restock_product(uuid, numeric, integer, text, uuid) is
  'Books a positive stock movement at one location and returns the resulting '
  'balance there, the org-wide balance, and the new weighted average cost. '
  'Defaults to the caller''s location when p_location_id is null.';

-- ---------------------------------------------------------------------------
-- 5. A deactivated account still resolved a tenant.
--
-- current_shop_role() already filters its fallback lookup on is_active, and the
-- live current_tenant_id() does too. This one does not, so for a user whose
-- token carries no tenant_id claim - the auth hook off, or a token minted
-- before provisioning - deactivating them left every policy still matching
-- their shop's rows. Their role comes back 'none', which blocks the writes, but
-- reads are scoped on tenant alone.
create or replace function public.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim text;
begin
  v_claim := nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id',
    ''
  );

  if v_claim is not null then
    return v_claim::uuid;
  end if;

  -- No claim: either the hook is off, or this token was issued before the user
  -- was provisioned into a shop and hasn't been refreshed yet.
  return (select u.tenant_id from public.users u where u.id = auth.uid() and u.is_active);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Nobody promotes themselves.
--
-- "users update their own profile" tried to enforce this in its WITH CHECK by
-- comparing the incoming role and tenant_id against the row already stored:
--
--   and role = (select u.role from public.users u where u.id = (select auth.uid()))
--
-- A policy on public.users cannot select from public.users. Postgres refuses
-- the whole statement:
--
--   42P17: infinite recursion detected in policy for relation "users"
--
-- so every profile update fails, and the protection it was reaching for is not
-- in force either. The running database dropped the subqueries and moved the
-- rule into a trigger, where reading the old row is just OLD. That is the shape
-- kept here, and it covers two columns the policy never looked at: location_id,
-- and pin_hash - a cashier could otherwise reset their own PIN.
create or replace function public.guard_self_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Owners manage staff, and SECURITY DEFINER routines (upsert_staff,
  -- set_staff_pin) run as the table owner, so neither is constrained here.
  if public.current_shop_role() = 'owner' or auth.uid() is null then
    return new;
  end if;

  if new.id = auth.uid() then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role' using errcode = 'PS403';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'You cannot move yourself to another shop' using errcode = 'PS403';
    end if;
    if new.location_id is distinct from old.location_id then
      raise exception 'Only an owner can reassign you to another location'
        using errcode = 'PS403';
    end if;
    if new.pin_hash is distinct from old.pin_hash then
      raise exception 'Only an owner can change a PIN' using errcode = 'PS403';
    end if;
  end if;

  return new;
end;
$$;

-- Postgres invokes this; nobody calls it, so it does not belong on the API
-- surface. Same treatment every other trigger function got in 20260728000900.
revoke all on function public.guard_self_promotion() from public, anon, authenticated;

drop trigger if exists users_guard_self_promotion on public.users;
create trigger users_guard_self_promotion
  before update on public.users
  for each row execute function public.guard_self_promotion();

-- With the trigger in place the WITH CHECK can say the one thing a policy can
-- actually answer without reading the table it is guarding.
drop policy if exists "users update their own profile" on public.users;
create policy "users update their own profile"
  on public.users for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. A new shop needs somewhere to put its stock.
--
-- Not drift: the live project runs this same provision_tenant, unchanged. It
-- has just never been caught, because its only shop predates 20260805000300 and
-- was handed a default location by that migration's backfill.
--
-- Every shop created since gets nothing. The backfill was a one-off over rows
-- that already existed, and provision_tenant was never taught to do the same
-- for new ones - while the same migration made stock_movements.location_id and
-- sales.location_id NOT NULL. default_location_id() then resolves to NULL and
-- the first sale or restock of a brand new shop dies on:
--
--   23502: null value in column "location_id" of relation "stock_movements"
--
-- A shop with no location is not a shop yet, so provisioning is the right place
-- to fix it rather than teaching each write path to cope. Same shape the
-- backfill used, so a shop provisioned today is indistinguishable from one
-- migrated then.
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

  -- The shop floor itself. Named after the shop until someone renames it,
  -- because a one-site business should never have to think about locations.
  insert into public.locations (tenant_id, kind, name, code, is_default)
  values (v_tenant.id, 'shop', v_tenant.name, 'MAIN', true);

  update public.users
  set tenant_id = v_tenant.id,
      role      = 'owner'
  where id = v_uid;

  return v_tenant;
end;
$$;
