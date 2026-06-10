# Codex report

Status: rebuilt tree Enter ownership inside `handleTreeKeydown()`.

Files changed:

- `js/pocket-tree-actions.js`
- `js/pocket-tree-enter-route.js`
- `docs/CODEX_REPORT.md`

Enter pipeline before:

- `js/pocket-tree-actions.js`: `handleTreeKeydown()` owned tree keydown and still fell back to `openDetailsEditorForSelectedNode()`.
- `js/pocket-tree-enter-route.js`: late capture listener tried to intercept tree Enter before the old fallback.
- `js/pocket-enter-copy-only.js`: document Enter capture code existed but was not installed; row-menu and PE Esc guards remained.
- `js/pocket-overlays-init.js`: binds `#treeWrap` keydown to `handleTreeKeydown()`; search Enter is separate.
- `js/pocket-editor-cutover-v3.js` and `js/pocket-pe-node-popout-bridge.js`: route Edit/double-click/PE opens through `PocketPeEditor.open` / `openPocketNodeEditor`.
- Local owners kept Enter for search, dialogs/menus, move mode, import, and active inline edit.

What was rebuilt:

- Added tree Enter helpers beside `handleTreeKeydown()`.
- Plain tree Enter now uses copy-context ancestry, not `shouldCopyOnSingleClick(node, hasKids)`.
- Copy-context Enter includes leaves, children, descendants, containers, and the copy root.
- Normal tree Enter opens PE via `window.openPocketPeEditor(id)`, then `window.PocketPeEditor.open(id)`, then `window.openPocketNodeEditor(id)`.
- `handleTreeKeydown()` no longer calls `openDetailsEditorForSelectedNode()` for plain Enter.

Removed/disabled:

- Neutralised the late `js/pocket-tree-enter-route.js` script as a no-op.
- Left `index.html` script order unchanged; the no-op script does not capture Enter.
- No document/window plain Enter capture was added.

Checks run:

- `node --check js/pocket-tree-actions.js` - passed.
- `node --check js/pocket-tree-enter-route.js` - passed.
- `node tools/pocket-check.js` - passed; existing `w4_68` fixture warning remains when `POCKET_CHECK_DATA` is not set.

Manual test checklist:

1. Normal existing tree node + Enter opens PE popup, not inline editor.
2. Copy-context leaf + Enter copies selected label.
3. Copy-context container + Enter copies selected label.
4. Copy-context root + Enter copies selected label.
5. Search field + Enter remains search-specific.
6. PE field + Enter remains PE/local.
7. Move mode + Enter confirms move.
8. Pending import + Enter confirms import.
9. New blank node inline edit + Enter commits new node.
10. Rename inline edit + Enter commits rename.
11. Row-click copy unchanged.
12. Ctrl/Cmd+C copy unchanged.
13. Dirty-popup protection and pending-open unchanged.
