# PE Persistence Contract

## P013 independent content-section contract

P013 makes **Notes** and **Outline** independent content sections of one node. `node.label` remains the shared title, `node.details` is Notes truth, and a supported `node.editor.outline` under the exact `pocket.nodeEditor.v1` schema is Outline truth. Neither section is a projection of the other after P013.

- A supported Outline opens the Outline tab; otherwise PE opens Notes. The selected tab is runtime UI state only.
- Switching tabs never converts content, marks PE dirty, records an operation, or writes a truth file. Unsaved edits in both sections remain in memory.
- Saving compares Notes and Outline independently in the main window. Notes-only changes preserve the existing raw editor object; Outline-only changes preserve Notes; combined changes persist together.
- Blank Notes remove only `node.details`. An absent or wholly blank Outline removes only `node.editor`; a fresh blank runtime row is not persisted.
- Existing `details` on older Outline nodes is retained verbatim as initial Notes, even when it resembles the Outline. There is no heuristic cleanup or automatic migration.
- An unchanged supported raw Outline, including supported raw extensions, survives a Notes-only save. An actual Outline change crosses the P012 canonicalisation and non-lossy preflight boundary.
- Unsupported or malformed non-null editor metadata remains in the P011 read-only compatibility experience; Notes are not selectively enabled around it.
- Older Pocket versions may display Notes without understanding the independent Outline. P013 makes no bidirectional older-reader editing promise.

The terms `mode: "text"` and `mode: "outline"` may remain inside the popup payload as a presentation-tab indicator for compatibility. They do not describe conversion or persistence ownership.

P012 updates the executable P010/P011 baseline to describe the current persistence contract after source-identity binding, node-revision checks and non-lossy save preflight.

The terms used below are deliberate:

- **Stable** means behaviour that future work should preserve unless Murray explicitly changes the product contract.
- **Compatibility** means behaviour retained for existing Pocket inputs, but not necessarily preferred for new data.
- **CURRENT-RISK** means an executable test freezes a known weakness so a later fix can replace the observation deliberately.
- **Unsupported/unknown** means Pocket preserves the value but does not claim that the current editor can interpret it.
- **Future desired** means a direction from the P009 migration plan that P012 does not implement.

P012 makes a narrow safety change at the explicit PE save boundary. Each canonical PE opening now carries a JSON-safe document-session identity and the node revision it actually opened. The main window rejects a save before node lookup or mutation when the document session changed, and rejects before mutation when that node revision is stale. Raw save content is checked before the existing slicing normalisers can lose it. Successful in-memory apply returns a new revision to the popup, so a failed truth-file export can be retried safely. P011 first-class `editor`/`pe` preservation and unsupported-editor read-only behaviour remain intact.

P012 does not migrate the truth-file schema, persist the runtime source binding, or rewrite a file merely because it was opened. Tests use synthetic fixtures, in-memory handles and instrumented write surfaces only. No personal Pocket truth file was read or written, and this synthetic validation does not claim Murray's physical browser acceptance.

## 1. Purpose and scope

This contract records the P012-tested behaviour that P013 and later work must change deliberately. It covers:

- active `index.html` script order and sole node-normalisation ownership;
- accepted root shapes and precedence;
- ordinary Text, supported v1 Outline, malformed and unknown editor states;
- opaque, uncapped first-class preservation of `editor` and `pe`;
- the exact supported-v1 recognition gate;
- the read-only PE compatibility view and its defence in depth;
- load-time `node.pe` synthesis;
- PE opening identity, optimistic node-revision binding, apply and save-request payloads;
- document-session renewal and successful save-as identity adoption;
- raw Text and Outline save preflight, including exact non-lossy limits;
- failed-export revision handshakes, pending-operation visibility and retry;
- root export and browser recovery representations;
- compact load, export and reload round trips;
- generated PE runtime compilation and P008 indentation parsing; and
- details-first copy context.

This document distinguishes opening a file from explicitly writing the selected truth file. It also distinguishes browser `localStorage` recovery writes from truth-file persistence.

P012 does not declare every retained behaviour desirable. Every CURRENT-RISK test is expected to pass while that weakness remains. A later task that fixes one must replace the corresponding expectation instead of preserving the bug for the sake of a green suite.

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
- executes `js/pocket-io-browser.js` with controlled, in-memory file handles and deterministic picker/write spies;
- does not create a real `FileSystemFileHandle`, invoke a real picker, or write a truth file;
- instruments generated runtime code in memory only.

