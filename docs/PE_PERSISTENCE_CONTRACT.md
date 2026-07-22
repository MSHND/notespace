# PE Persistence Contract

P011 updates the executable P010 baseline to describe the current persistence contract after first-class PE metadata hardening.

The terms used below are deliberate:

- **Stable** means behaviour that future work should preserve unless Murray explicitly changes the product contract.
- **Compatibility** means behaviour retained for existing Pocket inputs, but not necessarily preferred for new data.
- **CURRENT-RISK** means an executable test freezes a known weakness so a later fix can replace the observation deliberately.
- **Unsupported/unknown** means Pocket preserves the value but does not claim that the current editor can interpret it.
- **Future desired** means a direction from the P009 migration plan that P011 does not implement.

P011 makes a narrow production change. It establishes one load-normalisation owner, preserves `editor` and `pe` as first-class opaque JSON, exact-gates the supported editor schema, and provides a details-only read-only view for unsupported editor data. It does not migrate the truth-file schema or rewrite a file merely because it was opened. Tests use synthetic fixtures only. No personal Pocket truth file was read or written.

## 1. Purpose and scope

This contract records the P011-tested behaviour that P012 and later work must change deliberately. It covers:

- active `index.html` script order and sole node-normalisation ownership;
- accepted root shapes and precedence;
- ordinary Text, supported v1 Outline, malformed and unknown editor states;
- opaque, uncapped first-class preservation of `editor` and `pe`;
- the exact supported-v1 recognition gate;
- the read-only PE compatibility view and its defence in depth;
- load-time `node.pe` synthesis;
- PE opening, apply and save-request payloads;
- root export and browser recovery representations;
- compact load, export and reload round trips;
- generated PE runtime compilation and P008 indentation parsing; and
- details-first copy context.

This document distinguishes opening a file from explicitly writing the selected truth file. It also distinguishes browser `localStorage` recovery writes from truth-file persistence.

P011 does not declare every retained behaviour desirable. Every CURRENT-RISK test is expected to pass while that weakness remains. A later task that fixes one must replace the corresponding expectation instead of preserving the bug for the sake of a green suite.

## 2. How to run the focused test

From the repository root:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

The suite uses Node built-ins only: `node:test`, `node:assert/strict`, `node:fs`, `node:path` and `node:vm`. It adds no dependency and requires no package script.

The harness:

- reads only repository source and synthetic fixtures;
- executes actual browser-global scripts in isolated VM contexts;
- derives the relevant source order from actual `index.html` script tags;
- replaces UI and file-system surfaces with controlled in-memory shims;
- records browser `localStorage` activity separately;
- does not load `js/pocket-io-browser.js` or create a file handle;
- does not invoke a picker, `writeTruthFile()`, or a real `exportTree()`; and
- instruments generated runtime code in memory only.

The P011 validation run on Node `v23.11.0` reports 53 tests, 53 passes and 0 failures.

## 3. Source files exercised

The suite parses or executes these current production sources:

| File | Functions or contract exercised |
| --- | --- |
| `index.html` | Actual classic-script order |
| `js/pocket-state.js` | Lexical state and runtime constants |
| `js/pocket-data.js` | `cleanText()`, `normaliseDetails()`, generic extras and reserved first-class keys |
| `js/pocket-editor-metadata.js` | Opaque JSON cloning, exact editor classification and supported-v1 normalisation |
| `js/pocket-pe-import-preserve.js` | Visible-version patch and verified absence of a `normaliseNodes()` wrapper |
| `js/pocket-storage.js` | `buildPocketPayload()`, `ensurePeFromLegacyDetails()`, `applyLoadedState()` and browser safety representations |
| `js/pocket-import.js` | Sole `normaliseNodes()` owner, `normaliseInput()`, `nodeMap()` and PiP recovery |
| `js/pocket-editor-copy.js` | `collapseAllNodes()`, `getPath()` and `copyContextPayloadForNode()` |
| `js/pocket-history-status.js` | Actual `recordOp()` path used by PE apply |
| `js/pocket-node-popout-model.js` | Editor classification, supported-view normalisation and opening payloads |
| `js/pocket-node-popout-target.js` | Node resolution by explicit ID and current fallback |
| `js/pocket-node-popout-editor.js` | `apply()`, `applyAndSave()` and unsupported-editor rejection |
| `js/pocket-node-popout-runtime.js` | Generated program, read-only guards, exact save schema, shared parser and Text/Outline projection |
| `js/pocket-node-popout-template.js` | Read-only fields, warning and disabled controls |
| `js/pocket-editor-cutover-v3.js` | Canonical open route and unsupported-node legacy-fallback guard |

`js/pocket-io-browser.js` remains the production truth-write owner, but the focused suite deliberately does not execute it. Tests of `applyAndSave()` inject an in-memory `exportTree()` result and separately assert that picker and `writeTruthFile()` spies remain untouched.

