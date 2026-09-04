/**
 * The parts of the Sentry setup that must be identical on the client, the
 * server and the edge runtime.
 *
 * Two things drive everything here.
 *
 * The first is that this must be inert without configuration. The DSN is read
 * from NEXT_PUBLIC_SENTRY_DSN, and when it is absent `Sentry.init` is simply
 * not called, so nothing is captured, nothing is queued, and no network request
 * is ever attempted. A developer cloning this repo, and a deployment that has
 * not signed up for Sentry, both behave exactly as they did before — no crash,
 * no warning, no dropped requests. Error monitoring you have to configure in
 * order to run the app is error monitoring people rip out.
 *
 * The second is that this app handles things that must never leave it. Staff
 * PINs are four to eight digits and are the only identity a cashier without a
 * login has. The till cashier cookie is httpOnly precisely so the browser
 * cannot nominate a cashier. Supabase auth tokens sit in cookies too. Sentry's
 * defaults do not send request bodies or cookies, but "the default is safe" is
 * not the same as "this cannot happen", so the scrubbing below is explicit and
 * runs on every event.
 */
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Whether monitoring is configured at all. */
export const sentryEnabled = Boolean(SENTRY_DSN);

/**
 * Sampling.
 *
 * Errors are always sent — a shop that loses a sale wants that seen the first
 * time, not one time in ten. Traces are sampled hard in production because a
 * till is used continuously all day and full tracing would be mostly repeated
 * evidence of the same working code path, at a cost the shop is paying for.
 */
export const TRACES_SAMPLE_RATE = process.env.NODE_ENV === "production" ? 0.1 : 1;

/** Anything whose *name* implies it carries a credential or an identity. */
const SENSITIVE_KEY = /(pin|password|secret|token|api[-_]?key|authorization|cookie|session)/i;

const REDACTED = "[redacted]";

/**
 * Strip values whose keys look sensitive, at any depth.
 *
 * Key-based rather than value-based: a PIN is four digits and there is no way
 * to recognise "4817" as a secret by looking at it, but there is every way to
 * recognise `pin`. Arrays and plain objects are walked; anything else is
 * returned untouched, so this cannot mangle an Error or a Date.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrub(v, depth + 1);
  }
  return out;
}

/** Query strings can carry a PIN even when no field is named one — a mistyped
 *  GET form, a copy-pasted URL. The path is what identifies the page; the
 *  query is not worth the risk. */
function scrubUrl(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?${REDACTED}`;
}

/**
 * Last gate before an event leaves the process.
 *
 * Runs on client, server and edge alike, so there is one place to audit rather
 * than three that have to agree.
 */
export function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      event.request.headers = scrub(event.request.headers) as Record<string, string>;
    }
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    if (event.request.query_string) event.request.query_string = REDACTED;
  }

  if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;

  // Breadcrumbs are the sneaky one: a fetch breadcrumb records the URL of every
  // request the page made, including any that carried a query string.
  event.breadcrumbs = event.breadcrumbs?.map((b) => ({
    ...b,
    data: b.data
      ? (scrub({
          ...b.data,
          ...(typeof b.data.url === "string" ? { url: scrubUrl(b.data.url) } : {}),
        }) as Record<string, unknown>)
      : b.data,
  }));

  return event;
}

/**
 * Noise that is not a bug.
 *
 * Every one of these is a browser or a network telling us about itself. Left
 * in, they bury the real report — and a monitoring dashboard nobody trusts is
 * one nobody opens.
 */
export const IGNORE_ERRORS = [
  // Navigating away mid-request, backgrounding a tab, flaky shop wifi. The
  // till is used on a phone in a building with thick walls; this is expected.
  "AbortError",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Load failed",
  // Browser extensions and injected scripts, not this app.
  "ResizeObserver loop completed with undelivered notifications",
  "ResizeObserver loop limit exceeded",
  "Non-Error promise rejection captured",
];
