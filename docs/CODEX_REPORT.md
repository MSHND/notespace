# Codex report

Status: report-only plan to replace tree Enter routing with one clear owner.

Files changed:

- `docs/CODEX_REPORT.md`

Current Enter owners:

- `js/pocket-overlays-init.js` binds `el.treeWrap` keydown to `handleTreeKeydown()` and also installs global capture shortcuts for non-Enter shortcuts.
- `js/pocket-tree-actions.js` owns current tree keydown. Its plain Enter branch handles copy leaves, then falls back to `openDetailsEditorForSelectedNode()`.
- `js/pocket-enter-copy-only.js` still contains old Enter helper code, but the document/window Enter capture registrations are disabled. It still installs PE Escape and row-menu guards.
- `js/pocket-overlays-init.js` search-field Enter selects/copies the first filtered item; this is search-specific, not tree routing.
- `js/pocket-editor-cutover-v3.js` routes click, double-click, and Edit controls to PE via `openDirect()`. It does not own Enter.

Current route facts:

- Old inline editor opens from `handleTreeKeydown()` plain Enter fallback through `openDetailsEditorForSelectedNode()`.
- PE opens through `openPocketPeEditor`, `PocketPeEditor.open`, or `openPocketNodeEditor` after the cutover/bridge stack.
- Copy-context Enter currently uses `shouldCopyOnSingleClick(node, hasKids)`, so it copies only copy-ready leaves and excludes containers.
- `pocket-pe-node-popout-bridge.js` exposes `PocketPeEditor.open/apply` by delegating to `PocketNodePopoutEditor`.
- `pocket-pe-save-dirty.js` wraps PE open/apply for dirty cue/save bridge; keep this untouched.
- `pocket-node-popout-window.js` owns dirty-popup replacement and pending-open behaviour; keep this untouched.
- Script order: `pocket-tree-actions.js` loads early, `pocket-overlays-init.js` binds tree keydown, PE bridge/cutover load later, and `pocket-enter-copy-only.js` loads last.

Handlers to remove or keep disabled:

- Permanently avoid broad document/window plain-Enter capture in `pocket-enter-copy-only.js`.
- Do not re-enable a global `handleEnter()` that calls `preventDefault()` before a confirmed copy/open action.
- Leave global capture shortcuts in `pocket-overlays-init.js` alone because they handle Escape/Cmd/Ctrl shortcuts, not plain tree Enter.

Proposed single owner:

- Keep `handleTreeKeydown()` as the only tree Enter owner because it is already bound to `#treeWrap`, not document/window.
- Replace only its plain Enter branch with a small purpose-built router, for example `routeTreeEnterForSelectedNode(ev)`.
- The router should call PE directly through `openPocketPeEditor`, then `PocketPeEditor.open`, then `openPocketNodeEditor` only as fallback.
- The router must never call `openDetailsEditorForSelectedNode()`.

Exact rules:

- Editable fields: ignore input, textarea, select, contenteditable, PE fields, and search field at tree-routing layer.
- Dialogs/menus: ignore command palette, controls overlay, detail overlay, row menu, `[role=dialog]`, and `[role=menu]`.
- Move/import/inline edit: let existing move, pending import, and inline edit branches own Enter before tree Enter routing.
- Selected copy-context node: copy selected label if node is under a recognised copy context; include containers for Enter only.
- Selected normal node: open PE popup, preserving dirty-popup and pending-open protections.
- No selected node: warn/select-first status only; do not open inline editor.

Smallest safe implementation plan:

- Add a tiny tree-only predicate/helper near `handleTreeKeydown()` in `js/pocket-tree-actions.js`.
- In the existing plain Enter branch, replace the copy/inline-editor fallback with copy-or-PE routing.
- Keep row-click copy on `shouldCopyOnSingleClick()` unchanged.
- Keep Ctrl/Cmd+C copy in `pocket-overlays-init.js` unchanged.
- Leave `pocket-enter-copy-only.js` Enter capture disabled; optionally remove unused Enter helper code in a later cleanup after manual retest.
- Do not change script order unless a later check proves a missing PE API at runtime.

Files likely to change next:

- `js/pocket-tree-actions.js`
- `docs/CODEX_REPORT.md`
- `js/pocket-enter-copy-only.js` only if removing dead Enter capture/helper code after the tree route is stable.

Do not touch:

- PE save/apply plumbing, dirty-popup protection, pending-open behaviour, row-click copy, Ctrl/Cmd+C copy, popup styling, migration/data logic, legacy fields, or broad routing.

Risks and checks:

- Risks: PE API unavailable when Enter fires; copy-context predicate too broad; accidentally reopening inline editor; move/import/search/dialog Enter ownership regressing.
- Checks: normal tree node + Enter opens PE; copy child leaf + Enter copies; copy child container + Enter copies; copy root behaviour deliberate; Enter in search/editing/dialog/menu ignored by tree router; row-click copy unchanged; Ctrl/Cmd+C unchanged; dirty-popup and pending-open flows unchanged; Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode unchanged.

Checks run:

- Not run; report-only docs change.
