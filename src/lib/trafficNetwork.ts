import type { SnapshotIn } from "mobx-state-tree";
import { types } from "mobx-state-tree";
import { hostCategory, type ParsedPacket, shortHost } from "./tcpdumpParser";

const HostModel = types.model("Host", {
    id: types.identifier,
    address: types.string,
    label: types.string,
    category: types.enumeration("HostCategory", ["local", "private", "public"]),
    packetCount: types.optional(types.number, 0),
    bytesTotal: types.optional(types.number, 0),
});

const FlowModel = types.model("Flow", {
    id: types.identifier,
    srcHost: types.string,
    dstHost: types.string,
    proto: types.string,
    dstPort: types.maybeNull(types.number),
    packetCount: types.optional(types.number, 0),
    bytesTotal: types.optional(types.number, 0),
    lastSeen: types.optional(types.number, 0),
});

const PacketModel = types.model("TrafficPacket", {
    id: types.identifier,
    timestamp: types.string,
    proto: types.string,
    srcHost: types.string,
    srcPort: types.maybeNull(types.number),
    dstHost: types.string,
    dstPort: types.maybeNull(types.number),
    length: types.number,
    info: types.string,
    receivedAt: types.number,
});

const AnomalyModel = types.model("Anomaly", {
    id: types.identifier,
    timestamp: types.number,
    severity: types.enumeration("Severity", ["low", "medium", "high"]),
    type: types.string,
    description: types.string,
    hostId: types.maybe(types.string),
    flowId: types.maybe(types.string),
});

