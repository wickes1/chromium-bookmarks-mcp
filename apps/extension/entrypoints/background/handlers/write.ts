import { ROOT_FOLDER_IDS } from '@chromium-bookmarks-mcp/shared';
import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';
import { clearFolderPathCache } from './read.js';

// Helper: create nested folders from a path like "Tech > AI > LLM"
async function createFolderPath(path: string, rootId: string = '1'): Promise<string> {
  const parts = path.split('>').map(p => p.trim()).filter(Boolean);
  let parentId = rootId;

  for (const part of parts) {
    const children = await chrome.bookmarks.getChildren(parentId);
    const existing = children.find(c => !c.url && c.title === part);
    if (existing) {
      parentId = existing.id;
    } else {
      const created = await chrome.bookmarks.create({ parentId, title: part });
      parentId = created.id;
    }
  }

  return parentId;
}

// --- Tool: bookmark_import_html ---
export async function handleImportHtml(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const html = args.html as string;
  const parentId = args.parent_id as string | undefined;
  const targetId = parentId || '1'; // default to Bookmarks Bar

  if (!html) return { status: 'error', error: 'html content is required' };

  let created = 0;
  let folders = 0;
  // Track <DT>/<A> markup we saw but could not turn into a node, so a malformed
  // export reports a real diagnostic instead of a silent "success" (CORR-3).
  let unparsedDt = 0;
  let unparsedAnchors = 0;

  // Folder open is an <H3>; the folder's content is delimited by a following
  // <DL> ... </DL>. We push on <H3> and pop on </DL>. <DL> opens are no-ops
  // because the folder was already pushed by its <H3>. Tokens are matched
  // anywhere on the line (not anchored to line start) so one-line / minified
  // exports that pack <H3><DL>...</DL> together still balance correctly.
  const lines = html.split('\n');
  const folderStack: string[] = [targetId];

  // Quote- and attribute-order-tolerant matchers.
  //  - HREF may be single- or double-quoted and may follow other attributes.
  //  - </DL> is counted by occurrence, anywhere on the line.
  const h3Re = /<H3\b[^>]*>([\s\S]*?)<\/H3>/i;
  const anchorRe = /<A\b[^>]*\bHREF\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/A>/i;
  // Single scanning regex applied left-to-right so multiple tokens on one line
  // are handled in document order.
  const tokenRe = /<H3\b[^>]*>[\s\S]*?<\/H3>|<A\b[^>]*>[\s\S]*?<\/A>|<\/DL>/gi;

  for (const rawLine of lines) {
    const line = rawLine;
    const hasDt = /<DT\b/i.test(line);
    let matchedSomething = false;

    tokenRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(line)) !== null) {
      const token = m[0];

      if (/^<\/DL>/i.test(token)) {
        if (folderStack.length > 1) folderStack.pop();
        continue;
      }

      if (/^<H3\b/i.test(token)) {
        const h3 = token.match(h3Re);
        const title = decodeHtmlEntities(h3 ? h3[1] : '');
        const folder = await chrome.bookmarks.create({
          parentId: folderStack[folderStack.length - 1],
          title,
        });
        folderStack.push(folder.id);
        folders++;
        matchedSomething = true;
        continue;
      }

      // Anchor (bookmark).
      const a = token.match(anchorRe);
      if (a) {
        const rawHref = a[2] ?? a[3] ?? a[4] ?? '';
        const url = decodeHtmlEntities(rawHref);
        const title = decodeHtmlEntities(a[5] ?? '');
        await chrome.bookmarks.create({
          parentId: folderStack[folderStack.length - 1],
          title,
          url,
        });
        created++;
        matchedSomething = true;
      } else {
        // An <A>...</A> we matched structurally but couldn't extract an HREF
        // from (e.g. javascript: stripped, or no HREF attribute).
        unparsedAnchors++;
      }
    }

    // A line carrying a <DT> that produced no folder/bookmark is markup we
    // failed to parse — surface it rather than dropping it silently.
    if (hasDt && !matchedSomething) {
      unparsedDt++;
      if (/<A\b/i.test(line)) unparsedAnchors++;
    }
  }

  const data: Record<string, unknown> = { created, folders };
  if (unparsedDt > 0) data.unparsedDtLines = unparsedDt;
  if (unparsedAnchors > 0) data.unparsedAnchorLines = unparsedAnchors;

  // Created folders/bookmarks may shift folder paths — drop the stale cache.
  clearFolderPathCache();
  return { status: 'success', data };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// --- Tool: bookmark_create ---
