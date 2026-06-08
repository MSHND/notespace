# Codex report

Status: first PE migration diagnostic step implemented. No canonical migration writes were added.

Files changed:

- `tools/pocket-check.js`
- `docs/CODEX_REPORT.md`

What changed:

- Extended `tools/pocket-check.js` so `POCKET_CHECK_DATA=path/to/export.json` reports PE/data shape inventory.
- The diagnostic prints counts, node ids, labels, and field presence only.
- It does not print private `details` or `pe.text` body content.
- Conflicting `details` / `pe.text` pairs warn only; invalid input and shrinking outline checks still fail.

Live export result:

- Total nodes: 734
- Nodes with `node.pe`: 195
- Nodes with `node.details`: 191
- Nodes with both `node.pe` and `node.details`: 190
- Details-only nodes: 1
- PE-only nodes: 5
- Nodes with `node.editor`: 0
- Matching `details` / `pe.text` pairs: 188
- Conflicting `details` / `pe.text` pairs: 2
- Conflict nodes: `w` / `Work (CoA)`; `node_mpor798l_rxdyhx3` / `Phone`

Required target checks:

- `node_mq4snlc7_t5ku2wm` / `Francesca POs`: details yes, pe no, editor no
- `w` / `Work (CoA)`: details yes, pe yes, editor no
- `node_mpor798l_rxdyhx3` / `Phone`: details yes, pe yes, editor no
- `w4_68` / `Electricity`: details no, pe no, editor no

Checks run:

- `node --check tools/pocket-check.js` using bundled Node - passed
- `node tools/pocket-check.js` using bundled Node in scratch harness - passed with the existing no-fixture warning
- `POCKET_CHECK_DATA=<local pocket-data.json> node tools/pocket-check.js` using bundled Node - passed; conflicts reported as warnings

Result:

- Diagnostic-only change completed.
- Private live export was not committed.
- App runtime behaviour, popup styling, script order, save/apply plumbing, canonical `node.pe` writes, and `node.details` cleanup were not changed.
