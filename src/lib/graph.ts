import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { formatBytes, layoutHosts, protoColor } from "../layout";
import { trafficNetwork } from "./trafficNetwork";
import type {
    FlowEdgeData,
    HostCategory,
    HostNodeData,
    TrafficSnapshot,
} from "../types";

export const MAX_GRAPH_HOSTS = 24;
export const MAX_GRAPH_FLOWS = 48;

export function createGraph(): TrafficSnapshot {
    const hostList = trafficNetwork.hostList.slice(0, MAX_GRAPH_HOSTS);
    const hostIds = new Set(hostList.map((host) => host.id));
    const positions = layoutHosts(hostList);
    const activeFlowIds = new Set(
        trafficNetwork.activeFlows.map((flow) => flow.id),
    );

    const nodes: Node<HostNodeData>[] = hostList.map((host) => ({
        id: host.id,
        type: "host",
        position: positions.get(host.id) ?? { x: 0, y: 0 },
        data: {
            label: host.label,
            address: host.address,
            category: host.category as HostCategory,
            packetCount: host.packetCount,
            bytesTotal: formatBytes(host.bytesTotal),
        },
    }));

    const edges: Edge<FlowEdgeData>[] = trafficNetwork.flowList
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
