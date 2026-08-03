# Synced Pocket contract

## 1. Status and purpose

P027 defines the tested foundation for a future Synced Pocket. It does not expose sync in production. There is no Turn on sync control, account, passkey flow, production device store, selected backend, network request or recovery-key implementation.

The unloaded `PocketSyncContract` module is a dependency-injected orchestration seam. Its tests establish the ownership, encryption, Save and remote-revision rules that later integration must preserve.

## 2. Two human modes

### Local Pocket

The human explicitly chooses or creates a local JSON file or password-protected Vault. That file is the sole truth owner. Existing opening, Save, recovery, PE and owner-session rules remain unchanged. Plain JSON remains the simple readable option; standalone encrypted Vault files remain an advanced local option.

### Synced Pocket

The human turns on sync once. The future Synced Pocket is always end-to-end encrypted and does not ask the human to configure a storage provider, URL, token or folder. Routine access should eventually use the device's normal secure gesture. There is no second routine Sync button: Save means durable device Save followed by one explicit sync attempt.

P027 defines `ownerKind: "synced"` only inside the unloaded contract. It does not add that kind to `pocketFileState()`, `setPocketFileSession()`, `canShowPocketTree()`, `canModifyPocket()` or `exportTree()`.

## 3. One active truth owner

A future synced owner represents one logical Pocket. Its encrypted device record and encrypted remote record are replicas of that one owner, not competing owners.

The synced owner has:

- a stable synced Pocket identity;
- a last confirmed remote revision;
- an optional current encrypted record waiting to sync; and
- a pending/conflict state that can survive a locally successful Save.

Successful activation rotates the active Pocket owner/session identity exactly once. From that point, ordinary Save must target the synced owner only. The former local file handle must never remain a writable destination inside the synced owner.

## 4. Original-file backup and plain JSON transparency

Activation starts from an open local JSON file or Vault. Before adopting the synced owner, Pocket ensures that a dirty source is saved successfully. The original file is therefore an up-to-date backup snapshot at the transition point.

After adoption, Pocket does not change, relocate, encrypt, delete or continue writing to that original file. A former handle may be retained only as non-writable historical context outside the live synced owner contract.

For a readable JSON source, the future UI must use its real safe displayed filename:

> **Your original file will stay where it is**
>
> `{filename} is readable and will not be changed or deleted. After sync is working, you can decide whether to keep or remove it.`

The protected synced copy does not make the historical JSON unreadable. Only the human decides whether to keep, secure or remove that file later.

## 5. Account access and content protection are separate

Future account/passkey authentication proves that the human may access an account. It must not itself be treated as the content-encryption key.

A separately designed Pocket master key will protect readable Pocket content. It must be unlocked locally. The service must never receive readable Pocket content or the unlocked content key.

P027 deliberately does not choose:

- a WebAuthn/passkey flow;
- a passkey-to-key mechanism;
- a production master-key store;
- a key-wrapping scheme; or
- an account/server authentication protocol.

## 6. Emergency recovery is required but deferred

Synced Pocket needs an understandable emergency recovery mechanism for a lost device or inaccessible account gesture. It is a prerequisite for a production activation journey, but P027 does not generate, display, store or validate a recovery key.

Production activation must not claim to be ready until account access, content-key protection and emergency recovery have a complete reviewed design.

## 7. Activation preconditions and source-session protection

Activation accepts only a current local `json` or `vault` owner. `none` and `detached` are rejected.

The orchestration captures the exact source-owner session before asynchronous work. It rechecks that session after asynchronous boundaries. If the file, Vault session or owner changes, activation fails closed and does not adopt the staged synced owner.

If the source has unsaved content, activation first calls the existing local Save boundary. Cancellation or failure stops activation. Pocket does not create a synced Pocket from content that differs silently from the backup file.

## 8. Initial activation order

The tested order is:

1. capture and validate the source session;
2. save a dirty source through the existing Save boundary;
3. freeze one point-in-time readable Pocket payload;
4. seal it locally through the injected encryption boundary;
5. durably persist the encrypted synced-device record;
6. read and verify the expected remote revision;
7. conditionally commit only the encrypted record; and
8. adopt the synced owner exactly once.

Adoption occurs only after the initial device and remote writes succeed. Before that point, the local JSON/Vault owner remains active. A staged device record is not authoritative merely because it was written.

