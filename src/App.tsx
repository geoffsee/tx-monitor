import { useCallback, useEffect, useRef, useState } from "react";
import {
    Background,
    BackgroundVariant,
    BaseEdge,
    Controls,
    EdgeLabelRenderer,
    Handle,
    MarkerType,
    Panel,
    ReactFlow,
    type Edge,
    type EdgeProps,
    type Node,
    type NodeProps,
    type ReactFlowInstance,
    Position,
    getSmoothStepPath,
} from "@xyflow/react";
import { onSnapshot } from "mobx-state-tree";
import {
    HOST_NODE_SIZE,
    categoryColor,
    categoryLabel,
    formatBytes,
    layoutHosts,
    protoColor,
} from "./layout";
import { trafficNetwork } from "./trafficNetwork";
import type { ParsedPacket } from "./tcpdumpParser";

type HostNodeData = {
    label: string;
    address: string;
    category: "local" | "private" | "public";
    packetCount: number;
    bytesTotal: string;
};

type FlowEdgeData = {
    label?: string;
    labelColor: string;
    stroke: string;
    active: boolean;
};

type Selection =
    | { kind: "host"; id: string }
    | { kind: "flow"; id: string }
    | { kind: "packet"; id: string };

type TrafficSnapshot = {
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

function FlowEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
    selected,
}: EdgeProps<Edge<FlowEdgeData>>) {
    const [path, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
    });

    return (
        <>
            <BaseEdge
                id={id}
                path={path}
                markerEnd={markerEnd}
                style={{
                    stroke: data?.stroke,
                    strokeWidth: selected ? 5 : data?.active ? 3.5 : 2,
                    opacity: selected ? 1 : data?.active ? 1 : 0.45,
                    cursor: "pointer",
                }}
            />
            {data?.label ? (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: "absolute",
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                            background: "#141414",
                            color: data.labelColor,
                            padding: "4px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            lineHeight: 1,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {data.label}
                    </div>
                </EdgeLabelRenderer>
            ) : null}
        </>
    );
}

