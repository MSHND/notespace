# Next local action

Read the repo-level `AGENTS.md` first.

Purpose: apply one safe load-order prune for the retired PE simple standalone loader.

Target: `js/pocket-pe-simple-standalone.js`

Important limits:

- Do not delete the file.
- Do not modify PE/editor scripts.
- Do not make unrelated changes.
- Use the repo-local mod tool. Do not manually rewrite `index.html`.

Local steps:

1. Run `npm run check`.
2. Run `node tools/pocket-mod-index.js remove-script js/pocket-pe-simple-standalone.js --dry-run`.
3. If the dry run is sensible, run `node tools/pocket-mod-index.js remove-script js/pocket-pe-simple-standalone.js`.
4. Run `npm run check` again.
5. Update `docs/CODEX_REPORT.md` with results.

Expected result:

- `index.html` no longer loads `js/pocket-pe-simple-standalone.js`.
- `js/pocket-pe-simple-standalone.js` still exists.
- `npm run check` passes.

Stop if anything looks wrong.
