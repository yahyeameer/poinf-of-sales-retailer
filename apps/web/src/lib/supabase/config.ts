/**
 * Whether this deployment has been given a database, and if not, which
 * variables are missing.
 *
 * This exists because the app had two different opinions on the subject.
 * `middleware.ts` treated missing configuration as "carry on" and let the
 * request through; `server.ts`'s createClient() treated it as fatal and threw.
 * The result was that a Vercel deploy without the Supabase variables set
 * passed the middleware, reached a page, threw inside getTenantContext(), and
 * rendered the error boundary — so the whole diagnosis a developer needed
 * ("you didn't set NEXT_PUBLIC_SUPABASE_URL") was delivered as:
 *
 *   Something went wrong
 *   An unexpected error occurred while processing your request.
 *
 * One module, one answer, and the answer names the variables.
 *
 * The literal `process.env.X` reads matter and must not be refactored into
 * dynamic lookups: Next inlines NEXT_PUBLIC_* at build time by textual
 * substitution, so `process.env[name]` would evaluate to undefined in a
 * production bundle even when the variable is set.
 */

export interface SupabaseConfig {
  url: string;
  key: string;
}

const VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

/** The names of the variables that still need setting. Empty means configured. */
export function missingSupabaseVars(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push(VARS[0]);
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push(VARS[1]);
  return missing;
}

export function isSupabaseConfigured(): boolean {
  return missingSupabaseVars().length === 0;
}

/** Config, or null. Never throws — callers decide what an unconfigured
 *  deployment should look like, and for most of them that is not a crash. */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

/**
 * Thrown by createClient(), which genuinely cannot do its job without config.
 *
 * A named class rather than a bare Error so callers can tell "this deployment
 * was never set up" apart from "Supabase is having a bad minute" — the two
 * need different messages, and only one of them is worth retrying.
 */
export class SupabaseNotConfiguredError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Supabase is not configured. Missing: ${missing.join(", ")}. ` +
        `Set these in your hosting provider's environment variables and redeploy — ` +
        `NEXT_PUBLIC_* values are baked in at build time, so an existing build will ` +
        `not pick them up.`,
    );
    this.name = "SupabaseNotConfiguredError";
    this.missing = missing;
  }
}
