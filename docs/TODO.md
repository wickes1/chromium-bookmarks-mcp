# chromium-bookmarks-mcp — TODO

## Phase 5: Publish (Required for release)

- [ ] README.md — install guide, feature list, architecture diagram, screenshots
- [ ] Privacy Policy — "no data leaves the machine" statement (Chrome Web Store requirement)
- [ ] Chrome Web Store submission — developer account ($5), screenshots, description, review
- [ ] NPM publish — `npm publish` so users can `npm install -g chromium-bookmarks-mcp`
- [ ] postinstall auto-register — npm install automatically runs `register` command

## Quality Improvements

- [ ] Handler test coverage — 15 bookmark tool handlers have zero tests
- [ ] Folder path cache — N+1 `chrome.bookmarks.get()` calls in `enrichNode`/`getFolderPath`
- [ ] `bookmark_search` add `folder_path` param — let agents search by folder name, not just ID
- [ ] Windows browser detection — `browsers.ts` only supports macOS/Linux
- [ ] Version from package.json — `stdio-proxy.ts` hardcodes `'0.1.0'`

## Future Features

- [ ] `bookmark_export_html` / `bookmark_import_html`
- [ ] `bookmark_check_dead_links` — HTTP check for broken bookmarks
- [ ] GitHub Actions CI — automated test + publish pipeline
- [ ] Open source — public GitHub repo
