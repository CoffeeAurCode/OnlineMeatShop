CREATE TYPE "public"."checkout_attempt_status" AS ENUM('OPEN', 'AUTHORISED', 'CONSUMED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PLACED', 'PREPARING', 'WEIGHED', 'READY', 'OUT', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."pay_mode" AS ENUM('PREPAID', 'COD');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('REQUIRES_PAYMENT_METHOD', 'REQUIRES_CAPTURE', 'CAPTURED', 'CANCELLED', 'FAILED', 'DISPUTED');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "checkout_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"cart_hash" text NOT NULL,
	"quote_version" integer NOT NULL,
	"quoted_est_cents" integer NOT NULL,
	"authorised_ceiling_cents" integer NOT NULL,
	"payment_intent_id" text,
	"stripe_idempotency_key" text,
	"order_id" uuid,
	"status" "checkout_attempt_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_attempt_payment_intent_id_unique" UNIQUE("payment_intent_id"),
	CONSTRAINT "checkout_attempt_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "checkout_attempt_consumed_has_order" CHECK ("checkout_attempt"."status" <> 'CONSUMED' OR "checkout_attempt"."order_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"name" text,
	"marketing_consent_at" timestamp with time zone,
	"marketing_consent_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"postal_code" text NOT NULL,
	"fsa" text NOT NULL,
	"slot_id" uuid NOT NULL,
	"business_day_id" uuid NOT NULL,
	"pay_mode" "pay_mode" NOT NULL,
	"status" "order_status" DEFAULT 'PLACED' NOT NULL,
	"est_line_total_cents" integer NOT NULL,
	"delivery_fee_cents" integer NOT NULL,
	"est_total_cents" integer NOT NULL,
	"final_total_cents" integer,
	"catalog_version" integer NOT NULL,
	"slot_hot_eligible" boolean NOT NULL,
	"has_hot_line" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "order_final_total_iff_weighed" CHECK (("order"."final_total_cents" IS NULL)
          = ("order"."status" IN ('PLACED', 'PREPARING', 'CANCELLED'))),
	CONSTRAINT "order_hot_line_needs_hot_slot" CHECK (NOT "order"."has_hot_line" OR "order"."slot_hot_eligible"),
	CONSTRAINT "order_money_non_negative" CHECK ("order"."est_line_total_cents" >= 0 AND "order"."delivery_fee_cents" >= 0
          AND "order"."est_total_cents" >= 0
          AND ("order"."final_total_cents" IS NULL OR "order"."final_total_cents" >= 0)),
	CONSTRAINT "order_est_total_is_sum" CHECK ("order"."est_total_cents" = "order"."est_line_total_cents" + "order"."delivery_fee_cents")
);
--> statement-breakpoint
CREATE TABLE "order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"prep_option_id" uuid,
	"product_name" text NOT NULL,
	"pricing_mode" "pricing_mode" NOT NULL,
	"handling" "handling" NOT NULL,
	"rate_per_kg_cents" integer,
	"pack_price_cents" integer,
	"requested_g" integer NOT NULL,
	"est_amount_cents" integer NOT NULL,
	"act_weight_g" integer,
	"act_amount_cents" integer,
	"tax_code" text NOT NULL,
	"tax_rate_basis_points" integer,
	"tax_cents" integer,
	"variance_approved_at" timestamp with time zone,
	CONSTRAINT "order_line_pack_never_repriced" CHECK ("order_line"."pricing_mode" <> 'pack'
          OR ("order_line"."act_weight_g" IS NULL
              AND ("order_line"."act_amount_cents" IS NULL OR "order_line"."act_amount_cents" = "order_line"."est_amount_cents"))),
	CONSTRAINT "order_line_snapshot_matches_mode" CHECK (("order_line"."pricing_mode" = 'pack' AND "order_line"."pack_price_cents" IS NOT NULL AND "order_line"."rate_per_kg_cents" IS NULL)
          OR ("order_line"."pricing_mode" = 'perKg' AND "order_line"."rate_per_kg_cents" IS NOT NULL AND "order_line"."pack_price_cents" IS NULL)),
	CONSTRAINT "order_line_money_non_negative" CHECK ("order_line"."requested_g" >= 0 AND "order_line"."est_amount_cents" >= 0
          AND ("order_line"."act_weight_g" IS NULL OR "order_line"."act_weight_g" >= 0)
          AND ("order_line"."act_amount_cents" IS NULL OR "order_line"."act_amount_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"payment_intent_id" text,
	"status" "payment_status" NOT NULL,
	"authorised_cents" integer NOT NULL,
	"captured_cents" integer,
	"capture_idempotency_key" text,
	"authorised_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payment_payment_intent_id_unique" UNIQUE("payment_intent_id"),
	CONSTRAINT "payment_capture_within_authorisation" CHECK ("payment"."captured_cents" IS NULL
          OR ("payment"."captured_cents" >= 0 AND "payment"."captured_cents" <= "payment"."authorised_cents")),
	CONSTRAINT "payment_authorised_positive" CHECK ("payment"."authorised_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "checkout_attempt" ADD CONSTRAINT "checkout_attempt_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_business_day_id_business_day_id_fk" FOREIGN KEY ("business_day_id") REFERENCES "public"."business_day"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_prep_option_id_prep_option_id_fk" FOREIGN KEY ("prep_option_id") REFERENCES "public"."prep_option"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempt_one_live" ON "checkout_attempt" USING btree ("customer_id","cart_hash") WHERE "checkout_attempt"."status" IN ('OPEN', 'AUTHORISED');