The P013 validation run reports 79 tests, 79 passes and 0 failures. The same command and result are also recorded in `docs/CODEX_REPORT.md`.

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
| `js/pocket-history-status.js` | Actual `recordOp()` path and narrow lexical pending-operation count |
| `js/pocket-io-browser.js` | File sessions, safe editor identity, load/create/adopt transitions, queued export guards, truth-write result propagation and save-as adoption |
| `js/pocket-node-popout-model.js` | Editor classification, supported-view normalisation, opening bindings and raw non-lossy save preflight |
| `js/pocket-node-popout-target.js` | Node resolution by explicit ID and current fallback |
| `js/pocket-node-popout-editor.js` | Ordered identity/revision/apply gates, non-lossy preparation, retry handshake and export-result propagation |
| `js/pocket-node-popout-runtime.js` | Generated program, independent Notes/Outline payload, tab state, revision/identity adoption, dirty-state result handling, read-only guards and structured-paste parser |
| `js/pocket-node-popout-template.js` | Read-only fields, warning and disabled controls |
| `js/pocket-editor-cutover-v3.js`, `js/pocket-editor-popout.js` and `js/pocket-pe-save-dirty.js` | Canonical open/apply/save ownership and fail-closed legacy routes |
| `js/pocket-storage.js`, `js/pocket-import.js`, `js/pocket-editor-copy.js` and `js/pocket-vault-io-browser.js` | Active recovery, PiP and Vault state adoption as new document sessions |

`js/pocket-io-browser.js` remains the production truth-write owner. Tests of rejection paths assert that no export, picker, writable, workspace safety write or PiP snapshot is reached. Export and retry tests use controlled return values and fake handles only.

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

## 5. Historical pre-P013 Text-node contract

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

P012 does not change how already persisted Text is normalised on load. At an explicit PE save, however, title and body are first normalised without slicing and rejected when they exceed 220 or 4,000 characters. The normal save path no longer silently turns a 221-character title or 4,001-character body into the persisted maximum.

On active load, a details-bearing node without its own `pe` property still gains an in-memory `pocket.pe.v1` Text object through `ensurePeFromLegacyDetails()`. That is CURRENT-RISK compatibility behaviour, not the Text canonical model. An own `pe` property, including `pe: null`, prevents synthesis.

## 6. Historical pre-P013 Outline-node contract

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

P012 narrows the explicit Outline boundary: Outline canonicalisation may proceed only when both the preserved supported raw Outline and the unsliced incoming save payload pass the explicit save contract. A view that has sliced row 401, sliced a 4,001-character block or retained duplicate IDs cannot be saved back as Outline over the raw object. The separate P013-unresolved changed-Text deletion behaviour remains as documented below.

The generated runtime normally builds the save body from `outlineToText(outline)`, producing two spaces per depth. `applyPayload()` does not verify that `payload.body` matches `payload.outline`, so independently supplied details and Outline content can still diverge.

An Outline apply writes both `node.editor` and the `node.details` projection. It leaves an existing `node.pe` untouched.

## 7. Runtime-only and derived fields

| Field or representation | Status |
| --- | --- |
| PE opening `path` | Runtime-derived from `getPath(node.id)` |
| PE opening `openedAt` | Runtime timestamp |
| PE opening `updatedAt` | Compatibility alias of the node revision at opening; it is no longer a newly generated “now” value |
| PE opening `originalUpdatedAt` | Exact normalised `node.updatedAt` captured at opening; required optimistic-concurrency token |
| PE opening `fileSessionId` | JSON-safe document-session token; authoritative source identity for PE apply |
| PE opening `sourceFileName` | Cleaned diagnostic display name, not identity and not persisted by PE |
| PE opening `sourcePipSession` | Diagnostic PiP-session flag, not identity and not persisted by PE |
| PE `readOnly`, reason, message and schema diagnostic | Runtime compatibility state, not persisted editor data |
| Popup dirty, save generation, allowed-to-close, selection and menu state | Runtime-only |
| Runtime Outline blocks created from Text | Derived from the current textarea through the shared structured-paste parser |
| Runtime block IDs created during Text conversion | Fresh values, persisted only after apply and successful truth export |
| Outline body text | Derived by `outlineToText()` in the normal generated-runtime save path |
| Normalised supported-v1 PE copy | Derived editing view; the raw state object remains separate until a changed apply |
| `state.ops` | Runtime operation history and dirty signal, copied into recovery representations but not the root truth payload |
| `getPocketUnsavedOperationCount()` | Read-only count over lexical `state.ops`; exposes neither `state` nor the mutable operation array |
| `state.collapsed`, `selectedId`, `focusRootId` | Workspace/runtime state, not node Outline collapse metadata |
| Synthesised `node.pe` | Added in memory on load from details, then included in a later explicit export unless future work stops synthesis |
| `pocketGuard` | Derived for each export from instance and source metadata |

