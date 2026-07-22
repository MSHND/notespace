# PE Persistence Contract

P010 records and tests the persistence behaviour that exists on the accepted P009 baseline. It is a characterisation contract, not a declaration that every observed behaviour is desirable.

The terms used below are deliberate:

- **Stable** means behaviour that future work should preserve unless Murray explicitly changes the product contract.
- **Compatibility** means behaviour retained for existing Pocket inputs, but not necessarily preferred for new data.
- **CURRENT-RISK** means an executable test freezes a known weakness so a later fix can replace the observation deliberately.
- **Unsupported/unknown** means the current code has no reliable interpretation or compatibility promise.
- **Future desired** means a direction from the P009 migration plan that P010 does not implement.

No current truth-file schema migration occurred in P010. Production behaviour is unchanged. The fixtures are synthetic, and no personal Pocket truth file was read or written.

## 1. Purpose and scope

This contract provides an executable baseline before P011 changes load ownership or metadata preservation. It covers:

- active `index.html` script load order and normalisation ownership;
- accepted root shapes and precedence;
- node, Text, Outline, extras and editor boundaries;
- load-time `node.pe` synthesis;
- current PE opening and apply payloads;
- operation recording and controlled `applyAndSave()` outcomes;
- root export construction;
- compact load/export round trips;
- generated PE runtime compilation and P008 indentation parsing; and
- details-first copy context.

P010 distinguishes opening a file from explicitly writing the selected truth file. It also distinguishes browser `localStorage` recovery writes from truth-file persistence.

P010 does not fix any observed weakness. Every CURRENT-RISK test is expected to pass while that weakness remains. A later task that fixes one must replace the corresponding expectation rather than preserving the bug for the sake of a green suite.

## 2. How to run the focused test

From the repository root:

```sh
node --test tests/pe-persistence-contract.test.js
```

The suite uses Node built-ins only: `node:test`, `node:assert/strict`, `node:fs`, `node:path` and `node:vm`. It adds no dependency and requires no package script.

The harness:

- reads only repository source and synthetic fixtures;
- executes actual browser-global scripts in isolated VM contexts;
- derives the relevant source order from actual `index.html` script tags;
- replaces only UI and file-system surfaces with controlled in-memory shims;
- records browser `localStorage` activity separately;
- does not load `js/pocket-io-browser.js` or create a file handle;
- does not invoke a picker, `writeTruthFile()`, or a real `exportTree()`; and
- makes temporary generated-runtime instrumentation in memory only.

## 3. Source files exercised

The suite parses or executes the following current production sources:

| File | Functions or contract exercised |
| --- | --- |
| `index.html` | Actual classic-script order |
| `js/pocket-state.js` | Lexical state and runtime constants |
| `js/pocket-data.js` | `cleanText()`, `normaliseDetails()`, `safeJsonClone()`, `normaliseNodeExtras()`, `normaliseRootExtras()` |
| `js/pocket-editor-metadata.js` | Intermediate `normaliseNodesWithEditor()` ownership and overwrite interaction |
| `js/pocket-pe-import-preserve.js` | Intermediate `normaliseNodesPreservingPe()` wrapper |
| `js/pocket-storage.js` | `buildPocketPayload()`, `buildPeFromLegacyDetails()`, `ensurePeFromLegacyDetails()`, `applyLoadedState()` and browser safety snapshots |
| `js/pocket-import.js` | Final `normaliseNodes()`, `normaliseInput()`, `nodeMap()` and PiP snapshot activity |
| `js/pocket-editor-copy.js` | `collapseAllNodes()`, `getPath()` and `copyContextPayloadForNode()` |
| `js/pocket-history-status.js` | Actual `recordOp()` path used by PE apply |
| `js/pocket-node-popout-model.js` | `normaliseEditorMeta()` and `buildPayload()` |
| `js/pocket-node-popout-target.js` | Node resolution by explicit ID and current `window.state` fallback |
| `js/pocket-node-popout-editor.js` | `applyPayload()` through public `apply()` and `applyAndSave()` |
| `js/pocket-node-popout-runtime.js` | Actual generated program, shared indentation parser, Text/Outline projection and empty-row rendering fallback |

`js/pocket-io-browser.js` remains the production truth-write owner, but the P010 suite deliberately does not execute it. Tests of `applyAndSave()` inject an in-memory `exportTree()` result and separately assert that picker and `writeTruthFile()` spies remain untouched.

