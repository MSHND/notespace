# Codex report

Status: Report-only decomposition plan for `js/pocket-node-popout-editor.js`.

Files inspected:

- `js/pocket-node-popout-editor.js`
- `index.html` script order around the PE scripts only

Files changed:

- `docs/CODEX_REPORT.md`

Major responsibilities currently in `js/pocket-node-popout-editor.js`:

- Public owner: defines `window.PocketNodePopoutEditor` with `open()` and `apply()`.
- Main-window lookup and payload building: selected-node lookup, text/detail normalisation, outline editor metadata normalisation, path/title/body payload creation.
- Generated popup document: full HTML, CSS, toolbar, fields, unsaved dialog, and inline runtime script.
- Popup runtime: dirty state, Save, Cmd+S/Ctrl+S, Escape/close handling, `beforeunload`, focus return, text/outline mode switching, and outline editing.
- Main-window apply/save: compares payload to the live node, writes `node.label`, `node.details`, and `node.editor`, then records, refreshes, renders, persists, and reports status.
- Bridge contract: `js/pocket-pe-node-popout-bridge.js` depends on `PocketNodePopoutEditor` existing before `js/pocket-editor-cutover-v3.js`.

Natural split boundaries:

- Main-window API shell and window opening should stay together until the end, because script order depends on the exported `PocketNodePopoutEditor` object.
- Main-window data model helpers can split from popup rendering: `clean`, `normaliseDetailsSafe`, `getNode`, `normaliseOutlineBlock`, `normaliseEditorMeta`, and `payloadFromNode`.
- Popup document template can split from main-window save/apply: HTML shell, CSS, toolbar/dialog markup, and popup script injection.
- Popup runtime can split from the template once it has a single explicit payload/opener contract.
- Main-window `apply()` should remain near the node write/persist side until title/data plumbing work is deliberately scheduled.

Suggested small file names and ownership:

- `js/pocket-node-popout-editor.js`: public `PocketNodePopoutEditor.open/apply` owner and compatibility shell.
- `js/pocket-node-popout-model.js`: node lookup, detail/title cleaning wrappers, outline metadata schema, payload creation, and payload normalisation.
- `js/pocket-node-popout-template.js`: `editorHtml(payload)` and HTML/CSS assembly.
- `js/pocket-node-popout-popup-runtime.js`: popup-window runtime script as a generated string or renderer-owned function.
- `js/pocket-node-popout-outline-runtime.js`: outline-only popup behaviours if the runtime file becomes too dense.
- `js/pocket-node-popout-apply.js`: later home for `apply()` only after title/data source-of-truth decisions are settled.

Safest order of extraction:

1. Extract the generated popup CSS/markup helper into `pocket-node-popout-template.js`, while keeping `editorHtml(payload)` callable from the current owner.
2. Extract pure model helpers into `pocket-node-popout-model.js`, with no node writes and no UI side effects.
3. Extract the popup runtime string into `pocket-node-popout-popup-runtime.js`, keeping the existing opener call to `window.opener.PocketNodePopoutEditor.apply(buildPayload())`.
4. Only then consider extracting outline runtime helpers, because outline rendering, dirty state, and body serialisation are tightly coupled.
5. Leave `apply()` in `pocket-node-popout-editor.js` until the title/data plumbing work is intentionally handled.

Functions/data that should remain together:

- `normaliseOutlineBlock`, `normaliseEditorMeta`, and `OUTLINE_EDITOR_SCHEMA`.
- Popup `outline`, `textToOutline`, `outlineToText`, `renderOutline`, `setMode`, `currentBody`, and `buildPayload`.
- Popup `dirty`, `allowedToClose`, unsaved-dialog handlers, `save()`, `closeSafely()`, and `beforeunload`.
- Main-window node writes, `recordOp`, `refreshMeta`, `renderTree`, `saveWorkspaceState`, `persistPipSnapshot`, and status messaging inside `apply()`.

Risks:

- Script order is brittle. `pocket-node-popout-editor.js` currently loads at `index.html:167`, before the bridge and cutover scripts.
- Moving popup runtime out of the generated document too early could break popup-window context access.
- Splitting outline conversion separately from `buildPayload()` could cause saved text and saved outline metadata to drift.
- Extracting `apply()` before title/data plumbing is settled could hide the current `node.label` and `node.details` source-of-truth behaviour.
- Each new global helper adds a boot-order dependency unless wrapped under one namespace.

First smallest extraction step:

- Create `js/pocket-node-popout-template.js` with a single namespace function such as `window.PocketNodePopoutTemplate.render(payload, helpers)`.
- Move only the HTML/CSS assembly out of `editorHtml(payload)`.
- Keep `pocket-node-popout-editor.js` exporting `PocketNodePopoutEditor.open/apply`.
- Add the new script immediately before `js/pocket-node-popout-editor.js` in `index.html`.
- Verify with `node --check` on both files, `npm run check`, and the manual PE open/save/Cmd+S/unsaved-close smoke test.

Checks:

- Not run. Report-only change; no JavaScript or runtime behaviour changed.
