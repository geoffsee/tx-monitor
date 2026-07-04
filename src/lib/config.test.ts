import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    getDb,
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

function setupLocalConfig(content: string) {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(LOCAL_CONFIG_DIR, { recursive: true });
    writeFileSync(LOCAL_CONFIG, content, "utf8");
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
        const cfg = parseConfigContent(`
# comment
db=/home/user/.tx-monitor
PORT=3002
file_replay_speed=1.5
TXMON_LSOF_DISABLE=1
codex_model = gpt-test
`);
        expect(cfg.db).toBe("/home/user/.tx-monitor");
        expect(cfg.port).toBe("3002");
        expect(cfg.file_replay_speed).toBe("1.5");
        expect(cfg.lsof_disable).toBe("1");
        expect(cfg.codex_model).toBe("gpt-test");
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

    test("ignores credential-like values even on allowed-looking keys", () => {
        const cfg = parseConfigContent(`db=sk-1234567890abcdef`);
        // 'db' key is allowed, but value looks like secret; our isSecretKey checks value for sk-
        // current impl skips whole entry if value matches secret pattern
        expect(cfg.db).toBeUndefined();
    });
});

describe("resolve helpers (config < env < cli)", () => {
    test("resolveDb: cli wins, then env, then config, then def", () => {
        expect(resolveDb("cli-db", "env-db", "cfg-db", "def")).toBe("cli-db");
        expect(resolveDb(undefined, "env-db", "cfg-db", "def")).toBe("env-db");
        expect(resolveDb(undefined, undefined, "cfg-db", "def")).toBe("cfg-db");
        expect(resolveDb(undefined, undefined, undefined, "def")).toBe("def");
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

describe("loadAppConfig + local file", () => {
    test("loads from local .tx-monitor/config when present", () => {
        setupLocalConfig(`
db=/tmp/testdb
port=9876
file_replay_speed=2
`);
        // Force cwd to the temp dir so loader finds the local config
        const prev = process.cwd();
        try {
            process.chdir(TEST_DIR);
            resetConfigCache();
            const cfg = loadAppConfig(process.cwd());
            expect(getDb(cfg)).toBe("/tmp/testdb");
            expect(getPort(cfg)).toBe(9876);
            expect(cfg.file_replay_speed).toBe("2");
        } finally {
            process.chdir(prev);
            resetConfigCache();
        }
    });

    test("local config does not override env for getters but load still surfaces it", () => {
        setupLocalConfig("port=2222");
        const prev = process.cwd();
        try {
            process.chdir(TEST_DIR);
            resetConfigCache();
            const cfg = loadAppConfig(process.cwd());
            // config surface
            expect(getPort(cfg)).toBe(2222);
        } finally {
            process.chdir(prev);
            resetConfigCache();
        }
    });
});
