# Pocket File and Device Changes Contract

## 1. Purpose

P016 defines how Pocket handles a selected JSON file when the browser also holds a device copy with meaningful changes that are not in that file.

The contract has one overriding rule:

> Comparing, reviewing, combining or adopting device changes never writes a file.

A selected file is written only after an explicit Save. If Pocket opens device changes or a combined result, it first removes all authority to write the file that happened to be selected. The next Save must use the existing file-picker path.

This is a document-ownership and recovery-safety change. It does not add autosave, background writes, cloud synchronisation, file watching or a general handle-free editing mode.

### P017 pending-file permission correction

P017 closes a permission-display gap in the selected-file path. Before P017, Chrome's additional read/write permission state was represented only by the ordinary no-file tree gate. If a Pocket file was already active, `canShowPocketTree()` correctly kept that tree visible, but the gate containing Continue and Cancel was not rendered. The candidate file therefore existed as a pending handle without a visible decision.

The file-opening path now owns one dedicated accessible permission dialog. The selected active file remains visible behind it, but the background is inert and the canonical mutation gates reject tree changes, Save, PE opening or apply, popout, Create New and another Open action while the choice is unresolved.

A pending candidate handle is not active file ownership:

- the current handle, tree, document session, PE identity and dirty state remain unchanged while permission is requested and while the candidate is read and validated;
- Continue is single-flight and requests permission only for that exact candidate handle;
- a request token and captured source session prevent cancellation, session rotation or a stale async completion from adopting a candidate;
- the candidate becomes active only after its content has been read, parsed and accepted by the existing selected-file loader;
- successful adoption uses `setPocketFileSession()` and rotates the document session through the canonical owner;
- the permission dialog closes before the existing P016 file/device dialog can receive focus;
- denial or permission failure clears only the candidate and reports that the current file is unchanged;
- Cancel, including Escape, clears only the candidate, writes nothing and returns focus to the active tree;
- read failure, invalid JSON or another rejected load cannot adopt the candidate or rotate the current session; and
- the initial no-file route uses the same dialog, with the ordinary no-file gate remaining behind it.

The previous permission-specific Continue/Cancel branch in `buildPocketFileGate()` is retired. There is one pending-permission owner in `js/pocket-io-browser.js`; `isPocketFilePermissionPromptOpen()` is the shared interaction boundary. Every selected-file read is bound to the document session current when it begins, so an already-granted concurrent candidate cannot overtake a visible permission choice. A routine Save already in progress for the active handle cannot dismiss the pending choice or fall through to a new picker, while a real document-session change revokes it.

## 2. User-visible decision

After a valid file is loaded, Pocket compares that file with the current browser safety copy. If their meaningful content is equal, Pocket opens the file without showing a decision. Export times and other transport-only differences do not trigger the screen.

If meaningful content differs, Pocket blocks tree editing, Save and other whole-document actions and shows an accessible modal dialog:

> Pocket found changes on this device that aren’t in the file you opened.
>
> How would you like to handle the difference?

The four explicit choices are:

| Choice | Supporting text | Result |
|---|---|---|
| Use the file | Open the version in the file you chose. | Keep the selected file and its handle. |
| Use the device changes | Open the changes Pocket kept safe on this device. | Open the device tree as a detached unsaved document. |
| Combine what can be combined | Keep changes from both versions where Pocket can do that safely. | Compare three versions, ask for any required choices, then open the result detached and unsaved. |
| Review the differences | See what changed before deciding. | Show a readable, non-mutating summary and return to the choices. |

Where available, the dialog identifies the selected filename and friendly save time, plus when the device changes were kept and their source filename. A matching filename is descriptive only. It grants no write authority and is not proof of shared ancestry.

The dialog has `role="dialog"`, `aria-modal="true"` and a labelled title. Initial focus is on Use the file. Focus remains inside the dialog while it is open. Escape does not select a version or close the decision. It returns focus to the first choice.

The same owner and responsive dialog are used at normal widths and in Phone mode. There is no generic close control that can silently choose a version.

## 3. Meaningful comparison

`PocketDeviceChanges` is the canonical comparison boundary. It converts supported current payload shapes into one comparison document containing:

- nodes;
- tombstones;
- root extras; and
- data extras.

