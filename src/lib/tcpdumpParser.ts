import type { ProcessInfo } from "./processInfo";

export type PacketProto = "TCP" | "UDP" | "ICMP" | "OTHER";

export type ParsedPacket = {
    id: string;
    timestamp: string;
    proto: PacketProto;
    srcHost: string;
    srcPort: number | null;
    dstHost: string;
    dstPort: number | null;
    length: number;
    info: string;
    process?: ProcessInfo;
};

type PendingHeader = {
    timestamp: string;
    proto: PacketProto;
    length: number;
};

let packetCounter = 0;

function nextPacketId(): string {
    packetCounter += 1;
    return `pkt-${packetCounter}`;
}

function extractProto(line: string): PacketProto {
    const match = line.match(/(?:proto|next-header)\s+(TCP|UDP|ICMP)\s*\(/i);
    if (!match?.[1]) {
        return "OTHER";
    }
    return match[1].toUpperCase() as PacketProto;
}

function extractLength(line: string): number {
    const match = line.match(/length[:\s]+(\d+)/i);
    return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

function extractFlow(line: string): {
    srcHost: string;
    srcPort: number | null;
    dstHost: string;
    dstPort: number | null;
    info: string;
} | null {
    const match = line.match(
        /([0-9a-fA-F:.]+)\.(\d+)\s+>\s+([0-9a-fA-F:.]+)\.(\d+):\s*(.*)$/,
    );
    if (!match) {
        return null;
    }

    const [, srcHost, srcPortStr, dstHost, dstPortStr, info = ""] = match;
    if (!srcHost || !srcPortStr || !dstHost || !dstPortStr) {
        return null;
    }

    return {
        srcHost,
        srcPort: Number.parseInt(srcPortStr, 10),
        dstHost,
        dstPort: Number.parseInt(dstPortStr, 10),
        info: info.trim(),
    };
}

function isHeaderLine(line: string): boolean {
    return /^\d{2}:\d{2}:\d{2}\.\d+\s+IP6?\s+\(/.test(line);
}

// Retention (per #39 / #40): tcpdump text output is the canonical zero-dependency
// ingestion boundary. Parser is conservative and supports only what tcpdump lines
// provide; do not infer, widen, or add alternate parsers without explicit signal.
export class TcpdumpParser {
    private pendingHeader: PendingHeader | null = null;

    parseLine(line: string): ParsedPacket | null {
        const trimmed = line.trim();
        if (!trimmed) {
            return null;
        }

        if (isHeaderLine(trimmed)) {
            const timestampMatch = trimmed.match(/^(\d{2}:\d{2}:\d{2}\.\d+)/);
            const timestamp = timestampMatch?.[1] ?? "00:00:00.000000";
            const proto = extractProto(trimmed);
            const length = extractLength(trimmed);
            const inlineFlow = extractFlow(trimmed);

            if (inlineFlow) {
                return {
                    id: nextPacketId(),
                    timestamp,
                    proto,
                    srcHost: inlineFlow.srcHost,
                    srcPort: inlineFlow.srcPort,
                    dstHost: inlineFlow.dstHost,
                    dstPort: inlineFlow.dstPort,
                    length,
                    info: inlineFlow.info,
                };
            }

            this.pendingHeader = { timestamp, proto, length };
            return null;
        }

        if (this.pendingHeader) {
            const flow = extractFlow(trimmed);
            if (!flow) {
                return null;
            }

            const packet: ParsedPacket = {
                id: nextPacketId(),
                timestamp: this.pendingHeader.timestamp,
                proto: this.pendingHeader.proto,
                srcHost: flow.srcHost,
                srcPort: flow.srcPort,
                dstHost: flow.dstHost,
                dstPort: flow.dstPort,
                length: this.pendingHeader.length,
                info: flow.info,
            };
            this.pendingHeader = null;
            return packet;
        }

        return null;
    }
}

export function hostCategory(address: string): "local" | "private" | "public" {
    if (
        address === "127.0.0.1" ||
        address === "::1" ||
        address.startsWith("127.")
    ) {
        return "local";
    }

    if (
        address.startsWith("10.") ||
        address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
        address.startsWith("fe80:") ||
        address.startsWith("fd")
    ) {
        return "private";
    }

    return "public";
}

export function shortHost(address: string): string {
    if (address.length <= 18) {
        return address;
    }
    return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function formatService(
    port: number | null,
    proto: PacketProto | string,
    name?: string,
): string {
    const p = (proto as string).toUpperCase() as PacketProto;
    if (port === null) {
        const base = p;
        return name ? `${base} ${name}` : base;
    }
    let svc: string;
    if (port === 443) {
        svc = "HTTPS";
    } else if (port === 80) {
        svc = "HTTP";
    } else if (port === 53) {
        svc = "DNS";
    } else {
        svc = `${p}/${port}`;
    }
    if (name?.trim()) {
        return `${svc} ${name.trim()}`;
    }
    return svc;
}
