#!/usr/bin/env bash
# Restore Grok CLI OAuth credentials from GROK_CREDENTIALS into ~/.grok/.
#
# GROK_CREDENTIALS is base64-encoded either:
#   - a single auth.json payload (default target: ~/.grok/auth.json), or
#   - a gzip tar archive rooted at $HOME (e.g. .grok/auth.json).
#
# Used by GitHub Actions before caretta runs the bundled grok CLI with a
# SuperGrok / X Premium+ subscription instead of XAI_API_KEY billing.

set -euo pipefail

if [ -z "${GROK_CREDENTIALS:-}" ]; then
    echo "GROK_CREDENTIALS is not set; skipping Grok OAuth restore." >&2
    exit 0
fi

grok_home="${HOME}/.grok"
tmp_payload="$(mktemp)"
trap 'rm -f "$tmp_payload"' EXIT

if ! printf '%s' "$GROK_CREDENTIALS" | base64 -d >"$tmp_payload" 2>/dev/null; then
    echo "GROK_CREDENTIALS is not valid base64." >&2
    exit 1
fi

mkdir -p "$grok_home"
chmod 700 "$grok_home" 2>/dev/null || true

if tar tzf "$tmp_payload" >/dev/null 2>&1; then
    tar xzf "$tmp_payload" -C "$HOME"
    echo "Restored Grok OAuth session from GROK_CREDENTIALS archive." >&2
else
    dest="${GROK_CREDENTIALS_PATH:-$grok_home/auth.json}"
    mkdir -p "$(dirname "$dest")"
    cp "$tmp_payload" "$dest"
    chmod 600 "$dest" 2>/dev/null || true
    echo "Restored Grok OAuth session to ${dest}." >&2
fi

# Prefer subscription OAuth over any API key present in the workflow env.
unset XAI_API_KEY GROK_API_KEY 2>/dev/null || true
export XAI_API_KEY=""
export GROK_API_KEY=""
