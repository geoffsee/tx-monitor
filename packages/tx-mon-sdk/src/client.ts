import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import {
    and,
    asc,
    count,
    desc,
    eq,
    gte,
    isNull,
    like,
    lte,
    or,
    type SQL,
} from "drizzle-orm";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { resolveDbPath } from "./paths";
import * as schema from "./schema";
import {
    type CaptureSession,
    captureSessions,
    type EntityMarkerRow,
    entityMarkers,
    type PacketRow,
    packets,
} from "./schema";

export const DEFAULT_PACKET_LIMIT = 200;
export const MAX_PACKET_LIMIT = 5000;
export const DEFAULT_SESSION_LIMIT = 50;
export const MAX_SESSION_LIMIT = 500;
export const DEFAULT_TOP_N = 20;
export const MAX_TOP_N = 100;
export const DEFAULT_WINDOW_MS = 30_000;

export type OpenTxMonOptions = {
    /** Absolute or ~/ path. Defaults to TXMON_DB or ~/.tx-monitor. */
    dbPath?: string;
};

export type FindSessionsOptions = {
    from?: number;
    to?: number;
    mode?: string;
    /** Substring match against label, notes, or tags. */
    q?: string;
    limit?: number;
    offset?: number;
};

export type QueryPacketsOptions = {
    sessionId?: string;
    from?: number;
    to?: number;
    host?: string;
    port?: number;
    proto?: string;
    /** Substring match against packet info. */
    q?: string;
    limit?: number;
    offset?: number;
};

export type SummarizeOptions = {
    sessionId?: string;
    from?: number;
    to?: number;
    topN?: number;
};

export type ContextAroundOptions = {
    windowMs?: number;
    sessionId?: string;
    limit?: number;
    topN?: number;
};

export type CountEntry = {
    key: string;
    count: number;
    bytes: number;
};

export type CaptureSummary = {
    packetCount: number;
    byteCount: number;
    byProto: CountEntry[];
    topHosts: CountEntry[];
    topPorts: CountEntry[];
};

export type EntityMarker = {
    kind: "host" | "flow";
    id: string;
    pinned: boolean;
    note: string | null;
    tags: string | null;
};

export type PacketPage = {
    packets: PacketRow[];
    total: number;
    offset: number;
    limit: number;
};

export type SessionPage = {
    sessions: CaptureSession[];
    total: number;
    offset: number;
    limit: number;
};

export type EventContext = {
    eventAt: number;
    windowMs: number;
    from: number;
    to: number;
    sessions: CaptureSession[];
    packets: PacketRow[];
    packetTotal: number;
    summary: CaptureSummary;
};

type SchemaDb = BunSQLiteDatabase<typeof schema>;

function clampLimit(value: number | undefined, fallback: number, max: number) {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.min(Math.trunc(value), max));
}

function clampOffset(value: number | undefined) {
    if (value === undefined || !Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.trunc(value));
}

function escapeLike(value: string): string {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
}

function requireSql(value: SQL | undefined): SQL {
    if (!value) {
        throw new Error("Expected SQL condition");
    }
    return value;
}

function sessionOverlapConditions(from?: number, to?: number): SQL[] {
    const conditions: SQL[] = [];
    if (to !== undefined) {
        conditions.push(lte(captureSessions.startedAt, to));
    }
    if (from !== undefined) {
        conditions.push(
            requireSql(
                or(
                    isNull(captureSessions.endedAt),
                    gte(captureSessions.endedAt, from),
                ),
            ),
        );
    }
    return conditions;
}

function packetFilterConditions(opts: QueryPacketsOptions): SQL[] {
    const conditions: SQL[] = [];
    if (opts.sessionId) {
        conditions.push(eq(packets.sessionId, opts.sessionId));
    }
    if (opts.from !== undefined) {
        conditions.push(gte(packets.receivedAt, opts.from));
    }
    if (opts.to !== undefined) {
        conditions.push(lte(packets.receivedAt, opts.to));
    }
    if (opts.proto) {
        conditions.push(eq(packets.proto, opts.proto));
    }
    if (opts.host) {
        conditions.push(
            requireSql(
                or(
                    eq(packets.srcHost, opts.host),
                    eq(packets.dstHost, opts.host),
                ),
            ),
        );
    }
    if (opts.port !== undefined) {
        conditions.push(
            requireSql(
                or(
                    eq(packets.srcPort, opts.port),
                    eq(packets.dstPort, opts.port),
                ),
            ),
        );
    }
    if (opts.q) {
        const pattern = `%${escapeLike(opts.q)}%`;
        conditions.push(like(packets.info, pattern));
    }
    return conditions;
}

function whereAll(conditions: SQL[]): SQL | undefined {
    if (conditions.length === 0) {
        return undefined;
    }
    if (conditions.length === 1) {
        return conditions[0];
    }
    return and(...conditions);
}

