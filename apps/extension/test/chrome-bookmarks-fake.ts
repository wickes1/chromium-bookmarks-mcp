/**
 * In-memory chrome.bookmarks fake for handler unit tests.
 *
 * Backs a mutable bookmark tree and projects the same node shapes the real
 * Chromium API returns, so a handler can seed a tree, run, and assert the
 * resulting tree. Methods implemented: get, getChildren, getSubTree, getTree,
 * create, move, remove, removeTree, update, search.
 *
 * Semantics deliberately mirror Chromium where handlers depend on them:
 *  - getChildren returns shallow nodes (no `children` array), sorted by index.
 *  - getSubTree/getTree return deep nodes; every folder carries a `children`
 *    array (empty for empty folders), every bookmark carries `url`.
 *  - remove() throws on a non-empty folder (use removeTree); removeTree removes
 *    a folder and its whole subtree.
 *  - move()/create() recompute sibling indices; create() appends unless `index`
 *    is given. Root ids are '0' (root), '1' (Bookmarks Bar), '2' (Other).
 */

export interface FakeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded?: number;
  dateGroupModified?: number;
  // Present only on folders. Stored as ordered child ids.
  childIds?: string[];
}

export interface SeedNode {
  title: string;
  url?: string;
  dateAdded?: number;
  children?: SeedNode[];
}

export interface ChromeBookmarksFake {
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
  // The live API surface assigned onto globalThis.chrome.bookmarks.
  api: ChromeBookmarksApi;
  // Dump the current tree as plain nested nodes (handy for assertions).
  snapshot(): chrome.bookmarks.BookmarkTreeNode[];
  // Direct access to a node by id (or undefined). Returns a deep projection.
  node(id: string): chrome.bookmarks.BookmarkTreeNode | undefined;
  // Number of mutating calls, useful to assert "nothing was touched".
  mutations: { create: number; move: number; remove: number; removeTree: number; update: number };
}

