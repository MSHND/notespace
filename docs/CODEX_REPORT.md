# Codex report

Status: PE conflict-preservation diagnostic/preview implemented. No `node.pe.legacyDetails` app writes yet.

Files changed:

- `tools/pocket-check.js`
- `docs/CODEX_REPORT.md`

What changed:

- Extended `tools/pocket-check.js` to preview conflict preservation when `POCKET_CHECK_DATA` points to an export JSON.
- Conflict preview applies only when `node.details` and `node.pe.text` both exist, are meaningful, and differ.
- The preview reports ids, labels, counts, field presence, and pass/fail/warn only.
- It does not print private body/detail text and does not modify the supplied export file.

Truth-file diagnostic result:

- Conflict preservation count: 2
- Conflict nodes: `w` / `Work (CoA)`; `node_mpor798l_rxdyhx3` / `Phone`
- Would receive `node.pe.legacyDetails`: 2
- `node.pe.text` unchanged: 2
- `node.details` retained: 2
- `node.pe.text` overwritten: 0
- `node.details` dropped: 0
- `Phone` target preview: `pe.legacyDetails` missing before, present after preview; `pe.text` present; `details` retained.
- `Work (CoA)` target preview: `pe.legacyDetails` missing before, present after preview; `pe.text` present; `details` retained.
- Details-only migration preview still reports `node_mq4snlc7_t5ku2wm` / `Francesca POs` upgrading from details-only to `pe.text`.
- `w4_68` / `Electricity` outline diagnostic still runs; this export has no outline source on `w4_68`.
- Local truth file was verified unchanged and was not committed.

Checks run:

- `node --check tools/pocket-check.js` using bundled Node - passed
- `node tools/pocket-check.js` using bundled Node in scratch harness - passed with expected no-fixture warning
- `POCKET_CHECK_DATA=<local truth file> node tools/pocket-check.js` using bundled Node - passed

Result:

- Diagnostic-only conflict preview is complete.
- App runtime behaviour, popup styling, script order, save/apply plumbing, `node.pe.legacyDetails` writes, `node.pe.text`, and `node.details` were not changed.
