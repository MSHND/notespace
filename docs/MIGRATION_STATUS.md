# Pocket migration status

Phase: planning, stabilisation, and two safe load-order prunes complete.

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
- Second safe prune passed: `index.html` no longer loads `js/pocket-pe-simple-standalone.js`.
- Both pruned files still exist in the repo and have not been deleted.
- `npm run check` passes after both safe prunes.

Next move: smoke test Pocket in the browser before deleting files or pruning further.
