import {
    categoryColor,
    categoryLabel,
    formatBytes,
    protoColor,
} from "../layout";
import { trafficNetwork } from "../lib/trafficNetwork";
import type { HostCategory, Selection } from "../types";
import {
    detailBadgeStyle,
    detailCloseButtonStyle,
    detailEyebrowStyle,
    detailHeaderStyle,
    detailLinkRowStyle,
    detailMetricGridStyle,
    detailMetricLabelStyle,
    detailMetricStyle,
    detailMetricValueStyle,
    detailPanelStyle,
    detailRowStyle,
    detailSectionTitleStyle,
    detailSubtleStyle,
    detailTitleStyle,
    statusBadgeStyle,
} from "./styles";

function ProcessDetails(props: { command: string; pid: number; user: string }) {
    return (
        <>
            <div style={detailSectionTitleStyle}>Process</div>
            <div style={detailRowStyle}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {props.command}
                </div>
                <div style={detailSubtleStyle}>
                    pid {props.pid} · {props.user}
                </div>
            </div>
        </>
    );
}

function MarkerEditor({
    kind,
    entityId,
    onSetEntityMarker,
}: {
    kind: "host" | "flow";
    entityId: string;
    onSetEntityMarker?: (
        k: "host" | "flow",
        id: string,
        patch: { pinned?: boolean; note?: string | null; tags?: string | null },
    ) => void;
}) {
    const m = trafficNetwork.markers.get(entityId);
    const pinned = !!m?.pinned;
    const note = m?.note ?? "";
    const tags = m?.tags ?? "";
    // Key each field on its own persisted value so saving note does not remount tags (and steal focus).
    return (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            <button
                type="button"
                onClick={() =>
                    onSetEntityMarker?.(kind, entityId, { pinned: !pinned })
                }
                style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    border: "1px solid #445",
                    background: pinned ? "#2a3a2a" : "#0d1821",
                    color: pinned ? "#f4d35e" : "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                }}
            >
                {pinned ? "★ Pinned (click to unpin)" : "☆ Pin this entity"}
            </button>
            <input
                key={`${entityId}-note-${note}`}
                placeholder="Note (lightweight, persists with session)"
                defaultValue={note}
                onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (onSetEntityMarker) {
                        onSetEntityMarker(kind, entityId, {
                            note: v || null,
                        });
                    }
                }}
                style={{
                    fontSize: 10,
                    padding: "2px 4px",
                    background: "#081118",
                    border: "1px solid #33414a",
                    color: "inherit",
                }}
            />
            <input
                key={`${entityId}-tags-${tags}`}
                placeholder="tags (comma,separated)"
                defaultValue={tags}
                onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (onSetEntityMarker) {
                        onSetEntityMarker(kind, entityId, {
                            tags: v || null,
                        });
                    }
                }}
                style={{
                    fontSize: 10,
                    padding: "2px 4px",
                    background: "#081118",
                    border: "1px solid #33414a",
                    color: "inherit",
                }}
            />
        </div>
    );
}

type DetailPanelProps = {
    selection: Selection;
    onClear: () => void;
    onSelectFlow: (flowId: string) => void;
    onSetEntityMarker?: (
        kind: "host" | "flow",
        id: string,
        patch: { pinned?: boolean; note?: string | null; tags?: string | null },
    ) => void;
};

