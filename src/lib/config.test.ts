import { describe, expect, test } from "bun:test";
import {
    parseConfigFile,
    resolveCodexModel,
    resolveCodexTimeoutMs,
    resolveDbPath,
    resolveFilePath,
    resolveFileReplaySleepCapMs,
    resolveFileReplaySpeed,
    resolveLsofDisabled,
    resolveLsofIntervalMs,
    resolvePort,
    resolveServe,
    resolveTcpdumpArgs,
} from "./config";

describe("parseConfigFile", () => {
    test("parses simple KEY=VALUE and export lines", () => {
        const cfg = parseConfigFile(`
PORT=3002
export TXMON_DB=/data/tx.db
FILE_REPLAY_SPEED=0.5
# comment
TXMON_CODEX_MODEL=gpt-test
`);
        expect(cfg.PORT).toBe("3002");
        expect(cfg.TXMON_DB).toBe("/data/tx.db");
        expect(cfg.FILE_REPLAY_SPEED).toBe("0.5");
        expect(cfg.TXMON_CODEX_MODEL).toBe("gpt-test");
    });

    test("ignores comments and blank lines", () => {
        const cfg = parseConfigFile("# header\n\nFOO=bar\n");
        expect(cfg.FOO).toBe("bar");
        expect(Object.keys(cfg).length).toBe(1);
    });
});

describe("resolvePort", () => {
    test("prefers cli over env over file over default", () => {
        expect(resolvePort("4000")).toBe(4000);
        expect(resolvePort(undefined, { PORT: "3005" }, {})).toBe(3005);
        expect(resolvePort(undefined, {}, { PORT: "3010" })).toBe(3010);
        expect(resolvePort(undefined, {}, {})).toBe(3001);
    });

    test("falls back to default for invalid values", () => {
        expect(resolvePort("not-a-number")).toBe(3001);
        expect(resolvePort(undefined, { PORT: "0" }, {})).toBe(3001);
    });
});

describe("resolveDbPath", () => {
    test("returns null when --no-db flag is set", () => {
        expect(resolveDbPath(undefined, true, {}, {})).toBeNull();
    });

    test("prefers cli db, then env TXMON_DB, then file, then default", () => {
        expect(resolveDbPath("/cli.db", false, {}, {})).toBe("/cli.db");
        expect(resolveDbPath(undefined, false, { TXMON_DB: "/e.db" }, {})).toBe(
            "/e.db",
        );
        expect(resolveDbPath(undefined, false, {}, { TXMON_DB: "/f.db" })).toBe(
            "/f.db",
        );
        expect(resolveDbPath(undefined, false, {}, {})).toBe("tx-mon.db");
    });
});

describe("resolveFilePath", () => {
    test("supports cli, TXMON_FILE env, file 'file' and TXMON_FILE keys", () => {
        expect(resolveFilePath("/cli.log")).toBe("/cli.log");
        expect(resolveFilePath(undefined, { TXMON_FILE: "/e.log" }, {})).toBe(
            "/e.log",
        );
        expect(resolveFilePath(undefined, {}, { file: "/cfile.log" })).toBe(
            "/cfile.log",
        );
        expect(resolveFilePath(undefined, {}, { TXMON_FILE: "/ctx.log" })).toBe(
            "/ctx.log",
        );
    });
});

describe("resolveFileReplaySpeed", () => {
    test("prefers env then file then default 0", () => {
        expect(resolveFileReplaySpeed({ FILE_REPLAY_SPEED: "2" }, {})).toBe(2);
        expect(resolveFileReplaySpeed({}, { FILE_REPLAY_SPEED: "0.25" })).toBe(
            0.25,
        );
        expect(resolveFileReplaySpeed({}, {})).toBe(0);
    });
});

describe("resolveFileReplaySleepCapMs", () => {
    test("prefers env then file then default 120", () => {
        expect(
            resolveFileReplaySleepCapMs({ FILE_REPLAY_SLEEP_CAP_MS: "50" }, {}),
        ).toBe(50);
        expect(resolveFileReplaySleepCapMs({}, {})).toBe(120);
    });
});

describe("resolveCodexModel", () => {
    test("prefers env then file then default", () => {
        expect(resolveCodexModel({ TXMON_CODEX_MODEL: "  m1 " }, {})).toBe(
            "m1",
        );
        expect(resolveCodexModel({}, { TXMON_CODEX_MODEL: "m2" })).toBe("m2");
        expect(resolveCodexModel({}, {})).toBe("gpt-5.5");
    });
});

describe("resolveCodexTimeoutMs", () => {
    test("prefers env then file then default 120000", () => {
        expect(
            resolveCodexTimeoutMs({ TXMON_CODEX_TIMEOUT_MS: "60000" }, {}),
        ).toBe(60000);
        expect(resolveCodexTimeoutMs({}, {})).toBe(120000);
    });
});

describe("resolveTcpdumpArgs", () => {
    test("returns value from env or file", () => {
        expect(
            resolveTcpdumpArgs({ TXMON_TCPDUMP_ARGS: "tcpdump -i eth0" }),
        ).toBe("tcpdump -i eth0");
        expect(
            resolveTcpdumpArgs({}, { TXMON_TCPDUMP_ARGS: "sudo tcpdump" }),
        ).toBe("sudo tcpdump");
    });
});

describe("resolveLsofDisabled / resolveLsofIntervalMs", () => {
    test("lsof disabled only when exactly '1'", () => {
        expect(resolveLsofDisabled({ TXMON_LSOF_DISABLE: "1" })).toBe(true);
        expect(resolveLsofDisabled({ TXMON_LSOF_DISABLE: "0" })).toBe(false);
        expect(resolveLsofDisabled({}, { TXMON_LSOF_DISABLE: "1" })).toBe(true);
    });

    test("lsof interval from env/file or 1500", () => {
        expect(resolveLsofIntervalMs({ TXMON_LSOF_INTERVAL_MS: "800" })).toBe(
            800,
        );
        expect(resolveLsofIntervalMs({}, {})).toBe(1500);
    });
});

describe("resolveServe", () => {
    test("cli true wins; supports env/file truthy values", () => {
        expect(resolveServe(true)).toBe(true);
        expect(resolveServe(false, { SERVE: "1" }, {})).toBe(true);
        expect(resolveServe(undefined, {}, { serve: "true" })).toBe(true);
        expect(resolveServe(undefined, {}, { SERVE: "yes" })).toBe(true);
        expect(resolveServe(undefined, {}, {})).toBe(false);
    });
});
