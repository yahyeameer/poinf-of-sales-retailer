-- Make the weekly report actually go out, and leave evidence that it did.
--
-- The weekly-report edge function has been complete since it was written: it
-- pulls weekly_report_stats(), has Claude write the recap, and emails it
-- through Resend. Two things were missing.
--
-- It was never scheduled. Its own header says "intended to run on a schedule
-- (pg_cron or an external trigger)" and nothing ever scheduled it, so it has
-- never run once.
--
-- And it recorded nothing. Outcomes came back in the HTTP response, which on a
-- cron run nobody reads. A shop owner asking "did last week's report go out?"
-- had no way to find out, and a send that failed every week for a month would
-- look exactly like one that worked. For a feature whose entire purpose is to
-- arrive unprompted, silent failure is the failure mode that matters.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The log
-- ---------------------------------------------------------------------------

create type public.report_delivery_status as enum ('sent', 'skipped', 'failed');

create table public.report_deliveries (
  id        uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,

  kind text not null default 'weekly' check (kind in ('weekly')),

  -- The Monday-to-Sunday window the recap covers, not when it was sent. A run
  -- that retries on Tuesday still describes last week, and the unique index
  -- below uses this to stop a retry sending a second copy.
  period_end date not null,

  status    public.report_delivery_status not null,
  recipient text,

  -- Kept so the owner can read what was sent without digging through their
  -- inbox, and so a garbled recap can be diagnosed after the fact.
  body   text,
  reason text,

  created_at timestamptz not null default now()
);

-- One successful send per shop per week. A cron that fires twice, or an
-- operator re-running the job by hand, must not email the owner twice about
-- the same week. Partial index so failed and skipped attempts can repeat
-- freely — those are exactly the ones worth retrying.
create unique index report_deliveries_one_send_per_period
  on public.report_deliveries (tenant_id, kind, period_end)
  where status = 'sent';

create index report_deliveries_tenant_idx
  on public.report_deliveries (tenant_id, created_at desc);

comment on table public.report_deliveries is
  'Every attempt to send a scheduled report. The unique index makes a second '
  'successful send for the same week impossible, so retries are safe.';

-- ---------------------------------------------------------------------------
-- 2. RLS
--
-- Owners read their own shop's history; nobody writes through this path. The
-- edge function runs as service_role, which bypasses RLS, so there is
-- deliberately no insert policy: a delivery record should only ever be
-- created by the job that did the delivering.
-- ---------------------------------------------------------------------------

alter table public.report_deliveries enable row level security;
alter table public.report_deliveries force  row level security;

create policy "owners read report deliveries"
  on public.report_deliveries for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
  );

grant select on public.report_deliveries to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Which week are we talking about
--
-- The report covers the week that just ended. Pinning this in SQL rather than
-- computing it in the edge function means the log, the UI and the job cannot
-- disagree about which Sunday a row belongs to.
-- ---------------------------------------------------------------------------

create or replace function public.last_report_period_end(p_at timestamptz default now())
returns date
language sql
immutable
set search_path = ''
as $$
  -- date_trunc('week') is Monday-based in Postgres, so this is the Sunday that
  -- ended the most recently completed week.
  select (date_trunc('week', p_at)::date - 1)
$$;

comment on function public.last_report_period_end(timestamptz) is
  'The Sunday ending the most recently completed week. One definition, shared '
  'by the cron job, the edge function and the dashboard.';

revoke all on function public.last_report_period_end(timestamptz) from public, anon;
grant execute on function public.last_report_period_end(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The schedule
--
-- Guarded rather than assumed. pg_cron and pg_net are available on Supabase
-- but must be enabled per project, and a self-hoster running plain Postgres
-- has neither. A migration that hard-failed there would block every later
-- migration over a feature that is optional by design.
--
-- The service-role key is NOT in this file and must never be: the repository
-- is public. It is read from Vault at call time, under the name below, and the
-- schedule is only created once someone has put it there. The NOTICE says how.
-- ---------------------------------------------------------------------------

do $$
declare
  v_has_cron boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  v_has_net  boolean := exists (select 1 from pg_extension where extname = 'pg_net');
  v_has_vault boolean := exists (select 1 from pg_extension where extname = 'supabase_vault');
  v_has_secret boolean := false;
begin
  if not (v_has_cron and v_has_net) then
    raise notice
      'weekly report NOT scheduled: pg_cron=% pg_net=%. Enable both (Supabase '
      'dashboard -> Database -> Extensions), then re-run this migration.',
      v_has_cron, v_has_net;
    return;
  end if;

  if v_has_vault then
    select exists (select 1 from vault.decrypted_secrets where name = 'weekly_report_invoke_key')
      into v_has_secret;
  end if;

  if not v_has_secret then
    raise notice
      'weekly report NOT scheduled: no Vault secret named weekly_report_invoke_key. '
      'Store the project service-role key with '
      'select vault.create_secret(''<service-role-key>'', ''weekly_report_invoke_key''); '
      'and a second secret ''weekly_report_url'' holding '
      'https://<project-ref>.supabase.co/functions/v1/weekly-report, then re-run.';
    return;
  end if;

  -- Unschedule first so re-running the migration updates rather than duplicates.
  perform cron.unschedule('weekly-report')
  where exists (select 1 from cron.job where jobname = 'weekly-report');

  -- Mondays at 06:00 UTC: the week is complete, and it lands before a shop
  -- owner's Monday rather than during Sunday trade.
  perform cron.schedule(
    'weekly-report',
    '0 6 * * 1',
    $cron$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_report_url'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_report_invoke_key')
      ),
      body    := '{}'::jsonb
    );
    $cron$
  );

  raise notice 'weekly report scheduled: Mondays 06:00 UTC';
end $$;
