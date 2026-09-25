ALTER TABLE `products` ADD `barcode` text;--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`);