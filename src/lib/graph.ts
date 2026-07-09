import { type Edge, MarkerType, type Node } from "@xyflow/react";
import {
    formatBytes,
    HOST_NODE_SIZE,
    layoutHosts,
    protoColor,
    resolveEdgeHandles,
} from "../layout";
import type {
    ComparisonSummary,
    FlowEdgeData,
    HostCategory,
    HostNodeData,
    TrafficSnapshot,
} from "../types";
import { getComparisonContext } from "./comparison";
import type { TrafficHost } from "./trafficNetwork";
import { trafficNetwork } from "./trafficNetwork";

export const MAX_GRAPH_HOSTS = 18;
export const MAX_GRAPH_FLOWS = 48;
export const MAX_FEED_PACKETS = 30;
export const MAX_SNAPSHOT_FLOWS = 64;
export const FLOW_ACTIVE_WINDOW_MS = 2500;
export const FLOW_STALE_WINDOW_MS = 12000;

function selectGraphHosts(
    hosts: TrafficHost[],
    eligibleFlows = trafficNetwork.flowList,
): TrafficHost[] {
    const hostById = new Map(hosts.map((host) => [host.id, host]));
    const selectedIds = new Set<string>();

    for (const flow of eligibleFlows.slice(0, MAX_GRAPH_FLOWS)) {
        if (selectedIds.size >= MAX_GRAPH_HOSTS) {
            break;
        }
        if (hostById.has(flow.srcHost)) {
            selectedIds.add(flow.srcHost);
        }
        if (selectedIds.size >= MAX_GRAPH_HOSTS) {
            break;
        }
        if (hostById.has(flow.dstHost)) {
            selectedIds.add(flow.dstHost);
        }
    }

    for (const host of hosts) {
        if (selectedIds.size >= MAX_GRAPH_HOSTS) {
            break;
        }
        selectedIds.add(host.id);
    }

    return hosts.filter((host) => selectedIds.has(host.id));
}

let cachedLayoutKey = "";
let cachedLayout = new Map<string, { x: number; y: number }>();

function layoutKeyForHosts(hosts: TrafficHost[]): string {
    return hosts
        .map((host) => host.id)
        .sort()
        .join("|");
}

function resolveLayout(hostList: TrafficHost[]) {
    const key = layoutKeyForHosts(hostList);
    if (key === cachedLayoutKey) {
        return cachedLayout;
    }

    cachedLayoutKey = key;
    cachedLayout = layoutHosts(hostList);
    return cachedLayout;
}

