# P015 Architecture, Security and Failure-Mode Audit

## 1. Audit identity

- **Baseline SHA:** `29224a3218a7dd12c40ac5d0503394282e7624d3`
- **Baseline commit:** `P014 Retire legacy node.pe shadow`
- **Branch:** `main`
- **Audit date:** 2026-07-24
- **Repository:** `MSHND/notespace`
- **Tracked inventory:** 95 files, including 60 production JavaScript files and one 94-case focused `node:test` suite
- **Scope:** active script order; global ownership; all document-adoption, truth-write and recovery routes; the canonical and legacy editor stacks; popup, Document PiP and message boundaries; Vault cryptography and IO; normalisation; localStorage and IndexedDB; DOM and generated-code sinks; input-size handling; tests, workflow and dependency surfaces
- **Excluded:** PR #6, its branch and its contents; personal Pocket truth files; browser localStorage; real Vault files; network scanners; runtime changes; test changes; deployment headers not present in the repository

The baseline was fetched before inspection. Local `main`, `HEAD` and `origin/main` were identical, with no ahead/behind divergence and a clean worktree. PR #6 was not merged, cherry-picked, modified or used.

The audit used tracked-source inventory, line-numbered source inspection, repository-wide symbol and sink searches, script-order tracing, controlled Node VM probes using actual baseline source, the existing focused test suite, JavaScript syntax checks and Git diff checks. It did not inspect or infer from Murray's personal data.

Commands included:

- `git fetch origin`
- `git status --short --branch`
- `git rev-parse HEAD`
- `git rev-parse origin/main`
- `git log --oneline --decorate`
- `git ls-files`
- `gh run list --repo MSHND/notespace --branch main --limit 10 --json databaseId,workflowName,headSha,status,conclusion,event,createdAt`
- targeted `rg`, `nl`, `sed` and `find` inspections
- controlled Node VM probes against actual repository scripts
- `node --test tests/pe-persistence-contract.test.js`
- `find js -name '*.js' -print0 | xargs -0 -n1 node --check`
- `git diff --check`
- `git diff --name-only`
- `git diff --cached --check`
- `git diff --cached --name-only`

No automated scanner uploaded repository content. The prohibited broad checker commands were not run.

### Active `index.html` script load order

The audited order is the literal classic-script order at `index.html:129–179`:

1. `js/pocket-state.js`
2. `js/pocket-data.js`
3. `js/pocket-editor-metadata.js`
4. `js/pocket-pe-import-preserve.js`
5. `js/pocket-storage.js`
6. `js/pocket-import.js`
7. `js/pocket-editor-copy.js`
8. `js/pocket-editor-joy.js`
9. `js/pocket-history-status.js`
10. `js/pocket-tree-actions.js`
11. `js/pocket-scroll-polish.js`
12. `js/pocket-render.js`
13. `js/pocket-io-browser.js`
14. `js/pocket-crypto.js`
15. `js/pocket-vault.js`
16. `js/pocket-vault-io-browser.js`
17. `js/pocket-phone-mode.js`
18. `js/pocket-phone-tap.js`
19. `js/pocket-detail-drag.js`
20. `js/pocket-editor-popout-source-lock.js`
21. `js/pocket-editor-popout.js`
22. `js/pocket-editor-popout-v2.js`
23. `js/pocket-editor-popout-node-guard.js`
24. `js/pocket-editor-popout-fresh.js`
25. `js/pocket-overlays-init.js`
26. `js/pocket-detail-dirty.js`
27. `js/pocket-editor-handoff.js`
28. `js/pocket-editor-rebase.js`
29. `js/pocket-editor-conflict.js`
30. `js/pocket-editor-test-loop.js`
31. `js/pocket-editor-save-ack.js`
32. `js/pocket-editor-visual-sync.js`
33. `js/pocket-save-chip-normalise.js`
34. `js/pocket-list-smoothing.js`
35. `js/pocket-more-button.js`
36. `js/pocket-build-label.js`
37. `js/pocket-phone-menu.js`
38. `js/pocket-node-popout-template.js`
39. `js/pocket-node-popout-runtime.js`
40. `js/pocket-node-popout-model.js`
41. `js/pocket-node-popout-window.js`
42. `js/pocket-sync-status.js`
43. `js/pocket-health-sync.js`
44. `js/pocket-node-popout-target.js`
45. `js/pocket-node-popout-editor.js`
46. `js/pocket-pe-node-popout-bridge.js`
47. `js/pocket-editor-cutover-v3.js`
48. `js/pocket-pe-save-dirty.js`
49. `js/pocket-editor-human-close.js`
50. `js/pocket-enter-copy-only.js`
51. `js/pocket-multi-select.js`

This order is security- and behaviour-relevant because classic top-level lexical bindings, globals, event phase and wrapper replacement determine the final owners described below.

### Principal active owners

| Boundary | Active owner at baseline |
|---|---|
| Lexical tree/UI state and file-handle/session variables | `js/pocket-state.js` |
| Canonical `normaliseNodes()` / `normaliseInput()` | `js/pocket-import.js` |
| Root export shape and browser recovery payloads | `js/pocket-storage.js` |
| Operation recording and narrow unsaved-op count | `js/pocket-history-status.js` |
| Tree rendering and search projection | `js/pocket-render.js` |
| File gate, selected-handle load, save queue and physical write | `js/pocket-io-browser.js` |
| Current editor classification and raw metadata preservation | `js/pocket-editor-metadata.js` |
| Canonical PE payload, popup, target and apply/save | `js/pocket-node-popout-{model,window,target,editor}.js` plus template/runtime |
| Current PE alias and UI cutover | `js/pocket-pe-node-popout-bridge.js`, `js/pocket-editor-cutover-v3.js`, `js/pocket-pe-save-dirty.js` |
| Vault cryptography, envelope state and active browser IO | `js/pocket-crypto.js`, `js/pocket-vault.js`, `js/pocket-vault-io-browser.js` |
| Main/PiP snapshot transfer | `js/pocket-editor-copy.js` and the host closure in `js/pocket-io-browser.js` |
| Final `PocketEditorPopout` legacy global | V2 over V1 delegation, then `js/pocket-editor-conflict.js` wrapper |
| Final `window.open` | Wrapper chain from PE import-preserve, PE save/dirty, human-close and Enter compatibility scripts; all react to obsolete names, not canonical `pocketNodePopoutEditor` |
| Final `setStatus` | Base `js/pocket-history-status.js`, wrapped by old rebase logic |

## 2. Executive verdict

Pocket's ordinary single-file Notes and Outline workflow remains acceptable at this baseline when the user works in one browser tab with a valid current Pocket file. The explicit file gate, P011 editor recognition, P012 popup source/revision checks, P013 independent Notes/Outline model and P014 `node.pe` retirement are materially sound.

The overall condition is nevertheless **RED**, because six reachable paths can lose data or write one document's content through another document's writable handle:

1. cross-file recovery adoption;
2. Vault opening while a JSON truth handle is active;
3. stale Document PiP return;
4. destructive load normalisation without diagnostics;
5. root-shape recognition and precedence mismatch; and
6. concurrent tab or external-file last-writer-wins saving.

Until corrected, Pocket's local recovery should not be restored while a different file is active, Vault open should not be treated as a safely owned editable document, Document PiP should not remain open across a file switch or divergent main-window edit, malformed/future files should not be edited and resaved, and the same truth file should not be edited concurrently in multiple tabs or applications.

The audit register contains:

- **6 RED findings**
- **14 YELLOW findings**
- **10 confirmed GREEN boundaries**
- **6 INFORMATIONAL findings**

Recommended correction order:

1. bind recovery adoption to document ownership;
2. isolate Vault ownership and decide its browser-recovery privacy contract;
3. bind Document PiP return to its opening document;
4. fail closed on destructive normalisation and ambiguous root shapes;
5. add save-time disk freshness validation;
6. make recovery failures visible and empty state persistable;
7. then address bounded input, Vault envelope hardening, editor debt and CI.

## 3. Severity definitions

### RED

A reachable path with plausible data loss, wrong-file writing, confidentiality failure, integrity failure or severe security impact. Optional features may still be RED when the path is genuinely reachable.

### YELLOW

A credible reliability, availability, hardening, observability or architectural risk which is testable or worth correcting, but does not presently justify rejecting ordinary use.

### GREEN

A reviewed boundary whose current protections are appropriate for the assessed threat and failure model.

### INFORMATIONAL

Cleanup, documentation drift, future design consideration or a hypothesis which inspection disproved.

## 4. Findings register

### P015-F01: Recovery adoption can overwrite the wrong active truth file

- **Severity:** RED
- **Category:** document ownership, integrity, wrong-file writing
- **Affected flow:** automatic local-safety offer, manual previous-version restore and Phone-mode automatic restore
- **Ordinary-use impact:** normal editing is unaffected until recovery is invoked; recovery is a visible supported feature, and Phone mode can invoke it automatically
- **Preconditions:** a snapshot from document A exists; writable document B is active; the user accepts or triggers restoration, or enables Phone mode; an explicit later Save occurs
- **Evidence:** `saveLocalSafetySnapshot()` stores one origin-global snapshot with only source labels at `js/pocket-storage.js:86–110`; `maybeOfferLocalSafetyRestore()` compares timestamps without source identity at `js/pocket-storage.js:441–458`; `restorePreviousLocalSafetyVersion()` selects a global trail entry without source filtering at `js/pocket-storage.js:420–438`; `restoreLocalSafetySnapshot()` renews the session and adopts the snapshot at `js/pocket-storage.js:365–392`; `renewPocketDocumentSession()` deliberately retains `truthFileHandle` at `js/pocket-io-browser.js:186–193`; Phone mode's existing-node guard reads unavailable `window.state` and then restores without confirmation at `js/pocket-phone-mode.js:60–88`; `exportTree()` later captures and writes the retained handle at `js/pocket-io-browser.js:679–736`
- **Step-by-step failure path:** A's snapshot survives in localStorage → B is selected and owns the writable handle → restoration replaces B's in-memory tree with A → session rotation invalidates old PE windows but keeps B's handle → the next edit/Save serialises A's tree through B's handle
- **Existing mitigation:** restoration does not write immediately; an explicit modifiable file is required; an explicit Save is still required; session rotation protects previously opened PE windows; source filename and timestamp labels exist
- **Missing protection:** source/session/fingerprint matching; a restore destination policy; handle clearing or explicit rebinding; a conflict screen for same-name and different-name sources
- **Likelihood:** plausible, particularly after crashes, switching files, multiple tabs or Phone-mode use
- **Impact:** high, because B can be overwritten with A's content
- **Confidence:** high
- **Recommended future correction boundary:** one document-adoption owner which requires a matching stable source identity or clears the writable handle and requires an explicit Save As before a recovered tree can become truth
- **Suggested future test:** synthetic A/B handles with different and identical filenames, covering automatic offer, manual trail restore and Phone mode; assert B receives zero writes until the user explicitly chooses B as the recovery destination
- **Product decision required:** whether a cross-source recovery should be rejected, opened read-only or allowed only through an explicit “restore into this file” confirmation

### P015-F02: Opening a Vault retains the previous JSON truth handle