## 4. Current persisted root shape

`buildPocketPayload()` emits this broad shape:

~~~json
{
  "schema": "portal.export.v1",
  "exportedAt": "2026-02-02T03:04:05.000Z",
  "writtenAt": "2026-02-02T03:04:05.000Z",
  "pocketGuard": {
    "schema": "pocket.guard.v1",
    "instanceId": "pocket_example",
    "sourceFileName": "synthetic.json",
    "sourceWrittenAt": "2026-01-01T00:00:00.000Z",
    "backupWrittenAt": "2026-02-02T03:04:05.000Z"
  },
  "mainThoughtTree": [],
  "mainThoughtTreeTombstones": [],
  "data": {
    "pocketGuard": {
      "schema": "pocket.guard.v1",
      "instanceId": "pocket_example",
      "sourceFileName": "synthetic.json",
      "sourceWrittenAt": "2026-01-01T00:00:00.000Z",
      "backupWrittenAt": "2026-02-02T03:04:05.000Z"
    },
    "mainThoughtTree": [],
    "mainThoughtTreeTombstones": []
  }
}
~~~

Verified export rules:

- `schema` is always rewritten as `portal.export.v1`.
- `exportedAt` and `writtenAt` are the same supplied or generated timestamp.
- `pocketGuard` occurs at the top level and inside `data` with equivalent content.
- The top-level and nested trees contain equivalent cloned node data.
- The top-level and nested tombstone arrays contain equivalent cloned data.
- `state.rootExtras` is spread into the root before owned root fields.
- `state.dataExtras` is spread into `data` before owned data fields.
- Owned schema, guard, tree and tombstone fields win over conflicting extras.
- `editor`, `pe`, and unknown node fields present in `state.nodes` are serialised without another node-normalisation pass.
- The returned tree is detached from later mutations to `state.nodes`.

Tombstone entries are selected from the winning root container and copied as an array. The active input normaliser does not apply a tombstone item schema or item-count limit.

## 5. Current Text-node contract

A representative persisted Text node is:

~~~json
{
  "id": "text_1",
  "parentId": "root",
  "label": "Text note",
  "order": 1000,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "source": "manual",
  "details": "Parent\n  Child"
}
~~~

An ordinary node is editable as Text only when:

- it has no own `editor` property; or
- it has an own `editor: null` value.

The two states are semantically equivalent for PE recognition, but an explicit `editor: null` remains present through load, export and reload. JSON-compatible `node.pe` content does not determine active Text or Outline mode. Only the impossible non-JSON cloneability guard can make a `pe`-bearing node read-only.

Current Text rules:

- `node.details` is the readable Text body.
- Empty or whitespace-only details normalise to an empty value and the `details` property is omitted.
- The opening payload uses normalised details, a normalised title, `mode: "text"`, and `outline: null`.
- A changed Text apply writes the normalised body to `details`, or deletes `details` when the body is empty.
- Saving a currently supported Outline as changed Text deletes its accepted `node.editor` metadata.
- A node with any other own, non-null `editor` value is not treated as ordinary editable Text. It receives the read-only compatibility view described below.
- `node.pe` is preserved and its schema/content is not an active standalone PE model. Its JSON cloneability is checked only as a fail-closed persistence safety gate.

On active load, a details-bearing node without its own `pe` property still gains an in-memory `pocket.pe.v1` Text object through `ensurePeFromLegacyDetails()`. That is CURRENT-RISK compatibility behaviour, not the Text canonical model. An own `pe` property, including `pe: null`, prevents synthesis.

## 6. Current Outline-node contract

A representative persisted saved Outline node is:

~~~json
{
  "id": "outline_1",
  "parentId": "root",
  "label": "Outline note",
  "order": 1000,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "source": "manual",
  "details": "Parent\n  Child",
  "editor": {
    "schema": "pocket.nodeEditor.v1",
    "mode": "outline",
    "outline": [
      {
        "id": "block_parent",
        "text": "Parent",
        "depth": 0,
        "collapsed": true,
        "order": 1
      },
      {
        "id": "block_child",
        "text": "Child",
        "depth": 1,
        "collapsed": false,
        "order": 2
      }
    ]
  }
}
~~~

The active PE model supports an Outline only when all of these conditions are true:

- the node has an own `editor` property;
- the value is a non-null, non-array object;
- `schema` is exactly `pocket.nodeEditor.v1`;
- `mode` is exactly `outline`;
- `outline` is an array; and
- at least one of the first 400 normalised blocks has non-empty cleaned text, depth above zero, or `collapsed: true`.

There is no case-folding, trimming or best-effort schema rewrite at the recognition boundary. An empty array and one blank depth-0 uncollapsed row are unsupported. A blank collapsed row is supported.

