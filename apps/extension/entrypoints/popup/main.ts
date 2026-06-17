const dot = document.getElementById('dot')!;
const statusText = document.getElementById('status-text')!;
const portInfo = document.getElementById('port-info')!;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;

// A small hint line rendered under the status row. Created lazily so the popup
// HTML doesn't need to ship an empty element.
let hintEl: HTMLElement | null = null;
function setHint(text: string): void {
  if (!text) {
    if (hintEl) hintEl.style.display = 'none';
    return;
  }
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.id = 'hint';
    hintEl.style.marginTop = '8px';
    hintEl.style.fontSize = '11px';
    hintEl.style.lineHeight = '1.4';
    hintEl.style.color = '#b3261e';
    // Insert right after the status row so it reads as a hint under the dot.
    portInfo.insertAdjacentElement('beforebegin', hintEl);
  }
  hintEl.textContent = text;
  hintEl.style.display = 'block';
}

// Map a raw onDisconnect lastError into an actionable hint for the popup.
function hintForError(error: string | null): string {
  if (!error) return '';
  const e = error.toLowerCase();
  if (e.includes('not found') || e.includes('no such native') || e.includes('manifest')) {
    return 'Host manifest not found — run: bunx chromium-bookmarks-mcp register';
  }
  if (e.includes('handshake')) {
    return 'Native host started but the server did not — check the host logs.';
  }
  if (e.includes('forbidden') || e.includes('access') || e.includes('permission')) {
    return 'Native host blocked — check the manifest allowed_origins and permissions.';
  }
  return `Disconnected: ${error}`;
}

async function showIdentity(): Promise<boolean> {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'get-identity' });
    if (res?.status === 'success' && res.data) {
      const { browser, bookmarkCount } = res.data as { browser?: string; bookmarkCount?: number };
      const parts: string[] = ['Connected'];
      if (browser) parts.push(browser);
      statusText.textContent = parts.join(' — ');
      if (typeof bookmarkCount === 'number') {
        const suffix = browser ? `, ${bookmarkCount} bookmarks` : ` — ${bookmarkCount} bookmarks`;
        statusText.textContent += suffix;
      }
      return true;
    }
  } catch {
    // Fall through to the plain "Connected" label.
  }
  return false;
}

async function checkStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-status' });
    if (response?.connected) {
      dot.className = 'dot connected';
      statusText.textContent = 'Connected';
      const port = response.port ?? 19420;
      portInfo.textContent = `127.0.0.1:${port}`;
      portInfo.style.display = 'block';
      setHint('');
      await showIdentity();
    } else if (response?.connecting) {
      dot.className = 'dot disconnected';
      statusText.textContent = 'Connecting...';
      portInfo.style.display = 'none';
      setHint('');
    } else {
      dot.className = 'dot disconnected';
      statusText.textContent = 'Not connected';
      portInfo.style.display = 'none';
      setHint(hintForError(response?.lastError ?? null));
    }
  } catch {
    dot.className = 'dot disconnected';
    statusText.textContent = 'Error';
    portInfo.style.display = 'none';
    setHint('');
  }
}

async function forceReconnect(): Promise<void> {
  refreshBtn.disabled = true;
  statusText.textContent = 'Reconnecting...';
  setHint('');
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
