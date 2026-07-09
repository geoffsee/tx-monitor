import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
    categoryColor,
    categoryLabel,
    formatPacketCount,
    HOST_NODE_SIZE,
} from "../layout";
import type { HostNodeData } from "../types";
import {
    nodeMetricLabelStyle,
    nodeMetricStyle,
    nodeMetricValueStyle,
} from "./styles";

const handleStyle = {
    opacity: 0,
    width: 1,
    height: 1,
    minWidth: 0,
    minHeight: 0,
    border: "none",
    background: "transparent",
    pointerEvents: "none" as const,
};

export function HostNode({ data, selected }: NodeProps<Node<HostNodeData>>) {
    const accent = categoryColor(data.category);
    const packetLabel = formatPacketCount(data.packetCount);
    const processLines = data.processes ?? [];
    const processCount = data.processCount ?? processLines.length;
    const processTitle = processLines.join("\n");
    const firstProcess = processLines[0]?.split(" · ")[0] ?? "";
    const processSummary =
        processCount > 1
            ? `${firstProcess} +${processCount - 1}`
            : firstProcess;
    const showResolvedDns =
        data.category === "public" &&
        data.resolvedDns &&
        data.label !== data.resolvedDns;
    const isPinned = !!data.pinned;

    return (
        <div
            className="host-node-shell"
            style={{
                width: HOST_NODE_SIZE.width,
                height: HOST_NODE_SIZE.height,
                position: "relative",
            }}
        >
            <Handle
                type="target"
                id="target-top"
                position={Position.Top}
                style={{ ...handleStyle, top: -8 }}
            />
            <Handle
                type="target"
                id="target-bottom"
                position={Position.Bottom}
                style={{ ...handleStyle, bottom: -8 }}
            />
            <Handle
                type="target"
                id="target-left"
                position={Position.Left}
                style={{ ...handleStyle, left: -8 }}
            />
            <Handle
                type="target"
                id="target-right"
                position={Position.Right}
                style={{ ...handleStyle, right: -8 }}
            />
            <Handle
                type="source"
                id="source-top"
                position={Position.Top}
                style={{ ...handleStyle, top: -8 }}
            />
            <Handle
                type="source"
                id="source-bottom"
                position={Position.Bottom}
                style={{ ...handleStyle, bottom: -8 }}
            />
            <Handle
                type="source"
                id="source-left"
                position={Position.Left}
                style={{ ...handleStyle, left: -8 }}
            />
            <Handle
                type="source"
                id="source-right"
                position={Position.Right}
                style={{ ...handleStyle, right: -8 }}
            />
            <div
                className="host-node-card"
                style={{
                    position: "absolute",
                    inset: 0,
                    boxSizing: "border-box",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${selected ? accent : isPinned ? "#f4d35e" : `${accent}33`}`,
                    background: "#0d1821",
                    color: "#d9e6ec",
                    boxShadow: selected
                        ? `0 0 0 2px ${accent}55`
                        : isPinned
                          ? `0 0 0 2px #f4d35e33`
                          : "0 4px 14px rgba(0, 0, 0, 0.24)",
                    fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif',
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        flexShrink: 0,
                        fontSize: 9,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: accent,
                    }}
                >
                    {categoryLabel(data.category)}
                    {isPinned ? " ★" : ""}
                </div>
                <div
                    title={data.address}
                    style={{
                        flexShrink: 0,
                        marginTop: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily:
                            '"IBM Plex Mono", "SF Mono", "Menlo", monospace',
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {data.label}
                </div>
                {processSummary ? (
                    <div
                        title={processTitle}
                        style={{
                            flexShrink: 0,
                            marginTop: 6,
                            fontSize: 10,
                            lineHeight: 1.1,
                            color: "#9bb2bd",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {processSummary}
                    </div>
                ) : null}
                {showResolvedDns ? (
                    <div
                        title={data.resolvedDns}
                        style={{
                            flexShrink: 0,
                            marginTop: 3,
                            fontSize: 9,
                            lineHeight: 1.1,
                            color: "#7fa3b2",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {data.resolvedDns}
                    </div>
                ) : null}
                <div
                    style={{
                        display: "flex",
                        flexWrap: "nowrap",
                        gap: 5,
                        marginTop: "auto",
                        flexShrink: 0,
                    }}
                >
                    <div
                        style={nodeMetricStyle}
                        title={`${data.packetCount.toLocaleString("en-US")} packets`}
                    >
                        <div style={nodeMetricLabelStyle}>Packets</div>
                        <div style={nodeMetricValueStyle}>{packetLabel}</div>
                    </div>
                    <div style={nodeMetricStyle} title={data.bytesTotal}>
                        <div style={nodeMetricLabelStyle}>Volume</div>
                        <div style={nodeMetricValueStyle}>
                            {data.bytesTotal}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
