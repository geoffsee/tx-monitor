-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS `entity_markers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`pinned` integer NOT NULL DEFAULT 0,
	`note` text,
	`tags` text,
	FOREIGN KEY (`session_id`) REFERENCES `capture_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `entity_markers_session_idx` ON `entity_markers` (`session_id`, `kind`, `entity_id`);
