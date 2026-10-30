CREATE TABLE "discord_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"message_id" text NOT NULL,
	"content" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_messages_transaction_channel_unique" UNIQUE("transaction_id","channel")
);
--> statement-breakpoint
ALTER TABLE "discord_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discord_messages" ADD CONSTRAINT "discord_messages_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;