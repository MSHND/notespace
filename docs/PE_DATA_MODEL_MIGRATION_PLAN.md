# PE Data Model Audit and Safe Migration Plan

- Pocket Task: P009
- Repository baseline: `26b6937b54cdd0b383054b1b4fa607d5e159e33e` (`P008 Fix PE text-to-outline indentation`)
- Audit date: 22 July 2026
- Status: report only. No runtime, schema, persistence, fixture or personal truth-file change was made.

## P013 product decision addendum — 24 July 2026

Murray selected independent Notes and Outline content rather than destructive conversion semantics.

The implemented P013 current model is:

- the shared title truth remains `node.label`;
- Notes truth is `node.details`;
- Outline truth is accepted `node.editor` using the unchanged `pocket.nodeEditor.v1` schema;
- `node.notes` does not exist;
- the `portal.export.v1` root shape is unchanged;
- Notes and Outline may each be present or absent independently;
- the visible Notes/Outline selection is runtime presentation state and is not persisted; and
- an accepted Outline chooses the opening Outline tab, otherwise Notes opens.

P013 deliberately rejects the audit's former projection model. After P013:

- tab switching never converts Notes into Outline rows;
- tab switching never projects Outline rows into Notes;
- editing Notes does not rewrite, remove or canonicalise an unchanged Outline;
- editing Outline does not rewrite or remove Notes;
- both sections may be edited before one Save and persist together;
- existing `node.details` on old Outline nodes becomes initial Notes exactly as stored, even when it looks identical to the Outline; and
- there is no heuristic cleanup, migration, mirroring, synchronisation or copy command.

This may make older nodes appear to contain duplicated Notes and Outline. That is intentional non-destructive preservation. The user may later edit or clear either section explicitly.

The meaningful supported Outline rule is shared across recognition, comparison and save. An Outline is meaningful when at least one row has nonblank text, depth greater than zero, or `collapsed === true`. Null, an empty array, and rows made only of blank depth-0 uncollapsed placeholders represent absence. Therefore a blank row at depth 1, a blank collapsed row, or a hierarchy that uses blank structural rows remains meaningful.

An unchanged raw supported Outline is preserved through Notes-only and title-only saves, including supported extension fields and raw values hidden by the normalised editing view. An actual Outline edit or clear still crosses P012's stored-raw and incoming non-lossy safety boundary. Empty incoming content cannot bypass row 401, 4,001-character text, duplicate-ID or other stored-raw rejection.

Unsupported or malformed non-null editor metadata remains wholly read-only under P011. P013 does not selectively edit Notes around unknown metadata. P012 file-session identity, source diagnostics, node revision, failed-export retry, queued-write rejection and Save & Close persistence requirements remain unchanged.

No automatic migration is required or permitted. Older Pocket versions may display `node.details` as readable Notes without understanding the independent Outline, and may not offer equivalent editing semantics. P014 remains the separate decision about retiring live `node.pe` synthesis and search use while preserving raw legacy values.

The P009 audit findings below are retained as historical evidence of the pre-P010/P013 implementation. Statements describing `details` as an Outline projection document that earlier state and are superseded by this addendum for current behavior.

## How to read this report

The following terms are used deliberately:

- **Verified behaviour** means the behaviour is directly supported by the named current-main code and, where useful, an in-memory probe of that code.
- **Inferred risk** means a reachable consequence of verified code paths, not a claim that Murray's files contain the condition.
- **Proposed design** means a future contract. It is not implemented by P009.
- **Product decision** means a user-visible policy choice that Murray should make before implementation.

No personal Pocket JSON was opened or scanned for this audit. The repository fixture and illustrative synthetic values were used instead.

## 1. Executive Summary

Pocket currently has two active PE content representations and one legacy shadow representation:

- `node.details` is the active plain-Text body.
- `node.editor`, when accepted as an Outline, contains `pocket.nodeEditor.v1` blocks and is the active Outline representation.
- `node.pe` is legacy metadata. Current file loading can create it from `details`, current standalone PE does not update it, and search still reads it.

For an Outline node, Pocket writes both the structured `node.editor.outline` and an indented Text projection in `node.details`. The structured outline wins when that node is reopened in the current standalone PE. For a Text node, the absence of accepted Outline metadata makes `node.details` the effective content truth. `node.label` remains the title truth in both modes.

This is operationally safe for small, well-formed current outlines that remain within every active limit and are edited through the accepted standalone route. It is not yet a sufficiently explicit or robust general persistence contract. The most important verified weakness is load order: `index.html` loads the editor-aware normalisers before `js/pocket-import.js`, whose later global `normaliseNodes()` replaces them. As a result, `node.editor` and `node.pe` survive file load only as generic node extras. A serialised editor object over 8,000 characters can be dropped in memory on load even though the current PE can create and save a much larger valid outline.

Other material weaknesses are:

- Outline content can be much larger than the 4,000-character `details` projection.
- runtime editing has no pre-save warning before the 400-block, 4,000-character-per-block and 4,000-character-body normalisers slice data;
- unknown editor schemas are not actually checked and can be rewritten as v1 on an edit;
- duplicate block IDs are not repaired or rejected;
- `node.pe` can become a stale third copy and can affect search;
- a PE payload is bound to a node ID, but not to the file session or node revision that was open when the payload was built;
- temporarily editing the Text projection of an existing Outline and switching back to Outline discards those Text edits; and
- top-level and nested copies of the whole tree are persisted, while current `portal.export.v1` loading treats the top-level copy as the winner.

**Recommendation:** do not migrate Pocket's truth-file schema now. Retain the broad current model and implement Option A: a hardened, documented v1 contract. Make `node.editor` first-class at load, check its schema exactly, preserve unknown schemas opaquely, prevent silent truncation, require unique IDs, define array order as authoritative, stop silently synthesising legacy `node.pe`, and bind PE apply/save to its original file session. Keep `details` as a compatibility projection for Outline nodes until Murray decides otherwise.

The hardening should happen soon because the load-size and cross-file identity gaps are present risks. A data-model migration should happen later only if a real product need justifies it. The safest next step is P010, a non-writing contract and fixture test task that makes every current state and limit reproducible before any normalisation code changes.

## 2. Current Truth Model

### Root truth-file shape

`buildPocketPayload()` in `js/pocket-storage.js` exports `portal.export.v1`. The same cloned tree and tombstone arrays are stored twice:

```json
{
  "schema": "portal.export.v1",
  "exportedAt": "2026-07-22T09:00:00.000Z",
  "writtenAt": "2026-07-22T09:00:00.000Z",
  "pocketGuard": {
    "schema": "pocket.guard.v1",
    "instanceId": "pocket_example",
    "sourceFileName": "notes.json",
    "sourceWrittenAt": "2026-07-22T08:00:00.000Z",
    "backupWrittenAt": "2026-07-22T09:00:00.000Z"
  },
  "mainThoughtTree": [],
  "mainThoughtTreeTombstones": [],
  "data": {
    "pocketGuard": {},
    "mainThoughtTree": [],
    "mainThoughtTreeTombstones": []
  }
}
```

The abbreviated nested `pocketGuard` above has the same values as the top-level guard in actual output. There is no separate numeric whole-file data-model version or migration-complete marker. Root schema `portal.export.v1`, editor schema `pocket.nodeEditor.v1`, legacy PE schema `pocket.pe.v1`, and recovery wrapper schemas are independent identifiers.

For `portal.export.v1`, `normaliseInput()` uses top-level `mainThoughtTree` and ignores a mismatched nested tree. For `portal.mtt.web.v1` and `portal.sync.v1`, it uses `data.mainThoughtTree`. This precedence was verified with the actual current functions.

### Ordinary or legacy Text node

```json
{
  "id": "node_text_1",
  "parentId": "root",
  "label": "Meeting notes",
  "order": 1000,
  "updatedAt": "2026-07-22T08:30:00.000Z",
  "source": "manual",
  "details": "First paragraph\n\nSecond paragraph"
}
```

Verified interpretation:

- `label` is the title.
- `details` is canonical PE content because there is no accepted Outline metadata.
- Text mode is implicit. There is no persisted `mode: "text"` in the active node contract.
- On load, `applyLoadedState()` currently adds a derived `node.pe` object in memory if the node has details and no own `pe`. Opening alone does not write the file, but a later unrelated explicit export can persist this derived object.

### Valid saved Outline node

```json
{
  "id": "node_outline_1",
  "parentId": "root",
  "label": "Project plan",
  "order": 1010,
  "updatedAt": "2026-07-22T08:40:00.000Z",
  "source": "manual",
  "details": "Prepare\n  Draft\n  Review",
  "editor": {
    "schema": "pocket.nodeEditor.v1",
    "mode": "outline",
    "outline": [
      {
        "id": "block_prepare",
        "text": "Prepare",
        "depth": 0,
        "collapsed": true,
        "order": 1
      },
      {
        "id": "block_draft",
        "text": "Draft",
        "depth": 1,
        "collapsed": false,
        "order": 2
      },
      {
        "id": "block_review",
        "text": "Review",
        "depth": 1,
        "collapsed": false,
        "order": 3
      }
    ]
  }
}
```

Verified interpretation:

