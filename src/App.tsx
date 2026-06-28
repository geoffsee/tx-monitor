import { useCallback } from "react";
import { CopilotSidebar } from "./components/CopilotSidebar";
import { Sidebar } from "./components/Sidebar";
import { TrafficGraph } from "./components/TrafficGraph";
import { useCompactLayout } from "./hooks/useCompactLayout";
import { useSelection } from "./hooks/useSelection";
import { useTrafficFeed } from "./hooks/useTrafficFeed";

export default function App() {
    const {
        graph,
        viewMode,
        activeSessionId,
        sessionLoadProgress,
        sessionsVersion,
        loadSession,
        returnToLive,
        sensitivity,
        setSensitivity,
    } = useTrafficFeed();
    const isCompact = useCompactLayout();
    const { selection, selectItem, clearSelection, setSelection } =
        useSelection();

    const handleSelectHost = useCallback(
        (id: string) => selectItem({ kind: "host", id }),
        [selectItem],
    );

    const handleSelectFlow = useCallback(
        (id: string) => selectItem({ kind: "flow", id }),
        [selectItem],
    );

    const handleSelectPacket = useCallback(
        (id: string) => selectItem({ kind: "packet", id }),
        [selectItem],
    );

    const handleSidebarSelectFlow = useCallback(
        (flowId: string) => selectItem({ kind: "flow", id: flowId }),
        [selectItem],
    );

    const handleNavigateToFlow = useCallback(
        (flowId: string) => setSelection({ kind: "flow", id: flowId }),
        [setSelection],
    );

    return (
        <main
            style={{
                minHeight: "100vh",
                padding: 16,
                background: "linear-gradient(180deg, #081118 0%, #0a141c 100%)",
                color: "#d9e6ec",
                fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif',
                boxSizing: "border-box",
                width: "100%",
                maxWidth: "100vw",
                overflow: "hidden",
            }}
        >
            <section
                style={{
                    display: "grid",
                    gridTemplateColumns: isCompact
                        ? "minmax(0, 1fr)"
                        : "minmax(0, 300px) minmax(0, 1fr) minmax(0, 340px)",
                    gap: 14,
                    minHeight: isCompact ? "auto" : "calc(100vh - 32px)",
                    maxHeight: isCompact ? undefined : "calc(100vh - 32px)",
                    width: "100%",
                    overflow: "hidden",
                }}
            >
                <CopilotSidebar
                    graph={graph}
                    selection={selection}
                    isCompact={isCompact}
                    sensitivity={sensitivity}
                    onSetSensitivity={setSensitivity}
                />
                <TrafficGraph
                    graph={graph}
                    selection={selection}
                    isCompact={isCompact}
                    onSelectHost={handleSelectHost}
                    onSelectFlow={handleSelectFlow}
                    onClearSelection={clearSelection}
                />
                <Sidebar
                    graph={graph}
                    selection={selection}
                    isCompact={isCompact}
                    viewMode={viewMode}
                    activeSessionId={activeSessionId}
                    sessionLoadProgress={sessionLoadProgress}
                    sessionsVersion={sessionsVersion}
                    onLoadSession={loadSession}
                    onReturnToLive={returnToLive}
                    onSelectFlow={handleSidebarSelectFlow}
                    onSelectPacket={handleSelectPacket}
                    onNavigateToFlow={handleNavigateToFlow}
                    onClearSelection={clearSelection}
                />
            </section>
        </main>
    );
}
