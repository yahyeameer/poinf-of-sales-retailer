/**
 * Shared HTTP plumbing for the edge functions.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Postgres error codes raised by the RPCs, mapped to the HTTP status the client
 * expects. Anything unrecognised is a 500 — an unexpected database error is a
 * bug here, not a client mistake.
 */
const PG_STATUS: Record<string, number> = {
  PS401: 401,
  PS403: 403,
  PS404: 404,
  PS405: 405,
  PS409: 409,
  PS422: 422,
};

export function fromPostgresError(err: { code?: string; message?: string; detail?: string }): Response {
  const status = PG_STATUS[err.code ?? ""] ?? 500;
  return json(
    {
      error: err.message ?? "Unexpected error",
      code: err.code ?? "unknown",
      // For PS422 this carries the offending product id, so the app can point
      // at the right line in the cart rather than failing the whole sale opaquely.
      detail: err.detail,
    },
    status,
  );
}

/** Rejects anything that isn't a POST carrying a bearer token. */
export function requireAuthedPost(req: Request): { token: string } | Response {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing Authorization header" }, 401);

  return { token };
}
