-- Take pin_hash away from `anon` too, and from any grant 20260904000100 missed.
--
-- 20260904000100 dropped the table-level grants on public.users and re-issued
-- them column by column, leaving pin_hash out. It revoked from `authenticated`
-- and only from `authenticated`.
--
-- That was enough on a database built from these migrations, where `anon` has
-- never held anything on public.users — which is why every local check passed.
-- It was not enough on the hosted project, where the production readiness check
-- reported:
--
--     PIN hashes are unreadable | FAIL | exposed to: anon, authenticated
--
-- Two separate gaps behind one message.
--
-- `anon` is the role a request carries before anyone signs in. It was never
-- revoked because the earlier migration did not name it. RLS still refuses the
-- rows — an anonymous caller has no tenant claim, so no policy matches — so
-- this is not by itself a way to read a hash. It is the belt that should be
-- there when the braces are the only thing holding, and for a bcrypt digest
-- over a four-digit keyspace that distinction is worth having.
--
-- `authenticated` is the surprising half, and the reason this migration uses
-- REVOKE ALL rather than naming privileges. In Postgres a privilege is
-- recorded per grantor: if `supabase_admin` granted SELECT and `postgres` runs
-- REVOKE, the grant made by the other role survives untouched and the column
-- stays readable. A hosted Supabase project is set up by roles that are not
-- the one the SQL editor runs as, so a targeted revoke can silently do
-- nothing there while working perfectly on a database you built yourself.
--
-- REVOKE ALL from both roles clears whatever is present, and the grants are
-- then re-issued from scratch, column by column, with pin_hash omitted. That
-- is idempotent and safe to run on a database where 20260904000100 already
-- did its job: it revokes what is there and puts back exactly what should be.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Clear everything, from both roles
-- ---------------------------------------------------------------------------

revoke all on public.users from anon;
revoke all on public.users from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Put back exactly what the app needs
--
-- Identical to the column list 20260904000100 established, plus the three
-- columns 20260905000100 added. pin_hash appears in none of them.
-- ---------------------------------------------------------------------------

grant select (
  id, tenant_id, email, name, role, is_active, last_seen_at,
  created_at, updated_at, location_id, login_enabled, has_pin,
  pin_set_at, pin_last_used_at, must_change_pin
) on public.users to authenticated;

grant insert (
  id, tenant_id, email, name, role, is_active, last_seen_at,
  created_at, updated_at, location_id, login_enabled
) on public.users to authenticated;

grant update (
  email, name, role, is_active, last_seen_at,
  updated_at, location_id, login_enabled
) on public.users to authenticated;

-- DELETE has no column granularity and needs none — it takes the whole row,
-- and RLS decides which rows. This was granted before; it is restored here
-- because the REVOKE ALL above took it away with everything else.
grant delete on public.users to authenticated;

-- `anon` gets nothing back. Nothing in the app reads public.users before the
-- caller has signed in; the sign-in itself goes through auth, not this table.

comment on column public.users.pin_hash is
  'bcrypt. Readable by nobody: `authenticated` holds column grants that omit '
  'it and `anon` holds nothing on this table at all. Verified by grantee AND '
  'by grantor — a privilege is recorded per grantor, so a revoke issued by one '
  'role leaves a grant made by another in place, which is how this survived '
  '20260904000100 on the hosted project.';
