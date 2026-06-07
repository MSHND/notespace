# Codex report

Status: PE popup Cmd+S/Ctrl+S and in-app unsaved warning fixed.

Cause:

- `js/pocket-node-popout-editor.js` owns the current PE popup DOM and the popup-local Save, close, dirty, keydown, and `beforeunload` handlers.
- Save button worked because it called the local `save()` handler directly.
- Cmd+S/Ctrl+S did not save because the popup keydown handler only routed Cmd/Ctrl+Enter to `save()`.
- In-app close/Escape used a short fallback prompt (`Close without saving?`) instead of the existing human-close warning wording.
- The browser-level `beforeunload` guard was also setting custom text. Modern browsers ignore that text, so the guard now uses an empty return value and leaves wording to the browser.

Files inspected:

- `js/pocket-node-popout-editor.js`
- `js/pocket-editor-human-close.js`

Files changed:

- `js/pocket-node-popout-editor.js`
- `docs/CODEX_REPORT.md`

Diff summary:

- Added the existing human-close prompt wording to the generated PE popup script.
- Changed in-app close/Escape to use that prompt before calling `window.close()`.
- Added Cmd+S/Ctrl+S to the popup keydown handler, routed to the same `save()` function as the Save button.
- Left Cmd/Ctrl+Enter save behaviour in place.
- Changed `beforeunload` to keep the browser-level guard without trying to customise its text.
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
{"generatedPopupScriptSyntax":"ok","htmlLength":11226}
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
4. Press Cmd+S on macOS or Ctrl+S on Windows/Linux.
5. Confirm it behaves exactly like clicking Save and the body edit persists after reopening PE.
6. Type another unsaved body edit.
7. Press Escape and confirm the custom unsaved prompt appears before any browser-level warning.
8. Repeat with the in-app popup close button.
9. Optionally close the browser/window chrome directly and confirm the browser/default warning still appears for unsaved changes.

Concerns:

- Browser/window chrome close cannot use custom text. That remains browser-controlled by design.
- `js/pocket-editor-human-close.js` still targets the old `pocketStandalonePe` window name. The current `pocketNodePopoutEditor` window owns its in-app close handling directly, so no wrapper was added here.

Next recommendation:

Repeat the manual retest above. If it passes, leave the current PE owner alone and only revisit stale helper scripts when there is a separate cleanup task.
