import { useCallback, useEffect, useState } from "react";
import type { Selection } from "../types";

export function useSelection() {
    const [selection, setSelection] = useState<Selection | null>(null);

    const selectItem = useCallback((next: Selection) => {
        setSelection((current) =>
            current?.kind === next.kind && current.id === next.id ? null : next,
        );
    }, []);

    const clearSelection = useCallback(() => {
        setSelection(null);
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSelection(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return { selection, selectItem, clearSelection, setSelection };
}
