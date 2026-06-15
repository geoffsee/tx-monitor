import type { Selection, TrafficSnapshot } from "../types";
import { resolveApiUrl } from "./api";
import {
    buildCopilotContext,
    type CopilotChatMessage,
    type CopilotRequest,
    type CopilotResponse,
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
