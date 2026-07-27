# Vault Ownership Contract

## 1. Purpose

P019 turns Pocket Vault v1 from an encryption proof loop into an explicit encrypted local truth-file workflow.

The central rule is:

> Exactly one active document owner has Save authority. When that owner is a Vault, Main Save and PE Save may write only an encrypted Vault envelope to that Vault's exact handle.

P019 does not add cloud synchronisation, accounts, key escrow, password recovery, OS keychain integration, encrypted browser crash recovery, shared Vaults or Document PiP for Vault content. It does not change the Pocket Vault v1 envelope format or the Pocket truth payload schema.

## 2. Active document owners

`js/pocket-io-browser.js` and the lexical `state.pocketFile` record define four owner kinds:

| Owner kind | Writable destination | Editable tree | Save behaviour |
| --- | --- | --- | --- |
| `none` | None | No ordinary editable tree | Existing no-file gate |
| `json` | Exact selected JSON `FileSystemFileHandle` | Yes | Existing JSON truth-file path |
| `vault` | Exact selected Vault `FileSystemFileHandle` plus an unlocked in-memory Vault session | Yes | Encrypt and write only that Vault |
| `detached` | None | Yes, only after explicit P016 device/combined adoption | Existing explicit new-destination picker |

The document-session number, exact handle object, owner kind and Vault-session ID are checked together. A filename is diagnostic only. Equal filenames do not confer identity or Save authority.

`setPocketFileSession()` is the canonical ownership transition. It installs only one handle, owner kind and transient Vault-session ID. Moving away from a Vault clears the previous unlocked Vault session. `clearPocketFileSession()` removes all handle and Vault authority. Successful ownership changes rotate the Pocket document session, invalidating earlier PE source identities and stale queued work.

The existing `truthFileHandle` remains the one active physical handle. The explicit owner kind prevents code from inferring that every non-null handle is an ordinary JSON destination.

## 3. Unlocked Vault session

`js/pocket-crypto.js` and `js/pocket-vault.js` retain one page-lifetime unlocked Vault session containing:

- a non-extractable AES-GCM `CryptoKey`;
- the envelope salt and fixed PBKDF2 iteration setting;
- Vault ID;
- current successful revision;
- content type and creation metadata; and
- a fresh random in-memory Vault-session ID.

The password is used to derive the non-extractable key. It is not installed in Pocket state, owner labels, node data, PE payloads, truth payloads or browser storage. The credential dialog consumes its local credential strings and clears both password fields immediately after unlock/key derivation, before create sealing, file writing or queued adoption. Encoded password bytes are zeroed after Web Crypto imports the key material. JavaScript strings cannot be securely zeroed, so the contract is non-retention rather than a claim of memory erasure.

The key and session are not persisted. Reloading the page, clearing the owner or adopting a different owner discards the active reference. Reopening a Vault therefore requires its password again.

The legacy origin-global `pocket.vault.state.v1` helpers no longer establish Vault ID or revision. The exact envelope and active in-memory session own those values.

## 4. Vault v1 cryptography

P019 preserves the existing format:

- AES-GCM with a 256-bit non-extractable key;
- PBKDF2-SHA-256;
- 310,000 iterations;
- 16-byte salt;
- 12-byte nonce;
- base64url encoding; and
- `portal.export.v1+json` plaintext content.

Opening validates the supported version, content type, cipher, KDF, exact iteration setting, canonical base64url fields, salt length, nonce length, Vault ID, revision and creation time before use.

Every encrypted Save uses `crypto.getRandomValues()` to create a fresh 12-byte nonce. The active revision advances by exactly one only after the writable stream closes successfully and the captured owner/session remains current. Encryption, permission or write failure does not advance it.

P019 retains Vault v1 compatibility. It does not introduce a new authenticated-header format or a rollback-detection protocol. Those are separate future hardening decisions.

## 5. Atomic Vault opening

`PocketVaultBrowserIo.openVault()` uses `showOpenFilePicker()` and treats the chosen handle as a pending candidate, not an owner.

The current document, handle, tree, operations, dirty state, document session and unlocked key remain authoritative while Pocket:

