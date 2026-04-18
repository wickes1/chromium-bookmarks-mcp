import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  manifest: {
    name: 'Chromium Bookmarks MCP',
    version: '0.1.0',
    description: 'Give AI agents real-time read/write access to your bookmarks via MCP',
    permissions: ['bookmarks', 'nativeMessaging', 'offscreen'],
    icons: {
      '16': 'icon-16.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
  },
});