## 4. Current persisted root shape

`buildPocketPayload()` emits this broad shape:

```json
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
```

Verified export rules:

- `schema` is always rewritten as `portal.export.v1`.
- `exportedAt` and `writtenAt` are the same supplied or generated timestamp.
- `pocketGuard` occurs at the top level and inside `data` with equivalent content.
- The top-level and nested trees contain equivalent cloned node data.
- The top-level and nested tombstone arrays contain equivalent cloned data.
- `state.rootExtras` is spread into the root before owned root fields.
- `state.dataExtras` is spread into `data` before owned data fields.
- Owned schema, guard, tree and tombstone fields win over conflicting extras.
- Surviving `editor`, `pe`, and unknown node fields in `state.nodes` are serialised without another node-normalisation pass.
- The returned tree is detached from later mutations to `state.nodes`.

Tombstone entries are selected from the winning root container and copied as an array. The active input normaliser does not apply a tombstone item schema or item-count limit.

## 5. Current Text-node contract

A representative persisted Text node is:

```json
{
  "id": "text_1",
  "parentId": "root",
  "label": "Text note",
  "order": 1000,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "source": "manual",
  "details": "Parent\n  Child"
}
```

Current rules:

- `node.details` is the Text body.
- Empty or whitespace-only details normalise to `""` and the `details` property is omitted.
- A node opens in Text when `PocketNodePopoutModel.normaliseEditorMeta(node.editor)` returns `null`.
- The opening payload uses normalised details, a normalised title, `mode: "text"`, and `outline: null`.
- A changed Text apply writes the supplied normalised body to `details`, or deletes `details` when the body is empty.
- A changed Text apply deletes `node.editor`, including previously accepted Outline metadata.
- An unchanged Text apply does not rewrite a small malformed raw `editor` object because both its before and after accepted editor views are `null`.
- `node.pe` is not used by the standalone PE for opening or applying Text.

On active load, a details-bearing node without its own `pe` property gains an in-memory `pocket.pe.v1` Text object through `ensurePeFromLegacyDetails()`. That is CURRENT-RISK compatibility behaviour, not the Text canonical model. An own `pe` property, including `pe: null`, prevents synthesis.

## 6. Current Outline-node contract

A representative persisted saved Outline node is:

```json
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
```

The active PE model accepts an Outline when:

- the input is a non-null object;
- `mode`, after cleaning and lower-casing, is `outline`;
- `outline` is an array; and
- at least one retained block has non-empty cleaned text, depth above zero, or `collapsed: true`.

A flat non-empty Outline is accepted. An empty array and one blank depth-0 uncollapsed row are rejected as non-meaningful and open in Text. A blank collapsed row is accepted.

For an accepted saved Outline:

- PE opens in Outline without reparsing `details`;
- saved non-empty IDs, depths and collapse state survive accepted normalisation within current limits;
- array position wins and `order` is regenerated as `index + 1`;
- `details` remains a separate body value in the opening payload;
- the active model does not verify the incoming schema string;
- a normalised result is labelled `pocket.nodeEditor.v1`; and
- unknown editor and block fields are not present in the normalised PE view.

The generated runtime normally builds the save body from `outlineToText(outline)`, producing two spaces per depth. `applyPayload()` itself does not verify that `payload.body` matches `payload.outline`. A caller can therefore write independent details and Outline content.

An Outline apply writes both:

- `node.editor`, from `PocketNodePopoutModel.normaliseEditorMeta(payload)`; and
- `node.details`, from the independently normalised `payload.body`.

It leaves an existing `node.pe` untouched.

## 7. Runtime-only and derived fields

The following are not independent persisted PE truth fields:

| Field or representation | Status |
| --- | --- |
| PE opening `path` | Runtime-derived from `getPath(node.id)` |
| PE opening `openedAt` | Runtime timestamp |
| PE opening `updatedAt` | Runtime timestamp, not the original node revision |
| Popup `dirty`, `allowedToClose`, selection and menu state | Runtime-only |
| Runtime Outline blocks created from Text | Derived from the current textarea through the shared structured-paste parser |
| Runtime block IDs created during Text conversion | Fresh runtime values, persisted only after a successful apply and truth export |
| Outline body text | Derived by `outlineToText()` in the normal generated-runtime save path |
| `state.ops` | Runtime operation history and dirty signal, copied into recovery representations but not the root truth payload |
| `state.collapsed`, `selectedId`, `focusRootId` | Workspace/runtime state, not node Outline collapse metadata |
| Synthesised `node.pe` | Added in memory on load from details, then included in a later explicit export unless removed by future work |
| `pocketGuard` | Derived for each export from instance and source metadata |