Outline block `order` is persisted but derived in the active PE view. Array order is operationally authoritative.

None of the P012 source-binding fields is added to a node or the root truth schema. They exist only in the opening popup payload, subsequent save attempts and structured apply/save results.

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

The preceding table includes read-time and editing-view normalisation. P012 adds a separate explicit-save boundary:

| Explicit PE save input | Accepted maximum or shape | Rejection reason |
| --- | --- | --- |
| Title after full `cleanText()` whitespace normalisation | 220 characters | `title-too-long` |
| Readable body after full `normaliseDetails()` whitespace normalisation | 4,000 characters | `details-too-long` |
| Outline schema and mode | Exact `pocket.nodeEditor.v1` and `outline` | `invalid-outline` |
| Outline container | Array with at most 400 rows | `invalid-outline` or `outline-too-many-blocks` |
| Outline meaning and cloneability | JSON-compatible and meaningful under the exact current-v1 rules | `invalid-outline` |
| Outline row | Non-null, non-array object | `invalid-outline-block` |
| Row ID | String which cleans to 1 through 80 characters | `invalid-outline-id` or `outline-id-too-long` |
| Row-ID uniqueness | Unique after cleaning | `duplicate-outline-block-id` |
| Row text | String or absent/null; carriage returns removed before counting; at most 4,000 characters | `invalid-outline-block` or `outline-block-text-too-long` |
| Row depth | Finite integer from 0 through 8 | `invalid-outline-depth` |
| Row collapse state | Boolean when the property is present; omission means false under canonical normalisation | `invalid-outline-block` |

Exact boundaries are accepted: title 220, body 4,000, 400 Outline rows, block text 4,000, ID 80, and depths 0 and 8. The next value is rejected. Fractional, non-finite, negative and above-8 depths are rejected rather than rounded or clamped at save time. Text-mode save checks title and body but deliberately ignores an unused `outline` member.

These checks inspect the unsliced input. Only after they pass may `prepareSave()` call the existing canonical normalisers. There is no “save anyway”, trimming choice, duplicate-ID rewrite or automatic row deletion.

The 400-block and 4,000-character block limits still apply to the supported editing view, not to first-class raw preservation. A larger raw editor remains in state and exports unchanged when the node is not explicitly saved. Before an explicit Outline save, `validateStoredEditorForSave()` also scans a currently supported node's stored raw Outline. That defence blocks an Outline save when the editable view would already have hidden rows, oversized text, duplicate cleaned IDs, excessive IDs, invalid depth, invalid row shape or invalid collapse state. Missing stored IDs remain compatible because the generated runtime supplies IDs before an explicit save. The scan does not repair or mutate loaded data.

The stored-raw scan intentionally does not redefine the P013-unresolved Text conversion boundary. A changed explicit Text save can still delete accepted Outline metadata, including raw metadata which the Outline path would refuse to overwrite. That remains a clearly named CURRENT-RISK, not an endorsed data-loss policy.

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

Every `buildPocketPayload()` output is `portal.export.v1`, regardless of the loaded input schema. P012 does not grant a lossless round-trip promise to unknown root schemas.

## 11. PE payload and apply contract

### Opening payloads

All opening payloads contain:

~~~text
id, title, body, mode, outline, path, openedAt, updatedAt,
fileSessionId, sourceFileName, sourcePipSession, originalUpdatedAt
~~~

A supported Outline payload also contains `schema: "pocket.nodeEditor.v1"`.

The source binding is deliberately popup-safe:

- `fileSessionId` is the authoritative identity token.
- `sourceFileName` is a cleaned display diagnostic only. Equal filenames do not make two sessions equal.
- `sourcePipSession` is a diagnostic boolean.
- `originalUpdatedAt` is the exact normalised node revision captured at opening.
- no `FileSystemFileHandle`, picker, callback, mutable state object, raw file object or browser permission is included.

