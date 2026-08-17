# ai-pos

Turborepo monorepo: `apps/web` (Next.js 15), `apps/mobile` (Expo), `packages/{db,shared,prompts}`.

## Two databases — know which one you are touching

**Local** is disposable. `npm run db:reset` rebuilds it from `packages/db/supabase/migrations`
plus `seed.sql`; it holds no real data. Ports: 54320 shadow, 54321 API, 54322 Postgres,
54323 Studio, 54324 Inbucket, 54329 pooler. Reset it freely.

**Hosted** is production. Supabase project `ai-pos`, ref `ogzqtmfgadksuszajgla`. There is no
staging project, so this holds the only copy of real sales, inventory, staff and customer data.

The trap: several `supabase` CLI subcommands default to the **linked hosted** project when given
no target flag. `npm run db:push` is `supabase db push --workdir packages/db` — that pushes to
production, not to local. `npm run db:reset` is local-only and is safe.

Never run a migration or mutating SQL against `ogzqtmfgadksuszajgla` unless it was explicitly
asked for. Read-only inspection is fine.

Three things are off the table entirely against the hosted project, not merely gated: resetting
it (`supabase db reset --linked` and equivalents), `DROP TABLE`, and `TRUNCATE`. There is no
backup step here, so each is unrecoverable. Run them by hand outside Claude Code if genuinely
needed. `DELETE` of specific rows, `ALTER TABLE`, and dropping indexes/policies/functions/views
are still available — they just need to be asked for explicitly.

## Checks

`npm run build` and `npm run typecheck` are the real gates; both pass on this branch.

`npm run lint` is **broken on `main` and not worth chasing**: `apps/web` has no ESLint config and
no `eslint` dependency, so `next lint` drops into its interactive setup prompt and exits 1. Fixing
it means adding a config and deps, which is its own task — don't treat the failure as a regression.

## Secrets

Real keys live in gitignored `.env` / `.env.local`; only `.env.example` is tracked and it stays
placeholder-only. **The GitHub repo is public** (`github.com/yahyeameer/poinf-of-sales-retailer`),
so nothing but this repo's own work belongs in a commit. Supabase anon/publishable keys are
client-side by design and are not secrets; service-role keys and DB passwords are.
