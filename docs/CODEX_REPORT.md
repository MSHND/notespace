# Codex report

Status: emergency Enter restore applied.

Files changed:

- `js/pocket-enter-copy-only.js`
- `docs/CODEX_REPORT.md`

Result:

- Disabled the capture-phase Enter interceptor in `js/pocket-enter-copy-only.js`.
- Removed the `document` and `window` `keydown` registrations for `handleEnter`.
- Left the PE Escape close guard and row-menu Move guard installed.
- Left `pocket-tree-actions.js` as the active tree Enter owner through `treeWrap` keydown.
- Did not attempt the copy-child Enter enhancement in this pass.
- Row-click copy, Ctrl/Cmd+C copy, PE save/apply, dirty-popup protection, pending-open behaviour, styling, migration/data, and legacy fields were not changed.

Diagnostic:

- `pocket-enter-copy-only.js` loaded last and captured plain Enter before `treeWrap` could receive it.
- Its `handleEnter()` path called `preventDefault()`, `stopPropagation()`, and `stopImmediatePropagation()` before normal tree/PE fallback could recover.
- Next copy-child work should use a tiny targeted predicate and should only suppress Enter after a confirmed copy/open action.

Checks run:

- `node --check js/pocket-enter-copy-only.js` - passed.
- `node tools/pocket-check.js` - passed; expected no-fixture warning for `w4_68`.

Manual retest steps for Murray:

- Normal node + Enter opens PE from tree context.
- Enter does not die globally.
- Enter in search/editing fields is ignored.
- Row-click copy still works.
- Ctrl/Cmd+C still works.
- Dirty-popup protection still works.
- Pending-open flow still works.
- Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still work.
- Enter-to-copy for copy children remains unfixed for now.
