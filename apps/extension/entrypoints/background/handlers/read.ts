import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';

// --- Shared helpers (exported for use by batch.ts) ---

// Get full tree or subtree by folder ID
export async function getTreeOrSubtree(folderId?: string): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return folderId
    ? chrome.bookmarks.getSubTree(folderId)
    : chrome.bookmarks.getTree();
}

// Flatten all bookmark nodes recursively (only nodes with URLs)
export function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[], result: chrome.bookmarks.BookmarkTreeNode[] = []): chrome.bookmarks.BookmarkTreeNode[] {
  for (const node of nodes) {
    if (node.url) result.push(node);
    if (node.children) flattenBookmarks(node.children, result);
  }
  return result;
}

// --- Internal helpers ---

// Module-level cache: nodeId → resolved folder path string.
// Valid for the lifetime of the process session. Bookmarks rarely move mid-session,
// so a persistent cache is acceptable. Call clearFolderPathCache() before batch
// operations if freshness is required.
const _folderPathCache = new Map<string, string>();

export function clearFolderPathCache(): void {
  _folderPathCache.clear();
}

// Compute folder path like "Bookmarks Bar > Tech > AI"
// Caches each intermediate node so sibling bookmarks in the same folder
// only pay the chrome.bookmarks.get() cost once.
async function getFolderPath(nodeId: string): Promise<string> {
  if (_folderPathCache.has(nodeId)) {
    return _folderPathCache.get(nodeId)!;
  }

  // Walk up the parent chain, collecting {id, title, parentId} for every
  // node that isn't yet cached. We stop as soon as we hit a cached ancestor
  // or reach the root.
  type NodeInfo = { id: string; title: string; parentId: string };
  const uncached: NodeInfo[] = [];
  let currentId = nodeId;

  while (currentId && currentId !== '0') {
    if (_folderPathCache.has(currentId)) break;
    const nodes = await chrome.bookmarks.get(currentId);
    if (nodes.length === 0) break;
    const n = nodes[0];
    uncached.push({ id: currentId, title: n.title || 'Root', parentId: n.parentId || '' });
    currentId = n.parentId || '';
  }

  // `uncached` is ordered from requested node up to the highest uncached ancestor.
  // Reverse to walk top-down so each parent path is resolved before its children.
  for (let i = uncached.length - 1; i >= 0; i--) {
    const { id, title, parentId } = uncached[i];
    const parentPath = parentId && parentId !== '0'
      ? (_folderPathCache.get(parentId) ?? '')
      : '';
    const path = parentPath ? `${parentPath} > ${title}` : title;
    _folderPathCache.set(id, path);
  }

  return _folderPathCache.get(nodeId) ?? '';
}

// Enrich a bookmark node with folderPath and type
async function enrichNode(node: chrome.bookmarks.BookmarkTreeNode): Promise<Record<string, unknown>> {
  const folderPath = node.parentId ? await getFolderPath(node.parentId) : '';
  return {
    id: node.id,
    title: node.title,
    type: node.url ? 'bookmark' : 'folder',
    url: node.url,
    parentId: node.parentId,
    index: node.index,
    dateAdded: node.dateAdded,
    dateGroupModified: node.dateGroupModified,
    folderPath,
    children: node.children ? node.children.map(c => ({
      id: c.id,
      title: c.title,
      type: c.url ? 'bookmark' : 'folder',
      url: c.url,
      parentId: c.parentId,
      index: c.index,
      dateAdded: c.dateAdded,
    })) : undefined,
  };
}

// Recursively count bookmarks and folders
function countNodes(nodes: chrome.bookmarks.BookmarkTreeNode[]): { total: number; folders: number; bookmarks: number } {
  let total = 0, folders = 0, bookmarks = 0;
  for (const node of nodes) {
    if (node.url) {
      bookmarks++; total++;
    } else if (node.children) {
      folders++; total++;
      const sub = countNodes(node.children);
      total += sub.total; folders += sub.folders; bookmarks += sub.bookmarks;
    }
  }
  return { total, folders, bookmarks };
}

