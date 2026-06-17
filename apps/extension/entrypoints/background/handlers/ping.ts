import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';

// Best-effort browser name from the UA string. Order matters: Edge/Brave/Opera
// all also contain "Chrome", so they must be checked first.
function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Brave/.test(ua)) return 'Brave';
  if (/Vivaldi/.test(ua)) return 'Vivaldi';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Chromium\//.test(ua)) return 'Chromium';
  return 'Browser';
}

function countTree(nodes: chrome.bookmarks.BookmarkTreeNode[]): { bookmarks: number; folders: number } {
  let bookmarks = 0;
  let folders = 0;
  for (const node of nodes) {
    if (node.url) {
      bookmarks++;
    } else if (node.children) {
      folders++;
      const sub = countTree(node.children);
      bookmarks += sub.bookmarks;
      folders += sub.folders;
    }
  }
  return { bookmarks, folders };
}

export async function handlePing(): Promise<ToolCallResponse> {
  const ua = navigator.userAgent;
  const browser = detectBrowser(ua);

  // Profile-ish identity: there is no stable profile-name API for an extension,
  // but the extension id is unique per (browser, profile) install, so it serves
  // as a coarse profile fingerprint the agent can use to tell installs apart.
  const profileId = chrome.runtime.id;

  let bookmarks = 0;
  let folders = 0;
  try {
    const tree = await chrome.bookmarks.getTree();
    const stats = countTree(tree);
    bookmarks = stats.bookmarks;
    folders = stats.folders;
  } catch {
    // Bookmarks may be unavailable; report zero counts rather than failing ping.
  }

  return {
    status: 'success',
    data: {
      message: 'pong',
      timestamp: Date.now(),
      browser,
      profileId,
      bookmarkCount: bookmarks,
      folderCount: folders,
      userAgent: ua,
    },
  };
}
