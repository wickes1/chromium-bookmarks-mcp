import { ROOT_FOLDER_IDS } from '@chromium-bookmarks-mcp/shared';
import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';
import { flattenBookmarks, getTreeOrSubtree, clearFolderPathCache } from './read.js';

// Shape of a previewed item across all destructive batch tools.
interface PreviewItem {
  id: string;
  title: string;
  url?: string;
}

// A destructive op executes only when the caller explicitly confirms AND is not
// in dry-run mode. Any other combination yields a non-mutating preview instead.
function shouldExecute(args: Record<string, unknown>): boolean {
  return args.confirm === true && args.dry_run !== true;
}

function previewResponse(wouldDelete: PreviewItem[]): ToolCallResponse {
  return {
    status: 'success',
    data: { preview: true, wouldDelete, count: wouldDelete.length },
  };
}

// Returns true if candidateId is the same node as ancestorId, or anywhere in its
// subtree. Walks the parent chain of the candidate up to the root.
async function isSelfOrDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
  if (candidateId === ancestorId) return true;
  let currentId: string | undefined = candidateId;
  while (currentId && currentId !== '0') {
    const nodes: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.get(currentId);
    if (nodes.length === 0) break;
    const parent: string | undefined = nodes[0].parentId;
    if (parent === ancestorId) return true;
    currentId = parent;
  }
  return false;
}

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

  if (moved > 0) clearFolderPathCache();

  return {
    status: moved > 0 ? 'success' : 'error',
    data: { moved, failed: errors.length, errors: errors.length > 0 ? errors : undefined },
  };
}

