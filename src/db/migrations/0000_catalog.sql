CREATE TYPE "public"."handling" AS ENUM('RAW', 'MARINATED', 'COOKED_CHILLED', 'COOKED_HOT');--> statement-breakpoint
CREATE TYPE "public"."pricing_mode" AS ENUM('pack', 'perKg');--> statement-breakpoint
CREATE TABLE "catalog_version" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_version_single_row" CHECK ("catalog_version"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "prep_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"handling" "handling" NOT NULL,
	"pricing_mode" "pricing_mode" NOT NULL,
	"pack_price_cents" integer,
	"w_min_g" integer,
	"w_max_g" integer,
	"rate_per_kg_cents" integer,
	"min_order_g" integer,
	"step_g" integer,
	"tax_code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_slug_unique" UNIQUE("slug"),
	CONSTRAINT "product_pricing_mode_xor" CHECK ((
        "product"."pricing_mode" = 'pack'
        AND "product"."pack_price_cents" IS NOT NULL AND "product"."w_min_g" IS NOT NULL AND "product"."w_max_g" IS NOT NULL
        AND "product"."rate_per_kg_cents" IS NULL AND "product"."min_order_g" IS NULL AND "product"."step_g" IS NULL
      ) OR (
        "product"."pricing_mode" = 'perKg'
        AND "product"."rate_per_kg_cents" IS NOT NULL AND "product"."min_order_g" IS NOT NULL AND "product"."step_g" IS NOT NULL
        AND "product"."pack_price_cents" IS NULL AND "product"."w_min_g" IS NULL AND "product"."w_max_g" IS NULL
      )),
	CONSTRAINT "product_pack_range_valid" CHECK ("product"."pricing_mode" <> 'pack' OR (
        "product"."pack_price_cents" > 0 AND "product"."w_min_g" > 0 AND "product"."w_min_g" <= "product"."w_max_g"
      )),
	CONSTRAINT "product_perkg_valid" CHECK ("product"."pricing_mode" <> 'perKg' OR (
        "product"."rate_per_kg_cents" > 0 AND "product"."step_g" > 0 AND "product"."min_order_g" >= "product"."step_g"
      ))
);
--> statement-breakpoint
ALTER TABLE "prep_option" ADD CONSTRAINT "prep_option_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;