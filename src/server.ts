#!/usr/bin/env bun
import { reverse } from "node:dns/promises";
import { existsSync } from "node:fs";
import { hostname as getHostname, homedir } from "node:os";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import type { ServerWebSocket } from "bun";
import appHtml from "../index.html";
import { openDatabase } from "./db/client";
import { TrafficStore } from "./db/store";
import {
    getDb,
    getFileReplaySleepCapMs,
    getFileReplaySpeed,
    getPort,
    loadAppConfig,
    resolveDb,
    resolvePortNumber,
} from "./lib/config";
import {
    askCopilotWithCodex,
    CopilotRequestError,
    getCopilotStatus,
    parseCopilotRequest,
    validateCopilotSetup,
} from "./lib/copilotServer";
import {
    isLsofEnabled,
    lsofPollIntervalMs,
    refreshSocketTable,
    type SocketTable,
} from "./lib/lsofCollector";
import { lookupProcess } from "./lib/processInfo";
import {
    hostCategory,
    type ParsedPacket,
    TcpdumpParser,
} from "./lib/tcpdumpParser";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const DEFAULT_DB = join(homedir(), ".tx-monitor");

const WS_PATH = "/ws";
const DIST = join(PACKAGE_ROOT, "dist");

// Load config (config file values). Precedence: config < env < CLI
const __appConfig = loadAppConfig();
const FILE_REPLAY_SPEED_BASE = getFileReplaySpeed(__appConfig) ?? 0;
const FILE_REPLAY_SLEEP_CAP_MS_BASE =
    getFileReplaySleepCapMs(__appConfig) ?? 120;

// Env-resolved bases (env overrides config) for replay speeds (no CLI flag for these)
const FILE_REPLAY_SPEED = Number.parseFloat(
    process.env.FILE_REPLAY_SPEED ?? String(FILE_REPLAY_SPEED_BASE),
);
const FILE_REPLAY_SLEEP_CAP_MS = Number.parseFloat(
    process.env.FILE_REPLAY_SLEEP_CAP_MS ??
        String(FILE_REPLAY_SLEEP_CAP_MS_BASE),
);

const HOSTNAME = getHostname();

type WsData = { remoteAddress: string | null };
type WsClient = ServerWebSocket<WsData>;

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".map": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
};

const STATIC_ASSET_EXTENSIONS = new Set([
    ".css",
    ".js",
    ".map",
    ".png",
    ".svg",
    ".woff",
    ".woff2",
]);

function isStaticAssetPath(pathname: string): boolean {
    const extension = extname(pathname.split("?")[0] ?? pathname);
    return STATIC_ASSET_EXTENSIONS.has(extension);
}

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        file: { type: "string" },
        port: { type: "string" },
        serve: { type: "boolean", default: false },
        db: { type: "string" },
        "no-db": { type: "boolean", default: false },
        iface: { type: "string" },
        direction: { type: "string" },
        bpf: { type: "string" },
        help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
});

if (values.help) {
    console.log(
        "Usage: bun run src/server.ts [options]\n\n" +
            "Options:\n" +
            "  --file <path>     Replay from tcpdump log instead of live\n" +
            "  --port <port>     Listen port (default 3001)\n" +
            "  --serve           Serve built dist/\n" +
            "  --db <path>       DB path (default ~/.tx-monitor)\n" +
            "  --no-db           Disable persistence\n" +
            "  --iface <name>    Capture interface (default any)\n" +
            "  --direction <d>   Capture direction in|out|inout (default out)\n" +
            "  --bpf <expr>      BPF filter (e.g. 'host 1.2.3.4 or port 53')\n" +
            "  --help            Show help\n\n" +
            "Env: TXMON_IFACE, TXMON_DIRECTION, TXMON_BPF, TXMON_TCPDUMP_ARGS (full override),\n" +
            "     TXMON_ALLOW_REMOTE_CAPTURE=1 to allow set-capture from non-loopback clients.\n" +
            "Runtime capture control (set-capture) is unauthenticated admin; keep the server\n" +
            "off untrusted networks or restrict to localhost clients (default).",
    );
    process.exit(0);
}

const filePath = values.file;
const listenPort = resolvePortNumber(
    values.port ? Number.parseInt(values.port, 10) : undefined,
    process.env.PORT,
    getPort(__appConfig),
    3001,
);
const runningFromSource = import.meta.url.includes("/src/server.ts");
const serveStatic =
    values.serve || (runningFromSource && existsSync(join(DIST, "index.html")));
