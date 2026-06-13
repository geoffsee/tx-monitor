import { describe, expect, test } from "bun:test";
import { HOST_NODE_SIZE, layoutHosts } from "./layout";
import type { TrafficHost } from "./trafficNetwork";

function makeHost(
    id: string,
    category: TrafficHost["category"],
): TrafficHost {
    return {
        id,
        address: id,
        label: id,
        category,
        packetCount: 1,
        bytesTotal: 1,
    };
}

function minDistance(
    positions: Map<string, { x: number; y: number }>,
): number {
    const points = [...positions.values()];
    let min = Number.POSITIVE_INFINITY;

    for (let left = 0; left < points.length; left += 1) {
        for (let right = left + 1; right < points.length; right += 1) {
            const dx = points[left]!.x - points[right]!.x;
            const dy = points[left]!.y - points[right]!.y;
            min = Math.min(min, Math.hypot(dx, dy));
        }
    }

    return min;
}

describe("layoutHosts", () => {
    test("keeps public hosts separated on a full ring", () => {
        const hosts = Array.from({ length: 18 }, (_, index) =>
            makeHost(`203.0.113.${index + 1}`, "public"),
        );
        const positions = layoutHosts(hosts);

        expect(positions.size).toBe(18);
        expect(minDistance(positions)).toBeGreaterThan(HOST_NODE_SIZE.width * 0.55);
    });

    test("uses stable positions regardless of input order", () => {
        const hosts = [
            makeHost("10.0.0.2", "private"),
            makeHost("203.0.113.10", "public"),
            makeHost("127.1.2.3", "local"),
            makeHost("10.0.0.3", "private"),
        ];
        const reversed = [...hosts].reverse();
        const forward = layoutHosts(hosts);
        const backward = layoutHosts(reversed);

        for (const host of hosts) {
            expect(forward.get(host.id)).toEqual(backward.get(host.id));
        }
    });
});
