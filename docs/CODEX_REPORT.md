# Codex report

Status: PE large-outline diagnostic added before data model migration. No migration implemented.

Files changed:

- `tools/pocket-check.js`
- `docs/CODEX_REPORT.md`

What changed:

- Extended `tools/pocket-check.js` with a read-only `w4_68` PE outline preservation diagnostic.
- The check scans `POCKET_CHECK_DATA` plus common sample/fixture JSON locations.
- It reports whether `w4_68` exists, outline source found, raw outline count, count after the current 400-block editor normalisation path, and whether the count shrinks.
- It fails when current normalisation would shrink available outline data.
- It warns clearly when no checked-in or supplied fixture is available.

Current fixture status:

- GitHub code search found no checked-in `w4_68` fixture in the repo.
- Without a fixture, the check warns: set `POCKET_CHECK_DATA=path/to/export.json` to supply data later.

Checks run:

- `node --check tools/pocket-check.js` - passed in scratch harness using bundled Node.
- `node tools/pocket-check.js` - passed in scratch harness with no fixture; emitted the expected no-fixture warning.
- Synthetic `POCKET_CHECK_DATA` fixture with 401 `node.editor.outline` blocks - failed as expected with shrink `401 -> 400`.

Result:

- Protection step is in check tooling only.
- PE runtime behaviour, popup styling, script order, canonical `node.pe` writes, and app save/apply plumbing were not changed.
