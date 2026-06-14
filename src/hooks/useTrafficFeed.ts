import { onSnapshot } from "mobx-state-tree";
import { useEffect, useState } from "react";
import { createGraph } from "../lib/graph";
import type { ParsedPacket } from "../lib/tcpdumpParser";
import { trafficNetwork } from "../lib/trafficNetwork";
import type { TrafficSnapshot } from "../types";
import { resolveWsUrl } from "../ws";

export function useTrafficFeed() {
    const [graph, setGraph] = useState<TrafficSnapshot>(() => createGraph());

    useEffect(() => {
        const dispose = onSnapshot(trafficNetwork, () => {
            setGraph(createGraph());
        });

        const socket = new WebSocket(resolveWsUrl());
        let pendingPackets: ParsedPacket[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const flushPackets = () => {
            if (pendingPackets.length === 0) {
                return;
            }
            trafficNetwork.ingestBatch(pendingPackets);
            pendingPackets = [];
            flushTimer = null;
        };

        const scheduleFlush = () => {
            if (flushTimer) {
                return;
            }
            flushTimer = setTimeout(flushPackets, 80);
        };

        socket.addEventListener("open", () => {
            trafficNetwork.setConnection(true);
        });

        socket.addEventListener("close", () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            flushPackets();
            trafficNetwork.setConnection(false);
        });

        socket.addEventListener("message", (event) => {
            const payload = JSON.parse(String(event.data)) as
                | { type: "packet"; packet: ParsedPacket }
                | { type: "status"; mode: string; label: string }
                | { type: "error"; message: string }
                | { type: "complete" };

            if (payload.type === "packet") {
                pendingPackets.push(payload.packet);
                scheduleFlush();
                return;
            }

            if (payload.type === "status") {
                trafficNetwork.setSource(payload.mode, payload.label);
                return;
            }

            if (payload.type === "error") {
                trafficNetwork.remember(payload.message);
                return;
            }

            if (payload.type === "complete") {
                flushPackets();
                trafficNetwork.remember("File replay complete");
            }
        });

        return () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            socket.close();
            dispose();
        };
    }, []);

    return graph;
}
