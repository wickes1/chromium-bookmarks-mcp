# chromium-bookmarks-mcp

Give AI agents real-time read/write access to your Chromium browser bookmarks via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

Works with **Brave**, **Chrome**, **Edge**, **Arc**, and any Chromium-based browser.

## Features

**19 MCP tools** for complete bookmark management:

| Category | Tools |
|----------|-------|
| **Read** | `ping`, `bookmark_get_tree`, `bookmark_list`, `bookmark_search`, `bookmark_get`, `bookmark_count`, `bookmark_find_duplicates` |
| **Write** | `bookmark_create`, `bookmark_update`, `bookmark_move`, `bookmark_delete`, `bookmark_delete_folder` |
| **Batch** | `bookmark_batch_move`, `bookmark_merge_folders`, `bookmark_deduplicate`, `bookmark_batch_delete` |
| **Export/Import** | `bookmark_export_html`, `bookmark_import_html` |
| **Analysis** | `bookmark_check_dead_links` |

**Key capabilities:**
- Real-time operations while browser is open (no file manipulation)
- Folder path resolution (`bookmark_search` supports `folder_path` like `"Bookmarks Bar > Tech > AI"`)
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
MCP Stdio Proxy (Process C)        <- spawned by Claude Code
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

## Installation

### 1. Install the browser extension

**From source (development):**

```bash
git clone https://github.com/Wickes1/chromium-bookmarks-mcp.git
cd chromium-bookmarks-mcp
bun install
cd apps/extension && bun run wxt build
```

Then load the unpacked extension:
1. Open `brave://extensions/` (or `chrome://extensions/`)
2. Enable **Developer mode**
3. Click **Load unpacked** -> select `apps/extension/.output/chrome-mv3/`
4. Note the **Extension ID**

### 2. Install the MCP server

```bash
# From source
bun install
```

### 3. Register the native messaging host

```bash
cd apps/mcp-server
bun run src/index.ts register <YOUR_EXTENSION_ID>
```

This registers the native messaging host manifest for all detected Chromium browsers.

### 4. Connect to Claude Code

```bash
claude mcp add bookmarks -- bun run /path/to/chromium-bookmarks-mcp/apps/mcp-server/src/index.ts
```

### 5. Verify

Open your browser, click the extension icon — should show **Connected** with a green dot.

In Claude Code:
```
Use the ping tool to check if bookmarks MCP is connected
```

## CLI Commands

```bash
bun run apps/mcp-server/src/index.ts              # Start MCP stdio proxy (default)
bun run apps/mcp-server/src/index.ts register      # Register native host for detected browsers
bun run apps/mcp-server/src/index.ts register ID   # Register with specific extension ID
bun run apps/mcp-server/src/index.ts unregister    # Remove native host registration
bun run apps/mcp-server/src/index.ts doctor        # Diagnose connection issues
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

## Development

### Prerequisites

- [Bun](https://bun.sh/) 1.2+
- A Chromium browser (Brave, Chrome, Edge, etc.)

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
    │   ├── browsers.ts       # Browser detection (macOS/Linux/Windows)
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

## Supported Browsers

| Browser | macOS | Linux | Windows |
|---------|-------|-------|---------|
| Chrome | Yes | Yes | Yes |
| Brave | Yes | Yes | Yes |
| Edge | Yes | Yes | Yes |
| Arc | Yes | - | - |
| Chromium | Yes | Yes | - |

## License

[MIT](LICENSE)
