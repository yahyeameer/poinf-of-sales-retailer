import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { withDeadline } from "@/lib/deadline";

import { supabaseConfig } from "./config";

/**
 * The middleware's share of the same budget (see server.ts for why this is one
 * deadline per client rather than a timeout per fetch).
 *
 * Tighter than the page budget deliberately: this runs before every single
 * request, so time spent here is added to everything, and the catch below
 * already treats a failed auth check as "let them through" rather than as an
 * error. Missing an auth check for one request when Supabase is unreachable
 * costs nothing — RLS still refuses every row.
 */
const AUTH_BUDGET_MS = 3_000;

// Exact matches, plus a prefix rule for the auth callback routes.
//
// This was a `startsWith` check over a list that included "/". Since every path
// starts with "/", every path counted as public and the redirect below never
// ran — the whole gate was dead. RLS still refused the data, so the pages
// rendered empty rather than leaking, but nobody was ever sent to sign in.
//
// "/monitoring" is Sentry's tunnel (tunnelRoute in next.config.mjs) — the
// endpoint the browser POSTs crash reports to. It has to be public, and for
// the least obvious reason on this list: the reports that matter most are the
// ones from a session that has no user, because "the login page threw" is
// precisely the failure nobody can tell you about. Left gated, those would be
// redirected to /login and lost.
const PUBLIC_PATHS = new Set(["/login", "/signup", "/monitoring"]);
const PUBLIC_PREFIXES = ["/auth/"];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = supabaseConfig();

  // Demo mode has to be switched on by whoever deploys the app, not by whoever
  // visits it. Previously `?demo=true` on any URL skipped the auth check and
  // set a permanent cookie, so one link turned the gate off for good — the same
  // shape as the PUBLIC_PATHS bug above, reached a different way. RLS still
  // refused every row, so nothing leaked, but the gate wasn't running.
  const demoAllowed = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const demoRequested =
    request.nextUrl.searchParams.get("demo") === "true" ||
    request.cookies.get("demo_mode")?.value === "true";

  // Nothing to check against. The setup screen in layout.tsx explains this to
  // whoever opens the app; redirecting to /login instead would just be a sign
  // in form with nothing behind it.
  if (!config) {
    return response;
  }

  if (demoAllowed && demoRequested) {
    if (request.nextUrl.searchParams.get("demo") === "true") {
      response.cookies.set("demo_mode", "true", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 8, // a working day, not forever
      });
    }
    return response;
  }

  // Someone carrying a stale demo cookie into a build where demo mode is off
  // should be signed in properly, not left in a half-state.
  if (!demoAllowed && request.cookies.get("demo_mode")) {
    response.cookies.delete("demo_mode");
  }

  try {
    const deadline = AbortSignal.timeout(AUTH_BUDGET_MS);

    const supabase = createServerClient(config.url, config.key, {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          return fetch(input, {
            ...init,
            signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
          });
        },
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // Bounded at the call site, not just at the socket: aborting the fetch
    // does not stop supabase-js retrying. See lib/deadline.ts.
    const {
      data: { user },
    } = await withDeadline(supabase.auth.getUser(), AUTH_BUDGET_MS, "middleware auth check");

    const { pathname } = request.nextUrl;

    if (!user && !isPublicPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  } catch (error) {
    // Don't lock everyone out because Supabase had a bad minute — but say so,
    // because an auth check that silently stops running is worth noticing.
    console.error("[middleware] auth check failed, allowing request through:", error);
  }

  return response;
}
