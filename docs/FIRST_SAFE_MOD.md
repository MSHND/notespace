# First safe mod

Remove the duplicate early Enter handler using repo-local tooling.

Target: `js/pocket-enter-preflight.js`

Run:

```bash
npm run check
npm run mod:dry-remove-enter-preflight
npm run mod:remove-enter-preflight
npm run check
```

Notes:

- The first check may fail because both Enter handlers are loaded.
- The dry run must report that it would remove the target script.
- The final check should pass or clearly report the next issue.
- If anything looks wrong, stop and repair before continuing.
