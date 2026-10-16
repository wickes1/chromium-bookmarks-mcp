#!/bin/bash
# Shell wrapper for native messaging host.
# Chrome/Brave spawns this script; it runs the Bun native host.
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Probe absolute bun paths - browser-spawned processes have a minimal PATH
# (/usr/bin:/bin:/usr/sbin:/sbin on macOS), so version managers and Homebrew
# are invisible to `command -v`. asdf is left out: its shim needs asdf on PATH.
for c in "${BUN_INSTALL:-$HOME/.bun}/bin/bun" "$HOME/.proto/bin/bun" \
         "$HOME/.local/share/mise/shims/bun" "/opt/homebrew/bin/bun" "/usr/local/bin/bun"; do
  [ -x "$c" ] && BUN="$c" && break
done
[ -x "${BUN:-}" ] || BUN="$(command -v bun 2>/dev/null)"
[ -x "${BUN:-}" ] || { echo "chromium-bookmarks-mcp: bun not found; set BUN_INSTALL or link it to ~/.bun/bin/bun" >&2; exit 1; }

# Prefer the built artifact (published tarball ships dist/), fall back to source (dev).
HOST="$DIR/dist/native-host.js"
if [ ! -f "$HOST" ]; then
  HOST="$DIR/src/native-host.ts"
fi

exec "$BUN" run "$HOST" "$@"
