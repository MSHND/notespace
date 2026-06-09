# Codex report

Status: smallest Enter copy-node fix implemented.

Files changed:

- `js/pocket-enter-copy-only.js`
- `docs/CODEX_REPORT.md`

What changed:

- Broadened the final Enter guard so a selected copy-ready node can copy from safe non-tree focus, such as `body` or another non-editing/non-modal area.
- Preserved the tree-target requirement for opening PE; non-copy nodes still only open PE from tree context.
- Added a small ignore guard for editable targets, open overlays/dialogs/menus, move mode, pending import, and inline-edit flows.
- Left `shouldCopyOnSingleClick()`, `copyText()`, PE routing, save/apply, dirty-popup protection, pending-open behaviour, styling, and migration/data logic unchanged.

Checks run:

- `node --check js/pocket-enter-copy-only.js` using bundled Node in a scratch copy from GitHub `main` - passed.
- `node tools/pocket-check.js` using bundled Node in a scratch repo harness from GitHub `main` - passed with expected no-fixture warning for `w4_68`.

Manual retest steps for Murray:

- Selected copy leaf + Enter copies.
- Selected copy leaf + Enter copies when focus is on `body` or a safe non-tree area.
- Selected non-copy node + Enter still opens PE only from tree context.
- Enter in search/details/PE fields is ignored by this copy guard.
- Row click copy still works.
- Ctrl/Cmd+C still works.
- Dirty popup protection still works.
- Pending-open flow still works.
- Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still work.
