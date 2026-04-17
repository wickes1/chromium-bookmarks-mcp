const dot = document.getElementById('dot')!;
const statusText = document.getElementById('status-text')!;
const info = document.getElementById('info')!;

async function checkStatus(): Promise<void> {
  try {
    const res = await fetch('http://127.0.0.1:19420/health', {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json() as { status: string; pendingRequests: number };

    dot.className = 'dot connected';
    statusText.textContent = 'Connected';
    info.textContent = `HTTP server running on port 19420\nPending requests: ${data.pendingRequests}`;
  } catch {
    dot.className = 'dot disconnected';
    statusText.textContent = 'Not connected';
    info.textContent = 'Native host is not running.\nMake sure you ran:\nnpm install -g chromium-bookmarks-mcp';
  }
}

checkStatus();
setInterval(checkStatus, 3000);
