PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`name` text NOT NULL,
	`price` real NOT NULL,
	`original_price` real,
	`unit` text DEFAULT 'PIEZA' NOT NULL,
	`quantity` real NOT NULL,
	`subtotal` real NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sale_items`("id", "sale_id", "product_id", "name", "price", "original_price", "unit", "quantity", "subtotal") SELECT "id", "sale_id", "product_id", "name", "price", "original_price", 'PIEZA', "quantity", "subtotal" FROM `sale_items`;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `products` ADD `unit` text DEFAULT 'PIEZA' NOT NULL;