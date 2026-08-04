# Synced Pocket emergency-recovery orchestration

## 1. Status and boundary

P041 adds one dormant browser orchestrator, `window.PocketSyncEmergencyRecovery`, for recovering an existing Synced Pocket onto an empty or detached device. It joins the reviewed P028-P040 contracts and stops at a durable `ready-for-adoption` device record. It is absent from `index.html`, `sw.js` and current production loaders. It does not add UI, adopt an owner, change Main Save or PE Save, or implement a recovery-proof algorithm.

The frozen public surface is exactly:

- `POLICY`;
- `createRecoveryOrchestrator(configuration)`.

The created orchestrator exposes exactly asynchronous `recover(dependencies, options)` and `resume(dependencies, options)` methods.

## 2. Recovery authority and target

The human supplies the existing P028 local-only recovery package. P041 validates the exact package through `PocketSyncSecurityContract`, including version 1, local-only flags, the opaque account locator and Pocket ID, the 256-bit canonical recovery root, checksum and approved instructions. The complete package is never sent to any remote service or returned in a result.

Recovery may start only while the captured target owner kind is `none` or `detached`. JSON, Vault and synced owners are rejected before package reading, key generation, storage, WebAuthn or remote access. The orchestrator preserves an opaque target-continuity value and rechecks the exact captured target after asynchronous boundaries. A changed target stops work and leaves any encrypted staged state available only for explicit resume against the restored original continuity.

Before staging or remote work, P041 asks the injected destination boundary for explicit permission to store the replacement recovery copy. The opaque destination capability remains in memory and is neither persisted nor uploaded. Cancellation or deferral therefore starts no recovery ceremony.

## 3. Encrypted device-first staging

P041 extends the existing P030 database and object store with a strict `pocket.sync.recovery-staging` record kind. It creates no second database or object store. The record contains only the opaque Pocket/device identity, a non-extractable device wrapping key and one P029-encrypted recovery draft. Every draft transition re-encrypts the complete draft and replaces the record through P030 compare-and-swap.

The first staged draft is committed before `beginRecovery`. Stable recovery, read, download, envelope and rotation identifiers are generated exactly once and encrypted before first use. Pending remote dispatch is persisted before the one network call. Confirmed results are persisted before the next step. There is no automatic retry.

The encrypted draft may temporarily contain the old package/root, exact proof and server-safe credential continuation, encrypted content, device envelope, replacement root/verifier/envelope, locator and replacement package. It never contains a readable Pocket payload, authenticator-native object, raw PRF output, session cookie, source handle or destination capability.

P030 record schema 3 adds nullable encrypted `recoveryDraft` to an ordinary device record. Schema-1 and schema-2 records migrate non-destructively to schema 3 with that field null. Recovery staging and activation drafts coexist in the same store without pretending an incomplete recovery is an ordinary valid device state.

## 4. Begin, proof and passkey

P041 sends the exact P038 `beginRecovery` request using the stored operation ID, package locator and new device ID. The validated response supplies a short-lived challenge, public recovery-authorisation metadata, the account's stable PRF evaluation input and P031-valid passkey registration options. It contains no stored verifier or recovery envelope.

The recovery proof is derived only by the injected exact one-method `recoveryProofDeriver`. P041 selects no proof construction. The adapter receives root bytes and the minimum bound public ceremony values and returns only the exact opaque P036/P038 proof shape.

The new passkey is created through an injected adapter backed by P031's browser WebAuthn boundary and serialised through P031's production registration serialiser. Only the server-safe credential enters the encrypted continuation. Any PRF output is transiently inspected by P031, cleared on a best-effort basis and neither persisted nor uploaded. P041 deliberately creates no passkey-PRF envelope.

The exact proof and safe credential request are durably staged before `finishRecovery`. If the response is ambiguous, explicit resume sends that exact finish request. It does not derive another proof or create another passkey. The P036/P037 service replay creates only one credential and one recovered session.

## 5. Local content recovery

