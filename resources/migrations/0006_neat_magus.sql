PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cash_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`opened_at` integer DEFAULT (unixepoch()) NOT NULL,
	`closed_at` integer,
	`opening_amount` integer NOT NULL,
	`closing_amount` integer,
	`expected_amount` integer,
	`difference` integer,
	`status` text DEFAULT 'OPEN' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_cash_sessions`("id", "user_id", "opened_at", "closed_at", "opening_amount", "closing_amount", "expected_amount", "difference", "status") SELECT "id", "user_id", "opened_at", "closed_at", CAST(ROUND("opening_amount" * 100) AS INTEGER), CAST(ROUND("closing_amount" * 100) AS INTEGER), CAST(ROUND("expected_amount" * 100) AS INTEGER), CAST(ROUND("difference" * 100) AS INTEGER), "status" FROM `cash_sessions`;--> statement-breakpoint
DROP TABLE `cash_sessions`;--> statement-breakpoint
ALTER TABLE `__new_cash_sessions` RENAME TO `cash_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cash_sessions_one_open_per_user` ON `cash_sessions` (`user_id`) WHERE "cash_sessions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX `cash_sessions_user_idx` ON `cash_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `cash_sessions_status_idx` ON `cash_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `__new_credit_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer,
	`customer_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`total` integer NOT NULL,
	`paid` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_credit_accounts`("id", "sale_id", "customer_id", "user_id", "total", "paid", "status", "created_at", "closed_at") SELECT "id", "sale_id", "customer_id", "user_id", CAST(ROUND("total" * 100) AS INTEGER), CAST(ROUND("paid" * 100) AS INTEGER), "status", "created_at", "closed_at" FROM `credit_accounts`;--> statement-breakpoint
DROP TABLE `credit_accounts`;--> statement-breakpoint
ALTER TABLE `__new_credit_accounts` RENAME TO `credit_accounts`;--> statement-breakpoint
CREATE INDEX `credit_accounts_customer_idx` ON `credit_accounts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `credit_accounts_status_idx` ON `credit_accounts` (`status`);--> statement-breakpoint
CREATE INDEX `credit_accounts_sale_idx` ON `credit_accounts` (`sale_id`);--> statement-breakpoint
CREATE TABLE `__new_credit_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`credit_account_id` integer NOT NULL,
	`cash_session_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`payment_method` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`credit_account_id`) REFERENCES `credit_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_credit_payments`("id", "credit_account_id", "cash_session_id", "user_id", "amount", "payment_method", "created_at") SELECT "id", "credit_account_id", "cash_session_id", "user_id", CAST(ROUND("amount" * 100) AS INTEGER), "payment_method", "created_at" FROM `credit_payments`;--> statement-breakpoint
DROP TABLE `credit_payments`;--> statement-breakpoint
ALTER TABLE `__new_credit_payments` RENAME TO `credit_payments`;--> statement-breakpoint
CREATE INDEX `credit_payments_account_idx` ON `credit_payments` (`credit_account_id`);--> statement-breakpoint
CREATE INDEX `credit_payments_session_idx` ON `credit_payments` (`cash_session_id`);--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`unit` text DEFAULT 'PIEZA' NOT NULL,
	`category_id` integer,
	`image_path` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "name", "price", "unit", "category_id", "image_path", "active", "created_at", "updated_at") SELECT "id", "name", CAST(ROUND("price" * 100) AS INTEGER), "unit", "category_id", "image_path", "active", "created_at", "updated_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE TABLE `__new_sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`original_price` integer,
	`unit` text DEFAULT 'PIEZA' NOT NULL,
	`quantity` real NOT NULL,
	`subtotal` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sale_items`("id", "sale_id", "product_id", "name", "price", "original_price", "unit", "quantity", "subtotal") SELECT "id", "sale_id", "product_id", "name", CAST(ROUND("price" * 100) AS INTEGER), CAST(ROUND("original_price" * 100) AS INTEGER), "unit", "quantity", CAST(ROUND("subtotal" * 100) AS INTEGER) FROM `sale_items`;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
CREATE INDEX `sale_items_sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_items_product_idx` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cash_session_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`total` integer NOT NULL,
	`payment_method` text NOT NULL,
	`amount_paid` integer,
	`change` integer,
	`ticket_number` integer NOT NULL,
	`customer_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sales`("id", "cash_session_id", "user_id", "total", "payment_method", "amount_paid", "change", "ticket_number", "customer_id", "created_at") SELECT "id", "cash_session_id", "user_id", CAST(ROUND("total" * 100) AS INTEGER), "payment_method", CAST(ROUND("amount_paid" * 100) AS INTEGER), CAST(ROUND("change" * 100) AS INTEGER), "ticket_number", "customer_id", "created_at" FROM `sales`;--> statement-breakpoint
DROP TABLE `sales`;--> statement-breakpoint
ALTER TABLE `__new_sales` RENAME TO `sales`;--> statement-breakpoint
CREATE UNIQUE INDEX `sales_ticket_per_session` ON `sales` (`cash_session_id`,`ticket_number`);--> statement-breakpoint
CREATE INDEX `sales_session_idx` ON `sales` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `sales_customer_idx` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `sales_created_at_idx` ON `sales` (`created_at`);--> statement-breakpoint
CREATE INDEX `sales_payment_method_idx` ON `sales` (`payment_method`);