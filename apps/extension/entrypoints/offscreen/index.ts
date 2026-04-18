const PING_INTERVAL_MS = 20_000;

const port = chrome.runtime.connect({ name: 'keepalive' });

port.onDisconnect.addListener(() => {
  console.log('[BM-MCP:offscreen] Port disconnected, closing.');
});

setInterval(() => {
  port.postMessage({ type: 'keepalive-ping' });
}, PING_INTERVAL_MS);
