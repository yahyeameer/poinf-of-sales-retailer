#!/usr/bin/env node
/**
 * Bundles a run of migrations into one paste-able script.
 *
 * `supabase db push` is the normal path and needs none of this. The bundle
 * exists for the case where the CLI is not available — no link, no access
 * token, no psql — and the only way in is the dashboard's SQL editor.
 *
 * Two things make a hand-pasted bundle safe rather than a trap:
 *
 *   * One transaction. Postgres applies DDL transactionally, so a bundle that
 *     hits an already-applied statement aborts whole and leaves the database
 *     untouched. There is no half-applied state to unpick.
 *   * The migration-history rows. `supabase db push` decides what to run by
 *     reading supabase_migrations.schema_migrations. Applying the SQL without
 *     writing those rows leaves the CLI believing the work is still pending,
 *     so the next push tries again and fails on columns that now exist.
 *
 * Usage:
 *   node packages/db/scripts/bundle-migrations.mjs [--from 20260904000100]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "supabase", "migrations");
const outFile = join(here, "..", "ALL_PENDING_MIGRATIONS.sql");

const fromArg = process.argv.indexOf("--from");
const from = fromArg === -1 ? "20260904000100" : process.argv[fromArg + 1];

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => f.split("_")[0] >= from);

if (files.length === 0) {
  console.error(`No migrations at or after ${from}`);
  process.exit(1);
}

const rule = "-- " + "=".repeat(73);

const header = `${rule.replace("-- ", "-- ===")}
--  ALL PENDING MIGRATIONS, AS ONE PASTE-ABLE SCRIPT
${rule}
--
--  GENERATED FILE - do not edit. Regenerate with:
--      node packages/db/scripts/bundle-migrations.mjs
--
--  Prefer \`npm run db:push\`. It applies these same files in order AND records
--  them in Supabase's migration history, so the CLI knows what has run. Use
--  this file only when the CLI is not available.
--
--  WHAT THIS IS
--  Migrations ${files[0].split("_")[0]} to ${files.at(-1).split("_")[0]}, in order, wrapped in a single
--  transaction, followed by the migration-history rows the CLI would write.
--
--  ALL OR NOTHING
--  Postgres applies DDL transactionally, so if any statement fails the whole
--  script rolls back and the database is untouched. You cannot end up half
--  applied. If it errors, send the message rather than editing around it - the
--  likely cause is that some of these are already applied, and the fix is to
--  regenerate the bundle from a later migration, not to force past the error.
--
--  SAFETY
--  Nothing here drops a table, truncates, or deletes a row. The changes are
--  new columns with defaults, new tables, new and replaced functions, and
--  ALTER VIEW. No existing figure moves.
--
--  HOW TO RUN IT
--  Supabase Dashboard -> SQL Editor -> New query -> paste all of it -> Run.
--  Then run verification/production_check_editor.sql and confirm every row
--  reads PASS.
${rule}

begin;
`;

const body = files
  .map((f) => `\n\n${rule}\n--  ${f}\n${rule}\n\n${readFileSync(join(migrationsDir, f), "utf8")}`)
  .join("");

const historyRows = files
  .map((f) => {
    const version = f.split("_")[0];
    const name = f.slice(version.length + 1, -4);
    return (
      `    insert into supabase_migrations.schema_migrations (version, name)\n` +
      `    values ('${version}', '${name}') on conflict (version) do nothing;\n`
    );
  })
  .join("");

const footer = `
${rule}
--  Tell the CLI these have run.
--
--  supabase_migrations.schema_migrations is how \`supabase db push\` knows what
--  is already applied. Guarded because that table only exists in a project
--  managed by the Supabase CLI; on a plain Postgres this is skipped.
${rule}

do $mig$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
${historyRows}  end if;
end
$mig$;

commit;

${rule}
--  Done. Now run verification/production_check_editor.sql - every row should
--  read PASS, except "Shop timezones set", which reads REVIEW until you set
--  the shop's timezone in Settings -> Shop details.
${rule}
`;

writeFileSync(outFile, header + body + footer);
console.log(`Bundled ${files.length} migrations (${files[0].split("_")[0]} .. ${files.at(-1).split("_")[0]})`);
console.log(`-> ${outFile}`);
