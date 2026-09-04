import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

/**
 * Flat config, driving `eslint` directly rather than `next lint`.
 *
 * Two deliberate choices.
 *
 * `next lint` is deprecated as of Next 15.5 and removed in 16, so wiring lint
 * up through it would have meant building on something already scheduled for
 * deletion. `npm run lint` therefore calls eslint itself.
 *
 * And the Next rules come from `@next/eslint-plugin-next` rather than the
 * `eslint-config-next` preset. The preset pulls in a parser that resolves
 * `next/dist/compiled/babel/eslint-parser` relative to itself, and npm hoists
 * the preset to the workspace root while `next` stays nested under apps/web —
 * the same hoisting quirk next.config.mjs documents for the swc bindings. The
 * preset cannot find Next from where it lands. The plugin has no such
 * dependency, and typescript-eslint parses TSX perfectly well on its own.
 *
 * Scope is narrow on purpose. A brand new linter over an existing codebase
 * produces hundreds of findings about style nobody has agreed to, and a lint
 * run everyone learns to ignore is worse than none. This turns on the rules
 * that catch real defects and leaves formatting alone.
 */
export default [
  {
    ignores: ["**/.next/**", "**/node_modules/**", "next-env.d.ts", "eslint.config.mjs"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Config files run in Node, not the browser. Without this `process` in
    // next.config.mjs reads as an undefined global.
    files: ["*.config.{js,mjs,ts}"],
    languageOptions: { globals: { process: "readonly", __dirname: "readonly" } },
  },

  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,

      // Unused variables are worth seeing, but a leading underscore is the
      // conventional way to say "deliberately ignored" and should not be noise.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],

      // `any` appears where the generated Supabase types are stale, with a
      // comment at each site explaining why. A warning keeps it visible without
      // failing the run over a documented, deliberate pattern.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
