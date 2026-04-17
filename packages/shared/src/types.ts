// --- Native Messaging Protocol ---

export enum NativeMessageType {
  START = 'start',
  STOP = 'stop',
  SERVER_STARTED = 'server_started',
  SERVER_STOPPED = 'server_stopped',
  CALL_TOOL = 'call_tool',
  CALL_TOOL_RESPONSE = 'call_tool_response',
  ERROR = 'error',
  PING = 'ping',
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
}

// --- Bookmark Types (used in later phases) ---

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  index?: number;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkNode[];
  folderPath?: string;
}

// --- Config ---

export const NATIVE_HOST_NAME = 'com.chromium_bookmarks_mcp';
export const DEFAULT_PORT = 19420;
export const REQUEST_TIMEOUT_MS = 30_000;
