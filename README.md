# AI POS — point of sale for small retail

A barcode-first, vision-fallback, offline-first point of sale for shops with
200–3,000 SKUs, one shared Android phone, and unreliable internet.

Most free POS tiers put inventory behind a paywall or fall over without a
connection. This one keeps selling when the network drops, treats the stock
ledger as append-only truth, and recognises products by camera so you don't need
a barcode scanner.

**Status:** early. The schema, RLS policies and prompts are real; the apps are
shells. See [Build order](#build-order) for what lands when.

---

## What's here

```
apps/
  mobile/            Expo + React Native. The thing staff actually use.
  web/               Next.js dashboard. Reports, catalog, staff, CSV import.
packages/
  db/                Supabase project: migrations, RLS, edge functions, seed.
  prompts/           Versioned LLM prompts + typed loader. Never inline these.
  shared/            Types, zod schemas, money + cart logic used by both apps.
```

Design decisions and the reasoning behind them live in [`docs/`](docs/):
[architecture](docs/architecture.md), [offline sync](docs/offline-sync.md),
[recognition pipeline](docs/recognition.md).

---

## Deploy your own in 30 minutes

You need [Node 20+](https://nodejs.org), [Docker](https://docker.com) (for the
local stack), and a free [Supabase](https://supabase.com) account.

### 1. Clone and install

```bash
git clone https://github.com/yahyeameer/poinf-of-sales-retailer.git && cd poinf-of-sales-retailer && npm install
```

### 2. Start Postgres locally

```bash
npm run db:start
```

This boots the Supabase stack and applies every migration in
`packages/db/supabase/migrations`. It prints an API URL, an anon key and a
service-role key — you need all three next.

### 3. Configure

```bash
cp .env.example .env
```

Paste the three values from step 2 into `.env`. The anon key is safe to ship in
an app bundle; it is protected by Row-Level Security, not by secrecy. The
service-role key bypasses RLS entirely — server-side only, never in a client.

### 4. Seed a demo shop

```bash
npm run db:reset
```

Creates one tenant with 40 products, a barcode on most of them, and two weeks of
backdated sales, so the dashboard has something to draw. Login:
`owner@demo.shop` / `demo1234`, staff PIN `1234`.

### 5. Run

```bash
npm run dev
```

Web dashboard at http://localhost:3000. For the phone, `cd apps/mobile && npx expo start` — note it needs a
[development build](https://docs.expo.dev/develop/development-builds/introduction/),
not Expo Go, because barcode scanning and on-device inference are native modules.

### 6. Go to production

Create a project at [supabase.com](https://supabase.com), then:

```bash
npx supabase link --workdir packages/db --project-ref YOUR_PROJECT_REF && npm run db:push
```

Then enable the auth hook that puts `tenant_id` into the JWT — without it every
RLS policy denies every row and the app will look completely empty. In the
Supabase dashboard: **Authentication → Hooks → Customize Access Token (JWT)
Claims**, select `public.custom_access_token_hook`. Full notes in
[`docs/deploy.md`](docs/deploy.md).

---

## How it works, briefly

**Multi-tenancy** is row-level, single database. Every tenant table carries
`tenant_id uuid not null` and every policy compares it against the `tenant_id`
claim in the JWT. Schema-per-tenant means migrating thousands of schemas;
database-per-tenant is absurd economics for a $5/month customer.

**Stock truth is the ledger.** `stock_movements` is append-only;
`products.stock_on_hand` is a trigger-maintained cache. When the two disagree,
the ledger is right — `select public.recompute_stock_on_hand(tenant_id)` rebuilds
the cache from it.

**Sales are written locally first.** Each carries a device-generated `client_id`
that makes the server insert idempotent, so a retry after a dropped connection
can't double-charge. The server is authoritative on stock: if another device
already sold the last unit, the sale is flagged `oversold` and surfaced to the
owner rather than silently dropped.

**Recognition is barcode-first.** MLKit reads the barcode on-device against a
local SQLite mirror — no network call at all. Only when there's no barcode does
a CLIP embedding run on-device against the tenant's vectors (a 2,000-SKU shop is
about 4 MB), with cloud pgvector as backup when the local mirror is stale.

---

## Build order

Roughly a fortnight each, solo.

| | | |
|---|---|---|
| 1–2 | Schema, RLS, auth with tenant claim, app shells | ✅ |
| 3–4 | Product CRUD, CSV import, catalog, image upload | |
| 5–6 | Sale screen, barcode scan, cart, checkout, local mirror | |
| 7–8 | Sync queue, offline sales, stock ledger, void-last-sale | |
| 9 | CLIP pipeline, on-device inference, vision fallback | |
| 10 | Dashboard reports, staff management | |
| 11 | Thermal printer, WhatsApp receipts, weekly email | |
| 12 | Polish, error boundaries, Sentry, pilot shops | |

If it slips: cut vision recognition (barcode carries v1), cut the web dashboard
(mobile reports are enough), cut WhatsApp receipts. Don't cut offline sync,
stock ledger correctness, or RLS — those are the parts that are miserable to
retrofit.

**Not in v1:** payment processing, multi-location transfers, e-commerce, iOS,
loyalty, refunds beyond void-within-5-minutes, multi-currency.

---

## Contributing

The interesting problems are in `packages/db` (sync correctness) and
`apps/mobile/src/sync` (queue semantics). If you're adding a table, it needs
`tenant_id`, an RLS policy, and a line in `docs/architecture.md` — a table
without a policy is a data leak, and CI fails the build for it.

## License

[AGPL-3.0-or-later](LICENSE). Run it for your own shop, fork it, sell services
around it — but if you host a modified version for others, publish your changes.
Managed hosting and support are how this stays funded.
