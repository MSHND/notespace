# Codex report

Status: Rolled back the PE popup toolbar chip visual pass.

Rollback performed:

- Restored `js/pocket-node-popout-template.js` to the last known working toolbar layout/style from before the chip alignment change.
- Preserved existing Save, Save & close, Cmd/Ctrl+S, Escape, and unsaved dialog behaviour.

Files changed:

- `js/pocket-node-popout-template.js`
- `docs/CODEX_REPORT.md`

Checks run:

- `node --check js/pocket-node-popout-template.js` - passed
- generated popup syntax probe - passed
- `node tools/pocket-check.js` - not run; it reads files outside this task's allowed inspection scope, including docs other than `docs/CODEX_REPORT.md`
- `npm run check` - not run; no `npm` executable is available in this environment

Result:

- Rollback restored the previous working popup template state; runtime/save/data plumbing was not changed.

Manual retest steps:

1. Hard refresh Pocket.
2. Confirm the main tree renders again.
3. Open PE/item details for a normal node.
4. Confirm `save` saves and keeps the popup open.
5. Confirm `save & close` saves and closes.
6. Confirm Cmd/Ctrl+S saves and keeps the popup open.
7. Make an unsaved edit, press Escape, and confirm the dialog still says `Save & close`.