For a supported saved Outline:

- the raw `node.editor` object remains unchanged in main state during load;
- raw top-level and block extension fields, incoming order values and large JSON size survive load, unrelated edits, export, reload and tested recovery routes;
- PE receives a separate normalised copy rather than the raw object;
- PE opens in Outline without reparsing `details`;
- saved non-empty IDs, depths and collapse state survive normalisation within current limits;
- array position wins in the PE view and `order` is regenerated as `index + 1`;
- unknown editor and block fields are omitted from the PE view;
- `details` remains a separate body value in the opening payload; and
- the generated Outline save payload carries the exact `pocket.nodeEditor.v1` schema.

The canonicalisation boundary is an explicit changed PE apply to that node. An unchanged apply leaves the raw object alone. A changed Outline apply writes the known v1 shape from the normalised PE payload, so raw extensions and non-canonical incoming order values may be removed at that deliberate edit boundary. P011 does not claim lossless extension preservation after the user edits that same editor object.

The generated runtime normally builds the save body from `outlineToText(outline)`, producing two spaces per depth. `applyPayload()` does not verify that `payload.body` matches `payload.outline`, so independently supplied details and Outline content can still diverge.

An Outline apply writes both `node.editor` and the `node.details` projection. It leaves an existing `node.pe` untouched.

## 7. Runtime-only and derived fields

| Field or representation | Status |
| --- | --- |
| PE opening `path` | Runtime-derived from `getPath(node.id)` |
| PE opening `openedAt` | Runtime timestamp |
| PE opening `updatedAt` | Runtime timestamp, not the original node revision |
| PE `readOnly`, reason, message and schema diagnostic | Runtime compatibility state, not persisted editor data |
| Popup dirty, allowed-to-close, selection and menu state | Runtime-only |
| Runtime Outline blocks created from Text | Derived from the current textarea through the shared structured-paste parser |
| Runtime block IDs created during Text conversion | Fresh values, persisted only after apply and successful truth export |
| Outline body text | Derived by `outlineToText()` in the normal generated-runtime save path |
| Normalised supported-v1 PE copy | Derived editing view; the raw state object remains separate until a changed apply |
| `state.ops` | Runtime operation history and dirty signal, copied into recovery representations but not the root truth payload |
| `state.collapsed`, `selectedId`, `focusRootId` | Workspace/runtime state, not node Outline collapse metadata |
| Synthesised `node.pe` | Added in memory on load from details, then included in a later explicit export unless future work stops synthesis |
| `pocketGuard` | Derived for each export from instance and source metadata |

Outline block `order` is persisted but derived in the active PE view. Array order is operationally authoritative.

## 8. Script-load and normalisation ownership

The suite derives and executes this relevant order from `index.html`:

1. `js/pocket-state.js`
2. `js/pocket-data.js`
3. `js/pocket-editor-metadata.js`
4. `js/pocket-pe-import-preserve.js`
5. `js/pocket-storage.js`
6. `js/pocket-import.js`

P011 establishes one deliberate owner:

- `js/pocket-import.js` contains the sole active `normaliseNodes()` declaration.
- `js/pocket-editor-metadata.js` exposes `PocketEditorMetadata` helpers but does not install or wrap `normaliseNodes()`.
- `js/pocket-pe-import-preserve.js` retains only the PE visible-version patch and does not install or wrap `normaliseNodes()`.
- `normaliseNodes()` handles core fields and generic extras, then explicitly calls `PocketEditorMetadata.copyFirstClassNodeFields()`.
- `editor` and `pe` are reserved in `RESERVED_NODE_KEYS`, so neither participates in the 24-extra budget or generic 8,000-character object cap.

For truth-file JSON values, the first-class copy path preserves an own `editor` or `pe` value as opaque JSON. Tests cover null, scalar, array, small object, object above 8,000 characters, unknown schema, malformed v1, current v1 extensions and large legacy `pe`. The copy path has no application-level character or property-count cap. Interpretation happens later and does not rewrite the raw state value.

An impossible non-JSON in-memory `editor` or `pe` value, such as a cyclic object, cannot receive that detached-clone guarantee. The loader keeps the rest of the node and leaves the original value attached rather than relabelling or dropping it. Classification then fails closed, the PE opens read-only from `details`, and apply/save rejects it before export. Because parsed truth and recovery JSON cannot contain such a value, P011 makes no lossless explicit-export promise for this synthetic in-memory state.

Recovery snapshot, trail, auto-cache and PiP restore paths all return through the canonical normaliser and retain tested large or unknown first-class values.

## 9. Limits and normalisation table

All exact object-size boundaries below use `JSON.stringify(value).length`, which is JavaScript UTF-16 code-unit length, not file bytes.