const dbPath = values["no-db"]
    ? null
    : resolveDb(
          values.db,
          process.env.TXMON_DB,
          getDb(__appConfig),
          DEFAULT_DB,
      );
const store = dbPath
    ? new TrafficStore(
          openDatabase(
              dbPath.startsWith("/") ? dbPath : join(process.cwd(), dbPath),
          ),
      )
    : null;
const clients = new Set<WsClient>();
let captureStarted = false;

// Capture control state (iface, direction, BPF) with CLI/env init + runtime updates
const IFACE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const ALLOW_REMOTE_CAPTURE =
    process.env.TXMON_ALLOW_REMOTE_CAPTURE === "1" ||
    process.env.TXMON_ALLOW_REMOTE_CAPTURE === "true";

/** Validate live capture interface name (tight charset). */
export function isValidIface(iface: string): boolean {
    return IFACE_RE.test(iface);
}

/**
 * Reject option-like BPF tokens that could inject tcpdump flags when argv-expanded.
 * Returns trimmed expression, or null if invalid.
 */
export function sanitizeBpf(expr: string): string | null {
    const b = expr.trim();
    if (!b) return "";
    if (b.split(/\s+/).some((t) => t.startsWith("-"))) {
        return null;
    }
    return b;
}

/**
 * Build tcpdump argv for live capture. Pure helper used by production path and tests.
 * BPF is passed as a single expression after `--` so tokens cannot be parsed as options.
 */
export function buildLiveCommand(
    iface: string,
    direction: string,
    bpf: string,
    uid: number | null = process.getuid?.() ?? null,
): string[] {
    const safeIface = isValidIface(iface) ? iface : "any";
    const safeDir = ["in", "out", "inout"].includes(direction)
        ? direction
        : "out";
    const base = [
        "tcpdump",
        "-i",
        safeIface,
        "-Q",
        safeDir,
        "-nn",
        "-vv",
        "-l",
        "--",
    ];
    const b = bpf.trim();
    if (b) {
        if (b.split(/\s+/).some((t) => t.startsWith("-"))) {
            throw new Error("BPF must not contain option-like tokens");
        }
        base.push(b);
    }
    return uid === 0 ? base : ["sudo", ...base];
}

function isLoopbackAddress(address: string | null | undefined): boolean {
    if (!address) return false;
    if (
        address === "127.0.0.1" ||
        address === "::1" ||
        address === "0:0:0:0:0:0:0:1"
    ) {
        return true;
    }
    // IPv4-mapped IPv6 (Bun dual-stack requestIP for 127.0.0.1 clients)
    if (address.startsWith("::ffff:127.") || address.startsWith(":ffff:127.")) {
        return true;
    }
    return false;
}

const cliIface =
    (values.iface as string | undefined) ?? process.env.TXMON_IFACE;
const cliDirection =
    (values.direction as string | undefined) ?? process.env.TXMON_DIRECTION;
const cliBpf = (values.bpf as string | undefined) ?? process.env.TXMON_BPF;
let captureIface =
    cliIface && isValidIface(cliIface.trim() || "any")
        ? cliIface.trim() || "any"
        : "any";
let captureDirection =
    cliDirection && ["in", "out", "inout"].includes(cliDirection)
        ? cliDirection
        : "out";
const sanitizedCliBpf = sanitizeBpf(cliBpf ?? "");
let captureBpf = sanitizedCliBpf ?? "";
if (cliBpf && sanitizedCliBpf === null) {
    console.error(
        "Ignoring invalid --bpf / TXMON_BPF (option-like tokens not allowed)",
    );
}
const activeFilePath: string | null = filePath ?? null;
let useFullOverride = false;
const tcpdumpFullOverride = process.env.TXMON_TCPDUMP_ARGS?.trim() ?? null;
if (tcpdumpFullOverride) {
    useFullOverride = true;
    const iM = tcpdumpFullOverride.match(/-i\s+(\S+)/);
    if (iM?.[1] && isValidIface(iM[1])) captureIface = iM[1];
    const qM = tcpdumpFullOverride.match(/-Q\s+(\S+)/);
    if (qM?.[1] && ["in", "out", "inout"].includes(qM[1])) {
        captureDirection = qM[1];
    }
    // crude tail for bpf after standard flags
    const tail = tcpdumpFullOverride
        .replace(/^(\s*sudo\s+)?\s*tcpdump\s+/, "")
        .replace(/\s*(-i\s+\S+|-Q\s+\S+|-nn|-vv|-l)\s*/g, " ")
        .trim();
    if (tail) {
        const s = sanitizeBpf(tail);
        if (s !== null) captureBpf = s;
    }
}

