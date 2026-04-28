<p align="center">
  <img src="apps/extension/public/icon.svg" width="128" height="128" alt="Chromium Bookmarks MCP">
</p>

<h1 align="center">Chromium Bookmarks MCP</h1>

<p align="center">
  <strong>Give AI agents real-time read/write access to your browser bookmarks via <a href="https://modelcontextprotocol.io/">Model Context Protocol</a>.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/chromium-bookmarks-mcp"><img src="https://img.shields.io/npm/v/chromium-bookmarks-mcp" alt="npm version"></a>
  <a href="https://chromewebstore.google.com/detail/chromium-bookmarks-mcp/ipcgfbbojaphhaoanjalmjmooeobjein"><img src="https://img.shields.io/badge/Chrome_Web_Store-published-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-compatible-blue" alt="MCP Compatible"></a>
</p>

<p align="center">
  Works with <strong>Claude Code</strong> &middot; <strong>Claude Desktop</strong> &middot; <strong>Cursor</strong> &middot; <strong>Windsurf</strong> &middot; <strong>VS Code Copilot</strong> &middot; and any MCP client<br>
  Supports <strong>Chrome</strong> &middot; <strong>Brave</strong> &middot; <strong>Edge</strong> &middot; <strong>Arc</strong> &middot; and any Chromium-based browser
</p>

---

## Quick Start

### 1. Install the Chrome extension

<a href="https://chromewebstore.google.com/detail/chromium-bookmarks-mcp/ipcgfbbojaphhaoanjalmjmooeobjein">
  <img src="https://img.shields.io/badge/Install_from-Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install from Chrome Web Store" height="48">
</a>

### 2. Install and register the MCP server

```bash
npx chromium-bookmarks-mcp register
```

### 3. Add to your AI client

**Claude Code:**
```bash
claude mcp add bookmarks -- npx chromium-bookmarks-mcp
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "bookmarks": {
      "command": "npx",
      "args": ["chromium-bookmarks-mcp"]
    }
  }
}
```

**Cursor / Windsurf / other MCP clients** — use the same command: `npx chromium-bookmarks-mcp`

### 4. Verify

Open your browser, click the extension icon — you should see a green dot and **Connected** status.

Then ask your AI agent:
```
Use the ping tool to check if bookmarks MCP is connected
```

> **Note:** Your browser must be open for the MCP tools to work. The extension communicates with the local MCP server process — no data leaves your machine.

## Features

**20 MCP tools** for complete bookmark management:

| Category | Tools |
|----------|-------|
| **Read** | `ping`, `bookmark_get_tree`, `bookmark_list`, `bookmark_search`, `bookmark_get`, `bookmark_count`, `bookmark_find_duplicates` |
| **Write** | `bookmark_create`, `bookmark_update`, `bookmark_move`, `bookmark_delete`, `bookmark_delete_folder` |
| **Batch** | `bookmark_batch_move`, `bookmark_merge_folders`, `bookmark_deduplicate`, `bookmark_batch_delete` |
| **Export/Import** | `bookmark_export_html`, `bookmark_import_html` |
| **Analysis** | `bookmark_check_dead_links` |

**Key capabilities:**
- Real-time operations while browser is open (no file manipulation)
- Folder path resolution (`"Bookmarks Bar > Tech > AI"`)
- Auto-create nested folders with `create_parents`
- Smart deduplication by URL
- Folder merge with optional dedup
- Dead link detection with HEAD/GET fallback
- Safety gates on destructive operations (`confirm: true` required)

## Architecture

Three-process design with HTTP bridge:

```
Claude Code / AI Agent
    | (MCP stdio JSON-RPC)
    v
MCP Stdio Proxy (Process C)        <- spawned by AI client
    | (HTTP to localhost:19420)
    v
Native Host + HTTP Server (Process A) <- spawned by browser extension
    | (Chrome Native Messaging)
    v
Browser Extension (Service Worker)
    | (chrome.bookmarks API)
    v
Browser Bookmarks
```

## Tool Reference

### Read Tools

**`ping`** — Check if the extension is connected and responsive.

**`bookmark_get_tree`** — Get the bookmark tree structure.
- `folder_id` (optional) — Get subtree of a specific folder
- `depth` (optional, default: 2) — Max depth to return. Use `0` for unlimited.

**`bookmark_list`** — List bookmarks in a folder (non-recursive).
- `folder_id` (optional) — Folder to list. Default: root.
- `limit` / `offset` — Pagination.

**`bookmark_search`** — Full-text search across titles and URLs.
- `query` — Search text
- `folder_id` or `folder_path` — Scope search (e.g., `"Bookmarks Bar > Tech"`)
- `limit` (optional, default: 50)

