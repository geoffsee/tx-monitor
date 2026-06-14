#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import type { ServerWebSocket } from "bun";
import { type ParsedPacket, TcpdumpParser } from "./lib/tcpdumpParser";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const DEFAULT_TCPDUMP = [
    "sudo",
    "tcpdump",
    "-i",
    "any",
    "-Q",
    "out",
    "-nn",
    "-vv",
];
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
    },
    strict: true,
    allowPositionals: false,
});

const filePath = values.file;
const listenPort = values.port ? Number.parseInt(values.port, 10) : PORT;
const serveStatic = values.serve || existsSync(join(DIST, "index.html"));
const clients = new Set<WsClient>();
let captureStarted = false;
const PACKET_BATCH_INTERVAL_MS = 50;
const PACKET_BATCH_MAX = 100;
let pendingPackets: ParsedPacket[] = [];
let packetBatchTimer: ReturnType<typeof setTimeout> | null = null;

function broadcast(message: Record<string, unknown>) {
    const payload = JSON.stringify(message);
    for (const client of clients) {
        client.send(payload);
    }
}

function flushPacketBatch() {
    if (pendingPackets.length === 0) {
        return;
    }
    broadcast({ type: "packets", packets: pendingPackets });
    pendingPackets = [];
    packetBatchTimer = null;
}

function emitPacket(packet: ParsedPacket) {
    const isFirstPacket = pendingPackets.length === 0;
    pendingPackets.push(packet);
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
            emitStatus("file", `file ${path}`);
            await replayFileOnce(path);
            flushPacketBatch();
            broadcast({ type: "complete" });
            await Bun.sleep(750);
        }
    } finally {
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

async function streamLiveTcpdump() {
    emitStatus("live", DEFAULT_TCPDUMP.join(" "));
    const parser = new TcpdumpParser();
    const proc = Bun.spawn({
        cmd: DEFAULT_TCPDUMP,
        stdout: "pipe",
        stderr: "inherit",
    });

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

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        broadcast({
            type: "error",
            message: `tcpdump exited with code ${exitCode}`,
        });
    }
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
            captureStarted = false;
        });
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
    async fetch(request, server) {
        const url = new URL(request.url);
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
                filePath ? `file ${filePath}` : DEFAULT_TCPDUMP.join(" "),
            );
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
if (filePath) {
    console.log(`Replay capture file on connect: ${filePath}`);
} else {
    console.log(`Live capture on connect: ${DEFAULT_TCPDUMP.join(" ")}`);
}