Outline block `order` is persisted but derived. Array order is operationally authoritative.

## 8. Script-load and normalisation ownership

The suite derives and executes this relevant order from `index.html`:

1. `js/pocket-state.js`
2. `js/pocket-data.js`
3. `js/pocket-editor-metadata.js`
4. `js/pocket-pe-import-preserve.js`
5. `js/pocket-storage.js`
6. `js/pocket-import.js`

Observed ownership transitions:

- `pocket-editor-metadata.js` assigns `window.normaliseNodes` to `normaliseNodesWithEditor()`.
- `pocket-pe-import-preserve.js` wraps that function with `normaliseNodesPreservingPe()` and marks the wrapper.
- `pocket-storage.js` leaves the wrapper in place.
- the later top-level `normaliseNodes()` declaration in `pocket-import.js` replaces it.
- `window.__pocketPeImportPreserveInstalled` remains true even though its wrapper is no longer the active function.

The final active owner is therefore the generic importer. `editor` and `pe` are not in `RESERVED_NODE_KEYS`; they are treated as generic node extras.

There is a second verified trap for P011. Even the intermediate `normaliseNodesWithEditor()` computes an editor-aware value and then runs `Object.assign(payload, extras)`. Because `editor` is still a generic extra, a small raw `editor` object can overwrite the explicit normalised value. Reordering scripts alone is not a complete repair. P011 must establish one owner and reserve first-class metadata from generic extras.

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
| Details carriage returns | All `\r` removed | `A\rB\r\nC` becomes `AB\nC` |
| Details tabs | Each tab becomes two spaces | Applies anywhere in the body |
| Details trailing whitespace | Removed per line | Outer result also trimmed |
| Details blank runs | Three or more newlines become two | At most one blank line remains between content |
| Empty details | Omitted | Empty and whitespace-only inputs have no `details` field after node normalisation |
| Generic node extras | First 24 accepted entries | Later entries are not examined once 24 have been retained |
| Generic node-extra key | 48, restricted character set | Must match `[a-zA-Z0-9_.:-]+` after cleaning |
| Generic node-extra string | 1,200 | Silently sliced |
| Generic node-extra object/array | At most 8,000 | 8,000 retained; 8,001 dropped |
| Generic root extras | First 32 accepted entries | Root and `data` use the same normaliser when selected |
| Generic root-extra key | 64, restricted character set | Same allowed character set as node extras |
| Generic root-extra string | 2,000 | Silently sliced |
| Generic root-extra object/array | At most 12,000 | 12,000 retained; 12,001 dropped |
| Active PE editor blocks | 400 | 399 and 400 retained; block 401 discarded |
| Active PE block text | 4,000 | 3,999 and 4,000 retained; 4,001 sliced |
| Active PE block ID | Cleaned to 80 | Missing ID generated; duplicate non-empty IDs retained |
| Active PE block depth | Rounded and clamped 0 to 8 | Negative becomes 0; `1.6` becomes 2; excessive becomes 8 |
| Active PE block collapse | Strict `=== true` | Other values become false |
| Active PE block order | `index + 1` | Incoming order ignored |
| Active PE schema | Not checked on input | Accepted shape is rewritten as `pocket.nodeEditor.v1` |
| Runtime Text-to-Outline depth | Clamped 0 to 8 | Tabs and inferred space units supported; shallowest line aligned to base |
| Runtime blank Text lines | Filtered | Empty conversion yields no blocks; renderer supplies one fresh blank row |

The active generic loader does not apply the larger limits declared by `normalisePocketPe()` in `pocket-editor-metadata.js`. A small `pe` object survives raw as a generic extra; an oversized one can be dropped or displaced by the 24-extra budget. A newly synthesised `pe.text` is based on the already normalised, at-most-4,000-character details body.

## 10. Load/export precedence

`normaliseInput()` currently selects data as follows:

