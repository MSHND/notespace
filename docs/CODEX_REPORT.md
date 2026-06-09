# Codex report

Status: report-only next decomposition seam after successful PE popout model extraction.

Files changed:

- `docs/CODEX_REPORT.md` only

Current remaining editor responsibilities:

- Resolve target node from input, selected id, and `nodeMap()`.
- Check that model, template, and runtime helpers are loaded.
- Build popup HTML by combining template render, runtime script, HTML escaping, and safe JSON.
- Calculate popup dimensions and screen position.
- Open, write, close document, and focus the popup window.
- Apply popup saves back to `node.label`, `node.details`, and `node.editor`.
- Run save/persist side effects: op record, metadata refresh, render, focus, workspace state, PiP snapshot, status, and logging.

Recommended next safe seam:

- Extract popup window/HTML orchestration, not save/apply plumbing.
- Proposed module: `js/pocket-node-popout-window.js`.
- Proposed API: `window.PocketNodePopoutWindow.open(payload, helpers)` returning `true`/`false`.
- Helper inputs should include `htmlEscape`, `safeJson`, and blocked-popup status handling only if needed to preserve exact messages.

Can popup orchestration be extracted safely?

- Yes, if it is limited to the current `editorHtml(payload)` plus size/position/open/document-write/focus sequence.
- Keep dimensions, window name, popup features, template/runtime dependency errors, document write order, focus call, and blocked-popup behaviour unchanged.
- Do not move `getNode`, `buildPayload`, or `apply` in the same pass.

What should remain in editor for now:

- Public API: `PocketNodePopoutEditor.open/apply`.
- Target node resolution and selected-id fallback.
- Calls into `PocketNodePopoutModel.buildPayload`.
- All save/apply comparisons, node writes, persistence calls, status text, and logs.
- PE migration/data compatibility behaviour and legacy field handling.

Files likely to change next:

- `js/pocket-node-popout-window.js` new helper.
- `js/pocket-node-popout-editor.js` to delegate popup opening.
- `index.html` to load the window helper before `pocket-node-popout-editor.js`.
- `docs/CODEX_REPORT.md` for result notes.
- `tools/pocket-check.js` only if script-order checking is added.

Risks/checks:

- Risk: popup blocked path or status message changes.
- Risk: window size/position/name/features drift.
- Risk: template/runtime dependency errors move or change.
- Risk: document write/focus timing changes.
- Checks: `node --check` new helper and editor, `node tools/pocket-check.js`, popup syntax probe if available, and manual hard-refresh/open/save/save-close/Cmd-Ctrl-S/Escape/unsaved/text/outline retest.

Smallest implementation step:

- Add `pocket-node-popout-window.js` with a copied `editorHtml` plus popup open/write/focus sequence.
- Load it before `pocket-node-popout-editor.js`.
- Replace only the popup open/write block in `PocketNodePopoutEditor.open` with a call to the new helper.
- Leave `apply`, runtime, template, model, bridge/cutover, script pruning, and PE migration untouched.
