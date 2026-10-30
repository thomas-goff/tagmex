-- Gmail sync every 30 minutes: Supabase Cron calls POST /api/sync on the app.
-- call_app gains a timeout argument because a sync can run up to the route's 60s maxDuration.
-- It is dropped and recreated rather than overloaded, so call_app('/path') stays unambiguous and the
-- existing heartbeat job keeps working unchanged.
drop function if exists private.call_app(text);

create function private.call_app(path text, timeout_ms integer default 10000)
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
    timeout_milliseconds := timeout_ms
  );
$$;

select cron.schedule('gmail-sync', '*/30 * * * *', $$select private.call_app('/api/sync', 65000)$$);
