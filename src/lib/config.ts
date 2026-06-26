import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvFile } from "./secrets";

const SECRET_KEYS = new Set(["OPENAI_API_KEY", "CODEX_API_KEY"]);

export type ConfigValues = Record<string, string>;

export interface CliOptions {
    file?: string;
    port?: string;
    serve?: boolean;
    db?: string;
    "no-db"?: boolean;
}

const DEFAULTS = {
    port: 3001,
    dbPath: "tx-mon.db",
    fileReplaySpeed: 0,
    fileReplaySleepCapMs: 120,
    codexModel: "gpt-5.5",
    codexTimeoutMs: 120000,
};

export function parseConfigFile(content: string): ConfigValues {
    const source = parseEnvFile(content);
    const out: ConfigValues = {};
    for (const [k, v] of Object.entries(source)) {
        if (typeof v === "string") {
            out[k] = v;
        }
    }
    return out;
}

export function loadAppConfigFile(cwd = process.cwd()): ConfigValues {
    const override = process.env.TXMON_CONFIG?.trim();
    const candidate = override ?? join(cwd, ".tx-monitor/config");
    if (!candidate || !existsSync(candidate)) {
        return {};
    }
    try {
        const raw = parseConfigFile(readFileSync(candidate, "utf8"));
        for (const key of Object.keys(raw)) {
            if (SECRET_KEYS.has(key)) {
                delete raw[key];
            }
        }
        return raw;
    } catch {
        return {};
    }
}

function getRaw(
    envKey: string,
    cliValue: string | undefined,
    env: NodeJS.ProcessEnv,
    file: ConfigValues,
): string | undefined {
    if (cliValue != null && cliValue !== "") {
        return cliValue;
    }
    const envVal = env[envKey];
    if (envVal != null && envVal !== "") {
        return envVal;
    }
    const fileVal = file[envKey];
    if (fileVal != null && fileVal !== "") {
        return fileVal;
    }
    return undefined;
}

export function resolvePort(
    cliPort: string | undefined,
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = {},
): number {
    const raw = getRaw("PORT", cliPort, env, file);
    if (!raw) return DEFAULTS.port;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS.port;
}

export function resolveDbPath(
    cliDb: string | undefined,
    cliNoDb: boolean | undefined,
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = {},
): string | null {
    if (cliNoDb) return null;
    const raw = getRaw("TXMON_DB", cliDb, env, file);
    if (raw) return raw;
    return DEFAULTS.dbPath;
}

export function resolveFilePath(
    cliFile: string | undefined,
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = {},
): string | undefined {
    if (cliFile != null && cliFile !== "") return cliFile;
    const envVal = env.TXMON_FILE;
    if (envVal != null && envVal !== "") return envVal;
    const cfgVal = file.file ?? file.TXMON_FILE;
    if (cfgVal != null && cfgVal !== "") return cfgVal;
    return undefined;
}

export function resolveFileReplaySpeed(
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = {},
): number {
    const raw = getRaw("FILE_REPLAY_SPEED", undefined, env, file);
    if (!raw) return DEFAULTS.fileReplaySpeed;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULTS.fileReplaySpeed;
}

export function resolveFileReplaySleepCapMs(
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = {},
): number {
    const raw = getRaw("FILE_REPLAY_SLEEP_CAP_MS", undefined, env, file);
    if (!raw) return DEFAULTS.fileReplaySleepCapMs;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS.fileReplaySleepCapMs;
}

export function resolveCodexModel(
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = loadAppConfigFile(),
): string {
    const raw = getRaw("TXMON_CODEX_MODEL", undefined, env, file);
    if (!raw) return DEFAULTS.codexModel;
    const trimmed = raw.trim();
    return trimmed || DEFAULTS.codexModel;
}

export function resolveCodexTimeoutMs(
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = loadAppConfigFile(),
): number {
    const raw = getRaw("TXMON_CODEX_TIMEOUT_MS", undefined, env, file);
    if (!raw) return DEFAULTS.codexTimeoutMs;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS.codexTimeoutMs;
}

export function resolveTcpdumpArgs(
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = {},
): string | undefined {
    return getRaw("TXMON_TCPDUMP_ARGS", undefined, env, file);
}

export function resolveLsofDisabled(
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = loadAppConfigFile(),
): boolean {
    const raw = getRaw("TXMON_LSOF_DISABLE", undefined, env, file);
    return raw?.trim() === "1";
}

export function resolveLsofIntervalMs(
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = loadAppConfigFile(),
): number {
    const raw = getRaw("TXMON_LSOF_INTERVAL_MS", undefined, env, file);
    if (!raw) return 1500;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1500;
}

export function resolveServe(
    cliServe: boolean | undefined,
    env: NodeJS.ProcessEnv = process.env,
    file: ConfigValues = {},
): boolean {
    if (cliServe) return true;
    const raw =
        getRaw("SERVE", undefined, env, file) ??
        getRaw("serve", undefined, env, file);
    if (!raw) return false;
    return /^(1|true|yes)$/i.test(raw.trim());
}

export { DEFAULTS };
