#!/usr/bin/env bun
/**
 * Process A — Native Messaging Host + HTTP Server.
 * Spawned by the browser extension via chrome.runtime.connectNative().
 * stdin/stdout: Chrome native messaging binary protocol.
 * Also runs Bun.serve() on localhost:PORT for MCP stdio proxy (Process C) to connect to.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  NativeMessageType,
  DEFAULT_PORT,
  EXTENSION_OP_TIMEOUT_MS,
  AUTH_TOKEN_HEADER,
  authTokenPath,
} from './types.js';
import type { NativeMessage, ToolCallPayload, ToolCallResponse } from './types.js';
import { encodeNativeMessage, decodeNativeMessages } from './native-protocol.js';

// --- State ---
const MAX_BUFFER_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_PENDING_REQUESTS = 100;
const MIN_PORT = 1;
const MAX_PORT = 65535;

// stdin chunks are accumulated in this list and concatenated only once a full
// frame is available (PERF-2: avoids O(n^2) Buffer.concat of the whole tail on
// every chunk). `bufferedBytes` tracks the total so the overflow guard stays cheap.
let chunks: Buffer[] = [];
let bufferedBytes = 0;

export interface PendingRequest {
  resolve: (value: ToolCallResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingRequests = new Map<string, PendingRequest>();

// --- In-memory auth token for the localhost control plane (SEC-1) ---
let authToken = '';

// --- Opt-in file logger (DX-2): no-op unless BOOKMARKS_MCP_LOG is set ---
const logFilePath = process.env.BOOKMARKS_MCP_LOG;

function logLine(line: string): void {
  // Always mirror to stderr (existing behavior); additionally append to the log
  // file when BOOKMARKS_MCP_LOG points somewhere writable.
  process.stderr.write(`${line}\n`);
  if (!logFilePath) return;
  try {
    appendFileSync(logFilePath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must never crash the host; swallow file errors silently.
  }
}

// --- Native Messaging: write to stdout ---
function sendToExtension(msg: NativeMessage): void {
  const encoded = encodeNativeMessage(msg);
  process.stdout.write(encoded);
}

// --- Native Messaging: read from stdin ---
function onStdinData(chunk: Buffer<ArrayBuffer>): void {
  chunks.push(chunk);
  bufferedBytes += chunk.length;

  if (bufferedBytes > MAX_BUFFER_SIZE) {
    logLine(`Buffer overflow: ${bufferedBytes} bytes, resetting.`);
    chunks = [];
    bufferedBytes = 0;
    return;
  }

  // Concatenate once (only when more than one chunk is buffered) and decode all
  // complete frames. Any partial tail is retained as a single Buffer with no
  // additional copy of the already-decoded prefix.
  const buffer = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, bufferedBytes);
  const { messages, remaining } = decodeNativeMessages(buffer);

  if (remaining.length === 0) {
    chunks = [];
    bufferedBytes = 0;
  } else {
    chunks = [remaining];
    bufferedBytes = remaining.length;
  }

  for (const raw of messages) {
    handleExtensionMessage(raw as NativeMessage);
  }
}

function startNativeMessaging(): void {
  process.stdin.on('data', onStdinData);
  process.stdin.on('end', () => {
    logLine('Extension disconnected, shutting down.');
    process.exit(0);
  });
}

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

// --- Dispatch lifecycle (extracted for testability, TEST-2) ---
// Registers a pending entry in `map`, arms a timeout that deletes the entry and
// rejects (so a timed-out request never leaks into the map), and fires `send`.
// Uses EXTENSION_OP_TIMEOUT_MS (the innermost budget) so the extension dispatch
// fails before the host's REQUEST_TIMEOUT_MS and the proxy fetch deadline (ARCH-5).
export function dispatchToolCall(
  map: Map<string, PendingRequest>,
  requestId: string,
  send: (requestId: string) => void,
  timeoutMs: number = EXTENSION_OP_TIMEOUT_MS,
): Promise<ToolCallResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.delete(requestId);
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    map.set(requestId, { resolve, reject, timer });
    send(requestId);
  });
}

// --- Call a tool on the extension, wait for response ---
function callExtensionTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
  const requestId = crypto.randomUUID();
  return dispatchToolCall(pendingRequests, requestId, (id) => {
    const payload: ToolCallPayload = { toolName, args };
    sendToExtension({
      type: NativeMessageType.CALL_TOOL,
      requestId: id,
      payload,
    });
  });
}

// --- Auth (SEC-1) ---
// Generate a per-session token and persist it 0600 before the HTTP server binds,
// so the proxy can only ever read a token the host already trusts.
export function initAuthToken(): string {
  authToken = crypto.randomUUID();
  const tokenPath = authTokenPath();
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, authToken, { mode: 0o600 });
  return authToken;
}

// --- Request handling (extracted for testability, TEST-2) ---

export interface CallToolDeps {
  authToken: string;
  pendingCount: () => number;
  maxPending: number;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<ToolCallResponse>;
}

/**
 * Pure handler for POST /call-tool. Returns a plain { body, status } pair so it
 * can be unit-tested without standing up a real HTTP server. Enforces:
 *   - token auth (SEC-1): 401 UNAUTHORIZED on mismatch/absent
 *   - backpressure (CORR-6): 503 BACKPRESSURE at maxPending
 *   - body validation (CORR-6): 400 BAD_REQUEST on bad JSON / missing toolName
 *   - tool errors (CORR-6): 500 TOOL_ERROR
 */
