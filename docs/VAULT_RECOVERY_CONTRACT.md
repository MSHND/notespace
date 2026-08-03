# Vault Recovery Contract

## 1. Purpose

P022 introduced authenticated encrypted browser recovery for unsaved changes made while an encrypted Pocket Vault is the active truth owner. P023 completed the user-facing recovery flow, P024 refined its presentation, P025 added a password-free **Not now** choice, and P026 tightens the initial startup warning without changing those accepted behaviours.

The recovery record is safety data, not a document owner. Viewing it never creates a truth-file owner, never replaces the active tree and never authorises a write. A selected local JSON file or encrypted Vault becomes authoritative only after Pocket has validated it and, for a recovery output, persisted the intended result successfully.

Main Save and PE Save continue to write only through the exact current owner and remain subject to the existing document-session, Vault-session, popup-session and node-revision checks.

## 2. Core invariants

- No selected or created file means no ordinary editable tree.
- Browser recovery is encrypted safety data, not authoritative document truth.
- The browser record contains no readable node labels, Notes, Outline/editor content, password, `CryptoKey`, original filename or writable handle.
- The recovery password is used only in live memory to authenticate and decrypt the record.
- Wrong-password, cancellation, validation and output failure reveal or delete nothing.
- Deferring the startup offer reveals, adopts, saves and deletes nothing; it only releases the current startup gate.
- Viewing recovery does not adopt a document, create an owner, mark Pocket dirty or open PE.
- Every output destination is explicitly selected.
- A recovery destination is adopted only after its write closes successfully.
- The exact encrypted browser record is cleared only after successful persistence and adoption, or explicit confirmed discard.
- Ordinary JSON and Vault owners remain distinct.
- Vault output never falls through to a plaintext Save path.
- No autosave, background truth-file write, file watcher, silent handle reuse, cloud synchronisation or cross-file write is added.

## 3. Encrypted browser record

The record remains at:

```text
pocketLite.vaultRecovery.encrypted.v1
```

Its outer schema remains `pocket.vaultRecovery.encrypted.v1` version 1. It contains `capturedAt`, `highestSequence` and one authenticated Pocket Vault v1 envelope.

The envelope exposes only bounded management and cryptographic metadata, including its stable `vaultId` and revision. The complete canonical Pocket payload remains inside AES-GCM ciphertext. Each capture uses a fresh nonce. The password and decrypted payload are never written back to browser storage.

For a normal unsaved capture, the recovery envelope revision is the saved Vault revision plus one. P023 therefore uses:

- envelope `vaultId` to identify the original Vault independently of filename; and
- recovery revision minus one as the saved base revision from which the unsaved recovery was captured.

These values support comparison. They do not independently grant Save authority.

## 4. Capture and live-Save lifecycle

`recordOp()` remains the canonical operation owner. For an active Vault it schedules `PocketVaultRecovery.scheduleCapture()` instead of plaintext local-safety storage.

A capture freezes the canonical payload and covered operation sequence, captures the exact document and Vault identities, encrypts with the active non-extractable key, rechecks ownership, then replaces only the record owned by that capture chain.

An unresolved startup record cannot be replaced or cleared merely because another page opens a Vault with the same ID. A successful live Vault Save clears only matching recovery owned by the current page and covered by that write. If newer operations remain after Save, Pocket encrypts the newer state again.

The synchronous `beforeunload` guard only warns. It does not begin encryption or write a truth file during unload.

## 5. Startup gate

When any encrypted recovery record exists, Pocket blocks ordinary startup behind the accessible Vault dialog. The initial choice contains exactly:

- **View recovery**
- **Not now**
- **Delete recovery**

The normal file gate and PiP startup adoption remain deferred while this decision is unresolved.

The warning title is **Unsaved Vault changes** and its body is **Pocket found encrypted recovery data from an earlier session.** The shared Vault dialog applies a warning-only presentation mode: a compact 356px maximum-width panel, View and Not now beside each other where space permits, and a quiet underlined Delete recovery action on its own row. The DOM and Tab order is View recovery, Not now, Delete recovery. An empty error live region takes no visual space in this mode. At 280px, 320px and 390px the panel remains inset, upper-positioned and free of horizontal overflow; phone-mode controls retain practical 44px targets.

