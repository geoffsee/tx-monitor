export type ProcessInfo = {
    pid: number;
    command: string;
    user: string;
};

export type SocketProto = "TCP" | "UDP";

export function normalizeHost(host: string): string {
    const trimmed = host.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed.slice(1, -1).toLowerCase();
    }
    return trimmed.toLowerCase();
}

export function socketKey(
    proto: SocketProto,
    localHost: string,
    localPort: number,
    remoteHost: string,
    remotePort: number,
): string {
    return `${proto}:${normalizeHost(localHost)}:${localPort}->${normalizeHost(remoteHost)}:${remotePort}`;
}

export function lookupProcess(
    table: Map<string, ProcessInfo>,
    packet: {
        proto: string;
        srcHost: string;
        srcPort: number | null;
        dstHost: string;
        dstPort: number | null;
    },
): ProcessInfo | undefined {
    if (
        (packet.proto !== "TCP" && packet.proto !== "UDP") ||
        packet.srcPort === null ||
        packet.dstPort === null
    ) {
        return undefined;
    }

    const proto = packet.proto as SocketProto;
    const forward = socketKey(
        proto,
        packet.srcHost,
        packet.srcPort,
        packet.dstHost,
        packet.dstPort,
    );
    const match = table.get(forward);
    if (match) {
        return match;
    }

    return table.get(
        socketKey(
            proto,
            packet.dstHost,
            packet.dstPort,
            packet.srcHost,
            packet.srcPort,
        ),
    );
}
