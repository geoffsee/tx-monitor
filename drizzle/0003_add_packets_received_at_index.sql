-- Add index on packets.received_at for efficient time-range queries
-- This supports cross-app time-window triage without session_id filtering
CREATE INDEX IF NOT EXISTS packets_received_at_idx ON packets (received_at);
--> statement-breakpoint
-- Add index on capture_sessions time columns for session overlap queries
CREATE INDEX IF NOT EXISTS capture_sessions_time_idx ON capture_sessions (started_at, ended_at);
