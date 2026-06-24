# Source Map

Use this map before touching a subsystem. Prefer the smallest relevant surface rather than reading the whole repository.

## Entry points

- `bin/tx-monitor.js`: CLI binary entry.
- `src/server.ts`: Bun server, HTTP routes, WebSocket setup, static serving, live capture, file replay, and persistence coordination.
- `src/index.tsx`: browser entrypoint.
- `src/App.tsx`: top-level React app composition.

## Capture and streaming

- `src/lib/tcpdumpParser.ts`: tcpdump line parser.
- `src/ws.ts`: WebSocket behavior.
- `src/hooks/useTrafficFeed.ts`: browser traffic stream consumption.
- `src/lib/lsofCollector.ts` and `src/lib/processInfo.ts`: process enrichment.

## Graph and UI

- `src/lib/trafficNetwork.ts`: network state model.
- `src/lib/graph.ts`: graph derivation.
- `src/layout.ts`: host positioning.
- `src/components/TrafficGraph.tsx`: graph rendering.
- `src/components/HostNode.tsx` and `src/components/FlowEdge.tsx`: graph primitives.
- `src/components/Sidebar.tsx`, `DetailPanel.tsx`, `SessionHistory.tsx`, and `CopilotSidebar.tsx`: supporting UI.
- `src/hooks/useCompactLayout.ts`, `useFitGraphView.ts`, and `useSelection.ts`: UI behavior hooks.

## Persistence and APIs

- `src/db/schema.ts`: Drizzle schema.
- `src/db/client.ts`: SQLite client setup.
- `src/db/store.ts`: session and packet store.
- `drizzle/`: migrations and metadata.
- `src/lib/api.ts`: browser API helpers.

## Copilot and safety

- `src/lib/copilot.ts`: shared copilot types/logic.
- `src/lib/copilotClient.ts`: browser copilot client.
- `src/lib/copilotServer.ts`: backend Codex SDK integration.
- `src/lib/secrets.ts`: secret handling.
- `src/lib/anomaly.ts`: anomaly cues.

## Tests

- Parser: `src/lib/tcpdumpParser.test.ts`.
- Graph/layout/state: `src/lib/graph.test.ts`, `src/layout.test.ts`.
- Persistence: `src/db/store.test.ts`.
- Copilot/secrets: `src/lib/copilot.test.ts`, `src/lib/copilotClient.ts`, `src/lib/copilotServer.test.ts`, `src/lib/secrets.test.ts`.
- Process enrichment: `src/lib/lsofCollector.test.ts`.
