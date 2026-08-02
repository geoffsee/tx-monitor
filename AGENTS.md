# Repository Guidelines

## Project Structure & Module Organization
This is a Bun + React app with a small, source-first layout.

- `src/` contains runtime code:
  - `server.ts` and `ws.ts`: Bun server + WebSocket orchestration.
  - `lib/`: parser, graph state, copilot integration, and persistence helpers.
  - `components/`: React UI (e.g., `TrafficGraph.tsx`, `Sidebar.tsx`).
  - `hooks/`: reusable React hooks for layout and selection behavior.
  - `db/`: Drizzle schema/client/store.
- `scripts/verify-publish.ts`: packaging sanity checks.
- `drizzle/`: SQL migrations.
- `build/`, `dist/`, `.test-tx-mon.db*`: generated artifacts (keep ignored/not committed).
- `packages/tx-mon-sdk/`: read-only capture query SDK (workspace package).
- `bin/tx-monitor.js`: executable entrypoint.
- `package.json` + `biome.json` + `tsconfig.json` define the toolchain.
- Tests live next to implementation files as `*.test.ts` / `*.test.tsx`.

## Build, Test, and Development Commands
- `bun run dev` — start Vite UI on `4173` (proxies `/ws` to server).
- `bun run monitor:file` — start server replaying `tcpdump.log`.
- `bun run monitor` (or `bun run start:file`) — live capture or file replay mode server.
- `bun run build` — build frontend bundle to `dist/`.
- `bun run compile` — create standalone `build/tx-monitor`.
- `bun run start` — run server (serves `dist/` when present).
- `bun run db:generate` / `bun run db:push` — refresh and apply Drizzle migrations.

## Coding Style & Naming Conventions
- Use the project formatter/linter: `bun run lint` and `bun run check:fix`.
- `biome.json` enforces 4-space indentation and double quotes; follow existing TypeScript style.
- Prefer explicit typing, `PascalCase` for React components/types, `camelCase` for functions/variables, and `kebab-case` file names.

## Testing Guidelines
- Framework: Bun test runner (`bun:test`), with tests colocated in `src/**/*.test.ts`.
- Primary command: `bun test`.
- CI also requires `bun run typecheck` and `bun run lint` before merging.
- Recommended local validation before PR:
  - `bun run lint`
  - `bun run typecheck`
  - `bun test`
  - `bun run build`

## Commit & Pull Request Guidelines
- Recent history uses short, imperative-style subjects (e.g., `fix linter config`, `add code guidelines...`).
- Pre-commit/pre-push hooks run formatting, typecheck, and tests automatically.
- PRs should include:
  - A clear summary of user-visible behavior changes.
  - Commands run (at minimum the four checks above).
  - Notes for any DB/migration or UI behavior changes.

## Security & Configuration Notes
- `txdump`/live capture needs elevated privileges on many systems.
- Keep credentials out of version control; use `.env.copilot` for local Codex/OpenAI keys.