| Area | Current limit or rule | Executed result |
| --- | --- | --- |
| Node ID | `cleanText(..., 80)` | Whitespace collapsed, trimmed, first 80 code units retained |
| Parent ID | `cleanText(..., 80)`, default `root` | Same cleaning, empty becomes `root` |
| Node title/label | `cleanText(..., 220)` | Whitespace collapsed, trimmed, first 220 retained |
| Node order | Finite number, rounded | Otherwise generated from input position |
| `updatedAt` | Cleaned to 40 | Empty load value becomes `nowIso()` |
| Node `source` | Cleaned to 30 | Empty becomes `manual` |
| `details` | 4,000 | 3,999 and 4,000 retained; 4,001 sliced to 4,000 |
| Details carriage returns | Removed | Carriage-return characters do not survive |
| Details tabs | Each tab becomes two spaces | Applies anywhere in the body |
| Details trailing whitespace | Removed per line | Outer result also trimmed |
| Details blank runs | Three or more newlines become two | At most one blank line remains between content |
| Empty details | Omitted | Empty and whitespace-only inputs have no `details` after normalisation |
| Generic node extras | First 24 accepted entries | Later generic entries are not examined once 24 are retained |
| Generic node-extra key | 48, restricted character set | Must match letters, numbers, underscore, dot, colon or hyphen after cleaning |
| Generic node-extra string | 1,200 | Silently sliced |
| Generic node-extra object/array | At most 8,000 | 8,000 retained; 8,001 dropped |
| First-class `editor` and `pe` | Exempt from generic count and size limits | Tested above 8,000 and with null, scalar, array and object values |
| Generic root extras | First 32 accepted entries | Root and `data` use the same normaliser when selected |
| Generic root-extra key | 64, restricted character set | Same allowed character set as node extras |
| Generic root-extra string | 2,000 | Silently sliced |
| Generic root-extra object/array | At most 12,000 | 12,000 retained; 12,001 dropped |
| Supported editor schema | Exact `pocket.nodeEditor.v1` | Any other non-null editor value is unsupported and read-only |
| Supported editor mode | Exact `outline` | Case or whitespace variants are unsupported |
| Active PE editor blocks | 400 | Normalised view retains 399 and 400; block 401 is omitted |
| Active PE block text | 4,000 | 3,999 and 4,000 retained; 4,001 sliced |
| Active PE block ID | Cleaned to 80 | Missing ID generated; duplicate non-empty IDs retained |
| Active PE block depth | Rounded and clamped 0 to 8 | Negative becomes 0; `1.6` becomes 2; excessive becomes 8 |
| Active PE block collapse | Strict `=== true` | Other values become false |
| Active PE block order | `index + 1` | Incoming order ignored in the editing view |
| Runtime Text-to-Outline depth | Clamped 0 to 8 | Tabs and inferred space units supported; shallowest line aligned to base |
| Runtime blank Text lines | Filtered | Empty conversion yields no blocks; renderer supplies one fresh blank row |

The 400-block and 4,000-character block limits apply to the supported editing view, not to first-class raw preservation. A larger raw editor remains in state and exports unchanged until an explicit changed PE apply canonicalises that node.

`normalisePocketPe()` still declares larger legacy limits, but the active loader does not run existing `pe` through it. Existing `pe` is copied opaquely. A newly synthesised `pe.text` is based on the already normalised, at-most-4,000-character details body.

## 10. Load/export precedence

`normaliseInput()` selects data as follows:

| Input state | Winning tree and tombstones | Extras result |
| --- | --- | --- |
| `portal.export.v1` with top and nested trees | Top-level `mainThoughtTree` | Root extras captured; nested `data` extras not captured |
| `portal.mtt.web.v1` | `data.mainThoughtTree` | Root and data extras captured separately |
| `portal.sync.v1` | `data.mainThoughtTree` | Root and data extras captured separately |
| `portal.pocketlite.changes.v1` | `snapshot.data.mainThoughtTree` | Root extras from outer object; data extras from snapshot data |
| Raw array | Array itself | Schema becomes `array.nodes`; no extras |
| Unknown schema with top-level `mainThoughtTree` | Top-level tree | Unknown schema string retained; bounded root extras retained |
| Unknown schema with nested-data-only tree | No nodes | Returned schema becomes empty; nested tree is unsupported |

For `portal.export.v1`, top-level tree precedence is current compatibility because Pocket emits both copies. Ignoring nested data extras remains a CURRENT-RISK loss path. A later export rebuilds `data` from empty `state.dataExtras`, so a data-only extension disappears.

Every `buildPocketPayload()` output is `portal.export.v1`, regardless of the loaded input schema. P011 does not grant a lossless round-trip promise to unknown root schemas.

## 11. PE payload and apply contract

### Opening payloads

All opening payloads contain:

