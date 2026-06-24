# Validation

## Full autonomous gate

Caretta is configured to run:

```bash
bun install && bun run lint && bun run typecheck && bun test && bun run build
```

Use this when the user asks for validation or before release work.

## Focused checks

Prefer focused tests while developing a subsystem:

- Parser: `bun test src/lib/tcpdumpParser.test.ts`.
- Graph: `bun test src/lib/graph.test.ts src/layout.test.ts`.
- Persistence: `bun test src/db/store.test.ts`.
- Copilot/secrets: `bun test src/lib/copilot.test.ts src/lib/copilotServer.test.ts src/lib/secrets.test.ts`.
- Process enrichment: `bun test src/lib/lsofCollector.test.ts`.

## Manual workflows

Safe replay workflow:

```bash
bun run monitor:file
bun run dev
```

Production-style local workflow:

```bash
bun run build
bun run start:file
```

Live capture requires tcpdump and may require sudo. Do not run it automatically.

## Release checks

Before packaging or deploy work, confirm:

- `package.json` files list remains intentional.
- Build output exists when expected.
- CLI entrypoint still points to `bin/tx-monitor.js`.
- Migrations under `drizzle/` are included.
- Local databases, logs, screenshots, and prior tarballs are not intentionally added to release artifacts unless the maintainer says so.
