import { expect, test } from "bun:test";
import type { ParsedPacket } from "./tcpdumpParser";
import { trafficNetwork } from "./trafficNetwork";

test("identifies large flow anomaly", () => {
    trafficNetwork.reset();

    const packet: ParsedPacket = {
        id: "p1",
        timestamp: "12:00:00.000000",
        proto: "TCP",
        srcHost: "192.168.1.1",
        srcPort: 12345,
        dstHost: "1.1.1.1",
        dstPort: 443,
        length: 101 * 1024 * 1024, // 101MB
        info: "Test packet",
    };

    trafficNetwork.ingestPacket(packet);

    expect(
        trafficNetwork.anomalyList.some(
            (a) => a.type === "Large Data Transfer",
        ),
    ).toBe(true);
});

test("identifies suspicious port anomaly on public IP", () => {
    trafficNetwork.reset();

    const packet: ParsedPacket = {
        id: "p2",
        timestamp: "12:00:01.000000",
        proto: "TCP",
        srcHost: "8.8.8.8",
        srcPort: 54321,
        dstHost: "192.168.1.5",
        dstPort: 445, // SMB
        length: 100,
        info: "Suspicious packet",
    };

    trafficNetwork.ingestPacket(packet);

    expect(
        trafficNetwork.anomalyList.some(
            (a) => a.type === "Suspicious External Port",
        ),
    ).toBe(true);
});

test("identifies high rate anomaly at default sensitivity", () => {
    trafficNetwork.reset();

    const base: ParsedPacket = {
        id: "r0",
        timestamp: "12:00:00.000000",
        proto: "TCP",
        srcHost: "10.0.0.1",
        srcPort: 1111,
        dstHost: "10.0.0.2",
        dstPort: 80,
        length: 100,
        info: "rate test",
    };

    // Ingest many packets in quick succession (synthetic times to avoid wall-clock variance)
    const baseTime = 1_000_000;
    for (let i = 0; i < 10; i++) {
        trafficNetwork.ingestPacket(
            { ...base, id: `r${i}` },
            false,
            baseTime + i * 10,
        );
    }

    expect(
        trafficNetwork.anomalyList.some(
            (a) =>
                a.type === "High Rate" &&
                a.flowId?.includes("10.0.0.1->10.0.0.2"),
        ),
    ).toBe(true);
});

test("large transfer threshold varies with sensitivity", () => {
    trafficNetwork.reset();
    trafficNetwork.setSensitivity("high");

    const pkt: ParsedPacket = {
        id: "l1",
        timestamp: "12:00:00.000000",
        proto: "TCP",
        srcHost: "192.168.1.10",
        srcPort: 2222,
        dstHost: "1.1.1.1",
        dstPort: 443,
        length: 60 * 1024 * 1024, // 60MB > 50MB high threshold
        info: "big",
    };
    trafficNetwork.ingestPacket(pkt);

    expect(
        trafficNetwork.anomalyList.some(
            (a) => a.type === "Large Data Transfer",
        ),
    ).toBe(true);

    trafficNetwork.reset();
    trafficNetwork.setSensitivity("low");
    trafficNetwork.ingestPacket({
        ...pkt,
        id: "l2",
        length: 120 * 1024 * 1024, // still under 200MB low
    });
    // At low, 120MB should not trigger large yet
    expect(
        trafficNetwork.anomalyList.some(
            (a) => a.type === "Large Data Transfer",
        ),
    ).toBe(false);
});

test("detects beaconing with periodic arrivals", () => {
    trafficNetwork.reset();
    trafficNetwork.setSensitivity("medium");

    const baseTime = 1_000_000;
    const interval = 500;
    const flowBase: ParsedPacket = {
        id: "b0",
        timestamp: "12:00:00.000000",
        proto: "UDP",
        srcHost: "192.168.1.5",
        srcPort: 3333,
        dstHost: "203.0.113.9",
        dstPort: 1234,
        length: 50,
        info: "beacon",
    };

    for (let i = 0; i < 5; i++) {
        trafficNetwork.ingestPacket(
            { ...flowBase, id: `b${i}` },
            false,
            baseTime + i * interval,
        );
    }

    expect(
        trafficNetwork.anomalyList.some(
            (a) => a.type === "Beaconing" && a.flowId?.includes("203.0.113.9"),
        ),
    ).toBe(true);
});

test("detects high DNS volume and broad DNS targets at high sensitivity", () => {
    trafficNetwork.reset();
    trafficNetwork.setSensitivity("high");

    // Generate many DNS packets to distinct targets to trigger both
    for (let i = 0; i < 20; i++) {
        const pkt: ParsedPacket = {
            id: `d${i}`,
            timestamp: `12:00:${String(i).padStart(2, "0")}.000000`,
            proto: "UDP",
            srcHost: "192.168.1.10",
            srcPort: 5353,
            dstHost: `8.8.8.${(i % 5) + 1}`,
            dstPort: 53,
            length: 60,
            info: "DNS",
        };
        trafficNetwork.ingestPacket(pkt);
    }

    const types = trafficNetwork.anomalyList.map((a) => a.type);
    expect(types).toContain("High DNS Volume");
    expect(types).toContain("Broad DNS Activity");
});
