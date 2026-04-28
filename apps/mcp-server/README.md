# Chromium Bookmarks MCP

> Give AI agents real-time read/write access to your browser bookmarks via [Model Context Protocol](https://modelcontextprotocol.io/).

[![npm version](https://img.shields.io/npm/v/chromium-bookmarks-mcp)](https://www.npmjs.com/package/chromium-bookmarks-mcp)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-published-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/chromium-bookmarks-mcp/ipcgfbbojaphhaoanjalmjmooeobjein)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Works with **Claude Code**, **Claude Desktop**, **Cursor**, **Windsurf**, **VS Code Copilot**, and any MCP client.
Supports **Chrome**, **Brave**, **Edge**, **Arc**, and any Chromium-based browser.

---

## Quick Start

**1. Install [Bun](https://bun.sh) 1.2+** (required to run the server):

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

**2. Install the [Chrome extension](https://chromewebstore.google.com/detail/chromium-bookmarks-mcp/ipcgfbbojaphhaoanjalmjmooeobjein).**

**3. Add to your AI client:**

```bash
# Claude Code
claude mcp add bookmarks -- npx chromium-bookmarks-mcp
```

Or in `claude_desktop_config.json` / Cursor / Windsurf:

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

The server auto-registers itself as a native messaging host on first run (including Windows registry keys). No manual setup.

**4. Open your browser, click the extension icon to activate**, then ask your agent: *"Use the ping tool to check if bookmarks MCP is connected."*

## What you get

**20 MCP tools** covering read, write, batch, export/import, and dead-link analysis — full list and tool reference on [GitHub](https://github.com/Wickes1/chromium-bookmarks-mcp#features).

## CLI

```bash
npx chromium-bookmarks-mcp              # Start MCP stdio proxy (default)
npx chromium-bookmarks-mcp register     # Re-register native host
npx chromium-bookmarks-mcp doctor       # Diagnose connection issues
npx chromium-bookmarks-mcp unregister   # Remove native host registration
```

## Privacy

All communication is localhost-only (`127.0.0.1`). No analytics, no telemetry, no external network calls. No data leaves your machine. See [privacy policy](https://github.com/Wickes1/chromium-bookmarks-mcp/blob/main/privacy-policy.md).

## Links

- **Full documentation:** [github.com/Wickes1/chromium-bookmarks-mcp](https://github.com/Wickes1/chromium-bookmarks-mcp#readme)
- **Issues:** [github.com/Wickes1/chromium-bookmarks-mcp/issues](https://github.com/Wickes1/chromium-bookmarks-mcp/issues)
- **Releases:** [github.com/Wickes1/chromium-bookmarks-mcp/releases](https://github.com/Wickes1/chromium-bookmarks-mcp/releases)

## License

[MIT](https://github.com/Wickes1/chromium-bookmarks-mcp/blob/main/LICENSE)
