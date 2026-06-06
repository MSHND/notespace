# Pocket migration status

Phase: planning and stabilisation.

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

Next move: build new dormant owners first, then wire behaviour only after the replacement structure exists.