Meaningful node content includes:

- ID;
- parent relationship;
- sibling order;
- label;
- Notes in `details`;
- first-class `editor` metadata, including unsupported opaque metadata;
- supported first-class fields; and
- preserved generic node extras.

The comparison is deterministic and independent of ordinary object key insertion order. It ignores transport-only or volatile values, including:

- `exportedAt`;
- export-only `writtenAt`;
- cache and safety-copy timestamps;
- generated guard timestamps and Pocket instance IDs;
- node `updatedAt` where all meaningful node content is otherwise equal; and
- retired `node.pe`.

The comparison does not flatten Outline into Notes, derive Notes from Outline or restore `node.pe`.

Meaningful equality is based on content, not on which version has a newer timestamp, more nodes or a matching filename.

## 4. Use the file

Use the file:

- leaves the selected file's normalised tree visible;
- retains its current writable handle and document-session ID;
- performs no write;
- performs no combination;
- clears only the current browser safety entry so the question is not immediately repeated;
- preserves the bounded safety trail for manual review; and
- returns focus to the tree.

The status is:

> Opened the file.

It does not claim that Pocket saved anything.

Pocket completes this choice only after it has kept the device version in the bounded earlier-version trail. If browser storage cannot preserve that version, or cannot clear the current entry, the decision remains open and neither version changes.

If file and device content compare equal, Pocket follows the same safe-file outcome without showing the dialog.

## 5. Use the device changes

Use the device changes:

- adopts the full device tree and valid pending operation history;
- clears the selected file handle;
- rotates the Pocket document session;
- invalidates PE windows opened under the earlier session;
- enters the explicit `detachedDeviceChanges` session state;
- keeps the tree visible and editable;
- restores valid monotonic operation sequences when they exist;
- ensures there is a fresh dirty transition if the older safety entry carried no usable operation history;
- retains or regenerates browser safety for the visible device tree;
- preserves a trustworthy stored BASE when one exists; and
- performs no file write.

The status is:

> Device changes opened. Save when ready.

The previously selected file receives zero writes. This remains true whether the two files have different names or the same name in different folders.

Before adoption, Pocket prepares a canonical device document which exactly matches the normalised detached tree it will display, including the narrowly preserved safe data extras. It must store that visible version, or confirm that the current safety entry already represents it, before clearing the selected handle. If this cannot be done, the decision remains open and the selected file stays untouched.

## 6. Detached unsaved document

`detachedDeviceChanges` is a narrow canonical file-session state. It is available only after Pocket explicitly adopts device changes or a combined result.

The detached session has:

- no `FileSystemFileHandle`;
- its own Pocket document-session ID;
- a visible and editable tree;
- permission to open the canonical PE;
- no authority to write any existing file;
- ordinary operation, monotonic sequence and dirty-state ownership;
- a device/combined source label suitable for the UI; and
- Save behaviour which follows the existing first-save picker path.

`capturePocketFileSaveSession()` and `isPocketFileSaveSessionCurrent()` include the detached state, so a queued save cannot silently cross between attached, PiP and detached ownership. PE source identity remains session-ID based. A PE opened before detached adoption is stale after the rotation. A PE opened after adoption can edit the detached tree but cannot write the earlier file.

Cancelling the Save picker leaves the detached tree open, dirty and covered by browser safety. No old file and no cancelled destination is written.

After a picked destination is successfully written and closed:

- that handle becomes the active truth-file handle;
- a fresh normal file session is adopted;
- the normalised meaningful document corresponding to the exact payload written becomes the document baseline;
- only pending transitions at or below the Save's captured sequence ceiling are removed;
- covered current safety is cleared; and
- any higher-sequence transitions made during the write remain dirty and receive a fresh safety copy based on the payload actually written.

A failed or cancelled write does not attach the failed destination, clear the detached state, clear pending transitions, advance BASE or discard browser safety.

## 7. BASE, FILE and DEVICE

Safe automatic combination uses three full normalised documents:

- **BASE:** the last reliable full version shared by the file and device changes;
- **FILE:** the selected JSON file being opened; and
- **DEVICE:** the browser-held version.

The in-memory document baseline is established or updated only after:

