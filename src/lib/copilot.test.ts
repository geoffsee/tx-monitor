import { describe, expect, test } from "bun:test";
import type { TrafficSnapshot } from "../types";
import { buildCopilotContext } from "./copilot";

const emptyGraph: TrafficSnapshot = {
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
    sensitivity: "medium",
    markers: [],
    hostLabels: {},
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

    test("includes entity markers for pinned hosts and flows", () => {
        const withMarkers: TrafficSnapshot = {
            ...sampleGraph,
            markers: [
                {
                    kind: "host",
                    id: "10.0.0.1",
                    pinned: true,
                    note: "gateway",
                    tags: "core",
                },
                {
                    kind: "flow",
                    id: "flow-1",
                    pinned: false,
                    note: "dns",
                    tags: null,
                },
            ],
        };
        const context = buildCopilotContext(withMarkers, null);
        expect(context.markers).toEqual(withMarkers.markers);
        expect(context.markers[0]?.note).toBe("gateway");
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

    test("includes service names via formatService in topFlows and selection", () => {
        const context = buildCopilotContext(sampleGraph, {
            kind: "flow",
            id: "flow-1",
        });
        // UDP 53 -> DNS
        expect(context.topFlows[0]?.service).toBe("DNS");
        expect(context.selection).toMatchObject({ service: "DNS" });
    });

    test("uses hostLabels for addresses outside graph.nodes", () => {
        const graph: TrafficSnapshot = {
            ...sampleGraph,
            nodes: sampleGraph.nodes.slice(0, 1), // only 10.0.0.1 laid out
            hostLabels: {
                "10.0.0.1": "10.0.0.1",
                "8.8.8.8": "dns.google",
            },
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
        };
        const context = buildCopilotContext(graph, null);
        expect(context.topFlows[0]?.dstLabel).toBe("dns.google");
        expect(context.topFlows[0]?.service).toBe("DNS dns.google");
    });
});