1. verifies or obtains read/write permission through the shared P017 permission owner;
2. reads the candidate;
3. parses and validates the outer Vault envelope;
4. shows the accessible unlock dialog;
5. derives the key and authenticates the ciphertext;
6. parses the decrypted JSON;
7. validates the decrypted document structure before normalisation;
8. normalises nodes and root/data metadata through the active normalisers and proves that the result remains meaningfully equal to the decrypted document;
9. resolves any dirty-current-owner decision; and
10. serialises final adoption through the shared owner/save queue.

Only then does Pocket stage the decrypted state without storage or rendering side effects, recheck the candidate, install the candidate's exact handle and unlocked session, rotate the document session once, clear the old owner's authority and refresh the source UI. If staging fails, the exact prior state and owner remain installed. Successful commit also clears document-bound Notes/rename drafts, undo snapshots, pending imports and menus so an old document action cannot mutate a same-ID item in the new document.

Cancellation, permission denial, read failure, invalid or unsupported envelope, wrong password, authentication failure, invalid decrypted JSON, structural rejection, stale candidate or a superseding owner transition changes none of the current owner, tree, dirty state, handle or key and performs zero writes.

Opening ordinary JSON while a Vault is active follows the same prepared-candidate boundary. The old Vault key is not cleared until the replacement JSON state has staged successfully. A dirty Vault is resolved before the validated JSON candidate may be adopted, and mutation remains gated until the queued adoption completes.

## 6. Permission and credential dialogs

Vault permission uses the shared P017 Continue/Cancel dialog. The current document remains active behind it. Permission success only permits the candidate pipeline to continue; it does not itself adopt the Vault.

The dedicated Vault dialog is an accessible modal with inert background and focus containment.

Unlock mode:

- title: **Unlock encrypted Vault**
- field: **Password**
- actions: **Unlock**, **Cancel**

Create mode:

- title: **Create encrypted Vault**
- fields: **Password**, **Confirm password**
- actions: **Create Vault**, **Cancel**

Password inputs use `type="password"`, require at least eight characters and are cleared after submission or closure. Return submits a valid form. Escape cancels an idle dialog. Wrong passwords remain inside the unlock dialog and do not alter the active document.

Only one candidate and one Vault dialog are active at a time. Owner-changing actions and ordinary mutations are gated while either the permission or Vault dialog is unresolved.

## 7. Encrypted Main Save

`exportTree()` remains the one Main Save owner. It freezes the canonical Pocket payload and dispatches from the captured owner kind.

For a Vault owner it:

1. captures the exact Pocket document session, Vault handle and Vault-session ID;
2. freezes the current canonical payload and covered operation sequence;
3. seals the payload with the active non-extractable key and next revision;
4. generates a fresh nonce;
5. checks the captured owner before and after permission and asynchronous write boundaries;
6. writes the envelope only to the captured Vault handle;
7. closes the writable stream;
8. advances the active Vault revision only after successful persistence;
9. updates the document baseline to the payload actually written; and
10. removes only operations covered by that successful Save.

The Vault path never falls back to an ordinary JSON handle, a picker, a download, a plaintext copy or detached mode. `writeTruthFile()` explicitly rejects a Vault owner, and `exportTree()` delegates Vault persistence only to `PocketVaultBrowserIo.writeActiveVaultPayload()`.

If encryption, permission or persistence fails, the Vault remains active, operations remain dirty and decrypted content remains only in memory. A queued Save whose document owner or Vault session changed fails closed.

The source UI identifies the owner as `Encrypted Vault · <filename>`. The primary Save control's accessible name is **Save encrypted Vault**.

## 8. Encrypted PE Save

P019 extends the P012/P018 transient PE identity with:

- `sourceOwnerKind`; and
- `sourceVaultSessionId`.

These fields travel only in the opening/save transport. They do not enter Notes, Outline, `node.editor`, state nodes, truth JSON, Vault plaintext, localStorage or recovery records.

The save boundary verifies, in order:

1. P018 main-page and popup-instance ownership;
2. Pocket document-session identity;
3. source owner kind;
4. Vault-session identity when the owner is `vault`;
5. node existence and original node revision;
6. P011 editor support classification; and
7. P012 non-lossy payload preflight.

Only then may the node change be applied and canonical `exportTree()` invoked. A Vault PE becomes clean only after the encrypted Vault write succeeds.

If the node change is applied in memory but Vault persistence fails, the returned node revision is retained for retry, the PE stays dirty and no plaintext or alternate-file fallback occurs. A PE opened before JSON/Vault/detached switching, Vault replacement or page reload fails closed.

