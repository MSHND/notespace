# Codex report

Status: report-only investigation of copy subnode still not copying on Enter.

Files changed:

- `docs/CODEX_REPORT.md`

Findings:

- Enter handling still reaches copy through two paths:
  - `js/pocket-enter-copy-only.js` capture guard calls `copySelectedNodeIfAppropriate()` before PE open.
  - `js/pocket-tree-actions.js` older `handleTreeKeydown()` has the same copy-before-details branch when focus is in `#treeWrap`.
- Both paths depend on `shouldCopyOnSingleClick(node, hasKids)` from `js/pocket-editor-copy.js`.
- A node under a parent/root labelled exactly `copy` should be recognised as inside copy context, because `findCopyContextRootId()` walks ancestors and `isCopyContextLabelFallbackNode()` accepts `copy` and `copy templates`.
- Copy context can also be marked by `copyContext`, role/copyRole, profile role/copyRole, or id `m1`.
- The strict gate is `hasKids`: `shouldCopyOnSingleClick()` immediately returns `false` for any node with children.
- Therefore a selected subnode under `copy` copies only if it is a leaf. If the selected “copy” subnode has children, it is not copy-ready by current rules.
- `.copyReady` is applied in `js/pocket-render.js` from the same predicate. A copy-context subnode with children will not receive `.copyReady`.
- `copyText()` in `js/pocket-import.js` is still available and unchanged; the clipboard path is not the likely failure point.
- No PE bridge/cutover code is needed for this specific failure unless the row is incorrectly changing `state.selectedId`.

Likely reason Enter still does not copy:

- The selected copy subnode is probably being treated as a container because it has children.
- Current code defines “copy-ready” as a leaf under copy context, not any descendant under copy context.
- If the row is visually a parent/folder row, Enter will skip copy and either fall through to PE/details from tree context or do nothing from safe non-tree focus.

Smallest safe fix:

- Add a dedicated Enter-copy predicate in `js/pocket-enter-copy-only.js`, for example `shouldCopyOnEnter(node, hasKids)`.
- Preserve existing click-copy behaviour by leaving `shouldCopyOnSingleClick()` unchanged.
- For Enter only, allow descendants under a recognised copy context to copy even when they have children, while excluding the copy root itself if needed.
- Keep PE open tree-only and keep all editable/modal/menu/move/import guards.
- Add a tiny diagnostic log or temporary console check only if Murray needs to confirm `node.id`, `label`, `hasKids`, `copyRootId`, and `.copyReady`; do not print private body/details text.

What should remain untouched:

- `copyText()`, PE save/apply, dirty-popup protection, pending-open behaviour, PE routing, popup styling, migration/data logic, and legacy fields.

Risks and checks:

- Risks: copying a copy-branch container when the user expected Enter to open/edit it; copying the `copy` root itself; changing row-click behaviour accidentally.
- Checks: selected leaf under `copy` + Enter copies; selected container under `copy` + Enter copies if that is the intended Murray case; selected `copy` root behaviour is deliberate; non-copy node + Enter opens PE only from tree context; Enter in search/details/PE fields is ignored; row-click copy, Ctrl/Cmd+C, dirty-popup protection, pending-open flow, Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still work.
