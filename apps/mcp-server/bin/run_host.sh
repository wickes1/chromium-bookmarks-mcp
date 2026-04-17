#!/bin/bash
# Shell wrapper for native messaging host.
# Chrome/Brave spawns this script; it runs the Bun native host.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec bun run "$DIR/src/native-host.ts" "$@"
