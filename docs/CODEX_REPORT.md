# Codex report

Status: smallest Enter-only copy predicate implemented.

Files changed:

- `js/pocket-enter-copy-only.js`
- `docs/CODEX_REPORT.md`

Result:

- Added a dedicated Enter-copy predicate in `js/pocket-enter-copy-only.js`.
- Enter still honours existing `shouldCopyOnSingleClick()` for existing copy-ready leaves.
- Enter now also copies descendants under a recognised copy context when they have children.
- The copy root itself is excluded by requiring the copy context root id to differ from the selected node id.
- Row-click copy behaviour is unchanged and still depends on `shouldCopyOnSingleClick()`.
- `copyText()` is unchanged.
- Editable/modal/menu/move/import/inline-edit guards are preserved.
- PE opening remains tree-target-only for non-copy nodes.
- PE save/apply, dirty-popup protection, pending-open behaviour, styling, migration/data, and legacy fields are unchanged.

Checks run:

- `node --check js/pocket-enter-copy-only.js` - passed.
- `node tools/pocket-check.js` - passed; expected no-fixture warning for `w4_68`.

Manual retest steps for Murray:

- Selected leaf under copy + Enter copies.
- Selected container/subnode under copy + Enter copies.
- Selected copy root does not copy.
- Row-click copy behaviour is unchanged.
- Selected non-copy node + Enter opens PE only from tree context.
- Enter in search/details/PE fields is ignored.
- Ctrl/Cmd+C still works.
- Dirty-popup protection still works.
- Pending-open flow still works.
- Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still work.
