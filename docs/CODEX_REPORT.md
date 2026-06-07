# Codex report

Status: PE popup in-app unsaved-close dialog restored.

Cause:

- `js/pocket-node-popout-editor.js` owns the current PE popup DOM and its popup-local Save, close, dirty, keydown, and `beforeunload` handlers.
- The previous close/Escape path used a simple browser `confirm()` prompt.
- That made in-app PE close/Escape warn, but it could only offer OK/Cancel, not the earlier human-friendly three-choice flow.
- Browser/window chrome close still uses the browser-controlled `beforeunload` warning and does not try to customise browser warning text.

Files inspected:

- `js/pocket-node-popout-editor.js`
- `js/pocket-editor-human-close.js`
- `js/pocket-pe-save-dirty.js`
- `js/pocket-detail-dirty.js`

Files changed:

- `js/pocket-node-popout-editor.js`
- `docs/CODEX_REPORT.md`

Diff summary:

- Added a small in-app unsaved-changes dialog to the generated PE popup HTML.
- Added three choices:
  - `Save`
  - `Exit without saving`
  - `Go back to editing`
- Wired `Save` to the existing PE `save()` handler, so it applies changes and closes on success.
- Wired `Exit without saving` to close the popup without applying the dirty PE draft.
- Wired `Go back to editing` and Escape while the dialog is open to hide the dialog and keep the dirty draft intact.
- Kept Cmd+S/Ctrl+S and Cmd/Ctrl+Enter save behaviour.
- Left browser/window close on the default `beforeunload` warning.
- No title/node label plumbing changes.
- No `node.details`/`node.pe.text` migration.
- No script pruning or file deletion.

Check results:

```text
$ node --check js/pocket-node-popout-editor.js
# passed with no output
```

```text
$ node <generated popup script syntax probe>
[node popout editor] opened { id: 'node_1', title: 'Probe' }
{"generatedPopupScriptSyntax":"ok","hasDialog":true,"htmlLength":13710}
```

```text
$ npm run check

> check
> node tools/pocket-check.js

Pocket check v1
ok   index.html - ends with </html>
ok   script tags - 46
ok   enter handlers - no duplicate known pair detected
ok   js/pocket-node-editor-route.js - ends with })(window);
ok   js/boot/pocket-load-manifest.js - exists
ok   js/boot/pocket-boot.js - exists
ok   js/commands/pocket-command-router.js - exists
ok   docs/PIPEWORK_RULE.md - exists
Pocket check passed
```

Manual retest steps:

1. Hard refresh Pocket.
2. Open PE/item details for a normal node.
3. Type a harmless body edit.
4. Press Escape and confirm the custom three-choice dialog appears.
5. Choose `Go back to editing` and confirm the popup stays open with the edit intact.
6. Press Escape again, choose `Exit without saving`, reopen PE, and confirm the unsaved edit was not applied.
7. Type another body edit, press Escape, choose `Save`, and confirm PE closes and the edit persists after reopening.
8. Repeat with the in-app popup close button.
9. Confirm Cmd+S/Ctrl+S still behaves like Save.
10. Optionally close the browser/window chrome directly and confirm the browser/default warning still appears for unsaved changes.

Concerns:

- Browser/window chrome close cannot show the custom three-choice dialog. It remains browser-controlled by design.
- `js/pocket-editor-human-close.js` still targets the old `pocketStandalonePe` window name, so the current `pocketNodePopoutEditor` window owns this dialog directly.

Next recommendation:

Repeat the manual retest above. If it passes, leave the current PE owner alone and only revisit stale helper scripts in a separate cleanup task.