~~~text
id, title, body, mode, outline, path, openedAt, updatedAt
~~~

A supported Outline payload also contains `schema: "pocket.nodeEditor.v1"`.

An unsupported or malformed own non-null editor produces:

- `mode: "text"`;
- `outline: null`;
- `readOnly: true`;
- `readOnlyReason: "unsupported-editor"`;
- a fixed readable warning; and
- an optional short `editorSchema` diagnostic when one can be derived safely.

For an unsupported value, the raw editor object, its Outline text and its extension fields are never embedded in the popup document or generated runtime. The compatibility promise is details-only readability. The normalised `node.details` body and title are selectable, but Pocket does not claim they are a faithful projection of a future editor schema.

The read-only template and runtime:

- mark title and body `readonly`;
- disable Save, Save & Close, Text mode and Outline mode;
- prevent dirty state, apply, export and unsaved-close prompts;
- consume Cmd/Ctrl+S without saving;
- allow ordinary Close and Escape closure; and
- keep the details text selectable for copying.

The opening payload still has no file-session ID, source filename identity, writable-handle identity or original node revision. Its `updatedAt` is generated at open time and is not an optimistic-concurrency token.

### Applying

`PocketNodePopoutEditor.apply()` reaches private `applyPayload()` and:

- requires the current Pocket file gate when available;
- resolves the current node by explicit payload ID;
- reclassifies the current node before any mutation;
- rejects an unsupported or malformed current editor with reason `unsupported-editor`;
- records no operation and invokes no export for that rejection;
- compares normalised before and after title, details and supported editor metadata;
- returns success without an operation for unchanged content;
- applies by ID even if lexical `state.selectedId` names another node;
- writes title and details within current caps;
- writes supported Outline metadata or deletes accepted editor metadata for changed Text;
- updates `node.updatedAt`;
- records one `details_edit` operation; and
- invokes UI, workspace and PiP refresh surfaces.

The defence is based on the current node, not a caller-supplied `readOnly` flag. `applyAndSave()` returns `applied: false`, `exported: false`, and reason `unsupported-editor` without reaching `exportTree()`.

`js/pocket-editor-cutover-v3.js` also refuses to route an unsupported node into the legacy editable popup if the standalone read-only open fails. Ordinary Text and supported v1 nodes retain the established fallback behaviour.

The generated editable Outline runtime stamps the exact v1 schema on save. Text payloads remain schema-free. There is still no source-file session binding or original-node revision preflight before a supported mutation.

### Applying and requesting persistence

The suite replaces `exportTree()` with an in-memory result. Current outcomes for supported or ordinary editable nodes are:

| Controlled export result | `applyAndSave()` result |
| --- | --- |
| `{ ok: true }` after a changed apply | `ok: true`, `exported: true`, reason `exported` |
| `false` or `{ ok: false }` | `ok: false`, `exported: false`, reason `export-failed-or-cancelled` |
| `{ downloaded: true }` | `ok: false`, `downloaded: true`, reason `downloaded-copy` |
| Throw or rejected promise | `ok: false`, reason `export-failed` |
| No `exportTree` function | `ok: false`, reason `export-unavailable` |
| Unchanged payload with no visible operations | `ok: true`, `applied: false`, `exported: false`, reason `unchanged` |

After an export failure, a supported in-memory node mutation and recorded operation remain. The popup runtime treats applied-but-not-exported as incomplete and stays dirty.

`pocket-state.js` still declares top-level lexical `state`, which is not automatically `window.state`. `PocketNodePopoutEditor.hasUnsavedOps()` reads `global.state`. An unchanged PE save can therefore miss lexical pending operations and skip an export request. This remains CURRENT-RISK.

## 12. Browser safety storage versus truth-file persistence

The selected local JSON file remains the explicit document truth. Calling actual `applyLoadedState()` on a synthetic legacy Text fixture, with local-safety restore prompting disabled, writes these browser keys:

- `pocketLite.lastSaveSnapshot.v1`
- `pocketLite.pip.snapshot.v1`
- `pocketLite.workspace.state.v1`

A later `buildPocketPayload()` may also create `pocketLite.instanceId.v1` through `getPocketInstanceId()`.

Those are `localStorage` writes. They are not truth-file persistence. During load and payload building:

- no operation is recorded;
- no `exportTree()` surface is called;
- no `writeTruthFile()` surface is called;
- no open or save picker is called;
- no file handle exists; and
- no repository or external JSON file is written.

Opening alone does not write the selected truth file. It can still mutate in-memory node shape through `node.pe` synthesis, and a later explicit export can carry that mutation. This remains CURRENT-RISK.

P011 additionally verifies that local safety snapshot, safety trail, auto-cache and PiP recovery routes preserve raw large current editor objects, raw unknown editor objects and raw legacy `pe` values. Recovery normalisation does not convert their schema or trim them to the generic extras cap.