| Input state | Winning tree and tombstones | Extras result |
| --- | --- | --- |
| `portal.export.v1` with top and nested trees | Top-level `mainThoughtTree` | Root extras captured; nested `data` extras not captured |
| `portal.mtt.web.v1` | `data.mainThoughtTree` | Root and data extras captured separately |
| `portal.sync.v1` | `data.mainThoughtTree` | Root and data extras captured separately |
| `portal.pocketlite.changes.v1` | `snapshot.data.mainThoughtTree` | Root extras from outer object; data extras from snapshot data |
| Raw array | Array itself | Schema becomes `array.nodes`; no extras |
| Unknown schema with top-level `mainThoughtTree` | Top-level tree | Unknown schema string retained; bounded root extras retained |
| Unknown schema with nested-data-only tree | No nodes | Returned schema becomes empty; nested tree is unsupported |

For `portal.export.v1`, top-level tree precedence is stable current compatibility because Pocket emits both copies. However, ignoring nested data extras is a CURRENT-RISK loss path. A later export rebuilds `data` from empty `state.dataExtras`, so a data-only extension disappears.

Every `buildPocketPayload()` output is `portal.export.v1`, regardless of the loaded input schema. P010 does not grant a lossless round-trip promise to unknown root schemas.

## 11. PE payload and apply contract

### Opening payload

`PocketNodePopoutModel.buildPayload(node)` returns exactly:

```text
id, title, body, mode, outline, path, openedAt, updatedAt
```

Verified absences:

- no file-session ID;
- no source filename identity;
- no writable handle identity; and
- no original node revision field.

The payload's `updatedAt` is generated at open time. It is not a copy of `node.updatedAt` and cannot be used as an optimistic-concurrency token.

### Applying

`PocketNodePopoutEditor.apply()` reaches private `applyPayload()` and:

- requires the current Pocket file gate when that gate is available;
- resolves the current node by explicit payload ID;
- compares normalised before/after title, details and accepted editor metadata;
- returns success without an operation for unchanged content;
- applies by ID even if lexical `state.selectedId` names a different node;
- writes title and details within current caps;
- writes accepted Outline metadata or deletes editor metadata for a changed Text payload;
- updates `node.updatedAt`;
- records one `details_edit` operation through actual `recordOp()`; and
- invokes UI, workspace and PiP refresh surfaces.

There is no source-file session binding or original-node revision preflight before mutation. That remains future work.

### Applying and requesting persistence

The test replaces `exportTree()` with an in-memory result. Actual current outcomes are:

| Controlled export result | `applyAndSave()` result |
| --- | --- |
| `{ ok: true }` after a changed apply | `ok: true`, `exported: true`, reason `exported` |
| `false` or `{ ok: false }` | `ok: false`, `exported: false`, reason `export-failed-or-cancelled` |
| `{ downloaded: true }` | `ok: false`, `downloaded: true`, reason `downloaded-copy` |
| Throw or rejected promise | `ok: false`, reason `export-failed` |
| No `exportTree` function | `ok: false`, reason `export-unavailable` |
| Unchanged PE payload with no visible operations | `ok: true`, `applied: false`, `exported: false`, reason `unchanged` |

After an export failure, the in-memory node mutation and recorded operation remain. The generated popup runtime treats an applied-but-not-exported result as incomplete and keeps itself dirty. P010 does not exercise a real file handle.

One additional CURRENT-RISK is now executable: `pocket-state.js` declares top-level `const state`, which is available as a classic-script lexical binding but not as `window.state`. `PocketNodePopoutEditor.hasUnsavedOps()` and fallback selection paths read `global.state`. An unchanged PE save therefore cannot see existing lexical `state.ops` and skips its export request. P010 does not repair or mask this with a test-only `window.state` alias.

## 12. Browser safety storage versus truth-file persistence

The selected local JSON file remains the explicit document truth. P010's load test proves the distinction between browser safety activity and truth persistence.

Calling actual `applyLoadedState()` on the synthetic legacy Text fixture, with local-safety restore prompting disabled, writes these browser keys:

- `pocketLite.lastSaveSnapshot.v1`
- `pocketLite.pip.snapshot.v1`
- `pocketLite.workspace.state.v1`

The later `buildPocketPayload()` call may also create `pocketLite.instanceId.v1` through `getPocketInstanceId()`.

Those are `localStorage` writes. They are not truth-file persistence. During load and payload building:

