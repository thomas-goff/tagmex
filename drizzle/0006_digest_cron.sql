-- Budget digest and alerts: Supabase Cron calls POST /api/digest hourly at :05. The route posts the
-- digest once per day from each user's digest_hour (so a failed 07:05 run is caught up at 08:05) and
-- checks threshold / salary alerts every time. Deduplicated in notifications_sent.
select cron.schedule('budget-digest', '5 * * * *', $$select private.call_app('/api/digest', 30000)$$);
--> statement-breakpoint
-- MCP audit log retention: 90 days.
select cron.schedule(
  'mcp-audit-retention',
  '30 3 * * *',
  $$delete from public.mcp_audit_log where at < now() - interval '90 days'$$
);
