import { formatBytes } from "../layout";
import { isRowSelected } from "../lib/selection";
import type { Selection, TrafficSnapshot } from "../types";
import { DetailPanel } from "./DetailPanel";
import {
    denseFeedRowStyle,
    denseListRowStyle,
    denseStatusRowStyle,
    denseSubtleStyle,
    listStyle,
    panelTitleStyle,
    selectedRowStyle,
    sidePanelStyle,
    statusBadgeStyle,
    summaryCardStyle,
    summaryLabelStyle,
    summaryValueStyle,
} from "./styles";

type SidebarProps = {
    graph: TrafficSnapshot;
    selection: Selection | null;
    isCompact: boolean;
    onSelectFlow: (id: string) => void;
    onSelectPacket: (id: string) => void;
    onNavigateToFlow: (id: string) => void;
    onClearSelection: () => void;
};

export function Sidebar({
    graph,
    selection,
    isCompact,
    onSelectFlow,
    onSelectPacket,
    onNavigateToFlow,
    onClearSelection,
}: SidebarProps) {
    return (
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
                    onClear={onClearSelection}
                    onSelectFlow={onNavigateToFlow}
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
                <section
                    style={{
                        flexShrink: 0,
                        minWidth: 0,
                        maxHeight: selection ? 180 : 240,
                        overflow: "auto",
                    }}
                >
                    <div style={panelTitleStyle}>Active Flows</div>
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                        {graph.flows.length === 0 ? (
                            <div style={denseFeedRowStyle}>No flows yet</div>
                        ) : (
                            graph.flows.map((flow) => (
                                <button
                                    key={flow.id}
                                    type="button"
                                    onClick={() => onSelectFlow(flow.id)}
                                    style={{
                                        ...denseStatusRowStyle,
                                        cursor: "pointer",
                                        width: "100%",
                                        textAlign: "left",
                                        font: "inherit",
                                        color: "inherit",
                                        ...(isRowSelected(
                                            selection,
                                            "flow",
                                            flow.id,
                                        )
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
                                            {flow.dstPort
                                                ? `:${flow.dstPort}`
                                                : ""}{" "}
                                            · {flow.packetCount} pkts ·{" "}
                                            {formatBytes(flow.bytesTotal)}
                                        </div>
                                    </div>
                                    <div style={statusBadgeStyle(flow.active)}>
                                        {flow.active ? "active" : "idle"}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </section>
                <section
                    style={{
                        flex: 1,
                        minHeight: 0,
                        minWidth: 0,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    <div style={panelTitleStyle}>Packet Feed</div>
                    <ul
                        style={{
                            ...listStyle,
                            gap: 6,
                            marginTop: 8,
                            flex: 1,
                            minHeight: 0,
                            overflow: "auto",
                        }}
                    >
                        {graph.packets.slice(0, 10).map((packet) => (
                            <li key={packet.id}>
                                <button
                                    type="button"
                                    onClick={() => onSelectPacket(packet.id)}
                                    style={{
                                        ...denseListRowStyle,
                                        cursor: "pointer",
                                        width: "100%",
                                        textAlign: "left",
                                        font: "inherit",
                                        color: "inherit",
                                        ...(isRowSelected(
                                            selection,
                                            "packet",
                                            packet.id,
                                        )
                                            ? selectedRowStyle
                                            : {}),
                                    }}
                                >
                                    <strong
                                        style={{
                                            display: "block",
                                            fontSize: 13,
                                        }}
                                    >
                                        {packet.timestamp} {packet.proto}
                                    </strong>
                                    <div style={denseSubtleStyle}>
                                        {packet.srcHost} -&gt; {packet.dstHost}{" "}
                                        · {packet.length} B
                                    </div>
                                    <div style={denseSubtleStyle}>
                                        {packet.info || "No payload summary"}
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </aside>
    );
}