- `editor.outline` is the active standalone PE content winner on open.
- `details` is a derived two-space Text projection produced on Outline save and retained for compatibility, tree search, copy context and older routes.
- The array position owns display order. Current active PE normalisation rewrites `order` to `index + 1`; the generated runtime does not use incoming `order` to sort.
- IDs, depth and collapsed state are structural data. They cannot be recovered from `details` alone.
- Current code does not verify that the incoming editor `schema` equals `pocket.nodeEditor.v1`. This report calls the example valid because its schema and fields match the intended v1 contract, not because current code enforces the schema.

### Empty Text node

```json
{
  "id": "node_empty_1",
  "parentId": "root",
  "label": "Empty note",
  "order": 1020,
  "updatedAt": "2026-07-22T08:50:00.000Z",
  "source": "manual"
}
```

Whitespace-only body content normalises to an empty string and `applyPayload()` deletes `details`. With no meaningful Outline metadata, the node reopens in Text mode. An empty array or a single blank depth-0, uncollapsed Outline row is not persisted as a distinct empty Outline state by the active model.

### Node creation defaults

`insertSiblingBelow()` and `insertChildUnder()` in `js/pocket-tree-actions.js`, and `ensurePathNodeUnder()` in `js/pocket-import.js`, create core node fields only: ID, parent ID, label, source, order and updated timestamp. They do not create `details`, `editor` or `pe`. PE content fields therefore appear only after content is saved, except for the current load-time legacy `pe` synthesis described below.

### Legacy `node.pe` state

The following can exist in current truth JSON or be added in memory from `details` during load:

```json
{
  "id": "node_legacy_pe_1",
  "parentId": "root",
  "label": "Legacy note",
  "order": 1030,
  "updatedAt": "2026-07-22T08:55:00.000Z",
  "source": "manual",
  "details": "Current active body",
  "pe": {
    "schema": "pocket.pe.v1",
    "title": "Legacy note",
    "mode": "text",
    "text": "Older shadow body",
    "outline": [],
    "updatedAt": "2026-07-21T10:00:00.000Z"
  }
}
```

The active standalone PE does not read, update or delete `node.pe`. `js/pocket-filter-pe-search.js` does read its title, text and outline for search. This makes `node.pe` a persisted legacy shadow, not the current editor truth.

A materially distinct legacy state has `pe` but no `details` or `editor`:

```json
{
  "id": "node_pe_only_1",
  "parentId": "root",
  "label": "Legacy PE-only note",
  "order": 1040,
  "updatedAt": "2026-07-22T08:58:00.000Z",
  "source": "manual",
  "pe": {
    "schema": "pocket.pe.v1",
    "title": "Legacy PE-only note",
    "mode": "text",
    "text": "Content visible only to the legacy PE search wrapper",
    "outline": [],
    "updatedAt": "2026-07-21T11:00:00.000Z"
  }
}
```

The active standalone PE opens this as empty Text because its model ignores `pe`. Search can still find `pe.text`. An unchanged PE save leaves the object alone; an actual Text edit writes `details` but still does not synchronise or remove `pe`.

### Persisted, runtime-only, derived and discarded fields

| Category | Fields or values | Current treatment |
| --- | --- | --- |
| Persisted core node | `id`, `parentId`, `label`, `order`, `updatedAt`, `source`, plus supported task/profile/system/status fields and bounded extras | Normalised into `state.nodes` and exported. This report focuses on PE-relevant fields. |
| Persisted Text content | `details` | Optional. Missing and empty are equivalent after normalisation. |
| Persisted Outline content | `editor.schema`, `editor.mode`, `editor.outline[]` with `id`, `text`, `depth`, `collapsed`, `order` | Optional. Accepted Outline metadata makes Outline the active PE mode. |
| Persisted legacy shadow | `pe` | Optional. Not owned by the active standalone PE. May be synthesised in memory from `details` and later exported. |
| Persisted compatibility projection | `details` on an Outline node | Derived from the Outline during Outline save, then capped and normalised as ordinary details. |
| Derived Outline field | block `order` | Recreated from array position on active PE normalisation. Incoming values are not authoritative. |
| Runtime PE payload | `body`, top-level `mode`, top-level `outline`, `path`, `openedAt`, payload `updatedAt` | Passed to the popup. Not persisted as these top-level payload fields. |
| Runtime editing state | popup dirty flag, selection set, selection anchor, context-menu state, DOM rows | Not in truth JSON. Outline DOM text is synced back into the runtime array before relevant operations. |
| Runtime app state | `state.ops`, selected node, focus root, tree collapsed set, save queue, file handle and file-session ID | Not in truth JSON. Some are copied into browser recovery or workspace storage. |
| Normalised fields | title, details, outline blocks, timestamps and supported extras | May be trimmed, sliced, clamped or regenerated in memory before an edit/export. |
| Discarded fields | malformed core nodes, excessive or invalid extras, unknown fields over generic caps, non-JSON values, unknown fields inside rewritten editor metadata | Not recoverable from exported state unless the original file or a separate backup is retained. |

## 3. Data Flow Map

### Active truth-file to PE to truth-file route

| Stage | Active owner | Verified behaviour and ownership |
| --- | --- | --- |
| File selection | `openPocketFile()` and `loadFromFileHandle()` in `js/pocket-io-browser.js` | Requires user selection and read/write permission. `initialisePocketFileGate()` clears the writable handle at startup. IndexedDB stores only a display-name hint. |
| Parse | `loadFromFile()` in `js/pocket-io-browser.js` | Reads file text, parses JSON, optionally recognises supported change-log/import formats, then calls `normaliseInput()`. File open does not write. |
| Root routing | `normaliseInput()` in `js/pocket-import.js` | Selects the root or nested tree according to the recognised root shape and calls the currently active `normaliseNodes()`. |
| Node load normalisation | `normaliseNodes()` in `js/pocket-import.js` | This is the final active global definition because of `index.html` script order. It normalises core fields and passes `editor` and `pe` through `normaliseNodeExtras()` as generic extras. |
| Intended but replaced normalisers | `normaliseNodesWithEditor()` in `js/pocket-editor-metadata.js` and the wrapper in `js/pocket-pe-import-preserve.js` | Loaded earlier, then overwritten by `js/pocket-import.js`. Their exported helper functions still exist, but they do not own current file-load node normalisation. Blindly reactivating them is unsafe because their accepted-outline tests and extras merge behaviour differ from the active PE model. |
| State adoption | `applyLoadedState()` in `js/pocket-storage.js` | Assigns normalised nodes to state, then `ensurePeFromLegacyDetails()` mutates details-bearing nodes by adding a legacy `pe` shadow when absent. No operation is recorded. |
| State lookup | `nodeMap()` in `js/pocket-import.js` | Rebuilds a Map of references to `state.nodes`. PE applies mutate those node objects directly. |
| Edit routing | `openDirect()` in `js/pocket-editor-cutover-v3.js`, via `PocketPeEditor` in `js/pocket-pe-node-popout-bridge.js` | Routes accepted edit actions to the current standalone node popout. Old v1/v2 popouts remain loaded as a fallback when the standalone open reports false. |
| Compatibility save wrapper | `installDirtyCue()` in `js/pocket-pe-save-dirty.js` | Wraps the bridge's `PocketPeEditor.open/apply` surfaces and exposes legacy `__pocketPeApplyAndSave`. The current generated node-popout runtime saves directly through `PocketNodePopoutEditor.applyAndSave()`, so that legacy helper is not the canonical current save owner. |
| PE payload construction | `buildPayload()` in `js/pocket-node-popout-model.js` | Normalises `node.editor`; accepted Outline metadata produces Outline mode and saved blocks. Otherwise `details` produces Text mode with `outline: null`. `node.pe` is ignored. |
| Popup creation | `open()` in `js/pocket-node-popout-window.js` | Writes the template and generated runtime into the named standalone popup. It protects a dirty current popup and stores one pending open. |
| Initial PE state | generated program from `PocketNodePopoutRuntime.build()` in `js/pocket-node-popout-runtime.js` | Saved outline blocks initialise directly and are not reparsed from `body`. A Text payload stays Text until the user selects Outline. |
| Text to Outline | `setMode()`, `textToOutline()`, `outlineBlocksFromPastedText()`, `leadingIndentInfo()`, `inferPastedSpaceUnit()` and `makeBlock()` in the generated runtime | P008 made Text conversion use the structured-paste parser. It reads the live textarea only when `outline` is null, ignores blank lines, infers hierarchy, creates fresh IDs, sets `collapsed: false`, and clamps depth. |
| Outline to Text | `outlineToText()` and `currentBody()` in the generated runtime | Produces a two-space-indented Text projection. The popup retains its runtime outline array after switching to Text. |
| PE save payload | runtime `buildPayload()` | Emits node ID, title, current body, current mode and the outline array. It does not include the originating truth-file session, handle identity or original node revision. |
| Apply to current node | `applyPayload()` in `js/pocket-node-popout-editor.js` | Resolves payload ID against the current `nodeMap`, normalises title/body/editor, writes or deletes `details` and `editor`, records `details_edit`, and leaves `node.pe` untouched. |
| Apply and persist | `applyAndSave()` in `js/pocket-node-popout-editor.js` | Applies to memory first, then calls `exportTree({ returnDetails: true })`. A failed truth-file write leaves the operation in memory and the popup dirty. |
| Full export | `exportTree()` in `js/pocket-io-browser.js` | Captures the active file session, serialises saves through a queue, rejects a changed session, freezes `buildPocketPayload()`, writes only when operations exist, and clears only operations present at save start after success. |
| Truth-file write | `writeTruthFile()` and `writePocketPayloadToHandle()` in `js/pocket-io-browser.js` | Requests write permission, writes pretty JSON plus newline, closes the writable, and can fall back to an explicit save picker. There is no read-back verification or automatic pre-write disk backup. |