No password, `CryptoKey`, salt or full Vault session is exposed to the popup.

## 9. Creating an active encrypted Vault

**Save as encrypted Vault…** requires an already active valid Pocket document and `showSaveFilePicker()`.

Pocket chooses a new destination, proves it is distinct from the active handle, collects and confirms a password, derives a non-extractable key, generates a new Vault ID and salt, seals revision 1 with a fresh nonce, writes and closes the new file, and only then installs it as the active Vault owner. If exact-handle comparison is unavailable or fails, Pocket asks for another destination rather than treating uncertainty as permission to overwrite.

The previous JSON, Vault or detached owner remains unchanged if the picker, credential entry, encryption, permission or write fails. Creating a Vault never repurposes or overwrites the previous JSON file.

After success, future Main Save and PE Save target only the new encrypted Vault.

## 10. Explicit unencrypted JSON export

While a Vault is active, **Export unencrypted JSON copy…** first shows:

> **Export an unencrypted copy?**
>
> This creates a readable JSON file. Your encrypted Vault will remain active, and future Save will continue writing only to the Vault.

After explicit confirmation Pocket always opens `showSaveFilePicker()`, requires a destination proven distinct from the active Vault handle, writes one readable canonical JSON payload to the newly selected handle, and leaves the Vault owner, key, revision and document session unchanged. A second wrapper for the same file is rejected through `isSameEntry()`. Missing or failed exact-entry comparison fails closed.

The exported JSON handle receives no future Save authority. Export cancellation or failure changes nothing. Exporting a copy does not make the Vault clean unless the Vault itself was already saved.

## 11. Dirty owner switching

Unsaved Vault plaintext is not stored in browser recovery. Opening or creating another document from a dirty Vault therefore shows:

> **Save changes to this Vault?**
>
> Vault changes are not stored in browser recovery. Save them before opening another file, or discard them.

Actions:

- **Save and continue** performs the canonical encrypted Vault Save and continues only after success.
- **Discard and continue** writes nothing and permits only the already prepared candidate to be adopted.
- **Cancel** retains the dirty Vault and clears the candidate.

The dialog owns an internal token which authorises only its current Save-and-continue call through the normal `exportTree()` gate. It does not create another Save owner. Failed Save leaves the Vault and dialog open. Candidate tokens and the shared owner/save queue prevent stale unlocks, candidates and writes from overtaking a newer owner.

Opening a Vault from a dirty JSON owner remains conservative: Pocket asks the user to save the current Pocket file rather than silently discarding or copying JSON changes into the Vault flow.

## 12. Browser-recovery privacy

While a Vault owner is active, Pocket suppresses plaintext persistence and restoration through:

- workspace state;
- current local-safety snapshot;
- local-safety trail writes;
- automatic cache;
- last-save snapshot;
- FILE/DEVICE/BASE device-change resolution;
- PiP snapshot persistence and restoration;
- PiP session export/adoption; and
- PiP host Save.

`recordOp()` still records in-memory operations, but the storage owner returns without writing Vault content. `applyLoadedState()` may establish the in-memory document baseline needed by the current page, but in Vault-private mode it skips workspace restore, local-safety offer, last-save snapshot and PiP persistence.

Opening a Vault does not delete a pre-existing ordinary JSON recovery copy. JSON recovery remains intact and becomes relevant again after returning to ordinary JSON ownership. When detached P016 device changes are explicitly saved as a Vault, only the covered current detached safety slot is cleared after the encrypted write; its historical trail remains. Vault plaintext is not compared or combined through P016 FILE/DEVICE/BASE.

While a Vault is dirty, the UI states:

> Vault changes are not kept in browser recovery. Save the Vault to protect them.

The existing single page `beforeunload` guard warns when unsaved work exists. It does not encrypt, save or write recovery data during unload.

P019 deliberately accepts this trade-off:

- saved Vault content is encrypted in the Vault file;
- unsaved Vault edits exist only in memory; and
- a crash or forced shutdown can lose those edits.

Encrypted browser crash recovery is future work.

## 13. Document PiP

Document PiP is blocked while a Vault owns the document because its current transfer and snapshot architecture is plaintext.

The user-facing explanation is:

> Document PiP is not available for encrypted Vaults yet because its transfer is not encrypted.

