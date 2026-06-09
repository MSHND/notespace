# Codex report

Status: report-only next decomposition map after successful PE popout window extraction.

Files changed:

- `docs/CODEX_REPORT.md` only

Current remaining editor responsibilities:

- Public API: `PocketNodePopoutEditor.open(input)` and `PocketNodePopoutEditor.apply(payload)`.
- Dependency guards for `PocketNodePopoutModel` and `PocketNodePopoutWindow`.
- Target node resolution from input, object id, selected id fallback, and `nodeMap()`.
- `open(input)` coordination: resolve node, build payload, delegate popup opening, log success, report missing node.
- `apply(payload)` save behaviour: resolve target, compare label/details/editor metadata, write node fields, update timestamp/selection, record op, refresh/render/focus/persist/status/log.

Next safest extraction seam:

- Target node resolution can be extracted safely as a tiny helper if it is kept behaviour-identical.
- Proposed module: `js/pocket-node-popout-target.js`.
- Proposed API: `window.PocketNodePopoutTarget.get(input)` returning the node or `null`.
- Optional API: `window.PocketNodePopoutTarget.clean(value, max)` only if the editor still needs shared id/title cleaning.

Can target node resolution be safely extracted?

- Yes, but only as a direct move of the current `clean`/`getNode` lookup path.
- It must preserve string input, object input, selected-id fallback, missing-id handling, `nodeMap()` use, and null return behaviour.
- Missing-node status/logging should remain in `pocket-node-popout-editor.js` so public API behaviour stays obvious.

Save/apply should remain untouched for now:

- `apply(payload)` is the riskiest remaining area because it owns node writes, legacy fields, outline metadata, persistence, render/focus, and user-facing status.
- Do not split save/apply until PE migration/conflict preservation rules are fully settled and covered by diagnostics/manual tests.

What should stay in editor:

- `PocketNodePopoutEditor.open/apply` public API.
- Missing-node user status/logging.
- Calls into model/window helpers.
- All save/apply comparisons, node writes, op/status/persist/render/focus side effects, and success logs.
- PE data compatibility and legacy field handling.

Files likely to change later:

- `js/pocket-node-popout-target.js` new helper.
- `js/pocket-node-popout-editor.js` to call target helper.
- `index.html` to load target helper before editor.
- `docs/CODEX_REPORT.md` for result notes.
- `tools/pocket-check.js` only if script-order checking is added.

Risks/checks:

- Risk: selected-id fallback changes.
- Risk: object/string input handling changes.
- Risk: missing `nodeMap()` behaviour changes.
- Risk: helper load order breaks editor startup.
- Checks: `node --check` new helper and editor, `node tools/pocket-check.js`, target-resolution probe for string/object/selected/missing-node cases, and manual hard-refresh/open/save/save-close/Cmd-Ctrl-S/Escape/text/outline retest.

Smallest implementation step:

- Add `pocket-node-popout-target.js` with copied `clean` and `get(input)` logic.
- Load it before `pocket-node-popout-editor.js`.
- Replace only `getNode(input)` calls in the editor with `PocketNodePopoutTarget.get(input)`.
- Do not change `apply`, model/window/runtime/template, bridge/cutover, migration/data logic, legacy fields, or scripts beyond the new load entry.
