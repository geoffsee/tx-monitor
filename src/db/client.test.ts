import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, upgradeLegacySchema } from "./client";
import { TrafficStore } from "./store";

const INITIAL_MIGRATION_HASH =
    "e22e4f01dd3f0237dd8b9486f80128098a360d3121539a4727fbae427aae7f98";
const INITIAL_MIGRATION_CREATED_AT = 1781459046183;

const tempDatabases: string[] = [];

function createLegacyDatabase(): string {
    const dbPath = join(tmpdir(), `tx-mon-legacy-${crypto.randomUUID()}.db`);
    tempDatabases.push(dbPath);

    const sqlite = new Database(dbPath);
    sqlite.exec(`
        CREATE TABLE capture_sessions (
            id text PRIMARY KEY NOT NULL,
            mode text NOT NULL,
            label text NOT NULL,
            started_at integer NOT NULL,
            ended_at integer,
            total_packets integer DEFAULT 0 NOT NULL,
            total_bytes integer DEFAULT 0 NOT NULL
        );

        CREATE TABLE __drizzle_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash text NOT NULL,
            created_at numeric
        );
    `);
    sqlite
        .query(
            `INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)`,
        )
        .run(INITIAL_MIGRATION_HASH, INITIAL_MIGRATION_CREATED_AT);
    sqlite.close();

    return dbPath;
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
                // Ignore cleanup errors for temp files.
            }
        }
    }
});

describe("openDatabase", () => {
    test("upgrades legacy capture_sessions schema", () => {
        const dbPath = createLegacyDatabase();
        const store = new TrafficStore(openDatabase(dbPath));

        const session = store.startSession("live", "tcpdump -i any", {
            hostname: "edge-router",
            cmdline: "tcpdump -i any -Q out",
            notes: "legacy upgrade",
            tags: "lab",
        });

        const loaded = store.getSession(session.id);
        expect(loaded?.hostname).toBe("edge-router");
        expect(loaded?.cmdline).toBe("tcpdump -i any -Q out");
        expect(loaded?.notes).toBe("legacy upgrade");
        expect(loaded?.tags).toBe("lab");
    });

    test("upgradeLegacySchema is idempotent", () => {
        const dbPath = createLegacyDatabase();
        const sqlite = new Database(dbPath);

        upgradeLegacySchema(sqlite);
        upgradeLegacySchema(sqlite);

        expect(
            sqlite
                .query(`PRAGMA table_info(capture_sessions)`)
                .all()
                .map((column) => (column as { name: string }).name),
        ).toEqual([
            "id",
            "mode",
            "label",
            "started_at",
            "ended_at",
            "total_packets",
            "total_bytes",
            "hostname",
            "cmdline",
            "notes",
            "tags",
        ]);
        sqlite.close();
    });
});
