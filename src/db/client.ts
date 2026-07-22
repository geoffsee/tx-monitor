import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const PACKAGE_ROOT = join(import.meta.dirname, "../..");
const MIGRATIONS_FOLDER = join(PACKAGE_ROOT, "drizzle");
const MIGRATIONS_JOURNAL = join(MIGRATIONS_FOLDER, "meta/_journal.json");
const INITIAL_MIGRATION_HASH =
    "e22e4f01dd3f0237dd8b9486f80128098a360d3121539a4727fbae427aae7f98";
const INITIAL_MIGRATION_CREATED_AT = 1781459046183;
const SESSION_METADATA_MIGRATION_HASH =
    "b53bddff6befad22729fad5b20bb05444fe1e097e1e8a313bdbee1fcd8146622";
const SESSION_METADATA_MIGRATION_CREATED_AT = 1781459047000;

const ENTITY_MARKERS_MIGRATION_HASH =
    "e7f2a1b3c4d5e6f708192a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4";
const ENTITY_MARKERS_MIGRATION_CREATED_AT = 1781459048000;

const CAPTURE_SESSION_OPTIONAL_COLUMNS = [
    "hostname text",
    "cmdline text",
    "notes text",
    "tags text",
] as const;

const PACKET_PROCESS_OPTIONAL_COLUMNS = [
    "process_command text",
    "process_pid integer",
    "process_user text",
] as const;

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

function recordMigrationIfMissing(
    sqlite: Database,
    hash: string,
    createdAt: number,
) {
    sqlite
        .query(`
            INSERT INTO __drizzle_migrations ("hash", "created_at")
            SELECT ?, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM __drizzle_migrations WHERE hash = ?
            )
        `)
        .run(hash, createdAt, hash);
}

export function upgradeLegacySchema(sqlite: Database) {
    for (const columnDefinition of CAPTURE_SESSION_OPTIONAL_COLUMNS) {
        const columnName = columnDefinition.split(" ")[0];
        if (
            columnName &&
            !tableHasColumn(sqlite, "capture_sessions", columnName)
        ) {
            sqlite.exec(
                `ALTER TABLE capture_sessions ADD COLUMN ${columnDefinition}`,
            );
        }
    }
    for (const columnDefinition of PACKET_PROCESS_OPTIONAL_COLUMNS) {
        const columnName = columnDefinition.split(" ")[0];
        if (columnName && !tableHasColumn(sqlite, "packets", columnName)) {
            sqlite.exec(`ALTER TABLE packets ADD COLUMN ${columnDefinition}`);
        }
    }
    ensureEntityMarkersTable(sqlite);
}

function ensureEntityMarkersTable(sqlite: Database) {
    const tables = sqlite
        .query(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='entity_markers'`,
        )
        .all() as Array<{ name: string }>;
    if (tables.length === 0) {
        sqlite.exec(`
            CREATE TABLE entity_markers (
                id text PRIMARY KEY NOT NULL,
                session_id text NOT NULL,
                kind text NOT NULL,
                entity_id text NOT NULL,
                pinned integer NOT NULL DEFAULT 0,
                note text,
                tags text
            );
            CREATE INDEX IF NOT EXISTS entity_markers_session_idx ON entity_markers (session_id, kind, entity_id);
        `);
    }
}

function initializeEmbeddedSchema(sqlite: Database) {
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS capture_sessions (
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

        CREATE TABLE IF NOT EXISTS packets (
            id text PRIMARY KEY NOT NULL,
            session_id text NOT NULL,
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
            process_user text,
            FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON UPDATE no action ON DELETE no action
        );

        CREATE INDEX IF NOT EXISTS packets_session_received_idx ON packets (session_id, received_at);

        CREATE TABLE IF NOT EXISTS entity_markers (
            id text PRIMARY KEY NOT NULL,
            session_id text NOT NULL,
            kind text NOT NULL,
            entity_id text NOT NULL,
            pinned integer NOT NULL DEFAULT 0,
            note text,
            tags text
        );
        CREATE INDEX IF NOT EXISTS entity_markers_session_idx ON entity_markers (session_id, kind, entity_id);

        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at numeric
        );
    `);

    recordMigrationIfMissing(
        sqlite,
        INITIAL_MIGRATION_HASH,
        INITIAL_MIGRATION_CREATED_AT,
    );
    upgradeLegacySchema(sqlite);
    recordMigrationIfMissing(
        sqlite,
        SESSION_METADATA_MIGRATION_HASH,
        SESSION_METADATA_MIGRATION_CREATED_AT,
    );
    recordMigrationIfMissing(
        sqlite,
        ENTITY_MARKERS_MIGRATION_HASH,
        ENTITY_MARKERS_MIGRATION_CREATED_AT,
    );
}

export function openDatabase(dbPath: string) {
    const sqlite = new Database(dbPath, { create: true });
    sqlite.exec("PRAGMA journal_mode = WAL;");
    sqlite.exec("PRAGMA foreign_keys = ON;");

    const db = drizzle(sqlite, { schema });
    if (existsSync(MIGRATIONS_JOURNAL)) {
        migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
        upgradeLegacySchema(sqlite);
    } else {
        initializeEmbeddedSchema(sqlite);
    }

    return db;
}

export type DatabaseClient = ReturnType<typeof openDatabase>;
