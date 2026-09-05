# Applying these migrations to the hosted project

The hosted project (`ogzqtmfgadksuszajgla`) is production. There is no staging
project and no backup step in this repo, so it holds the only copy of real
sales, inventory, staff and customer data. Everything below is deliberately
small, ordered, and reversible up to the point noted.

This file exists because the migrations that close a **cross-tenant data leak**
are in the repo and not in production. Until they are applied, in the live
database:

- a **cashier can read the shop's wage bill** by selecting `v_expenses_daily`
  instead of `public.expenses`, and
- **one shop can read another shop's takings** through `v_profit_daily`.

Both were reproduced against a real Postgres before the fix, and the fix was
verified the same way.

## What is being applied

| Migration | What it does | Risk |
|---|---|---|
| `20260906000100_zero_total_sales` | A sale totalling zero (free item, 100% discount) no longer fails on a payment-row constraint | Replaces `process_sale`; only the payment block differs from the live definition |
| `20260906000200_views_security_invoker` | **The security fix.** Three views run as the caller, so RLS applies | `ALTER VIEW` only. No data touched |
| `20260906000300_expense_date_timezone` | Superseded by the next one; kept so the sequence applies in order | Replaces `record_expense` |
| `20260907000100_shop_timezone` | Adds `tenants.timezone` (default `'UTC'`), buckets the three daily views by the shop's day | Adds a column with a default; views rewritten |

**Nothing here drops a table, truncates, or deletes a row.** The only additive
change is one column with a default, so no existing figure moves until an owner
sets a timezone.

## Before

Run the read-only check and keep the output. It should show the leak present.

```bash
psql "$SUPABASE_DB_URL" -f packages/db/verification/production_check.sql
```

Expect section 1 to list `v_expenses_daily`, `v_profit_daily` and
`v_staff_pin_status`, and section 2 to show the migrations as `NO`.

## Apply

```bash
npm run db:push          # supabase db push --workdir packages/db
```

`db:push` targets the **linked hosted project**. That is what is wanted here
and is the reason this file spells it out — the same command is easy to run by
accident when meaning to touch local.

If the CLI is not linked yet:

```bash
supabase link --project-ref ogzqtmfgadksuszajgla --workdir packages/db
```

## After

```bash
psql "$SUPABASE_DB_URL" -f packages/db/verification/production_check.sql
```

Sections 1, 3, 4 and 5 must each print **no rows**. Section 2 must show every
migration as `YES`.

Then set the shop's timezone — section 6 lists what each is on. Either through
**Settings → Shop details → Time zone** in the app, or:

```sql
update public.tenants set timezone = 'Africa/Nairobi' where name = '<shop>';
```

An invalid name is rejected by a trigger rather than silently ignored, so a
typo cannot quietly put the shop back on UTC.

## If something looks wrong

`20260906000200` is the one that matters and is trivially reversible:

```sql
-- Only if a view genuinely misbehaves. This REOPENS the leak.
alter view public.v_expenses_daily set (security_invoker = off);
```

The timezone change reverts by setting the shop back to `'UTC'`, which restores
the previous bucketing exactly — that is what the default is, and there is a
check covering it (`verification/timezone.sql`, "on UTC, the Nairobi sale
reports on the 11th again").

`process_sale` and `record_expense` are `create or replace`; reverting either
means re-applying the previous definition from git history.

## Verifying behaviour, not just shape

`production_check.sql` reads catalog metadata. To exercise the actual
behaviour, the four scripts in `packages/db/verification/` run against any
database with the migrations applied — but they **write and roll back**, so
run them against local (`npm run db:reset` first), not against production.
