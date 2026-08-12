# Synced Pocket encrypted device store

## 1. Scope and status

P030 implements the dormant browser device-store foundation for a future Synced Pocket. P039 added one optional encrypted activation draft. P041 adds a strict encrypted emergency-recovery staging variant and one optional encrypted recovery draft, still in the same database and object store. `js/pocket-sync-device-store.js` remains absent from `index.html` and `sw.js`; it does not create a live synced owner, change Save, show UI, contact a service or alter current JSON/Vault recovery.

The store follows Pocket's [product principles](PRODUCT_PRINCIPLES.md): preserve one complete state, keep storage machinery invisible, persist no readable content or raw unlock secret, and use the smallest replaceable mechanism that meets the contract.

## 2. Database shape

The browser driver uses IndexedDB with exactly:

- database: `pocket.sync.device.v1`;
- database version: `1`;
- object store: `pockets`;
- key path: `syncedPocketId`; and
- secondary indexes: none.

There is one current record per opaque synced Pocket ID. Product v1 may expose only one ordinary Synced Pocket per account, but a Pocket ID key does not make filenames identity or prevent a later reviewed multi-Pocket account model. There are no history, operation, log, telemetry, settings or migration stores. Keeping only current encrypted state avoids a second truth history, duplicate ciphertext and unbounded storage machinery.

This database is separate from `pocketLite.recentFile.v1`, which stores only recent local-file display metadata for the existing JSON/Vault owner.

## 3. Exact record schema

Record schema version 4 is the following strict whole-record shape. `deviceWrappingKey` is an actual structured-cloned `CryptoKey`, not the displayed placeholder string. `activationDraft` and `recoveryDraft` are null outside their dormant orchestration or one P029 encrypted record. Their readable logical fields never appear in raw IndexedDB state.

```json
{
  "kind": "pocket.sync.device-state",
  "schemaVersion": 4,
  "storeRevision": 1,
  "syncedPocketId": "opaque-pocket-id",
  "deviceId": "opaque-device-id",
  "deviceWrappingKey": "<non-extractable CryptoKey>",
  "deviceEnvelope": {
    "context": {
      "syncedPocketId": "opaque-pocket-id",
      "envelopeId": "opaque-envelope-id",
      "envelopeKind": "device",
      "envelopeVersion": 1
    },
    "metadata": {
      "contractVersion": 1,
      "syncedPocketId": "opaque-pocket-id",
      "envelopeId": "opaque-envelope-id",
      "kind": "device",
      "version": 1,
      "deviceId": "opaque-device-id",
      "createdAt": "valid timestamp",
      "kdf": "none"
    },
    "record": {
      "format": "pocket.sync.master-key-envelope.opaque",
      "version": 1,
      "algorithm": "AES-GCM-256",
      "nonce": "canonical-base64url",
      "ciphertext": "canonical-base64url"
    }
  },
  "content": {
    "context": {
      "syncedPocketId": "opaque-pocket-id",
      "revision": 1,
      "contentType": "portal.export.v1+json"
    },
    "record": {
      "format": "pocket.sync.content.opaque",
      "version": 1,
      "algorithm": "AES-GCM-256",
      "nonce": "canonical-base64url",
      "ciphertext": "canonical-base64url"
    }
  },
  "remote": {
    "confirmedRevision": 0,
    "pending": {
      "expectedRevision": 0,
      "operationId": "opaque-operation-id",
      "logicalChangeId": "opaque-logical-change-id",
      "attemptKind": "new-change"
    },
    "conflict": null
  },
  "usage": {
    "masterKeyGeneration": 1,
    "masterKeyContentEncryptions": 1,
    "deviceWrappingKeyEncryptions": 1
  },
  "activationDraft": null,
  "recoveryDraft": null
}
```

Unknown fields fail closed. P030 delegates content/envelope/context/key validation to P029 and trusted-device/conditional-request metadata validation to P028 instead of creating weaker parallel formats. All Pocket, device and envelope identities must agree. The direct device envelope is exactly `device` with `kdf: none`; no HKDF salt or derivation version is stored.

## 4. Encrypted-only persistent boundary

Persistent state contains only opaque identity/revision metadata, the non-extractable device wrapping key, its encrypted master-key envelope, one encrypted content record, minimal pending/conflict state, encryption-use counters and optional encrypted activation/recovery drafts. It contains no readable nodes, labels, Notes, Outline, JSON payload, filename/path/handle, Vault password, plaintext recovery root/package, raw key, PRF output, transfer secret, browser-safety recovery payload, account password/token or UI/search state.

During P039 activation, the draft may temporarily contain the recovery root and complete local-only recovery package inside ciphertext. P029 seals that draft with the non-extractable device key and binds it to the Pocket ID and current `storeRevision`. After recovery-copy confirmation, P039 replaces the draft with a cleaned state containing neither value before owner adoption. The raw record never exposes either temporary value.

`remote.pending` identifies how to retry the one `content.record`; it never stores a second ciphertext copy. A conflict retains that same pending record and records only the newer actual revision and matching operation ID.

The device key is stored directly by IndexedDB structured cloning. It must be a non-extractable AES-GCM-256 `CryptoKey` with exactly `encrypt` and `decrypt` usages. P030 never exports it, serialises it as JWK/raw bytes, substitutes an extractable key or falls back to plaintext. A runtime clone/storage failure returns `device-key-storage-unsupported` and fails closed. Non-extractability is not a promise of hardware backing or protection from compromised same-origin code, browser, extension, OS or device.

