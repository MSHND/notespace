# Codex report

## POCKET TASK P008

Title: Fix PE Text-to-Outline indentation conversion

Status: implemented and validated against the actual generated PE runtime.

Commit title:

- `P008 Fix PE text-to-outline indentation`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Starting `origin/main`: `c8c9a39f5485d500666a11c8061567cb8658e964`
- Starting commit: `P007 Refine PE outline Escape behaviour`
- `git fetch origin` confirmed that `origin/main` had not advanced beyond P007 before editing.
- The local `main` branch matched `origin/main`, and the working tree was clean before editing.

### Root cause confirmed

`js/pocket-node-popout-runtime.js` is an outer runtime factory that returns a second JavaScript program from a template string. The old independent `textToOutline()` implementation contained an escape-sensitive leading-whitespace expression in the outer source.

Inspection of the actual string returned by `PocketNodePopoutRuntime.build(...)` confirmed that the intended leading-whitespace expression was emitted as:

```js
line.match(/^s*/)
```

instead of a whitespace matcher. The generated program still compiled, but typical indented lines reported no leading indentation, so Text-to-Outline conversion flattened them to depth 0. Switching back to Text then serialised that flattened outline and removed the visible indentation.

The independent parser also differed from the established structured multiline paste parser. It did not share blank-line filtering, relative-depth alignment, inferred space units, or the structured parser's fresh-block construction.

During validation, the existing shared parser was also found to infer its space unit from absolute indentation. For a common leading margin of 4, 6, and 8 spaces, it selected 4 as the unit and produced `0,0,1`. This was corrected in the canonical parser so the required common-leading case produces `0,1,2` without reintroducing a second parsing model.

### Files changed

- `js/pocket-node-popout-runtime.js`
- `docs/CODEX_REPORT.md`

No other source, persistence, model, template, main-tree, or retired PE file was modified. No dependency or validation artefact was added.

### Implementation

`textToOutline()` now delegates directly to the canonical structured multiline parser:

```js
function textToOutline(text) { return outlineBlocksFromPastedText(text, 0); }
```

Function declaration hoisting makes this ordering safe inside the generated runtime.

`inferPastedSpaceUnit()` now calculates space offsets relative to the shallowest leading-space count. When any meaningful line begins at zero spaces, the result is identical to the previous structured-paste inference. When every meaningful line has a common positive margin, the margin no longer masks the actual indentation step. A uniform common margin still falls back safely to that margin.

The former independent Text-to-Outline whitespace calculation has been removed, so Text conversion and structured multiline paste now have one indentation parser.

### New Text-to-Outline behaviour

- Text-only nodes still initialise in Text mode because `js/pocket-node-popout-model.js` still emits `mode: "text"` and `outline: null` when no valid outline metadata exists.
- Indentation alone does not automatically select Outline mode.
- On the first manual Outline selection for a text-only node, `setMode()` converts the current live `bodyInput.value`, including edits made after the PE opened.
- Spaces, tabs, and mixed tabs and spaces are parsed by `leadingIndentInfo()`.
- Space indentation units are inferred by the shared parser.
- Common leading indentation is removed through relative-depth alignment.
- Meaningful lines retain their relative hierarchy.
- Depth is clamped to 0 through 8.
- Each converted row receives a fresh block ID and `collapsed: false` through `makeBlock()`.
- Blank and whitespace-only lines are ignored.
- Empty or whitespace-only input produces no parsed blocks, after which the existing `renderOutline()` fallback creates one fresh blank depth-0 row.
- Text serialisation continues to use the standard two-space representation from `outlineToText()`.

### Parser results

The parser exercised was the function embedded in the actual program returned by `PocketNodePopoutRuntime.build(...)`, observed through an in-memory test hook. It was not a separate parser imitation.

- Two-space hierarchy: `0,1,2`
- Four-space hierarchy: `0,1,2`
- Tab hierarchy: `0,1,2`
- Mixed tab and space hierarchy: `0,1,2`
- Common leading 4, 6, and 8 spaces: `0,1,2`
- Blank-line sample: three meaningful rows at `0,1,2`, with no blank outline rows
- Base-depth alignment sample at depth 3: `3,4,5`
- Eleven-level sample: `0,1,2,3,4,5,6,7,8,8,8`
- Empty and whitespace-only parser input: no blocks, followed by one blank depth-0 row through rendering fallback
- PFC sample: `0,1,2,3,3,2,2,3,3,3`

All generated blocks in the parser cases had non-empty unique IDs, `collapsed: false`, and depths within 0 through 8.

### Round-trip results

Text to Outline to Text to Outline round trips were validated for:

- two-space indentation
- four-space indentation
- tabs
- mixed tabs and spaces
- common leading indentation
- blank-line input
- the complete PFC sample

The returned Text used the normalised two-space representation. Re-parsing that Text preserved the same meaningful row text and depth sequence. No tested hierarchy flattened.

### Saved native outline regression

An Outline-mode payload was tested with stable IDs, multiple depths, a collapsed parent, and body text that deliberately did not match the saved outline.

