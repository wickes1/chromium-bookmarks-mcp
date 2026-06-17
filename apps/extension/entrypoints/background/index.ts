/** Extension service worker — manages native messaging connection and tool dispatch. */
import { NATIVE_HOST_NAME, NativeMessageType, DEFAULT_PORT } from '@chromium-bookmarks-mcp/shared';
import type { NativeMessage, ToolCallPayload, ToolCallResponse } from '@chromium-bookmarks-mcp/shared';
import { handlePing } from './handlers/ping.js';
import { handleGetTree, handleList, handleSearch, handleGet, handleCount, handleFindDuplicates, handleExportHtml, handleCheckDeadLinks } from './handlers/read.js';
import { handleCreate, handleUpdate, handleMove, handleDelete, handleDeleteFolder, handleImportHtml } from './handlers/write.js';
import { handleBatchMove, handleMergeFolders, handleDeduplicate, handleBatchDelete } from './handlers/batch.js';
import { acquireKeepalive, releaseKeepalive } from './keepalive.js';

// The set of message types the native host is allowed to send us. Used to
// validate inbound messages before they reach a handler (SEC-3).
const INBOUND_NATIVE_TYPES = new Set<NativeMessageType>([
  NativeMessageType.SERVER_STARTED,
  NativeMessageType.CALL_TOOL,
  NativeMessageType.PONG,
]);