- **Severity:** RED
- **Category:** document ownership, integrity, wrong-file writing
- **Affected flow:** `Open Vault`, followed by any edit and Main Save
- **Ordinary-use impact:** ordinary JSON-only use is unaffected; the optional Vault flow is unsafe when another writable JSON file is active
- **Preconditions:** writable JSON document A is active; the user deliberately selects and unlocks a Vault; the user edits the decrypted tree and presses Save
- **Evidence:** `PocketVaultBrowserIo.openVaultFile()` decrypts, normalises, calls `renewPocketDocumentSession()` and applies Vault state at `js/pocket-vault-io-browser.js:72–97`; renewal retains the previous handle at `js/pocket-io-browser.js:186–193`; `applyLoadedState()` replaces state and source labels but does not own the handle at `js/pocket-storage.js:460–501`; a later operation and `exportTree()` write through the retained handle at `js/pocket-history-status.js:3–9` and `js/pocket-io-browser.js:679–736`
- **Step-by-step failure path:** A owns the handle → Vault V is decrypted and adopted → the session rotates but A remains the handle → V is edited → Main Save writes V's decrypted content into A
- **Existing mitigation:** Vault open itself records no operation and performs no truth write; P012 invalidates PE windows opened before the Vault; explicit editing and Save are required
- **Missing protection:** a Vault document-owner state; clearing of the ordinary JSON handle; a deliberate export destination; separation between Vault save and JSON truth save
- **Likelihood:** lower than ordinary recovery because Vault is optional, but the path is direct and user-reachable
- **Impact:** high, with loss of A and accidental plaintext placement of V
- **Confidence:** high
- **Recommended future correction boundary:** Vault adoption must establish a distinct document owner and clear ordinary JSON write authority unless the user explicitly exports a JSON copy
- **Suggested future test:** open a synthetic Vault while fake handle A is active, edit, press Main Save and assert zero A writes; then exercise the explicitly approved export path
- **Product decision required:** whether an opened Vault is editable only through a future Vault save, read-only, or exportable to a newly chosen JSON file

### P015-F03: Document PiP return is not bound to its opening document

- **Severity:** RED
- **Category:** document ownership, stale window, integrity, wrong-file writing
- **Affected flow:** Document PiP Save or dirty PiP close after the main window changes or switches files
- **Ordinary-use impact:** normal main-window editing is unaffected; PiP becomes unsafe when it outlives its source revision or source file
- **Preconditions:** PiP opens from A; main A changes independently or the main window switches to B; stale PiP A is dirty; PiP Save or `pagehide` returns the snapshot
- **Evidence:** `exportPocketLiteSessionState()` carries source labels, tree and operations but no main file-session token or base document revision at `js/pocket-editor-copy.js:109–124`; `adoptPocketLiteSessionState()` blindly normalises and replaces main state, renews the session and retains the current handle at `js/pocket-editor-copy.js:127–153`; the PiP host adopts before export and adopts a dirty close at `js/pocket-io-browser.js:58–79`
- **Step-by-step failure path:** PiP A opens → main switches to B or gains newer A edits → PiP returns its older A snapshot → main state is replaced → B's retained handle may receive A on host Save, or the replacement remains pending for the next Save
- **Existing mitigation:** mutation uses a direct same-origin host callback rather than wildcard message data; snapshots are normalised; session renewal invalidates old PE windows; dirty state is required for close adoption
- **Missing protection:** opening-session identity, base document revision/hash, source matching and a conflict path preserving both versions
- **Likelihood:** plausible for users who keep PiP open while returning to the main window
- **Impact:** high, including replacement of newer state or wrong-file writing
- **Confidence:** high
- **Recommended future correction boundary:** bind every PiP snapshot to the document session and base revision captured at PiP creation, and reject divergent return without replacing either copy
- **Suggested future test:** controlled A/B same-ID and same-file divergent-state sequences, including Save, `pagehide` and main-file switch
- **Product decision required:** conflict UX when both main and PiP changed

### P015-F04: Destructive load normalisation is silent and later Save commits the loss

- **Severity:** RED
- **Category:** normalisation, silent data loss, forward compatibility
- **Affected flow:** selecting a partially malformed, legacy or externally produced Pocket JSON file, then making any legitimate edit and saving
- **Ordinary-use impact:** current app-produced valid files are normally within bounds; malformed and third-party/current-future files are affected
- **Preconditions:** at least one node survives normalisation so the file opens, while another node or field violates a current rule; the user later performs an explicit Save
- **Evidence:** canonical `normaliseNodes()` skips non-objects, missing/blank/reserved/duplicate IDs and blank labels at `js/pocket-import.js:301–313`; it truncates or defaults core fields at `js/pocket-import.js:308–330`; `normaliseDetails()` trims and slices to 4,000 characters at `js/pocket-data.js:49–55`; generic node and root extras are capped and silently dropped at `js/pocket-data.js:326–438`; selected-file load adopts only the normalised state at `js/pocket-io-browser.js:850–897`; recovery baselines are then built from that normalised state at `js/pocket-storage.js:460–520`
- **Observed actual-source probe:** duplicate, `root`, blank-label and colliding nodes disappeared; 4,001-character details became 4,000; orphan, self-parent and cyclic nodes survived structurally; no diagnostic was returned
- **Destructive rules include:** IDs 80 characters; labels 220; details 4,000; source 30; 24 generic node extras; 32 root extras; node-extra strings 1,200; root-extra strings 2,000; generic object extras 8,000/12,000 serialised characters; whitelisted task/profile/system/status fields; reserved `due` is not emitted; unknown core fields may disappear. P011's first-class `editor` preservation is an important exception.
- **Step-by-step failure path:** raw file contains valid and invalid material → normaliser silently omits/truncates → original disk file remains intact while open → app snapshots contain only normalised state → a later unrelated explicit Save writes the omissions back to the selected file
- **Existing mitigation:** no autosave; the original file remains untouched until explicit Save; current UI generates bounded IDs and fields; unsupported `editor` values are preserved opaquely and opened read-only
- **Missing protection:** a loss report; raw-vs-normalised comparison; fail/read-only boundary; preservation of rejected raw records for recovery
- **Likelihood:** credible for malformed imports, hand-edited files and future producers; low for ordinary current files
- **Impact:** high because omitted data cannot be recovered from Pocket's post-load snapshots
- **Confidence:** high
- **Recommended future correction boundary:** classify normalisation as lossless, repaired-with-visible-diagnostics or destructive; refuse editable ownership for destructive cases until the user explicitly accepts a previewed repair on a disposable copy
- **Suggested future test:** actual-source mixed valid/malformed load with write spies, proving no source-handle write authority after destructive normalisation without explicit repair
- **Product decision required:** reject versus read-only versus previewed repair

Verified current node/root outcomes at the P015 baseline:

| Input condition | Current normalised result | Warning |
|---|---|---|
| Non-object node | Omitted | None |
| Missing/blank ID, exact `root` ID or duplicate cleaned ID | Node omitted; no replacement ID is generated | None |
| ID over 80 characters | Truncated; a collision can make a later node disappear | None |
| Missing parent | Defaults to `root` | None |
| Unknown/orphan/self/cyclic parent | Cleaned to 80 characters and retained without topology validation | None |
| Blank label | Entire node omitted | None |
| Label over 220 characters | Truncated | None |
| Finite order | Rounded; duplicate sibling orders remain and later compare by label | None |
| Invalid order | Replaced with `1000 + output index` | None |
| Missing `updatedAt` | Current time generated | None |
| Malformed non-empty `updatedAt` | Whitespace-cleaned/truncated to 40 characters, not ISO-validated | None |
| Empty/whitespace Notes | `details` omitted | None |
| Notes over 4,000 normalised characters | Sliced | None |
| `due` | Reserved but not emitted by `normaliseNodes()` | None |
| Task/profile/system/status unknown fields | Whitelisted normalisers omit them | None |
| Current or unknown JSON-compatible `editor` | Preserved first-class; unsupported content becomes read-only in PE | Visible compatibility view for unsupported editor |
| Generic node extras | Valid keys only; first 24; scalar/string/object caps | None |
| Root extras | Valid keys only; first 32; scalar/string/object caps | None |
| Tombstone array | Preserved opaquely with no item/count validation | None |

### P015-F05: Root-shape recognition can accept valid content as an empty editable document

- **Severity:** RED
- **Category:** root schema, precedence, silent data loss
- **Affected flow:** selected `portal.export.v1`, unknown/future root schema, or a file whose top-level and nested trees disagree
- **Ordinary-use impact:** current Pocket writes equivalent top-level and nested trees, so its own untouched files are normally safe; older, future or externally produced variants are affected
- **Preconditions:** a selected recognised object has only `data.mainThoughtTree`, or has divergent copies/unknown schema; the user adds or edits content and saves
- **Evidence:** `isPocketPayloadShape()` accepts a nested tree or a known schema at `js/pocket-io-browser.js:555–560`; `normaliseInput()` handles nested trees specially only for `portal.mtt.web.v1`, `portal.sync.v1` and change snapshots, otherwise requiring top-level `mainThoughtTree` at `js/pocket-import.js:351–410`; the loader accepts a recognised empty result at `js/pocket-io-browser.js:850–867`; generic top-level precedence discards nested data extras at `js/pocket-import.js:390–398`; export always rewrites `portal.export.v1` at `js/pocket-storage.js:57–84`
- **Observed actual-source probe:** nested-only `portal.export.v1` normalised to no nodes; a dual-copy export selected the top tree and returned `dataExtras: null`
- **Step-by-step failure path:** a nested-only export is recognised → normalisation returns empty → the selected handle becomes active and UI reports a loaded Pocket file → direct empty Save is blocked, but adding one node permits Save → the valid nested tree is replaced by the new small top-level tree. For divergent copies, the top copy wins without a warning. Unknown top-level schemas can be rewritten as current export on Save.
- **Existing mitigation:** empty state cannot be directly saved until changed; current writer emits matching copies; mtt/sync nested precedence is explicit; no autosave
- **Missing protection:** agreement between shape recognition and normalisation; dual-copy equality validation; unknown-schema read-only handling; root/data extras preservation contract
- **Likelihood:** credible for future/alternate producers, not common for current untouched files
- **Impact:** high because a valid tree can be overwritten
- **Confidence:** high
- **Recommended future correction boundary:** one explicit root classifier that either selects an unambiguous supported representation or opens read-only with diagnostics
- **Suggested future test:** nested-only, divergent-copy and unknown-schema selected-handle load/add/save sequences using actual source and a fake writable handle
- **Product decision required:** precedence and conflict UX for divergent dual trees

### P015-F06: No save-time disk freshness check permits last-writer-wins loss

