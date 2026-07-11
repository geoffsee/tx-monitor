import type { Edge, Node } from "@xyflow/react";

export type HostCategory = "local" | "private" | "public";

export type HostNodeData = {
    label: string;
    address: string;
    category: HostCategory;
    packetCount: number;
    bytesTotal: string;
    processes?: string[];
    processCount?: number;
    resolvedDns?: string;
    inComparison?: boolean;
    pinned?: boolean;
};

export type FlowEdgeData = {
    label?: string;
    labelColor: string;
    stroke: string;
    active: boolean;
    inComparison?: boolean;
    pinned?: boolean;
};

export type Selection =
    | { kind: "host"; id: string }
    | { kind: "flow"; id: string }
    | { kind: "packet"; id: string };

export type CaptureSessionSummary = {
    id: string;
    mode: string;
    label: string;
    startedAt: number;
    endedAt: number | null;
    totalPackets: number;
    totalBytes: number;
    hostname: string | null;
    cmdline: string | null;
    notes: string | null;
    tags: string | null;
};

export type TrafficViewMode = "live" | "history";

export type ComparisonSummary = {
    sessionId: string;
    label: string;
    hostCount: number;
    flowCount: number;
    commonHostCount: number;
    commonFlowCount: number;
};

export type SessionLoadProgress = {
    loaded: number;
    total: number;
};

export type Anomaly = {
    id: string;
    timestamp: number;
    severity: "low" | "medium" | "high";
    type: string;
    description: string;
    hostId?: string;
    flowId?: string;
};

export type EntityMarker = {
    kind: "host" | "flow";
    id: string;
    pinned: boolean;
    note: string | null;
    tags: string | null;
};

export type ProcessSummary = {
    command: string;
    pid: number;
    user: string;
};

/** Why an entity was dropped from in-memory state (telemetry, not silent loss). */
export type EvictionReason =
    | "host_cap"
    | "flow_cap"
    | "flow_orphan"
    | "packet_window"
    | "summary_mode";

export type EvictionByReason = Record<EvictionReason, number>;

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
        process?: ProcessSummary;
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
        process?: ProcessSummary;
        inComparison?: boolean;
    }>;
    anomalies: Anomaly[];
    events: string[];
    totalPackets: number;
    totalBytes: number;
    hostCount: number;
    flowCount: number;
    hostsEvicted: number;
    flowsEvicted: number;
    packetsEvicted: number;
    /** Cumulative counts by eviction reason (hosts/flows/packets). */
    evictionByReason: EvictionByReason;
    summaryOnly: boolean;
    connected: boolean;
    sourceLabel: string;
    capture: {
        iface: string;
        direction: string;
        bpf: string;
    };
    sensitivity: "low" | "medium" | "high";
    comparison?: ComparisonSummary;
    markers: EntityMarker[];
};
