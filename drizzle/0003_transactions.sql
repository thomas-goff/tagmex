CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('user_rule', 'merchant_rule', 'transfer', 'manual', 'none');--> statement-breakpoint
CREATE TYPE "public"."expense_type" AS ENUM('static', 'dynamic', 'irregular');--> statement-breakpoint
CREATE TYPE "public"."rule_match_type" AS ENUM('exact', 'token');--> statement-breakpoint
CREATE TYPE "public"."rule_origin" AS ENUM('seed', 'learned');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('card_purchase', 'debit_order', 'payment', 'transfer', 'credit', 'reversal', 'fee', 'withdrawal', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('gmail');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"expense_type" "expense_type",
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_user_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"match_type" "rule_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"origin" "rule_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rules_user_match_pattern_unique" UNIQUE("user_id","match_type","pattern")
);
--> statement-breakpoint
ALTER TABLE "category_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_type" text NOT NULL,
	"account_last4" text NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description_raw" text NOT NULL,
	"description_normalised" text NOT NULL,
	"category_id" uuid,
	"category_source" "category_source" DEFAULT 'none' NOT NULL,
	"rule_id" uuid,
	"balance_after" numeric(12, 2),
	"kind" "transaction_kind" NOT NULL,
	"transaction_type" text NOT NULL,
	"reserved" boolean DEFAULT false NOT NULL,
	"source" "transaction_source" NOT NULL,
	"source_ref" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_source_ref_unique" UNIQUE("source","source_ref")
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingested_messages" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_rule_id_category_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."category_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_system_kind_unique" ON "categories" USING btree ("user_id","kind") WHERE "categories"."is_system";--> statement-breakpoint
CREATE INDEX "transactions_user_occurred_idx" ON "transactions" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_user_category_idx" ON "transactions" USING btree ("user_id","category_id");--> statement-breakpoint
ALTER TABLE "ingested_messages" ADD CONSTRAINT "ingested_messages_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;