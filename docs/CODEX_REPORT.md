# Codex report

Status: implemented a contained tree-only Enter route override because Codex tokens were exhausted before the planned direct handler edit.

Files changed:

- `js/pocket-tree-enter-route.js`
- `index.html`
- `docs/CODEX_REPORT.md`

What changed:

- Added `js/pocket-tree-enter-route.js` as a small purpose-built tree Enter router.
- Loaded it last in `index.html`, after `pocket-enter-copy-only.js`.
- The new route listens only on `#treeWrap` keydown, using capture on that element so it can stop the old tree Enter fallback before it opens the inline editor.
- It does not add document/window Enter capture.
- It does not change PE save/apply plumbing, dirty-popup protection, pending-open behaviour, row-click copy, Ctrl/Cmd+C copy, search-field Enter, migration/data logic, legacy fields, popup styling, or script order of existing scripts.

New Enter route behaviour:

- Plain Enter only.
- Ignores editable targets: input, textarea, select, button, contenteditable.
- Ignores visible dialogs/menus/overlays.
- Ignores inline edit, move mode, and pending import so existing local flows keep ownership.
- If no node is selected, shows `Select an item first.` and does not open inline edit.
- If the selected node is inside a recognised copy context, copies the selected node label.
- Copy-context containers are included because the route uses copy-context ancestry, not `shouldCopyOnSingleClick(node, hasKids)`.
- Otherwise opens the PE/item details popup via:
  1. `window.openPocketPeEditor(id)`
  2. `window.PocketPeEditor.open(id)`
  3. `window.openPocketNodeEditor(id)`

Important note:

- `js/pocket-tree-actions.js` still contains the old plain Enter fallback to `openDetailsEditorForSelectedNode()`.
- The new route is loaded last and intercepts plain Enter on `#treeWrap` before that fallback can run.
- This is intentionally contained as an emergency route, not the final cleanest refactor.
- After manual testing passes, the cleaner follow-up would be to move this logic directly into `handleTreeKeydown()` and remove the old fallback.

Checks run:

- No automated browser checks run.
- Static check only: confirmed original handler had the inline fallback and new route avoids document/window capture.

Manual test checklist:

1. Hard refresh the app.
2. Select a normal tree node and press Enter.
   - Expected: PE/item details popup opens.
   - Expected: old inline editor does not open.
3. Select a copy-context leaf and press Enter.
   - Expected: selected label copies.
4. Select a copy-context container and press Enter.
   - Expected: selected label copies.
5. Select the copy root and press Enter.
   - Expected: deliberate copy behaviour; report if this feels wrong.
6. Press Enter in the search field.
   - Expected: search-specific behaviour still works.
7. Press Enter inside PE fields.
   - Expected: tree route does not fire.
8. Test move mode Enter.
   - Expected: move confirm still works.
9. Test pending import Enter if available.
   - Expected: import confirm still works.
10. Test row-click copy.
    - Expected: unchanged.
11. Test Ctrl/Cmd+C copy.
    - Expected: unchanged.
12. Test dirty-popup replacement and pending-open flow.
    - Expected: unchanged.
13. Test Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode.
    - Expected: unchanged.
