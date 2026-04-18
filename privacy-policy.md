# Privacy Policy — Chromium Bookmarks MCP

**Last updated:** April 2026

## Overview

Chromium Bookmarks MCP is a browser extension and companion MCP server that gives AI agents read/write access to your browser bookmarks. This privacy policy explains how your data is handled.

## Data Collection

**We do not collect any data.** Specifically:

- No bookmark data is transmitted to external servers
- No analytics or telemetry is collected
- No cookies or tracking mechanisms are used
- No user accounts are required
- No data is shared with third parties

## How Your Data is Used

All bookmark data stays entirely on your local machine. The data flow is:

1. The browser extension reads/writes bookmarks using Chrome's `chrome.bookmarks` API
2. Bookmark data is sent to a **local** native messaging host process via Chrome's Native Messaging protocol
3. The native messaging host runs an HTTP server bound to `127.0.0.1` (localhost only) — it is **not accessible from the network**
4. An MCP server process connects to this localhost HTTP server to serve tool calls to AI agents running on your machine

**No bookmark data ever leaves your computer.**

## Network Requests

The extension makes **no external network requests** except when you explicitly use the `bookmark_check_dead_links` tool, which sends HTTP HEAD/GET requests to the URLs stored in your bookmarks to verify they are still accessible. These requests go directly to the bookmark URLs — no proxy or intermediary is used.

## Permissions

The extension requests three permissions:

| Permission | Purpose |
|-----------|---------|
| `bookmarks` | Read and write browser bookmarks |
| `nativeMessaging` | Communicate with the local MCP server process |
| `offscreen` | Keep the service worker alive for persistent native messaging connection |

No other permissions are requested. The extension cannot access your browsing history, tabs, or any other browser data.

## Data Storage

The extension stores no data of its own. It only accesses bookmarks through Chrome's built-in `chrome.bookmarks` API, which stores data in the browser's standard bookmark storage.

## Open Source

This project is open source. You can inspect the full source code to verify these claims:
https://github.com/Wickes1/chromium-bookmarks-mcp

## Contact

For privacy-related questions, please open an issue on GitHub:
https://github.com/Wickes1/chromium-bookmarks-mcp/issues
