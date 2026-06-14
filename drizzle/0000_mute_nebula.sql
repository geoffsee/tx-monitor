CREATE TABLE `capture_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`label` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`total_packets` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `packets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`proto` text NOT NULL,
	`src_host` text NOT NULL,
	`src_port` integer,
	`dst_host` text NOT NULL,
	`dst_port` integer,
	`length` integer NOT NULL,
	`info` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `capture_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `packets_session_received_idx` ON `packets` (`session_id`,`received_at`);