function HostNode({ data, selected }: NodeProps<Node<HostNodeData>>) {
    const accent = categoryColor(data.category);

    return (
        <div
            style={{
                width: HOST_NODE_SIZE.width,
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${selected ? accent : `${accent}33`}`,
                background: "linear-gradient(180deg, #0d1821 0%, #0a131a 100%)",
                color: "#d9e6ec",
                boxShadow: selected
                    ? `0 0 0 2px ${accent}55, 0 10px 24px rgba(0, 0, 0, 0.28)`
                    : "0 10px 24px rgba(0, 0, 0, 0.28)",
                fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif',
                cursor: "pointer",
            }}
        >
            <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
            <Handle type="target" position={Position.Right} style={{ opacity: 0 }} />
            <Handle type="source" position={Position.Left} style={{ opacity: 0 }} />
            <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                }}
            >
                <div style={{ minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: 10,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: accent,
                        }}
                    >
                        {categoryLabel(data.category)}
                    </div>
                    <div
                        style={{
                            marginTop: 3,
                            fontSize: 14,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {data.label}
                    </div>
                </div>
                <div
                    style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: `1px solid ${accent}44`,
                        background: `${accent}1f`,
                        color: accent,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                    }}
                >
                    {data.packetCount}
                </div>
            </div>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginTop: 12,
                }}
            >
                <div style={nodeMetricStyle}>
                    <div style={nodeMetricLabelStyle}>Packets</div>
                    <div style={nodeMetricValueStyle}>{data.packetCount}</div>
                </div>
                <div style={nodeMetricStyle}>
                    <div style={nodeMetricLabelStyle}>Volume</div>
                    <div style={nodeMetricValueStyle}>{data.bytesTotal}</div>
                </div>
            </div>
            <div
                style={{
                    marginTop: 10,
                    fontSize: 11,
                    color: "#7090a0",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {data.address}
            </div>
        </div>
    );
}

const nodeTypes = { host: HostNode };
const edgeTypes = { flow: FlowEdge };

const MAX_GRAPH_HOSTS = 24;
const MAX_GRAPH_FLOWS = 48;

function createGraph(): TrafficSnapshot {
    const hostList = trafficNetwork.hostList.slice(0, MAX_GRAPH_HOSTS);
    const hostIds = new Set(hostList.map((host) => host.id));
    const positions = layoutHosts(hostList);
    const activeFlowIds = new Set(
        trafficNetwork.activeFlows.map((flow) => flow.id),
    );

    const nodes = hostList.map((host) => ({
        id: host.id,
        type: "host",
        position: positions.get(host.id) ?? { x: 0, y: 0 },
        data: {
            label: host.label,
            address: host.address,
            category: host.category,
            packetCount: host.packetCount,
            bytesTotal: formatBytes(host.bytesTotal),
        },
    }));

    const edges = trafficNetwork.flowList
        .filter(
            (flow) => hostIds.has(flow.srcHost) && hostIds.has(flow.dstHost),
        )
        .slice(0, MAX_GRAPH_FLOWS)
        .map((flow) => {
        const active = activeFlowIds.has(flow.id);
        const stroke = protoColor(flow.proto);
        const portLabel = flow.dstPort ? `:${flow.dstPort}` : "";
        return {
            id: flow.id,
            source: flow.srcHost,
            target: flow.dstHost,
            type: "flow",
            animated: active,
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: stroke,
            },
            data: {
                label: active ? `${flow.proto}${portLabel}` : undefined,
                labelColor: stroke,
                stroke,
                active,
            },
        };
    });

    return {
        nodes,
        edges,
        packets: trafficNetwork.packets.map((packet) => ({
            id: packet.id,
            timestamp: packet.timestamp,
            proto: packet.proto,
            srcHost: packet.srcHost,
            dstHost: packet.dstHost,
            length: packet.length,
            info: packet.info,
        })),
        flows: trafficNetwork.flowList.slice(0, 12).map((flow) => ({
            id: flow.id,
            srcHost: flow.srcHost,
            dstHost: flow.dstHost,
            proto: flow.proto,
            dstPort: flow.dstPort,
            packetCount: flow.packetCount,
            bytesTotal: flow.bytesTotal,
            active: activeFlowIds.has(flow.id),
        })),
        events: [...trafficNetwork.events],
        totalPackets: trafficNetwork.totalPackets,
        totalBytes: trafficNetwork.totalBytes,
        hostCount: trafficNetwork.hosts.size,
        flowCount: trafficNetwork.flows.size,
        connected: trafficNetwork.connected,
        sourceLabel: trafficNetwork.sourceLabel,
    };
}

function resolveWsUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
}

function DetailPanel({
    selection,
    onClear,
    onSelectFlow,
}: {
    selection: Selection;
    onClear: () => void;
    onSelectFlow: (flowId: string) => void;
}) {
    if (selection.kind === "host") {
        const host = trafficNetwork.hosts.get(selection.id);
        if (!host) {
            return null;
        }

        const accent = categoryColor(host.category);
        const allFlows = trafficNetwork.flowList.filter(
            (flow) => flow.srcHost === host.id || flow.dstHost === host.id,
        );
        const flows = allFlows.slice(0, 8);
        const packets = trafficNetwork.packets
            .filter((packet) => packet.srcHost === host.id || packet.dstHost === host.id)
            .slice(0, 6);

        return (
            <section style={detailPanelStyle}>
                <div style={detailHeaderStyle}>
                    <div style={detailEyebrowStyle}>Host Details</div>
                    <button type="button" onClick={onClear} style={detailCloseButtonStyle}>
                        Close
                    </button>
                </div>
                <div style={{ ...detailBadgeStyle, color: accent, borderColor: `${accent}44`, background: `${accent}1f` }}>
                    {categoryLabel(host.category)}
                </div>
                <div style={detailTitleStyle}>{host.label}</div>
                <div style={detailSubtleStyle}>{host.address}</div>
                <div style={detailMetricGridStyle}>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Packets</div>
                        <div style={detailMetricValueStyle}>{host.packetCount}</div>
                    </div>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Volume</div>
                        <div style={detailMetricValueStyle}>{formatBytes(host.bytesTotal)}</div>
                    </div>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Flows</div>
                        <div style={detailMetricValueStyle}>{allFlows.length}</div>
                    </div>
                </div>
                {flows.length > 0 ? (
                    <>
                        <div style={detailSectionTitleStyle}>Connections</div>
                        <div style={{ display: "grid", gap: 4 }}>
                            {flows.map((flow) => (
                                <button
                                    key={flow.id}
                                    type="button"
                                    onClick={() => onSelectFlow(flow.id)}
                                    style={detailLinkRowStyle}
                                >
                                    <span style={{ fontWeight: 600, fontSize: 12 }}>
                                        {flow.srcHost === host.id ? "→" : "←"}{" "}
                                        {flow.srcHost === host.id ? flow.dstHost : flow.srcHost}
                                    </span>
                                    <span style={detailSubtleStyle}>
                                        {flow.proto}
                                        {flow.dstPort ? `:${flow.dstPort}` : ""} ·{" "}
                                        {flow.packetCount} pkts
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                ) : null}
                {packets.length > 0 ? (
                    <>
                        <div style={detailSectionTitleStyle}>Recent Packets</div>
                        <div style={{ display: "grid", gap: 4 }}>
                            {packets.map((packet) => (
                                <div key={packet.id} style={detailRowStyle}>
                                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                                        {packet.timestamp} · {packet.proto}
                                    </div>
                                    <div style={detailSubtleStyle}>
                                        {packet.srcHost} → {packet.dstHost} · {packet.length} B
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : null}
            </section>
        );
    }

    if (selection.kind === "flow") {
        const flow = trafficNetwork.flows.get(selection.id);
        if (!flow) {
            return null;
        }

        const stroke = protoColor(flow.proto);
        const active = trafficNetwork.activeFlows.some((entry) => entry.id === flow.id);
        const packets = trafficNetwork.packets
            .filter(
                (packet) =>
                    packet.srcHost === flow.srcHost &&
                    packet.dstHost === flow.dstHost &&
                    packet.proto === flow.proto &&
                    packet.dstPort === flow.dstPort,
            )
            .slice(0, 8);

        return (
            <section style={detailPanelStyle}>
                <div style={detailHeaderStyle}>
                    <div style={detailEyebrowStyle}>Flow Details</div>
                    <button type="button" onClick={onClear} style={detailCloseButtonStyle}>
                        Close
                    </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ ...detailBadgeStyle, color: stroke, borderColor: `${stroke}44`, background: `${stroke}1f` }}>
                        {flow.proto}
                        {flow.dstPort ? `:${flow.dstPort}` : ""}
                    </div>
                    <div style={statusBadgeStyle(active)}>{active ? "active" : "idle"}</div>
                </div>
                <div style={detailTitleStyle}>
                    {flow.srcHost} → {flow.dstHost}
                </div>
                <div style={detailMetricGridStyle}>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Packets</div>
                        <div style={detailMetricValueStyle}>{flow.packetCount}</div>
                    </div>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Volume</div>
                        <div style={detailMetricValueStyle}>{formatBytes(flow.bytesTotal)}</div>
                    </div>
                </div>
                {packets.length > 0 ? (
                    <>
                        <div style={detailSectionTitleStyle}>Recent Packets</div>
                        <div style={{ display: "grid", gap: 4 }}>
                            {packets.map((packet) => (
                                <div key={packet.id} style={detailRowStyle}>
                                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                                        {packet.timestamp} · {packet.length} B
                                    </div>
                                    <div style={detailSubtleStyle}>
                                        {packet.srcPort ?? "?"} → {packet.dstPort ?? "?"} ·{" "}
                                        {packet.info || "No payload summary"}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : null}
            </section>
        );
    }

    const packet = trafficNetwork.packets.find((entry) => entry.id === selection.id);
    if (!packet) {
        return null;
    }

    const stroke = protoColor(packet.proto);

    return (
        <section style={detailPanelStyle}>
            <div style={detailHeaderStyle}>
                <div style={detailEyebrowStyle}>Packet Details</div>
                <button type="button" onClick={onClear} style={detailCloseButtonStyle}>
                    Close
                </button>
            </div>
            <div style={{ ...detailBadgeStyle, color: stroke, borderColor: `${stroke}44`, background: `${stroke}1f` }}>
                {packet.proto}
            </div>
            <div style={detailTitleStyle}>{packet.timestamp}</div>
            <div style={detailMetricGridStyle}>
                <div style={detailMetricStyle}>
                    <div style={detailMetricLabelStyle}>Length</div>
                    <div style={detailMetricValueStyle}>{packet.length} B</div>
                </div>
                <div style={detailMetricStyle}>
                    <div style={detailMetricLabelStyle}>Source Port</div>
                    <div style={detailMetricValueStyle}>{packet.srcPort ?? "—"}</div>
                </div>
                <div style={detailMetricStyle}>
                    <div style={detailMetricLabelStyle}>Dest Port</div>
                    <div style={detailMetricValueStyle}>{packet.dstPort ?? "—"}</div>
                </div>
            </div>
            <div style={detailSectionTitleStyle}>Endpoints</div>
            <div style={detailRowStyle}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Source</div>
                <div style={detailSubtleStyle}>{packet.srcHost}</div>
            </div>
            <div style={detailRowStyle}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Destination</div>
                <div style={detailSubtleStyle}>{packet.dstHost}</div>
            </div>
            <div style={detailSectionTitleStyle}>Summary</div>
            <div style={{ ...detailRowStyle, whiteSpace: "normal", lineHeight: 1.45 }}>
                {packet.info || "No payload summary available"}
            </div>
        </section>
    );
}

function isRowSelected(selection: Selection | null, kind: Selection["kind"], id: string): boolean {
    return selection?.kind === kind && selection.id === id;
}

export default function App() {
    const [graph, setGraph] = useState<TrafficSnapshot>(() => createGraph());
    const [selection, setSelection] = useState<Selection | null>(null);
    const [isCompact, setIsCompact] = useState(() => window.innerWidth < 1220);
    const flowRef = useRef<ReactFlowInstance | null>(null);
    const lastFitBucket = useRef(-1);

    const selectItem = useCallback((next: Selection) => {
        setSelection((current) =>
            current?.kind === next.kind && current.id === next.id ? null : next,
        );
    }, []);

    const displayNodes = graph.nodes.map((node) => ({
        ...node,
        selected: isRowSelected(selection, "host", node.id),
    }));

    const displayEdges = graph.edges.map((edge) => ({
        ...edge,
        selected: isRowSelected(selection, "flow", edge.id),
    }));

    const fitGraphView = useCallback((hostCount: number) => {
        if (!flowRef.current || hostCount === 0) {
            return;
        }

        const fitBucket = Math.ceil(hostCount / 4);
        if (fitBucket === lastFitBucket.current) {
            return;
        }

        lastFitBucket.current = fitBucket;
        requestAnimationFrame(() => {
            flowRef.current?.fitView({
                padding: 0.22,
                duration: 240,
                includeHiddenNodes: false,
            });
        });
    }, []);

    useEffect(() => {
        const dispose = onSnapshot(trafficNetwork, () => {
            const nextGraph = createGraph();
            setGraph(nextGraph);
            fitGraphView(nextGraph.nodes.length);
        });
        const onResize = () => setIsCompact(window.innerWidth < 1220);
        window.addEventListener("resize", onResize);

        const socket = new WebSocket(resolveWsUrl());
        let pendingPackets: ParsedPacket[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const flushPackets = () => {
            if (pendingPackets.length === 0) {
                return;
            }
            trafficNetwork.ingestBatch(pendingPackets);
            pendingPackets = [];
            flushTimer = null;
        };

        const scheduleFlush = () => {
            if (flushTimer) {
                return;
            }
            flushTimer = setTimeout(flushPackets, 80);
        };

        socket.addEventListener("open", () => {
            trafficNetwork.setConnection(true);
        });

        socket.addEventListener("close", () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            flushPackets();
            trafficNetwork.setConnection(false);
        });

        socket.addEventListener("message", (event) => {
            const payload = JSON.parse(String(event.data)) as
                | { type: "packet"; packet: ParsedPacket }
                | { type: "status"; mode: string; label: string }
                | { type: "error"; message: string }
                | { type: "complete" };

            if (payload.type === "packet") {
                pendingPackets.push(payload.packet);
                scheduleFlush();
                return;
            }

            if (payload.type === "status") {
                trafficNetwork.setSource(payload.mode, payload.label);
                return;
            }

            if (payload.type === "error") {
                trafficNetwork.remember(payload.message);
                return;
            }

            if (payload.type === "complete") {
                flushPackets();
                trafficNetwork.remember("File replay complete");
            }
        });

        return () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            window.removeEventListener("resize", onResize);
            socket.close();
            dispose();
        };
    }, [fitGraphView]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSelection(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <main
            style={{
                minHeight: "100vh",
                padding: 16,
                background: "linear-gradient(180deg, #081118 0%, #0a141c 100%)",
                color: "#d9e6ec",
                fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif',
                boxSizing: "border-box",
                width: "100%",
                maxWidth: "100vw",
                overflow: "hidden",
            }}
        >
            <section
                style={{
                    display: "grid",
                    gridTemplateColumns: isCompact ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 340px)",
                    gap: 14,
                    minHeight: isCompact ? "auto" : "calc(100vh - 32px)",
                    maxHeight: isCompact ? undefined : "calc(100vh - 32px)",
                    width: "100%",
                    overflow: "hidden",
                }}
            >
                <article
                    style={{
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 14,
                        border: "1px solid #1a2d3a",
                        background: "linear-gradient(180deg, #0a141c 0%, #091118 100%)",
                        minHeight: isCompact ? 780 : undefined,
                        minWidth: 0,
                    }}
                >
                    <div style={scanlineStyle} />
                    <div style={{ position: "absolute", inset: 0 }}>
                        <ReactFlow
                            nodes={displayNodes}
                            edges={displayEdges}
                            nodeTypes={nodeTypes}
                            edgeTypes={edgeTypes}
                            nodeOrigin={[0.5, 0.5]}
                            onInit={(instance) => {
                                flowRef.current = instance;
                                fitGraphView(graph.nodes.length);
                            }}
                            onNodeClick={(_event, node) => {
                                selectItem({ kind: "host", id: node.id });
                            }}
                            onEdgeClick={(_event, edge) => {
                                selectItem({ kind: "flow", id: edge.id });
                            }}
                            onPaneClick={() => setSelection(null)}
                            nodesDraggable={false}
                            nodesConnectable={false}
                            elementsSelectable
                            zoomOnScroll
                            panOnScroll
                            minZoom={0.2}
                            maxZoom={1.5}
                            colorMode="dark"
                            proOptions={{ hideAttribution: true }}
                        >
                            <Background
                                variant={BackgroundVariant.Lines}
                                gap={28}
                                size={1}
                                color="rgba(76, 108, 124, 0.16)"
                            />
                            <Controls
                                position="bottom-left"
                                style={{
                                    background: "#0d1821",
                                    border: "1px solid #223849",
                                    boxShadow: "none",
                                }}
                            />
                            <Panel position="top-left">
                                <div
                                    style={{
                                        ...overlayPanelStyle,
                                        width: isCompact ? "calc(50vw - 120px)" : "50vw",
                                        minHeight: 56,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 16,
                                        padding: "10px 14px",
                                    }}
                                >
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={eyebrowStyle}>TRAFFIC OVERVIEW</div>
                                        <div
                                            style={{
                                                marginTop: 2,
                                                fontSize: isCompact ? 18 : 20,
                                                fontWeight: 700,
                                                lineHeight: 1.05,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            Network Traffic Monitor
                                        </div>
                                    </div>
                                </div>
                            </Panel>
                            <Panel position="top-right">
                                <div style={{ ...legendPanelStyle, display: "flex", gap: 8 }}>
                                    <div style={compactKpiStyle}>
                                        <span style={compactKpiLabelStyle}>Hosts</span>
                                        <span style={compactKpiValueStyle}>
                                            {graph.hostCount}
                                        </span>
                                    </div>
                                    <div style={compactKpiStyle}>
                                        <span style={compactKpiLabelStyle}>Flows</span>
                                        <span style={compactKpiValueStyle}>
                                            {graph.flowCount}
                                        </span>
                                    </div>
                                    <div style={compactKpiStyle}>
                                        <span style={compactKpiLabelStyle}>Packets</span>
                                        <span style={compactKpiValueStyle}>
                                            {graph.totalPackets}
                                        </span>
                                    </div>
                                </div>
                            </Panel>
                            <Panel position="bottom-right">
                                <div style={legendPanelStyle}>
                                    <div style={legendRowStyle}>
                                        <span
                                            style={{
                                                ...legendSwatchStyle,
                                                background: "#4dd0a8",
                                            }}
                                        />
                                        TCP flow
                                    </div>
                                    <div style={legendRowStyle}>
                                        <span
                                            style={{
                                                ...legendSwatchStyle,
                                                background: "#66aec4",
                                            }}
                                        />
                                        UDP flow
                                    </div>
                                    <div style={legendRowStyle}>
                                        <span
                                            style={{
                                                ...legendSwatchStyle,
                                                background: "#efc26d",
                                            }}
                                        />
                                        Public host
                                    </div>
                                </div>
                            </Panel>
                            <Panel position="bottom-center">
                                <div style={tickerStyle}>
                                    <span style={tickerLabelStyle}>Latest</span>
                                    <span>{graph.events[0] ?? "Waiting for traffic"}</span>
                                </div>
                            </Panel>
                        </ReactFlow>
                    </div>
                </article>
                <aside
                    style={{
                        ...sidePanelStyle,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        minWidth: 0,
                        width: "100%",
                        maxWidth: "100%",
                        height: isCompact ? "auto" : "calc(100vh - 32px)",
                        maxHeight: isCompact ? undefined : "calc(100vh - 32px)",
                        overflow: "hidden",
                        boxSizing: "border-box",
                    }}
                >
                    <section
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8,
                            flexShrink: 0,
                            minWidth: 0,
                        }}
                    >
                        <div style={summaryCardStyle}>
                            <div style={summaryLabelStyle}>Feed</div>
                            <div style={summaryValueStyle}>
                                {graph.connected ? "Live" : "Offline"}
                            </div>
                        </div>
                        <div style={summaryCardStyle}>
                            <div style={summaryLabelStyle}>Volume</div>
                            <div style={summaryValueStyle}>
                                {formatBytes(graph.totalBytes)}
                            </div>
                        </div>
                    </section>
                    {selection ? (
                        <DetailPanel
                            selection={selection}
                            onClear={() => setSelection(null)}
                            onSelectFlow={(flowId) => setSelection({ kind: "flow", id: flowId })}
                        />
                    ) : null}
                    <section style={{ flexShrink: 0, minWidth: 0 }}>
                        <div style={panelTitleStyle}>Capture Source</div>
                        <div style={{ ...denseFeedRowStyle, marginTop: 8 }}>
                            {graph.sourceLabel}
                        </div>
                    </section>
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            overflow: "hidden",
                        }}
                    >
                    <section style={{ flexShrink: 0, minWidth: 0, maxHeight: selection ? 180 : 240, overflow: "auto" }}>
                        <div style={panelTitleStyle}>Active Flows</div>
                        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                            {graph.flows.length === 0 ? (
                                <div style={denseFeedRowStyle}>No flows yet</div>
                            ) : (
                                graph.flows.map((flow) => (
                                    <div
                                        key={flow.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => selectItem({ kind: "flow", id: flow.id })}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                selectItem({ kind: "flow", id: flow.id });
                                            }
                                        }}
                                        style={{
                                            ...denseStatusRowStyle,
                                            cursor: "pointer",
                                            ...(isRowSelected(selection, "flow", flow.id)
                                                ? selectedRowStyle
                                                : {}),
                                        }}
                                    >
                                        <div style={{ minWidth: 0 }}>
                                            <div
                                                style={{
                                                    fontWeight: 700,
                                                    fontSize: 13,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {flow.srcHost} -&gt; {flow.dstHost}
                                            </div>
                                            <div style={denseSubtleStyle}>
                                                {flow.proto}
                                                {flow.dstPort ? `:${flow.dstPort}` : ""} ·{" "}
                                                {flow.packetCount} pkts ·{" "}
                                                {formatBytes(flow.bytesTotal)}
                                            </div>
                                        </div>
                                        <div style={statusBadgeStyle(flow.active)}>
                                            {flow.active ? "active" : "idle"}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                    <section style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        <div style={panelTitleStyle}>Packet Feed</div>
                        <ul style={{ ...listStyle, gap: 6, marginTop: 8, flex: 1, minHeight: 0, overflow: "auto" }}>
                            {graph.packets.slice(0, 10).map((packet) => (
                                <li
                                    key={packet.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => selectItem({ kind: "packet", id: packet.id })}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            selectItem({ kind: "packet", id: packet.id });
                                        }
                                    }}
                                    style={{
                                        ...denseListRowStyle,
                                        cursor: "pointer",
                                        ...(isRowSelected(selection, "packet", packet.id)
                                            ? selectedRowStyle
                                            : {}),
                                    }}
                                >
                                    <strong style={{ display: "block", fontSize: 13 }}>
                                        {packet.timestamp} {packet.proto}
                                    </strong>
                                    <div style={denseSubtleStyle}>
                                        {packet.srcHost} -&gt; {packet.dstHost} ·{" "}
                                        {packet.length} B
                                    </div>
                                    <div style={denseSubtleStyle}>
                                        {packet.info || "No payload summary"}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                    </div>
                </aside>
            </section>
        </main>
    );
}

const nodeMetricStyle: React.CSSProperties = {
    padding: 8,
    borderRadius: 8,
    background: "#101d26",
    border: "1px solid #1a2c38",
};

const nodeMetricLabelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const nodeMetricValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 16,
    fontWeight: 700,
};

const scanlineStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background:
        "linear-gradient(rgba(98, 132, 149, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(98, 132, 149, 0.04) 1px, transparent 1px)",
    backgroundSize: "24px 24px",
};

const overlayPanelStyle: React.CSSProperties = {
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.22)",
};

const eyebrowStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#66aec4",
};

const compactKpiStyle: React.CSSProperties = {
    minWidth: 78,
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0d1821",
    display: "grid",
    gap: 2,
};

const compactKpiLabelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const compactKpiValueStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
};

const legendPanelStyle: React.CSSProperties = {
    display: "grid",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    fontSize: 12,
};

const legendRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
};

const legendSwatchStyle: React.CSSProperties = {
    width: 12,
    height: 3,
    display: "inline-block",
    borderRadius: 999,
};

const tickerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    fontSize: 12,
    color: "#b8cbd5",
};

const tickerLabelStyle: React.CSSProperties = {
    color: "#66aec4",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 700,
};

const sidePanelStyle: React.CSSProperties = {
    borderRadius: 12,
    padding: 12,
    border: "1px solid #1a2d3a",
    background: "#0b141b",
    boxSizing: "border-box",
};

const summaryCardStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
};

const summaryLabelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const summaryValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontWeight: 700,
    color: "#d9e6ec",
    fontSize: 14,
};

const panelTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 13,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#66aec4",
};

const statusBadgeStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 8px",
    borderRadius: 999,
    border: `1px solid ${active ? "#1f4d40" : "#33414a"}`,
    background: active ? "rgba(41, 161, 116, 0.12)" : "rgba(70, 90, 102, 0.12)",
    color: active ? "#7ce3b7" : "#9aa8b2",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 700,
});

const listStyle: React.CSSProperties = {
    margin: "12px 0 0",
    padding: 0,
    listStyle: "none",
    display: "grid",
    gap: 8,
};

const denseStatusRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    minWidth: 0,
};

const denseSubtleStyle: React.CSSProperties = {
    marginTop: 2,
    fontSize: 11,
    color: "#7f99a7",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
};

const denseListRowStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    lineHeight: 1.35,
};

const denseFeedRowStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderLeft: "2px solid #1f4d40",
    background: "#0f1921",
    color: "#d9e6ec",
    lineHeight: 1.35,
    fontSize: 12,
    wordBreak: "break-all",
    overflowWrap: "anywhere",
};

const selectedRowStyle: React.CSSProperties = {
    borderColor: "#66aec4",
    background: "#132028",
    boxShadow: "inset 0 0 0 1px #66aec433",
};

const detailPanelStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 10,
    border: "1px solid #223849",
    background: "#0d1821",
    display: "grid",
    gap: 10,
    minWidth: 0,
    maxHeight: 240,
    overflow: "auto",
    flexShrink: 0,
};

const detailHeaderStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
};

const detailEyebrowStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#66aec4",
    fontWeight: 700,
};

const detailCloseButtonStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #33414a",
    background: "#101d26",
    color: "#9aa8b2",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
};

const detailBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignSelf: "start",
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
};

const detailTitleStyle: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.3,
    wordBreak: "break-all",
    overflowWrap: "anywhere",
};

const detailSubtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#7f99a7",
    wordBreak: "break-all",
    overflowWrap: "anywhere",
};

const detailMetricGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 6,
};

const detailMetricStyle: React.CSSProperties = {
    padding: 8,
    borderRadius: 8,
    background: "#101d26",
    border: "1px solid #1a2c38",
    minWidth: 0,
    overflow: "hidden",
};

const detailMetricLabelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const detailMetricValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 14,
    fontWeight: 700,
};

const detailSectionTitleStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#7b9aaa",
    fontWeight: 700,
};

const detailRowStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    minWidth: 0,
    overflow: "hidden",
};

const detailLinkRowStyle: React.CSSProperties = {
    display: "grid",
    gap: 2,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    textAlign: "left",
    cursor: "pointer",
    color: "inherit",
    font: "inherit",
};
