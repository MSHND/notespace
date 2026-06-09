# Codex report

Status: Enter-only copy predicate corrected for copy-node children.

Files changed:

- `js/pocket-enter-copy-only.js`
- `docs/CODEX_REPORT.md`

Result:

- Updated `shouldCopyOnEnter()` to use a parent/ancestor copy-context check.
- Direct children of the recognised `copy` node now qualify for Enter-copy.
- Descendants under the recognised `copy` node also qualify for Enter-copy.
- Container children are allowed because `hasKids` no longer blocks the Enter-only copy-context path.
- The copy root itself remains excluded unless the existing single-click predicate would already allow it.
- `findCopyContextRootId(parentId)` is used for the ancestor check, so a child that is also marked as a copy context is not mistaken for the root to exclude.
- Row-click copy behaviour is unchanged and still depends on `shouldCopyOnSingleClick()`.
- `copyText()` is unchanged.
- Editable/modal/menu/move/import/inline-edit guards are preserved.
- PE opening remains tree-target-only for non-copy nodes.
- No PE save/apply, dirty-popup protection, pending-open, styling, migration/data, or legacy-field behaviour changed.

Checks run:

- `node --check js/pocket-enter-copy-only.js` - passed.
- `node tools/pocket-check.js` - passed; expected no-fixture warning for `w4_68`.

Manual retest steps for Murray:

- Selected child directly under copy + Enter copies.
- Selected leaf under copy + Enter copies.
- Selected container/subnode under copy + Enter copies.
- Selected copy root does not copy unless existing behaviour already allowed it.
- Row-click copy behaviour is unchanged.
- Selected non-copy node + Enter opens PE only from tree context.
- Enter in search/details/PE fields is ignored.
- Ctrl/Cmd+C still works.
- Dirty-popup protection still works.
- Pending-open flow still works.
- Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still work.