export default defineBackground(() => {
  // Explicit connection state so a second connect() while one is already in
  // flight is a no-op, instead of opening a duplicate native port (ARCH-6).
  type ConnState = 'disconnected' | 'connecting' | 'connected';
  let state: ConnState = 'disconnected';
  let port: chrome.runtime.Port | null = null;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  // Consecutive failed connect attempts; drives exponential backoff (PERF-3).
  let reconnectAttempts = 0;
  // Last disconnect/handshake error, surfaced to the popup via get-status (DX-6).
  let lastError: string | null = null;

  // Backoff: base 1s, doubled per attempt, capped at 30s, plus up to 1s jitter
  // so many extensions don't reconnect in lockstep.
  const BACKOFF_BASE_MS = 1000;
  const BACKOFF_CAP_MS = 30_000;
  const BACKOFF_JITTER_MS = 1000;
  // If START is sent but SERVER_STARTED never arrives, give up and reconnect.
  const HANDSHAKE_TIMEOUT_MS = 10_000;

  function clearHandshakeTimer(): void {
    if (handshakeTimer) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  }

  function teardownPort(): void {
    if (port) {
      try { port.disconnect(); } catch { /* already gone */ }
      port = null;
    }
  }

  function connect(): void {
    // Idempotent: never open a second port while connecting or connected.
    if (state === 'connecting' || state === 'connected') return;

    state = 'connecting';
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      console.log('[BM-MCP] Connecting to native host');

      port.onMessage.addListener((msg: NativeMessage) => {
        handleNativeMessage(msg);
      });

      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message ?? 'unknown';
        console.warn(`[BM-MCP] Native host disconnected: ${error}`);
        lastError = error;
        port = null;
        state = 'disconnected';
        clearHandshakeTimer();
        releaseKeepalive();
        scheduleReconnect();
      });

      port.postMessage({
        type: NativeMessageType.START,
        requestId: crypto.randomUUID(),
        payload: { port: DEFAULT_PORT },
      } satisfies NativeMessage);

      // Wait for SERVER_STARTED. If it never comes, the host is wedged — tear
      // the port down and let the disconnect/backoff path retry.
      clearHandshakeTimer();
      handshakeTimer = setTimeout(() => {
        handshakeTimer = null;
        if (state === 'connecting') {
          console.warn('[BM-MCP] Handshake timed out (no SERVER_STARTED)');
          lastError = 'handshake timeout: native host did not start the server';
          // Disconnecting fires onDisconnect, which transitions + schedules.
          teardownPort();
          if (state === 'connecting') {
            // No onDisconnect fired (defensive); transition manually.
            state = 'disconnected';
            scheduleReconnect();
          }
        }
      }, HANDSHAKE_TIMEOUT_MS);
    } catch (err) {
      console.error('[BM-MCP] Failed to connect:', err);
      lastError = (err as Error).message;
      port = null;
      state = 'disconnected';
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** reconnectAttempts, BACKOFF_CAP_MS);
    const delay = backoff + Math.floor(Math.random() * BACKOFF_JITTER_MS);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  async function handleNativeMessage(msg: NativeMessage): Promise<void> {
    // SEC-3: validate the inbound message shape before dispatch. The native
    // host is a separate process and the port is independently reachable, so
    // this boundary cannot rely on the proxy's schemas.
    if (!msg || typeof msg !== 'object' || typeof msg.requestId !== 'string' || !INBOUND_NATIVE_TYPES.has(msg.type)) {
      console.warn('[BM-MCP] Dropping malformed native message:', msg);
      return;
    }

    if (msg.type === NativeMessageType.SERVER_STARTED) {
      console.log('[BM-MCP] HTTP server started on port', (msg.payload as { port: number }).port);
      state = 'connected';
      reconnectAttempts = 0;
      lastError = null;
      clearHandshakeTimer();
      acquireKeepalive();
      return;
    }

    if (msg.type === NativeMessageType.CALL_TOOL) {
      // SEC-3: validate the tool-call payload before handing args to a handler.
      const payload = msg.payload as Partial<ToolCallPayload> | undefined;
      if (!payload || typeof payload.toolName !== 'string' || typeof payload.args !== 'object' || payload.args === null) {
        port?.postMessage({
          type: NativeMessageType.CALL_TOOL_RESPONSE,
          requestId: crypto.randomUUID(),
          responseToRequestId: msg.requestId,
          payload: { status: 'error', error: 'invalid CALL_TOOL payload: expected { toolName: string, args: object }', code: 'BAD_REQUEST' },
        } satisfies NativeMessage);
        return;
      }

      const { toolName, args } = payload as ToolCallPayload;
      let response: ToolCallResponse;

      try {
        switch (toolName) {
          case 'ping':
            response = await handlePing();
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
          case 'bookmark_create':
            response = await handleCreate(args);
            break;
          case 'bookmark_update':
            response = await handleUpdate(args);
            break;
          case 'bookmark_move':
            response = await handleMove(args);
            break;
          case 'bookmark_delete':
            response = await handleDelete(args);
            break;
          case 'bookmark_delete_folder':
            response = await handleDeleteFolder(args);
            break;
          case 'bookmark_batch_move':
            response = await handleBatchMove(args);
            break;
          case 'bookmark_merge_folders':
            response = await handleMergeFolders(args);
            break;
          case 'bookmark_deduplicate':
            response = await handleDeduplicate(args);
            break;
          case 'bookmark_batch_delete':
            response = await handleBatchDelete(args);
            break;
          case 'bookmark_export_html':
            response = await handleExportHtml(args);
            break;
          case 'bookmark_import_html':
            response = await handleImportHtml(args);
            break;
          case 'bookmark_check_dead_links':
            response = await handleCheckDeadLinks(args);
            break;
          default:
            response = { status: 'error', error: `Unknown tool: ${toolName}`, code: 'BAD_REQUEST' };
        }
      } catch (err) {
        response = { status: 'error', error: (err as Error).message, code: 'TOOL_ERROR' };
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
    connect();
  });

  chrome.runtime.onInstalled.addListener(() => {
    connect();
  });

  // Handle keepalive pings from offscreen document
  chrome.runtime.onConnect.addListener((p) => {
    if (p.name === 'keepalive') {
      p.onMessage.addListener(() => {
        // Receiving the message keeps the SW alive
      });
    }
  });

  // Handle status queries and manual reconnects from popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'get-status') {
      // No connect() side-effect here — status is read-only (ARCH-6). The SW's
      // own lifecycle (connect on load / onStartup / onInstalled / reconnect
      // backoff) owns the connection; force-reconnect is the manual lever.
      sendResponse({
        connected: state === 'connected',
        connecting: state === 'connecting',
        port: DEFAULT_PORT,
        lastError,
      });
      return true;
    }

    if (msg.type === 'get-identity') {
      // Browser + profile + bookmark count for the popup (PROD-4). Reuses the
      // ping handler so the identity shown matches what agents see over MCP.
      handlePing()
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ status: 'error', error: (err as Error).message }));
      return true;
    }

    if (msg.type === 'force-reconnect') {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearHandshakeTimer();
      teardownPort();
      state = 'disconnected';
      reconnectAttempts = 0;
      lastError = null;
      connect();
      sendResponse({ ok: true });
      return true;
    }
  });
});
