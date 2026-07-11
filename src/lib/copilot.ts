import { formatBytes } from "../layout";
import type { Anomaly, Selection, TrafficSnapshot } from "../types";
import { formatService, shortHost } from "./tcpdumpParser";

export type CopilotMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
};

export type CopilotChatMessage = {
    role: "user" | "assistant";
    content: string;
};

// Retention (per #39 / #40): strict client-provided snapshot model for copilot.
// CopilotRequest.context is always built client-side from TrafficSnapshot and sent
// via POST /api/copilot. No ambient streaming or server-pulled data for AI analysis.
export type CopilotRequest = {
    prompt: string;
    history: CopilotChatMessage[];
    context: CopilotContext;
};

export type CopilotResponse = {
    answer: string;
    threadId: string | null;
};

export type CopilotAuthMode = "local" | "api-key";

export type CopilotStatus = {
    authMode: CopilotAuthMode;
    hasCredentials: boolean;
    model: string;
    timeoutMs: number;
    ready: boolean;
};

export type CopilotValidationResult = {
    success: boolean;
    message: string;
};

let messageCounter = 0;

export function createMessage(
    role: CopilotMessage["role"],
    content: string,
): CopilotMessage {
    messageCounter += 1;
    return { id: `msg-${messageCounter}`, role, content };
}

export const COPILOT_SUGGESTIONS = [
    "Summarize this capture",
    "What are the top flows?",
    "Any unusual traffic?",
    "Explain my selection",
] as const;

export const COPILOT_SYSTEM_PROMPT = `You are a network traffic analysis copilot for tx-monitor, a real-time tcpdump visualizer.

Answer using only the capture context provided with each request. Be concise, practical, and specific. Call out hosts, flows, protocols, ports, volumes, and local processes when relevant. Mention any detected anomalies if they are present in the context. If the capture is empty or the question cannot be answered from the context, say so clearly.

Do not invent packets, hosts, or flows that are not in the context.`;

function topFlows(graph: TrafficSnapshot, limit = 8) {
    return [...graph.flows]
        .sort((a, b) => b.bytesTotal - a.bytesTotal)
        .slice(0, limit);
}

function topHosts(graph: TrafficSnapshot, limit = 8) {
    return [...graph.nodes]
        .sort(
            (a, b) =>
                Number.parseInt(b.data.bytesTotal, 10) -
                Number.parseInt(a.data.bytesTotal, 10),
        )
        .slice(0, limit);
}

function createHostLabelLookup(graph: TrafficSnapshot) {
    // Prefer full snapshot hostLabels (all known hosts + DNS); fall back to
    // laid-out nodes for older/partial snapshots, then raw address.
    const fromMap = graph.hostLabels ?? {};
    const fromNodes = new Map(
        graph.nodes.map((n) => [n.id, n.data.label] as const),
    );
    return (addr: string) => fromMap[addr] ?? fromNodes.get(addr) ?? addr;
}

function serviceName(
    dstPort: number | null | undefined,
    proto: string,
    dstHost: string,
    getLabel: (addr: string) => string,
) {
    const dstLabel = getLabel(dstHost);
    // shortHost labels are display truncations, not DNS — never append them
    const name =
        dstLabel !== dstHost && dstLabel !== shortHost(dstHost)
            ? dstLabel
            : undefined;
    return formatService(dstPort ?? null, proto, name);
}

function describeSelectionContext(
    graph: TrafficSnapshot,
    selection: Selection | null,
    getLabel: (addr: string) => string,
) {
    if (!selection) {
        return null;
    }

    if (selection.kind === "host") {
        const host = graph.nodes.find((node) => node.id === selection.id);
        if (!host) {
            return { kind: "host", missing: selection.id };
        }

        return {
            kind: "host",
            label: host.data.label,
            address: host.data.address,
            category: host.data.category,
            packetCount: host.data.packetCount,
            bytesTotal: host.data.bytesTotal,
        };
    }

    if (selection.kind === "flow") {
        const flow = graph.flows.find((item) => item.id === selection.id);
        if (!flow) {
            return { kind: "flow", missing: selection.id };
        }

        return {
            kind: "flow",
            ...flow,
            srcLabel: getLabel(flow.srcHost),
            dstLabel: getLabel(flow.dstHost),
            service: serviceName(
                flow.dstPort,
                flow.proto,
                flow.dstHost,
                getLabel,
            ),
        };
    }

    const packet = graph.packets.find((item) => item.id === selection.id);
    if (!packet) {
        return { kind: "packet", missing: selection.id };
    }

    return {
        kind: "packet",
        ...packet,
        srcLabel: getLabel(packet.srcHost),
        dstLabel: getLabel(packet.dstHost),
        service: serviceName(
            packet.dstPort,
            packet.proto,
            packet.dstHost,
            getLabel,
        ),
    };
}

