#!/usr/bin/env bun
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

const requiredPaths = [
    "bin/tx-monitor.js",
    "drizzle/meta/_journal.json",
    "dist/index.html",
    "src/server.ts",
    "src/db/client.ts",
    "src/db/store.ts",
    "src/db/schema.ts",
    "src/components/SessionHistory.tsx",
    "src/lib/api.ts",
];

const missing = requiredPaths.filter(
    (path) => !existsSync(join(PACKAGE_ROOT, path)),
);

const migrationSql = readdirSync(join(PACKAGE_ROOT, "drizzle")).filter((name) =>
    name.endsWith(".sql"),
);

if (migrationSql.length === 0) {
    missing.push("drizzle/*.sql");
}

if (missing.length > 0) {
    console.error("Publish verification failed. Missing required files:");
    for (const path of missing) {
        console.error(`  - ${path}`);
    }
    process.exit(1);
}

console.log("Publish verification passed.");
