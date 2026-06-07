# Codex report

Status: PE node popout bridge wired into `index.html` with the repo-local mod tool.

Commands run:

- `sed -n '1,260p' AGENTS.md`
  - Result: repo instructions read.
- `sed -n '1,260p' docs/PIPEWORK_RULE.md`
  - Result: pipework rule read.
- `sed -n '1,260p' docs/REFACTOR_PIPELINE.md`
  - Result: refactor pipeline read.
- `sed -n '1,260p' docs/MIGRATION_STATUS.md`
  - Result: migration status read.
- `sed -n '1,320p' docs/CODEX_REPORT.md`
  - Result: previous report read.
- `sed -n '1,260p' tools/pocket-mod-index.js`
  - Result: existing narrow index mod tool read.
- `sed -n '1,260p' js/pocket-pe-node-popout-bridge.js`
  - Result: dormant bridge read.
- `rg -n 'pocket-node-popout-editor|pocket-pe-node-popout-bridge|pocket-editor-cutover-v3|pocket-pe-save-dirty|pocket-node-editor-route|pocket-pe-simple-standalone|pocket-enter-preflight' index.html`
  - Result: confirmed bridge was not loaded and current order was node popout editor, editor cutover, node editor route, PE save dirty.
- `node --check tools/pocket-mod-index.js`
  - Result: passed with no output.
- `npm run check`
  - Result: passed before the insert.
- `node tools/pocket-mod-index.js insert-script-after js/pocket-node-popout-editor.js js/pocket-pe-node-popout-bridge.js --dry-run`
  - Result: reported `dry run: no files changed` and `would insert script: js/pocket-pe-node-popout-bridge.js after js/pocket-node-popout-editor.js`.
- `node tools/pocket-mod-index.js insert-script-after js/pocket-node-popout-editor.js js/pocket-pe-node-popout-bridge.js`
  - Result: inserted the bridge script after `js/pocket-node-popout-editor.js`.
- `sed -n '160,174p' index.html`
  - Result: read-back confirmed the expected script order.
- `tail -n 5 index.html`
  - Result: confirmed `index.html` still ends with `</html>`.
- `test -f js/pocket-pe-node-popout-bridge.js`
  - Result: confirmed the bridge file still exists.
- `git diff --name-status`
  - Result: only `index.html` and `tools/pocket-mod-index.js` were changed before this report update.
- `npm run check`
  - Result: passed after the insert.
- Temporary browser smoke setup: `python3 -m http.server 8765 --bind 127.0.0.1`
  - Result: served Pocket locally for browser testing.

Files changed:

- `tools/pocket-mod-index.js`
- `index.html`
- `docs/CODEX_REPORT.md`

Diff summary:

- Extended `tools/pocket-mod-index.js` with `insert-script-after`.
- The insert command:
  - requires an anchor script and an inserted script;
  - refuses if the inserted script is already present;
  - refuses if the anchor script is not found exactly once;
  - preserves the rest of `index.html`;
  - refuses to write a truncated `index.html`;
  - supports `--dry-run`;
  - reports what it would insert or did insert.
- Used the tool to insert:

```html
<script src="js/pocket-pe-node-popout-bridge.js"></script>
```

after:

```html
<script src="js/pocket-node-popout-editor.js"></script>
```

Check result:

```text
> check
> node tools/pocket-check.js

Pocket check v1
ok   index.html - ends with </html>
ok   script tags - 46
ok   enter handlers - no duplicate known pair detected
ok   js/pocket-node-editor-route.js - ends with })(window);
ok   js/boot/pocket-load-manifest.js - exists
ok   js/boot/pocket-boot.js - exists
ok   js/commands/pocket-command-router.js - exists
ok   docs/PIPEWORK_RULE.md - exists
Pocket check passed
```

Script order confirmation:

```html
<script src="js/pocket-node-popout-editor.js"></script>
<script src="js/pocket-pe-node-popout-bridge.js"></script>
<script src="js/pocket-editor-cutover-v3.js"></script>
```

Safety confirmation:

- `index.html` still ends with `</html>`.
- `js/pocket-pe-node-popout-bridge.js` still exists.
- No files were deleted.
- No existing PE/editor scripts were modified.
- No unrelated files were changed.

Browser smoke-test result:

- Opened Pocket at `http://127.0.0.1:8765/index.html`.
- Hard refreshed by reloading a cache-busting local URL.
- Pocket loaded a 7-node local autosave in the in-app browser.
- A visible tree node was selected.
- Double-clicking the selected node produced this console signal:

```text
[node popout editor] opened Object
```

- No console `error` entries were observed in the captured browser log tail.
- Expected warning observed:

```text
[PE route] minimal stub loaded; rebuild paused
```

- The temporary local server logged 404s for `JSONs/pocket-change-log.ndjson` and `pocket-change-log.ndjson`; the app catches those optional change-log loads and continued with Pocket data loaded.

Browser smoke-test limitation:

- The in-app browser represented the popup as a blank `about:blank` surface, so the popout document could not be inspected there.
- A controlled Playwright fallback could not complete because the bundled Playwright browser executable was missing:

```text
browserType.launch: Executable doesn't exist at /Users/murrayhenderson/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

- A second fallback using installed Google Chrome also failed:

```text
browserType.launch: Target page, context or browser has been closed
```

- Because of those browser automation limits, a harmless body edit/save in the popup was not confirmed by automation in this pass.

Concerns:

- The bridge wiring fixes the missing `PocketPeEditor.open/apply` surface for later scripts, and the open route now reaches `PocketNodePopoutEditor.open`.
- The popup edit/save loop still needs a manual Chrome/Safari check or a working Playwright browser install to confirm end-to-end save behaviour.

Suggested next step:

Run one manual browser smoke in Chrome or Safari: open Pocket, select a normal node, open item details, make a harmless body edit, save, and confirm the tree/details update. After that, proceed to the `node.label` title-source fix as a separate small step.
