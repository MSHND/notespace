# Pocket migration status

Phase: planning and stabilisation.

Known state:

- `js/pocket-node-editor-route.js` is a minimal valid stub.
- PE route functional rebuild is paused.
- Older editor and PE scripts may still be loaded.
- `node.label` is the intended title source of truth.
- `node.pe` is intended native item-details metadata.

Next move: rebuild the PE route as the canonical owner, then retire replaced wrappers after tests pass.