- **Severity:** RED
- **Category:** concurrency, stale file, integrity
- **Affected flow:** two tabs or another application edit the same selected file after Pocket loaded it
- **Ordinary-use impact:** single-tab, single-writer use is unaffected; concurrent editing of the same file is unsafe
- **Preconditions:** the same file is open in two contexts, or externally edited; both retain write permission; the stale context saves last
- **Evidence:** `assessStaleFileRisk()` compares browser snapshot/backup timestamps only when lowercased filenames match at `js/pocket-storage.js:254–302`; the result is cached at load by `applyLoadedState()` at `js/pocket-storage.js:460–475`; `shouldPauseForStaleExportGuard()` reads only that cached flag at `js/pocket-io-browser.js:655–672`; the physical write path does not re-read `lastModified`, size, content or a hash before `createWritable()` at `js/pocket-io-browser.js:444–459,679–704`
- **Step-by-step failure path:** tab A and B load the same revision → A edits and saves → B's cached guard remains clear → B saves its stale full-tree payload → A's newer content is overwritten
- **Existing mitigation:** explicit manual Save, an exact in-tab handle/session queue, P012 popup source/revision checks, no background writes
- **Missing protection:** a disk revision token captured at load and revalidated immediately before write; a multi-tab coordination or conflict surface
- **Likelihood:** uncommon but realistic in multiple-tab, refresh/reopen or external-editor use
- **Impact:** high because newer truth-file changes can be overwritten
- **Confidence:** high
- **Recommended future correction boundary:** narrow save-time handle freshness preflight, not a file watcher; preserve both versions and require a manual choice on mismatch
- **Suggested future test:** fake handle whose `getFile().lastModified`, size or content changes after load, plus a physical two-tab test
- **Product decision required:** conflict UX and whether a separate-copy action is the default

### P015-F07: Local recovery can fail silently on quota or serialisation pressure

- **Severity:** YELLOW
- **Category:** recovery reliability, observability, scaling
- **Affected flow:** every recorded tree operation
- **Ordinary-use impact:** small current trees usually fit; larger trees or restricted/quota-full storage can lose the newest browser recovery copy without warning
- **Preconditions:** localStorage throws, quota is exhausted, serialisation fails, or data exceeds a snapshot cap
- **Evidence:** `recordOp()` ignores the return from `saveLocalSafetySnapshot()` at `js/pocket-history-status.js:3–9`; the snapshot serialises the full payload and catches failure as `false` at `js/pocket-storage.js:57–110`; trail cloning caps an entry at 900,000 characters and its result is not propagated at `js/pocket-storage.js:333–354`; auto-cache and PiP writes swallow exceptions at `js/pocket-storage.js:503–520` and `js/pocket-import.js:91–107`; last-save clone caps at 5,000,000 characters at `js/pocket-storage.js:523–542`
- **Step-by-step failure path:** edit records an operation → full-tree snapshot write fails → operation remains dirty but UI is not told the current recovery copy failed → health may continue describing an older copy
- **Existing mitigation:** truth-file Save is independent; the operation remains dirty; trail, PiP and last-save copies can provide overlapping recovery
- **Missing protection:** recovery-write acknowledgement, freshness status, quota-specific warning and tests with throwing storage
- **Likelihood:** environment and tree-size dependent
- **Impact:** medium to high after a crash, because perceived recovery may be stale
- **Confidence:** high
- **Recommended future correction boundary:** make recovery success observable without blocking edits; separately report primary snapshot and trail status
- **Suggested future test:** throwing/quota localStorage and large synthetic editor metadata, asserting dirty state plus a calm recovery warning
- **Product decision required:** none for failure visibility; any later choice to block edits when recovery is unavailable would require approval

### P015-F08: Save or undo can clear or leave the current safety snapshot stale

- **Severity:** YELLOW
- **Category:** recovery lifecycle, save race, undo
- **Affected flow:** an edit lands while a write is pending; a no-change Save occurs while an unrelated global snapshot exists; or the user undoes a delete, move or edit
- **Ordinary-use impact:** ordinary quick writes are usually unaffected; delayed writes, cross-file localStorage history and the visible Undo command expose the gap
- **Preconditions:** a new operation is recorded during an awaited write; another file's current snapshot remains while the active file has no operations; or an operation writes its post-mutation snapshot and is then undone
- **Evidence:** `exportTree()` preserves newer operations with `slice(opsAtSaveStart)` at `js/pocket-io-browser.js:700–720`, but then unconditionally calls `clearLocalSafetySnapshot()` at `js/pocket-io-browser.js:728–731`; the no-operation path also clears it at `js/pocket-io-browser.js:692–699`; `recordOp()` stores the post-mutation safety snapshot at `js/pocket-history-status.js:3–9`, while `restoreTreeUndoSnapshot()` replaces the tree and updates only the PiP snapshot at `js/pocket-history-status.js:33–46`
- **Step-by-step failure path:** save freezes payload → newer edit writes a newer safety snapshot → old payload succeeds → newer op correctly remains dirty → current snapshot is nevertheless removed. Separately, a no-change Save in B can remove the origin-global current snapshot from A. For Undo, the original mutation writes its new tree to local safety → Undo restores the prior tree without refreshing local safety → a crash/recovery can resurrect the mutation the user just undid.
- **Existing mitigation:** newer operations remain dirty; trail and PiP may still hold the edit; Undo immediately refreshes the visible tree and PiP snapshot
- **Missing protection:** snapshot generation/content identity and conditional clearing; immediate replacement when newer operations or undo state remain
- **Likelihood:** low to moderate for save races, direct whenever a tree Undo is followed by recovery before another operation
- **Impact:** medium recovery degradation
- **Confidence:** high
- **Recommended future correction boundary:** clear only a snapshot proven covered by the written payload; retain or regenerate recovery for newer operations and every successful tree Undo
- **Suggested future test:** delayed fake write, mid-write new operation, optional trail failure and delete/move/edit Undo, asserting that the current recovery snapshot always represents the latest visible tree
- **Product decision required:** none for preserving the newest recovery state

### P015-F09: The final node cannot be saved or locally recovered after deletion

- **Severity:** YELLOW
- **Category:** empty-state persistence, reliability
- **Affected flow:** deleting the last remaining node
- **Ordinary-use impact:** reachable in ordinary use, although most documents contain multiple nodes
- **Preconditions:** one node remains and is deleted
- **Evidence:** deletion records an operation after removing nodes at `js/pocket-tree-actions.js:143–171` and `js/pocket-multi-select.js:316–342`; `saveLocalSafetySnapshot()` rejects an empty tree at `js/pocket-storage.js:86–87`; `exportTree()` rejects empty state at `js/pocket-io-browser.js:685–691`; `buildEmptyPocketPayload()` proves the root format can represent empty state at `js/pocket-io-browser.js:541–552`; `pocketLite.lastSaveSnapshot.v1` has a writer but no active reader at `js/pocket-storage.js:523–562`
- **Step-by-step failure path:** final node is deleted → operation exists but current safety snapshot is not written → Save returns `empty` → deletion cannot become truth and returns after reload
- **Existing mitigation:** the existing truth file still contains the old node, so this does not destroy the prior version
- **Missing protection:** explicit empty-tree save and recovery policy; user-facing reason
- **Likelihood:** low but direct
- **Impact:** medium, because the user's intended state cannot persist
- **Confidence:** high
- **Recommended future correction boundary:** allow explicit empty truth and empty safety payloads, with the same confirmation and queued-write protections
- **Suggested future test:** delete-last, Save, reopen, cancellation and recovery
- **Product decision required:** whether an empty Pocket file is valid or requires a visible confirmation

### P015-F10: Selected input and path import have no overall resource ceilings

- **Severity:** YELLOW
- **Category:** availability, local denial of service
- **Affected flow:** ordinary JSON selection, invalid/NDJSON selection, slash-path import, huge opaque editor metadata, rendering and search
- **Ordinary-use impact:** normal files are small; a deliberately or accidentally huge locally selected/pasted input can freeze or exhaust the browser
- **Preconditions:** the user deliberately selects or pastes very large or deeply nested content
- **Evidence:** `loadFromFile()` reads the entire file and calls whole-string `JSON.parse()` at `js/pocket-io-browser.js:783–814`; after parse failure it materialises NDJSON parsing even when import fallback is disabled at `js/pocket-io-browser.js:815–847`; `parseNdjsonLines()` splits, trims and filters all lines before the 5,000 accepted-object cap at `js/pocket-import.js:3–19`; node count and tombstones are uncapped; opaque editor cloning is recursive and uncapped at `js/pocket-editor-metadata.js:38–70,97–126`; render/search can classify and clone metadata repeatedly at `js/pocket-render.js:284–361`; slash-path parsing/import has no total byte, entry or depth ceiling at `js/pocket-import.js:533–840,916–1060`
- **Step-by-step failure path:** large local input is fully materialised and recursively cloned/rendered → CPU/memory spikes → per-operation full-tree safety serialisation can amplify large imports and exhaust localStorage
- **Existing mitigation:** explicit local selection/paste is required; individual labels, Notes and Outline blocks have caps; trees begin collapsed
- **Missing protection:** file/byte/node/depth/tombstone/import ceilings and early rejection before parsing/derivation
- **Likelihood:** low accidentally, credible for hostile selected files
- **Impact:** availability loss, not remote exfiltration
- **Confidence:** high
- **Recommended future correction boundary:** evidence-based early size gates and iterative/visited traversal, without reintroducing destructive caps on opaque metadata
- **Suggested future test:** disposable large fixtures and synthetic deep metadata with timing/memory guardrails
- **Product decision required:** practical limits and the read-only fallback for oversized but valid files

### P015-F11: Malformed topology and hostile IDs can hide data or break rendering

- **Severity:** YELLOW
- **Category:** validation, availability, UI integrity
- **Affected flow:** opening nodes with missing parents, self-parenting, cycles or selector-special IDs
- **Ordinary-use impact:** active UI mutations normally create safe IDs and prevent ordinary cycles; hand-edited/hostile selected JSON is affected
- **Preconditions:** a deliberately or accidentally malformed selected file; some recursion cases additionally require matching stale workspace focus or filtering
- **Evidence:** `normaliseNodes()` cleans but does not validate `parentId` at `js/pocket-import.js:301–348`; `childrenMap()` accepts all parent links at `js/pocket-import.js:419–429`; render starts from root children and recursively visits without a visited set at `js/pocket-render.js:326–376,387–553`; workspace focus is restored by ID without source matching at `js/pocket-storage.js:27–54`; inline edit queries an unescaped ID selector at `js/pocket-render.js:558–565`
- **Step-by-step failure path:** orphans/cycles survive and remain exportable but may be invisible → stale focus or filter can recurse into a cycle → call-stack exhaustion; a selector-special ID can make an edit lookup throw
- **Existing mitigation:** generated app IDs are safe; ancestry helpers and delete traversal have guards; disconnected cycles are usually not reached from the root
- **Missing protection:** parent existence/cycle validation, visited render sets and `CSS.escape()` or non-selector lookup
- **Likelihood:** low for current files, credible for hostile local input
- **Impact:** availability and misleading UI, with raw topology generally still preserved
- **Confidence:** high
- **Recommended future correction boundary:** visible topology diagnostics and cycle-safe rendering before deciding whether malformed nodes are read-only or repairable
- **Suggested future test:** orphan, self-cycle, multi-node cycle, stale focus and selector-special ID fixtures
- **Product decision required:** whether topology defects open read-only, are rejected, or enter an explicit repair flow

### P015-F12: Vault accepts file-controlled crypto cost and unbounded encoded input

