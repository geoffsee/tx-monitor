import { useCallback, useEffect, useRef, useState } from "react";
import {
    fetchSession,
    fetchSessionPackets,
    SESSION_PAGE_SIZE,
} from "../lib/api";
import { createGraph } from "../lib/graph";
import type { ParsedPacket } from "../lib/tcpdumpParser";
import { trafficNetwork } from "../lib/trafficNetwork";
import type {
    SessionLoadProgress,
    TrafficSnapshot,
    TrafficViewMode,
} from "../types";
import { resolveWsUrl } from "../ws";

const FLUSH_INTERVAL_MS = 80;
const MAX_INGEST_PER_FLUSH = 1000;
const CATCHUP_GRAPH_INTERVAL_MS = 120;
const HISTORY_INGEST_CHUNK = 2000;

export type TrafficFeedState = {
    graph: TrafficSnapshot;
    viewMode: TrafficViewMode;
    activeSessionId: string | null;
    sessionLoadProgress: SessionLoadProgress | null;
    sessionsVersion: number;
    loadSession: (sessionId: string) => Promise<void>;
    returnToLive: () => void;
    refreshSessions: () => void;
    sensitivity: "low" | "medium" | "high";
    setSensitivity: (level: "low" | "medium" | "high") => void;
    summaryOnly: boolean;
    setSummaryOnly: (enabled: boolean) => void;
};

export function useTrafficFeed(): TrafficFeedState {
    const [graph, setGraph] = useState<TrafficSnapshot>(() => createGraph());
    const [viewMode, setViewMode] = useState<TrafficViewMode>("live");
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [sessionLoadProgress, setSessionLoadProgress] =
        useState<SessionLoadProgress | null>(null);
    const [sessionsVersion, setSessionsVersion] = useState(0);
    const graphRafRef = useRef<number | null>(null);
    const graphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasDisplayedPacketsRef = useRef(false);
    const livePausedRef = useRef(false);
    const loadAbortRef = useRef(0);

    const publishGraph = useCallback(() => {
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
    }, []);

    const refreshSessions = useCallback(() => {
        setSessionsVersion((version) => version + 1);
    }, []);

    const returnToLive = useCallback(() => {
        loadAbortRef.current += 1;
        livePausedRef.current = false;
        setSessionLoadProgress(null);
        setActiveSessionId(null);
        setViewMode("live");
        trafficNetwork.reset();
        publishGraph();
        refreshSessions();
    }, [publishGraph, refreshSessions]);

    const loadSession = useCallback(
        async (sessionId: string) => {
            const loadId = loadAbortRef.current + 1;
            loadAbortRef.current = loadId;
            livePausedRef.current = true;
            setActiveSessionId(sessionId);
            setViewMode("history");
            setSessionLoadProgress({ loaded: 0, total: 0 });
            trafficNetwork.reset();
            publishGraph();

            try {
                const session = await fetchSession(sessionId);
                if (loadAbortRef.current !== loadId) {
                    return;
                }

                const headerLabel = session.hostname
                    ? `${session.label} @ ${session.hostname}`
                    : session.label;
                trafficNetwork.setSource("history", headerLabel);
                trafficNetwork.remember(
                    `Loading ${session.totalPackets.toLocaleString()} packets`,
                );
                setSessionLoadProgress({
                    loaded: 0,
                    total: session.totalPackets,
                });
                publishGraph();

                let offset = 0;
                while (offset < session.totalPackets) {
                    if (loadAbortRef.current !== loadId) {
                        return;
                    }

                    const batch = await fetchSessionPackets(
                        sessionId,
                        offset,
                        SESSION_PAGE_SIZE,
                    );
                    if (batch.length === 0) {
                        break;
                    }

                    for (
                        let index = 0;
                        index < batch.length;
                        index += HISTORY_INGEST_CHUNK
                    ) {
                        if (loadAbortRef.current !== loadId) {
                            return;
                        }
                        trafficNetwork.ingestHistoricalBatch(
                            batch.slice(index, index + HISTORY_INGEST_CHUNK),
                        );
                    }

                    offset += batch.length;
                    setSessionLoadProgress({
                        loaded: offset,
                        total: session.totalPackets,
                    });
                    publishGraph();
                }

                if (loadAbortRef.current !== loadId) {
                    return;
                }

                trafficNetwork.remember(
                    `Loaded session · ${session.totalPackets.toLocaleString()} packets`,
                );
                setSessionLoadProgress(null);
                publishGraph();
                refreshSessions();
            } catch (error) {
                if (loadAbortRef.current !== loadId) {
                    return;
                }
                const message =
                    error instanceof Error
                        ? error.message
                        : "Failed to load session";
                trafficNetwork.remember(message);
                setSessionLoadProgress(null);
                publishGraph();
            }
        },
        [publishGraph, refreshSessions],
    );

    useEffect(() => {
        hasDisplayedPacketsRef.current = false;

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
            if (pendingPackets.length === 0 || livePausedRef.current) {
                pendingPackets.length = 0;
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
            if (flushTimer || livePausedRef.current) {
                return;
            }
            const delay =
                hasDisplayedPacketsRef.current || pendingPackets.length === 0
                    ? FLUSH_INTERVAL_MS
                    : 0;
            flushTimer = setTimeout(flushPackets, delay);
        };

        const queuePackets = (packets: ParsedPacket[]) => {
            if (packets.length === 0 || livePausedRef.current) {
                return;
            }
            pendingPackets.push(...packets);
            scheduleFlush();
        };

        socket.addEventListener("open", () => {
            if (!livePausedRef.current) {
                trafficNetwork.setConnection(true);
                publishGraph();
            }
        });

        socket.addEventListener("close", () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
            }
            if (!livePausedRef.current) {
                flushPackets();
                trafficNetwork.setConnection(false);
                publishGraph();
            }
        });

        socket.addEventListener("message", (event) => {
            if (livePausedRef.current) {
                return;
            }

            const payload = JSON.parse(String(event.data)) as
                | { type: "packet"; packet: ParsedPacket }
                | { type: "packets"; packets: ParsedPacket[] }
                | { type: "dns"; host: string; name: string }
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

            if (payload.type === "dns") {
                trafficNetwork.setResolvedDns(payload.host, payload.name);
                publishGraph();
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
                refreshSessions();
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
    }, [publishGraph, refreshSessions]);

    const setSensitivity = useCallback(
        (level: "low" | "medium" | "high") => {
            trafficNetwork.setSensitivity(level);
            publishGraph();
        },
        [publishGraph],
    );

    const setSummaryOnly = useCallback(
        (enabled: boolean) => {
            trafficNetwork.setSummaryOnly(enabled);
            publishGraph();
        },
        [publishGraph],
    );

    return {
        graph,
        viewMode,
        activeSessionId,
        sessionLoadProgress,
        sessionsVersion,
        loadSession,
        returnToLive,
        refreshSessions,
        sensitivity: graph.sensitivity,
        setSensitivity,
        summaryOnly: graph.summaryOnly,
        setSummaryOnly,
    };
}