function flattenBookmarksExcluding(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  excludeId: string,
  result: chrome.bookmarks.BookmarkTreeNode[] = [],
): chrome.bookmarks.BookmarkTreeNode[] {
  for (const node of nodes) {
    if (node.id === excludeId) continue;
    if (node.url) result.push(node);
    if (node.children) flattenBookmarksExcluding(node.children, excludeId, result);
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

  // Moving a folder's children into one of its own descendants would orphan them
  // or fail mid-loop. Reject before touching anything (mirrors the same-id guard).
  if (await isSelfOrDescendant(targetId, sourceId)) {
    return { status: 'error', error: 'target_id must not be the source folder or one of its descendants' };
  }

  // Get existing URLs in target for dedup — EXCLUDE source subtree to prevent
  // source bookmarks from matching against themselves when source is inside target.
  let targetUrls = new Set<string>();
  if (deduplicate) {
    const targetTree = await chrome.bookmarks.getSubTree(targetId);
    const targetBookmarks = flattenBookmarksExcluding(targetTree, sourceId);
    targetUrls = new Set(targetBookmarks.map(b => b.url!).filter(Boolean));
  }

  // Get source children
  const sourceChildren = await chrome.bookmarks.getChildren(sourceId);

  // Any path that permanently deletes is gated: the source folder when
  // delete_source, AND the duplicate children removed when deduplicate. Without
  // confirm (or in dry_run) return a non-mutating preview of exactly what would
  // be removed. A pure move-merge removes nothing and proceeds ungated (moves
  // only relocate data) (CORR-2b).
  const dupesToRemove = deduplicate
    ? sourceChildren.filter((c) => c.url && targetUrls.has(c.url))
    : [];
  if (!shouldExecute(args) && (deleteSource || dupesToRemove.length > 0)) {
    const wouldDelete: PreviewItem[] = dupesToRemove.map((c) => ({ id: c.id, title: c.title, url: c.url }));
    if (deleteSource) wouldDelete.push({ id: sourceId, title: '(source folder)' });
    return previewResponse(wouldDelete);
  }

  let moved = 0;
  let duplicatesRemoved = 0;
  const duplicateDetails: Array<{ id: string; title: string; url: string }> = [];
  const errors: string[] = [];

  // Do all moves first, then the destructive duplicate removes, so a failure
  // part way through never leaves moved children stranded under a half-removed
  // source. Each op is wrapped so one failure doesn't abort the whole merge.
  const duplicates: chrome.bookmarks.BookmarkTreeNode[] = [];
  for (const child of sourceChildren) {
    if (deduplicate && child.url && targetUrls.has(child.url)) {
      duplicates.push(child);
    } else {
      try {
        await chrome.bookmarks.move(child.id, { parentId: targetId });
        moved++;
        if (child.url) targetUrls.add(child.url);
      } catch (err) {
        errors.push(`move ${child.id}: ${(err as Error).message}`);
      }
    }
  }

  for (const child of duplicates) {
    try {
      await chrome.bookmarks.remove(child.id);
      duplicatesRemoved++;
      duplicateDetails.push({ id: child.id, title: child.title, url: child.url! });
    } catch (err) {
      errors.push(`remove ${child.id}: ${(err as Error).message}`);
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
    } catch (err) {
      // Source might be a root folder, or removal may fail.
      errors.push(`delete source ${sourceId}: ${(err as Error).message}`);
    }
  }

  if (moved > 0 || duplicatesRemoved > 0 || sourceDeleted) clearFolderPathCache();

  return {
    status: 'success',
    data: {
      moved,
      duplicatesRemoved,
      sourceDeleted,
      duplicates: duplicateDetails.length > 0 ? duplicateDetails : undefined,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
}

// --- Tool: bookmark_deduplicate ---
export async function handleDeduplicate(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const folderId = args.folder_id as string | undefined;
  const scope = args.scope as string | undefined;
  const keep = (args.keep as string) || 'first';

  // Guard against an omitted folder_id silently deduplicating the entire tree.
  // The caller must scope explicitly: a folder_id, or scope:'global'.
  if (!folderId && scope !== 'global') {
    return { status: 'error', error: 'specify folder_id or scope:"global"' };
  }

  const tree = await getTreeOrSubtree(folderId);
  const allBookmarks = flattenBookmarks(tree);

  // Group by URL
  const urlMap = new Map<string, chrome.bookmarks.BookmarkTreeNode[]>();
  for (const bm of allBookmarks) {
    if (!bm.url) continue;
    const existing = urlMap.get(bm.url) || [];
    existing.push(bm);
    urlMap.set(bm.url, existing);
  }

  // Resolve, per URL group, which nodes would be removed (all but the kept one).
  const plan: Array<{ url: string; keptId: string; toRemove: chrome.bookmarks.BookmarkTreeNode[] }> = [];
  for (const [url, nodes] of urlMap) {
    if (nodes.length <= 1) continue;
    const sorted = [...nodes];
    if (keep === 'last') sorted.reverse();
    plan.push({ url, keptId: sorted[0].id, toRemove: sorted.slice(1) });
  }

  // Non-mutating preview unless explicitly confirmed.
  if (!shouldExecute(args)) {
    const wouldDelete: PreviewItem[] = [];
    for (const { toRemove } of plan) {
      for (const node of toRemove) {
        wouldDelete.push({ id: node.id, title: node.title, url: node.url });
      }
    }
    return previewResponse(wouldDelete);
  }

  let removed = 0;
  const details: Array<{ url: string; kept: string; removed: string[] }> = [];

  for (const { url, keptId, toRemove } of plan) {
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
      details.push({ url, kept: keptId, removed: removedIds });
    }
  }

  if (removed > 0) clearFolderPathCache();

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

  const safeIds = ids.filter(id => !ROOT_FOLDER_IDS.includes(id));
  const skipped = ids.length - safeIds.length;

  // Non-mutating preview unless explicitly confirmed. Resolve each id to its
  // title/url so the caller can see exactly what would be deleted; ids that
  // cannot be resolved are still listed so the preview count is accurate.
  if (!shouldExecute(args)) {
    const wouldDelete: PreviewItem[] = [];
    for (const id of safeIds) {
      try {
        const nodes = await chrome.bookmarks.get(id);
        const n = nodes[0];
        wouldDelete.push({ id, title: n?.title ?? '', url: n?.url });
      } catch {
        wouldDelete.push({ id, title: '' });
      }
    }
    return {
      status: 'success',
      data: {
        preview: true,
        wouldDelete,
        count: wouldDelete.length,
        skippedRootFolders: skipped > 0 ? skipped : undefined,
      },
    };
  }

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

  if (deleted > 0) clearFolderPathCache();

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
