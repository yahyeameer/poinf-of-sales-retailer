// Next checks the lockfile for @next/swc-* and offers to patch it if they look
// missing. In this workspace they always look missing and never are: npm hoists
// swc to the root node_modules, while `next` itself is nested under apps/web so
// that each app gets exactly one React. Next derives the expected swc path from
// wherever it found `next`, so it looks under apps/web/node_modules and finds
// nothing — then tries to reach a registry to "fix" it.
//
// That lookup asks the package manager for its registry, and its detection only
// checks the app directory for a lockfile. Ours lives at the repo root, so it
// falls through to probing for yarn, then pnpm — and a pnpm shim on PATH answers,
// even though `packageManager` pins this repo to npm. pnpm then refuses to run,
// once per swc package, and the build prints eight npm errors and a scary
// "Failed to patch lockfile" before carrying on and succeeding anyway.
//
// Node resolves swc from the root perfectly well, so there is nothing to fix.
// Set before the config object so it lands before Next loads the swc bindings.
// This file is .mjs and needs no transpiling, so it is evaluated first; the flag
// cannot live in .env, which is gitignored and so would not survive a clone.
process.env.NEXT_IGNORE_INCORRECT_LOCKFILE = "1";

// From /config, not the package root: the root re-export is deprecated in v10
// and removed in v11, and it warns on every build.
import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The workspace packages ship TypeScript source rather than a build artefact,
  // so Next has to compile them itself.
  transpilePackages: ["@ai-pos/shared", "@ai-pos/prompts"],
  typedRoutes: true,

  /**
   * Response headers.
   *
   * The till takes money and the staff page sets PINs, so framing is the one
   * that matters most here: without X-Frame-Options an attacker can put the
   * real till in a transparent iframe under their own buttons and harvest a
   * shift's takings through a cashier who never sees it.
   *
   * Deliberately no Content-Security-Policy. A useful one needs a nonce
   * threaded through the inline theme script in layout.tsx, and a CSP that is
   * wrong does not degrade — it blanks the app. Shipping one that has never
   * run against a real deployment would be worse than shipping none, so it is
   * written up as follow-up work rather than guessed at here.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The web app never touches these; barcode scanning is the mobile
          // app's job and uses a native module, not the browser camera.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

/**
 * Sentry.
 *
 * withSentryConfig is applied unconditionally — it is a build-time wrapper, and
 * whether anything is *reported* is decided by NEXT_PUBLIC_SENTRY_DSN at
 * runtime (see src/lib/sentry-shared.ts). Wrapping without a DSN costs a build
 * step and produces an app that never phones home.
 *
 * Source map upload is the part that genuinely needs credentials, so it is the
 * part that is conditional. Without SENTRY_AUTH_TOKEN the plugin would try,
 * fail, and — depending on the version — either warn loudly on every build or
 * fail it outright. A contributor cloning this repo has no token and should not
 * have to care, so uploads are switched off unless an org, a project and a
 * token are all present. Stack traces still arrive; they are just minified
 * until someone sets those three.
 */
const sentryUploadConfigured = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,
  sourcemaps: {
    disable: !sentryUploadConfigured,
    // Uploaded maps are deleted from the bundle afterwards. Leaving them served
    // would hand anyone the unminified source of the till and the pricing logic.
    deleteSourcemapsAfterUpload: true,
  },

  // Routes browser reports through this app's own origin instead of straight to
  // ingest.sentry.io. Ad blockers and the restrictive DNS common on shop wifi
  // block that host by name, and a monitoring tool that silently drops reports
  // from exactly the flaky networks you most want to hear about is worse than
  // none.
  tunnelRoute: "/monitoring",

  webpack: {
    // Strips Sentry's own debug logging from the client bundle.
    treeshake: { removeDebugLogging: true },

    // Vercel cancels a function the moment it responds, which can be before a
    // queued event has been flushed. This registers the hook that waits.
    automaticVercelMonitors: true,
  },
});
