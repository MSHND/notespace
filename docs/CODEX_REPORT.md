# Codex report

Status: PE popup toolbar polished; Save now stays open and Save & close is separate.

Files changed:

- `js/pocket-node-popout-template.js`
- `js/pocket-node-popout-runtime.js`
- `docs/CODEX_REPORT.md`

Checks run:

- `node --check js/pocket-node-popout-template.js` - passed
- `node --check js/pocket-node-popout-runtime.js` - passed
- generated popup syntax probe - passed
- `node tools/pocket-check.js` - passed
- `npm run check` - not run; no `npm` executable is available in this environment

Result:

- Passed available checks; npm wrapper unavailable, direct check script passed.

Manual retest steps for Murray:

1. Hard refresh Pocket.
2. Open PE/item details for a normal node.
3. Confirm the toolbar feels grouped: title/status, save actions, mode, hint, and close align cleanly.
4. Edit body text and click `save`; confirm the popup stays open and shows saved.
5. Reopen PE and confirm the saved edit persisted.
6. Edit again and press Cmd/Ctrl+S; confirm the popup stays open and the edit persists after reopen.
7. Edit again and click `save & close`; confirm it saves and closes.
8. Make an unsaved edit and press Escape; confirm the warning appears.
9. In the warning, confirm `Save` saves and closes, `Exit without saving` discards, and `Go back to editing` keeps the draft.
