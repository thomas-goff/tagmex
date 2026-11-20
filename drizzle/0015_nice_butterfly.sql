DROP INDEX "budget_items_user_category_idx";--> statement-breakpoint
CREATE INDEX "sync_runs_connection_started_idx" ON "sync_runs" USING btree ("mailbox_connection_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_rule_idx" ON "transactions" USING btree ("rule_id") WHERE "transactions"."rule_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_user_uncategorised_idx" ON "transactions" USING btree ("user_id","occurred_on") WHERE "transactions"."category_source" = 'none' and not "transactions"."is_deleted";