#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "setup-git-hooks: not a git repository, skipping"
  exit 0
fi

HOOKS_DIR=".dev/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "setup-git-hooks: $HOOKS_DIR does not exist, skipping"
  exit 0
fi

chmod +x "$HOOKS_DIR"/* 2>/dev/null || true

git config core.hooksPath "$HOOKS_DIR"

echo "setup-git-hooks: core.hooksPath set to $HOOKS_DIR"
