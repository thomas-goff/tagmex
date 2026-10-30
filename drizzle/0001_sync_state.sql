CREATE TYPE "public"."ingest_status" AS ENUM('processing', 'parsed', 'ignored', 'failed');--> statement-breakpoint
CREATE TABLE "ingested_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_connection_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"status" "ingest_status" DEFAULT 'processing' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	CONSTRAINT "ingested_messages_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
ALTER TABLE "ingested_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mailbox_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"gmail_address" text NOT NULL,
	"history_id" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_connections_gmail_address_unique" UNIQUE("gmail_address")
);
--> statement-breakpoint
ALTER TABLE "mailbox_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_connection_id" uuid,
	"retry_failed" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched" integer DEFAULT 0 NOT NULL,
	"parsed" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingested_messages" ADD CONSTRAINT "ingested_messages_mailbox_connection_id_mailbox_connections_id_fk" FOREIGN KEY ("mailbox_connection_id") REFERENCES "public"."mailbox_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_mailbox_connection_id_mailbox_connections_id_fk" FOREIGN KEY ("mailbox_connection_id") REFERENCES "public"."mailbox_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingested_messages_status_idx" ON "ingested_messages" USING btree ("mailbox_connection_id","status");