# Local verification scripts

Plain `psql` scripts used to check the purchasing migrations behave as intended.
They are **not** pgTAP and are deliberately not in `supabase/tests/`, which is
what `supabase test db` (`npm run test`) scans — these need no extension beyond
what the migrations already require, so they run against any Postgres 16 that
has the schema applied.

Each script acts as a real signed-in user: it sets `request.jwt.claims` and
`SET ROLE authenticated`, so RLS is live rather than bypassed. That is the point
of them — a check run as superuser proves nothing about a policy.

## Running them

Against the local Supabase stack:

```bash
npm run db:start
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f packages/db/verification/suppliers.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f packages/db/verification/purchase_orders.sql
```

They expect the seed data created by `npm run db:reset` to have been replaced by
the two-tenant fixture at the top of each file; read the header before running,
and never point them at the hosted project — they write.

## What they cover

`suppliers.sql`
- case-insensitive duplicate supplier names are rejected
- a restock records its supplier and the ledger trigger averages the cost
- the pre-existing five-argument `restock_product` call still resolves
- naming another tenant's supplier raises PS404, not a raw FK error
- suppliers are isolated per tenant
- a cashier may read suppliers but not write one
- `supplier_id` is refused on any movement that is not a restock

`purchase_orders.sql`
- `suggest_purchase_lines` drafts from what is under its reorder point
- references number sequentially per tenant (PO-0001, PO-0002)
- the same product twice on one order raises PS422
- partial receipt leaves the order `partial` with the balance outstanding
- over-receipt raises PS422 rather than being absorbed
- receiving the remainder moves it to `received`
- re-receiving a complete order raises PS405
- cancelling an order with stock against it raises PS405
- cancelling an untouched order works and is idempotent
- the ledger links back to both the order and the supplier