`PocketNodePopoutRuntime` returns these fields unchanged on every save attempt. It does not generate a new session identity or replace the original revision with the clock.

The runtime also sends the unsliced title, readable body and Outline rows to the main window. Oversized and duplicate-row payload tests confirm that the popup does not pre-trim away the evidence needed by authoritative main-window preflight. The popup performs only the local completeness check for its source binding before contacting the opener.

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

Unsupported read-only payloads may carry the safe source binding, but it cannot make them editable and the popup never sends a save.

### Document-session contract

`pocketFileSessionId` is runtime-only. `capturePocketEditorSourceIdentity()` exposes only the three safe opening fields, while `capturePocketFileSaveSession()` separately retains the main-window handle for queued truth writes. `isPocketEditorSourceIdentityCurrent()` compares the numeric session token. It does not use the filename as identity.

A fresh session token is established when a different document state is successfully adopted:

- a selected Pocket JSON file is loaded, including a successful reload of the same handle;
- a new Pocket file is created;
- PiP snapshot state is restored;
- PiP session state is adopted back into a host;
- a local safety snapshot is restored;
- an encrypted Vault payload is opened; and
- a newly picked truth-file target is successfully written and adopted.

File parsing or permission failure does not discard the previously active session. A failed write also leaves the current binding available for an explicit retry. `setPocketFileSession(..., { forceNewSession: true })` is used only for a genuine document adoption. A routine successful write to the already active handle refreshes diagnostics without incrementing the session.

For save-as, `writeTruthFile()` verifies the old queued session before and after picker/write stages. A successful picked-file result names the old session it adopted from and returns the newly active safe source identity. `exportTree()` recognises only that precise handoff as a legitimate session transition. The popup adopts the new identity only after `ok: true` and `exported: true`.

### Ordered main-window gate

`PocketNodePopoutEditor.applyPayload()` fails closed in this order:

1. `canModifyPocket()` confirms a current modifiable Pocket document.
2. The payload must contain a complete JSON-safe source-identity shape.
3. The source session ID must equal the active document session.
4. The supplied node ID is validated, then resolved explicitly through `PocketNodePopoutTarget.getById()`.
5. The target node must still exist.
6. `originalUpdatedAt` must be present and valid.
7. It must equal the current node's normalised `updatedAt`.
8. The current node is reclassified under the P011 unsupported-editor gate.
9. Stored-raw loss scan and raw payload preflight must both pass.
10. Only then are before/after values calculated and any mutation applied.
11. Only a successful changed apply records an operation or refreshes workspace/PiP safety state. Truth export can begin only after apply succeeds, either for that change or to retry an already pending operation.

The session check precedes node lookup. A stale PE from file A therefore cannot resolve and mutate a same-ID node in file B. Rejection does not change node content, `updatedAt`, selection, operation history, browser safety state, PiP snapshot or truth file.

| Safety failure | Structured reason | User-facing meaning |
| --- | --- | --- |
| No current modifiable document | `no-pocket-file` | There is no writable Pocket file for this save |
| Missing or malformed safe identity | `missing-source-identity` | Pocket cannot verify where the editor belongs |
| Session token differs | `file-session-changed` | Pocket is now using a different document |
| Target cannot be resolved | `missing-node` | The original item no longer exists |
| Missing original revision | `missing-node-revision` | Pocket cannot verify which item revision was opened |
| Current revision differs | `node-revision-changed` | The item changed after the editor opened |
| Unsupported current editor data | `unsupported-editor` | This Pocket version cannot safely edit the item |
| Raw input outside the save contract | Specific reason from the limits table | Nothing is trimmed, repaired or applied |

### Applying

`PocketNodePopoutEditor.apply()` reaches private `applyPayload()` and:

