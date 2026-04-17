import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  manifest: {
    name: 'Chromium Bookmarks MCP',
    version: '0.1.0',
    description: 'Give AI agents real-time read/write access to your bookmarks via MCP',
    permissions: ['bookmarks', 'nativeMessaging', 'offscreen'],
  },
});
