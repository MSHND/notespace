# Codex report

Status: report-only decomposition map for `js/pocket-node-popout-editor.js`. No code changes in this pass.

Files changed:

- `docs/CODEX_REPORT.md` only

Current call flow:

- `pocket-editor-cutover-v3.js` routes Edit/double-click/right-click Edit to `PocketPeEditor.open`.
- `pocket-pe-node-popout-bridge.js` delegates `PocketPeEditor.open/apply` to `PocketNodePopoutEditor.open/apply`.
- `pocket-node-popout-editor.js` opens the popup and receives saves from `pocket-node-popout-runtime.js`.
- `pocket-node-editor-route.js` is currently a minimal `PocketPeEditor` stub.

Current editor responsibilities:

- Resolve target node from input, selected id, and `nodeMap()`.
- Normalise legacy body and outline editor metadata.
- Build popup payload from `node.label`, `node.details`, `node.editor`, path, and timestamps.
- Require template/runtime modules and render popup HTML.
- Open, size, write, and focus the popup window.
- Apply popup saves back to node fields.
- Drive save side effects: `recordOp`, `refreshMeta`, `renderTree`, focus, workspace state, PiP snapshot, status, and logs.

Public API:

- `window.PocketNodePopoutEditor.open(input)` returns `true` on popup open, `false` on blocked/missing node.
- `window.PocketNodePopoutEditor.apply(payload)` returns `true` when save/no-op succeeds, `false` when target node is missing.

Safe to extract next:

- Pure-ish payload/model helpers: `clean`, `normaliseDetailsSafe`, `normaliseOutlineBlock`, `normaliseEditorMeta`, and `payloadFromNode`.
- Rendering adapter helper: `editorHtml(payload)` once template/runtime dependency checks stay identical.
- Keep extracted APIs behaviour-preserving, including current legacy `node.details` / `node.editor` reads and the existing outline cap.

Do not touch yet:

- `apply(payload)` save/apply side effects and persistence calls.
- Bridge/cutover routing and fallback logic.
- Runtime save/dirty/close behaviour.
- Template markup/CSS/script order.
- PE canonical migration, conflict preservation writes, legacy field cleanup, or outline cap changes.

Recommended next seam:

- Extract payload/model construction first.
- Proposed module: `js/pocket-node-popout-model.js`.
- Proposed API: `window.PocketNodePopoutModel.buildPayload(node)` and `window.PocketNodePopoutModel.normaliseEditorMeta(value)`.
- Reason: this removes data-shape logic from the window/open/apply controller without touching save plumbing, popup behaviour, bridge routing, or visual code.

Files likely to change next:

- `js/pocket-node-popout-model.js` new helper.
- `js/pocket-node-popout-editor.js` to call the helper.
- `index.html` only for controlled script insertion before `pocket-node-popout-editor.js`.
- `tools/pocket-check.js` only if a script-order/check entry is needed.
- `docs/CODEX_REPORT.md` for result notes.

Risks and checks:

- Risk: script order break if model loads after editor.
- Risk: payload drift in title/body/mode/outline/path/timestamps.
- Risk: changing current legacy reads before PE migration is ready.
- Risk: outline normalisation behaviour changing accidentally.
- Checks: `node --check` new helper and editor, popup syntax probe if available, `node tools/pocket-check.js`, and manual open/save/save-close/Cmd-Ctrl-S/Escape/unsaved-dialog retest.

Smallest implementation step:

- Add `pocket-node-popout-model.js` with exact copied payload/outline normalisation helpers.
- Add the script before `pocket-node-popout-editor.js`.
- Replace only `payloadFromNode`/`normaliseEditorMeta` calls in the editor with the model API.
- Do not change `apply`, runtime, bridge, cutover, template, migration, or styling in that pass.
