CREATE TABLE "orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" text DEFAULT 'ENCARGO' NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text,
	"pickup_at" integer NOT NULL,
	"notes" text,
	"items" text NOT NULL,
	"total" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deposit" integer DEFAULT 0 NOT NULL,
	"deposit_sale_id" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"sale_id" integer,
	"user_id" integer NOT NULL,
	"created_at" integer DEFAULT (extract(epoch from now())::int) NOT NULL,
	"closed_at" integer
);
--> statement-breakpoint
CREATE TABLE "product_components" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_components_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"quantity" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_options" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_options_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"group_name" text NOT NULL,
	"name" text NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kind" text DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_deposit_sale_id_sales_id_fk" FOREIGN KEY ("deposit_sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_component_id_products_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_pickup_idx" ON "orders" USING btree ("pickup_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_components_unique" ON "product_components" USING btree ("product_id","component_id");--> statement-breakpoint
CREATE INDEX "product_components_component_idx" ON "product_components" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "product_options_product_idx" ON "product_options" USING btree ("product_id");--> statement-breakpoint
-- Producto interno con el que se cobran los anticipos de encargos (no sale en el catálogo).
INSERT INTO "products" ("name", "price", "unit", "kind", "active")
SELECT 'Anticipo de encargo', 0, 'PIEZA', 'ANTICIPO', 1
WHERE NOT EXISTS (SELECT 1 FROM "products" WHERE "kind" = 'ANTICIPO');
