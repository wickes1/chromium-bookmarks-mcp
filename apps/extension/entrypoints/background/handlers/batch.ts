import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';
import { flattenBookmarks } from './read.js';

// --- Tool: bookmark_batch_move ---
export async function handleBatchMove(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const ids = args.ids as string[];
  const parentId = args.parent_id as string;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return { status: 'error', error: 'ids array is required and must not be empty' };
  }
  if (!parentId) {
    return { status: 'error', error: 'parent_id is required' };
  }

  let moved = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      await chrome.bookmarks.move(id, { parentId });
      moved++;
    } catch (err) {
      errors.push(`${id}: ${(err as Error).message}`);
    }
  }

  return {
    status: moved > 0 ? 'success' : 'error',
    data: { moved, failed: errors.length, errors: errors.length > 0 ? errors : undefined },
  };
}

// Helper: flatten bookmarks from a tree, excluding a specific subtree by ID
function flattenBookmarksExcluding(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  excludeId: string,
): chrome.bookmarks.BookmarkTreeNode[] {
  const result: chrome.bookmarks.BookmarkTreeNode[] = [];
  for (const node of nodes) {
    if (node.id === excludeId) continue; // skip the excluded subtree entirely
    if (node.url) result.push(node);
    if (node.children) result.push(...flattenBookmarksExcluding(node.children, excludeId));
  }
  return result;
}

// --- Tool: bookmark_merge_folders ---
export async function handleMergeFolders(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const sourceId = args.source_id as string;
  const targetId = args.target_id as string;
  const deleteSource = args.delete_source as boolean ?? false;
  const deduplicate = args.deduplicate as boolean ?? false;

  if (!sourceId) return { status: 'error', error: 'source_id is required' };
  if (!targetId) return { status: 'error', error: 'target_id is required' };
  if (sourceId === targetId) return { status: 'error', error: 'source_id and target_id must be different' };

  // Get existing URLs in target for dedup — EXCLUDE source subtree to prevent
  // source bookmarks from matching against themselves when source is inside target
  let targetUrls = new Set<string>();
  if (deduplicate) {
    const targetTree = await chrome.bookmarks.getSubTree(targetId);
    const targetBookmarks = flattenBookmarksExcluding(targetTree, sourceId);
    targetUrls = new Set(targetBookmarks.map(b => b.url!).filter(Boolean));
  }

  // Get source children
  const sourceChildren = await chrome.bookmarks.getChildren(sourceId);

  let moved = 0;
  let duplicatesRemoved = 0;
  const duplicateDetails: Array<{ id: string; title: string; url: string }> = [];

  for (const child of sourceChildren) {
    if (deduplicate && child.url && targetUrls.has(child.url)) {
      // Duplicate — remove from source
      duplicateDetails.push({ id: child.id, title: child.title, url: child.url });
      await chrome.bookmarks.remove(child.id);
      duplicatesRemoved++;
    } else {
      // Move to target
      await chrome.bookmarks.move(child.id, { parentId: targetId });
      moved++;
      if (child.url) targetUrls.add(child.url);
    }
  }

  let sourceDeleted = false;
  if (deleteSource) {
    try {
      const remaining = await chrome.bookmarks.getChildren(sourceId);
      if (remaining.length === 0) {
        await chrome.bookmarks.remove(sourceId);
      } else {
        await chrome.bookmarks.removeTree(sourceId);
      }
      sourceDeleted = true;
    } catch {
      // Source might be a root folder
    }
  }

  return {
    status: 'success',
    data: {
      moved,
      duplicatesRemoved,
      sourceDeleted,
      duplicates: duplicateDetails.length > 0 ? duplicateDetails : undefined,
    },
  };
}

// --- Tool: bookmark_deduplicate ---
export async function handleDeduplicate(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = args.folder_id as string | undefined;
  const keep = (args.keep as string) || 'first';

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

  let removed = 0;
  const details: Array<{ url: string; kept: string; removed: string[] }> = [];

  for (const [url, nodes] of urlMap) {
    if (nodes.length <= 1) continue;

    // Determine which to keep
    const sorted = [...nodes];
    if (keep === 'last') sorted.reverse();

    const keptNode = sorted[0];
    const toRemove = sorted.slice(1);

    const removedIds: string[] = [];
    for (const node of toRemove) {
      try {
        await chrome.bookmarks.remove(node.id);
        removed++;
        removedIds.push(node.id);
      } catch {
        // Already removed or cannot remove
      }
    }

    if (removedIds.length > 0) {
      details.push({ url, kept: keptNode.id, removed: removedIds });
    }
  }

  return {
    status: 'success',
    data: { removed, groups: details.length, details },
  };
}

// --- Tool: bookmark_batch_delete ---
export async function handleBatchDelete(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const ids = args.ids as string[];

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return { status: 'error', error: 'ids array is required and must not be empty' };
  }

  // Prevent deleting root folders
  const rootIds = ['0', '1', '2'];
  const safeIds = ids.filter(id => !rootIds.includes(id));
  const skipped = ids.length - safeIds.length;

  let deleted = 0;
  const errors: string[] = [];

  for (const id of safeIds) {
    try {
      await chrome.bookmarks.remove(id);
      deleted++;
    } catch (err) {
      errors.push(`${id}: ${(err as Error).message}`);
    }
  }

  return {
    status: deleted > 0 ? 'success' : 'error',
    data: {
      deleted,
      failed: errors.length,
      skippedRootFolders: skipped > 0 ? skipped : undefined,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
}
