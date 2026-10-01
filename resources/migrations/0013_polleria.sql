CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'ENCARGO' NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text,
	`pickup_at` integer NOT NULL,
	`notes` text,
	`items` text NOT NULL,
	`total` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deposit` integer DEFAULT 0 NOT NULL,
	`deposit_sale_id` integer,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`sale_id` integer,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`deposit_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_pickup_idx` ON `orders` (`pickup_at`);--> statement-breakpoint
CREATE TABLE `product_components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`component_id` integer NOT NULL,
	`quantity` real NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`component_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_components_unique` ON `product_components` (`product_id`,`component_id`);--> statement-breakpoint
CREATE INDEX `product_components_component_idx` ON `product_components` (`component_id`);--> statement-breakpoint
CREATE TABLE `product_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`group_name` text NOT NULL,
	`name` text NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_options_product_idx` ON `product_options` (`product_id`);--> statement-breakpoint
ALTER TABLE `products` ADD `kind` text DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `note` text;--> statement-breakpoint
-- Producto interno con el que se cobran los anticipos de encargos (no sale en el catálogo).
INSERT INTO `products` (`name`, `price`, `unit`, `kind`, `active`)
SELECT 'Anticipo de encargo', 0, 'PIEZA', 'ANTICIPO', 1
WHERE NOT EXISTS (SELECT 1 FROM `products` WHERE `kind` = 'ANTICIPO');