**`bookmark_get`** — Get a single bookmark/folder by ID with folder path.

**`bookmark_count`** — Count bookmarks and folders, optionally scoped.

**`bookmark_find_duplicates`** — Find bookmarks with duplicate URLs.

### Write Tools

**`bookmark_create`** — Create a bookmark or folder.
- `title` — Required
- `url` — Omit to create a folder
- `parent_id` or `parent_path` + `create_parents: true` — Auto-create nested folders

**`bookmark_update`** — Update title or URL.

**`bookmark_move`** — Move to a different parent folder.

**`bookmark_delete`** — Delete a single bookmark. Root folders protected.

**`bookmark_delete_folder`** — Delete a folder and all contents. Requires `confirm: true`.

### Batch Tools

**`bookmark_batch_move`** — Move multiple bookmarks at once.

**`bookmark_merge_folders`** — Merge source folder into target.
- `deduplicate` — Skip bookmarks that already exist in target (by URL)
- `delete_source` — Remove source folder after merge

**`bookmark_deduplicate`** — Remove duplicate bookmarks (same URL).
- `keep` — `'first'` or `'last'`

**`bookmark_batch_delete`** — Delete multiple bookmarks by IDs.

### Export/Import

**`bookmark_export_html`** — Export as Netscape Bookmark HTML format.

**`bookmark_import_html`** — Import from Netscape Bookmark HTML.

### Analysis

**`bookmark_check_dead_links`** — Check URLs for broken links (HTTP HEAD with GET fallback).
- `limit` (default: 50) — Max bookmarks to check
- `timeout_ms` (default: 5000) — Request timeout

## CLI Commands

```bash
npx chromium-bookmarks-mcp              # Start MCP stdio proxy (default)
npx chromium-bookmarks-mcp register     # Register native host for detected browsers
npx chromium-bookmarks-mcp register ID  # Register with specific extension ID
npx chromium-bookmarks-mcp unregister   # Remove native host registration
npx chromium-bookmarks-mcp doctor       # Diagnose connection issues
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension shows "Disconnected" | Make sure you ran `npx chromium-bookmarks-mcp register` and restarted your browser |
| `register` doesn't detect browser | Pass the extension ID manually: `npx chromium-bookmarks-mcp register <ID>` |
| MCP tools timeout | Ensure your browser is open and the extension is enabled |
| Port 19420 conflict | Another instance may be running. Check with `lsof -i :19420` |
| Tools work but return empty | Your browser may need bookmarks — try creating one manually first |

For deeper diagnostics, run:
```bash
npx chromium-bookmarks-mcp doctor
```

## Supported Browsers

| Browser | macOS | Linux | Windows |
|---------|-------|-------|---------|
| Chrome | Yes | Yes | Yes |
| Brave | Yes | Yes | Yes |
| Edge | Yes | Yes | Yes |
| Arc | Yes | - | - |
| Chromium | Yes | Yes | - |

## Development

### Prerequisites

- [Bun](https://bun.sh/) 1.2+
- A Chromium browser

### Project Structure

```
chromium-bookmarks-mcp/
├── packages/shared/          # Shared types and constants
├── apps/extension/           # Browser extension (WXT + TypeScript)
│   └── entrypoints/
│       ├── background/       # Service worker + tool handlers
│       ├── offscreen/        # Keepalive for MV3
│       └── popup/            # Connection status UI
└── apps/mcp-server/          # MCP server + native host
    ├── src/
    │   ├── index.ts          # CLI entry point
    │   ├── native-host.ts    # Process A: native messaging + HTTP
    │   ├── stdio-proxy.ts    # Process C: MCP stdio proxy
    │   ├── native-protocol.ts # Chrome binary protocol
    │   ├── browsers.ts       # Browser detection
    │   └── register.ts       # Native host registration
    └── bin/run_host.sh       # Shell wrapper for native host
```

### Commands

```bash
bun install                    # Install all dependencies
bun test                       # Run tests
cd apps/extension && bun run wxt dev    # Dev mode (hot reload)
cd apps/extension && bun run wxt build  # Production build
```

## Security & Privacy

- Only 3 permissions: `bookmarks`, `nativeMessaging`, `offscreen`
- All communication is localhost only (`127.0.0.1`)
- No analytics, no telemetry, no external network calls
- No data leaves your machine
- Root folder deletion protected
- Destructive batch operations require explicit confirmation
- Full [Privacy Policy](privacy-policy.md)

## License

[MIT](LICENSE)
