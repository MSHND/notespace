# Codex report

Status: PE migration plan updated with live-export inventory and legacy `node.details` protection. No migration implemented.

Files changed:

- `docs/CODEX_REPORT.md` only

Live export confirmation:

- Source used locally for counts only: `pocket-data.json`; export file was not committed.
- Total nodes: 734
- Nodes with `node.pe`: 195
- Nodes with `node.details`: 191
- Nodes with both `node.pe` and `node.details`: 190
- Details-only nodes: 1
- PE-only nodes: 5
- Nodes with `node.editor`: 0
- Matching `details` / `pe.text` pairs: 188
- Conflicting `details` / `pe.text` pairs: 2

Required migration test cases:

- Details-only: `node_mq4snlc7_t5ku2wm` / `Francesca POs`
- Conflict: `w` / `Work (CoA)`
- Conflict: `node_mpor798l_rxdyhx3` / `Phone`
- Historical outline risk: `w4_68` / `Electricity`

`w4_68` live-export shape:

- `w4_68` exists.
- It has no `details`, no `pe`, and no `editor` in this export.
- It has 15 direct children; 8 direct children have `details`, and 9 direct children have `pe`.
- Treat `w4_68` as a historical large-outline preservation risk, but this export does not contain a large outline on `w4_68`.

Compatibility rules:

- Treat `node.details` as legacy body data requiring protection.
- If `node.pe.text` is meaningful, prefer it as canonical PE body.
- If `node.pe.text` is empty or missing and `node.details` exists, migrate `details` into `node.pe.text`.
- If both exist and differ, preserve both; do not silently overwrite either field.
- Add a pre-migration diagnostic/report for all `details` / `pe.text` conflicts before destructive cleanup.
- Keep `node.details` during the initial migration; remove legacy fields only after round-trip tests pass.

First implementation step:

- Add diagnostics that count `pe` / `details` / `editor` shape and list conflict ids/labels.
- Include the details-only node, both conflict nodes, and `w4_68` in migration checks.
- Do not add canonical migration writes yet.

Result:

- Report-only update completed.
- App runtime behaviour, popup styling, script order, save/apply plumbing, and private export data were not changed.
