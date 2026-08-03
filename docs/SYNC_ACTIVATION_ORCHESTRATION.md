# Synced Pocket activation orchestration

## Status

P039 adds one dormant browser module, `js/pocket-sync-activation.js`. It is not loaded by `index.html`, cached by `sw.js`, connected to current Pocket ownership, or called by Main Save or PE Save. It selects no service origin and adds no UI.

The module is the concrete local conductor for the reviewed P027–P038 foundations. It does not replace their cryptography, device storage, passkey validation, transport validation or service state machines.

## Public boundary

`window.PocketSyncActivation` exposes exactly:

- `POLICY`;
- `createActivationOrchestrator(configuration)`.

The created orchestrator exposes only asynchronous `activate()` and `resume()` methods. Configuration injects the real P028 security contract, P029 crypto module, P030 device store, P031 account client, P038 content/envelope/recovery services, randomness and clock. Per-call dependencies inject current-source capture and validation, existing local Save, payload freezing, recovery-copy mechanics and final owner adoption.

No operation runs at module load.

## Source owner and frozen payload

Activation accepts only a current JSON or Vault owner. The captured session must supply an opaque continuity value that contains no handle, path or filename. P039:

1. captures the source;
2. verifies that exact session;
3. uses the existing local Save boundary once when dirty;
4. verifies the same session again;
5. freezes one readable payload once;
6. rechecks the session after asynchronous boundaries and immediately before adoption.

The readable payload is passed only to P029 content sealing. It is never stored in the device record or sent remotely. Resume captures the currently active source again and requires its owner kind and continuity value to match the encrypted draft. A different JSON file or Vault cannot inherit a staged activation.

## Recovery-copy decision before remote work

Fresh activation asks for an opaque recovery-copy destination before generating local key material, starting WebAuthn or mutating remote state. Deferral or cancellation stops with the JSON/Vault owner intact and creates no device or remote record.

The destination capability stays in memory only. It is never persisted or uploaded.

## Local cryptography

P039 uses P029 directly:

- one non-extractable random AES-GCM-256 Pocket master key;
- one non-extractable device wrapping key;
- one 256-bit recovery root;
- one exact revision-1 encrypted content record;
- one device master-key envelope;
- one purpose-separated recovery master-key envelope;
- one purpose-separated recovery-authorisation verifier;
- one optional passkey-PRF envelope when the actual registration ceremony supplies valid PRF output.

The recovery wrapping key uses `pocket.sync.recovery.master-key-wrapping.v1`. The verifier uses `pocket.sync.recovery.account-authorisation.v1` through P029's focused verifier derivation. The verifier and envelope use independent salts.

P039 never exports the master key, uploads PRF output, or uploads the recovery root. Temporary byte arrays are cleared on a best-effort basis without claiming perfect JavaScript zeroisation.

## Encrypted activation draft

P030 record schema version 2 adds one optional `activationDraft` field. The draft is an ordinary P029 opaque encrypted record sealed with the non-extractable device wrapping key. Its AAD binds the Pocket identity and current device-store revision.

Schema-1 P030 records migrate non-destructively to schema 2 with a null draft. The IndexedDB database version, one `pockets` object store, `syncedPocketId` key path and no-index rule do not change.

The encrypted draft retains only what explicit resume needs:

- activation, Pocket and device identities;
- source owner kind and non-handle continuity value;
- stable remote operation and logical-change IDs;
- encrypted content and envelope records;
- confirmed remote, key-set and recovery versions;
- safe account and credential identities;
- a P031-safe registration continuation after credential creation;
- recovery locator after initialisation;
- recovery root and local package only until copy storage is confirmed;
- stage, pending operation and diagnostic timestamps.

It does not contain a source handle/path/filename, readable Pocket payload, raw master key, raw PRF output, cookie, bearer token, Vault password, current owner token or browser-safety data. Raw device-store inspection sees ciphertext, not the root or package.

`readActivation(activationId)` scans the existing one store without adding an index, opens encrypted drafts through P029 and fails if malformed state or duplicate activation identity is found.

