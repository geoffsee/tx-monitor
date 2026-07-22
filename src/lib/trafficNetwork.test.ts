import { beforeEach, expect, test } from "bun:test";
import type { ParsedPacket } from "./tcpdumpParser";
import {
    MAX_MEMORY_ANOMALIES,
    MAX_MEMORY_FLOWS,
    trafficNetwork,
} from "./trafficNetwork";

beforeEach(() => {
    trafficNetwork.reset();
    trafficNetwork.setSensitivity("medium");
});

// Each distinct flow key that crosses the large-transfer threshold produces a
// `large-flow-<flowId>` anomaly. Under high-churn ingest the set of all-time
// distinct flow keys is effectively unbounded, so without eviction cleanup the
// anomalies map (and the private flowArrivals map) grew without limit and the
// per-frame anomalyList sort on the render path eventually froze the tab.
function largeTransferPacket(index: number): ParsedPacket {
    return {
        id: `pkt-${index}`,
        timestamp: "12:00:00.000000",
        proto: "TCP",
        srcHost: "192.168.1.100",
        srcPort: 40000 + (index % 20000),
        // Wide distinct destination space -> new flow key every packet.
        dstHost: `93.184.${Math.floor(index / 254) % 254}.${(index % 254) + 1}`,
        dstPort: 1000 + (index % 60000),
        length: 101 * 1024 * 1024, // 101MB > 100MB medium threshold
        info: "bulk transfer",
    };
}

test("anomalies map stays bounded under high-churn ingest", () => {
    for (let i = 0; i < 2500; i++) {
        trafficNetwork.ingestPacket(largeTransferPacket(i), true);
    }

    expect(trafficNetwork.anomalies.size).toBeLessThanOrEqual(
        MAX_MEMORY_ANOMALIES,
    );
    expect(trafficNetwork.flows.size).toBeLessThanOrEqual(MAX_MEMORY_FLOWS);
    // Eviction actually ran (otherwise the bound is trivially satisfied).
    expect(trafficNetwork.flowsEvicted).toBeGreaterThan(0);
});

test("evicting a flow drops its anomalies (no dangling references)", () => {
    for (let i = 0; i < 2500; i++) {
        trafficNetwork.ingestPacket(largeTransferPacket(i), true);
    }

    // Every surviving flow-scoped anomaly must reference a live flow; if
    // forgetFlow did not run on eviction, evicted flows would leave orphaned
    // anomalies behind here.
    for (const anomaly of trafficNetwork.anomalies.values()) {
        if (anomaly.flowId) {
            expect(trafficNetwork.flows.has(anomaly.flowId)).toBe(true);
        }
    }
});

test("evicting a host drops its host-scoped anomalies", () => {
    // Suspicious-port anomalies are keyed by destination host; churn a wide host
    // space so hosts evict, then assert no anomaly references an evicted host.
    for (let i = 0; i < 2000; i++) {
        trafficNetwork.ingestPacket(
            {
                id: `sp-${i}`,
                timestamp: "12:00:00.000000",
                proto: "TCP",
                srcHost: "192.168.1.100",
                srcPort: 50000 + (i % 10000),
                dstHost: `203.0.${Math.floor(i / 254) % 254}.${(i % 254) + 1}`,
                dstPort: 445, // suspicious port -> host-scoped anomaly
                length: 128,
                info: "smb probe",
            },
            true,
        );
    }

    expect(trafficNetwork.hostsEvicted).toBeGreaterThan(0);
    for (const anomaly of trafficNetwork.anomalies.values()) {
        if (anomaly.hostId) {
            expect(trafficNetwork.hosts.has(anomaly.hostId)).toBe(true);
        }
    }
});
