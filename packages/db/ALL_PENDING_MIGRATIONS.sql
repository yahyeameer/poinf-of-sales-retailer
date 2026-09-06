-- ============================================================================
--  ALL PENDING MIGRATIONS, AS ONE PASTE-ABLE SCRIPT
-- =========================================================================
--
--  GENERATED FILE - do not edit. Regenerate with:
--      node packages/db/scripts/bundle-migrations.mjs
--
--  Prefer `npm run db:push`. It applies these same files in order AND records
--  them in Supabase's migration history, so the CLI knows what has run. Use
--  this file only when the CLI is not available.
--
--  WHAT THIS IS
--  Migrations 20260904000100 to 20260909000100, in order, wrapped in a single
--  transaction, followed by the migration-history rows the CLI would write.
--
--  ALL OR NOTHING
--  Postgres applies DDL transactionally, so if any statement fails the whole
--  script rolls back and the database is untouched. You cannot end up half
--  applied. If it errors, send the message rather than editing around it - the
--  likely cause is that some of these are already applied, and the fix is to
--  regenerate the bundle from a later migration, not to force past the error.
--
--  SAFETY
--  Nothing here drops a table, truncates, or deletes a row. The changes are
--  new columns with defaults, new tables, new and replaced functions, and
--  ALTER VIEW. No existing figure moves.
--
--  HOW TO RUN IT
--  Supabase Dashboard -> SQL Editor -> New query -> paste all of it -> Run.
--  Then run verification/production_check_editor.sql and confirm every row
--  reads PASS.
-- =========================================================================

begin;


-- =========================================================================
--  20260904000100_protect_pin_hash.sql
-- =========================================================================

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


-- =========================================================================
--  20260905000100_staff_pin_admin.sql
-- =========================================================================

-- Managing a staff PIN without being able to read one.
--
-- 20260904000100 made pin_hash unreadable, which was the right call and left
-- three practical gaps behind:
--
--   * Only an owner could set or clear a PIN. In a shop with a manager on the
--     floor and the owner away, a cashier who forgets their PIN cannot be
--     helped until the owner is back. Since a PIN cannot be recovered — it is
--     bcrypt, and deliberately not readable by anyone — "forgot my PIN" always
--     means "issue a new one", so this is the whole recovery path.
--   * A PIN issued by someone else is known to that someone else. There was no
--     way to say "use this once, then choose your own".
--   * Nothing recorded who changed whose PIN. Sales are attributed by PIN, so
--     whoever can set one can decide which name a sale is rung under. That is
--     worth a trail even in a shop of three people.
--
-- The delegation is deliberately not symmetric: a manager may manage cashiers,
-- never an owner. Otherwise the weakest till credential in the shop becomes a
-- route to the strongest, which is the opposite of what a PIN is for.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. What a PIN now carries with it
-- ---------------------------------------------------------------------------

alter table public.users
  add column pin_set_at        timestamptz,
  add column pin_last_used_at  timestamptz,
  add column must_change_pin   boolean not null default false;

comment on column public.users.pin_set_at is
  'When the current PIN was issued. Answers "is this still the temporary one '
  'from three months ago" without exposing anything about the PIN itself.';

comment on column public.users.pin_last_used_at is
  'Last successful till unlock. A PIN that has never been used usually means '
  'the staff member was never shown it.';

comment on column public.users.must_change_pin is
  'Set when someone else issued this PIN. The till accepts it once and then '
  'requires a new one, so a PIN a manager knows does not stay in use.';

-- These three are facts *about* a PIN, not the PIN, so they are readable.
-- Writing them stays with the functions below: must_change_pin in particular
-- would be worth clearing by hand if a client could.
grant select (pin_set_at, pin_last_used_at, must_change_pin)
  on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who may manage whose PIN
--
-- One place, so the four functions below cannot drift apart on the question.
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_staff_pin(p_target_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text := public.current_shop_role();
  v_target_role public.shop_role;
begin
  select u.role into v_target_role
  from public.users u
  where u.id = p_target_id
    and u.tenant_id = public.current_tenant_id();

  -- Not in this shop, or no such person. Never leak which.
  if v_target_role is null then
    return false;
  end if;

  if v_actor_role = 'owner' then
    return true;
  end if;

  -- A manager runs the floor, so they issue cashiers' PINs — but not an
  -- owner's, and not another manager's. Managing your own is self-service,
  -- handled by change_own_staff_pin(), which demands the current PIN.
  if v_actor_role = 'manager' then
    return v_target_role = 'cashier';
  end if;

  return false;
end;
$$;

comment on function public.can_manage_staff_pin is
  'Whether the caller may issue or clear a PIN for this person. Owners may '
  'manage anyone in their shop; managers may manage cashiers only, so a till '
  'PIN can never be used to reach an owner account.';

revoke all on function public.can_manage_staff_pin(uuid) from public;
grant execute on function public.can_manage_staff_pin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The trail
--
-- Append-only by construction. That takes two things, not one.
--
-- The obvious half is RLS: only a SELECT policy exists, so no client statement
-- can match a row to write. The half that is easy to miss is that
-- 20260817000100 set ALTER DEFAULT PRIVILEGES for this schema, so every table
-- created here is granted select, insert, update and delete to `authenticated`
-- automatically — including this one, the moment it is created. Granting only
-- SELECT does not take the others away; they arrive on their own.
--
-- Checked rather than assumed: information_schema.role_table_grants showed all
-- four on this table straight after creation. RLS still refused the writes, so
-- nothing leaked, but "the log cannot be edited" resting on a single mechanism
-- is not what an audit trail is for. The revoke below is the other half.
-- ---------------------------------------------------------------------------

create table public.staff_pin_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- Null when the actor's account was later deleted; the entry still stands.
  actor_id    uuid references public.users(id) on delete set null,
  target_id   uuid not null references public.users(id) on delete cascade,
  action      text not null check (action in ('issued', 'cleared', 'reset_required', 'changed_by_self')),
  created_at  timestamptz not null default now()
);

comment on table public.staff_pin_events is
  'Who changed whose till PIN. Sales are attributed by PIN, so the ability to '
  'issue one is the ability to choose whose name a sale is rung under.';

-- Foreign keys are not indexed automatically, and all three are used: the
-- listing below filters on tenant, the staff screen shows one person''s
-- history, and "what has this manager been doing" reads by actor.
create index staff_pin_events_tenant_at_idx
  on public.staff_pin_events (tenant_id, created_at desc);
create index staff_pin_events_target_idx on public.staff_pin_events (target_id);
create index staff_pin_events_actor_idx on public.staff_pin_events (actor_id);

alter table public.staff_pin_events enable row level security;

-- current_tenant_id() is wrapped in a SELECT so Postgres evaluates it once for
-- the statement rather than once per row.
create policy "managers read pin events"
  on public.staff_pin_events for select
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_shop_role()) in ('owner', 'manager')
  );

grant select on public.staff_pin_events to authenticated;

-- Undo what the schema's default privileges handed out. The only writer is
-- log_staff_pin_event() below, which is SECURITY DEFINER and runs as the owner.
revoke insert, update, delete, truncate on public.staff_pin_events from authenticated;
revoke insert, update, delete, truncate on public.staff_pin_events from anon;

