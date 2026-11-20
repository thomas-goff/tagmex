ALTER TABLE "budget_items" DROP CONSTRAINT "budget_items_user_category_unique";--> statement-breakpoint
ALTER TABLE "budget_items" ADD COLUMN "effective_from" date DEFAULT '1970-01-01' NOT NULL;--> statement-breakpoint
CREATE INDEX "budget_items_user_category_idx" ON "budget_items" USING btree ("user_id","category_id","effective_from");--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_user_category_effective_unique" UNIQUE("user_id","category_id","effective_from");