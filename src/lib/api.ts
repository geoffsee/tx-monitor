import type { CaptureSessionSummary } from "../types";
import type { ClientSecrets } from "./secrets";
import type { PacketProto } from "./tcpdumpParser";

export type StoredPacketRow = {
    id: string;
    timestamp: string;
    proto: PacketProto;
    srcHost: string;
    srcPort: number | null;
    dstHost: string;
    dstPort: number | null;
    length: number;
    info: string;
    receivedAt: number;
    sessionId: string;
};

export type StoredPacket = StoredPacketRow;

const SESSION_PAGE_SIZE = 5000;

export function resolveApiUrl(path: string): string {
    return new URL(path, window.location.origin).toString();
}

export async function fetchSessions(
    limit = 20,
): Promise<CaptureSessionSummary[]> {
    const response = await fetch(resolveApiUrl(`/api/sessions?limit=${limit}`));
    if (!response.ok) {
        throw new Error(`Failed to load sessions (${response.status})`);
    }
    return response.json() as Promise<CaptureSessionSummary[]>;
}

export async function fetchSecrets(): Promise<ClientSecrets> {
    const response = await fetch(resolveApiUrl("/api/secrets"), {
        cache: "no-store",
    });
    if (!response.ok) {
        throw new Error(`Failed to load server config (${response.status})`);
    }
    return response.json() as Promise<ClientSecrets>;
}

export async function fetchSession(
    sessionId: string,
): Promise<CaptureSessionSummary> {
    const response = await fetch(
        resolveApiUrl(`/api/sessions/${encodeURIComponent(sessionId)}`),
    );
    if (!response.ok) {
        throw new Error(`Failed to load session (${response.status})`);
    }
    return response.json() as Promise<CaptureSessionSummary>;
}

export async function fetchSessionPackets(
    sessionId: string,
    offset: number,
    limit = SESSION_PAGE_SIZE,
): Promise<StoredPacketRow[]> {
    const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
    });
    const response = await fetch(
        resolveApiUrl(
            `/api/sessions/${encodeURIComponent(sessionId)}/packets?${params}`,
        ),
    );
    if (!response.ok) {
        throw new Error(`Failed to load session packets (${response.status})`);
    }
    return response.json() as Promise<StoredPacketRow[]>;
}

export { SESSION_PAGE_SIZE };
