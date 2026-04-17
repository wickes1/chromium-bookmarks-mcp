import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';

// Helper: compute folder path like "Bookmarks Bar > Tech > AI"
async function getFolderPath(nodeId: string): Promise<string> {
  const parts: string[] = [];
  let currentId = nodeId;

  while (currentId && currentId !== '0') {
    const nodes = await chrome.bookmarks.get(currentId);
    if (nodes.length === 0) break;
    parts.unshift(nodes[0].title || 'Root');
    currentId = nodes[0].parentId || '';
  }

  return parts.join(' > ');
}

// Helper: enrich a bookmark node with folderPath
async function enrichNode(node: chrome.bookmarks.BookmarkTreeNode): Promise<Record<string, unknown>> {
  const folderPath = node.parentId ? await getFolderPath(node.parentId) : '';
  return {
    id: node.id,
    title: node.title,
    url: node.url,
    parentId: node.parentId,
    index: node.index,
    dateAdded: node.dateAdded,
    dateGroupModified: node.dateGroupModified,
    folderPath,
    children: node.children ? node.children.map(c => ({
      id: c.id,
      title: c.title,
      url: c.url,
      parentId: c.parentId,
      index: c.index,
      dateAdded: c.dateAdded,
    })) : undefined,
  };
}

// Helper: recursively count bookmarks and folders
function countNodes(nodes: chrome.bookmarks.BookmarkTreeNode[]): { total: number; folders: number; bookmarks: number } {
  let total = 0, folders = 0, bookmarks = 0;
  for (const node of nodes) {
    if (node.url) {
      bookmarks++;
      total++;
    } else if (node.children) {
      folders++;
      total++;
      const sub = countNodes(node.children);
      total += sub.total;
      folders += sub.folders;
      bookmarks += sub.bookmarks;
    }
  }
  return { total, folders, bookmarks };
}

// Helper: flatten all bookmark nodes recursively
function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[], result: chrome.bookmarks.BookmarkTreeNode[] = []): chrome.bookmarks.BookmarkTreeNode[] {
  for (const node of nodes) {
    if (node.url) {
      result.push(node);
    }
    if (node.children) {
      flattenBookmarks(node.children, result);
    }
  }
  return result;
}

// --- Tool: bookmark_get_tree ---
export async function handleGetTree(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = args.folder_id as string | undefined;

  let tree: chrome.bookmarks.BookmarkTreeNode[];
  if (folderId) {
    tree = await chrome.bookmarks.getSubTree(folderId);
  } else {
    tree = await chrome.bookmarks.getTree();
  }

  return { status: 'success', data: tree };
}

// --- Tool: bookmark_list ---
export async function handleList(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = (args.folder_id as string) || '0';
  const limit = (args.limit as number) || 100;
  const offset = (args.offset as number) || 0;

  const children = await chrome.bookmarks.getChildren(folderId);
  const sliced = children.slice(offset, offset + limit);

  const enriched = await Promise.all(sliced.map(enrichNode));

  return {
    status: 'success',
    data: {
      items: enriched,
      total: children.length,
      hasMore: offset + limit < children.length,
    },
  };
}

// --- Tool: bookmark_search ---
export async function handleSearch(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const query = args.query as string;
  const folderId = args.folder_id as string | undefined;
  const limit = (args.limit as number) || 50;

  if (!query) {
    return { status: 'error', error: 'query is required' };
  }

  let results = await chrome.bookmarks.search(query);

  // If folder_id specified, filter to only bookmarks under that folder
  if (folderId) {
    const subtree = await chrome.bookmarks.getSubTree(folderId);
    const subtreeIds = new Set<string>();
    function collectIds(nodes: chrome.bookmarks.BookmarkTreeNode[]) {
      for (const n of nodes) {
        subtreeIds.add(n.id);
        if (n.children) collectIds(n.children);
      }
    }
    collectIds(subtree);
    results = results.filter(r => subtreeIds.has(r.id));
  }

  const sliced = results.slice(0, limit);
  const enriched = await Promise.all(sliced.map(enrichNode));

  return {
    status: 'success',
    data: {
      items: enriched,
      total: results.length,
      returned: sliced.length,
    },
  };
}

// --- Tool: bookmark_get ---
export async function handleGet(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const id = args.id as string;
  if (!id) {
    return { status: 'error', error: 'id is required' };
  }

  try {
    const nodes = await chrome.bookmarks.get(id);
    if (nodes.length === 0) {
      return { status: 'error', error: `Bookmark not found: ${id}` };
    }
    const enriched = await enrichNode(nodes[0]);
    return { status: 'success', data: enriched };
  } catch {
    return { status: 'error', error: `Bookmark not found: ${id}` };
  }
}

// --- Tool: bookmark_count ---
export async function handleCount(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = args.folder_id as string | undefined;

  let tree: chrome.bookmarks.BookmarkTreeNode[];
  if (folderId) {
    tree = await chrome.bookmarks.getSubTree(folderId);
  } else {
    tree = await chrome.bookmarks.getTree();
  }

  const stats = countNodes(tree[0]?.children || tree);
  return { status: 'success', data: stats };
}

// --- Tool: bookmark_find_duplicates ---
export async function handleFindDuplicates(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = args.folder_id as string | undefined;

  let tree: chrome.bookmarks.BookmarkTreeNode[];
  if (folderId) {
    tree = await chrome.bookmarks.getSubTree(folderId);
  } else {
    tree = await chrome.bookmarks.getTree();
  }

  const allBookmarks = flattenBookmarks(tree);

  // Group by URL
  const urlMap = new Map<string, chrome.bookmarks.BookmarkTreeNode[]>();
  for (const bm of allBookmarks) {
    if (!bm.url) continue;
    const existing = urlMap.get(bm.url) || [];
    existing.push(bm);
    urlMap.set(bm.url, existing);
  }

  // Filter to only duplicates
  const duplicates: Array<{ url: string; count: number; bookmarks: Array<Record<string, unknown>> }> = [];
  for (const [url, nodes] of urlMap) {
    if (nodes.length > 1) {
      const enriched = await Promise.all(nodes.map(enrichNode));
      duplicates.push({ url, count: nodes.length, bookmarks: enriched });
    }
  }

  return {
    status: 'success',
    data: {
      duplicateGroups: duplicates.length,
      totalDuplicates: duplicates.reduce((sum, d) => sum + d.count - 1, 0),
      groups: duplicates,
    },
  };
}
