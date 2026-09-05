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
