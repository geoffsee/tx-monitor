import { useEffect, useState } from "react";
import { formatBytes } from "../layout";
import { fetchSessions } from "../lib/api";
import type {
    CaptureSessionSummary,
    HistoryPlayback,
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
    historyPlayback: HistoryPlayback | null;
    historyBookmarks: Array<{ name: string; offset: number }>;
    onLoadSession: (sessionId: string) => void;
    onReturnToLive: () => void;
    onSeek: (offset: number) => void;
    onAddBookmark: (name: string) => void;
    onRemoveBookmark: (name: string) => void;
    onJumpToBookmark: (name: string) => void;
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
    historyPlayback,
    historyBookmarks,
    onLoadSession,
    onReturnToLive,
    onSeek,
    onAddBookmark,
    onRemoveBookmark,
    onJumpToBookmark,
}: SessionHistoryProps) {
    const [sessions, setSessions] = useState<CaptureSessionSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [bookmarkName, setBookmarkName] = useState("");

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

            {viewMode === "history" &&
            activeSessionId &&
            !sessionLoadProgress &&
            historyPlayback &&
            historyPlayback.total > 0 ? (
                <div
                    style={{
                        marginTop: 8,
                        padding: "6px 8px",
                        background: "#0f1a22",
                        borderRadius: 4,
                        border: "1px solid #22313a",
                    }}
                >
                    <div
                        style={{
                            ...denseSubtleStyle,
                            marginBottom: 4,
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: 0,
                        }}
                    >
                        <span>Timeline</span>
                        <span>
                            {historyPlayback.total > 0
                                ? Math.round(
                                      (historyPlayback.offset /
                                          historyPlayback.total) *
                                          100,
                                  )
                                : 0}
                            %
                        </span>
                    </div>
                    {(historyPlayback.startTime || historyPlayback.endTime) && (
                        <div
                            style={{
                                ...denseSubtleStyle,
                                fontSize: 9,
                                marginBottom: 2,
                                marginTop: 0,
                            }}
                        >
                            {historyPlayback.startTime ?? "?"} →{" "}
                            {historyPlayback.endTime ?? "?"}
                        </div>
                    )}
                    <input
                        type="range"
                        min={0}
                        max={historyPlayback.total}
                        step={1}
                        value={historyPlayback.offset}
                        onChange={(e) => {
                            const v = Number.parseInt(e.target.value, 10);
                            if (!Number.isNaN(v)) onSeek(v);
                        }}
                        style={{ width: "100%", accentColor: "#7ce3b7" }}
                    />
                    <div
                        style={{
                            ...denseSubtleStyle,
                            fontSize: 10,
                            marginTop: 2,
                        }}
                    >
                        {historyPlayback.offset.toLocaleString()} /{" "}
                        {historyPlayback.total.toLocaleString()} pkts
                    </div>
                    <div style={{ marginTop: 6 }}>
                        <div
                            style={{
                                display: "flex",
                                gap: 4,
                                alignItems: "center",
                            }}
                        >
                            <input
                                type="text"
                                placeholder="name"
                                value={bookmarkName}
                                onChange={(e) =>
                                    setBookmarkName(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (
                                        e.key === "Enter" &&
                                        bookmarkName.trim()
                                    ) {
                                        onAddBookmark(bookmarkName);
                                        setBookmarkName("");
                                    }
                                }}
                                style={{
                                    flex: 1,
                                    fontSize: 10,
                                    padding: "2px 4px",
                                    background: "#132028",
                                    border: "1px solid #33414a",
                                    color: "inherit",
                                    borderRadius: 3,
                                }}
                            />
                            <button
                                type="button"
                                disabled={!bookmarkName.trim()}
                                onClick={() => {
                                    if (bookmarkName.trim()) {
                                        onAddBookmark(bookmarkName);
                                        setBookmarkName("");
                                    }
                                }}
                                style={{
                                    ...denseSubtleStyle,
                                    marginTop: 0,
                                    padding: "1px 6px",
                                    fontSize: 9,
                                    border: "1px solid #33414a",
                                    background: "#101d26",
                                    cursor: bookmarkName.trim()
                                        ? "pointer"
                                        : "default",
                                    borderRadius: 3,
                                }}
                            >
                                +mark
                            </button>
                        </div>
                        {historyBookmarks.length > 0 && (
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 4,
                                    marginTop: 4,
                                }}
                            >
                                {historyBookmarks.map((bm) => (
                                    <button
                                        key={bm.name}
                                        type="button"
                                        onClick={() =>
                                            onJumpToBookmark(bm.name)
                                        }
                                        title={`Jump to offset ${bm.offset}`}
                                        style={{
                                            fontSize: 9,
                                            background: "#1a2a33",
                                            padding: "1px 4px",
                                            borderRadius: 3,
                                            border: "1px solid #22313a",
                                            color: "inherit",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 2,
                                            cursor: "pointer",
                                            font: "inherit",
                                        }}
                                    >
                                        {bm.name}@{bm.offset}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveBookmark(bm.name);
                                            }}
                                            style={{
                                                cursor: "pointer",
                                                paddingLeft: 2,
                                                opacity: 0.6,
                                                background: "transparent",
                                                border: "none",
                                                color: "inherit",
                                                font: "inherit",
                                                padding: 0,
                                                lineHeight: 1,
                                            }}
                                            aria-label={`Remove ${bm.name} bookmark`}
                                        >
                                            ×
                                        </button>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
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
