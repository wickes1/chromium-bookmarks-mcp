#!/usr/bin/env bun
/**
 * Process A — Native Messaging Host + HTTP Server.
 * Spawned by the browser extension via chrome.runtime.connectNative().
 * stdin/stdout: Chrome native messaging binary protocol.
 * Also runs Bun.serve() on localhost:PORT for MCP stdio proxy (Process C) to connect to.
 */
import { NativeMessageType, DEFAULT_PORT, REQUEST_TIMEOUT_MS } from './types.js';
import type { NativeMessage, ToolCallPayload, ToolCallResponse } from './types.js';
import { encodeNativeMessage, decodeNativeMessages } from './native-protocol.js';

// --- State ---
let buffer = Buffer.alloc(0);
const pendingRequests = new Map<string, {
  resolve: (value: ToolCallResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// --- Native Messaging: write to stdout ---
function sendToExtension(msg: NativeMessage): void {
  const encoded = encodeNativeMessage(msg);
  process.stdout.write(encoded);
}

// --- Native Messaging: read from stdin ---
process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  const { messages, remaining } = decodeNativeMessages(buffer);
  buffer = Buffer.from(remaining);

  for (const raw of messages) {
    const msg = raw as NativeMessage;
    handleExtensionMessage(msg);
  }
});

process.stdin.on('end', () => {
  process.stderr.write('Extension disconnected, shutting down.\n');
  process.exit(0);
});

// --- Handle messages from extension ---
function handleExtensionMessage(msg: NativeMessage): void {
  if (msg.type === NativeMessageType.START) {
    startHttpServer(msg.payload as { port?: number });
    return;
  }

  if (msg.type === NativeMessageType.CALL_TOOL_RESPONSE && msg.responseToRequestId) {
    const pending = pendingRequests.get(msg.responseToRequestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.responseToRequestId);
      pending.resolve(msg.payload as ToolCallResponse);
    }
    return;
  }

  if (msg.type === NativeMessageType.PONG) {
    return;
  }
}

// --- Call a tool on the extension, wait for response ---
function callExtensionTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timer });

    const payload: ToolCallPayload = { toolName, args };
    sendToExtension({
      type: NativeMessageType.CALL_TOOL,
      requestId,
      payload,
    });
  });
}

// --- HTTP Server (Bun.serve) ---
let httpServer: ReturnType<typeof Bun.serve> | null = null;

function startHttpServer(config?: { port?: number }): void {
  const port = config?.port ?? DEFAULT_PORT;

  httpServer = Bun.serve({
    port,
    hostname: '127.0.0.1',

    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/health' && req.method === 'GET') {
        return Response.json({ status: 'ok', pendingRequests: pendingRequests.size });
      }

      if (url.pathname === '/call-tool' && req.method === 'POST') {
        let body: { toolName?: string; args?: Record<string, unknown> };
        try {
          body = await req.json();
        } catch {
          return Response.json({ status: 'error', error: 'Invalid JSON body' }, { status: 400 });
        }
        if (!body.toolName || typeof body.toolName !== 'string') {
          return Response.json({ status: 'error', error: 'toolName (string) is required' }, { status: 400 });
        }
        const args = (body.args && typeof body.args === 'object') ? body.args : {};
        try {
          const result = await callExtensionTool(body.toolName, args);
          return Response.json(result);
        } catch (err) {
          return Response.json(
            { status: 'error', error: (err as Error).message },
            { status: 500 }
          );
        }
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    },
  });

  sendToExtension({
    type: NativeMessageType.SERVER_STARTED,
    requestId: crypto.randomUUID(),
    payload: { port },
  });

  process.stderr.write(`HTTP server listening on 127.0.0.1:${port}\n`);
}
