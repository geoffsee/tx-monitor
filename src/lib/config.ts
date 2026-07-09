import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnvFile, SECRET_KEYS } from "./secrets";

export type ConfigMap = Record<string, string>;

const CANONICAL_KEYS = [
    "db",
    "port",
    "file_replay_speed",
    "file_replay_sleep_cap_ms",
    "lsof_disable",
    "lsof_interval_ms",
    "codex_timeout_ms",
    "codex_model",
] as const;

const KEY_ALIASES: Record<string, string> = {
    DB: "db",
    TXMON_DB: "db",
    PORT: "port",
    FILE_REPLAY_SPEED: "file_replay_speed",
    FILE_REPLAY_SLEEP_CAP_MS: "file_replay_sleep_cap_ms",
    LSOF_DISABLE: "lsof_disable",
    TXMON_LSOF_DISABLE: "lsof_disable",
    LSOF_INTERVAL_MS: "lsof_interval_ms",
    TXMON_LSOF_INTERVAL_MS: "lsof_interval_ms",
    CODEX_TIMEOUT_MS: "codex_timeout_ms",
    TXMON_CODEX_TIMEOUT_MS: "codex_timeout_ms",
    CODEX_MODEL: "codex_model",
    TXMON_CODEX_MODEL: "codex_model",
};

/** Keys never accepted from a config file (credentials / capture args). */
const BLOCKED_CONFIG_KEYS = new Set(
    [
        ...SECRET_KEYS,
        "TXMON_CODEX_AUTH",
        "CODEX_AUTH",
        "TXMON_TCPDUMP_ARGS",
        "TCPDUMP_ARGS",
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
    ].map((k) => k.toUpperCase()),
);

function normalizeKey(raw: string): string | null {
    const upper = raw.trim().toUpperCase();
    if (KEY_ALIASES[upper]) {
        return KEY_ALIASES[upper];
    }
    const lower = raw.trim().toLowerCase();
    if ((CANONICAL_KEYS as readonly string[]).includes(lower)) {
        return lower;
    }
    return null;
}

const SECRET_PATTERNS = [
    /API[_-]?KEY/i,
    /OPENAI/i,
    /CODEX.*AUTH/i,
    /TOKEN/i,
    /SECRET/i,
    /PASSWORD/i,
    /CREDENTIAL/i,
    /TCPDUMP_ARGS/i,
];

function isSecretKey(key: string, value?: string): boolean {
    if (BLOCKED_CONFIG_KEYS.has(key.trim().toUpperCase())) {
        return true;
    }
    if (SECRET_PATTERNS.some((re) => re.test(key))) {
        return true;
    }
    if (
        value &&
        /(sk-[a-zA-Z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,})/i.test(value)
    ) {
        return true;
    }
    return false;
}

/** Expand a leading `~/` or bare `~` to the user home directory. */
export function expandHomePath(value: string, home = homedir()): string {
    if (value === "~") {
        return home;
    }
    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return join(home, value.slice(2));
    }
    return value;
}

let cachedCwd: string | null = null;
let cachedHome: string | null = null;
let cachedConfig: ConfigMap | null = null;

function readConfigFile(path: string, home: string): ConfigMap {
    if (!existsSync(path)) {
        return {};
    }
    try {
        const content = readFileSync(path, "utf8");
        return parseConfigContent(content, { warnPath: path, home });
    } catch {
        return {};
    }
}

export type LoadAppConfigOptions = {
    /** Override home directory (tests). Default: os.homedir(). */
    home?: string;
};

export function loadAppConfig(
    cwd = process.cwd(),
    options: LoadAppConfigOptions = {},
): ConfigMap {
    const home = options.home ?? homedir();
    if (cachedConfig && cachedCwd === cwd && cachedHome === home) {
        return cachedConfig;
    }
    const candidates: string[] = [
        join(home, ".tx-monitor", "config"),
        join(home, ".tx-monitor", "config.toml"),
        join(cwd, ".tx-monitor", "config"),
        join(cwd, ".tx-monitor.toml"),
    ];
    let merged: ConfigMap = {};
    for (const p of candidates) {
        const part = readConfigFile(p, home);
        merged = { ...merged, ...part };
    }
    cachedCwd = cwd;
    cachedHome = home;
    cachedConfig = merged;
    return merged;
}

export function resetConfigCache(): void {
    cachedCwd = null;
    cachedHome = null;
    cachedConfig = null;
}

export type ParseConfigOptions = {
    /** When set, secret-like keys log a warning with this path. */
    warnPath?: string;
    home?: string;
};

