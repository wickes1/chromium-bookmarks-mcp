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
    'Returns the full bookmark tree structure. Optionally pass folder_id to get a subtree.',
    z.object({
      folder_id: z.string().optional().describe('Folder ID to get subtree of. Omit for full tree.'),
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('MCP stdio proxy started.\n');
}
