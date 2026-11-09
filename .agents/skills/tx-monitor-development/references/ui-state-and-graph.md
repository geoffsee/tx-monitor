# UI State and Graph

## Graph contract

The graph exists to make host relationships legible during live traffic. Preserve stable identity for nodes and edges so the UI does not jump unnecessarily under stream churn.

When changing graph behavior, test or reason explicitly about:

- Host identity normalization.
- Edge aggregation across packets.
- Directionality and protocol/port metadata.
- Selection persistence when graph data updates.
- Layout determinism.
- Behavior when packet history is capped.

## UI contract

React components should keep packet evidence available. If a visualization summarizes traffic, the detail panel or session view should still make the underlying host, port, protocol, process, timestamp, or packet count inspectable.

Prefer small, subsystem-local changes:

- `TrafficGraph.tsx` for rendering and graph interaction.
- `HostNode.tsx` and `FlowEdge.tsx` for visual primitives.
- `useTrafficFeed.ts` for stream ingestion.
- `useSelection.ts` for selection behavior.
- `SessionHistory.tsx` for persisted-session browsing.
- `CopilotSidebar.tsx` for explicit analysis workflow.

Avoid UI changes that make the tool look like a generic SaaS dashboard. The product frame is local packet visibility, not enterprise observability.
