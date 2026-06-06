# Pocket migration status

Phase: planning, stabilisation, and first safe prune complete.

Known state:

- `js/pocket-node-editor-route.js` is a minimal valid stub.
- PE route functional rebuild is paused.
- Older editor and PE scripts may still be loaded.
- `node.label` is the intended title source of truth.
- `node.pe` is intended native item-details metadata.
- `js/commands/pocket-command-router.js` exists as a dormant future owner for command behaviour.
- `tools/pocket-check.js` exists as a read-only repo health check.
- `tools/pocket-mod-index.js` exists as a narrow index.html mod tool.
- `AGENTS.md` gives agent/Codex instructions for safe repo work.
- First safe prune passed: `index.html` no longer loads `js/pocket-enter-preflight.js`.
- `js/pocket-enter-preflight.js` still exists in the repo and has not been deleted.
- `npm run check` passes after the first safe prune.

Next move: name one small cleanup or dormant-owner step, write it into `docs/CODEX_NEXT.md`, let Codex act locally, then review `docs/CODEX_REPORT.md`.
