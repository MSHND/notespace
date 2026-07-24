# Pocket Architecture Checkpoint

Status: current known-good handover after PE, Enter, outline, sync-status, multi-select, UI polish, and old route cleanup work.

Purpose: keep future passes from reviving old editor routes, bypassing save/recovery plumbing, or touching data-loss-adjacent outline behaviour without a specific test plan.

## 1. Current Known-Good User Behaviours

Expected behaviours:

- Clicking/selecting a normal tree node works as before.
- Enter on a normal tree node opens PE / item details.
- Enter on a copy-context node copies.
- Row-click copy behaviour is unchanged.
- Ctrl/Cmd+C copy behaviour is unchanged.
- PE opens as the standalone item details editor.
- PE Save works.
- PE Save & Close works.
- PE unsaved guard works.
- PE text mode works.
- PE outline mode works.
- PE outline collapse preserves visible text.
- PE outline top-level/head nodes collapse independently.
- Main Save/export works.
- Sync status is visible in Health/status.
- No auto-sync is currently active.
- Multi-select works with Ctrl/Cmd-click, Shift-click, and Escape.
- Multi-delete works with confirmation.
- Multi-move is not implemented yet.

## 2. Active PE / Item Details Route

Active standalone PE stack:

- `js/pocket-node-popout-template.js`
- `js/pocket-node-popout-runtime.js`
- `js/pocket-node-popout-model.js`
- `js/pocket-node-popout-window.js`
- `js/pocket-node-popout-target.js`
- `js/pocket-node-popout-editor.js`
- `js/pocket-pe-node-popout-bridge.js`
- `js/pocket-editor-cutover-v3.js`
- `js/pocket-pe-save-dirty.js`

Ownership:

- `pocket-node-popout-template.js` renders the standalone popup HTML/CSS shell.
- `pocket-node-popout-runtime.js` builds the inline runtime script for the open popup: dirty state, Save, Save & Close, Escape, mode switching, outline editing, unsaved dialog, and pending-open callbacks.
- `pocket-node-popout-model.js` builds the popup payload and normalises legacy editor metadata.
- `pocket-node-popout-window.js` owns popup window creation, document write/focus, dirty-popup replacement guard, and one-slot pending open.
- `pocket-node-popout-target.js` resolves string/object/selected-id targets.
- `pocket-node-popout-editor.js` keeps the public `PocketNodePopoutEditor.open/apply` API and owns main-app apply side effects, node writes, `recordOp()`, persistence calls, and status refresh.
- `pocket-pe-node-popout-bridge.js` exposes `PocketPeEditor.open/apply` by delegating to `PocketNodePopoutEditor`.
- `pocket-editor-cutover-v3.js` routes edit button, command edit, row-menu edit, and double-click into `PocketPeEditor.open`, with old popout as fallback only.
- `pocket-pe-save-dirty.js` still wraps active PE save/apply and old-details dirty cues. Treat it carefully.

## 3. Enter / Copy Route

Expected Enter behaviour:

- Normal selected node + Enter opens PE.
- Copy-context selected node + Enter copies the selected node label.
- Current tree Enter ownership is in `handleTreeKeydown()` and `routeTreeEnterForSelectedNode()` in `js/pocket-tree-actions.js`.
- `shouldCopyOnTreeEnter()` and `copyNodeLabelFromTreeEnter()` handle copy-context Enter.
- `openPeFromTreeEnter()` prefers `openPocketPeEditor`, then `PocketPeEditor.open`, then `openPocketNodeEditor`.
- The old duplicate popout-default Enter route has been removed.

Future rule:

- Do not add another document/window/tree Enter owner.
- Do not route Enter back to the old inline editor.
- Keep row-click copy and Ctrl/Cmd+C copy separate from tree Enter routing.

## 4. Save / Export / Recovery Path

Current design:

- Main Save/export remains the canonical write path to the browser truth file.
- PE Save/apply updates app state; it does not necessarily mean the browser truth file has been exported.
- Local safety/recovery snapshots remain important.
- `recordOp()` and operation tracking should not be bypassed.
- Future features must not silently write files unless an explicit auto-sync design pass is approved and tested.

Relevant files/functions:

- `js/pocket-io-browser.js`: `exportTree()`, `enqueueTreeSave()`, `writeTruthFile()`, `saveCurrentContext()`.
- `js/pocket-storage.js`: `buildPocketPayload()`, `saveLocalSafetySnapshot()`, `readLocalSafetySnapshot()`, conflict guard helpers and restore helpers. It no longer synthesises legacy `node.pe` on load.
- `js/pocket-tree-actions.js`: tree mutation functions call `recordOp()` for delete/move operations.
- `js/pocket-node-popout-editor.js`: PE apply calls `recordOp({ type: "details_edit", ... })` and persists state after applying popup changes.

## 5. Sync-Readiness / Health Status

Current sync status:

- `js/pocket-sync-status.js` provides `getPocketSyncStatus()` and `window.__pocketLiteGetSyncStatus()`.
- `js/pocket-health-sync.js` appends sync status to the existing Health/status output.
- `canAutoWrite` currently remains `false`.
- There is no auto-sync engine yet.
- There are no timers, file watching, background saves, or silent writes.

Status concepts documented by the helper:

