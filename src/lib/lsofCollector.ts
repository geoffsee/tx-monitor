import {
    normalizeHost,
    type ProcessInfo,
    type SocketProto,
    socketKey,
} from "./processInfo";

export type SocketTable = Map<string, ProcessInfo>;

const LSOF_COMMAND = ["lsof", "-nP", "+c0", "-iTCP", "-iUDP"];
const LINE_PATTERN =
    /^(\S+)\s+(\d+)\s+(\S+)\s+\S+u?\s+IPv[46]\s+\S+\s+\S+\s+(TCP|UDP)\s+(.+)$/;

function parseHostPort(value: string): { host: string; port: number } | null {
    const trimmed = value.trim();
    const bracketMatch = trimmed.match(/^\[([^\]]+)\]:(\d+)$/);
    if (bracketMatch?.[1] && bracketMatch[2]) {
        return {
            host: bracketMatch[1],
            port: Number.parseInt(bracketMatch[2], 10),
        };
    }

    const plainMatch = trimmed.match(/^([^:*]+):(\d+)$/);
    if (plainMatch?.[1] && plainMatch[2]) {
        return {
            host: plainMatch[1],
            port: Number.parseInt(plainMatch[2], 10),
        };
    }

    return null;
}

function parseSocketName(name: string): {
    proto: SocketProto;
    local: { host: string; port: number };
    remote: { host: string; port: number } | null;
} | null {
    const match = name.match(/^(TCP|UDP)\s+(.+)$/);
    if (!match?.[1] || !match[2]) {
        return null;
    }

    const proto = match[1] as SocketProto;
    const body = match[2].replace(/\s+\([^)]+\)$/, "").trim();
    const [localPart, remotePart] = body.split("->");
    if (!localPart) {
        return null;
    }

    const local = parseHostPort(localPart);
    if (!local) {
        return null;
    }

    const remote = remotePart ? parseHostPort(remotePart) : null;
    if (remotePart && !remote) {
        return null;
    }

    return { proto, local, remote };
}

export function parseLsofOutput(output: string): SocketTable {
    const table: SocketTable = new Map();

    for (const line of output.split(/\r?\n/)) {
        if (!line || line.startsWith("COMMAND")) {
            continue;
        }

        const match = line.match(LINE_PATTERN);
        if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
            continue;
        }

        const socket = parseSocketName(`${match[4]} ${match[5]}`);
        if (!socket?.remote) {
            continue;
        }

        const owner: ProcessInfo = {
            command: match[1],
            pid: Number.parseInt(match[2], 10),
            user: match[3],
        };

        table.set(
            socketKey(
                socket.proto,
                socket.local.host,
                socket.local.port,
                socket.remote.host,
                socket.remote.port,
            ),
            owner,
        );

        table.set(
            socketKey(
                socket.proto,
                socket.remote.host,
                socket.remote.port,
                socket.local.host,
                socket.local.port,
            ),
            owner,
        );
    }

    return table;
}

export async function refreshSocketTable(): Promise<SocketTable> {
    const proc = Bun.spawn({
        cmd: LSOF_COMMAND,
        stdout: "pipe",
        stderr: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(`lsof exited with code ${exitCode}`);
    }
    return parseLsofOutput(text);
}

export function isLsofEnabled(): boolean {
    if (process.env.TXMON_LSOF_DISABLE === "1") {
        return false;
    }
    return process.platform === "darwin" || process.platform === "linux";
}

export function lsofPollIntervalMs(): number {
    const parsed = Number.parseInt(
        process.env.TXMON_LSOF_INTERVAL_MS ?? "1500",
        10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1500;
}

export { normalizeHost };
