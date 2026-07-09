# Codex report

Status: Pocket save-permission explanation added before Chrome's prompt.

Files changed:

- `js/pocket-state.js`
- `js/pocket-io-browser.js`
- `js/pocket-render.js`
- `docs/CODEX_REPORT.md`

Behaviour added:

- Loading a Pocket file now checks read/write permission with `queryPermission()` first.
- If permission is already granted, the file loads normally with no extra screen.
- If Chrome is likely to ask, Pocket first shows an in-app explanation screen.
- The Continue button triggers Chrome's real save-permission prompt from the user click.
- Cancel clears the pending file handle and returns to the Load/Create screen.
- Denied/cancelled browser permission keeps the tree hidden and shows a calm message.

User-facing wording:

- Title: `Let Pocket save your changes`
- Body: `Chrome may ask if Pocket can save changes to the file you just chose. Choose "Save changes" so Pocket can save normally.`
- Smaller line: `Pocket only uses the file you select.`
- Buttons: `Continue`, `Cancel`
- Denied message: `Pocket needs permission to save changes to that file.`

Not changed:

- Chrome's browser permission prompt is not bypassed, suppressed, spoofed, or replaced.
- The file-open-only document model remains in place.
- No tree rows or edits are allowed until Pocket has writable access.
- Create new Pocket file, PE Save, main Save, recent file storage, dirty recovery, Enter/copy, outline copy, tree multi-select, stale guard, and safety snapshots were left unchanged.
- `node tools/pocket-check.js` was not run per prompt.

Checks run:

- `node --check js/pocket-state.js` - passed via bundled Node.
- `node --check js/pocket-io-browser.js` - passed via bundled Node.
- `node --check js/pocket-render.js` - passed via bundled Node.

Manual regression checklist:

- Hard refresh: tree hidden and Load/Create screen shown.
- Load Pocket file without granted save permission: Pocket explanation appears before Chrome prompt.
- Continue: Chrome prompt appears; Save changes loads the file and shows the tree.
- Permission already granted: file loads without unnecessary explanation.
- Cancel from Pocket explanation: tree remains hidden and no file session is created.
- Deny/cancel Chrome permission: tree remains hidden and calm message appears.
- Create new Pocket file still works.
- Main Save and PE Save still work after a file is loaded.
- Risky actions without a file still show the Load/Create guard.
