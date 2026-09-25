CREATE UNIQUE INDEX "cash_sessions_one_open_per_user" ON "cash_sessions" USING btree ("user_id") WHERE "cash_sessions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "cash_sessions_user_idx" ON "cash_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cash_sessions_status_idx" ON "cash_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_accounts_customer_idx" ON "credit_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "credit_accounts_status_idx" ON "credit_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_accounts_sale_idx" ON "credit_accounts" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "credit_payments_account_idx" ON "credit_payments" USING btree ("credit_account_id");--> statement-breakpoint
CREATE INDEX "credit_payments_session_idx" ON "credit_payments" USING btree ("cash_session_id");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ticket_per_session" ON "sales" USING btree ("cash_session_id","ticket_number");--> statement-breakpoint
CREATE INDEX "sales_session_idx" ON "sales" USING btree ("cash_session_id");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_created_at_idx" ON "sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sales_payment_method_idx" ON "sales" USING btree ("payment_method");