#!/usr/bin/env bash
# Fail fast when Grok OAuth is misconfigured for CI.
# Default model comes from caretta.toml [agent_models].xai; override with GROK_VERIFY_MODEL.
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

if [ -n "${GROK_VERIFY_MODEL:-}" ]; then
    model="$GROK_VERIFY_MODEL"
else
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
        echo "caretta.toml has no [agent_models] xai entry (or set GROK_VERIFY_MODEL)." >&2
        exit 1
    fi
fi

models_out="$(grok models 2>&1 || true)"
if ! printf '%s\n' "$models_out" | grep -Fq "$model"; then
    echo "Configured model '$model' is not available for this Grok session." >&2
    echo "Available models (names only):" >&2
    # Print only model id-like tokens; never dump raw auth material.
    printf '%s\n' "$models_out" | grep -Eio 'grok[-a-z0-9.]*' | sort -u >&2 || true
    echo "Set GROK_VERIFY_MODEL or run 'grok models' after 'grok login'." >&2
    exit 1
fi

# Stream response through grep only; do not echo model output (may include prompts/context).
if ! grok -m "$model" -p "Reply with exactly: credentials ok" \
    --always-approve --output-format json \
    | grep -Fq "credentials ok"; then
    echo "Grok prompt verification failed for model ${model}." >&2
    exit 1
fi

echo "Grok OAuth verified for model ${model}." >&2
