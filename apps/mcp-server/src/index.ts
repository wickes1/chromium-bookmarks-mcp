#!/usr/bin/env bun
import { register, unregister, doctor } from './register.js';
import { startStdioProxy } from './stdio-proxy.js';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'register':
      try {
        register(process.argv[3]);
      } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        process.exit(1);
      }
      break;
    case 'unregister':
      unregister();
      break;
    case 'doctor':
      await doctor();
      break;
    case undefined:
    case 'serve':
      startStdioProxy().catch((err) => {
        process.stderr.write(`Fatal: ${err.message}\n`);
        process.exit(1);
      });
      break;
    default:
      console.log(`Usage: chromium-bookmarks-mcp [command]

Commands:
  (none)       Start MCP stdio proxy (default)
  register     Register native host for all detected browsers
  unregister   Remove native host registration
  doctor       Diagnose connection issues
`);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
