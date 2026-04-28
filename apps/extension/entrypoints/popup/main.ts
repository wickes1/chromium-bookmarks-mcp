const dot = document.getElementById('dot')!;
const statusText = document.getElementById('status-text')!;
const portInfo = document.getElementById('port-info')!;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;

async function checkStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-status' });
    if (response?.connected) {
      const port = response.port ?? 19420;
      dot.className = 'dot connected';
      statusText.textContent = 'Connected';
      portInfo.textContent = `127.0.0.1:${port}`;
      portInfo.style.display = 'block';
    } else {
      dot.className = 'dot disconnected';
      statusText.textContent = 'Not connected';
      portInfo.style.display = 'none';
    }
  } catch {
    dot.className = 'dot disconnected';
    statusText.textContent = 'Error';
    portInfo.style.display = 'none';
  }
}

async function forceReconnect(): Promise<void> {
  refreshBtn.disabled = true;
  statusText.textContent = 'Reconnecting...';
  try {
    await chrome.runtime.sendMessage({ type: 'force-reconnect' });
  } catch {
    // Ignore — checkStatus will reflect the failure.
  }
  await checkStatus();
  refreshBtn.disabled = false;
}

refreshBtn.addEventListener('click', forceReconnect);

checkStatus();
setInterval(checkStatus, 3000);