- **Severity:** YELLOW
- **Category:** security hardening, local denial of service
- **Affected flow:** opening a deliberately hostile or malformed Vault
- **Ordinary-use impact:** Vaults produced by current Pocket use sensible parameters; hostile selected files are affected
- **Preconditions:** the user selects a hostile Vault and enters a passphrase
- **Evidence:** `openJson()` accepts `Number(meta.iterations)` without a finite integer or safe range and decodes arbitrary salt, nonce and payload at `js/pocket-crypto.js:119–133`; base64 decoding is unbounded at `js/pocket-crypto.js:47–53`; Vault IO reads and parses the complete file before size checks at `js/pocket-vault-io-browser.js:63–89`
- **Step-by-step failure path:** huge iteration count or encoded payload reaches Web Crypto/decoder → CPU or memory exhaustion before a friendly rejection
- **Existing mitigation:** unsupported cipher/KDF is rejected; malformed data generally throws and the UI catches it; local selection and passphrase entry are required
- **Missing protection:** envelope/file/payload sizes, exact salt/nonce lengths and an accepted iteration range
- **Likelihood:** low accidental, credible hostile-local-file scenario
- **Impact:** browser availability, not demonstrated data compromise
- **Confidence:** high
- **Recommended future correction boundary:** validate the complete envelope before KDF or large decoding
- **Suggested future test:** hostile iteration, base64, salt, nonce and payload boundaries that fail before `deriveKey()`
- **Product decision required:** practical Vault size and KDF-work ceilings, plus the user-facing outcome for oversized but otherwise recognisable files

### P015-F13: Vault header identity and revision are unauthenticated and inconsistent

- **Severity:** YELLOW
- **Category:** cryptographic envelope, rollback semantics, reliability
- **Affected flow:** Vault save/open, future revision or rollback decisions
- **Ordinary-use impact:** ciphertext confidentiality and authentication remain intact; displayed identity/revision is not trustworthy
- **Preconditions:** an envelope header is modified, a seal/download fails, localStorage fails or multiple Vault documents use the same origin state
- **Evidence:** AES-GCM encrypts only the JSON payload and supplies no `additionalData` at `js/pocket-crypto.js:91–116`; `vaultId`, `revision`, `createdAt` and `contentType` sit outside the ciphertext at `js/pocket-crypto.js:80–88,105–116`; `nextRevision()` persists before sealing/download at `js/pocket-vault.js:30–39,61–68`; `currentVaultId()` uses Date/Math.random origin-global state at `js/pocket-vault.js:41–51`; Vault open neither adopts nor validates a revision chain at `js/pocket-vault-io-browser.js:88–97`
- **Step-by-step failure path:** header display fields can be changed without a tag failure; direct helper use, or a future repaired Save Vault command, can consume a revision before sealing/download succeeds; localStorage failure can reuse it; different Vaults can share one local sequence; rollback is not detected
- **Existing mitigation:** salt/nonce/iterations tampering normally causes key/tag failure; payload ciphertext is AES-GCM authenticated; revision is currently diagnostic rather than an enforced trust decision; F15 blocks the normal Save Vault UI before its revision helper, so the revision-consumption subpath is presently direct-helper or future-repair exposure
- **Missing protection:** authenticated canonical header, explicit Vault identity ownership, post-success revision commit and rollback policy
- **Likelihood:** moderate as reliability debt, low as active security exploitation
- **Impact:** misleading version/identity and unsafe future assumptions, not plaintext compromise
- **Confidence:** high
- **Recommended future correction boundary:** decide revision semantics first, then authenticate header fields as AAD and advance state only after a confirmed artefact
- **Suggested future test:** header tamper, seal failure, storage failure, multiple Vault IDs and rollback
- **Product decision required:** whether revision is merely display metadata or a rollback security boundary

### P015-F14: Decrypted Vault content is copied into plaintext browser storage

- **Severity:** YELLOW
- **Category:** local confidentiality, product contract
- **Affected flow:** Vault open and subsequent edits
- **Ordinary-use impact:** only Vault users are affected; there is no demonstrated remote exfiltration path
- **Preconditions:** the user unlocks a Vault in the browser
- **Evidence:** Vault open calls `applyLoadedState()` at `js/pocket-vault-io-browser.js:88–95`; that writes a full plaintext last-save snapshot and PiP snapshot at `js/pocket-storage.js:477–500,523–542` and `js/pocket-import.js:91–107`; the first edit adds plaintext local safety and trail at `js/pocket-history-status.js:3–9` and `js/pocket-storage.js:86–110`; sealing does not clear the readable in-memory tree or pre-existing browser recovery copies; the passphrase is collected as a transient string through `prompt()` at `js/pocket-vault-io-browser.js:27–30`, passed to crypto and not deliberately persisted by application code
- **Step-by-step failure path:** encrypted file is decrypted → full readable tree is copied to origin localStorage → another user of the browser profile or same-origin code can read it
- **Existing mitigation:** storage remains on-device and same-origin; the current crypto source explicitly promises that readable data stays on-device, not that all browser recovery is encrypted at rest; no application passphrase persistence was found, although a browser prompt is only a basic local UI against shoulder-surfing or clipboard mistakes
- **Missing protection:** a documented Vault-mode recovery policy, storage partition/cleanup, or encrypted recovery
- **Likelihood:** certain when a Vault is opened
- **Impact:** local privacy exposure whose severity depends on the intended Vault promise
- **Confidence:** high
- **Recommended future correction boundary:** decide whether Vault mode permits plaintext browser recovery; then disable with warning, partition and clear, or encrypt it using an explicit unlocked session
- **Suggested future test:** inspect only synthetic storage spies after Vault open/edit/close
- **Product decision required:** whether Vault promises encrypted-at-rest browser recovery

### P015-F15: The active Save Vault command cannot see lexical application state

- **Severity:** YELLOW
- **Category:** availability, global ownership
- **Affected flow:** command-palette `Save Vault`
- **Ordinary-use impact:** optional Vault save is currently unavailable
- **Preconditions:** any non-empty current Pocket document and the user invokes Save Vault
- **Evidence:** the active gate reads `global.state?.nodes` at `js/pocket-vault-io-browser.js:37–43`; `state` is a top-level lexical `const`, deliberately not `window.state`, at `js/pocket-state.js:17–83`; the payload builder itself can access lexical state through `buildPocketPayload()` at `js/pocket-vault.js:54–68`
- **Observed actual-source probe:** `window.state` was undefined while lexical `state` existed; active Save Vault returned false before `sealCurrentPocket()`
- **Step-by-step failure path:** Save Vault is invoked → the gate sees no `window.state.nodes` despite a non-empty lexical state → sealing and download are skipped → the feature reports no usable result
- **Existing mitigation:** no plaintext or encrypted file is accidentally written; direct payload/seal helpers remain testable
- **Missing protection:** a narrow read-only node-count or readiness helper, equivalent to P012's operation-count helper
- **Likelihood:** certain on the active command
- **Impact:** feature availability, not data loss
- **Confidence:** high
- **Recommended future correction boundary:** expose only the minimum read-only readiness signal or let the canonical payload builder validate, never `window.state = state`
- **Suggested future test:** actual command handler with lexical state and download spy
- **Product decision required:** none; this is a narrow ownership defect

### P015-F16: Capture-phase cutover loses selected-node identity for several Edit controls

- **Severity:** YELLOW
- **Category:** reachable UI defect, editor routing
- **Affected flow:** topbar Edit, command-palette Edit, old popout control and the click-only row mini-menu Edit
- **Ordinary-use impact:** double-click and explicit-ID programmatic routes work; several visible button/menu routes can report no selection instead of opening PE
- **Preconditions:** a node is selected and an Edit control outside a `[data-node-id]` row is clicked
- **Evidence:** `selectedNode()` falls back only through unavailable `global.state` at `js/pocket-editor-cutover-v3.js:25–35`; capture routing derives an ID only from an ancestor row, then prevents and stops the event before calling `openDirect()` at `js/pocket-editor-cutover-v3.js:160–190`; visible controls are wired with lexical `state.selectedId` in bubble handlers at `js/pocket-overlays-init.js:350–363,426–467`, but capture prevents those handlers; the click-only mini-menu buttons are appended outside the row and carry no node ID at `js/pocket-overlays-init.js:120–215`
- **Step-by-step failure path:** control click reaches document capture → row ID is blank → original handler is stopped → `openDirect(null)` cannot read lexical selection via `window.state` → PE does not open
- **Existing mitigation:** row double-click passes an explicit row ID; Enter and direct aliases pass explicit node IDs; the pointerdown-driven context action at `js/pocket-render.js:193–270` can open before the later click capture; Murray's prior physical acceptance covered working Text/Outline popups but not every entry route
- **Missing protection:** one explicit-ID route for all controls and a DOM reachability test in real script order
- **Likelihood:** high for the affected controls
- **Impact:** local availability/frustration, no data mutation
- **Confidence:** high from event and ownership trace; physical confirmation remains useful
- **Recommended future correction boundary:** repair only the canonical Edit entry routing, without reviving the legacy fallback
- **Suggested future test:** actual-index click capture for topbar, command palette, both row menus, double-click and Enter; canonical open exactly once
- **Product decision required:** none; preserve the accepted canonical editor and make every visible entry supply an explicit node ID

### P015-F17: The loaded legacy editor stack remains a load-order safety dependency

- **Severity:** YELLOW
- **Category:** architecture, maintainability, latent security
- **Affected flow:** editor opening, legacy drafts, dirty guards, status wrappers and save listeners
- **Ordinary-use impact:** current canonical routing is safe; maintenance changes can revive weaker or competing owners
- **Preconditions:** future script-order, event-owner or alias changes, or direct programmatic calls to legacy globals
- **Evidence:** old v1/v2 popup and inline-detail scripts load before canonical modules in `index.html:147–179`; cutover currently suppresses old UI handlers with capture and fail-closed canonical routing at `js/pocket-editor-cutover-v3.js:123–215`; the defined `openLegacyFallback()` is unused at `js/pocket-editor-cutover-v3.js:83–109`; legacy globals/wrappers remain installed by `js/pocket-editor-popout.js`, `js/pocket-editor-popout-v2.js`, `js/pocket-editor-conflict.js`, `js/pocket-editor-rebase.js`, `js/pocket-pe-save-dirty.js` and old inline helpers
- **Step-by-step failure path:** a later load/event change bypasses cutover → old popup/draft/status/dirty ownership becomes reachable → weaker identity, generated-script or acknowledgement behaviour reappears
- **Existing mitigation:** canonical aliases ultimately reach `PocketNodePopoutEditor`; P012 rejects unbound old saves; old dirty wrappers target different popup names; tests prove canonical-open failure does not fall back
- **Missing protection:** removal/isolation of obsolete owners and an actual-index event ownership test
- **Likelihood:** medium as a maintenance regression
- **Impact:** potentially high if a safe owner is displaced, but no current bypass was found
- **Confidence:** high
- **Recommended future correction boundary:** characterise every live Edit route, then remove legacy v1/v2, obsolete listeners and old wrappers from active load in one focused retirement task
- **Suggested future test:** full index order and all UI/programmatic entry points, asserting one canonical owner and zero legacy opens/applies
- **Product decision required:** whether any legacy inline draft or conflict-recovery behaviour is still a supported user promise before its code is removed

### P015-F18: Legacy save messages are not bound to origin or popup source

