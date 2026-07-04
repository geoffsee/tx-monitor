import type { Selection, TrafficSnapshot } from "../types";
import { resolveApiUrl } from "./api";
import {
    buildCopilotContext,
    type CopilotChatMessage,
    type CopilotRequest,
    type CopilotResponse,
    type CopilotStatus,
    type CopilotValidationResult,
} from "./copilot";

type ErrorResponse = {
    error?: string;
};

type AskCopilotParams = {
    prompt: string;
    history: CopilotChatMessage[];
    graph: TrafficSnapshot;
    selection: Selection | null;
};

async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

export async function askCopilot(params: AskCopilotParams): Promise<string> {
    const payload: CopilotRequest = {
        prompt: params.prompt,
        history: params.history,
        context: buildCopilotContext(params.graph, params.selection),
    };
    const response = await fetch(resolveApiUrl("/api/copilot"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    const body = await readJson(response);

    if (!response.ok) {
        const error =
            body && typeof body === "object" && "error" in body
                ? (body as ErrorResponse).error
                : null;
        throw new Error(error || `Copilot request failed (${response.status})`);
    }

    const answer = (body as CopilotResponse | null)?.answer?.trim();
    if (!answer) {
        throw new Error("Codex returned an empty response.");
    }

    return answer;
}

type StatusResponse = CopilotStatus & {
    validation?: CopilotValidationResult;
};

export async function fetchCopilotStatus(
    validate = false,
): Promise<CopilotStatus & { validation?: CopilotValidationResult }> {
    const url = resolveApiUrl(
        validate ? "/api/copilot/status?validate=true" : "/api/copilot/status",
    );
    const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
    });
    const body = await readJson(response);
    if (!response.ok) {
        const error =
            body && typeof body === "object" && "error" in body
                ? (body as ErrorResponse).error
                : null;
        throw new Error(error || `Copilot status failed (${response.status})`);
    }
    return (
        (body as StatusResponse) ?? {
            authMode: "local",
            hasCredentials: false,
            model: "unknown",
            timeoutMs: 120000,
            ready: false,
        }
    );
}

export async function validateCopilot(): Promise<{
    status: CopilotStatus;
    validation: CopilotValidationResult;
}> {
    const result = await fetchCopilotStatus(true);
    if (!result.validation) {
        return {
            status: result,
            validation: {
                success: false,
                message: "No validation result returned.",
            },
        };
    }
    return { status: result, validation: result.validation };
}
