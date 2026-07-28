# Deploying to a real Supabase project

Local setup is in the [README](../README.md). This is the production path.

## 1. Link and push the schema

```bash
npx supabase link --workdir packages/db --project-ref YOUR_PROJECT_REF
```

```bash
npm run db:push
```

## 2. Enable the auth hook — do not skip this

**Authentication → Hooks → Customize Access Token (JWT) Claims**, select
`public.custom_access_token_hook`.

Without it there is no `tenant_id` claim, every RLS policy denies every row, and
the app renders as a working install with an empty shop. It looks like a data
problem and it isn't.

Verify by signing in and decoding the JWT — it should contain `tenant_id` and
`shop_role`.

## 3. Create the storage bucket

`product-images`, public read. The policies in the RLS migration expect object
paths of the form `<tenant_id>/<product_id>/<uuid>.jpg`; the first path segment
is what scopes the write.

## 4. Set the function secrets

```bash
npx supabase secrets set --workdir packages/db CLIP_API_URL=... CLIP_API_KEY=... ANTHROPIC_API_KEY=... RESEND_API_KEY=...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do
not set them by hand.

## 5. Deploy the functions

```bash
npx supabase functions deploy --workdir packages/db
```

`weekly-report` authenticates with the service-role key rather than a user
session. Schedule it with pg_cron:

```sql
select cron.schedule(
  'weekly-owner-report',
  '0 19 * * 0',
  $$select net.http_post(
      url     := 'https://YOUR_REF.supabase.co/functions/v1/weekly-report',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  )$$
);
```

## 6. Point the apps at it

Web — set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the
host's environment. The anon key is protected by RLS, not by secrecy; it is
meant to ship in the bundle. The service-role key is not, and must never appear
in an app.

Mobile — `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
`eas.json`. The app needs a development build, not Expo Go: barcode scanning and
on-device inference are native modules.

## Before letting a real shop on it

- [ ] `enable_confirmations = true` in `config.toml` once email delivery works
- [ ] Set `ALLOWED_ORIGIN` on the edge functions — the default is `*`
- [ ] Point-in-time recovery on. The stock ledger is the shop's books.
- [ ] Sentry in both apps
- [ ] Run `npm run db:lint` and clear the warnings
- [ ] Confirm a second shop's account genuinely cannot see the first one's rows.
      Do this by hand, with two real accounts, before anyone's takings depend on it.
