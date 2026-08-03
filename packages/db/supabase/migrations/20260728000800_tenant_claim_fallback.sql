-- Make tenant resolution survive a missing auth hook.
--
-- The tenant_id claim is minted by custom_access_token_hook, which has to be
-- switched on per project (Authentication -> Hooks). Until someone does that,
-- every policy saw NULL, every query returned zero rows, and the app rendered a
-- blank dashboard with no error anywhere — the most expensive kind of failure,
-- because it looks like a bug in the app.
--
-- So: read the claim when it's there, fall back to a lookup when it isn't. The
-- hook is now a performance optimisation rather than a correctness requirement.
--
-- SECURITY DEFINER is load-bearing. This function is called *from* the RLS
-- policies on public.users; a plain function reading that table would re-enter
-- those policies and recurse until the stack blows.

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
  return (select u.tenant_id from public.users u where u.id = auth.uid());
end;
$$;

comment on function public.current_tenant_id() is
  'Tenant of the current request. Prefers the tenant_id JWT claim; falls back to '
  'a lookup when the auth hook is not enabled. NULL for anon and for a user with '
  'no shop, and NULL never matches a NOT NULL column, so policies fail closed.';

create or replace function public.current_shop_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim text;
begin
  v_claim := nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'shop_role',
    ''
  );

  if v_claim is not null then
    return v_claim;
  end if;

  return coalesce(
    (select u.role::text from public.users u where u.id = auth.uid() and u.is_active),
    'none'
  );
end;
$$;
