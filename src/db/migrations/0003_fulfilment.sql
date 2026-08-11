CREATE TABLE "serviceable_fsa" (
	"fsa" text PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	CONSTRAINT "fsa_format" CHECK ("serviceable_fsa"."fsa" ~ '^[A-Z][0-9][A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"hot_eligible" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "slot_not_overbooked" CHECK ("slot"."booked_count" >= 0 AND "slot"."booked_count" <= "slot"."capacity"),
	CONSTRAINT "slot_times_ordered" CHECK ("slot"."cutoff_at" <= "slot"."starts_at" AND "slot"."starts_at" < "slot"."ends_at"),
	CONSTRAINT "slot_capacity_positive" CHECK ("slot"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "zone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"fee_cents" integer NOT NULL,
	"free_above_cents" integer,
	CONSTRAINT "zone_name_unique" UNIQUE("name"),
	CONSTRAINT "zone_fee_non_negative" CHECK ("zone"."fee_cents" >= 0),
	CONSTRAINT "zone_free_above_positive" CHECK ("zone"."free_above_cents" IS NULL OR "zone"."free_above_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "serviceable_fsa" ADD CONSTRAINT "serviceable_fsa_zone_id_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zone"("id") ON DELETE restrict ON UPDATE no action;