function emptySummary(): CaptureSummary {
    return {
        packetCount: 0,
        byteCount: 0,
        byProto: [],
        topHosts: [],
        topPorts: [],
    };
}

function topEntries(
    map: Map<string, { count: number; bytes: number }>,
    topN: number,
): CountEntry[] {
    return [...map.entries()]
        .map(([key, value]) => ({
            key,
            count: value.count,
            bytes: value.bytes,
        }))
        .sort(
            (a, b) =>
                b.count - a.count ||
                b.bytes - a.bytes ||
                a.key.localeCompare(b.key),
        )
        .slice(0, topN);
}

function tableHasColumn(
    sqlite: Database,
    table: string,
    column: string,
): boolean {
    const columns = sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
    }>;
    return columns.some((entry) => entry.name === column);
}

/** Core packet columns present on all schema versions (no process attribution). */
const packetCoreColumns = {
    id: packets.id,
    sessionId: packets.sessionId,
    timestamp: packets.timestamp,
    proto: packets.proto,
    srcHost: packets.srcHost,
    srcPort: packets.srcPort,
    dstHost: packets.dstHost,
    dstPort: packets.dstPort,
    length: packets.length,
    info: packets.info,
    receivedAt: packets.receivedAt,
};

export class TxMonClient {
    private readonly sqlite: Database;
    private readonly db: SchemaDb;
    /** False on older capture DBs that predate process attribution columns. */
    private readonly hasProcessColumns: boolean;

    constructor(sqlite: Database, db: SchemaDb) {
        this.sqlite = sqlite;
        this.db = db;
        this.hasProcessColumns = tableHasColumn(
            sqlite,
            "packets",
            "process_command",
        );
    }

    get dbPath(): string {
        return this.sqlite.filename;
    }

    close(): void {
        this.sqlite.close();
    }

    findSessions(opts: FindSessionsOptions = {}): SessionPage {
        const limit = clampLimit(
            opts.limit,
            DEFAULT_SESSION_LIMIT,
            MAX_SESSION_LIMIT,
        );
        const offset = clampOffset(opts.offset);
        const conditions = sessionOverlapConditions(opts.from, opts.to);

        if (opts.mode) {
            conditions.push(eq(captureSessions.mode, opts.mode));
        }
        if (opts.q) {
            const pattern = `%${escapeLike(opts.q)}%`;
            conditions.push(
                requireSql(
                    or(
                        like(captureSessions.label, pattern),
                        like(captureSessions.notes, pattern),
                        like(captureSessions.tags, pattern),
                    ),
                ),
            );
        }

        const where = whereAll(conditions);
        const base = this.db.select().from(captureSessions);
        const countBase = this.db
            .select({ total: count() })
            .from(captureSessions);

        const totalRow = (where ? countBase.where(where) : countBase).get() as
            | { total: number }
            | undefined;
        const total = totalRow?.total ?? 0;

        const sessions = (where ? base.where(where) : base)
            .orderBy(desc(captureSessions.startedAt))
            .limit(limit)
            .offset(offset)
            .all() as CaptureSession[];

        return { sessions, total, offset, limit };
    }

    getSession(id: string): CaptureSession | undefined {
        return this.db
            .select()
            .from(captureSessions)
            .where(eq(captureSessions.id, id))
            .get() as CaptureSession | undefined;
    }

    queryPackets(opts: QueryPacketsOptions = {}): PacketPage {
        const limit = clampLimit(
            opts.limit,
            DEFAULT_PACKET_LIMIT,
            MAX_PACKET_LIMIT,
        );
        const offset = clampOffset(opts.offset);
        const where = whereAll(packetFilterConditions(opts));

        const countBase = this.db.select({ total: count() }).from(packets);
        const totalRow = (where ? countBase.where(where) : countBase).get() as
            | { total: number }
            | undefined;
        const total = totalRow?.total ?? 0;

        const rows = this.hasProcessColumns
            ? ((where
                  ? this.db.select().from(packets).where(where)
                  : this.db.select().from(packets)
              )
                  .orderBy(asc(packets.receivedAt), asc(packets.id))
                  .limit(limit)
                  .offset(offset)
                  .all() as PacketRow[])
            : (
                  (where
                      ? this.db
                            .select(packetCoreColumns)
                            .from(packets)
                            .where(where)
                      : this.db.select(packetCoreColumns).from(packets)
                  )
                      .orderBy(asc(packets.receivedAt), asc(packets.id))
                      .limit(limit)
                      .offset(offset)
                      .all() as Array<
                      Omit<
                          PacketRow,
                          "processCommand" | "processPid" | "processUser"
                      >
                  >
              ).map((row) => ({
                  ...row,
                  processCommand: null,
                  processPid: null,
                  processUser: null,
              }));

        return { packets: rows, total, offset, limit };
    }

