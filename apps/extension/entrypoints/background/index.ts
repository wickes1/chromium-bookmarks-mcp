import { NATIVE_HOST_NAME, NativeMessageType, DEFAULT_PORT } from '@chromium-bookmarks-mcp/shared';
import type { NativeMessage, ToolCallPayload, ToolCallResponse } from '@chromium-bookmarks-mcp/shared';
import { handlePing } from './handlers/ping.js';
import { handleGetTree, handleList, handleSearch, handleGet, handleCount, handleFindDuplicates } from './handlers/read.js';
import { acquireKeepalive, releaseKeepalive } from './keepalive.js';

export default defineBackground(() => {
  let port: chrome.runtime.Port | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const RECONNECT_DELAY_MS = 3000;

  function connect(): void {
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      console.log('[BM-MCP] Connected to native host');

      acquireKeepalive();

      port.onMessage.addListener((msg: NativeMessage) => {
        handleNativeMessage(msg);
      });

      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message ?? 'unknown';
        console.warn(`[BM-MCP] Native host disconnected: ${error}`);
        port = null;
        releaseKeepalive();
        scheduleReconnect();
      });

      port.postMessage({
        type: NativeMessageType.START,
        requestId: crypto.randomUUID(),
        payload: { port: DEFAULT_PORT },
      } satisfies NativeMessage);
    } catch (err) {
      console.error('[BM-MCP] Failed to connect:', err);
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  async function handleNativeMessage(msg: NativeMessage): Promise<void> {
    if (msg.type === NativeMessageType.SERVER_STARTED) {
      console.log('[BM-MCP] HTTP server started on port', (msg.payload as { port: number }).port);
      return;
    }

    if (msg.type === NativeMessageType.CALL_TOOL) {
      const { toolName, args } = msg.payload as ToolCallPayload;
      let response: ToolCallResponse;

      try {
        switch (toolName) {
          case 'ping':
            response = handlePing();
            break;
          case 'bookmark_get_tree':
            response = await handleGetTree(args);
            break;
          case 'bookmark_list':
            response = await handleList(args);
            break;
          case 'bookmark_search':
            response = await handleSearch(args);
            break;
          case 'bookmark_get':
            response = await handleGet(args);
            break;
          case 'bookmark_count':
            response = await handleCount(args);
            break;
          case 'bookmark_find_duplicates':
            response = await handleFindDuplicates(args);
            break;
          default:
            response = { status: 'error', error: `Unknown tool: ${toolName}` };
        }
      } catch (err) {
        response = { status: 'error', error: (err as Error).message };
      }

      port?.postMessage({
        type: NativeMessageType.CALL_TOOL_RESPONSE,
        requestId: crypto.randomUUID(),
        responseToRequestId: msg.requestId,
        payload: response,
      } satisfies NativeMessage);
      return;
    }
  }

  connect();

  chrome.runtime.onStartup.addListener(() => {
    if (!port) connect();
  });

  chrome.runtime.onInstalled.addListener(() => {
    if (!port) connect();
  });

  // Handle keepalive pings from offscreen document
  chrome.runtime.onConnect.addListener((p) => {
    if (p.name === 'keepalive') {
      p.onMessage.addListener(() => {
        // Receiving the message keeps the SW alive
      });
    }
  });

  // Handle status queries from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'get-status') {
      sendResponse({ connected: port !== null });
      return true;
    }
  });
});
