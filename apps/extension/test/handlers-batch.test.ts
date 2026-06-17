import { describe, test, expect, beforeEach } from 'bun:test';
import { installChromeFake, type ChromeBookmarksFake, type SeedNode } from './chrome-bookmarks-fake.js';
import {
  handleDeduplicate,
  handleMergeFolders,
  handleBatchDelete,
} from '../entrypoints/background/handlers/batch.js';

// All node ids (pre-order, index order) whose url matches. Pre-order mirrors
// flattenBookmarks, so allIdsByUrl(...)[0] is the node handleDeduplicate treats
// as "first" and the last entry is the "last".
function allIdsByUrl(fake: ChromeBookmarksFake, url: string): string[] {
  const out: string[] = [];
  function walk(nodes: chrome.bookmarks.BookmarkTreeNode[]): void {
    for (const n of nodes) {
      if (n.url === url) out.push(n.id);
      if (n.children) walk(n.children);
    }
  }
  walk(fake.snapshot());
  return out;
}

function findIdByUrl(fake: ChromeBookmarksFake, url: string): string | undefined {
  return allIdsByUrl(fake, url)[0];
}

// Collect every url present in the tree (with duplicates).
function allUrls(fake: ChromeBookmarksFake): string[] {
  const out: string[] = [];
  const stack = [...fake.snapshot()];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.url) out.push(n.url);
    if (n.children) stack.push(...n.children);
  }
  return out;
}

// Find a folder id by title (depth-first).
function findFolderIdByTitle(fake: ChromeBookmarksFake, title: string): string | undefined {
  const stack = [...fake.snapshot()];
  while (stack.length) {
    const n = stack.pop()!;
    if (!n.url && n.title === title) return n.id;
    if (n.children) stack.push(...n.children);
  }
  return undefined;
}

describe('handleDeduplicate', () => {
  let fake: ChromeBookmarksFake;

  beforeEach(() => {
    // Two copies of the same url under Bookmarks Bar; the first seeded wins for
    // keep:'first', the last seeded wins for keep:'last'.
    const seed: SeedNode[] = [
      { title: 'First copy', url: 'https://dup.example' },
      { title: 'Second copy', url: 'https://dup.example' },
      { title: 'Unique', url: 'https://unique.example' },
    ];
    fake = installChromeFake(seed);
  });

  test("keep:'first' removes later copies and keeps the first node", async () => {
    const firstId = findIdByUrl(fake, 'https://dup.example');
    const res = await handleDeduplicate({ scope: 'global', keep: 'first', confirm: true });

    expect(res.status).toBe('success');
    const data = res.data as { removed: number; details: Array<{ kept: string }> };
    expect(data.removed).toBe(1);
    // The kept node is still present; exactly one copy of the url remains.
    expect(fake.node(firstId!)).toBeDefined();
    expect(allUrls(fake).filter((u) => u === 'https://dup.example')).toHaveLength(1);
    expect(data.details[0].kept).toBe(firstId!);
  });

  test("keep:'last' keeps the last node instead of the first", async () => {
    // Resolve the LAST occurrence (pre-order) before mutation.
    const ids = allIdsByUrl(fake, 'https://dup.example');
    const lastId = ids[ids.length - 1];

    const res = await handleDeduplicate({ scope: 'global', keep: 'last', confirm: true });
    expect(res.status).toBe('success');
    const data = res.data as { removed: number; details: Array<{ kept: string }> };
    expect(data.removed).toBe(1);
    expect(fake.node(lastId)).toBeDefined();
    expect(data.details[0].kept).toBe(lastId);
  });

  test('without folder_id or scope it errors and mutates nothing', async () => {
    const before = JSON.stringify(fake.snapshot());
    const res = await handleDeduplicate({ keep: 'first', confirm: true });

    expect(res.status).toBe('error');
    expect(res.error).toContain('folder_id');
    expect(res.error).toContain('global');
    expect(fake.mutations.remove).toBe(0);
    expect(fake.mutations.removeTree).toBe(0);
    expect(JSON.stringify(fake.snapshot())).toBe(before);
  });

  test('dry_run returns a preview and mutates nothing', async () => {
    const before = JSON.stringify(fake.snapshot());
    const res = await handleDeduplicate({ scope: 'global', keep: 'first', dry_run: true, confirm: true });

    expect(res.status).toBe('success');
    const data = res.data as { preview: boolean; wouldDelete: unknown[]; count: number };
    expect(data.preview).toBe(true);
    expect(data.count).toBe(1);
    expect(data.wouldDelete).toHaveLength(1);
    expect(fake.mutations.remove).toBe(0);
    expect(JSON.stringify(fake.snapshot())).toBe(before);
  });

  test('without confirm it previews (does not execute)', async () => {
    const res = await handleDeduplicate({ scope: 'global', keep: 'first' });
    const data = res.data as { preview?: boolean };
    expect(data.preview).toBe(true);
    expect(fake.mutations.remove).toBe(0);
  });
});

