# Next local action

Read `AGENTS.md` first.

Purpose: verify the first safe prune.

Expected state:

- `index.html` no longer loads `js/pocket-enter-preflight.js`.
- `js/pocket-enter-preflight.js` still exists.
- `npm run check` passes.

Local steps:

1. Check the git diff.
2. Run `npm run check`.
3. Update `docs/CODEX_REPORT.md` with results.

Do not delete files or change PE/editor behaviour in this step.
