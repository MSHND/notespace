# Synced Pocket key-envelope and recovery service core

## 1. Status and relationship

P036 extends the dormant, undeployed `sync-service/pocket-sync-service-core.js` state machine created by P034 and hardened by P035. It makes the P028/P029 envelope and emergency-recovery model enforceable at the service boundary without enabling sync or changing current JSON/Vault ownership.

P028 defines account/content-key separation, envelope kinds and mandatory recovery. P029 defines the exact AES-GCM envelope and HKDF metadata. P030 keeps the device envelope in encrypted local device state. P031 keeps WebAuthn PRF output local. P034 supplies strict transactions, accounts, credentials, sessions and Pocket ownership. P036 adds only the encrypted-envelope and recovery records and operations needed behind those boundaries.

The service never receives a Pocket master key, device wrapping key, WebAuthn PRF output, raw recovery root or complete recovery package. It stores opaque encrypted master-key envelopes and a purpose-specific derived recovery verifier. Successful account or recovery authentication still does not mean content is unlocked.

## 2. Service method and collection surface

The existing frozen module export remains exactly `POLICY`, `COLLECTIONS` and `createServiceCore`. The created core now has fifteen methods: the seven P034 account/content methods plus `listEnvelopes`, `downloadEnvelope`, `addEnvelope`, `revokeEnvelope`, `initialiseRecovery`, `beginRecovery`, `finishRecovery` and `rotateRecovery`.

Five strict collections are added to the existing six:

- `keySets` owns one versioned envelope/recovery state per synced Pocket;
- `envelopes` owns active encrypted envelopes and metadata-only revoked tombstones;
- `recoveryLocators` maps one opaque server-generated locator to the active recovery version;
- `recoveryCeremonies` binds one proof and replacement-passkey ceremony; and
- `keyOperations` stores immutable committed/conflict results for mutation replay.

There is no envelope history, recovery-root record, proof log, queue, cleanup task or administrative bypass.

## 3. Key sets and envelopes

A key set is owned by the same account as the corresponding Pocket. Its positive `keySetVersion` is the compare-and-swap authority. Absence means version zero. Every successful envelope or recovery mutation advances exactly once; conflicts do not change envelopes or the key set.

Envelope records use the exact P029 `pocket.sync.master-key-envelope.opaque` version-1 AES-GCM shape: a canonical 12-byte nonce and exactly 48 decoded ciphertext bytes. Kind metadata is strict:

- `device` binds an opaque device ID and uses `kdf: none`;
- `passkey-prf` binds an active credential owned by the account and uses HKDF-SHA-256;
- `device-transfer` uses HKDF-SHA-256 without a device or credential target; and
- `recovery` uses HKDF-SHA-256 and can be created only by recovery setup/rotation.

Listing returns deterministic metadata only. Download returns ciphertext only for an active listed envelope. Generic add/revoke cannot mutate a recovery envelope.

Revocation replaces an active envelope with a tombstone in the same transaction that advances the key set. The tombstone retains identifying metadata but has `encryptedEnvelopeSize: 0`, `encryptedEnvelope: null` and a revocation time. Pocket content ciphertext is not re-encrypted by ordinary envelope revocation.

## 4. Key-operation idempotency

Every mutation carries an operation ID, logical-change ID, attempt kind and expected key-set version. Canonical SHA-256 digests cover account/Pocket identity, operation kind, expected version and every logical request field, including encrypted-envelope and verifier fields. Only `attemptKind` is excluded.

An exact explicit idempotent retry returns the stored outcome. A first-seen idempotent retry may execute. Reusing an operation as a new change, or changing any covered field, fails closed. Conflict outcomes are durable and replay the original versions rather than recalculating against later state. Operation records contain digests and safe outcomes, never envelope ciphertext, proofs or verifier material.

## 5. Initial recovery setup

`initialiseRecovery` requires an authenticated account session, the owned Pocket, an unconfigured recovery state, matching key-set version, an exact Ed25519 SPKI public verifier and an exact version-1 recovery envelope. The service creates one fresh 32-byte opaque account locator.

One transaction inserts the envelope and locator, installs the verifier, moves the key set to `ready`, advances its version and stores the immutable operation result. Exact replay returns the same locator. A failed transaction leaves recovery wholly unconfigured.

The client creates a fresh Ed25519 keypair and recovery wrapping key locally. It sends only the public verifier; its version-2 recovery package keeps the PKCS8 private signing material with the recovery root.

## 6. Recovery proof boundary

