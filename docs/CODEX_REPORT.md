# Codex report

## POCKET TASK P011

Title: Consolidate PE editor recognition

Status: first-class PE metadata ownership, exact editor recognition and read-only compatibility handling implemented and validated. Physical browser acceptance remains.

Commit title:

- `P011 Consolidate PE editor recognition`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Expected and confirmed starting `origin/main`: `8699d91a35ae941a49c42d28c216548e552635fd`
- Starting commit: `P010 Specify PE persistence contract`
- Local `main` matched `origin/main`, and the working tree was clean before P011.
- No personal or active Pocket truth file outside the repository was inspected.

### Outcome

P011 makes `editor` and `pe` deliberate first-class node fields, gives the active PE one exact recognition contract, and prevents unsupported or malformed editor data from reaching an editable fallback.

The resulting boundary is:

- load and recovery preserve JSON-compatible `editor` and `pe` values opaquely without the generic extras count or size caps;
- the active PE interprets only an exact supported `pocket.nodeEditor.v1` Outline;
- absent and explicit-null editor states remain ordinary editable Text;
- unsupported, future and malformed non-null editor states open as readable, read-only Text projections;
- no read path rewrites opaque editor data or writes the selected truth file;
- unrelated edits and exports preserve untouched raw first-class metadata; and
- an explicit edit of a supported v1 Outline writes the existing canonical v1 representation.

No new persistence schema or migration was introduced.

### Files changed

Production files:

- `js/pocket-data.js`
- `js/pocket-editor-metadata.js`
- `js/pocket-pe-import-preserve.js`
- `js/pocket-import.js`
- `js/pocket-node-popout-model.js`
- `js/pocket-node-popout-template.js`
- `js/pocket-node-popout-runtime.js`
- `js/pocket-node-popout-editor.js`
- `js/pocket-editor-cutover-v3.js`

`js/pocket-editor-cutover-v3.js` is included because the cutover previously treated a failed canonical open as permission to use a legacy editable popup. P011 must block that fallback for unsupported or malformed editor data, otherwise the read-only contract could be bypassed.

Test and documentation files:

- `tests/pe-persistence-contract.test.js`
- `docs/PE_PERSISTENCE_CONTRACT.md`
- `docs/CODEX_REPORT.md`

The six synthetic P010 fixtures are unchanged. No dependency, package script, production JSON example or retired PE implementation was added or modified.

### Canonical load owner

`js/pocket-import.js` remains the final `normaliseNodes()` owner in actual `index.html` load order, but it is now deliberate rather than accidental:

- `js/pocket-editor-metadata.js` supplies recognition, normalisation and JSON-compatible cloning helpers without replacing `normaliseNodes()`;
- `js/pocket-pe-import-preserve.js` no longer wraps node normalisation and now owns only the existing visible PE version marker patch;
- `editor` and `pe` are reserved node keys, so generic extras cannot consume their first-24 field budget or overwrite them by property order; and
- the canonical owner copies both fields after ordinary node construction through the first-class metadata helper.

The focused suite confirms that the final lexical and window-visible `normaliseNodes()` identity is the canonical `js/pocket-import.js` owner.

### Uncapped opaque first-class preservation

For truth-file JSON values, `editor` and `pe` are preserved as detached JSON-compatible clones outside the generic extras limits. This removes the prior 8,000-character object loss path and the shared 24-field budget interaction.

Coverage includes:

- small and large current v1 Outline objects;
- large unknown-schema editor objects;
- large legacy `pe` objects;
- explicit nulls, scalars and arrays;
- cyclic non-JSON in-memory `editor` and `pe` values that fail closed without discarding their nodes;
- unsupported and malformed editor objects;
- load, export and reload;
- unrelated-node edits followed by explicit export; and
- local safety snapshot, safety trail, auto-cache and PiP recovery routes.

Opaque preservation is not semantic acceptance. Raw unsupported data can survive intact while the active PE refuses to edit it.

