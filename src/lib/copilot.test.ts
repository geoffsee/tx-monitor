import { describe, expect, test } from "bun:test";
import type { Anomaly, TrafficSnapshot } from "../types";
import {
    buildAnomalyExport,
    buildAnomalyPrompt,
    buildCopilotContext,
} from "./copilot";

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
    evictionByReason: {
        host_cap: 0,
        flow_cap: 0,
        flow_orphan: 0,
        packet_window: 0,
        summary_mode: 0,
    },
    summaryOnly: false,
    connected: true,
    sourceLabel: "tcpdump -i any",
    sensitivity: "medium",
    markers: [],
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
});

const sampleAnomalyFlow: Anomaly = {
    id: "rate-spike-flow-1",
    timestamp: 1_700_000_000_000,
    severity: "low",
    type: "High Rate",
    description: "Flow flow-1 received 8 packets in ~2s",
    flowId: "flow-1",
};

const sampleAnomalyHost: Anomaly = {
    id: "suspicious-8.8.8.8-445",
    timestamp: 1_700_000_000_100,
    severity: "high",
    type: "Suspicious External Port",
    description: "Host 8.8.8.8 receiving traffic on sensitive port 445",
    hostId: "8.8.8.8",
};

const sampleAnomalyGlobal: Anomaly = {
    id: "dns-volume",
    timestamp: 1_700_000_000_200,
    severity: "low",
    type: "High DNS Volume",
    description: "35 DNS packets observed",
};

const graphWithPackets: TrafficSnapshot = {
    ...sampleGraph,
    flowCount: 2,
    flows: [
        ...sampleGraph.flows,
        {
            id: "flow-tcp",
            srcHost: "10.0.0.1",
            dstHost: "8.8.8.8",
            proto: "TCP",
            dstPort: 443,
            packetCount: 1,
            bytesTotal: 80,
            active: true,
        },
    ],
    packets: [
        {
            id: "p1",
            timestamp: "12:00:00.000000",
            proto: "UDP",
            srcHost: "10.0.0.1",
            dstHost: "8.8.8.8",
            srcPort: 50_000,
            dstPort: 53,
            length: 60,
            info: "DNS",
        },
        {
            id: "p2",
            timestamp: "12:00:00.010000",
            proto: "UDP",
            srcHost: "8.8.8.8",
            dstHost: "10.0.0.1",
            srcPort: 53,
            dstPort: 50_000,
            length: 120,
            info: "DNS resp",
        },
        {
            id: "p3",
            timestamp: "12:00:01.000000",
            proto: "TCP",
            srcHost: "10.0.0.1",
            dstHost: "1.1.1.1",
            srcPort: 50_001,
            dstPort: 80,
            length: 100,
            info: "other",
        },
        // Same host pair as flow-1, different proto — must not leak into flow export
        {
            id: "p4",
            timestamp: "12:00:01.100000",
            proto: "TCP",
            srcHost: "10.0.0.1",
            dstHost: "8.8.8.8",
            srcPort: 50_002,
            dstPort: 443,
            length: 80,
            info: "HTTPS",
        },
        // Same direction + proto as flow-1, different dstPort — must not leak
        {
            id: "p5",
            timestamp: "12:00:01.200000",
            proto: "UDP",
            srcHost: "10.0.0.1",
            dstHost: "8.8.8.8",
            srcPort: 50_003,
            dstPort: 123,
            length: 70,
            info: "NTP",
        },
    ],
};

describe("buildAnomalyPrompt", () => {
    test("includes type, description and flow when present", () => {
        const prompt = buildAnomalyPrompt(sampleAnomalyFlow);
        expect(prompt).toContain("High Rate");
        expect(prompt).toContain("Flow flow-1");
        expect(prompt).toContain("snapshot context");
    });

    test("includes host when present and no flow", () => {
        const prompt = buildAnomalyPrompt(sampleAnomalyHost);
        expect(prompt).toContain("Suspicious External Port");
        expect(prompt).toContain("Related host: 8.8.8.8");
    });

    test("handles global anomaly without host or flow", () => {
        const prompt = buildAnomalyPrompt(sampleAnomalyGlobal);
        expect(prompt).toContain("High DNS Volume");
        expect(prompt).not.toContain("Related host");
        expect(prompt).not.toContain("Related flow");
    });
});

describe("buildAnomalyExport", () => {
    test("exports flow-targeted slice with matching flow and packets", () => {
        const exp = buildAnomalyExport(sampleAnomalyFlow, graphWithPackets);
        expect(exp.anomaly.id).toBe("rate-spike-flow-1");
        expect(exp.related.flows.length).toBe(1);
        expect(exp.related.flows[0]?.id).toBe("flow-1");
        // direction + proto + dstPort: p1 matches; reverse p2, ambient TCP p4, other-port p5 excluded
        expect(exp.related.packets.map((p) => p.id)).toEqual(["p1"]);
        expect(exp.related.hosts.map((h) => h.id).sort()).toEqual([
            "10.0.0.1",
            "8.8.8.8",
        ]);
    });

    test("excludes same-endpoint ambient packets of different proto", () => {
        const exp = buildAnomalyExport(sampleAnomalyFlow, graphWithPackets);
        expect(exp.related.packets.some((p) => p.id === "p4")).toBe(false);
        expect(exp.related.packets.some((p) => p.proto === "TCP")).toBe(false);
        expect(exp.related.flows.some((f) => f.id === "flow-tcp")).toBe(false);
    });

    test("excludes same-direction same-proto different-port ambient packets", () => {
        const exp = buildAnomalyExport(sampleAnomalyFlow, graphWithPackets);
        expect(exp.related.packets.some((p) => p.id === "p5")).toBe(false);
        expect(exp.related.packets.some((p) => p.dstPort === 123)).toBe(false);
    });

    test("exports host-targeted slice limited to that host", () => {
        const exp = buildAnomalyExport(sampleAnomalyHost, graphWithPackets);
        expect(exp.related.hosts.length).toBe(1);
        expect(exp.related.hosts[0]?.id).toBe("8.8.8.8");
        // flows involving the host (UDP flow-1 + TCP flow-tcp)
        expect(exp.related.flows.length).toBe(2);
        // packets involving the host (p1, p2 reverse, p4 ambient TCP, p5 other-port UDP)
        expect(exp.related.packets.length).toBe(4);
    });

    test("exports global anomaly with empty related to avoid ambient leak", () => {
        const exp = buildAnomalyExport(sampleAnomalyGlobal, graphWithPackets);
        expect(exp.anomaly.type).toBe("High DNS Volume");
        expect(exp.related.hosts.length).toBe(0);
        expect(exp.related.flows.length).toBe(0);
        expect(exp.related.packets.length).toBe(0);
    });
});
