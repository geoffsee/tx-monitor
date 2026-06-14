import { describe, expect, test } from "bun:test";
import { parseEnvFile, pickClientSecrets } from "./secrets";

describe("parseEnvFile", () => {
    test("parses dotenv assignments and quoted values", () => {
        const values = parseEnvFile(`
# ignored
OPENAI_API_KEY=sk-file
export EXTRA_VALUE="two words"
SINGLE_QUOTED='keeps # hash'
INLINE_COMMENT=value # ignored
`);

        expect(values.OPENAI_API_KEY).toBe("sk-file");
        expect(values.EXTRA_VALUE).toBe("two words");
        expect(values.SINGLE_QUOTED).toBe("keeps # hash");
        expect(values.INLINE_COMMENT).toBe("value");
    });
});

describe("pickClientSecrets", () => {
    test("returns allowlisted client secrets only", () => {
        expect(
            pickClientSecrets({
                OPENAI_API_KEY: "sk-test",
                OTHER_SECRET: "hidden",
            }),
        ).toEqual({ OPENAI_API_KEY: "sk-test" });
    });

    test("prefers earlier sources", () => {
        expect(
            pickClientSecrets(
                { OPENAI_API_KEY: "sk-env" },
                { OPENAI_API_KEY: "sk-file" },
            ),
        ).toEqual({ OPENAI_API_KEY: "sk-env" });
    });
});
