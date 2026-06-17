// --- Native Messaging Protocol ---

export enum NativeMessageType {
  START = 'start',
  SERVER_STARTED = 'server_started',
  CALL_TOOL = 'call_tool',
  CALL_TOOL_RESPONSE = 'call_tool_response',
  PONG = 'pong',
}

export interface NativeMessage {
  type: NativeMessageType;
  requestId: string;
  responseToRequestId?: string;
  payload?: unknown;
}

export interface ToolCallPayload {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolCallResponse {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  code?: string;
}

// --- Config ---

export const NATIVE_HOST_NAME = 'com.chromium_bookmarks_mcp';
export const DEFAULT_PORT = 19420;
export const REQUEST_TIMEOUT_MS = 30_000;
export const ROOT_FOLDER_IDS = ['0', '1', '2'];

// --- Auth (localhost control plane: stdio-proxy <-> native-host) ---

export const AUTH_TOKEN_HEADER = 'x-bookmarks-mcp-token';

import { homedir } from 'node:os';
import { join } from 'node:path';

export function authTokenPath(): string {
  return join(homedir(), '.cache', 'chromium-bookmarks-mcp', 'auth-token');
}

// --- Timeout budget (nested across hops) ---
// EXTENSION_OP_TIMEOUT_MS < REQUEST_TIMEOUT_MS < proxy fetch (35_000)
export const EXTENSION_OP_TIMEOUT_MS = 25_000;
export const DEAD_LINK_DEADLINE_MS = 24_000;