export async function handleCallTool(
  headerToken: string | null,
  parseBody: () => Promise<unknown>,
  deps: CallToolDeps,
): Promise<{ body: ToolCallResponse; status: number }> {
  if (!deps.authToken || headerToken !== deps.authToken) {
    return { body: { status: 'error', error: 'unauthorized', code: 'UNAUTHORIZED' }, status: 401 };
  }

  if (deps.pendingCount() >= deps.maxPending) {
    return {
      body: { status: 'error', error: 'Too many pending requests', code: 'BACKPRESSURE' },
      status: 503,
    };
  }

  let body: unknown;
  try {
    body = await parseBody();
  } catch {
    return { body: { status: 'error', error: 'Invalid JSON body', code: 'BAD_REQUEST' }, status: 400 };
  }

  const parsed = body as { toolName?: unknown; args?: unknown };
  if (!parsed.toolName || typeof parsed.toolName !== 'string') {
    return {
      body: { status: 'error', error: 'toolName (string) is required', code: 'BAD_REQUEST' },
      status: 400,
    };
  }

  const args = (parsed.args && typeof parsed.args === 'object')
    ? (parsed.args as Record<string, unknown>)
    : {};

  try {
    const result = await deps.callTool(parsed.toolName, args);
    return { body: result, status: 200 };
  } catch (err) {
    return {
      body: { status: 'error', error: (err as Error).message, code: 'TOOL_ERROR' },
      status: 500,
    };
  }
}

// --- Port validation (SEC-4) ---
// The START payload comes from the (untrusted) extension; only honor a sane
// integer port, otherwise fall back to the host-controlled DEFAULT_PORT.
export function resolvePort(payloadPort?: number): number {
  if (
    typeof payloadPort === 'number' &&
    Number.isInteger(payloadPort) &&
    payloadPort >= MIN_PORT &&
    payloadPort <= MAX_PORT
  ) {
    return payloadPort;
  }
  return DEFAULT_PORT;
}

// --- HTTP Server (Bun.serve) ---
let httpServer: ReturnType<typeof Bun.serve> | null = null;

function buildServer(port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',

    async fetch(req) {
      const url = new URL(req.url);

      // /health stays UNAUTHENTICATED (SEC-1) so the proxy / doctor can probe it.
      if (url.pathname === '/health' && req.method === 'GET') {
        return Response.json({ status: 'ok', pendingRequests: pendingRequests.size });
      }

      if (url.pathname === '/call-tool' && req.method === 'POST') {
        const { body, status } = await handleCallTool(
          req.headers.get(AUTH_TOKEN_HEADER),
          () => req.json(),
          {
            authToken,
            pendingCount: () => pendingRequests.size,
            maxPending: MAX_PENDING_REQUESTS,
            callTool: callExtensionTool,
          },
        );
        return Response.json(body, { status });
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    },
  });
}

// Probe an existing listener to decide whether it is one of our own instances.
// Returns true only when /health responds with this server's shape.
async function isOurHealthyInstance(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    const body = await res.json() as { status?: unknown; pendingRequests?: unknown };
    return body.status === 'ok' && typeof body.pendingRequests === 'number';
  } catch {
    return false;
  }
}

function startHttpServer(config?: { port?: number }): void {
  const port = resolvePort(config?.port);

  try {
    httpServer = buildServer(port);
  } catch (err) {
    // DX-3 / PROD-3: a port conflict (second browser, or a stale instance) must
    // not crash with an opaque stack trace and an unreachable reconnect loop.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      void isOurHealthyInstance(port).then((authoritative) => {
        if (authoritative) {
          // An existing instance already owns the port and speaks our protocol.
          // Treat it as authoritative and still report SERVER_STARTED so the
          // extension stops retrying.
          logLine(`Port ${port} already serving a healthy chromium-bookmarks-mcp instance; deferring to it.`);
          sendToExtension({
            type: NativeMessageType.SERVER_STARTED,
            requestId: crypto.randomUUID(),
            payload: { port },
          });
        } else {
          logLine(
            `Port ${port} is in use by another process. ` +
            `Close the other program (or the other Chromium browser) using 127.0.0.1:${port} and reconnect.`,
          );
          process.exit(1);
        }
      });
      return;
    }

    logLine(`Failed to start HTTP server on 127.0.0.1:${port}: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  sendToExtension({
    type: NativeMessageType.SERVER_STARTED,
    requestId: crypto.randomUUID(),
    payload: { port },
  });

  logLine(`HTTP server listening on 127.0.0.1:${port}`);
}

// --- Entrypoint ---
// Only run side effects (token generation, stdin wiring) when executed directly
// as the native host; staying inert on import keeps the module unit-testable.
if (import.meta.main) {
  // Generate the auth token up front, before any START can spin up the server,
  // so /call-tool is never reachable without a valid token (SEC-1).
  initAuthToken();
  startNativeMessaging();
}
