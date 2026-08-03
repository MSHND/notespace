# Synced Pocket remote API contract

## 1. Status and conventions

This is the version 1 conceptual contract for a future Pocket-owned, provider-neutral remote adapter. Pocket owns the product account relationship and policy; no underlying service is exposed for human configuration. This document defines operation shapes and invariants, not URLs, transport bindings, hosting, databases, identity vendors or infrastructure. P031 implements the unloaded strict client-side passkey ceremony boundary for the four begin/finish account operations; it supplies no transport and makes no request at module load.

Every request and response carries `apiVersion: 1`. Identifiers are opaque, unguessable strings. Authenticated account context is transport/session state and is never inferred from a filename. Product v1 permits one ordinary synced Pocket, but requests still carry `syncedPocketId`.

Unknown fields fail validation. Remote records may contain public WebAuthn ceremony material, opaque identifiers, authenticated ciphertext and minimal operational metadata only. They may not contain readable Pocket content, filenames/paths, local handles, raw content keys, raw PRF results, raw recovery roots or complete recovery packages.

## 2. Common result forms

Successful operations use:

```json
{
  "apiVersion": 1,
  "ok": true,
  "operationId": "opaque-operation-id"
}
```

Rejected operations use a stable machine reason and calm display-safe status. They never echo secrets or submitted ciphertext:

```json
{
  "apiVersion": 1,
  "ok": false,
  "operationId": "opaque-operation-id",
  "reason": "stable-reason",
  "retryable": false
}
```

Challenges, authorisations and pairing records have explicit expiries, are bound to their operation/purpose and are single-use where specified. Servers validate account, credential, device, synced Pocket and version relationships on every operation rather than trusting client-supplied association.

## 3. Passkey registration

### Begin registration

Request:

```json
{
  "apiVersion": 1,
  "operationId": "opaque-operation-id",
  "accountIntent": "create-or-add-credential",
  "deviceId": "opaque-device-id"
}
```

Response:

```json
{
  "apiVersion": 1,
  "ok": true,
  "operationId": "opaque-operation-id",
  "ceremonyId": "opaque-ceremony-id",
  "expiresAt": "timestamp",
  "prfEvaluationInput": "canonical-unpadded-base64url-encoding-32-public-random-bytes",
  "publicKeyCreationOptions": "standards-shaped-public-options"
}
```

### Finish registration

Request contains `apiVersion`, `operationId`, `ceremonyId`, `deviceId` and the public credential creation response required for server-side WebAuthn verification. Client-only PRF `results` must be removed before serialisation. The service validates challenge, origin, relying-party scope, user presence/verification, credential uniqueness and expiry.

Response contains the matching `operationId`, `ceremonyId` and `prfEvaluationInput`, plus opaque `accountId` and `credentialId`, positive `credentialVersion` and positive `accountPolicyVersion`. It contains no private key, PRF output, content key or recovery material.

## 4. Passkey authentication

### Begin authentication

Request contains `apiVersion`, `operationId` and an optional opaque account locator. Response contains the matching operation ID, `ceremonyId`, expiry, one canonical 32-byte public PRF evaluation input and standards-shaped public credential request options.

### Finish authentication

Request contains `apiVersion`, `operationId`, `ceremonyId` and the public assertion response. Client-only PRF `results` are not included. The service validates the challenge, origin, relying-party scope, signature, user verification requirements, credential/account relationship and expiry.

Response repeats the bound operation, ceremony, credential and PRF-input identities, establishes account authorisation and returns only opaque account/credential references and policy versions. Authentication success does not assert that content is unlocked. P031 reports `accountAuthenticated: true` and `contentUnlocked: false`; later orchestration must independently open an approved content-key envelope.

## 5. Credential management

### List credentials

Authenticated request: `apiVersion`, `operationId`.

Response items: `credentialId`, `credentialVersion`, `createdAt`, `lastUsedAt`, `revokedAt`, authenticator attachment/backup display metadata where deliberately retained, and a human-supplied credential label if a later reviewed UI allows one. No authenticator private material or PRF result is stored.

### Revoke credential

Authenticated request: `apiVersion`, `operationId`, `credentialId`, `expectedCredentialVersion`, and a fresh account-authorisation proof. Response returns the next credential version and revocation time.

