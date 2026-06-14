# tx-monitor

A real-time network traffic visualizer.

## Prerequisites

- [Bun](https://bun.sh)
- `tcpdump` (required for live capture only)

## Quick Start
Use your preferred Node package management solution to execute the cli.
```bash
sudo bunx tx-monitor
```

### Development

Run the WebSocket server and Vite dev server in separate terminals:

```bash
# Terminal 1 — replay from a log file
bun run monitor:file

# Terminal 2 — frontend with WebSocket proxy
bun run dev
```

Open [http://localhost:4173](http://localhost:4173).

For live capture instead of file replay:

```bash
bun run monitor
```

Live mode requires `sudo` access for `tcpdump`.

### Production

Build the frontend, then start the Bun server (which serves `dist/` and the WebSocket feed):

```bash
bun run build
bun run start:file   # or: bun run start
```

Open [http://localhost:3001](http://localhost:3001).

## Scripts

| Script | Description |
| --- | --- |
| `bun run dev` | Vite dev server on port 4173 (proxies `/ws` to 3001) |
| `bun run build` | Build browser bundle into `dist/` |
| `bun run monitor` | Start server with live `tcpdump` capture |
| `bun run monitor:file` | Start server replaying `tcpdump.log` |
| `bun run start` | Start server (live capture; serves `dist/` if present) |
| `bun run start:file` | Start server with `--file tcpdump.log` |

## Server Options

```bash
bun run src/server.ts [--file <path>] [--port <port>] [--serve] [--db <path>] [--no-db]
```

| Flag | Description |
| --- | --- |
| `--file <path>` | Replay a `tcpdump` log instead of live capture |
| `--port <port>` | WebSocket and HTTP port (default: `3001`) |
| `--serve` | Serve the built frontend from `dist/` |
| `--db <path>` | SQLite database path for packet persistence (default: `tx-mon.db`) |
| `--no-db` | Disable SQLite persistence |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Server listen port |
| `TXMON_DB` | `tx-mon.db` | SQLite database path when persistence is enabled |
| `FILE_REPLAY_SPEED` | `0` | Real-time replay multiplier for file mode (`0` = send as fast as possible) |
| `FILE_REPLAY_SLEEP_CAP_MS` | `120` | Max delay between replayed packets when `FILE_REPLAY_SPEED` is set |

## Persistence

Captured packets are persisted to SQLite via [Drizzle ORM](https://orm.drizzle.team) using Bun's built-in driver. Persistence is enabled by default and writes to `tx-mon.db` in the current working directory.

Read persisted data over HTTP:

| Endpoint | Description |
| --- | --- |
| `GET /api/sessions` | List recent capture sessions |
| `GET /api/sessions/:id` | Fetch one capture session |
| `GET /api/sessions/:id/packets?offset=0&limit=5000` | Paginated packets for a session |
| `GET /api/packets?limit=80&session=<id>` | List recent packets, optionally scoped to one session |

Schema migrations live in `drizzle/` and are applied automatically on server startup.

```bash
bun run db:generate   # regenerate migrations after schema changes
```

## Testing

```bash
bun test
```

## Project Layout

```
src/
  App.tsx              # React UI and network diagram
  server.ts            # Bun WebSocket server
  db/                  # Drizzle ORM schema, client, and store
  tcpdumpParser.ts     # tcpdump line parser
  trafficNetwork.ts    # Application state
  layout.ts            # Host positioning
  index.tsx            # Browser entrypoint
drizzle/               # SQLite migrations
dist/                  # Generated build output
```
