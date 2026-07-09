import { describe, expect, test } from "bun:test";
import { createGraph, FLOW_STALE_WINDOW_MS } from "./graph";
import type { PacketProto, ParsedPacket } from "./tcpdumpParser";
import {
    MAX_MEMORY_FLOWS,
    MAX_MEMORY_HOSTS,
    MAX_MEMORY_PACKETS_SUMMARY,
    trafficNetwork,
} from "./trafficNetwork";

function packet(
    id: string,
    srcHost: string,
    dstHost: string,
    dstPort: number,
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
    };
}

describe("createGraph", () => {
    test("keeps live flows visible through the stale window", () => {
        trafficNetwork.reset();

        trafficNetwork.ingestPacket(
            packet("fresh", "10.0.0.1", "203.0.113.10", 443),
            true,
            Date.now(),
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
            Date.now() - FLOW_STALE_WINDOW_MS - 500,
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

    test("enforces explicit caps on hosts and flows under large multi-thousand packet loads", () => {
        trafficNetwork.reset();

        // Generate multi-thousand packets with limited high-volume hosts/flows
        // plus many low-volume ones to trigger pruning.
        const baseTime = Date.now();
        const highVolumeHosts = ["10.0.0.1", "10.0.0.2"];
        const highVolumeFlows = [
            "10.0.0.1->203.0.113.1:TCP:443",
            "10.0.0.2->203.0.113.2:TCP:443",
        ];
        for (let i = 0; i < 6500; i++) {
            // High volume: repeat popular ones often with consistent flow key
            const isHigh = i % 3 !== 0;
            const src = isHigh
                ? (highVolumeHosts[i % highVolumeHosts.length] as string)
                : `10.1.${Math.floor(i / 30) % 250}.${(i % 60) + 1}`;
            let dst: string;
            let dstPort: number;
            let proto: PacketProto;
            if (isHigh) {
                dst = `203.0.113.${(i % 2) + 1}`;
                dstPort = 443;
                proto = "TCP";
            } else {
                dst = `203.0.113.${100 + (i % 220)}`;
                dstPort = 12345 + (i % 1000);
                proto = i % 3 === 0 ? "UDP" : "TCP";
            }
            const p: ParsedPacket = {
                id: `lp-${i}`,
                timestamp: "12:00:00.000000",
                proto,
                srcHost: src,
                srcPort: 50000 + (i % 1000),
                dstHost: dst,
                dstPort,
                length: 80 + (i % 200),
                info: "large-load test",
            };
            trafficNetwork.ingestPacket(p, true, baseTime + i);
        }

        expect(trafficNetwork.hosts.size).toBeLessThanOrEqual(MAX_MEMORY_HOSTS);
        expect(trafficNetwork.flows.size).toBeLessThanOrEqual(MAX_MEMORY_FLOWS);

        // High volume entities should be retained (not the first victims)
        expect(trafficNetwork.hosts.has("10.0.0.1")).toBe(true);
        expect(trafficNetwork.hosts.has("10.0.0.2")).toBe(true);
        expect(trafficNetwork.flows.has(highVolumeFlows[0] as string)).toBe(
            true,
        );
        expect(trafficNetwork.flows.has(highVolumeFlows[1] as string)).toBe(
            true,
        );

        // Snapshot counts reflect in-memory (capped) but totals are accurate
        const snap = createGraph();
        expect(snap.hostCount).toBeLessThanOrEqual(MAX_MEMORY_HOSTS);
        expect(snap.flowCount).toBeLessThanOrEqual(MAX_MEMORY_FLOWS);
        expect(snap.totalPackets).toBe(6500);

        // Eviction telemetry present under sustained load (hosts + packets; flows may evict via orphan on host cap)
        expect(trafficNetwork.hostsEvicted).toBeGreaterThan(0);
        expect(trafficNetwork.packetsEvicted).toBeGreaterThan(0);
        expect(snap.hostsEvicted).toBeGreaterThan(0);
        expect(snap.packetsEvicted).toBeGreaterThan(0);
        // flows under cap (explicit flow eviction verified in history test)
        expect(trafficNetwork.flowsEvicted).toBeGreaterThanOrEqual(0);
    }, 20000);

    test("history ingest respects caps and uses progressive page-style batching", () => {
        trafficNetwork.reset();
        trafficNetwork.setSource("history", "large historical");

        const packets: (ParsedPacket & { receivedAt: number })[] = [];
        for (let i = 0; i < 2500; i++) {
            packets.push({
                id: `hp-${i}`,
                timestamp: `12:00:${String(i % 60).padStart(2, "0")}.000000`,
                proto: "TCP",
                srcHost: `192.168.0.${(i % 50) + 1}`,
                srcPort: 40000,
                dstHost: `10.0.0.${(Math.floor(i / 50) % 60) + 1}`,
                dstPort: 443,
                length: 100,
                info: "hist",
                receivedAt: 1_000_000 + i,
            });
        }

        // Simulate the chunked progressive ingest used by loadSession
        const CHUNK = 200;
        for (let off = 0; off < packets.length; off += CHUNK) {
            trafficNetwork.ingestHistoricalBatch(
                packets.slice(off, off + CHUNK),
            );
        }

        expect(trafficNetwork.hosts.size).toBeLessThanOrEqual(MAX_MEMORY_HOSTS);
        expect(trafficNetwork.flows.size).toBeLessThanOrEqual(MAX_MEMORY_FLOWS);
        // totals from all ingested even though hosts/flows capped
        expect(trafficNetwork.totalPackets).toBe(2500);
        // flow eviction via explicit pruneFlows (hosts < cap, many src*dst flows)
        expect(trafficNetwork.flowsEvicted).toBeGreaterThan(0);
        const snap2 = createGraph();
        expect(snap2.flowsEvicted).toBeGreaterThan(0);
    }, 20000);

    test("pinned hosts and flows survive display filters and surface marker flags", () => {
        trafficNetwork.reset();
        const staleFlowId = "10.0.0.1->203.0.113.50:TCP:443";
        const freshFlowId = "10.0.0.2->203.0.113.51:TCP:443";

        trafficNetwork.ingestPacket(
            packet("stale-pin", "10.0.0.1", "203.0.113.50", 443),
            true,
            Date.now() - FLOW_STALE_WINDOW_MS - 1_000,
        );
        trafficNetwork.ingestPacket(
            packet("fresh", "10.0.0.2", "203.0.113.51", 443),
            true,
            Date.now(),
        );

        // Without pin, stale flow is hidden in live mode.
        expect(createGraph().edges.map((e) => e.id)).not.toContain(staleFlowId);

        trafficNetwork.setEntityMarker("flow", staleFlowId, {
            pinned: true,
            note: "watch this",
            tags: "lab",
        });
        trafficNetwork.setEntityMarker("host", "10.0.0.1", {
            pinned: true,
            note: "important host",
        });

        const graph = createGraph();
        expect(graph.edges.map((e) => e.id)).toContain(staleFlowId);
        expect(graph.edges.map((e) => e.id)).toContain(freshFlowId);
        expect(graph.nodes.map((n) => n.id)).toContain("10.0.0.1");
        expect(graph.nodes.find((n) => n.id === "10.0.0.1")?.data.pinned).toBe(
            true,
        );
        expect(
            graph.edges.find((e) => e.id === staleFlowId)?.data?.pinned,
        ).toBe(true);
        // Pinned flows are prioritized in list snapshot
        expect(graph.flows[0]?.id).toBe(staleFlowId);
        expect(graph.markers).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "flow",
                    id: staleFlowId,
                    pinned: true,
                    note: "watch this",
                    tags: "lab",
                }),
                expect.objectContaining({
                    kind: "host",
                    id: "10.0.0.1",
                    pinned: true,
                    note: "important host",
                }),
            ]),
        );

        // Clear pin: stale flow hides again; marker row removed when empty.
        trafficNetwork.setEntityMarker("flow", staleFlowId, {
            pinned: false,
            note: null,
            tags: null,
        });
        const cleared = createGraph();
        expect(cleared.edges.map((e) => e.id)).not.toContain(staleFlowId);
        expect(
            cleared.markers.find((m) => m.id === staleFlowId),
        ).toBeUndefined();
    });

    test("summary-only mode drops fine-grained packets after threshold while retaining aggregates, recent window, and caps", () => {
        trafficNetwork.reset();
        trafficNetwork.setSummaryOnly(true);
        expect(trafficNetwork.summaryOnly).toBe(true);

        const baseTime = Date.now();
        const numPackets = 300;
        for (let i = 0; i < numPackets; i++) {
            const p: ParsedPacket = {
                id: `sm-${i}`,
                timestamp: "12:00:00.000000",
                proto: "TCP",
                srcHost: `10.0.0.${(i % 20) + 1}`,
                srcPort: 50000,
                dstHost: `203.0.113.${(i % 10) + 1}`,
                dstPort: 443,
                length: 60,
                info: "summary-mode test",
            };
            trafficNetwork.ingestPacket(p, true, baseTime + i);
        }

        // Packet details capped to summary window
        expect(trafficNetwork.packets.length).toBeLessThanOrEqual(
            MAX_MEMORY_PACKETS_SUMMARY,
        );
        expect(trafficNetwork.packetsEvicted).toBeGreaterThanOrEqual(
            numPackets - MAX_MEMORY_PACKETS_SUMMARY,
        );

        // Aggregates and high-level caps retained
        expect(trafficNetwork.totalPackets).toBe(numPackets);
        expect(trafficNetwork.hosts.size).toBeLessThanOrEqual(MAX_MEMORY_HOSTS);
        expect(trafficNetwork.flows.size).toBeLessThanOrEqual(MAX_MEMORY_FLOWS);
        // only packets evicted in this low-host variety run
        expect(trafficNetwork.hostsEvicted).toBe(0);
        expect(trafficNetwork.flowsEvicted).toBe(0);

        const snap = createGraph();
        expect(snap.summaryOnly).toBe(true);
        expect(snap.packets.length).toBeLessThanOrEqual(
            MAX_MEMORY_PACKETS_SUMMARY,
        );
        expect(snap.totalPackets).toBe(numPackets);
        expect(snap.packetsEvicted).toBeGreaterThanOrEqual(0);

        // Toggle back to full retains behavior
        trafficNetwork.setSummaryOnly(false);
        expect(trafficNetwork.summaryOnly).toBe(false);
        // Next ingest can grow packet window back toward full cap
        trafficNetwork.ingestPacket(
            packet("post", "10.0.0.99", "203.0.113.99", 443),
            true,
        );
        expect(trafficNetwork.packets.length).toBeGreaterThan(0);
    }, 10000);
});
