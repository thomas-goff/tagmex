CREATE TYPE "public"."savings_balance_source" AS ENUM('bank', 'manual', 'contributions');--> statement-breakpoint
CREATE TABLE "savings_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"category_id" uuid,
	"account_match" text,
	"balance_source" "savings_balance_source" DEFAULT 'contributions' NOT NULL,
	"manual_balance" numeric(12, 2),
	"manual_balance_on" date,
	"goal" numeric(12, 2),
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_accounts_user_name_unique" UNIQUE("user_id","name"),
	CONSTRAINT "savings_accounts_goal_non_negative" CHECK ("savings_accounts"."goal" is null or "savings_accounts"."goal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "savings_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "savings_accounts" ADD CONSTRAINT "savings_accounts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "savings_accounts_user_idx" ON "savings_accounts" USING btree ("user_id","sort_order");