# Codex report

Status: report-only investigation of Enter no longer copying copy nodes.

Files changed:

- `docs/CODEX_REPORT.md`

Findings:

- Current Enter handling lives in two places:
  - `js/pocket-tree-actions.js` has the older `handleTreeKeydown(ev)` bound to `#treeWrap`.
  - `js/pocket-enter-copy-only.js` is loaded last and installs capture-phase Enter guards on `document` and `window`.
- Current intended order: `pocket-enter-copy-only.js` should intercept plain Enter, copy if the selected node is copy-ready, otherwise open PE.
- Copy nodes are identified by `shouldCopyOnSingleClick(node, hasKids)` in `js/pocket-editor-copy.js`.
- Copy-ready means a leaf node under a copy context/root, PiP copy mode, or copy-focused branch. Roots can be marker nodes via `copyContext`, role/copyRole, id `m1`, or label fallback `copy templates` / `copy`.
- The copy action itself uses `copyText()` from `js/pocket-import.js`; Enter callers copy the selected node label and then call `showCopiedFeedback()`.
- Rows still render `.copyReady` when `shouldCopyOnSingleClick()` is true, so copy identification appears intact.
- Likely break: the final Enter guard in `pocket-enter-copy-only.js` only runs when the key event target is `#treeWrap` or inside it. Recent PE/popup focus work can leave focus on `body`, a toolbar area, or another non-tree element while `state.selectedId` still points at a copy node. In that case the copy guard returns early and the selected copy node is not copied.
- `pocket-editor-cutover-v3.js` intentionally leaves Enter available for copy/row behaviour; bridge/cutover does not need to own this fix.
- `js/pocket-node-editor-route.js` is only a minimal PE route stub and is not part of the Enter copy decision.

Smallest safe fix:

- Keep the fix in `js/pocket-enter-copy-only.js`.
- Broaden `handleEnter(ev)` so plain Enter can copy the selected copy-ready node when focus is not editable and no modal/menu/import/move state should own Enter.
- Preserve the existing tree-target check for opening PE, so Enter outside the tree does not unexpectedly open item details.
- Prefer factoring a small guard such as `shouldIgnoreEnterTarget(target)` rather than changing PE routing.
- Do not change `shouldCopyOnSingleClick()`, `copyText()`, PE save/apply, dirty-popup protection, pending-open behaviour, or bridge/cutover routing.

Risks and checks:

- Risks: Enter triggering copy while typing in inputs/textareas/contenteditable, while a dialog/menu is active, or while move/import/inline-edit flows own Enter.
- Checks: selected copy leaf + Enter copies; selected non-copy node + Enter still opens PE only from tree context; Enter in search/details/PE fields is ignored by this guard; row click copy still works; Ctrl/Cmd+C still works; dirty popup protection and pending-open flows still pass.
- Syntax/checks for future implementation: `node --check js/pocket-enter-copy-only.js`, `node tools/pocket-check.js`, plus manual PE regression pass for Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode.
