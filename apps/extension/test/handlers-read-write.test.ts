import { describe, test, expect, beforeEach } from 'bun:test';
import { installChromeFake, type SeedNode } from './chrome-bookmarks-fake';
import {
  clearFolderPathCache,
  handleSearch,
  handleExportHtml,
  handleCheckDeadLinks,
} from '../entrypoints/background/handlers/read';
import {
  handleCreate,
  handleUpdate,
  handleMove,
  handleDelete,
  handleImportHtml,
} from '../entrypoints/background/handlers/write';

// The handlers read the global `chrome.bookmarks` at call time; install a fresh
// fake before each test and reset the module-level folder-path cache so cache
// state from one test never leaks into the next.
beforeEach(() => {
  clearFolderPathCache();
});

// Walk a snapshot to find the first node whose title matches, returning the
// full node (with children for folders).
function findByTitle(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  title: string,
): chrome.bookmarks.BookmarkTreeNode | undefined {
  for (const n of nodes) {
    if (n.title === title) return n;
    if (n.children) {
      const hit = findByTitle(n.children, title);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe('handleCreate', () => {
  test('create_parents reuses an existing same-title folder instead of duplicating it', async () => {
    // Bookmarks Bar ('1') already contains Tech > AI.
    const fake = installChromeFake([
      { title: 'Tech', children: [{ title: 'AI', children: [] }] },
    ]);

    const before = fake.mutations.create;

    const res = await handleCreate({
      parent_path: 'Tech > AI',
      create_parents: true,
      title: 'Anthropic',
      url: 'https://anthropic.com',
    });

    expect(res.status).toBe('success');

    // Tech and AI must NOT have been re-created — only the leaf bookmark.
    const snapshot = fake.snapshot();
    const bar = findByTitle(snapshot, 'Bookmarks Bar')!;
    const techMatches = (bar.children ?? []).filter(c => c.title === 'Tech');
    expect(techMatches.length).toBe(1);
    const ai = findByTitle(snapshot, 'AI')!;
    const aiFolderMatches = (techMatches[0].children ?? []).filter(c => c.title === 'AI');
    expect(aiFolderMatches.length).toBe(1);

    // The bookmark landed inside the reused AI folder.
    const created = (ai.children ?? []).find(c => c.title === 'Anthropic');
    expect(created?.url).toBe('https://anthropic.com');

    // Exactly one create call (the bookmark); the two folders were reused.
    expect(fake.mutations.create - before).toBe(1);
  });
});

describe('handleUpdate / handleDelete error on missing id', () => {
  test('update returns an error for an unknown id and touches nothing', async () => {
    const fake = installChromeFake([{ title: 'Keep', url: 'https://keep.example' }]);
    const before = { ...fake.mutations };

    const res = await handleUpdate({ id: '99999', title: 'New title' });

    expect(res.status).toBe('error');
    expect(res.error).toContain('99999');
    expect(fake.mutations.update).toBe(before.update);
  });

  test('delete returns an error for an unknown id and touches nothing', async () => {
    const fake = installChromeFake([{ title: 'Keep', url: 'https://keep.example' }]);
    const before = { ...fake.mutations };

    const res = await handleDelete({ id: '99999' });

    expect(res.status).toBe('error');
    expect(res.error).toContain('99999');
    expect(fake.mutations.remove).toBe(before.remove);
    expect(fake.mutations.removeTree).toBe(before.removeTree);
  });

  test('update requires an id', async () => {
    installChromeFake();
    const res = await handleUpdate({ title: 'x' });
    expect(res.status).toBe('error');
    expect(res.error).toBe('id is required');
  });
});

describe('folderPath cache freshness after a move (CORR-8 regression guard)', () => {
  test('search returns the post-move folder path, not the stale pre-move one', async () => {
    // Two sibling folders under Bookmarks Bar; a bookmark starts under Tech.
    const seed: SeedNode[] = [
      { title: 'Tech', children: [{ title: 'Pinned', url: 'https://pin.example/unique-corr8' }] },
      { title: 'Archive', children: [] },
    ];
    const fake = installChromeFake(seed);

    const snap0 = fake.snapshot();
    const tech = findByTitle(snap0, 'Tech')!;
    const archive = findByTitle(snap0, 'Archive')!;
    const pinned = (tech.children ?? []).find(c => c.title === 'Pinned')!;

    // Prime the cache: search resolves and caches folderPath under Tech.
    const first = await handleSearch({ query: 'unique-corr8' });
    expect(first.status).toBe('success');
    const firstItems = (first.data as { items: Array<Record<string, unknown>> }).items;
    expect(firstItems[0].folderPath).toBe('Bookmarks Bar > Tech');

    // Move the bookmark into Archive. handleMove must invalidate the cache.
    const moveRes = await handleMove({ id: pinned.id, parent_id: archive.id });
    expect(moveRes.status).toBe('success');

    // A fresh search must reflect the NEW path. Without clearFolderPathCache()
    // in handleMove this would still report the stale "Bookmarks Bar > Tech".
    const second = await handleSearch({ query: 'unique-corr8' });
    const secondItems = (second.data as { items: Array<Record<string, unknown>> }).items;
    expect(secondItems[0].folderPath).toBe('Bookmarks Bar > Archive');
  });
});

describe('import_html round-trips a nested export from handleExportHtml', () => {
  test('export then import reproduces the same folder/bookmark structure', async () => {
    // A nested tree with a folder, a sub-folder, and bookmarks at two levels.
    const seed: SeedNode[] = [
      {
        title: 'Work',
        children: [
          { title: 'Anthropic', url: 'https://anthropic.com/' },
          {
            title: 'Tools',
            children: [
              { title: 'Ripgrep', url: 'https://github.com/BurntSushi/ripgrep' },
              { title: 'Query & Sort', url: 'https://example.com/?a=1&b=2' },
            ],
          },
        ],
      },
    ];
    const exportFake = installChromeFake(seed);

    // Export the whole tree to Netscape HTML.
    const exportRes = await handleExportHtml({});
    expect(exportRes.status).toBe('success');
    const html = (exportRes.data as { html: string }).html;

    // Fresh, empty store; import the HTML back under Bookmarks Bar.
    const importFake = installChromeFake();
    const importRes = await handleImportHtml({ html });
    expect(importRes.status).toBe('success');
    const importData = importRes.data as Record<string, unknown>;
    // export renders the named root containers (Bookmarks Bar, Other Bookmarks)
    // as <H3> folders too, so the faithful round-trip recreates them: 4 folders
    // (Bookmarks Bar, Work, Tools, Other Bookmarks) and 3 bookmarks.
    expect(importData.folders).toBe(4);
    expect(importData.created).toBe(3);
    // A clean round-trip leaves nothing unparsed.
    expect(importData.unparsedDtLines).toBeUndefined();
    expect(importData.unparsedAnchorLines).toBeUndefined();

    // Structure check: Work > Tools > Ripgrep survives, ampersand decodes.
    const snap = importFake.snapshot();
    const work = findByTitle(snap, 'Work');
    expect(work).toBeDefined();
    const tools = findByTitle(snap, 'Tools');
    expect(tools?.children?.length).toBe(2);
    const ripgrep = (tools!.children ?? []).find(c => c.title === 'Ripgrep');
    expect(ripgrep?.url).toBe('https://github.com/BurntSushi/ripgrep');
    const ampersand = (tools!.children ?? []).find(c => c.title === 'Query & Sort');
    expect(ampersand?.url).toBe('https://example.com/?a=1&b=2');
    const anthropic = (work!.children ?? []).find(c => c.title === 'Anthropic');
    expect(anthropic?.url).toBe('https://anthropic.com/');
  });
});

describe('import_html parser robustness (CORR-3)', () => {
  test('parses single-quoted and reordered HREF attributes', async () => {
    const fake = installChromeFake();
    const html = [
      '<DL><p>',
      "    <DT><A ADD_DATE=\"123\" HREF='https://single.example/x'>Single</A>",
      '    <DT><A HREF="https://double.example/y" ICON="data:foo">Double</A>',
      '</DL><p>',
    ].join('\n');

    const res = await handleImportHtml({ html });
    expect(res.status).toBe('success');
    const data = res.data as Record<string, unknown>;
    expect(data.created).toBe(2);

    const snap = fake.snapshot();
    const single = findByTitle(snap, 'Single');
    expect(single?.url).toBe('https://single.example/x');
    const dbl = findByTitle(snap, 'Double');
    expect(dbl?.url).toBe('https://double.example/y');
  });

  test('balances folders when <H3> and <DL> share a line (one-line export)', async () => {
    const fake = installChromeFake();
    // Folder open and its DL open on the same line; close on its own line.
    const html = [
      '<DL><p>',
      '    <DT><H3>Packed</H3><DL><p><DT><A HREF="https://packed.example/a">A</A>',
      '    </DL><p>',
      '    <DT><A HREF="https://top.example/b">B</A>',
      '</DL><p>',
    ].join('\n');

    const res = await handleImportHtml({ html });
    expect(res.status).toBe('success');
    const data = res.data as Record<string, unknown>;
    expect(data.folders).toBe(1);
    expect(data.created).toBe(2);

    // "A" lives inside Packed; "B" lives at the top level (folder popped).
    const snap = fake.snapshot();
    const packed = findByTitle(snap, 'Packed')!;
    expect((packed.children ?? []).some(c => c.title === 'A')).toBe(true);
    const bar = findByTitle(snap, 'Bookmarks Bar')!;
    expect((bar.children ?? []).some(c => c.title === 'B')).toBe(true);
  });

  test('reports unparsed <DT> lines instead of silently succeeding', async () => {
    installChromeFake();
    // A <DT> line whose anchor markup is broken (no closing </A>).
    const html = [
      '<DL><p>',
      '    <DT><A HREF="https://broken.example/x">Broken',
      '</DL><p>',
    ].join('\n');

    const res = await handleImportHtml({ html });
    expect(res.status).toBe('success');
    const data = res.data as Record<string, unknown>;
    expect(data.created).toBe(0);
    expect(data.unparsedDtLines).toBe(1);
  });
});

describe('folder-scoped search (PERF-4 ancestry walk)', () => {
  test('only returns hits whose parentId ancestry includes the scope folder', async () => {
    const seed: SeedNode[] = [
      { title: 'Scope', children: [{ title: 'Inside', url: 'https://hit.example/perf4' }] },
      { title: 'Other', children: [{ title: 'Outside', url: 'https://miss.example/perf4' }] },
    ];
    const fake = installChromeFake(seed);

    const snap = fake.snapshot();
    const scope = findByTitle(snap, 'Scope')!;

    const res = await handleSearch({ query: 'perf4', folder_id: scope.id });
    expect(res.status).toBe('success');
    const items = (res.data as { items: Array<Record<string, unknown>> }).items;
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Inside');
  });
});

describe('check_dead_links SSRF guard (SEC-7)', () => {
  test('blocks loopback / private / link-local / metadata hosts without fetching', async () => {
    const seed: SeedNode[] = [
      { title: 'loopback', url: 'http://127.0.0.1/' },
      { title: 'localhost', url: 'http://localhost:8080/admin' },
      { title: 'private-10', url: 'http://10.0.0.5/' },
      { title: 'private-172', url: 'http://172.16.4.4/' },
      { title: 'private-192', url: 'http://192.168.1.1/' },
      { title: 'metadata', url: 'http://169.254.169.254/latest/meta-data/' },
      { title: 'ipv6-loopback', url: 'http://[::1]/' },
      { title: 'ipv6-ula', url: 'http://[fc00::1]/' },
    ];
    installChromeFake(seed);

    // If any of these slipped past the guard, fetch() would be called (and
    // likely hang/throw in the test runtime). The guard must mark all blocked
    // and never invoke fetch — assert via the returned counts.
    const res = await handleCheckDeadLinks({ timeout_ms: 100 });
    expect(res.status).toBe('success');
    const data = res.data as Record<string, unknown>;
    expect(data.blocked).toBe(seed.length);
    expect(data.checked).toBe(0);
    expect(data.alive).toBe(0);
    expect(data.dead).toBe(0);
  });
});