create or replace function public.log_staff_pin_event(
  p_target_id uuid,
  p_action    text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.staff_pin_events (tenant_id, actor_id, target_id, action)
  values (public.current_tenant_id(), auth.uid(), p_target_id, p_action);
$$;

-- Internal. Callable only by the functions below, which are themselves gated.
revoke all on function public.log_staff_pin_event(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 4. Issuing, clearing, forcing and self-service
-- ---------------------------------------------------------------------------

-- Replaces the owner-only version from 20260728000600. Same signature, so no
-- caller changes; the authorisation, the timestamps and the trail are new.
create or replace function public.set_staff_pin(
  p_user_id uuid,
  p_pin     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_staff_pin(p_user_id) then
    raise exception 'Not allowed to set this staff member''s PIN'
      using errcode = 'PS403';
  end if;

  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits' using errcode = 'PS422';
  end if;

  update public.users
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
      pin_set_at = now(),
      pin_last_used_at = null,
      -- Issued by someone else, so it is a one-time PIN. The exception is
      -- issuing your own, which nobody else has seen.
      must_change_pin = (p_user_id <> auth.uid())
  where id = p_user_id
    and tenant_id = public.current_tenant_id();

  if not found then
    raise exception 'No such staff member in this shop' using errcode = 'PS404';
  end if;

  perform public.log_staff_pin_event(p_user_id, 'issued');
end;
$$;

create or replace function public.clear_staff_pin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_staff_pin(p_user_id) then
    raise exception 'Not allowed to clear this staff member''s PIN'
      using errcode = 'PS403';
  end if;

  update public.users
  set pin_hash = null,
      pin_set_at = null,
      pin_last_used_at = null,
      must_change_pin = false
  where id = p_user_id and tenant_id = public.current_tenant_id();

  if not found then
    raise exception 'No such staff member in this shop' using errcode = 'PS404';
  end if;

  perform public.log_staff_pin_event(p_user_id, 'cleared');
end;
$$;

-- "I think someone watched them type it." Keeps the PIN working so the shift
-- is not interrupted, but forces a new one at the next unlock.
create or replace function public.require_staff_pin_change(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_staff_pin(p_user_id) then
    raise exception 'Not allowed to manage this staff member''s PIN'
      using errcode = 'PS403';
  end if;

  update public.users
  set must_change_pin = true
  where id = p_user_id
    and tenant_id = public.current_tenant_id()
    and pin_hash is not null;

  if not found then
    raise exception 'That staff member has no PIN to change'
      using errcode = 'PS404';
  end if;

  perform public.log_staff_pin_event(p_user_id, 'reset_required');
end;
$$;

revoke all on function public.require_staff_pin_change(uuid) from public;
grant execute on function public.require_staff_pin_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. Teaching the self-promotion guard about legitimate self-service
--
-- public.users carries guard_self_promotion() (20260817000100), which raises
-- 'Only an owner can change a PIN' whenever a non-owner changes pin_hash on
-- their own row. That rule is right: without it, a cashier who reached the
-- table directly could reissue their own till credential.
--
-- Its comment claims SECURITY DEFINER routines are "not constrained here".
-- They are: SECURITY DEFINER changes which privileges apply, not what
-- current_shop_role() returns, and that function reads the JWT claim. The
-- existing callers simply never hit the rule, because they only ever write
-- someone *else's* row. change_own_staff_pin() is the first that does not.
--
-- So the guard is taught to recognise one specific case, keyed to a row rather
-- than to a session: a transaction-local setting naming the exact user whose
-- PIN is being replaced. Setting it grants nothing on its own — `authenticated`
-- holds no update privilege on pin_hash at all since 20260904000100, so a
-- client that set this by hand still cannot write the column. It is the
-- SECURITY DEFINER function's way of saying "this one is deliberate", not a
-- permission. The verification script tests exactly that.
-- ---------------------------------------------------------------------------

create or replace function public.guard_self_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
    if new.pin_hash is distinct from old.pin_hash
       and coalesce(current_setting('app.self_pin_change', true), '') <> new.id::text
    then
      raise exception 'Only an owner can change a PIN' using errcode = 'PS403';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_self_promotion is
  'Stops anyone but an owner editing their own role, shop, location or PIN. '
  'The PIN rule makes one exception, for change_own_staff_pin(), which has '
  'already required the current PIN as proof.';

-- Self-service. The only path that does not need a manager, and the only one
-- that proves the caller already knows the PIN it is replacing — which is what
-- makes it safe to let a cashier use it on their own account.
--
-- Takes no user id on purpose: it always acts on the person who can produce
-- the current PIN, so it cannot be pointed at a colleague.
create or replace function public.change_own_staff_pin(
  p_user_id     uuid,
  p_current_pin text,
  p_new_pin     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_new_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits' using errcode = 'PS422';
  end if;

  -- Same check the till does to unlock, so a wrong current PIN fails here for
  -- exactly the reason it would fail there.
  if not public.verify_staff_pin(p_user_id, p_current_pin) then
    raise exception 'That PIN is not correct' using errcode = 'PS403';
  end if;

  if p_new_pin = p_current_pin then
    raise exception 'The new PIN must be different from the old one'
      using errcode = 'PS422';
  end if;

  -- Transaction-local, and names the row it authorises. Cleared immediately
  -- so it cannot cover a second, unrelated write later in the same request.
  perform set_config('app.self_pin_change', p_user_id::text, true);

  update public.users
  set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
      pin_set_at = now(),
      must_change_pin = false
  where id = p_user_id
    and tenant_id = public.current_tenant_id();

  perform set_config('app.self_pin_change', '', true);

  perform public.log_staff_pin_event(p_user_id, 'changed_by_self');
end;
$$;

comment on function public.change_own_staff_pin is
  'Replace a PIN by proving you know it. Deliberately usable by a cashier on '
  'their own account: the current PIN is the authorisation, so no elevated '
  'role is involved and no manager has to be found.';

revoke all on function public.change_own_staff_pin(uuid, text, text) from public;
grant execute on function public.change_own_staff_pin(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Record use, and let the till see what it must ask for
-- ---------------------------------------------------------------------------

-- last_seen_at was already being touched here; pin_last_used_at is the
-- narrower fact, and the one the staff screen can explain.
create or replace function public.verify_staff_pin(
  p_user_id uuid,
  p_pin     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash
  from public.users
  where id = p_user_id
    and tenant_id = public.current_tenant_id()
    and is_active;

  if v_hash is null then
    return false;
  end if;

  if extensions.crypt(p_pin, v_hash) = v_hash then
    update public.users
    set last_seen_at = now(),
        pin_last_used_at = now()
    where id = p_user_id;
    return true;
  end if;

  return false;
end;
$$;

-- The till has to know before unlocking whether this person owes a new PIN, so
-- it can ask for one in the same breath rather than letting them start a shift
-- and interrupting it. Return type changes, so this is a drop and recreate.
drop function if exists public.till_staff(uuid);

create or replace function public.till_staff(p_location_id uuid default null)
returns table (
  id uuid,
  name text,
  role public.shop_role,
  must_change_pin boolean
)
language sql
stable
set search_path = ''
as $$
  select u.id, u.name, u.role, u.must_change_pin
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
-- 6. The staff screen's view of all this
--
-- A view rather than four more columns on a select, so the one place that
-- decides what is safe to show about a PIN is here, next to the grants.
-- SECURITY INVOKER (the default) so the caller's RLS still applies.
-- ---------------------------------------------------------------------------

create or replace view public.v_staff_pin_status as
  select
    u.id,
    u.tenant_id,
    u.name,
    u.role,
    u.is_active,
    u.has_pin,
    u.pin_set_at,
    u.pin_last_used_at,
    u.must_change_pin,
    -- Never used since it was issued, and issued by someone else: almost
    -- always a PIN the staff member has not actually been given yet.
    (u.has_pin and u.pin_last_used_at is null) as pin_never_used,
    public.can_manage_staff_pin(u.id) as can_manage
  from public.users u
  where u.tenant_id = public.current_tenant_id();

comment on view public.v_staff_pin_status is
  'Everything the staff screen needs to talk about PINs, and nothing about the '
  'PIN itself. can_manage answers "should this row show buttons" with the same '
  'rule the functions enforce, so the UI cannot offer an action that will fail.';

grant select on public.v_staff_pin_status to authenticated;


-- =========================================================================
--  20260905000200_expenses.sql
-- =========================================================================

-- What the shop spends, so "profit" can mean profit.
--
-- Everything reported up to now stops at gross margin: revenue minus what the
-- goods cost, which sale_items snapshot at the moment of sale. That is the
-- right number for "which lines are worth stocking" and the wrong one for "did
-- we make money this month". Rent, wages, transport and electricity are not in
-- it, and in a small shop they are most of the difference between a good
-- margin and an empty till.
--
-- So: a ledger of money going out, in the same integer minor units as every
-- other amount in this schema, and a view that finally subtracts one from the
-- other.
--
-- One thing here is not like the other tables. Expenses include wages, and a
-- cashier being able to read their colleagues' pay is a real problem in a real
-- shop. Every other table in this schema is readable by any member; this one
-- is owner and manager only, enforced in the policy rather than in the UI.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Categories
--
-- A fixed list rather than free text, because the whole point is to group and
-- total these. Free text gives you 'Rent', 'rent' and 'RENT' by the third
-- month and no usable report. 'other' is the escape hatch, and the note column
-- carries the detail.
-- ---------------------------------------------------------------------------

create type public.expense_category as enum (
  'rent',
  'wages',
  'stock_transport',
  'utilities',
  'supplies',
  'maintenance',
  'fees',
  'other'
);

comment on type public.expense_category is
  'Deliberately short. Categories exist to be totalled, and a list long enough '
  'to need thought at the counter gets used inconsistently.';

-- ---------------------------------------------------------------------------
-- 2. The ledger
-- ---------------------------------------------------------------------------

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  -- Null means "the whole business" — rent for a single shop, an accountant's
  -- fee. Set means this cost belongs to one branch, which is what makes
  -- per-location profit possible once a shop has more than one.
  location_id   uuid references public.locations(id) on delete set null,

  category      public.expense_category not null,

  -- Minor units, like every other amount here. A cost of zero is not a cost,
  -- and a negative one is a refund that belongs on its own row with a note.
  amount_cents  bigint not null check (amount_cents > 0),

  note          text check (note is null or length(note) <= 500),

  -- The date the money was spent, which is not always the date it was typed
  -- in. Reports group on this.
  spent_on      date not null default current_date,

  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.expenses is
  'Money out. Read and written by owners and managers only — this holds wages.';

create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();

-- Foreign keys are not indexed automatically. tenant/date carries the reports,
-- and the other two carry the joins and the ON DELETE behaviour above.
create index expenses_tenant_spent_idx
  on public.expenses (tenant_id, spent_on desc);
create index expenses_location_idx on public.expenses (location_id);
create index expenses_created_by_idx on public.expenses (created_by);

-- ---------------------------------------------------------------------------
-- 3. Who can see the wage bill
--
-- current_tenant_id() and current_shop_role() are wrapped in SELECT so
-- Postgres evaluates each once per statement rather than once per row.
-- ---------------------------------------------------------------------------

alter table public.expenses enable row level security;

create policy "managers read expenses"
  on public.expenses for select
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_shop_role()) in ('owner', 'manager')
    and public.can_see_location(location_id)
  );

create policy "managers write expenses"
  on public.expenses for all
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_shop_role()) in ('owner', 'manager')
    and public.can_see_location(location_id)
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_shop_role()) in ('owner', 'manager')
    and public.can_see_location(location_id)
  );

grant select, insert, update, delete on public.expenses to authenticated;

-- The schema's default privileges (20260817000100) hand `anon` nothing, but
-- this table is worth being explicit about rather than inheriting a default.
revoke all on public.expenses from anon;

-- ---------------------------------------------------------------------------
-- 4. Recording one
--
-- A function rather than a plain insert so tenant_id and created_by are filled
-- from the session instead of being supplied by the client. RLS would refuse a
-- wrong tenant_id anyway; not accepting one at all is simpler to reason about.
-- ---------------------------------------------------------------------------

create or replace function public.record_expense(
  p_category    public.expense_category,
  p_amount_cents bigint,
  p_spent_on    date default null,
  p_note        text default null,
  p_location_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can record expenses'
      using errcode = 'PS403';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'An expense must be more than zero' using errcode = 'PS422';
  end if;

  -- A date in the future is nearly always a typo in the year, and it would
  -- quietly fall outside every report until someone went looking.
  if coalesce(p_spent_on, current_date) > current_date then
    raise exception 'An expense cannot be dated in the future'
      using errcode = 'PS422';
  end if;

  insert into public.expenses
    (tenant_id, location_id, category, amount_cents, note, spent_on, created_by)
  values (
    public.current_tenant_id(),
    p_location_id,
    p_category,
    p_amount_cents,
    nullif(btrim(p_note), ''),
    coalesce(p_spent_on, current_date),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_expense(public.expense_category, bigint, date, text, uuid) from public;
grant execute on function public.record_expense(public.expense_category, bigint, date, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reporting
--
-- Both views are SECURITY INVOKER (the default), so the RLS above still
-- decides what a caller sees. A cashier reading v_profit_daily gets no rows
-- rather than someone else's wages.
-- ---------------------------------------------------------------------------

create or replace view public.v_expenses_daily as
  select
    e.tenant_id,
    e.spent_on as day,
    e.category,
    sum(e.amount_cents)::bigint as amount_cents,
    count(*)::bigint as entries
  from public.expenses e
  group by e.tenant_id, e.spent_on, e.category;

comment on view public.v_expenses_daily is
  'Daily spend by category. Grouped on spent_on, not created_at, so a cost '
  'entered late still lands on the day it was actually incurred.';

grant select on public.v_expenses_daily to authenticated;

-- The number the whole migration exists for.
--
-- A full outer join, not an inner one: a day with sales and no expenses and a
-- day with expenses and no sales are both real and both interesting, and an
-- inner join would silently drop each of them.
create or replace view public.v_profit_daily as
  with sales_by_day as (
    select
      p.day,
      sum(p.revenue_cents)::bigint as revenue_cents,
      sum(p.margin_cents)::bigint  as gross_margin_cents
    from public.v_product_performance p
    group by p.day
  ),
  spend_by_day as (
    select e.day, sum(e.amount_cents)::bigint as expenses_cents
    from public.v_expenses_daily e
    group by e.day
  )
  select
    coalesce(s.day, x.day) as day,
    coalesce(s.revenue_cents, 0) as revenue_cents,
    coalesce(s.gross_margin_cents, 0) as gross_margin_cents,
    coalesce(x.expenses_cents, 0) as expenses_cents,
    -- What is actually left. Can be negative, and saying so is the point.
    coalesce(s.gross_margin_cents, 0) - coalesce(x.expenses_cents, 0) as net_profit_cents
  from sales_by_day s
  full outer join spend_by_day x on x.day = s.day;

comment on view public.v_profit_daily is
  'Gross margin minus expenses, per day. The first number in this schema that '
  'answers "did the shop make money", rather than "did the goods sell well". '
  'net_profit_cents is signed on purpose.';

grant select on public.v_profit_daily to authenticated;


-- =========================================================================
--  20260906000100_zero_total_sales.sql
-- =========================================================================

-- A sale that comes to nothing should still record.
--
-- Found by running the till's own arithmetic through process_sale(): two
-- ordinary situations both failed with a raw constraint violation rather than
-- a message anyone could act on.
--
--   * A zero-priced line. Shops ring these up so the stock movement still
--     happens — a carrier bag, a sample, something bundled in.
--   * A discount that cancels the basket. On the house, a staff meal, a
--     damaged item written off in front of the customer.
--
-- In both cases the sale total is zero, and process_sale() unconditionally
-- inserted a sale_payments row for that amount. sale_payments checks
-- amount_cents <> 0, so the insert failed, the transaction rolled back, and
-- the cashier saw "new row for relation sale_payments violates check
-- constraint" mid-checkout.
--
-- The constraint is right: zero is not a tender. The fix is to not write the
-- row. Everything else about the sale — the lines, the stock movements, the
-- attribution — is unchanged and still recorded.
--
-- Only the payment block differs from the previous definition; the rest is
-- carried over verbatim so this cannot quietly change the arithmetic.

set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.process_sale(p_client_id text, p_items jsonb, p_payment_method payment_method, p_discount_cents integer DEFAULT 0, p_created_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text, p_shift_id uuid DEFAULT NULL::uuid, p_payments jsonb DEFAULT NULL::jsonb, p_location_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid)
 RETURNS sales
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant_id   uuid := public.current_tenant_id();
  v_uid         uuid := auth.uid();
  v_cashier     uuid;
  v_location    uuid := coalesce(p_location_id, public.default_location_id());
  v_tenant      public.tenants;
  v_sale        public.sales;
  v_item        jsonb;
  v_product     public.products;
  v_on_hand     numeric(14,3);
  v_qty         numeric(14,3);
  v_unit_price  integer;
  v_line_total  integer;
  v_subtotal    integer := 0;
  v_taxable     integer;
  v_tax         integer;
  v_total       integer;
  v_oversell    boolean := false;
  v_lines       jsonb := '[]'::jsonb;
  v_paid        integer;
  v_method      public.payment_method;
  v_shift       public.shifts;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;
  if v_location is null then
    raise exception 'This shop has no location set up' using errcode = 'PS422';
  end if;

  -- A caller may name any active staff member in their own shop, and nobody
  -- outside it. Falling back to the session's own user keeps existing callers
  -- working unchanged.
  if p_cashier_id is not null then
    select id into v_cashier from public.users
    where id = p_cashier_id and tenant_id = v_tenant_id and is_active;
    if not found then
      raise exception 'That cashier is not on this shop''s staff' using errcode = 'PS404';
    end if;
  else
    v_cashier := v_uid;
  end if;

  select * into v_sale
  from public.sales
  where tenant_id = v_tenant_id and client_id = p_client_id;

  if found then
    return v_sale;
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A sale needs at least one line' using errcode = 'PS422';
  end if;

  if p_shift_id is not null then
    select * into v_shift from public.shifts
    where id = p_shift_id and tenant_id = v_tenant_id;
    if not found then
      raise exception 'Shift not found' using errcode = 'PS404';
    end if;
    if v_shift.status <> 'open' then
      raise exception 'That shift is closed - open a new one' using errcode = 'PS405';
    end if;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items) as t(value)
    order by (value ->> 'product_id')::uuid
  loop
    v_qty        := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unit_price_cents')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line quantity must be positive' using errcode = 'PS422';
    end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid and tenant_id = v_tenant_id;

    if not found then
      raise exception 'Product % is not in this shop', v_item ->> 'product_id'
        using errcode = 'PS404';
    end if;

    select ls.on_hand into v_on_hand
    from public.location_stock ls
    where ls.location_id = v_location and ls.product_id = v_product.id
    for update;

    v_on_hand := coalesce(v_on_hand, 0);

    if v_unit_price is null then
      v_unit_price := v_product.price_cents;
    end if;

    if v_on_hand - v_qty < 0 then
      if not v_tenant.allow_oversell then
        raise exception 'Only % of "%" left here', v_on_hand, v_product.name
          using errcode = 'PS422', detail = v_product.id::text;
      end if;
      v_oversell := true;
    end if;

    v_line_total := round(v_qty * v_unit_price)::integer;
    v_subtotal   := v_subtotal + v_line_total;

    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_product.id,
      'quantity',         v_qty,
      'unit_price_cents', v_unit_price,
      'line_total_cents', v_line_total,
      'name_at_sale',     v_product.name,
      'unit_cost_cents',  v_product.cost_cents
    );
  end loop;

  p_discount_cents := least(greatest(coalesce(p_discount_cents, 0), 0), v_subtotal);
  v_taxable := v_subtotal - p_discount_cents;

  if v_tenant.tax_inclusive then
    v_tax   := round(v_taxable * v_tenant.tax_rate / (1 + v_tenant.tax_rate))::integer;
    v_total := v_taxable;
  else
    v_tax   := round(v_taxable * v_tenant.tax_rate)::integer;
    v_total := v_taxable + v_tax;
  end if;

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    select coalesce(sum((e ->> 'amount_cents')::integer), 0) into v_paid
    from jsonb_array_elements(p_payments) as t(e);

    if v_paid <> v_total then
      raise exception 'Payments total % but the sale is %', v_paid, v_total
        using errcode = 'PS422';
    end if;

    if jsonb_array_length(p_payments) = 1 then
      v_method := (p_payments -> 0 ->> 'method')::public.payment_method;
    else
      v_method := 'mixed';
    end if;
  else
    v_method := coalesce(p_payment_method, 'cash');
  end if;

  insert into public.sales (
    tenant_id, location_id, cashier_id, client_id, shift_id, kind,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    payment_method, tax_inclusive, has_oversell, note, created_at
  )
  values (
    v_tenant_id, v_location, v_cashier, p_client_id, p_shift_id, 'sale',
    v_subtotal, p_discount_cents, v_tax, v_total,
    v_method, v_tenant.tax_inclusive, v_oversell, p_note,
    coalesce(p_created_at, now())
  )
  returning * into v_sale;

  insert into public.sale_items (
    tenant_id, sale_id, product_id, quantity,
    unit_price_cents, line_total_cents, name_at_sale, unit_cost_cents
  )
  select v_tenant_id, v_sale.id, l.product_id, l.quantity,
         l.unit_price_cents, l.line_total_cents, l.name_at_sale, l.unit_cost_cents
  from jsonb_to_recordset(v_lines) as l(
    product_id uuid, quantity numeric, unit_price_cents integer,
    line_total_cents integer, name_at_sale text, unit_cost_cents integer
  );

  -- A sale can legitimately come to nothing: a zero-priced line (a carrier bag
  -- rung up so stock still moves) or a discount that cancels the whole basket
  -- (on the house, a staff meal, a damaged item written off). Those still need
  -- to be recorded, because the stock movement and the audit trail are the
  -- point of ringing them up at all.
  --
  -- What they must not do is write a payment row. sale_payments checks
  -- amount_cents <> 0, deliberately — zero is not a tender, and a row saying
  -- someone paid nothing is noise in every report that reads the table. Before
  -- this, the fallback below inserted v_total unconditionally, so both cases
  -- died on that constraint and the cashier got a raw Postgres error in the
  -- middle of a checkout.
  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents, tendered_cents, reference)
    select v_tenant_id, v_sale.id,
           (e ->> 'method')::public.payment_method,
           (e ->> 'amount_cents')::integer,
           nullif(e ->> 'tendered_cents', '')::integer,
           nullif(e ->> 'reference', '')
    from jsonb_array_elements(p_payments) as t(e)
    -- A split-tender payload can carry a zero leg for a method the cashier
    -- opened and left empty. It is not a payment either.
    where (e ->> 'amount_cents')::integer <> 0;
  elsif v_total <> 0 then
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents)
    values (v_tenant_id, v_sale.id, v_method, v_total);
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, delta, reason, reference_id, created_by
  )
  select v_tenant_id, v_location, l.product_id, -l.quantity, 'sale', v_sale.id, v_cashier
  from jsonb_to_recordset(v_lines) as l(product_id uuid, quantity numeric);

  return v_sale;

