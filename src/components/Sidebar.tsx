import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../layout";
import { isRowSelected } from "../lib/selection";
import type {
    Selection,
    SessionLoadProgress,
    TrafficSnapshot,
    TrafficViewMode,
} from "../types";
import { DetailPanel } from "./DetailPanel";
import { SessionHistory } from "./SessionHistory";
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
    tickerLabelStyle,
    tickerStyle,
} from "./styles";

type SidebarProps = {
    graph: TrafficSnapshot;
    selection: Selection | null;
    isCompact: boolean;
    viewMode: TrafficViewMode;
    activeSessionId: string | null;
    sessionLoadProgress: SessionLoadProgress | null;
    sessionsVersion: number;
    onLoadSession: (sessionId: string) => void;
    onReturnToLive: () => void;
    onSelectFlow: (id: string) => void;
    onSelectPacket: (id: string) => void;
    onNavigateToFlow: (id: string) => void;
    onClearSelection: () => void;
    onUpdateCapture?: (updates: {
        iface?: string;
        direction?: string;
        bpf?: string;
    }) => void;
};

export function Sidebar({
    graph,
    selection,
    isCompact,
    viewMode,
    activeSessionId,
    sessionLoadProgress,
    sessionsVersion,
    onLoadSession,
    onReturnToLive,
    onSelectFlow,
    onSelectPacket,
    onNavigateToFlow,
    onClearSelection,
    onUpdateCapture,
}: SidebarProps) {
    const feedLabel =
        viewMode === "history"
            ? "History"
            : graph.connected
              ? "Live"
              : "Offline";

    // Windowed list state for long flow and packet lists (virtualized to bound
    // DOM nodes under large sessions while allowing scroll through window).
    const flowsContainerRef = useRef<HTMLDivElement>(null);
    const [flowsScrollTop, setFlowsScrollTop] = useState(0);
    const packetsContainerRef = useRef<HTMLUListElement>(null);
    const [packetsScrollTop, setPacketsScrollTop] = useState(0);

    // Pending capture control drafts (synced from live graph.capture)
    const [pendingIface, setPendingIface] = useState("any");
    const [pendingDirection, setPendingDirection] = useState<
        "in" | "out" | "inout"
    >("out");
    const [pendingBpf, setPendingBpf] = useState("");
    useEffect(() => {
        if (graph.capture) {
            setPendingIface(graph.capture.iface || "any");
            const d = graph.capture.direction as "in" | "out" | "inout";
            if (d === "in" || d === "out" || d === "inout")
                setPendingDirection(d);
            setPendingBpf(graph.capture.bpf ?? "");
        }
    }, [graph.capture]);

    const FLOW_ITEM_HEIGHT = 58;
    const PACKET_ITEM_HEIGHT = 58;
    const OVERSCAN = 2;

    const getWindowedFlows = () => {
        const items = graph.flows;
        const container = flowsContainerRef.current;
        const height = container ? container.clientHeight || 220 : 220;
        const scroll = flowsScrollTop;
        const raw = Math.floor(scroll / FLOW_ITEM_HEIGHT) - OVERSCAN;
        const start = Math.max(0, Math.min(items.length, raw));
        const visibleCount =
            Math.ceil(height / FLOW_ITEM_HEIGHT) + OVERSCAN * 2;
        const end = Math.min(items.length, start + visibleCount);
        return { items: items.slice(start, end), start, total: items.length };
    };

    const getWindowedPackets = () => {
        const items = graph.packets;
        const container = packetsContainerRef.current;
        const height = container ? container.clientHeight || 300 : 300;
        const scroll = packetsScrollTop;
        const raw = Math.floor(scroll / PACKET_ITEM_HEIGHT) - OVERSCAN;
        const start = Math.max(0, Math.min(items.length, raw));
        const visibleCount =
            Math.ceil(height / PACKET_ITEM_HEIGHT) + OVERSCAN * 2;
        const end = Math.min(items.length, start + visibleCount);
        return { items: items.slice(start, end), start, total: items.length };
    };

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
            <div
                style={{
                    ...tickerStyle,
                    width: "100%",
                    boxSizing: "border-box",
                }}
            >
                <span style={tickerLabelStyle}>Latest</span>
                <span
                    style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {graph.events[0] ?? "Waiting for traffic"}
                </span>
            </div>
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
                    <div style={summaryValueStyle}>{feedLabel}</div>
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
            <SessionHistory
                viewMode={viewMode}
                activeSessionId={activeSessionId}
                sessionLoadProgress={sessionLoadProgress}
                sessionsVersion={sessionsVersion}
                onLoadSession={onLoadSession}
                onReturnToLive={onReturnToLive}
            />
            <section style={{ flexShrink: 0, minWidth: 0 }}>
                <div style={panelTitleStyle}>Capture Source</div>
                <div style={{ ...denseFeedRowStyle, marginTop: 8 }}>
                    {graph.sourceLabel}
                </div>
                {viewMode !== "history" && graph.capture ? (
                    <div
                        style={{
                            marginTop: 6,
                            display: "grid",
                            gap: 4,
                            fontSize: 11,
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                gap: 4,
                                alignItems: "center",
                            }}
                        >
                            <span>iface</span>
                            <input
                                value={pendingIface}
                                onChange={(e) =>
                                    setPendingIface(e.target.value)
                                }
                                style={{
                                    flex: 1,
                                    fontSize: 11,
                                    padding: "1px 3px",
                                    minWidth: 0,
                                }}
                                placeholder="any"
                            />
                            <span>dir</span>
                            <select
                                value={pendingDirection}
                                onChange={(e) =>
                                    setPendingDirection(
                                        e.target.value as
                                            | "in"
                                            | "out"
                                            | "inout",
                                    )
                                }
                                style={{ fontSize: 11 }}
                            >
                                <option value="out">out</option>
                                <option value="in">in</option>
                                <option value="inout">inout</option>
                            </select>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                gap: 4,
                                alignItems: "center",
                            }}
                        >
                            <span>bpf</span>
                            <input
                                value={pendingBpf}
                                onChange={(e) => setPendingBpf(e.target.value)}
                                style={{
                                    flex: 1,
                                    fontSize: 11,
                                    padding: "1px 3px",
                                    minWidth: 0,
                                }}
                                placeholder="host 1.2.3.4 or port 53"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() =>
                                onUpdateCapture?.({
                                    iface: pendingIface || "any",
                                    direction: pendingDirection,
                                    bpf: pendingBpf,
                                })
                            }
                            style={{
                                fontSize: 11,
                                padding: "1px 4px",
                                cursor: "pointer",
                                alignSelf: "start",
                            }}
                        >
                            Apply (restart live capture)
                        </button>
                    </div>
                ) : null}
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
                    ref={flowsContainerRef}
                    onScroll={(e) =>
                        setFlowsScrollTop(
                            (e.target as HTMLDivElement).scrollTop,
                        )
                    }
                >
                    <div style={panelTitleStyle}>Active Flows</div>
                    {(() => {
                        const w = getWindowedFlows();
                        if (w.total === 0) {
                            return (
                                <div
                                    style={{
                                        display: "grid",
                                        gap: 6,
                                        marginTop: 8,
                                    }}
                                >
                                    <div style={denseFeedRowStyle}>
                                        No flows yet
                                    </div>
                                </div>
                            );
                        }
                        const spacerBefore = w.start * FLOW_ITEM_HEIGHT;
                        const spacerAfter =
                            (w.total - w.start - w.items.length) *
                            FLOW_ITEM_HEIGHT;
                        return (
                            <div
                                style={{
                                    display: "grid",
                                    gap: 6,
                                    marginTop: 8,
                                    paddingTop: `${spacerBefore}px`,
                                    paddingBottom: `${spacerAfter}px`,
                                }}
                            >
                                {w.items.map((flow) => (
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
                                                {flow.srcHost} -&gt;{" "}
                                                {flow.dstHost}
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
                                        <div
                                            style={statusBadgeStyle(
                                                flow.active,
                                            )}
                                        >
                                            {flow.active ? "active" : "idle"}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        );
                    })()}
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
                        ref={packetsContainerRef}
                        onScroll={(e) =>
                            setPacketsScrollTop(
                                (e.target as HTMLUListElement).scrollTop,
                            )
                        }
                        style={{
                            ...listStyle,
                            gap: 6,
                            marginTop: 8,
                            flex: 1,
                            minHeight: 0,
                            overflow: "auto",
                        }}
                    >
                        {(() => {
                            const w = getWindowedPackets();
                            if (w.total === 0) {
                                return null;
                            }
                            const spacerBefore = w.start * PACKET_ITEM_HEIGHT;
                            const spacerAfter =
                                (w.total - w.start - w.items.length) *
                                PACKET_ITEM_HEIGHT;
                            return (
                                <>
                                    <div
                                        style={{
                                            height: `${spacerBefore}px`,
                                        }}
                                    />
                                    {w.items.map((packet) => (
                                        <li key={packet.id}>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onSelectPacket(packet.id)
                                                }
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
                                                    {packet.timestamp}{" "}
                                                    {packet.proto}
                                                </strong>
                                                <div style={denseSubtleStyle}>
                                                    {packet.srcHost} -&gt;{" "}
                                                    {packet.dstHost} ·{" "}
                                                    {packet.length} B
                                                </div>
                                                <div style={denseSubtleStyle}>
                                                    {packet.info ||
                                                        "No payload summary"}
                                                </div>
                                            </button>
                                        </li>
                                    ))}
                                    <div
                                        style={{
                                            height: `${spacerAfter}px`,
                                        }}
                                    />
                                </>
                            );
                        })()}
                    </ul>
                </section>
            </div>
        </aside>
    );
}
