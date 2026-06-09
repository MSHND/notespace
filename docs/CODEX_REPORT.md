# Codex report

Status: smallest PE pending-open behaviour implemented.

Files changed:

- `js/pocket-node-popout-window.js`
- `js/pocket-node-popout-runtime.js`
- `docs/CODEX_REPORT.md`

What changed:

- Added one private pending-open slot in `PocketNodePopoutWindow`.
- When dirty item A blocks opening item B, the latest blocked payload/helpers are remembered and the existing unsaved dialog is shown.
- Added `resumePendingOpen()` and `cancelPendingOpen()` to the window helper.
- Save & close now resumes the pending open only after save succeeds.
- Exit without saving clears dirty state and resumes the pending open.
- Go back to editing cancels the pending open.
- Save-and-stay cancels any pending open so it cannot surprise-open later.
- No requested-node queue was added; only one pending request exists.

Unchanged:

- Save/apply plumbing, node writes, persistence, popup styling, template markup, unsaved dialog wording, script order, PE migration/data logic, legacy fields, outline cap behaviour, and bridge/cutover routing were not changed.

Checks run:

- `node --check js/pocket-node-popout-runtime.js` using bundled Node in a scratch copy from GitHub `main` - passed.
- `node --check js/pocket-node-popout-window.js` using bundled Node in a scratch copy from GitHub `main` - passed.
- `node tools/pocket-check.js` using bundled Node in a scratch repo harness from GitHub `main` - passed with expected no-fixture warning for `w4_68`.

Manual retest steps for Murray:

- Dirty A -> open B -> Save & close opens B.
- Dirty A -> open B -> Exit without saving opens B.
- Dirty A -> open B -> Go back keeps A and does not later open B.
- Failed save does not open B.
- Normal Save still works.
- Normal Save & close still works.
- Cmd/Ctrl+S still works.
- Escape unsaved dialog still works.
- Text mode still works.
- Outline mode still works.