- a valid selected file is successfully loaded;
- Create New successfully writes and adopts its file;
- an existing truth-file Save succeeds; or
- a first Save or Save As successfully writes and adopts its file.

It is not updated merely because a comparison is shown, device changes are opened, a combined result is opened, a picker is cancelled or a write fails.

Browser safety keeps two deliberately separate layers:

1. the full DEVICE payload, which remains the authoritative browser-held content; and
2. optional browser-only combination and change metadata stored beside that payload.

The browser-only change envelope uses schema `pocket.deviceChanges.v1`. It contains:

- the BASE fingerprint;
- BASE source labels;
- the capture time;
- the source filename;
- semantic change descriptors;
- the highest pending sequence; and
- no full before/after copy of user content.

Each meaningful transition receives one stable positive safe-integer sequence. If one transition changes several fields, every descriptor for that transition shares its sequence. Later transitions receive higher sequences. Pocket preserves the high-water mark across safety rewrites, detached adoption, PiP snapshots and Save retries, so timestamp order and array position are not the save-coverage authority.

The browser key `pocketLite.deviceChange.sequence.v1` stores only that monotonic sequence high-water. It contains no title, Notes, Outline, node, metadata or other user content. It is browser-only coordination state and never enters the top-level or nested truth JSON.

Descriptors identify:

- item addition;
- title or label change;
- Notes or `details` change;
- Outline or `editor` change;
- first-class node metadata;
- generic node extras;
- urgent state;
- copy-context state;
- move or parent change;
- sibling order change;
- item deletion;
- subtree deletion with descendant IDs;
- root-extra changes;
- data-extra changes; and
- tombstone additions, changes or removals.

These descriptors explain what changed and delimit which pending transitions a Save covers. They do not reconstruct content, contain full before/after values, resolve differences or override BASE, FILE or DEVICE. The three full normalised documents remain the only content authorities for comparison and combination.

The `pocket.deviceChanges.v1` envelope is browser-only. It is never embedded in a node, `editor`, root extras, data extras, the top-level truth payload or the nested truth-data payload. `buildPocketPayload()` and truth-file export do not serialise it.

The fingerprint is a deterministic consistency marker, not a cryptographic security claim.

Pocket first tries to store the complete DEVICE payload with its optional BASE and change metadata. Under storage pressure it retries progressively with optional BASE and browser-change metadata omitted. The complete DEVICE payload has priority over combination or explanatory metadata. If even the DEVICE-only copy cannot be stored, a device or combined adoption fails closed unless the existing current entry already represents the exact visible document.

At Save start, Pocket freezes the truth payload and captures the highest pending operation sequence as that Save's ceiling. A transition covered by an in-flight payload cannot be discarded from operation history while the write is pending.

After confirmed truth persistence:

- the normalised meaningful document corresponding to the successfully written payload becomes BASE;
- only operations whose sequence is at or below the captured ceiling are removed;
- operations above the ceiling remain dirty;
- the current visible DEVICE is stored again against the newly written BASE; and
- its `pocket.deviceChanges.v1` envelope contains only descriptors above the covered ceiling.

Pocket stores this replacement before clearing covered safety. The DEVICE-first pressure fallback may retain the newest full DEVICE without BASE or change descriptors. If the refresh fails entirely, the higher-sequence operations remain dirty, the earlier safety entry is retained and Pocket shows a warning.

A failed, cancelled, stale-session or otherwise rejected Save clears no sequence, changes no BASE and leaves the existing DEVICE safety copy in place.

An explicit zero-node Pocket document remains a valid DEVICE state. Deleting the final item records the deletion and tombstone, refreshes browser safety, keeps Save available and can persist an empty tree through the normal explicit Save path. Safety readers require an actual top-level or nested tree array, so a corrupt timestamped object with no tree is not reinterpreted as an empty document.

Continued typing in the details editor refreshes the full DEVICE payload while retaining the draft transition's existing sequence. If a covered draft is continued or cancelled during an in-flight write, Pocket records a higher-sequence transition for the visible post-write state rather than marking it clean.

Pre-P016 entries and pressure-reduced entries without `pocket.deviceChanges.v1` remain readable because the full DEVICE payload is authoritative. When Pocket adopts older unsequenced operation history, it assigns safe increasing sequences above the remembered browser high-water mark before recording later transitions.

