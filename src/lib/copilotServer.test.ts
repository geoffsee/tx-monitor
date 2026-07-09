import { describe, expect, test } from "bun:test";
import type { TrafficSnapshot } from "../types";
import { buildCopilotContext } from "./copilot";
import {
    buildCodexCopilotPrompt,
    getCopilotStatus,
    parseCopilotRequest,
    validateCopilotSetup,
} from "./copilotServer";

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
    hostsEvicted: 0,
    flowsEvicted: 0,
    packetsEvicted: 0,
    summaryOnly: false,
    connected: true,
    sourceLabel: "tcpdump -i any",
    capture: { iface: "any", direction: "out", bpf: "" },
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

describe("getCopilotStatus", () => {
    test("returns auth mode and credential presence without secrets", () => {
        const status = getCopilotStatus();
        expect(["local", "api-key"]).toContain(status.authMode);
        expect(typeof status.hasCredentials).toBe("boolean");
        expect(typeof status.model).toBe("string");
        expect(typeof status.timeoutMs).toBe("number");
        expect(typeof status.ready).toBe("boolean");
        // ensure no secret-like value leaks in the object
        const { model: _model, ...rest } = status;
        const json = JSON.stringify(rest);
        expect(json).not.toContain("sk-");
        expect(json).not.toContain("OPENAI");
    });
});

describe("validateCopilotSetup", () => {
    test("exports callable async function (network attempt only on explicit UI validate)", () => {
        expect(typeof validateCopilotSetup).toBe("function");
        // Invocation intentionally omitted in unit tests to prevent long-lived
        // Codex SDK connection attempts and dangling processes in CI without
        // credentials. Behavior is covered by getCopilotStatus and runtime use.
    });
});
