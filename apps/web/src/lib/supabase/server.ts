import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SupabaseNotConfiguredError, missingSupabaseVars, supabaseConfig } from "./config";

/**
 * How long this request may spend on Supabase in total.
 *
 * A deadline for the whole client, not a timeout per fetch, and the difference
 * is the entire point. The original code gave each fetch its own 3s
 * AbortSignal, which looks like a 3s bound and is not one: supabase-js retries
 * a failed token refresh with exponential backoff, so against a project that
 * accepts connections and then never answers — a paused free-tier project, from
 * the client's side — a single page render made *thirteen* attempts and took 56
 * seconds. Raising the per-fetch number would have made that worse, not better.
 *
 * On Vercel, 56s is past the function limit on every plan below Pro, so the
 * visitor gets a gateway error no matter how gracefully the code handles it.
 * One signal created per client and shared by every fetch it makes bounds the
 * whole thing: retries inherit the same deadline instead of each starting a
 * fresh clock.
 *
 * 8s leaves room inside a 10s function limit for the render that follows.
 */
const SUPABASE_BUDGET_MS = 8_000;

/**
 * Supabase client for Server Components, route handlers and server actions.
 *
 * Always the anon key, never service-role. Every query from the dashboard goes
 * through RLS as the signed-in owner — the web app has no privileged read path
 * into the database, which is what keeps one careless `select *` from becoming
 * a cross-tenant leak.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const config = supabaseConfig();
  if (!config) throw new SupabaseNotConfiguredError(missingSupabaseVars());

  // Created here, once, so it is shared by every request this client makes.
  const deadline = AbortSignal.timeout(SUPABASE_BUDGET_MS);

  return createServerClient(config.url, config.key, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        return fetch(input, {
          ...init,
          // A caller's own signal still wins; it is combined with the deadline
          // rather than replaced by it, which is what the old `??` got wrong —
          // passing any signal silently removed the timeout altogether.
          signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
        });
      },
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: any[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
