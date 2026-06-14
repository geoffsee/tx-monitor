import { useEffect, useRef, useState } from "react";
import { createGraph } from "../lib/graph";
import type { ParsedPacket } from "../lib/tcpdumpParser";
import { trafficNetwork } from "../lib/trafficNetwork";
import type { TrafficSnapshot } from "../types";
import { resolveWsUrl } from "../ws";

const FLUSH_INTERVAL_MS = 80;
const MAX_INGEST_PER_FLUSH = 250;

export function useTrafficFeed() {
    const [graph, setGraph] = useState<TrafficSnapshot>(() => createGraph());
    const graphRafRef = useRef<number | null>(null);

    useEffect(() => {
        const scheduleGraphUpdate = () => {
            if (graphRafRef.current !== null) {
                return;
            }
            graphRafRef.current = requestAnimationFrame(() => {
                graphRafRef.current = null;
                setGraph(createGraph());
            });
        };

        const socket = new WebSocket(resolveWsUrl());
        const pendingPackets: ParsedPacket[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const flushPackets = () => {
            flushTimer = null;
            if (pendingPackets.length === 0) {
                return;
            }

            const batch = pendingPackets.splice(0, MAX_INGEST_PER_FLUSH);
            trafficNetwork.ingestBatch(batch, true);
            scheduleGraphUpdate();

            if (pendingPackets.length > 0) {
                flushTimer = setTimeout(flushPackets, 0);
            }
        };

        const scheduleFlush = () => {
            if (flushTimer) {
                return;
            }
            flushTimer = setTimeout(flushPackets, FLUSH_INTERVAL_MS);
        };

        const queuePackets = (packets: ParsedPacket[]) => {
            if (packets.length === 0) {
                return;
            }
            pendingPackets.push(...packets);
            scheduleFlush();
        };

        socket.addEventListener("open", () => {
            trafficNetwork.setConnection(true);
            scheduleGraphUpdate();
        });

        socket.addEventListener("close", () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            flushPackets();
            trafficNetwork.setConnection(false);
            scheduleGraphUpdate();
        });

        socket.addEventListener("message", (event) => {
            const payload = JSON.parse(String(event.data)) as
                | { type: "packet"; packet: ParsedPacket }
                | { type: "packets"; packets: ParsedPacket[] }
                | { type: "status"; mode: string; label: string }
                | { type: "error"; message: string }
                | { type: "complete" };

            if (payload.type === "packet") {
                queuePackets([payload.packet]);
                return;
            }

            if (payload.type === "packets") {
                queuePackets(payload.packets);
                return;
            }

            if (payload.type === "status") {
                trafficNetwork.setSource(payload.mode, payload.label);
                scheduleGraphUpdate();
                return;
            }

            if (payload.type === "error") {
                trafficNetwork.remember(payload.message);
                scheduleGraphUpdate();
                return;
            }

            if (payload.type === "complete") {
                flushPackets();
                trafficNetwork.remember("File replay complete");
                scheduleGraphUpdate();
            }
        });

        return () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            if (graphRafRef.current !== null) {
                cancelAnimationFrame(graphRafRef.current);
            }
            socket.close();
        };
    }, []);

    return graph;
}
