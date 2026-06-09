# Codex report

Status: smallest PE popout model extraction implemented.

Files changed:

- `js/pocket-node-popout-model.js`
- `js/pocket-node-popout-editor.js`
- `index.html`
- `docs/CODEX_REPORT.md`

What changed:

- Added `PocketNodePopoutModel.buildPayload(node)` and `PocketNodePopoutModel.normaliseEditorMeta(value)`.
- Moved copied payload/outline model construction into `js/pocket-node-popout-model.js`.
- Updated `pocket-node-popout-editor.js` to call the model for popup payloads and outline metadata normalisation.
- Added `js/pocket-node-popout-model.js` after runtime and before editor in `index.html`.

Behaviour preserved:

- Save/apply side effects stay in `pocket-node-popout-editor.js`.
- Runtime, template markup/CSS, bridge/cutover routing, PE migration logic, legacy fields, and outline cap behaviour were not changed.

Checks run:

- `node --check js/pocket-node-popout-model.js` using bundled Node - passed
- `node --check js/pocket-node-popout-editor.js` using bundled Node - passed
- `node tools/pocket-check.js` using bundled Node in scratch harness - passed with expected no-fixture warning
- Popup model syntax/shape probe using bundled Node - passed

Result:

- Extraction completed as a behaviour-preserving model/helper split.
- Manual retest recommended: popup open, Save, Save & close, Cmd/Ctrl+S, Escape, unsaved dialog, text mode, and outline mode.