The standalone PE still ignores JSON-compatible legacy `pe` content for mode and content selection. It checks only first-class cloneability, so an impossible cyclic in-memory `pe` fails closed before editing or export just like an impossible cyclic `editor`.

### Exact editor-recognition gate

The shared metadata contract classifies editor state as one of:

- `none` for an absent field or `editor: null`;
- `supported-v1-outline` for an exact supported Outline; or
- `unsupported-or-malformed` for every other present, non-null value.

Supported editor metadata must have all of:

- `schema === "pocket.nodeEditor.v1"`;
- `mode === "outline"`;
- an array-valued `outline`; and
- at least one meaningful retained block.

Unknown schemas are no longer accepted by shape, relabelled as v1 or stripped in the PE view as if they were supported. Malformed current-schema objects, scalars and arrays also fail closed. Existing supported v1 block normalisation, including current ID, depth, collapse, ordering and size limits, remains the canonical editable view.

### Read-only compatibility view

Unsupported or malformed editor data produces a Text-mode payload containing the normalised title and readable `details` projection, plus an explicit read-only reason and message. The raw opaque editor object is not embedded in the generated popup program or HTML.

The template and generated runtime jointly enforce the view:

- a visible read-only banner explains why editing is unavailable;
- the title and body remain selectable for copy but are read-only;
- Save, Save & Close, Text and Outline controls are disabled;
- no Outline is initialised or rendered from unsupported metadata;
- input events, mode switching, buttons and save shortcuts cannot mark the popup dirty or invoke apply/save;
- unsaved-dialog and `beforeunload` protection stay inactive because no edit is possible; and
- Close and Escape still close the readable popup normally.

This is compatibility presentation only. There is no hidden preserve-on-save branch because saving is unavailable.

### Apply defence and cutover bypass fix

The main-window apply owner reclassifies the current node before accepting any payload. If its stored editor is unsupported or malformed:

- `apply()` returns failure, with optional structured details for callers that request them;
- `applyAndSave()` reports `unsupported-editor`;
- the node is not mutated;
- no operation is recorded; and
- no export or truth-write route is invoked.

The cutover attempts the canonical standalone read-only open first. If that open fails, unsupported or malformed nodes do not fall through to either legacy editable bridge. Ordinary Text and supported v1 nodes retain the established fallback behaviour for a genuine canonical-open failure.

### Raw v1 extensions and explicit canonicalisation

Load ownership and PE interpretation are deliberately separate for supported v1 data too:

- raw v1 editor and block extension fields remain in state after load;
- an unrelated edit and later explicit export preserve that untouched raw v1 object exactly;
- opening the node uses a detached canonical editable view; and
- explicitly saving an edit to that v1 Outline replaces the raw object with the canonical `pocket.nodeEditor.v1` shape, so unrecognised extensions are removed only at that explicit edit boundary.

The generated editable Outline runtime now emits the exact v1 schema in its save payload. This makes canonicalisation intentional and testable rather than a silent read-time migration.

### Legacy `pe` synthesis

P011 does not change `ensurePeFromLegacyDetails()`:

- a details-bearing node without its own `pe` field can still gain an in-memory Text `pocket.pe.v1` projection during load;
- any own `pe` value, including null, still prevents synthesis; and
- the standalone node PE still does not use legacy `node.pe` as its editable model.

This remains an explicitly named CURRENT-RISK compatibility behaviour. Consolidating first-class preservation does not endorse or expand it.

### P010 CURRENT-RISK results

P011 resolves P010 CURRENT-RISK categories 1, 2, 3, 4 and 10:

1. `normaliseNodes()` ownership is now deliberate and tested.
2. `editor` and `pe` are reserved outside the generic first-24 extras budget.
3. first-class editor metadata is no longer dropped above the generic 8,000-character object cap.
4. unknown Outline-like schemas are exact-gated and never rewritten as v1 merely because their shape resembles Outline.
10. malformed and unknown raw objects remain preserved while PE exposes an explicit read-only Text view rather than shape-based interpretation.