## 13. Stable behaviour assertions

The focused suite treats these as stable current assertions:

- `js/pocket-import.js` is the sole active node-normalisation owner.
- `editor` and `pe` are reserved, first-class and outside generic extras count and size limits.
- Opaque JSON values, including null, scalar, array, large object and unknown fields, survive load, export and reload.
- A supported raw v1 object with top-level and block extensions remains raw in main state through unrelated persistence paths.
- Exact schema, mode, array and meaningful-content checks determine supported v1 Outline recognition.
- An absent editor or `editor: null` opens as editable Text.
- Any other own non-null editor opens in a details-only read-only compatibility view.
- An impossible non-JSON own `pe` value also fails closed into that view, while every tested JSON-compatible legacy `pe` remains outside mode selection.
- Unsupported editor data never enters popup HTML or generated runtime source.
- Read-only mode disables all edit and save controls, never becomes dirty, and closes with Close or Escape.
- Application-level apply and save-request paths reject unsupported current nodes before mutation, operation recording or export.
- The legacy editable popup is not a fallback for an unsupported node.
- The selected truth file is not written merely by `applyLoadedState()`.
- Browser recovery storage remains distinguishable from truth persistence.
- Valid saved Outlines open from the editor array rather than reparsing body text.
- Generated editable Outline saves carry the exact v1 schema.
- `buildPocketPayload()` emits guarded top-level and nested tree copies.
- Text normalisation retains its tested whitespace and 4,000-character policy.
- Changed supported applies record one `details_edit` operation; unchanged applies record none.
- Failed controlled export results do not falsely report truth persistence.
- Generated runtime programs compile for Text, saved Outline and rejected metadata payloads.
- P008 Text-to-Outline uses the shared structured-paste parser.
- Spaces, tabs, mixed indentation and common leading indentation retain hierarchy.
- Blank Text lines are filtered and empty Outline rendering supplies one fresh blank row.
- Text to Outline to Text normalises to two-space indentation without flattening.
- Copy context remains details-first and ignores editor metadata.

P011 does not change active-file protections, Main Save ownership, PE dirty-after-failed-persistence behaviour, P006 selection/subtree actions, P007 Escape ordering, P008 indentation conversion, structured paste, the one Enter owner or truth-write routing.

## 14. Compatibility behaviour assertions

| State | Current load result | Current PE result | Current export result | Classification |
| --- | --- | --- | --- | --- |
| Legacy Text without `pe` | Details retained; Text `pe` synthesised in memory | Editable Text | Later explicit export includes synthesised `pe` | Current-risk |
| Text with no `editor` | Details retained | Editable Text | Text shape retained, subject to normalisation | Stable |
| Text with `editor: null` | Null retained first-class | Editable Text | Null retained unless that node is changed | Stable compatibility |
| Valid current v1 Outline | Raw editor retained without load rewrite | Normalised Outline copy | Untouched export retains raw object | Stable |
| Current v1 with extensions or non-canonical order | Raw extensions and order retained | PE view strips extensions and derives order | Unchanged export retains raw; changed PE apply writes canonical known v1 | Compatibility |
| Saved Outline viewed temporarily in Text | State unchanged | Runtime shows two-space projection | No export change unless user saves | Compatibility |
| Saved Outline changed and saved as Text | Supported editor exists before apply | Explicit Text save removes editor | Details remains; IDs/depths/collapse are absent | Current-risk |
| Text converted manually to Outline | Loads Text | Shared parser creates fresh IDs and relative depths | Successful save exports v1 editor plus details projection | Stable |
| Empty or whitespace-only Text | `details` omitted; no `pe` synthesis | Editable Text | Empty content represented by omission | Stable |
| Empty or blank uncollapsed v1 Outline object | Raw object retained | Details-only read-only view | Raw object retained untouched | Unsupported/unknown |
| Malformed v1 editor | Raw value retained first-class | Details-only read-only view | Raw value retained through unrelated export | Stable preservation, unsupported editing |
| Unknown editor schema | Raw value retained first-class | Details-only read-only view | Raw value retained through unrelated export | Stable preservation, unsupported editing |
| Scalar or array editor | Raw value retained first-class | Details-only read-only view | Raw value retained through unrelated export | Stable preservation, unsupported editing |
| Missing block ID in otherwise supported v1 | Raw missing value retained | PE view generates an ID | Generated ID persists after a changed Outline save | Compatibility |
| Duplicate block IDs | Raw duplicates retained | PE view retains duplicates | Changed Outline save still contains duplicates | Current-risk |
| Invalid or excessive depth | Raw value retained | PE rounds and clamps to 0 through 8 | Changed Outline save persists the clamped value | Compatibility |
| More than 400 blocks or block text above 4,000 | Large raw editor retained | Supported view slices at current caps | Untouched export is raw; changed PE save can persist the sliced view | Current-risk at edit boundary |
| Mismatched details and supported Outline | Both retained | Outline wins mode while body remains independent | Drift survives untouched export | Current-risk |
| Large or unknown `pe` | Raw value retained outside extras caps | Ignored by active standalone PE | Raw value retained through export and recovery | Compatibility |
| Unknown root schema with top-level tree | Best-effort top-level load | Nodes follow their individual PE rules | Export schema becomes `portal.export.v1` | Unsupported/unknown |
| Unknown root schema with nested-data-only tree | No nodes loaded | No PE target | Empty normalised state if later exported | Unsupported/unknown |

