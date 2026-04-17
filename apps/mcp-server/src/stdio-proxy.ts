#!/usr/bin/env bun
/**
 * Process C — MCP Stdio Proxy.
 * Spawned by Claude Code. Receives MCP tool calls via stdin (JSON-RPC),
 * proxies them to Process A's HTTP server, returns results via stdout.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DEFAULT_PORT } from '@chromium-bookmarks-mcp/shared';
import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';

const HTTP_BASE = `http://127.0.0.1:${DEFAULT_PORT}`;

async function callNativeHost(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
  const res = await fetch(`${HTTP_BASE}/call-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolName, args }),
  });

  if (!res.ok) {
    if (res.status === 500) {
      const body = await res.json() as ToolCallResponse;
      return body;
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<ToolCallResponse>;
}

async function checkConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${HTTP_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startStdioProxy(): Promise<void> {
  const server = new McpServer(
    { name: 'chromium-bookmarks-mcp', version: '0.1.0' },
    { instructions: 'Manage Chromium browser bookmarks. Requires the Chromium Bookmarks MCP extension to be installed and the browser to be open.' }
  );

  // Register the ping tool
  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Check if the browser extension is connected and responsive.',
      inputSchema: z.object({}),
    },
    async () => {
      const connected = await checkConnection();
      if (!connected) {
        return {
          content: [{ type: 'text' as const, text: 'Extension not connected. Please open your browser and ensure the Chromium Bookmarks MCP extension is installed.' }],
          isError: true,
        };
      }

      try {
        const result = await callNativeHost('ping', {});
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data ?? result) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // Helper: register a tool that proxies to the native host
  function registerProxyTool(
    name: string,
    title: string,
    description: string,
    inputSchema: z.ZodObject<z.ZodRawShape>,
  ) {
    server.registerTool(name, { title, description, inputSchema }, async (args) => {
      const connected = await checkConnection();
      if (!connected) {
        return {
          content: [{ type: 'text' as const, text: 'Extension not connected. Please open your browser and ensure the Chromium Bookmarks MCP extension is installed.' }],
          isError: true,
        };
      }
      try {
        const result = await callNativeHost(name, args as Record<string, unknown>);
        if (result.status === 'error') {
          return {
            content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    });
  }

  // Read tools
  registerProxyTool(
    'bookmark_get_tree',
    'Get Bookmark Tree',
    'Returns the bookmark tree structure. Default depth is 3 to prevent huge responses. Use depth: 0 for unlimited (not recommended for large collections). Use folder_id to get a subtree.',
    z.object({
      folder_id: z.string().optional().describe('Folder ID to get subtree of. Omit for full tree.'),
      depth: z.number().optional().describe('Max depth to return (default: 3). Folders beyond this show childCount instead of children. Use 0 for unlimited.'),
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
    'Full-text search across bookmark titles and URLs.',
    z.object({
      query: z.string().describe('Search query to match against titles and URLs.'),
      folder_id: z.string().optional().describe('Scope search to a specific folder subtree.'),
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
    'Delete a folder and ALL its contents. Requires confirm: true as a safety gate.',
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
    'Merge all contents of source folder into target folder. Optionally deduplicate and delete source.',
    z.object({
      source_id: z.string().describe('Source folder ID to merge from.'),
      target_id: z.string().describe('Target folder ID to merge into.'),
      delete_source: z.boolean().optional().describe('Delete source folder after merge. Default: false.'),
      deduplicate: z.boolean().optional().describe('Skip moving bookmarks that already exist in target (by URL). Default: false.'),
    }),
  );

  registerProxyTool(
    'bookmark_deduplicate',
    'Deduplicate Bookmarks',
    'Find and remove duplicate bookmarks (same URL) within a folder or globally.',
    z.object({
      folder_id: z.string().optional().describe('Scope to a specific folder. Omit for global dedup.'),
      keep: z.enum(['first', 'last']).optional().describe('Which duplicate to keep. Default: first.'),
    }),
  );

  registerProxyTool(
    'bookmark_batch_delete',
    'Batch Delete Bookmarks',
    'Delete multiple bookmarks by their IDs. Cannot delete root folders.',
    z.object({
      ids: z.array(z.string()).describe('Array of bookmark IDs to delete.'),
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('MCP stdio proxy started.\n');
}