exception
  when unique_violation then
    select * into v_sale from public.sales
    where tenant_id = v_tenant_id and client_id = p_client_id;
    if found then
      return v_sale;
    end if;
    raise;
end;
$function$;


-- =========================================================================
--  20260906000200_views_security_invoker.sql
-- =========================================================================

-- Close a cross-tenant leak in three views.
--
-- A Postgres view does not run as the person querying it. It runs as the view's
-- owner, and RLS on the tables underneath is evaluated against that owner —
-- unless the view is created with `security_invoker = on`, which has existed
-- since PG15 and is off by default.
--
-- Every view in this schema up to 20260903 sets it. The three added in
-- 20260905 did not, and their comments confidently described them as
-- "SECURITY INVOKER (the default)". That is true of functions and false of
-- views, which is exactly the kind of thing a comment should not be trusted on.
--
-- These views are owned by postgres, so they were reading their base tables as
-- a superuser: no RLS at all. Reproduced before fixing, on a shop with one
-- expense of 500000 recorded as wages:
--
--   * a cashier selecting from public.expenses      -> 0 rows (policy works)
--   * the same cashier from v_expenses_daily        -> 1 row, wages visible
--   * an owner of a DIFFERENT shop from v_profit_daily -> 1 row
--
-- So the manager-only rule on expenses was bypassable by reading the view
-- instead of the table, and one shop could read another's takings. Wages were
-- the specific thing the policy on public.expenses was written to protect.
--
-- The base tables were never wrong. Only these three views were.