PiP open, snapshot persistence, session export, session adoption and PiP-host Save all fail closed in Vault mode. Ordinary JSON PiP behaviour is unchanged. A PiP session from another document cannot return Vault content through these guarded routes.

## 14. Same-filename and race safety

Filenames are never ownership credentials.

- JSON and Vault handles with the same name are distinct.
- Two Vault handles with the same name are distinct.
- Reopening another Vault creates a new Vault-session ID.
- Save captures the exact handle, Pocket document-session ID, owner kind and Vault-session ID.
- Checks run before and after asynchronous permission, encryption and write stages.
- JSON and Vault owner transitions use the same serial queue as truth writes.

Accordingly, delayed JSON Save cannot write after Vault adoption, delayed Vault V1 Save cannot write after V2 adoption, and an old PE cannot apply after any owner/session transition.

## 15. Integration with P016, P017 and P018

P019 preserves:

- P016 ordinary JSON FILE/DEVICE/BASE comparison and detached ownership;
- P017 pending permission candidate ownership, single-flight Continue and inert modal;
- P018 page-private PE window and popup-instance ownership;
- P012 file-session, node-revision and non-lossy Save checks;
- independent Notes and Outline; and
- the explicit-file gate, no autosave, no background writes and no silent handle reuse.

Vault plaintext is deliberately excluded from P016 recovery and Document PiP. Vault owner identity supplements rather than replaces P012 and P018 checks.

## 16. Automated validation

Run from the repository root:

~~~sh
node --test tests/p019-vault-ownership.test.js
node --test tests/pe-persistence-contract.test.js
node --test tests/device-changes-resolution.test.js
node --test tests/p018-popout-isolation.test.js
find js -name '*.js' -print0 | xargs -0 -n1 node --check
git diff --check
~~~

Final P019 commit results:

- P019 Vault ownership suite: **87 passed, 0 failed**
- PE persistence suite: **96 passed, 0 failed**
- Device-changes/P017 suite: **69 passed, 0 failed**
- P018 popup-isolation suite: **15 passed, 0 failed**
- Combined test result: **267 passed, 0 failed**
- Production JavaScript syntax checks: **PASS for every `js/*.js` file and `sw.js`**
- Generated PE runtime `new Function(...)`, where applicable: **PASS through the PE persistence suite**
- `git diff --check`: **PASS**

The focused tests must use synthetic data, fake handles and browser-like VM contexts. They must not read Murray's real truth file, real Vault, browser storage or password.

## 17. Physical acceptance checklist

Murray's physical browser acceptance remains required. Use disposable files and a disposable password only. Do not use Murray's real truth file or a future real Vault.

1. Create disposable JSON A.
2. Add a distinctive item and Save A.
3. Choose Save as encrypted Vault.
4. Create disposable Vault V with a disposable password.
5. Confirm source says Encrypted Vault and shows V.
6. Edit V in the main tree.
7. Press Main Save.
8. Close and reopen V.
9. Unlock V.
10. Confirm the edit is present.
11. Reopen JSON A.
12. Confirm A was not replaced with Vault content.
13. Open V again.
14. Edit through PE.
15. Save through PE.
16. Confirm PE becomes clean only after encrypted persistence.
17. Reopen V and confirm the PE edit.
18. Confirm A remains unchanged.
19. Choose Export unencrypted JSON copy.
20. Confirm the warning says the copy is readable.
21. Export to disposable JSON C.
22. Confirm V remains active.
23. Make another V edit and press Main Save.
24. Reopen V and confirm the edit.
25. Confirm C did not receive the later Save.
26. Attempt to open V with the wrong password while A is active.
27. Confirm A remains active and unchanged.
28. Make V dirty and attempt to open A.
29. Test Cancel.
30. Confirm dirty V remains.
31. Repeat and test Discard and continue.
32. Confirm no Vault write occurred.
33. Repeat and test Save and continue.
34. Confirm switching waits for encrypted persistence.
35. Reload Pocket.
36. Confirm V requires its password again.
37. Confirm ordinary JSON recovery still works with disposable JSON.
38. Confirm no Vault recovery offer appears over V.
39. Confirm PiP is calmly unavailable while V is active.
40. Stop immediately if any operation targets the wrong file or Chrome becomes unstable.

Do not ask Murray to reproduce a crash.
