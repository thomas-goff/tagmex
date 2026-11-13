ALTER TYPE "public"."transaction_source" ADD VALUE 'manual';--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_savings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "split_of" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_split_of_transactions_id_fk" FOREIGN KEY ("split_of") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_split_of_idx" ON "transactions" USING btree ("split_of");--> statement-breakpoint
-- A category called Savings is money put away, not spent: flag it, so it stops counting as
-- spending. Any other savings category is flagged with update_category (savings: true).
UPDATE "categories" SET "is_savings" = true WHERE "kind" = 'expense' AND lower("name") = 'savings';
