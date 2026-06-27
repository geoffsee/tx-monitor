import { beforeEach, describe, expect, test } from "bun:test";
import { createGraph, FLOW_STALE_WINDOW_MS } from "./graph";
import type { ParsedPacket } from "./tcpdumpParser";
import { trafficNetwork } from "./trafficNetwork";

function packet(
    id: string,
    srcHost: string,
    dstHost: string,
    dstPort: number,
    process?: { command: string; pid: number; user: string },
): ParsedPacket {
    return {
        id,
        timestamp: "12:00:00.000000",
        proto: "TCP",
        srcHost,
        srcPort: 50_000,
        dstHost,
        dstPort,
        length: 100,
        info: "test packet",
        ...(process ? { process } : {}),
    };
}

describe("createGraph", () => {
    beforeEach(() => trafficNetwork.reset());
    test("keeps live flows visible through the stale window", () => {
        trafficNetwork.reset();

        trafficNetwork.ingestPacket(
            packet("fresh", "10.0.0.1", "203.0.113.10", 443),
            true,
            2000000000000,
        );

        const graph = createGraph();

        expect(graph.edges.map((edge) => edge.id)).toContain(
            "10.0.0.1->203.0.113.10:TCP:443",
        );
    });

    test("hides live flows after the stale window", () => {
        trafficNetwork.reset();

        trafficNetwork.ingestPacket(
            packet("stale", "10.0.0.1", "203.0.113.20", 443),
            true,
            1000000000,
        );

        const graph = createGraph();

        expect(graph.edges.map((edge) => edge.id)).not.toContain(
            "10.0.0.1->203.0.113.20:TCP:443",
        );
    });

    test("does not apply live stale filtering to history sessions", () => {
        trafficNetwork.reset();
        trafficNetwork.setSource("history", "saved capture");
        trafficNetwork.ingestHistoricalBatch([
            {
                ...packet("history", "10.0.0.1", "203.0.113.30", 443),
                receivedAt: Date.now() - FLOW_STALE_WINDOW_MS - 500,
            },
        ]);

        const graph = createGraph();

        expect(graph.edges.map((edge) => edge.id)).toContain(
            "10.0.0.1->203.0.113.30:TCP:443",
        );
    });

    test("filters hosts, flows, packets, and events by address term", () => {
        trafficNetwork.reset();
        trafficNetwork.ingestPacket(
            {
                ...packet("p1", "10.0.0.1", "203.0.113.10", 443),
                info: "one",
            },
            true,
        );
        trafficNetwork.ingestPacket(
            {
                ...packet("p2", "10.0.0.2", "203.0.113.20", 80),
                info: "two",
            },
            true,
        );
        trafficNetwork.remember("Discovered host 10.0.0.1");

        const unfiltered = createGraph();
        expect(unfiltered.nodes.length).toBeGreaterThan(0);
        expect(unfiltered.packets.length).toBeGreaterThan(0);

        const filtered = createGraph("10.0.0.1");
        expect(filtered.nodes.some((n) => n.id === "10.0.0.1")).toBe(true);
        expect(filtered.nodes.some((n) => n.id === "10.0.0.2")).toBe(false);
        expect(
            filtered.packets.every(
                (p) => p.srcHost === "10.0.0.1" || p.dstHost === "10.0.0.1",
            ),
        ).toBe(true);
        expect(filtered.events[0]).toContain("10.0.0.1");
    });

    test("filters by port, protocol, and process name", () => {
        trafficNetwork.reset();
        trafficNetwork.ingestPacket(
            {
                ...packet("p80", "10.0.0.5", "203.0.113.5", 80),
                proto: "TCP",
                info: "http",
            },
            true,
        );
        trafficNetwork.ingestPacket(
            packet("p443", "10.0.0.5", "203.0.113.5", 443, {
                command: "curl",
                pid: 123,
                user: "root",
            }),
            true,
        );

        const byPort = createGraph("443");
        expect(
            byPort.packets.some((p) => p.dstHost.includes("203.0.113.5")),
        ).toBe(true);
        expect(byPort.packets.every((p) => p.srcHost === "10.0.0.5")).toBe(
            true,
        );

        const byProto = createGraph("tcp");
        expect(byProto.flows.length).toBeGreaterThan(0);

        const byProc = createGraph("curl");
        expect(byProc.flows.some((f) => f.process?.command === "curl")).toBe(
            true,
        );
        expect(byProc.packets.some((p) => p.process?.command === "curl")).toBe(
            true,
        );
    });

    test("filter applies to history sessions without stale drop", () => {
        trafficNetwork.reset();
        trafficNetwork.setSource("history", "test hist");
        trafficNetwork.ingestHistoricalBatch([
            {
                ...packet("h1", "192.168.1.10", "192.168.1.20", 22),
                receivedAt: Date.now(),
            },
            {
                ...packet("h2", "192.168.1.30", "8.8.8.8", 53),
                proto: "UDP",
                receivedAt: Date.now(),
            },
        ]);

        const filtered = createGraph("192.168.1.10");
        expect(filtered.nodes.some((n) => n.id === "192.168.1.10")).toBe(true);
        expect(filtered.nodes.some((n) => n.id === "192.168.1.30")).toBe(false);
        // history keeps the old flow
        expect(filtered.edges.some((e) => e.id.includes("192.168.1.10"))).toBe(
            true,
        );
    });

    test("empty filter shows unfiltered view; unknown term yields no matches in view lists", () => {
        trafficNetwork.reset();
        trafficNetwork.ingestPacket(
            packet("px", "10.1.2.3", "10.4.5.6", 1234),
            true,
        );

        const emptyF = createGraph("");
        expect(emptyF.packets.length).toBeGreaterThan(0);

        const noMatch = createGraph("zzzz-no-such-thing-xyz");
        expect(noMatch.nodes.length).toBe(0);
        expect(noMatch.edges.length).toBe(0);
        expect(noMatch.packets.length).toBe(0);
        // events may or not; but main lists narrowed
    });
});
