import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, image files, and the app-shell files a
    // client fetches *before* it has a session.
    //
    // robots.txt and manifest.webmanifest were caught by this gate and answered
    // with a 307 to /login. A crawler therefore never saw the "disallow all"
    // it came for, and the manifest never loaded — so "add to home screen"
    // installed an unnamed, iconless app. Both are unauthenticated by nature;
    // neither reveals anything about a shop.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