- requires a current modifiable file/session;
- validates source identity before resolving a node;
- resolves only the explicit payload ID, never the current selection fallback;
- rejects a missing node with `missing-node`;
- rejects missing binding or revision with `missing-source-identity` or `missing-node-revision`;
- rejects a changed document session with `file-session-changed`;
- rejects a changed node revision with `node-revision-changed`;
- reclassifies the current node before any mutation;
- rejects an unsupported or malformed current editor with reason `unsupported-editor`;
- runs the stored-raw and incoming-payload preflight before normalisation;
- records no operation and invokes no export for any rejection;
- compares normalised before and after title, details and supported editor metadata;
- returns success without an operation for unchanged content, including the current revision and source identity;
- applies by ID even if lexical `state.selectedId` names another node;
- writes title and details only after the unsliced values are within current caps;
- writes supported Outline metadata or deletes accepted editor metadata for changed Text;
- advances `node.updatedAt`, forcing at least one millisecond of monotonic progress if the clock has not moved;
- records one `details_edit` operation; and
- invokes UI, workspace and PiP refresh surfaces.

The defence is based on the current node, not a caller-supplied `readOnly` flag. `applyAndSave()` returns `applied: false`, `exported: false`, and reason `unsupported-editor` without reaching `exportTree()`.

The canonical cutover no longer opens the unbound legacy editor when the safe standalone editor cannot open. Older `PocketEditorPopout.apply()` calls delegate to the canonical apply owner and therefore fail closed without a P012 binding. The older PE dirty/save bridge delegates `applyAndSave()` to the canonical owner. There is no active legacy mutation path which bypasses identity, revision or preflight checks.

The generated editable Outline runtime stamps the exact v1 schema on save. Text payloads remain schema-free. Both modes carry the opening source session and original node revision to the main-window gate.

### Applying and requesting persistence

`applyAndSave()` returns a structured result. Current outcomes for supported or ordinary editable nodes are:

| Outcome | `applyAndSave()` result |
| --- | --- |
| Rejected before apply | `ok: false`, `applied: false`, `exported: false`, precise safety reason |
| Changed apply plus successful truth write | `ok: true`, `applied: true`, `changed: true`, `exported: true`, reason `exported` |
| Unchanged apply with no pending operation | `ok: true`, `applied: false`, `changed: false`, `exported: false`, reason `unchanged` |
| Unchanged apply with a pending lexical operation | Truth export is retried rather than skipped |
| Changed apply plus cancel/failure/stale guard | `ok: false`, `applied: true`, `exported: false`, precise export reason and the new node revision |
| Download fallback only | `ok: false`, `applied: true`, `exported: false`, `downloaded: true`, reason `downloaded-copy` |
| No export function | `ok: false`, `applied: true`, `exported: false`, reason `export-unavailable` |
| Thrown/rejected export | `ok: false`, `applied: true`, `exported: false`, reason `write-failed` |

Recognised failure reasons include `file-session-changed`, `cancelled`, `stale-guard`, `no-pocket-file`, `permission-denied`, `write-failed`, `downloaded-copy` and `export-unavailable`. The generated runtime maps these and the identity/revision/preflight reasons to calm, specific status and alert text rather than collapsing them into a generic failure.

After an export failure, the supported in-memory mutation and its operation remain pending. The result includes `nodeUpdatedAt`; the popup adopts that revision whenever `applied: true`, while remaining dirty. A second unchanged save then passes the revision check. `getPocketUnsavedOperationCount()` reads lexical `state.ops` without exposing mutable state, so that retry still invokes `exportTree()`. A successful retry clears dirty only after truth persistence succeeds.

After a successful picked-file save, the result also includes the newly active `sourceIdentity`. The popup adopts it only with successful persistence. It does not adopt the identity of a different file after a rejected switch or stale queued save.

The generated runtime tracks an edit generation for an in-flight save. If the user makes a newer edit before the earlier save completes, that earlier success does not clear the newer dirty state. Save & Close closes only after successful truth persistence, or a genuinely unchanged save with no pending operation and no newer edit. Every rejection and every applied-but-not-exported result leaves the popup open and dirty.

| Popup result | Revision adopted | Source identity adopted | Dirty/close result |
| --- | --- | --- | --- |
| Rejected before apply | No | No | Dirty; stays open |
| Applied, export failed/cancelled/paused | Yes, the revision created by this apply | No | Dirty; stays open and retryable |
| Export succeeded to active handle | Yes | Returned current identity, which remains the same session | Clean; Save & Close may close |
| Export succeeded through picked-file adoption | Yes | Yes, the new session identity | Clean; Save & Close may close |
| Save response succeeds but a newer popup edit exists | Yes for the saved generation | Only on successful export | Newer content remains dirty; no close |
| Read-only unsupported editor | Not applicable | Not applicable | Always clean, never saves |

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

