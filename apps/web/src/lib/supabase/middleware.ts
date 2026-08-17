import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Exact matches, plus a prefix rule for the auth callback routes.
//
// This was a `startsWith` check over a list that included "/". Since every path
// starts with "/", every path counted as public and the redirect below never
// ran — the whole gate was dead. RLS still refused the data, so the pages
// rendered empty rather than leaking, but nobody was ever sent to sign in.
const PUBLIC_PATHS = new Set(["/login", "/signup"]);
const PUBLIC_PREFIXES = ["/auth/"];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Demo mode has to be switched on by whoever deploys the app, not by whoever
  // visits it. Previously `?demo=true` on any URL skipped the auth check and
  // set a permanent cookie, so one link turned the gate off for good — the same
  // shape as the PUBLIC_PATHS bug above, reached a different way. RLS still
  // refused every row, so nothing leaked, but the gate wasn't running.
  const demoAllowed = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const demoRequested =
    request.nextUrl.searchParams.get("demo") === "true" ||
    request.cookies.get("demo_mode")?.value === "true";

  if (!supabaseUrl || !supabaseKey) {
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
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      global: {
        fetch: (input, init) => {
          return fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(2000),
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

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
