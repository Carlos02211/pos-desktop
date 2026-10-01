ALTER TABLE "products" ADD COLUMN "open_price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Producto "Varios" de precio libre, listo para cobrar lo que no está en el catálogo.
INSERT INTO "products" ("name", "price", "unit", "open_price", "active")
SELECT 'Varios', 0, 'PIEZA', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM "products" WHERE lower("name") = 'varios' AND "active" = 1);