P011 additionally verified that local safety snapshot, safety trail, auto-cache and PiP recovery routes preserve raw large current editor objects, raw unknown editor objects and raw legacy `pe` values. Recovery normalisation does not convert their schema or trim them to the generic extras cap.

P012 treats adopting recovered, PiP or Vault state as a new document session even when the writable handle is unchanged. That invalidates existing PE source bindings before the replacement tree can be edited. This session renewal is in-memory safety state, not a truth-file write. Browser safety snapshots remain recovery support rather than working truth.

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
- Every canonical editable opening carries a safe document-session token and exact original node revision, with no handle or mutable state.
- A same-name or same-handle reload establishes a new session and invalidates older PE openings.
- Routine successful writes to the already active handle do not invalidate a still-open PE.
- File A/B same-ID, missing identity, stale node and missing node saves reject before mutation, operation recording or export.
- A change to another node does not invalidate the target node's PE.
- Raw title, body, row-count, row-text, ID, uniqueness, depth, collapse and Outline-shape checks run before slicing normalisers.
- Existing supported raw Outline data is scanned before explicit Outline save so a truncated editing view cannot overwrite the preserved raw object as Outline.
- Every preflight rejection leaves the node, operation list, workspace safety state, PiP snapshot and truth-write surfaces unchanged.
- Changed apply returns the new node revision whether export succeeds or fails.
- Failed or cancelled export keeps the popup dirty, and a retry can export its pending lexical operation without exposing `state`.
- Successful save-as returns and adopts the new safe source identity.
- The popup cannot become clean or close through Save & Close until persistence succeeds; newer edits made during an in-flight save also remain dirty.
- Legacy apply/save routes delegate to the canonical owner or fail closed.
- The selected truth file is not written merely by `applyLoadedState()`.
- Browser recovery storage remains distinguishable from truth persistence.
- Valid saved Outlines open from the editor array rather than reparsing body text.
- Generated editable Outline saves carry the exact v1 schema.
- `buildPocketPayload()` emits guarded top-level and nested tree copies.
- Text normalisation retains its tested whitespace and 4,000-character policy.
- Changed supported applies record one `details_edit` operation; unchanged applies record none.
- Failed controlled export results preserve their meaningful reason and do not falsely report truth persistence.
- Generated runtime programs compile for Text, saved Outline and rejected metadata payloads.
- P008 Text-to-Outline uses the shared structured-paste parser.
- Spaces, tabs, mixed indentation and common leading indentation retain hierarchy.
- Blank Text lines are filtered and empty Outline rendering supplies one fresh blank row.
- Text to Outline to Text normalises to two-space indentation without flattening.
- Copy context remains details-first and ignores editor metadata.

P012 preserves Main Save ownership, existing queued export/expected-handle protection, P011 unsupported-editor compatibility, P006 selection/subtree actions, P007 Escape ordering, P008 indentation conversion, structured paste, details-first copy context, the one Enter owner and truth-write routing.

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
| Duplicate block IDs | Raw duplicates retained | PE view retains duplicates | Explicit Outline save is blocked before mutation; untouched export retains raw | Stable Outline-save defence; read-view compatibility |
| Invalid or excessive depth | Raw value retained | PE view rounds/clamps for display | Explicit Outline save is blocked while stored raw data remains invalid; untouched export retains raw | Stable Outline-save defence; read-view compatibility |
| More than 400 blocks or block text above 4,000 | Large raw editor retained | Supported view may slice at current caps | Explicit Outline save is blocked by stored-raw scan; untouched export retains raw | Stable Outline-save defence; read-view compatibility |
| Mismatched details and supported Outline | Both retained | Outline wins mode while body remains independent | Drift survives untouched export | Current-risk |
| Large or unknown `pe` | Raw value retained outside extras caps | Ignored by active standalone PE | Raw value retained through export and recovery | Compatibility |
| PE bound to current file and matching node revision | Node resolves by explicit ID | Editable Text or Outline | Valid save applies and exports normally | Stable |
| PE from an older file session, including same filename/ID | Active tree remains untouched | Stale popup remains dirty and readable/editable for copying | No operation, export, picker or write | Stable rejection |
| PE with stale target-node revision | Current newer node remains untouched | Stale popup remains dirty | No operation or export | Stable rejection |
| PE whose target node was deleted | No replacement lookup | Popup remains dirty | No operation or export | Stable rejection |
| PE with over-limit or structurally unsafe raw save payload | Loaded state remains untouched | Exact issue and limit reported | No truncation, operation or export | Stable rejection |
| Changed apply followed by failed/cancelled export | New in-memory revision and operation remain pending | Popup adopts its own new revision and remains dirty | Later unchanged retry exports pending operation | Stable retry |
| Successful save-as to a picked file | New target becomes active with a new session | Still-open popup adopts returned identity | Later saves target the adopted document | Stable |
| Unknown root schema with top-level tree | Best-effort top-level load | Nodes follow their individual PE rules | Export schema becomes `portal.export.v1` | Unsupported/unknown |
| Unknown root schema with nested-data-only tree | No nodes loaded | No PE target | Empty normalised state if later exported | Unsupported/unknown |

