-- Hourly heartbeat: Supabase Cron calls POST /api/jobs/heartbeat on the app.
-- app_url and cron_secret come from each project's Vault and are never committed.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- private schema: not exposed through Supabase's Data API (public functions become RPC endpoints)
create schema if not exists private;

create or replace function private.call_app(path text)
returns bigint
language sql
set search_path = ''
as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || path,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$$;

select cron.schedule('heartbeat', '0 * * * *', $$select private.call_app('/api/jobs/heartbeat')$$);