describe('handleMergeFolders with source nested inside target', () => {
  let fake: ChromeBookmarksFake;
  let sourceId: string;
  let targetId: string;

  beforeEach(() => {
    // Target folder contains its own bookmark AND a nested Source folder that
    // holds a duplicate of the target bookmark plus a unique one.
    const seed: SeedNode[] = [
      {
        title: 'Target',
        children: [
          { title: 'Shared', url: 'https://shared.example' },
          {
            title: 'Source',
            children: [
              { title: 'Shared dup', url: 'https://shared.example' },
              { title: 'Only in source', url: 'https://only-source.example' },
            ],
          },
        ],
      },
    ];
    fake = installChromeFake(seed);
    targetId = findFolderIdByTitle(fake, 'Target')!;
    sourceId = findFolderIdByTitle(fake, 'Source')!;
  });

  test('does not delete source bookmarks against themselves', async () => {
    // dedup on; source is INSIDE target. The exclude-source logic must prevent
    // the source bookmark from matching itself. Only the genuine duplicate
    // (against the target-level "Shared") should be removed.
    const res = await handleMergeFolders({
      source_id: sourceId,
      target_id: targetId,
      deduplicate: true,
      delete_source: false,
      confirm: true,
    });

    expect(res.status).toBe('success');
    const data = res.data as { moved: number; duplicatesRemoved: number };
    // "Only in source" moves up to Target; "Shared dup" is a real duplicate of
    // the target's "Shared" and is removed.
    expect(data.moved).toBe(1);
    expect(data.duplicatesRemoved).toBe(1);
    // The unique url survived the move; shared url still present exactly once.
    expect(allUrls(fake)).toContain('https://only-source.example');
    expect(allUrls(fake).filter((u) => u === 'https://shared.example')).toHaveLength(1);
  });

  test('merge with deduplicate but no confirm previews and removes nothing (CORR-2b)', async () => {
    const before = JSON.stringify(fake.snapshot());
    const res = await handleMergeFolders({
      source_id: sourceId,
      target_id: targetId,
      deduplicate: true,
      delete_source: false,
    });

    expect(res.status).toBe('success');
    const data = res.data as { preview?: boolean; count?: number };
    expect(data.preview).toBe(true);
    expect(data.count).toBe(1); // the one genuine duplicate that would be removed
    expect(fake.mutations.move).toBe(0);
    expect(fake.mutations.remove).toBe(0);
    expect(JSON.stringify(fake.snapshot())).toBe(before);
  });

  test('rejects when target is a descendant of source and mutates nothing', async () => {
    // Swap roles: target is now inside source -> illegal merge direction.
    const before = JSON.stringify(fake.snapshot());
    const res = await handleMergeFolders({
      source_id: targetId,
      target_id: sourceId,
    });

    expect(res.status).toBe('error');
    expect(res.error).toContain('descendant');
    expect(fake.mutations.move).toBe(0);
    expect(fake.mutations.remove).toBe(0);
    expect(JSON.stringify(fake.snapshot())).toBe(before);
  });

  test('delete_source without confirm returns a preview and mutates nothing', async () => {
    const before = JSON.stringify(fake.snapshot());
    const res = await handleMergeFolders({
      source_id: sourceId,
      target_id: targetId,
      delete_source: true,
    });

    expect(res.status).toBe('success');
    const data = res.data as { preview: boolean; wouldDelete: Array<{ id: string }>; count: number };
    expect(data.preview).toBe(true);
    // The source folder itself is part of what would be deleted.
    expect(data.wouldDelete.some((w) => w.id === sourceId)).toBe(true);
    expect(fake.mutations.move).toBe(0);
    expect(fake.mutations.remove).toBe(0);
    expect(fake.mutations.removeTree).toBe(0);
    expect(JSON.stringify(fake.snapshot())).toBe(before);
  });
});

describe('handleBatchDelete', () => {
  let fake: ChromeBookmarksFake;
  let aId: string;
  let bId: string;

  beforeEach(() => {
    const seed: SeedNode[] = [
      { title: 'A', url: 'https://a.example' },
      { title: 'B', url: 'https://b.example' },
    ];
    fake = installChromeFake(seed);
    aId = findIdByUrl(fake, 'https://a.example')!;
    bId = findIdByUrl(fake, 'https://b.example')!;
  });

  test('partial-failure counts and skippedRootFolders are reported', async () => {
    // Mix a real id, a root folder id ('1' = Bookmarks Bar, skipped), and a
    // bogus id (fails in remove). Expect deleted:1, skipped:1, one error.
    const res = await handleBatchDelete({
      ids: [aId, '1', 'does-not-exist'],
      confirm: true,
    });

    expect(res.status).toBe('success');
    const data = res.data as {
      deleted: number;
      failed: number;
      skippedRootFolders?: number;
      errors?: string[];
    };
    expect(data.deleted).toBe(1);
    expect(data.skippedRootFolders).toBe(1);
    expect(data.failed).toBe(1);
    expect(data.errors).toHaveLength(1);
    // 'A' is gone; 'B' untouched.
    expect(fake.node(aId)).toBeUndefined();
    expect(fake.node(bId)).toBeDefined();
  });

  test('dry_run returns a preview and mutates nothing', async () => {
    const before = JSON.stringify(fake.snapshot());
    const res = await handleBatchDelete({ ids: [aId, bId], dry_run: true, confirm: true });

    expect(res.status).toBe('success');
    const data = res.data as { preview: boolean; wouldDelete: Array<{ id: string }>; count: number };
    expect(data.preview).toBe(true);
    expect(data.count).toBe(2);
    expect(data.wouldDelete.map((w) => w.id).sort()).toEqual([aId, bId].sort());
    expect(fake.mutations.remove).toBe(0);
    expect(JSON.stringify(fake.snapshot())).toBe(before);
  });

  test('without confirm it previews (does not execute)', async () => {
    const res = await handleBatchDelete({ ids: [aId] });
    const data = res.data as { preview?: boolean };
    expect(data.preview).toBe(true);
    expect(fake.mutations.remove).toBe(0);
    expect(fake.node(aId)).toBeDefined();
  });
});