// The subset of chrome.bookmarks the handlers call. Kept structural so the
// fake can be installed without pulling the full @types/chrome surface.
export interface ChromeBookmarksApi {
  get(idOrIdList: string | string[]): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  getChildren(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  getSubTree(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  getTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  create(detail: chrome.bookmarks.CreateDetails): Promise<chrome.bookmarks.BookmarkTreeNode>;
  move(
    id: string,
    destination: { parentId?: string; index?: number },
  ): Promise<chrome.bookmarks.BookmarkTreeNode>;
  remove(id: string): Promise<void>;
  removeTree(id: string): Promise<void>;
  update(
    id: string,
    changes: { title?: string; url?: string },
  ): Promise<chrome.bookmarks.BookmarkTreeNode>;
  search(query: string | { query?: string; url?: string; title?: string }): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
}

const ROOT_ID = '0';
const DEFAULT_ROOTS: Array<{ id: string; title: string }> = [
  { id: '1', title: 'Bookmarks Bar' },
  { id: '2', title: 'Other Bookmarks' },
];

/**
 * Build the fake. If `seed` is provided, its top-level entries are placed under
 * the Bookmarks Bar ('1') unless `seedParentId` says otherwise.
 */
export function createChromeBookmarksFake(
  seed?: SeedNode[],
  seedParentId: string = '1',
): ChromeBookmarksFake {
  const nodes = new Map<string, FakeNode>();
  let nextId = 100;
  const mutations = { create: 0, move: 0, remove: 0, removeTree: 0, update: 0 };

  function allocId(): string {
    return String(nextId++);
  }

  // --- bootstrap the immutable root scaffold ---
  nodes.set(ROOT_ID, { id: ROOT_ID, title: '', childIds: [], dateAdded: 0 });
  for (let i = 0; i < DEFAULT_ROOTS.length; i++) {
    const r = DEFAULT_ROOTS[i];
    nodes.set(r.id, { id: r.id, parentId: ROOT_ID, index: i, title: r.title, childIds: [], dateAdded: 0 });
    nodes.get(ROOT_ID)!.childIds!.push(r.id);
  }

  function insertSeed(seedNodes: SeedNode[], parentId: string): void {
    for (const s of seedNodes) {
      const id = allocId();
      const parent = nodes.get(parentId);
      if (!parent || !parent.childIds) throw new Error(`seed parent not a folder: ${parentId}`);
      const node: FakeNode = {
        id,
        parentId,
        index: parent.childIds.length,
        title: s.title,
        dateAdded: s.dateAdded ?? Date.now(),
      };
      if (s.url !== undefined && s.children === undefined) {
        node.url = s.url;
      } else {
        node.childIds = [];
      }
      nodes.set(id, node);
      parent.childIds.push(id);
      if (s.children && s.children.length > 0) {
        insertSeed(s.children, id);
      }
    }
  }

  if (seed && seed.length > 0) {
    insertSeed(seed, seedParentId);
  }

  // --- projections (the shapes the real API returns) ---

  function shallow(node: FakeNode): chrome.bookmarks.BookmarkTreeNode {
    const out: chrome.bookmarks.BookmarkTreeNode = {
      id: node.id,
      title: node.title,
    } as chrome.bookmarks.BookmarkTreeNode;
    if (node.parentId !== undefined) out.parentId = node.parentId;
    if (node.index !== undefined) out.index = node.index;
    if (node.url !== undefined) out.url = node.url;
    if (node.dateAdded !== undefined) out.dateAdded = node.dateAdded;
    if (node.dateGroupModified !== undefined) out.dateGroupModified = node.dateGroupModified;
    return out;
  }

  function deep(node: FakeNode): chrome.bookmarks.BookmarkTreeNode {
    const out = shallow(node);
    if (node.childIds) {
      out.children = orderedChildren(node).map(deep);
    }
    return out;
  }

  function orderedChildren(node: FakeNode): FakeNode[] {
    if (!node.childIds) return [];
    return node.childIds.map((cid) => {
      const c = nodes.get(cid);
      if (!c) throw new Error(`dangling child id ${cid} under ${node.id}`);
      return c;
    });
  }

  function requireNode(id: string): FakeNode {
    const n = nodes.get(id);
    if (!n) throw new Error(`Can't find bookmark for id.`);
    return n;
  }

  function reindex(parent: FakeNode): void {
    if (!parent.childIds) return;
    parent.childIds.forEach((cid, i) => {
      const c = nodes.get(cid);
      if (c) c.index = i;
    });
  }

  function detach(node: FakeNode): void {
    if (node.parentId === undefined) return;
    const parent = nodes.get(node.parentId);
    if (parent && parent.childIds) {
      parent.childIds = parent.childIds.filter((cid) => cid !== node.id);
      reindex(parent);
    }
  }

  function collectSubtreeIds(id: string, acc: string[] = []): string[] {
    acc.push(id);
    const n = nodes.get(id);
    if (n && n.childIds) {
      for (const cid of n.childIds) collectSubtreeIds(cid, acc);
    }
    return acc;
  }

  function isDescendant(maybeDescendantId: string, ancestorId: string): boolean {
    let cur = nodes.get(maybeDescendantId);
    while (cur && cur.parentId !== undefined) {
      if (cur.parentId === ancestorId) return true;
      cur = nodes.get(cur.parentId);
    }
    return false;
  }

  // --- the API ---

  const api: ChromeBookmarksApi = {
    async get(idOrIdList) {
      const ids = Array.isArray(idOrIdList) ? idOrIdList : [idOrIdList];
      const result: chrome.bookmarks.BookmarkTreeNode[] = [];
      for (const id of ids) {
        const n = nodes.get(id);
        if (!n) throw new Error(`Can't find bookmark for id: ${id}`);
        result.push(shallow(n));
      }
      return result;
    },

    async getChildren(id) {
      const n = requireNode(id);
      if (!n.childIds) throw new Error(`Can't get children of a non-folder: ${id}`);
      return orderedChildren(n).map(shallow);
    },

    async getSubTree(id) {
      const n = requireNode(id);
      return [deep(n)];
    },

    async getTree() {
      return [deep(requireNode(ROOT_ID))];
    },

    async create(detail) {
      const parentId = detail.parentId ?? '1';
      const parent = nodes.get(parentId);
      if (!parent) throw new Error(`Can't find parent bookmark for id: ${parentId}`);
      if (!parent.childIds) throw new Error(`Parent is not a folder: ${parentId}`);

      const id = allocId();
      const node: FakeNode = {
        id,
        parentId,
        title: detail.title ?? '',
        dateAdded: Date.now(),
      };
      // A node with a url is a bookmark; without one it is a folder.
      if (detail.url !== undefined) {
        node.url = detail.url;
      } else {
        node.childIds = [];
      }
      nodes.set(id, node);

      const at =
        typeof detail.index === 'number'
          ? Math.max(0, Math.min(detail.index, parent.childIds.length))
          : parent.childIds.length;
      parent.childIds.splice(at, 0, id);
      reindex(parent);
      mutations.create++;
      return shallow(node);
    },

    async move(id, destination) {
      const node = requireNode(id);
      const targetParentId = destination.parentId ?? node.parentId;
      if (targetParentId === undefined) throw new Error(`Can't move root.`);
      const targetParent = nodes.get(targetParentId);
      if (!targetParent) throw new Error(`Can't find destination parent: ${targetParentId}`);
      if (!targetParent.childIds) throw new Error(`Destination is not a folder: ${targetParentId}`);
      if (id === targetParentId || isDescendant(targetParentId, id)) {
        throw new Error(`Can't move a folder into itself or a descendant.`);
      }

      detach(node);
      node.parentId = targetParentId;
      const at =
        typeof destination.index === 'number'
          ? Math.max(0, Math.min(destination.index, targetParent.childIds.length))
          : targetParent.childIds.length;
      targetParent.childIds.splice(at, 0, id);
      reindex(targetParent);
      mutations.move++;
      return shallow(node);
    },

    async remove(id) {
      const node = requireNode(id);
      if (node.childIds && node.childIds.length > 0) {
        throw new Error(`Can't remove non-empty folder (use recursive to force removal).`);
      }
      detach(node);
      nodes.delete(id);
      mutations.remove++;
    },

    async removeTree(id) {
      requireNode(id);
      const ids = collectSubtreeIds(id);
      const root = nodes.get(id)!;
      detach(root);
      for (const subId of ids) nodes.delete(subId);
      mutations.removeTree++;
    },

    async update(id, changes) {
      const node = requireNode(id);
      if (changes.title !== undefined) node.title = changes.title;
      if (changes.url !== undefined) {
        if (node.childIds) throw new Error(`Can't set a url on a folder: ${id}`);
        node.url = changes.url;
      }
      mutations.update++;
      return shallow(node);
    },

    async search(query) {
      const q = typeof query === 'string' ? query : (query.query ?? query.url ?? query.title ?? '');
      const needle = q.toLowerCase();
      const matches: chrome.bookmarks.BookmarkTreeNode[] = [];
      for (const n of nodes.values()) {
        if (n.id === ROOT_ID) continue;
        const inTitle = (n.title ?? '').toLowerCase().includes(needle);
        const inUrl = (n.url ?? '').toLowerCase().includes(needle);
        if (needle === '' || inTitle || inUrl) {
          matches.push(shallow(n));
        }
      }
      return matches;
    },
  };

  const fake: ChromeBookmarksFake = {
    get bookmarks() {
      return [deep(requireNode(ROOT_ID))];
    },
    api,
    snapshot() {
      return [deep(requireNode(ROOT_ID))];
    },
    node(id: string) {
      const n = nodes.get(id);
      return n ? deep(n) : undefined;
    },
    mutations,
  };

  return fake;
}

/**
 * Install the fake onto globalThis so handlers that reference the global
 * `chrome.bookmarks` resolve to it. Returns the fake for assertions.
 *
 *   const fake = installChromeFake([{ title: 'Tech', children: [...] }]);
 *   await handleDeduplicate({ scope: 'global', confirm: true });
 *   expect(fake.snapshot()).toEqual(...);
 */
export function installChromeFake(seed?: SeedNode[], seedParentId: string = '1'): ChromeBookmarksFake {
  const fake = createChromeBookmarksFake(seed, seedParentId);
  const g = globalThis as unknown as { chrome?: { bookmarks: ChromeBookmarksApi } };
  const existing = g.chrome ?? ({} as { bookmarks: ChromeBookmarksApi });
  existing.bookmarks = fake.api;
  g.chrome = existing;
  return fake;
}
