import type { Selection, TrafficSnapshot } from "../types";
import type { CopilotMessage } from "./copilot";

export type ExportKind = "snapshot" | "selection";

export type ExportSessionMeta = {
    id: string | null;
    mode: string;
    sourceLabel: string;
    viewMode: "live" | "history";
    exportedAt: string;
    activeSelection: Selection | null;
};

export type ExportPayload = {
    kind: ExportKind;
    session: ExportSessionMeta;
    summary: {
        totalPackets: number;
        totalBytes: number;
        hostCount: number;
        flowCount: number;
        anomalyCount: number;
    };
    hosts: Array<{
        id: string;
        label: string;
        address: string;
        category: string;
        packetCount: number;
        bytesTotal: string;
        resolvedDns?: string;
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
        process?: { command: string; pid: number; user: string };
    }>;
    packets: Array<{
        id: string;
        timestamp: string;
        proto: string;
        srcHost: string;
        dstHost: string;
        length: number;
        info: string;
        process?: { command: string; pid: number; user: string };
    }>;
    anomalies: TrafficSnapshot["anomalies"];
    events: string[];
    copilot?: {
        messages: CopilotMessage[];
    };
};

export type BuildExportOptions = {
    kind?: ExportKind;
    includeCopilot?: boolean;
    copilotMessages?: CopilotMessage[];
    activeSessionId?: string | null;
    viewMode?: "live" | "history";
};

export function buildExportPayload(
    graph: TrafficSnapshot,
    selection: Selection | null,
    options: BuildExportOptions = {},
): ExportPayload {
    const now = new Date().toISOString();
    const kind: ExportKind =
        options.kind ?? (selection ? "selection" : "snapshot");

    const hosts = graph.nodes.map((node) => ({
        id: node.id,
        label: node.data.label,
        address: node.data.address,
        category: node.data.category,
        packetCount: node.data.packetCount,
        bytesTotal: node.data.bytesTotal,
        ...(node.data.resolvedDns
            ? { resolvedDns: node.data.resolvedDns }
            : {}),
    }));

    const flows = graph.flows.map((flow) => ({
        id: flow.id,
        srcHost: flow.srcHost,
        dstHost: flow.dstHost,
        proto: flow.proto,
        dstPort: flow.dstPort,
        packetCount: flow.packetCount,
        bytesTotal: flow.bytesTotal,
        active: flow.active,
        ...(flow.process ? { process: flow.process } : {}),
    }));

    const packets = graph.packets.map((packet) => ({
        id: packet.id,
        timestamp: packet.timestamp,
        proto: packet.proto,
        srcHost: packet.srcHost,
        dstHost: packet.dstHost,
        length: packet.length,
        info: packet.info,
        ...(packet.process ? { process: packet.process } : {}),
    }));

    const payload: ExportPayload = {
        kind,
        session: {
            id: options.activeSessionId ?? null,
            mode: graph.sourceLabel.includes("file")
                ? "file"
                : graph.sourceLabel.includes("live")
                  ? "live"
                  : graph.sourceLabel,
            sourceLabel: graph.sourceLabel,
            viewMode: options.viewMode ?? "live",
            exportedAt: now,
            activeSelection: selection,
        },
        summary: {
            totalPackets: graph.totalPackets,
            totalBytes: graph.totalBytes,
            hostCount: graph.hostCount,
            flowCount: graph.flowCount,
            anomalyCount: graph.anomalies.length,
        },
        hosts,
        flows,
        packets,
        anomalies: graph.anomalies,
        events: graph.events,
    };

    if (
        options.includeCopilot &&
        options.copilotMessages &&
        options.copilotMessages.length > 0
    ) {
        payload.copilot = {
            messages: options.copilotMessages.map((m) => ({ ...m })),
        };
    }

    return payload;
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function exportAsJson(payload: ExportPayload, filename?: string): void {
    const ts = payload.session.exportedAt.replace(/[:.]/g, "-");
    const defaultName = `tx-monitor-${payload.kind}-${ts}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
    });
    triggerDownload(blob, filename ?? defaultName);
}

export function exportPacketsCsv(
    packets: ExportPayload["packets"],
    _meta: { sourceLabel: string; exportedAt: string },
    filename?: string,
): void {
    const headers = [
        "id",
        "timestamp",
        "proto",
        "srcHost",
        "dstHost",
        "length",
        "info",
        "processCommand",
        "processPid",
        "processUser",
    ];
    const rows = packets.map((p) => [
        csvEscape(p.id),
        csvEscape(p.timestamp),
        csvEscape(p.proto),
        csvEscape(p.srcHost),
        csvEscape(p.dstHost),
        String(p.length),
        csvEscape(p.info),
        p.process ? csvEscape(p.process.command) : "",
        p.process ? String(p.process.pid) : "",
        p.process ? csvEscape(p.process.user) : "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const ts = _meta.exportedAt.replace(/[:.]/g, "-");
    const defaultName = `tx-monitor-packets-${ts}.csv`;
    triggerDownload(blob, filename ?? defaultName);
}

export function exportFlowsCsv(
    flows: ExportPayload["flows"],
    _meta: { sourceLabel: string; exportedAt: string },
    filename?: string,
): void {
    const headers = [
        "id",
        "srcHost",
        "dstHost",
        "proto",
        "dstPort",
        "packetCount",
        "bytesTotal",
        "active",
        "processCommand",
        "processPid",
        "processUser",
    ];
    const rows = flows.map((f) => [
        csvEscape(f.id),
        csvEscape(f.srcHost),
        csvEscape(f.dstHost),
        csvEscape(f.proto),
        f.dstPort != null ? String(f.dstPort) : "",
        String(f.packetCount),
        String(f.bytesTotal),
        f.active ? "true" : "false",
        f.process ? csvEscape(f.process.command) : "",
        f.process ? String(f.process.pid) : "",
        f.process ? csvEscape(f.process.user) : "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const ts = _meta.exportedAt.replace(/[:.]/g, "-");
    const defaultName = `tx-monitor-flows-${ts}.csv`;
    triggerDownload(blob, filename ?? defaultName);
}

function csvEscape(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
