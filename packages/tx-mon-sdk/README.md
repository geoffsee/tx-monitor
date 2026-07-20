# tx-mon-sdk

Read-only Bun SDK for querying [tx-monitor](https://github.com/geoffsee/tx-monitor) capture databases.

Use this from another dashboard or tool to triage **timestamped events** with nearby packet context — without running the tx-monitor HTTP server.

## Requirements

- Bun `>= 1.0`
- A SQLite DB written by tx-monitor (default `~/.tx-monitor`)

The SDK opens the database **read-only** and never runs migrations. Start tx-monitor with persistence enabled at least once so the schema exists.

## Install

From this monorepo (workspace):

```bash
bun add tx-mon-sdk@workspace:*
```

Or depend on the package path / published version when available.

## Quick start

```ts
import { openTxMon } from "tx-mon-sdk";

const tx = openTxMon(); // TXMON_DB or ~/.tx-monitor

const ctx = tx.contextAround(Date.parse("2026-07-20T18:00:00Z"), {
    windowMs: 30_000,
    limit: 200,
});

console.log(ctx.sessions, ctx.packets, ctx.summary);
tx.close();
```

## API

| Method | Purpose |
| --- | --- |
| `openTxMon({ dbPath? })` | Open read-only DB (`dbPath` / `TXMON_DB` / `~/.tx-monitor`) |
| `findSessions({ from?, to?, mode?, q?, limit?, offset? })` | Sessions overlapping a time range |
| `getSession(id)` | One session row |
| `queryPackets({ sessionId?, from?, to?, host?, port?, proto?, q?, limit?, offset? })` | Filtered packets (`receivedAt` window) |
| `summarize({ sessionId?, from?, to?, topN? })` | Proto / host / port tallies |
| `contextAround(eventAt, { windowMs?, sessionId?, limit?, topN? })` | Sessions + packets + summary around an event |
| `getMarkers(sessionId)` | Entity markers for a session |
| `close()` | Close the SQLite handle |

Schema table definitions are also exported from `tx-mon-sdk/schema` for apps that share the same Drizzle models.

## Notes

- Packet metadata can be sensitive; treat SDK results like local capture data.
- Cross-session time queries may scan more rows than per-session lookups; keep windows tight for interactive triage.
