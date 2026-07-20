import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_DB_PATH = join(homedir(), ".tx-monitor");

export function expandHomePath(value: string, home = homedir()): string {
    if (value === "~") {
        return home;
    }
    if (value.startsWith("~/")) {
        return join(home, value.slice(2));
    }
    return value;
}

export function resolveDbPath(
    dbPath?: string | null,
    envDb = process.env.TXMON_DB,
): string {
    const raw = dbPath ?? envDb ?? DEFAULT_DB_PATH;
    return expandHomePath(raw);
}