let liveProc: ReturnType<typeof Bun.spawn> | null = null;
let captureGeneration = 0;

function getLiveCommand(): string[] {
    if (useFullOverride && tcpdumpFullOverride) {
        const parts = tcpdumpFullOverride.split(/\s+/);
        return parts[0] === "sudo" || process.getuid?.() === 0
            ? parts
            : ["sudo", ...parts];
    }
    return buildLiveCommand(captureIface, captureDirection, captureBpf);
}

function getLiveLabel(): string {
    return getLiveCommand().join(" ");
}

/** Match a single host/port atomic clause (no top-level and/or). */
function matchAtomicBpfClause(p: ParsedPacket, clause: string): boolean {
    const c = clause.replace(/[()]/g, " ").trim().toLowerCase();
    if (!c) return true;
    const sh = p.srcHost.toLowerCase();
    const dh = p.dstHost.toLowerCase();
    const sp = p.srcPort != null ? String(p.srcPort) : "";
    const dp = p.dstPort != null ? String(p.dstPort) : "";

    const hostM = c.match(/^(?:(src|dst)\s+)?host\s+(\S+)$/);
    if (hostM?.[2]) {
        const h = hostM[2];
        if (hostM[1] === "src") return sh === h;
        if (hostM[1] === "dst") return dh === h;
        return sh === h || dh === h;
    }
    const portM = c.match(/^(?:(src|dst)\s+)?port\s+(\S+)$/);
    if (portM?.[2]) {
        const pt = portM[2];
        if (portM[1] === "src") return sp === pt;
        if (portM[1] === "dst") return dp === pt;
        return sp === pt || dp === pt;
    }

    // Fallback token heuristic for bare host/port-ish tokens
    const hosts: string[] = [];
    const ports: string[] = [];
    const tokens = c
        .split(/[\s|&]+/)
        .filter((t) => t && !["and", "or"].includes(t));
    for (const t of tokens) {
        if (t.startsWith("-")) continue;
        if (/[.:]/.test(t) || /^[0-9a-f]{3,}$/.test(t)) {
            hosts.push(t);
        } else if (/^\d+$/.test(t)) {
            ports.push(t);
        }
    }
    if (hosts.length === 0 && ports.length === 0) {
        // Unrecognized clause (e.g. net/tcp): pass so we don't over-drop
        return true;
    }
    const hostOk =
        hosts.length === 0 || hosts.some((h) => sh === h || dh === h);
    const portOk =
        ports.length === 0 || ports.some((pt) => sp === pt || dp === pt);
    return hostOk && portOk;
}

/**
 * Basic post-filter for file replay only. Supports host/port clauses combined
 * with top-level `and` / `or` (and binds tighter than or, matching common BPF use).
 */
function packetMatchesBpf(p: ParsedPacket, expr: string): boolean {
    const filter = expr.trim();
    if (!filter) return true;
    const f = filter.toLowerCase();
    // Split on top-level " or " (outside parentheses)
    const orClauses: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < f.length; i++) {
        const ch = f[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (depth === 0 && f.slice(i, i + 4) === " or ") {
            orClauses.push(f.slice(start, i));
            start = i + 4;
            i += 3;
        }
    }
    orClauses.push(f.slice(start));

    return orClauses.some((orClause) => {
        const andParts: string[] = [];
        depth = 0;
        start = 0;
        const clause = orClause;
        for (let i = 0; i < clause.length; i++) {
            const ch = clause[i];
            if (ch === "(") depth++;
            else if (ch === ")") depth = Math.max(0, depth - 1);
            else if (depth === 0 && clause.slice(i, i + 5) === " and ") {
                andParts.push(clause.slice(start, i));
                start = i + 5;
                i += 4;
            }
        }
        andParts.push(clause.slice(start));
        return andParts.every((part) => matchAtomicBpfClause(p, part));
    });
}

