import {
    type FormEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import { fetchSecrets } from "../lib/api";
import {
    askCopilot,
    COPILOT_SUGGESTIONS,
    COPILOT_WELCOME,
    type CopilotMessage,
    createMessage,
} from "../lib/copilot";
import type { Selection, TrafficSnapshot } from "../types";
import {
    copilotBubbleAssistantStyle,
    copilotBubbleUserStyle,
    copilotInputStyle,
    copilotMessagesStyle,
    copilotSendButtonStyle,
    copilotSuggestionStyle,
    panelTitleStyle,
    sidePanelStyle,
} from "./styles";

type CopilotSidebarProps = {
    graph: TrafficSnapshot;
    selection: Selection | null;
    isCompact: boolean;
};

export function CopilotSidebar({
    graph,
    selection,
    isCompact,
}: CopilotSidebarProps) {
    const [messages, setMessages] = useState<CopilotMessage[]>([
        COPILOT_WELCOME,
    ]);
    const [draft, setDraft] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [configError, setConfigError] = useState<string | null>(null);
    const [isLoadingConfig, setIsLoadingConfig] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const hasApiKey = apiKey.trim().length > 0;

    useEffect(() => {
        let ignore = false;

        async function loadSecrets() {
            try {
                const secrets = await fetchSecrets();
                if (!ignore) {
                    setApiKey(secrets.OPENAI_API_KEY ?? "");
                    setConfigError(null);
                }
            } catch (error) {
                if (!ignore) {
                    setApiKey("");
                    setConfigError(
                        error instanceof Error
                            ? error.message
                            : "Failed to load server config.",
                    );
                }
            } finally {
                if (!ignore) {
                    setIsLoadingConfig(false);
                }
            }
        }

        void loadSecrets();

        return () => {
            ignore = true;
        };
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });

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
                    apiKey,
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
                setMessages((current) => [
                    ...current,
                    createMessage("assistant", message),
                ]);
            } finally {
                setIsLoading(false);
            }
        },
        [apiKey, graph, isLoading, messages, selection],
    );

    const handleSubmit = useCallback(
        (event: FormEvent) => {
            event.preventDefault();
            void submitPrompt(draft);
        },
        [draft, submitPrompt],
    );

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
            }}
        >
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
                    Ask about flows, hosts, and patterns in the current capture.
                </p>
            </header>

            <label
                style={{
                    display: "grid",
                    gap: 6,
                    flexShrink: 0,
                }}
            >
                <span
                    style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "#7b9aaa",
                    }}
                >
                    OpenAI config
                </span>
                <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                        isLoadingConfig
                            ? "Loading OPENAI_API_KEY"
                            : "OPENAI_API_KEY"
                    }
                    autoComplete="off"
                    disabled={isLoadingConfig}
                    style={{
                        ...copilotInputStyle,
                        opacity: isLoadingConfig ? 0.6 : 1,
                    }}
                />
                {configError || hasApiKey ? (
                    <span
                        style={{
                            fontSize: 11,
                            lineHeight: 1.35,
                            color: hasApiKey ? "#7ce3b7" : "#dca96e",
                        }}
                    >
                        {hasApiKey ? "Loaded from server config" : configError}
                    </span>
                ) : null}
            </label>

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
                    <div style={copilotBubbleAssistantStyle}>Thinking…</div>
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
                        disabled={isLoading || isLoadingConfig || !hasApiKey}
                        onClick={() => void submitPrompt(suggestion)}
                        style={{
                            ...copilotSuggestionStyle,
                            opacity:
                                isLoading || isLoadingConfig || !hasApiKey
                                    ? 0.5
                                    : 1,
                            cursor:
                                isLoading || isLoadingConfig || !hasApiKey
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
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                        isLoadingConfig
                            ? "Loading server config"
                            : hasApiKey
                              ? "Ask about this capture…"
                              : "OPENAI_API_KEY missing"
                    }
                    disabled={isLoading || isLoadingConfig || !hasApiKey}
                    style={{
                        ...copilotInputStyle,
                        opacity:
                            isLoading || isLoadingConfig || !hasApiKey
                                ? 0.6
                                : 1,
                    }}
                />
                <button
                    type="submit"
                    disabled={
                        isLoading ||
                        isLoadingConfig ||
                        !hasApiKey ||
                        !draft.trim()
                    }
                    style={{
                        ...copilotSendButtonStyle,
                        opacity:
                            isLoading ||
                            isLoadingConfig ||
                            !hasApiKey ||
                            !draft.trim()
                                ? 0.5
                                : 1,
                        cursor:
                            isLoading ||
                            isLoadingConfig ||
                            !hasApiKey ||
                            !draft.trim()
                                ? "not-allowed"
                                : "pointer",
                    }}
                >
                    {isLoading ? "…" : "Send"}
                </button>
            </form>
        </aside>
    );
}