## 8. Combination eligibility

Combine what can be combined is enabled only when:

- a JSON-safe BASE payload exists;
- its stored fingerprint matches the payload;
- BASE, FILE and DEVICE pass conservative structural and processing-size validation;
- the two candidates have credible ancestry from BASE; and
- no ambiguous top-level/nested tree copies or raw-versus-normalised content differences prevent a safe comparison.

The current processing boundary is deliberately conservative. It accepts at most 10,000 nodes and five million stable-serialisation characters for comparison.

Credible ancestry uses the stored BASE and meaningful shared node evidence. A matching filename alone is never sufficient.

For a pre-P016 or pressure-degraded safety entry without a valid BASE:

- Use the file works;
- Use the device changes works;
- Review the differences works as a direct two-version summary; and
- Combine is disabled.

The explanation is:

> Pocket doesn’t have the earlier shared version needed to combine these safely.

Pocket never substitutes a two-way union.

Missing or incomplete browser change descriptors do not change these choices. They cannot make DEVICE content disappear, make an unsafe BASE valid or give metadata authority over a full version.

## 9. Three-way combination rules

Node ID is the primary correspondence key. Each meaningful node field is combined independently:

| BASE/FILE/DEVICE relationship | Result |
|---|---|
| FILE unchanged, DEVICE changed | Use DEVICE. |
| FILE changed, DEVICE unchanged | Use FILE. |
| FILE and DEVICE changed identically | Keep the value once. |
| FILE and DEVICE changed differently | Ask Murray which version to use. |
| Added on one side only | Include it. |
| Added on both with the same ID and content | Include it once. |
| Added on both with the same ID but different content | Ask Murray. |
| Deleted on one side, unchanged on the other | Accept the deletion. |
| Deleted on one side, changed on the other | Ask whether to keep the item or leave it removed. |
| Deleted on both | Delete it. |

Independent changes combine independently. Examples include a FILE move plus DEVICE Notes change, or a FILE title change plus DEVICE Outline change.

`updatedAt` does not decide content. A one-sided change keeps an appropriate source time. Where both sides contribute independent changes, Pocket uses the newest valid contributing time deterministically.

The same per-key three-way rule applies to:

- root extras;
- data extras; and
- tombstones.

Browser-only BASE and `pocket.deviceChanges.v1` metadata are never copied into an exported Pocket payload.

## 10. Differences that need a choice

If all changes combine automatically, Pocket says:

> Pocket combined the changes. Nothing else needs your choice.

If values differ on the same field, Pocket says:

> Pocket combined what it could.
>
> There are _n_ differences that need your choice.

For an item changed differently in both versions, the screen shows its path, title, changed fields and concise file/device values. The available actions are:

- Use the file version;
- Use the device version; and
- Keep both, where both concrete item versions exist.

For delete-versus-edit, Keep both is not shown. The choices are Keep the item or Leave it removed.

Metadata and tombstone choices select the file or device value for the affected key. Pocket does not expose raw internal structures unless preserved metadata itself is the unresolved difference.

## 11. Keep both

Keep both retains the FILE subtree under its original IDs and duplicates the DEVICE subtree with fresh IDs.

The duplication:

- assigns a fresh non-reserved ID to every copied node;
- remaps copied descendant `parentId` values to their copied parents;
- duplicates under fresh IDs any DEVICE descendant branch which moved outside the duplicated DEVICE root, preserving its DEVICE parent and descendants rather than losing the independent move;
- keeps the copied root under the same parent as the retained FILE root;
- deterministically reflows overlapping sibling choices so every copied root remains immediately after its retained FILE root without duplicate positions;
- reconciles overlapping moved descendants across active Keep both choices in either resolution order, so one DEVICE source item is copied only once under its copied DEVICE parent;
- preserves Notes, first-class Outline/editor metadata, opaque editor metadata, extras and child order;
- reconstructs the retained FILE branch's deletion records when a broader Keep both choice supersedes an earlier descendant choice;
- adds `(device version)` to an otherwise identical copied root label without exceeding the existing label limit; and
- marks nested choices covered by the parent duplication so descendants are not duplicated twice.

