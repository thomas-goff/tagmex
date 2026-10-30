CREATE TYPE "public"."account_label_kind" AS ENUM('account', 'counterparty');--> statement-breakpoint
CREATE TABLE "account_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "account_label_kind" NOT NULL,
	"match" text NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_labels_user_kind_match_unique" UNIQUE("user_id","kind","match")
);
--> statement-breakpoint
ALTER TABLE "account_labels" ENABLE ROW LEVEL SECURITY;