ALTER TABLE "products" ADD COLUMN "barcode" text;--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_unique" ON "products" USING btree ("barcode");