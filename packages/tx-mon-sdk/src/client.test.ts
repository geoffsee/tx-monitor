import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { openTxMon, openTxMonFromSqlite } from "./client";
import { expandHomePath, resolveDbPath } from "./paths";
import { captureSessions, entityMarkers, packets } from "./schema";

const tempDatabases: string[] = [];

function createSchema(sqlite: Database) {
    sqlite.exec(`
        CREATE TABLE capture_sessions (
            id text PRIMARY KEY NOT NULL,
            mode text NOT NULL,
            label text NOT NULL,
            hostname text,
            cmdline text,
            notes text,
            tags text,
            started_at integer NOT NULL,
            ended_at integer,
            total_packets integer DEFAULT 0 NOT NULL,
            total_bytes integer DEFAULT 0 NOT NULL
        );
        CREATE TABLE packets (
            id text PRIMARY KEY NOT NULL,
            session_id text NOT NULL REFERENCES capture_sessions(id),
            timestamp text NOT NULL,
            proto text NOT NULL,
            src_host text NOT NULL,
            src_port integer,
            dst_host text NOT NULL,
            dst_port integer,
            length integer NOT NULL,
            info text NOT NULL,
            received_at integer NOT NULL,
            process_command text,
            process_pid integer,
            process_user text
        );
        CREATE TABLE entity_markers (
            id text PRIMARY KEY NOT NULL,
            session_id text NOT NULL REFERENCES capture_sessions(id),
            kind text NOT NULL,
            entity_id text NOT NULL,
            pinned integer DEFAULT 0 NOT NULL,
            note text,
            tags text
        );
    `);
}

function seedFixture() {
    const dbPath = join(tmpdir(), `tx-mon-sdk-${crypto.randomUUID()}.db`);
    tempDatabases.push(dbPath);
    const sqlite = new Database(dbPath, { create: true });
    createSchema(sqlite);
    const db = drizzle(sqlite);

    const t0 = 1_700_000_000_000;
    db.insert(captureSessions)
        .values([
            {
                id: "sess-a",
                mode: "live",
                label: "morning capture",
                notes: "prod triage",
                tags: "prod",
                startedAt: t0,
                endedAt: t0 + 60_000,
                totalPackets: 3,
                totalBytes: 300,
            },
            {
                id: "sess-b",
                mode: "file",
                label: "replay",
                notes: null,
                tags: null,
                startedAt: t0 + 120_000,
                endedAt: t0 + 180_000,
                totalPackets: 1,
                totalBytes: 50,
            },
        ])
        .run();

    db.insert(packets)
        .values([
            {
                id: "pkt-1",
                sessionId: "sess-a",
                timestamp: "10:00:00.000000",
                proto: "TCP",
                srcHost: "10.0.0.1",
                srcPort: 44321,
                dstHost: "1.1.1.1",
                dstPort: 443,
                length: 100,
                info: "Flags [S]",
                receivedAt: t0 + 10_000,
                processCommand: "curl",
                processPid: 4242,
                processUser: "alice",
            },
            {
                id: "pkt-2",
                sessionId: "sess-a",
                timestamp: "10:00:05.000000",
                proto: "UDP",
                srcHost: "10.0.0.1",
                srcPort: 5353,
                dstHost: "8.8.8.8",
                dstPort: 53,
                length: 80,
                info: "DNS query",
                receivedAt: t0 + 15_000,
            },
            {
                id: "pkt-3",
                sessionId: "sess-a",
                timestamp: "10:00:20.000000",
                proto: "TCP",
                srcHost: "10.0.0.2",
                srcPort: 22,
                dstHost: "10.0.0.1",
                dstPort: 4000,
                length: 120,
                info: "ssh",
                receivedAt: t0 + 20_000,
            },
            {
                id: "pkt-4",
                sessionId: "sess-b",
                timestamp: "10:02:00.000000",
                proto: "TCP",
                srcHost: "10.0.0.9",
                srcPort: 80,
                dstHost: "10.0.0.1",
                dstPort: 8080,
                length: 50,
                info: "HTTP",
                receivedAt: t0 + 130_000,
            },
        ])
        .run();

    db.insert(entityMarkers)
        .values({
            id: "sess-a:host:10.0.0.1",
            sessionId: "sess-a",
            kind: "host",
            entityId: "10.0.0.1",
            pinned: 1,
            note: "local",
            tags: null,
        })
        .run();

    sqlite.close();
    return { dbPath, t0 };
}

