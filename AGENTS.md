# Agent instructions

This repo uses a cautious, intentional change pipeline.

Core rule:

New behaviour should be added through small, named, dormant files first. Existing large files should only be touched when the replacement structure is already in place. Every write must be verified by read-back before moving on.

Before changing behaviour:

1. Read `docs/PIPEWORK_RULE.md`.
2. Read `docs/REFACTOR_PIPELINE.md`.
3. Check `docs/MIGRATION_STATUS.md`.
4. Prefer small new files over large rewrites.
5. Avoid full replacements of `index.html`.
6. Do not add wrapper patches unless there is no safer option.

Useful tools:

- `node tools/pocket-check.js`
- `node tools/pocket-mod-index.js remove-script js/pocket-enter-preflight.js`

Current architecture direction:

- `index.html` should eventually become a small shell.
- Boot order should move toward `js/boot/`.
- Command behaviour should move toward `js/commands/pocket-command-router.js`.
- PE/item-details behaviour should have one canonical owner.
- Legacy files are temporary and should be retired only after replacements pass tests.

If a file becomes truncated or broken, stop feature work and repair it first.