function shouldIncludePacket(p: ParsedPacket): boolean {
    return packetMatchesBpf(p, captureBpf);
}

function applyCaptureUpdate(updates: {
    iface?: string;
    direction?: string;
    bpf?: string;
}): string | null {
    // Validate all fields first so a bad bpf never partially applies iface/dir
    let nextIface: string | undefined;
    let nextDirection: string | undefined;
    let nextBpf: string | undefined;
    if (updates.iface !== undefined) {
        const v = updates.iface.trim() || "any";
        if (!isValidIface(v)) {
            return `Invalid iface "${v}" (allowed: A-Za-z0-9_.:-)`;
        }
        nextIface = v;
    }
    if (updates.direction !== undefined) {
        const v = updates.direction;
        if (!["in", "out", "inout"].includes(v)) {
            return `Invalid direction "${v}" (use in|out|inout)`;
        }
        nextDirection = v;
    }
    if (updates.bpf !== undefined) {
        const sanitized = sanitizeBpf(updates.bpf);
        if (sanitized === null) {
            return "BPF must not contain option-like tokens";
        }
        nextBpf = sanitized;
    }

    let changed = false;
    if (nextIface !== undefined && nextIface !== captureIface) {
        captureIface = nextIface;
        changed = true;
    }
    if (nextDirection !== undefined && nextDirection !== captureDirection) {
        captureDirection = nextDirection;
        changed = true;
    }
    if (nextBpf !== undefined && nextBpf !== captureBpf) {
        captureBpf = nextBpf;
        changed = true;
    }
    if (!changed) return null;
    useFullOverride = false;
    const newLabel = activeFilePath ? `file ${activeFilePath}` : getLiveLabel();
    console.log(
        `Updated capture: iface=${captureIface} dir=${captureDirection} bpf="${captureBpf}"`,
    );
    const isLive = !activeFilePath;
    if (isLive) {
        captureGeneration += 1;
        if (liveProc) {
            try {
                liveProc.kill();
            } catch {
                /* ignore */
            }
            liveProc = null;
        }
        captureStarted = false;
        startCapture();
    }
    // file mode: BPF filter applies to subsequent parsed packets without restart
    emitStatus(activeFilePath ? "file" : "live", newLabel);
    return null;
}

const PACKET_BATCH_INTERVAL_MS = 50;
const PACKET_BATCH_MAX = 100;
let pendingPackets: ParsedPacket[] = [];
let packetBatchTimer: ReturnType<typeof setTimeout> | null = null;
let socketTable: SocketTable = new Map();
let lsofTimer: ReturnType<typeof setInterval> | null = null;
const dnsCache = new Map<string, string | null>();
const pendingDnsLookups = new Set<string>();

function enrichPacket(packet: ParsedPacket): ParsedPacket {
    const process = lookupProcess(socketTable, packet);
    return process ? { ...packet, process } : packet;
}

function startLsofCollector() {
    if (!isLsofEnabled() || activeFilePath) {
        return;
    }

    const refresh = async () => {
        try {
            socketTable = await refreshSocketTable();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "lsof refresh failed";
            console.error(message);
        }
    };

    void refresh();
    lsofTimer = setInterval(() => {
        void refresh();
    }, lsofPollIntervalMs());
}

function stopLsofCollector() {
    if (lsofTimer) {
        clearInterval(lsofTimer);
        lsofTimer = null;
    }
    socketTable = new Map();
}

function broadcast(message: Record<string, unknown>) {
    const payload = JSON.stringify(message);
    for (const client of clients) {
        client.send(payload);
    }
}

function normalizeDnsName(name: string): string {
    return name.trim().replace(/\.$/, "");
}

function scheduleReverseDnsLookup(host: string) {
    if (
        hostCategory(host) !== "public" ||
        dnsCache.has(host) ||
        pendingDnsLookups.has(host)
    ) {
        return;
    }

    pendingDnsLookups.add(host);
    void reverse(host)
        .then((names) => {
            const name = names.map(normalizeDnsName).find(Boolean) ?? null;
            dnsCache.set(host, name);
            if (name) {
                broadcast({ type: "dns", host, name });
            }
        })
        .catch(() => {
            dnsCache.set(host, null);
        })
        .finally(() => {
            pendingDnsLookups.delete(host);
        });
}

