# Vault Recovery Contract

## 1. Purpose

P022 adds encrypted browser recovery for unsaved changes made while an encrypted Pocket Vault is the active truth owner.

The recovery copy is a safety aid, not a document owner. It does not replace the selected Vault, remember or regain a writable handle, open itself as the working document, or write to any file without an explicit user action. Main Save and PE Save continue to write only through the current active owner and remain subject to the existing document-session, Vault-session and node-revision protections.

This contract supersedes the P019 trade-off that unsaved Vault edits existed only in memory. It does not change the Pocket Vault v1 envelope, the Pocket truth payload schema, ordinary JSON recovery, or explicit local-file ownership.

## 2. Core invariants

P022 preserves these boundaries:

- the selected local JSON file or encrypted Vault remains the explicit document truth;
- no selected or created file means no ordinary editable tree;
- browser storage is recovery support only;
- Vault browser recovery contains no readable Pocket content;
- no password, decrypted recovery payload, `CryptoKey` or writable `FileSystemFileHandle` is persisted;
- the original Vault filename and handle are not required to unlock recovery;
- decrypting recovery does not adopt it as the active document;
- every output destination is explicit and user-selected;
- failed, cancelled or rejected output leaves the encrypted recovery intact;
- successful live-Vault persistence clears only recovery covered by that write;
- PE remains dirty until truth-file persistence succeeds;
- no autosave, background truth-file write, file watcher, cloud synchronisation or silent handle reuse is introduced; and
- existing non-Vault browser recovery continues to use its established path.

## 3. Encrypted browser record

The browser record uses the localStorage key:

```text
pocketLite.vaultRecovery.encrypted.v1
```

Its outer shape is deliberately small:

```json
{
  "schema": "pocket.vaultRecovery.encrypted.v1",
  "version": 1,
  "capturedAt": "2026-07-30T06:30:00.000Z",
  "highestSequence": 12,
  "envelope": {
    "kind": "pocket.vault",
    "version": 1,
    "vaultId": "<opaque Vault identifier>",
    "revision": 5,
    "createdAt": "<Vault creation time>",
    "contentType": "portal.export.v1+json",
    "crypto": {
      "cipher": "AES-GCM",
      "kdf": "PBKDF2-SHA-256",
      "iterations": 310000,
      "salt": "<base64url>",
      "nonce": "<base64url>",
      "encoding": "base64url"
    },
    "payload": "<base64url>"
  }
}
```

Only management and cryptographic envelope metadata is readable outside the ciphertext. Node labels, Notes, Outline/editor data, root/data extras and tombstones exist only inside the authenticated encrypted envelope.

The encrypted plaintext is a complete canonical Pocket payload built from the current in-memory document. `highestSequence` identifies the latest operation covered by that encrypted capture. It supports save-race decisions but is not an authority to write or adopt a file.

Recovery encryption reuses the active Vault's non-extractable in-memory key, salt and Vault identity. Each capture is sealed with a fresh AES-GCM nonce. The password and decrypted bytes are not added to the record.

## 4. Capture lifecycle

`recordOp()` remains the canonical operation owner. When the active owner is an encrypted Vault, its normal browser-safety call is routed to `PocketVaultRecovery.scheduleCapture()` instead of the plaintext local-safety snapshot.

Capture is asynchronous and serialised:

1. freeze the current canonical payload and highest operation sequence;
2. capture the exact Pocket document and Vault-session identities;
3. encrypt with the active non-extractable Vault key;
4. recheck both identities before storing;
5. replace the browser record only if the capture is still current; and
6. report whether encrypted recovery is pending, stored or failed.

An older capture cannot overwrite a newer capture or cross into another document/Vault session. Pocket also refuses to replace an unresolved encrypted recovery belonging to a different Vault. This preserves the earlier recovery instead of silently destroying it.

Replacement and live-Save cleanup require exact in-memory ownership of the stored recovery bytes, not merely a matching Vault ID. A record found at startup is therefore unowned by the new page until the user explicitly resolves it. Choosing **Keep for later**, or opening the same Vault in another page/session, cannot silently replace or clear that kept record. The current page may update only the capture chain it created itself.

Browser quota, serialisation or encryption failure leaves the in-memory document and operation list dirty. The UI warns that encrypted browser recovery could not be updated and directs the user to save the Vault. A failed recovery capture never becomes a truth-file write.

The synchronous `beforeunload` guard continues to warn about dirty work. It does not begin asynchronous encryption or writing while the page is unloading.

## 5. Successful Vault Save and save races

Main Save still freezes one canonical payload and the operation sequence covered at Save start. Only a successfully closed encrypted Vault write may advance the Vault revision, establish the new baseline or retire covered operations.

After successful truth persistence:

- when no newer operations remain, P022 removes the matching encrypted browser recovery;
- when newer operations were recorded during the write, P022 encrypts the newest visible state with the now-current Vault session and retains that newer recovery;
- if refreshing the newer recovery fails, the successful truth save remains successful, the newer operations remain dirty and Pocket warns that browser recovery could not be refreshed; and
- a recovery belonging to another Vault or changed flow is not deleted.