P011's cross-version promise remains deliberately narrow. Current Pocket preserves unsupported editor JSON on unrelated load, recovery and export routes and shows only persisted `details` read-only. It does not promise that `details` exactly represents a future editor, that an older Pocket build will preserve fields it does not know, or that unsupported content can be edited bidirectionally.

Existing `node.pe` remains opaque compatibility data and is not synchronised by standalone PE edits. Raw arrays still load as `array.nodes`; `portal.mtt.web.v1`, `portal.sync.v1` and `portal.pocketlite.changes.v1` retain their established nested-container routes.

## 15. Current-risk characterisation assertions

The suite retains these seven explicitly named characterisation tests:

1. `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
   - Read-time supported-view normalisation retains duplicates. P012 separately blocks any explicit Outline save while duplicate cleaned IDs exist.
2. `CURRENT-RISK: Outline normalisation silently slices block 401`
   - The detached editing view still has a 400-row cap. P012's stored-raw scan prevents that view from overwriting the larger preserved raw object.
3. `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
   - The detached editing view still has a 4,000-character row cap. P012 blocks explicit save before the preserved raw text can be lost.
4. `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
   - Load is truth-write-free but not shape-neutral in memory.
5. `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
   - Mode/content selection and body projection can disagree.
6. `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
   - A data-only extension is not retained on this route.
7. `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`
   - Explicit Text persistence removes IDs, depths and collapse metadata.

P012 replaces these former CURRENT-RISK observations with positive safety assertions:

- missing file-session and original-node identity;
- unchanged save being unable to see lexical pending operations;
- explicit save silently accepting row 401 or row text at 4,001 characters;
- explicit apply silently truncating title or body; and
- explicit save accepting duplicate row IDs.

The three retained read-view limit/duplicate tests do not grant permission to persist a lossy normalised Outline view. Their companion P012 tests prove explicit Outline-save rejection and zero mutation. The changed-Text deletion risk is intentionally retained separately for P013.

These tests freeze observations, not product policy. The seven named weaknesses remain present after P012. Details/editor equality and destructive Text/Outline conversion remain P013 work. Load-time `node.pe` synthesis remains P014 work.

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
| Block IDs/depth/order | Read view plus explicit-save missing/duplicate/80/81 and depth 0/8/-1/9/fractional/non-finite checks | Stable save defence plus CURRENT-RISK read duplicates |
| Outline limits | Read view and explicit save at 399/400/401 blocks and 3,999/4,000/4,001 block text | Stable non-lossy save defence plus CURRENT-RISK read slicing |
| Native Outline open | IDs, depths, collapse, body drift and no reparse | Stable plus CURRENT-RISK drift |
| Unsupported PE view | Read-only Text/details, warning, raw exclusion, disabled controls, Cmd/Ctrl+S, Escape and Close | Stable compatibility |
| Apply defence | Unsupported apply and `applyAndSave()` with zero mutation, operation and export | Stable |
| Cutover and legacy defence | Canonical open only; old apply/save surfaces delegate to the safe owner or fail closed | Stable |
| Unrelated edit | Raw unknown, malformed, large current editor and large `pe` preserved | Stable |
| Recovery routes | Safety snapshot/trail, auto-cache and PiP with large and unknown metadata | Stable |
| Load-time synthesis | No op, browser keys, zero truth surfaces and later export shape | CURRENT-RISK |
| Root export | Schema, timestamps, guards, dual trees, tombstones, extras and detached clones | Stable |
| Compact round trips | Text, empty, v1, malformed, unknown, drift and extras | Mixed |
| Document identity | Valid, missing, malformed, wrong session, same-name A/B, PiP, same-handle reload and picked-file adoption | Stable |
| Node revision | Match, missing, label/details/editor stale changes, unrelated-node change, deletion and successive saves | Stable |
| Raw preflight | Title/body, block count/text, ID, duplicates, depth, malformed Outline, exact schema and Text unused Outline | Stable non-lossy save defence |
| Rejection side effects | Exact node/editor/`pe`/revision/ops plus workspace, PiP, export, writer and picker counts | Stable |
| Retry | Cancel, throw/write failure, stale guard, revision adoption, lexical pending op and successful second export | Stable |
| Queued write | Active session switched before queued write runs; new file is not written | Stable |
| PE apply | Explicit ID, dual Outline write, Text deletion, unchanged detection, operation and limits | Mixed, with P013 Text conversion risk |
| PE save request | Success and precise cancel/stale/session/no-file/write/download/unavailable propagation | Stable |
| Lexical operation helper | Read-only count supports unchanged retry without exposing mutable `state` | Stable |
| Generated runtime | Compile states, bound Text/Outline payloads, read-only, rejection, retry, revision/identity adoption, parser, round trips and empty renderer | Stable |
| P006/P007 runtime regressions | Subtree Copy, Paste-after-selection, Duplicate, Delete and Escape menu/dialog/row/close ordering | Stable |
| Copy context | Details first, label fallback and editor ignored | Stable |
| Main-tree Enter ownership | Active scripts retain `handleTreeKeydown` as the sole owner | Stable |

The focused P012 suite reports 77 tests, 77 passes and 0 failures on Node `v23.11.0`.

## 18. Change protocol for P013 and later tasks

Any later task that changes a tested contract must:

1. identify whether the assertion is stable, compatibility or CURRENT-RISK;
2. preserve the synthetic input demonstrating the old boundary unless it is genuinely obsolete;
3. change production, tests and this document in the same task;
4. replace a fixed CURRENT-RISK name with a positive contract name;
5. prove opening alone still performs no truth-file write;
6. keep browser safety writes distinct from truth persistence;
7. preserve raw unsupported metadata through unrelated paths;
8. test both sides of every changed cap or schema gate;
9. preserve the P012 check order and assert zero mutation for every new rejection;
10. compile and exercise generated runtime whenever payload or runtime shape changes;
11. test failed persistence and retry whenever apply/export semantics change;
12. rehearse any destructive migration only with disposable copies; and
13. require Murray's product decision before changing conversion meaning, older-version promises or migration triggers.

Tentative next boundaries remain:

- **P013, explicit Text/Outline conversion:** define whether Text on a saved Outline is projection-only or an explicit destructive conversion. Preserve IDs and collapse state unless the user confirms conversion. Murray must decide the product meaning before implementation.
- **P014, retire `node.pe` as live content:** stop load-time synthesis and stale search use while continuing to preserve existing raw `pe` values. No existing value may be deleted automatically. Murray must confirm preserve-and-stop-generating rather than promotion or synchronisation.

P012 does not approve those phases. No future task should make opening a file silently migrate it. Ordinary explicit Save must not mass-rewrite untouched nodes merely because a newer reader recognised them.

P012 closes the specific lexical-operation visibility gap with `getPocketUnsavedOperationCount()`. Future work must keep that surface narrow and read-only. It must not expose `window.state` or permit callers to replace `state.ops`.

## 19. Non-goals

P012 does not add or propose:

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
- persisted file-session or revision fields in the truth schema;
- automatic merge, rebase or last-writer-wins;
- “save anyway”, explicit truncation or automatic duplicate-ID repair;
- new Text/Outline conversion semantics;
- changes to existing title, details, block or depth caps;
- changes to Main Save, PE Save ownership or active-file protections;
- changes to P006 selection, subtree, Paste, Duplicate or Delete behaviour;
- changes to P007 Escape ordering;
- changes to P008 indentation conversion;
- changes to details-first copy context or the one active main-tree Enter owner; or
- inspection or testing of Murray's personal Pocket files.

Future desired behaviour remains documented in `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`. P012's role is narrower: bind explicit PE saves to their source, reject stale or lossy saves, and preserve retry without silently migrating Pocket's explicit truth file.