- no operation is recorded;
- no `exportTree()` surface is called;
- no `writeTruthFile()` surface is called;
- no open or save picker is called;
- no file handle exists; and
- no repository or external JSON file is written.

Opening alone does not write the selected truth file. It can still mutate in-memory node shape through `node.pe` synthesis, and a later explicit export can carry that mutation. That difference is why the synthesis test is classified CURRENT-RISK.

## 13. Stable behaviour assertions

The focused suite treats these as stable current assertions:

- the selected truth file is not written merely by `applyLoadedState()`;
- browser recovery storage is distinguishable from truth persistence;
- Text nodes open in Text when there is no accepted Outline;
- small valid saved Outlines open in Outline and preserve accepted IDs, depths and collapse state;
- saved Outline initialisation uses the editor array instead of reparsing body text;
- `buildPocketPayload()` emits guarded top-level and nested tree copies;
- explicit root, data, node, editor and `pe` fields already present in state are serialised;
- Text normalisation has the exact tested whitespace and 4,000-character policy;
- current accepted Outline normalisation has the exact tested block, text, ID, depth, collapse and order policy;
- changed applies record one `details_edit` operation;
- unchanged applies record no operation;
- failed controlled export results do not falsely report persistence success;
- generated runtime programs compile for Text, saved Outline and rejected metadata payloads;
- P008 Text-to-Outline uses the shared structured-paste parser;
- two spaces, four spaces, tabs, mixed indentation and common leading indentation retain hierarchy;
- blank Text lines are filtered and empty Outline rendering supplies one fresh blank row;
- Text to Outline to Text normalises to two-space indentation without flattening;
- structured-paste parsing aligns the shallowest pasted line to the supplied insertion base; and
- copy context remains details-first, falling back to the label rather than editor metadata.

Because no production file changed, P010 does not alter active-file protections, Main Save, PE dirty-state rules, P006 actions, P007 Escape behaviour, P008 conversion, the one Enter owner, or any truth-write route.

## 14. Compatibility behaviour assertions

These observations support existing inputs but are not promises for new schema design:

| State | Current load result | Current PE result | Current export result | Classification |
| --- | --- | --- | --- | --- |
| Legacy Text without `pe` | Details retained; Text `pe` synthesised in memory | Opens Text | Later explicit export includes synthesised `pe` | Current-risk |
| Small valid current v1 Outline | Raw editor survives generic extras; details can also produce `pe` | Opens Outline from accepted editor, preserving accepted IDs/depths/collapse | Raw state editor plus details and any synthesised `pe` exported | Stable for small v1, with current-risk synthesis |
| Saved Outline viewed temporarily in Text | State unchanged | Runtime shows two-space projection | No export change unless user saves | Compatibility |
| Saved Outline changed and saved as Text | Accepted editor exists before apply | Changed Text apply deletes editor | Details remains; Outline IDs/depths/collapse are absent | Current-risk |
| Text converted manually to Outline | Loads Text | Shared parser creates fresh IDs and relative depths | Successful save exports editor plus details projection | Stable |
| Empty or whitespace-only Text | `details` omitted; no `pe` synthesis | Opens Text | Empty content remains represented by omission | Stable |
| Empty or one blank uncollapsed Outline object | Small raw object can survive generic extras | Active model rejects it and opens Text | Raw object survives if untouched; changed Text apply can delete it | Compatibility |
| Small malformed editor | Raw object survives generic extras | Opens Text | Raw object survives while untouched | Compatibility |
| Small unknown Outline-like schema | Raw unknown object survives generic extras | Shape is accepted and rewritten to v1 in the PE view | Raw survives untouched; changed apply can replace it with v1 | Current-risk |
| Missing block ID | Raw value can survive generic load | PE view generates an ID | Generated ID persists after changed Outline save | Compatibility |
| Duplicate block IDs | Duplicates survive generic load | PE model retains duplicates | Changed Outline save still contains duplicates | Current-risk |
| Invalid or excessive depth | Raw value can survive generic load | PE rounds and clamps to 0 through 8 | Changed Outline save persists the clamped value | Compatibility |
| More than 400 blocks or block text above 4,000 | Large editor may first be dropped by generic 8,000 cap | Direct model normalisation slices block 401/text 4,001 | Fallback Text or sliced editor can be exported after change | Current-risk |
| Mismatched details and accepted Outline | Both values survive | Outline chooses mode/content; body remains independent details | Drift survives an untouched export | Current-risk |
| Unknown root schema with top-level tree | Best-effort top-level load | Nodes follow their individual PE rules | Export schema becomes `portal.export.v1` | Unsupported/unknown |
| Unknown root schema with nested-data-only tree | No nodes loaded | No editable PE target | Empty normalised state if later exported | Unsupported/unknown |