Credential revocation and content-envelope revocation are separate operations. Removing a passkey does not silently destroy the last content-unlock/recovery path. Policies reject removal that would leave no approved account recovery path.

## 6. Remote revision and encrypted content

### Read revision

Authenticated request:

```json
{
  "apiVersion": 1,
  "operationId": "opaque-operation-id",
  "syncedPocketId": "opaque-pocket-id"
}
```

Response contains the current non-negative integer `revision`, encrypted-record format/version and encrypted byte size. Timestamps never decide the winner.

### Download encrypted record

Request contains `apiVersion`, `operationId`, `syncedPocketId` and optionally a requested `revision`. Response contains the exact opaque encrypted record for that revision:

```json
{
  "apiVersion": 1,
  "ok": true,
  "operationId": "opaque-operation-id",
  "syncedPocketId": "opaque-pocket-id",
  "revision": 8,
  "encryptedRecord": {
    "format": "pocket.sync.content.opaque",
    "version": 1,
    "algorithm": "AES-GCM-256",
    "nonce": "<canonical unpadded base64url: 12 bytes>",
    "ciphertext": "<canonical unpadded base64url: ciphertext plus 16-byte tag>"
  }
}
```

This five-field shape is exact. The service rejects unknown fields, a nonce that is not exactly 12 decoded bytes, ciphertext shorter than the 16-byte tag, padding/non-canonical base64url, or any algorithm/version other than `AES-GCM-256`/1. Revision and synced Pocket ID remain outside the record and are bound locally through P029 content AAD. The service treats the record as opaque and never asks the client to supply readable metadata for indexing.

### Conditional upload

Request:

```json
{
  "apiVersion": 1,
  "syncedPocketId": "opaque-pocket-id",
  "expectedRevision": 7,
  "operationId": "opaque-idempotency-id",
  "logicalChangeId": "opaque-logical-change-id",
  "attemptKind": "new-change",
  "encryptedRecord": {
    "format": "pocket.sync.content.opaque",
    "version": 1,
    "algorithm": "AES-GCM-256",
    "nonce": "<canonical unpadded base64url: 12 bytes>",
    "ciphertext": "<canonical unpadded base64url: ciphertext plus 16-byte tag>"
  }
}
```

The server atomically commits only if its current revision equals `expectedRevision`. Success advances exactly once:

```json
{
  "apiVersion": 1,
  "ok": true,
  "status": "committed",
  "wrote": true,
  "revision": 8,
  "operationId": "opaque-idempotency-id",
  "replayed": false
}
```

Conflict never writes and never masquerades as success:

```json
{
  "apiVersion": 1,
  "ok": false,
  "status": "conflict",
  "wrote": false,
  "conflict": true,
  "actualRevision": 9,
  "operationId": "opaque-idempotency-id"
}
```

The server records the result keyed by account, synced Pocket and `operationId`. Retrying the same exact logical operation uses the same operation ID, logical change ID, expected revision and encrypted record with `attemptKind: "idempotent-retry"`; it returns the original committed result with `replayed: true` and does not create another revision. A new logical content change uses a new operation ID and logical change ID. Reuse of an operation ID with different content or revision fails closed.

## 7. Key envelopes

### List permitted envelope metadata

Authenticated request contains `apiVersion`, `operationId` and `syncedPocketId`. The response contains the current envelope-set version and allowlisted items only: opaque envelope ID, kind, envelope version, opaque target device/credential ID where applicable, creation time and revocation time/state. It omits wrapping ciphertext unless a separately authorised unlock/download operation needs that exact envelope, and never returns raw wrapping material.

### Add envelope

Authenticated request contains:

- `apiVersion`, `operationId`, `syncedPocketId`;
- opaque `envelopeId`;
- kind exactly `device`, `passkey-prf`, `device-transfer` or `recovery`;
- envelope format/version and authenticated wrapping ciphertext;
- purpose-bound metadata such as opaque target device/credential ID when applicable; and
- expected envelope-set version.

The opaque envelope record has exact top-level fields `format`, `version`, `algorithm`, `nonce` and `ciphertext`: format `pocket.sync.master-key-envelope.opaque`, version 1, algorithm `AES-GCM-256`, a canonical 12-byte nonce and exactly 48 ciphertext bytes. The latter protects the 32-byte master key plus the 16-byte tag. Envelope ID, kind and version remain separate and are locally authenticated through P029 envelope AAD.

