import { describe, expect, test } from "bun:test";
import { HOST_NODE_SIZE, layoutHosts, resolveEdgeHandles } from "./layout";
import type { TrafficHost } from "./lib/trafficNetwork";

function makeHost(id: string, category: TrafficHost["category"]): TrafficHost {
    return {
        id,
        address: id,
        label: id,
        category,
        packetCount: 1,
        bytesTotal: 1,
    };
}

function minDistance(positions: Map<string, { x: number; y: number }>): number {
    const points = [...positions.values()];
    let min = Number.POSITIVE_INFINITY;

    for (let left = 0; left < points.length; left += 1) {
        const leftPoint = points[left];
        if (!leftPoint) {
            continue;
        }

        for (let right = left + 1; right < points.length; right += 1) {
            const rightPoint = points[right];
            if (!rightPoint) {
                continue;
            }

            const dx = leftPoint.x - rightPoint.x;
            const dy = leftPoint.y - rightPoint.y;
            min = Math.min(min, Math.hypot(dx, dy));
        }
    }

    return min;
}

describe("layoutHosts", () => {
    test("wraps large public tiers into multiple columns", () => {
        const hosts = Array.from({ length: 18 }, (_, index) =>
            makeHost(`203.0.113.${index + 1}`, "public"),
        );
        const positions = layoutHosts(hosts);

        expect(positions.size).toBe(18);
        expect(minDistance(positions)).toBeGreaterThan(
            HOST_NODE_SIZE.width * 0.55,
        );

        const ys = [...positions.values()].map((point) => point.y);
        const heightSpan = Math.max(...ys) - Math.min(...ys);
        expect(heightSpan).toBeLessThan(HOST_NODE_SIZE.height * 6);
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

    test("routes same-column edges vertically", () => {
        expect(resolveEdgeHandles({ x: 0, y: -60 }, { x: 0, y: 60 })).toEqual({
            sourceHandle: "source-bottom",
            targetHandle: "target-top",
        });
        expect(resolveEdgeHandles({ x: 0, y: 60 }, { x: 0, y: -60 })).toEqual({
            sourceHandle: "source-top",
            targetHandle: "target-bottom",
        });
    });

    test("routes cross-tier edges horizontally", () => {
        expect(resolveEdgeHandles({ x: -300, y: 0 }, { x: 0, y: 40 })).toEqual({
            sourceHandle: "source-right",
            targetHandle: "target-left",
        });
        expect(resolveEdgeHandles({ x: 0, y: 0 }, { x: -300, y: 40 })).toEqual({
            sourceHandle: "source-left",
            targetHandle: "target-right",
        });
    });
});
