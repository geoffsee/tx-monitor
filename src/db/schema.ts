import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const captureSessions = sqliteTable("capture_sessions", {
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
});

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
    },
    (table) => [
        index("packets_session_received_idx").on(
            table.sessionId,
            table.receivedAt,
        ),
    ],
);

export type CaptureSession = typeof captureSessions.$inferSelect;
export type PacketRow = typeof packets.$inferSelect;
export type NewCaptureSession = typeof captureSessions.$inferInsert;
export type NewPacketRow = typeof packets.$inferInsert;
