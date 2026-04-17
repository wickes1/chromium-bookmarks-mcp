import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';

export function handlePing(): ToolCallResponse {
  return {
    status: 'success',
    data: {
      message: 'pong',
      timestamp: Date.now(),
      browser: navigator.userAgent,
    },
  };
}
