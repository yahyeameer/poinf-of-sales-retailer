# Offline sync

The hardest fortnight of the build, and the one thing that must not be cut.
A shop whose till stops when the network does is not a till.

## Three rules

1. **A sale is committed locally before any network call.** The customer has
   already paid. The network does not get a vote.
2. **Every sale carries a `client_id` from birth.** The server is idempotent on
   `(tenant_id, client_id)`, so retrying is always safe — which is what makes
   rule 1 workable.
3. **A rejected sale is flagged, never deleted.** A shop losing money without
   knowing it did is the one failure mode worth real paranoia about.

## Write path

```
cashier taps Charge
  └─ SQLite transaction:
       insert into pending_sales (status='pending')
       insert into local_stock_deltas
       decrement products.stock_on_hand   ← optimistic
  └─ return to UI immediately
  └─ (background) drainQueue()
       └─ POST /functions/v1/process-sale  { sales: [...] }   ← batched
            └─ per sale: process_sale() RPC
                 ├─ (tenant_id, client_id) already exists? return it, done
                 ├─ lock product rows in product_id order
                 ├─ insufficient stock and shop disallows oversell? raise PS422
                 └─ insert sale + sale_items + stock_movements, one transaction
       └─ on ok:  mark synced, drop the optimistic delta
       └─ on network error: back to 'pending', attempts++
       └─ on PS422/PS404: mark 'rejected', surface to the owner
```

Products are locked in `product_id` order. Two cashiers ringing up the same two
products in opposite order deadlock otherwise, and on a shared phone in a busy
shop that is not hypothetical.

The batch is sent in one request, sequentially processed server-side. A device
that has been offline all day arrives with forty sales; forty round trips on bad
4G is much worse than one. They are *processed* one at a time because they
contend for the same row locks — concurrency there buys nothing but contention.

## Read path

- **On login:** full catalog pull, paged at 1000 rows.
- **While open:** realtime subscription on `products` filtered by `tenant_id`.
- **Every 5 minutes:** incremental pull on `updated_at`.

The incremental pass is not redundant with realtime. A phone that was asleep or
out of coverage missed the websocket entirely.

Server stock overwrites local on every pull — the server is authoritative — and
then this device's unsynced deltas are re-applied on top. Without that second
step, a pull mid-queue makes sold stock reappear on the shelf.

## Conflict: oversell

Server wins. If another device already sold the last unit, `process_sale` raises
`PS422` and the sale is marked `rejected` locally, with the product id in the
error detail.

The sale still happened. Money changed hands. So it stays on the device, flagged,
until the owner reconciles — and the dashboard shows a banner counting sales that
went through on stock that wasn't there.

Shops that genuinely sell faster than they restock can set
`tenants.allow_oversell`, which records the sale with `has_oversell = true`
instead of rejecting it.

## Things that look like bugs and aren't

**Signing out with sales queued is refused.** Those rows are money that already
changed hands, and signing out would strand them behind a login screen.
`clearCatalogOnSignOut()` deliberately leaves `pending_sales` alone.

**Synced sales linger for seven days.** So a cashier can reprint a receipt from
a day they were offline. `pruneSyncedSales()` clears them after that.

**`attempts` caps at 12.** Past that a sale stops retrying on its own and moves
to the owner's problem list, rather than hammering a server that keeps saying no.

## Testing it

The seed exercises the real path — it posts every demo sale through
`process_sale()` as the `authenticated` role, then asserts the stock cache
matches the ledger. If the trigger or a policy regresses, `npm run db:reset`
fails.

What still needs coverage before this is trustworthy:

- [ ] Two devices, same last unit, simultaneous sync → exactly one `PS422`
- [ ] Kill the app mid-`drainQueue` → no duplicate on restart
- [ ] Same `client_id` posted twice concurrently → one sale, both callers agree
- [ ] Clock skew: device an hour behind → sale lands on the right report day
