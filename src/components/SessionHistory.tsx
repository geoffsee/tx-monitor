import { useEffect, useState } from "react";
import { formatBytes } from "../layout";
import { fetchSessions } from "../lib/api";
import type {
    CaptureSessionSummary,
    SessionLoadProgress,
    TrafficViewMode,
} from "../types";
import {
    denseFeedRowStyle,
    denseStatusRowStyle,
    denseSubtleStyle,
    panelTitleStyle,
    selectedRowStyle,
    statusBadgeStyle,
} from "./styles";

type SessionHistoryProps = {
    viewMode: TrafficViewMode;
    activeSessionId: string | null;
    sessionLoadProgress: SessionLoadProgress | null;
    sessionsVersion: number;
    onLoadSession: (sessionId: string) => void;
    onReturnToLive: () => void;
};

function formatSessionTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function sessionStatus(session: CaptureSessionSummary): string {
    return session.endedAt ? "saved" : "active";
}

export function SessionHistory({
    viewMode,
    activeSessionId,
    sessionLoadProgress,
    sessionsVersion,
    onLoadSession,
    onReturnToLive,
}: SessionHistoryProps) {
    const [sessions, setSessions] = useState<CaptureSessionSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void sessionsVersion;
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const rows = await fetchSessions();
                if (!cancelled) {
                    setSessions(rows);
                }
            } catch (loadError) {
                if (!cancelled) {
                    const message =
                        loadError instanceof Error
                            ? loadError.message
                            : "Failed to load sessions";
                    setError(message);
                    setSessions([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [sessionsVersion]);

    const progressPercent =
        sessionLoadProgress && sessionLoadProgress.total > 0
            ? Math.round(
                  (sessionLoadProgress.loaded / sessionLoadProgress.total) *
                      100,
              )
            : 0;

    return (
        <section style={{ flexShrink: 0, minWidth: 0 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                }}
            >
                <div style={panelTitleStyle}>Session History</div>
                <button
                    type="button"
                    onClick={onReturnToLive}
                    disabled={viewMode === "live" && !sessionLoadProgress}
                    style={{
                        ...denseSubtleStyle,
                        marginTop: 0,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #33414a",
                        background: viewMode === "live" ? "#132028" : "#101d26",
                        color: viewMode === "live" ? "#7ce3b7" : "#d9e6ec",
                        cursor:
                            viewMode === "live" && !sessionLoadProgress
                                ? "default"
                                : "pointer",
                        font: "inherit",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                    }}
                >
                    Live
                </button>
            </div>

            {sessionLoadProgress ? (
                <div style={{ ...denseFeedRowStyle, marginTop: 8 }}>
                    Loading session · {progressPercent}% (
                    {sessionLoadProgress.loaded.toLocaleString()} /{" "}
                    {sessionLoadProgress.total.toLocaleString()})
                </div>
            ) : null}

            <div
                style={{
                    display: "grid",
                    gap: 6,
                    marginTop: 8,
                    maxHeight: 180,
                    overflow: "auto",
                }}
            >
                {loading ? (
                    <div style={denseFeedRowStyle}>Loading sessions…</div>
                ) : error ? (
                    <div style={denseFeedRowStyle}>{error}</div>
                ) : sessions.length === 0 ? (
                    <div style={denseFeedRowStyle}>No saved sessions yet</div>
                ) : (
                    sessions.map((session) => {
                        const selected = activeSessionId === session.id;
                        const active = sessionStatus(session) === "active";
                        return (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => onLoadSession(session.id)}
                                disabled={Boolean(sessionLoadProgress)}
                                style={{
                                    ...denseStatusRowStyle,
                                    cursor: sessionLoadProgress
                                        ? "wait"
                                        : "pointer",
                                    width: "100%",
                                    textAlign: "left",
                                    font: "inherit",
                                    color: "inherit",
                                    opacity: sessionLoadProgress ? 0.7 : 1,
                                    ...(selected ? selectedRowStyle : {}),
                                }}
                            >
                                <div style={{ minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontWeight: 700,
                                            fontSize: 13,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {session.label}
                                    </div>
                                    <div style={denseSubtleStyle}>
                                        {formatSessionTime(session.startedAt)} ·{" "}
                                        {session.totalPackets.toLocaleString()}{" "}
                                        pkts · {formatBytes(session.totalBytes)}
                                        {session.hostname
                                            ? ` · ${session.hostname}`
                                            : ""}
                                    </div>
                                    {(session.cmdline &&
                                        session.cmdline !== session.label) ||
                                    session.notes ||
                                    session.tags ? (
                                        <div
                                            style={{
                                                ...denseSubtleStyle,
                                                fontSize: 10,
                                                opacity: 0.75,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                            title={
                                                session.cmdline ||
                                                session.notes ||
                                                undefined
                                            }
                                        >
                                            {session.cmdline &&
                                            session.cmdline !== session.label
                                                ? session.cmdline
                                                : null}
                                            {session.notes
                                                ? `${
                                                      session.cmdline &&
                                                      session.cmdline !==
                                                          session.label
                                                          ? " · "
                                                          : ""
                                                  }note`
                                                : null}
                                            {session.tags
                                                ? `${
                                                      session.notes ||
                                                      (
                                                          session.cmdline &&
                                                              session.cmdline !==
                                                                  session.label
                                                      )
                                                          ? " · "
                                                          : ""
                                                  }tags`
                                                : null}
                                        </div>
                                    ) : null}
                                </div>
                                <div style={statusBadgeStyle(active)}>
                                    {session.mode}
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </section>
    );
}
