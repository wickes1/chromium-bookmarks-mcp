# Privacy Policy

**Chromium Bookmarks MCP** does not collect, store, or transmit any user data.

## Data Handling

- All bookmark operations are performed locally within your browser
- The extension communicates only with a local process on your machine via Chrome Native Messaging
- No data is sent to external servers, third parties, or analytics services
- No personally identifiable information is collected
- No cookies or tracking mechanisms are used

## Permissions

| Permission | Purpose |
|------------|---------|
| `bookmarks` | Read and modify bookmarks in response to user-initiated MCP tool calls |
| `nativeMessaging` | Communicate with the local MCP server process |
| `offscreen` | Keep the service worker alive during active native messaging connections |

## Network Requests

The extension makes no network requests except when the user explicitly invokes the "Check Dead Links" tool, which sends HTTP HEAD requests to bookmark URLs to verify availability. Only the HTTP status code is checked — no bookmark data is transmitted.

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/wickes1/chromium-bookmarks-mcp/issues

*Last updated: 2026-04-27*
