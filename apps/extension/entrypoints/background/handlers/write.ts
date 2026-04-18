import { ROOT_FOLDER_IDS } from '@chromium-bookmarks-mcp/shared';
import type { ToolCallResponse } from '@chromium-bookmarks-mcp/shared';

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

  // Simple state-machine parser for Netscape Bookmark HTML
  const lines = html.split('\n');
  const folderStack: string[] = [targetId];

  for (const line of lines) {
    const trimmed = line.trim();

    // Folder start: <DT><H3 ...>Title</H3>
    const folderMatch = trimmed.match(/<DT><H3[^>]*>(.*?)<\/H3>/i);
    if (folderMatch) {
      const title = decodeHtmlEntities(folderMatch[1]);
      const folder = await chrome.bookmarks.create({
        parentId: folderStack[folderStack.length - 1],
        title,
      });
      folderStack.push(folder.id);
      folders++;
      continue;
    }

    // DL start — folder contents begin (folder was already pushed)
    if (trimmed.match(/^<DL>/i)) continue;

    // DL end — folder contents end, pop folder stack
    if (trimmed.match(/^<\/DL>/i)) {
      if (folderStack.length > 1) folderStack.pop();
      continue;
    }

    // Bookmark: <DT><A HREF="..." ...>Title</A>
    const bookmarkMatch = trimmed.match(/<DT><A\s+HREF="([^"]*)"[^>]*>(.*?)<\/A>/i);
    if (bookmarkMatch) {
      const url = decodeHtmlEntities(bookmarkMatch[1]);
      const title = decodeHtmlEntities(bookmarkMatch[2]);
      await chrome.bookmarks.create({
        parentId: folderStack[folderStack.length - 1],
        title,
        url,
      });
      created++;
    }
  }

  return { status: 'success', data: { created, folders } };
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

  const details: chrome.bookmarks.BookmarkCreateArg = {
    parentId: resolvedParentId,
    title,
    url,
    index,
  };

  const created = await chrome.bookmarks.create(details);
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

  const changes: chrome.bookmarks.BookmarkChangesArg = {};
  if (title !== undefined) changes.title = title;
  if (url !== undefined) changes.url = url;

  try {
    const updated = await chrome.bookmarks.update(id, changes);
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
    const destination: chrome.bookmarks.BookmarkDestinationArg = { parentId };
    if (index !== undefined) destination.index = index;
    const moved = await chrome.bookmarks.move(id, destination);
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
    return { status: 'success', data: { deletedFolder: folderTitle, deletedItems: count } };
  } catch (err) {
    return { status: 'error', error: (err as Error).message };
  }
}
