import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * A client that acts *as the calling user*, so every query still goes through
 * RLS. This is the default; reach for the service-role client only when a job
 * genuinely has no user behind it.
 */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/**
 * Bypasses RLS entirely. Only for work with no user context — the scheduled
 * weekly report, and writing embeddings back after the CLIP call. Every use
 * must scope its own queries by tenant_id by hand, because nothing else will.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Reads the tenant_id claim without a round trip to the auth server. */
export function tenantFromToken(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return decoded.tenant_id ?? null;
  } catch {
    return null;
  }
}
