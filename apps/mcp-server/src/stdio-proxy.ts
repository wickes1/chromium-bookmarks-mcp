/**
 * Process C — MCP Stdio Proxy.
 * Spawned by Claude Code. Receives MCP tool calls via stdin (JSON-RPC),
 * proxies them to Process A's HTTP server, returns results via stdout.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { DEFAULT_PORT, AUTH_TOKEN_HEADER, authTokenPath } from './types.js';
import type { ToolCallResponse } from './types.js';
import pkg from '../package.json';
import { ensureRegistered } from './register.js';

const HTTP_BASE = `http://127.0.0.1:${DEFAULT_PORT}`;
const VERSION: string = pkg.version;
// Pretty-print tool output only when explicitly requested; compact JSON keeps
// payloads (and token cost) small for the common case (PERF-5).
const DEBUG_JSON = process.env.BOOKMARKS_MCP_DEBUG === '1';

/**
 * Error thrown for an HTTP-layer failure that is NOT a fetch/connection
 * rejection — i.e. the host answered with a non-OK, non-JSON response. Kept
 * distinct from fetch rejections so error classification stays structural
 * (ARCH-3) instead of substring-based.
 */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Structurally classify a thrown error as "extension/host not reachable"
 * (ARCH-3). A fetch to a down localhost rejects with a TypeError whose `cause`
 * carries the OS error code; an aborted/timed-out fetch rejects with
 * TimeoutError/AbortError. Anything that is one of our own HttpErrors is a real
 * HTTP response and must NOT be treated as a connection failure.
 */
export function isNotConnectedError(err: unknown): boolean {
  if (err instanceof HttpError) return false;
  if (!(err instanceof Error)) return true; // non-Error rejection from fetch -> treat as down
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const code = (err as { cause?: { code?: string } }).cause?.code;
  if (code) {
    // Any connection-establishment / socket failure to 127.0.0.1 means the
    // native host is not running. Enumerated for clarity; the default below
    // also covers it, since every fetch-layer rejection to a dead localhost is
    // NOT_CONNECTED.
    return true;
  }
  // A bare fetch rejection ("fetch failed" TypeError) without a cause code is
  // still a transport failure to the local host.
  return err.name === 'TypeError';
}

const STATUS_CODE_MAP: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  503: 'BACKPRESSURE',
};

/**
 * Unwrap the JSON body of ANY non-OK response so host-side errors (400 bad
 * request, 401 unauthorized, 500 tool error, 503 backpressure) reach the caller
 * as a clean tool error carrying a `code` (CORR-6). If the response is not
 * application/json, throw an HttpError so the caller emits a generic message.
 */
export async function unwrapNonOkBody(res: Response): Promise<ToolCallResponse> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json() as ToolCallResponse;
    return {
      ...body,
      // A non-OK response is always surfaced as an error to the caller.
      status: 'error',
      // Preserve a host-supplied code, else derive one from the status.
      code: body.code ?? STATUS_CODE_MAP[res.status] ?? 'TOOL_ERROR',
    };
  }
  throw new HttpError(res.status, res.statusText);
}

/** Read the per-session auth token written by the native host (SEC-1). */
function readAuthToken(): string | null {
  try {
    return readFileSync(authTokenPath(), 'utf-8').trim() || null;
  } catch {
    // Token file may not exist yet (host not started) — proceed unauthenticated
    // and let the host's 401 drive the retry.
    return null;
  }
}

async function fetchCallTool(toolName: string, args: Record<string, unknown>, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers[AUTH_TOKEN_HEADER] = token;
  return fetch(`${HTTP_BASE}/call-tool`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ toolName, args }),
    signal: AbortSignal.timeout(35_000),
  });
}

export async function callNativeHost(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
  let res = await fetchCallTool(toolName, args, readAuthToken());

  // On 401, the token file may have been (re)written after we read it — re-read
  // once and retry (SEC-1). If still 401, fall through to unwrap as an error.
  if (res.status === 401) {
    res = await fetchCallTool(toolName, args, readAuthToken());
  }

  if (!res.ok) {
    return unwrapNonOkBody(res);
  }

  return res.json() as Promise<ToolCallResponse>;
}

