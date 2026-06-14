import { describe, expect, test } from "bun:test";
import type { TrafficSnapshot } from "../types";
import { buildCopilotContext } from "./copilot";

const emptyGraph: TrafficSnapshot = {
    nodes: [],
    edges: [],
    packets: [],
    flows: [],
    events: [],
    totalPackets: 0,
    totalBytes: 0,
    hostCount: 0,
    flowCount: 0,
    connected: true,
    sourceLabel: "tcpdump -i any",
};

const sampleGraph: TrafficSnapshot = {
    ...emptyGraph,
    totalPackets: 120,
    totalBytes: 48_000,
    hostCount: 2,
    flowCount: 1,
    nodes: [
        {
            id: "10.0.0.1",
            type: "host",
            position: { x: 0, y: 0 },
            data: {
                label: "10.0.0.1",
                address: "10.0.0.1",
                category: "private",
                packetCount: 80,
                bytesTotal: "32000",
            },
        },
        {
            id: "8.8.8.8",
            type: "host",
            position: { x: 0, y: 0 },
            data: {
                label: "8.8.8.8",
                address: "8.8.8.8",
                category: "public",
                packetCount: 40,
                bytesTotal: "16000",
            },
        },
    ],
    flows: [
        {
            id: "flow-1",
            srcHost: "10.0.0.1",
            dstHost: "8.8.8.8",
            proto: "UDP",
            dstPort: 53,
            packetCount: 40,
            bytesTotal: 16_000,
            active: true,
        },
    ],
    events: ["New host 8.8.8.8"],
};

describe("buildCopilotContext", () => {
    test("includes capture summary and top flows", () => {
        const context = buildCopilotContext(sampleGraph, null);
        expect(context.summary.totalPackets).toBe(120);
        expect(context.topFlows[0]?.dstHost).toBe("8.8.8.8");
        expect(context.topHosts[0]?.label).toBe("10.0.0.1");
    });

    test("includes selected flow details", () => {
        const context = buildCopilotContext(sampleGraph, {
            kind: "flow",
            id: "flow-1",
        });
        expect(context.selection).toMatchObject({
            kind: "flow",
            proto: "UDP",
            dstPort: 53,
        });
    });
});
