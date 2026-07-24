# Codex report

## POCKET TASK P013

Title: Separate Notes and Outline content

### Baseline

- Confirmed `origin/main` at `70e1cd3a01ea661465c25a1c1b502f86c8d6804b` (`P012 Bind PE saves to source identity`).
- Local branch and remote were equal and the worktree was clean before implementation.
- No personal Pocket truth file was inspected or modified.

### Implementation and user-visible behaviour

- The PE controls are labelled **Notes** and **Outline**, not Text and Outline modes.
- `node.details` remains independent Notes truth; exact current-v1 `node.editor.outline` remains independent Outline truth; `node.label` remains shared.
- A supported Outline opens its tab. Nodes without one open Notes. Opening an absent Outline creates only a fresh blank runtime row.
- Tab switching retains both unsaved sections, performs no conversion, and does not dirty the popup.
- Runtime saves always send both independent views. The main-window model compares them independently rather than trusting the visible tab.
- Notes-only changes preserve raw supported editor metadata and extensions. Outline changes preserve Notes and cross the existing P012 non-lossy/canonical save boundary. Combined edits persist in one apply.
- Blank Notes remove only `details`; a blank Outline removes only `editor`; clearing both persists neither optional field.
- Existing indented details projections remain Notes without detection, cleanup, or migration.
- Structured-paste parsing, selection/subtree actions, P007 Escape ordering, read-only unsupported metadata, P012 source/revision checks, export retry, dirty-close protection, search, and details-first copy remain unchanged.

### Files changed

- `js/pocket-node-popout-runtime.js`: removed implicit Notes/Outline conversion and made tab selection presentation-only.
- `js/pocket-node-popout-template.js`: renamed the visible sections and accessibility labels.
- `js/pocket-node-popout-model.js`: validates and compares Notes and Outline independently, preserves unchanged raw editor data, permits a deliberately empty Outline, and retains P012 loss checks on actual Outline edits.
- `js/pocket-node-popout-editor.js`: reports which independent section changed while retaining the existing apply/save owner.
- `js/pocket-editor-popout.js`: removes the same destructive conversion from the loaded compatibility UI, while its save continues to delegate to the canonical owner and fail closed when unbound.
- `tests/pe-persistence-contract.test.js`: extends the active-source contract suite for independent sections and updates P008 coverage to structured paste only.
- `docs/PE_PERSISTENCE_CONTRACT.md`: records the P013 contract and compatibility boundary.
- `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`: records Murray's independent-section product decision without removing the historical audit.
- `docs/CODEX_REPORT.md`: this report.

No `index.html`, package, dependency, fixture, truth-file example, retired implementation, copy route, search route, or save architecture file changed.

### Validation

- `node --test tests/pe-persistence-contract.test.js`: 79 passed, 0 failed.
- `node --check` passed for every changed JavaScript file, and `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.
- Generated runtime source was built from actual `PocketNodePopoutRuntime.build()` and compiled with `new Function(...)` for Notes-only, Outline, combined/read-only, blank Outline and P012 rejection/retry paths through the focused suite.
- Controlled runtime checks proved switching tabs does not dirty or convert, retains unsaved Notes and Outline, emits both in one save, renders a blank absent Outline, and retains structured-paste indentation.
- Main-window tests proved Notes-only, Outline-only, combined, clear Notes, clear Outline, clear both, raw-extension preservation, unsafe-raw preservation on Notes edit, and rejection on an actual unsafe Outline edit.
- P006 subtree actions, P007 Escape ordering, P008 paste parsing, P011 read-only compatibility, P012 source identity/revision/export retry/limits, and details-first copy remain green.

### Remaining CURRENT-RISK items

The focused suite still labels previously audited load-time normalisation and compatibility weaknesses as CURRENT-RISK, including legacy `node.pe` synthesis and pre-recognition slicing. P013 does not change `node.pe`; that policy remains planned for P014. Physical browser acceptance remains required.

### Browser acceptance checklist

1. Save and reopen a Notes-only node; open Outline and confirm it is blank and unsaved.
2. Save and reopen an Outline-only node; confirm Notes remains empty.
3. Put content in both sections, save once, hard refresh, and verify both.
4. Edit Notes only on an Outline node and verify IDs, depths, collapse, order, and content remain unchanged.
5. Edit Outline only and verify Notes is byte-for-byte/semantically unchanged.
6. Clear Notes and Outline independently, saving and reopening after each; then confirm clearing both leaves neither optional field.
7. Switch tabs repeatedly with unsaved edits in both and confirm neither changes or disappears.
8. Paste a multiline indented hierarchy into Outline and exercise Copy, Duplicate, Delete, Enter, Tab, and Shift+Tab.
9. Confirm dirty-close protection and Save & Close behaviour after failed/cancelled persistence.
10. Repeat the P012 same-node-ID file-switch rejection.
