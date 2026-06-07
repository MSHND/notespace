# Codex report

Status: PE popup button/save wiring inspected; one tiny generated-script fix applied.

Likely cause:

- `js/pocket-node-popout-editor.js` creates the current PE/item-details popup DOM.
- Its popup script is generated inside an outer template literal.
- Inside that generated script, `textToOutline()` and `outlineToText()` used `"\n"` in string literals.
- In an outer template literal, those become literal newlines in the popup script source, leaving invalid JavaScript like a quoted string split across lines.
- Result: the popup opened visually, but its inline script failed before binding Save, close, mode, dirty, and `beforeunload` handlers. That matches the manual result: buttons did not work, typed body text was lost, and no unsaved warning appeared.

Ownership findings:

- Popup DOM creator: `js/pocket-node-popout-editor.js`.
- Current popup Save / close / dirty / apply owner: `js/pocket-node-popout-editor.js`.
- Bridge owner: `js/pocket-pe-node-popout-bridge.js`, which delegates `PocketPeEditor.open/apply` to `PocketNodePopoutEditor.open/apply`.
- Dirty/save wrapper: `js/pocket-pe-save-dirty.js`, which wraps `PocketPeEditor.apply` after the bridge is loaded.
- Inline detail dirty owner: `js/pocket-detail-dirty.js`, for the old inline detail overlay only.
- Human-close helper: `js/pocket-editor-human-close.js`, still looks for the old `pocketStandalonePe` window name and does not attach to the new `pocketNodePopoutEditor` window.

Other inspection notes:

- `PocketNodePopoutEditor.apply(payload)` accepts the bridge payload shape `{ id, title, body, mode, outline, updatedAt }`.
- `PocketNodePopoutEditor.apply()` currently writes body text to `node.details`, not `node.pe.text`.
- The bridge does not appear to be sending the wrong payload shape.
- The popup script calls `window.opener.PocketNodePopoutEditor.apply(...)`, so it should be able to reach the needed opener function once the inline script parses and binds.
- Several older helper scripts still target old PE/window contracts:
  - `pocketStandalonePe`
  - `pocketSimplePe_*`
  - `#title`
  - `#text`
  - `.bar`
  - `.outlineInput`
- Those old helper mismatches explain why extra helper warnings/guards may not attach, but the immediate "all buttons dead" symptom is best explained by the generated inline script parse failure.

Files inspected:

- `AGENTS.md`
- `docs/PIPEWORK_RULE.md`
- `docs/REFACTOR_PIPELINE.md`
- `docs/MIGRATION_STATUS.md`
- `js/pocket-node-popout-editor.js`
- `js/pocket-pe-node-popout-bridge.js`
- `js/pocket-pe-save-dirty.js`
- `js/pocket-detail-dirty.js`
- `js/pocket-editor-human-close.js`
- `js/pocket-enter-copy-only.js`
- `js/pocket-pe-esc-close.js`
- `js/pocket-editor-popout.js`
- `js/pocket-editor-popout-v2.js`
- `js/pocket-editor-popout-default.js`
- `js/pocket-editor-popout-fresh.js`

Files changed:

- `js/pocket-node-popout-editor.js`
- `docs/CODEX_REPORT.md`

Diff summary:

- Changed generated popup script newline literals from `"\n"` to `"\\n"` in:
  - `textToOutline()`
  - `outlineToText()`
- No title-source change.
- No file deletes.
- No script pruning.
- No wrapper patch.
- No data model change.

Check results:

```text
$ node --check js/pocket-node-popout-editor.js
# passed with no output
```

```text
$ node <generated popup script syntax probe>
[node popout editor] opened { id: 'node_1', title: 'Probe' }
{
  "generatedPopupScriptSyntax": "ok",
  "htmlLength": 11145
}
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

Manual test to repeat:

1. Hard refresh Pocket.
2. Select a normal node.
3. Open PE/item details.
4. Type a harmless body edit.
5. Confirm the dirty marker appears.
6. Click Save.
7. Reopen the same node and confirm the body edit persists.
8. Repeat with an unsaved body edit, then close with the popup X or Escape and confirm the unsaved-change prompt appears.

Concerns:

- `PocketNodePopoutEditor.apply()` still writes to `node.details`, not `node.pe.text`. That is a data-model migration question and was not changed here.
- Older PE helper scripts still target old popup names/DOM. They may be dead plumbing now, but should not be pruned until the new owner passes manual testing.
- `js/pocket-editor-human-close.js` does not attach to the current `pocketNodePopoutEditor` window name. The node popout's own close and `beforeunload` handlers should now work after the parse fix, so this was left alone.

Next recommendation:

Repeat the manual PE save/dirty test. If it passes, the next small step should be to retire or adapt stale helper expectations only after deciding whether `PocketNodePopoutEditor` is the canonical PE owner.
