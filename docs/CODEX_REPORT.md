# Codex report

Status: active Pocket file switching fixed for PE saves.

Files changed:

- `js/pocket-state.js`
- `js/pocket-io-browser.js`
- `js/pocket-storage.js`
- `docs/CODEX_REPORT.md`

Root cause:

- The stale export guard compared file B against global last-safety/backup timestamps from file A.
- After choosing B, the first PE Save could return `stale-guard`, flash the main save chip as `check`, and make PE report `save not completed`.
- The export queue also did not have an active-file session token, so an older queued save had no way to know the writable target had changed.

Fix:

- Stale-file risk now only compares safety/backup metadata for the same source file name.
- Active file sessions now have a small session id that changes when the writable target changes.
- `exportTree()` captures the active session when the save is requested.
- Queued saves whose captured session no longer matches do not write or clear current state.
- `writeTruthFile()` writes to the captured active handle and does not let old save completion replace the current file session.

Not changed:

- Explicit file picker per browser session remains in place.
- No recent file handle reuse was added.
- Permission explanation flow, PE apply-before-export semantics, dirty recovery, snapshots, copy/Enter, outline copy, tree multi-select, stale protection for the same file, and save/export model were left intact.
- No auto-sync or file watching was added.

Checks run:

- `node --check js/pocket-state.js` - passed via bundled Node.
- `node --check js/pocket-io-browser.js` - passed via bundled Node.
- `node --check js/pocket-storage.js` - passed via bundled Node.
- `node tools/pocket-check.js` was not run per prompt.

Manual regression checklist:

- Create/open file A.
- Edit in PE and Save; A should change.
- Choose file B from the top bar.
- Confirm B is active and tree loads B.
- Edit in PE and Save; PE should report success and B should change.
- Confirm A is not changed by the B save.
- Main Save should write B.
- Switch back to A and PE Save should write A.
- Hard refresh should ask the user to choose a file again.
- Permission explanation should still appear when needed.
