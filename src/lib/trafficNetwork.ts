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

const TrafficNetworkModel = types
    .model("TrafficNetwork", {
        hosts: types.map(HostModel),
        flows: types.map(FlowModel),
        packets: types.array(PacketModel),
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
    }))
    .actions((self) => {
        const remember = (message: string) => {
            self.events.unshift(message);
            if (self.events.length > 16) {
                self.events.pop();
            }
        };

        const ensureHost = (address: string) => {
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
            remember(`Discovered host ${shortHost(address)} (${category})`);
            return host;
        };

        const flowKey = (packet: ParsedPacket) =>
            `${packet.srcHost}->${packet.dstHost}:${packet.proto}:${packet.dstPort ?? "any"}`;

        const ingestPacket = (packet: ParsedPacket) => {
            const src = ensureHost(packet.srcHost);
            const dst = ensureHost(packet.dstHost);
            src.packetCount += 1;
            src.bytesTotal += packet.length;
            dst.packetCount += 1;
            dst.bytesTotal += packet.length;

            const key = flowKey(packet);
            const existingFlow = self.flows.get(key);
            if (existingFlow) {
                existingFlow.packetCount += 1;
                existingFlow.bytesTotal += packet.length;
                existingFlow.lastSeen = Date.now();
            } else {
                self.flows.set(
                    key,
                    FlowModel.create({
                        id: key,
                        srcHost: packet.srcHost,
                        dstHost: packet.dstHost,
                        proto: packet.proto,
                        dstPort: packet.dstPort,
                        packetCount: 1,
                        bytesTotal: packet.length,
                        lastSeen: Date.now(),
                    }),
                );
            }

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
                receivedAt: Date.now(),
            };
            self.packets.unshift(snapshot);
            if (self.packets.length > 80) {
                self.packets.pop();
            }

            self.totalPackets += 1;
            self.totalBytes += packet.length;
        };

        const ingestBatch = (packets: ParsedPacket[]) => {
            for (const packet of packets) {
                ingestPacket(packet);
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
            self.events.clear();
            self.totalPackets = 0;
            self.totalBytes = 0;
        };

        return {
            ingestPacket,
            ingestBatch,
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
