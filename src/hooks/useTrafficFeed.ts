import { useEffect, useRef, useState } from "react";
import { createGraph } from "../lib/graph";
import type { ParsedPacket } from "../lib/tcpdumpParser";
import { trafficNetwork } from "../lib/trafficNetwork";
import type { TrafficSnapshot } from "../types";
import { resolveWsUrl } from "../ws";

const FLUSH_INTERVAL_MS = 80;
const MAX_INGEST_PER_FLUSH = 1000;
const CATCHUP_GRAPH_INTERVAL_MS = 120;

export function useTrafficFeed() {
    const [graph, setGraph] = useState<TrafficSnapshot>(() => createGraph());
    const graphRafRef = useRef<number | null>(null);
    const graphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasDisplayedPacketsRef = useRef(false);

    useEffect(() => {
        hasDisplayedPacketsRef.current = false;

        const publishGraph = () => {
            if (graphRafRef.current !== null) {
                cancelAnimationFrame(graphRafRef.current);
            }
            if (graphTimerRef.current !== null) {
                clearTimeout(graphTimerRef.current);
                graphTimerRef.current = null;
            }
            graphRafRef.current = requestAnimationFrame(() => {
                graphRafRef.current = null;
                setGraph(createGraph());
            });
        };

        const scheduleGraphUpdate = (
            backlogSize: number,
            isFirstBatch = false,
        ) => {
            if (isFirstBatch || backlogSize === 0) {
                publishGraph();
                return;
            }
            if (backlogSize > MAX_INGEST_PER_FLUSH) {
                if (graphTimerRef.current !== null) {
                    return;
                }
                graphTimerRef.current = setTimeout(() => {
                    graphTimerRef.current = null;
                    publishGraph();
                }, CATCHUP_GRAPH_INTERVAL_MS);
                return;
            }
            publishGraph();
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
            const isFirstBatch = !hasDisplayedPacketsRef.current;
            trafficNetwork.ingestBatch(batch, true);
            hasDisplayedPacketsRef.current = true;
            scheduleGraphUpdate(pendingPackets.length, isFirstBatch);

            if (pendingPackets.length > 0) {
                flushTimer = setTimeout(flushPackets, 0);
            } else {
                publishGraph();
            }
        };

        const scheduleFlush = () => {
            if (flushTimer) {
                return;
            }
            const delay =
                hasDisplayedPacketsRef.current || pendingPackets.length === 0
                    ? FLUSH_INTERVAL_MS
                    : 0;
            flushTimer = setTimeout(flushPackets, delay);
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
            publishGraph();
        });

        socket.addEventListener("close", () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            flushPackets();
            trafficNetwork.setConnection(false);
            publishGraph();
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
                publishGraph();
                return;
            }

            if (payload.type === "error") {
                trafficNetwork.remember(payload.message);
                publishGraph();
                return;
            }

            if (payload.type === "complete") {
                flushPackets();
                trafficNetwork.remember("File replay complete");
                publishGraph();
            }
        });

        return () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            if (graphRafRef.current !== null) {
                cancelAnimationFrame(graphRafRef.current);
            }
            if (graphTimerRef.current !== null) {
                clearTimeout(graphTimerRef.current);
            }
            socket.close();
        };
    }, []);

    return graph;
}
