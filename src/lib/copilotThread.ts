import type { CopilotMessage } from "./copilot";

let currentMessages: CopilotMessage[] = [];

export function getCopilotMessages(): CopilotMessage[] {
    return currentMessages.slice();
}

export function setCopilotMessages(messages: CopilotMessage[]): void {
    currentMessages = messages.slice();
}
