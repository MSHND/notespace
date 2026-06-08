# Codex report

Status: report-only PE data model migration plan. No migration implemented.

Files changed:

- `docs/CODEX_REPORT.md` only

Current PE open/apply flow:

- `PocketNodePopoutEditor.open()` resolves a node, builds a popup payload, renders the template, and injects runtime script.
- `payloadFromNode(node)` currently reads `node.label`, `node.details`, and normalized `node.editor`.
- `PocketNodePopoutRuntime.build(...)` keeps local dirty/mode state and sends `{ id, title, body, mode, outline, updatedAt }` back to `PocketNodePopoutEditor.apply(...)`.
- `apply(payload)` compares legacy fields, writes back to the node, refreshes the tree/meta, saves workspace state, and persists the PIP snapshot.

Current field map:

- title: reads/writes `node.label`.
- body: reads/writes `node.details` through `normaliseDetailsSafe(..., 4000)`.
- outline: reads/writes `node.editor.outline` through `normaliseEditorMeta(...)`.
- mode: reads/writes `node.editor.mode`; non-outline mode removes `node.editor`.
- risk note: `normaliseEditorMeta(...)` currently slices outlines to 400 blocks, which is unsafe for `w4_68` at about 866 lines.

Safest target canonical flow:

- Keep the runtime payload shape unchanged for the first migration.
- Change only editor-side mapping first: payload title still maps to `node.label`; body maps to `node.pe.text`; outline maps to `node.pe.outline`; mode maps to `node.pe.mode`; PE timestamp maps to `node.pe.updatedAt`.
- Preserve `node.updatedAt` as the app-level modified timestamp.
- Update `node.pe` atomically, preserving unrelated existing `node.pe` keys.
- Do not delete legacy `node.details` or `node.editor` in the first canonical write pass.

Compatibility/fallback rules:

- body open order: `node.pe.text` string, else `node.details`, else empty string.
- outline open order: valid `node.pe.outline`, else valid `node.editor.outline`, else `null`.
- mode open order: valid `node.pe.mode`, else valid legacy outline mode, else `outline` when meaningful outline data exists, else `text`.
- title remains `node.label` only.
- import/export/normalisation must preserve `node.pe` verbatim enough to keep text, outline, mode, and updatedAt.

Large-outline preservation risks:

- Any 400-block cap in PE outline normalisation will truncate `w4_68`.
- Text/body limits must not be reused for structured outline arrays.
- Text-mode saves must not replace or clear an existing large `node.pe.outline` unless the user intentionally edits outline data.
- Legacy fallback must not copy truncated `node.editor.outline` over a larger `node.pe.outline`.

Proposed diagnostics/tests:

- Add a targeted fixture or repo data probe for `w4_68` at `Work (CoA) -> Reference -> Meter Info -> Electricity`.
- Assert expected outline count is about 866 before open, after payload build, after save-and-stay-open, and after Save & close.
- Add round-trip checks for `node.pe.text`, `node.pe.outline`, `node.pe.mode`, and `node.pe.updatedAt` through save, export, import, and normalisation.
- Add a guard test that fails if PE outline length shrinks unexpectedly.

First smallest implementation step:

- Add editor-only PE helpers in `js/pocket-node-popout-editor.js` to read canonical PE with legacy fallback and to build canonical `node.pe` from the existing runtime payload.
- First change should be covered by a `w4_68` round-trip diagnostic before enabling canonical writes broadly.

Files likely to need changes:

- `js/pocket-node-popout-editor.js`
- data normalisation/import/export owner files, once identified for `node.pe` preservation
- targeted diagnostics/check tooling for the `w4_68` round trip
- `docs/CODEX_REPORT.md`

Result:

- Report-only plan completed; popup runtime, styling, script order, and save behaviour were not changed.
