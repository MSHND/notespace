# Synced Pocket service safety core

## 1. Status and boundary

P034 adds, and P036 extends, a dormant, undeployed server-side safety and persistence core at `sync-service/pocket-sync-service-core.js`. It is CommonJS Node code in the existing repository. It is not loaded by `index.html`, `sw.js` or any browser module, and it adds no HTTP server, cookie parser, WebAuthn implementation, database driver, deployment configuration, provider, host, origin, UI, owner or Save integration.

The core is the smallest deterministic state machine that can later sit behind P032's seven locked routes. It independently validates request context, relationships and opaque encrypted records before committing. It never accepts readable Pocket content or a content-unlock secret.

P034 follows the established sequence:

- P027 owns staged activation, device-first Save and explicit conflict behaviour;
- P028 owns strict remote metadata and account/content-key separation;
- P029 owns the exact encrypted content format;
- P030 owns the encrypted device record;
- P031 owns the browser passkey ceremony boundary;
- P032 owns the same-origin bounded client transport; and
- P033 owns the safe remote revision boundary.

None of these modules is production-loaded.

## 2. Production module surface

The frozen CommonJS export has exactly:

- `POLICY`, the reviewed version and conservative validation limits;
- `COLLECTIONS`, the eleven exact collection names; and
- `createServiceCore(configuration)`.

`createServiceCore()` returns exactly fifteen asynchronous methods:

- `beginRegistration(input)`;
- `finishRegistration(input)`;
- `beginAuthentication(input)`;
- `finishAuthentication(input)`;
- `readRevision(input)`;
- `downloadEncryptedRecord(input)`; and
- `conditionalUpload(input)`;
- `listEnvelopes(input)`;
- `downloadEnvelope(input)`;
- `addEnvelope(input)`;
- `revokeEnvelope(input)`;
- `initialiseRecovery(input)`;
- `beginRecovery(input)`;
- `finishRecovery(input)`; and
- `rotateRecovery(input)`.

There is no generic dispatcher, collection access, raw transaction access, cookie helper, cleanup task, migration command or administrative mutation API.

## 3. Exact factory configuration

The factory accepts exactly:

```js
{
  store,
  webAuthnVerifier,
  recoveryProofVerifier,
  randomBytes,
  now,
  trustedOrigin,
  rpId,
  rpName,
  credentialAlgorithms,
  ceremonyLifetimeMs,
  sessionLifetimeMs
}
```

Unknown or missing fields fail. `trustedOrigin` must be one canonical HTTPS origin with no path beyond `/`, query, fragment or credentials. In version 1, `rpId` must exactly equal that origin's canonical hostname. An explicit origin port is not part of the RP ID. WebAuthn can permit some registrable parent-domain RP IDs, but safely accepting them requires public-suffix-aware deployment policy. P035 deliberately does not add that complexity: parent-domain scope is unsupported and Pocket fails closed until a real deployment demonstrates a need for broader scope. The RP name is non-empty and bounded. Credential algorithms are a non-empty, duplicate-free array of safe integers. Ceremony lifetime is a positive safe integer no greater than ten minutes. Session lifetime is a positive safe integer no greater than ninety days.

The injected `randomBytes(count)` must return exactly that many bytes in a `Uint8Array`; all generated opaque IDs use 32 bytes encoded as canonical unpadded base64url. `now()` must return a finite millisecond timestamp. The core starts no timer and reads no environment, file, browser store, process argument or global configuration.

The injected verifier has exactly two Promise-returning methods:

- `verifyRegistration(input)`; and
- `verifyAuthentication(input)`.

Verifier results remain untrusted until the core validates every field and relationship.

P036 adds an exact one-method `recoveryProofVerifier`. It receives only bound public ceremony context, the stored derived recovery-authorisation verifier and the submitted opaque proof. It receives no recovery envelope, Pocket ciphertext, root, master key or PRF output. P036 deliberately supplies no production proof algorithm.

## 4. Request-security context

Every method receives exactly `{ context, body }`. Context is exactly:

```js
{
  method: "POST",
  origin: "https://configured.example",
  fetchSite: "same-origin",
  contentType: "application/json",
  sessionId: null
}
```

