import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ParsedPacket } from "../lib/tcpdumpParser";
import type { DatabaseClient } from "./client";
import {
    type CaptureSession,
    captureSessions,
    type EntityMarkerRow,
    entityMarkers,
    type PacketRow,
    packets,
} from "./schema";

function sessionId(): string {
    return crypto.randomUUID();
}

export class TrafficStore {
    private activeSessionId: string | null = null;

    constructor(private readonly db: DatabaseClient) {}

    startSession(
        mode: string,
        label: string,
        metadata: {
            hostname?: string | null;
            cmdline?: string | null;
            notes?: string | null;
            tags?: string | null;
        } = {},
    ): CaptureSession {
        const row = {
            id: sessionId(),
            mode,
            label,
            hostname: metadata.hostname ?? null,
            cmdline: metadata.cmdline ?? null,
            notes: metadata.notes ?? null,
            tags: metadata.tags ?? null,
            startedAt: Date.now(),
        };
        this.db.insert(captureSessions).values(row).run();
        this.activeSessionId = row.id;
        return {
            ...row,
            endedAt: null,
            totalPackets: 0,
            totalBytes: 0,
        };
    }

    endSession(): void {
        if (!this.activeSessionId) {
            return;
        }

        this.db
            .update(captureSessions)
            .set({ endedAt: Date.now() })
            .where(eq(captureSessions.id, this.activeSessionId))
            .run();
        this.activeSessionId = null;
    }

    updateSessionMetadata(
        id: string,
        metadata: {
            notes?: string | null;
            tags?: string | null;
        },
    ): void {
        const updates: Record<string, string | null> = {};
        if (metadata.notes !== undefined) {
            updates.notes = metadata.notes;
        }
        if (metadata.tags !== undefined) {
            updates.tags = metadata.tags;
        }
        if (Object.keys(updates).length === 0) {
            return;
        }
        this.db
            .update(captureSessions)
            .set(updates)
            .where(eq(captureSessions.id, id))
            .run();
    }

    getActiveSessionId(): string | null {
        return this.activeSessionId;
    }

    savePackets(batch: ParsedPacket[]): void {
        if (batch.length === 0 || !this.activeSessionId) {
            return;
        }

        const sessionId = this.activeSessionId;
        const receivedAt = Date.now();
        const existingIds = new Set(
            this.db
                .select({ id: packets.id })
                .from(packets)
                .where(
                    inArray(
                        packets.id,
                        batch.map((packet) => packet.id),
                    ),
                )
                .all()
                .map((row) => row.id),
        );
        const newPackets = batch.filter(
            (packet) => !existingIds.has(packet.id),
        );
        if (newPackets.length === 0) {
            return;
        }

        const rows = newPackets.map((packet) => ({
            id: packet.id,
            sessionId,
            timestamp: packet.timestamp,
            proto: packet.proto,
            srcHost: packet.srcHost,
            srcPort: packet.srcPort,
            dstHost: packet.dstHost,
            dstPort: packet.dstPort,
            length: packet.length,
            info: packet.info,
            receivedAt,
        }));

        this.db.insert(packets).values(rows).run();

        const totalBytes = newPackets.reduce(
            (sum, packet) => sum + packet.length,
            0,
        );
        this.db
            .update(captureSessions)
            .set({
                totalPackets: sql`${captureSessions.totalPackets} + ${newPackets.length}`,
                totalBytes: sql`${captureSessions.totalBytes} + ${totalBytes}`,
            })
            .where(eq(captureSessions.id, sessionId))
            .run();
    }

    listSessions(limit = 20): CaptureSession[] {
        return this.db
            .select()
            .from(captureSessions)
            .orderBy(desc(captureSessions.startedAt))
            .limit(limit)
            .all();
    }

    getSession(id: string): CaptureSession | undefined {
        return this.db
            .select()
            .from(captureSessions)
            .where(eq(captureSessions.id, id))
            .get();
    }

    listRecentPackets(limit = 80, sessionId?: string): PacketRow[] {
        const query = this.db.select().from(packets);

        if (sessionId) {
            return query
                .where(eq(packets.sessionId, sessionId))
                .orderBy(desc(packets.receivedAt))
                .limit(limit)
                .all();
        }

        return query.orderBy(desc(packets.receivedAt)).limit(limit).all();
    }

    listSessionPackets(
        sessionId: string,
        offset: number,
        limit: number,
    ): PacketRow[] {
        return this.db
            .select()
            .from(packets)
            .where(eq(packets.sessionId, sessionId))
            .orderBy(asc(packets.receivedAt), asc(packets.id))
            .limit(limit)
            .offset(offset)
            .all();
    }

    private entityMarkerRowId(
        sessionId: string,
        kind: string,
        entityId: string,
    ): string {
        return `${sessionId}:${kind}:${entityId}`;
    }

    setEntityMarker(
        sessionId: string,
        input: {
            kind: "host" | "flow";
            entityId: string;
            pinned?: boolean;
            note?: string | null;
            tags?: string | null;
        },
    ): void {
        if (!sessionId || !input.entityId) {
            return;
        }
        const id = this.entityMarkerRowId(
            sessionId,
            input.kind,
            input.entityId,
        );
        const existing = this.db
            .select()
            .from(entityMarkers)
            .where(eq(entityMarkers.id, id))
            .get();

        const nextPinned =
            input.pinned !== undefined
                ? input.pinned
                    ? 1
                    : 0
                : (existing?.pinned ?? 0);
        const nextNote =
            input.note !== undefined ? input.note : (existing?.note ?? null);
        const nextTags =
            input.tags !== undefined ? input.tags : (existing?.tags ?? null);

        const hasContent =
            nextPinned === 1 ||
            (nextNote && nextNote.trim().length > 0) ||
            (nextTags && nextTags.trim().length > 0);

        if (!hasContent) {
            if (existing) {
                this.db
                    .delete(entityMarkers)
                    .where(eq(entityMarkers.id, id))
                    .run();
            }
            return;
        }

        const row = {
            id,
            sessionId,
            kind: input.kind,
            entityId: input.entityId,
            pinned: nextPinned,
            note: nextNote,
            tags: nextTags,
        };

        if (existing) {
            this.db
                .update(entityMarkers)
                .set({
                    pinned: nextPinned,
                    note: nextNote,
                    tags: nextTags,
                })
                .where(eq(entityMarkers.id, id))
                .run();
        } else {
            this.db.insert(entityMarkers).values(row).run();
        }
    }

    getEntityMarkers(sessionId: string): Array<{
        kind: "host" | "flow";
        id: string;
        pinned: boolean;
        note: string | null;
        tags: string | null;
    }> {
        if (!sessionId) {
            return [];
        }
        const rows = this.db
            .select()
            .from(entityMarkers)
            .where(eq(entityMarkers.sessionId, sessionId))
            .all();
        return rows.map((row: EntityMarkerRow) => ({
            kind: row.kind as "host" | "flow",
            id: row.entityId,
            pinned: !!row.pinned,
            note: row.note,
            tags: row.tags,
        }));
    }
}
