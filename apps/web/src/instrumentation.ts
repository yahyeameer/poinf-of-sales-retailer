import * as Sentry from "@sentry/nextjs";

/**
 * Next calls this once per server process, before the first request.
 *
 * The two runtimes are imported dynamically and separately because they are
 * genuinely different builds: the edge one cannot use Node APIs, and importing
 * the Node one into an edge bundle fails at build time rather than at runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Server-side errors that never reach a client error boundary.
 *
 * This is the hook that matters most for this app. A throw inside a server
 * component or a server action — a failed RPC in completeSale, a Supabase
 * outage during a stocktake — is caught by Next and turned into a digest
 * before any React boundary sees it. Without this the whole class of error
 * that actually breaks a shop's day is invisible.
 *
 * The digest it reports is the same string error.tsx shows the user, so a
 * cashier reading a code off a screen and an event in Sentry can be matched
 * up without asking them to describe what happened.
 */
export const onRequestError = Sentry.captureRequestError;
