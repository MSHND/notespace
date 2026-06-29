# Codex report

Status: old PE dirty/close cleanup investigation complete. No code was changed.

Files changed:

- `docs/CODEX_REPORT.md`

Files inspected / traced:

- `index.html`
- `js/pocket-node-popout-window.js`
- `js/pocket-node-popout-runtime.js`
- `js/pocket-pe-node-popout-bridge.js`
- `js/pocket-editor-cutover-v3.js`
- `js/pocket-tree-actions.js`
- `js/pocket-pe-save-dirty.js`
- `js/pocket-editor-human-close.js`
- `js/pocket-pe-import-preserve.js`
- `js/pocket-enter-copy-only.js`
- `js/pocket-pe-esc-close.js`

Findings:

- Current active PE popup name is `pocketNodePopoutEditor` in `js/pocket-node-popout-window.js`.
- Current dirty-popup protection lives in `PocketNodePopoutRuntime` / `PocketNodePopoutSession` plus `PocketNodePopoutWindow` pending-open handling.
- `pocketStandalonePe` references are legacy-only in the loaded path:
  - `js/pocket-editor-human-close.js` wraps `window.open` only for `name === "pocketStandalonePe"`.
  - `js/pocket-pe-save-dirty.js` also captures only `pocketStandalonePe` for old `__pocketPeWindow`, old-details injection, and old dirty guards.
- `pocketSimplePe_` references are also old/simple-popup scoped:
  - `js/pocket-pe-import-preserve.js` still has important import preservation, but its popup-name patch targets `pocketSimplePe_`.
  - `js/pocket-enter-copy-only.js` still includes an old `pocketSimplePe_` Esc guard.
  - `js/pocket-pe-esc-close.js` targets `pocketSimplePe_` and is not loaded in current `index.html`.
- `__pocketPeWindow` / `__pocketPeDirty` are old-window globals; the current node popout stack does not depend on them for unsaved protection.

Answers:

1. No current active PE route found using `pocketStandalonePe`; current route uses `pocketNodePopoutEditor`.
2. Current PE route is `openPocketPeEditor` / `PocketPeEditor.open` -> `PocketNodePopoutEditor.open` -> `PocketNodePopoutWindow.open`.
3. `pocket-editor-human-close.js` is not needed for the current PE popup, but may still affect an old fallback if it opens `pocketStandalonePe`.
4. `pocket-pe-save-dirty.js` is mixed: old standalone popup guards look stale, but its `PocketPeEditor.open/apply` dirty-cue wrapper and `openPocketPeEditor` exposure are still active route plumbing.
5. Old details button injection appears tied to the old standalone popup DOM and old-details recovery bridge, not the current node popout UI.
6. Loaded `window.open` interceptors targeting old popup names are effectively no-op for current PE, but still broad enough that removal needs a dedicated fallback proof pass.
7. Nothing was removed or neutralised because the old fallback stack is intentionally still present.
8. Safest next cleanup: split `pocket-pe-save-dirty.js` in a future pass so active `PocketPeEditor` wrapping stays separate from old `pocketStandalonePe` dirty/old-details injection.

Current behaviour confirmations:

- Active PE route remains unchanged.
- Enter/copy behaviour unchanged.
- PE Save / Save & Close / unsaved guard unchanged.
- Dirty-popup and pending-open protection unchanged.
- Outline, multi-select, sync Health/status, and main Save/export unchanged.
- No auto-sync/write behaviour added.

Cleanup candidates left for later:

- Prove whether any fallback still opens `pocketStandalonePe`; if not, remove `js/pocket-editor-human-close.js` from `index.html` and delete the file.
- Split or neutralise only the old `pocketStandalonePe` sections inside `js/pocket-pe-save-dirty.js`, keeping active `PocketPeEditor` wrapping intact.
- Audit old `pocketSimplePe_` patches in `js/pocket-pe-import-preserve.js` and `js/pocket-enter-copy-only.js` separately; do not touch PE import preservation while doing so.

Checks run:

- No JS changed; no `node --check` target.
- Bundled Node `tools/pocket-check.js` - passed; existing `w4_68` warning remains when `POCKET_CHECK_DATA` is not set.

Manual test checklist:

- Hard refresh Pocket.
- Normal node + Enter opens PE.
- Copy node + Enter copies.
- Row-click copy unchanged.
- Ctrl/Cmd+C copy unchanged.
- PE Save works.
- PE Save & Close works.
- PE unsaved guard appears when expected.
- Dirty-popup pending-open flow still works.
- Outline text and independent collapse still work.
- Multi-select / multi-delete still work.
- Health sync status still works.
- Main Save/export still works.
