# Codex report

Status: recent Pocket file handle reuse removed.

Files changed:

- `js/pocket-io-browser.js`
- `js/pocket-render.js`
- `docs/CODEX_REPORT.md`

Behaviour changed:

- `openPocketFile()` now always opens the file picker.
- Stored recent `FileSystemFileHandle` values are ignored.
- Recent storage now writes only display metadata: file name and timestamp.
- Existing old IndexedDB records may still contain a handle, but Pocket reads only the display name.
- After the user chooses a file in the current session, the live in-memory handle is still used for main Save and PE Save.
- The permission explanation screen still appears before Chrome's save-permission prompt when needed.

User-facing wording:

- Landing title: `Load your Pocket file`
- Landing body: `Choose a Pocket file to continue, or create a new one.`
- Recent hint: `Last used: <file name>`
- Buttons: `Choose Pocket file`, `Create new Pocket file`

Not changed:

- File-open-only document model remains in place.
- Tree stays hidden until a Pocket file is chosen or created.
- Create new Pocket file flow is unchanged.
- PE Save, main Save after load, dirty recovery, Enter/copy, PE outline copy, tree multi-select, stale guard, and local safety snapshots were left unchanged.
- `node tools/pocket-check.js` was not run per prompt.

Checks run:

- `node --check js/pocket-io-browser.js` - passed via bundled Node.
- `node --check js/pocket-render.js` - passed via bundled Node.

Manual regression checklist:

- Hard refresh with an old recent handle stored: tree should stay hidden.
- Landing should show `Last used: <file name>` if known.
- No Open/Load last used button should appear.
- `Choose Pocket file` should open the file picker every time.
- Permission explanation should still appear before Chrome's save prompt when needed.
- Tree should load only after permission is granted.
- Main Save and PE Save should write to the file chosen in the current session.
- Hard refresh again: no silent handle reuse; picker opens again.
- Create new Pocket file still works.
- Risky actions before loading a file still show the Load/Create guard.
