import { useCallback, useEffect, useRef, useState } from "react";
import {
    fetchSession,
    fetchSessionPackets,
    SESSION_PAGE_SIZE,
    type StoredPacketRow,
} from "../lib/api";
import { createGraph } from "../lib/graph";
import type { ParsedPacket } from "../lib/tcpdumpParser";
import { trafficNetwork } from "../lib/trafficNetwork";
import type {
    HistoryPlayback,
    SessionLoadProgress,
    TrafficSnapshot,
    TrafficViewMode,
} from "../types";
import { resolveWsUrl } from "../ws";

const BOOKMARKS_KEY_PREFIX = "txmon-bookmarks-";

function loadBookmarksForSession(
    sessionId: string,
): Array<{ name: string; offset: number }> {
    try {
        const raw = localStorage.getItem(BOOKMARKS_KEY_PREFIX + sessionId);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter(
                (b: unknown): b is { name: string; offset: number } =>
                    typeof b === "object" &&
                    b !== null &&
                    "name" in b &&
                    "offset" in b &&
                    typeof (b as { name: unknown }).name === "string" &&
                    typeof (b as { offset: unknown }).offset === "number",
            );
        }
    } catch {
        // ignore storage errors
    }
    return [];
}

function saveBookmarksForSession(
    sessionId: string,
    bms: Array<{ name: string; offset: number }>,
) {
    try {
        localStorage.setItem(
            BOOKMARKS_KEY_PREFIX + sessionId,
            JSON.stringify(bms),
        );
    } catch {
        // ignore storage errors
    }
}

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
    historyPlayback: HistoryPlayback | null;
    historyBookmarks: Array<{ name: string; offset: number }>;
    loadSession: (sessionId: string) => Promise<void>;
    returnToLive: () => void;
    refreshSessions: () => void;
    seekTo: (offset: number) => void;
    addBookmark: (name: string) => void;
    removeBookmark: (name: string) => void;
    jumpToBookmark: (name: string) => void;
};

export function useTrafficFeed(): TrafficFeedState {
    const [graph, setGraph] = useState<TrafficSnapshot>(() => createGraph());
    const [viewMode, setViewMode] = useState<TrafficViewMode>("live");
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [sessionLoadProgress, setSessionLoadProgress] =
        useState<SessionLoadProgress | null>(null);
    const [sessionsVersion, setSessionsVersion] = useState(0);
    const [historyPlayback, setHistoryPlayback] =
        useState<HistoryPlayback | null>(null);
    const [historyBookmarks, setHistoryBookmarks] = useState<
        Array<{ name: string; offset: number }>
    >([]);
    const graphRafRef = useRef<number | null>(null);
    const graphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasDisplayedPacketsRef = useRef(false);
    const livePausedRef = useRef(false);
    const loadAbortRef = useRef(0);
    const historyPacketsRef = useRef<StoredPacketRow[]>([]);
    const historyBookmarksRef = useRef<Array<{ name: string; offset: number }>>(
        [],
    );

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
        historyPacketsRef.current = [];
        setHistoryPlayback(null);
        historyBookmarksRef.current = [];
        setHistoryBookmarks([]);
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
            historyPacketsRef.current = [];
            setHistoryPlayback(null);
            historyBookmarksRef.current = [];
            setHistoryBookmarks([]);
            trafficNetwork.reset();
            publishGraph();

            try {
                const session = await fetchSession(sessionId);
                if (loadAbortRef.current !== loadId) {
                    return;
                }

                trafficNetwork.setSource("history", session.label);
                trafficNetwork.remember(
                    `Loading ${session.totalPackets.toLocaleString()} packets`,
                );
                setSessionLoadProgress({
                    loaded: 0,
                    total: session.totalPackets,
                });
                publishGraph();

                const collected: StoredPacketRow[] = [];
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

                    collected.push(...batch);

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

                historyPacketsRef.current = collected;
                const startTime = collected[0]?.timestamp;
                const endTime = collected[collected.length - 1]?.timestamp;
                setHistoryPlayback({
                    offset: collected.length,
                    total: session.totalPackets,
                    label: session.label,
                    ...(startTime ? { startTime } : {}),
                    ...(endTime ? { endTime } : {}),
                });
                const bms = loadBookmarksForSession(sessionId);
                historyBookmarksRef.current = bms;
                setHistoryBookmarks(bms);

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

    const seekTo = useCallback(
        (targetOffset: number) => {
            if (viewMode !== "history" || !activeSessionId) {
                return;
            }
            const packets = historyPacketsRef.current;
            if (packets.length === 0) {
                return;
            }
            const clamped = Math.max(
                0,
                Math.min(Math.floor(targetOffset), packets.length),
            );
            trafficNetwork.resetData();
            if (clamped > 0) {
                const prefix = packets.slice(0, clamped);
                for (
                    let index = 0;
                    index < prefix.length;
                    index += HISTORY_INGEST_CHUNK
                ) {
                    trafficNetwork.ingestHistoricalBatch(
                        prefix.slice(index, index + HISTORY_INGEST_CHUNK),
                    );
                }
            }
            setHistoryPlayback((prev) =>
                prev ? { ...prev, offset: clamped } : null,
            );
            publishGraph();
        },
        [viewMode, activeSessionId, publishGraph],
    );

    const addBookmark = useCallback(
        (name: string) => {
            const trimmed = name.trim();
            if (!trimmed || !activeSessionId || !historyPlayback) {
                return;
            }
            const currentOffset = historyPlayback.offset;
            const existing = historyBookmarksRef.current.filter(
                (b) => b.name !== trimmed,
            );
            const updated = [
                ...existing,
                { name: trimmed, offset: currentOffset },
            ].sort((a, b) => a.offset - b.offset);
            historyBookmarksRef.current = updated;
            setHistoryBookmarks(updated);
            saveBookmarksForSession(activeSessionId, updated);
        },
        [activeSessionId, historyPlayback],
    );

    const removeBookmark = useCallback(
        (name: string) => {
            if (!activeSessionId) {
                return;
            }
            const updated = historyBookmarksRef.current.filter(
                (b) => b.name !== name,
            );
            historyBookmarksRef.current = updated;
            setHistoryBookmarks(updated);
            saveBookmarksForSession(activeSessionId, updated);
        },
        [activeSessionId],
    );

    const jumpToBookmark = useCallback(
        (name: string) => {
            const bm = historyBookmarksRef.current.find((b) => b.name === name);
            if (bm) {
                seekTo(bm.offset);
            }
        },
        [seekTo],
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

    return {
        graph,
        viewMode,
        activeSessionId,
        sessionLoadProgress,
        sessionsVersion,
        historyPlayback,
        historyBookmarks,
        loadSession,
        returnToLive,
        refreshSessions,
        seekTo,
        addBookmark,
        removeBookmark,
        jumpToBookmark,
    };
}