The compact active path is therefore:

```text
selected truth JSON
  -> loadFromFile()
  -> normaliseInput()
  -> pocket-import.js normaliseNodes()
  -> applyLoadedState() + legacy pe synthesis
  -> state.nodes / nodeMap()
  -> PocketNodePopoutModel.buildPayload()
  -> generated Text or Outline runtime
  -> runtime buildPayload()
  -> PocketNodePopoutEditor.applyPayload()
  -> recordOp()
  -> exportTree()
  -> buildPocketPayload()
  -> writeTruthFile()
  -> selected truth JSON
```

### Active-file and stale-file protection

- `setPocketFileSession()` increments `pocketFileSessionId` whenever the handle, writable state, display name or PiP target changes.
- `capturePocketFileSaveSession()` and `isPocketFileSaveSessionCurrent()` protect the queued export. `exportTree()` checks the snapshot before work and again around the write.
- `assessStaleFileRisk()` in `js/pocket-storage.js` compares the loaded `writtenAt` with newer local-safety and last-backup timestamps only when the normalised filenames match. It does not compare file content, a revision, `lastModified` or a hash.
- `shouldPauseForStaleExportGuard()` in `js/pocket-io-browser.js` pauses the first Save and offers a separate backup copy. It arms a 15-second confirmation window, during which a second explicit Save may proceed.
- A missing or unparseable loaded timestamp cannot produce the timestamp-based stale warning. There is intentionally no external-change watcher.
- `writePocketPayloadToHandle()` treats successful `write()` plus `close()` as persistence success. Current code does not read the file back after writing.
- When a fallback save picker selects a replacement handle, the writable session name changes but `state.source.fileName` is not updated on that path. `writeLastBackupMeta()` takes its filename from `state.source`, so later backup/stale metadata can remain associated with the old source name.
- These protections correctly guard the export target. They do not bind an already open PE payload to the file session before `applyPayload()` mutates current in-memory state.

### Recovery and alternate representations

| Representation | Owner | What it contains | Important boundary |
| --- | --- | --- | --- |
| Local safety snapshot | `saveLocalSafetySnapshot()` in `js/pocket-storage.js` | Full `buildPocketPayload()`, source labels, UI state and operations inside `pocket.localSafety.v1` | Browser storage, not working truth. Restore re-runs current normalisation and requires an active modifiable file before an explicit later Save. |
| Local safety trail | `appendLocalSafetyTrail()` | Up to eight coalesced snapshots | A compact entry over 900,000 serialised characters is rejected. |
| PiP snapshot | `persistPipSnapshot()` in `js/pocket-import.js` | State nodes, tombstones, extras, selection/collapse and operations | Restored only in PiP mode. It is not a normal startup truth source. |
| Auto cache | `saveAutoCache()` and dormant `restoreAutoCache()` in `js/pocket-storage.js` | Normalised tree and source metadata | Current main has no caller for `restoreAutoCache()`; `autoLoadAtStartup()` returns false. |
| Last-save snapshot | `saveLastSaveSnapshot()` | Full payload up to 5,000,000 characters | No repository read/restore owner was found. It is not proof of successful disk persistence. |
| Backup metadata | `writeLastBackupMeta()` | Timestamp, count and filename only | Does not contain tree data. |
| Encrypted Vault | `PocketVault.buildCurrentPocketPayload()` and `openVaultFile()` | Encrypted `portal.export.v1` payload | Vault open calls `applyLoadedState()` but does not establish or clear the ordinary truth-file session. A migration rehearsal must not assume Vault open retargets Main Save. |

After a successful export, `exportTree()` clears the dedicated current local-safety snapshot even when edits made during the write leave newer operations in `state.ops`; it then refreshes the PiP snapshot. Those newer operations remain dirty and the separate safety trail may remain, but `LOCAL_SAFETY_KEY` has been removed. Future migration work should preserve the current operation slicing while testing this recovery boundary explicitly.

## 4. Current Invariants

### Invariants enforced by current code

- No selected or created writable Pocket file means the main tree is hidden and mutations are rejected by `requirePocketFileForChanges()`.
- Startup does not silently reuse a stored writable handle. Only a recent filename hint is stored in IndexedDB.
- Main and PE truth writes route through `exportTree()`, `writeTruthFile()` and the captured file-session checks.
- Saves are queued. A queued save whose active file session changed is rejected.
- A successful queued save removes only the operations that existed when that save began. Newer operations remain local.
- PE apply records a `details_edit` operation after the in-memory node mutation.
- PE stays dirty when truth-file persistence fails and clears dirty state only after a successful export or a genuinely unchanged result.
- An accepted Outline mode must have an object with `mode` normalising to `outline` and at least one meaningful block. The active model does not, however, enforce the schema identifier.
- Active PE block normalisation caps blocks at 400, text at 4,000 characters, depth from 0 to 8, and IDs at 80 characters or generates a missing ID.
- Text save deletes `node.editor`. Outline save writes `node.editor` and a `details` projection.
- Saved native Outline blocks are used directly on initialisation instead of reparsing `details`.
- Text-to-Outline and structured multiline paste share one parser. Blank lines are ignored and new blocks receive fresh IDs.
- Array order is operationally authoritative. Active PE rewrites `order` sequentially.
- Tree copy-context payload remains details-first, then label, through `copyContextPayloadForNode()` in `js/pocket-editor-copy.js`.
- No autosave, file watcher, background file write, cloud synchronisation or health-status auto-write is active.

### Invariants currently assumed but not enforced

- A saved `node.editor` object will fit under the generic 8,000-character extra-value load cap.
- An object claiming or resembling Outline metadata actually uses the supported `pocket.nodeEditor.v1` schema.
- Block IDs are unique. Missing IDs are generated, but duplicate non-empty IDs survive.
- Outline text and the `details` projection describe the same logical content.
- Legacy `node.pe` agrees with the current label, details or outline.
- The top-level and nested copies of the exported tree agree.
- The popup still belongs to the same truth-file session and same node revision when Save is pressed.
- A user will not type into a temporary Text projection and then switch back to Outline expecting those edits to be reparsed.
- Runtime content fits persistence limits. The popup does not preflight the full content before applying slices.
- Unknown editor and block fields are safe to discard when a known-looking object is edited.
- An older Pocket version will preserve newer metadata. No minimum-version or downgrade contract exists.
- Depth jumps form a sensible hierarchy. Individual depths are clamped, but jumps are not repaired or rejected.
- File timestamps are present and trustworthy enough for stale-file detection. The guard has no hash, revision or external-change watcher by design.

## 5. Duplicated or Derived Data

| Logical value | Representations | Why it exists | Current winner and regeneration | Divergence and loss | Assessment |
| --- | --- | --- | --- | --- | --- |
| Node title | `node.label`, popup `title`, legacy `node.pe.title` | Main-tree title, editing payload and legacy PE compatibility | `node.label` wins. Popup title is rebuilt from it. Active PE never refreshes `pe.title`. | Legacy title can stay stale and remain searchable. | Useful runtime duplication, dangerous persisted legacy shadow. |
| Text content | `node.details`, popup textarea, local safety/PiP/cache copies | Editing, compatibility, search, copy context and recovery | For Text mode, `details` wins. Popup reads it and Text save writes it. Browser copies reflect in-memory state at capture time. | Normalisation removes or changes whitespace and caps at 4,000 characters. Unapplied popup drafts are not in current recovery snapshots. | Necessary primary Text representation plus expected recovery copies. |
| Outline content | `node.editor.outline`, runtime outline array, contenteditable DOM rows | Persistence, editing operations and rendering | On valid Outline open, `editor.outline` wins. DOM is synchronised into the runtime array before relevant render/save operations. | Duplicate IDs can make ID-based row lookup target the first matching row. Runtime content can exceed save caps. | Necessary runtime duplication, but persisted validation is too weak. |
| Outline as Text | `node.editor.outline` and `node.details` | Older/readable fallback, tree search, details-first copy context and mode switching | Outline wins on Outline open. Outline save regenerates `details` through `outlineToText()` and details normalisation. | `details` caps at 4,000 while Outline capacity is much larger. Blank lines, IDs, collapse and exact indentation are absent from the projection. | Useful compatibility, but canonical ownership and loss boundaries must be explicit. |
| Legacy PE content | `node.pe.text` or `node.pe.outline` alongside `details` and `editor` | Earlier PE model and PE-aware search | No active editor synchronises it. Existing `pe` wins only inside `pocket-filter-pe-search.js`; missing `pe` is synthesised from details during load. | It can be stale immediately after active PE save and can produce stale search matches. | Dangerous ambiguity. Preserve opaquely until policy is chosen, but stop treating it as live truth. |
| Whole tree | root `mainThoughtTree` and `data.mainThoughtTree` | Compatibility with several Portal/Pocket envelope shapes | Current `portal.export.v1` load uses the root copy. Export rebuilds both from the same clone. | A hand-edited or future mismatched nested copy loses. Nested `data` extras are not retained on this route. | Compatibility duplication with a defined but under-documented winner. |
| Saved state copies | truth file, local safety, trail, PiP, auto cache, last-save snapshot and Vault | Recovery and alternate export | The selected local JSON remains the only document truth. Each browser copy is regenerated at its own capture point. | Every restore route that normalises nodes inherits current metadata caps. Storage quotas and snapshot caps differ. | Useful safety support only if clearly subordinate to the truth file. |

