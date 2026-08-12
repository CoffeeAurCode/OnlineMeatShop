-- 0006_prototype_foundations
--
-- Hand-edited after generation, in one place and for one reason. Drizzle
-- emitted the three new address columns as `ADD COLUMN ... text NOT NULL`
-- with no default, which Postgres refuses outright on a table that already
-- has rows. Replaced with the add / backfill / constrain sequence so the
-- migration is safe against a live `order` table.
--
-- The sentinel `(not recorded)` is deliberately ugly and deliberately not an
-- empty string: an order placed before this migration genuinely has no
-- address, and a blank field reads as a bug in the console rather than as an
-- absence of data. `province` backfills to 'QC' because every pre-existing
-- order is a Montreal test order; there is no other province in the data.
--
-- `public_token` keeps its generated form. `gen_random_uuid()` is VOLATILE,
-- so Postgres rewrites the table and evaluates it PER ROW rather than storing
-- one shared value in the catalog. Every existing order therefore gets its
-- own distinct token, which is what the UNIQUE constraint added at the bottom
-- requires. A non-volatile default here would fail that constraint instead.

CREATE TYPE "public"."staff_role" AS ENUM('OWNER', 'STAFF');--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_fr" text NOT NULL,
	"blurb_en" text,
	"blurb_fr" text,
	"image_path" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" DEFAULT 'STAFF' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_username_unique" UNIQUE("username"),
	CONSTRAINT "staff_failed_attempts_non_negative" CHECK ("staff"."failed_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customer" DROP CONSTRAINT "customer_email_unique";--> statement-breakpoint
ALTER TABLE "customer" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "customer" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "province" text;--> statement-breakpoint
UPDATE "order" SET
        "address_line1" = coalesce("address_line1", '(not recorded)'),
        "city"          = coalesce("city", '(not recorded)'),
        "province"      = coalesce("province", 'QC');--> statement-breakpoint
ALTER TABLE "order" ALTER COLUMN "address_line1" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ALTER COLUMN "city" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ALTER COLUMN "province" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "delivery_notes" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "public_token" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "name_fr" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "description_fr" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "image_path" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE INDEX "category_sort_idx" ON "category" USING btree ("sort_order");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_phone_unique" ON "customer" USING btree ("phone") WHERE "customer"."phone" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_email_unique" ON "customer" USING btree ("email") WHERE "customer"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_category_idx" ON "product" USING btree ("category_id","active");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_public_token_unique" UNIQUE("public_token");