**Delete recovery** requires confirmation, needs no password, deletes only the exact encrypted browser record and then returns to normal no-file startup. The confirmation title is **Delete encrypted recovery?**, its body says that only recovery stored in this browser is permanently deleted and saved Pocket files and Vaults are unchanged, and its confirm button is visibly destructive. It does not touch a saved JSON file or Vault.

**View recovery** opens the password dialog. Cancel returns to the initial three choices. A wrong password reveals no content and leaves the record byte-for-byte intact.

**Not now** requires no password or confirmation. It does not call the decrypt or deletion path, alter the exact encrypted browser record, adopt recovered content, create a truth owner or write a file. It closes only the current recovery interaction, releases the gate and resumes ordinary startup exactly once. Because the record remains byte-for-byte intact, Pocket offers the same three choices again on the next reload or startup.

## 6. Read-only recovery viewer

After successful authentication and structural validation, `PocketVaultRecoveryViewer` displays a dedicated temporary preview.

The viewer:

- displays the capture date and time;
- says that the content is recovered browser data and has not been written to a Pocket file;
- renders the recovered home tree;
- supports branch expansion and collapse;
- supports node selection;
- displays the selected label and readable Notes;
- displays supported `pocket.nodeEditor.v1` Outline rows with indentation;
- keeps keyboard focus inside the modal preview while it is open; and
- treats Escape as **Keep for later**, without deleting or writing recovery.

The viewer works from an isolated cloned recovery document. It does not replace `state.nodes`, set a file handle, activate a Vault session, add operations, write browser storage, clear recovery, open PE or expose mutation controls.

Closing the viewer clears its cloned tree and selection references. **Keep for later** also clears the recovery flow's decrypted document and payload references where practical.

Vault prompts use the one shared modal owner and appear as compact Pocket panels near the upper part of the visible app. They retain inert-background and focus-containment behaviour, use internal scrolling when height is constrained, respect narrow-screen safe areas and keep password text at 16px to avoid touch-browser zoom. Narrow and phone-mode layouts do not turn them into bottom sheets or routine full-screen cards.

The read-only viewer uses Pocket's normal panel, row, selected-row and text tokens. It is a compact two-column tree/content surface when space permits and becomes a bounded one-column surface on narrow screens, with the tree first and independent tree/content scrolling. Small recovered documents do not force an artificial large body height.

## 7. Actions after viewing

The viewer presents the same five operations as a compact, wrapping action strip:

- **Keep for later**
- **Save as Vault**
- **Save as JSON**
- **Add to file**
- **Discard recovery**

The concise visible labels retain longer descriptive text for assistive technology and pointer hints. The action IDs and recovery state-machine meanings are unchanged.

**Keep for later** closes the viewer, retains the encrypted record and continues to normal startup.

**Discard recovery** uses the same confirmed exact-record deletion as the initial discard.

**Save as Vault** asks for a new destination and a new confirmed password, creates a new Vault ID and revision 1, writes only the selected new file, then adopts it as the active Vault. The record is cleared only after that succeeds.

**Save as JSON** first warns that the output is readable and unencrypted, asks for a new destination, writes only that file, then adopts it as the active JSON owner. The record is cleared only after that succeeds.

Picker cancellation, password cancellation, encryption failure, permission failure, stale flow, write failure or unsafe adoption retains the encrypted recovery.

## 8. Smart Add to existing

Add to existing uses the same `PocketFileOpening` content classifier as the main **Choose file** action:

1. select one file;
2. read and parse its contents;
3. validate a Vault envelope before considering plain JSON; and
4. return a classified candidate without adopting it.

Filename and extension are diagnostic only. Both plain Pocket JSON and authenticated Pocket Vault envelopes are accepted. A Vault destination is unlocked through the shared Vault credential and structural-validation function.

All write paths acquire write permission, reread the exact destination bytes reviewed by the flow, fail if those bytes changed, write through the destination's correct JSON or encrypted route, and only then adopt it.

### Same Vault

The selected envelope's `vaultId` is compared with the recovery envelope's `vaultId`.

If the IDs match and the selected revision equals the recovery base revision, Pocket confirms a clean restore, writes the recovered whole-document state as the next encrypted revision, then activates that Vault.

