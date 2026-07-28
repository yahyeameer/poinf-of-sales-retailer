# Architecture

## Multi-tenancy

Row-level security, single Postgres database. Every tenant-owned table carries
`tenant_id uuid not null`; every policy compares it against the `tenant_id`
claim in the JWT, resolved through `public.current_tenant_id()`.

The claim is minted by `public.custom_access_token_hook`, a Supabase auth hook
that runs on every token issue and refresh. This has one consequence that bites
during onboarding and nowhere else: **a token issued before the user had a shop
carries no `tenant_id`, so every policy denies every row.** After
`provision_tenant()`, the client must call `refreshSession()`. Skip it and the
owner sees an empty dashboard for a shop they just created.

Why not schema-per-tenant: migrating thousands of schemas, and a connection
pooler that has to care which one it's in. Why not database-per-tenant: absurd
economics at $5/month.

`current_tenant_id()` returns NULL when the claim is absent, and NULL never
equals a NOT NULL column. Policies fail closed.

## Tables

| Table | Notes |
|---|---|
| `tenants` | One shop. Currency, tax rate, tax-inclusive flag, plan, oversell policy. |
| `users` | Mirrors `auth.users`. `tenant_id` nullable only between signup and onboarding. |
| `categories` | Per tenant, unique by name. |
| `products` | `stock_on_hand` is a **cache**. `cost_cents` is a derived weighted average. |
| `product_images` | Paths into the `product-images` bucket, `<tenant>/<product>/<uuid>`. |
| `product_embeddings` | 512-dim CLIP vectors, L2-normalised, HNSW indexed. |
| `sales` | `client_id` is the device-generated idempotency key. |
| `sale_items` | Snapshots name and cost at sale time. |
| `stock_movements` | **Append-only. Source of truth for stock.** |

Adding a table means adding `tenant_id`, an RLS policy, and a row here. A table
without a policy is a data leak.

## Stock is a ledger

`stock_movements` is append-only, enforced by a trigger that rejects UPDATE and
DELETE — not merely by convention, because service-role code bypasses RLS and
would otherwise be one careless statement from destroying the audit trail.

`products.stock_on_hand` is a trigger-maintained cache of `sum(delta)`. When
they disagree, the ledger is right:

```sql
select public.recompute_stock_on_hand('<tenant-id>');
```

It returns the number of rows that were wrong. A healthy shop returns 0. The
seed asserts this, so `npm run db:reset` fails loudly if the trigger regresses.

Weighted average cost is recomputed on inbound restocks only — a sale must never
move the cost basis, or margin reporting becomes fiction. Negative on-hand is
clamped to zero in that calculation so an oversold product doesn't produce a
nonsensical average.

## Money and tax

Integer minor units everywhere. No float ever holds a price.

Shelf prices are tax-inclusive by default, which is the norm in the target
markets: `total = subtotal - discount`, and `tax_cents` is the component already
inside. Exclusive mode adds it on top. The two balance differently, so
`sales.tax_inclusive` snapshots the setting per sale and the
`sales_totals_balance` constraint branches on it.

`packages/shared/src/cart.ts` duplicates this arithmetic client-side so the cart
can show a total before the sale posts. **The two must agree**, including
rounding — Postgres `round()` breaks ties away from zero and `Math.round()`
breaks them toward +Infinity, hence `roundHalfAwayFromZero()`. There are tests.

## Roles

| | cashier | manager | owner |
|---|---|---|---|
| Read catalog, ring up sales | ✅ | ✅ | ✅ |
| Restock | ✅ | ✅ | ✅ |
| Product CRUD, categories | | ✅ | ✅ |
| Void a sale | own, ≤5 min | ✅ | ✅ |
| Staff, PINs, shop settings | | | ✅ |

Staff PINs are bcrypt-hashed, verified through a SECURITY DEFINER function so
`pin_hash` is never selectable by a client. The PIN does not authenticate
against the server — the device is already signed in as the shop. It picks who
is standing at the till so sales are attributed correctly. That is why four
digits is acceptable, and why a cashier can't change prices with one.

## What runs where

| Concern | Where | Why |
|---|---|---|
| Barcode read | On-device (MLKit) | Instant, offline, free |
| Embedding at intake | Edge function → CLIP API | Owner is online when adding stock |
| Vision match at checkout | On-device CLIP + local ANN | Must work offline, must be fast |
| Sale write | Local first, then sync | The network doesn't get a vote |
| Stock truth | Server ledger | Prevents overselling across devices |
| Reports | Server views | Aggregation across dates |

## Error codes

RPCs raise custom SQLSTATEs the clients branch on. See
`packages/shared/src/errors.ts`.

| Code | Meaning |
|---|---|
| `PS401` | Not authenticated / no shop on session |
| `PS403` | Not permitted for this role |
| `PS404` | Not found in this shop |
| `PS405` | Not allowed (append-only ledger, void window expired) |
| `PS409` | Conflict — already exists |
| `PS422` | Unprocessable — usually insufficient stock. DETAIL carries the product id. |
