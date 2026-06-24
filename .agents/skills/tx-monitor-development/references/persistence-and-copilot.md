# Persistence and Copilot

## SQLite and sessions

Persistence turns transient packet streams into inspectable sessions. Schema or store changes should preserve:

- Session creation and retrieval.
- Packet insertion order and pagination.
- Optional persistence disablement via `--no-db`.
- Migration compatibility for existing local databases where practical.
- Clear behavior for WAL/shm side files and local database paths.

Use `src/db/store.test.ts` as the first place to encode persistence expectations.

## HTTP APIs

The README-documented APIs are part of the user contract:

- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/packets?offset=0&limit=5000`
- `GET /api/packets?limit=80&session=<id>`
- `POST /api/copilot`

If route behavior changes, update README and tests together.

## Copilot and secrets

Copilot analysis is optional and should operate on explicit client-provided snapshots. Treat packet metadata, process names, hostnames, and environment variables as sensitive.

When changing copilot behavior, preserve:

- `TXMON_CODEX_AUTH=local` and `TXMON_CODEX_AUTH=api-key` behavior.
- `OPENAI_API_KEY` handling without logging secret values.
- `TXMON_CODEX_MODEL` override behavior.
- `TXMON_CODEX_TIMEOUT_MS` timeout behavior.
- Safe failures when credentials are absent or the SDK request fails.

Do not send ambient live packet streams to AI services by default.
