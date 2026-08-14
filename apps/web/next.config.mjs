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
};

export default nextConfig;
