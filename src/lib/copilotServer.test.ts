import { describe, expect, test } from "bun:test";
import type { TrafficSnapshot } from "../types";
import { buildCopilotContext } from "./copilot";
import { buildCodexCopilotPrompt, parseCopilotRequest } from "./copilotServer";

const graph: TrafficSnapshot = {
    nodes: [],
    edges: [],
    packets: [],
    flows: [],
    anomalies: [],
    events: [],
    totalPackets: 0,
    totalBytes: 0,
    hostCount: 0,
    flowCount: 0,
    connected: true,
    sourceLabel: "tcpdump -i any",
    sensitivity: "medium",
};

const context = buildCopilotContext(graph, null);

describe("parseCopilotRequest", () => {
    test("normalizes prompt, history, and context", () => {
        const request = parseCopilotRequest({
            prompt: "What is happening?",
            history: [
                { role: "user", content: "Summarize this capture" },
                { role: "system", content: "ignored" },
            ],
            context,
        });

        expect(request.prompt).toBe("What is happening?");
        expect(request.history).toEqual([
            { role: "user", content: "Summarize this capture" },
        ]);
        expect(request.context).toBe(context);
    });

    test("rejects missing copilot context", () => {
        expect(() =>
            parseCopilotRequest({ prompt: "What is happening?" }),
        ).toThrow("Expected copilot context.");
    });
});

describe("buildCodexCopilotPrompt", () => {
    test("includes guardrails, context, history, and user question", () => {
        const prompt = buildCodexCopilotPrompt({
            prompt: "Any anomalies?",
            history: [{ role: "assistant", content: "No packets yet." }],
            context,
        });

        expect(prompt).toContain("Do not run shell commands");
        expect(prompt).toContain('"totalPackets": 0');
        expect(prompt).toContain("ASSISTANT: No packets yet.");
        expect(prompt).toContain("Any anomalies?");
    });
});
