CREATE TABLE "business_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "business_day_business_date_unique" UNIQUE("business_date"),
	CONSTRAINT "business_day_closed_at_iff_closed" CHECK ("business_day"."open" = ("business_day"."closed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "stock_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_day_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"stocked_g" integer NOT NULL,
	"reserved_g" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_not_oversold" CHECK ("stock_item"."reserved_g" >= 0 AND "stock_item"."reserved_g" <= "stock_item"."stocked_g"),
	CONSTRAINT "stock_stocked_non_negative" CHECK ("stock_item"."stocked_g" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_business_day_id_business_day_id_fk" FOREIGN KEY ("business_day_id") REFERENCES "public"."business_day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_day_one_open" ON "business_day" USING btree ((true)) WHERE "business_day"."open";--> statement-breakpoint
CREATE UNIQUE INDEX "stock_item_day_product" ON "stock_item" USING btree ("business_day_id","product_id");