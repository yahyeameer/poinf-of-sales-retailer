-- Stop staff PIN hashes being readable by staff.
--
-- verify_staff_pin() carries this comment, and has since it was written:
--
--   'SECURITY DEFINER so pin_hash never has to be selectable by a client.'
--
-- The function is indeed SECURITY DEFINER. The column was selectable anyway.
-- `authenticated` holds table-level SELECT on public.users, which cascades to
-- every column in it, so any signed-in member of a shop could read every
-- colleague's pin_hash:
--
--   select name, pin_hash from users;
--
-- The hash is bcrypt, so this is not a plaintext leak. It is worse than it
-- looks all the same: a PIN here is four to eight digits, and set_staff_pin()
-- validates 4–8, so the realistic keyspace is ten thousand candidates. That is
-- an offline brute force measured in minutes on a laptop, against a hash the
-- attacker already has and can attack at leisure.
--
-- What it buys them matters more now than it did. Until this release nothing
-- called verify_staff_pin(), so a cracked PIN opened nothing. Sales are now
-- attributed to whoever unlocks the till by PIN, so a cashier who cracks a
-- colleague's PIN can ring sales — or voids — under that colleague's name, and
-- the cashier-performance report will agree with them.
--
-- Column-level privileges are the fix. Postgres has no way to subtract one
-- column from a table-level grant, so the table grants are dropped and
-- re-issued per column, leaving pin_hash out.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. A safe way to ask the only question anyone actually asks
--
-- Two callers only ever needed "does this person have a PIN", never the hash:
-- till_staff() filters on it, and the staff screen shows a badge. A generated
-- column answers that without exposing the material, and cannot drift from it
-- the way a maintained boolean would.
-- ---------------------------------------------------------------------------

alter table public.users
  add column has_pin boolean generated always as (pin_hash is not null) stored;

comment on column public.users.has_pin is
  'Whether a PIN is set. Derived, so it cannot disagree with pin_hash. Exists '
  'so nothing needs read access to the hash itself.';

-- ---------------------------------------------------------------------------
-- 2. Re-issue the grants without pin_hash
--
-- DELETE has no column granularity and needs none — it takes the whole row.
-- ---------------------------------------------------------------------------

revoke select, insert, update on public.users from authenticated;

grant select (
  id, tenant_id, email, name, role, is_active, last_seen_at,
  created_at, updated_at, location_id, login_enabled, has_pin
) on public.users to authenticated;

-- Insert and update stay column-scoped for the same reason: the sanctioned way
-- to set a PIN is set_staff_pin(), which is SECURITY DEFINER and owner-gated.
-- Writing the column directly would sidestep both the length check and the
-- hashing.
grant insert (
  id, tenant_id, email, name, role, is_active, last_seen_at,
  created_at, updated_at, location_id, login_enabled
) on public.users to authenticated;

grant update (
  email, name, role, is_active, last_seen_at,
  updated_at, location_id, login_enabled
) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 3. till_staff() no longer needs the hash
--
-- It is not SECURITY DEFINER — deliberately, so the caller's RLS still decides
-- which staff they may see — which means the revoke above would have broken it
-- where it reads pin_hash. It reads the derived column instead. Behaviour is
-- unchanged; `has_pin` is true exactly when `pin_hash is not null`.
-- ---------------------------------------------------------------------------

create or replace function public.till_staff(p_location_id uuid default null)
returns table (id uuid, name text, role public.shop_role)
language sql
stable
set search_path = ''
as $$
  select u.id, u.name, u.role
  from public.users u
  where u.tenant_id = public.current_tenant_id()
    and u.is_active
    and u.has_pin
    and (u.location_id is null
         or u.location_id = coalesce(p_location_id, public.default_location_id()))
  order by u.name
$$;

grant execute on function public.till_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The claim in the original comment, now true
-- ---------------------------------------------------------------------------

comment on function public.verify_staff_pin is
  'SECURITY DEFINER so pin_hash never has to be selectable by a client — and '
  'as of 20260904000100 it genuinely is not: `authenticated` holds column '
  'grants on public.users that omit it. Still tenant-scoped: it will not '
  'verify a PIN belonging to another shop.';