export function DetailPanel({
    selection,
    onClear,
    onSelectFlow,
    onSetEntityMarker,
}: DetailPanelProps) {
    if (selection.kind === "host") {
        const host = trafficNetwork.hosts.get(selection.id);
        if (!host) {
            return null;
        }

        const accent = categoryColor(host.category as HostCategory);
        const allFlows = trafficNetwork.flowList.filter(
            (flow) => flow.srcHost === host.id || flow.dstHost === host.id,
        );
        const flows = allFlows.slice(0, 8);
        const packets = trafficNetwork.packets
            .filter(
                (packet) =>
                    packet.srcHost === host.id || packet.dstHost === host.id,
            )
            .slice(0, 6);

        return (
            <section style={detailPanelStyle}>
                <div style={detailHeaderStyle}>
                    <div style={detailEyebrowStyle}>Host Details</div>
                    <button
                        type="button"
                        onClick={onClear}
                        style={detailCloseButtonStyle}
                    >
                        Close
                    </button>
                </div>
                <div
                    style={{
                        ...detailBadgeStyle,
                        color: accent,
                        borderColor: `${accent}44`,
                        background: `${accent}1f`,
                    }}
                >
                    {categoryLabel(host.category as HostCategory)}
                </div>
                <div style={detailTitleStyle}>{host.label}</div>
                <div style={detailSubtleStyle}>{host.address}</div>
                <div style={detailMetricGridStyle}>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Packets</div>
                        <div style={detailMetricValueStyle}>
                            {host.packetCount}
                        </div>
                    </div>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Volume</div>
                        <div style={detailMetricValueStyle}>
                            {formatBytes(host.bytesTotal)}
                        </div>
                    </div>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Flows</div>
                        <div style={detailMetricValueStyle}>
                            {allFlows.length}
                        </div>
                    </div>
                </div>
                <div style={detailSectionTitleStyle}>Durable Marker</div>
                <MarkerEditor
                    kind="host"
                    entityId={host.id}
                    onSetEntityMarker={onSetEntityMarker}
                />
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
                                    <span
                                        style={{
                                            fontWeight: 600,
                                            fontSize: 12,
                                        }}
                                    >
                                        {flow.srcHost === host.id ? "→" : "←"}{" "}
                                        {flow.srcHost === host.id
                                            ? flow.dstHost
                                            : flow.srcHost}
                                    </span>
                                    <span style={detailSubtleStyle}>
                                        {flow.proto}
                                        {flow.dstPort ? `:${flow.dstPort}` : ""}
                                        {flow.processCommand
                                            ? ` · ${flow.processCommand}`
                                            : ""}{" "}
                                        · {flow.packetCount} pkts
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                ) : null}
                {packets.length > 0 ? (
                    <>
                        <div style={detailSectionTitleStyle}>
                            Recent Packets
                        </div>
                        <div style={{ display: "grid", gap: 4 }}>
                            {packets.map((packet) => (
                                <div key={packet.id} style={detailRowStyle}>
                                    <div
                                        style={{
                                            fontSize: 12,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {packet.timestamp} · {packet.proto}
                                    </div>
                                    <div style={detailSubtleStyle}>
                                        {packet.srcHost} → {packet.dstHost} ·{" "}
                                        {packet.length} B
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
        const active = trafficNetwork.activeFlows.some(
            (entry) => entry.id === flow.id,
        );
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
                    <button
                        type="button"
                        onClick={onClear}
                        style={detailCloseButtonStyle}
                    >
                        Close
                    </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                        style={{
                            ...detailBadgeStyle,
                            color: stroke,
                            borderColor: `${stroke}44`,
                            background: `${stroke}1f`,
                        }}
                    >
                        {flow.proto}
                        {flow.dstPort ? `:${flow.dstPort}` : ""}
                    </div>
                    <div style={statusBadgeStyle(active)}>
                        {active ? "active" : "idle"}
                    </div>
                </div>
                <div style={detailTitleStyle}>
                    {flow.srcHost} → {flow.dstHost}
                </div>
                <div style={detailMetricGridStyle}>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Packets</div>
                        <div style={detailMetricValueStyle}>
                            {flow.packetCount}
                        </div>
                    </div>
                    <div style={detailMetricStyle}>
                        <div style={detailMetricLabelStyle}>Volume</div>
                        <div style={detailMetricValueStyle}>
                            {formatBytes(flow.bytesTotal)}
                        </div>
                    </div>
                </div>
                <div style={detailSectionTitleStyle}>Durable Marker</div>
                <MarkerEditor
                    kind="flow"
                    entityId={flow.id}
                    onSetEntityMarker={onSetEntityMarker}
                />
                {flow.processCommand && flow.processPid && flow.processUser ? (
                    <ProcessDetails
                        command={flow.processCommand}
                        pid={flow.processPid}
                        user={flow.processUser}
                    />
                ) : null}
                {packets.length > 0 ? (
                    <>
                        <div style={detailSectionTitleStyle}>
                            Recent Packets
                        </div>
                        <div style={{ display: "grid", gap: 4 }}>
                            {packets.map((packet) => (
                                <div key={packet.id} style={detailRowStyle}>
                                    <div
                                        style={{
                                            fontSize: 12,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {packet.timestamp} · {packet.length} B
                                    </div>
                                    <div style={detailSubtleStyle}>
                                        {packet.srcPort ?? "?"} →{" "}
                                        {packet.dstPort ?? "?"} ·{" "}
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

    const packet = trafficNetwork.packets.find(
        (entry) => entry.id === selection.id,
    );
    if (!packet) {
        return null;
    }

    const stroke = protoColor(packet.proto);

    return (
        <section style={detailPanelStyle}>
            <div style={detailHeaderStyle}>
                <div style={detailEyebrowStyle}>Packet Details</div>
                <button
                    type="button"
                    onClick={onClear}
                    style={detailCloseButtonStyle}
                >
                    Close
                </button>
            </div>
            <div
                style={{
                    ...detailBadgeStyle,
                    color: stroke,
                    borderColor: `${stroke}44`,
                    background: `${stroke}1f`,
                }}
            >
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
                    <div style={detailMetricValueStyle}>
                        {packet.srcPort ?? "—"}
                    </div>
                </div>
                <div style={detailMetricStyle}>
                    <div style={detailMetricLabelStyle}>Dest Port</div>
                    <div style={detailMetricValueStyle}>
                        {packet.dstPort ?? "—"}
                    </div>
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
            {packet.processCommand &&
            packet.processPid &&
            packet.processUser ? (
                <ProcessDetails
                    command={packet.processCommand}
                    pid={packet.processPid}
                    user={packet.processUser}
                />
            ) : null}
            <div style={detailSectionTitleStyle}>Summary</div>
            <div
                style={{
                    ...detailRowStyle,
                    whiteSpace: "normal",
                    lineHeight: 1.45,
                }}
            >
                {packet.info || "No payload summary available"}
            </div>
        </section>
    );
}
