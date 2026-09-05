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
