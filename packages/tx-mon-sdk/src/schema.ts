import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const captureSessions = sqliteTable(
    "capture_sessions",
    {
        id: text("id").primaryKey(),
        mode: text("mode").notNull(),
        label: text("label").notNull(),
        hostname: text("hostname"),
        cmdline: text("cmdline"),
        notes: text("notes"),
        tags: text("tags"),
        startedAt: integer("started_at").notNull(),
        endedAt: integer("ended_at"),
        totalPackets: integer("total_packets").notNull().default(0),
        totalBytes: integer("total_bytes").notNull().default(0),
    },
    (table) => [
        index("capture_sessions_time_idx").on(table.startedAt, table.endedAt),
    ],
);

export const entityMarkers = sqliteTable(
    "entity_markers",
    {
        id: text("id").primaryKey(),
        sessionId: text("session_id")
            .notNull()
            .references(() => captureSessions.id),
        kind: text("kind").notNull(),
        entityId: text("entity_id").notNull(),
        pinned: integer("pinned").notNull().default(0),
        note: text("note"),
        tags: text("tags"),
    },
    (table) => [
        index("entity_markers_session_idx").on(
            table.sessionId,
            table.kind,
            table.entityId,
        ),
    ],
);

export type EntityMarkerRow = typeof entityMarkers.$inferSelect;
export type NewEntityMarkerRow = typeof entityMarkers.$inferInsert;

export const packets = sqliteTable(
    "packets",
    {
        id: text("id").primaryKey(),
        sessionId: text("session_id")
            .notNull()
            .references(() => captureSessions.id),
        timestamp: text("timestamp").notNull(),
        proto: text("proto").notNull(),
        srcHost: text("src_host").notNull(),
        srcPort: integer("src_port"),
        dstHost: text("dst_host").notNull(),
        dstPort: integer("dst_port"),
        length: integer("length").notNull(),
        info: text("info").notNull(),
        receivedAt: integer("received_at").notNull(),
        /** lsof-attributed process command (best-effort; nullable). */
        processCommand: text("process_command"),
        processPid: integer("process_pid"),
        processUser: text("process_user"),
    },
    (table) => [
        index("packets_session_received_idx").on(
            table.sessionId,
            table.receivedAt,
        ),
        index("packets_received_at_idx").on(table.receivedAt),
    ],
);

export type CaptureSession = typeof captureSessions.$inferSelect;
export type PacketRow = typeof packets.$inferSelect;
export type NewCaptureSession = typeof captureSessions.$inferInsert;
export type NewPacketRow = typeof packets.$inferInsert;
