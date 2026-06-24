import type { TrafficHost } from "./lib/trafficNetwork";
import type { HostCategory } from "./types";

export const HOST_NODE_SIZE = {
    width: 204,
    height: 104,
};

const ROW_GAP = 14;
const COL_GAP = 36;
const TIER_GAP = 100;
const MAX_ROWS_PER_COLUMN = 5;
const ROW_STEP = HOST_NODE_SIZE.height + ROW_GAP;
const COLUMN_STEP = HOST_NODE_SIZE.width + COL_GAP;
const TIER_STEP = HOST_NODE_SIZE.width + TIER_GAP;

function stableSort(hosts: TrafficHost[]): TrafficHost[] {
    return [...hosts].sort((left, right) => left.id.localeCompare(right.id));
}

function placeTier(
    hosts: TrafficHost[],
    rightX: number,
    centerY: number,
    positions: Map<string, { x: number; y: number }>,
): number {
    const sorted = stableSort(hosts);
    if (sorted.length === 0) {
        return rightX;
    }

    const rowCount = Math.min(MAX_ROWS_PER_COLUMN, sorted.length);
    const colCount = Math.ceil(sorted.length / rowCount);

    for (let index = 0; index < sorted.length; index += 1) {
        const host = sorted[index];
        if (!host) {
            continue;
        }

        const column = Math.floor(index / rowCount);
        const row = index % rowCount;
        const rowsInColumn = Math.min(
            rowCount,
            sorted.length - column * rowCount,
        );
        const x = rightX - column * COLUMN_STEP;
        const yOffset = (row - (rowsInColumn - 1) / 2) * ROW_STEP;

        positions.set(host.id, {
            x: Math.round(x),
            y: Math.round(centerY + yOffset),
        });
    }

    return rightX - (colCount - 1) * COLUMN_STEP;
}

const SAME_COLUMN_THRESHOLD = 24;

export function resolveEdgeHandles(
    source: { x: number; y: number },
    target: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
    const dx = target.x - source.x;
    const dy = target.y - source.y;

    if (Math.abs(dx) <= SAME_COLUMN_THRESHOLD) {
        if (dy >= 0) {
            return {
                sourceHandle: "source-bottom",
                targetHandle: "target-top",
            };
        }
        return { sourceHandle: "source-top", targetHandle: "target-bottom" };
    }

    if (dx >= 0) {
        return { sourceHandle: "source-right", targetHandle: "target-left" };
    }

    return { sourceHandle: "source-left", targetHandle: "target-right" };
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

    const localLeftX = placeTier(grouped.local, center.x, center.y, positions);

    let nextRightX = localLeftX - TIER_STEP;
    if (grouped.private.length > 0) {
        const privateLeftX = placeTier(
            grouped.private,
            nextRightX,
            center.y,
            positions,
        );
        nextRightX = privateLeftX - TIER_STEP;
    }

    if (grouped.public.length > 0) {
        placeTier(grouped.public, nextRightX, center.y, positions);
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
    if (value < 1024 * 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatPacketCount(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 100_000) {
        return `${Math.round(value / 1_000)}K`;
    }
    if (value >= 10_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toLocaleString("en-US");
}

export function categoryLabel(category: HostCategory): string {
    switch (category) {
        case "local":
            return "LOCAL";
        case "private":
            return "PRIVATE";
        case "public":
            return "PUBLIC";
        default:
            return category satisfies never;
    }
}

export function categoryColor(category: HostCategory): string {
    switch (category) {
        case "local":
            return "#7ce3b7";
        case "private":
            return "#66aec4";
        case "public":
            return "#efc26d";
        default:
            return category satisfies never;
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
