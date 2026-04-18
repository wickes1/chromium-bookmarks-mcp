# Chrome Web Store Listing

## Name
Chromium Bookmarks MCP

## Short Description (132 chars max)
Give AI agents real-time read/write access to your browser bookmarks via Model Context Protocol (MCP).

## Detailed Description

Chromium Bookmarks MCP connects your browser bookmarks to AI agents (like Claude) through the Model Context Protocol (MCP). It provides 19 tools for complete bookmark management — all running locally on your machine.

**What it does:**
- Read, search, and browse your bookmark tree
- Create, move, update, and delete bookmarks
- Merge folders, deduplicate bookmarks, batch operations
- Export/import bookmarks as HTML
- Check for dead/broken bookmark links
- All operations happen in real-time while your browser is open

**How it works:**
1. This extension connects to a local MCP server via Chrome's Native Messaging
2. AI agents interact with the MCP server to manage your bookmarks
3. All data stays on your machine — nothing is sent to external servers

**Requirements:**
- Bun runtime (https://bun.sh)
- chromium-bookmarks-mcp npm package
- An MCP-compatible AI agent (Claude Code, etc.)

**Privacy:**
- Only 3 permissions: bookmarks, nativeMessaging, offscreen
- No data collection, no analytics, no tracking
- All communication is localhost only
- Full source code available on GitHub

## Category
Productivity

## Language
English

## Privacy Policy URL
https://github.com/Wickes1/chromium-bookmarks-mcp/blob/main/privacy-policy.md
