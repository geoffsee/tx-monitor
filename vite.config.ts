import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const serverProcessPort = Number.parseInt(
    process.env.TXMON_SERVER_PORT ?? "3001",
    10,
);
const serverProcessTarget = `http://localhost:${serverProcessPort}`;

function pipeServerOutput(stream: Readable, log: (message: string) => void) {
    stream.setEncoding("utf8");
    let pending = "";

    stream.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";

        for (const line of lines) {
            if (line.trim()) {
                log(`[server] ${line}`);
            }
        }
    });
}

function launchServerProcess(): Plugin {
    return {
        name: "tx-monitor-server-process",
        apply: "serve",
        configureServer(viteServer) {
            const args = [
                "run",
                "src/server.ts",
                "--port",
                String(serverProcessPort),
            ];
            const serverProcess = spawn("bun", args, {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    PORT: String(serverProcessPort),
                },
                stdio: ["ignore", "pipe", "pipe"],
            });
            let shuttingDown = false;

            pipeServerOutput(
                serverProcess.stdout,
                viteServer.config.logger.info,
            );
            pipeServerOutput(
                serverProcess.stderr,
                viteServer.config.logger.error,
            );

            serverProcess.on("error", (error) => {
                viteServer.config.logger.error(
                    `[server] Failed to launch: ${error.message}`,
                );
            });

            serverProcess.on("exit", (code, signal) => {
                if (!shuttingDown && code !== 0) {
                    viteServer.config.logger.error(
                        `[server] Process exited with ${
                            signal ?? `code ${code}`
                        }`,
                    );
                }
            });

            const stopServerProcess = () => {
                shuttingDown = true;
                if (!serverProcess.killed) {
                    serverProcess.kill("SIGTERM");
                }
            };

            viteServer.httpServer?.once("close", stopServerProcess);
            process.once("exit", stopServerProcess);
        },
    };
}

export default defineConfig({
    plugins: [launchServerProcess(), react()],
    server: {
        host: "0.0.0.0",
        port: 4173,
        strictPort: true,
        proxy: {
            "/ws": {
                target: serverProcessTarget.replace("http:", "ws:"),
                ws: true,
            },
            "/api": {
                target: serverProcessTarget,
            },
        },
    },
});
