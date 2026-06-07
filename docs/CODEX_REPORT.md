# Codex report

Status: First PE node popout template extraction completed.

Files changed:

- `js/pocket-node-popout-template.js`
- `js/pocket-node-popout-editor.js`
- `index.html`
- `docs/CODEX_REPORT.md`

What changed:

- Added `window.PocketNodePopoutTemplate.render(payload, helpers)`.
- Moved the PE popup document shell, markup, and CSS out of `js/pocket-node-popout-editor.js`.
- Kept the popup runtime script in `js/pocket-node-popout-editor.js`.
- Kept `PocketNodePopoutEditor.open/apply` owned by `js/pocket-node-popout-editor.js`.
- Added `js/pocket-node-popout-template.js` immediately before `js/pocket-node-popout-editor.js` in `index.html`.
- Did not change save/apply plumbing.
- Did not change title/node label plumbing.
- Did not migrate `node.details` or `node.pe.text`.
- Did not extract popup runtime or outline runtime.

Checks run:

```text
$ node --check js/pocket-node-popout-template.js
# passed with no output
```

```text
$ node --check js/pocket-node-popout-editor.js
# passed with no output
```

```text
$ node <generated popup script syntax probe>
[node popout editor] opened { id: 'node_1', title: 'Probe' }
{"generatedPopupScriptSyntax":"ok","templateRender":"ok","inlineScripts":1,"htmlLength":13827}
```

```text
$ node <old/new generated runtime comparison>
[node popout editor] opened { id: 'node_1', title: 'Probe' }
[node popout editor] opened { id: 'node_1', title: 'Probe' }
{"runtimeSameAfterTimestampNeutralise":true}
```

```text
$ npm run check

> check
> node tools/pocket-check.js

Pocket check v1
ok   index.html - ends with </html>
ok   script tags - 47
ok   enter handlers - no duplicate known pair detected
ok   js/pocket-node-editor-route.js - ends with })(window);
ok   js/boot/pocket-load-manifest.js - exists
ok   js/boot/pocket-boot.js - exists
ok   js/commands/pocket-command-router.js - exists
ok   docs/PIPEWORK_RULE.md - exists
Pocket check passed
```

Result:

- Passed.

Manual retest steps for Murray:

1. Hard refresh Pocket.
2. Open PE/item details for a normal node.
3. Confirm the popup opens with the same layout and visible top-right close `X`.
4. Type a harmless body edit and click `save`; reopen PE and confirm the edit persists.
5. Type another edit and press Cmd+S/Ctrl+S; reopen PE and confirm the edit persists.
6. Type another unsaved edit and press Escape; confirm the three-button in-app warning appears.
7. Confirm `Go back to editing` keeps the popup open with edits intact.
8. Confirm `Exit without saving` closes without applying the draft.
9. Confirm `Save` in the warning saves and closes.
