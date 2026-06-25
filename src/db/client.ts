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
            FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON UPDATE no action ON DELETE no action
        );

        CREATE INDEX IF NOT EXISTS packets_session_received_idx ON packets (session_id, received_at);

        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at numeric
        );
    `);

    sqlite
        .query(`
            INSERT INTO __drizzle_migrations ("hash", "created_at")
            SELECT ?, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM __drizzle_migrations WHERE created_at = ?
            )
        `)
        .run(
            INITIAL_MIGRATION_HASH,
            INITIAL_MIGRATION_CREATED_AT,
            INITIAL_MIGRATION_CREATED_AT,
        );
}

export function openDatabase(dbPath: string) {
    const sqlite = new Database(dbPath, { create: true });
    sqlite.exec("PRAGMA journal_mode = WAL;");
    sqlite.exec("PRAGMA foreign_keys = ON;");

    const db = drizzle(sqlite, { schema });
    if (existsSync(MIGRATIONS_JOURNAL)) {
        migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } else {
        initializeEmbeddedSchema(sqlite);
    }

    return db;
}

export type DatabaseClient = ReturnType<typeof openDatabase>;
