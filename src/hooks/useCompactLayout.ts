import { useEffect, useState } from "react";

const COMPACT_BREAKPOINT = 1220;

export function useCompactLayout() {
    const [isCompact, setIsCompact] = useState(
        () => window.innerWidth < COMPACT_BREAKPOINT,
    );

    useEffect(() => {
        const onResize = () =>
            setIsCompact(window.innerWidth < COMPACT_BREAKPOINT);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return isCompact;
}
