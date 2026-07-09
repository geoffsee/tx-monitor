import {
    Background,
    BackgroundVariant,
    Controls,
    type Edge,
    type Node,
    Panel,
    ReactFlow,
    type ReactFlowInstance,
} from "@xyflow/react";
import { useRef } from "react";
import { useFitGraphOnHostCount } from "../hooks/useFitGraphView";
import { isRowSelected } from "../lib/selection";
import type {
    FlowEdgeData,
    HostNodeData,
    Selection,
    TrafficSnapshot,
} from "../types";
import { edgeTypes, nodeTypes } from "./graphTypes";
import {
    compactKpiLabelStyle,
    compactKpiStyle,
    compactKpiValueStyle,
    eyebrowStyle,
    legendPanelStyle,
    legendRowStyle,
    legendSwatchStyle,
    overlayPanelStyle,
    scanlineStyle,
} from "./styles";

type TrafficGraphProps = {
    graph: TrafficSnapshot;
    selection: Selection | null;
    isCompact: boolean;
    onSelectHost: (id: string) => void;
    onSelectFlow: (id: string) => void;
    onClearSelection: () => void;
};

export function TrafficGraph({
    graph,
    selection,
    isCompact,
    onSelectHost,
    onSelectFlow,
    onClearSelection,
}: TrafficGraphProps) {
    const flowRef = useRef<ReactFlowInstance<
        Node<HostNodeData>,
        Edge<FlowEdgeData>
    > | null>(null);
    const fitGraphView = useFitGraphOnHostCount(flowRef, graph.nodes.length);

    const displayNodes: Node<HostNodeData>[] = graph.nodes.map((node) => ({
        ...node,
        selected: isRowSelected(selection, "host", node.id),
    }));

    const displayEdges: Edge<FlowEdgeData>[] = graph.edges.map((edge) => ({
        ...edge,
        selected: isRowSelected(selection, "flow", edge.id),
    }));

    return (
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
                        onSelectHost(node.id);
                    }}
                    onEdgeClick={(_event, edge) => {
                        onSelectFlow(edge.id);
                    }}
                    onPaneClick={onClearSelection}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable
                    elevateNodesOnSelect
                    defaultEdgeOptions={{ zIndex: 0 }}
                    zoomOnScroll
                    panOnScroll
                    minZoom={0.45}
                    maxZoom={1.25}
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
                                width: isCompact
                                    ? "calc(50vw - 120px)"
                                    : "50vw",
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
                        <div
                            style={{
                                display: "flex",
                                gap: 8,
                            }}
                        >
                            <div style={compactKpiStyle}>
                                <span style={compactKpiLabelStyle}>Hosts</span>
                                <span style={compactKpiValueStyle}>
                                    {graph.hostCount}
                                    {graph.hostsEvicted > 0 ? (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: "#e6a07c",
                                                marginLeft: 2,
                                            }}
                                        >
                                            -{graph.hostsEvicted}
                                        </span>
                                    ) : null}
                                </span>
                            </div>
                            <div style={compactKpiStyle}>
                                <span style={compactKpiLabelStyle}>Flows</span>
                                <span style={compactKpiValueStyle}>
                                    {graph.flowCount}
                                    {graph.flowsEvicted > 0 ? (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: "#e6a07c",
                                                marginLeft: 2,
                                            }}
                                        >
                                            -{graph.flowsEvicted}
                                        </span>
                                    ) : null}
                                </span>
                            </div>
                            <div style={compactKpiStyle}>
                                <span style={compactKpiLabelStyle}>
                                    Packets
                                </span>
                                <span style={compactKpiValueStyle}>
                                    {graph.totalPackets}
                                    {graph.packetsEvicted > 0 ? (
                                        <span
                                            style={{
                                                fontSize: 9,
                                                color: "#e6a07c",
                                                marginLeft: 2,
                                            }}
                                        >
                                            -{graph.packetsEvicted}
                                        </span>
                                    ) : null}
                                </span>
                            </div>
                        </div>
                    </Panel>
                </ReactFlow>
            </div>
        </article>
    );
}
