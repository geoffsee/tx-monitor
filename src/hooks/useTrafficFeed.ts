import { useCallback, useEffect, useRef, useState } from "react";
import {
    fetchSession,
    fetchSessionPackets,
    SESSION_PAGE_SIZE,
} from "../lib/api";
import {
    clearComparisonContext,
    MAX_COMPARISON_ENTRIES,
    setComparisonContext,
} from "../lib/comparison";
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
    comparisonSessionId: string | null;
    comparisonLabel: string | null;
    comparisonLoadProgress: SessionLoadProgress | null;
    loadComparisonSession: (sessionId: string) => Promise<void>;
    clearComparison: () => void;
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
    const activeSessionIdRef = useRef<string | null>(null);
    const [comparisonSessionId, setComparisonSessionId] = useState<
        string | null
    >(null);
    const [comparisonLabel, setComparisonLabel] = useState<string | null>(null);
    const [comparisonLoadProgress, setComparisonLoadProgress] =
        useState<SessionLoadProgress | null>(null);
    const compLoadAbortRef = useRef(0);
    /** Installed comparison session id (sync with state for race-free checks). */
    const compSessionIdRef = useRef<string | null>(null);
    /** In-flight comparison load target (null when idle). */
    const compTargetSessionIdRef = useRef<string | null>(null);

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
        compLoadAbortRef.current += 1;
        livePausedRef.current = false;
        activeSessionIdRef.current = null;
        setSessionLoadProgress(null);
        setActiveSessionId(null);
        setViewMode("live");
        compSessionIdRef.current = null;
        compTargetSessionIdRef.current = null;
        setComparisonSessionId(null);
        setComparisonLabel(null);
        setComparisonLoadProgress(null);
        clearComparisonContext();
        trafficNetwork.reset();
        publishGraph();
        refreshSessions();
    }, [publishGraph, refreshSessions]);

    const loadSession = useCallback(
        async (sessionId: string) => {
            const loadId = loadAbortRef.current + 1;
            loadAbortRef.current = loadId;
            livePausedRef.current = true;
            activeSessionIdRef.current = sessionId;
            setActiveSessionId(sessionId);
            setViewMode("history");
            setSessionLoadProgress({ loaded: 0, total: 0 });
            trafficNetwork.reset();
            publishGraph();

            // Abort/clear comparison if installed or in-flight target is this
            // session (avoids self-overlay races while React state is stale).
            if (
                compSessionIdRef.current === sessionId ||
                compTargetSessionIdRef.current === sessionId
            ) {
                compLoadAbortRef.current += 1;
                compSessionIdRef.current = null;
                compTargetSessionIdRef.current = null;
                setComparisonSessionId(null);
                setComparisonLabel(null);
                setComparisonLoadProgress(null);
                clearComparisonContext();
            }

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

    const loadComparisonSession = useCallback(
        async (sessionId: string) => {
            if (activeSessionIdRef.current === sessionId) {
                // Cannot compare a session against itself as primary
                return;
            }
            const loadId = compLoadAbortRef.current + 1;
            compLoadAbortRef.current = loadId;
            compTargetSessionIdRef.current = sessionId;
            setComparisonLoadProgress({ loaded: 0, total: 0 });

            try {
                const session = await fetchSession(sessionId);
                if (compLoadAbortRef.current !== loadId) {
                    return;
                }

                const headerLabel = session.hostname
                    ? `${session.label} @ ${session.hostname}`
                    : session.label;

                const hostSet = new Set<string>();
                const flowSet = new Set<string>();
                const makeFlowKey = (
                    src: string,
                    dst: string,
                    proto: string,
                    dstPort: number | null,
                ) => `${src}->${dst}:${proto}:${dstPort ?? "any"}`;

                setComparisonLoadProgress({
                    loaded: 0,
                    total: session.totalPackets,
                });
                publishGraph();

                let offset = 0;
                while (offset < session.totalPackets) {
                    if (compLoadAbortRef.current !== loadId) {
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

                    for (const p of batch) {
                        if (
                            p.srcHost &&
                            hostSet.size < MAX_COMPARISON_ENTRIES
                        ) {
                            hostSet.add(p.srcHost);
                        }
                        if (
                            p.dstHost &&
                            hostSet.size < MAX_COMPARISON_ENTRIES
                        ) {
                            hostSet.add(p.dstHost);
                        }
                        if (flowSet.size < MAX_COMPARISON_ENTRIES) {
                            flowSet.add(
                                makeFlowKey(
                                    p.srcHost,
                                    p.dstHost,
                                    p.proto,
                                    p.dstPort,
                                ),
                            );
                        }
                    }

                    offset += batch.length;
                    setComparisonLoadProgress({
                        loaded: offset,
                        total: session.totalPackets,
                    });

                    if (
                        hostSet.size >= MAX_COMPARISON_ENTRIES &&
                        flowSet.size >= MAX_COMPARISON_ENTRIES
                    ) {
                        break;
                    }
                }

                if (compLoadAbortRef.current !== loadId) {
                    return;
                }
                // Primary may have become this session mid-flight
                if (activeSessionIdRef.current === sessionId) {
                    compTargetSessionIdRef.current = null;
                    setComparisonLoadProgress(null);
                    return;
                }

                // Bound and install
                setComparisonContext(sessionId, headerLabel, hostSet, flowSet);
                compSessionIdRef.current = sessionId;
                compTargetSessionIdRef.current = null;
                setComparisonSessionId(sessionId);
                setComparisonLabel(headerLabel);
                setComparisonLoadProgress(null);
                publishGraph();
                refreshSessions();
            } catch (error) {
                if (compLoadAbortRef.current !== loadId) {
                    return;
                }
                const message =
                    error instanceof Error
                        ? error.message
                        : "Failed to load comparison";
                trafficNetwork.remember(message);
                compTargetSessionIdRef.current = null;
                setComparisonLoadProgress(null);
                // leave prior comparison (if any) intact on failure
                publishGraph();
            }
        },
        [publishGraph, refreshSessions],
    );

    const clearComparison = useCallback(() => {
        compLoadAbortRef.current += 1;
        compSessionIdRef.current = null;
        compTargetSessionIdRef.current = null;
        setComparisonSessionId(null);
        setComparisonLabel(null);
        setComparisonLoadProgress(null);
        clearComparisonContext();
        publishGraph();
    }, [publishGraph]);

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
        comparisonSessionId,
        comparisonLabel,
        comparisonLoadProgress,
        loadComparisonSession,
        clearComparison,
        summaryOnly: graph.summaryOnly,
        setSummaryOnly,
    };
}
