import { formatBytes } from "../layout";
import type { Selection, TrafficSnapshot } from "../types";

export type CopilotMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
};

export type CopilotChatMessage = {
    role: "user" | "assistant";
    content: string;
};

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

function describeSelectionContext(
    graph: TrafficSnapshot,
    selection: Selection | null,
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

        return { kind: "flow", ...flow };
    }

    const packet = graph.packets.find((item) => item.id === selection.id);
    if (!packet) {
        return { kind: "packet", missing: selection.id };
    }

    return { kind: "packet", ...packet };
}

export function buildCopilotContext(
    graph: TrafficSnapshot,
    selection: Selection | null,
) {
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
            proto: flow.proto,
            dstPort: flow.dstPort,
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
            length: packet.length,
            info: packet.info,
            process: packet.process,
        })),
        anomalies: graph.anomalies.slice(0, 10),
        recentEvents: graph.events.slice(-8),
        selection: describeSelectionContext(graph, selection),
    };
}

export type CopilotContext = ReturnType<typeof buildCopilotContext>;

export const COPILOT_WELCOME = createMessage(
    "assistant",
    "I'm your traffic copilot. I analyze the current capture through the backend Codex SDK.\n\nSetup uses TXMON_CODEX_AUTH (local or api-key) and OPENAI_API_KEY (for api-key mode, via env or .env.copilot). Status and Validate are shown above.",
);
