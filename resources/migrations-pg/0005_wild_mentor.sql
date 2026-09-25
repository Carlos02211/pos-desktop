ALTER TABLE "cash_sessions" ALTER COLUMN "opening_amount" SET DATA TYPE integer USING round("opening_amount" * 100)::integer;--> statement-breakpoint
ALTER TABLE "cash_sessions" ALTER COLUMN "closing_amount" SET DATA TYPE integer USING round("closing_amount" * 100)::integer;--> statement-breakpoint
ALTER TABLE "cash_sessions" ALTER COLUMN "expected_amount" SET DATA TYPE integer USING round("expected_amount" * 100)::integer;--> statement-breakpoint
ALTER TABLE "cash_sessions" ALTER COLUMN "difference" SET DATA TYPE integer USING round("difference" * 100)::integer;--> statement-breakpoint
ALTER TABLE "credit_accounts" ALTER COLUMN "total" SET DATA TYPE integer USING round("total" * 100)::integer;--> statement-breakpoint
ALTER TABLE "credit_accounts" ALTER COLUMN "paid" SET DATA TYPE integer USING round("paid" * 100)::integer;--> statement-breakpoint
ALTER TABLE "credit_payments" ALTER COLUMN "amount" SET DATA TYPE integer USING round("amount" * 100)::integer;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE integer USING round("price" * 100)::integer;--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "price" SET DATA TYPE integer USING round("price" * 100)::integer;--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "original_price" SET DATA TYPE integer USING round("original_price" * 100)::integer;--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "subtotal" SET DATA TYPE integer USING round("subtotal" * 100)::integer;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "total" SET DATA TYPE integer USING round("total" * 100)::integer;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "amount_paid" SET DATA TYPE integer USING round("amount_paid" * 100)::integer;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "change" SET DATA TYPE integer USING round("change" * 100)::integer;