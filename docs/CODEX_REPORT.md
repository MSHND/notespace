# Codex report

Status: Pocket file chooser wording and build marker refreshed.

Files changed:

- `index.html`
- `js/pocket-overlays-init.js`
- `js/pocket-build-label.js`
- `topbar.css`
- `docs/CODEX_REPORT.md`

Result:

- Landing wording remains `Choose Pocket file` and `Create new Pocket file`.
- Top toolbar file control now shows `Choose file` with `Choose Pocket file` title/accessible text.
- Existing chooser controls still call `openPocketFile()`; the toolbar no longer falls back to the hidden file input.
- `openPocketFile()` already calls `showOpenFilePicker()` directly; no recent handle reuse was added.
- Build marker is `a370471+choose-file`, exposed as `window.POCKET_BUILD` and shown quietly in the top bar.

Not changed:

- File-open-only document model remains in place.
- Tree stays hidden until a Pocket file is chosen or created.
- Create new Pocket file flow is unchanged.
- PE Save, main Save after load, dirty recovery, Enter/copy, PE outline copy, tree multi-select, stale guard, and local safety snapshots were left unchanged.
- No auto-sync, background writes, save/export behaviour, PE behaviour, Enter/copy behaviour, or migration logic was changed.

Checks run:

- `node --check js/pocket-overlays-init.js` - passed via bundled Node.
- `node --check js/pocket-build-label.js` - passed via bundled Node.
- `node tools/pocket-check.js` was not run per prompt.

Manual regression checklist:

- Hard refresh.
- Landing should show `Choose Pocket file`.
- Top toolbar `Choose file` should open the file picker every time.
- Permission explanation should still appear before Chrome's save prompt when needed.
- Tree should load only after permission is granted.
- Main Save and PE Save should write to the file chosen in the current session.
- Hard refresh again: no silent handle reuse; picker opens again.
- Create new Pocket file still works.
- `window.POCKET_BUILD` should return `a370471+choose-file`.