Keep both is unavailable when one side represents deletion rather than a concrete item version.

When one side deletes a subtree and the other changes a descendant, Pocket presents the ancestor choice first. Choosing Leave it removed consistently covers unresolved choices for descendants which that side also removed. A descendant retained or moved elsewhere by the deleting side keeps that safe parent and order while independently combined Notes, Outline and other content survive. Choosing Keep the item for a descendant cannot silently reverse an earlier ancestor-removal choice. Where no ancestor choice exists, keeping a changed descendant restores only the live ancestor chain required to keep that item structurally valid and removes matching deletion tombstones.

## 12. Structural validation and adoption

Before combination is offered, and again after all choices, Pocket validates:

- every node is a JSON object;
- every node ID is present, unique, within the current limit and not `root`;
- labels and parent IDs are valid;
- every non-root parent exists;
- no node is its own parent;
- there are no parent cycles;
- orders are finite;
- live IDs do not collide with tombstones; and
- the result remains within safe comparison limits.

The completed result is also passed through the actual active node and root-extra normalisers as a non-mutating check. Pocket rejects the combination if that round trip would omit, truncate or otherwise change meaningful content, including when independent FILE and DEVICE extras would jointly exceed the current persistence budgets.

Pocket does not silently attach orphans to root, repair cycles or choose a conflicting value.

If validation fails, neither version is mutated or written. The decision screen remains available with:

> Pocket couldn’t safely combine these versions. Nothing was changed.

Only a complete, validated result is adopted. Pocket announces that no further choice is needed, then confirms the detached dirty result with:

> Pocket combined the changes. Nothing else needs your choice. Combined changes opened. Save when ready.

No file write occurs until Murray presses Save and successfully chooses a destination.

## 13. Review the differences

Review is read-only and never changes either version. With a valid BASE it groups paths or item names into:

- Changed in the file;
- Changed on this device;
- Added in the file;
- Added on this device;
- Removed in the file;
- Removed on this device;
- Changed in both versions; and
- Moved in one version.

Without a valid BASE, review provides a direct two-version summary labelled as differences between the file and device changes. It does not claim to know which side made a historical change.

Review retains actions for Use the file, Use the device changes, safe combination when available, and Back.

## 14. Manual and Phone-mode routes

The command formerly labelled Restore previous local version is routed through the same owner and should appear as Review an earlier device version. Selecting a trail entry no longer replaces the active tree directly.

For a manual earlier version:

- the current document is FILE;
- the selected trail entry is DEVICE;
- the same meaningful comparison and four-choice screen applies;
- device and combined results open detached; and
- the current file handle is never inherited by those results.

Phone mode no longer restores a browser copy automatically. When it finds different browser-held changes, it invokes the shared decision screen. It never has a separate restoration path or silently adopts a tree.

## 15. Stable safety boundaries

P016 preserves:

- the selected local JSON file as explicit document truth;
- the startup file gate;
- the existing queued-write session checks;
- Main Save and PE Save using only the current active destination;
- PE remaining dirty until persistence succeeds;
- P012 PE source-session and node-revision rejection;
- one active main-tree Enter owner;
- details-first copy context;
- independent Notes and Outline;
- unsupported editor metadata as opaque and read-only;
- supported structural-only Outlines;
- current Outline selection, subtree and structured-paste rules;
- no `node.pe`; and
- no `pocket-editor-popout-default.js` behaviour.

P016 does not fix Vault ownership, Document PiP return ownership, destructive import normalisation, external-file freshness or general recovery observability. Those remain separate P015 findings.

In particular, ordinary selected-file loading retains the pre-P016 canonical `normaliseInput()` precedence and limits. P016 does not broaden that loader merely to support combination. If a raw selected file or device entry would compare differently after current normalisation, or contains conflicting top-level and nested tree copies, automatic combination is disabled. Direct device adoption narrowly preserves safe raw data extras while storing the exact canonical tree that will be displayed.

No truth-file schema migration is introduced. BASE, detached-session data and the `pocket.deviceChanges.v1` envelope are browser/runtime safety metadata only.

## 16. Focused automated coverage

The focused P016 suite is:

~~~sh
node --test tests/device-changes-resolution.test.js
~~~