The following exact CURRENT-RISK categories remain:

- `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
- `CURRENT-RISK: Outline normalisation silently slices block 401`
- `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
- `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
- `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
- `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
- `CURRENT-RISK: PE opening payload has no file-session or original-revision identity`
- `CURRENT-RISK: Outline apply accepts independent details/editor content and silently enforces title/body limits`
- `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`
- `CURRENT-RISK: unchanged PE save cannot see lexical unsaved operations through window.state`

These retained assertions cover duplicate IDs, the block-401 and block-text-4,001 truncation boundaries, legacy `pe` synthesis, details/Outline drift, root/data extras precedence, missing source identity, apply limits and drift, Text deletion semantics, and the lexical-state visibility gap.

### Generated-runtime validation

`PocketNodePopoutRuntime.build()` returned programs that compiled with `new Function(...)` for:

- ordinary editable Text with `outline: null`;
- a valid saved v1 Outline; and
- an unsupported or rejected editor state represented by the read-only Text payload.

The controlled generated-runtime tests confirm:

- an editable Outline save includes `schema: "pocket.nodeEditor.v1"`;
- read-only controls and fields are disabled at both template and runtime layers;
- programmatic input, mode, Save, Save & Close and shortcut attempts do not call apply/save or create dirty state;
- no unsupported raw editor content is embedded in the generated program or HTML;
- read-only Text remains selectable and closable; and
- the unsaved dialog and unload guard remain inactive.

P008 regression coverage remains green for:

- two-space and four-space indentation;
- tabs and mixed tab/space indentation;
- common leading indentation;
- blank-line filtering;
- depth clamping;
- structured-paste base-depth alignment;
- Text to Outline to Text round trips with normalised two-space projection; and
- one fresh blank depth-0 uncollapsed row for empty or whitespace-only Text.

### Focused test result

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
tests 53
suites 0
pass 53
fail 0
cancelled 0
skipped 0
todo 0
```

The suite uses actual repository source in isolated VM contexts and controlled in-memory browser/file surfaces. It creates no file handle, invokes no picker, performs no network access and writes no truth file.

### Additional validation

Passed:

- `node --check` for all nine changed production JavaScript files;
- `node --check tests/pe-persistence-contract.test.js`;
- generated-runtime compilation and controlled execution;
- fixture inventory and JSON parsing through the focused suite; and
- `git diff --check`.

The final review confirms:

- no synthetic fixture changed;
- no personal Pocket truth file was read or written;
- no truth-file migration, background write, autosave, watcher, cloud synchronisation or silent handle reuse was added;
- no new dependency or package script was added;
- no retired PE file was restored or modified;
- P006 outline actions, P007 Escape order, P008 indentation conversion, details-first copy context and the one active main-tree Enter owner remain covered or unchanged;
- `node tools/pocket-check.js` was not run; and
- `npm run check` was not run.

### Still requiring Murray's physical browser acceptance

- Unsupported and malformed nodes visibly open in the standalone read-only compatibility view.
- The banner wording, disabled controls, selectable text and close/Escape feel are acceptable in the real popup.
- A failed canonical read-only open does not expose a legacy editable fallback.
- Ordinary Text and native v1 Outline editing, Save and Save & Close still feel unchanged against a selected disposable truth file.
- Large current v1, unknown-schema and legacy `pe` values survive a real open and unrelated explicit save without silent migration.
- Explicitly editing a supported v1 Outline canonicalises only that edited editor object as documented.

### Git identification

This report is included in the commit titled `P011 Consolidate PE editor recognition`. Its resulting SHA is intentionally not embedded in the same commit because adding that SHA would create a different commit. Completion remains gated on pushing that exact commit to `origin/main`, fetching again, confirming local `main` and `origin/main` resolve to it, and confirming the worktree is clean.

---

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