export function parseConfigContent(
    content: string,
    options: ParseConfigOptions = {},
): ConfigMap {
    const home = options.home ?? homedir();
    const parsed = parseEnvFile(content);
    const out: ConfigMap = {};
    for (const [k, v] of Object.entries(parsed)) {
        if (isSecretKey(k, v)) {
            if (options.warnPath) {
                console.warn(
                    `[config] ignoring secret-like or blocked key in ${options.warnPath}: ${k}`,
                );
            }
            continue;
        }
        const norm = normalizeKey(k);
        if (norm) {
            const raw = v ?? "";
            out[norm] = norm === "db" ? expandHomePath(raw, home) : raw;
        }
    }
    return out;
}

// Typed accessors from a config map (file values only)
export function getDb(cfg: ConfigMap): string | undefined {
    return cfg.db;
}
export function getPort(cfg: ConfigMap): number | undefined {
    const v = cfg.port;
    if (!v) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
export function getFileReplaySpeed(cfg: ConfigMap): number | undefined {
    const v = cfg.file_replay_speed;
    if (v == null || v === "") return undefined;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
}
export function getFileReplaySleepCapMs(cfg: ConfigMap): number | undefined {
    const v = cfg.file_replay_sleep_cap_ms;
    if (v == null || v === "") return undefined;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
}
export function getLsofDisable(cfg: ConfigMap): boolean | undefined {
    const v = cfg.lsof_disable;
    if (v == null || v === "") return undefined;
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
}
export function getLsofIntervalMs(cfg: ConfigMap): number | undefined {
    const v = cfg.lsof_interval_ms;
    if (v == null || v === "") return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
export function getCodexTimeoutMs(cfg: ConfigMap): number | undefined {
    const v = cfg.codex_timeout_ms;
    if (v == null || v === "") return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
export function getCodexModel(cfg: ConfigMap): string | undefined {
    const v = cfg.codex_model?.trim();
    return v ? v : undefined;
}

// Effective resolution with precedence: config < env < cli
export function resolveDb(
    cli: string | undefined,
    env: string | undefined,
    cfg: string | undefined,
    def: string,
): string {
    if (cli != null) return cli;
    if (env != null) return env;
    if (cfg != null) return cfg;
    return def;
}

export function resolvePortNumber(
    cli: number | undefined,
    envPort: string | undefined,
    cfg: number | undefined,
    def: number,
): number {
    if (cli != null && Number.isFinite(cli) && cli > 0) return cli;
    if (envPort != null) {
        const n = Number.parseInt(envPort, 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    if (cfg != null && Number.isFinite(cfg) && cfg > 0) return cfg;
    return def;
}

export function resolveNumber(
    cli: number | undefined,
    envStr: string | undefined,
    cfg: number | undefined,
    def: number,
): number {
    if (cli != null && Number.isFinite(cli)) return cli;
    if (envStr != null) {
        const n = Number.parseFloat(envStr);
        if (Number.isFinite(n)) return n;
    }
    if (cfg != null && Number.isFinite(cfg)) return cfg;
    return def;
}

/** Minimal startup line: no secrets, safe defaults only. */
export function formatEffectiveSettings(opts: {
    port: number;
    dbPath: string | null;
    fileReplaySpeed: number;
    filePath?: string | null;
}): string {
    const effectiveDb = opts.dbPath ?? "disabled";
    const effectiveReplay =
        opts.fileReplaySpeed > 0 ? `speed=${opts.fileReplaySpeed}` : "fast";
    const mode = opts.filePath ? "file" : "live";
    return `Effective settings: port=${opts.port} db=${effectiveDb} replay=${effectiveReplay} mode=${mode}`;
}

// Effective getters for modules that currently read env directly (config < env)
export function getEffectiveLsofDisabled(): boolean {
    const envVal = process.env.TXMON_LSOF_DISABLE;
    if (envVal != null) {
        return envVal === "1";
    }
    const cfg = loadAppConfig();
    const c = getLsofDisable(cfg);
    return c ?? false;
}

export function getEffectiveLsofIntervalMs(): number {
    const envVal = process.env.TXMON_LSOF_INTERVAL_MS;
    if (envVal != null) {
        const n = Number.parseInt(envVal, 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    const cfg = loadAppConfig();
    return getLsofIntervalMs(cfg) ?? 1500;
}

export function getEffectiveCodexTimeoutMs(): number {
    const envVal = process.env.TXMON_CODEX_TIMEOUT_MS;
    if (envVal != null) {
        const n = Number.parseInt(envVal, 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    const cfg = loadAppConfig();
    return getCodexTimeoutMs(cfg) ?? 120000;
}

export function getEffectiveCodexModel(): string {
    const envVal = process.env.TXMON_CODEX_MODEL?.trim();
    if (envVal) return envVal;
    const cfg = loadAppConfig();
    return getCodexModel(cfg) ?? "gpt-5.5";
}
