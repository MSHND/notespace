# Codex report

Status: stopped after browser smoke test failure

Browser used: Google Chrome headless via Chrome DevTools Protocol.

Commands run:

- `git pull --ff-only`
  - Result: `Already up to date.`
- `npm run check`
  - Result: passed.
- Browser smoke test against `http://127.0.0.1:4173/index.html`
  - Local server: `python3 -m http.server 4173`.
  - Hard refresh: yes.
  - Existing JSON: `JSONs/pocket-data.json` loaded in-browser.
  - Note: that JSON normalised to copy-context sample nodes only, so the smoke test created one temporary in-browser normal node, `smoke_normal_node`. No repo file was changed for that node.
  - Attempted PE route: `openItemDetailsForNode("smoke_normal_node")`.

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

PE/item details opened: no.

Smoke output:

```json
{
  "browser": "Google Chrome headless via Chrome DevTools Protocol",
  "hardRefresh": true,
  "check": "npm run check passed before smoke",
  "temporaryNormalNode": true,
  "openAttempt": {
    "ok": false,
    "threw": false,
    "selectedId": "smoke_normal_node",
    "routeState": {
      "hasOpenItemDetailsForNode": true,
      "hasOpenPocketNodeEditor": true,
      "hasOpenPocketEditor": true,
      "hasOpenPocketPeEditor": false,
      "hasPocketPeOpen": false,
      "hasPocketPeApply": false,
      "pocketPeVersion": "PE route minimal stub v1",
      "hasPocketNodePopoutOpen": true
    },
    "scripts": {
      "loadedPreflight": false,
      "loadedCopyOnly": true,
      "loadedPeSimpleStandalone": false
    }
  },
  "editorTargets": [],
  "consoleProblemCount": 2,
  "consoleProblems": [
    "error: Failed to load resource: the server responded with a status of 404 (File not found)",
    "error: Failed to load resource: the server responded with a status of 404 (File not found)"
  ],
  "consoleWarningCount": 2,
  "consoleWarnings": [
    "warning: [PE route] minimal stub loaded; rebuild paused",
    "warning: [PE route] minimal stub loaded; rebuild paused"
  ]
}
```

Save/close behaviour: not tested because no PE/editor window opened.

Console errors: two Chrome resource-load 404 errors were captured. The local server log on the final pass showed `/favicon.ico` returning 404. The smoke output also captured two warnings from `js/pocket-node-editor-route.js`: `[PE route] minimal stub loaded; rebuild paused`.

Files changed: `docs/CODEX_REPORT.md` only.

Diff summary:

- Replaced the pending browser-smoke placeholder report with the browser smoke result.
- No app behaviour files changed.
- `index.html` was not edited.
- No JS files were edited or deleted.

Concerns:

- The requested browser smoke test failed before save/close: `openItemDetailsForNode("smoke_normal_node")` returned `false` and no PE target opened.
- The live route state has `PocketNodePopoutEditor.open`, but does not have `PocketPeEditor.open`, `PocketPeEditor.apply`, or `openPocketPeEditor`.
- `PocketPeEditor.version` is currently `PE route minimal stub v1`, so the loaded route appears to be a paused stub rather than a functional PE bridge.

Suggested next step: stop further pruning. Add a small named bridge or dormant owner file, following the intentional-change workflow, to restore the canonical PE open/apply route before any more load-order pruning.