- raw node arrays load as `array.nodes`;
- `portal.mtt.web.v1`, `portal.sync.v1` and `portal.pocketlite.changes.v1` use their legacy nested containers;
- an unknown root schema with a top-level tree is best-effort loaded;
- small unknown and malformed node extras can survive load/export within generic limits;
- a malformed small editor object remains raw in state and opens as Text;
- a missing accepted block ID is generated in the PE view;
- empty and whitespace-only Text is persisted by omission rather than an explicit empty-content tag;
- empty or blank uncollapsed Outline metadata is not meaningful to the PE model and falls back to Text;
- `details` remains a compatibility projection beside saved Outline metadata;
- switching and saving as Text removes accepted Outline metadata under the current model; and
- existing `node.pe` is carried as generic data and is not synchronised by standalone PE edits.

These behaviours may be narrowed by an approved later contract. They must not be changed accidentally as a side effect of P011 load-owner work.

## 15. Current-risk characterisation assertions

The suite contains these explicitly named passing tests:

1. `CURRENT-RISK: index load order leaves pocket-import.js as active normaliseNodes owner`
   - Proves final ownership, oversized editor loss under that owner, and raw editor overwrite inside the intermediate metadata owner.
2. `CURRENT-RISK: editor and pe share the first-24 generic extras budget`
   - Proves property order can displace both metadata objects.
3. `CURRENT-RISK: active load drops editor metadata above the generic 8,000-character object cap`
   - Proves 8,001 is absent while details survives.
4. `CURRENT-RISK: unknown Outline-like schema is accepted, rewritten as v1, and stripped of unknown fields`
   - Proves there is no exact schema gate in the active PE model.
5. `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
   - Proves ID uniqueness is not enforced.
6. `CURRENT-RISK: Outline normalisation silently slices block 401`
   - Proves the block cap is truncating rather than rejecting.
7. `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
   - Proves per-block text is truncated rather than rejected.
8. `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
   - Proves load is truth-write-free but not shape-neutral in memory.
9. `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
   - Proves PE mode/content selection and body projection can disagree.
10. `CURRENT-RISK: small malformed and unknown editor objects survive load but PE interprets only their shape`
    - Proves generic preservation and PE interpretation apply different contracts.
