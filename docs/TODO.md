# chromium-bookmarks-mcp — TODO

## Completed

### Phase 1-4: Core Implementation
- [x] Three-process architecture (Extension ↔ Native Host ↔ MCP Stdio Proxy)
- [x] 19 MCP tools: ping + 7 read + 6 write + 4 batch + 2 export/import + 1 analysis
- [x] Offscreen keepalive for MV3 service worker
- [x] Popup UI with connection status
- [x] CLI: serve, register, unregister, doctor

### Quality Improvements
- [x] Folder path cache — N+1 `chrome.bookmarks.get()` calls eliminated
- [x] `bookmark_search` add `folder_path` param — agents can search by folder name
- [x] Windows browser detection — `browsers.ts` supports macOS/Linux/Windows
- [x] Version from package.json — dynamic, not hardcoded
- [x] merge_folders dedup bug fix — excludes source subtree from comparison
- [x] Default depth 2 for get_tree — prevents MCP token overflow
- [x] Type field on list/search responses — `type: 'folder' | 'bookmark'`
- [x] Batch partial success — returns `success` if any items succeeded
- [x] HTTP input validation on /call-tool endpoint
- [x] DRY cleanup — shared helpers, constants, no dead code
- [x] Code consistency — naming, comments, log prefixes, shebangs

### Phase 5: Publish Preparation
- [x] README.md — install guide, 19 tools reference, architecture diagram
- [x] Privacy Policy — no data collection, localhost only, dead link disclaimer
- [x] LICENSE — MIT
- [x] NPM package.json — description, keywords, files, postinstall, bin
- [x] Inline shared types for NPM compatibility (no workspace:* dependency)
- [x] Exclude test files from published package
- [x] Windows run_host.cmd wrapper
- [x] Extension icons (16/48/128 PNG)
- [x] Chrome Web Store listing text

## Remaining — Publish Actions (manual)

- [ ] Create GitHub repo: `gh repo create chromium-bookmarks-mcp --public --source=. --push`
- [ ] NPM publish: `cd apps/mcp-server && npm publish`
- [ ] Chrome Web Store: upload `apps/extension/.output/*.zip` to [developer dashboard](https://chrome.google.com/webstore/devconsole) ($5 developer fee)
- [ ] Update README install instructions after NPM/Store URLs are live

## Future (low priority)

- [ ] Handler test coverage — 19 tool handlers have zero unit tests
- [ ] GitHub Actions CI — automated test + publish pipeline
- [ ] Folder path cache invalidation — listen to `chrome.bookmarks.onMoved`/`onChanged` events
- [ ] `bookmark_search` add `folder_path` to other tools (list, count, etc.)
