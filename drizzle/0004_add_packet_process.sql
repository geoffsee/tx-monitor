-- Persist lsof process attribution on packets (nullable; live captures only).
ALTER TABLE `packets` ADD COLUMN `process_command` text;--> statement-breakpoint
ALTER TABLE `packets` ADD COLUMN `process_pid` integer;--> statement-breakpoint
ALTER TABLE `packets` ADD COLUMN `process_user` text;
