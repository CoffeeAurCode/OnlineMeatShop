-- 0008_delivery_partners
--
-- The roster, the assignment, and the settings the console owns.
--
-- Three things, and they are one change: the shop cannot dispatch an order
-- without somebody to dispatch it to, and it cannot let the owner configure
-- the console without somewhere to keep the answer.
--
--   1. `delivery_partner` -- a name, an E.164 number, active/inactive. NOT a
--      user: no account, no password, no session. See the table comment in
--      `schema.ts` for why that is the right call at 2-6 orders a day.
--
--   2. `order` gains an assignment: a live FK plus a NAME AND PHONE SNAPSHOT,
--      an `assigned_at` and a `dispatched_at`. The snapshot is the point -- the
--      FK is `on delete set null` so a partner can be removed, and without the
--      snapshot removing them would erase who delivered every order they ever
--      carried.
--
--   3. `shop_setting` -- key/value, jsonb, for preferences with no relational
--      meaning (the new-order chime, the message it speaks). Anything a CHECK
--      should enforce stays a real column; see the table comment.
--
-- ✅ EVERY COLUMN ADDED TO `order` IS NULLABLE AND EVERY CONSTRAINT IS
-- SATISFIED BY THE ROWS ALREADY THERE. `order_assignment_coherent` holds for
-- an unassigned order because all four columns are NULL together, and
-- `order_dispatch_after_assign` holds because `dispatched_at` is NULL. So this
-- does not rewrite `order` and does not need a backfill.
--
-- ⚠ `partner_phone_e164` USES `[+]`, NOT `\+`. The backslash does not
-- survive TypeScript's template-literal escaping in `schema.ts`, and the
-- resulting `^+` is an invalid POSIX quantifier that Postgres refuses. That
-- failure lands at migration time on the live database. Caught here once
-- already -- do not "tidy" it back.

CREATE TABLE "delivery_partner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_phone_e164" CHECK ("delivery_partner"."phone" ~ '^[+][1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "shop_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "delivery_partner_id" uuid;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "partner_name" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "partner_phone" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_setting" ADD CONSTRAINT "shop_setting_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_phone_active" ON "delivery_partner" USING btree ("phone") WHERE "delivery_partner"."active";--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_delivery_partner_id_delivery_partner_id_fk" FOREIGN KEY ("delivery_partner_id") REFERENCES "public"."delivery_partner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_assignment_coherent" CHECK (("order"."delivery_partner_id" IS NULL AND "order"."assigned_at" IS NULL
           AND "order"."partner_name" IS NULL AND "order"."partner_phone" IS NULL)
          OR ("order"."delivery_partner_id" IS NOT NULL AND "order"."assigned_at" IS NOT NULL
              AND "order"."partner_name" IS NOT NULL AND "order"."partner_phone" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_dispatch_after_assign" CHECK ("order"."dispatched_at" IS NULL OR "order"."assigned_at" IS NOT NULL);