## Monotonic stages

The state machine distinguishes:

1. `source-ready`;
2. `local-material-ready`;
3. `device-staged`;
4. `account-registered`;
5. `content-committed`;
6. `device-envelope-committed`;
7. `prf-envelope-committed` or `prf-envelope-skipped`;
8. `recovery-initialised`;
9. `recovery-copy-pending`;
10. `ready-for-adoption`;
11. `adopted`.

The first persisted draft is `device-staged`. Earlier stages occur before a device record exists. Persisted stages never move backwards. Every transition uses P030 compare-and-swap and becomes visible only after commit. Impossible stage/version/secret combinations fail closed and are not repaired or reset.

## Registration and client-only PRF handling

P031 now provides a narrow safe continuation for activation. Its existing one-shot `registerPasskey()` remains compatible. When P039 supplies a credential-ready callback, P031 passes:

- the server-safe registration credential and ceremony continuity;
- client-only PRF output, when present.

P039 converts valid PRF output immediately into a P029 envelope, persists only the envelope and safe continuation, then clears the bytes. If remote finish is ambiguous, explicit resume calls P031 `finishRegistration()` with that safe continuation and does not invoke passkey creation again.

When PRF output is unavailable, activation records `prf-envelope-skipped`. Device and recovery envelopes remain mandatory, so optional PRF support does not weaken recovery readiness.

## Remote order and ambiguity

After encrypted device staging and account registration, P039 calls P038 in this order:

1. conditional content upload at expected revision 0;
2. device-envelope addition at key-set version 0;
3. optional PRF-envelope addition at the returned key-set version, or explicit skip;
4. recovery initialisation at the current returned key-set version.

Each mutation has stable operation and logical-change IDs generated once before first use. P039 persists the pending operation before dispatch and persists confirmed success before starting the next mutation.

There is no automatic retry. An ambiguous result returns a resumable outcome. Explicit `resume()` sends the exact request with `attemptKind: "idempotent-retry"`. Confirmed stages are not repeated. A 409 conflict is durable, stops activation and never adopts an owner.

## Mandatory recovery copy

Recovery initialisation installs version-1 verifier/envelope state and returns a service-generated opaque locator. Only then does P039 ask the injected package builder to construct a P028-valid local-only package from the locator, Pocket ID and persisted encrypted root.

The exact validated package is encrypted into the draft before the writer is called. A cancelled or failed write leaves `recovery-copy-pending`, retains the same encrypted root/package/locator/envelopes/IDs and returns a safe explicit-resume result. Resume requests a fresh destination capability but writes the exact same package and performs no confirmed remote mutation again.

After confirmed copy storage, P039 replaces the draft with `ready-for-adoption` and removes the recovery root, complete package and registration continuation. The final decrypted state retains only safe identities, encrypted records and confirmed versions.

## Owner adoption last

P039 validates the P028 activation gates in explicit pre-adoption mode, rechecks the source session and injects exactly this owner:

```json
{
  "ownerKind": "synced",
  "activationId": "<opaque>",
  "syncedPocketId": "<opaque>",
  "deviceId": "<opaque>",
  "confirmedRemoteRevision": 1,
  "syncPending": false
}
```

The adapter must be idempotent for an activation ID. If adoption fails, the source remains active and the ready encrypted draft survives. Resume then performs only the adoption attempt. A completed local replay returns success without another remote call, recovery-copy write or owner transition.

## Deliberately absent

P039 adds no UI, live synced owner, Save branch, HTTP/cookie adapter, selected origin, database, provider, deployment, dependency, service-worker entry, timer, worker, polling or background retry.

## P040 boundary

P040 should add dormant emergency-recovery orchestration for a new device: local recovery-package intake, begin/finish recovery, proof derivation through a reviewed adapter, local recovery-envelope opening, content validation, replacement root/verifier/envelope creation, atomic remote rotation, replacement-copy confirmation and new-device state persistence. It must remain separate from production loading and owner integration.
