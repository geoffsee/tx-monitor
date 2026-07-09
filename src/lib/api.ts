import type { CaptureSessionSummary, EntityMarker } from "../types";
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

export async function fetchEntityMarkers(
    sessionId: string,
): Promise<EntityMarker[]> {
    const response = await fetch(
        resolveApiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/markers`),
    );
    if (!response.ok) {
        throw new Error(`Failed to load markers (${response.status})`);
    }
    return response.json() as Promise<EntityMarker[]>;
}

export async function saveEntityMarker(
    sessionId: string,
    marker: {
        kind: "host" | "flow";
        id: string;
        pinned?: boolean;
        note?: string | null;
        tags?: string | null;
    },
): Promise<void> {
    const response = await fetch(
        resolveApiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/markers`),
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                kind: marker.kind,
                entityId: marker.id,
                pinned: marker.pinned,
                note: marker.note,
                tags: marker.tags,
            }),
        },
    );
    if (!response.ok) {
        throw new Error(`Failed to save marker (${response.status})`);
    }
}

export { SESSION_PAGE_SIZE };
