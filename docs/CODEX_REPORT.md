# Codex report

Status: old popout-default route removed from active loading.

Files changed:

- `index.html`
- `js/pocket-editor-popout-default.js`
- `docs/CODEX_REPORT.md`

Change:

- Removed the `js/pocket-editor-popout-default.js` script tag.
- Deleted `js/pocket-editor-popout-default.js` from the repo.

Reasoning:

- Repo reference scan found `PocketEditorPopoutDefault` only in its own file and the script tag.
- The file installed older capture interceptors for edit button, command edit, row-menu edit, tree double-click, and tree Enter.
- Current PE routing is owned by `PocketPeEditor.open` via `pocket-pe-node-popout-bridge.js` and `pocket-editor-cutover-v3.js`.
- Current tree Enter routing is owned by `handleTreeKeydown()` / `routeTreeEnterForSelectedNode()` in `pocket-tree-actions.js`.
- Old popout fallback engine files remain loaded for cutover fallback; only the default interceptor layer was removed.

Confirmations:

- Active PE route still resolves through `PocketPeEditor.open` to `PocketNodePopoutEditor.open`.
- No Enter/copy/tree routing changes.
- No PE save/apply/save-close/runtime behaviour changes.
- No outline runtime/data-handling changes.
- No multi-select or multi-delete behaviour changes.
- No sync/save/export/write behaviour changes.
- No data-model or migration changes.

Remaining legacy cleanup candidates:

- Old popout fallback engine files remain intentionally loaded and should only be reviewed after another focused fallback-dependency pass.

Checks run:

- No changed JS remained for `node --check` after deleting the old route file.
- Bundled Node `tools/pocket-check.js` - passed; script count is now 52 and the existing `w4_68` fixture warning remains when `POCKET_CHECK_DATA` is not set.
- Local script-order check confirms `pocket-editor-popout-default.js` is no longer loaded and the standalone PE stack remains loaded.

Manual test checklist:

1. Hard refresh Pocket.
2. Click normal node, press Enter; PE opens.
3. Click copy node, press Enter; copy still happens.
4. Double-click normal node; PE opens.
5. Use Edit button/menu/command palette path; PE opens.
6. PE Save works.
7. PE Save & Close works.
8. PE unsaved guard still appears when expected.
9. Outline mode still preserves text.
10. Outline collapse heads remain independent.
11. Multi-select and multi-delete still work.
12. Health/sync status still works.
13. Main Save/export still works.
14. No new console errors.
