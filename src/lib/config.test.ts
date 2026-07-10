import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    expandHomePath,
    formatEffectiveSettings,
    getDb,
    getEffectiveCodexModel,
    getEffectiveLsofDisabled,
    getPort,
    loadAppConfig,
    parseConfigContent,
    resetConfigCache,
    resolveDb,
    resolveNumber,
    resolvePortNumber,
} from "./config";

const TEST_DIR = join(process.cwd(), ".tmp-config-test");
const LOCAL_CONFIG_DIR = join(TEST_DIR, ".tx-monitor");
const LOCAL_CONFIG = join(LOCAL_CONFIG_DIR, "config");
const FAKE_HOME = join(TEST_DIR, "home");
const HOME_CONFIG_DIR = join(FAKE_HOME, ".tx-monitor");
const HOME_CONFIG = join(HOME_CONFIG_DIR, "config");

function setupLocalConfig(content: string) {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(LOCAL_CONFIG_DIR, { recursive: true });
    writeFileSync(LOCAL_CONFIG, content, "utf8");
}

function setupHomeConfig(content: string) {
    mkdirSync(HOME_CONFIG_DIR, { recursive: true });
    writeFileSync(HOME_CONFIG, content, "utf8");
}

function cleanup() {
    rmSync(TEST_DIR, { recursive: true, force: true });
}

beforeEach(() => {
    resetConfigCache();
});

afterEach(() => {
    cleanup();
    resetConfigCache();
});

describe("parseConfigContent", () => {
    test("parses allowed safe keys with normalization", () => {
        const cfg = parseConfigContent(
            `
# comment
db=/home/user/.tx-monitor
PORT=3002
file_replay_speed=1.5
TXMON_LSOF_DISABLE=1
codex_model = gpt-test
`,
            { home: "/home/user" },
        );
        expect(cfg.db).toBe("/home/user/.tx-monitor");
        expect(cfg.port).toBe("3002");
        expect(cfg.file_replay_speed).toBe("1.5");
        expect(cfg.lsof_disable).toBe("1");
        expect(cfg.codex_model).toBe("gpt-test");
    });

    test("expands ~ in db path", () => {
        const cfg = parseConfigContent("db=~/.tx-monitor", {
            home: "/home/alice",
        });
        expect(cfg.db).toBe(join("/home/alice", ".tx-monitor"));
    });

    test("ignores unknown keys", () => {
        const cfg = parseConfigContent("foo=bar\nunknown_setting=123");
        expect(Object.keys(cfg).length).toBe(0);
    });

    test("enforces no secrets (by key or value)", () => {
        const cfg = parseConfigContent(`
OPENAI_API_KEY=sk-abc1234567890
db=/ok
MY_SECRET_TOKEN=hidden
TXMON_CODEX_AUTH=api-key
`);
        expect(cfg.db).toBe("/ok");
        expect(cfg.OPENAI_API_KEY).toBeUndefined();
        expect(cfg.MY_SECRET_TOKEN).toBeUndefined();
        expect(cfg.TXMON_CODEX_AUTH).toBeUndefined();
    });

    test("blocks TXMON_TCPDUMP_ARGS from config", () => {
        const cfg = parseConfigContent(`
TXMON_TCPDUMP_ARGS=tcpdump -i eth0
db=/tmp/ok
`);
        expect(cfg.db).toBe("/tmp/ok");
        expect(cfg.TXMON_TCPDUMP_ARGS).toBeUndefined();
        expect(Object.keys(cfg)).toEqual(["db"]);
    });

    test("ignores credential-like values even on allowed-looking keys", () => {
        const cfg = parseConfigContent(`db=sk-1234567890abcdef`);
        // 'db' key is allowed, but value looks like secret; isSecretKey checks value for sk-
        expect(cfg.db).toBeUndefined();
    });
});

describe("expandHomePath", () => {
    test("expands tilde forms", () => {
        expect(expandHomePath("~", "/home/u")).toBe("/home/u");
        expect(expandHomePath("~/data", "/home/u")).toBe(
            join("/home/u", "data"),
        );
        expect(expandHomePath("/abs/path", "/home/u")).toBe("/abs/path");
        expect(expandHomePath("relative", "/home/u")).toBe("relative");
    });
});

describe("resolve helpers (config < env < cli)", () => {
    test("resolveDb: cli wins, then env, then config, then def", () => {
        expect(resolveDb("cli-db", "env-db", "cfg-db", "def")).toBe("cli-db");
        expect(resolveDb(undefined, "env-db", "cfg-db", "def")).toBe("env-db");
        expect(resolveDb(undefined, undefined, "cfg-db", "def")).toBe("cfg-db");
        expect(resolveDb(undefined, undefined, undefined, "def")).toBe("def");
    });

    test("expandHomePath expands env/CLI tilde after resolveDb", () => {
        // server wraps resolveDb with expandHomePath so env/CLI ~/ paths expand
        // (config-file db=~ is expanded at parse time)
        expect(
            expandHomePath(
                resolveDb(undefined, "~/from-env", "/cfg", "/def"),
                "/home/u",
            ),
        ).toBe(join("/home/u", "from-env"));
        expect(
            expandHomePath(
                resolveDb("~/from-cli", "~/from-env", "/cfg", "/def"),
                "/home/u",
            ),
        ).toBe(join("/home/u", "from-cli"));
    });

    test("resolvePortNumber: cli/env/cfg/def with validity", () => {
        expect(resolvePortNumber(4000, "5000", 6000, 3001)).toBe(4000);
        expect(resolvePortNumber(undefined, "5000", 6000, 3001)).toBe(5000);
        expect(resolvePortNumber(undefined, undefined, 6000, 3001)).toBe(6000);
        expect(resolvePortNumber(undefined, "notnum", 6000, 3001)).toBe(6000);
        expect(resolvePortNumber(undefined, undefined, undefined, 3001)).toBe(
            3001,
        );
        expect(resolvePortNumber(-5, undefined, undefined, 3001)).toBe(3001);
    });

    test("resolveNumber: supports float replay speeds", () => {
        expect(resolveNumber(2.5, "3", 1, 0)).toBe(2.5);
        expect(resolveNumber(undefined, "3.5", 1, 0)).toBe(3.5);
        expect(resolveNumber(undefined, undefined, 1.25, 0)).toBe(1.25);
        expect(resolveNumber(undefined, undefined, undefined, 0)).toBe(0);
    });
});

