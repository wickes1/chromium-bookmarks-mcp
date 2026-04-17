#!/bin/bash
# Shell wrapper for native messaging host.
# Chrome/Brave spawns this script; it runs the Bun native host.
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Use absolute bun path - browser-spawned processes have minimal PATH
BUN="${HOME}/.bun/bin/bun"
if [ ! -x "$BUN" ]; then
  BUN="$(command -v bun 2>/dev/null || echo bun)"
fi

exec "$BUN" run "$DIR/src/native-host.ts" "$@"
