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
    processCommand: types.maybe(types.string),
    processPid: types.maybe(types.number),
    processUser: types.maybe(types.string),
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
    processCommand: types.maybe(types.string),
    processPid: types.maybe(types.number),
    processUser: types.maybe(types.string),
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
        resolvedDns: types.map(types.string),
        anomalies: types.map(AnomalyModel),
        events: types.array(types.string),
        totalPackets: types.optional(types.number, 0),
        totalBytes: types.optional(types.number, 0),
        dnsPacketCount: types.optional(types.number, 0),
        sensitivity: types.optional(
            types.enumeration("AnomalySensitivity", ["low", "medium", "high"]),
            "medium",
        ),
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

        // Bounded per-flow arrival history for rate and beacon detection (max 16)
        const flowArrivals = new Map<string, number[]>();
        // Distinct DNS target hosts seen (capped naturally by host cardinality)
        const dnsTargets = new Set<string>();

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
            seenAt: number,
        ) => {
            const sens = self.sensitivity;

            // 1. Large Flow Detection (threshold depends on sensitivity)
            const largeBytes =
                sens === "low"
                    ? 200 * 1024 * 1024
                    : sens === "high"
                      ? 50 * 1024 * 1024
                      : 100 * 1024 * 1024;
            if (flow.bytesTotal > largeBytes) {
                addAnomaly({
                    id: `large-flow-${flow.id}`,
                    timestamp: Date.now(),
                    severity: "medium",
                    type: "Large Data Transfer",
                    description: `Flow ${flow.id} has transferred over ${Math.round(largeBytes / (1024 * 1024))}MB`,
                    flowId: flow.id,
                });
            }

            // 2. Suspicious Port to Public (signature-based, always active)
            const suspiciousPorts = [137, 138, 139, 445, 3389];
            const isPublic =
                hostCategory(packet.srcHost) === "public" ||
                hostCategory(packet.dstHost) === "public";

            if (
                isPublic &&
                packet.dstPort &&
                suspiciousPorts.includes(packet.dstPort)
            ) {
                addAnomaly({
                    id: `suspicious-port-${packet.dstHost}-${packet.dstPort}`,
                    timestamp: Date.now(),
                    severity: "high",
                    type: "Suspicious External Port",
                    description: `Host ${packet.dstHost} receiving traffic on sensitive port ${packet.dstPort} from/to public IP`,
                    hostId: packet.dstHost,
                });
            }

            // 3. Rate spike (sudden high packet count to same flow in short window)
            const arrivals = flowArrivals.get(flow.id) ?? [];
            const rateWindowMs = 1500;
            const recent = arrivals.filter((t) => seenAt - t <= rateWindowMs);
            const rateThresh = sens === "low" ? 14 : sens === "high" ? 4 : 8;
            if (recent.length >= rateThresh) {
                addAnomaly({
                    id: `rate-spike-${flow.id}`,
                    timestamp: Date.now(),
                    severity: sens === "high" ? "medium" : "low",
                    type: "High Rate",
                    description: `Flow ${flow.id} received ${recent.length} packets in ~${Math.round(rateWindowMs / 1000)}s`,
                    flowId: flow.id,
                });
            }

            // 4. Beaconing (periodic timing to same remote)
            if (arrivals.length >= 3) {
                const minSamples = sens === "low" ? 6 : sens === "high" ? 3 : 4;
                if (arrivals.length >= minSamples) {
                    const deltas: number[] = [];
                    for (let i = 1; i < arrivals.length; i++) {
                        const prev = arrivals[i - 1];
                        const curr = arrivals[i];
                        if (prev !== undefined && curr !== undefined) {
                            deltas.push(curr - prev);
                        }
                    }
                    const sorted = [...deltas].sort((a, b) => a - b);
                    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
                    if (median >= 150) {
                        let regular = 0;
                        for (const d of deltas) {
                            if (
                                median > 0 &&
                                Math.abs(d - median) / median <= 0.35
                            )
                                regular++;
                        }
                        const ratio = regular / deltas.length;
                        if (ratio >= 0.6) {
                            addAnomaly({
                                id: `beacon-${flow.id}`,
                                timestamp: Date.now(),
                                severity: "low",
                                type: "Beaconing",
                                description: `Flow ${flow.id} shows periodic timing (~${Math.round(median)}ms intervals)`,
                                flowId: flow.id,
                            });
                        }
                    }
                }
            }

            // 5. Unusual DNS (high volume or broad target set)
            const isDns = packet.dstPort === 53 || packet.srcPort === 53;
            if (isDns) {
                const dnsVolThresh =
                    sens === "low" ? 75 : sens === "high" ? 15 : 35;
                const dnsDivThresh =
                    sens === "low" ? 12 : sens === "high" ? 4 : 7;
                const dnsCount = self.dnsPacketCount ?? 0;
                const targetCount = dnsTargets.size;
                if (
                    dnsCount >= dnsVolThresh &&
                    !self.anomalies.has("dns-volume")
                ) {
                    addAnomaly({
                        id: "dns-volume",
                        timestamp: Date.now(),
                        severity: "low",
                        type: "High DNS Volume",
                        description: `${dnsCount} DNS packets observed`,
                    });
                }
                if (
                    targetCount >= dnsDivThresh &&
                    !self.anomalies.has("dns-diversity")
                ) {
                    addAnomaly({
                        id: "dns-diversity",
                        timestamp: Date.now(),
                        severity: "low",
                        type: "Broad DNS Activity",
                        description: `DNS queries to ${targetCount} distinct destinations`,
                    });
                }
            }
        };

        const ensureHost = (address: string, quiet = false) => {
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

            // Track arrivals for rate/beacon (use the ingest timestamp)
            const arrivals = flowArrivals.get(flow.id) ?? [];
            arrivals.push(seenAt);
            if (arrivals.length > 16) arrivals.shift();
            flowArrivals.set(flow.id, arrivals);

            // Track DNS volume/diversity
            const isDns = packet.dstPort === 53 || packet.srcPort === 53;
            if (isDns) {
                self.dnsPacketCount = (self.dnsPacketCount ?? 0) + 1;
                dnsTargets.add(packet.dstHost);
            }

            detectAnomalies(packet, flow, seenAt);

            if (packet.process) {
                flow.processCommand = packet.process.command;
                flow.processPid = packet.process.pid;
                flow.processUser = packet.process.user;
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
                receivedAt: seenAt,
                ...(packet.process
                    ? {
                          processCommand: packet.process.command,
                          processPid: packet.process.pid,
                          processUser: packet.process.user,
                      }
                    : {}),
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

        const setResolvedDns = (host: string, name: string) => {
            const trimmedHost = host.trim();
            const trimmedName = name.trim();
            if (!trimmedHost || !trimmedName) {
                return;
            }
            self.resolvedDns.set(trimmedHost, trimmedName);
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
            self.resolvedDns.clear();
            self.anomalies.clear();
            self.events.clear();
            self.totalPackets = 0;
            self.totalBytes = 0;
            self.dnsPacketCount = 0;
            self.sensitivity = "medium";
            flowArrivals.clear();
            dnsTargets.clear();
            self.sourceMode = "live";
            self.sourceLabel = "sudo tcpdump -i any -Q out -nn -vv";
        };

        const setSensitivity = (level: "low" | "medium" | "high") => {
            self.sensitivity = level;
        };

        return {
            ingestPacket,
            ingestBatch,
            ingestHistoricalBatch,
            setResolvedDns,
            setConnection,
            setSource,
            setSensitivity,
            reset,
            remember,
        };
    });

export const trafficNetwork = TrafficNetworkModel.create({
    hosts: {},
    resolvedDns: {},
    flows: {},
    packets: [],
    events: [],
});

export type TrafficHost = (typeof trafficNetwork.hostList)[number];
export type TrafficFlow = (typeof trafficNetwork.flowList)[number];
