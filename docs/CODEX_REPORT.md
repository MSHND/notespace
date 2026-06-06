# Codex report

Status: PE route inspection only; no app behaviour changes made.

Commands run:

- `git pull --ff-only`
  - Result: fast-forwarded local inspection clone to current `main`.
- `sed -n '1,220p' AGENTS.md`
  - Result: repo instructions read.
- Inspected PE/editor route files:
  - `js/pocket-node-editor-route.js`
  - `js/pocket-node-popout-editor.js`
  - `js/pocket-editor-cutover-v3.js`
  - `js/pocket-render.js`
  - `js/pocket-pe-save-dirty.js`
  - nearby legacy popout files: `js/pocket-editor-popout.js`, `js/pocket-editor-popout-v2.js`, `js/pocket-editor-popout-default.js`, `js/pocket-editor-conflict.js`
- `npm run check`
  - Result: passed.

Check result:

```text
> check
> node tools/pocket-check.js

Pocket check v1
ok   index.html - ends with </html>
ok   script tags - 45
ok   enter handlers - no duplicate known pair detected
ok   js/pocket-node-editor-route.js - ends with })(window);
ok   js/boot/pocket-load-manifest.js - exists
ok   js/boot/pocket-boot.js - exists
ok   js/commands/pocket-command-router.js - exists
ok   docs/PIPEWORK_RULE.md - exists
Pocket check passed
```

Likely cause of PE not opening:

- `js/pocket-node-editor-route.js` is currently a minimal stub. It creates `window.PocketPeEditor` only if needed, sets `PocketPeEditor.version = "PE route minimal stub v1"`, and logs `[PE route] minimal stub loaded; rebuild paused`.
- It does not define `PocketPeEditor.open` or `PocketPeEditor.apply`.
- `js/pocket-editor-cutover-v3.js` treats `PocketPeEditor.open(node.id)` as the main standalone route. Its `openStandalone()` returns `false` when `PocketPeEditor.open` is missing.
- `js/pocket-pe-save-dirty.js` only installs its dirty/save wrapper if `PocketPeEditor.apply` already exists. Because the stub route has no `apply`, it cannot create a useful `openPocketPeEditor` wrapper.
- `js/pocket-node-popout-editor.js` does expose a plausible working owner, `PocketNodePopoutEditor.open/apply`, but that owner is not wired into the canonical `PocketPeEditor.open/apply` route.

Current route/open/apply owners:

- `js/pocket-render.js`
  - `openItemDetailsForNode(nodeId)` is the front-door route used by rendered item details/edit actions.
  - It tries, in order: `openPocketPeEditor`, `PocketPeEditor.open`, `openPocketNodeEditor`, then `openPocketEditor`.
- `js/pocket-editor-cutover-v3.js`
  - Installs `window.openPocketNodeEditor = openDirect` and `window.openPocketEditor = openDirect`.
  - `openDirect()` resolves the selected node, tries `PocketPeEditor.open(node.id)` first, then tries the old `PocketEditorPopout.open()` fallback.
- `js/pocket-node-editor-route.js`
  - Current `PocketPeEditor` owner in name only.
  - It is a stub and owns only `PocketPeEditor.version`, not `open` or `apply`.
- `js/pocket-node-popout-editor.js`
  - Owns `PocketNodePopoutEditor.open(input)` and `PocketNodePopoutEditor.apply(payload)`.
  - Its save path applies directly to the selected node, records a `details_edit`, refreshes/render/focuses, saves workspace state, and persists the PIP snapshot.
- Legacy popout family
  - `js/pocket-editor-popout.js` and `js/pocket-editor-popout-v2.js` own/replace `PocketEditorPopout.open/apply`.
  - `js/pocket-editor-conflict.js`, `js/pocket-editor-save-ack.js`, and related files wrap or listen around that legacy owner.
- `js/pocket-pe-save-dirty.js`
  - Intended as a wrapper around an existing `PocketPeEditor.open/apply` implementation.
  - It does not currently create the missing PE implementation.

Safest next implementation step:

Add a small named bridge/owner file first, without touching large files: for example a dormant `js/pocket-pe-node-popout-bridge.js` that maps the canonical `PocketPeEditor.open/apply` surface to `PocketNodePopoutEditor.open/apply` only when the node popout owner is present. Then verify that bridge in isolation. After that, use repo-local tooling or a tiny exact load-order mod to load it in the intended position, and rerun `npm run check` plus the browser smoke test.

A slightly stronger version is to make `js/pocket-node-editor-route.js` the canonical owner, but only after the replacement bridge is already present and verified. Avoid editing `index.html` manually.

Risks:

- If the bridge bypasses `js/pocket-pe-save-dirty.js`, save/dirty cues or truth-file save expectations may differ from the old PE route.
- If `PocketNodePopoutEditor.apply` becomes canonical without checking import/persist behaviour, edits may apply locally but not meet the expected truth-file save flow in all contexts.
- The legacy fallback remains broad and wrapped by several files, so fixing the canonical route should avoid accidental interactions with `PocketEditorPopout` wrappers.
- Load order matters: the bridge must run after `PocketNodePopoutEditor` exists and before wrappers that expect `PocketPeEditor.apply` to exist.
- The previous browser smoke used an in-browser temporary normal node because bundled `JSONs/pocket-data.json` normalised to copy-context sample nodes only. A future smoke should include or load a known normal-node fixture.

Files changed:

- `docs/CODEX_REPORT.md` only.

Diff summary:

- Replaced the browser-smoke result report with this PE route inspection report.
- No app behaviour files changed.
- `index.html` was not edited.
- No JS files were edited or deleted.

Next recommendation:

Stop further pruning. Prepare the small dormant PE bridge/owner file next, then wire it only after its surface is verified and the report names the exact load-order step.
