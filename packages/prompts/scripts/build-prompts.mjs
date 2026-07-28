#!/usr/bin/env node
/**
 * Turns prompts/*.md into TypeScript modules.
 *
 * The markdown is the source of truth — it is what you review in a diff and
 * what a non-engineer can edit. But Metro can't resolve `.md`, and the Supabase
 * CLI only bundles what lives under `supabase/functions`, so neither app can
 * import the markdown directly. Generating a `.ts` file sidesteps both.
 *
 * Outputs (both committed, so a fresh clone works without running this):
 *   packages/prompts/src/generated.ts
 *   packages/db/supabase/functions/_shared/prompts.generated.ts
 *
 * Run: npm run build -w @ai-pos/prompts
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = resolve(here, "..", "prompts");
const repoRoot = resolve(here, "..", "..", "..");

const TARGETS = [
  resolve(here, "..", "src", "generated.ts"),
  resolve(repoRoot, "packages", "db", "supabase", "functions", "_shared", "prompts.generated.ts"),
];

/** Minimal frontmatter parse. The schema here is fixed and tiny; a YAML dep isn't worth it. */
function parse(raw, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`${file}: missing frontmatter block`);

  const [, head, body] = match;
  const meta = {};
  for (const line of head.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, key, value] = kv;
    meta[key] = value.startsWith("[")
      ? value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean)
      : value;
  }

  if (!meta.id) throw new Error(`${file}: frontmatter needs an id`);

  const declared = new Set(meta.variables ?? []);
  const used = new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

  // Catch the two ways this drifts: a placeholder nobody supplies at runtime,
  // and a declared variable that silently stopped being interpolated.
  for (const v of used) {
    if (!declared.has(v)) throw new Error(`${file}: {{${v}}} is used but not declared in frontmatter`);
  }
  for (const v of declared) {
    if (!used.has(v)) throw new Error(`${file}: variable "${v}" is declared but never used`);
  }

  return {
    id: meta.id,
    version: Number(meta.version ?? 1),
    description: meta.description ?? "",
    variables: [...declared],
    body: body.trim(),
  };
}

const files = readdirSync(promptsDir).filter((f) => f.endsWith(".md")).sort();
const prompts = files.map((f) => parse(readFileSync(join(promptsDir, f), "utf8"), f));

const banner = `// GENERATED FILE — DO NOT EDIT.
// Source: packages/prompts/prompts/*.md
// Regenerate: npm run build -w @ai-pos/prompts
`;

const output = `${banner}
export type PromptId =
${prompts.map((p) => `  | ${JSON.stringify(p.id)}`).join("\n")};

export interface PromptDefinition {
  readonly id: PromptId;
  readonly version: number;
  readonly description: string;
  readonly variables: readonly string[];
  readonly body: string;
}

export const PROMPTS: Record<PromptId, PromptDefinition> = {
${prompts
  .map(
    (p) => `  ${JSON.stringify(p.id)}: {
    id: ${JSON.stringify(p.id)},
    version: ${p.version},
    description: ${JSON.stringify(p.description)},
    variables: ${JSON.stringify(p.variables)},
    body: ${JSON.stringify(p.body)},
  },`,
  )
  .join("\n")}
};
`;

for (const target of TARGETS) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output, "utf8");
  console.log(`wrote ${target.replace(repoRoot, ".")}`);
}

console.log(`${prompts.length} prompts: ${prompts.map((p) => `${p.id}@v${p.version}`).join(", ")}`);
