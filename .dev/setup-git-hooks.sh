#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "setup-git-hooks: not a git repository, skipping"
  exit 0
fi
chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks
echo "setup-git-hooks: core.hooksPath set to .githooks"
