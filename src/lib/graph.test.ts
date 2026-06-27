import { describe, expect, test } from "bun:test";
import { createGraph, FLOW_STALE_WINDOW_MS } from "./graph";
import type { ParsedPacket } from "./tcpdumpParser";
import { trafficNetwork } from "./trafficNetwork";

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
        trafficNetwork.reset();
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
        trafficNetwork.reset();
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
        trafficNetwork.reset();
    });
});