## 5. Whole-record atomicity and local compare-and-swap

Initial creation requires `storeRevision: 1` and IndexedDB `add` semantics, so it cannot replace an existing Pocket. Every replacement uses one readwrite transaction to read and validate the current record, compare the caller's expected `storeRevision`, validate the complete proposed record, require exactly the next store revision, prevent remote-revision and same-generation usage rollback, and write the whole record.

Success is reported only after the IndexedDB transaction `complete` event, not after an individual `add` or `put` request. Request failure, validation failure, stale comparison, abort or interruption therefore leaves the previous whole record unchanged. A stale tab receives `device-store-revision-conflict` and cannot silently overwrite the winner. P030 adds no tab election, lease, polling, timer or background reconciliation.

Reading returns `null` for an absent Pocket and otherwise returns only a fully validated record. `readActivation(activationId)` and `readRecoveryAttempt(recoveryAttemptId)` scan the same one store, open candidate drafts through P029 and require one matching encrypted identity; they add no index or plaintext lookup record. Malformed, duplicate, plaintext-bearing and unsupported-version records fail closed without repair, weakening or automatic deletion.

P041 recovery begins with the separate strict record kind `pocket.sync.recovery-staging`. It is keyed by the opaque Pocket ID but cannot pass ordinary-device validation because it has no device envelope or content before the master key is recovered. It contains exactly the device key and one encrypted draft. `createRecoveryStaging` is insert-only, `replaceRecoveryStaging` is compare-and-swap, and `promoteRecoveryStaging` atomically replaces it with one fully valid ordinary device record. No plaintext marker, second store or fallback storage is used.

## 6. Remote and usage invariants

With no pending write, content revision equals confirmed remote revision and conflict is null. With pending state, expected revision equals confirmed revision, content revision is exactly confirmed plus one, and pending metadata plus `content.record` must form a valid P028 conditional-write request. A conflict requires that pending operation and a newer actual remote revision.

Per-long-lived-key encryption counters are durable and conservative: `masterKeyContentEncryptions` counts Pocket-content encryptions with that master key and may reset only when `masterKeyGeneration` increases. `deviceWrappingKeyEncryptions` counts direct device-envelope plus encrypted activation/recovery-draft seals with that device key and can never decrease across an ordinary record replacement, independently of master-key generation. Before using an already durable long-lived key, the caller atomically reserves the complete required counter increment on the existing record. A reservation leaves `storeRevision`, every ciphertext, authenticated context and logical state unchanged, but is protected by exact revision and usage compare-and-swap. It commits before AES-GCM runs and is never refunded, so a crash may over-count use but cannot under-count a key that remains available. Recovery reserves two uses before creating the device envelope and its following encrypted draft. Each counter must remain below P029's operational ceiling. Schema 4 explicitly migrates the old aggregates without reducing them; where the former split cannot prove a precise allocation, it retains the complete legacy envelope count against the device key. These local counters cannot prove the global total across every device; a later remote/account rotation policy must enforce the whole-account ceiling.

`storeRevision` represents logical encrypted-state revision, not byte-for-byte identity of every security field. An owner may refresh an equal-revision record only when all logical fields, authenticated contexts, envelope and drafts are unchanged, the same master generation remains cryptographically compatible with the device envelope, and one or both durable usage counters increased. Any other equal-revision difference fails closed; a committed reservation remains spent even if the following encryption or logical persistence fails.

## 7. Versions and migrations

Database version 1 remains unchanged. Record schema version 4 is current. The registered migrations are `1-to-2-encrypted-activation-draft`, `2-to-3-encrypted-recovery-draft` and `3-to-4-per-long-lived-key-usage`. Each validates the complete prior record and adds only its reviewed encrypted-draft or usage fields. Neither resets, rewrites or weakens existing content. Unknown higher versions and lower versions without an explicit version-by-version migration fail closed.

Every P039 stage update first reserves its device-key use without advancing `storeRevision`, then re-encrypts the complete draft and replaces the whole record through the existing compare-and-swap transaction. Remote success is not advanced in the draft until that replacement commits. A stale local writer therefore cannot move activation backwards or overwrite a newer confirmed stage, including by erasing a committed usage reservation.

Future migration must be explicitly reviewed and transactionally atomic. P030 performs no destructive reset, `deleteDatabase`, start-fresh fallback, timestamp-based migration or automatic removal of malformed data.

## 8. Durability and ownership limits

IndexedDB transaction completion means the browser accepted the durable write. Browser/site-data clearing or storage eviction can still remove it. P030 does not call `navigator.storage.persist()`; persistence-policy UX is deferred until activation integration. The encrypted remote record and the human-held recovery copy remain essential recovery routes.

This record is the encrypted durable device representation of a future Synced Pocket owner, not another human-visible truth file. It does not write or retain the former JSON/Vault handle, store an independently editable plaintext tree or change existing browser safety recovery.

## 9. Replaceable platform boundary and remaining work

The state machine uses a narrow injected transaction driver. A future desktop or native shell may replace the IndexedDB driver while preserving this exact record, validation, insert-only creation, transaction-completion and compare-and-swap contract. P030 does not add a shell.

P039/P040 supply activation/adoption staging, P041 supplies emergency recovery through injected seams, and P045 loads their browser foundations inertly. Still unimplemented are visible Sync UI, transfer UI, whole-account usage enforcement/key rotation, conflict UX, synced-owner browser recovery, storage-persistence UX and all production loading. P049's local HTTPS composition does not change that boundary.
