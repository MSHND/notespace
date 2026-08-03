# Synced Pocket remote API contract

## 1. Status and conventions

This is the version 1 contract for a future Pocket-owned, provider-neutral remote service. Pocket owns the product account relationship and policy; no underlying service is exposed for human configuration. P032 implements the still-unloaded client transport and strict account/content adapters described here. P034 implements the corresponding dormant, undeployed server-side safety state machine for the seven locked routes. Neither selects an endpoint origin, hosting, database, identity vendor or infrastructure. P031 remains the strict client-side WebAuthn ceremony owner.

Every request and response carries `apiVersion: 1`. Identifiers are opaque, unguessable strings. Authenticated account context is transport/session state and is never inferred from a filename. Product v1 permits one ordinary synced Pocket, but requests still carry `syncedPocketId`.

Unknown fields fail validation. Remote records may contain public WebAuthn ceremony material, opaque identifiers, authenticated ciphertext and minimal operational metadata only. They may not contain readable Pocket content, filenames/paths, local handles, raw content keys, raw PRF results, raw recovery roots or complete recovery packages.

### P032 transport binding

The future service is reached beneath one caller-supplied same-origin absolute-path root. P032 accepts no full or scheme-relative URL and v1 has no cross-origin API. These locked suffixes are appended to that root:

- `/account/passkeys/registration/begin`
- `/account/passkeys/registration/finish`
- `/account/passkeys/authentication/begin`
- `/account/passkeys/authentication/finish`
- `/pockets/revision/read`
- `/pockets/content/download`
- `/pockets/content/conditional-upload`

All seven operations use POST-only JSON. Fetch uses same-origin mode/credentials, no-store caching, redirect rejection and no-referrer policy. Identifiers occur only in request bodies. Future authentication uses a browser-managed same-origin cookie; P032 neither sends nor persists a bearer token. P034 enforces an exact POST/Origin/Fetch-Metadata/content-type/session context, atomic session rotation, account/Pocket authorisation and durable conditional-write/idempotency state. A later HTTP adapter must map real headers and Secure/HttpOnly/SameSite cookies into that boundary and supply abuse controls.

Account/revision responses and their requests are limited to 262,144 UTF-8 bytes. Encrypted content download/upload JSON is limited to 16,777,216 UTF-8 bytes. P032 rejects declared or actually oversized responses, non-JSON/HTML bodies, redirects, malformed JSON and unexpected statuses. It never retries automatically.

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

Response repeats `apiVersion`, `operationId` and `syncedPocketId`, and then contains exactly the current non-negative integer `revision`, `recordPresent`, `contentFormat`, `contentVersion` and `encryptedRecordSize`. Empty state is revision 0, false, null, null and 0. Present state has a positive revision, true, `pocket.sync.content.opaque`, version 1 and a positive size. Timestamps never decide the winner.

### Download encrypted record

Request contains exactly `apiVersion`, `operationId`, `syncedPocketId` and a positive requested `revision`. Response repeats those values, supplies `encryptedRecordSize`, and contains the exact opaque encrypted record for that revision:

```json
{
  "apiVersion": 1,
  "ok": true,
  "operationId": "opaque-operation-id",
  "syncedPocketId": "opaque-pocket-id",
  "revision": 8,
  "encryptedRecordSize": 32,
  "encryptedRecord": {
    "format": "pocket.sync.content.opaque",
    "version": 1,
    "algorithm": "AES-GCM-256",
    "nonce": "<canonical unpadded base64url: 12 bytes>",
    "ciphertext": "<canonical unpadded base64url: ciphertext plus 16-byte tag>"
  }
}
```

The encrypted record's five-field shape is exact. `encryptedRecordSize` means decoded ciphertext bytes including the 16-byte authentication tag, excluding the nonce and JSON/base64url framing. The client and service reject unknown fields, a nonce that is not exactly 12 decoded bytes, ciphertext shorter than the tag, padding/non-canonical base64url, or any algorithm/version other than `AES-GCM-256`/1. Revision and synced Pocket ID remain outside the record and are bound locally through P029 content AAD. The service treats the record as opaque and never asks the client to supply readable metadata for indexing.

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

The server atomically commits only if its current revision equals `expectedRevision`. HTTP 200 is accepted only with the exact committed body and advances exactly once:

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

HTTP 409 is accepted only with the exact conflict body. Conflict never writes and never masquerades as success:

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

HTTP/body disagreement fails closed: a conflict body on 200 and a committed body on 409 are both invalid. The server records the result keyed by account, synced Pocket and `operationId`. Retrying the same exact logical operation uses the same operation ID, logical change ID, expected revision and encrypted record with `attemptKind: "idempotent-retry"`; it returns the original committed result with `replayed: true` and does not create another revision. A new logical content change uses a new operation ID and logical change ID. Reuse of an operation ID with different content or revision fails closed. If a network response is lost after a possible commit, P032 reports ambiguity as unavailable and does not guess or retry automatically.

### P034 service-core enforcement

`sync-service/pocket-sync-service-core.js` is the dormant CommonJS state machine behind these seven route shapes. It has no HTTP listener, cookie parser, database driver, real WebAuthn verifier, selected origin or deployment. Its exact request context must be produced by a later HTTP adapter before any request body, store or verifier work occurs.

For version 1, P035 requires the configured WebAuthn RP ID to equal the trusted-origin hostname exactly. An explicit origin port is excluded from the RP ID. The service core does not accept parent-domain scope or attempt public-suffix classification; broader WebAuthn scope remains a later deployment-policy decision.

The core persists six strict version-1 record types: account, credential, session, ceremony, Pocket and immutable operation result. All reads validate exact stored schemas. Registration/authentication completion rechecks ceremony, account, credential and prior-session versions after the injected verifier returns, then commits credential/account/session/ceremony changes atomically. Session rotation never revokes the old session without durably creating its replacement.

Content routes require an active unexpired account session and the exact account-to-Pocket relationship. First upload binds the account only in the same transaction that creates revision 1 and its immutable operation result. Later writes use one current encrypted record, safe revision compare-and-swap and a canonical SHA-256 logical-request digest. Exact explicit retries replay the stored committed or conflict outcome. A changed payload or `new-change` reuse under an existing operation ID fails closed. Conflict remains HTTP 409 and does not alter the Pocket.

See [Synced Pocket service safety core](SYNC_SERVICE_CORE.md) for the factory, transaction and record contracts. The seven client request/response bodies above are unchanged.

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