Encryption failure, permission failure, a cancelled picker, stale-session rejection, write failure or close failure leaves the existing encrypted recovery intact.

## 6. Startup warning and interaction gate

On startup or reload, the presence of the browser record immediately opens the permanent accessible Vault dialog before ordinary work continues.

The warning says that Pocket kept unsaved Vault changes encrypted in this browser and offers:

- **Unlock recovery**
- **Delete recovery**
- **Not now**

The modal uses the shared Vault dialog's `role="dialog"`, `aria-modal="true"`, focus containment, background inertness and keyboard handling. While the recovery flow is open, tree mutation, file opening/creation, Vault creation/export and PiP opening are gated.

The ordinary startup file gate and any PiP snapshot adoption are also deferred through one callback until the user finishes the recovery choice. This prevents startup code from rotating the document session behind the modal. After **Not now**, Delete, Keep or a completed output, that deferred normal startup runs once.

**Not now** closes the flow, leaves the encrypted record untouched and allows normal Pocket use. No recovery content is decrypted.

## 7. Delete and discard

**Delete recovery** does not require a password. Pocket first asks for explicit confirmation:

> This permanently deletes only the browser-held encrypted recovery. It does not change or delete any saved Pocket file or Vault.

The post-unlock **Discard recovery** action uses the same safety meaning and also requires confirmation.

Cancellation changes nothing. Confirmed deletion removes only the exact browser record which the current flow opened. If that record changed meanwhile or browser deletion fails, Pocket leaves it available and reports the failure.

## 8. Unlock boundary

**Unlock recovery** asks for the protecting Vault password inside Pocket. It does not ask for the original Vault file or use a remembered handle.

Unlock:

- validates the stored record and Vault envelope before use;
- derives a key from the entered password and envelope parameters;
- authenticates/decrypts the ciphertext;
- validates the recovered Pocket structure without adopting it;
- keeps the validated decrypted payload only in the current in-memory flow; and
- clears the credential controls after submission or closure.

A wrong password reveals no content, deletes nothing and leaves retry or Cancel available. A damaged, changed or structurally unsafe record also remains encrypted and stored.

After successful unlock, Pocket presents exactly these explicit actions:

- **Save as new encrypted Vault**
- **Save as plain JSON**
- **Add to an existing Pocket file**
- **Keep for later**
- **Discard recovery**

Unlocking alone never changes the visible tree, active handle, document session, operation history or saved file.

## 9. Output ownership

Every recovery output is bound to the exact document session in which the startup flow began and to an unforgeable in-memory recovery-flow token. Output is rejected if the active document/session changes, another owner action is pending, a permission prompt is open or the flow is superseded.

### Save as new encrypted Vault

Pocket:

1. validates the recovered payload;
2. asks for a new Vault destination;
3. requires that destination to be provably distinct from any current active handle;
4. asks for and confirms a new password;
5. creates a new non-extractable Vault session;
6. seals revision 1 with a fresh nonce;
7. writes and closes only the selected new handle.

The recovery output is deliberately write-only: it does not replace the visible tree or active document owner. Cancellation, encryption failure or write failure retains both the current owner and encrypted browser recovery. A successful save clears the recovery. If browser deletion then fails, the newly saved Vault remains authoritative and Pocket warns that the older encrypted recovery still exists.

### Save as plain JSON

Pocket first warns:

> This creates a readable plain JSON file. Anyone who can open that file can read the recovered Pocket content.

After confirmation it asks for a new JSON destination, requires it to be distinct from the current active handle and writes only that handle. It does not adopt the readable output as the active document. Failure or cancellation retains the encrypted recovery. Success clears it, subject to the same deletion-failure warning.

### Keep for later

Pocket clears decrypted in-memory flow state, closes the dialog and leaves the encrypted browser record intact. It does not adopt or write recovered content.

## 10. Add to an existing Pocket file

This action intentionally avoids a full-document merge.

Pocket asks the user to select one existing plain Pocket JSON file, reads and validates it, builds the result in memory, shows an explicit **Add and save** confirmation, then rereads the destination immediately before writing. Any byte-level change since review fails closed. Pocket writes only the explicitly selected handle and does not adopt that destination as the active document.

The import:

- creates one new top-level node labelled `Recovered YYYY-MM-DD HH:MM`;
- assigns a fresh ID to the wrapper;
- assigns fresh IDs to every recovered node;
- remaps every recovered parent relationship beneath the wrapper;
- preserves recovered node content, Notes, supported or opaque editor metadata, generic node extras and subtree order; and
- retains the destination document's existing nodes, tombstones, root extras and data extras.

Only the recovered node tree is imported. Recovered root extras, data extras and tombstones are deliberately not merged into the destination because P022 favours a contained, inspectable subtree over risky whole-document combination. The selected destination must be a supported plain Pocket JSON file; encrypted Vault envelopes are rejected.

Read, parse, validation, confirmation, freshness or write failure performs no adoption and leaves recovery available. A successful import/write leaves the current active owner unchanged and clears the encrypted recovery.