- **Severity:** YELLOW
- **Category:** message hardening, in-memory integrity
- **Affected flow:** obsolete `pocketEditorPopout:save` and acknowledgement messages
- **Ordinary-use impact:** normal canonical PE does not use this message path
- **Preconditions:** an unexpected browsing context has a Window reference and supplies a valid current P012 node ID, revision and small session ID
- **Evidence:** capture listener `handlePopoutSaveWithAck()` checks only message type, then calls apply and acknowledges `ev.source` with `"*"` at `js/pocket-editor-save-ack.js:7–33`; a second unbound listener exists at `js/pocket-editor-popout.js:271–280`; old popup acknowledgement accepts any sender at `js/pocket-editor-popout.js:219–224`; the final apply chain delegates to canonical P012 checks through `js/pocket-editor-conflict.js:68–103`, `js/pocket-editor-popout-v2.js:7–9,180–183` and `js/pocket-editor-popout.js:232–241`
- **Observed actual-source probe:** an arbitrary synthetic source with a correctly bound payload changed title/Notes, recorded one operation and received an acknowledgement; it did not export because the legacy route calls `apply()`, not `applyAndSave()`
- **Step-by-step failure path:** an unexpected window obtains the current binding values → it sends a legacy save message → the unbound listener accepts it and canonical apply changes in-memory state → an explicit later Main Save can persist that mutation
- **Existing mitigation:** blind or unbound messages fail P012; no practical hostile same-origin launch or ingress route was found
- **Missing protection:** exact tracked source, feasible origin handling and a per-open nonce
- **Likelihood:** low and local/high-friction
- **Impact:** in-memory integrity with possible later persistence through explicit Main Save
- **Confidence:** high
- **Recommended future correction boundary:** delete the obsolete listeners with legacy retirement; if temporarily retained, bind source/origin/nonce
- **Suggested future test:** wrong origin/source with otherwise valid payload causes zero node, operation and export changes
- **Product decision required:** none if the obsolete listener has no supported compatibility promise; otherwise the required legacy support period must be stated

### P015-F19: Document PiP dirty-state messages accept unrelated senders

- **Severity:** YELLOW
- **Category:** message hardening, availability
- **Affected flow:** closing a Document PiP host
- **Ordinary-use impact:** only PiP close prompts are affected
- **Preconditions:** an unrelated same-page/window context can message the PiP host
- **Evidence:** child sends `pocketLite:dirtyState` to `"*"` at `js/pocket-editor-copy.js:97–105`; host accepts only the type and boolean at `js/pocket-io-browser.js:43–55`
- **Step-by-step failure path:** forged `true` sets host dirty → unnecessary close warning. Forged `false` is rechecked against the iframe's direct `hasUnsavedChanges()` and does not reliably bypass protection.
- **Existing mitigation:** direct iframe dirty recheck at `js/pocket-io-browser.js:49–50`; no content or mutation is carried
- **Missing protection:** `ev.source === iframe.contentWindow` and feasible origin validation
- **Likelihood:** low
- **Impact:** nuisance/availability, not truth integrity
- **Confidence:** high
- **Recommended future correction boundary:** bind the message while implementing P015-F03's PiP session contract
- **Suggested future test:** unrelated source true/false messages do not change host dirty state
- **Product decision required:** none; source binding is defence in depth

### P015-F20: Repository CI does not run the focused production-source suite

- **Severity:** YELLOW
- **Category:** test coverage, maintainability
- **Affected flow:** every future push and pull request
- **Ordinary-use impact:** no immediate runtime defect; regressions can pass the only tracked workflow
- **Preconditions:** a change breaks behaviour not modelled by the custom checker
- **Evidence:** `.github/workflows/pocket-check.yml:1–15` runs only `npm run check`; `package.json:1–7` maps that to `tools/pocket-check.js`; the checker largely inventories/static-checks and still models retired `node.pe` concepts at `tools/pocket-check.js:177–315,318–459`, then checks only a known Enter pair/load list at `tools/pocket-check.js:517–544`; it does not run `tests/pe-persistence-contract.test.js` or syntax-check all active scripts. GitHub Actions history queried on 2026-07-24 showed successful `Pocket check` and Pages deployment runs for the P014 SHA; Pages deployment is not behavioural test coverage, and no focused-suite run was present.
- **Step-by-step failure path:** a production change breaks a safety contract covered only by the focused suite → the tracked workflow runs the older checker alone → the regression can merge without CI detecting it
- **Existing mitigation:** the 94-case suite executes actual source in controlled VM/runtime harnesses and has been run manually for P010–P015
- **Missing protection:** CI invocation of the focused suite and active-script syntax checks
- **Likelihood:** high as a process gap
- **Impact:** delayed detection of safety regressions
- **Confidence:** high
- **Recommended future correction boundary:** add a separate focused-test and syntax job, then retire or rescope the stale checker through an approved task
- **Suggested future test:** the workflow itself should run the existing direct command on Node 20
- **Product decision required:** whether the broad checker is retained, respecified or retired after focused CI is established

### P015-F21: Create New deliberately seeds a new file from current recovery

- **Severity:** INFORMATIONAL
- **Category:** documented product behaviour
- **Affected flow:** Create New while a local-safety snapshot exists
- **Ordinary-use impact:** the command can create a new file containing recovered work rather than an empty tree; it does not overwrite the old active file
- **Preconditions:** a current local-safety snapshot exists and the user explicitly chooses Create New and a destination
- **Evidence:** the gate presents recovery-oriented wording at `js/pocket-render.js:63–147`; `payloadForNewPocketFile()` chooses the recovery payload at `js/pocket-io-browser.js:563–570`; `createNewPocketFile()` writes a newly picked handle before adopting it and clears snapshot/operations only after success at `js/pocket-io-browser.js:572–609`
- **Step-by-step failure path:** no defect was confirmed: recovery exists → Create New presents recovery-oriented UI → the user chooses a new handle → only that newly selected destination receives the recovery payload
- **Existing mitigation:** explicit user action and a newly picked destination are required; cancellation changes nothing; the prior active handle is not used
- **Missing protection:** the label and product contract do not make the recovery-seeding meaning unmistakable
- **Likelihood:** expected whenever recovery exists and the user chooses Create New
- **Impact:** potentially surprising content in a new destination, but no overwrite of an existing file
- **Confidence:** high
- **Conclusion:** this is surprising but does not overwrite a pre-existing active handle. It appears to be an intentional “finish saving recovery” path, not a confirmed wrong-file defect.
- **Recommended future correction boundary:** clarify the button label and product contract before changing it
- **Suggested future test:** recovery present/absent and cancelled picker, confirming only the newly picked handle is touched
- **Product decision required:** whether “Create New” should mean empty document or recovery destination

### P015-F22: Several loaders and storage routes are dormant rather than active risks

- **Severity:** INFORMATIONAL
- **Category:** dead code, maintainability
- **Affected flow:** NDJSON/change-log adoption, auto-cache startup/restore, local Vault storage and service-worker caching
- **Ordinary-use impact:** none at this baseline because the relevant adoption or registration owners are not active
- **Preconditions:** a future change revives one of these routes without adding current document/session protections
- **Evidence:** `autoLoadAtStartup()` returns false and `loadLatestSnapshotFromChangeLog()` has no caller at `js/pocket-import.js:66–89`; `restoreAutoCache()` has no adoption owner at `js/pocket-storage.js:564–588`; active Choose File never sets `allowImportFallback: true` at `js/pocket-io-browser.js:375–408,783–897`; hidden `undoLastImportBatch()` only delegates to generic tree Undo at `js/pocket-import.js:1084–1086`, while no active code reveals its control; `pocket-vault-local.js` is not loaded; `sw.js` has no registration call in tracked source
- **Step-by-step failure path:** no current path reaches adoption or service-worker registration; risk appears only if a dormant helper is wired back into an active flow without an explicit owner
- **Existing mitigation:** no active caller, registration or import-fallback flag exposes these routes
- **Missing protection:** explicit deletion or ownership tests would prevent accidental revival
- **Likelihood:** none at the baseline; dependent on a future revival
- **Impact:** none now; a future ownership or availability regression if revived casually
- **Confidence:** high for tracked baseline reachability
- **Conclusion:** NDJSON/change-log, auto-cache startup, import-specific Undo, local Vault alternative and service worker issues are dormant cleanup, not active wrong-write or network findings. If import Undo were exposed, it could undo no matching import snapshot or an unrelated prior tree action. The JSON-parse failure path still incurs NDJSON parsing cost, which is covered by P015-F10.
- **Recommended future correction boundary:** delete or explicitly own each route before revival, with source/session tests
- **Suggested future test:** an actual-index reachability test proving these routes remain inactive, followed by source/session tests if any is intentionally revived
- **Product decision required:** none while dormant; future product approval is required before revival

### P015-F23: Dormant legacy popup generators have a confirmed script-injection boundary

- **Severity:** INFORMATIONAL
- **Category:** dormant security debt
- **Affected flow:** direct or future revival of legacy v1/v2 popups
- **Ordinary-use impact:** none through the accepted canonical UI; direct global or future maintenance use would be unsafe with hostile local text
- **Preconditions:** code or a maintainer directly invokes a legacy generator with text containing an HTML script terminator, or restores a normal UI route to it
- **Evidence:** v1 HTML-escapes visible fields but interpolates raw `JSON.stringify()` into an inline script at `js/pocket-editor-popout.js:14–16,72–89,147–151`; v2 repeats the pattern at `js/pocket-editor-popout-v2.js:17–19,88–100,144–146`
- **Observed actual-source probe:** a synthetic `</script><script>…` title produced a second script start in v1 output
- **Step-by-step failure path:** no ordinary baseline route reaches the generator; if revived, hostile selected-file text can terminate the inline script and create executable markup in that legacy popup
- **Existing mitigation:** canonical cutover intercepts normal editor opens; the canonical popup escapes `<`; P012 rejects unbound legacy saves
- **Missing protection:** the dormant generators themselves lack the canonical safe serializer
- **Likelihood:** none through ordinary baseline use; dependent on direct invocation or future revival
- **Impact:** none now; script execution in the legacy popup if revived with hostile locally selected text
- **Confidence:** high
- **Conclusion:** no ordinary baseline UI reaches these generators, and unbound legacy saves fail P012. This is not an active XSS finding, but revival would be unsafe.
- **Recommended future correction boundary:** remove with legacy retirement; if retained, use the canonical serializer and full generated-HTML tests
- **Suggested future test:** actual generated legacy HTML with closing-script input, coupled with an index-route test proving it remains unreachable until deletion
- **Product decision required:** whether any legacy popup remains supported

### P015-F24: Architecture and manual-test documentation has drifted

- **Severity:** INFORMATIONAL
- **Category:** documentation and maintenance
- **Affected flow:** future maintenance and physical acceptance planning
- **Ordinary-use impact:** none at runtime; a maintainer can follow obsolete ownership or conversion guidance
- **Preconditions:** a future task relies on the older documents or embedded manual checklist instead of current active source and the P010–P014 contract
- **Evidence:** `docs/ARCHITECTURE.md:54,191–192` describes a legacy fallback that current cutover does not call; `docs/ARCHITECTURE.md:155,245–247` refers to removed conversion semantics inconsistent with P013; `docs/MIGRATION_STATUS.md:7–8` names an untracked route and a stale paused state; `js/pocket-editor-test-loop.js:7–15` describes old inline/conflict/drag ownership; `js/pocket-pe-simple-standalone.js:1–4` claims it is loaded and names a nonexistent file
- **Step-by-step failure path:** stale guidance is treated as current → a future change targets or revives the wrong owner → accepted behaviour can regress even though the documentation edit itself has no runtime effect
- **Existing mitigation:** recent `docs/PE_PERSISTENCE_CONTRACT.md`, tests and active-source inspection are more accurate
- **Missing protection:** one maintained ownership map and removal of stale manual guidance when its code is retired
- **Likelihood:** credible during future maintenance
- **Impact:** misdirected implementation or acceptance work that regresses an established boundary
- **Confidence:** high
- **Conclusion:** recent `docs/PE_PERSISTENCE_CONTRACT.md` is more accurate. Drift could mislead a future maintainer but does not change runtime.
- **Recommended future correction boundary:** update only in the future implementation task that changes the corresponding owner
- **Suggested future test:** static ownership assertions can supplement, but not replace, actual-source event and route tests
- **Product decision required:** none

