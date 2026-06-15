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

    expect(trafficNetwork.anomalyList.length).toBe(1);
    expect(trafficNetwork.anomalyList[0]?.type).toBe("Large Data Transfer");
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

    expect(trafficNetwork.anomalyList.length).toBe(1);
    expect(trafficNetwork.anomalyList[0]?.type).toBe(
        "Suspicious External Port",
    );
});
