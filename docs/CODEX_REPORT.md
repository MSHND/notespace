# Codex report

Status: file-open-only Pocket document model implemented.

Files changed:

- `js/pocket-state.js`
- `js/pocket-io-browser.js`
- `js/pocket-storage.js`
- `js/pocket-render.js`
- `js/pocket-overlays-init.js`
- `js/pocket-tree-actions.js`
- `js/pocket-node-popout-editor.js`
- `js/pocket-import.js`
- `docs/CODEX_REPORT.md`

Behaviour added:

- Tree rows are hidden until a writable Pocket file is loaded or a new Pocket file is created.
- Clean browser-only cached data is no longer loaded as the working document on startup.
- Dirty recovery data shows a recovery screen, not the normal tree.
- Create new Pocket file opens Save As first, writes an initial or recovered payload, stores the handle/name, then shows the tree.
- Load Pocket file uses the stored recent file handle after a user click when available; otherwise it opens the file picker.
- Recent file handle/name storage was added with a small IndexedDB store; only the display name is shown.
- Central helpers added: `hasWritablePocketFile()`, `canShowPocketTree()`, `canModifyPocket()`, `requirePocketFileForChanges()`.
- Risky add/edit/PE/save/delete/move/import routes now block without an active Pocket file.

User-facing wording:

- Landing title: `Load your Pocket file`
- Landing body: `Choose a Pocket file to continue, or create a new one.`
- Recovery title: `Finish saving your Pocket changes`
- Recovery body: `Pocket found changes that may not have been saved.`
- Guard title: `Load your Pocket file to make changes`
- Guard body: `Choose a Pocket file, or create a new one.`
- Buttons: `Load Pocket file`, `Create new Pocket file`
- Recent hint: `Last used: <file name>`

Not changed:

- No auto-sync, timers, file watching, or background writes were added.
- PE save/apply plumbing, Enter/copy/tree routing, outline runtime, multi-select, sync status, main export shape, and migration/data model were left alone.
- `node tools/pocket-check.js` was not run per prompt.

Checks run:

- `node --check js/pocket-state.js` - passed via bundled Node.
- `node --check js/pocket-io-browser.js` - passed via bundled Node.
- `node --check js/pocket-storage.js` - passed via bundled Node.
- `node --check js/pocket-render.js` - passed via bundled Node.
- `node --check js/pocket-overlays-init.js` - passed via bundled Node.
- `node --check js/pocket-tree-actions.js` - passed via bundled Node.
- `node --check js/pocket-node-popout-editor.js` - passed via bundled Node.
- `node --check js/pocket-import.js` - passed via bundled Node.

Manual regression checklist:

- Hard refresh with no file loaded: tree should be hidden and landing shown.
- Load Pocket file: existing file should open, tree should appear, edits should work.
- Main Save and PE Save should save to the opened Pocket file.
- Hard refresh after clean save: landing should appear, not a stale browser tree.
- Create new Pocket file: Save As should appear before editing, then empty tree should appear.
- Dirty recovery: recovery screen should appear; Create new Pocket file should save recovered data into the chosen file.
- Risky actions without a file should show the Load/Create prompt and not run automatically later.
- Enter/copy, row-click copy, PE dirty/pending-open, outline copy/collapse, multi-select/delete, sync Health, and main Save/export should remain unchanged after a file is loaded.