function sendCachedDns(ws: WsClient) {
    for (const [host, name] of dnsCache) {
        if (name) {
            ws.send(JSON.stringify({ type: "dns", host, name }));
        }
    }
}

function flushPacketBatch() {
    if (pendingPackets.length === 0) {
        return;
    }
    const batch = pendingPackets;
    pendingPackets = [];
    packetBatchTimer = null;
    broadcast({ type: "packets", packets: batch });
    store?.savePackets(batch);
}

function emitPacket(packet: ParsedPacket) {
    const enriched = enrichPacket(packet);
    scheduleReverseDnsLookup(enriched.srcHost);
    scheduleReverseDnsLookup(enriched.dstHost);
    const isFirstPacket = pendingPackets.length === 0;
    pendingPackets.push(enriched);
    if (pendingPackets.length >= PACKET_BATCH_MAX) {
        if (packetBatchTimer) {
            clearTimeout(packetBatchTimer);
        }
        flushPacketBatch();
        return;
    }
    if (packetBatchTimer) {
        return;
    }
    packetBatchTimer = setTimeout(
        () => flushPacketBatch(),
        isFirstPacket ? 0 : PACKET_BATCH_INTERVAL_MS,
    );
}

function emitStatus(mode: string, label: string) {
    broadcast({
        type: "status",
        mode,
        label,
        iface: captureIface,
        direction: captureDirection,
        bpf: captureBpf,
    });
}

async function replayFileOnce(path: string, expectedGen = captureGeneration) {
    const resolved = join(process.cwd(), path);
    if (!existsSync(resolved)) {
        throw new Error(`File not found: ${resolved}`);
    }

    const parser = new TcpdumpParser();
    const stream = Bun.file(resolved).stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let previousTimestamp: number | null = null;
    const replayRealtime = FILE_REPLAY_SPEED > 0;

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            if (captureGeneration !== expectedGen) {
                return;
            }
            const packet = parser.parseLine(line);
            if (!packet) {
                continue;
            }

            if (replayRealtime) {
                const currentTimestamp = timestampToMs(packet.timestamp);
                if (previousTimestamp !== null && currentTimestamp !== null) {
                    const delta = Math.max(
                        0,
                        currentTimestamp - previousTimestamp,
                    );
                    const delay = Math.min(
                        delta / FILE_REPLAY_SPEED,
                        FILE_REPLAY_SLEEP_CAP_MS,
                    );
                    if (delay > 0) {
                        await Bun.sleep(delay);
                    }
                    if (captureGeneration !== expectedGen) {
                        return;
                    }
                }
                if (currentTimestamp !== null) {
                    previousTimestamp = currentTimestamp;
                }
            }

            if (shouldIncludePacket(packet)) {
                emitPacket(packet);
            }
        }
    }
}

// replayFile and replayFileOnce also use only TcpdumpParser + tcpdump text files
// (zero-dependency ingestion boundary retained per #39).
async function replayFile(path: string, expectedGen = captureGeneration) {
    try {
        while (clients.size > 0 && captureGeneration === expectedGen) {
            ensureCaptureSession("file", `file ${path}`);
            emitStatus("file", `file ${path}`);
            await replayFileOnce(path, expectedGen);
            flushPacketBatch();
            broadcast({ type: "complete" });
            await Bun.sleep(750);
            if (captureGeneration !== expectedGen) break;
        }
    } finally {
        if (captureGeneration === expectedGen) {
            endCaptureSession();
            captureStarted = false;
        }
    }
}

function timestampToMs(timestamp: string): number | null {
    const match = timestamp.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
    if (!match) {
        return null;
    }

    const [, hoursStr, minutesStr, secondsStr, fractionStr] = match;
    if (!hoursStr || !minutesStr || !secondsStr || !fractionStr) {
        return null;
    }

    const hours = Number.parseInt(hoursStr, 10);
    const minutes = Number.parseInt(minutesStr, 10);
    const seconds = Number.parseInt(secondsStr, 10);
    const fraction = fractionStr.padEnd(6, "0").slice(0, 6);
    const micros = Number.parseInt(fraction, 10);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + micros / 1000;
}

