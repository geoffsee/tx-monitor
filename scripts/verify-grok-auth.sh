#!/usr/bin/env bash
# Fail fast when Grok OAuth or the caretta.toml model id is misconfigured for CI.
set -euo pipefail

if [ -z "${GROK_CREDENTIALS:-}" ] && [ ! -f "${HOME}/.grok/auth.json" ]; then
    echo "No Grok credentials: set GROK_CREDENTIALS or restore auth.json first." >&2
    exit 1
fi

if [ -n "${GROK_CREDENTIALS:-}" ]; then
    bash "$(dirname "$0")/restore-grok-credentials.sh"
fi

if ! command -v grok >/dev/null 2>&1; then
    curl -fsSL https://x.ai/cli/install.sh | bash
fi
export PATH="${HOME}/.grok/bin:${PATH}"

unset XAI_API_KEY GROK_API_KEY

model="$(
    awk '
        /^\[agent_models\]/ { in_models = 1; next }
        /^\[/ { in_models = 0 }
        in_models && $1 == "xai" {
            split($0, parts, "=")
            gsub(/[" \t]/, "", parts[2])
            print parts[2]
            exit
        }
    ' caretta.toml
)"
if [ -z "$model" ]; then
    echo "caretta.toml has no [agent_models] xai entry." >&2
    exit 1
fi

if ! grok models 2>&1 | grep -Fq "$model"; then
    echo "Configured model '$model' is not available for this Grok session." >&2
    echo "Run 'grok models' locally after 'grok login' and update caretta.toml." >&2
    exit 1
fi

grok -m "$model" -p "Reply with exactly: credentials ok" \
    --always-approve --output-format json \
    | grep -Fq "credentials ok"

echo "Grok OAuth verified for model ${model}." >&2