// buildCopilotContext produces the snapshot-derived context for the strict
// client-provided model. Changes to this or the context shape require explicit
// demand/review per retention commitment (#39).
export function buildCopilotContext(
    graph: TrafficSnapshot,
    selection: Selection | null,
) {
    const getLabel = createHostLabelLookup(graph);

    return {
        summary: {
            totalPackets: graph.totalPackets,
            totalBytes: graph.totalBytes,
            totalBytesLabel: formatBytes(graph.totalBytes),
            hostCount: graph.hostCount,
            flowCount: graph.flowCount,
            connected: graph.connected,
            sourceLabel: graph.sourceLabel,
        },
        topHosts: topHosts(graph).map((host) => ({
            label: host.data.label,
            address: host.data.address,
            category: host.data.category,
            packetCount: host.data.packetCount,
            bytesTotal: host.data.bytesTotal,
        })),
        topFlows: topFlows(graph).map((flow) => ({
            id: flow.id,
            srcHost: flow.srcHost,
            dstHost: flow.dstHost,
            srcLabel: getLabel(flow.srcHost),
            dstLabel: getLabel(flow.dstHost),
            proto: flow.proto,
            dstPort: flow.dstPort,
            service: serviceName(
                flow.dstPort,
                flow.proto,
                flow.dstHost,
                getLabel,
            ),
            packetCount: flow.packetCount,
            bytesTotal: flow.bytesTotal,
            bytesTotalLabel: formatBytes(flow.bytesTotal),
            active: flow.active,
            process: flow.process,
        })),
        recentPackets: graph.packets.slice(0, 12).map((packet) => ({
            id: packet.id,
            timestamp: packet.timestamp,
            proto: packet.proto,
            srcHost: packet.srcHost,
            dstHost: packet.dstHost,
            srcLabel: getLabel(packet.srcHost),
            dstLabel: getLabel(packet.dstHost),
            ...(packet.dstPort != null
                ? {
                      service: serviceName(
                          packet.dstPort,
                          packet.proto,
                          packet.dstHost,
                          getLabel,
                      ),
                  }
                : {}),
            length: packet.length,
            info: packet.info,
            process: packet.process,
        })),
        anomalies: graph.anomalies.slice(0, 10),
        recentEvents: graph.events.slice(-8),
        selection: describeSelectionContext(graph, selection, getLabel),
        markers: graph.markers ?? [],
    };
}

export type CopilotContext = ReturnType<typeof buildCopilotContext>;

export const COPILOT_WELCOME = createMessage(
    "assistant",
    "I'm your traffic copilot. I analyze the current capture through the backend Codex SDK.\n\nSetup uses TXMON_CODEX_AUTH (local or api-key) and OPENAI_API_KEY (for api-key mode, via env or .env.copilot). Status and Validate are shown above.",
);

export function buildAnomalyPrompt(anomaly: Anomaly): string {
    const parts: string[] = [];
    parts.push(
        `Explain this anomaly: ${anomaly.type} - ${anomaly.description}.`,
    );
    if (anomaly.flowId) {
        parts.push(`Related flow: ${anomaly.flowId}.`);
    }
    if (anomaly.hostId) {
        parts.push(`Related host: ${anomaly.hostId}.`);
    }
    parts.push(
        "Analyze using the provided snapshot context, referencing any matching hosts, flows, or packets.",
    );
    return parts.join(" ");
}

export type AnomalyExport = {
    exportedAt: string;
    anomaly: Anomaly;
    related: {
        hosts: TrafficSnapshot["nodes"];
        flows: TrafficSnapshot["flows"];
        packets: TrafficSnapshot["packets"];
    };
};

export function buildAnomalyExport(
    anomaly: Anomaly,
    graph: TrafficSnapshot,
): AnomalyExport {
    const now = new Date().toISOString();
    let relatedHosts: TrafficSnapshot["nodes"] = [];
    let relatedFlows: TrafficSnapshot["flows"] = [];
    let relatedPackets: TrafficSnapshot["packets"] = [];

    const flow = anomaly.flowId
        ? graph.flows.find((f) => f.id === anomaly.flowId)
        : undefined;
    const hostId = anomaly.hostId;

    if (flow) {
        relatedFlows = graph.flows.filter((f) => f.id === flow.id);
        relatedHosts = graph.nodes.filter(
            (n) => n.id === flow.srcHost || n.id === flow.dstHost,
        );
        relatedPackets = graph.packets.filter(
            (p) =>
                p.proto === flow.proto &&
                p.srcHost === flow.srcHost &&
                p.dstHost === flow.dstHost &&
                p.dstPort === flow.dstPort,
        );
    } else if (hostId) {
        relatedHosts = graph.nodes.filter((n) => n.id === hostId);
        relatedFlows = graph.flows.filter(
            (f) => f.srcHost === hostId || f.dstHost === hostId,
        );
        relatedPackets = graph.packets.filter(
            (p) => p.srcHost === hostId || p.dstHost === hostId,
        );
    }

    return {
        exportedAt: now,
        anomaly,
        related: {
            hosts: relatedHosts,
            flows: relatedFlows,
            packets: relatedPackets,
        },
    };
}
