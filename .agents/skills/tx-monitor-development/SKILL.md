---
name: tx-monitor-development
description: "Maintainer-agent reference for implementing, reviewing, or testing tx-monitor functionality: tcpdump parsing, live/file replay, WebSocket streaming, React traffic graph state, SQLite persistence, copilot analysis, packaging, and validation. Use when modifying code, docs, tests, or release behavior in this repository."
---

# tx-monitor Development

## Core Workflow

Identify the subsystem first, then load only the needed reference:

- Project map and source ownership: read `references/source-map.md`.
- tcpdump capture, file replay, WebSocket streaming, parser behavior, and packet fixtures: read `references/packet-capture-and-server.md`.
- React graph, node/edge state, layout, selection, and UI interaction: read `references/ui-state-and-graph.md`.
- SQLite persistence, session APIs, copilot auth/payloads, and secret handling: read `references/persistence-and-copilot.md`.
- Validation commands, safe manual workflows, and release/package checks: read `references/validation.md`.

Prefer deterministic file replay over live capture during development. Do not run `sudo`, live `tcpdump`, publishing, or deploy commands unless explicitly requested by the user.

## Implementation Habits

Keep packet ingestion, persistence, and UI state boundaries explicit. Parser changes should be backed by tcpdump line fixtures. Graph changes should preserve deterministic host/edge identity. Persistence changes should verify sessions and packet round-trips. Copilot changes should verify auth mode, timeout, redaction, and failure paths.

Treat packet metadata as sensitive local data. Do not log secrets, API keys, raw environment values, or copilot payloads. Keep AI analysis opt-in and based on explicit client-provided snapshots.

Use package scripts instead of ad-hoc commands:

- Full autonomous gate: `bun run lint && bun run typecheck && bun test && bun run build`.
- Formatting/fixes: `bun run format` and `bun run lint:fix`.
- Safe manual replay path: `bun run monitor:file` with `bun run dev` in a second terminal.
- Production smoke path: `bun run build` then `bun run start:file`.

## Repository Context

This is a Bun-first ESM TypeScript app and CLI. The server streams tcpdump-derived traffic over WebSocket, persists sessions through Drizzle/SQLite, serves HTTP APIs, and optionally calls the Codex SDK for copilot analysis. The browser renders an interactive React/@xyflow traffic graph with sidebars, detail panels, session history, and selection state.

Autonomous work should stay inside the current product frame: local-first real-time packet visibility. Do not expand into hosted observability, full IDS/SIEM behavior, packet injection, active scanning, or Wireshark-scale protocol dissection unless the user explicitly changes scope.
