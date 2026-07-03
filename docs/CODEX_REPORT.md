# Codex report

Status: Stage 1 PE outline multi-select copy support implemented.

Files changed:

- `js/pocket-node-popout-runtime.js`
- `js/pocket-node-popout-template.js`
- `docs/CODEX_REPORT.md`

Outline selection:

- Added popup-local outline row selection state only.
- Added a small row gutter selector before the existing collapse toggle.
- Normal click selects one outline row.
- Ctrl/Cmd-click toggles rows.
- Shift-click selects a visible range from the last outline selection anchor.
- Clicking inside `.outlineText` still edits/selects text normally.
- Escape clears outline row selection first; with no outline selection it keeps the existing close/unsaved flow.

Copy behaviour:

- Ctrl/Cmd+C copies selected outline rows as plain text while in outline mode.
- Output uses two spaces per relative depth level.
- Selected rows copy in document order.
- Selecting a parent copies the parent plus its logical subtree.
- If parent and child are both selected, the parent wins and the child is not duplicated.
- Collapsed descendants are included because copy uses the logical outline model, not only visible rows.
- Clipboard uses `navigator.clipboard.writeText` with a textarea fallback.

Confirmations:

- Selection and copy do not mark PE dirty.
- No paste, cut, multi-delete, drag/drop, or main-tree selection changes were added.
- PE Save, Save & Close, unsaved guard, pending-open, outline sync, collapse hierarchy, text/outline switching, main Save/export, sync status, and main tree Enter/copy were left unchanged.
- Outline DOM text is still synced before copy through the existing `syncOutlineFromDom()` protection.
- `docs/ARCHITECTURE.md` was not changed; this report records the Stage 1 behaviour.

Checks run:

- `node --check js/pocket-node-popout-runtime.js` - passed.
- `node --check js/pocket-node-popout-template.js` - passed.
- Generated popup runtime syntax probe - passed.
- `node tools/pocket-check.js` - attempted, but the local temp mirror no longer had the check tool and refetching that tool into temp was blocked by local access permissions.

Manual test checklist:

- Hard refresh Pocket.
- Open PE for a normal node.
- Switch to outline mode.
- Click inside outline text; cursor placement and editing still work.
- Click row gutter; row selection appears.
- Ctrl/Cmd-click row gutters toggles multiple rows.
- Shift-click row gutter selects a visible range.
- Ctrl/Cmd+C copies selected rows as plain indented text.
- Parent + child selected copies parent subtree once, without duplicate child lines.
- Collapsed parent selection copies its logical subtree, including hidden descendants.
- Escape clears outline selection before close handling.
- Copying selection does not mark PE dirty.
- PE Save still works.
- PE Save & Close still works.
- PE unsaved guard still works after actual text edits.
- Outline collapse still preserves text.
- Top-level outline collapse remains independent.
- Text/outline switch still preserves content.
- Main tree multi-select still works.
- Main Save/export still works.
- No new console errors.
