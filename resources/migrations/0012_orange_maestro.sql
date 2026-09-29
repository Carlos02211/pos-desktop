CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`stock_after` real NOT NULL,
	`reason` text,
	`sale_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movements_product_idx` ON `stock_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_created_idx` ON `stock_movements` (`created_at`);--> statement-breakpoint
ALTER TABLE `products` ADD `track_stock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `stock` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `min_stock` real;