import type { Selection } from "../types";

export function isRowSelected(
    selection: Selection | null,
    kind: Selection["kind"],
    id: string,
): boolean {
    return selection?.kind === kind && selection.id === id;
}
