# Codex report

Status: Report only. No runtime extraction or save/apply plumbing change.

Inspected:

- `js/pocket-node-popout-editor.js`
- `js/pocket-node-popout-template.js`
- `index.html` for script order only

1. Runtime/event responsibilities still in `pocket-node-popout-editor.js`:

- Builds node payload from `node.label`, `node.details`, and outline editor metadata.
- Generates the inline popup runtime script string.
- Runtime owns child-window state: `dirty`, `allowedToClose`, `mode`, `outline`, and focus return.
- Runtime wires Save, Close, unsaved-dialog buttons, mode buttons, outline row events, Cmd/Ctrl+S, Cmd/Ctrl+Enter, Escape, and `beforeunload`.
- Runtime serializes current text/outline state and calls `window.opener.PocketNodePopoutEditor.apply(...)`.
- `open` still owns popup sizing, `window.open`, template rendering, `document.write`, focus, and blocked-popup status.
- `apply` still owns node mutation, persistence, render refresh, focus restore, status, and snapshot/save calls.

2. Safest extraction boundary:

- Extract only the runtime script factory, leaving `open`, `apply`, payload normalization, `safeJson`, and template rendering in `pocket-node-popout-editor.js`.
- Keep the extracted helper pure: input is the already-safe JSON string; output is the inline child-window script text.
- Do not make the popup depend on loading the helper file inside the popup window.

3. What must stay together for now:

- Save, dirty state, `allowedToClose`, unsaved dialog, Escape handling, and `beforeunload` should move as one runtime unit.
- Outline state, outline rendering/edit events, text/outline conversion, and `buildPayload()` should stay with that runtime unit.
- `PocketNodePopoutEditor.apply` and all node save/persistence plumbing should stay in `pocket-node-popout-editor.js`.
- Title to `node.label`, body to `node.details`, and `node.editor` outline metadata should stay unchanged.

4. Suggested helper file and API:

- File: `js/pocket-node-popout-runtime.js`
- Load order: after `js/pocket-node-popout-template.js`, before `js/pocket-node-popout-editor.js`.
- API: `window.PocketNodePopoutRuntime.build(initialJson)` returns the complete inline runtime script string.

5. First smallest extraction step:

- Move the existing `popupRuntimeScript(initial)` body into `PocketNodePopoutRuntime.build(initialJson)` with no behavior edits.
- In `editorHtml(payload)`, require `PocketNodePopoutRuntime.build`, then pass `runtimeScript: PocketNodePopoutRuntime.build(safeJson(payload))` to the template.
- Add the new script tag between template and editor.
- Run syntax checks only after the mechanical move.

6. Key risks:

- Save must keep calling opener `apply(...)` synchronously and only close when it returns truthy.
- Failed Save must leave the popup open and dirty.
- Cmd/Ctrl+S and Cmd/Ctrl+Enter must still `preventDefault()` and route to Save.
- Escape must cancel the unsaved dialog when shown; otherwise it must use the safe close path.
- Unsaved-dialog Save, Discard, and Cancel must preserve focus and dirty/close semantics.
- `dirty` and `allowedToClose` must stay coupled so scripted closes do not trigger `beforeunload`, but manual dirty closes still warn.
- The helper runs in the opener page; the returned script runs in the popup page, so no runtime logic can depend on helper closures.