### P015-F25: A strict Content Security Policy is not represented by current architecture

- **Severity:** INFORMATIONAL
- **Category:** defence in depth
- **Affected flow:** deployment hardening and canonical popup creation
- **Ordinary-use impact:** no confirmed exploit follows from CSP absence alone
- **Preconditions:** a future deployment adopts a strict CSP, or another injection flaw appears that CSP could have limited
- **Evidence:** no in-document CSP exists; the canonical popup uses `document.write()` and a generated inline script at `js/pocket-node-popout-template.js:128–130`; no external third-party application scripts were found
- **Step-by-step failure path:** no current exploit path was established; the generated inline runtime means a strict self-only policy would currently block the canonical popup unless nonces, hashes or externalisation are introduced
- **Existing mitigation:** canonical encoding was verified; no third-party runtime or user-controlled network destination was found
- **Missing protection:** repository-level CSP definition and an architecture compatible with a strict inline-script policy
- **Likelihood:** deployment-dependent
- **Impact:** no confirmed current integrity loss; strict-policy adoption would break popup availability until the runtime boundary changes
- **Confidence:** medium because deployment headers are outside the repository
- **Conclusion:** CSP absence is not itself an exploit, and deployment headers cannot be inferred from this repository. A strict `script-src 'self'` would require nonce/hash support or externalised runtime rather than a one-line header.
- **Recommended future correction boundary:** revisit after legacy editor retirement and canonical generated-HTML characterisation
- **Suggested future test:** inspect deployed response headers and exercise the canonical popup under a report-only CSP before enforcement
- **Product decision required:** whether CSP hardening is a current deployment requirement

### P015-F26: Generic-extra `__proto__` input does not currently pollute global prototypes

- **Severity:** INFORMATIONAL
- **Category:** disproved security hypothesis
- **Affected flow:** generic root-extra normalisation and export
- **Ordinary-use impact:** none confirmed
- **Preconditions:** a deliberately selected JSON file supplies a magic `__proto__` key in generic extras
- **Evidence:** `normaliseRootExtras()` assigns into a fresh local object at `js/pocket-data.js:405–438`; a controlled actual-source probe showed a supplied `__proto__` changed only that local object's prototype, created no enumerable own property, did not pollute `Object.prototype`, and did not survive spread/JSON export
- **Step-by-step failure path:** the hypothesised path stops at the fresh local object's prototype; it neither mutates `Object.prototype` nor produces an enumerable exported field
- **Existing mitigation:** fresh-object assignment plus later spread/JSON serialization prevents the supplied key from reaching global prototypes or persisted output
- **Missing protection:** explicitly rejecting magic keys would make the contract clearer, but no exploitable gap was established
- **Likelihood:** an exploit was not established
- **Impact:** none at the baseline
- **Confidence:** high
- **Conclusion:** filtering magic keys would improve clarity, but current paths do not establish exploitable prototype pollution
- **Recommended future correction boundary:** optional explicit magic-key rejection only alongside normalisation-contract work, not as an urgent standalone fix
- **Suggested future test:** retain the controlled prototype assertion if extras handling is changed
- **Product decision required:** none

## 5. Confirmed GREEN boundaries

### P015-G01: Explicit file gate and delayed handle adoption

`initialisePocketFileGate()` clears active ownership at startup and stores only a recent filename hint at `js/pocket-io-browser.js:279–354`. `canModifyPocket()` requires an active writable handle or explicit PiP session at `js/pocket-io-browser.js:147–220`. A candidate selected handle is adopted only after read, parse and normalisation succeed at `js/pocket-io-browser.js:375–415,791–799,850–897`. Invalid JSON, read failures and unrecognised shapes do not replace the current handle.

### P015-G02: P012 PE source-session and node-revision checks

Canonical PE opening carries safe source identity and exact `updatedAt` at `js/pocket-node-popout-model.js:302–332`. Apply checks modifiable file, identity, current session, node existence, original revision, unsupported metadata and raw save preflight before mutation at `js/pocket-node-popout-editor.js:68–190`. File A's stale popup cannot mutate same-ID B, and the popup remains dirty after rejection.

### P015-G03: Unsupported editor metadata remains opaque and read-only

P011 exact-gates current v1 and preserves unsupported raw JSON through normalisation in `js/pocket-editor-metadata.js:72–137` and `js/pocket-import.js:339–345`. Payload construction exposes only readable `details`, not raw unsupported metadata, at `js/pocket-node-popout-model.js:302–332`. Runtime and direct apply both enforce read-only at `js/pocket-node-popout-runtime.js:8–46,674–773` and `js/pocket-node-popout-editor.js:161–174`.

### P015-G04: Queued save targets are session-bound

`capturePocketFileSaveSession()` includes exact handle identity at `js/pocket-io-browser.js:151–166`. Queue, picker and post-write checks at `js/pocket-io-browser.js:462–539,679–736` prevent a stale save from being redirected to newly active B. A physical write already in progress may finish against old A and then report `file-session-changed`, but B is not written. This is conservative acknowledgement ambiguity, not wrong-file redirection.

### P015-G05: Operations clear only after confirmed truth persistence

`exportTree()` freezes a point-in-time payload, awaits write result, verifies session or approved picked-file adoption, and only then slices operations at `js/pocket-io-browser.js:700–736`. Edits made during the write remain in `state.ops`. Failed, cancelled and stale-guard outcomes retain operations. Download fallback does call the broadly named `markSavedNow()` to record backup metadata, but returns `downloaded-copy`, retains operations and explicitly says “separate copy” at `js/pocket-io-browser.js:637–652,751–759`; the dirty Save chip therefore remains active. The helper name is maintenance debt, but the current UI does not claim that a downloaded copy became the active truth file. P015-F08 is a narrower recovery-snapshot clearing issue, not an operation-loss contradiction.

### P015-G06: Physical write errors are handled conservatively

Permission is queried/requested at `js/pocket-io-browser.js:356–371`; `createWritable()`, `write()` and `close()` are awaited and abort is attempted on error at `js/pocket-io-browser.js:444–459`; operations are not cleared on failure. The implementation relies on browser File System Access safe-write behaviour, so platform atomicity and power-loss durability remain unproven rather than claimed.

### P015-G07: Canonical generated popup escaping and dirty reuse are sound

Canonical JSON replaces `<` with `\u003c` at `js/pocket-node-popout-window.js:8–31`; template fields are HTML-escaped at `js/pocket-node-popout-template.js:5–31,107–130`; Outline content uses DOM creation and `textContent` at `js/pocket-node-popout-runtime.js:477–519`. Named-window reuse checks one canonical dirty API before and after `window.open()` at `js/pocket-node-popout-window.js:52–149`. A hostile synthetic canonical payload did not create a second script element.

### P015-G08: Vault cryptographic primitives are appropriate

The core uses AES-256-GCM, fresh CSPRNG 16-byte salts and 12-byte nonces, PBKDF2-HMAC-SHA-256 with a 310,000 default, non-extractable keys and authenticated ciphertext at `js/pocket-crypto.js:12–22,27–77,91–117`. It enforces an eight-character minimum before both derivation paths at `js/pocket-crypto.js:56–77`; that is a modest usability policy whose real strength still depends on the user's passphrase, not a substitute for parameter validation. A stronger KDF might be a future platform choice, but 310,000 PBKDF2 iterations are not classified as weak here. P015-F12 and P015-F13 concern validation and envelope ownership, not the core primitives.

### P015-G09: Recent-file metadata does not silently retain write authority

IndexedDB stores only display name and timestamp, not a `FileSystemFileHandle`, at `js/pocket-io-browser.js:279–345`. Failure is soft. Startup clears the file session and presents the hint without silently reopening a writable handle at `js/pocket-io-browser.js:348–354`.

### P015-G10: No autosave, background truth write or active external content destination was found

Truth writes are reachable only through explicit Main/PE/PiP save or Create New actions. No file watcher, cloud sync, dynamic external import, third-party runtime dependency or content-controlled network destination is active. `readSourceText()` uses fixed dormant same-origin candidate paths at `js/pocket-storage.js:590–638`; `sw.js` is unregistered. Browser recovery writes are not truth-file writes. The tree has one active Enter owner through `handleTreeKeydown()` at `js/pocket-tree-actions.js:787–804` and its single binding at `js/pocket-overlays-init.js:560`; the older capture helper explicitly leaves Enter disabled at `js/pocket-enter-copy-only.js:394–407`. Copy-context payloads still prefer `details` over the label at `js/pocket-editor-copy.js:542–559`.

## 6. Editor ownership map

| Script or surface | P015 classification | Reachability and role |
|---|---|---|
| `js/pocket-editor-metadata.js` | Canonical active owner | Exact editor classification and opaque JSON preservation |
| `js/pocket-node-popout-template.js` | Canonical active owner | Popup document shell and escaped visible fields |
| `js/pocket-node-popout-runtime.js` | Canonical active owner | Generated Notes/Outline UI, dirty state, P006–P008 interactions and direct opener save |
| `js/pocket-node-popout-model.js` | Canonical active owner | Payload, P011 classification and P012 non-lossy preflight |
| `js/pocket-node-popout-window.js` | Canonical active owner | Fixed popup reference, reuse, pending-open and dirty-switch ownership |
| `js/pocket-node-popout-target.js` | Canonical active owner | Strict node lookup; selected-node fallback uses unavailable `window.state`, but normal canonical callers pass IDs |
| `js/pocket-node-popout-editor.js` | Canonical active owner | Open, apply, revision/session defence and truth export |
| `js/pocket-pe-node-popout-bridge.js` | Active alias | Delegates `PocketPeEditor` to canonical owner |
| `js/pocket-editor-cutover-v3.js` | Active UI routing owner | Capture routing to canonical PE; legacy fallback is defined but unreachable |
| `js/pocket-pe-save-dirty.js` | Active wrapper plus dormant old instrumentation | Final alias still delegates open/apply/save to canonical; old popup-name instrumentation does not match canonical name |
| `js/pocket-editor-popout.js` | Loaded legacy/dormant UI | V1 global and live message listener; dynamic apply delegates to canonical P012 |
| `js/pocket-editor-popout-v2.js` | Loaded legacy/dormant UI | Overwrites legacy global, direct programmatic opener remains; no normal current route |
| `js/pocket-editor-conflict.js` | Active legacy wrapper | Wraps only `PocketEditorPopout`, not canonical PE |
| `js/pocket-editor-save-ack.js` | Active compatibility protection with hardening gap | Capture listener for legacy save messages, covered by P015-F18 |
| `js/pocket-editor-popout-source-lock.js` | Old inline-details only | Target listener suppressed by cutover; relies on `window.state` |
| `js/pocket-editor-popout-node-guard.js` | Old inline-details only | Target listener suppressed by cutover |
| `js/pocket-editor-popout-fresh.js` | Old inline-details only | Draft-choice listener suppressed by cutover |
| `js/pocket-editor-handoff.js` | Old inline-details only | Handoff flags/listener suppressed by cutover |
| `js/pocket-editor-rebase.js` | Active but semantically old wrapper | Wraps status text associated with old inline flow |
| `js/pocket-editor-human-close.js` | Dormant compatibility wrapper | Wraps `window.open` only for obsolete `pocketStandalonePe` |
| `js/pocket-pe-import-preserve.js` | Dormant compatibility wrapper | Wraps only obsolete `pocketSimplePe_` names; no normaliser ownership |
| `js/pocket-enter-copy-only.js` PE wrapper | Dormant compatibility wrapper | Obsolete simple-PE names; active main-tree Enter remains one owner |
| `js/pocket-editor-visual-sync.js`, `pocket-detail-dirty.js`, `pocket-detail-drag.js`, `pocket-editor-joy.js` | Old inline-details support | Loaded, but current cutover hides the inline UI |
| `js/pocket-editor-test-loop.js` | Active manual overlay, stale instructions | Describes old inline/conflict/drag testing rather than current canonical ownership |
| `pe-editor.html` | Tracked, not loaded | Complete dormant alternate PE; its save payload at `pe-editor.html:135–140` lacks P012 source identity/revision and would fail closed through canonical apply |
| `js/pocket-outline-model.js` | Tracked, not loaded | Dormant alternate `pocket.outline.v1` model at `js/pocket-outline-model.js:1–24,210–220`; unrelated to the accepted `pocket.nodeEditor.v1` owner |
| `js/pocket-pe-simple-standalone.js`, `pocket-pe-esc-close.js`, `pocket-pe-version-v05.js` | Tracked, not loaded | Dormant code only |
| `pocket-editor-popout-default.js` | Absent | Correctly not restored or routed |