## 11. Non-Vault recovery

P022 does not replace, delete or reinterpret ordinary JSON browser recovery.

While a Vault is active:

- plaintext workspace, local-safety trail, auto-cache, last-save and PiP recovery writes remain suppressed;
- an existing ordinary JSON safety record is preserved;
- the new encrypted Vault record uses its separate key and lifecycle; and
- returning to an ordinary JSON owner restores the ordinary recovery rules.

Vault recovery is not routed through P016 FILE/DEVICE/BASE comparison, is not eligible for silent restoration, and is never mixed with ordinary plaintext safety data.

## 12. Security and failure invariants

The automated and manual acceptance boundary must prove:

- persisted browser data does not contain readable node, Notes, Outline, root/data-extra or password marker text;
- only a valid password can authenticate/decrypt the envelope;
- wrong-password, invalid-record and invalid-structure paths preserve the blob;
- decrypted content stays in the active JavaScript flow only;
- Delete/Discard removes only the browser record;
- recovery output never writes the current handle unless that exact file was explicitly selected for the contained add-to-existing action;
- a recovery output never adopts its selected destination or changes the visible working tree;
- stale flow/session completion cannot write, adopt or clear a newer record;
- a failed output never clears recovery;
- live-Vault save clears only covered recovery;
- newer changes during Save remain dirty and encrypted in refreshed recovery;
- the canonical Main Save and PE Save owners remain unchanged; and
- no recovery metadata enters Pocket nodes or exported truth JSON.

P022 does not provide password recovery, key escrow, multi-device recovery, cloud backup, rollback detection, shared Vaults, automatic restore, automatic merge or a guarantee that browser storage survives user/browser clearing.

## 13. Automated validation

The focused executable contract is exercised by:

```sh
node --test tests/p019-vault-ownership.test.js
```

P022 result: **133 passed, 0 failed**.

The suite loads the actual production scripts in a controlled VM with synthetic handles, Web Crypto, localStorage and DOM surfaces. P022 coverage includes encrypted-only capture, decryptability with the correct synthetic password, absence of plaintext markers, capture coalescing/session checks, startup warning actions, wrong-password retention, confirmed deletion, all explicit output routes, add-to-existing ID/parent remapping, write/cancellation failure retention, successful clearing, save-race refresh, ordinary JSON recovery preservation, dialog lifecycle/accessibility and existing P019-P021 owner/save regressions.

Changed JavaScript is syntax-checked directly with `node --check`. The prohibited broad checker and its npm alias are not part of this contract.

## 14. Physical browser acceptance checklist

Use disposable synthetic Pocket/Vault files only. This checklist records required acceptance and must not be marked complete until Murray has exercised it in a real supported browser:

1. Open an encrypted Vault.
2. Make a change so the document is dirty.
3. Confirm an encrypted recovery snapshot is created via the intended flow.
4. Simulate reload / restart.
5. Confirm the startup recovery warning appears.
6. Confirm the options are:
   - Unlock recovery
   - Delete recovery
   - Not now
7. Confirm Delete recovery works without password and requires confirmation.
8. Confirm wrong password does not reveal content and does not delete the blob.
9. Confirm correct password unlocks the recovery flow.
10. Confirm the unlocked options include:
    - Save as new encrypted Vault
    - Save as plain JSON
    - Add to an existing Pocket file
    - Keep for later
    - Discard recovery
11. Confirm Save as new encrypted Vault succeeds and clears recovery.
12. Confirm Save as plain JSON warns clearly and clears recovery on success.
13. Confirm Add to an existing Pocket file imports beneath a single timestamped top-level recovery node and clears recovery on success.
14. Confirm Keep for later leaves the recovery blob intact.
15. Confirm Discard recovery removes it with confirmation.
16. Confirm no existing active-file session protections were broken.
17. Confirm normal non-recovery Vault usage still works.
18. Confirm PE save semantics and explicit truth-file saving still behave correctly.

## 15. Known limits

- Browser localStorage is finite and may be cleared by the browser or user. P022 reports capture failure but cannot guarantee browser retention.
- Only one encrypted Vault recovery record is retained. An unresolved record from another Vault is preserved rather than overwritten, so the newly active Vault may temporarily lack browser recovery until the earlier record is resolved.
- Output processing is bounded to 10,000 nodes and approximately 5,000,000 serialised characters to avoid unsafe recovery transformation in the browser.
- Add to an existing file accepts plain Pocket JSON only and imports the recovered node tree under one wrapper. It does not merge recovered root/data extras or tombstones.
- Add to existing acquires write permission and rereads exact destination bytes immediately before writing. The File System Access API does not provide a compare-and-swap transaction, so a separate external writer changing the file after that final check remains a platform-level race.
- A successfully written recovery output may remain accompanied by the older encrypted browser record if localStorage deletion fails. Pocket reports that state rather than pretending cleanup succeeded.
- Physical browser acceptance is still required for real picker permission, File System Access write/close behaviour, reload persistence, focus containment and localStorage quota behaviour.
