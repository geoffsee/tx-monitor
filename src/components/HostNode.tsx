import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { categoryColor, categoryLabel, HOST_NODE_SIZE } from "../layout";
import type { HostNodeData } from "../types";
import {
    nodeMetricLabelStyle,
    nodeMetricStyle,
    nodeMetricValueStyle,
} from "./styles";

export function HostNode({ data, selected }: NodeProps<Node<HostNodeData>>) {
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
            <Handle
                type="target"
                position={Position.Left}
                style={{ opacity: 0 }}
            />
            <Handle
                type="target"
                position={Position.Right}
                style={{ opacity: 0 }}
            />
            <Handle
                type="source"
                position={Position.Left}
                style={{ opacity: 0 }}
            />
            <Handle
                type="source"
                position={Position.Right}
                style={{ opacity: 0 }}
            />
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
