import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../layout";
import { displayHostLabel } from "../lib/hostDisplay";
import { isRowSelected } from "../lib/selection";
import { formatService } from "../lib/tcpdumpParser";
import { trafficNetwork } from "../lib/trafficNetwork";
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
    comparisonSessionId: string | null;
    comparisonLabel: string | null;
    comparisonLoadProgress: SessionLoadProgress | null;
    onLoadSession: (sessionId: string) => void;
    onReturnToLive: () => void;
    onLoadComparison: (sessionId: string) => void;
    onClearComparison: () => void;
    onSelectFlow: (id: string) => void;
    onSelectPacket: (id: string) => void;
    onNavigateToFlow: (id: string) => void;
    onClearSelection: () => void;
    onUpdateCapture?: (updates: {
        iface?: string;
        direction?: string;
        bpf?: string;
    }) => void;
    onSetEntityMarker?: (
        kind: "host" | "flow",
        id: string,
        patch: { pinned?: boolean; note?: string | null; tags?: string | null },
    ) => void;
};

export function Sidebar({
    graph,
    selection,
    isCompact,
    viewMode,
    activeSessionId,
    sessionLoadProgress,
    sessionsVersion,
    comparisonSessionId,
    comparisonLabel,
    comparisonLoadProgress,
    onLoadSession,
    onReturnToLive,
    onLoadComparison,
    onClearComparison,
    onSelectFlow,
    onSelectPacket,
    onNavigateToFlow,
    onClearSelection,
    onUpdateCapture,
    onSetEntityMarker,
}: SidebarProps) {
    const feedLabel =
        viewMode === "history"
            ? "History"
            : graph.connected
              ? "Live"
              : "Offline";
    const isFileSource = graph.sourceLabel.startsWith("file ");

    // Windowed list state for long flow and packet lists (virtualized to bound
    // DOM nodes under large sessions while allowing scroll through window).
    const flowsContainerRef = useRef<HTMLDivElement>(null);
    const [flowsScrollTop, setFlowsScrollTop] = useState(0);
    const packetsContainerRef = useRef<HTMLUListElement>(null);
    const [packetsScrollTop, setPacketsScrollTop] = useState(0);
    // Overlay list filter when a comparison session is loaded.
    const [comparisonListFilter, setComparisonListFilter] = useState<
        "all" | "shared" | "delta"
    >("all");

    // Pending capture control drafts (synced from live graph.capture primitives only;
    // object identity of graph.capture changes every publishGraph and must not reset drafts)
    const [pendingIface, setPendingIface] = useState("any");
    const [pendingDirection, setPendingDirection] = useState<
        "in" | "out" | "inout"
    >("out");
    const [pendingBpf, setPendingBpf] = useState("");
    const [captureDirty, setCaptureDirty] = useState(false);
    const serverIface = graph.capture?.iface;
    const serverDirection = graph.capture?.direction;
    const serverBpf = graph.capture?.bpf;
    useEffect(() => {
        if (serverIface === undefined) return;
        const iface = serverIface || "any";
        const d = serverDirection as "in" | "out" | "inout" | undefined;
        const dir =
            d === "in" || d === "out" || d === "inout" ? d : ("out" as const);
        const bpf = serverBpf ?? "";
        if (captureDirty) {
            // Clear dirty only after server confirms matching params (or
            // leave dirty on reject so drafts do not pretend to be applied).
            if (
                iface === (pendingIface || "any") &&
                dir === pendingDirection &&
                bpf === pendingBpf
            ) {
                setCaptureDirty(false);
            }
            return;
        }
        setPendingIface(iface);
        setPendingDirection(dir);
        setPendingBpf(bpf);
    }, [
        serverIface,
        serverDirection,
        serverBpf,
        captureDirty,
        pendingIface,
        pendingDirection,
        pendingBpf,
    ]);

    const FLOW_ITEM_HEIGHT = 58;
    const PACKET_ITEM_HEIGHT = 58;
    const OVERSCAN = 2;

    const filterByComparison = <T extends { inComparison?: boolean }>(
        items: T[],
    ): T[] => {
        if (!graph.comparison || comparisonListFilter === "all") {
            return items;
        }
        if (comparisonListFilter === "shared") {
            return items.filter((item) => item.inComparison === true);
        }
        return items.filter((item) => item.inComparison === false);
    };

    const getWindowedFlows = () => {
        const items = filterByComparison(graph.flows);
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
        const items = filterByComparison(graph.packets);
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

    const comparisonBadge = (inComparison: boolean | undefined) => {
        if (inComparison === true) {
            return (
                <span
                    style={{
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 3,
                        border: "1px solid #66aec4",
                        color: "#66aec4",
                        letterSpacing: "0.06em",
                        flexShrink: 0,
                    }}
                >
                    shared
                </span>
            );
        }
        if (inComparison === false) {
            return (
                <span
                    style={{
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 3,
                        border: "1px solid #e6a07c",
                        color: "#e6a07c",
                        letterSpacing: "0.06em",
                        flexShrink: 0,
                    }}
                >
                    delta
                </span>
            );
        }
        return null;
    };

    const renderComparisonFilterControls = () =>
        graph.comparison ? (
            <div
                style={{
                    display: "flex",
                    gap: 4,
                    marginTop: 6,
                    flexWrap: "wrap",
                }}
            >
                {(
                    [
                        ["all", "All"],
                        ["shared", "Shared"],
                        ["delta", "Delta"],
                    ] as const
                ).map(([value, label]) => {
                    const active = comparisonListFilter === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setComparisonListFilter(value)}
                            style={{
                                ...denseSubtleStyle,
                                padding: "2px 6px",
                                borderRadius: 4,
                                border: `1px solid ${
                                    active
                                        ? value === "delta"
                                            ? "#e6a07c"
                                            : value === "shared"
                                              ? "#66aec4"
                                              : "#33414a"
                                        : "#33414a"
                                }`,
                                background: active ? "#132028" : "#101d26",
                                color:
                                    active && value === "delta"
                                        ? "#e6a07c"
                                        : active && value === "shared"
                                          ? "#66aec4"
                                          : "#d9e6ec",
                                fontSize: 10,
                                cursor: "pointer",
                            }}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
        ) : null;

    // displayHostLabel uses full trafficNetwork (not graph.nodes) so hosts
    // outside MAX_GRAPH_HOSTS still resolve DNS / labels for flows, packets, ticker.
    const pinnedById = new Map((graph.markers ?? []).map((m) => [m.id, m]));
    const formatMarkerSuffix = (
        marker: { note?: string | null; tags?: string | null } | undefined,
    ): string => {
        if (!marker) return "";
        const bits: string[] = [];
        if (marker.note?.trim()) bits.push(marker.note.trim());
        if (marker.tags?.trim()) bits.push(marker.tags.trim());
        return bits.length > 0 ? ` · ${bits.join(" · ")}` : "";
    };

    // Packet ticker: service name + DNS labels (raw values via title).
    const latestPacket = trafficNetwork.packets[0];
    const latestTicker = latestPacket
        ? `${latestPacket.timestamp} ${formatService(latestPacket.dstPort, latestPacket.proto)} ${displayHostLabel(latestPacket.srcHost)} → ${displayHostLabel(latestPacket.dstHost)}`
        : (graph.events[0] ?? "Waiting for traffic");
    const latestTickerTitle = latestPacket
        ? `${latestPacket.srcHost} -> ${latestPacket.dstHost} · ${latestPacket.proto}${latestPacket.dstPort ? `:${latestPacket.dstPort}` : ""}`
        : undefined;

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
                    title={latestTickerTitle}
                >
                    {latestTicker}
                </span>
            </div>
            <section
                style={{
                    display: "grid",
                    gridTemplateColumns: graph.comparison
                        ? "1fr 1fr 1fr"
                        : "1fr 1fr",
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
                {graph.comparison ? (
                    <div style={summaryCardStyle}>
                        <div style={summaryLabelStyle}>Compare</div>
                        <div
                            style={{
                                ...summaryValueStyle,
                                fontSize: 11,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                            title={`${graph.comparison.label} · ${graph.comparison.commonFlowCount} shared / ${graph.comparison.deltaFlowCount} delta flows (primary only)`}
                        >
                            <span style={{ color: "#66aec4" }}>
                                {graph.comparison.commonFlowCount}
                            </span>
                            <span style={{ color: "#7b9aaa" }}> / </span>
                            <span style={{ color: "#e6a07c" }}>
                                {graph.comparison.deltaFlowCount}
                            </span>
                        </div>
                    </div>
                ) : null}
            </section>
            {selection ? (
                <DetailPanel
                    selection={selection}
                    onClear={onClearSelection}
                    onSelectFlow={onNavigateToFlow}
                    onSetEntityMarker={onSetEntityMarker}
                />
            ) : null}
            <SessionHistory
                viewMode={viewMode}
                activeSessionId={activeSessionId}
                sessionLoadProgress={sessionLoadProgress}
                sessionsVersion={sessionsVersion}
                comparisonSessionId={comparisonSessionId}
                comparisonLabel={comparisonLabel}
                comparisonLoadProgress={comparisonLoadProgress}
                onLoadSession={onLoadSession}
                onReturnToLive={onReturnToLive}
                onLoadComparison={onLoadComparison}
                onClearComparison={onClearComparison}
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
                        {!isFileSource ? (
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
                                    onChange={(e) => {
                                        setCaptureDirty(true);
                                        setPendingIface(e.target.value);
                                    }}
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
                                    onChange={(e) => {
                                        setCaptureDirty(true);
                                        setPendingDirection(
                                            e.target.value as
                                                | "in"
                                                | "out"
                                                | "inout",
                                        );
                                    }}
                                    style={{ fontSize: 11 }}
                                >
                                    <option value="out">out</option>
                                    <option value="in">in</option>
                                    <option value="inout">inout</option>
                                </select>
                            </div>
                        ) : null}
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
                                onChange={(e) => {
                                    setCaptureDirty(true);
                                    setPendingBpf(e.target.value);
                                }}
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
                            onClick={() => {
                                // Leave captureDirty true until status matches
                                // pending (see effect); rejected set-capture
                                // never emits status so drafts stay editable.
                                if (isFileSource) {
                                    onUpdateCapture?.({ bpf: pendingBpf });
                                } else {
                                    onUpdateCapture?.({
                                        iface: pendingIface || "any",
                                        direction: pendingDirection,
                                        bpf: pendingBpf,
                                    });
                                }
                            }}
                            style={{
                                fontSize: 11,
                                padding: "1px 4px",
                                cursor: "pointer",
                                alignSelf: "start",
                            }}
                        >
                            {isFileSource
                                ? "Apply BPF filter"
                                : "Apply (restart live capture)"}
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
                    {renderComparisonFilterControls()}
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
                                        {graph.comparison &&
                                        comparisonListFilter !== "all"
                                            ? `No ${comparisonListFilter} flows`
                                            : "No flows yet"}
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
                                            ...(flow.inComparison === true
                                                ? {
                                                      borderColor: "#66aec455",
                                                  }
                                                : flow.inComparison === false
                                                  ? {
                                                        borderColor:
                                                            "#e6a07c55",
                                                    }
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
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                }}
                                                title={`${flow.srcHost} -> ${flow.dstHost}`}
                                            >
                                                {pinnedById.get(flow.id)?.pinned
                                                    ? "★ "
                                                    : ""}
                                                {displayHostLabel(flow.srcHost)}{" "}
                                                -&gt;{" "}
                                                {displayHostLabel(flow.dstHost)}
                                                {comparisonBadge(
                                                    flow.inComparison,
                                                )}
                                            </div>
                                            <div
                                                style={denseSubtleStyle}
                                                title={`${flow.proto}${flow.dstPort ? `:${flow.dstPort}` : ""}`}
                                            >
                                                {formatService(
                                                    flow.dstPort,
                                                    flow.proto,
                                                )}{" "}
                                                · {flow.packetCount} pkts ·{" "}
                                                {formatBytes(flow.bytesTotal)}
                                                {formatMarkerSuffix(
                                                    pinnedById.get(flow.id),
                                                )}
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
                    {renderComparisonFilterControls()}
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
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                        fontSize: 13,
                                                    }}
                                                    title={`${packet.proto}${packet.dstPort ? `:${packet.dstPort}` : ""}`}
                                                >
                                                    <span>
                                                        {packet.timestamp}{" "}
                                                        {formatService(
                                                            packet.dstPort ??
                                                                null,
                                                            packet.proto,
                                                        )}
                                                    </span>
                                                    {comparisonBadge(
                                                        packet.inComparison,
                                                    )}
                                                </strong>
                                                <div
                                                    style={denseSubtleStyle}
                                                    title={`${packet.srcHost} -> ${packet.dstHost}`}
                                                >
                                                    {displayHostLabel(
                                                        packet.srcHost,
                                                    )}{" "}
                                                    -&gt;{" "}
                                                    {displayHostLabel(
                                                        packet.dstHost,
                                                    )}{" "}
                                                    · {packet.length} B
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