If the IDs match but the selected revision is newer or otherwise different, Pocket does not overwrite it. The confirmation explains the divergence and offers the safe fallback: preserve the selected Vault and import the recovered document beneath one timestamped top-level `Recovered <date/time>` node.

If the contained fallback cannot be built and validated safely, Pocket fails closed and writes nothing.

### Different Vault

Pocket preserves the destination Vault's stable ID, existing content and revision lineage. It creates one timestamped top-level Recovered node, fresh-remaps every imported node ID, preserves the recovered hierarchy and supported node content, encrypts the combined document as the next destination revision, then activates that Vault.

### Plain JSON

Pocket uses the same contained import and fresh-ID remapping, writes only the selected JSON handle, then activates that JSON file.

Recovered root extras, data extras and tombstones are not broadly merged into a different destination. The contained subtree preserves recovered node data without inventing a lossy whole-document merge.

## 9. Output adoption and clearing order

Recovery output follows this order:

1. validate the recovered and destination structures;
2. obtain explicit confirmation;
3. capture the exact recovery flow and source document session;
4. acquire permission;
5. reread and compare destination bytes where a destination already exists;
6. write and close only the selected destination;
7. establish that handle and its JSON or Vault session as the sole active owner;
8. establish the written payload as the clean baseline; and
9. clear only the exact browser recovery record opened by the flow.

The deferred no-file startup callback is retired after a successful adopted output so it cannot clear the newly installed owner.

If browser-record deletion fails after a successful output, the new file remains authoritative and active, and Pocket warns that the older encrypted recovery still exists.

## 10. Interaction with current-file conversion

P023 moves encryption and decryption to document-owned controls.

- A plain JSON owner can be converted to a new encrypted Vault.
- A Vault owner can be converted to a new readable JSON file.
- Conversion never overwrites the source file in place.
- The source remains active and dirty if destination selection, credentials or persistence fails.
- The new file becomes active only after its write succeeds.
- Vault-to-JSON conversion clears an exact matching encrypted recovery only after the current document is safely persisted into the new JSON.

## 11. Security and failure boundary

Automated and physical acceptance must prove:

- persisted browser surfaces contain no recovery plaintext or password;
- wrong passwords disclose nothing;
- the viewer is display-only and creates no owner;
- classification does not adopt;
- unsupported content reaches no permission or write step;
- stale or changed destinations are not written;
- Vault destinations use encrypted persistence only;
- different destinations retain existing content under one fresh Recovered wrapper;
- same-Vault divergence is never blindly overwritten;
- failed or cancelled output retains recovery and the prior owner;
- successful output activates only the written destination;
- Main Save and PE Save retain their existing owner/session protections; and
- no recovery metadata enters truth JSON or node editor data.

The File System Access API does not provide compare-and-swap. Pocket rereads immediately before writing, but a separate external writer changing the file after that final comparison remains a platform-level race.

## 12. Automated validation

The executable contract uses production modules in controlled VM/browser-like contexts with synthetic handles, Web Crypto, localStorage and DOM surfaces:

```sh
node --test tests/p019-vault-ownership.test.js
node --test tests/pe-persistence-contract.test.js
node --test tests/device-changes-resolution.test.js
node --test tests/p018-popout-isolation.test.js
```

P023 adds coverage for content-based JSON/Vault classification, one smart Choose file action, unsupported content, wrong passwords, read-only tree/content inspection, Keep, exact discard, same-Vault revision restore, divergent same-Vault contained fallback, different-Vault import, plain-JSON import, post-write adoption, both conversion directions and cancellation/failure retention.

P025 adds executable coverage for the exact three-choice startup gate, one canonical Not-now control/listener, byte-for-byte record retention, no decryption or deletion, no recovered-tree or owner adoption, single startup resumption, warning return after reload, reset/busy lifecycle reuse, compact wrapping layout and the refreshed offline shell.

P026 adds executable coverage for the exact warning and confirmation copy, View/Not now/Delete DOM order, warning-only shared-dialog mode lifecycle, quiet destructive styling, two-column-plus-delete layout and the refreshed offline shell. The existing behavioural cases continue to prove View, Not now, Delete cancel/confirm, viewer actions, output ownership and recovery retention.