### What conversion loses

- Text to Outline ignores blank and whitespace-only lines, normalises indentation into relative depths, creates new IDs and sets `collapsed: false`.
- Outline to Text preserves row text and relative hierarchy using two spaces per depth, but loses IDs, `collapsed`, `order` and exact original whitespace.
- Saving an Outline while in Text deletes `node.editor`, making that structural loss permanent after successful truth-file persistence.
- Saving a Text-only node as Outline creates fresh structural metadata. Reopening then uses that saved metadata, as accepted in P008.
- Switching an existing Outline to Text, editing, and switching back to Outline before saving reuses the retained runtime array and discards the temporary Text edits.

## 6. Limits and Data-Loss Analysis

### Active limits and normalisation rules

| Item | Active rule | Owner | Consequence |
| --- | --- | --- | --- |
| Generic single-line cleaning | Collapse every whitespace run to one space, trim, then slice | `cleanText()` in `js/pocket-data.js` | Used for IDs, labels, schema names and several metadata strings. |
| Node ID | 80 characters; blank, `root` and duplicate node IDs are rejected; first duplicate wins | `normaliseNodes()` | A rejected node is omitted from in-memory state. |
| Parent ID | 80 characters; blank becomes `root` | `normaliseNodes()` | No referential repair beyond the fallback. |
| Title / label | 220 characters; blank node labels cause node rejection on file load | `normaliseNodes()` and PE model/editor | Popup uses `Untitled` only as a runtime/apply fallback. |
| Source | 30 characters; blank becomes `manual` | `normaliseNodes()` | Normalised on load. |
| Updated timestamp | 40 characters; blank becomes `nowIso()` | `normaliseNodes()` | A missing timestamp changes in memory on load. |
| Details / body | 4,000 characters | `normaliseDetails()` and PE model/editor | Removes carriage returns, converts tabs to two spaces, removes trailing line whitespace, collapses 3+ newlines to 2, trims the whole body, then slices. First-line leading and final trailing whitespace are removed by whole-body trim. |
| Editor at file load | Generic object must serialise to at most 8,000 characters and appear within the first 24 retained extras | final `normaliseNodes()` plus `normaliseNodeExtras()` | The intended editor-specific load path is not active. A larger editor object is dropped as a whole. |
| Generic node extras | At most 24; key 48 characters and restricted syntax; strings 1,200; object/array JSON 8,000 | `normaliseNodeExtras()` | Unknown fields beyond limits are omitted silently. `editor` and `pe` currently count as extras. |
| Root extras | At most 32; key 64; strings 2,000; object/array JSON 12,000 | `normaliseRootExtras()` | Reserved root fields and excessive extras are not preserved. |
| Outline blocks | First 400 blocks | active `normaliseEditorMeta()` | Runtime may contain more. Apply silently retains only 400 in `node.editor`. |
| Block text | 4,000 characters after carriage-return removal | active `normaliseOutlineBlock()` | Oversized runtime text is sliced on apply. |
| Block ID | 80 cleaned characters; missing creates a fresh ID | active `normaliseOutlineBlock()` | Duplicate non-empty IDs are not fixed. Repeated normalisation of missing IDs can produce different IDs. |
| Block depth | Numeric, rounded and clamped from 0 to 8; non-numeric becomes 0 | active `normaliseOutlineBlock()` | Excessive values are repaired only when the active model normalises or rewrites the metadata. Depth jumps remain. |
| Block collapsed | Only literal `true` persists as true | active `normaliseOutlineBlock()` | Other truthy values become false. |
| Block order | Always array index plus one | active `normaliseOutlineBlock()` | Incoming order is ignored. Runtime drops it and a changed save recreates it. |
| Legacy `pe` intended limits | text 120,000; 3,000 outline lines; 1,200 per line | helper functions in `js/pocket-editor-metadata.js` and `js/pocket-pe-import-preserve.js` | These helpers do not own final current file-load node normalisation because the later importer replaces their wrapper. Small raw `pe` survives as a generic extra; a larger raw `pe` can be dropped at 8,000 characters. Derived `pe` from details contains at most 4,000 characters. |
| Local safety trail entry | 900,000 serialised characters; eight entries total | `appendLocalSafetyTrail()` | An oversized compact trail entry is rejected. The current safety snapshot itself relies on browser quota. |
| Last-save snapshot | 5,000,000 serialised characters | `saveLastSaveSnapshot()` | Oversized payload is not stored there. No restore owner exists on current main. |

### Reachable data-loss or divergence paths

1. **Large Outline saved, then metadata dropped on reload.** Active PE can save up to 400 blocks of 4,000 characters each. `buildPocketPayload()` exports that state without the generic 8,000-character cap. On the next file load, the same editor object is a generic extra and is dropped if its serialised form exceeds 8,000 characters. The node then opens from the at-most-4,000-character `details` projection. This is a verified code-path risk.

2. **Outline is larger than its compatibility Text.** A valid Outline can preserve substantially more than 4,000 characters in `editor.outline`, while `details` retains only the first 4,000 normalised characters. This mismatch is expected under current limits but not explicitly marked in JSON.

3. **Saving that Outline in Text makes the truncation authoritative.** Text mode makes `normaliseEditorMeta(payload)` return null. `applyPayload()` deletes `editor` and keeps only the 4,000-character body. IDs, depths, collapsed state and content beyond the body cap are lost after successful persistence.

4. **Many short Text rows produce a partial Outline.** A 4,000-character Text body can contain more than 400 short nonblank lines. P008 conversion can create all rows in runtime, but apply keeps only the first 400 editor blocks. The `details` projection can still contain later lines, so the next accepted Outline open can hide content that remains in details.

5. **Oversized runtime block text is sliced without a decision point.** Contenteditable rows and pasted input are not limited before apply. The active model slices each block and body during save comparison/application.

6. **Unknown schemas and fields can be downgraded.** File load can retain a small unknown editor object opaquely as an extra. `PocketNodePopoutModel.normaliseEditorMeta()` ignores its schema. If its shape looks like an Outline, the PE opens it and any actual change rewrites the object as `pocket.nodeEditor.v1`, dropping unknown editor and block fields.

7. **Malformed metadata can be deleted by an unrelated PE field change.** If an editor object does not form a meaningful Outline, the PE opens Text. A title or body change causes apply to delete `node.editor`. A no-change save returns early and generally leaves the raw object untouched.

8. **Missing IDs can create an implicit repair.** The before and after normalisations can generate fresh IDs at different times. A nominal save can therefore compare as changed and persist generated IDs. Duplicate IDs, by contrast, are retained and can alias selection or editing because runtime lookup is ID-based and first-match.

9. **Blank-line and whitespace fidelity differs by representation.** Details retains at most one consecutive blank line after normalisation. Text-to-Outline ignores all blank lines. Outline-to-Text uses standard two-space indentation. These are intentional semantic normalisations, but exact formatting does not round-trip.

10. **Legacy `pe` can drift and affect search.** Load-time synthesis creates it without an operation. Active PE save updates `details` and `editor` but not `pe`. Search temporarily appends `pe` text to details, so obsolete content can continue to match.

11. **Root and nested copies can disagree.** Current export regenerates both equally, but a hand-edited or future file can differ. For `portal.export.v1`, root wins and nested `data` extras are not kept. Any later export forces root schema back to `portal.export.v1`. An unknown future schema with only `data.mainThoughtTree` can pass `isPocketPayloadShape()` but normalise to an empty tree because `normaliseInput()` has no matching nested route.

12. **Browser recovery shares the same normalisation weakness.** Safety and cache readers call `normaliseInput()`. Restoring a snapshot can therefore drop the same oversized editor or unknown extras as direct file load.

13. **Older or fallback editor routes use different meaningful-outline rules.** The loaded legacy popout normalisers treat flat nonempty depth-0 rows as not meaningful, while the current standalone model accepts text as meaningful. If the fallback route activates, the same metadata can be interpreted differently.

## 7. Compatibility Matrix