11. `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
    - Proves a data-only extension is not retained on this route.
12. `CURRENT-RISK: PE opening payload has no file-session or original-revision identity`
    - Proves the payload cannot bind apply to its source session or original revision.
13. `CURRENT-RISK: Outline apply accepts independent details/editor content and silently enforces title/body limits`
    - Proves apply can persist drift and truncates title/body at current caps.
14. `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`
    - Proves changed Text persistence removes IDs, depths and collapse metadata.
15. `CURRENT-RISK: unchanged PE save cannot see lexical unsaved operations through window.state`
    - Proves an unchanged PE save can skip export even when lexical operations are pending.

These tests freeze observations, not product policy. The current known weaknesses remain present after P010.

## 16. Fixture inventory

All fixtures are small, parseable JSON under `tests/fixtures/pe-persistence/`:

| Fixture | Purpose |
| --- | --- |
| `legacy-text.json` | Ordinary indented Text without `editor` or `pe` |
| `current-outline-v1.json` | Small saved v1 Outline with stable IDs, nested depth, collapse and deliberate details drift |
| `empty-text.json` | Whitespace-only details |
| `malformed-editor.json` | Small v1-labelled object with non-array Outline |
| `unknown-editor-schema.json` | Small future schema with Outline-like content and unknown fields |
| `root-precedence.json` | Disagreeing top/nested trees, tombstones and synthetic root/data/node extras |

Large boundary inputs are generated in memory. No megabyte fixture, personal value, random timestamp requirement or invalid commented JSON is committed.

## 17. Test matrix

| Area | Executable coverage | Classification |
| --- | --- | --- |
| Fixture integrity | Inventory, size and `JSON.parse()` | Stable |
| Index ownership | Identity transition plus semantic oversized case | CURRENT-RISK |
| Node extras | 24/25, strings, finite scalars, invalid key/value, editor/pe budget | Stable limits plus CURRENT-RISK metadata treatment |
| Root extras | 32/33, 2,000/2,001 string, 12,000/12,001 object | Stable current limits |
| Root precedence | Export, MTT, sync, change snapshot, array, unknown top and unknown nested-only | Compatibility plus CURRENT-RISK data-extra loss |
| Text normalisation | Empty, whitespace, CR, tab, trailing, outer, newline runs, 3,999/4,000/4,001 | Stable current limits |
| Editor load size | Small, exact 8,000 and 8,001 | CURRENT-RISK above cap |
| Active editor model | Flat, nested, Text, absent, empty, blank, malformed and unknown schema | Stable accepted shapes plus CURRENT-RISK coercion |
| Block IDs/depth/order | Missing, duplicate, long ID, negative/fractional/excess depth, incoming order, unknown field | Compatibility plus CURRENT-RISK duplicates |
| Outline limits | 399/400/401 blocks and 3,999/4,000/4,001 block text | Stable boundaries plus CURRENT-RISK slicing |
| Native Outline open | IDs, depths, collapse and independent body | Stable small v1 plus CURRENT-RISK drift |
| Load-time synthesis | No op, browser keys, zero truth surfaces, later export shape | CURRENT-RISK |
| Root export | Schema, timestamps, guards, dual trees, tombstones, extras and detached clones | Stable |
| Compact round trips | Text, empty, v1 Outline, malformed, unknown, drift and extras | Mixed stable, compatibility and CURRENT-RISK |
| PE opening payload | Exact keys, Text/Outline mode and missing identity fields | CURRENT-RISK identity gap |
| PE apply | By ID, dual Outline write, Text deletion, unchanged detection, operation recording and caps | Mixed stable and CURRENT-RISK |
| PE save request | Success, false/cancel, downloaded copy, throw and unavailable | Stable current result contract |
| Lexical/global state | Pending lexical operation with unchanged PE | CURRENT-RISK |
| Generated runtime | Three compile states, shared parser cases, round trips and empty renderer | Stable P008 regression coverage |
| Copy context | Details first, label fallback, editor ignored | Stable |

The P010 validation run on Node `v23.11.0` reports 41 tests, 41 passes, and 0 failures.

## 18. Change protocol for P011 and later tasks

Any later task that changes a tested contract must:

1. identify whether the changed assertion is stable, compatibility or CURRENT-RISK;
2. preserve the synthetic input that demonstrates the old boundary unless it is genuinely obsolete;
3. change production and its focused expectation in the same task;
4. replace a fixed CURRENT-RISK test name with a positive contract name;
5. update this document and `docs/CODEX_REPORT.md` with the new owner and boundary;
6. prove opening alone still performs no truth-file write;
7. keep browser safety writes distinct from truth persistence;
8. test both sides of every changed cap or schema gate;
9. run generated-runtime compilation whenever PE payload/runtime shape changes;
10. rehearse any destructive migration only with disposable copies; and
11. require Murray's product decision before changing Text/Outline conversion meaning, older-version promises or migration triggers.

P011 should use this baseline to consolidate one deliberate first-class load owner, reserve `editor` and `pe` from generic extras, exact-gate supported schemas, and preserve unknown schemas opaquely. Reordering the current scripts without fixing the extras overwrite is insufficient.

The newly characterised lexical `state` versus `window.state` gap also needs a deliberately scoped future fix. P010 does not prescribe exposing mutable state globally. A narrow query or access facade should be considered in the appropriate implementation task.

No later task should make opening a file silently migrate it. Ordinary explicit Save must not mass-rewrite untouched nodes merely because a newer reader recognised them.

## 19. Non-goals

P010 does not add or propose:

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
- changes to Main Save, PE Save, active-file protection or dirty-state ownership;
- changes to P006 selection, subtree, Paste, Duplicate or Delete behaviour;
- changes to P007 Escape behaviour;
- changes to P008 indentation conversion;
- changes to details-first copy context or the one active main-tree Enter owner; or
- inspection or testing of Murray's personal Pocket files.

Future desired behaviour remains documented in `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`. P010's role is narrower: make the current contract observable, executable and safe to change deliberately.