// Trim tree to a max depth to prevent huge responses
function trimToDepth(nodes: chrome.bookmarks.BookmarkTreeNode[], maxDepth: number, currentDepth: number = 0): unknown[] {
  return nodes.map(node => {
    const trimmed: Record<string, unknown> = {
      id: node.id, title: node.title, url: node.url,
      parentId: node.parentId, index: node.index, dateAdded: node.dateAdded,
    };
    if (node.children) {
      if (currentDepth < maxDepth) {
        trimmed.children = trimToDepth(node.children, maxDepth, currentDepth + 1);
      } else {
        trimmed.childCount = node.children.length;
      }
    }
    return trimmed;
  });
}

// --- Tool handlers ---

export async function handleGetTree(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = args.folder_id as string | undefined;
  const depth = args.depth as number | undefined;
  const tree = await getTreeOrSubtree(folderId);

  // Default depth 2 to keep response under MCP token limits. Use depth: 0 for unlimited.
  const effectiveDepth = depth === 0 ? undefined : (depth ?? 2);
  if (effectiveDepth !== undefined) {
    return { status: 'success', data: trimToDepth(tree, effectiveDepth) };
  }
  return { status: 'success', data: tree };
}

export async function handleList(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = (args.folder_id as string) || '0';
  const limit = (args.limit as number) || 100;
  const offset = (args.offset as number) || 0;

  const children = await chrome.bookmarks.getChildren(folderId);
  const sliced = children.slice(offset, offset + limit);
  const enriched = await Promise.all(sliced.map(enrichNode));

  return {
    status: 'success',
    data: { items: enriched, total: children.length, hasMore: offset + limit < children.length },
  };
}

// Resolve a folder path like "Bookmarks Bar > Tech > AI" to its folder ID.
// Walks down from root (or a given parent) matching folder names at each level.
async function resolveFolderPath(path: string, rootId: string = '0'): Promise<string | null> {
  const parts = path.split('>').map(p => p.trim()).filter(Boolean);
  let currentId = rootId;

  for (const part of parts) {
    const children = await chrome.bookmarks.getChildren(currentId);
    const match = children.find(c => !c.url && c.title === part);
    if (!match) return null;
    currentId = match.id;
  }

  return currentId;
}

export async function handleSearch(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const query = args.query as string;
  let folderId = args.folder_id as string | undefined;
  const folderPath = args.folder_path as string | undefined;
  const limit = (args.limit as number) || 50;

  if (!query) return { status: 'error', error: 'query is required' };

  // Resolve folder_path to folder_id if provided
  if (folderPath && !folderId) {
    const resolved = await resolveFolderPath(folderPath);
    if (!resolved) {
      return { status: 'error', error: `Folder not found: ${folderPath}` };
    }
    folderId = resolved;
  }

  let results = await chrome.bookmarks.search(query);

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
    data: { items: enriched, total: results.length, returned: sliced.length },
  };
}

export async function handleGet(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const id = args.id as string;
  if (!id) return { status: 'error', error: 'id is required' };

  try {
    const nodes = await chrome.bookmarks.get(id);
    if (nodes.length === 0) return { status: 'error', error: `Bookmark not found: ${id}` };
    return { status: 'success', data: await enrichNode(nodes[0]) };
  } catch {
    return { status: 'error', error: `Bookmark not found: ${id}` };
  }
}

export async function handleCount(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const tree = await getTreeOrSubtree(args.folder_id as string | undefined);
  const stats = countNodes(tree[0]?.children || tree);
  return { status: 'success', data: stats };
}

export async function handleFindDuplicates(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const tree = await getTreeOrSubtree(args.folder_id as string | undefined);
  const allBookmarks = flattenBookmarks(tree);

  const urlMap = new Map<string, chrome.bookmarks.BookmarkTreeNode[]>();
  for (const bm of allBookmarks) {
    if (!bm.url) continue;
    const existing = urlMap.get(bm.url) || [];
    existing.push(bm);
    urlMap.set(bm.url, existing);
  }

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
