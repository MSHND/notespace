# Codex report

## POCKET TASK P010

Title: Specify and test the current PE persistence contract

Status: production-neutral characterisation suite and durable contract completed against current `origin/main`.

Commit title:

- `P010 Specify PE persistence contract`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Expected and confirmed starting `origin/main`: `1b74ff1efaf857b0fd40ede400c9ae7933a97461`
- Starting commit: `P009 Audit PE data model migration`
- Murray had accepted P009 before this task.
- `git fetch origin` found no commits newer than the expected P009 baseline.
- Local `main` matched `origin/main`, and the working tree was clean before P010.
- No personal or active Pocket truth file outside the repository was inspected.

### Outcome

P010 adds an executable baseline for the current PE persistence contract without changing production behaviour.

The durable contract is:

- `docs/PE_PERSISTENCE_CONTRACT.md`

It separates:

- intended stable behaviour;
- current compatibility behaviour;
- explicitly named CURRENT-RISK characterisation behaviour;
- unsupported or unknown input states; and
- future desired behaviour that P010 does not implement.

No current truth-file migration occurred. Every known weakness tested by P010 remains present in production after this task.

### Files changed

Added:

- `docs/PE_PERSISTENCE_CONTRACT.md`
- `tests/pe-persistence-contract.test.js`
- `tests/fixtures/pe-persistence/legacy-text.json`
- `tests/fixtures/pe-persistence/current-outline-v1.json`
- `tests/fixtures/pe-persistence/empty-text.json`
- `tests/fixtures/pe-persistence/malformed-editor.json`
- `tests/fixtures/pe-persistence/unknown-editor-schema.json`
- `tests/fixtures/pe-persistence/root-precedence.json`

Updated:

- `docs/CODEX_REPORT.md`

No helper file was necessary. No production JavaScript, HTML, CSS, runtime configuration, production JSON example, dependency or package script changed.

### Fixture inventory

- `legacy-text.json`: ordinary indented Text with no `editor` or `pe`.
- `current-outline-v1.json`: small native v1 Outline with stable IDs, nested depth, collapse and deliberate details drift.
- `empty-text.json`: whitespace-only details.
- `malformed-editor.json`: small v1-labelled editor object with a non-array Outline.
- `unknown-editor-schema.json`: small future editor schema with Outline-like content and unknown fields.
- `root-precedence.json`: disagreeing top-level/nested trees, tombstones and synthetic root/data/node extras.

All fixtures are synthetic, parseable and below 5,000 characters. Large limit cases are generated in memory, so no oversized fixture was committed.

### Test harness design

The focused CommonJS test uses Node built-ins only:

- `node:test`
- `node:assert/strict`
- `node:fs`
- `node:path`
- `node:vm`

The harness:

- derives relevant classic-script order from actual `index.html`;
- executes actual repository source in fresh VM contexts;
- preserves the real top-level lexical `state` binding instead of masking it with `window.state`;
- exercises actual `normaliseDetails()`, extras normalisers, `normaliseInput()`, `applyLoadedState()`, `buildPocketPayload()`, PE model/target/editor functions, `recordOp()`, generated runtime and copy-context code;
- uses minimal DOM and `localStorage` shims;
- instruments `exportTree()`, `writeTruthFile()` and picker surfaces separately;
- uses only in-memory controlled export outcomes for `applyAndSave()`;
- creates no file handle;
- writes no temporary file;
- performs no network access; and
- exposes private generated-runtime parser functions only by modifying the returned program string in memory, then returning before DOM initialisation. The executed functions are the actual generated functions, not copied parser logic.

The generated empty-row test additionally invokes actual `renderOutline()` with a small in-memory element shim.

### Exact focused test result

Node version:

```text
v23.11.0
```

Command:

```sh
node --test tests/pe-persistence-contract.test.js
```

Result:

```text
tests 41
suites 0
pass 41
fail 0
cancelled 0
skipped 0
todo 0
```

The test file also passed:

```sh
node --check tests/pe-persistence-contract.test.js
```

### Exact CURRENT-RISK tests captured