Exact results for the completed implementation are recorded in `docs/CODEX_REPORT.md`.

## 13. Physical browser acceptance checklist

Use disposable synthetic files and disposable passwords only.

1. Create a disposable encrypted recovery and reload Pocket.
2. Confirm the startup prompt is titled **Unsaved Vault changes**, uses the short encrypted-recovery body, and shows **View recovery**, **Not now** and quiet **Delete recovery** in that order.
3. Confirm initial focus is on View and Tab remains contained in the order View, Not now, Delete.
4. Choose Not now and confirm no password prompt or recovery viewer appears.
5. Confirm the exact encrypted browser record remains unchanged, no recovered tree or truth owner is adopted, and no file is written.
6. Confirm normal Pocket startup resumes once, focus returns sensibly to **Choose file**, and the recovery modal, focus trap and interaction gate are gone.
7. Reload and confirm the same three-choice recovery warning returns.
8. Choose View and Cancel the password dialog; confirm the initial three choices return with neutral enabled controls.
9. Enter a wrong password; confirm no recovered content appears and the record remains.
10. Enter the correct password.
11. Confirm the read-only viewer shows capture time, tree, branch toggles, node selection, Notes and supported Outline.
12. Confirm no active filename/owner appears, editing commands remain unavailable and PE cannot open.
13. Choose Keep for later, reload and confirm the recovery offer returns.
14. Confirm initial Delete and post-view Discard both show **Delete encrypted recovery?**; Cancel retains the record and the destructive confirm deletes only browser recovery.
15. Use the main **Choose file** control to open a plain JSON file.
16. Use the same control to open a Vault and confirm the password prompt.
17. Confirm no separate Open Vault control exists.
18. Add recovery to a plain JSON destination and confirm one Recovered root and active JSON ownership after Save.
19. Add recovery to a different Vault and confirm one Recovered root, unchanged destination Vault ID and active Vault ownership.
20. Select the original Vault under a different filename and confirm same-Vault detection uses Vault ID.
21. Confirm an unchanged-base original Vault offers clean restore.
22. Confirm a newer original Vault is not overwritten and offers the contained Recovered fallback.
23. Cancel or fail each output route and confirm recovery remains.
24. Convert current JSON to a new Vault; confirm the JSON is untouched and the new Vault becomes active only after Save.
25. Convert current Vault to a new plain JSON; confirm the Vault is untouched, the warning is clear and the new JSON becomes active only after Save.
26. Confirm Main Save, PE Save and File A/File B stale-session protection still target only the active owner.
27. At desktop width, confirm the initial warning is about 340-360px wide, compact and upper-positioned; confirm every other shared Vault prompt retains its existing compact layout and short-height scrolling.
28. At approximately 280px, 320px and 390px, confirm View and Not now remain beside each other where possible, Delete stays beneath, all actions remain visible without routine scrolling, and there is no staircase wrapping or horizontal overflow.
29. Confirm the viewer resembles a read-only Pocket tree, avoids excess empty space for a small document and gives larger tree/content panes independent scrolling.
30. Confirm the five recovery operations form a compact wrapping strip and that Discard is visibly destructive without dominating the viewer.
31. Keyboard through both modal surfaces; confirm visible focus, contained Tab navigation, announced errors and the accepted Escape behaviour.
32. With an installed/offline copy, refresh the service-worker shell and confirm the P026 wording and layout replace any cached earlier prompt.
33. Confirm the P026 flow adds no new console warning or error on the top-level Pocket page.

Stop immediately if the wrong file changes or an owner rotates before successful persistence.

## 14. Known limits

- Browser localStorage is finite and may be cleared by the browser or user.
- Only one encrypted Vault recovery record is retained.
- Processing is bounded to 10,000 nodes and approximately 5,000,000 serialised characters.
- Safe contained import does not perform a broad merge of root/data extras or tombstones.
- Same-Vault clean restore relies on the stable Vault ID and monotonic saved revision; divergent revisions use the contained fallback.
- Password recovery, key escrow, cloud backup, multi-device recovery and automatic file reopening remain out of scope.
- Physical browser acceptance is still required for real picker permission, write/close, focus, reload persistence and browser-storage behaviour.
