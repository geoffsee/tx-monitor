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
    /**
     * When a comparison overlay is active: true = also in comparison
     * (shared/common), false = primary-only (delta). Undefined when no
     * comparison is loaded.
     */
    inComparison?: boolean;
    pinned?: boolean;
};

export type FlowEdgeData = {
    label?: string;
    labelColor: string;
    stroke: string;
    active: boolean;
    /**
     * When a comparison overlay is active: true = shared/common,
     * false = primary-only (delta). Undefined when no comparison.
     */
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
    /** Hosts retained from the comparison (overlay) session. */
    hostCount: number;
    /** Flows retained from the comparison (overlay) session. */
    flowCount: number;
    /** Hosts present in both primary and comparison. */
    commonHostCount: number;
    /** Flows present in both primary and comparison. */
    commonFlowCount: number;
    /** Hosts present only in the primary (delta). */
    deltaHostCount: number;
    /** Flows present only in the primary (delta). */
    deltaFlowCount: number;
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
        srcPort: number | null;
        dstPort: number | null;
        length: number;
        info: string;
        process?: ProcessSummary;
        /**
         * When a comparison overlay is active: true = flow key also in
         * comparison (shared), false = primary-only (delta). Undefined when
         * no comparison is loaded.
         */
        inComparison?: boolean;
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
        /**
         * When a comparison overlay is active: true = shared with comparison
         * session, false = primary-only (delta). Undefined when no comparison.
         */
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
    /**
     * Full id→display-label map for hosts known to trafficNetwork (not limited
     * to laid-out graph.nodes / MAX_GRAPH_HOSTS). Used by copilot and any
     * consumer that must label flows/packets outside the graph cap.
     */
    hostLabels: Record<string, string>;
};
