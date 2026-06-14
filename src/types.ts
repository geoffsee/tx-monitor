import type { Edge, Node } from "@xyflow/react";

export type HostCategory = "local" | "private" | "public";

export type HostNodeData = {
    label: string;
    address: string;
    category: HostCategory;
    packetCount: number;
    bytesTotal: string;
};

export type FlowEdgeData = {
    label?: string;
    labelColor: string;
    stroke: string;
    active: boolean;
};

export type Selection =
    | { kind: "host"; id: string }
    | { kind: "flow"; id: string }
    | { kind: "packet"; id: string };

export type TrafficSnapshot = {
    nodes: Node<HostNodeData>[];
    edges: Edge<FlowEdgeData>[];
    packets: Array<{
        id: string;
        timestamp: string;
        proto: string;
        srcHost: string;
        dstHost: string;
        length: number;
        info: string;
    }>;
    flows: Array<{
        id: string;
        srcHost: string;
        dstHost: string;
        proto: string;
        dstPort: number | null;
        packetCount: number;
        bytesTotal: number;
        active: boolean;
    }>;
    events: string[];
    totalPackets: number;
    totalBytes: number;
    hostCount: number;
    flowCount: number;
    connected: boolean;
    sourceLabel: string;
};