| State | Verified current behaviour | Risk | Desired future behaviour |
| --- | --- | --- | --- |
| Legacy text-only node | `details` normalises to 4,000 characters; active PE opens Text. Load adds a derived `pe` in memory when absent. | Next unrelated explicit save can persist the unrequested legacy shadow. Whitespace normalises before edit. | Keep `details` canonical and Text mode. Recognition alone must not mutate persisted shape. |
| Valid current v1 Outline node | If `editor` survives the 8,000-character extras gate, active PE opens Outline from saved blocks and does not parse body. | Large valid metadata can disappear on hard refresh; details and pe can differ. | First-class exact-schema recognition, preservation and validation. Outline canonical; details explicitly derived. |
| Outline viewed temporarily in Text | `setMode()` serialises Outline into the textarea but retains the runtime Outline array. | Text edits are discarded if the user switches back to Outline before saving. | Define Text view as projection-only or require an explicit destructive conversion. Do not silently discard typed edits. |
| Outline saved while in Text | Body is saved; `node.editor` is deleted. | IDs, depths, collapse and content beyond 4,000 characters are lost. | Explicit Convert to Text action with a clear warning and size preflight. |
| Text-only node converted to Outline | First Outline selection parses the current textarea through the shared P008 parser, creates fresh IDs, and saves editor plus details projection. | More than 400 rows or oversized blocks are sliced at apply; large saved editor may drop at next load. | Preserve P008 conversion and paste semantics, with validation and no silent truncation. |
| Empty Text node | Empty/whitespace-only body is deleted; no editor; opens Text. | None beyond the inability to distinguish intentional blank formatting. | Keep this simple default. |
| Empty Outline node | Empty array or blank depth-0 uncollapsed rows normalise to null; opens Text. A blank indented/collapsed row can count as meaningful. | The state is inconsistent and surprising at the edge. | Treat empty Outline as empty Text unless Murray later requests a distinct empty-Outline state. |
| Malformed `node.editor` | Small object may survive generic extras. PE ignores it if not meaningful; a changed Text save deletes it. | Silent loss of opaque metadata. | Preserve opaque, warn, and require explicit conversion or repair before editing. |
| Unknown editor schema version | Schema is ignored if mode/outline look acceptable; a changed save rewrites as v1. | Future fields and semantics can be destroyed. | Exact schema gate. Unknown schema stays opaque and read-only with a visible warning. |
| Missing block IDs | Active normalisation creates fresh IDs. | Repeated normalisation can produce different IDs and cause an otherwise nominal save to repair metadata. | Detect once, report, and persist stable repairs only on an explicit edit or migration action. |
| Duplicate block IDs | Duplicates survive. Runtime uses ID sets and first-match lookup. | Selection, text sync, subtree operations and focus can alias rows. | Refuse editable Outline mode until IDs are explicitly repaired, or repair with a preview and report. |
| Invalid or excessive depths | Values round/clamp to 0 through 8; non-numeric becomes 0. Jumps are retained. | A changed save silently persists the repaired value; hierarchy jumps may remain illogical. | Validate visibly. Keep 0 through 8 and decide separately whether depth jumps are legal. |
| Excessive block count | Active model retains first 400 on apply. Generic extras load can drop the whole editor earlier. | Rows after 400 can be lost or hidden. | Block save with a clear count and resolution path. Never silently truncate. |
| Oversized block text | Active model retains first 4,000 characters per block. | Tail content is silently lost on changed save. | Block or explicitly resolve before persistence. |
| Stale `details` and `editor.outline` | Accepted Outline wins in PE. Outline Save regenerates details; search indexes both. | Obsolete details can match search and older consumers; regenerated details may truncate. | Document Outline as winner, detect drift, regenerate only on explicit node edit/save. |
| Stale `node.pe` | Active PE ignores it; PE-aware search reads it. | Third-copy drift and stale search results. | Preserve existing object opaquely, stop synthesising it, and stop using it as current content unless Murray chooses otherwise. |
| Legacy `pe`-only node | Active PE opens empty Text because it ignores `pe`; PE-aware search still finds the legacy content. | A user can see a search hit but an empty current editor, then create a second unsynchronised body. | Preserve the legacy object, show a clear compatibility warning, and offer only an explicit backed-up conversion after Murray chooses the `pe` policy. |
| File produced by a future Pocket version | Any object with top-level `mainThoughtTree` can load regardless of schema. An unknown nested-only shape can pass the Pocket-shape check yet normalise to an empty tree. Unknown fields survive only within extras caps. | Later save forces `portal.export.v1`, may drop nested or oversized unknowns, and can downgrade editor metadata. | Feature-gate unknown versions, preserve raw data, and require explicit conversion or a copy. |
| File reopened in an older Pocket version | No compatibility contract exists. Current older/fallback routes can use `details` and may carry small unknown extras, but not reliably. | Editing can create stale details/editor pairs or drop larger metadata. | Promise readable `details` fallback only unless a tested older-version matrix is adopted. Warn before downgrade editing. |
| File A PE left open, then file B loaded | PE payload has node ID but no file-session token. Apply resolves against current file B. | Same ID in B can receive and export A's popup content. Missing ID safely rejects. | Bind payload to file-session ID and original node revision; reject and retain dirty state on mismatch. |
| Stale queued save | `exportTree()` captures and rechecks file session before and after queued write. | Correctly rejected, but only after PE has already applied in memory if the gap occurred before export. | Keep current export guard and add the earlier PE apply identity guard. |

## 8. Options

### Option A: Retain the broad current shape and strengthen its contracts

**Proposed persisted shape:** keep `portal.export.v1`, `node.details` and `pocket.nodeEditor.v1`. Define Text as `details` with no current editor. Define Outline as canonical `editor.outline` plus a derived `details` compatibility projection. Preserve existing `node.pe` opaquely, but stop creating or treating it as live content.

**Advantages**

- No whole-file schema migration is required.
- Smallest risk to the accepted P006, P007 and P008 behaviour.
- JSON stays plain, local, inspectable and recoverable.
- Existing text-only and current v1 Outline files keep their shape.
- Older readers can still display the `details` projection.
- Code rollback does not require rolling truth files back because hardening need not rewrite untouched nodes.

**Disadvantages**

- Outline content remains deliberately duplicated.
- Contracts and tests must prevent or report drift.
- `details` cannot preserve Outline IDs, collapse, exact blank lines or large complete content.
- Safe editing in older Pocket versions still cannot be promised.

**Compatibility cost:** low. Current files remain recognisable. Unknown schema objects need a new read-only preservation path, but not a new JSON shape.

**Migration complexity:** low because this is hardening, not data migration. The difficult parts are consolidating load ownership without activating the older inconsistent normaliser, and ensuring raw unknown metadata survives in-memory use and export.

**Rollback:** code-only for untouched files. Any per-node repair persisted after an explicit edit should be recoverable from the ordinary truth-file backup policy.

**Text/Outline switching:** current P008 parsing can remain. Text conversion from a saved Outline should become an explicit destructive action. Temporary Text projection should either be read-only or clearly abandon/reparse edits according to Murray's choice.

**Copy/paste:** details-first copy context remains unchanged. Structured Outline paste continues to use current blocks and shared indentation parsing. Validation is added before persistence, not inside insertion semantics.

**Older Pocket files:** open as they do now, without writing on open. Legacy details remain canonical Text. Existing `pe` is preserved pending a separate decision.

**Future editor modes:** limited but not blocked. An unknown `editor.schema` can be preserved opaquely and feature-gated. A later v2 can still be introduced if needed.

**One truth or dual representation:** Text has one active content truth. Outline intentionally keeps one canonical structured truth plus one derived compatibility projection.

### Option B: Add a modest, explicitly versioned Outline v2

**Proposed persisted shape:** retain `details` as fallback, but use an editor object such as:

```json
{
  "schema": "pocket.nodeEditor.v2",
  "kind": "outline",
  "projection": {
    "field": "details",
    "format": "indent-2",
    "derivedFromRevision": 7
  },
  "revision": 7,
  "blocks": []
}
```

**Advantages**

- Creates a clean schema boundary and makes canonical ownership explicit.
- Adds room for revision, projection, ID and extension rules without overloading v1.
- Unknown versions can be gated safely.
- Future migration completion can be identified per node.

**Disadvantages**

- Still duplicates Outline content in `details`.
- Current and older PE code ignores schema and can downgrade or delete v2 unless all routes are fixed first.
- Mixed v1/v2 files, per-node upgrades and downgrade warnings add product complexity.
- Backup, preview, rollback and migration reporting must exist before use.

**Compatibility cost:** medium. Text-only and v1 nodes can remain unchanged, but every PE load/save/search/copy/recovery route must understand v2 or preserve it opaquely.

**Migration complexity:** medium. V1 should upgrade only on explicit per-node edit or an explicit previewed migration command, never on open or unrelated Main Save.

**Rollback:** preserve a complete pre-migration truth-file copy. A v2 node can be rolled back only if its v1 source or a lossless v1 projection is retained.

**Text/Outline switching:** block semantics can remain, but revision and projection rules must update deterministically. Convert to Text still needs explicit destructive semantics.

**Copy/paste:** current block paste can map to `blocks`; details-first copy can continue. All code must use the v2 adapter rather than raw field assumptions.

**Older Pocket files:** still open through v1/text adapters. Older apps may see `details` but cannot safely edit v2 metadata.

**Future editor modes:** better than Option A because schema/kind boundaries are explicit.

**One truth or dual representation:** canonical structured truth plus a marked derived projection, still dual on disk.