After finish succeeds, P041 derives the old recovery wrapping key locally from the encrypted old root and the returned recovery-envelope context. P029 authenticates and opens the 48-byte master-key envelope and imports the master key as non-extractable. A wrong root or substituted Pocket, envelope, kind or version fails AES-GCM authentication.

P041 then reads the current remote revision and downloads that exact encrypted content revision through P038. It reconstructs the P029 content context from the correlated Pocket ID and revision, authenticates and decrypts locally, and passes the readable payload to the injected Pocket-domain validator. The payload is immediately released after validation. It is not returned or persisted in the draft.

If the revision changes, encrypted content is malformed, authentication fails or the readable payload is structurally invalid, recovery stops before envelope addition or rotation.

## 6. New device envelope and recovery rotation

The device wrapping key was generated before initial staging. Once the master key is open, P029 wraps it once for a new version-1 `device` envelope with the new device ID, `kdf: none` and no credential target. The encrypted draft is committed before P038 `addEnvelope`. Ambiguous addition is replayed only after explicit resume with the same operation, logical-change ID and envelope and `attemptKind: idempotent-retry`. A key-set conflict stops before recovery rotation.

P041 then creates one fresh, distinct 256-bit replacement recovery root. P029 independently creates:

- the next-version recovery-authorisation verifier; and
- the next-version recovery master-key envelope.

They use independent salts and the existing distinct account-authorisation and master-key-wrapping domains. P029's verifier helper now accepts an explicit positive version while retaining version 1 as its default for P039.

P038 `rotateRecovery` uses the credential-bound completed recovery operation, the key-set version after device-envelope addition, the old recovery version and stable rotation identities. Exact explicit replay reuses all material. A committed rotation installs a new locator/verifier/envelope and atomically revokes the old locator and erases the old recovery-envelope ciphertext. A conflict does not claim readiness or build a replacement package.

## 7. Replacement recovery copy

Only after rotation commits does P041 build the new P028 package from the returned locator and encrypted replacement root. It calls the prepared local destination boundary and requires explicit write success.

If writing fails, recovery remains not ready. The exact new package/root/locator stay only inside the encrypted draft and `resume` asks for a fresh in-memory destination capability. It performs no remote calls and writes the same package. The old package is already invalid after successful rotation, so this pause is deliberately visible to the caller.

## 8. Final state and cleanup

After replacement-copy confirmation, P030 atomically promotes the staging record into one ordinary schema-3 device record containing:

- the new non-extractable device key and device envelope;
- the authenticated encrypted current content and confirmed revision;
- no pending content operation or conflict;
- coherent encryption-use counters; and
- one encrypted safe recovery draft at `ready-for-adoption`.

The safe final draft retains only opaque attempt/Pocket/device/account/credential identity, confirmed content/key-set/recovery versions, timestamps and replacement-copy confirmation. It removes all roots, packages, locators, proof, challenge/begin/finish continuations, PRF output, transient key material, downloaded content duplicate and recovery-envelope ciphertext.

`resume` of that final attempt returns the same deeply frozen safe result without target capture, remote work, proof derivation, WebAuthn, copy writing, cryptographic mutation or device-store writing.

## 9. No adoption and no background behaviour

Success means locally durable and remotely rotated, not live ownership:

```json
{
  "ok": true,
  "reason": "recovery-ready",
  "adopted": false,
  "readyForAdoption": true,
  "locallyDurable": true,
  "remotelyCommitted": true,
  "replacementRecoveryCopyStored": true,
  "syncPending": false
}
```

The result includes safe revisions and the opaque recovery-attempt ID, but no root, package, locator, proof, credential response, key or ciphertext. P041 adds no timer, polling, worker, retry loop, storage fallback, cookie handling, logging or owner adapter.

## 10. P042 boundary

P042 should build one dormant synced-owner and explicit Save controller able to adopt either a P039/P040 activation-ready record or a P041 recovery-ready record. It should preserve one owner/session authority and one device-first explicit Save path. UI, production loading, HTTP/database deployment and the reviewed recovery-proof adapter remain separate gates.
