#!/usr/bin/env bash
# Encode local Grok CLI OAuth credentials for the GROK_CREDENTIALS GitHub secret.
#
# Usage:
#   ./scripts/encode-grok-credentials.sh
#   ./scripts/encode-grok-credentials.sh | gh secret set GROK_CREDENTIALS
#
# By default reads ~/.grok/auth.json. Set GROK_AUTH_FILE to override.

set -euo pipefail

auth_file="${GROK_AUTH_FILE:-${HOME}/.grok/auth.json}"

if [ ! -f "$auth_file" ]; then
    echo "Grok auth file not found: ${auth_file}" >&2
    echo "Run \`grok login\` locally first." >&2
    exit 1
fi

base64 <"$auth_file" | tr -d '\n'
