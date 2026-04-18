# chromium-bookmarks-mcp — TODO

## Phase 5: Publish (Required for release)

- [ ] README.md — install guide, feature list, architecture diagram, screenshots
- [ ] Privacy Policy — "no data leaves the machine" statement (Chrome Web Store requirement)
- [ ] Chrome Web Store submission — developer account ($5), screenshots, description, review
- [ ] NPM publish — `npm publish` so users can `npm install -g chromium-bookmarks-mcp`
- [ ] postinstall auto-register — npm install automatically runs `register` command

## Quality Improvements — DONE

- [x] Folder path cache — N+1 `chrome.bookmarks.get()` calls eliminated
- [x] `bookmark_search` add `folder_path` param — agents can search by folder name
- [x] Windows browser detection — `browsers.ts` supports macOS/Linux/Windows
- [x] Version from package.json — `stdio-proxy.ts` reads from package.json

## Future Features — DONE

- [x] `bookmark_export_html` — export as Netscape HTML format
- [x] `bookmark_import_html` — import from Netscape HTML format
- [x] `bookmark_check_dead_links` — HTTP HEAD/GET check for broken URLs
- [ ] GitHub Actions CI — automated test + publish pipeline (not needed yet)