- clean
- dirty
- saving
- PE dirty
- old details dirty
- conflict/stale risk
- needs file / no file handle
- blockers
- warnings
- unsaved operation count

Future rule:

- Visibility is allowed.
- Writing is not allowed from health/status.
- Auto-write must remain disabled until a separate explicit auto-sync pass exists.

## 6. Multi-Select / Multi-Delete

Current model:

- `state.selectedId` remains the primary/focused selected node.
- Multi-select is layered separately through `state.multiSelectedIds`.
- Normal click clears multi-selection and selects one node.
- Ctrl/Cmd-click toggles a node in multi-selection.
- Shift-click selects the visible rendered range.
- Escape clears multi-selection and keeps the focused selected node.

Bulk safety:

- `getEffectiveMultiSelectedRootIds()` reduces parent/child overlap before bulk delete.
- If parent and child are both selected, the parent wins and the child is ignored for the bulk operation.
- Multi-delete asks for confirmation before deleting effective roots and their children.
- Multi-delete records `delete_many` through `recordOp()` and preserves the safety/recovery path.
- Multi-move is deliberately not implemented yet.

Relevant file:

- `js/pocket-multi-select.js`

## 7. PE Outline Runtime

Current outline expectations:

- Outline rows carry stable block IDs.
- Visible DOM outline text syncs back into the outline model before re-render, save, Save & Close, mode switch, and outline operations.
- `syncOutlineFromDom()` and `syncOutlineTextElement()` are data-loss-adjacent protection.
- `renderOutline()` may rebuild the outline pane, so sync-before-render must remain.
- `isHidden(index)` checks only the actual ancestor chain.
- `hasChildren(index)` means the next row is deeper than the current row.
- Collapse hides only actual descendants.
- Top-level/head outline rows are independent.
- `outlineToText()` should preserve all rows when switching back to text mode.

Future rule:

- Treat changes to outline render/collapse/save/mode-switching as data-loss-adjacent.
- Do not remove stable block IDs or DOM-to-model sync without replacing their protection.

Relevant file:

- `js/pocket-node-popout-runtime.js`

## 8. UI Polish Layer

Current UI polish structure:

- `pocket-ui-polish.css` is a light, shared visual layer for chip/status/focus/selection surfaces.
- PE popup visual styling remains inside `js/pocket-node-popout-template.js` because the popup writes a standalone document.
- Visual polish should stay separate from behaviour where possible.
- IDs used by JavaScript should not be casually changed.
- PE template IDs must remain stable for runtime hooks.

## 9. Legacy Fallback / Caution Zone

Still present and should not be casually removed:

- `js/pocket-editor-popout.js`
- `js/pocket-editor-popout-v2.js`
- `js/pocket-editor-popout-node-guard.js`
- `js/pocket-editor-popout-fresh.js`
- old details overlay plumbing
- `js/pocket-pe-save-dirty.js`
- current `node.details` Notes and first-class `node.editor` compatibility/preservation code; retired `node.pe` stays reserved and is discarded during normalisation
- old details/dirty/close scripts that may still reference older popup names

Current caution:

- `pocket-editor-cutover-v3.js` still keeps old poput fallback behaviour if standalone PE fails.
- `pocket-pe-save-dirty.js` still wraps `PocketPeEditor.open/apply` and also references old details behaviours.
- `pocket-storage.js` owns current payload and recovery-state adoption and should not be changed casually.

## 10. Removed / Superseded Route

Recent cleanup:

- `js/pocket-editor-popout-default.js` was removed from active loading and deleted.
- It overlapped with newer PE cutover and tree Enter routing.
- It installed duplicate capture interceptors for edit button, command edit, row-menu edit, tree double-click, and tree Enter.

Future rule:

- Do not reintroduce `pocket-editor-popout-default.js`.
- Do not add another duplicate route that competes with `pocket-editor-cutover-v3.js` or `handleTreeKeydown()`.

## 11. Do Not Touch Without Specific Tests

Use a focused test plan before changing:

- tree Enter routing
- copy-context routing
- PE save/apply/save-close
- PE unsaved guard
- dirty-popup replacement and pending-open behaviour
- PE outline render/collapse/sync
- main Save/export/write path
- operation tracking and recovery snapshots
- sync-status `canAutoWrite`
- multi-select delete root reduction
- data model fields including current `node.details` and `node.editor`, plus the reserved/discarded `node.pe` key

## 12. Suggested Next Work

Future work candidates:

- Small cleanup investigation of old `pocketStandalonePe` / old-details dirty/close scripts.
- Direct rewire of any remaining old details entry points, if safe.
- Multi-move as a separate careful feature pass.
- Auto-save/auto-sync design only after another explicit design pass.
- Fuller automated/manual regression checklist around PE, Enter, copy, multi-select, and save/export.

## 13. Manual Regression Checklist

Before and after risky changes:

1. Hard refresh.
2. Normal node Enter opens PE.
3. Copy node Enter copies.
4. Double-click/edit path opens PE.
5. PE Save works.
6. PE Save & Close works.
7. PE unsaved guard appears when expected.
8. Outline mode preserves visible text.
9. Outline top-level/head collapse is independent.
10. Text/outline switch preserves content.
11. Multi-select works.
12. Multi-delete with parent/child overlap confirms and deletes only effective roots.
13. Health/sync status displays.
14. Main Save/export works.
15. No new console errors.