`contentType` may include a valid UTF-8 charset parameter. Method, exact Origin, Fetch Metadata, content type and nullable opaque session ID are checked before body handling, store access, randomness or verifier work. Missing or `null` origins, cross-site and same-site requests, GET, forms, unknown fields and bearer-token substitutes fail closed.

The core models the decision. A future adapter must map real HTTP headers and the secure browser-managed session cookie into this exact context.

Successful methods return exactly `{ status, body, session }`. Only successful passkey registration, authentication or recovery completion returns a session instruction. The core never emits a cookie header. Conflict is an exact normal result with status 409 and `session: null`; other failures throw stable, non-secret service errors.

## 5. Transactional store contract

The injected store has exactly one Promise-returning method:

```js
store.transact("readonly" | "readwrite", callback)
```

The callback receives exactly four Promise-returning methods:

```js
{
  get(collection, key),
  insert(collection, key, record),
  replace(collection, key, expectedStoreVersion, record),
  remove(collection, key, expectedStoreVersion)
}
```

The outer transaction resolves only after commit. Insert is insert-only. Replace and remove use store-version compare-and-swap. A readwrite adapter must stage every mutation and atomically commit all or none. Malformed stored records, unknown fields, duplicate insertion, stale store versions and commit failures fail closed. The core does not repair, delete or treat malformed state as absent.

P034 provides no production database. `tests/helpers/p034-memory-service-store.js` is a deterministic test-only driver with serial transactions, snapshot inspection and narrow failure injection before reads, before staging, before commit and during commit.

## 6. Persisted records

The exact frozen collections are `accounts`, `credentials`, `sessions`, `ceremonies`, `pockets`, `operations`, `keySets`, `envelopes`, `recoveryLocators`, `recoveryCeremonies` and `keyOperations`. Every record is a strict plain object with `schemaVersion: 1`, a positive safe `storeVersion`, matching collection identity and no unknown fields.

### Account

An account stores only its opaque ID, policy version, public 32-byte PRF evaluation input, duplicate-free active credential IDs, nullable one-Pocket binding and creation time. It contains no email, human name, filename, content, recovery root or content key.

### Credential

A credential stores its public WebAuthn key material, algorithm, counter, approved transports, backup flags, active status, account relationship and creation time. It contains no private authenticator material, raw PRF result or human label. Authentication may only advance verifier state; it cannot change identity or ownership.

### Session

A session stores opaque session/account/credential IDs, active or revoked status, creation and expiry, and nullable replacement ID. Content operations never extend expiry. Rotation creates the replacement and revokes the prior session in one transaction.

### Ceremony

A ceremony is keyed by operation ID and stores its registration/authentication type, generated ceremony ID and challenge, canonical request digest, account and prior-session relationship, public PRF input, expiry, exact begin body, and nullable finish digest/result. Pending ceremonies have no finish result. Completed ceremonies retain the exact committed result so an identical finish can replay without creating another credential or session.

### Pocket

A Pocket record stores only account/Pocket identity, current positive revision, decoded ciphertext size, the exact P028/P029 opaque encrypted record and creation time. Revision zero is represented by absence. There is one current encrypted record, no history, pending duplicate or readable metadata.

### Operation

An immutable operation record stores account/Pocket/operation/logical-change identity, expected revision, a SHA-256 logical-request digest and exact committed/conflict result. It never stores ciphertext. Composite keys use separately base64url-encoded identifier components.

### Key and recovery records

P036 adds one versioned key set per Pocket, active or ciphertext-free revoked envelope records, opaque recovery locators, single-use recovery ceremonies and immutable key-operation outcomes. Key-set compare-and-swap prevents stale envelope changes. Recovery moves through `unconfigured`, `ready` and `rotation-required`; new credential/session creation and later verifier/envelope/locator rotation each commit atomically. Full schemas and invariants are in `docs/SYNC_KEY_RECOVERY_SERVICE.md`.

## 7. Ceremony and verifier lifecycle

Registration begin creates only a pending ceremony. A new account remains provisional until finish. An exact pending-begin replay returns the stored challenge and options; a changed or completed operation cannot begin again. Options require resident credentials, user verification, no attestation, configured algorithms and one account-level PRF input.

