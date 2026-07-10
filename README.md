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

| Flag | Description |
| --- | --- |
| `--file <path>` | Replay a `tcpdump` log instead of live capture |
| `--port <port>` | WebSocket and HTTP port (default: `3001`) |
| `--serve` | Serve the built frontend from `dist/` |
| `--db <path>` | SQLite database path for packet persistence (default: `~/.tx-monitor`) |
| `--no-db` | Disable SQLite persistence |

## Configuration File

A local config file supplies safe defaults. Precedence is: config file < environment variables < CLI flags.

Primary location:
- `~/.tx-monitor/config`

Additional locations (later entries override earlier for the same key):
- `~/.tx-monitor/config.toml`
- `.tx-monitor/config` (relative to current working directory)
- `.tx-monitor.toml` (relative to current working directory)

File format is a simple `KEY=VALUE` file (comments with `#`, basic quoting supported, similar to dotenv). Only safe, non-secret keys are accepted.

Supported config keys (examples):

```
db=~/.tx-monitor
port=3002
file_replay_speed=1
file_replay_sleep_cap_ms=200
lsof_disable=0
lsof_interval_ms=2000
codex_timeout_ms=180000
codex_model=gpt-5.5
```

Secrets, credentials, API keys, and `TXMON_TCPDUMP_ARGS` are not allowed in the config file and are ignored if present (with a warning for secret-like or blocked keys). Keep credentials in the environment or `.env.copilot` only. Capture command args stay env-only so config files cannot change live `tcpdump` invocation.

A brief effective settings line is logged at startup (port, db, replay, mode). No new interactive settings UI is added.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Server listen port |
| `TXMON_DB` | `~/.tx-monitor` | SQLite database path when persistence is enabled |
| `TXMON_CODEX_AUTH` | `local` | Codex SDK auth mode for copilot requests. Use `local` for your logged-in Codex/OpenAI subscription credentials, or `api-key` to pass `OPENAI_API_KEY`. |
| `OPENAI_API_KEY` | unset | Optional key used only when `TXMON_CODEX_AUTH=api-key`. Can also be set in `.env.copilot`. |
| `TXMON_CODEX_MODEL` | `gpt-5.5` | Optional model override for Codex SDK copilot requests |
| `TXMON_CODEX_TIMEOUT_MS` | `120000` | Timeout for backend Codex SDK copilot requests |
| `FILE_REPLAY_SPEED` | `0` | Real-time replay multiplier for file mode (`0` = send as fast as possible) |
| `FILE_REPLAY_SLEEP_CAP_MS` | `120` | Max delay between replayed packets when `FILE_REPLAY_SPEED` is set |
| `TXMON_TCPDUMP_ARGS` | unset | Optional full live-capture argv (env only; not accepted in config files) |

## Persistence

Captured packets are persisted to SQLite via [Drizzle ORM](https://orm.drizzle.team) using Bun's built-in driver. Persistence is enabled by default and writes to `~/.tx-monitor`.

Read persisted data over HTTP:

| Endpoint | Description |
| --- | --- |
| `GET /api/sessions` | List recent capture sessions |
| `GET /api/sessions/:id` | Fetch one capture session |
| `GET /api/sessions/:id/packets?offset=0&limit=5000` | Paginated packets for a session |
| `GET /api/packets?limit=80&session=<id>` | List recent packets, optionally scoped to one session |
| `POST /api/copilot` | Analyze the client-provided capture snapshot (strict snapshot model) using the backend Codex SDK |

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
