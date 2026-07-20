# Persistence and Copilot

## SQLite and sessions

Persistence turns transient packet streams into inspectable sessions. Schema or store changes should preserve:

- Session creation and retrieval.
- Packet insertion order and pagination.
- Optional persistence disablement via `--no-db`.
- Migration compatibility for existing local databases where practical.
- Clear behavior for WAL/shm side files and local database paths.

Use `src/db/store.test.ts` as the first place to encode persistence write expectations.
Use `packages/tx-mon-sdk` tests for read-only historical query / event-context behavior.

The shared Drizzle schema lives in `packages/tx-mon-sdk/src/schema.ts` (re-exported from `src/db/schema.ts`). The app owns writes and migrations; the SDK opens the DB read-only.

## HTTP APIs

The README-documented APIs are part of the user contract:

- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/packets?offset=0&limit=5000`
- `GET /api/packets?limit=80&session=<id>`
- `POST /api/copilot`

If route behavior changes, update README and tests together.

## SDK (external readers)

Dashboard and agent tooling should prefer `tx-mon-sdk` (`openTxMon` / `contextAround`) when they can read `~/.tx-monitor` directly. Keep HTTP as the contract for the in-app UI and remote clients that cannot share the DB file.

## Copilot and secrets

Copilot analysis is optional and should operate on explicit client-provided snapshots. Treat packet metadata, process names, hostnames, and environment variables as sensitive.

When changing copilot behavior, preserve:

- `TXMON_CODEX_AUTH=local` and `TXMON_CODEX_AUTH=api-key` behavior.
- `OPENAI_API_KEY` handling without logging secret values.
- `TXMON_CODEX_MODEL` override behavior.
- `TXMON_CODEX_TIMEOUT_MS` timeout behavior.
- Safe failures when credentials are absent or the SDK request fails.

Do not send ambient live packet streams to AI services by default.
