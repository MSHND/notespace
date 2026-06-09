# Codex report

Status: smallest PE popout window orchestration extraction implemented.

Files changed:

- `js/pocket-node-popout-window.js`
- `js/pocket-node-popout-editor.js`
- `index.html`
- `docs/CODEX_REPORT.md`

What changed:

- Added `PocketNodePopoutWindow.open(payload, helpers)`.
- Moved popup HTML assembly, template/runtime combination, HTML escaping, safe JSON, sizing, positioning, `window.open`, document write/close, focus, and blocked-popup status into `js/pocket-node-popout-window.js`.
- Updated `pocket-node-popout-editor.js` to keep `open/apply`, node resolution, model calls, success logging, and all save/apply side effects while delegating popup opening.
- Added `js/pocket-node-popout-window.js` after model and before editor in `index.html`.

Behaviour preserved:

- Save/apply behaviour, runtime behaviour, popup styling, template markup, model logic, bridge/cutover routing, PE migration/data logic, legacy fields, and outline cap behaviour were not changed.

Checks run:

- `node --check js/pocket-node-popout-window.js` using bundled Node - passed
- `node --check js/pocket-node-popout-editor.js` using bundled Node - passed
- `node tools/pocket-check.js` using bundled Node in scratch harness - passed with expected no-fixture warning
- Popup window orchestration probe using bundled Node - passed

Result:

- Extraction completed as a behaviour-preserving window/helper split.
- Manual retest recommended: hard refresh, main tree render, popup open, Save, Save & close, Cmd/Ctrl+S, Escape unsaved dialog, text mode, outline mode.
