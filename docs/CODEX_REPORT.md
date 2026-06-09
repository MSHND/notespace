# Codex report

Status: smallest PE popout target node resolution extraction implemented.

Files changed:

- `js/pocket-node-popout-target.js`
- `js/pocket-node-popout-editor.js`
- `index.html`
- `docs/CODEX_REPORT.md`

What changed:

- Added `PocketNodePopoutTarget.get(input)`.
- Moved target node resolution into `js/pocket-node-popout-target.js`.
- Preserved string input, object input, selected-id fallback, missing-id handling, `nodeMap()` lookup, and `null` return behaviour.
- Updated `pocket-node-popout-editor.js` to keep the public `open/apply` API and delegate only target lookup.
- Added `js/pocket-node-popout-target.js` before `pocket-node-popout-editor.js` in `index.html`.

Behaviour preserved:

- Missing-node status/logging remains in `pocket-node-popout-editor.js`.
- Save/apply comparisons, node writes, persistence calls, status/logging, runtime behaviour, popup styling, template markup, model/window logic, bridge/cutover routing, PE migration/data logic, legacy fields, and outline cap behaviour were not changed.

Checks run:

- `node --check js/pocket-node-popout-target.js` using bundled Node - passed
- `node --check js/pocket-node-popout-editor.js` using bundled Node - passed
- `node tools/pocket-check.js` using bundled Node in scratch harness - passed with expected no-fixture warning
- Target-resolution probe for string input, object input, selected-id fallback, missing-node, missing-id, and missing-`nodeMap()` cases - passed

Result:

- Extraction completed as a behaviour-preserving target/helper split.
- Manual retest recommended: hard refresh, main tree render, popup open, Save, Save & close, Cmd/Ctrl+S, Escape unsaved dialog, text mode, outline mode.
