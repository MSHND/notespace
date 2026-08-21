# P072 — Audit local phone everyday-use readiness

## Scope and baseline

This is a static code and contract audit of the P071 client at `447d015c9898453b92e7169fddc3838853318d26` (the current `origin/main`). It covers the six local-phone capabilities named in P072. It does not change runtime behaviour, inspect Sync/server/deployment code, or claim physical-device acceptance.

Phone mode is presentation and interaction state. `js/pocket-phone-mode.js:90-116` enters it from `(max-width: 700px) and (pointer: coarse)` and listens for later matches; `setPhoneMode(..., { persist: false })` applies the automatic state at `js/pocket-phone-mode.js:76-84`. The legacy `#btnPhoneMode` is hidden in `index.html:32`, so a visible manual switch is not required. Before a Pocket is open, `js/pocket-render.js:305-313` renders the Open/New file gate (`js/pocket-render.js:75-125`). After a local file is open, the shell exposes the tree and phone surfaces. Add, move, and editor owners still gate mutations through `requirePocketFileForChanges`.

## Capability audit

| Capability | Current user path on Phone | Owning functions, elements, selectors, and files | Status | Reason / smallest boundary |
|---|---|---|---|---|
| Browse and navigate the tree | Open a local Pocket; tap a parent row to fold/unfold, or tap a leaf/row to select it and keep it visible. The existing twisty remains available. | `#treeWrap` in `index.html:53-55`; `PocketPhoneTap` parent handling in `js/pocket-phone-tap.js:21-53`; row selection and focus in `js/pocket-render.js:483-492`; twisty in `js/pocket-render.js:385-404`; thumb-sized rows in `phone.css:3-22`. | `READY IN CLIENT` | The tap path reaches the same selection, collapse, render, and focus owners without hover, right-click, double-click, or keyboard input. Physical scroll and tap comfort still need the checklist below. |
| Fast capture / add a thought | Tap the visible `+` FAB; Pocket adds below the selected item, under the focused branch, or at the root, then starts inline label capture. The selected-row menu also offers Add below. | `#btnAddMobile` in `index.html:60`; coarse-pointer visibility and safe-area placement in `styles.css:1065-1083,1391-1397`; binding in `js/pocket-overlays-init.js:568-570`; `addItemsFromPrimaryAction` in `js/pocket-tree-actions.js:584-618`; menu action in `js/pocket-overlays-init.js:199-201`. | `READY IN CLIENT` | The action is locally owned and file-gated. It is unavailable before a Pocket owner exists by design, rather than being a Synced-Pocket feature. Test the thumb reach, keyboard, and save feel on a real phone. |
| Find / search | Tap the top-bar `find` field, type a term, and use the filtered tree; clear the field to return home. | `#search` in `index.html:20`; Phone-visible shell placement in `topbar.css:166-220`; input/filter owner in `js/pocket-overlays-init.js:616-623`; matching label, path, details, and outline text in `js/pocket-render.js:314-347`. | `READY IN CLIENT` | A tap-first path exists. Ctrl/Cmd+F is an optional desktop convenience, not a Phone prerequisite. Narrow-width layout, on-screen keyboard, and filter readability require physical testing. |
| Read note content | Select a row, tap its `⋯` Actions button, then tap Edit. | Selected-row `⋯` injection in `js/pocket-phone-menu.js:10-30`; Phone bottom sheet in `phone.css:63-94`; Edit action in `js/pocket-overlays-init.js:104-216,199-201`; routing in `js/pocket-overlays-init.js:464-477` and `js/pocket-editor-cutover-v3.js:123-165`; active editor opens `PocketNodePopoutWindow.open` via `js/pocket-node-popout-editor.js:34-47` and `js/pocket-node-popout-window.js:227-257`. | `LOCAL CLIENT GAP` | The actual Phone route opens a new popup (`window.open`) with minimum 600×600 desktop geometry (`js/pocket-node-popout-window.js:79-87,227-250`). The phone-sized `#detailOverlay` exists (`index.html:301-325`, `phone.css:96-116`) but the cutover hides it and routes Edit to the standalone popup (`js/pocket-editor-cutover-v3.js:42-45,76-81`). Smallest follow-up boundary: add a Phone-only read route to the existing in-page detail editor, leaving the desktop/PE popup route unchanged. |
| Edit note content | Same selected-row Actions → Edit path, then change label/Notes and save. | The same menu/routing owners above; the dormant in-page editor’s read/write owners are `openDetailsEditorForSelectedNode` in `js/pocket-editor-copy.js:409-462`, `#detailEditorLabel`/`#detailEditorBody`/`#btnDetailSave` in `index.html:301-324`, and Save binding in `js/pocket-overlays-init.js:597-598`. | `LOCAL CLIENT GAP` | The reachable editor is the popup path, not the Phone-safe overlay. Smallest follow-up boundary: use the existing in-page detail editor and `saveDetailsEditor` for Phone, preserving current Save/close/persistence ownership; no PE parity work is needed. Physical typing, keyboard resize, and save confirmation remain to be tested after that route exists. |
| Ordinary structural movement, nesting, and reorganisation | Select a row, open Actions, tap Move, then use the four on-screen move-pad buttons for up/down/reorder and left/right/outdent/indent. | Menu Move action in `js/pocket-overlays-init.js:199-202`; `#mobileMovePad` and four buttons in `index.html:61-66`; coarse-pointer display in `styles.css:1096-1123,1391-1397`; pointer binding in `js/pocket-overlays-init.js:570-593`; `toggleMoveMode` and shared pad router in `js/pocket-tree-actions.js:853-893`; structural owners `indentNodeById`, `outdentNodeById`, and `moveNodeWithinSiblings` in `js/pocket-tree-actions.js:175-270`. | `READY IN CLIENT` | The Phone controls reach the existing structural owners, including repeated press handling, rather than adding a parallel movement model. Verify accidental movement, nesting clarity, idle timeout, and Save on a real phone. |