Final active globals are:

- `PocketNodePopoutEditor`: canonical frozen object;
- `PocketPeEditor`: wrapper over the canonical bridge;
- `openPocketPeEditor`: canonical-opening alias;
- `openPocketNodeEditor` and `openPocketEditor`: cutover aliases;
- `PocketEditorPopout`: conflict wrapper over v2 and v1 canonical apply delegation;
- `PocketEditorPopoutV2`: direct dormant v2 opener;
- `window.open`: wrapper chain that reacts only to obsolete popup names; and
- `setStatus`: wrapped by old rebase logic.

Script order is therefore part of current correctness even though the final canonical apply owner is strong.

## 7. State-adoption and file-ownership map

| Route | Session rotation | Handle result | Source / `writtenAt` result | Operations | PE opened before route | Later Main Save destination | Local recovery offer | Risk | Current tests |
|---|---|---|---|---|---|---|---|---|---|
| Ordinary selected JSON | Forced after successful recognition | Chosen handle replaces old | Selected filename plus normalised schema/time | Cleared | Rejected by new session | Chosen file | Timestamp-only newer-snapshot offer can appear | GREEN for valid current shape; offer is F01 | Session reload tested |
| Recognised empty JSON | Forced | Chosen handle replaces old | Selected filename; schema/time may be empty after shape mismatch | Cleared | Rejected by new session | Save blocked until a node exists | Suppressed by `skipLocalSafetyCheck` | F05/F09 shape risk | Empty recognition partially tested |
| Create New | Forced after new handle write succeeds | Newly picked handle | New filename and new payload time | Cleared | Rejected by new session | New file | Existing recovery can seed payload; no later offer | INFORMATIONAL recovery seeding | Identity tested, recovery seed not end-to-end |
| First Save / Save As picker | Forced only after write and old-session proof | Newly picked handle | Filename changes; in-memory source time remains its prior label until a later load | Covered ops clear after success | Saving PE adopts returned identity; other old bindings reject | Picked file | No adoption-time offer | GREEN | Picked adoption tested |
| Automatic current recovery offer | Forced by renewal | Current handle retained | Snapshot filename and capture time replace visible source labels | Snapshot ops restored | Rejected by new session | Current handle | This is the offer/restore route | RED F01 | Timestamp behaviour present, cross-source write absent |
| Manual previous recovery version | Forced by renewal | Current handle retained | Trail source filename and capture time | Snapshot ops restored | Rejected by new session | Current handle | Manual global trail, no source filter | RED F01 | No cross-source test |
| Phone-mode recovery | Forced by restore | Current handle retained | Snapshot source filename and capture time | Snapshot ops restored | Rejected by new session | Current handle | Automatic current-snapshot restore can run | RED F01, automatic path | No active handler test |
| Auto-cache restore | None, reader only | No adoption owner | Reader returns cached labels only | N/A | Unchanged | N/A | No active offer | Dormant | Reader normalisation tested |
| PiP startup snapshot | Forced PiP session | Handle cleared/null | Snapshot source labels | Snapshot ops retained | No pre-existing PE in the new PiP document | Main host or later picker | Direct PiP snapshot restore, not local-safety offer | Appropriate for PiP startup | Recovery normalisation tested |
| PiP return to main | Forced by renewal | Main's current handle retained | PiP source labels replace main labels | PiP ops replace main ops | Rejected by new session | Main's retained handle | No local-safety offer | RED F03 | Rotation only |
| Vault open | Forced by renewal | Previous JSON handle retained | Vault filename and decrypted/envelope time | Cleared | Rejected by new session | Previous JSON handle after an edit | Suppressed by `skipLocalSafetyCheck` | RED F02 | Rotation/no-write-on-open only |
| NDJSON/change-log load | No active caller | N/A | Parsed snapshot labels if revived | N/A | N/A | N/A | No active offer | Dormant, size debt F10 | Pure parsing covered narrowly |
| File path-import fallback | Active caller never enables it | N/A | Would be import source labels, not a new owner | N/A | N/A | N/A | No active offer | Dormant | No end-to-end route |
| Inline slash-path import | No document adoption | Current handle retained | Current source unchanged | New operation(s) | Remains valid unless its own node revision changed | Current file | Normal operation safety snapshot, no restore offer | Availability F10 | Functional import coverage outside P015 scope |
| Tree Undo | No document adoption | Current handle retained | Current source unchanged | Original operation remains | Target-node revision is revalidated by P012 | Current file | No offer; primary snapshot can remain stale | Local-safety snapshot can remain post-mutation, F08 | No safety-freshness assertion |
| Alternate supported root schema | Same as ordinary selected load | Chosen handle | Selected filename plus schema-specific time | Cleared | Rejected by new session | Chosen file | Same timestamp-only offer as ordinary load | Root precedence F05 | Precedence unit characterisation |
| Raw array root input | Same as ordinary selected load | Chosen handle | Selected filename; no root schema metadata | Cleared | Rejected by new session | Chosen file | Timestamp-only offer can appear | Compatibility route; normal node-loss rules F04 still apply | Array normalisation characterised |
| Top-level popup fallback for PiP | Separate window restores its own PiP snapshot/session | No handle; later Save requires a picker | Snapshot source labels | Snapshot operations retained | Independent window | Newly picked file only | Direct PiP snapshot restore, no local-safety offer | No wrong-handle route; availability/reuse remains a browser uncertainty | No real-browser fallback test |
| Startup fallback | Disabled | Session cleared | Empty source | Empty | No editable PE can open | None until selected/created | No offer until a file is selected | GREEN explicit gate | Gate/source tests |

Reloading the same handle as a new document deliberately forces a new session. A routine successful write to the already active handle does not rotate the session. This is correct for P012 and distinct from the whole-document ownership defects above.

Raw arrays are an accepted compatibility root at `js/pocket-import.js:400–408`; they receive ordinary node normalisation without root metadata. The non-Document-PiP fallback opens a separate `?pip=1` top-level window at `js/pocket-io-browser.js:3–22`; that window restores the PiP snapshot into a null-handle PiP session at `js/pocket-import.js:110–148` and saves through its own picker path at `js/pocket-io-browser.js:763–780`. It therefore does not return state through the RED F03 host callback.

## 8. Storage and recovery map

| Storage key or store | Content | At-rest form | Size boundary | Source binding | Failure visibility | Restore owner |
|---|---|---|---|---|---|---|
| `pocketLite.workspace.state.v1` | Source labels, selection, focus, collapse | Plaintext JSON | Browser quota only | Labels only; not checked before UI restore | Silent boolean | `restoreWorkspaceState()` |
| `pocketLite.localSafety.snapshot.v1` | Full dual-tree payload, operations and UI state | Plaintext JSON | Browser quota only | Filename/timestamp labels only | `false` ignored by `recordOp()` | Active automatic/manual recovery |
| `pocketLite.localSafety.trail.v1` | Up to eight full recovery entries | Plaintext JSON | Each appended clone up to 900,000 chars | Global mixed-source trail | Failure ignored | Manual previous-version restore |
| `pocketLite.lastSaveSnapshot.v1` | Full saved/baseline payload | Plaintext JSON | Clone up to 5,000,000 chars | Source labels | Silent `false` | No active reader |
| `pocketLite.auto.cache.v1` | Full normalised tree | Plaintext JSON | Browser quota only | Source labels | Exception swallowed | Reader exists, no adopter |
| `pocketLite.pip.snapshot.v1` | Full tree, extras, operations and UI state | Plaintext JSON | Browser quota only | Source labels, no base session | Exception swallowed | Active PiP startup |
| `pocketLite.lastBackup.meta.v1` | Filename, time and node count | Plaintext JSON | Small fixed metadata | Filename only | `null` | Status/conflict helper |
| `pocketLite.instanceId.v1` | Origin-wide instance ID | Plaintext string | 80-char read boundary | Origin, not document | Ephemeral fallback | Export guard metadata |
| `pocket.vault.state.v1` | Vault ID/revision metadata | Plaintext JSON | Browser quota only | Origin-global, not opened Vault | Boolean ignored by revision flow | Vault save helpers |
| `pocket.editorPopoutDraft.v1.*`, `.v2.*` | Legacy popup drafts | Plaintext JSON | Browser quota only | Node ID in key, no file session | Failure swallowed | Dormant old popups |
| `pocket.phoneMode.v1` and auto-restore marker | UI preference/timestamp | Plaintext | Small | None | Failure swallowed | Phone-mode initialiser |
| IndexedDB `pocketLite.recentFile.v1/recentFile` | Display name and update time | Plaintext metadata | Browser quota only | No handle or document identity | Soft failure | File-gate hint only |

Browser storage is recovery/support state, not document truth. That architectural statement remains true, but F01, F07, F08 and F14 show that recovery ownership, visibility and privacy still need explicit contracts.

## 9. Security surface map