set search_path = public, extensions;

alter view public.v_expenses_daily   set (security_invoker = on);
alter view public.v_profit_daily     set (security_invoker = on);
alter view public.v_staff_pin_status set (security_invoker = on);

comment on view public.v_expenses_daily is
  'Daily spend by category. Grouped on spent_on, not created_at, so a cost '
  'entered late still lands on the day it was actually incurred. '
  'security_invoker is on, so the caller''s RLS applies — without it this view '
  'reads as its owner and hands every shop''s wage bill to anyone who asks.';

comment on view public.v_profit_daily is
  'Gross margin minus expenses, per day. The first number in this schema that '
  'answers "did the shop make money", rather than "did the goods sell well". '
  'net_profit_cents is signed on purpose. security_invoker is on: see above.';

comment on view public.v_staff_pin_status is
  'Everything the staff screen needs to talk about PINs, and nothing about the '
  'PIN itself. can_manage answers "should this row show buttons" with the same '
  'rule the functions enforce. security_invoker is on: see above.';


-- =========================================================================
--  20260906000300_expense_date_timezone.sql
-- =========================================================================

-- Let a shop record today's expense when their today is not UTC's today.
--
-- record_expense() rejected any spent_on after current_date, and current_date
-- on the server is UTC. spent_on is a plain date meaning "the day this money
-- went out", which is always the local day, so for a shop east of Greenwich
-- their own today is UTC's tomorrow for part of every day — and the function
-- refused it as "dated in the future".
--
-- The check exists to catch a mistyped year, which is what it will still do:
-- 2027 is a year out, not a day. One day of slack is the widest any real
-- offset can be (UTC+14 is the furthest ahead there is), so this stays a
-- typo guard while no longer refusing a shop its own calendar.
--
-- The schema stores no per-tenant timezone, so this is deliberately the small
-- version of the fix. The larger one — bucketing the daily reporting views by
-- the shop's local day rather than UTC — is a separate change and is written
-- up rather than guessed at here.