### Option C: Adopt a unified tagged node-content model

**Proposed persisted shape:** move canonical content into a single tagged value, for example:

```json
{
  "content": {
    "schema": "pocket.nodeContent.v1",
    "kind": "outline",
    "blocks": []
  },
  "details": "Derived compatibility text"
}
```

Text would use `kind: "text"` and `text`; future modes could add new kinds.

**Advantages**

- One explicit canonical content location for every editor mode.
- Natural extension point for future modes and revisions.
- Simplifies long-term ownership rules after all consumers migrate.
- Can mark `details` as purely derived compatibility data.

**Disadvantages**

- Broad rewrite across import, state, node creation, PE, old details paths, search, copy, recovery, export and Vault.
- Older Pocket ignores `content`; keeping details for readability recreates duplication.
- Current generic extras can drop a large `content` object unless load architecture changes first.
- Highest chance of regressions in a small local application whose current user needs are already met.

**Compatibility cost:** high. Every producer and consumer requires an adapter. Old files need indefinite support and older applications cannot safely edit new content.

**Migration complexity:** high. Requires explicit full-file rehearsal, mixed-version strategy, backup proof and potentially dual-write transition logic.

**Rollback:** difficult after edits made only in the new model. A verified full original copy and lossless compatibility projection are mandatory.

**Text/Outline switching:** conceptually cleaner because the tagged value owns mode, but conversions remain lossy and still need explicit user semantics.

**Copy/paste:** must be routed through content-kind adapters. Existing details-first behaviour would need a stable compatibility API.

**Older Pocket files:** import adapters are straightforward in concept but extensive in practice.

**Future editor modes:** strongest option.

**One truth or dual representation:** one canonical content truth, but likely still a derived `details` fallback for compatibility.

### Option comparison

| Criterion | Option A | Option B | Option C |
| --- | --- | --- | --- |
| Current-file rewrite required | No | Per-node or explicit command | Yes, eventually broad |
| Data-loss surface | Lowest if caps are blocked | Medium | Highest during transition |
| Backward readability | Strong through details | Strong through details | Requires deliberate fallback |
| Canonical clarity | Improved contract, dual Outline representation | Clearer versioned dual representation | Best long-term canonicality |
| Engineering scope | Small to medium hardening | Medium migration | Large rewrite |
| Fit for current Pocket | Best | Possible later | Not justified now |

## 9. Recommendation

Choose **Option A now**.

Pocket is a personal, explicitly saved local-file application. It does not need an enterprise schema framework or an automatic migration engine to solve the verified problems. Its immediate risk comes from inconsistent recognition, weak validation and hidden derivation, not from the absence of a new version number.

The recommended contract is:

1. `node.label` is always the title truth.
2. Text node content is `node.details`; accepted current Outline metadata is absent.
3. Outline node content is `node.editor.outline`; `node.details` is an explicitly derived compatibility projection.
4. Array position is authoritative. `order` is compatibility data, regenerated from the array.
5. `pocket.nodeEditor.v1` is accepted only when the schema matches exactly and all structural validation passes.
6. Unknown editor schemas and unknown fields are preserved opaquely. They are not best-effort edited.
7. `node.pe` is legacy opaque data. Stop generating new copies and stop depending on it for current content after Murray approves that policy. Do not delete existing values automatically.
8. No save path may silently truncate or discard PE content. A limit breach blocks persistence and explains the exact count/size.
9. An open PE is bound to the truth-file session and node revision it opened from.
10. Opening, inspecting or recognising any node never writes or schedules a truth-file migration.

Implementation should begin soon as safety hardening, starting with non-writing tests and load-contract consolidation. A schema migration should not be scheduled now. Reconsider Option B only if Pocket needs a new stored capability that v1 cannot express, such as lossless blank rows, explicit content revisions or another editor mode. Reconsider Option C only if multiple editor modes make the current compatibility projection unmanageable.

Do not simply move `js/pocket-import.js` earlier or reactivate `normaliseNodesWithEditor()`. That older function rejects flat nonempty outlines that the active model accepts, and its extras merge can overwrite a normalised editor with the raw extra. The safe implementation is one deliberate, tested load owner.

## 10. Proposed Target JSON

These examples show the recommended Option A contract. They are not a P009 schema change.

### Text node

```json
{
  "id": "node_text_2",
  "parentId": "root",
  "label": "Plain note",
  "order": 1000,
  "updatedAt": "2026-07-22T10:00:00.000Z",
  "source": "manual",
  "details": "This is the canonical Text content."
}
```

- Canonical content: `details`.
- Mode: implicit Text because there is no accepted `editor`.
- Derived compatibility content: none.
- Legacy `pe`: not created for a new or loaded Text node.

### Outline node

```json
{
  "id": "node_outline_2",
  "parentId": "root",
  "label": "Release checklist",
  "order": 1010,
  "updatedAt": "2026-07-22T10:05:00.000Z",
  "source": "manual",
  "details": "Prepare\n  Validate\n  Publish",
  "editor": {
    "schema": "pocket.nodeEditor.v1",
    "mode": "outline",
    "outline": [
      {
        "id": "block_prepare_1",
        "text": "Prepare",
        "depth": 0,
        "collapsed": false,
        "order": 1
      },
      {
        "id": "block_validate_1",
        "text": "Validate",
        "depth": 1,
        "collapsed": true,
        "order": 2
      },
      {
        "id": "block_publish_1",
        "text": "Publish",
        "depth": 1,
        "collapsed": false,
        "order": 3
      }
    ]
  }
}
```

- Canonical content: `editor.outline`.
- Derived compatibility content: `details`, generated using two spaces per depth on explicit Outline save.
- Schema/version: exact `pocket.nodeEditor.v1`.
- Mode: explicit `outline` inside the editor object.
- Block identity: non-empty unique `id` values.
- Hierarchy: integer `depth` from 0 through 8.
- Display order: array position. `order` is retained for compatibility and regenerated from that position.
- Collapse: literal Boolean `collapsed`.

### Empty node

```json
{
  "id": "node_empty_2",
  "parentId": "root",
  "label": "Blank note",
  "order": 1020,
  "updatedAt": "2026-07-22T10:10:00.000Z",
  "source": "manual"
}
```

The recommended default is that empty Text and empty Outline are the same persisted empty-content state and reopen in Text. No blank editor object is needed.

### Future or unknown editor schema

```json
{
  "id": "node_future_1",
  "parentId": "root",
  "label": "Future content",
  "order": 1030,
  "updatedAt": "2026-07-22T10:15:00.000Z",
  "source": "manual",
  "details": "Readable compatibility projection",
  "editor": {
    "schema": "pocket.nodeEditor.v9",
    "mode": "canvas",
    "futureField": {
      "preserve": true
    }
  }
}
```

Recommended behaviour:

- Preserve the unknown `editor` object opaquely in memory, recovery and export without the generic 8,000-character metadata cap.
- Do not interpret it as v1 or open it for best-effort Outline editing.
- Show `details` as a readable compatibility view and a clear unsupported-version warning.
- Require an explicit conversion on a copied/backed-up file before replacing the unknown object.
- For known v1 objects, preserve unrecognised top-level and block fields during unrelated saves. When the node itself is explicitly edited, merge updates into recognised fields rather than silently erasing extension data, or block and ask if a safe merge cannot be proved.

The root remains `portal.export.v1` under Option A. This recommendation deliberately avoids a whole-file migration marker. Per-node schema values and an audit result are sufficient until an actual new persisted schema is approved.

## 11. Migration Policy

### Read-time recognition

- Parse the selected file and recognise exact supported root and editor schemas.
- Keep raw unknown editor objects available for lossless re-export.
- Build validated runtime views without rewriting the persisted object in `state.nodes` merely because it was read.
- Report malformed, duplicate-ID, oversized, unknown-version and drift conditions. Do not auto-repair them at read time.
- Opening alone must never write, enqueue a write, record an operation or silently change the future whole-file export shape.

### When normalisation may persist

- A normal user edit may update the node the user explicitly edited, after validation and any required warning.
- Ordinary Main Save may persist explicit existing operations. It must not mass-upgrade untouched nodes because they were recognised or normalised during load.
- A missing ID or other repair should be stable in the runtime view, but should persist only with an explicit node edit or approved repair command.
- Converting a saved Outline to Text is a destructive semantic migration for that node and should require a distinct action and confirmation.
- No current task should write `node.pe` merely because it was missing. Existing `node.pe` should remain untouched until its policy is approved.

### Explicit migration command

If Option B or C is ever approved, prefer an explicit migration command for existing files:

1. inspect and count candidate nodes without mutation;
2. show every malformed, unknown and lossy case;
3. require the user to choose or create a destination backup copy;
4. serialise and parse-verify the original backup;
5. migrate in memory;
6. serialise and validate the candidate result;
7. show a summary and require explicit confirmation;
8. write only to the current confirmed active file session;
9. read back and validate if the browser file API permits it; and
10. retain the original backup and a migration report.

Per-node edit-triggered upgrade is acceptable for known lossless v1-to-v2 cases, but only after schema recognition, caps and unknown-field preservation are fixed. Whole-file migration on ordinary Save is not acceptable.

