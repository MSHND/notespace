# Codex report

Status: latest Enter-only copy predicate correction rolled back to restore safer Enter behaviour.

Files changed:

- `js/pocket-enter-copy-only.js`
- `docs/CODEX_REPORT.md`

Rollback performed:

- Reverted `js/pocket-enter-copy-only.js` from the broad parent/ancestor `copyAncestorRootIdForEnter()` check.
- Restored the previous `copyContextRootIdForEnter(node)` predicate from the last safer state.
- PE save/apply, dirty-popup protection, pending-open behaviour, `copyText()`, row-click copy, styling, migration/data, and legacy fields were not changed.

Diagnostic:

- Enter was being consumed in `handleEnter()` when `copySelectedNodeIfAppropriate()` returned true.
- That branch calls `preventDefault()`, `stopPropagation()`, and `stopImmediatePropagation()`, so older tree/PE Enter handlers never run.
- The broad parent/ancestor copy-context predicate could classify too many selected nodes as Enter-copy candidates before the tree-target PE open path.
- Next safe copy-child fix should add a tiny targeted check before that preventDefault branch, scoped to a verified `copy` node child/descendant case.
- Do not broaden ancestor matching again without proving the selected node is under the intended copy root.

Checks run:

- `node --check js/pocket-enter-copy-only.js` - passed.
- `node tools/pocket-check.js` - passed; expected no-fixture warning for `w4_68`.

Manual retest steps for Murray:

- Normal node + Enter opens PE from tree context.
- Enter does not die globally.
- Enter in search/editing fields is ignored appropriately.
- Row-click copy still works.
- Ctrl/Cmd+C still works.
- Dirty-popup protection still works.
- Pending-open flow still works.
- Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still work.
