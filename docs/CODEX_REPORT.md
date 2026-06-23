# Codex report

Status: PE outline collapse data-loss-adjacent fix added.

Files changed:

- `js/pocket-node-popout-runtime.js`
- `docs/CODEX_REPORT.md`

Root cause:

- `renderOutline()` cleared and rebuilt the outline pane.
- Collapse and outline key operations could call `renderOutline()` before the active contentEditable row had been reliably copied back into the `outline` array.
- Re-render then restored text from stale model state, so visible unsaved row text could disappear.

Fix implemented:

- Added stable `data-block-id` wiring on each rendered `.outlineText`.
- Added `syncOutlineFromDom()` to copy the focused row and all visible outline rows back into matching outline blocks by ID.
- Called sync before outline re-render, collapse toggle, insert, indent/outdent, row removal, outline-to-text conversion, `currentBody()`, and `buildPayload()`.
- `buildPayload()` now also ensures outline blocks have stable IDs before save/apply.

Safety confirmations:

- Collapsing a branch hides only descendants; the parent/head row remains visible.
- Parent/head text is synced before collapse and should not disappear.
- Visible unsaved outline rows are synced before re-render, save, Save & Close, and text/outline conversion.
- Collapsed descendants remain preserved in the outline array.
- Save, Save & Close, dirty-popup protection, main tree Enter/copy, multi-select, save/export/sync, and PE data-model meaning were not changed.

Checks run:

- Bundled Node `--check js/pocket-node-popout-runtime.js` - passed.
- Bundled Node `--check js/pocket-node-popout-template.js` - passed.
- Generated popup runtime syntax probe - passed.
- Bundled Node `tools/pocket-check.js` - passed; existing `w4_68` fixture warning remains when `POCKET_CHECK_DATA` is not set.

Manual test checklist:

1. Hard refresh Pocket.
2. Open PE on a node.
3. Switch to outline mode.
4. Create a parent/head row with text.
5. Add one or more child rows beneath it.
6. Edit the parent/head row text.
7. Collapse the parent/head row; parent text remains visible and children hide.
8. Expand it; children reappear with text intact.
9. Edit a child row, then collapse parent without saving; child text is preserved after expand.
10. Save PE, close, and reopen; outline text and collapsed state are preserved.
11. Switch outline to text mode; text output includes all outline text.
12. Switch back to outline mode; text is not lost.
13. Save & Close still works.
14. Dirty-popup protection still works.
15. Main Save/export and sync status still work.
16. Main tree Enter/copy/multi-select remain unchanged.