const TrafficNetworkModel = types
    .model("TrafficNetwork", {
        hosts: types.map(HostModel),
        flows: types.map(FlowModel),
        packets: types.array(PacketModel),
        anomalies: types.map(AnomalyModel),
        events: types.array(types.string),
        totalPackets: types.optional(types.number, 0),
        totalBytes: types.optional(types.number, 0),
        sourceMode: types.optional(types.string, "live"),
        sourceLabel: types.optional(
            types.string,
            "sudo tcpdump -i any -Q out -nn -vv",
        ),
        connected: types.optional(types.boolean, false),
    })
    .views((self) => ({
        get hostList() {
            return Array.from(self.hosts.values()).sort(
                (left, right) => right.packetCount - left.packetCount,
            );
        },
        get flowList() {
            return Array.from(self.flows.values()).sort(
                (left, right) => right.lastSeen - left.lastSeen,
            );
        },
        get activeFlows() {
            const cutoff = Date.now() - 2500;
            return this.flowList.filter((flow) => flow.lastSeen >= cutoff);
        },
        get anomalyList() {
            return Array.from(self.anomalies.values()).sort(
                (left, right) => right.timestamp - left.timestamp,
            );
        },
    }))
    .actions((self) => {
        const remember = (message: string) => {
            self.events.unshift(message);
            if (self.events.length > 16) {
                self.events.pop();
            }
        };

        const addAnomaly = (anomaly: SnapshotIn<typeof AnomalyModel>) => {
            if (self.anomalies.has(anomaly.id)) {
                return;
            }
            self.anomalies.set(anomaly.id, AnomalyModel.create(anomaly));
            remember(`ALERT: ${anomaly.type} - ${anomaly.description}`);
        };

        const detectAnomalies = (
            packet: ParsedPacket,
            flow: typeof FlowModel.Type,
        ) => {
            // 1. Large Flow Detection (> 100MB)
            if (flow.bytesTotal > 100 * 1024 * 1024) {
                addAnomaly({
                    id: `large-flow-${flow.id}`,
                    timestamp: Date.now(),
                    severity: "medium",
                    type: "Large Data Transfer",
                    description: `Flow ${flow.id} has transferred over 100MB`,
                    flowId: flow.id,
                });
            }

            // 2. Suspicious Port to Public
            const suspiciousPorts = [137, 138, 139, 445, 3389];
            const isPublic =
                hostCategory(packet.srcHost) === "public" ||
                hostCategory(packet.dstHost) === "public";

            if (isPublic && packet.dstPort && suspiciousPorts.includes(packet.dstPort)) {
                addAnomaly({
                    id: `suspicious-port-${packet.dstHost}-${packet.dstPort}`,
                    timestamp: Date.now(),
                    severity: "high",
                    type: "Suspicious External Port",
                    description: `Host ${packet.dstHost} receiving traffic on sensitive port ${packet.dstPort} from/to public IP`,
                    hostId: packet.dstHost,
                });
            }
        };

        const ensureHost = (address: string, quiet = false) => {
// ... existing code ...
            const existing = self.hosts.get(address);
            if (existing) {
                return existing;
            }

            const category = hostCategory(address);
            const host = HostModel.create({
                id: address,
                address,
                label: shortHost(address),
                category,
            });
            self.hosts.set(address, host);
            if (!quiet) {
                remember(`Discovered host ${shortHost(address)} (${category})`);
            }
            return host;
        };

        const flowKey = (packet: ParsedPacket) =>
            `${packet.srcHost}->${packet.dstHost}:${packet.proto}:${packet.dstPort ?? "any"}`;

        const ingestPacket = (
            packet: ParsedPacket,
            quiet = false,
            seenAt = Date.now(),
        ) => {
            const src = ensureHost(packet.srcHost, quiet);
            const dst = ensureHost(packet.dstHost, quiet);
            src.packetCount += 1;
            src.bytesTotal += packet.length;
            dst.packetCount += 1;
            dst.bytesTotal += packet.length;

            const key = flowKey(packet);
            const existingFlow = self.flows.get(key);
            let flow: typeof FlowModel.Type;
            if (existingFlow) {
                existingFlow.packetCount += 1;
                existingFlow.bytesTotal += packet.length;
                existingFlow.lastSeen = seenAt;
                flow = existingFlow;
            } else {
                flow = FlowModel.create({
                    id: key,
                    srcHost: packet.srcHost,
                    dstHost: packet.dstHost,
                    proto: packet.proto,
                    dstPort: packet.dstPort,
                    packetCount: 1,
                    bytesTotal: packet.length,
                    lastSeen: seenAt,
                });
                self.flows.set(key, flow);
            }

            detectAnomalies(packet, flow);

            const snapshot: SnapshotIn<typeof PacketModel> = {
                id: packet.id,
                timestamp: packet.timestamp,
                proto: packet.proto,
                srcHost: packet.srcHost,
                srcPort: packet.srcPort,
                dstHost: packet.dstHost,
                dstPort: packet.dstPort,
                length: packet.length,
                info: packet.info,
                receivedAt: seenAt,
            };
            self.packets.unshift(snapshot);
            if (self.packets.length > 80) {
                self.packets.pop();
            }

            self.totalPackets += 1;
            self.totalBytes += packet.length;
        };

        const ingestBatch = (packets: ParsedPacket[], quiet = false) => {
            for (const packet of packets) {
                ingestPacket(packet, quiet);
            }
        };

        type HistoricalPacket = ParsedPacket & { receivedAt: number };

        const ingestHistoricalBatch = (
            packets: HistoricalPacket[],
            quiet = true,
        ) => {
            for (const packet of packets) {
                ingestPacket(packet, quiet, packet.receivedAt);
            }
        };

        const setConnection = (connected: boolean) => {
            self.connected = connected;
            remember(
                connected
                    ? "Connected to traffic feed"
                    : "Traffic feed disconnected",
            );
        };

        const setSource = (mode: string, label: string) => {
            self.sourceMode = mode;
            self.sourceLabel = label;
            remember(`Source: ${label}`);
        };

        const reset = () => {
            self.hosts.clear();
            self.flows.clear();
            self.packets.clear();
            self.anomalies.clear();
            self.events.clear();
            self.totalPackets = 0;
            self.totalBytes = 0;
        };

        return {
            ingestPacket,
            ingestBatch,
            ingestHistoricalBatch,
            setConnection,
            setSource,
            reset,
            remember,
        };
    });

export const trafficNetwork = TrafficNetworkModel.create({
    hosts: {},
    flows: {},
    packets: [],
    events: [],
});

export type TrafficHost = (typeof trafficNetwork.hostList)[number];
export type TrafficFlow = (typeof trafficNetwork.flowList)[number];