export async function startStdioProxy(): Promise<void> {
  try {
    ensureRegistered();
  } catch (err) {
    process.stderr.write(`[chromium-bookmarks-mcp] auto-register failed: ${(err as Error).message}\n`);
  }

  const server = new McpServer(
    { name: 'chromium-bookmarks-mcp', version: VERSION },
    { instructions: 'Manage Chromium browser bookmarks. Requires the Chromium Bookmarks MCP extension to be installed and the browser to be open.' }
  );

  const NOT_CONNECTED_MSG = 'Extension not connected. Please open your browser and ensure the Chromium Bookmarks MCP extension is installed.';

  function registerProxyTool(
    name: string,
    title: string,
    description: string,
    inputSchema: z.ZodObject<z.ZodRawShape>,
  ) {
    server.registerTool(name, { title, description, inputSchema }, async (args) => {
      try {
        const result = await callNativeHost(name, args as Record<string, unknown>);
        if (result.status === 'error') {
          const code = result.code ? ` [${result.code}]` : '';
          return { content: [{ type: 'text' as const, text: `Error${code}: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, DEBUG_JSON ? 2 : undefined) }] };
      } catch (err) {
        if (isNotConnectedError(err)) {
          return { content: [{ type: 'text' as const, text: `${NOT_CONNECTED_MSG} [NOT_CONNECTED]` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    });
  }

  // Ping
  registerProxyTool('ping', 'Ping', 'Check if the browser extension is connected and responsive.', z.object({}));

  // Read tools
  registerProxyTool(
    'bookmark_get_tree',
    'Get Bookmark Tree',
    'Returns the bookmark tree structure. Default depth is 2 to stay within MCP token limits. Use higher depth for more detail, or depth: 0 for unlimited. Use folder_id to get a subtree.',
    z.object({
      folder_id: z.string().optional().describe('Folder ID to get subtree of. Omit for full tree.'),
      depth: z.number().optional().describe('Max depth to return (default: 2). Folders beyond this show childCount instead of children. Use 0 for unlimited.'),
    }),
  );

  registerProxyTool(
    'bookmark_list',
    'List Bookmarks',
    'List bookmarks in a specific folder (non-recursive). Returns items with folder paths.',
    z.object({
      folder_id: z.string().optional().describe('Folder ID to list. Default: root (0).'),
      limit: z.number().optional().describe('Max items to return. Default: 100.'),
      offset: z.number().optional().describe('Number of items to skip. Default: 0.'),
    }),
  );

  registerProxyTool(
    'bookmark_search',
    'Search Bookmarks',
    'Full-text search across bookmark titles and URLs. Scope to a folder by ID or path.',
    z.object({
      query: z.string().describe('Search query to match against titles and URLs.'),
      folder_id: z.string().optional().describe('Scope search to a specific folder subtree by ID.'),
      folder_path: z.string().optional().describe('Scope search by folder path, e.g. "Bookmarks Bar > Tech > AI". Alternative to folder_id.'),
      limit: z.number().optional().describe('Max results to return. Default: 50.'),
    }),
  );

  registerProxyTool(
    'bookmark_get',
    'Get Bookmark',
    'Get a single bookmark or folder by ID with full details including folder path.',
    z.object({
      id: z.string().describe('Bookmark or folder ID.'),
    }),
  );

  registerProxyTool(
    'bookmark_count',
    'Count Bookmarks',
    'Count total bookmarks and folders, optionally scoped to a specific folder.',
    z.object({
      folder_id: z.string().optional().describe('Folder ID to count within. Omit for global count.'),
    }),
  );

  registerProxyTool(
    'bookmark_find_duplicates',
    'Find Duplicate Bookmarks',
    'Find bookmarks with duplicate URLs. Returns groups of duplicates with their locations.',
    z.object({
      folder_id: z.string().optional().describe('Scope duplicate search to a specific folder.'),
    }),
  );

  // Write tools
  registerProxyTool(
    'bookmark_create',
    'Create Bookmark',
    'Create a new bookmark or folder. Omit url to create a folder. Set create_parents: true with parent_path to auto-create nested folders.',
    z.object({
      title: z.string().describe('Title of the bookmark or folder.'),
      url: z.string().optional().describe('URL for a bookmark. Omit to create a folder.'),
      parent_id: z.string().optional().describe('Parent folder ID. Default: Bookmarks Bar (1).'),
      parent_path: z.string().optional().describe('Parent folder path like "Tech > AI". Used with create_parents.'),
      create_parents: z.boolean().optional().describe('Auto-create parent folders from parent_path if they don\'t exist.'),
      index: z.number().optional().describe('Position within the parent folder.'),
    }),
  );

  registerProxyTool(
    'bookmark_update',
    'Update Bookmark',
    'Update the title or URL of an existing bookmark or folder.',
    z.object({
      id: z.string().describe('Bookmark or folder ID to update.'),
      title: z.string().optional().describe('New title.'),
      url: z.string().optional().describe('New URL (bookmarks only).'),
    }),
  );

  registerProxyTool(
    'bookmark_move',
    'Move Bookmark',
    'Move a bookmark or folder to a different parent folder.',
    z.object({
      id: z.string().describe('Bookmark or folder ID to move.'),
      parent_id: z.string().describe('Target parent folder ID.'),
      index: z.number().optional().describe('Position within the target folder.'),
    }),
  );

  registerProxyTool(
    'bookmark_delete',
    'Delete Bookmark',
    'Delete a single bookmark by ID. Cannot delete root folders.',
    z.object({
      id: z.string().describe('Bookmark ID to delete.'),
    }),
  );

  registerProxyTool(
    'bookmark_delete_folder',
    'Delete Folder',
    'Delete a folder and ALL its contents. Requires confirm: true as a safety gate. Permanently deletes the folder and every bookmark inside it, with no undo. Back up first with bookmark_export_html.',
    z.object({
      id: z.string().describe('Folder ID to delete.'),
      confirm: z.boolean().describe('Must be true to confirm deletion of folder and all contents.'),
    }),
  );

  // Batch tools
  registerProxyTool(
    'bookmark_batch_move',
    'Batch Move Bookmarks',
    'Move multiple bookmarks to a target folder at once.',
    z.object({
      ids: z.array(z.string()).describe('Array of bookmark IDs to move.'),
      parent_id: z.string().describe('Target parent folder ID.'),
    }),
  );

  registerProxyTool(
    'bookmark_merge_folders',
    'Merge Folders',
    'Merge all contents of source folder into target folder. Optionally deduplicate and delete source. When delete_source is true, or deduplicate removes duplicates, this permanently deletes bookmarks, with no undo: call with dry_run:true first to preview what would be removed, then confirm:true to execute. Back up first with bookmark_export_html.',
    z.object({
      source_id: z.string().describe('Source folder ID to merge from.'),
      target_id: z.string().describe('Target folder ID to merge into.'),
      delete_source: z.boolean().optional().describe('Delete source folder after merge. Default: false.'),
      deduplicate: z.boolean().optional().describe('Skip moving bookmarks that already exist in target (by URL). Default: false.'),
      confirm: z.boolean().optional().describe('Required (with dry_run unset/false) to actually delete the source folder and/or duplicate bookmarks.'),
      dry_run: z.boolean().optional().describe('Preview only: report what would be removed without deleting anything.'),
    }),
  );

  registerProxyTool(
    'bookmark_deduplicate',
    'Deduplicate Bookmarks',
    'Find and remove duplicate bookmarks (same URL) within a folder or globally. Permanently deletes the redundant copies, with no undo: call with dry_run:true first to preview which bookmarks would be removed, then confirm:true to execute. You must pass folder_id or scope:"global" so an omitted scope can never wipe the whole tree. Back up first with bookmark_export_html.',
    z.object({
      folder_id: z.string().optional().describe('Scope to a specific folder. Required unless scope:"global" is set.'),
      scope: z.enum(['global']).optional().describe('Set to "global" to deduplicate across the entire bookmark tree. Required when folder_id is omitted.'),
      keep: z.enum(['first', 'last']).optional().describe('Which duplicate to keep. Default: first.'),
      confirm: z.boolean().optional().describe('Required (with dry_run unset/false) to actually delete the duplicates.'),
      dry_run: z.boolean().optional().describe('Preview only: report which duplicates would be removed without deleting anything.'),
    }),
  );

  registerProxyTool(
    'bookmark_batch_delete',
    'Batch Delete Bookmarks',
    'Delete multiple bookmarks by their IDs. Cannot delete root folders. Permanently deletes the listed bookmarks, with no undo: call with dry_run:true first to preview the items, then confirm:true to execute. Back up first with bookmark_export_html.',
    z.object({
      ids: z.array(z.string()).describe('Array of bookmark IDs to delete.'),
      confirm: z.boolean().optional().describe('Required (with dry_run unset/false) to actually delete the bookmarks.'),
      dry_run: z.boolean().optional().describe('Preview only: report which bookmarks would be removed without deleting anything.'),
    }),
  );

  // Export/Import tools
  registerProxyTool(
    'bookmark_export_html',
    'Export Bookmarks as HTML',
    'Export bookmarks in Netscape Bookmark HTML format (same as browser export). Returns the HTML string.',
    z.object({
      folder_id: z.string().optional().describe('Export a specific folder subtree. Omit for all bookmarks.'),
    }),
  );

  registerProxyTool(
    'bookmark_import_html',
    'Import Bookmarks from HTML',
    'Import bookmarks from Netscape Bookmark HTML format into the browser.',
    z.object({
      html: z.string().describe('Netscape Bookmark HTML content to import.'),
      parent_id: z.string().optional().describe('Parent folder ID to import into. Default: Bookmarks Bar (1).'),
    }),
  );

  // Analysis tools
  registerProxyTool(
    'bookmark_check_dead_links',
    'Check Dead Links',
    'Check bookmarks for broken/dead URLs by making HTTP requests. Checks in batches of 5.',
    z.object({
      folder_id: z.string().optional().describe('Scope check to a specific folder.'),
      limit: z.number().optional().describe('Max bookmarks to check. Default: 50.'),
      timeout_ms: z.number().optional().describe('HTTP request timeout in ms. Default: 5000.'),
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('MCP stdio proxy started.\n');
}
