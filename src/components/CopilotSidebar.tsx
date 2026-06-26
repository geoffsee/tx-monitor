import type React from "react";
import {
    type FormEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {
    COPILOT_SUGGESTIONS,
    COPILOT_WELCOME,
    type CopilotMessage,
    type CopilotStatus,
    createMessage,
} from "../lib/copilot";
import {
    askCopilot,
    fetchCopilotStatus,
    validateCopilot,
} from "../lib/copilotClient";
import type { Selection, TrafficSnapshot } from "../types";
import {
    anomalyBadgeStyle,
    copilotBubbleAssistantStyle,
    copilotBubbleUserStyle,
    copilotInputStyle,
    copilotMessagesStyle,
    copilotSendButtonStyle,
    copilotSuggestionStyle,
    denseAnomalyRowStyle,
    panelTitleStyle,
    sidePanelStyle,
} from "./styles";

type CopilotSidebarProps = {
    graph: TrafficSnapshot;
    selection: Selection | null;
    isCompact: boolean;
};

type Tab = "copilot" | "anomalies";

export function CopilotSidebar({
    graph,
    selection,
    isCompact,
}: CopilotSidebarProps) {
    const [activeTab, setActiveTab] = useState<Tab>("copilot");
    const [messages, setMessages] = useState<CopilotMessage[]>([
        COPILOT_WELCOME,
    ]);
    const [draft, setDraft] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [copilotStatus, setCopilotStatus] = useState<CopilotStatus | null>(
        null,
    );
    const [validation, setValidation] = useState<{
        success: boolean;
        message: string;
    } | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });

    useEffect(() => {
        let cancelled = false;
        fetchCopilotStatus(false)
            .then((s) => {
                if (!cancelled) {
                    setCopilotStatus(s);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCopilotStatus({
                        authMode: "local",
                        hasCredentials: false,
                        model: "unknown",
                        timeoutMs: 120000,
                        ready: false,
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const submitPrompt = useCallback(
        async (prompt: string) => {
            const trimmed = prompt.trim();
            if (!trimmed || isLoading) {
                return;
            }

            const userMessage = createMessage("user", trimmed);
            const history = messages
                .filter((message) => message.id !== COPILOT_WELCOME.id)
                .map((message) => ({
                    role: message.role,
                    content: message.content,
                }));

            setMessages((current) => [...current, userMessage]);
            setDraft("");
            setIsLoading(true);

            try {
                const answer = await askCopilot({
                    prompt: trimmed,
                    history,
                    graph,
                    selection,
                });
                setMessages((current) => [
                    ...current,
                    createMessage("assistant", answer),
                ]);
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : "Copilot request failed.";
                const lower = message.toLowerCase();
                const guidance =
                    lower.includes("key") ||
                    lower.includes("auth") ||
                    lower.includes("credential") ||
                    lower.includes("login") ||
                    lower.includes("timeout") ||
                    lower.includes("codex") ||
                    lower.includes("empty") ||
                    lower.includes("failed")
                        ? " — See auth status and Validate button above for setup guidance."
                        : "";
                setMessages((current) => [
                    ...current,
                    createMessage("assistant", message + guidance),
                ]);
            } finally {
                setIsLoading(false);
            }
        },
        [graph, isLoading, messages, selection],
    );

    const handleValidate = useCallback(async () => {
        if (isValidating || isLoading) {
            return;
        }
        setIsValidating(true);
        setValidation(null);
        try {
            const { status, validation: v } = await validateCopilot();
            setCopilotStatus(status);
            setValidation(v);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Validation request failed.";
            setValidation({ success: false, message });
        } finally {
            setIsValidating(false);
        }
    }, [isValidating, isLoading]);

    const handleSubmit = useCallback(
        (event: FormEvent) => {
            event.preventDefault();
            void submitPrompt(draft);
        },
        [draft, submitPrompt],
    );

    const tabButtonStyle = (isActive: boolean): React.CSSProperties => ({
        flex: 1,
        padding: "8px 4px",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        background: isActive ? "#132028" : "transparent",
        color: isActive ? "#66aec4" : "#7f99a7",
        border: "none",
        borderBottom: isActive ? "2px solid #66aec4" : "2px solid transparent",
        cursor: "pointer",
        transition: "all 0.2s ease",
    });

    return (
        <aside
            style={{
                ...sidePanelStyle,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minWidth: 0,
                width: "100%",
                maxWidth: "100%",
                height: isCompact ? 320 : "calc(100vh - 32px)",
                maxHeight: isCompact ? 320 : "calc(100vh - 32px)",
                overflow: "hidden",
                boxSizing: "border-box",
                padding: 0,
            }}
        >
            <nav
                style={{
                    display: "flex",
                    borderBottom: "1px solid #1a2d3a",
                    background: "#0b141b",
                }}
            >
                <button
                    type="button"
                    style={tabButtonStyle(activeTab === "copilot")}
                    onClick={() => setActiveTab("copilot")}
                >
                    Copilot
                </button>
                <button
                    type="button"
                    style={tabButtonStyle(activeTab === "anomalies")}
                    onClick={() => setActiveTab("anomalies")}
                >
                    Anomalies{" "}
                    {graph.anomalies.length > 0
                        ? `(${graph.anomalies.length})`
                        : ""}
                </button>
            </nav>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    flex: 1,
                    minHeight: 0,
                    padding: 12,
                }}
            >
                {activeTab === "copilot" ? (
                    <>
                        <header style={{ flexShrink: 0 }}>
                            <div style={panelTitleStyle}>Copilot</div>
                            <p
                                style={{
                                    margin: "6px 0 0",
                                    fontSize: 12,
                                    lineHeight: 1.45,
                                    color: "#7f99a7",
                                }}
                            >
                                Ask about flows, hosts, and patterns in the
                                current capture.
                            </p>
                            <div
                                style={{
                                    marginTop: 8,
                                    padding: "6px 8px",
                                    borderRadius: 6,
                                    border: "1px solid #1a2d3a",
                                    background: "#0f1921",
                                    fontSize: 11,
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        flexWrap: "wrap",
                                    }}
                                >
                                    <span style={{ color: "#7f99a7" }}>
                                        Auth:
                                    </span>
                                    <span style={{ fontFamily: "monospace" }}>
                                        {copilotStatus
                                            ? copilotStatus.authMode
                                            : "…"}
                                    </span>
                                    <span
                                        style={{
                                            color: copilotStatus?.ready
                                                ? "#7ce3b7"
                                                : "#e6a07c",
                                        }}
                                    >
                                        {copilotStatus
                                            ? copilotStatus.ready
                                                ? copilotStatus.authMode ===
                                                  "local"
                                                    ? "• ready (local creds)"
                                                    : "• key present"
                                                : "• not ready"
                                            : "• checking…"}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void handleValidate()}
                                        disabled={isValidating || isLoading}
                                        style={{
                                            marginLeft: "auto",
                                            padding: "2px 8px",
                                            fontSize: 10,
                                            borderRadius: 4,
                                            border: "1px solid #223849",
                                            background: "#132028",
                                            color: "#66aec4",
                                            cursor:
                                                isValidating || isLoading
                                                    ? "not-allowed"
                                                    : "pointer",
                                        }}
                                    >
                                        {isValidating
                                            ? "Validating…"
                                            : "Validate"}
                                    </button>
                                </div>
                                {validation ? (
                                    <div
                                        style={{
                                            marginTop: 4,
                                            color: validation.success
                                                ? "#7ce3b7"
                                                : "#e6a07c",
                                            fontSize: 10,
                                        }}
                                    >
                                        {validation.message}
                                    </div>
                                ) : null}
                                <div
                                    style={{
                                        marginTop: 4,
                                        color: "#5c7889",
                                        fontSize: 10,
                                        lineHeight: 1.3,
                                    }}
                                >
                                    Modes: <code>local</code> (Codex login) or{" "}
                                    <code>api-key</code> (OPENAI_API_KEY). Set
                                    TXMON_CODEX_AUTH and/or use .env.copilot.
                                    Validation pings without exposing secrets.
                                </div>
                            </div>
                        </header>

                        <div style={copilotMessagesStyle}>
                            {messages.map((message) => (
                                <div
                                    key={message.id}
                                    style={
                                        message.role === "user"
                                            ? copilotBubbleUserStyle
                                            : copilotBubbleAssistantStyle
                                    }
                                >
                                    {message.content}
                                </div>
                            ))}
                            {isLoading ? (
                                <div style={copilotBubbleAssistantStyle}>
                                    Thinking…
                                </div>
                            ) : null}
                            <div ref={messagesEndRef} />
                        </div>

                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 6,
                                flexShrink: 0,
                            }}
                        >
                            {COPILOT_SUGGESTIONS.map((suggestion) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    disabled={isLoading}
                                    onClick={() =>
                                        void submitPrompt(suggestion)
                                    }
                                    style={{
                                        ...copilotSuggestionStyle,
                                        opacity: isLoading ? 0.5 : 1,
                                        cursor: isLoading
                                            ? "not-allowed"
                                            : "pointer",
                                    }}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>

                        <form
                            onSubmit={handleSubmit}
                            style={{
                                display: "flex",
                                gap: 8,
                                flexShrink: 0,
                                minWidth: 0,
                            }}
                        >
                            <input
                                type="text"
                                value={draft}
                                onChange={(event) =>
                                    setDraft(event.target.value)
                                }
                                placeholder="Ask about this capture…"
                                disabled={isLoading}
                                style={{
                                    ...copilotInputStyle,
                                    opacity: isLoading ? 0.6 : 1,
                                }}
                            />
                            <button
                                type="submit"
                                disabled={isLoading || !draft.trim()}
                                style={{
                                    ...copilotSendButtonStyle,
                                    opacity:
                                        isLoading || !draft.trim() ? 0.5 : 1,
                                    cursor:
                                        isLoading || !draft.trim()
                                            ? "not-allowed"
                                            : "pointer",
                                }}
                            >
                                {isLoading ? "…" : "Send"}
                            </button>
                        </form>
                    </>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            flex: 1,
                            minHeight: 0,
                        }}
                    >
                        <header style={{ flexShrink: 0 }}>
                            <div style={panelTitleStyle}>Anomalies</div>
                            <p
                                style={{
                                    margin: "6px 0 0",
                                    fontSize: 12,
                                    lineHeight: 1.45,
                                    color: "#7f99a7",
                                }}
                            >
                                Heuristic-based alerts for unusual traffic
                                patterns.
                            </p>
                        </header>

                        <div
                            style={{
                                flex: 1,
                                overflow: "auto",
                                display: "grid",
                                gap: 8,
                                alignContent: "start",
                            }}
                        >
                            {graph.anomalies.length === 0 ? (
                                <div
                                    style={{
                                        padding: 24,
                                        textAlign: "center",
                                        color: "#7f99a7",
                                        fontSize: 13,
                                    }}
                                >
                                    No anomalies detected.
                                </div>
                            ) : (
                                graph.anomalies.map((anomaly) => (
                                    <div
                                        key={anomaly.id}
                                        style={{
                                            ...denseAnomalyRowStyle,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 4,
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "start",
                                            }}
                                        >
                                            <div
                                                style={anomalyBadgeStyle(
                                                    anomaly.severity,
                                                )}
                                            >
                                                {anomaly.type}
                                            </div>
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    color: "#5c7889",
                                                }}
                                            >
                                                {new Date(
                                                    anomaly.timestamp,
                                                ).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                fontWeight: 600,
                                                fontSize: 13,
                                                color: "#d9e6ec",
                                            }}
                                        >
                                            {anomaly.description}
                                        </div>
                                        {anomaly.flowId && (
                                            <div
                                                style={{
                                                    fontSize: 11,
                                                    color: "#66aec4",
                                                    fontFamily: "monospace",
                                                }}
                                            >
                                                Flow: {anomaly.flowId}
                                            </div>
                                        )}
                                        {anomaly.hostId && (
                                            <div
                                                style={{
                                                    fontSize: 11,
                                                    color: "#66aec4",
                                                    fontFamily: "monospace",
                                                }}
                                            >
                                                Host: {anomaly.hostId}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </aside>
    );
}
