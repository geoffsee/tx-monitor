#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

const DIST = "./dist";
const PUBLIC = "./public";
const SKIP_COPY = /\.(log)$/i;

async function copyDir(src: string, dest: string) {
    await mkdir(dest, { recursive: true });

    for await (const entry of new Bun.Glob("**/*").scan({
        cwd: src,
        absolute: false,
    })) {
        if (SKIP_COPY.test(entry)) {
            continue;
        }

        const from = join(src, entry);
        const to = join(dest, entry);
        const file = Bun.file(from);

        if ((await file.stat()).isDirectory()) {
            await mkdir(to, { recursive: true });
            continue;
        }

        await mkdir(join(to, ".."), { recursive: true });
        await Bun.write(to, file);
    }
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const result = await Bun.build({
    entrypoints: ["./src/index.tsx"],
    outdir: DIST,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: true,
    naming: {
        entry: "[dir]/[name]-[hash].[ext]",
        chunk: "chunks/[name]-[hash].[ext]",
        asset: "assets/[name]-[hash].[ext]",
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
    publicPath: "./",
    throw: false,
});

if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
        console.error(log);
    }
    process.exit(1);
}

if (existsSync(PUBLIC)) {
    await copyDir(PUBLIC, DIST);
}

const entryScript = result.outputs
    .map((output) => basename(output.path))
    .find((path) => path.includes("index-") && path.endsWith(".js"));

const stylesheets = result.outputs
    .map((output) => basename(output.path))
    .filter((path) => path.endsWith(".css"))
    .map((path) => `<link rel="stylesheet" href="./${path}" />`)
    .join("\n    ");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <title>Traffic Monitor</title>
    ${stylesheets}
    <style>
      html, body, #app {
        margin: 0;
        min-height: 100%;
      }

      body {
        background: #081118;
      }

      * {
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./${entryScript}"></script>
  </body>
</html>`;

await Bun.write(join(DIST, "index.html"), html);
await Bun.write(join(DIST, ".nojekyll"), "");

console.log("Built browser dist in ./dist");
