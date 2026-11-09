# Packet Capture and Server

## Development path

Use file replay as the default development path. It avoids sudo, live network variance, and accidental capture of unrelated traffic:

```bash
bun run monitor:file
bun run dev
```

Live mode depends on tcpdump and may require elevated permissions. Do not run live capture unless the user explicitly asks.

## Parser rules

Parser changes must preserve a direct mapping from tcpdump text to structured packet events. When supporting a new line shape, add representative fixtures to parser tests and cover malformed or partial input where relevant.

Keep parser behavior conservative:

- Do not infer more than the line supports.
- Preserve timestamps, protocol, source, destination, ports, and length when present.
- Treat unknown formats as non-events rather than fabricating data.
- Keep platform-specific tcpdump differences explicit in tests.

## Streaming rules

The server should keep capture, parsing, persistence, and WebSocket delivery separable enough that a failure in one path does not silently corrupt another. Under packet bursts, prefer batching, capping, or backpressure over unbounded in-memory growth.

When changing `src/server.ts` or `src/ws.ts`, consider:

- File replay behavior with `--file`.
- Live capture behavior with tcpdump missing or permission denied.
- HTTP API behavior when persistence is disabled with `--no-db`.
- WebSocket client connect/disconnect behavior.
- Static serving of the built frontend.