describe("formatEffectiveSettings", () => {
    test("formats without secrets", () => {
        expect(
            formatEffectiveSettings({
                port: 3001,
                dbPath: "/home/u/.tx-monitor",
                fileReplaySpeed: 0,
                filePath: "tcpdump.log",
            }),
        ).toBe(
            "Effective settings: port=3001 db=/home/u/.tx-monitor replay=fast mode=file",
        );
        expect(
            formatEffectiveSettings({
                port: 4000,
                dbPath: null,
                fileReplaySpeed: 2,
                filePath: null,
            }),
        ).toBe(
            "Effective settings: port=4000 db=disabled replay=speed=2 mode=live",
        );
    });
});

describe("loadAppConfig + local file", () => {
    test("loads from local .tx-monitor/config when present", () => {
        setupLocalConfig(`
db=/tmp/testdb
port=9876
file_replay_speed=2
`);
        const prev = process.cwd();
        try {
            process.chdir(TEST_DIR);
            resetConfigCache();
            const cfg = loadAppConfig(process.cwd(), { home: FAKE_HOME });
            expect(getDb(cfg)).toBe("/tmp/testdb");
            expect(getPort(cfg)).toBe(9876);
            expect(cfg.file_replay_speed).toBe("2");
        } finally {
            process.chdir(prev);
            resetConfigCache();
        }
    });

    test("cwd config overrides home config for same key", () => {
        rmSync(TEST_DIR, { recursive: true, force: true });
        setupHomeConfig("port=1111\ndb=/from-home");
        mkdirSync(LOCAL_CONFIG_DIR, { recursive: true });
        writeFileSync(LOCAL_CONFIG, "port=2222", "utf8");
        const prev = process.cwd();
        try {
            process.chdir(TEST_DIR);
            resetConfigCache();
            const cfg = loadAppConfig(process.cwd(), { home: FAKE_HOME });
            expect(getPort(cfg)).toBe(2222);
            expect(getDb(cfg)).toBe("/from-home");
        } finally {
            process.chdir(prev);
            resetConfigCache();
        }
    });

    test("loads port from local config", () => {
        setupLocalConfig("port=2222");
        const prev = process.cwd();
        try {
            process.chdir(TEST_DIR);
            resetConfigCache();
            const cfg = loadAppConfig(process.cwd(), { home: FAKE_HOME });
            expect(getPort(cfg)).toBe(2222);
        } finally {
            process.chdir(prev);
            resetConfigCache();
        }
    });

    test("resolvePortNumber: env overrides config port", () => {
        setupLocalConfig("port=2222");
        const prev = process.cwd();
        try {
            process.chdir(TEST_DIR);
            resetConfigCache();
            const cfg = loadAppConfig(process.cwd(), { home: FAKE_HOME });
            expect(
                resolvePortNumber(undefined, "3333", getPort(cfg), 3001),
            ).toBe(3333);
            expect(
                resolvePortNumber(undefined, undefined, getPort(cfg), 3001),
            ).toBe(2222);
        } finally {
            process.chdir(prev);
            resetConfigCache();
        }
    });
});

describe("effective getters (config < env)", () => {
    // getEffective* call bare loadAppConfig() (real homedir); isolation is via
    // chdir so only the cwd-local .tx-monitor/config key under test applies.
    test("getEffectiveLsofDisabled: env overrides config", () => {
        setupLocalConfig("lsof_disable=1");
        const prev = process.cwd();
        const prevEnv = process.env.TXMON_LSOF_DISABLE;
        try {
            process.chdir(TEST_DIR);
            delete process.env.TXMON_LSOF_DISABLE;
            resetConfigCache();
            expect(getEffectiveLsofDisabled()).toBe(true);

            process.env.TXMON_LSOF_DISABLE = "0";
            resetConfigCache();
            expect(getEffectiveLsofDisabled()).toBe(false);

            process.env.TXMON_LSOF_DISABLE = "1";
            resetConfigCache();
            expect(getEffectiveLsofDisabled()).toBe(true);
        } finally {
            if (prevEnv === undefined) {
                delete process.env.TXMON_LSOF_DISABLE;
            } else {
                process.env.TXMON_LSOF_DISABLE = prevEnv;
            }
            process.chdir(prev);
            resetConfigCache();
        }
    });

    test("getEffectiveCodexModel: env overrides config", () => {
        setupLocalConfig("codex_model=from-config");
        const prev = process.cwd();
        const prevEnv = process.env.TXMON_CODEX_MODEL;
        try {
            process.chdir(TEST_DIR);
            delete process.env.TXMON_CODEX_MODEL;
            resetConfigCache();
            expect(getEffectiveCodexModel()).toBe("from-config");

            process.env.TXMON_CODEX_MODEL = "from-env";
            resetConfigCache();
            expect(getEffectiveCodexModel()).toBe("from-env");
        } finally {
            if (prevEnv === undefined) {
                delete process.env.TXMON_CODEX_MODEL;
            } else {
                process.env.TXMON_CODEX_MODEL = prevEnv;
            }
            process.chdir(prev);
            resetConfigCache();
        }
    });
});
