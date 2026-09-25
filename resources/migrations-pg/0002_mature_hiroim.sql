ALTER TABLE "sale_items" ALTER COLUMN "quantity" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text DEFAULT 'PIEZA' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "unit" text DEFAULT 'PIEZA' NOT NULL;