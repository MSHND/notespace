# Codex report

Status: PE outline collapse sibling-branch fix added.

Root cause:

- `isHidden(index)` scanned all previous outline rows.
- A collapsed earlier depth-0 row could be treated as an ancestor of a later depth-1 row even after a new depth-0 sibling appeared.
- Result: collapsing Head 1 could hide Child 2 / Child 3 under later heads.

Files changed:

- `js/pocket-node-popout-runtime.js`
- `docs/CODEX_REPORT.md`

Fix implemented:

- Rewrote `isHidden(index)` to walk only the target row's actual ancestor chain.
- It skips rows that are not shallower than the current ancestor search depth.
- When it reaches a real ancestor candidate, it checks collapsed state and then narrows the search.
- Once the search reaches depth 0, it stops so earlier top-level siblings cannot be ancestors.

Confirmations:

- Collapse now affects only actual descendants.
- Top-level/head rows are independent.
- `hasChildren(index)` remains unchanged and still means the next row is deeper than the current row.
- Outline DOM-to-model syncing from the prior fix was preserved.
- No save/apply/export/sync, main tree Enter/copy, multi-select, or outline data-model behaviour was changed.

Checks run:

- Bundled Node `--check js/pocket-node-popout-runtime.js` - passed.
- Generated popup runtime syntax probe - passed.
- Bundled Node `tools/pocket-check.js` - passed; existing `w4_68` fixture warning remains when `POCKET_CHECK_DATA` is not set.

Manual test checklist:

1. Hard refresh.
2. Open PE.
3. Switch to outline mode.
4. Create Head 1 / Child 1, Head 2 / Child 2, Head 3 / Child 3.
5. Collapse Head 1; only Child 1 hides, while Head 2, Child 2, Head 3, and Child 3 remain visible.
6. Collapse Head 2; only Child 2 hides, and Head 1 / Head 3 branches are unaffected.
7. Expand Head 1; only Child 1 reappears.
8. Expand Head 2; only Child 2 reappears.
9. Save, close, and reopen; outline text and collapse state remain correct.
10. Switch outline to text and back; no text is lost.
