const dot = document.getElementById('dot')!;
const statusText = document.getElementById('status-text')!;
const info = document.getElementById('info')!;

async function checkStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-status' });
    if (response?.connected) {
      dot.className = 'dot connected';
      statusText.textContent = 'Connected';
      info.textContent = 'Native host is running.\nBookmark tools are available via MCP.';
    } else {
      dot.className = 'dot disconnected';
      statusText.textContent = 'Not connected';
      info.textContent = 'Native host is not running.\nMake sure you ran:\nnpm install -g chromium-bookmarks-mcp';
    }
  } catch {
    dot.className = 'dot disconnected';
    statusText.textContent = 'Error';
    info.textContent = 'Could not reach background service worker.';
  }
}

checkStatus();
setInterval(checkStatus, 3000);