P011's cross-version promise is deliberately narrow. Current Pocket preserves unsupported editor JSON on unrelated load, recovery and export routes and shows only persisted `details` read-only. It does not promise that `details` exactly represents a future editor, that an older Pocket build will preserve fields it does not know, or that unsupported content can be edited bidirectionally.

Existing `node.pe` remains opaque compatibility data and is not synchronised by standalone PE edits. Raw arrays still load as `array.nodes`; `portal.mtt.web.v1`, `portal.sync.v1` and `portal.pocketlite.changes.v1` retain their established nested-container routes.

## 15. Current-risk characterisation assertions

The suite contains these ten explicitly named passing tests:

1. `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
   - ID uniqueness is not enforced.
2. `CURRENT-RISK: Outline normalisation silently slices block 401`
   - The editing-view block cap truncates instead of rejecting before edit.
3. `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
   - Per-block text is truncated in the editing view.
4. `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
   - Load is truth-write-free but not shape-neutral in memory.
5. `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
   - Mode/content selection and body projection can disagree.
6. `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
   - A data-only extension is not retained on this route.
7. `CURRENT-RISK: PE opening payload has no file-session or original-revision identity`
   - Apply cannot bind itself to the source session or original node revision.
8. `CURRENT-RISK: Outline apply accepts independent details/editor content and silently enforces title/body limits`
   - Apply can persist drift and truncates title/body at current caps.
9. `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`
   - Explicit Text persistence removes IDs, depths and collapse metadata.
10. `CURRENT-RISK: unchanged PE save cannot see lexical unsaved operations through window.state`
    - An unchanged PE save can skip export when lexical operations are pending.

The former load-owner, generic extras, oversized metadata, unknown-schema coercion and malformed-shape interpretation risks are no longer current-risk assertions. P011 replaces them with positive preservation, exact-gating and read-only tests.

These tests freeze observations, not product policy. The ten named weaknesses remain present after P011.

## 16. Fixture inventory

All fixtures are small, parseable JSON under `tests/fixtures/pe-persistence/`:

| Fixture | Purpose |
| --- | --- |
| `legacy-text.json` | Ordinary indented Text without `editor` or `pe` |
| `current-outline-v1.json` | Saved v1 Outline with stable IDs, nested depth, collapse and deliberate details drift |
| `empty-text.json` | Whitespace-only details |
| `malformed-editor.json` | v1-labelled object with non-array Outline |
| `unknown-editor-schema.json` | Future schema with Outline-like content and unknown fields |
| `root-precedence.json` | Disagreeing top/nested trees, tombstones and synthetic extras |

Large boundaries, scalar and array metadata, raw extension objects and recovery cases are generated in memory. No megabyte fixture, personal value, random timestamp requirement or invalid commented JSON is committed.

## 17. Test matrix

| Area | Executable coverage | Classification |
| --- | --- | --- |
| Fixture integrity | Inventory, size and `JSON.parse()` | Stable |
| Index ownership | Actual order, single function identity and helper non-ownership | Stable |
| Node extras | 24/25 and generic scalar/object boundaries | Stable current limits |
| First-class metadata | Reserved position, null/scalar/array/object, above 8,000, `editor` and `pe` | Stable preservation |
| Impossible non-JSON metadata | Cyclic in-memory `editor` or `pe` remains attached, is read-only and cannot apply/export through PE | Unsupported/unknown |
| Root extras | 32/33, 2,000/2,001 string, 12,000/12,001 object | Stable current limits |
| Root precedence | Export, MTT, sync, change snapshot, array and unknown routes | Compatibility plus CURRENT-RISK data-extra loss |
| Text normalisation | Empty, whitespace, CR, tabs, trailing, outer, blank runs and 3,999/4,000/4,001 | Stable current limits |
| Exact editor gate | Absent, null, v1, mode, array, meaningful, empty, blank, malformed, unknown, scalar and array | Stable recognition |
| Raw supported v1 | Large object, extension fields and incoming order across load/export/reload | Stable preservation |
| Block IDs/depth/order | Missing, duplicate, long ID, depth bounds, incoming order and unknown fields | Compatibility plus CURRENT-RISK duplicates |
| Outline limits | 399/400/401 blocks and 3,999/4,000/4,001 block text | Stable boundaries plus CURRENT-RISK slicing |
| Native Outline open | IDs, depths, collapse, body drift and no reparse | Stable plus CURRENT-RISK drift |
| Unsupported PE view | Read-only Text/details, warning, raw exclusion, disabled controls, Cmd/Ctrl+S, Escape and Close | Stable compatibility |
| Apply defence | Unsupported apply and `applyAndSave()` with zero mutation, operation and export | Stable |
| Cutover defence | Unsupported node cannot fall back; ordinary and supported nodes retain fallback | Stable |
| Unrelated edit | Raw unknown, malformed, large current editor and large `pe` preserved | Stable |
| Recovery routes | Safety snapshot/trail, auto-cache and PiP with large and unknown metadata | Stable |
| Load-time synthesis | No op, browser keys, zero truth surfaces and later export shape | CURRENT-RISK |
| Root export | Schema, timestamps, guards, dual trees, tombstones, extras and detached clones | Stable |
| Compact round trips | Text, empty, v1, malformed, unknown, drift and extras | Mixed |
| PE identity | Missing source session and original revision | CURRENT-RISK |
| PE apply | By ID, dual Outline write, Text deletion, unchanged detection, operation and caps | Mixed |
| PE save request | Success, false/cancel, downloaded copy, throw and unavailable | Stable current result contract |
| Lexical/global state | Pending lexical operation with unchanged PE | CURRENT-RISK |
| Generated runtime | Compile states, exact Outline schema, parser, round trips and empty renderer | Stable |
| Copy context | Details first, label fallback and editor ignored | Stable |

The focused P011 suite reports 53 tests, 53 passes and 0 failures.

## 18. Change protocol for P012 and later tasks

Any later task that changes a tested contract must:

1. identify whether the assertion is stable, compatibility or CURRENT-RISK;
2. preserve the synthetic input demonstrating the old boundary unless it is genuinely obsolete;
3. change production, tests and this document in the same task;
4. replace a fixed CURRENT-RISK name with a positive contract name;
5. prove opening alone still performs no truth-file write;
6. keep browser safety writes distinct from truth persistence;
7. preserve raw unsupported metadata through unrelated paths;
8. test both sides of every changed cap or schema gate;
9. compile and exercise generated runtime whenever payload or runtime shape changes;
10. rehearse any destructive migration only with disposable copies; and
11. require Murray's product decision before changing conversion meaning, older-version promises or migration triggers.

Tentative next boundaries remain:

- **P012, identity binding and non-lossy preflight:** add file-session identity and original node revision, reject stale or mismatched saves before mutation, and validate block counts, text sizes and duplicate IDs without silently slicing. Rejection must leave PE dirty and must not export. Murray must decide size-limit UX and whether explicit truncation is ever allowed.
- **P013, explicit Text/Outline conversion:** define whether Text on a saved Outline is projection-only or an explicit destructive conversion. Preserve IDs and collapse state unless the user confirms conversion. Murray must decide the product meaning before implementation.
- **P014, retire `node.pe` as live content:** stop load-time synthesis and stale search use while continuing to preserve existing raw `pe` values. No existing value may be deleted automatically. Murray must confirm preserve-and-stop-generating rather than promotion or synchronisation.

P011 does not approve those phases. No future task should make opening a file silently migrate it. Ordinary explicit Save must not mass-rewrite untouched nodes merely because a newer reader recognised them.

The lexical `state` versus `window.state` gap also needs deliberately scoped future work. This contract does not prescribe exposing mutable state globally.

## 19. Non-goals

P011 does not add or propose:

- autosave;
- cloud synchronisation;
- collaboration;
- file watchers;
- background truth-file writes;
- background migration;
- silent writable-handle reuse;
- another PE implementation;
- restoration or routing through `pocket-editor-popout-default.js`;
- a wholesale application rewrite;
- a package dependency or package script;
- a current truth-file schema migration;
- changes to root-shape precedence or root extras;
- removal of load-time `pe` synthesis;
- file-session identity or stale-revision protection;
- new Text/Outline conversion semantics;
- changes to existing title, details, block or depth caps;
- changes to Main Save, PE Save ownership or active-file protections;
- changes to P006 selection, subtree, Paste, Duplicate or Delete behaviour;
- changes to P007 Escape ordering;
- changes to P008 indentation conversion;
- changes to details-first copy context or the one active main-tree Enter owner; or
- inspection or testing of Murray's personal Pocket files.

Future desired behaviour remains documented in `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`. P011's role is narrower: make first-class metadata recognition and preservation safe without silently migrating Pocket's explicit truth file.