set search_path = public, extensions;

create or replace function public.record_expense(
  p_category    public.expense_category,
  p_amount_cents bigint,
  p_spent_on    date default null,
  p_note        text default null,
  p_location_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can record expenses'
      using errcode = 'PS403';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'An expense must be more than zero' using errcode = 'PS422';
  end if;

  -- One day of slack for timezones ahead of UTC. Still catches the typo this
  -- guard was written for.
  if coalesce(p_spent_on, current_date) > current_date + 1 then
    raise exception 'An expense cannot be dated in the future'
      using errcode = 'PS422';
  end if;

  insert into public.expenses
    (tenant_id, location_id, category, amount_cents, note, spent_on, created_by)
  values (
    public.current_tenant_id(),
    p_location_id,
    p_category,
    p_amount_cents,
    nullif(btrim(p_note), ''),
    coalesce(p_spent_on, current_date),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_expense(public.expense_category, bigint, date, text, uuid) from public;
grant execute on function public.record_expense(public.expense_category, bigint, date, text, uuid) to authenticated;


-- =========================================================================
--  20260907000100_shop_timezone.sql
-- =========================================================================

-- Report a shop's day, not Greenwich's.
--
-- Three views bucketed sales with (created_at AT TIME ZONE 'UTC')::date, and
-- nothing recorded where the shop actually is. So "today's takings" meant
-- today in UTC, which is only the same thing as the shop's today for a shop
-- in UTC and for the part of the day the two happen to overlap elsewhere.
--
-- Concretely, before this:
--
--   * Nairobi (UTC+3): a sale at 01:30 on Tuesday is 22:30 UTC Monday, so it
--     lands in Monday's figures. A shop that closes before midnight never
--     notices; one that trades late is quietly wrong every night.
--   * Anywhere west of Greenwich it is worse and constant: in UTC-5, every
--     sale after 19:00 local is already tomorrow in UTC, so the evening trade
--     — often the busiest part of the day — is reported on the wrong day.
--
-- The number an owner checks when they cash up is this one. If it disagrees
-- with the drawer they stop trusting the product, and they are right to.
--
-- Default 'UTC', so a shop that never sets this behaves exactly as it does
-- today and this migration changes no existing figure.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Where the shop is
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column timezone text not null default 'UTC';

comment on column public.tenants.timezone is
  'IANA name, e.g. Africa/Nairobi. Decides where a shop''s day starts and ends '
  'for every daily report. Defaults to UTC, which is what the reports assumed '
  'before this column existed.';

-- A CHECK constraint cannot consult pg_timezone_names — the lookup is not
-- immutable — so the guard is a trigger. Worth having: a typo like
-- 'Africa/Nairobbi' would not error anywhere, it would silently fall back and
-- put the shop's day back on UTC, which is exactly the bug being fixed.
create or replace function public.validate_tenant_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone)
  then
    raise exception '% is not a known timezone name', coalesce(new.timezone, '(null)')
      using errcode = 'PS422',
            hint = 'Use an IANA name such as Africa/Nairobi or America/New_York.';
  end if;
  return new;
end;
$$;

create trigger tenants_validate_timezone
  before insert or update of timezone on public.tenants
  for each row execute function public.validate_tenant_timezone();

-- ---------------------------------------------------------------------------
-- 2. The three daily views
--
-- Each gains a join to tenants for the zone. tenants holds one row per shop,
-- so this is a lookup, not a scan. security_invoker is carried over — losing
-- it here would reopen the cross-tenant leak 20260906000200 closed.
-- ---------------------------------------------------------------------------

create or replace view public.v_sales_daily
with (security_invoker = on) as
  select
    s.tenant_id,
    (s.created_at at time zone t.timezone)::date as day,
    count(*) filter (where s.kind = 'sale') as transactions,
    count(*) filter (where s.kind = 'refund') as refunds,
    sum(s.total_cents) as revenue_cents,
    sum(s.tax_cents) as tax_cents,
    sum(s.discount_cents) as discount_cents,
    coalesce(sum(p.cash), 0::numeric) as cash_cents,
    coalesce(sum(p.mobile), 0::numeric) as mobile_money_cents,
    coalesce(sum(p.card), 0::numeric) as card_cents
  from public.sales s
  join public.tenants t on t.id = s.tenant_id
  left join lateral (
    select
      sum(sp.amount_cents) filter (where sp.method = 'cash') as cash,
      sum(sp.amount_cents) filter (where sp.method = 'mobile_money') as mobile,
      sum(sp.amount_cents) filter (where sp.method = 'card') as card
    from public.sale_payments sp
    where sp.sale_id = s.id
  ) p on true
  where s.status = 'completed'
  group by s.tenant_id, ((s.created_at at time zone t.timezone)::date);

create or replace view public.v_product_performance
with (security_invoker = on) as
  select
    si.tenant_id,
    si.product_id,
    p.name,
    p.category_id,
    (s.created_at at time zone t.timezone)::date as day,
    sum(si.quantity) as units,
    sum(si.line_total_cents) as revenue_cents,
    sum(si.line_total_cents)
      - sum(round(si.quantity * si.unit_cost_cents::numeric))::bigint as margin_cents
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  join public.products p on p.id = si.product_id
  join public.tenants t on t.id = si.tenant_id
  where s.status = 'completed'
  group by si.tenant_id, si.product_id, p.name, p.category_id,
           ((s.created_at at time zone t.timezone)::date);

create or replace view public.v_cashier_performance
with (security_invoker = on) as
  select
    s.tenant_id,
    s.cashier_id,
    u.name as cashier_name,
    (s.created_at at time zone t.timezone)::date as day,
    count(*) as transactions,
    sum(s.total_cents) as revenue_cents,
    count(*) filter (where s.status = 'voided') as voids
  from public.sales s
  join public.tenants t on t.id = s.tenant_id
  left join public.users u on u.id = s.cashier_id
  group by s.tenant_id, s.cashier_id, u.name,
           ((s.created_at at time zone t.timezone)::date);

-- ---------------------------------------------------------------------------
-- 3. "Today" for the shop
--
-- v_profit_daily joins margin (from v_product_performance, now the shop's
-- local day) against expenses (from spent_on, which was always a local day
-- the owner typed). Those two were on different bases until now; they agree
-- from here.
-- ---------------------------------------------------------------------------

create or replace function public.current_shop_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select t.timezone from public.tenants t where t.id = public.current_tenant_id()),
    'UTC'))::date
