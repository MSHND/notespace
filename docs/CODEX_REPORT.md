# Codex report

Status: PE outline selection context menu implemented and validated.

Starting `origin/main`:

- `1168067bc7819a56a6e8ee377f5f500ed72fa7b1`

Files changed:

- `js/pocket-node-popout-runtime.js`
- `js/pocket-node-popout-template.js`
- `docs/CODEX_REPORT.md`

Feature summary:

- Replaced the permanent PE outline Duplicate toolbar button with a compact right-click menu.
- Added accessible `Copy`, `Paste after selection`, `Duplicate`, and `Delete` menu actions.
- Kept Cmd/Ctrl+C and Cmd/Ctrl+D outline shortcuts.
- Added safe Delete and Backspace handling for selected branches when focus is outside editable text fields.
- Added selection-aware structured paste shared by native multiline paste and context-menu paste.

Context-menu behaviour:

- Right-clicking an unselected outline row clears the old selection and selects that row.
- Right-clicking a row already in the selection preserves the complete selection.
- The menu is positioned at the pointer and clamped inside the visible viewport.
- Only outline-row context menus are suppressed; no document-wide context-menu blocker was added.
- Focus moves to the first menu item when the menu opens.
- Escape closes the menu before outline-selection clearing or PE close protection runs.
- Escape and non-rendering actions return focus to the originating row selector.
- Outside click, mode change, scroll, resize, save-and-close, discard, and PE close dismiss the menu.
- Arrow Up, Arrow Down, Home, and End move focus between menu items.

Copy and Duplicate:

- Context-menu Copy reuses `copyOutlineSelection()`.
- Context-menu Duplicate reuses `duplicateOutlineSelection()`.
- Selected parents include their complete subtrees and selected descendants are not processed twice.
- Duplicate still creates fresh IDs, preserves depth and collapsed state, selects duplicated roots, and marks PE dirty without saving.
- The old `duplicateOutlineBtn` markup, lookup, and click listener were removed.

Structured paste:

- `insertStructuredOutlineText()` is now the shared insertion path.
- With an outline selection, paste inserts after the final selected subtree.
- Without a selection, native multiline paste inserts after the active outline row.
- Context-menu paste reads `navigator.clipboard.readText()` inside the menu click action.
- Single-line and multiline non-empty context-menu text are accepted.
- Tabs and spaces continue to infer relative hierarchy and every pasted block receives a fresh ID.
- Pasted root blocks become selected, the first root becomes the anchor, and the first pasted row receives focus.
- Empty, denied, unavailable, or failed clipboard reads do not alter the outline or throw an uncaught error.
- Clipboard failure feedback directs the user to Cmd/Ctrl+V.
- Ordinary single-line paste inside an edited outline row remains native inline text paste.

Multi-select delete:

- Added `deleteOutlineSelection()`.
- It synchronises visible outline text before calculating selected root ranges.
- It removes each selected root and complete subtree exactly once, processing ranges from bottom to top.
- Parent-plus-child selection does not double-delete and disjoint selections are all removed.
- The row now occupying the first deleted position is selected and focused; otherwise the closest previous row is used.
- Deleting every block creates, selects, and focuses one fresh blank depth-0 block.
- Delete and Backspace invoke branch deletion only from non-editable PE surfaces.
- `.outlineText`, title, textarea, input, select, and contenteditable targets keep normal text editing behaviour.

Not changed:

- PE Save and `applyAndSave()` plumbing.
- Truth-file export and active-file session protection.
- Dirty-close protection and save ownership.
- Text-mode editing, Enter row creation, Tab indentation, collapse/expand, and existing selection semantics.
- Main tree Enter routing or copy-context behaviour outside PE.
- No retired PE implementation was restored.

Checks run:

- `node --check js/pocket-node-popout-runtime.js` - passed.
- `node --check js/pocket-node-popout-template.js` - passed.
- Generated-runtime validation loaded the factory with a minimal `window` shim, called `PocketNodePopoutRuntime.build()` with a valid outline payload, and passed the returned program to `new Function(...)` - passed.
- Generated HTML contained the context-menu runtime and no `duplicateOutlineBtn` lookup - passed.
- `git diff --check` - passed.
- `node tools/pocket-check.js` and `npm run check` were not run, as required.

Browser-tested with the active generated template/runtime:

- Menu markup, accessible role/label, four menu items, and removal of the toolbar Duplicate button.
- Right-click selection replacement and preservation of an existing parent-plus-child selection.
- Viewport clamping, first-item focus, Escape priority, and outside-click focus behaviour.
- Context Copy produced existing copied-row feedback and did not mark a clean PE dirty.
- Context Paste inserted a three-row hierarchy after the selected subtree, selected the pasted root, focused it, and marked PE dirty.
- Empty clipboard paste left the outline unchanged and showed feedback.
- Context Duplicate cloned one selected branch with fresh unique IDs.
- Context Delete removed a parent/child selection plus a disjoint branch exactly once.
- Delete and Backspace on row selectors removed selected branches.
- Backspace in `.outlineText` did not delete the selected branch.
- Deleting every row produced one selected, focused blank row with a fresh ID.
- Native single-line paste stayed inline.
- Native multiline paste used structured rows, including insertion after a selected subtree.
- Cmd/Ctrl+D remained active.
- No browser console warnings or errors were observed.

Still requiring Murray's browser confirmation:

- Real OS clipboard contents for Cmd/Ctrl+C; the automation harness confirmed context Copy feedback but could not independently inspect the page clipboard write.
- A deliberately denied clipboard permission prompt and its fallback message.
- Scroll/resize dismissal in the real popup window.
- Normal browser context-menu appearance outside the outline.
- PE Save, Save & Close, unsaved-close protection, and truth-file persistence against a real selected Pocket file.