export async function handleCreate(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const parentId = args.parent_id as string | undefined;
  const title = args.title as string;
  const url = args.url as string | undefined;
  const index = args.index as number | undefined;
  const createParents = args.create_parents as boolean | undefined;
  const parentPath = args.parent_path as string | undefined;

  if (!title) {
    return { status: 'error', error: 'title is required' };
  }

  let resolvedParentId = parentId || '1'; // default to Bookmarks Bar

  // If parent_path is provided and create_parents is true, create the folder path
  if (parentPath && createParents) {
    resolvedParentId = await createFolderPath(parentPath, parentId || '1');
  }

  const details: chrome.bookmarks.CreateDetails = {
    parentId: resolvedParentId,
    title,
    url,
    index,
  };

  const created = await chrome.bookmarks.create(details);
  clearFolderPathCache();
  return { status: 'success', data: created };
}

// --- Tool: bookmark_update ---
export async function handleUpdate(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const id = args.id as string;
  const title = args.title as string | undefined;
  const url = args.url as string | undefined;

  if (!id) {
    return { status: 'error', error: 'id is required' };
  }

  if (!title && !url) {
    return { status: 'error', error: 'At least one of title or url must be provided' };
  }

  const changes: { title?: string; url?: string } = {};
  if (title !== undefined) changes.title = title;
  if (url !== undefined) changes.url = url;

  try {
    const updated = await chrome.bookmarks.update(id, changes);
    clearFolderPathCache();
    return { status: 'success', data: updated };
  } catch {
    return { status: 'error', error: `Bookmark not found: ${id}` };
  }
}

// --- Tool: bookmark_move ---
export async function handleMove(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const id = args.id as string;
  const parentId = args.parent_id as string;
  const index = args.index as number | undefined;

  if (!id) {
    return { status: 'error', error: 'id is required' };
  }
  if (!parentId) {
    return { status: 'error', error: 'parent_id is required' };
  }

  try {
    const destination: { parentId?: string; index?: number } = { parentId };
    if (index !== undefined) destination.index = index;
    const moved = await chrome.bookmarks.move(id, destination);
    clearFolderPathCache();
    return { status: 'success', data: moved };
  } catch (err) {
    return { status: 'error', error: (err as Error).message };
  }
}

// --- Tool: bookmark_delete ---
export async function handleDelete(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const id = args.id as string;

  if (!id) {
    return { status: 'error', error: 'id is required' };
  }

  // Prevent deleting root folders
  if (ROOT_FOLDER_IDS.includes(id)) {
    return { status: 'error', error: 'Cannot delete root bookmark folders' };
  }

  try {
    const nodes = await chrome.bookmarks.get(id);
    const node = nodes[0];
    await chrome.bookmarks.remove(id);
    clearFolderPathCache();
    return { status: 'success', data: { deleted: node } };
  } catch {
    return { status: 'error', error: `Bookmark not found: ${id}` };
  }
}

// --- Tool: bookmark_delete_folder ---
export async function handleDeleteFolder(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const id = args.id as string;
  const confirm = args.confirm as boolean;

  if (!id) {
    return { status: 'error', error: 'id is required' };
  }

  if (!confirm) {
    return { status: 'error', error: 'confirm: true is required to delete a folder and all its contents' };
  }

  // Prevent deleting root folders
  if (ROOT_FOLDER_IDS.includes(id)) {
    return { status: 'error', error: 'Cannot delete root bookmark folders' };
  }

  try {
    // Count contents before deleting
    const subtree = await chrome.bookmarks.getSubTree(id);
    let count = 0;
    function countAll(nodes: chrome.bookmarks.BookmarkTreeNode[]) {
      for (const n of nodes) {
        count++;
        if (n.children) countAll(n.children);
      }
    }
    countAll(subtree[0]?.children || []);

    const folderTitle = subtree[0]?.title;
    await chrome.bookmarks.removeTree(id);
    clearFolderPathCache();
    return { status: 'success', data: { deletedFolder: folderTitle, deletedItems: count } };
  } catch (err) {
    return { status: 'error', error: (err as Error).message };
  }
}
