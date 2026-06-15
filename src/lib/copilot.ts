import OpenAI from "openai";
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

const COPILOT_SYSTEM_PROMPT = `You are a network traffic analysis copilot for tx-monitor, a real-time tcpdump visualizer.

Answer using only the capture context provided with each request. Be concise, practical, and specific. Call out hosts, flows, protocols, ports, and volumes when relevant. Mention any detected anomalies if they are present in the context. If the capture is empty or the question cannot be answered from the context, say so clearly.

Do not invent packets, hosts, or flows that are not in the context.`;

const OPENAI_MODEL = "gpt-4o-mini";

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
        })),
        recentPackets: graph.packets.slice(0, 12).map((packet) => ({
            id: packet.id,
            timestamp: packet.timestamp,
            proto: packet.proto,
            srcHost: packet.srcHost,
            dstHost: packet.dstHost,
            length: packet.length,
            info: packet.info,
        })),
        anomalies: graph.anomalies.slice(0, 10),
        recentEvents: graph.events.slice(-8),
        selection: describeSelectionContext(graph, selection),
    };
}

export async function askCopilot(params: {
    apiKey: string;
    prompt: string;
    history: CopilotChatMessage[];
    graph: TrafficSnapshot;
    selection: Selection | null;
}): Promise<string> {
    const apiKey = params.apiKey.trim();
    const prompt = params.prompt.trim();

    if (!apiKey) {
        throw new Error("Enter your OpenAI API key to use copilot.");
    }

    if (!prompt) {
        return "Ask a question about the capture, or pick one of the suggestions below.";
    }

    const client = new OpenAI({
        apiKey,
        dangerouslyAllowBrowser: true,
    });
    const context = buildCopilotContext(params.graph, params.selection);

    const completion = await client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
            { role: "system", content: COPILOT_SYSTEM_PROMPT },
            {
                role: "user",
                content: `Capture context (JSON):\n${JSON.stringify(context, null, 2)}`,
            },
            {
                role: "assistant",
                content:
                    "Understood. I will analyze this capture using only the provided context.",
            },
            ...params.history.map((message) => ({
                role: message.role,
                content: message.content,
            })),
            { role: "user", content: prompt },
        ],
    });

    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
        throw new Error("OpenAI returned an empty response.");
    }

    return answer;
}

export const COPILOT_WELCOME = createMessage(
    "assistant",
    "I'm your traffic copilot. I use the OpenAI key from the server config for this session.",
);