async function monitorTcpdumpStderr(proc: ReturnType<typeof Bun.spawn>) {
    if (!proc.stderr || typeof proc.stderr === "number") {
        return;
    }

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("tcpdump: listening on")) {
                continue;
            }
            console.error(trimmed);
            broadcast({ type: "error", message: trimmed });
        }
    }
}

// Retention guard (#39): live and file ingestion both route exclusively through
// TcpdumpParser on human-readable tcpdump text. This is the canonical boundary.
async function streamLiveTcpdump(expectedGen = captureGeneration) {
    const myGen = expectedGen;
    ensureCaptureSession("live", getLiveLabel());
    emitStatus("live", getLiveLabel());
    startLsofCollector();
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    try {
        const parser = new TcpdumpParser();
        const cmd = getLiveCommand();
        proc = Bun.spawn({
            cmd,
            stdout: "pipe",
            stderr: "pipe",
        });
        liveProc = proc;
        const stderrTask = monitorTcpdumpStderr(proc);

        const reader = (
            proc.stdout as unknown as {
                getReader(): ReadableStreamDefaultReader<Uint8Array>;
            }
        ).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            if (captureGeneration !== myGen) {
                break;
            }
            const { value, done } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (captureGeneration !== myGen) {
                    break;
                }
                const packet = parser.parseLine(line);
                // Live path: tcpdump already applied BPF; do not double-filter
                if (packet) {
                    emitPacket(packet);
                }
            }
        }

        await stderrTask;
        const exitCode = await (proc as unknown as { exited: Promise<number> })
            .exited;
        if (captureGeneration === myGen) {
            endCaptureSession();
            if (exitCode !== 0) {
                broadcast({
                    type: "error",
                    message: `tcpdump exited with code ${exitCode}`,
                });
            }
        }
    } finally {
        if (liveProc === proc) {
            liveProc = null;
        }
        stopLsofCollector();
        if (captureGeneration === myGen) {
            endCaptureSession();
        }
    }
}

function ensureCaptureSession(mode: string, label: string) {
    if (!store || store.getActiveSessionId()) {
        return;
    }
    const cmdline = mode === "live" ? getLiveCommand().join(" ") : label;
    store.startSession(mode, label, {
        hostname: HOSTNAME,
        cmdline,
    });
}

function endCaptureSession() {
    store?.endSession();
}

function startCapture() {
    if (captureStarted) {
        return;
    }
    captureStarted = true;

    const launchGen = captureGeneration;
    const task = activeFilePath
        ? replayFile(activeFilePath, launchGen)
        : streamLiveTcpdump(launchGen);
    void task
        .catch((error: unknown) => {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unknown capture error";
            console.error(message);
            broadcast({ type: "error", message });
        })
        .finally(() => {
            if (captureGeneration === launchGen) {
                endCaptureSession();
                captureStarted = false;
            }
        });
}

function jsonResponse(
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        throw new CopilotRequestError("Expected valid JSON body.");
    }
}

