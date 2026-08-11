CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'ABANDONED');--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"payload" jsonb NOT NULL,
	"order_id" uuid,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"dedupe_key" text,
	CONSTRAINT "notification_outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "outbox_sent_at_iff_sent" CHECK (("notification_outbox"."status" = 'SENT') = ("notification_outbox"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;