1. `CURRENT-RISK: index load order leaves pocket-import.js as active normaliseNodes owner`
2. `CURRENT-RISK: editor and pe share the first-24 generic extras budget`
3. `CURRENT-RISK: active load drops editor metadata above the generic 8,000-character object cap`
4. `CURRENT-RISK: unknown Outline-like schema is accepted, rewritten as v1, and stripped of unknown fields`
5. `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
6. `CURRENT-RISK: Outline normalisation silently slices block 401`
7. `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
8. `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
9. `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
10. `CURRENT-RISK: small malformed and unknown editor objects survive load but PE interprets only their shape`
11. `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
12. `CURRENT-RISK: PE opening payload has no file-session or original-revision identity`
13. `CURRENT-RISK: Outline apply accepts independent details/editor content and silently enforces title/body limits`
14. `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`
15. `CURRENT-RISK: unchanged PE save cannot see lexical unsaved operations through window.state`

These are observations, not approved future policy. Later fixes should replace their expectations and names in the same task.

### Verified limits and behaviours

The actual-source suite confirms:

- final `normaliseNodes()` ownership belongs to `js/pocket-import.js` after current index load;
- simply restoring the intermediate editor-aware owner is insufficient because generic extras can overwrite its explicit editor value;
- node extras retain the first 24 accepted values;
- node-extra objects survive at `JSON.stringify(...).length === 8000` and are dropped at 8,001;
- root extras retain the first 32 accepted values, strings to 2,000 and objects to 12,000;
- details normalisation removes carriage returns, converts tabs, strips trailing and outer whitespace, collapses long blank runs, and slices at 4,000;
- current root precedence for export, MTT, sync, change snapshot, array and unknown shapes;
- small valid and exact-8,000 editor objects survive the active loader while 8,001 does not;
- active PE acceptance and rejection rules for Text, empty, flat, nested, blank, malformed and unknown-schema editor states;
- missing-ID creation, duplicate-ID retention, depth clamp/rounding, array order, unknown-field removal and collapse handling;
- 399/400/401 block and 3,999/4,000/4,001 block-text boundaries;
- current load-time `node.pe` synthesis and its later export effect;
- root guard, timestamp, dual-tree, tombstone, extras and clone behaviour;
- compact Text, empty, native Outline, malformed, unknown-schema, drift and extras round trips;
- PE opening payload keys and identity omissions;
- Outline and Text application, current caps, unchanged detection and operation recording;
- controlled success, cancellation, downloaded copy, throw and unavailable export results;
- the real lexical `state` versus `window.state` visibility gap;
- details-first copy context; and
- the shared P008 indentation parser and empty rendering fallback.

### Generated runtime result

`PocketNodePopoutRuntime.build()` returned programs that compiled with `new Function(...)` for:

- Text mode with `outline: null`;
- valid saved Outline mode; and
- a rejected/empty metadata state normalised to Text.

The actual generated parser passed:

- two-space hierarchy;
- four-space hierarchy;
- tabs;
- mixed tab/space indentation;
- common leading indentation;
- blank-line filtering;
- depth clamp;
- shared structured-paste base alignment; and
- Text to Outline to Text hierarchy with normalised two-space output.

Actual generated rendering supplied one fresh blank depth-0 uncollapsed row after empty/whitespace-only Text produced no parser blocks.

### No-write and production-neutral confirmation

- `applyLoadedState()` recorded no operation and invoked no truth export, truth writer or picker.
- Its observed writes were browser `localStorage` safety/workspace snapshots only.
- Controlled `applyAndSave()` tests invoked only an in-memory `exportTree()` stub.
- The `writeTruthFile()` and picker spies stayed at zero throughout.
- No `FileSystemFileHandle` or real truth file was created or opened.
- No personal Pocket truth file was read or written.
- No production file changed.
- `package.json` did not change.
- No dependency was added.
- No retired PE file was restored or modified.
- `node tools/pocket-check.js` was not run.
- `npm run check` was not run.

### Repository validation

The final validation set includes:

- `node --version`;
- `node --check tests/pe-persistence-contract.test.js`;
- `node --test tests/pe-persistence-contract.test.js`;
- `git diff --check`;
- `JSON.parse()` over every committed fixture;
- exact 19-section heading order verification;
- balanced Markdown fence verification for both changed documents;
- executable-to-documented matching for all 15 CURRENT-RISK test names;
- existence checks for every source file and named function in the contract evidence table;
- complete staged-diff and changed-path review;
- confirmation that `package.json`, `index.html` and `js/` have no diff;
- confirmation that no temporary artefact remains; and
- an independent read-only review that reproduced 41 passes and found no blocker.

### Remaining work for P011

P011 can now change load ownership against an executable baseline. It should, subject to its own approved prompt:

- establish one deliberate first-class node/editor load owner;
- reserve `editor` and `pe` from generic extras;
- exact-gate supported editor schemas;
- preserve unknown schemas opaquely;
- avoid read-time shape mutation and silent truth migration;
- preserve current small v1 Outline behaviour;
- decide how to retain `data` extras on `portal.export.v1` reload; and
- explicitly scope the lexical `state` access gap rather than casually exposing mutable state globally.

P010 does not approve or implement any of those fixes.

### Git identification

This report is included in the commit titled `P010 Specify PE persistence contract`. Its resulting SHA is not embedded in the same commit because adding that SHA would create a different commit. Completion is gated on pushing that commit to `origin/main`, fetching again, confirming local `main` and `origin/main` resolve to the same commit, and confirming the worktree is clean.

---

## POCKET TASK P009

Title: Audit the PE data model and design a safe migration path

Status: documentation-only architecture audit completed against current `origin/main`.

Commit title:

- `P009 Audit PE data model migration`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Expected and confirmed starting `origin/main`: `26b6937b54cdd0b383054b1b4fa607d5e159e33e`
- Starting commit: `P008 Fix PE text-to-outline indentation`
- P008 browser acceptance was supplied by Murray in the task.
- `git fetch origin` found no commits newer than the expected P008 baseline.
- Local `main` matched `origin/main`, and the working tree was clean before the audit.
- No personal Pocket truth file outside the repository was inspected.

### Audit scope

The audit traced the active routes for:

- JSON parse, root-shape recognition and node normalisation;
- state adoption and `nodeMap()`;
- node creation defaults;
- PE edit routing and payload construction;
- Text and Outline initialisation;
- Text-to-Outline and Outline-to-Text conversion;
- structured multiline paste;
- runtime save-payload construction;
- PE application, change detection and operation recording;
- truth-file export and active-file session protection;
- browser recovery, PiP, cache, last-save and Vault representations;
- stale-file checks;
- legacy popout fallback behaviour;
- search and details-first copy-context consumers; and
- repository fixtures and architecture documentation.

The current implementation was inspected directly rather than inferred from prior reports.

### Principal verified findings

#### The intended PE-aware load normaliser is not active

`index.html` loads, in this order:

1. `js/pocket-editor-metadata.js`
2. `js/pocket-pe-import-preserve.js`
3. `js/pocket-storage.js`
4. `js/pocket-import.js`

The first two scripts install editor-aware versions of `normaliseNodes()`. The later top-level declaration in `js/pocket-import.js` replaces them. An in-memory VM probe using the actual source order confirmed that the final owner is the generic importer.

`editor` and `pe` are not reserved core fields in `js/pocket-data.js`. They therefore pass through `normaliseNodeExtras()`, which allows at most 24 extras and only 8,000 serialised characters for an object value.

The probe confirmed:

- a small unknown editor object survived unchanged as a generic extra;
- an editor object over 8,000 characters was absent after load normalisation;
- `portal.export.v1` used the top-level tree when root and nested copies disagreed; and
- `portal.mtt.web.v1` used the nested `data` tree.

This is the audit's highest-priority persistence weakness. A current PE can save editor metadata much larger than the generic load cap, so a large saved Outline can lose its structural metadata on hard refresh and fall back to the at-most-4,000-character details projection.

The older editor-aware normaliser cannot simply be reactivated. It uses a different meaningful-Outline rule and can let generic extras overwrite its normalised editor value.

#### Current canonicality depends on mode

- `node.label` is the title truth.
- For Text, `node.details` is the active content truth and accepted Outline metadata is absent.
- For a supported saved Outline, `node.editor.outline` is the active content winner.
- An Outline save also writes an indented `node.details` compatibility projection.
- Array position is operationally authoritative. Block `order` is regenerated as `index + 1`.
- Saving an Outline while in Text deletes `node.editor`, losing IDs, depths, collapse state and any content beyond the details limit.
- Empty or whitespace-only content has no `details` and no meaningful editor metadata, and reopens in Text.

#### Active editor validation is lossy and does not check schema

`PocketNodePopoutModel.normaliseEditorMeta()`:

- does not verify the incoming schema;
- rewrites accepted metadata as `pocket.nodeEditor.v1`;
- retains the first 400 blocks;
- retains the first 4,000 characters per block;
- clamps rounded depth to 0 through 8;
- creates missing IDs;
- retains duplicate non-empty IDs;
- replaces incoming order with array index plus one; and
- removes unknown editor and block fields when metadata is rewritten.

A second actual-model probe confirmed those behaviours, including unknown-schema coercion, duplicate-ID retention, missing-ID generation, 400/4,000 caps, 8/0 depth clamping, sequential order and current empty-Outline rules.

Duplicate IDs are operationally unsafe because selection and text synchronisation use ID sets and first-match lookup.

#### Persisted Outline and Text limits do not align

`node.details` is capped at 4,000 characters. A current Outline can contain up to 400 blocks with up to 4,000 characters per block in the active model. Runtime content is not warned or blocked before apply-time normalisation.

Reachable consequences include:

- a full Outline plus a truncated details projection;
- loss of all Outline-only content when saving that node as Text;
- more than 400 short Text lines producing a runtime Outline whose saved editor contains only the first 400 rows;
- oversized block tails being sliced on changed save; and
- a saved editor over 8,000 serialised characters being dropped by the next file load.

Text normalisation also removes carriage returns, converts tabs to two spaces, trims outer and trailing-line whitespace, collapses three or more newlines to two, and then slices. Text-to-Outline deliberately ignores all blank lines.

#### `node.pe` is a stale third representation

`applyLoadedState()` calls `ensurePeFromLegacyDetails()`, adding a `pocket.pe.v1` Text copy to every details-bearing node that lacks one. No operation is recorded. Opening alone does not write, but the next unrelated explicit export can persist that added object.

The active standalone PE reads and writes only `node.details` and `node.editor`; it never synchronises `node.pe`. `js/pocket-filter-pe-search.js` still indexes `node.pe`, so stale legacy content can affect search.

#### Unknown and future metadata is not safely gated

Small unknown editor schemas can survive an unrelated export as generic extras, but the active PE ignores the schema identifier. A structurally Outline-like future object can be opened and rewritten as v1 on any actual edit, losing unknown fields. Future root schemas with a top-level tree can load, but export always emits `portal.export.v1`. Unknown root and node fields survive only within bounded extras rules.

No safe older-version editing contract exists. The readable `details` projection is useful compatibility, but it is not proof that older versions preserve or round-trip editor metadata.

#### PE apply has a source-identity gap

The truth export queue correctly captures and verifies the active file session. The PE payload itself contains a node ID but no file-session token or original node revision. `applyPayload()` resolves that ID against the current `nodeMap()`.

If file A's PE remains open, file B becomes active, and B has the same node ID, the popup can apply A's content to B before export captures B's valid session. A missing ID safely rejects. This is a verified static route and was not tested against personal files.

#### Recovery mirrors the same model

Local safety, PiP, cache, last-save and Vault representations copy the same in-memory node fields in different wrappers and with different caps. Readers that call current normalisation inherit the editor/extras limitation.

The selected local JSON remains the only document truth. Browser storage is recovery support. Opening a file does not write it. Main Save and canonical PE Save still use explicit truth-file persistence, and PE remains dirty when persistence fails.

The adjacent `js/pocket-pe-save-dirty.js` wrapper still wraps bridge open/apply surfaces and exposes legacy `__pocketPeApplyAndSave`, but the current generated node-popout runtime saves directly through `PocketNodePopoutEditor.applyAndSave()`. The legacy helper is therefore not the canonical current save owner.

### Recommendation

The durable report recommends **Option A: retain the broad current v1 model and strengthen its contracts**.

No truth-file schema migration is recommended now. The immediate work is safety hardening:

- one deliberate first-class node/editor load owner;
- exact schema recognition;
- opaque preservation for unknown schemas and fields;
- visible validation instead of silent truncation;
- unique block-ID enforcement;
- explicit array-order ownership;
- no automatic creation of new legacy `node.pe` shadows;
- explicit semantics for converting a saved Outline to Text; and
- PE binding to its originating file session and node revision.

For Outline, keep `editor.outline` canonical and `details` as a derived compatibility projection until Murray chooses otherwise. This best fits Pocket's explicit local ownership, inspectable JSON, simple recovery and small-app scale.

The recommended immediate next task is P010, a non-writing contract and synthetic-fixture test pass. A v2 or unified content schema should be reconsidered only after current v1 is safe and a real product requirement justifies migration.

### Documentation produced

- `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`

The migration-plan report contains all required sections:

1. Executive Summary
2. Current Truth Model
3. Data Flow Map
4. Current Invariants
5. Duplicated or Derived Data
6. Limits and Data-Loss Analysis
7. Compatibility Matrix
8. Options
9. Recommendation
10. Proposed Target JSON
11. Migration Policy
12. Proposed Implementation Phases
13. Test and Acceptance Plan
14. Open Product Decisions for Murray
15. Non-goals

It also includes an evidence index, concrete JSON examples, P010 through P016 tentative phase boundaries and explicit distinctions between verified behaviour, inferred risk, proposed design and product choices.

### Files changed

- `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`
- `docs/CODEX_REPORT.md`

No JavaScript, HTML, CSS, JSON fixture, runtime configuration, dependency, retired PE file or personal truth file was changed.

### Checks performed

- Confirmed the repository root and configured `MSHND/notespace` origin.
- Ran `git status` before the audit and confirmed a clean working tree.
- Ran `git fetch origin`.
- Confirmed starting local `HEAD` and `origin/main` were both `26b6937b54cdd0b383054b1b4fa607d5e159e33e`.
- Confirmed no commits were newer than the expected P008 baseline.
- Searched the repository for the requested model fields, schemas, normalisers, payload builders, conversions, apply/save owners, export/serialisation, recovery and migration references.
- Inspected all current active route files and adjacent legacy/recovery consumers named in the evidence index.
- Executed the exact-load-order VM probe described above against current source.
- Executed the active-model boundary probe described above against current source.
- Confirmed all named report functions and files exist on current main.
- Confirmed the fifteen required numbered headings occur once and in order.
- Confirmed Markdown code fences are balanced.
- Reviewed Markdown tables and heading boundaries.
- Ran `git diff --check`.
- Reviewed the complete documentation diff.
- Confirmed only the two expected documentation files changed.
- Confirmed no temporary validation files or personal data were added.
- Confirmed no runtime file changed.

No JavaScript syntax check was needed because no JavaScript changed. `node tools/pocket-check.js` and `npm run check` were not run, as required.

### Product decisions still requiring Murray

The report asks Murray to decide, before future implementation:

- the conflict winner when Outline and details disagree;
- what Text means on an existing Outline;
- the future of legacy `node.pe`;
- the user experience at content limits;
- the older-version compatibility promise;
- the unsupported-editor-schema experience; and
- the trigger for any later real migration.

Codex recommends Outline as winner for a supported schema, projection-only Text plus explicit Convert to Text, preserve-but-stop-generating legacy `pe`, block rather than truncate, readable older-version fallback only, read-only unknown schemas, and explicit previewed migration with a verified backup.

### Git identification

This report is included in the commit titled `P009 Audit PE data model migration`. Its resulting SHA is not embedded in the same commit because adding that SHA would create a different commit. The completion response is gated on pushing that commit to `origin/main`, fetching again, confirming local `main` and `origin/main` resolve to the same commit, and confirming the worktree is clean.