Envelope metadata uses strict allowlists. `device` requires an opaque `deviceId`, forbids `credentialId`, uses `kdf: none` and has no KDF salt/derivation version. `passkey-prf` requires an opaque `credentialId`, forbids `deviceId`, and uses `kdf: HKDF-SHA-256`, `derivationVersion: 1` and a canonical base64url salt decoding to exactly 32 bytes. `device-transfer` and `recovery` forbid both target identifiers and use those same HKDF fields. The service may store the public salt and credential binding; it must never receive raw derivation input, a wrapping key, PRF output, transfer secret, recovery root or master key.

The service validates account/Pocket ownership, kind, exact format/size, KDF metadata, uniqueness and expected version, then returns the next envelope-set version. It cannot unwrap the envelope. Exact cryptographic layouts are defined in [Synced Pocket cryptographic format](SYNC_CRYPTO_FORMAT.md).

### Revoke envelope

Authenticated request contains `apiVersion`, `operationId`, `syncedPocketId`, `envelopeId`, expected envelope-set version and a fresh authorisation suitable for that envelope kind. Response returns the next envelope-set version and revocation state.

Revocation must not silently remove the last recovery envelope or all unlock paths. Revoking an envelope does not rewrite the encrypted content record.

## 8. Emergency recovery

### Begin recovery

Unauthenticated request contains `apiVersion`, `operationId` and the opaque account locator from the local recovery package. Response supplies a short-lived `recoveryCeremonyId`, recovery-authorisation version, random challenge, derivation parameters/version and expiry. It never requests the raw recovery root or full package.

### Finish recovery

Request contains `apiVersion`, `operationId`, `recoveryCeremonyId`, a challenge-bound proof derived using `pocket.sync.recovery.account-authorisation.v1`, and a newly registered/re-authenticated account credential response as required by policy. The proof is distinct from the key derived with `pocket.sync.recovery.master-key-wrapping.v1`.

On valid proof the service authorises download of the existing encrypted recovery envelope to the client. The client unwraps locally. Recovery is not complete until a rotation request atomically installs:

- a new recovery-authorisation verifier and version;
- a new recovery master-key envelope/version; and
- invalidation of the preceding recovery-authorisation version.

The response requires `replacementCopyRequired: true`. Pocket must prompt for a new local recovery copy. An old recovery proof fails after successful rotation. Failed/partial rotation leaves the prior valid state intact and is not reported as recovered.

## 9. Additional-device pairing relay

Future pairing operations may create, approve, relay and consume a short-lived pairing record. Shapes carry version, random pairing ID, expiry, ephemeral public agreement keys, authenticated transcript/ciphertext, opaque device/Pocket IDs and single-use state only.

The service never receives the ephemeral private keys, derived transport key, master key or readable content. Approval requires an already trusted device plus explicit human action. Expired, rejected or consumed pairings cannot be reused. This is an architecture slot, not a production endpoint.

## 10. Account deletion

### Request deletion

Authenticated request contains `apiVersion`, `operationId`, a fresh account-authorisation proof and the current account-data version. Response creates a short-lived, single-use `deletionChallengeId` and returns a display-safe inventory count for credentials, devices, encrypted Pocket records and envelopes. It does not return content.

### Confirm deletion

Request contains `apiVersion`, `operationId`, `deletionChallengeId`, explicit confirmation and another current authorisation proof. The server atomically marks the account, credentials, encrypted records, envelopes, recovery verifier and pairing records deleted according to the documented retention policy, then invalidates active sessions.

Deletion confirmation is idempotent: replaying the same operation returns the original deletion result. Account deletion never deletes local JSON/Vault files, local recovery copies or device/browser data silently; later UI must explain and separately offer local cleanup.

## 11. Operational rules

- Authorisation, size, schema, revision, expiry and rate limits are checked server-side.
- Error details do not reveal whether arbitrary account locators, credentials, envelope IDs or Pocket IDs exist.
- Logs and metrics exclude ciphertext bodies, WebAuthn responses, recovery proofs and human content.
- Remote backups retain encrypted records only and follow the same deletion boundary.
- No response claims content authenticity until the client successfully performs authenticated decryption with the expected synced Pocket context.
- Availability failures preserve P027's locally durable pending encrypted record and require an explicit later Save; there is no hidden background retry in v1.
