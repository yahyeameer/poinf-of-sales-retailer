-- Pre-flight for turning on the Supabase GitHub integration.
--
-- Read-only apart from one temp table. Paste into the SQL editor and run.
--
-- The integration decides what to apply by comparing the repo's migrations
-- against supabase_migrations.schema_migrations. Where that table has no
-- record of work that has in fact already been applied — because it was run by
-- hand, or pasted into this editor — the integration will try to run those
-- migrations again and fail on objects that already exist.
--
-- This says whether it is safe to switch the working directory to packages/db
-- and let merges deploy.
--
-- It handles the case where the history table does not exist at all, which is
-- not hypothetical: the paste-able bundle writes its history rows inside a
-- guard, so on a project that has never been managed by the CLI those inserts
-- were skipped without complaint.

create temp table if not exists preflight (line int, verdict text, detail text);
truncate preflight;

do $preflight$
declare
  v_missing text;
  v_count   int;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    insert into preflight values
      (1, 'REVIEW',
       'No migration history table. This project has never been managed by the '
       'Supabase CLI or the GitHub integration, so it has no record of the '
       '29 migrations in the repo. Turning the integration on now would make '
       'it try to apply all of them. Send me this output.');
    return;
  end if;

  create temp table if not exists repo_versions (version text);
  truncate repo_versions;
  insert into repo_versions (version) values
      ('20260728000100'),
      ('20260728000200'),
      ('20260728000300'),
      ('20260728000400'),
      ('20260728000500'),
      ('20260728000600'),
      ('20260728000700'),
      ('20260728000800'),
      ('20260728000900'),
      ('20260805000100'),
      ('20260805000200'),
      ('20260805000300'),
      ('20260806000100'),
      ('20260807000100'),
      ('20260808000100'),
      ('20260808000200'),
      ('20260817000100'),
      ('20260817000200'),
      ('20260903000100'),
      ('20260903000200'),
      ('20260903000300'),
      ('20260904000100'),
      ('20260905000100'),
      ('20260905000200'),
      ('20260906000100'),
      ('20260906000200'),
      ('20260906000300'),
      ('20260907000100'),
      ('20260908000100');

  select count(*), string_agg(r.version, ', ' order by r.version)
    into v_count, v_missing
  from repo_versions r
  left join supabase_migrations.schema_migrations a on a.version = r.version
  where a.version is null;

  if v_count = 0 then
    insert into preflight values
      (1, 'SAFE',
       'Every one of the 29 migrations in the repo is recorded. Set the '
       'working directory to packages/db; merges to main will deploy only '
       'genuinely new migrations.');
  else
    insert into preflight values
      (1, 'REVIEW',
       v_count || ' migration(s) are not recorded and the integration would try '
       'to run them: ' || v_missing || '. Send me this output before switching.');
  end if;

  insert into preflight
  select 2, 'recorded', a.version || '  ' || coalesce(a.name, '')
  from supabase_migrations.schema_migrations a
  order by a.version;
end
$preflight$;

select verdict, detail from preflight order by line, detail;
