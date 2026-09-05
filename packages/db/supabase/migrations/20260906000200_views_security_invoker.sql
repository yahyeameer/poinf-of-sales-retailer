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