Failure does not clear the source owner, rotate its session, mark it converted, claim Sync is ready or write the source file a second time.

## 9. Encryption and remote boundary

The readable frozen payload exists only for local sealing. The sealing dependency returns an opaque encrypted record. Device and remote operations receive that record plus minimal synced identity/revision metadata.

The remote boundary must never receive:

- node names, Notes, Outline text or a readable Pocket payload;
- a passphrase, master key, `CryptoKey` or recovery key;
- a local file handle or filesystem path; or
- readable source-file contents or its display name.

P027 tests this with a distinctive plaintext sentinel and a separate key object. Neither appears in any remote adapter argument. P027 does not change the Pocket Vault format or claim that Vault v1 is the final synced-record format.

## 10. Remote revision contract

Remote safety uses a stable synced Pocket identity and monotonically advancing integer revisions. Timestamps may be display metadata but never decide the winner.

A remote commit supplies:

- the synced Pocket identity;
- the last confirmed revision as the expected revision; and
- the next opaque encrypted record.

The remote adapter writes only when its current revision equals the expected revision. A mismatch returns an explicit conflict. Pocket never overwrites newer remote data, silently picks a winner or automatically merges in P027.

The deterministic test adapter can model an empty remote, a matching revision, unavailability, write failure, a newer revision and an intervening write between read and conditional commit.

## 11. Save means Save and sync

For a live synced owner, a future ordinary Save must:

1. freeze/seal new content when required;
2. durably persist the encrypted device record;
3. read the remote revision;
4. attempt one conditional encrypted remote write; and
5. return an explicit local/sync result.

The device write always precedes remote access.

### Full success

The encrypted device record is durable and the conditional remote commit succeeds. The confirmed revision advances, pending state clears and the status is:

> Saved · Synced

### Device Save failure

Pocket does not read or write remote state. Content remains unsaved/dirty and the confirmed sync state does not advance.

### Remote unavailable or failed write

The content is durable on this device. The confirmed remote revision remains unchanged, the exact encrypted record remains pending and the status is:

> Saved on this device · Sync pending

### Newer remote revision

The local encrypted record remains durable and pending. Pocket performs no overwrite or merge and reports:

> Pocket found newer changes from another device.

## 12. Explicit retry with no new edits

There is no background retry in v1. A later explicit Save retries a pending encrypted record even when the current operation count is zero. The record may be reused when it is still the current device record.

Successful retry advances the confirmed remote revision and clears pending state. It must not be short-circuited as Already saved.

The live integration point is immediately before the existing `exportTree()` zero-operation early return. A future `ownerKind: "synced"` branch must route an explicit Save with pending sync to this retry contract before ordinary no-change handling. P027 does not change `exportTree()` yet.

## 13. No autosave or background sync in v1

The contract contains no timers, polling, service-worker messaging, background sync, provider SDK, browser storage access or network API. One user Save produces at most one explicit remote attempt. Another explicit Save is the retry mechanism.

## 14. Contract API

`PocketSyncContract` exposes:

- `COPY` — exact Turn on sync, Sync is ready and Save/conflict strings;
- `plainJsonNotice(displayName)` — exact readable-source transparency copy;
- `activate(dependencies, options)` — ordered source-to-synced activation;
- `save(dependencies, syncedState, options)` — device-first synced Save; and
- `retryPending(dependencies, syncedState)` — explicit no-new-edit retry.

Dependencies own payload freezing, local sealing, device persistence, remote read, conditional remote write, dirty-source Save, source-session currency and final owner adoption. This keeps backend, account and storage choices outside the contract.

## 15. Deferred production decisions

Before production integration, later work must decide and review:

- the remote service and conditional-write API;
- account identity and passkey registration/sign-in;
- Pocket master-key generation, wrapping, local unlock and device transfer;
- emergency recovery creation, storage and human journey;
- the production encrypted device-record store and durability guarantees;
- the synced encrypted-record format and metadata limits;
- first-device and additional-device bootstrap;
- conflict review/reconciliation UI without automatic merge;
- account, device and remote-data deletion semantics; and
- availability, abuse, quota and operational monitoring boundaries.

The recommended next integration boundary is a provider-neutral security/storage design that chooses the account, content-key, emergency-recovery, device-store and conditional remote API contracts together. Only after those are reviewed should the unloaded P027 contract be adapted behind production ownership and Save seams.