    summarize(opts: SummarizeOptions = {}): CaptureSummary {
        const topN = clampLimit(opts.topN, DEFAULT_TOP_N, MAX_TOP_N);
        const where = whereAll(
            packetFilterConditions({
                sessionId: opts.sessionId,
                from: opts.from,
                to: opts.to,
            }),
        );

        const base = this.db
            .select({
                proto: packets.proto,
                srcHost: packets.srcHost,
                dstHost: packets.dstHost,
                srcPort: packets.srcPort,
                dstPort: packets.dstPort,
                length: packets.length,
            })
            .from(packets);
        const rows = (where ? base.where(where) : base).all() as Array<{
            proto: string;
            srcHost: string;
            dstHost: string;
            srcPort: number | null;
            dstPort: number | null;
            length: number;
        }>;

        if (rows.length === 0) {
            return emptySummary();
        }

        const byProto = new Map<string, { count: number; bytes: number }>();
        const hosts = new Map<string, { count: number; bytes: number }>();
        const ports = new Map<string, { count: number; bytes: number }>();
        let byteCount = 0;

        const bump = (
            map: Map<string, { count: number; bytes: number }>,
            key: string,
            bytes: number,
        ) => {
            const existing = map.get(key);
            if (existing) {
                existing.count += 1;
                existing.bytes += bytes;
            } else {
                map.set(key, { count: 1, bytes });
            }
        };

        for (const row of rows) {
            byteCount += row.length;
            bump(byProto, row.proto, row.length);
            bump(hosts, row.srcHost, row.length);
            bump(hosts, row.dstHost, row.length);
            if (row.srcPort != null) {
                bump(ports, String(row.srcPort), row.length);
            }
            if (row.dstPort != null) {
                bump(ports, String(row.dstPort), row.length);
            }
        }

        return {
            packetCount: rows.length,
            byteCount,
            byProto: topEntries(byProto, topN),
            topHosts: topEntries(hosts, topN),
            topPorts: topEntries(ports, topN),
        };
    }

    getMarkers(sessionId: string): EntityMarker[] {
        if (!sessionId) {
            return [];
        }
        const rows = this.db
            .select()
            .from(entityMarkers)
            .where(eq(entityMarkers.sessionId, sessionId))
            .all() as EntityMarkerRow[];
        return rows.map((row) => ({
            kind: row.kind as "host" | "flow",
            id: row.entityId,
            pinned: !!row.pinned,
            note: row.note,
            tags: row.tags,
        }));
    }

    contextAround(
        eventAt: number,
        opts: ContextAroundOptions = {},
    ): EventContext {
        const windowMs = clampLimit(
            opts.windowMs,
            DEFAULT_WINDOW_MS,
            24 * 60 * 60 * 1000,
        );
        const from = eventAt - windowMs;
        const to = eventAt + windowMs;
        const limit = clampLimit(
            opts.limit,
            DEFAULT_PACKET_LIMIT,
            MAX_PACKET_LIMIT,
        );
        const topN = clampLimit(opts.topN, DEFAULT_TOP_N, MAX_TOP_N);

        const { sessions } = this.findSessions({
            from,
            to,
            limit: MAX_SESSION_LIMIT,
        });
        const filteredSessions = opts.sessionId
            ? sessions.filter((session) => session.id === opts.sessionId)
            : sessions;

        const page = this.queryPackets({
            sessionId: opts.sessionId,
            from,
            to,
            limit,
            offset: 0,
        });
        const summary = this.summarize({
            sessionId: opts.sessionId,
            from,
            to,
            topN,
        });

        return {
            eventAt,
            windowMs,
            from,
            to,
            sessions: filteredSessions,
            packets: page.packets,
            packetTotal: page.total,
            summary,
        };
    }
}

/**
 * Open a read-only connection to a tx-monitor SQLite database.
 * Does not run migrations; the writer (tx-monitor) owns schema upgrades.
 */
export function openTxMon(opts: OpenTxMonOptions = {}): TxMonClient {
    const dbPath = resolveDbPath(opts.dbPath);
    if (!existsSync(dbPath)) {
        throw new Error(
            `tx-mon database not found at ${dbPath}. Start tx-monitor with persistence enabled first.`,
        );
    }

    const sqlite = new Database(dbPath, { readonly: true, create: false });
    sqlite.exec("PRAGMA foreign_keys = ON;");
    const db = drizzle(sqlite, { schema });
    return new TxMonClient(sqlite, db);
}

/** @internal test helper — open an existing sqlite handle (read/write ok for fixtures). */
export function openTxMonFromSqlite(sqlite: Database): TxMonClient {
    sqlite.exec("PRAGMA foreign_keys = ON;");
    const db = drizzle(sqlite, { schema });
    return new TxMonClient(sqlite, db);
}
