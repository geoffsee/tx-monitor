import type { TrafficHost } from "./trafficNetwork";

export const HOST_NODE_SIZE = {
    width: 168,
    height: 108,
};

const MIN_NODE_GAP = 32;
const RING_GAP = 140;

function stableSort(hosts: TrafficHost[]): TrafficHost[] {
    return [...hosts].sort((left, right) => left.id.localeCompare(right.id));
}

function ringRadiusForCount(count: number, minRadius: number): number {
    if (count <= 1) {
        return minRadius;
    }

    const slot = HOST_NODE_SIZE.width + MIN_NODE_GAP;
    const needed = (count * slot) / (2 * Math.PI);
    return Math.max(minRadius, needed);
}

function placeOnRing(
    hosts: TrafficHost[],
    radius: number,
    center: { x: number; y: number },
    positions: Map<string, { x: number; y: number }>,
    angleOffset = -Math.PI / 2,
) {
    const sorted = stableSort(hosts);
    const count = sorted.length;

    for (let index = 0; index < count; index += 1) {
        const host = sorted[index]!;
        const angle = angleOffset + (index / count) * Math.PI * 2;
        positions.set(host.id, {
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius,
        });
    }
}

export function layoutHosts(
    hosts: TrafficHost[],
    center = { x: 0, y: 0 },
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const grouped = {
        local: hosts.filter((host) => host.category === "local"),
        private: hosts.filter((host) => host.category === "private"),
        public: hosts.filter((host) => host.category === "public"),
    };

    if (grouped.local.length === 1) {
        positions.set(grouped.local[0]!.id, { ...center });
    } else if (grouped.local.length > 1) {
        placeOnRing(
            grouped.local,
            ringRadiusForCount(grouped.local.length, 90),
            center,
            positions,
        );
    }

    let nextRadius = ringRadiusForCount(grouped.private.length, 220);
    if (grouped.private.length > 0) {
        placeOnRing(grouped.private, nextRadius, center, positions, -Math.PI / 2);
        nextRadius += ringRadiusForCount(grouped.private.length, 220) + RING_GAP;
    }

    if (grouped.public.length > 0) {
        const publicRadius = Math.max(
            nextRadius,
            ringRadiusForCount(grouped.public.length, 360),
        );
        placeOnRing(grouped.public, publicRadius, center, positions, Math.PI / 6);
    }

    for (const host of hosts) {
        if (!positions.has(host.id)) {
            const overflow = hosts.filter((entry) => !positions.has(entry.id));
            const overflowRadius = ringRadiusForCount(overflow.length, 480);
            placeOnRing(overflow, overflowRadius, center, positions);
            break;
        }
    }

    return positions;
}

export function formatBytes(value: number): string {
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function categoryLabel(category: TrafficHost["category"]): string {
    switch (category) {
        case "local":
            return "LOCAL";
        case "private":
            return "PRIVATE";
        case "public":
            return "PUBLIC";
    }
}

export function categoryColor(category: TrafficHost["category"]): string {
    switch (category) {
        case "local":
            return "#7ce3b7";
        case "private":
            return "#66aec4";
        case "public":
            return "#efc26d";
    }
}

export function protoColor(proto: string): string {
    switch (proto) {
        case "TCP":
            return "#4dd0a8";
        case "UDP":
            return "#66aec4";
        case "ICMP":
            return "#efc26d";
        default:
            return "#9aa8b2";
    }
}