| Surface | Trust boundary | Current validation | Current risk | Recommended hardening |
|---|---|---|---|---|
| Selected JSON file | User-selected local bytes to mutable state | JSON parse, root recognition, normalisation | F04, F05, F10, F11 | Size gate; one root classifier; destructive-normalisation diagnostics/read-only |
| Writable file handle | Browser permission to physical truth | Exact in-tab handle/session and queued checks | F01–F03 ownership adoption; F06 external freshness | Central document owner and save-time disk token |
| localStorage recovery | Origin-global plaintext copies | JSON parse and current normaliser | Cross-source adoption, silent quota, Vault plaintext | Source identity, freshness, observable failure and privacy policy |
| IndexedDB recent hint | Browser storage | Small metadata only | Low | Keep handle-free; optional error telemetry |
| Canonical PE popup | Same-origin opener and generated HTML | P012 identity/revision/preflight; escaped HTML/JSON | GREEN | Retain full-window hostile-text and reuse tests |
| Legacy popups | Loaded same-origin globals | P012 on eventual apply, but weaker generation/message ownership | F17, F18, dormant F23 | Retire from active load |
| Legacy `postMessage` | Unexpected window to main state | Type plus eventual P012 payload checks | High-friction in-memory mutation | Exact source/origin/nonce or deletion |
| PiP dirty message | Child/other window to host prompt | Type/boolean plus direct false-state recheck | Nuisance F19 | Exact iframe source |
| PiP whole-state callback | Same-origin child to main document | Normalisation only | RED F03 | Session/base-revision binding |
| Vault envelope | User-selected encrypted local bytes | Kind/version, cipher/KDF and AES-GCM | F12–F14 | Resource bounds, AAD header and document/privacy ownership |
| Clipboard write | App text to OS clipboard | Bounded normalisation, explicit user action | No executable sink found | Keep details-first policy and permission failure handling |
| Blob download | In-memory JSON to separate local copy | JSON serialisation and fixed generated filename | Separate copy can be mistaken for backup, but status distinguishes it | Preserve “separate copy” wording |
| Same-origin fetch/XHR | Fixed repository paths | Internal candidate list | Dormant, no user-controlled destination | Remove with dormant loader or keep path allowlist |
| DOM and status | Imported text to page | `textContent`, escaped attributes and canonical safe JSON | Canonical GREEN; dormant legacy F23 | Retire old generators; characterise CSP |

No remote attacker is assumed where no remote ingress exists. The hostile JSON/Vault cases require deliberate local selection. The same-origin message findings concern unexpected local browsing contexts, stale windows and maintenance exposure rather than an internet-facing service.

## 10. Test coverage gaps

The focused suite has 94 passing cases and executes substantial actual production source through VM and generated-runtime harnesses. It is much stronger than a static grep suite, but it is concentrated on PE persistence. The only tracked CI workflow does not run it.

| Finding | Existing evidence | Missing or insufficient test |
|---|---|---|
| F01 recovery ownership | Recovery normalisation and session renewal are exercised | A/B different-name and same-name restore through a retained handle; Phone-mode automatic route |
| F02 Vault ownership | Vault open proves session rotation and no write at open | Old-handle retention plus edit-and-Save |
| F03 PiP return | PiP snapshot and renewal covered | Main/PiP divergence, file switch, Save and dirty `pagehide` |
| F04 destructive normalisation | Limits and ownership run against actual source | Mixed malformed load, visible diagnostics and no-write/read-only boundary |
| F05 root shape | Schema precedence and data-extra loss characterised | Nested-only/future/divergent selected-handle load-add-save |
| F06 disk freshness | Queue/session switching covered | Changed `lastModified`/content after load and physical multi-tab test |
| F07 recovery failure | Normal in-memory storage only | Throwing/quota storage, oversized opaque metadata and warning freshness |
| F08 snapshot freshness | Newer operation slicing tested | Delayed write plus newer snapshot retention, no-change cross-file snapshot, and delete/move/edit Undo recovery freshness |
| F09 empty state | Empty payload helpers indirectly present | Delete-last, local recovery, explicit Save and reopen |
| F10 resource ceilings | Individual PE field limits tested | Whole file/node/depth/tombstone/import limits and performance |
| F11 topology/IDs | No focused coverage | Orphans, cycles, stale focus, visited render and selector-special IDs |
| F12 hostile Vault cost | No crypto envelope tests | Validate before KDF/base64 allocation |
| F13 Vault metadata/revision | No tamper/failure tests | AAD, seal/download failure, storage failure, rollback/multi-Vault |
| F14 Vault plaintext | Vault payload builder/open partially exercised | Synthetic storage-key assertions after open and first edit |
| F15 Save Vault | Payload builder only | Actual active command and lexical state |
| F16 Edit routing | Direct cutover failure and explicit aliases tested | Full index DOM capture/bubble paths and every visible Edit control |
| F17 legacy ownership | Canonical fail-closed and bridge tests exist | Full active load/event ownership and safe retirement characterisation |
| F18 legacy messages | Unbound legacy saves fail P012 | Wrong-source correctly bound payload and acknowledgement target |
| F19 PiP dirty message | No unrelated-source test | Source-bound true/false message in browser-like host |
| F20 CI | Workflow is statically inspectable | CI execution of the existing focused suite and active-script syntax |

Real browser coverage is still required for File System Access durability, popup reuse after refresh, Document PiP lifecycle, storage quota behaviour and multiple-window races.

## 11. Recommended correction sequence

These are provisional task boundaries, not implementation prompts or approvals.

### P016: Bind recovery restore to document ownership

- **Findings:** F01, plus source-specific parts of F08
- **Product decision first:** cross-source restore should reject, open read-only or require explicit destination confirmation
- **Likely files:** `js/pocket-storage.js`, `js/pocket-io-browser.js`, `js/pocket-phone-mode.js`, focused tests and contract docs
- **Physical acceptance:** A/B different and same filenames; latest/manual/Phone recovery; no B write before explicit choice

### P017: Establish safe Vault document ownership

- **Findings:** F02, F14, F15
- **Product decision first:** Vault editing/save owner and whether browser recovery must remain encrypted at rest
- **Likely files:** `js/pocket-vault-io-browser.js`, `js/pocket-vault.js`, `js/pocket-storage.js`, narrow state helper, tests/docs
- **Physical acceptance:** open over active JSON, edit, Main Save, Vault save/cancel/failure, storage inspection using synthetic data

### P018: Bind Document PiP return to source session and base revision

- **Findings:** F03, F19
- **Product decision first:** conflict presentation when both copies changed
- **Likely files:** `js/pocket-editor-copy.js`, `js/pocket-io-browser.js`, tests/docs
- **Physical acceptance:** A/B switch, main/PiP concurrent edits, Save, close and dirty warning

### P019: Fail closed on destructive load normalisation and ambiguous roots

- **Findings:** F04, F05, F11's load diagnostics
- **Product decision first:** reject, read-only or previewed repair; dual-tree precedence policy
- **Likely files:** `js/pocket-import.js`, `js/pocket-io-browser.js`, `js/pocket-data.js`, tests/docs
- **Physical acceptance:** malformed and future synthetic files remain untouched; diagnostics are understandable

### P020: Add save-time disk freshness preflight

- **Findings:** F06
- **Product decision first:** overwrite, separate copy and reopen choices
- **Likely files:** `js/pocket-io-browser.js`, possibly a narrow file-revision helper, tests/docs
- **Physical acceptance:** two tabs and external edit; no watcher or background write

### P021: Make recovery observable and empty-state safe

- **Findings:** F07, F08, F09
- **Product decision first:** explicit empty-file validity and warning tone for recovery degradation
- **Likely files:** `js/pocket-history-status.js`, `js/pocket-storage.js`, `js/pocket-io-browser.js`, tests/docs
- **Physical acceptance:** quota failure, delayed save plus new edit, delete/move/edit Undo followed by recovery, delete-last/save/reopen

### P022: Bound hostile input and make traversal cycle-safe

- **Findings:** F10, F11
- **Product decision first:** practical file/node/depth limits and oversized read-only policy
- **Likely files:** `js/pocket-io-browser.js`, `js/pocket-import.js`, `js/pocket-render.js`, metadata helper, tests/docs
- **Physical acceptance:** large disposable files, responsive rejection and preserved originals

### P023: Harden the Vault envelope and revision contract

- **Findings:** F12, F13
- **Product decision first:** diagnostic versus rollback-security revision semantics
- **Likely files:** `js/pocket-crypto.js`, `js/pocket-vault.js`, `js/pocket-vault-io-browser.js`, crypto tests/docs
- **Physical acceptance:** malformed/hostile envelopes, wrong password, tampering, failed download

### P024: Repair canonical Edit entry routing

- **Findings:** F16
- **Product decision first:** none
- **Likely files:** `js/pocket-editor-cutover-v3.js` and focused routing tests
- **Physical acceptance:** topbar, command palette, row menus, double-click, Enter and unsupported read-only item

### P025: Retire the loaded legacy editor and bind any remaining messages

- **Findings:** F17, F18, F23, F25
- **Product decision first:** confirm no supported legacy draft recovery remains
- **Likely files:** `index.html`, legacy editor scripts/load list, canonical popup tests and docs
- **Physical acceptance:** canonical dirty/reuse/save retry, every Edit route, blocked popup and main refresh

### P026: Put focused source tests and syntax checks in CI

- **Findings:** F20
- **Product decision first:** whether the old broad checker is retained, respecified or removed
- **Likely files:** `.github/workflows/pocket-check.yml`, package/tooling only if explicitly approved
- **Physical acceptance:** none; verify GitHub status checks

## 12. Disproved or downgraded hypotheses

- **P012 popup binding works.** A stale PE cannot mutate same-ID B, and node revision/preflight rejection occurs before mutation. Wildcard legacy messages do not bypass this without a valid current binding.
- **Queued save does not redirect into the newly active file.** An already-started write may finish against old A and then report a session change, but B is not written and B operations are not cleared.
- **Canonical popup text does not break out of its script.** `<` is escaped in JSON and visible fields are HTML-escaped. The confirmed injection weakness belongs only to dormant legacy generators.
- **Create New does not write a pre-existing active handle.** It may seed from recovery, but it first writes a newly selected target and adopts only after success.
- **Recent-file IndexedDB does not silently reuse a writable handle.** It retains display metadata only.
- **Vault's 310,000-iteration PBKDF2/AES-GCM core is not weak for the stated browser/on-device model.** Findings concern parameter validation, header semantics, document ownership and plaintext recovery.
- **Dormant change-log, auto-cache and alternate Vault loaders are not active adoption paths.** They should not be promoted to RED merely because their code is old.
- **`node.pe` disappearance is the accepted P014 retirement, not accidental P015 loss.**
- **No active external content destination or third-party runtime script was found.** Hostile-file findings require local selection.
- **The generic-extra `__proto__` lead did not produce global prototype pollution.**

## 13. Remaining uncertainties

Static inspection and VM tests cannot establish:

- whether every target browser's `FileSystemWritableFileStream` implementation commits atomically on `close()` or preserves the prior file after power/process failure;
- whether `File.lastModified`, size or a content hash is the most dependable cross-browser save-time freshness token;
- real localStorage and IndexedDB quota size, eviction and private-mode behaviour;
- Document PiP event ordering and pagehide behaviour across supported browsers;
- same-origin/source behaviour for popups served through `file:`, local HTTP or deployment hosting;
- fixed-name popup reuse after main-window refresh or cross-origin navigation;
- physical multi-tab and external-editor races;
- practical performance ceilings for hostile very large/deep fixtures;
- deployment-level CSP or other response headers not represented in the repository; or
- browser download completion, because an anchor click is not durable-write acknowledgement.

Those boundaries require synthetic hostile fixture execution, quota stubs and carefully controlled physical browser tests using disposable copies. No personal truth file, real browser storage or real Vault was inspected during P015.
