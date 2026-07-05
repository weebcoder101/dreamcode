#!/usr/bin/env bash
# /deslop skill — install frontend dependencies
# Called automatically when the skill is first loaded.
set -euo pipefail

ROOT="$(cd "$(dirname "$(dirname "$(dirname "$(dirname "$(dirname "$(dirname "$0")")")")")")" && pwd)"

# Install design-system dependencies if the project uses them
cd "$ROOT"

# Check if package.json exists before installing
if [ -f "package.json" ]; then
  # Install core design dependencies needed by /deslop
  # These are peer deps — the project may already have them
  if command -v bun &>/dev/null; then
    bun add @phosphor-icons/react motion gsap 2>/dev/null || true
  elif command -v npm &>/dev/null; then
    npm install @phosphor-icons/react motion gsap --save 2>/dev/null || true
  fi
fi

echo "✅ /deslop dependencies ready"
