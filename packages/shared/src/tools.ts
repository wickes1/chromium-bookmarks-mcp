export interface ToolSchema {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'ping',
    title: 'Ping',
    description: 'Check if the browser extension is connected and responsive. Returns pong with extension info.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