## Physical test checklist

Static evidence cannot prove thumb comfort, iOS/Safari rendering, viewport and keyboard resize, safe-area behaviour, popup policy, or exact tap feel. Murray should run these minimum checks on a real phone with a local Pocket:

1. Open the local Pocket and confirm Phone mode appears automatically; no hidden phone switch is needed.
2. Tap a parent to expand/collapse, then tap a leaf and confirm selection stays visible.
3. Tap selected-row `⋯`; confirm the bottom sheet fits, is dismissible, and exposes Edit, Add below, and Move.
4. Tap `+`, type a short thought with the on-screen keyboard, finish capture, and Save.
5. Tap Find, filter by a label and by Notes content, then clear the filter.
6. Try Edit and record whether the current popup opens, is usable, and returns to Pocket. This is the known local gap, not a pass claim.
7. Enter Move, use all four pad directions, confirm order/nesting, and Save.
8. Repeat at the narrowest viewport and after rotation; check safe-area spacing, keyboard resize, accidental taps, and visible Save/status feedback.

## Hosting / Sync boundary

This audit is for a local file opened on the phone. The current shell keeps `#btnOpenSynced` hidden and disabled (`index.html:23`), and this task does not inspect or resume hosting. A phone cannot become genuinely useful same-Pocket access to a Pocket held on another device until the hosted Sync path and its authenticated transport are resumed. That is a hosting boundary, not a reason to add local phone behaviour here.

## READY NOW

- Browse and navigate the local tree.
- Capture/add a thought.
- Find/search the local Pocket.
- Move, indent, outdent, and reorder locally.

## NEXT LOCAL FIXES

- Route Phone Edit/read through the existing in-page detail editor, keeping the desktop/PE popup route intact.

## BLOCKED UNTIL HOSTING RESUMES

- Same-Pocket access from a different device through hosted Sync.