### Backups and original-file preservation

- Browser localStorage recovery is useful but is not the migration backup.
- `lastSaveSnapshot` is not sufficient because current code has no restore owner and it is written before disk success.
- Before any explicit migration, create a separate, user-visible full JSON copy through a save picker or download. Never silently reuse a hidden handle.
- Record source filename, source `writtenAt`, content hash if introduced, candidate schema counts, validation results and the chosen destination.
- Do not touch Murray's live truth file during development or rehearsal. Use disposable repository fixtures or explicit disposable copies.

### Rollback, interruption and failure

- Rollback means selecting the verified original copy as the active truth file, not trying to reverse arbitrary operations in place.
- A failed or cancelled write leaves state dirty and keeps the pre-migration copy available.
- An interrupted write must not mark migration complete. Completion requires successful close, optional read-back, parse, schema count and content-invariant checks.
- Stale or switched file sessions reject the write and retain the in-memory candidate as unsaved.
- Malformed known-schema nodes remain unchanged and are listed for manual resolution.
- Unknown schemas remain unchanged. No downgrade is attempted.

### Older applications and mixed versions

- Under Option A, there is no migration version mix. Text and v1 Outline nodes continue to coexist.
- Under a future Option B, mixed v1/v2 nodes should be allowed. Each node's editor schema identifies its state.
- Older Pocket compatibility should be described as readable fallback through `details`, not safe bidirectional editing, unless tested otherwise.
- A future root migration manifest may record counts and tool version, but it must not be required merely to open mixed files.
- Migration completion should mean every eligible candidate was either migrated or explicitly recorded as skipped, followed by successful persistence and validation. Opening a file is never completion.

## 12. Proposed Implementation Phases

These are tentative future Pocket tasks. P009 does not approve or implement them.

### P010: Specify and test the current PE persistence contract

- **User-visible change:** none.
- **Implementation boundary:** add small synthetic fixtures and pure/read-only tests for Text, v1 Outline, malformed, oversized and unknown-schema states. Capture actual script-load ownership and all limits.
- **Files likely involved:** a focused test/harness location, synthetic JSON fixtures, and documentation. No personal files.
- **Safety gate:** no production mutation, no broad checker, and fixtures must prove no write on load.
- **Tests required:** exact load-order VM probe, load/export round trips, duplicate/missing IDs, limits, unknown fields, root/data precedence and current generated runtime compile checks.
- **Rollback point:** the prior commit remains the rollback point; truth files are untouched.
- **Murray decision first:** no. This is the recommended immediate next task.

### P011: Consolidate first-class editor recognition and opaque preservation

- **User-visible change:** unsupported or malformed editor metadata is preserved and may show a warning instead of being best-effort edited.
- **Implementation boundary:** create one active `normaliseNodes()` owner; reserve `editor` and `pe` from generic extras; exact-gate supported schemas; preserve unknown objects opaquely; do not mutate nodes on recognition.
- **Files likely involved:** `index.html`, `js/pocket-import.js`, `js/pocket-data.js`, `js/pocket-editor-metadata.js`, `js/pocket-pe-import-preserve.js`, and focused tests.
- **Safety gate:** current small v1 Outline and legacy Text fixtures must be byte/semantic stable through unrelated save; large valid v1 must survive hard refresh.
- **Tests required:** every P010 fixture, browser hard refresh, recovery restore, root schema routes, future schema preservation and no-write-on-open instrumentation.
- **Rollback point:** code rollback only. The task must not migrate files.
- **Murray decision first:** confirm unknown-schema UX and readable-fallback promise.

### P012: Add PE identity binding and non-lossy save preflight

- **User-visible change:** PE refuses a stale file/node save and explains oversized content or duplicate IDs before persistence.
- **Implementation boundary:** include file-session ID and original node revision in the payload; reject mismatch before apply; validate counts, text sizes and ID uniqueness without slicing first.
- **Files likely involved:** `js/pocket-node-popout-model.js`, `js/pocket-node-popout-runtime.js`, `js/pocket-node-popout-editor.js`, `js/pocket-node-popout-window.js`, `js/pocket-io-browser.js`, and focused tests.
- **Safety gate:** rejection must retain popup dirty state and must not mutate the current file's state.
- **Tests required:** file A/B switch with same ID, missing node, stale revision, queued saves, failed export, limits, retry, P006 operations, P007 Escape and P008 parsing.
- **Rollback point:** code rollback; no automatic data rewrite.
- **Murray decision first:** choose size-limit UX and whether explicit truncation is ever allowed.

### P013: Make Text/Outline conversion semantics explicit

- **User-visible change:** a saved Outline's Text view is clearly projection-only, or Convert to Text is a distinct confirmed action. Temporary Text edits are never silently discarded.
- **Implementation boundary:** mode switch state machine and conversion warning only. Preserve current structured paste and saved native Outline initialisation.
- **Files likely involved:** `js/pocket-node-popout-runtime.js`, `js/pocket-node-popout-template.js`, model/editor only if the payload contract changes, and focused generated-runtime tests.
- **Safety gate:** no ID/collapse loss without explicit conversion confirmation; no regression to P006, P007 or P008.
- **Tests required:** all switch sequences, edits in temporary Text, save/reopen, blanks, large content, copy/paste, selection/subtree operations and dirty-close protection.
- **Rollback point:** current mode-switch behaviour remains available in the prior commit.
- **Murray decision first:** yes, decide what Text on an existing Outline means.

### P014: Retire `node.pe` as live content without deleting legacy data

- **User-visible change:** search stops surfacing stale legacy shadow text; loading no longer adds new `pe` objects.
- **Implementation boundary:** stop `ensurePeFromLegacyDetails()` synthesis, make search use `label`, `details` and current accepted editor metadata, preserve existing `pe` opaquely, and document an inventory route.
- **Files likely involved:** `js/pocket-storage.js`, `js/pocket-filter-pe-search.js`, load/preservation tests and documentation.
- **Safety gate:** no existing `pe` value is deleted or rewritten automatically; details-first copy behaviour is unchanged.
- **Tests required:** legacy pe-only/search cases, text and outline edits, unrelated Main Save, recovery snapshots and hard refresh.
- **Rollback point:** code rollback with original legacy objects still present.
- **Murray decision first:** yes, confirm preserve-and-stop-generating rather than promote or synchronise.

### P015: Add explicit backup and migration rehearsal tooling

- **User-visible change:** a preview can audit a disposable file and create a verified backup before any approved conversion.
- **Implementation boundary:** read-only inventory first, explicit destination selection, serialise/parse verification, report generation and rollback instructions. No schema conversion yet.
- **Files likely involved:** dedicated migration/audit module, browser file UI, recovery tests and documentation.
- **Safety gate:** cannot target a file without explicit selection; cannot write until backup verification and final confirmation; file-session checks mandatory.
- **Tests required:** cancellation at every step, interrupted writes, stale session, malformed data, backup parse failure, rollback, large files and disposable-copy browser rehearsal.
- **Rollback point:** select the verified original copy.
- **Murray decision first:** yes, approve whether such tooling is useful before building it.

### P016: Consider a v2 schema only if a new requirement justifies it

- **User-visible change:** none until a separately approved implementation task.
- **Implementation boundary:** decide between Option B and C using evidence from P010-P015; specify adapters and exact compatibility promises.
- **Files likely involved:** documentation and prototypes first, then a separately scoped implementation list.
- **Safety gate:** no production schema write during design; prove lossless handling of every current fixture.
- **Tests required:** full migration and downgrade matrix, mixed versions, future unknowns, recovery and disposable destructive rehearsal.
- **Rollback point:** no-op because design precedes implementation.
- **Murray decision first:** yes. Do not presume P016 will be approved.

## 13. Test and Acceptance Plan

### Unit and pure-function checks

- Load actual scripts in `index.html` order and assert the intended final owners by function identity, not filename inspection alone.
- Exercise `normaliseDetails()`, `normaliseNodeExtras()`, `normaliseRootExtras()`, `normaliseInput()`, active editor normalisation and payload building with synthetic inputs at, below and above every limit.
- Cover legacy text-only, empty Text, valid flat and nested v1 Outline, empty Outline, malformed editor, unknown schema, missing IDs, duplicate IDs, invalid depths, 399/400/401 blocks and 3,999/4,000/4,001-character block text.
- Verify root/data precedence for `portal.export.v1`, `portal.mtt.web.v1`, `portal.sync.v1`, unknown root schema, array input and nested-only future shapes.
- Assert exact unknown-field preservation rules and prove that an unsupported editor is never rewritten by an unrelated node operation.
- Verify drift detection between `details`, `editor.outline` and legacy `pe` without using personal data.

### Generated-runtime checks

- Build the actual program with `PocketNodePopoutRuntime.build()` and compile it with `new Function()` for Text, current Outline, empty and rejected metadata payloads.
- Preserve P008 Text-to-Outline and structured-paste cases for spaces, tabs, mixed indentation, common leading indentation, blank lines and depth clamp.
- Test Text to Outline to Text hierarchy, plus the deliberately lossy ID/collapse boundary.
- Exercise every mode-switch sequence, including editing the temporary Text projection and returning to Outline.
- Validate limit preflight before the payload reaches destructive normalisation.
- Re-run context Paste, copied-root selection, subtree Copy, Duplicate, Delete, Enter, Tab, Shift+Tab, collapse/expand and P007 Escape order.
- Confirm successful export clears dirty state and failed/stale/rejected export leaves PE dirty.

