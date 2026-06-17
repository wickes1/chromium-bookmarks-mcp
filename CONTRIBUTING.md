# Contributing

Thanks for hacking on chromium-bookmarks-mcp. This guide covers local setup, running the three-process stack against an unpacked extension, the test suite, and where each process writes its logs.

## Prerequisites

- [Bun](https://bun.sh) 1.2+ — the MCP server and native host run on Bun (`Bun.serve`, the Bun test runner). Not optional; the package declares `"engines": { "bun": ">=1.2.0" }`.
- A Chromium-based browser (Chrome, Brave, Edge, Arc, or Chromium) for end-to-end testing.
- Use **bun / bunx**, never npm / npx, for every command in this repo.

## Setup

This is a Bun workspace monorepo (`packages/*`, `apps/*`). One install at the root wires every package:

```bash
bun install
```

Layout:

```
chromium-bookmarks-mcp/
├── packages/shared/   # Shared wire types + constants (imported by the server)
├── apps/extension/    # Browser extension (WXT + TypeScript)
└── apps/mcp-server/   # MCP stdio proxy + native messaging host
```

## The three-process architecture

At runtime the system is three independent processes with two independent spawners. Understanding who spawns what is the key to debugging it:

```
AI client (Claude Code / Desktop / Cursor ...)
    | spawns, MCP stdio JSON-RPC
    v
Process C — MCP stdio proxy   (apps/mcp-server/src/stdio-proxy.ts)
    | HTTP to 127.0.0.1:19420
    v
Process A — native host + HTTP server   (apps/mcp-server/src/native-host.ts)
    | Chrome Native Messaging (stdin/stdout, 4-byte framed)
    v
Browser extension service worker   (apps/extension/entrypoints/background/)
    | chrome.bookmarks API
    v
Browser bookmarks
```

Two separate things start processes:

- The **browser** spawns Process A. When the extension opens a native-messaging port, Chrome runs `apps/mcp-server/bin/run_host.sh`, which `exec`s the Bun native host. The host is 1:1 with that port — when the extension disconnects, its stdin closes and the host exits. You cannot meaningfully run Process A by hand; let the browser launch it.
- The **AI client** spawns Process C. Process C also runs `ensureRegistered()` on startup (idempotent — see below), then bridges MCP stdio to the host's HTTP server.

## Running the full stack locally

1. **Build / load the unpacked extension.** Run the extension in dev mode (hot reload):

   ```bash
   cd apps/extension && bun run wxt dev
   ```

   This opens a browser with the unpacked extension loaded from `.output/`. Copy its ID from `chrome://extensions`.

2. **Reconcile the dev extension ID with the native host.** The native-host manifest pins `allowed_origins` to a single extension ID, defaulting to the published Web Store ID. Your unpacked build has a different ID, so the host will refuse the connection until you reconcile them. Pick one (see `.env.example` for both):

   - **Register the dev ID** (simplest):

     ```bash
     cd apps/mcp-server && bun run src/index.ts register <your-dev-extension-id>
     ```

     This rewrites `allowed_origins` (and the Windows registry key, on Windows) to your dev ID.

   - **Or pin `manifest.key`** in `apps/extension/wxt.config.ts` so the unpacked build derives the *same* ID as the published one — no re-registration needed. Keep the key out of git.

3. **Start the stdio proxy.** In normal use your AI client spawns this, but you can run it by hand to exercise the bridge:

   ```bash
   cd apps/mcp-server && bun run src/index.ts
   ```

   Or wire it into your client, e.g. Claude Code:

   ```bash
   claude mcp add bookmarks -- bun run /absolute/path/to/apps/mcp-server/src/index.ts
   ```

4. **Activate the connection.** Open the browser, click the extension icon. A green dot / **Connected** means the extension reached Process A. The extension only attempts a connection on browser launch, popup open, or **Refresh status** — there is no background polling, so click Refresh after restarting the host.

5. **Verify.** Ask the agent to call the `ping` tool, or run `bun run src/index.ts doctor` from `apps/mcp-server` to diagnose registration and the localhost port.

### About registration

`ensureRegistered()` runs at proxy startup (Process C), **not** at install time — there is no `postinstall` hook. It is idempotent: it only writes a manifest when one is missing or its `path` has gone stale, so it is safe to run on every startup. Use the explicit `register` / `unregister` subcommands when changing extension IDs or clearing manifests.

## Tests

The test runner is Bun's built-in `bun test`. From the repo root:

```bash
bun test
```

Suites live in two places:

- `apps/mcp-server/src/*.test.ts` — the server side: native messaging protocol framing, browser detection, native-host HTTP, the stdio proxy, and registration.
- `apps/extension/test/*.test.ts` — the bookmark-mutation handlers, run against an in-memory `chrome.bookmarks` fake (no real browser needed).

To run one package's suite, scope `bun test` to its directory:

```bash
cd apps/mcp-server && bun test
cd apps/extension && bun test
```

Or a single file:

```bash
cd apps/mcp-server && bun test src/native-protocol.test.ts
```

## Type checking

```bash
# shared package
cd packages/shared && bun run typecheck

# server (no dedicated script yet; run tsc directly)
cd apps/mcp-server && bunx tsc --noEmit
```

## Where each process logs

Each process logs to a different place — knowing which is essential, because the most fragile process (the native host) logs where it is hardest to see.

| Process | Stream | Where to read it |
|---------|--------|------------------|
| **Process A — native host** (`native-host.ts`) | `process.stderr` | Spawned by the browser, so its stderr is **captured and largely discarded by Chrome**. This is the hardest process to observe; treat connection failures as host-side until proven otherwise. Lines include buffer-overflow resets, "Extension disconnected", and "HTTP server listening on 127.0.0.1:19420". |
| **Process C — stdio proxy** (`stdio-proxy.ts`) | `process.stderr` | `stdout` is reserved for MCP JSON-RPC, so all diagnostics go to stderr — surfaced in your AI client's MCP server log (e.g. Claude Code's MCP logs), or directly in your terminal when you run the proxy by hand. Lines include "MCP stdio proxy started." and "auto-register failed: ...". |
| **Browser extension service worker** (`background/index.ts`) | `console.log` / `warn` / `error`, prefixed `[BM-MCP]` | `chrome://extensions` -> the extension's **service worker** link -> DevTools Console. Lines include "Connected to native host", "Native host disconnected: ...", and "HTTP server started on port ...". |

When the chain is broken, walk it back-to-front: extension console first (did the SW connect?), then assume the native host (does `doctor` find the manifest? is port 19420 free?), then the proxy log.

## Conventions

- TypeScript only. Match the existing code style; no emoji in code or commit messages.
- Keep the wire protocol types in `packages/shared` as the source of truth.
- Do not commit secrets: the unpacked-dev `manifest.key`, any `.env`, or personal data. `.env.example` is the committed reference; `.env` is gitignored.