Initialisation:

- used the saved outline array
- preserved IDs
- preserved texts
- preserved depths
- preserved collapsed state
- did not parse or replace the mismatched body text

The existing save payload continues to include `mode: "outline"` and the outline array. `js/pocket-node-popout-model.js` and its existing `pocket.nodeEditor.v1` metadata format were not changed. Reopening a valid saved outline therefore continues to use its persisted IDs, depths, and collapsed state instead of reparsing body text.

### Structured paste regression

The generated-runtime interaction harness confirmed:

- multiline paste after the active row
- paste after the final selected subtree
- base-depth alignment
- common leading indentation
- spaces, tabs, and mixed indentation through the shared parser
- blank-line filtering
- insertion position preservation
- fresh IDs and `collapsed: false`
- pasted-root selection and selection-anchor update
- PE dirty state without autosave

When a pasted sample contained an unindented root, space-unit inference was behaviour-identical to the previous parser. Context-menu Paste still uses the same `insertStructuredOutlineText()` path and retains its established selection and insertion semantics.

### P006 and P007 regression review

The generated-runtime interaction harness passed:

- subtree-aware Copy, including hidden descendants and normalised relative indentation
- context-menu Paste after selection
- Duplicate of a complete subtree with fresh IDs and preserved depths and collapsed values
- Delete of the duplicated subtree with focus-selection recovery
- Enter row creation
- Tab and Shift+Tab depth changes
- collapse and expand with descendant preservation
- P007 Escape order: context menu, unsaved dialog, `.outlineText` editing exit to the row selector, then normal close flow

The parser change did not modify the selection, context-menu, Copy, Duplicate, Delete, row-key, collapse, Escape, or close-flow implementations.

### Save, dirty state, and truth-file protections

The generated-runtime harness confirmed:

- Save builds a body and outline payload with the converted IDs and depths.
- Successful Save clears dirty state without closing.
- Successful Save & Close clears dirty state, permits closure, and invokes the existing close path.
- Applied-but-not-exported results remain dirty and open.
- Rejected Save and Save & Close results remain dirty and open, report failure, and retain before-unload protection.

The active-file and truth-file owners were inspected and have no diff:

- `js/pocket-node-popout-editor.js` still gates opening and payload application through `requirePocketFileForChanges()` and routes PE Save through `applyAndSave()`.
- `js/pocket-io-browser.js` still captures and validates the active file session, rejects changed sessions, requires a modifiable Pocket file, and writes through `exportTree()`.

No autosave, background write, file watcher, writable-handle reuse, cloud synchronisation, persistence format, or main-tree Enter routing was added or changed. Main Save, PE Save, dirty-until-export, active-file session, and details-first copy-context behaviour remain outside and untouched by this narrow runtime diff.

### Checks run

- `node --check js/pocket-node-popout-runtime.js` passed.
- `node --check js/pocket-node-popout-template.js` passed.
- `git diff --check` passed.
- A Text-mode payload with `outline: null` was built and the unmodified returned program passed to `new Function(...)`: passed.
- An Outline-mode payload with valid saved metadata was built and the unmodified returned program passed to `new Function(...)`: passed.
- Generated-source inspection confirmed the shared `textToOutline()` delegation: passed.
- Generated-source inspection confirmed the canonical `/^[ \\t]*/` matcher survived generation: passed.
- Generated-source inspection confirmed the faulty `/^s*/` parser was absent: passed.
- Generated parser and round-trip harness: `P008 generated parser validation: PASS`.
- Full UI-driven generated-runtime parser/native-outline harness: `P008 targeted generated-runtime validation: PASS`.
- Generated-runtime interaction regression harness: `P008 generated-runtime interaction regression: PASS`.
- Static diff review confirmed active-file protection files were unchanged.
- Final name-only and status review found only the two expected files and no temporary validation artefacts.

`node tools/pocket-check.js` and `npm run check` were not run, as required.

### Still requiring Murray's physical browser test

- Open the real older PFC text-only node, confirm it starts in Text mode, select Outline, and visually confirm the expected hierarchy.
- Switch the converted PFC node back to Text and confirm the normalised two-space indentation remains hierarchical.
- Save against the real selected Pocket truth JSON, close PE, reopen the node, and confirm Outline mode, IDs, depths, and collapsed state persist.
- Exercise real Clipboard API permission and native context-menu presentation.
- Confirm focus rings, selector focus, collapse visuals, and the physical P007 Escape feel in the standalone popup.
- Confirm actual popup close timing and main-window opener integration.
- Confirm file-picker permission, writable-handle session protection, and the physical truth-file export on Murray's Mac.

### Git identification

This report is included in the commit titled `P008 Fix PE text-to-outline indentation`. The resulting SHA is not embedded in the same commit because changing this file to add that SHA would produce a different SHA. The completion response is gated on pushing that commit to `origin/main`, fetching again, and confirming local `main` and `origin/main` resolve to the same P008 commit.