### Repository integration checks

- Load and export synthetic legacy and current files through `loadFromFile()`, `applyLoadedState()`, PE apply and `buildPocketPayload()`.
- Assert opening alone produces no operation and no truth-file write.
- Assert ordinary Main Save does not migrate untouched nodes or synthesise new metadata.
- Exercise recovery snapshot, trail, PiP and Vault payload handling with current, malformed, oversized and unknown editor data.
- Verify copy-context remains details-first and search uses only the chosen current representations.
- Verify a successful PE Save writes the complete truth payload, while persistence failure leaves the operation and local recovery data available.
- Confirm no autosave timer, background write, file watcher, silent handle reuse or health-triggered write is introduced.
- Confirm the retired `pocket-editor-popout-default.js` remains absent and no new PE implementation is created.

### Browser acceptance tests

- Hard refresh a disposable legacy Text file and a current native Outline file.
- Save and reopen each mode, including collapse state and stable IDs.
- Switch file A to file B while a dirty PE for A remains open. Use the same node ID in B and prove apply/save is rejected.
- Queue a save, switch active files before it runs, and confirm stale-session rejection without writing B.
- Deny or cancel write permission and confirm PE remains dirty and truth-file content is unchanged.
- Exercise stale-file guard, explicit second confirmation, save picker fallback and file A/B return.
- Verify clipboard permissions and visible behaviour for copy-context, structured Paste, subtree Copy, Duplicate, Delete and selection.
- Re-run Save, Save & Close, dirty-close protection and P007 Escape behaviour in the physical popup.
- Observe network, timers and file activity during idle use and confirm there is no autosave or background write.
- Test near-limit content with clear warnings and no silent truncation.

### Destructive migration rehearsal on disposable copies only

- Start from generated fixtures and explicit disposable copies, never Murray's active truth file.
- Record a content hash and parse summary before rehearsal.
- Create and parse-verify a separate original backup.
- Interrupt before backup, before candidate write, during a simulated write failure and after write but before verification.
- Reopen the candidate after hard refresh and compare all node content, IDs, depths, collapse, unknown fields and root extras.
- Reopen the original to prove rollback.
- Test newer schema input and an older-reader simulation. The older-reader acceptance target is readable details fallback unless Murray chooses a stronger promise.
- Do not mark rehearsal successful until the candidate was read back, normalised under the intended version and compared against explicit invariants.

## 14. Open Product Decisions for Murray

### 1. Which representation wins when a saved Outline and `details` disagree?

- **Why it matters:** current PE chooses Outline, while search and older readers can see details.
- **Choices:** Outline wins; Text wins; or block and ask on every mismatch.
- **Codex recommendation:** Outline wins for a supported editor schema, with a visible drift warning and deterministic projection regeneration only on explicit node save.
- **Reversible:** yes, until a conflict repair is persisted.

### 2. What should Text mean on an existing Outline?

- **Why it matters:** Text cannot represent IDs or collapse, and current temporary Text edits can be discarded.
- **Choices:** projection-only view; explicit destructive Convert to Text; or continuously reparse Text back into Outline.
- **Codex recommendation:** projection-only by default plus a distinct confirmed Convert to Text action.
- **Reversible:** viewing is reversible; conversion is reversible only from an original backup or until it is saved.

### 3. What is the future of legacy `node.pe`?

- **Why it matters:** it is a stale third content copy and still influences search.
- **Choices:** preserve opaquely and stop generating it; promote it to active truth; or keep all three copies synchronised.
- **Codex recommendation:** preserve existing values opaquely, stop synthesis, stop using it as current content, then consider explicit cleanup only after an inventory.
- **Reversible:** yes while existing objects are preserved.

### 4. What should happen when content exceeds a persistence limit?

- **Why it matters:** current code silently slices or drops content.
- **Choices:** block with a clear resolution; raise harmonised limits after measured testing; or allow explicit user-approved truncation/export.
- **Codex recommendation:** block by default. Raising limits can be a later evidence-based change. Silent truncation should not be offered.
- **Reversible:** limit settings are reversible before persistence; truncated content is not.

### 5. What compatibility promise should Pocket make to older versions?

- **Why it matters:** `details` supports readability, but older editing can create drift or drop large unknown metadata.
- **Choices:** readable fallback only; fully safe bidirectional editing; or current-version-only with a warning.
- **Codex recommendation:** readable fallback only. Do not promise safe older-version editing without a versioned test matrix.
- **Reversible:** the policy can strengthen later; a strong promise constrains future schemas.

### 6. How should unsupported editor schemas appear?

- **Why it matters:** best-effort editing can destroy future fields.
- **Choices:** read-only compatibility view with warning; Text fallback with explicit conversion; or best-effort editing.
- **Codex recommendation:** read-only details projection with a warning, plus explicit convert-on-a-copy if needed.
- **Reversible:** yes while the raw unknown editor object is preserved.

### 7. If a real migration is approved later, what triggers it?

- **Why it matters:** ordinary Save writes the entire in-memory tree, so hidden read-time changes can become whole-file changes.
- **Choices:** explicit preview and backup command; per-node upgrade only on explicit edit; or whole-file migration on ordinary Save.
- **Codex recommendation:** explicit command for existing files, with lossless per-node edit upgrade allowed only after contracts and backups are proven. Never migrate on open.
- **Reversible:** explicit backed-up migration is reversible by selecting the original copy. Ordinary-save migration is much harder to unwind.

## 15. Non-goals

This report does not propose:

- autosave;
- cloud synchronisation;
- collaboration;
- file watchers;
- background migration;
- silent writable-handle reuse;
- another PE implementation;
- restoration of `pocket-editor-popout-default.js`;
- a wholesale application rewrite;
- changing the one active main-tree Enter owner;
- changing details-first copy-context behaviour;
- changing P006 outline selection, subtree, paste, duplicate or delete behaviour;
- changing P007 Escape behaviour;
- changing P008 indentation parsing; or
- scanning or testing Murray's personal truth files.

## Evidence Index

The report's principal verified assertions trace to these current-main owners:

| Area | Files and functions |
| --- | --- |
| Script load order | `index.html` script tags for metadata, PE preservation, import, old popouts and current node popout |
| Core and extras normalisation | `js/pocket-data.js`: `cleanText()`, `normaliseDetails()`, `safeJsonClone()`, `normaliseNodeExtras()`, `normaliseRootExtras()` |
| Active file input | `js/pocket-import.js`: final `normaliseNodes()`, `normaliseInput()`, `nodeMap()`, `persistPipSnapshot()` |
| Intended editor/PE normalisers | `js/pocket-editor-metadata.js`: `normaliseTreeEditorMeta()`, `normalisePocketPe()`, `normaliseNodesWithEditor()`; `js/pocket-pe-import-preserve.js` wrapper |
| State adoption and export shape | `js/pocket-storage.js`: `buildPocketPayload()`, `ensurePeFromLegacyDetails()`, `applyLoadedState()` |
| Browser truth IO | `js/pocket-io-browser.js`: file-session helpers, `loadFromFile()`, `writeTruthFile()`, `exportTree()` |
| PE model | `js/pocket-node-popout-model.js`: `normaliseOutlineBlock()`, `normaliseEditorMeta()`, `buildPayload()` |
| PE runtime | `js/pocket-node-popout-runtime.js`: `makeBlock()`, conversions, structured paste, `setMode()`, runtime `buildPayload()`, save and Escape flow |
| PE apply/save | `js/pocket-node-popout-editor.js`: `applyPayload()`, `applyAndSave()` |
| PE routing | `js/pocket-node-popout-window.js`, `js/pocket-pe-node-popout-bridge.js`, `js/pocket-editor-cutover-v3.js` |
| Compatibility dirty/save wrapper | `js/pocket-pe-save-dirty.js`: `installDirtyCue()`, wrapped bridge surfaces and legacy `__pocketPeApplyAndSave` |
| Legacy fallback | `js/pocket-editor-popout.js`, `js/pocket-editor-popout-v2.js` |
| Search and copy | `js/pocket-render.js`, `js/pocket-filter-pe-search.js`, `js/pocket-editor-copy.js` |
| Operations and recovery | `js/pocket-history-status.js`, `js/pocket-storage.js`, `js/pocket-import.js` |
| Vault representation | `js/pocket-vault.js`, `js/pocket-vault-io-browser.js`, `js/pocket-crypto.js` |
| Repository example | `JSONs/pocket-data.json` |

Two focused in-memory probes loaded the actual current source. One confirmed that the final global load owner is the generic `normaliseNodes()`, that a small unknown editor object survives raw, that an editor object over 8,000 characters is absent after normalisation, and that `portal.export.v1` uses the root tree. The second confirmed the active PE model's schema rewrite, 400-block and 4,000-character caps, depth clamp, missing-ID generation, duplicate-ID retention, sequential order and empty-Outline rules. These probes did not create files or touch runtime state outside the process.
