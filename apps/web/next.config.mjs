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

export default nextConfig;
