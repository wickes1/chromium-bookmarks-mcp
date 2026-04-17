#!/usr/bin/env bun
/**
 * Process C — MCP Stdio Proxy.
 * Spawned by Claude Code. Receives MCP tool calls via stdin (JSON-RPC),
 * proxies them to Process A's HTTP server, returns results via stdout.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TOOL_SCHEMAS, DEFAULT_PORT } from '@chromium-bookmarks-mcp/shared';
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('MCP stdio proxy started.\n');
}
