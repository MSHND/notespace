# Codex report

Status: report-only editor/PE load-order inspection complete

Check result:

```text
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

Editor/PE-related scripts found:

```text
03 js/pocket-editor-metadata.js
04 js/pocket-pe-import-preserve.js
07 js/pocket-editor-copy.js
08 js/pocket-editor-joy.js
13 js/pocket-filter-pe-search.js
20 js/pocket-detail-drag.js
21 js/pocket-editor-popout-source-lock.js
22 js/pocket-editor-popout.js
23 js/pocket-editor-popout-v2.js
24 js/pocket-editor-popout-node-guard.js
25 js/pocket-editor-popout-fresh.js
27 js/pocket-detail-dirty.js
28 js/pocket-editor-handoff.js
29 js/pocket-editor-rebase.js
30 js/pocket-editor-conflict.js
31 js/pocket-editor-test-loop.js
32 js/pocket-editor-save-ack.js
33 js/pocket-editor-visual-sync.js
34 js/pocket-editor-popout-default.js
40 js/pocket-node-popout-editor.js
41 js/pocket-editor-cutover-v3.js
42 js/pocket-node-editor-route.js
43 js/pocket-pe-save-dirty.js
44 js/pocket-editor-human-close.js
45 js/pocket-pe-simple-standalone.js
46 js/pocket-enter-copy-only.js
```

Likely legacy or duplicate files:

- `js/pocket-pe-simple-standalone.js` is the clearest cleanup candidate. Its header says `Retired PE override`, and it intentionally does not override `PocketPeEditor` or `openPocketPeEditor`.
- `js/pocket-editor-cutover-v3.js` is a transition file. Its header says the old inline/details popout path is kept only as a fallback.
- The popout/editor stack has several layered transition or guard files: `js/pocket-editor-popout.js`, `js/pocket-editor-popout-v2.js`, `js/pocket-editor-popout-node-guard.js`, `js/pocket-editor-popout-fresh.js`, `js/pocket-editor-popout-default.js`, `js/pocket-node-popout-editor.js`, `js/pocket-editor-handoff.js`, `js/pocket-editor-rebase.js`, `js/pocket-editor-conflict.js`, `js/pocket-editor-save-ack.js`, and `js/pocket-editor-visual-sync.js`.
- `js/pocket-filter-pe-search.js` describes itself as a wrapper to extend search into newer `node.pe` text.
- `js/pocket-node-editor-route.js` is not a cleanup target yet. It is a minimal valid stub and says the functional rebuild is paused.

Suggested next cleanup step:

- Make the next safe cleanup a load-order prune only for `js/pocket-pe-simple-standalone.js`.
- Do it through repo-local tooling, with a dry run first, just like the Enter preflight prune.
- Do not delete `js/pocket-pe-simple-standalone.js` in that step; only remove its script tag from `index.html` after a checker confirms the file is loaded, retired, and non-owning.

Concerns:

- This was report-only. No app behaviour, `index.html`, files, or PE/editor scripts were changed.
- The editor/PE area still has multiple active transition layers, so broad pruning would be risky.
- `js/pocket-node-editor-route.js` is still only a paused/minimal stub, so anything that changes actual editor ownership should wait for a named owner and manual test.
- Local inspection was performed in `/tmp/notespace-report-pe-20260606` because the declared local workspace path was not available in this environment.