Authentication begin resolves the account from either a valid current session or an explicit opaque account locator. Missing and unknown locators use the same non-enumerating error. Options allow only the account's active credentials and stable PRF input. Discoverable sign-in without an account locator remains deferred.

Finish reads and validates the ceremony, calls the injected verifier once outside a write transaction, validates the result, then re-reads every relevant record inside the commit transaction. Registration atomically creates the account when needed, credential, active session and completed ceremony. Authentication atomically advances permitted credential state, creates a replacement session, revokes the prior session where present and completes the ceremony.

Non-zero signature counters must advance. An unsupported zero counter may remain zero. Backup eligibility cannot be changed after registration. Credential/account substitution and stale ceremony, account, credential or session versions fail without partial state.

Successful account authentication returns only the exact P031 account result plus a session instruction. It creates no content key, PRF output, envelope or `contentUnlocked` claim.

## 8. Session creation and rotation

Session IDs use 32 random bytes. The response body never carries one. Instead, completion returns:

```js
{
  action: "set",
  sessionId,
  expiresAt,
  replaceSessionId
}
```

A future HTTP adapter must turn that instruction into a correctly scoped secure cookie. The new session and any prior-session revocation are one atomic transaction. A failed commit leaves the prior session active and creates no replacement. Sessions neither slide nor receive background cleanup.

## 9. Account and Pocket authorisation

Revision read, encrypted download and conditional upload require an active, unexpired session and a valid account/credential relationship. Invalid or expired supplied sessions request cookie clearing without exposing their IDs. An unbound account reports revision zero. Once bound, version 1 permits exactly one opaque synced Pocket ID, and another account cannot read or write it.

Download serves only the exact current revision. The service has no history lookup. All accepted content remains the strict five-field opaque encrypted record; decoded ciphertext size includes the authentication tag.

## 10. Conditional writes and idempotency

Conditional upload validates P032's exact server request independently. Expected revision must be non-negative, safe and strictly below `Number.MAX_SAFE_INTEGER`. The logical digest explicitly orders account ID, Pocket ID, expected revision, operation ID, logical-change ID and exact encrypted-record fields; only `attemptKind` is excluded.

One readwrite transaction authorises the session/account/Pocket, validates any existing operation and then:

- commits exactly expected revision plus one when actual equals expected;
- stores an immutable conflict result without changing the Pocket when actual is newer;
- fails as invalid state when actual is lower; and
- atomically binds a previously unbound account only with a revision-1 Pocket and committed operation.

An exact explicit `idempotent-retry` returns the stored committed or conflict result. A committed replay sets `replayed: true`. `new-change` reuse or any changed logical digest fails. A first-seen idempotent retry may execute because the original request might never have arrived. Concurrent transactions cannot both commit the same expected revision.

Network ambiguity remains P032's responsibility: the client does not guess or retry automatically, and a later explicit retry uses the same durable identity.

## 11. Error and confidentiality boundary

Stable errors contain only a code, safe HTTP status and narrowly applicable `retryable` or `clearSession` booleans. They contain no opaque IDs, challenges, credentials, keys, ciphertext, WebAuthn response, native error message or readable Pocket content. The core logs nothing.

Raw PRF output, master keys, recovery roots and device wrapping keys are rejected by strict request/verifier schemas. Only a Pocket record contains ciphertext, and no accepted record contains readable Pocket fields.

## 12. Deferred adapter and P037 boundary

Later adapter work must provide and review:

- a real HTTP adapter for the seven locked routes;
- exact header/body limits and context mapping;
- Secure, HttpOnly, SameSite cookie issuance/clearing and fixation protection;
- a standards-compliant WebAuthn verifier adapter;
- a real durable transaction implementation matching the exact store surface;
- rate limits and operational rollback/backup policy; and
- the unresolved no-locator account-discovery policy.

P037 owns local envelope/recovery orchestration, recovery-package creation and future transport extension. Later adapters must not weaken the P034-P036 state machine or exact-host RP-ID policy. Provider, runtime, database, deployment origin, production UI and current owner/Save integration remain unselected.

## 13. Validation status

The focused Node suite executes the actual production module and deterministic store, including strict context, exact schemas, P031/P032 response compatibility, replay, stale writer, concurrency and injected commit failures. No browser acceptance is required because the module is server-side, undeployed and not production-loaded.