$$;

comment on function public.current_shop_date is
  'Today where the shop is. The date every "is this in the future" check and '
  'every default date should be measured against, rather than the server''s '
  'own idea of today.';

revoke all on function public.current_shop_date() from public;
grant execute on function public.current_shop_date() to authenticated;

-- record_expense() carried a one-day slack because it had no way to know the
-- shop's date and had to tolerate any offset. With the zone recorded it can
-- ask directly, so the guard goes back to being exact: a date after the shop's
-- own today is a typo, and nothing else.
create or replace function public.record_expense(
  p_category    public.expense_category,
  p_amount_cents bigint,
  p_spent_on    date default null,
  p_note        text default null,
  p_location_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_today date := public.current_shop_date();
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can record expenses'
      using errcode = 'PS403';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'An expense must be more than zero' using errcode = 'PS422';
  end if;

  if coalesce(p_spent_on, v_today) > v_today then
    raise exception 'An expense cannot be dated in the future'
      using errcode = 'PS422';
  end if;

  insert into public.expenses
    (tenant_id, location_id, category, amount_cents, note, spent_on, created_by)
  values (
    public.current_tenant_id(),
    p_location_id,
    p_category,
    p_amount_cents,
    nullif(btrim(p_note), ''),
    coalesce(p_spent_on, v_today),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_expense(public.expense_category, bigint, date, text, uuid) from public;
grant execute on function public.record_expense(public.expense_category, bigint, date, text, uuid) to authenticated;


-- =========================================================================
--  20260908000100_pin_hash_revoke_anon.sql
-- =========================================================================

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


-- =========================================================================
--  20260908000200_report_stats_location_scope.sql
-- =========================================================================

-- weekly_report_stats() ignored location isolation.
--
-- 20260817000200 scoped every table that carries a location, so a cashier
-- pinned to one shop can no longer read another's takings from public.sales.
-- This function walked straight past that: it is SECURITY DEFINER, so RLS does
-- not apply to it at all, and every figure it built was a whole-tenant
-- aggregate. Any signed-in staff member could call
--
--     /rest/v1/rpc/weekly_report_stats
--
-- and read the revenue, basket count and top movers of every location in the
-- business, including ones their own policies refuse them row by row.
--
-- The /reports/weekly page does hide itself from warehouse staff, but
-- nav-items.ts is explicit that this is "presentation, not enforcement" — the
-- RPC is reachable whether or not the page links to it. The tenant guard below
-- was already right and is untouched; what was missing was the location half.
--
-- The fix is can_see_location() on each subquery that reads sales. That
-- function is `current_location_id() is null or current_location_id() = $1`,
-- so it is true for everyone unpinned — an owner sees the whole business
-- exactly as before, and the emailed digest, which runs as service_role with
-- no JWT and therefore no location, is likewise unchanged.
--
-- WHAT IS DELIBERATELY STILL ORG-WIDE
-- dead_stock_30d reads v_dead_stock, which is product-level: it has no
-- location column because it reports products.stock_on_hand and cost. That
-- matches the line 20260817000200 already drew — "products, categories,
-- product_images. Catalog is org-wide by design" — so it is left alone rather
-- than half-scoped against a column that does not exist.
--
-- WHY top_5_movers IS REWRITTEN RATHER THAN FILTERED
-- It read v_product_performance, which is grouped by (tenant, product, day)
-- and carries no location_id. Adding one would have changed that view's grain
-- for every other consumer — v_profit_daily, the dashboard and the analytics
-- page all read it — so the movers are computed here from sale_items instead,
-- where the sale's own location_id is in reach. No view changes; nothing else
-- that reads v_product_performance is affected.
--
-- WHILE HERE: the week boundaries now honour the shop's timezone.
-- 20260907000100 moved every daily figure onto the shop's own day, but this
-- function still compared a timestamptz against a bare date, which buckets by
-- UTC. That was invisible while every tenant sat on the UTC default and turns
-- into real misplacement the moment one does not: at UTC+3 a sale rung at
-- 01:00 on Monday falls into the previous week's report.

set search_path = public, extensions;

create or replace function public.weekly_report_stats(
  p_tenant_id uuid,
  p_week_end  date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tenant     public.tenants;
  v_this_start date := p_week_end - 7;
  v_last_start date := p_week_end - 14;
  v_tz         text;
  v_result     jsonb;
begin
  -- Unchanged: one shop cannot ask for another's week.
  if p_tenant_id is distinct from public.current_tenant_id()
     and auth.role() <> 'service_role' then
    raise exception 'Not permitted for this tenant' using errcode = 'PS403';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  v_tz := coalesce(v_tenant.timezone, 'UTC');

  select jsonb_build_object(
    'shop_name', v_tenant.name,
    'currency',  v_tenant.currency,

    'revenue_this_week', coalesce((
      select sum(s.total_cents) from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
    ), 0),

    'revenue_last_week', coalesce((
      select sum(s.total_cents) from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_last_start
        and (s.created_at at time zone v_tz)::date <  v_this_start
    ), 0),

    'transactions_this_week', coalesce((
      select count(*) from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
    ), 0),

    -- Same figures v_product_performance would have given, restricted to the
    -- locations the caller is allowed to see.
    'top_5_movers', coalesce((
      select jsonb_agg(t) from (
        select p.name,
               sum(si.quantity)         as units,
               sum(si.line_total_cents) as revenue
        from public.sale_items si
        join public.sales s    on s.id = si.sale_id
        join public.products p on p.id = si.product_id
        where si.tenant_id = p_tenant_id and s.status = 'completed'
          and public.can_see_location(s.location_id)
          and (s.created_at at time zone v_tz)::date >= v_this_start
          and (s.created_at at time zone v_tz)::date <  p_week_end
        group by p.name
        order by sum(si.line_total_cents) desc
        limit 5
      ) t
    ), '[]'::jsonb),

    -- Product-level and intentionally org-wide; see the migration header.
    'dead_stock_30d', coalesce((
      select jsonb_agg(t) from (
        select name, stock_on_hand, days_since_last_sale
        from public.v_dead_stock
        where tenant_id = p_tenant_id
        order by tied_up_cents desc
        limit 5
      ) t
    ), '[]'::jsonb),

    -- v_low_stock is per location, so this one can be scoped directly.
    'low_stock_alerts', coalesce((
      select jsonb_agg(t) from (
        select name, stock_on_hand, reorder_point
        from public.v_low_stock
        where tenant_id = p_tenant_id
          and public.can_see_location(location_id)
        order by stock_on_hand
        limit 10
      ) t
    ), '[]'::jsonb),

    'busiest_day', (
      select to_char(s.created_at at time zone v_tz, 'FMDay')
      from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
      group by to_char(s.created_at at time zone v_tz, 'FMDay')
      order by sum(s.total_cents) desc
      limit 1
    ),

    'busiest_hour', (
      select extract(hour from s.created_at at time zone v_tz)::integer
      from public.sales s
      where s.tenant_id = p_tenant_id and s.status = 'completed'
        and public.can_see_location(s.location_id)
        and (s.created_at at time zone v_tz)::date >= v_this_start
        and (s.created_at at time zone v_tz)::date <  p_week_end
      group by extract(hour from s.created_at at time zone v_tz)
      order by count(*) desc
      limit 1
    )
  ) into v_result;

  return v_result;
end;
$fn$;

comment on function public.weekly_report_stats(uuid, date) is
  'Weekly digest figures. SECURITY DEFINER, so it enforces both halves of '
  'access itself: the tenant guard raises PS403 for another shop, and '
  'can_see_location() keeps a location-pinned caller to their own takings - '
  'RLS cannot do it here because a definer function bypasses it. Unpinned '
  'callers (owners, and service_role for the emailed digest) are unaffected. '
  'Buckets by the shop timezone, not UTC.';

-- 20260728000900 already revoked this from anon; the grants survive
-- create-or-replace, and are restated only so a fresh read of this file shows
-- who can call it.
revoke all on function public.weekly_report_stats(uuid, date) from public;
grant execute on function public.weekly_report_stats(uuid, date) to authenticated, service_role;


-- =========================================================================
--  20260909000100_secondary_currency.sql
-- =========================================================================

-- Take payment in a second currency: the shilling at the counter.
--
-- A shop in Hargeisa prices in dollars and is handed Somaliland shillings. One
-- in Mogadishu may price in dollars and take Somali shillings. The books want
-- one currency; the drawer holds another. Until now this product had room for
-- only the first of those.
--
-- WHAT THIS DOES NOT DO
-- It does not make the ledger multi-currency. Every price, sale total, report
-- and margin stays in `tenants.currency`, and `sale_payments.amount_cents` is
-- still that currency. Multi-currency accounting is a different and much
-- larger thing, and getting it half-right would corrupt every figure the shop
-- relies on.
--
-- What it adds is a second currency for *settlement*: the rate the shop is
-- trading at today, so the till can tell a cashier how many shillings to
-- collect and how much to give back, and a record on each payment of what
-- physically changed hands and at what rate.
--
-- WHY THE RATE IS STORED PER PAYMENT
-- The rate moves. The Somaliland shilling has run at several thousand to the
-- dollar and does not hold still, so a rate read from `tenants` a month later
-- will not reprice last month's sale. Storing it on the row is what lets a
-- drawer be reconciled against the day it was actually counted.
--
-- WHY A MANAGER MAY SET IT AND THE tenants POLICY IS UNTOUCHED
-- The rate is a daily number, often set before opening; making it owner-only
-- would mean a shop cannot trade until the owner wakes up. But UPDATE on
-- `tenants` is deliberately owner-only — that is what stops a manager editing
-- the tax rate — so widening the policy to let a manager in would hand them
-- every other setting on the row as well. Hence set_exchange_rate(): one
-- SECURITY DEFINER function that writes exactly two columns and nothing else.
--
-- ON THE CODE `SLS`
-- The Somaliland shilling has no ISO 4217 code; Somaliland is not a UN member.
-- `SLSH`, which is what a price list says, is four letters, and
-- `Intl.NumberFormat` throws RangeError on anything that is not three — so a
-- stored "SLSH" would break every screen in the app that formats money, and it
-- does not fit char(3) either. The stored code is `SLS`, the unofficial
-- three-letter code, displayed as `SLSH`. See packages/shared/src/money.ts.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The shop's trading rate
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column if not exists secondary_currency char(3),
  add column if not exists exchange_rate numeric(18,6),
  add column if not exists exchange_rate_updated_at timestamptz;

-- Major units of secondary per one major unit of `currency` — the number on a
-- bureau board ("1 USD = 8,500 SLSH"), not a minor-unit ratio. Anything else
-- would need every reader to know both exponents to make sense of it.
comment on column public.tenants.exchange_rate is
  'Major units of secondary_currency per 1 major unit of currency, as an owner '
  'would read it off a board. Null when the shop takes only its own currency.';

do $$
begin
  -- A rate without a currency is meaningless and a currency without a rate
  -- cannot be converted, so the pair travels together or not at all.
  if not exists (select 1 from pg_constraint where conname = 'tenants_secondary_currency_pair') then
    alter table public.tenants add constraint tenants_secondary_currency_pair check (
      (secondary_currency is null and exchange_rate is null)
      or (secondary_currency is not null and exchange_rate is not null and exchange_rate > 0)
    );
  end if;

  -- Settling in the currency you already price in is not a second currency,
  -- and would make the till offer the same money twice.
  if not exists (select 1 from pg_constraint where conname = 'tenants_secondary_currency_distinct') then
    alter table public.tenants add constraint tenants_secondary_currency_distinct check (
      secondary_currency is null or secondary_currency <> currency
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. What actually crossed the counter
-- ---------------------------------------------------------------------------

alter table public.sale_payments
  add column if not exists paid_currency char(3),
  add column if not exists paid_amount_minor bigint,
  add column if not exists fx_rate numeric(18,6);

comment on column public.sale_payments.paid_amount_minor is
  'What the customer settled this tender with, in paid_currency minor units. '
  'amount_cents remains the shop-currency figure and is what every report '
  'reads; this column exists so the drawer can be counted in the money it '
  'actually holds.';

do $$
begin
  -- All three or none. A currency with no amount cannot be reconciled, and an
  -- amount with no rate cannot be checked against the day's board.
  if not exists (select 1 from pg_constraint where conname = 'sale_payments_fx_complete') then
    alter table public.sale_payments add constraint sale_payments_fx_complete check (
      (paid_currency is null and paid_amount_minor is null and fx_rate is null)
      or (paid_currency is not null and paid_amount_minor is not null
          and fx_rate is not null and fx_rate > 0)
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Setting the rate, without handing over the rest of the row
-- ---------------------------------------------------------------------------

create or replace function public.set_exchange_rate(
  p_secondary_currency text,
  p_rate numeric
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role      text := public.current_shop_role();
  v_code      text := upper(nullif(btrim(coalesce(p_secondary_currency, '')), ''));
  v_row       public.tenants;
begin
  if v_tenant_id is null then
    raise exception 'Not signed in' using errcode = 'PS401';
  end if;

  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager may set the exchange rate'
      using errcode = 'PS403';
  end if;

  -- Clearing the pair is how a shop goes back to taking only its own money.
  if v_code is null then
    update public.tenants
    set secondary_currency = null,
        exchange_rate = null,
        exchange_rate_updated_at = now(),
        updated_at = now()
    where id = v_tenant_id
    returning * into v_row;
    return v_row;
  end if;

  if v_code !~ '^[A-Z]{3}$' then
    raise exception 'Currency code must be three letters (SLS, SOS, KES)'
      using errcode = 'PS422';
  end if;

  if p_rate is null or p_rate <= 0 then
    raise exception 'The exchange rate must be greater than zero'
      using errcode = 'PS422';
  end if;

  update public.tenants
  set secondary_currency = v_code,
      exchange_rate = p_rate,
      exchange_rate_updated_at = now(),
      updated_at = now()
  where id = v_tenant_id
  returning * into v_row;

  return v_row;
end;
$fn$;

comment on function public.set_exchange_rate(text, numeric) is
  'Sets the counter currency and today''s rate. SECURITY DEFINER because UPDATE '
  'on tenants is owner-only and the rate is a daily job a manager has to be '
  'able to do; it writes those two columns and nothing else, so it does not '
  'become a way for a manager to reach tax_rate or allow_oversell.';

revoke all on function public.set_exchange_rate(text, numeric) from public, anon;
grant execute on function public.set_exchange_rate(text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. process_sale carries the settlement details through
--
-- Only the sale_payments insert differs from the previous definition. The rest
-- is the live function body, extracted with pg_get_functiondef and left
-- untouched, so this cannot quietly change the arithmetic of a sale.
--
-- The new keys are optional: a caller that omits them — the mobile app, an
-- offline queue replaying yesterday's basket — writes NULLs and behaves
-- exactly as before.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_sale(p_client_id text, p_items jsonb, p_payment_method payment_method, p_discount_cents integer DEFAULT 0, p_created_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text, p_shift_id uuid DEFAULT NULL::uuid, p_payments jsonb DEFAULT NULL::jsonb, p_location_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid)
 RETURNS sales
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant_id   uuid := public.current_tenant_id();
  v_uid         uuid := auth.uid();
  v_cashier     uuid;
  v_location    uuid := coalesce(p_location_id, public.default_location_id());
  v_tenant      public.tenants;
  v_sale        public.sales;
  v_item        jsonb;
  v_product     public.products;
  v_on_hand     numeric(14,3);
  v_qty         numeric(14,3);
  v_unit_price  integer;
  v_line_total  integer;
  v_subtotal    integer := 0;
  v_taxable     integer;
  v_tax         integer;
  v_total       integer;
  v_oversell    boolean := false;
  v_lines       jsonb := '[]'::jsonb;
  v_paid        integer;
  v_method      public.payment_method;
  v_shift       public.shifts;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;
  if v_location is null then
    raise exception 'This shop has no location set up' using errcode = 'PS422';
  end if;

  -- A caller may name any active staff member in their own shop, and nobody
  -- outside it. Falling back to the session's own user keeps existing callers
  -- working unchanged.
  if p_cashier_id is not null then
    select id into v_cashier from public.users
    where id = p_cashier_id and tenant_id = v_tenant_id and is_active;
    if not found then
      raise exception 'That cashier is not on this shop''s staff' using errcode = 'PS404';
    end if;
  else
    v_cashier := v_uid;
  end if;

  select * into v_sale
  from public.sales
  where tenant_id = v_tenant_id and client_id = p_client_id;

  if found then
    return v_sale;
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A sale needs at least one line' using errcode = 'PS422';
  end if;

  if p_shift_id is not null then
    select * into v_shift from public.shifts
    where id = p_shift_id and tenant_id = v_tenant_id;
    if not found then
      raise exception 'Shift not found' using errcode = 'PS404';
    end if;
    if v_shift.status <> 'open' then
      raise exception 'That shift is closed - open a new one' using errcode = 'PS405';
    end if;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items) as t(value)
    order by (value ->> 'product_id')::uuid
  loop
    v_qty        := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unit_price_cents')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line quantity must be positive' using errcode = 'PS422';
    end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid and tenant_id = v_tenant_id;

    if not found then
      raise exception 'Product % is not in this shop', v_item ->> 'product_id'
        using errcode = 'PS404';
    end if;

    select ls.on_hand into v_on_hand
    from public.location_stock ls
    where ls.location_id = v_location and ls.product_id = v_product.id
    for update;

    v_on_hand := coalesce(v_on_hand, 0);

    if v_unit_price is null then
      v_unit_price := v_product.price_cents;
    end if;

    if v_on_hand - v_qty < 0 then
      if not v_tenant.allow_oversell then
        raise exception 'Only % of "%" left here', v_on_hand, v_product.name
          using errcode = 'PS422', detail = v_product.id::text;
      end if;
      v_oversell := true;
    end if;

    v_line_total := round(v_qty * v_unit_price)::integer;
    v_subtotal   := v_subtotal + v_line_total;

    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_product.id,
      'quantity',         v_qty,
      'unit_price_cents', v_unit_price,
      'line_total_cents', v_line_total,
      'name_at_sale',     v_product.name,
      'unit_cost_cents',  v_product.cost_cents
    );
  end loop;

  p_discount_cents := least(greatest(coalesce(p_discount_cents, 0), 0), v_subtotal);
  v_taxable := v_subtotal - p_discount_cents;

  if v_tenant.tax_inclusive then
    v_tax   := round(v_taxable * v_tenant.tax_rate / (1 + v_tenant.tax_rate))::integer;
    v_total := v_taxable;
  else
    v_tax   := round(v_taxable * v_tenant.tax_rate)::integer;
    v_total := v_taxable + v_tax;
  end if;

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    select coalesce(sum((e ->> 'amount_cents')::integer), 0) into v_paid
    from jsonb_array_elements(p_payments) as t(e);

    if v_paid <> v_total then
      raise exception 'Payments total % but the sale is %', v_paid, v_total
        using errcode = 'PS422';
    end if;

    if jsonb_array_length(p_payments) = 1 then
      v_method := (p_payments -> 0 ->> 'method')::public.payment_method;
    else
      v_method := 'mixed';
    end if;
  else
    v_method := coalesce(p_payment_method, 'cash');
  end if;

  insert into public.sales (
    tenant_id, location_id, cashier_id, client_id, shift_id, kind,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    payment_method, tax_inclusive, has_oversell, note, created_at
  )
  values (
    v_tenant_id, v_location, v_cashier, p_client_id, p_shift_id, 'sale',
    v_subtotal, p_discount_cents, v_tax, v_total,
    v_method, v_tenant.tax_inclusive, v_oversell, p_note,
    coalesce(p_created_at, now())
  )
  returning * into v_sale;

  insert into public.sale_items (
    tenant_id, sale_id, product_id, quantity,
    unit_price_cents, line_total_cents, name_at_sale, unit_cost_cents
  )
  select v_tenant_id, v_sale.id, l.product_id, l.quantity,
         l.unit_price_cents, l.line_total_cents, l.name_at_sale, l.unit_cost_cents
  from jsonb_to_recordset(v_lines) as l(
    product_id uuid, quantity numeric, unit_price_cents integer,
    line_total_cents integer, name_at_sale text, unit_cost_cents integer
  );

  -- A sale can legitimately come to nothing: a zero-priced line (a carrier bag
  -- rung up so stock still moves) or a discount that cancels the whole basket
  -- (on the house, a staff meal, a damaged item written off). Those still need
  -- to be recorded, because the stock movement and the audit trail are the
  -- point of ringing them up at all.
  --
  -- What they must not do is write a payment row. sale_payments checks
  -- amount_cents <> 0, deliberately — zero is not a tender, and a row saying
  -- someone paid nothing is noise in every report that reads the table. Before
  -- this, the fallback below inserted v_total unconditionally, so both cases
  -- died on that constraint and the cashier got a raw Postgres error in the
  -- middle of a checkout.
  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    insert into public.sale_payments (
      tenant_id, sale_id, method, amount_cents, tendered_cents, reference,
      paid_currency, paid_amount_minor, fx_rate
    )
    select v_tenant_id, v_sale.id,
           (e ->> 'method')::public.payment_method,
           (e ->> 'amount_cents')::integer,
           nullif(e ->> 'tendered_cents', '')::integer,
           nullif(e ->> 'reference', ''),
           -- Absent on every existing caller, and on any tender settled in the
           -- shop's own money. Present only when the cash that crossed the
           -- counter was a different currency.
           upper(nullif(e ->> 'paid_currency', '')),
           nullif(e ->> 'paid_amount_minor', '')::bigint,
           nullif(e ->> 'fx_rate', '')::numeric
    from jsonb_array_elements(p_payments) as t(e)
    -- A split-tender payload can carry a zero leg for a method the cashier
    -- opened and left empty. It is not a payment either.
    where (e ->> 'amount_cents')::integer <> 0;
  elsif v_total <> 0 then
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents)
    values (v_tenant_id, v_sale.id, v_method, v_total);
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, delta, reason, reference_id, created_by
  )
  select v_tenant_id, v_location, l.product_id, -l.quantity, 'sale', v_sale.id, v_cashier
  from jsonb_to_recordset(v_lines) as l(product_id uuid, quantity numeric);

  return v_sale;

exception
  when unique_violation then
    select * into v_sale from public.sales
    where tenant_id = v_tenant_id and client_id = p_client_id;
    if found then
      return v_sale;
    end if;
    raise;
end;
$function$;


comment on function public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb, uuid, uuid) is
  'Rings up a sale. Idempotent on client_id. p_payments entries may carry '
  'paid_currency/paid_amount_minor/fx_rate to record settlement in a second '
  'currency; amount_cents stays the shop-currency figure regardless, so every '
  'total and report is unaffected by how the customer chose to pay.';

-- =========================================================================
--  Tell the CLI these have run.
--
--  supabase_migrations.schema_migrations is how `supabase db push` knows what
--  is already applied. Guarded because that table only exists in a project
--  managed by the Supabase CLI; on a plain Postgres this is skipped.
-- =========================================================================

do $mig$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260904000100', 'protect_pin_hash') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260905000100', 'staff_pin_admin') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260905000200', 'expenses') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260906000100', 'zero_total_sales') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260906000200', 'views_security_invoker') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260906000300', 'expense_date_timezone') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260907000100', 'shop_timezone') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260908000100', 'pin_hash_revoke_anon') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260908000200', 'report_stats_location_scope') on conflict (version) do nothing;
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20260909000100', 'secondary_currency') on conflict (version) do nothing;
  end if;
end
$mig$;

commit;

-- =========================================================================
--  Done. Now run verification/production_check_editor.sql - every row should
--  read PASS, except "Shop timezones set", which reads REVIEW until you set
--  the shop's timezone in Settings -> Shop details.
-- =========================================================================
