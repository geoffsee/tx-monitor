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

### Native Executable

Build a standalone executable with the UI embedded:

```bash
bun run compile
./build/tx-monitor --file tcpdump.log   # or: sudo ./build/tx-monitor
```

Open [http://localhost:3001](http://localhost:3001). The compiled server embeds the React UI, so it does not need a sibling `dist/` directory.

## Scripts

| Script | Description |
| --- | --- |
| `bun run dev` | Vite dev server on port 4173 (proxies `/ws` to 3001) |
| `bun run build` | Build browser bundle into `dist/` |
| `bun run compile` | Build native executable into `build/tx-monitor` with embedded UI |
| `bun run monitor` | Start server with live `tcpdump` capture |
| `bun run monitor:file` | Start server replaying `tcpdump.log` |
| `bun run start` | Start server (live capture; serves `dist/` if present) |
| `bun run start:file` | Start server with `--file tcpdump.log` |

## Server Options

```bash
bun run src/server.ts [--file <path>] [--port <port>] [--serve] [--db <path>] [--no-db]
```

CLI flags take precedence over environment variables and local config (see below).

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
| `TXMON_CODEX_AUTH` | `local` | Codex SDK auth mode for copilot requests. Use `local` for your logged-in Codex/OpenAI subscription credentials, or `api-key` to pass `OPENAI_API_KEY`. |
| `OPENAI_API_KEY` | unset | Optional key used only when `TXMON_CODEX_AUTH=api-key`. Can also be set in `.env.copilot`. |
| `TXMON_CODEX_MODEL` | `gpt-5.3-codex` | Optional model override for Codex SDK copilot requests |
| `TXMON_CODEX_TIMEOUT_MS` | `120000` | Timeout for backend Codex SDK copilot requests |
| `FILE_REPLAY_SPEED` | `0` | Real-time replay multiplier for file mode (`0` = send as fast as possible) |
| `FILE_REPLAY_SLEEP_CAP_MS` | `120` | Max delay between replayed packets when `FILE_REPLAY_SPEED` is set |
| `TXMON_TCPDUMP_ARGS` | unset | Custom tcpdump command/args (advanced) |
| `TXMON_LSOF_DISABLE` | unset | Set to `1` to disable lsof process enrichment |
| `TXMON_LSOF_INTERVAL_MS` | `1500` | Polling interval for lsof enrichment (ms) |
| `TXMON_FILE` | unset | Alternative to `--file` for replay path |

## Local Configuration

An optional local config file supplies defaults without repeating CLI flags or environment variables on every run.

- Location: `.tx-monitor/config` (relative to current working directory), or the path specified by the `TXMON_CONFIG` environment variable.
- Format: simple `KEY=VALUE` assignments (supports `export`, single/double quotes, inline `#` comments, and blank lines — same syntax as `.env` files).
- Supported keys include the environment variables listed above plus `file` (or `TXMON_FILE`) for capture replay path and `SERVE` for serving the built UI.

Precedence (highest wins):
1. CLI flags (`--file`, `--port`, `--db`, `--no-db`, `--serve`)
2. Direct environment variables
3. Local config file
4. Built-in defaults

Example `.tx-monitor/config`:

```
PORT=3002
TXMON_DB=/var/lib/tx-mon.db
FILE_REPLAY_SPEED=1.0
TXMON_CODEX_MODEL=gpt-test
file=/home/user/captures/home.pcap
```

CLI flags and direct environment variables always override values from the config file.

Secrets (e.g. `OPENAI_API_KEY`) are never read from the config file. Use the process environment or `.env.copilot` for secrets.

Config loading performs only local filesystem reads, requires no network, and has no side effects when using the pure parsing/resolution helpers in tests.

## Persistence

Captured packets are persisted to SQLite via [Drizzle ORM](https://orm.drizzle.team) using Bun's built-in driver. Persistence is enabled by default and writes to `tx-mon.db` in the current working directory.

Read persisted data over HTTP:

| Endpoint | Description |
| --- | --- |
| `GET /api/sessions` | List recent capture sessions |
| `GET /api/sessions/:id` | Fetch one capture session |
| `GET /api/sessions/:id/packets?offset=0&limit=5000` | Paginated packets for a session |
| `GET /api/packets?limit=80&session=<id>` | List recent packets, optionally scoped to one session |
| `POST /api/copilot` | Analyze the current client-provided capture snapshot using the backend Codex SDK |

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
