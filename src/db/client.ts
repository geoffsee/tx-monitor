import { Database } from "bun:sqlite";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const PACKAGE_ROOT = join(import.meta.dirname, "../..");
const MIGRATIONS_FOLDER = join(PACKAGE_ROOT, "drizzle");

export function openDatabase(dbPath: string) {
    const sqlite = new Database(dbPath, { create: true });
    sqlite.exec("PRAGMA journal_mode = WAL;");
    sqlite.exec("PRAGMA foreign_keys = ON;");

    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    return db;
}

export type DatabaseClient = ReturnType<typeof openDatabase>;