export function createGraph(): TrafficSnapshot {
    const now = Date.now();
    const useLiveStaleWindow = trafficNetwork.sourceMode !== "history";
    const staleCutoff = now - FLOW_STALE_WINDOW_MS;
    const activeCutoff = now - FLOW_ACTIVE_WINDOW_MS;
    const eligibleFlows = useLiveStaleWindow
        ? trafficNetwork.flowList.filter((flow) => flow.lastSeen >= staleCutoff)
        : trafficNetwork.flowList;
    const hostList = selectGraphHosts(trafficNetwork.hostList, eligibleFlows);
    const hostIds = new Set(hostList.map((host) => host.id));
    const positions = resolveLayout(hostList);
    const activeFlowIds = new Set<string>();
    const hostProcessMap = new Map<string, Set<string>>();

    const comp = getComparisonContext();
    const compHostSet = comp ? comp.hostIds : null;
    const compFlowSet = comp ? comp.flowIds : null;

    const nodes: Node<HostNodeData>[] = hostList.map((host) => ({
        id: host.id,
        type: "host",
        position: positions.get(host.id) ?? { x: 0, y: 0 },
        width: HOST_NODE_SIZE.width,
        height: HOST_NODE_SIZE.height,
        data: {
            label: host.label,
            address: host.address,
            category: host.category as HostCategory,
            packetCount: host.packetCount,
            bytesTotal: formatBytes(host.bytesTotal),
            processes: [],
            processCount: 0,
            resolvedDns: trafficNetwork.resolvedDns.get(host.id),
            inComparison: compHostSet ? compHostSet.has(host.id) : undefined,
        },
    }));

    const flowSlice = eligibleFlows
        .filter(
            (flow) => hostIds.has(flow.srcHost) && hostIds.has(flow.dstHost),
        )
        .slice(0, MAX_GRAPH_FLOWS);

    let commonHostCount = 0;
    let commonFlowCount = 0;
    if (compHostSet) {
        for (const h of trafficNetwork.hostList) {
            if (compHostSet.has(h.id)) commonHostCount++;
        }
    }
    if (compFlowSet) {
        for (const f of trafficNetwork.flowList) {
            if (compFlowSet.has(f.id)) commonFlowCount++;
        }
    }

    for (const flow of flowSlice) {
        if (!useLiveStaleWindow || flow.lastSeen >= activeCutoff) {
            activeFlowIds.add(flow.id);
        }
        if (
            flow.processCommand &&
            flow.processPid !== undefined &&
            flow.processPid !== null &&
            flow.processUser?.trim() &&
            flow.processCommand.trim()
        ) {
            const label = `${flow.processCommand.trim()} · ${flow.processPid} (${flow.processUser})`;
            const srcSet =
                hostProcessMap.get(flow.srcHost) ?? new Set<string>();
            const dstSet =
                hostProcessMap.get(flow.dstHost) ?? new Set<string>();
            srcSet.add(label);
            dstSet.add(label);
            hostProcessMap.set(flow.srcHost, srcSet);
            hostProcessMap.set(flow.dstHost, dstSet);
        }
    }

    for (const node of nodes) {
        const processList = [
            ...(hostProcessMap.get(node.id) ?? new Set<string>()),
        ].sort((left, right) => left.localeCompare(right));
        if (processList.length > 0) {
            node.data.processes = processList.slice(0, 2);
            node.data.processCount = processList.length;
        }
    }

    const edges: Edge<FlowEdgeData>[] = flowSlice
        .filter((flow) => flow.srcHost !== flow.dstHost)
        .map((flow) => {
            const active = activeFlowIds.has(flow.id);
            const stroke = protoColor(flow.proto);
            const portLabel = flow.dstPort ? `:${flow.dstPort}` : "";
            const sourcePos = positions.get(flow.srcHost);
            const targetPos = positions.get(flow.dstHost);
            const handles =
                sourcePos && targetPos
                    ? resolveEdgeHandles(sourcePos, targetPos)
                    : {
                          sourceHandle: "source-right",
                          targetHandle: "target-left",
                      };
            const inComp = compFlowSet ? compFlowSet.has(flow.id) : undefined;
            return {
                id: flow.id,
                source: flow.srcHost,
                target: flow.dstHost,
                sourceHandle: handles.sourceHandle,
                targetHandle: handles.targetHandle,
                type: "flow",
                animated: false,
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: stroke,
                },
                data: {
                    label: `${flow.proto}${portLabel}`,
                    labelColor: stroke,
                    stroke,
                    active,
                    inComparison: inComp,
                },
            };
        });

    let comparisonSummary: ComparisonSummary | undefined;
    if (comp) {
        comparisonSummary = {
            sessionId: comp.sessionId,
            label: comp.label,
            hostCount: comp.hostIds.size,
            flowCount: comp.flowIds.size,
            commonHostCount,
            commonFlowCount,
        };
    }

    return {
        nodes,
        edges,
        packets: trafficNetwork.packets
            .slice(0, MAX_FEED_PACKETS)
            .map((packet) => ({
                id: packet.id,
                timestamp: packet.timestamp,
                proto: packet.proto,
                srcHost: packet.srcHost,
                dstHost: packet.dstHost,
                length: packet.length,
                info: packet.info,
                ...(packet.processCommand &&
                packet.processPid &&
                packet.processUser
                    ? {
                          process: {
                              command: packet.processCommand,
                              pid: packet.processPid,
                              user: packet.processUser,
                          },
                      }
                    : {}),
            })),
        // Provide a larger window of recent flows for sidebar lists (virtualized
        // to keep DOM bounded even when many flows present under the model cap).
        flows: trafficNetwork.flowList
            .slice(0, MAX_SNAPSHOT_FLOWS)
            .map((flow) => ({
                id: flow.id,
                srcHost: flow.srcHost,
                dstHost: flow.dstHost,
                proto: flow.proto,
                dstPort: flow.dstPort,
                packetCount: flow.packetCount,
                bytesTotal: flow.bytesTotal,
                active: activeFlowIds.has(flow.id),
                inComparison: compFlowSet
                    ? compFlowSet.has(flow.id)
                    : undefined,
                ...(flow.processCommand && flow.processPid && flow.processUser
                    ? {
                          process: {
                              command: flow.processCommand,
                              pid: flow.processPid,
                              user: flow.processUser,
                          },
                      }
                    : {}),
            })),
        anomalies: trafficNetwork.anomalyList.map((anomaly) => ({
            id: anomaly.id,
            timestamp: anomaly.timestamp,
            severity: anomaly.severity as "low" | "medium" | "high",
            type: anomaly.type,
            description: anomaly.description,
            hostId: anomaly.hostId,
            flowId: anomaly.flowId,
        })),
        events: [...trafficNetwork.events],
        totalPackets: trafficNetwork.totalPackets,
        totalBytes: trafficNetwork.totalBytes,
        hostCount: trafficNetwork.hosts.size,
        flowCount: trafficNetwork.flows.size,
        hostsEvicted: trafficNetwork.hostsEvicted || 0,
        flowsEvicted: trafficNetwork.flowsEvicted || 0,
        packetsEvicted: trafficNetwork.packetsEvicted || 0,
        summaryOnly: !!trafficNetwork.summaryOnly,
        connected: trafficNetwork.connected,
        sourceLabel: trafficNetwork.sourceLabel,
        sensitivity:
            (trafficNetwork.sensitivity as "low" | "medium" | "high") ??
            "medium",
        comparison: comparisonSummary,
    };
}
