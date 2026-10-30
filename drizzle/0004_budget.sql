CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"clerk_user_id" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_at" timestamp with time zone,
	CONSTRAINT "app_users_email_unique" UNIQUE("email"),
	CONSTRAINT "app_users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "app_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"expense_type" "expense_type" NOT NULL,
	"allocated" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expected_day" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_items_user_category_unique" UNIQUE("user_id","category_id"),
	CONSTRAINT "budget_items_allocated_non_negative" CHECK ("budget_items"."allocated" >= 0),
	CONSTRAINT "budget_items_expected_day_range" CHECK ("budget_items"."expected_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "budget_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"args" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"duration_ms" integer NOT NULL,
	"client_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_sent_user_key_unique" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notifications_sent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"salary_day_hint" integer DEFAULT 31 NOT NULL,
	"expected_salary_amount" numeric(12, 2),
	"salary_tolerance_pct" integer DEFAULT 20 NOT NULL,
	"timezone" text DEFAULT 'Africa/Johannesburg' NOT NULL,
	"digest_hour" integer DEFAULT 7 NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"discord_alerts_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_salary_day_range" CHECK ("user_settings"."salary_day_hint" between 1 and 31),
	CONSTRAINT "user_settings_tolerance_range" CHECK ("user_settings"."salary_tolerance_pct" between 0 and 100),
	CONSTRAINT "user_settings_digest_hour_range" CHECK ("user_settings"."digest_hour" between 0 and 23)
);
--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_salary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_audit_log_user_at_idx" ON "mcp_audit_log" USING btree ("user_id","at");