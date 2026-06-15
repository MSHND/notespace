# Codex report

Status: conservative cleanup pass complete.

Files changed:

- `index.html`
- `tools/pocket-check.js`
- `docs/CODEX_REPORT.md`
- removed `js/pocket-tree-enter-route.js`
- removed `js/pocket-node-editor-route.js`

Removed:

- `js/pocket-tree-enter-route.js`
  - Was a one-comment no-op.
  - Repo search found runtime references only in `index.html`.
  - Removed its script tag.
- `js/pocket-node-editor-route.js`
  - Was a minimal paused stub that only created `PocketPeEditor.version` and logged a warning.
  - Repo search found no runtime reads of `PocketPeEditor.version` or the warning string.
  - `pocket-pe-node-popout-bridge.js` creates the active `PocketPeEditor.open/apply` surface without this stub.
  - Removed its script tag and the stale checker expectation.

Deliberately left alone:

- PE popout stack: template, runtime, model, window, target, editor, bridge, cutover, save-dirty, and human-close.
- Old popout/editor generation scripts, because fallback paths still exist.
- Old inline/details overlay functions and DOM, because fallback/bridge paths still reference them.
- `node.pe` migration/preservation logic and legacy fields.
- `js/pocket-pe-save-dirty.js` old-details injection: appears keyed to `pocketStandalonePe`, while current popout uses `pocketNodePopoutEditor`; left untouched because the file also owns active dirty/save wrapping.

Proof:

- `pocket-tree-enter-route` search: only `index.html` plus previous report references before removal.
- `pocket-node-editor-route` search: `index.html`, `tools/pocket-check.js`, docs/comments before removal; after removal only archival docs/comment references remain.
- `PocketPeEditor.version` and `PE route minimal stub` search: only inside the removed stub.
- Active Enter remains in `js/pocket-tree-actions.js`.
- Active PE route remains `PocketPeEditor.open/apply` from `js/pocket-pe-node-popout-bridge.js`, wrapped by `js/pocket-pe-save-dirty.js`.

Checks run:

- `node --check js/pocket-tree-actions.js` - passed.
- `node --check js/pocket-node-popout-editor.js` - passed.
- `node --check js/pocket-pe-node-popout-bridge.js` - passed.
- `node --check js/pocket-pe-save-dirty.js` - passed.
- `node --check tools/pocket-check.js` - passed.
- `node tools/pocket-check.js` - passed; existing `w4_68` fixture warning remains when `POCKET_CHECK_DATA` is not set.

Manual test checklist:

1. Normal existing node + Enter opens PE, not inline.
2. Copy-context leaf/container/root + Enter copies selected label.
3. Double-click, Edit button, and row menu Edit open PE.
4. Search Enter, move mode Enter, and new/rename inline Enter are unchanged.
5. PE Save and Save & Close still work.
6. Dirty-popup pending-open protection is unchanged.
7. Old details button/path still works if intentionally retained.
8. Main Save/export still works.
