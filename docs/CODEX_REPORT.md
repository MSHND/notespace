# Codex report

## POCKET TASK P007

Status: PE outline Escape behaviour refined and validated.

Starting `origin/main`:

- `d141262b13241762fc4aea61f07b0f0a3908fb1d`

Files changed:

- `js/pocket-node-popout-runtime.js`
- `docs/CODEX_REPORT.md`

Feature summary:

- Added `exitOutlineRowEditing(target)` as the canonical outline-row editing exit.
- Escape inside `.outlineText` now synchronises that row into the outline model and focuses the same row's selector.
- The row-editing Escape does not close PE, clear selection, delete an empty row, revert text, change dirty state, or open the unsaved dialog.
- The next Escape from the non-editable row selector immediately invokes the existing PE close flow.

Previous Escape behaviour:

1. Close the outline context menu when open.
2. Dismiss the unsaved dialog when open.
3. Clear outline selection when any selection existed.
4. Invoke the normal PE close flow.

New Escape priority:

1. Close the outline context menu and restore focus to its originating row control.
2. Dismiss the unsaved dialog and return to editing.
3. When focus is inside `.outlineText`, synchronise the row and focus its selector.
4. Otherwise invoke `closeSafely()` immediately.

Selection behaviour:

- Outline selection is no longer cleared as an Escape layer.
- Multi-selection remains unchanged when leaving row editing and when dismissing the context menu.
- `clearOutlineSelection()` and the existing selection APIs remain available for their non-Escape owners, including mode changes.
- Cmd/Ctrl-click, Shift-click, Copy, Paste, Duplicate, Delete, and context-menu selection behaviour are unchanged.

Not changed:

- Save, Save & Close, `applyAndSave()`, export, session, and dirty-close plumbing.
- Context-menu actions and clipboard implementation.
- Outline Enter, Tab, Shift+Tab, collapse/expand, Backspace, Delete, or selection semantics.
- Text mode and other editable fields.
- Main-tree routing, copy context, or retired PE implementations.

Checks run:

- `node --check js/pocket-node-popout-runtime.js` - passed.
- `node --check js/pocket-node-popout-template.js` - passed.
- Generated-runtime validation loaded the runtime factory with a minimal `window` shim, called `PocketNodePopoutRuntime.build()` with a valid outline payload, and passed the returned program to `new Function(...)` - passed.
- `git diff --check` - passed.
- `node tools/pocket-check.js` and `npm run check` were not run, as required.

Browser-tested with the active generated template and runtime:

- Context-menu Escape closed only the menu, returned focus to the originating selector, preserved selection, and did not enter the PE close flow.
- Escape from edited outline text synchronised the edited value into the model, focused the same row selector, preserved dirty state, preserved multi-selection, and kept the unsaved dialog closed.
- A second Escape from the selector invoked clean close immediately or opened the existing unsaved dialog when dirty, with no selection-clearing step.
- Escape in the unsaved dialog dismissed it and returned focus to the prior editing control without closing or discarding.
- Text, empty, first, last, nested, expanded, selected, and unselected rows all retained their text and row count after leaving editing.
- An empty row was not deleted and clean row exits did not mark PE dirty.
- Text mode retained its existing direct dirty-close behaviour.
- Cmd/Ctrl-click and Shift-click selection, context-menu selection preservation, Copy, Paste, Duplicate, Delete, Enter, Tab, Shift+Tab, text-field Backspace, and non-editable Delete all remained operational.
- Context Copy wrote the expected parent-and-child text, structured Paste preserved hierarchy, Duplicate created unique IDs, and Delete removed complete branches once.
- No browser console warnings or errors were observed.

Still requiring Murray's browser confirmation:

- The physical two-Escape feel in the real standalone popup window.
- Clean popup closure without the local test harness's close-call marker.
- Save, Save & Close, unsaved-close protection, and truth-file persistence against a real selected Pocket file.
