#!/usr/bin/env bun
import { reverse } from "node:dns/promises";
import { existsSync } from "node:fs";
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
const DEFAULT_DB = "tx-mon.db";

function resolveTcpdumpCommand(): string[] {
    const envArgs = process.env.TXMON_TCPDUMP_ARGS?.trim();
    if (envArgs) {
        const parts = envArgs.split(/\s+/);
        return parts[0] === "sudo" || process.getuid?.() === 0
            ? parts
            : ["sudo", ...parts];
    }

    const args = ["tcpdump", "-i", "any", "-Q", "out", "-nn", "-vv", "-l"];
    return process.getuid?.() === 0 ? args : ["sudo", ...args];
}

const TCPDUMP_COMMAND = resolveTcpdumpCommand();
const TCPDUMP_LABEL = TCPDUMP_COMMAND.join(" ");
const WS_PATH = "/ws";
const DIST = join(PACKAGE_ROOT, "dist");
const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const FILE_REPLAY_SPEED = Number.parseFloat(
    process.env.FILE_REPLAY_SPEED ?? "0",
);
const FILE_REPLAY_SLEEP_CAP_MS = Number.parseFloat(
    process.env.FILE_REPLAY_SLEEP_CAP_MS ?? "120",
);

type WsClient = ServerWebSocket<undefined>;

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".map": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
};

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        file: { type: "string" },
        port: { type: "string" },
        serve: { type: "boolean", default: false },
        db: { type: "string" },
        "no-db": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
});

const filePath = values.file;
const listenPort = values.port ? Number.parseInt(values.port, 10) : PORT;
const serveStatic = values.serve || existsSync(join(DIST, "index.html"));
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
    if (!isLsofEnabled() || filePath) {
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
    broadcast({ type: "status", mode, label });
}

async function replayFileOnce(path: string) {
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
                }
                if (currentTimestamp !== null) {
                    previousTimestamp = currentTimestamp;
                }
            }

            emitPacket(packet);
        }
    }
}

async function replayFile(path: string) {
    try {
        while (clients.size > 0) {
            ensureCaptureSession("file", `file ${path}`);
            emitStatus("file", `file ${path}`);
            await replayFileOnce(path);
            flushPacketBatch();
            broadcast({ type: "complete" });
            await Bun.sleep(750);
        }
    } finally {
        endCaptureSession();
        captureStarted = false;
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

async function streamLiveTcpdump() {
    ensureCaptureSession("live", TCPDUMP_LABEL);
    emitStatus("live", TCPDUMP_LABEL);
    startLsofCollector();
    try {
        const parser = new TcpdumpParser();
        const proc = Bun.spawn({
            cmd: TCPDUMP_COMMAND,
            stdout: "pipe",
            stderr: "pipe",
        });
        const stderrTask = monitorTcpdumpStderr(proc);

        const reader = proc.stdout.getReader();
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
                const packet = parser.parseLine(line);
                if (packet) {
                    emitPacket(packet);
                }
            }
        }

        await stderrTask;
        const exitCode = await proc.exited;
        endCaptureSession();
        if (exitCode !== 0) {
            broadcast({
                type: "error",
                message: `tcpdump exited with code ${exitCode}`,
            });
        }
    } finally {
        stopLsofCollector();
    }
}

function ensureCaptureSession(mode: string, label: string) {
    if (!store || store.getActiveSessionId()) {
        return;
    }
    store.startSession(mode, label);
}

function endCaptureSession() {
    store?.endSession();
}

function startCapture() {
    if (captureStarted) {
        return;
    }
    captureStarted = true;

    const task = filePath ? replayFile(filePath) : streamLiveTcpdump();
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
            endCaptureSession();
            captureStarted = false;
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
        if (existsSync(join(DIST, "index.html"))) {
            return new Response(Bun.file(join(DIST, "index.html")), {
                headers: { "content-type": "text/html" },
            });
        }
        return new Response("Not found", { status: 404 });
    }

    const extension = extname(filePathOnDisk);
    const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
    return new Response(Bun.file(filePathOnDisk), {
        headers: { "content-type": contentType },
    });
}

Bun.serve({
    port: listenPort,
    routes: {
        "/": appHtml,
    },
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

        return new Response("Traffic monitor websocket server", {
            headers: { "content-type": "text/plain" },
        });
    },
    websocket: {
        open(ws) {
            clients.add(ws);
            emitStatus(
                filePath ? "file" : "live",
                filePath ? `file ${filePath}` : TCPDUMP_LABEL,
            );
            sendCachedDns(ws);
            startCapture();
        },
        close(ws) {
            clients.delete(ws);
        },
        message() {},
    },
});

console.log(
    `Traffic monitor websocket listening on ws://localhost:${listenPort}${WS_PATH}`,
);
if (store && dbPath) {
    console.log(`Persisting traffic to ${dbPath}`);
}
if (filePath) {
    console.log(`Replay capture file on connect: ${filePath}`);
} else {
    console.log(`Live capture: ${TCPDUMP_LABEL}`);
    startCapture();
}
