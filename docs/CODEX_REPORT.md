# Codex report

Status: report-only PE conflict-node preservation plan. No code changes in this pass.

Files changed:

- `docs/CODEX_REPORT.md` only

Problem:

- Conflict nodes have meaningful `node.details` and meaningful `node.pe.text` with different values.
- Known conflict tests: `node_mpor798l_rxdyhx3` / `Phone`; `w` / `Work (CoA)`.
- Manual correction: `Phone` has old inline editor content in `node.details` that must be preserved while current PE content in `node.pe.text` also remains primary.

Safest strategy:

- Never let either conflict side win silently.
- Keep `node.pe.text` as the canonical current PE body.
- Preserve conflicting legacy `node.details` in a structured PE field before any legacy cleanup.
- Keep `node.details` during initial migration and through round-trip tests.

Options compared:

- Append legacy details into `pe.text`: human-visible and searchable, but mixes old/current content and risks making the PE body confusing.
- Store legacy details in `node.pe.legacyDetails`: preserves both fields cleanly, keeps current PE text smooth, and makes protection explicit under the hood.
- Keep `node.details` indefinitely only: safest short term, but leaves migration incomplete and keeps old ambiguity alive.

Recommendation:

- Use `node.pe.legacyDetails` for conflict preservation.
- Keep `node.pe.text` unchanged and primary.
- Keep `node.details` unchanged until later cleanup is separately tested and approved.
- This best fits “human and smooth on the surface, trustworthy under the hood”: users see current PE content normally, while legacy inline content is retained in an auditable field.

Expected conflict shape:

- `Phone`: `node.pe.text` unchanged; `node.pe.legacyDetails` populated from existing `node.details`; `node.details` retained; no body text printed in diagnostics.
- `Work (CoA)`: handle by the same rule if still conflicting; preserve both fields without guessing which content is more important.

Diagnostics/tests needed:

- Count conflict nodes before and after the preservation path.
- List conflict ids/labels only.
- Confirm `pe.text` is not overwritten for `Phone` or `Work (CoA)`.
- Confirm `node.details` is retained for conflict nodes.
- Confirm `node.pe.legacyDetails` would be populated only when `details` and `pe.text` both exist and differ.
- Confirm details-only migration still works for missing-`pe` nodes.
- Confirm `w4_68` outline preservation diagnostic still runs.
- Confirm supplied truth/export file remains unchanged during diagnostics.

First smallest implementation step:

- Extend `tools/pocket-check.js` with a conflict-preservation preview: would-populate `node.pe.legacyDetails`, overwritten `pe.text` count, retained `details` count, and target checks for `Phone` and `Work (CoA)`.
- After that passes, add one small normalisation helper that sets `node.pe.legacyDetails` only for conflict nodes and leaves `node.pe.text` and `node.details` untouched.

Do not do in the conflict step:

- Do not overwrite `node.pe.text`.
- Do not delete `node.details`.
- Do not append legacy text into current PE body.
- Do not change popup runtime, styling, script order, or save/apply plumbing.