It executes the actual `PocketDeviceChanges`, operation-history, storage, file-session and canonical PE apply/save source in controlled Node VM contexts with synthetic documents, fake handles and in-memory storage. Its 54 cases cover meaningful equality, direct review, BASE validation, ambiguous and lossy-input rejection, independent combination, unresolved choices, choice-contributor timestamps, Keep both including a DEVICE descendant moved outside its former branch, deterministic duplicate-order sibling placement, dependency-safe parent/descendant delete-versus-edit choices, ancestor restoration, tombstone handling, active-normaliser extras-budget rejection, structural rejection, exact visible-device safety, fail-closed storage pressure, valid zero-node and malformed safety boundaries, continued details drafts, detached session rotation, stale and newly opened PE behaviour, PiP decision isolation, cancelled and failed writes, picked-destination adoption, manual and Phone routing, and the rendered keyboard/focus contract.

The focused cases also prove deterministic descriptors for all supported mutation categories, one monotonic sequence per transition, high-water restoration, full-DEVICE authority over incomplete or misleading descriptors, no truth-JSON leakage, DEVICE-first metadata fallback and sequence-ceiling save-race handling.

The existing PE persistence suite remains the regression boundary:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

No test accesses a personal Pocket file or creates a real writable browser handle.

## 17. Physical browser acceptance checklist

Use disposable Pocket files only. Murray's physical acceptance remains required:

1. Open disposable file A.
2. Make an edit without Save.
3. Reopen Pocket and select A.
4. Confirm the difference question appears.
5. Choose Use the file.
6. Confirm A remains unchanged and no Save occurs.
7. Repeat and choose Use the device changes.
8. Confirm DEVICE opens unsaved.
9. Press Save and cancel.
10. Confirm DEVICE remains open and A is untouched.
11. Save DEVICE as disposable file C.
12. Confirm only C changes.
13. Repeat with device changes from A while selecting file B.
14. Test different filenames.
15. Test identical filenames in different folders.
16. Confirm B is never overwritten.
17. Create independent FILE and DEVICE changes.
18. Choose Combine what can be combined.
19. Confirm both changes appear in an unsaved result.
20. Create a same-field difference.
21. Confirm Pocket asks which version to use.
22. Test Keep both on a node with children, Notes and Outline.
23. Confirm both subtrees survive with unique IDs.
24. Test Review the differences.
25. Test an older safety record without BASE.
26. Confirm Combine is unavailable but the other choices work.
27. Test Phone mode.
28. Open PE before DEVICE adoption.
29. Confirm that PE becomes stale after the session changes.
30. Open PE after DEVICE adoption and edit successfully.
31. Save the final result to a newly selected file.
32. Reopen that file and confirm persistence.

This checklist is a disposable-file browser rehearsal. Passing synthetic tests does not claim that these physical checks have been completed.

Save-race handling also needs a targeted disposable-browser rehearsal with an intentionally delayed fake write: start Save, make a newer edit after the frozen payload is captured, release the write, then confirm the written file contains the captured version while the newer edit remains visibly unsaved and device-safe. This supplements the exact 32-step checklist without changing it.

## 18. P017 physical permission checklist

Use disposable files A and B. Murray's physical browser acceptance remains required:

1. Open A and grant permission if requested.
2. Make an unsaved change in A.
3. Choose B.
4. Confirm a visible permission modal appears over A.
5. Confirm B's filename is shown.
6. Confirm A cannot be edited or saved while the modal is open.
7. Choose Cancel.
8. Confirm A remains open with its unsaved change.
9. Choose B again.
10. Choose Continue.
11. Grant Chrome permission.
12. Confirm B opens or the P016 file/device decision screen appears.
13. Confirm the permission modal is no longer visible.
14. Confirm A received no write.
15. Repeat and deny permission.
16. Confirm A remains unchanged.
17. Test an invalid disposable JSON as B.
18. Confirm A remains active.
19. In a private window, open A, edit without saving, then open B.
20. Confirm the visible permission step works.
21. Continue and confirm the P016 decision screen appears.
22. Confirm Combine is enabled where BASE and ancestry are valid.

This checklist is a disposable-file browser rehearsal. Passing the synthetic P017 coverage does not claim these physical checks have been completed.
