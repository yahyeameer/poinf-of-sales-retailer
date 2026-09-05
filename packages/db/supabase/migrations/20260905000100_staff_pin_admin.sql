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
