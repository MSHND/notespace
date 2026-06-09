# Codex report

Status: smallest PE dirty-popup replacement guard implemented.

Files changed:

- `js/pocket-node-popout-runtime.js`
- `js/pocket-node-popout-window.js`
- `docs/CODEX_REPORT.md`

What changed:

- Added a tiny popup session API inside the runtime: `hasUnsavedChanges()` and `requestUnsavedProtection()`.
- `requestUnsavedProtection()` reuses the existing unsaved-changes dialog path; it does not change Save, Save & close, Cmd/Ctrl+S, Escape, or close-button behaviour.
- Added a pre-write guard in `PocketNodePopoutWindow.open`.
- If the current popup is open and dirty, the helper focuses it, asks it to show the existing unsaved dialog, returns `false`, and does not write/open the new node.
- Added a second guard after `window.open` returns, before `document.open/write/close`, so a same-named existing popup is still protected before replacement.

Unchanged:

- Save/apply plumbing, node writes, persistence, popup styling, template markup, script order, PE migration/data logic, legacy fields, outline cap behaviour, and bridge/cutover routing were not changed.
- No requested-new-node queue was added.

Checks run:

- `node --check js/pocket-node-popout-runtime.js` using bundled Node in a scratch copy from GitHub `main` - passed.
- `node --check js/pocket-node-popout-window.js` using bundled Node in a scratch copy from GitHub `main` - passed.
- `node tools/pocket-check.js` using bundled Node in a scratch repo harness from GitHub `main` - passed with expected no-fixture warning for `w4_68`.

Manual retest steps for Murray:

- Open node A, edit without saving, then try to open node B.
- Confirm node A stays open, receives focus, and shows the existing unsaved-changes dialog.
- Confirm node B does not open yet.
- Confirm clean popup replacement still works.
- Confirm Save, Save & close, Cmd/Ctrl+S, Escape unsaved dialog, text mode, and outline mode still work.
