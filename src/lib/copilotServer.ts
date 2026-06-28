import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import { resolveCodexModel, resolveCodexTimeoutMs } from "./config";
import {
    COPILOT_SYSTEM_PROMPT,
    type CopilotChatMessage,
    type CopilotRequest,
    type CopilotResponse,
} from "./copilot";
import { loadClientSecrets } from "./secrets";

const CODEX_AUTH_MODE =
    process.env.TXMON_CODEX_AUTH?.trim() === "api-key" ? "api-key" : "local";
const COPILOT_LOG_PREFIX = "[copilot]";
const API_KEY_ENV_KEYS = new Set(["CODEX_API_KEY", "OPENAI_API_KEY"]);
let copilotRequestCounter = 0;

export class CopilotRequestError extends Error {
    override name = "CopilotRequestError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextCopilotRequestId() {
    copilotRequestCounter += 1;
    return `copilot-${Date.now().toString(36)}-${copilotRequestCounter}`;
}

function logCopilot(
    requestId: string,
    event: string,
    details: Record<string, unknown> = {},
) {
    console.log(COPILOT_LOG_PREFIX, requestId, event, details);
}

function warnCopilot(
    requestId: string,
    event: string,
    details: Record<string, unknown> = {},
) {
    console.warn(COPILOT_LOG_PREFIX, requestId, event, details);
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function parseHistory(value: unknown): CopilotChatMessage[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item): item is CopilotChatMessage => {
            if (!isRecord(item)) {
                return false;
            }
            return (
                (item.role === "user" || item.role === "assistant") &&
                typeof item.content === "string"
            );
        })
        .slice(-12);
}

export function parseCopilotRequest(value: unknown): CopilotRequest {
    if (!isRecord(value)) {
        throw new CopilotRequestError("Expected a JSON object.");
    }
    if (typeof value.prompt !== "string") {
        throw new CopilotRequestError("Expected prompt to be a string.");
    }
    if (!isRecord(value.context)) {
        throw new CopilotRequestError("Expected copilot context.");
    }

    return {
        prompt: value.prompt,
        history: parseHistory(value.history),
        context: value.context as CopilotRequest["context"],
    };
}

function formatHistory(history: CopilotChatMessage[]) {
    if (history.length === 0) {
        return "No prior messages.";
    }

    return history
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n\n");
}

export function buildCodexCopilotPrompt(params: CopilotRequest): string {
    return `${COPILOT_SYSTEM_PROMPT}

You are running inside the tx-monitor backend through the Codex SDK. Do not run shell commands, inspect files, edit files, use web search, or request approvals. Treat the capture context below as the complete source of truth.

Capture context (JSON):
${JSON.stringify(params.context, null, 2)}

Conversation history:
${formatHistory(params.history)}

User question:
${params.prompt.trim()}

Return only the concise answer for the user.`;
}

function createThreadOptions(workingDirectory: string): ThreadOptions {
    const model = resolveCodexModel();
    return {
        ...(model ? { model } : {}),
        workingDirectory,
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        webSearchEnabled: true,
        modelReasoningEffort: "medium",
        networkAccessEnabled: true,
        webSearchMode: "live",
    };
}

function localAuthEnv() {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !API_KEY_ENV_KEYS.has(key)) {
            env[key] = value;
        }
    }
    return env;
}

function createCodexClient() {
    if (CODEX_AUTH_MODE === "local") {
        return {
            codex: new Codex({ env: localAuthEnv() }),
            authSource: "local-codex-auth",
        };
    }

    const apiKey = loadClientSecrets().OPENAI_API_KEY?.trim();
    if (!apiKey) {
        return {
            codex: new Codex({ env: localAuthEnv() }),
            authSource: "local-codex-auth (OPENAI_API_KEY missing)",
        };
    }

    return {
        codex: new Codex({ apiKey }),
        authSource: "OPENAI_API_KEY",
    };
}

export async function askCopilotWithCodex(
    params: CopilotRequest,
): Promise<CopilotResponse> {
    const requestId = nextCopilotRequestId();
    const prompt = params.prompt.trim();
    if (!prompt) {
        logCopilot(requestId, "empty_prompt");
        return {
            answer: "Ask a question about the capture, or pick one of the suggestions below.",
            threadId: null,
        };
    }

    const startedAt = performance.now();
    const contextJson = JSON.stringify(params.context);
    const workingDirectory = await mkdtemp(join(tmpdir(), "txmon-codex-"));
    const controller = new AbortController();
    const timeoutMs = resolveCodexTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const { codex, authSource } = createCodexClient();
        logCopilot(requestId, "start", {
            model: resolveCodexModel(),
            authMode: CODEX_AUTH_MODE,
            authSource,
            timeoutMs: resolveCodexTimeoutMs(),
            promptChars: prompt.length,
            historyMessages: params.history.length,
            contextChars: contextJson.length,
            totalPackets: params.context.summary?.totalPackets,
            hostCount: params.context.summary?.hostCount,
            flowCount: params.context.summary?.flowCount,
            anomalies: params.context.anomalies?.length,
        });

        const thread = codex.startThread(createThreadOptions(workingDirectory));
        const result = await thread.run(buildCodexCopilotPrompt(params), {
            signal: controller.signal,
        });
        const answer = result.finalResponse.trim();

        if (!answer) {
            throw new Error("Codex returned an empty response.");
        }

        logCopilot(requestId, "complete", {
            threadId: thread.id,
            durationMs: Math.round(performance.now() - startedAt),
            answerChars: answer.length,
            inputTokens: result.usage?.input_tokens,
            outputTokens: result.usage?.output_tokens,
            reasoningOutputTokens: result.usage?.reasoning_output_tokens,
        });

        return {
            answer,
            threadId: thread.id,
        };
    } catch (error) {
        if (controller.signal.aborted) {
            warnCopilot(requestId, "timeout", {
                durationMs: Math.round(performance.now() - startedAt),
                timeoutMs: resolveCodexTimeoutMs(),
            });
            throw new Error("Codex copilot request timed out.");
        }
        warnCopilot(requestId, "failed", {
            durationMs: Math.round(performance.now() - startedAt),
            error: errorMessage(error),
        });
        throw error;
    } finally {
        clearTimeout(timeout);
        await rm(workingDirectory, { recursive: true, force: true }).catch(
            (error: unknown) => {
                warnCopilot(requestId, "cleanup_failed", {
                    error: errorMessage(error),
                });
            },
        );
    }
}
