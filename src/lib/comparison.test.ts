import { beforeEach, describe, expect, test } from "bun:test";
import {
    clearComparisonContext,
    getComparisonContext,
    getComparisonFlowCount,
    getComparisonHostCount,
    isFlowInComparison,
    isHostInComparison,
    MAX_COMPARISON_ENTRIES,
    setComparisonContext,
} from "./comparison";
import type { ParsedPacket } from "./tcpdumpParser";
import { trafficNetwork } from "./trafficNetwork";

beforeEach(() => {
    clearComparisonContext();
    trafficNetwork.reset();
});

describe("comparison context", () => {
    test("starts empty", () => {
        expect(getComparisonContext()).toBeNull();
        expect(isHostInComparison("10.0.0.1")).toBe(false);
        expect(isFlowInComparison("a->b:TCP:443")).toBe(false);
        expect(getComparisonHostCount()).toBe(0);
        expect(getComparisonFlowCount()).toBe(0);
    });

    test("setComparisonContext installs host and flow lookups", () => {
        setComparisonContext(
            "sess-1",
            "reference",
            ["10.0.0.1", "10.0.0.2"],
            ["10.0.0.1->8.8.8.8:UDP:53"],
        );

        const ctx = getComparisonContext();
        expect(ctx?.sessionId).toBe("sess-1");
        expect(ctx?.label).toBe("reference");
        expect(isHostInComparison("10.0.0.1")).toBe(true);
        expect(isHostInComparison("10.0.0.9")).toBe(false);
        expect(isFlowInComparison("10.0.0.1->8.8.8.8:UDP:53")).toBe(true);
        expect(isFlowInComparison("other")).toBe(false);
        expect(getComparisonHostCount()).toBe(2);
        expect(getComparisonFlowCount()).toBe(1);
    });

    test("clearComparisonContext removes all state", () => {
        setComparisonContext("s", "lab", ["h1"], ["f1"]);
        clearComparisonContext();
        expect(getComparisonContext()).toBeNull();
        expect(isHostInComparison("h1")).toBe(false);
        expect(isFlowInComparison("f1")).toBe(false);
        expect(getComparisonHostCount()).toBe(0);
        expect(getComparisonFlowCount()).toBe(0);
    });

    test("setComparisonContext truncates to MAX_COMPARISON_ENTRIES", () => {
        const hosts = Array.from(
            { length: MAX_COMPARISON_ENTRIES + 50 },
            (_, i) => `h${i}`,
        );
        const flows = Array.from(
            { length: MAX_COMPARISON_ENTRIES + 50 },
            (_, i) => `f${i}`,
        );
        setComparisonContext("cap", "capped", hosts, flows);
        expect(getComparisonHostCount()).toBe(MAX_COMPARISON_ENTRIES);
        expect(getComparisonFlowCount()).toBe(MAX_COMPARISON_ENTRIES);
        expect(isHostInComparison("h0")).toBe(true);
        expect(isHostInComparison(`h${MAX_COMPARISON_ENTRIES}`)).toBe(false);
        expect(isFlowInComparison("f0")).toBe(true);
        expect(isFlowInComparison(`f${MAX_COMPARISON_ENTRIES}`)).toBe(false);
    });

    test("skips empty host/flow strings when capping", () => {
        setComparisonContext("s", "lab", ["", "host-a", ""], ["", "flow-a"]);
        expect(getComparisonHostCount()).toBe(1);
        expect(getComparisonFlowCount()).toBe(1);
        expect(isHostInComparison("host-a")).toBe(true);
        expect(isFlowInComparison("flow-a")).toBe(true);
    });

    test("replaces prior context on subsequent set", () => {
        setComparisonContext("a", "A", ["h1"], ["f1"]);
        setComparisonContext("b", "B", ["h2"], ["f2"]);
        expect(getComparisonContext()?.sessionId).toBe("b");
        expect(isHostInComparison("h1")).toBe(false);
        expect(isHostInComparison("h2")).toBe(true);
        expect(isFlowInComparison("f1")).toBe(false);
        expect(isFlowInComparison("f2")).toBe(true);
    });

    test("comparison flow keys match trafficNetwork flow ids after ingest", () => {
        const packet: ParsedPacket = {
            id: "p1",
            timestamp: "12:00:00.000000",
            proto: "TCP",
            srcHost: "10.0.0.1",
            srcPort: 54321,
            dstHost: "203.0.113.10",
            dstPort: 443,
            length: 64,
            info: "test",
        };
        trafficNetwork.ingestPacket(packet, true, Date.now());

        const flowId = `${packet.srcHost}->${packet.dstHost}:${packet.proto}:${packet.dstPort ?? "any"}`;
        const networkFlow = trafficNetwork.flowList.find(
            (f) => f.id === flowId,
        );
        expect(networkFlow).toBeDefined();

        setComparisonContext(
            "cmp",
            "match",
            [packet.srcHost, packet.dstHost],
            [flowId],
        );
        expect(isFlowInComparison(networkFlow!.id)).toBe(true);
        expect(isHostInComparison(packet.srcHost)).toBe(true);
        expect(isHostInComparison(packet.dstHost)).toBe(true);
    });

    test("null dstPort uses 'any' in the shared flow key format", () => {
        const packet: ParsedPacket = {
            id: "p2",
            timestamp: "12:00:01.000000",
            proto: "ICMP",
            srcHost: "10.0.0.2",
            srcPort: null,
            dstHost: "10.0.0.3",
            dstPort: null,
            length: 32,
            info: "icmp",
        };
        trafficNetwork.ingestPacket(packet, true, Date.now());

        const flowId = `${packet.srcHost}->${packet.dstHost}:${packet.proto}:any`;
        expect(trafficNetwork.flowList.some((f) => f.id === flowId)).toBe(true);

        setComparisonContext("cmp", "icmp", [packet.srcHost], [flowId]);
        expect(isFlowInComparison(flowId)).toBe(true);
    });
});
