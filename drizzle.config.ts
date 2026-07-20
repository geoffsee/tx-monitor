import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "./packages/tx-mon-sdk/src/schema.ts",
    out: "./drizzle",
    dbCredentials: {
        url: process.env.TXMON_DB ?? "tx-mon.db",
    },
});
