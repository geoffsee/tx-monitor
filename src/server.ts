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
const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const FILE_REPLAY_SPEED = Number.parseFloat(
    process.env.FILE_REPLAY_SPEED ?? "0",
);
const FILE_REPLAY_SLEEP_CAP_MS = Number.parseFloat(
    process.env.FILE_REPLAY_SLEEP_CAP_MS ?? "120",
);

const HOSTNAME = getHostname();

type WsClient = ServerWebSocket<undefined>;

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
            "Env: TXMON_IFACE, TXMON_DIRECTION, TXMON_BPF, TXMON_TCPDUMP_ARGS (full override)",
    );
    process.exit(0);
}

const filePath = values.file;
const listenPort = values.port ? Number.parseInt(values.port, 10) : PORT;
const runningFromSource = import.meta.url.includes("/src/server.ts");
const serveStatic =
    values.serve || (runningFromSource && existsSync(join(DIST, "index.html")));
const dbPath = values["no-db"]
    ? null
    : (values.db ?? process.env.TXMON_DB ?? DEFAULT_DB);
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
const cliIface =
    (values.iface as string | undefined) ?? process.env.TXMON_IFACE;
const cliDirection =
    (values.direction as string | undefined) ?? process.env.TXMON_DIRECTION;
const cliBpf = (values.bpf as string | undefined) ?? process.env.TXMON_BPF;
let captureIface = cliIface ?? "any";
let captureDirection = cliDirection ?? "out";
let captureBpf = cliBpf ?? "";
const activeFilePath: string | null = filePath ?? null;
let useFullOverride = false;
const tcpdumpFullOverride = process.env.TXMON_TCPDUMP_ARGS?.trim() ?? null;
if (tcpdumpFullOverride) {
    useFullOverride = true;
    const iM = tcpdumpFullOverride.match(/-i\s+(\S+)/);
    if (iM?.[1]) captureIface = iM[1];
    const qM = tcpdumpFullOverride.match(/-Q\s+(\S+)/);
    if (qM?.[1]) captureDirection = qM[1];
    // crude tail for bpf after standard flags
    const tail = tcpdumpFullOverride
        .replace(/^(\s*sudo\s+)?\s*tcpdump\s+/, "")
        .replace(/\s*(-i\s+\S+|-Q\s+\S+|-nn|-vv|-l)\s*/g, " ")
        .trim();
    if (tail && !tail.startsWith("-")) {
        captureBpf = tail;
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
    const base = [
        "tcpdump",
        "-i",
        captureIface,
        "-Q",
        captureDirection,
        "-nn",
        "-vv",
        "-l",
    ];
    const b = captureBpf.trim();
    if (b) {
        base.push(...b.split(/\s+/));
    }
    return process.getuid?.() === 0 ? base : ["sudo", ...base];
}

function getLiveLabel(): string {
    return getLiveCommand().join(" ");
}

function packetMatchesBpf(p: ParsedPacket, expr: string): boolean {
    const filter = expr.trim();
    if (!filter) return true;
    const f = filter.toLowerCase();
    const sh = p.srcHost.toLowerCase();
    const dh = p.dstHost.toLowerCase();
    const sp = p.srcPort != null ? String(p.srcPort) : "";
    const dp = p.dstPort != null ? String(p.dstPort) : "";
    const hosts: string[] = [];
    const ports: string[] = [];
    const hostRe = /(?:^|[\s(])(?:(src|dst)\s+)?host\s+([^\s)&|]+)/g;
    for (let m = hostRe.exec(f); m !== null; m = hostRe.exec(f)) {
        if (m[2]) hosts.push(m[2]);
    }
    const portRe = /(?:^|[\s(])(?:(src|dst)\s+)?port\s+([^\s)&|]+)/g;
    for (let m = portRe.exec(f); m !== null; m = portRe.exec(f)) {
        if (m[2]) ports.push(m[2]);
    }
    if (hosts.length === 0 && ports.length === 0) {
        const tokens = f
            .split(/[\s|&()]+/)
            .filter((t) => t && !["and", "or"].includes(t));
        for (const t of tokens) {
            if (t.startsWith("-")) continue;
            if (/[.:]/.test(t) || /^[0-9a-f]{3,}$/.test(t)) {
                hosts.push(t);
            } else if (/^\d+$/.test(t)) {
                ports.push(t);
            }
        }
    }
    const hostOk =
        hosts.length === 0 || hosts.some((h) => sh === h || dh === h);
    const portOk =
        ports.length === 0 || ports.some((pt) => sp === pt || dp === pt);
    return hostOk && portOk;
}

function shouldIncludePacket(p: ParsedPacket): boolean {
    return packetMatchesBpf(p, captureBpf);
}

function applyCaptureUpdate(updates: {
    iface?: string;
    direction?: string;
    bpf?: string;
}) {
    let changed = false;
    if (updates.iface !== undefined) {
        const v = updates.iface.trim() || "any";
        if (v !== captureIface) {
            captureIface = v;
            changed = true;
        }
    }
    if (updates.direction !== undefined) {
        const v = updates.direction;
        if (["in", "out", "inout"].includes(v) && v !== captureDirection) {
            captureDirection = v;
            changed = true;
        }
    }
    if (updates.bpf !== undefined) {
        const v = updates.bpf;
        if (v !== captureBpf) {
            captureBpf = v;
            changed = true;
        }
    }
    if (!changed) return;
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
                if (packet && shouldIncludePacket(packet)) {
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

// Test helpers for exercising capture path (CLI variations, BPF filtering, no regression on file replay)
export function testBuildLiveCommand(
    iface: string,
    direction: string,
    bpf: string,
) {
    const base = ["tcpdump", "-i", iface, "-Q", direction, "-nn", "-vv", "-l"];
    const b = bpf.trim();
    if (b) base.push(...b.split(/\s+/));
    return process.getuid?.() === 0 ? base : ["sudo", ...base];
}
export { packetMatchesBpf as testPacketMatchesBpf };

if (import.meta.main) {
    Bun.serve({
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
                const upgraded = server.upgrade(request);
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
            message(_ws, message) {
                try {
                    const data = JSON.parse(String(message)) as {
                        type?: string;
                        [k: string]: unknown;
                    };
                    if (data.type === "set-capture") {
                        applyCaptureUpdate({
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