afterEach(() => {
    while (tempDatabases.length > 0) {
        const dbPath = tempDatabases.pop();
        if (!dbPath) {
            continue;
        }
        for (const suffix of ["", "-wal", "-shm"]) {
            try {
                unlinkSync(`${dbPath}${suffix}`);
            } catch {
                // ignore
            }
        }
    }
});

describe("paths", () => {
    test("expandHomePath and resolveDbPath", () => {
        expect(expandHomePath("~", "/home/u")).toBe("/home/u");
        expect(expandHomePath("~/data", "/home/u")).toBe("/home/u/data");
        expect(resolveDbPath("/abs/db")).toBe("/abs/db");
        expect(resolveDbPath(undefined, "~/from-env")).toContain("from-env");
    });
});

describe("TxMonClient", () => {
    test("openTxMon fails when missing", () => {
        expect(() =>
            openTxMon({ dbPath: join(tmpdir(), "missing-tx-mon.db") }),
        ).toThrow(/not found/);
    });

    test("findSessions filters by overlap and q", () => {
        const { dbPath, t0 } = seedFixture();
        const client = openTxMon({ dbPath });

        const aroundA = client.findSessions({
            from: t0 + 5_000,
            to: t0 + 25_000,
        });
        expect(aroundA.sessions.map((s) => s.id)).toEqual(["sess-a"]);

        const byQ = client.findSessions({ q: "prod" });
        expect(byQ.sessions).toHaveLength(1);
        expect(byQ.sessions[0]?.id).toBe("sess-a");

        const byMode = client.findSessions({ mode: "file" });
        expect(byMode.sessions.map((s) => s.id)).toEqual(["sess-b"]);

        client.close();
    });

    test("queryPackets filters by time, host, proto", () => {
        const { dbPath, t0 } = seedFixture();
        const client = openTxMon({ dbPath });

        const page = client.queryPackets({
            sessionId: "sess-a",
            from: t0 + 12_000,
            to: t0 + 25_000,
            proto: "TCP",
        });
        expect(page.packets.map((p) => p.id)).toEqual(["pkt-3"]);
        expect(page.total).toBe(1);

        const byHost = client.queryPackets({ host: "8.8.8.8" });
        expect(byHost.packets.map((p) => p.id)).toEqual(["pkt-2"]);

        const byInfo = client.queryPackets({ q: "DNS" });
        expect(byInfo.packets).toHaveLength(1);

        const withProcess = client.queryPackets({ host: "1.1.1.1" });
        expect(withProcess.packets[0]?.processCommand).toBe("curl");
        expect(withProcess.packets[0]?.processPid).toBe(4242);
        expect(withProcess.packets[0]?.processUser).toBe("alice");

        client.close();
    });

    test("summarize and contextAround", () => {
        const { dbPath, t0 } = seedFixture();
        const client = openTxMon({ dbPath });

        const summary = client.summarize({
            sessionId: "sess-a",
            from: t0,
            to: t0 + 30_000,
        });
        expect(summary.packetCount).toBe(3);
        expect(summary.byteCount).toBe(300);
        expect(summary.byProto.some((entry) => entry.key === "TCP")).toBe(true);
        expect(summary.topHosts[0]?.key).toBe("10.0.0.1");

        const ctx = client.contextAround(t0 + 15_000, { windowMs: 10_000 });
        expect(ctx.from).toBe(t0 + 5_000);
        expect(ctx.to).toBe(t0 + 25_000);
        expect(ctx.sessions.map((s) => s.id)).toEqual(["sess-a"]);
        expect(ctx.packets.map((p) => p.id)).toEqual([
            "pkt-1",
            "pkt-2",
            "pkt-3",
        ]);
        expect(ctx.packetTotal).toBe(3);
        expect(ctx.summary.packetCount).toBe(3);

        const markers = client.getMarkers("sess-a");
        expect(markers).toEqual([
            {
                kind: "host",
                id: "10.0.0.1",
                pinned: true,
                note: "local",
                tags: null,
            },
        ]);

        client.close();
    });

    test("openTxMonFromSqlite works for in-memory fixtures", () => {
        const sqlite = new Database(":memory:");
        createSchema(sqlite);
        const db = drizzle(sqlite);
        db.insert(captureSessions)
            .values({
                id: "s1",
                mode: "live",
                label: "mem",
                startedAt: 100,
                endedAt: 200,
                totalPackets: 0,
                totalBytes: 0,
            })
            .run();
        const client = openTxMonFromSqlite(sqlite);
        expect(client.getSession("s1")?.label).toBe("mem");
        client.close();
    });
});
