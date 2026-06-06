# First safe mod

Purpose: remove the duplicate early Enter handler from `index.html` using repo-local tooling, not a full-file rewrite.

Target script:

`js/pocket-enter-preflight.js`

Safe sequence:

```bash
npm run check
npm run mod:dry-remove-enter-preflight
npm run mod:remove-enter-preflight
npm run check
```

Expected before state:

- `npm run check` may fail because both Enter handlers are loaded.
- The dry run should say it would remove `js/pocket-enter-preflight.js`.

Expected after state:

- `index.html` still ends with `</html>`.
- `js