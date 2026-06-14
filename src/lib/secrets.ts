import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SECRET_KEYS = ["OPENAI_API_KEY"] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type ClientSecrets = Partial<Record<SecretKey, string>>;

type EnvSource = Record<string, string | undefined>;

function stripInlineComment(value: string) {
    const commentStart = value.search(/\s#/);
    return commentStart === -1 ? value : value.slice(0, commentStart).trimEnd();
}

function unquoteEnvValue(value: string) {
    const trimmed = value.trim();
    const quote = trimmed[0];
    if (
        (quote !== '"' && quote !== "'") ||
        trimmed[trimmed.length - 1] !== quote
    ) {
        return stripInlineComment(trimmed);
    }

    const unquoted = trimmed.slice(1, -1);
    if (quote === "'") {
        return unquoted;
    }

    return unquoted
        .replaceAll("\\n", "\n")
        .replaceAll("\\r", "\r")
        .replaceAll("\\t", "\t")
        .replaceAll('\\"', '"')
        .replaceAll("\\\\", "\\");
}

export function parseEnvFile(content: string): EnvSource {
    const values: EnvSource = {};

    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const assignment = trimmed.startsWith("export ")
            ? trimmed.slice("export ".length).trimStart()
            : trimmed;
        const equalsIndex = assignment.indexOf("=");
        if (equalsIndex === -1) {
            continue;
        }

        const key = assignment.slice(0, equalsIndex).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            continue;
        }

        values[key] = unquoteEnvValue(assignment.slice(equalsIndex + 1));
    }

    return values;
}

export function pickClientSecrets(...sources: EnvSource[]): ClientSecrets {
    const secrets: ClientSecrets = {};

    for (const key of SECRET_KEYS) {
        for (const source of sources) {
            const value = source[key]?.trim();
            if (value) {
                secrets[key] = value;
                break;
            }
        }
    }

    return secrets;
}

export function loadClientSecrets(cwd = process.cwd()): ClientSecrets {
    const envPath = join(cwd, ".env.copilot");
    const fileValues = existsSync(envPath)
        ? parseEnvFile(readFileSync(envPath, "utf8"))
        : {};

    return pickClientSecrets(process.env, fileValues);
}