async function handleApiRequest(
    request: Request,
    url: URL,
): Promise<Response | null> {
    if (!url.pathname.startsWith("/api/")) {
        return null;
    }

    if (url.pathname === "/api/copilot/status") {
        if (request.method !== "GET") {
            return jsonResponse({ error: "Method not allowed" }, 405, {
                allow: "GET",
            });
        }
        const doValidate = url.searchParams.get("validate") === "true";
        const status = getCopilotStatus();
        if (!doValidate) {
            return jsonResponse(status, 200, {
                "cache-control": "no-store",
            });
        }
        try {
            const validation = await validateCopilotSetup();
            return jsonResponse({ ...status, validation }, 200, {
                "cache-control": "no-store",
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Copilot validation failed.";
            return jsonResponse(
                { ...status, validation: { success: false, message } },
                200,
                { "cache-control": "no-store" },
            );
        }
    }

    // /api/copilot retains strict client-provided snapshot model (context from
    // caller only). No ambient or server-initiated streaming per #39 guard.
    if (url.pathname === "/api/copilot") {
        if (request.method !== "POST") {
            return jsonResponse({ error: "Method not allowed" }, 405, {
                allow: "POST",
            });
        }

        try {
            const body = await readJsonBody(request);
            const payload = parseCopilotRequest(body);
            const result = await askCopilotWithCodex(payload);
            return jsonResponse(result, 200, {
                "cache-control": "no-store",
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Copilot request failed.";
            const status = error instanceof CopilotRequestError ? 400 : 502;
            console.error(message);
            return jsonResponse({ error: message }, status, {
                "cache-control": "no-store",
            });
        }
    }

    if (!store) {
        return jsonResponse({ error: "Persistence is disabled" }, 503);
    }

    if (url.pathname === "/api/sessions") {
        const limit = Number.parseInt(
            url.searchParams.get("limit") ?? "20",
            10,
        );
        return jsonResponse(store.listSessions(limit));
    }

    const sessionMatch = url.pathname.match(
        /^\/api\/sessions\/([^/]+)(\/packets)?$/,
    );
    if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
        const session = store.getSession(sessionId);
        if (!session) {
            return jsonResponse({ error: "Session not found" }, 404);
        }

        if (sessionMatch[2] === "/packets") {
            const offset = Number.parseInt(
                url.searchParams.get("offset") ?? "0",
                10,
            );
            const limit = Number.parseInt(
                url.searchParams.get("limit") ?? "5000",
                10,
            );
            const rows = store.listSessionPackets(sessionId, offset, limit);
            return jsonResponse(
                rows.map((row) => ({
                    id: row.id,
                    timestamp: row.timestamp,
                    proto: row.proto,
                    srcHost: row.srcHost,
                    srcPort: row.srcPort,
                    dstHost: row.dstHost,
                    dstPort: row.dstPort,
                    length: row.length,
                    info: row.info,
                    receivedAt: row.receivedAt,
                    sessionId: row.sessionId,
                })),
            );
        }

        return jsonResponse(session);
    }

    if (url.pathname === "/api/packets") {
        const limit = Number.parseInt(
            url.searchParams.get("limit") ?? "80",
            10,
        );
        const sessionId = url.searchParams.get("session") ?? undefined;
        const rows = store.listRecentPackets(limit, sessionId);
        return jsonResponse(
            rows.map((row) => ({
                id: row.id,
                timestamp: row.timestamp,
                proto: row.proto,
                srcHost: row.srcHost,
                srcPort: row.srcPort,
                dstHost: row.dstHost,
                dstPort: row.dstPort,
                length: row.length,
                info: row.info,
                receivedAt: row.receivedAt,
                sessionId: row.sessionId,
            })),
        );
    }

    const markersMatch = url.pathname.match(
        /^\/api\/sessions\/([^/]+)\/markers$/,
    );
    if (markersMatch) {
        const sessionId = decodeURIComponent(markersMatch[1] ?? "");
        const session = store.getSession(sessionId);
        if (!session) {
            return jsonResponse({ error: "Session not found" }, 404);
        }
        if (request.method === "GET") {
            return jsonResponse(store.getEntityMarkers(sessionId));
        }
        if (request.method === "POST" || request.method === "PUT") {
            try {
                const body = (await readJsonBody(request)) as {
                    kind?: string;
                    entityId?: string;
                    pinned?: boolean;
                    note?: string | null;
                    tags?: string | null;
                };
                if (
                    !body ||
                    (body.kind !== "host" && body.kind !== "flow") ||
                    !body.entityId
                ) {
                    return jsonResponse(
                        { error: "Invalid marker payload" },
                        400,
                    );
                }
                store.setEntityMarker(sessionId, {
                    kind: body.kind,
                    entityId: body.entityId,
                    pinned: body.pinned,
                    note: body.note,
                    tags: body.tags,
                });
                return jsonResponse({ ok: true });
            } catch {
                return jsonResponse({ error: "Bad request" }, 400);
            }
        }
        return jsonResponse({ error: "Method not allowed" }, 405, {
            allow: "GET,POST",
        });
    }

    return jsonResponse({ error: "Not found" }, 404);
}

async function serveStaticFile(pathname: string): Promise<Response> {
    const relativePath = pathname === "/" ? "/index.html" : pathname;
    const filePathOnDisk = join(DIST, relativePath);

    if (!existsSync(filePathOnDisk)) {
        if (
            !isStaticAssetPath(relativePath) &&
            existsSync(join(DIST, "index.html"))
        ) {
            return new Response(Bun.file(join(DIST, "index.html")), {
                headers: { "content-type": "text/html" },
            });
        }
        return new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain" },
        });
    }

    const extension = extname(filePathOnDisk);
    const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
    return new Response(Bun.file(filePathOnDisk), {
        headers: { "content-type": contentType },
    });
}

// Test helpers: thin wrappers around production pure functions (no reimplementation)
export function testBuildLiveCommand(
    iface: string,
    direction: string,
    bpf: string,
) {
    return buildLiveCommand(iface, direction, bpf);
}
export {
    isLoopbackAddress as testIsLoopbackAddress,
    isValidIface as testIsValidIface,
    packetMatchesBpf as testPacketMatchesBpf,
    sanitizeBpf as testSanitizeBpf,
};

if (import.meta.main) {
    Bun.serve<WsData>({
        port: listenPort,
        ...(serveStatic
            ? {}
            : {
                  routes: {
                      "/": appHtml,
                  },
              }),
        async fetch(request, server) {
            const url = new URL(request.url);
            const apiResponse = await handleApiRequest(request, url);
            if (apiResponse) {
                return apiResponse;
            }

            if (url.pathname === WS_PATH) {
                const ip = server.requestIP(request);
                const upgraded = server.upgrade(request, {
                    data: {
                        remoteAddress: ip?.address ?? null,
                    } satisfies WsData,
                });
                if (!upgraded) {
                    return new Response("WebSocket upgrade failed", {
                        status: 400,
                    });
                }
                return undefined;
            }

            if (serveStatic) {
                return serveStaticFile(url.pathname);
            }

            if (isStaticAssetPath(url.pathname)) {
                return new Response("Not found", {
                    status: 404,
                    headers: { "content-type": "text/plain" },
                });
            }

            return new Response("Traffic monitor websocket server", {
                headers: { "content-type": "text/plain" },
            });
        },
        websocket: {
            open(ws) {
                clients.add(ws);
                const mode0 = activeFilePath ? "file" : "live";
                const label0 = activeFilePath
                    ? `file ${activeFilePath}`
                    : getLiveLabel();
                emitStatus(mode0, label0);
                sendCachedDns(ws);
                startCapture();
            },
            close(ws) {
                clients.delete(ws);
            },
            message(ws, message) {
                try {
                    const data = JSON.parse(String(message)) as {
                        type?: string;
                        [k: string]: unknown;
                    };
                    if (data.type === "set-capture") {
                        // Privileged control plane: loopback clients only unless opted in
                        if (
                            !ALLOW_REMOTE_CAPTURE &&
                            !isLoopbackAddress(ws.data.remoteAddress)
                        ) {
                            ws.send(
                                JSON.stringify({
                                    type: "error",
                                    message:
                                        "set-capture allowed from localhost only (set TXMON_ALLOW_REMOTE_CAPTURE=1 to override)",
                                }),
                            );
                            return;
                        }
                        const err = applyCaptureUpdate({
                            iface:
                                typeof data.iface === "string"
                                    ? data.iface
                                    : undefined,
                            direction:
                                typeof data.direction === "string"
                                    ? data.direction
                                    : undefined,
                            bpf:
                                typeof data.bpf === "string"
                                    ? data.bpf
                                    : undefined,
                        });
                        if (err) {
                            ws.send(
                                JSON.stringify({
                                    type: "error",
                                    message: err,
                                }),
                            );
                        }
                    }
                } catch {
                    // ignore malformed control messages
                }
            },
        },
    });

    console.log(
        `Traffic monitor websocket listening on ws://localhost:${listenPort}${WS_PATH}`,
    );
    if (!ALLOW_REMOTE_CAPTURE) {
        console.log(
            "Capture control (set-capture) restricted to localhost clients; set TXMON_ALLOW_REMOTE_CAPTURE=1 to allow remote",
        );
    }
    // Minimal effective settings exposure (no secrets)
    const effectiveDb = dbPath ?? "disabled";
    const effectiveReplay =
        FILE_REPLAY_SPEED > 0 ? `speed=${FILE_REPLAY_SPEED}` : "fast";
    console.log(
        `Effective settings: port=${listenPort} db=${effectiveDb} replay=${effectiveReplay}`,
    );
    if (store && dbPath) {
        console.log(`Persisting traffic to ${dbPath}`);
    }
    if (activeFilePath) {
        console.log(`Replay capture file on connect: ${activeFilePath}`);
    } else {
        console.log(`Live capture: ${getLiveLabel()}`);
        startCapture();
    }
}
