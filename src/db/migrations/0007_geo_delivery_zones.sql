-- 0007_geo_delivery_zones
--
-- Serviceability stops being a list of postal prefixes and becomes a distance.
--
-- Three things happen here and they are one change:
--
--   1. `zone` gains a CIRCLE (centre + radius). A zone may now be defined by
--      the FSAs pointing at it, by a circle, or by both. Nothing existing is
--      touched: every current zone has all three columns NULL and keeps
--      resolving through `serviceable_fsa` exactly as before.
--
--   2. `order.postal_code` and `order.fsa` DROP NOT NULL. An order located by
--      GPS has no postal code, and writing an invented one to satisfy the old
--      constraint would put fiction on a real row and corrupt every report
--      that groups by FSA.
--
--   3. `order_is_locatable` replaces what that NOT NULL was actually for. It
--      is the stronger statement: the old constraint accepted any six
--      characters, this one insists on a real coordinate PAIR or a postal
--      code. An order that cannot be found is refused by the database.
--
-- ⚠ NOTHING IS BACKFILLED and nothing needs to be. Both ALTERs only relax a
-- constraint, and all three new columns are nullable, so this migration is
-- safe against a live `order` table with rows in it and does not rewrite it.

ALTER TABLE "order" ALTER COLUMN "postal_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ALTER COLUMN "fsa" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "zone" ADD COLUMN "centre_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "zone" ADD COLUMN "centre_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "zone" ADD COLUMN "radius_m" integer;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_is_locatable" CHECK (("order"."lat" IS NOT NULL AND "order"."lng" IS NOT NULL) OR "order"."postal_code" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_circle_whole" CHECK (("zone"."centre_lat" IS NULL AND "zone"."centre_lng" IS NULL AND "zone"."radius_m" IS NULL)
          OR ("zone"."centre_lat" IS NOT NULL AND "zone"."centre_lng" IS NOT NULL AND "zone"."radius_m" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_circle_on_earth" CHECK (("zone"."centre_lat" IS NULL
           OR ("zone"."centre_lat" BETWEEN -90 AND 90 AND "zone"."centre_lng" BETWEEN -180 AND 180))
          AND ("zone"."radius_m" IS NULL OR "zone"."radius_m" > 0));