import { missingSupabaseVars } from "@/lib/supabase/config";

/**
 * What a deployment with no database should say.
 *
 * The alternative — and what this app did until now — was to let
 * createClient() throw inside a server component, which Next turns into a
 * digest and error.tsx renders as "Something went wrong. An unexpected error
 * occurred." That is true and useless. Nothing about it suggests the cause is
 * two unset environment variables, so the obvious next move is to go looking
 * for a bug in the app.
 *
 * Naming the variables costs nothing: they are the names of settings, not the
 * settings themselves, and the anon key they refer to is public by design and
 * protected by RLS. The service-role key is never involved here.
 *
 * The redeploy line is the part people actually get stuck on. Next inlines
 * NEXT_PUBLIC_* at build time, so adding them in a hosting dashboard changes
 * nothing until something rebuilds — the app keeps showing this screen and it
 * looks as though the settings did not save.
 */
export function SetupRequired() {
  const missing = missingSupabaseVars();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          AI POS
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          This deployment isn&apos;t connected to a database yet
        </h1>
        <p className="text-sm text-muted-foreground">
          The app built and started fine — it just has nowhere to read or write data,
          so there is nothing it can show you.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">
          {missing.length === 1 ? "Missing variable" : "Missing variables"}
        </h2>
        <ul className="mt-3 space-y-1.5">
          {missing.map((name) => (
            <li key={name} className="font-mono text-xs break-all text-foreground">
              {name}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Both values are on your Supabase project page under{" "}
          <span className="font-medium text-foreground">Settings → API</span>. Use the
          project URL and the <span className="font-medium text-foreground">anon</span>{" "}
          key — never the service-role key, which must not reach a browser.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Then redeploy</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Saving the variables is not enough on its own. Values beginning{" "}
          <span className="font-mono text-xs">NEXT_PUBLIC_</span> are compiled into the
          build, so the running one cannot pick them up — trigger a new deployment and
          this screen will be replaced by the sign-in page.
        </p>
      </div>
    </main>
  );
}
