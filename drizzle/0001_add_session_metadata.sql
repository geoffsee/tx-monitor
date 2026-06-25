-- Custom SQL migration file, put your code below! --
ALTER TABLE `capture_sessions` ADD `hostname` text;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD `cmdline` text;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD `tags` text;
