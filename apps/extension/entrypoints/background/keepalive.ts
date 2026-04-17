let offscreenCreated = false;

export async function acquireKeepalive(): Promise<void> {
  if (offscreenCreated) return;

  try {
    // @ts-expect-error: chrome.runtime.getContexts may not be typed
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }
  } catch {
    // getContexts not available, proceed to create
  }

  try {
    // @ts-expect-error: chrome.offscreen is MV3 only
    await chrome.offscreen.createDocument({
      url: '/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Keep service worker alive for native messaging connection',
    });
    offscreenCreated = true;
    console.log('[BM-MCP] Offscreen keepalive acquired');
  } catch (err) {
    console.warn('[BM-MCP] Failed to create offscreen document:', err);
  }
}

export async function releaseKeepalive(): Promise<void> {
  if (!offscreenCreated) return;

  try {
    // @ts-expect-error: chrome.offscreen is MV3 only
    await chrome.offscreen.closeDocument();
    offscreenCreated = false;
    console.log('[BM-MCP] Offscreen keepalive released');
  } catch {
    // Already closed
  }
}