The factory requires an exact one-method `recoveryProofVerifier`. Its production Ed25519 verifier receives the stored public verifier, bound Pocket/device/operation/ceremony identities, challenge, recovery/key-set versions, expiry, exact credential digest and submitted signature. It imports the SPKI key for `verify` only and receives no envelope, Pocket ciphertext, master key, PRF output, recovery root or private key. False, malformed or thrown adapter results become the stable non-secret `service-recovery-proof-failed`. The verifier is called once outside the write transaction. Every relevant record and version is re-read before commit.

## 7. Begin and finish recovery

`beginRecovery` is unauthenticated and requires an active opaque locator. Unknown and revoked locators use the same display-safe unavailable error. The core loads and cross-checks account, Pocket, key set, locator, active recovery envelope and verifier, then stores one pending ceremony with a fresh challenge and P031-compatible replacement-passkey registration options.

The response exposes the recovery and key-set versions but not the stored verifier value or recovery envelope. Exact pending replay returns the same challenge/options. No credential or session is created by begin.

`finishRecovery` requires the bound ceremony/device/version, verifies the recovery proof, then verifies a new passkey registration. One transaction creates the credential, appends it to the account, creates a normal account session, advances the key set to `rotation-required` and completes the ceremony. The response returns the still-active recovery envelope so the client can unwrap locally. It makes no content-unlocked claim.

An exact finish replay before rotation returns the same credential, still-valid session and recovery envelope. It creates nothing twice. Changed replay fails. P041 durably stages the exact safe finish continuation before dispatch, so network ambiguity resumes without another proof derivation, passkey, credential or session. Once consumed, that recovery version cannot begin a second ceremony.

## 8. Rotation-required and atomic rotation

Recovery is not complete when the new credential/session is created. The key set records the recovery operation and credential and remains `rotation-required`. Only an active session authenticated with that recovered credential may make the initial rotation or receive a stored idempotent rotation replay.

After rotation, the ready key set deliberately clears its consumed recovery-operation and recovery-credential fields. The completed recovery ceremony remains the durable authority binding the recovery operation, account, Pocket and recovered credential. `rotateRecovery` checks that ceremony and credential before it inspects a stored key-operation result, so another credential on the same account cannot receive the replacement locator.

`rotateRecovery` requires matching operation, key-set and recovery versions, a fresh Ed25519 public verifier, next-version recovery envelope and fresh envelope ID. One transaction:

- inserts the new active envelope and locator;
- replaces the old envelope with a ciphertext-free tombstone;
- revokes the old locator;
- replaces the active verifier;
- advances recovery and key-set versions;
- clears the consumed recovery operation/credential; and
- returns to `ready` with one replayable operation result.

A conflict or failed commit retains the prior complete recovery path. A successful rotation rejects the old locator, removes the old verifier from active state and removes old recovery-envelope ciphertext from service state. Already exfiltrated ciphertext cannot be remotely recalled, which remains an unavoidable limitation.

P041 adds the recovered device envelope before rotation and supplies the post-addition key-set version. The response says a replacement recovery copy is required. P041 builds and writes it locally only after the new locator exists; the service does not generate that package or claim that the human saved it.

## 9. Recovery package boundary

The version-2 recovery package stays local-only. It contains opaque locator and Pocket ID, recovery-root material, PKCS8 recovery-signing private material, entropy declaration, checksum and human instructions. It is never an accepted service request and contains no Pocket Notes, account session or passkey private material.

P036 selects no file extension, QR encoding, word list, printing layout or storage recommendation.

## 10. Transaction and confidentiality guarantees

All multi-record changes use the existing injected transaction interface. Deterministic tests inject failures before reads, before staging, before commit and during commit. They also share one store across core instances to prove same-version mutations and recovery finishes cannot create duplicate state.

Malformed stored records or relationships fail closed without repair, deletion or reset. Only Pocket records contain content ciphertext. Only active envelope records contain master-key-envelope ciphertext. Revoked envelopes, ceremonies and operation records contain none.

## 11. Deferred work

P038 supplies the unloaded exact browser communication boundary and P041 supplies dormant local envelope opening, recovery-package replacement and encrypted recovery staging through the existing service methods. P041 stops at `ready-for-adoption` and keeps roots, master keys and PRF output local.

P050 composes the real native-WebCrypto Ed25519 recovery-proof verifier into the local server configuration. The service remains undeployed; P042's one synced-owner/Save controller, public deployment, abuse controls and operational rollback policy remain separate work.
