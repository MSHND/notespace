# Codex report

## POCKET TASK P034 - BUILD SYNC SERVICE SAFETY CORE

Title: Build sync service safety core

Status: P034 adds the dormant, undeployed CommonJS safety and persistence state machine behind P032's seven locked remote routes. The core validates exact same-origin request context, passkey ceremony/account/session relationships and opaque encrypted revisions independently of the browser client. It reports success only after one injected atomic transaction commits.

Commit title:

- `P034 Build sync service safety core`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `0cd030afb81f1e4c2867e0c1ad23bf197078ef98`
- Starting title: `P033 Harden remote revision boundary`
- Implementation date: 2026-08-03
- Branch: `main`
- Production boundary: `sync-service/pocket-sync-service-core.js` in the same repository.
- The CommonJS module is absent from `index.html`, `sw.js` and every browser production loader.

P034 adds no HTTP server, real WebAuthn verifier, production database, ORM, host, provider, domain/origin, cookie implementation, deployment file, UI, owner, Main Save/PE Save integration, service-worker change, dependency, npm script or background process. Current JSON/Vault behaviour and every loaded browser production path remain unchanged.

### Core, request and transaction design

- The frozen module exports exactly `POLICY`, `COLLECTIONS` and `createServiceCore`.
- The factory requires the exact injected store, two-method verifier, 32-byte randomness function, finite clock, canonical HTTPS trusted origin, RP identity/name, frozen credential algorithms and bounded ceremony/session lifetimes.
- The created core exposes exactly the seven asynchronous P032 operations: registration begin/finish, authentication begin/finish, revision read, encrypted download and conditional upload.
- Every invocation first validates an exact POST, trusted-Origin, `same-origin` Fetch Metadata, JSON content type and nullable opaque session context. Unknown or cross-origin context fails before body, store, randomness or verifier work.
- Stable errors expose only their stable service code, status and narrowly applicable retry/clear-session booleans. Native failures, submitted identifiers, credentials, keys, ciphertext and readable content are not logged or copied into errors.
- The injected store exposes only `transact(readonly|readwrite, callback)`. A transaction exposes exactly Promise-returning `get`, `insert`, `replace` and `remove`; insert is insert-only and replacement/removal uses `storeVersion` compare-and-swap.
- The production module supplies no database driver. `tests/helpers/p034-memory-service-store.js` is a deterministic test-only serial driver with staged atomic commits, rollback, two-core shared state, snapshots and four narrow failure points.

### Exact service state and authorisation

- Six strict version-1 collections store only accounts, public credentials, sessions, passkey ceremonies, one current encrypted Pocket record and immutable operation results.
- Every record is an exact plain object with matching identity, positive safe store version and no unknown fields. All reads validate before use; malformed or relationally impossible state fails without repair, deletion or reset.
- Account records contain a public 32-byte PRF evaluation input, active opaque credential IDs and one nullable Pocket binding. They contain no readable account profile or Pocket content.
- Credential records contain only public verifier state and account ownership. Sessions contain only opaque relationships, status and expiry. Ceremony records contain public options, challenge/digests and exact completed results, never raw PRF output or private key material.
- Only the Pocket record stores ciphertext. It stores one current P028/P029 opaque encrypted record and its decoded ciphertext size; revision zero is absence and no history is retained.
- Immutable operation records store a canonical SHA-256 logical-request digest and exact committed/conflict result, not ciphertext.
- Content methods require an active unexpired session, valid session/account/credential relationships and the exact account-to-Pocket binding. Invalid supplied sessions request clearing without exposing the session ID.

### Ceremonies, verifier and sessions

- Registration begin stores only one pending ceremony. Exact pending begin replay returns the original body/challenge; changed, expired or completed reuse fails.
- Authentication resolves an account from a current session or explicit opaque locator and uses one non-enumerating unresolved-account error. Discoverable no-locator policy remains deferred.
- P034 builds P031-compatible resident-key/user-verification-required options with the account's stable public PRF input. No second PRF input or conditional mediation is added.
- The injected verifier is called once outside a write transaction. Its strict result is revalidated, then the core re-reads ceremony, account, credential and prior session before commit.
- Registration atomically creates/updates account and credential state, creates the active session and completes the ceremony. Authentication atomically advances permitted verifier state, creates the replacement session, revokes the prior session and completes the ceremony.
- Exact completed finish replay returns the stored result and same still-valid session instruction; changed replay creates no second credential or session.
- Successful account authentication does not create or return a content key, PRF output, envelope or content-unlocked claim.

### Encrypted revisions and idempotency

- An unbound authorised account reads exact revision zero. First expected-revision-zero upload atomically binds that account, creates revision 1 and inserts its operation result.
- Conditional upload independently enforces the exact P032 body, safe advanceable expected revision and strict opaque encrypted record.
- The canonical digest explicitly covers account, Pocket, expected revision, operation and logical-change identities plus every encrypted-record field. `attemptKind` alone is excluded.
- Exact current revision commits once. A newer actual revision creates an immutable HTTP 409 conflict result without changing the Pocket. Actual revision below expected fails as invalid state.
- Exact explicit idempotent retries replay the original commit or conflict; a committed replay sets `replayed: true`. First-seen idempotent retry may execute. `new-change` reuse or any changed logical request fails.
- Concurrent same-revision writes serialize so they cannot both commit. Replays also validate the current account/Pocket relationship and coherent stored outcome before returning success.

### Failure injection and confidentiality

- Injected failures before first read, after reads/before staging, after staging/before commit and during commit retain the prior complete snapshot.
- Focused failures prove there is no partial account, credential, session, session revocation, Pocket binding, Pocket revision or operation outcome, and no false success after commit failure.
- Stale ceremony, account, credential and prior-session versions fail after verifier work but before any partial completion.
- Distinctive readable-Pocket and raw-unlock-secret sentinels are rejected from all request/verifier schemas, records, results and errors. Only the Pocket record contains opaque ciphertext, exactly once.

### Files changed

- `sync-service/pocket-sync-service-core.js`
- `tests/helpers/p034-memory-service-store.js`
- `tests/p034-sync-service-core.test.js`
- `docs/SYNC_SERVICE_CORE.md`
- `docs/SYNC_REMOTE_API_CONTRACT.md`
- `docs/SYNC_SECURITY_ARCHITECTURE.md`
- `docs/SYNC_THREAT_MODEL.md`
- `docs/SYNC_CONTRACT.md`
- `docs/SYNC_USER_JOURNEY.md`
- `docs/CODEX_REPORT.md`

### Validation

- `node --test tests/p034-sync-service-core.test.js` - 33 passed, 0 failed.
- `node --test tests/p032-sync-remote-client.test.js` - 33 passed, 0 failed.
- `node --test tests/p031-sync-account-client.test.js` - 27 passed, 0 failed.
- `node --test tests/p030-sync-device-store.test.js` - 29 passed, 0 failed.
- `node --test tests/p029-sync-crypto.test.js` - 25 passed, 0 failed.
- `node --test tests/p028-sync-security-contract.test.js` - 27 passed, 0 failed.
- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 538 passed, 0 failed.
- `node --check` passed for the production core, deterministic helper and focused test.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P034 is server-side, undeployed and not production-loaded.

### Recommended P035 boundary

Supply one reviewed HTTP/header/cookie adapter, one standards-compliant WebAuthn verifier adapter and one real durable database transaction adapter around P034's exact interfaces. Add request-size/rate limits, secure cookie issuance/clearing and operational rollback/backup policy without weakening the state machine or loading sync in today's Pocket. Keep provider/origin selection, envelope/recovery/pairing/deletion APIs, account-discovery UI and owner/Save integration separately reviewed.

## POCKET TASK P033 - HARDEN REMOTE REVISION BOUNDARY

Title: Harden remote revision boundary

Status: P033 closes the final-safe-integer edge in P032's dormant conditional-upload client. An expected revision that cannot advance safely now fails before transport, and a committed response must explicitly contain both a safe integer and the exact next revision.

Commit title:

- `P033 Harden remote revision boundary`

### Baseline and finding

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `19ddb0669ba86267c686a9b707c56e3bd140c7ab`
- Starting title: `P032 Build remote session and conditional-write client`
- Implementation date: 2026-08-03
- Branch: `main`
- Actual P032 source admitted `expectedRevision: Number.MAX_SAFE_INTEGER`; its proposed next revision was `9007199254740992`, which is not a JavaScript safe integer. The reachable baseline path made one transport call and accepted that unsafe committed revision.

### Correction

- `validateConditionalUploadRequest()` still requires a non-negative safe integer and now additionally rejects `expectedRevision >= Number.MAX_SAFE_INTEGER` with `remote-request-invalid` before P028 validation or transport.
- The HTTP 200 committed-response branch now explicitly requires `Number.isSafeInteger(response.revision)` and exact equality with `request.expectedRevision + 1`; unsafe committed revisions use `remote-response-invalid`.
- Revision zero remains valid. `Number.MAX_SAFE_INTEGER - 1` remains advanceable and a committed `Number.MAX_SAFE_INTEGER` is accepted when it is exactly next.
- HTTP 409 conflict validation remains unchanged: `actualRevision` must be a safe integer greater than the expected revision.
- Revision reads, downloads, incorrect-revision rejection, idempotent replay and network handling remain unchanged.

### Files changed

- `js/pocket-sync-remote-client.js`
- `tests/p032-sync-remote-client.test.js`
- `docs/SYNC_REMOTE_CLIENT.md`
- `docs/CODEX_REPORT.md`

The remote-client contract now states the same advanceable-request and safe committed-response boundary. No backend, UI, owner, Main Save, PE Save, storage schema, account/passkey flow, route, response limit, service-worker file or production loader changed. The remote client remains unloaded, so no loaded production behaviour changed.

### Validation

- `node --test tests/p032-sync-remote-client.test.js` - 33 passed, 0 failed.
- `node --test tests/p031-sync-account-client.test.js` - 27 passed, 0 failed.
- `node --test tests/p030-sync-device-store.test.js` - 29 passed, 0 failed.
- `node --test tests/p029-sync-crypto.test.js` - 25 passed, 0 failed.
- `node --test tests/p028-sync-security-contract.test.js` - 27 passed, 0 failed.
- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 505 passed, 0 failed.
- `node --check` passed for `js/pocket-sync-remote-client.js` and the changed focused test.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P033 changes only the unloaded remote client, its executable Node test and documentation.

## POCKET TASK P032 - BUILD REMOTE SESSION AND CONDITIONAL-WRITE CLIENT FOUNDATION

Title: Build remote session and conditional-write client foundation

Status: P032 adds the dormant provider-neutral same-origin client boundary for a future Pocket account/content service. It binds P031's exact passkey service to bounded JSON transport and binds P028's encrypted revision, download and conditional-write contracts without enabling sync or changing production behavior.

Commit title:

- `P032 Build remote session and conditional-write client`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `1a9b599f9a0f7fbe9105c36a3fa140934a8ec053`
- Starting title: `P031 Build account and passkey client foundation`
- Implementation date: 2026-08-03
- Branch: `main`
- `js/pocket-sync-remote-client.js` remains absent from `index.html` and `sw.js` and performs no network or environment access when loaded.
- No backend, provider, actual service origin, UI, account/session implementation, storage, token manager, live owner, Save integration, envelope/recovery/pairing operation, service-worker change or production loader was added.

### Module, transport and session boundary

- The global `PocketSyncRemoteClient` exports frozen `POLICY` and `ROUTES`, exact revision/download/upload validators, `createBrowserJsonTransport`, `createAccountService` and `createContentService`.
- The browser transport accepts only a caller-supplied same-origin absolute-path service root. It appends locked route suffixes for four passkey operations plus revision read, content download and conditional upload; opaque identifiers stay in POST JSON bodies.
- Fetch uses `mode` and `credentials` `same-origin`, `cache: no-store`, `redirect: error`, `referrerPolicy: no-referrer`, and exact JSON request/response content types. Requests are finite plain JSON, serialized exactly once, and no path retries automatically.
- Future authentication is a server-owned browser cookie session. P032 does not create/read cookies or send/persist bearer tokens. Secure/HttpOnly/SameSite attributes, rotation, fixation/CSRF defenses, server WebAuthn verification and account/Pocket authorization remain server work.
- Account/revision JSON has a 262,144-byte UTF-8 limit; content JSON has a 16,777,216-byte limit. Declared/actual oversize, redirects, HTML/non-JSON, malformed/non-object JSON and unexpected statuses fail closed. Stream reads cancel once oversized.

### Account and encrypted content contracts

- `createAccountService` exposes exactly P031's `beginRegistration`, `finishRegistration`, `beginAuthentication` and `finishAuthentication` and delegates validation to the actual P031 production contract. P031 retains begin-to-finish ceremony/PRF continuity; P032 has no ceremony cache and PRF results never cross transport.
- Revision read is exact `{ apiVersion, operationId, syncedPocketId }` and accepts only coherent empty revision 0 or positive opaque-record metadata. Download additionally requires a positive revision and returns the exact matching P028 record.
- Download size is decoded ciphertext bytes including the 16-byte authentication tag and excluding the nonce and JSON/base64url framing. Filenames, timestamps-as-authority, readable content, handles, keys and recovery/PRF secrets are excluded.
- Conditional upload requires explicit API version and P028's exact expected revision, operation/logical-change IDs, attempt kind and encrypted record. HTTP 200 must be committed at exactly the next revision; HTTP 409 must be a non-writing newer-revision conflict.
- An explicit idempotent retry may return the durable original result with `replayed: true`; a new change may not. Network ambiguity after dispatch remains an unavailable result: P032 never guesses success or automatically retries. Durable operation ownership and changed-payload replay rejection remain mandatory server enforcement.
- Stable non-secret errors distinguish invalid service roots/routes/requests/responses, redirects, content type/size, authentication, authorization, rate limiting, service unavailability and other rejection. Native network and server response bodies are not exposed.

### Files changed

- `js/pocket-sync-remote-client.js`
- `tests/helpers/p032-remote-fixtures.js`
- `tests/p032-sync-remote-client.test.js`
- `docs/SYNC_REMOTE_CLIENT.md`
- `docs/SYNC_REMOTE_API_CONTRACT.md`
- `docs/SYNC_SECURITY_ARCHITECTURE.md`
- `docs/SYNC_THREAT_MODEL.md`
- `docs/SYNC_CONTRACT.md`
- `docs/SYNC_USER_JOURNEY.md`
- `docs/CODEX_REPORT.md`

### Validation

- `node --test tests/p032-sync-remote-client.test.js` - 31 passed, 0 failed.
- `node --test tests/p031-sync-account-client.test.js` - 27 passed, 0 failed.
- `node --test tests/p030-sync-device-store.test.js` - 29 passed, 0 failed.
- `node --test tests/p029-sync-crypto.test.js` - 25 passed, 0 failed.
- `node --test tests/p028-sync-security-contract.test.js` - 27 passed, 0 failed.
- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 503 passed, 0 failed.
- `node --check` passed for every changed/new JavaScript file.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P032 changes no production-loaded code or visible UI and its fetch/transport behavior is covered by injected deterministic production-module tests.

### Recommended next implementation boundary

Implement and security-review the same-origin server/session boundary behind P032: server-side WebAuthn verification, secure cookie/CSRF policy, account/Pocket authorization, durable revision CAS and operation-idempotency persistence, response/body limits and abuse controls. Keep envelope/recovery operations and owner/Save integration separate until the complete activation, mandatory recovery and conflict journeys can be reviewed as one owner-safe production seam.

## POCKET TASK P031 - BUILD ACCOUNT AND PASSKEY CLIENT FOUNDATION

Title: Build account and passkey client foundation

Status: P031 adds the dormant provider-neutral client boundary for future Pocket account passkey registration/authentication. It validates exact versioned ceremony shapes, performs strict native/fallback WebAuthn JSON conversion, keeps PRF output local and reports account success with content still locked. It does not enable sync or change current production behavior.

Commit title:

- `P031 Build account and passkey client foundation`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `1229cd6fde21f8a8d948a0d6438a44dea091ce7c`
- Starting title: `P030 Build encrypted device store foundation`
- Implementation date: 2026-08-03
- Branch: `main`
- `js/pocket-sync-account-client.js` remains absent from `index.html` and `sw.js`.
- No live synced owner, UI, account session, backend/provider/endpoint, network transport, current Save integration, service-worker change, JSON/Vault owner or browser-recovery change was added.

### Client and WebAuthn boundary

- One injected Pocket account service has exactly `beginRegistration`, `finishRegistration`, `beginAuthentication` and `finishAuthentication`; one separately injected WebAuthn adapter owns browser calls.
- Exact version 1 begin/finish allowlists bind operation, ceremony, credential, device and PRF-input identities. Expiry is checked before and after the human gesture. No path retries automatically.
- Registration requires a discoverable credential, user verification and no attestation. Authentication requires user verification and does not request conditional mediation.
- Native `parseCreationOptionsFromJSON`, `parseRequestOptionsFromJSON` and credential `toJSON` are preferred. Strict fallbacks decode/encode every WebAuthn binary member as canonical unpadded base64url and independent buffers.
- Cancellation, unsupported capability, browser security failure, service failure, invalid response, expiry and identity mismatch return stable codes without exposing browser/service messages.

### PRF and content-lock separation

- Each ceremony carries one service-supplied public PRF evaluation input: canonical base64url decoding to exactly 32 bytes. The client neither generates nor persists it.
- Registration distinguishes unavailable, enabled-without-output and available; authentication distinguishes unavailable and available. Present output must be exactly 32 bytes or finish is not called.
- Extension results are inspected before serialization. Native/manual finish credentials retain at most registration's public `prf.enabled`; all raw PRF results are stripped from service-bound payloads.
- Usable output is copied to a fresh local `Uint8Array` for the immediate future envelope caller and must be cleared there. It never enters truth/Vault/device/recovery data or remote request metadata.
- Successful account operations explicitly return `accountAuthenticated: true` and `contentUnlocked: false`. Only a later separately validated P028/P029 credential-bound envelope path may unlock content.
- P028 envelope metadata now requires `deviceId` only for device envelopes and `credentialId` only for passkey-PRF envelopes; transfer/recovery envelopes forbid both.

### Files changed

- `js/pocket-sync-account-client.js`
- `js/pocket-sync-security-contract.js`
- `tests/p031-sync-account-client.test.js`
- `tests/p028-sync-security-contract.test.js`
- `tests/p029-sync-crypto.test.js`
- `docs/SYNC_ACCOUNT_PASSKEY.md`
- `docs/SYNC_REMOTE_API_CONTRACT.md`
- `docs/SYNC_SECURITY_ARCHITECTURE.md`
- `docs/SYNC_USER_JOURNEY.md`
- `docs/SYNC_THREAT_MODEL.md`
- `docs/SYNC_CONTRACT.md`
- `docs/CODEX_REPORT.md`

### Validation

- `node --test tests/p031-sync-account-client.test.js` - 27 passed, 0 failed.
- `node --test tests/p030-sync-device-store.test.js` - 29 passed, 0 failed.
- `node --test tests/p029-sync-crypto.test.js` - 25 passed, 0 failed.
- `node --test tests/p028-sync-security-contract.test.js` - 27 passed, 0 failed.
- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 472 passed, 0 failed.
- `node --check` passed for every changed/new JavaScript file.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P031 changes no production-loaded code or visible UI.

### Recommended next implementation boundary

Implement and security-review the Pocket account server/session adapter plus credential-bound passkey-PRF envelope orchestration, then join it to P027-P030 activation only after complete failure atomicity, recovery, revocation and human UI/copy paths are tested. Keep the foundation unloaded until that owner transition is ready as one reviewed production seam.

## POCKET TASK P030 - BUILD THE ENCRYPTED DEVICE STORE FOUNDATION

Title: Build encrypted device store foundation

Status: P030 adds the dormant production-capable IndexedDB foundation for a future Synced Pocket's encrypted device state. It stores one strictly validated current encrypted record, protects replacement with local compare-and-swap and transaction completion, and keeps P027/P028/P029 ownership, security and crypto boundaries intact. It does not enable sync or change current production behaviour.

Commit title:

- `P030 Build encrypted device store foundation`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `66a55f8b6e65e130e24ca2030e5e04b0a18aed63`
- Starting title: `P029 Implement sync crypto foundation`
- Implementation date: 2026-08-03
- Branch: `main`
- `js/pocket-sync-device-store.js` remains absent from `index.html` and `sw.js`.
- No live synced owner, UI, account, passkey ceremony, backend, provider, endpoint, network request, service-worker change, current Save integration, JSON/Vault owner or browser-recovery change was added.

### Concrete database and record

- IndexedDB database `pocket.sync.device.v1`, version 1, contains exactly one `pockets` object store keyed by `syncedPocketId`, with no indexes or auxiliary/history/log stores.
- Strict `pocket.sync.device-state` schema version 1 holds `storeRevision`, opaque Pocket/device identities, one non-extractable device `CryptoKey`, its P029 device envelope, one P029 encrypted content record, minimal P028 pending/conflict metadata and per-device key-use accounting.
- Pending metadata refers to the sole `content.record`; ciphertext is not duplicated. Strict allowlists exclude readable content, filenames/paths/handles, Vault/recovery secrets, raw keys, tokens, browser-safety payloads and UI/search state.
- The module delegates P028/P029 context, metadata, conditional-request, encrypted-record and non-extractable key checks rather than weakening their formats.

### Atomicity, concurrency and failure

- Initial creation requires `storeRevision: 1`, uses insert-only `add` semantics and resolves only at transaction completion.
- Replacement reads and validates the current record, checks expected `storeRevision`, requires exactly the next revision, prevents remote/counter rollback and writes the complete new record in one readwrite transaction.
- Only the IndexedDB transaction `complete` event reports success. Request, validation, clone and transaction failures preserve the prior whole state. Stale concurrent tabs receive `device-store-revision-conflict` and cannot silently overwrite the winner.
- Restored device keys must remain non-extractable AES-GCM-256 keys with exact usages. Unsupported structured cloning fails closed as `device-key-storage-unsupported`; there is no raw/JWK, plaintext or extractable-key fallback.
- Browser eviction/site-data clearing can remove device state. P030 does not request persistent storage and does not claim hardware-backed key storage. Encrypted remote state and the human recovery copy remain essential.

### Versions and migrations

- Database and record schema version 1 are the only supported versions. The explicit narrow migration seam has no registered migrations.
- Higher versions and lower versions without an explicit migration fail closed. There is no destructive reset, `deleteDatabase`, start-fresh fallback, timestamp migration or automatic malformed-record deletion.
- A future shell may replace the narrow IndexedDB driver only while preserving the exact record and transaction contract; no shell was added.

### Files changed

- `js/pocket-sync-device-store.js`
- `tests/helpers/p030-memory-device-store-driver.js`
- `tests/p030-sync-device-store.test.js`
- `docs/PRODUCT_PRINCIPLES.md`
- `docs/SYNC_DEVICE_STORE.md`
- `docs/SYNC_CONTRACT.md`
- `docs/SYNC_SECURITY_ARCHITECTURE.md`
- `docs/SYNC_THREAT_MODEL.md`
- `docs/CODEX_REPORT.md`

### Validation

- `node --test tests/p030-sync-device-store.test.js` - 29 passed, 0 failed.
- `node --test tests/p029-sync-crypto.test.js` - 25 passed, 0 failed.
- `node --test tests/p028-sync-security-contract.test.js` - 25 passed, 0 failed.
- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 443 passed, 0 failed.
- `node --check` passed for every changed/new JavaScript file.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P030 changes no production-loaded code or visible UI.

### Recommended next implementation boundary

Implement and review the account/WebAuthn ceremony and remote adapter/service boundaries, including activation-time device-store capability checks, whole-account key-use enforcement/rotation and recovery/device-transfer flows, while keeping all code unloaded until the complete adoption and one-owner Save path is ready for security review.

## POCKET TASK P029 - IMPLEMENT SYNC CRYPTO FOUNDATION

Title: Implement sync crypto foundation

Status: P029 adds the real provider-neutral Web Crypto foundation for the future Synced Pocket while keeping it unloaded. It locks and tests exact content/envelope formats, AAD, HKDF separation, non-extractable key lifecycles and strict P028 metadata validation. It does not enable sync or change any current production owner, Save, Vault or recovery behaviour.

Commit title:

- `P029 Implement sync crypto foundation`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `37a5f5e7b9e0d34d558ef748a3a8424b9436d399`
- Starting title: `P028 Lock sync security architecture`
- Implementation date: 2026-08-03
- Branch: `main`
- `js/pocket-sync-crypto.js` remains absent from `index.html` and `sw.js`.
- No production-loaded file, JSON/Vault format, current Vault crypto, source owner/session, Main Save, PE Save, browser recovery path or service-worker behaviour changed.

### Concrete format and API

- AES-GCM-256 protects content and 32-byte master-key envelopes with random 12-byte nonces, 128-bit tags and canonical unpadded base64url.
- The master key is exactly 32 locally random bytes imported as a non-extractable AES-GCM key with only `encrypt`/`decrypt`. It is independent of accounts, passkeys, PRF output, recovery, filenames and human passwords.
- HKDF-SHA-256 derives non-extractable wrapping keys from at least 32 bytes of high-entropy input, a random 32-byte salt and exact versioned `passkey-prf`, `device-transfer` or `recovery` labels/info. Direct device envelopes use a separately generated key and `kdf: none`.
- Exact compact-JSON UTF-8 AAD binds content to format/version/algorithm/Pocket/revision/type and envelopes to format/version/algorithm/Pocket/envelope ID/kind/version.
- `PocketSyncCrypto` exposes strict record/context/key validation; device and derived wrapping-key creation; master-key creation, opening and rewrapping; and content sealing/opening. It returns no raw master-key or derived-key bytes.
- Temporary master/decrypted/plaintext/derivation buffers are cleared on a best-effort basis. No perfect JavaScript memory erasure is claimed.
- Policy declares fewer than `2^32` operations per key (`2^31` ceiling); durable cross-device counting and rotation remain future work.

### Vectors and executable coverage

- Official RFC 5869 HKDF-SHA-256 test case 1 verifies the published PRK and 42-byte OKM through standards-compatible Web Crypto operations.
- The NIST AES-256-GCM empty-plaintext known-answer test verifies tag `530f8afbc74536b9a963b4f1c4cb738b`.
- `tests/fixtures/p029-sync-crypto-vectors.json` commits fixed synthetic Pocket vectors for exact content AAD/ciphertext, direct device envelope AAD/ciphertext, recovery HKDF info/derived-key behaviour and recovery envelope AAD/ciphertext.
- Focused tests execute production modules in controlled VM contexts with deterministic randomness only at the test boundary. They cover non-extractability, fresh nonces, byte clearing, all envelope kinds, rewrapping, every bound context field, record/ciphertext tampering, strict canonical encoding/lengths, plaintext exclusion and the unchanged local Vault boundary.

### Files changed

- `js/pocket-sync-crypto.js`
- `js/pocket-sync-security-contract.js`
- `tests/fixtures/p029-sync-crypto-vectors.json`
- `tests/p029-sync-crypto.test.js`
- `tests/p028-sync-security-contract.test.js`
- `docs/SYNC_CRYPTO_FORMAT.md`
- `docs/SYNC_SECURITY_ARCHITECTURE.md`
- `docs/SYNC_REMOTE_API_CONTRACT.md`
- `docs/SYNC_THREAT_MODEL.md`
- `docs/SYNC_CONTRACT.md`
- `docs/CODEX_REPORT.md`

### Validation

- `node --test tests/p029-sync-crypto.test.js` - 25 passed, 0 failed.
- `node --test tests/p028-sync-security-contract.test.js` - 25 passed, 0 failed.
- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 414 passed, 0 failed.
- `node --check` passed for every changed/new JavaScript file.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P029 changes no production-loaded code or visible UI.

### Deliberately unimplemented

P029 adds no live synced owner, Turn on sync UI, account, passkey ceremony, recovery UI/package flow, durable device store, IndexedDB/localStorage record, backend, endpoint, provider, network request, production loader, autosave, background sync, caller-controlled nonce or raw-key export.

### Recommended next implementation boundary

Design and review a versioned durable encrypted-device store and migrations that consume the P029 records, protect device wrapping keys, preserve P027 owner/Save atomicity and durably enforce encryption-use limits/master-key rotation. Keep account/WebAuthn and provider adapters behind separate reviewed boundaries before any production loading.

## POCKET TASK P028 - LOCK SYNC SECURITY, STORAGE AND RECOVERY ARCHITECTURE

Title: Lock sync security architecture

Status: P028 locks a provider-neutral, versioned security/storage/recovery architecture for the future Synced Pocket. It adds one unloaded deterministic production contract, focused executable validation, conceptual remote API shapes and a threat model. It does not enable sync, load code in production, select a provider or endpoint, add an account/passkey/recovery flow, or change current JSON/Vault ownership, Save or recovery behaviour.

Commit title:

- `P028 Lock sync security architecture`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `a4ea0f75dac4b740bf1a1d56d325a7a8367c3dc0`
- Starting title: `P027 Build synced Pocket foundation`
- Implementation date: 2026-08-03
- Branch: `main`
- `js/pocket-sync-security-contract.js` is deliberately absent from `index.html` and `sw.js`. It has no DOM, browser storage, cryptography, randomness, network, endpoint or provider dependency.
- P027's exact human copy and orchestration are unchanged. No current production-loaded JavaScript, HTML, CSS, service worker, Vault/JSON format, crypto, file handle, owner/session, Main Save, PE Save or browser-recovery path changed.

### Locked architecture

- One random locally generated 256-bit Pocket master key protects content through authenticated encryption with a fresh nonce for every record. Multiple independent key envelopes allow one envelope to be replaced without re-encrypting all content. Raw bytes have minimum practical lifetime and best-effort clearing; no perfect JavaScript zeroisation or universal hardware-backed protection is claimed.
- Passkeys authenticate the account but are not the content key. Optional WebAuthn PRF may unlock only when the actual ceremony supplies valid client extension output; output remains client-only, uses domain-separated derivation and is never the sole recovery path.
- Unlock priority is exactly valid device envelope, valid actual passkey-PRF envelope, approved device-transfer envelope, recovery envelope, then unavailable. Missing/invalid material fails closed rather than silently falling through.
- Trusted-device and remote metadata use strict allowlists. Filenames, readable Pocket content, raw keys/PRF/recovery roots, file/Vault handles, owner tokens and current browser-safety recovery payloads are forbidden.
- Mandatory recovery uses a random local root of at least 256 bits, separate account-authorisation/master-key-wrap labels, a local-only package and exact locked human copy. **I’ll do this later** pauses activation without replacing the source owner. Successful recovery rotates recovery material, invalidates old authorisation and requires a new copy.
- **Sync is ready** requires the current/saved source, local master key, durable encrypted device record, successful conditional initial remote commit, registered account credential, recovery envelope, saved recovery copy and final synced-owner adoption.
- Remote operation shapes are versioned for passkey registration/authentication, credential list/revoke, revision/read/download/conditional upload/conflict, envelopes add/revoke, emergency recovery/rotation, device-transfer relay and account deletion request/confirm. Conditional writes carry expected revision plus stable operation/logical-change IDs; idempotent replay cannot create another revision and conflicts never overwrite.
- Product v1 permits one ordinary Synced Pocket while all schemas carry an opaque synced Pocket ID. No filename establishes identity.

### Contract and tests

`PocketSyncSecurityContract` exposes explicit versions and policies plus deterministic builders/validators for PRF ceremony output, unlock selection, recovery/activation readiness, trusted-device/remote/content/envelope metadata, local-only recovery packages, opaque encrypted records, conditional write requests/results and recovery rotation.

The focused suite executes that production source inside isolated VM contexts. A distinctive plaintext sentinel proves readable fields cannot enter accepted remote metadata/request shapes. It also checks loader isolation, exact envelope kinds/order/copy/derivation labels, passkey-versus-PRF separation, fail-closed invalid material, mandatory recovery, all activation gates, device-store exclusions, conditional conflict/idempotency semantics, recovery rotation and absence of DOM/storage/network/provider dependencies.

### Files changed

- `js/pocket-sync-security-contract.js`
- `tests/p028-sync-security-contract.test.js`
- `docs/SYNC_SECURITY_ARCHITECTURE.md`
- `docs/SYNC_REMOTE_API_CONTRACT.md`
- `docs/SYNC_THREAT_MODEL.md`
- `docs/SYNC_CONTRACT.md`
- `docs/SYNC_USER_JOURNEY.md`
- `docs/CODEX_REPORT.md`

### Validation

- `node --test tests/p028-sync-security-contract.test.js` - 25 passed, 0 failed.
- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 389 passed, 0 failed.
- `node --check` passed for the new production contract and focused test.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P028 changes no production-loaded code or visible UI.

### Deliberately unimplemented

P028 adds no actual encryption/key generation, WebAuthn ceremony, passkey account, PRF request, IndexedDB/device store, recovery file picker, pairing, backend, endpoint, provider, remote request, live synced owner, production UI, service-worker behaviour, autosave or background sync. Concrete algorithm/parameter selection, test vectors, durable migrations, server enforcement, operational controls, conflict UI and synced-owner browser recovery require later reviewed work.

### Recommended next implementation boundary

Select and review concrete authenticated-encryption, key-derivation and envelope parameters with test vectors; implement the versioned encrypted device-store adapter and real WebAuthn/account-service adapters behind P027/P028's injected seams; then test activation/recovery failure atomicity before loading any synced owner or visible UI in production.

## POCKET TASK P027 - BUILD THE SYNCED POCKET FOUNDATION

Title: Build synced Pocket foundation

Status: P027 adds an unloaded, provider-neutral Synced Pocket contract; a deterministic test-only remote adapter; executable ownership, activation, local-first Save, pending retry, conflict and human-copy coverage; and the approved future security and user-journey documentation. It does not expose or enable sync in production.

Commit title:

- `P027 Build synced Pocket foundation`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `a75b269a898a1a4a3f7c99b039ba23fbc468d2b2`
- Starting title: `P026 Tighten Vault recovery prompt`
- Implementation date: 2026-08-03
- Branch: `main`
- The new module is deliberately absent from `index.html` and `sw.js`. Existing local JSON/Vault ownership, Main Save, PE Save, recovery, file opening, crypto and service-worker behaviour are unchanged.

### Contract and API

`PocketSyncContract` follows the repository's browser/global module style and exposes:

- `COPY` for the exact Turn on sync, Sync is ready and Save/conflict strings;
- `plainJsonNotice(displayName)` for exact readable-source transparency using the supplied filename;
- `activate(dependencies, options)` for ordered JSON/Vault-to-synced activation;
- `save(dependencies, syncedState, options)` for encrypted device-first Save and one conditional remote attempt; and
- `retryPending(dependencies, syncedState)` for explicit retry with no new edits.

Every stateful boundary is injected: source-session capture/currency, dirty-source Save, payload freeze, local sealing, encrypted device persistence, remote revision read, conditional encrypted write and final synced-owner adoption. Adoption occurs exactly once and only after initial device and remote success. Failures leave the local JSON/Vault owner active.

The deterministic `InMemorySyncAdapter` exists only under `tests/helpers`. It models empty/matching remote state, successful writes, unavailability, failed writes, newer revisions and an intervening device write without network, timers, browser storage, credentials or random behaviour.

Tests use distinctive readable content and a separate key object, proving that remote arguments contain neither readable payload data nor key/source-handle objects. Revision mismatches never overwrite or merge remote content. A pending encrypted record remains locally safe and an explicit Save can reuse and sync it even with zero new edits.

### Files changed

- `js/pocket-sync-contract.js`
- `tests/helpers/p027-in-memory-sync-adapter.js`
- `tests/p027-sync-contract.test.js`
- `docs/SYNC_CONTRACT.md`
- `docs/SYNC_USER_JOURNEY.md`
- `docs/CODEX_REPORT.md`

No production-loaded JavaScript, HTML, CSS, service worker, dependency, crypto format, fixture or personal-data file changed.

### Validation

- `node --test tests/p027-sync-contract.test.js` - 36 passed, 0 failed.
- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 364 passed, 0 failed.
- `node --check` passed for the new production contract, test adapter and P027 test.
- `git diff --check` passed.
- The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

Physical browser acceptance: not applicable. P027 changes no production-loaded code or visible UI.

### Deliberately unimplemented

P027 adds no Turn on sync button, sign-in screen, account, backend, network request, passkey, Face ID/fingerprint/PIN request, production content-key store, emergency recovery key, IndexedDB synced record, live `ownerKind: "synced"`, background retry, autosave or second Sync button. It does not claim that real cloud sync is available.

### Recommended next integration boundary

Before production UI or ownership wiring, complete a provider-neutral security/storage design that selects the account/passkey boundary, Pocket master-key protection and transfer, emergency recovery, durable encrypted device store and conditional remote API together. After review, adapt those implementations behind P027's injected seams and branch a future live synced Save immediately before `exportTree()`'s current zero-operation early return so pending sync can be retried explicitly.

## POCKET TASK P026 - TIGHTEN VAULT RECOVERY STARTUP UI

Title: Tighten Vault recovery prompt

Status: the initial encrypted-recovery warning now uses shorter copy and a compact warning-only layout. **View recovery** and **Not now** remain the two main choices; quiet **Delete recovery** sits beneath them and is last in DOM and Tab order. The accepted P025 recovery behaviours and the existing shared Vault dialog/recovery owners are unchanged.

Commit title:

- `P026 Tighten Vault recovery prompt`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `897cf5e400df1bcf856c821d46ac56f49bb3c5ab`
- Starting title: `P025 Allow deferring Vault recovery`
- Implementation date: 2026-08-03
- Branch: `main`
- P026 changes only initial-warning and deletion-confirmation wording/presentation, production contract tests, documentation and the offline cache generation. It adds no modal, recovery owner, listener, storage key, file route, Save path or startup route.
- Browser validation used the repository's disposable encrypted fixture on an isolated local origin. No personal Pocket file, Vault, password, handle or browser recovery was inspected.

### Implementation

The shared Vault overlay now receives `vaultRecoveryWarningMode` only while its existing `recovery-warning` mode is active and removes it on close. That mode limits the card to 356px, reduces warning-only gaps/padding, removes the empty error row from layout, and gives the three canonical actions a two-column-plus-delete grid. Other Vault dialogs retain the shared P024/P025 presentation.

The initial warning now says **Unsaved Vault changes** and **Pocket found encrypted recovery data from an earlier session.** Its DOM and keyboard order is View recovery, Not now, Delete recovery. Delete is an underlined quiet destructive action on its own row. At narrow widths all three controls retain 44px touch heights.

The existing exact-record deletion path still owns both initial and post-view deletion. Its shared confirmation now says **Delete encrypted recovery?** and explains that only recovery stored in this browser is permanently deleted while saved Pocket files and Vaults are unchanged. The confirm action remains visibly destructive. View, Not now, Cancel, confirmed deletion, recovery retention, output ownership and file safety semantics are unchanged.

The service-worker cache advances from `pocket-shell-v6` to `pocket-shell-v7` so installed/offline copies refresh the changed HTML, CSS and JavaScript.

### Files changed

- `index.html`
- `vault.css`
- `js/pocket-vault-io-browser.js`
- `js/pocket-vault-recovery.js`
- `sw.js`
- `tests/p019-vault-ownership.test.js`
- `docs/VAULT_RECOVERY_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No crypto primitive, Vault envelope, truth payload, file owner, Main Save, PE Save, recovery storage format, dependency, fixture or personal-data file changed.

### Automated validation

- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 328 passed, 0 failed.
- `node --check` passed for both changed production JavaScript modules, `sw.js` and the changed JavaScript test.
- `git diff --check` passed.

The production-module harness proves the exact warning copy, three-action order, warning-mode lifecycle, Not-now retention/reload, View/Cancel, Delete/Cancel/confirm, exact confirmation copy, destructive confirm styling, zero saved-file writes and refreshed offline shell. Existing recovery, PE, device-resolution and popup-isolation cases continue to prove the unchanged ownership and persistence boundaries.

The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

### Disposable production-browser validation

- Desktop 1280x720: the warning was a 356px by 190.5px upper panel, initial focus was View, the error live region occupied no space, View/Not now shared the primary row and Delete sat beneath.
- 390x720, 320x720 and 280x720: the panel widths were 356px, 300px and 260px; View/Not now stayed side by side, Delete stayed beneath, every action was 44px high, the whole panel was visible without scrolling and document width equalled viewport width.
- Tab order was View recovery, Not now, Delete recovery, then wrapped to View.
- Not now closed the modal, returned focus to Choose file, opened no viewer, and the warning returned after reload.
- View opened the unchanged recovery-password dialog; Cancel returned to the warning.
- Delete opened the exact revised confirmation. Cancel returned to the warning; confirmed deletion closed the flow and the warning did not return after reload.
- The destructive confirm rendered with its established danger class and red filled treatment; the warning-only class was absent from confirmation mode.
- The top-level production page recorded zero console warnings or errors.

The temporary local seed page, disposable browser record and local server were removed after validation.

### Remaining physical acceptance

Murray's physical browser acceptance remains required for installed/offline cache replacement, real touch/safe-area rendering and interaction alongside native file permissions. Use disposable Pocket/Vault files and passwords only. The P026-inclusive checklist is in `docs/VAULT_RECOVERY_CONTRACT.md`, section 13.

## POCKET TASK P025 - ALLOW DEFERRING VAULT RECOVERY

Title: Add Not now to Vault recovery startup

Status: the encrypted-recovery startup gate now offers **View recovery**, **Discard recovery** and **Not now**. Not now ends only the current startup interaction, preserves the exact encrypted browser record, performs no password/decrypt/delete/adopt/write action, and resumes normal Pocket startup once. The retained record is offered again on the next reload.

Commit title:

- `P025 Allow deferring Vault recovery`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `077a5604be2e37349eebf136e98950dead958e65`
- Starting title: `P024 Polish Vault recovery UI`
- Implementation date: 2026-07-31
- Branch: `main`
- P025 extends the existing shared Vault dialog and existing `PocketVaultRecovery.runStartupFlow()` owner. It does not add another modal, recovery owner, startup route or truth-file path.
- No personal Pocket file, Vault, password, file handle or browser storage was inspected. Automated and browser checks used synthetic encrypted content and a disposable password only.

### Implementation

The existing `vaultRecoveryWarningActions` row gains one neutral secondary `vaultRecoveryNotNow` control. It is included in the canonical dialog button list, so the established busy/reset, focus-containment and one-listener lifecycle applies to all three startup actions.

The shared dialog resolves the new choice as `not-now`. The recovery state machine handles that result by calling its existing `finishFlow()` once. That clears only transient flow references and the active startup gate, then consumes the deferred normal-startup callback once. It does not call unlock/decrypt, `clearRecovery()`, output/adoption or any writer, and it does not change `ownedRecordRaw` or browser storage.

The warning body explains that the choice may be deferred. The status after selection is:

> Encrypted browser recovery kept for later. Pocket will offer it again next time.

P024's existing flexible action row already wraps the third neutral button at narrow widths, so `vault.css` remains unchanged. The offline shell advances from `pocket-shell-v5` to `pocket-shell-v6` so cached startup markup and JavaScript cannot retain the two-button gate.

### Files changed

Production:

- `index.html`
- `js/pocket-state.js`
- `js/pocket-vault-io-browser.js`
- `js/pocket-vault-recovery.js`
- `sw.js`

Tests:

- `tests/p019-vault-ownership.test.js`

Documentation:

- `docs/VAULT_RECOVERY_CONTRACT.md`
- `docs/VAULT_OWNERSHIP_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No CSS, package, dependency, fixture, generated PE runtime, crypto primitive, Vault envelope, Pocket truth schema or personal-data file changed.

### Automated validation

- `node --test tests/p019-vault-ownership.test.js` - 148 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 328 passed, 0 failed.
- `node --check` passed for every changed JavaScript file and `sw.js`.
- `git diff --check` passed.

The new executable case proves exact-record retention, zero decrypt calls, zero browser-storage writes/removals, no recovered-tree or owner adoption, no picker activity, one startup resumption, clean dialog release and warning return in a fresh reload context. Existing tests additionally prove View/Cancel, wrong-password, read-only preview, Discard/Cancel/confirm, one canonical listener, reset/busy reuse, compact wrapping and the refreshed service-worker cache generation.

The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

### Disposable browser validation

An isolated local Pocket origin was seeded with one synthetic authenticated encrypted recovery. The startup prompt showed the three required actions with initial focus on View. Tab moved View to Discard to Not now and wrapped back to View without leaving the dialog.

Selecting Not now showed no password or viewer, left no modal/body-class/inert lock, returned focus to Choose file and displayed the normal no-file startup screen. A SHA-256 fingerprint and length of the exact synthetic browser record were unchanged before and after selection. Reload presented the three-choice warning again.

View still opened the password dialog. A wrong disposable password revealed nothing and retained the record; Cancel returned to the three choices; the correct disposable password opened the accepted read-only viewer. Keep retained the same fingerprint. Initial Discard still required confirmation, Cancel retained the record, and confirmed Discard removed only that browser record.

At 390px the prompt remained a 370px upper panel with no horizontal overflow; at 320px it remained a 300px upper panel with no horizontal overflow. All three actions wrapped into a 94px neutral action area. The normal top-level production page recorded zero console warnings or errors. The narrow-width iframe harness itself recorded the repository's pre-existing missing-node `MutationObserver` error, which was absent from top-level Pocket and is unrelated to the P025 recovery files.

Temporary seed/frame pages and the synthetic browser record were removed after validation.

### Remaining physical acceptance

Murray's physical browser acceptance remains required for real installed/offline cache replacement, top-level 320px/390px Chrome layout, focus return across Chrome reloads and interaction alongside real file permissions. The exact P025-inclusive disposable checklist is in `docs/VAULT_RECOVERY_CONTRACT.md`, section 13.

## POCKET TASK P024 - POLISH VAULT RECOVERY UI

Title: Polish Vault recovery UI

Status: the accepted P023 recovery and Vault flows now use Pocket's compact neutral panel, row and chip language. Shared Vault prompts sit near the upper part of the app instead of becoming narrow-screen bottom sheets. The read-only recovery viewer is smaller, tree-first and free of a forced large body, and its five existing operations form a compact wrapping strip. Recovery ownership, encryption, output, conversion and file-opening behaviour is unchanged.

Commit title:

- `P024 Polish Vault recovery UI`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched and confirmed starting `origin/main`: `78ca58853ed6b419f1c4dc2a8afd6f61df1ca512`
- Starting title: `P023 Complete Vault recovery flow`
- Implementation date: 2026-07-31
- Branch: `main`
- P024 changes presentation and restrained recovery-action markup only. It does not change the recovery state machine, canonical dialog owner, Vault envelope, crypto, truth payload, file owner, Main Save, PE Save, conversion, Add-to-existing or startup-gate logic.
- Browser validation used only disposable synthetic documents, encrypted recoveries, passwords and in-memory file handles. No personal Pocket file, Vault, password, file handle or browser recovery was inspected.

### Compact shared Vault prompts

The canonical Vault overlay now aligns a 430px maximum-width Pocket panel toward the upper part of the visible app. Its responsive top spacing, safe-area-aware margins, remaining-viewport maximum height and internal scrolling keep startup recovery, unlock, new-password, conversion, confirmation and dirty-owner-switch modes usable without a bottom-sheet or routine full-screen phone treatment.

Panel surfaces, borders, text, muted copy, rows and controls reuse Pocket variables. Padding, gaps, radii, headings and shadows are lighter. Buttons retain practical 40px desktop and 44px narrow touch heights, and both password fields remain 16px.

### Pocket-native recovery viewer and action strip

The viewer maximum width is reduced from 980px to 760px and its forced 360px body minimum is removed. A small document therefore produces a small panel. A large document uses independently scrolling tree and content panes. Wide viewports retain a compact two-column layout; narrow viewports stack the bounded tree before bounded Notes/Outline content without horizontal overflow.

The viewer reuses Pocket panel, row, hover, selected-row, text and muted tokens. Tree spacing, branch controls, selected content and Notes/Outline typography are denser while preserving the isolated read-only renderer and all focus and accessibility relationships.

The five canonical action IDs remain unchanged. Their concise visible labels are **Keep for later**, **Save as Vault**, **Save as JSON**, **Add to file** and **Discard recovery**. Longer descriptions remain in visually hidden text and pointer titles. The controls wrap as a compact chip-like strip; Discard uses a quiet destructive treatment.

The service-worker shell advances to `pocket-shell-v5`, with `vault.css` still present exactly once, so installed/offline copies cannot retain stale P023 CSS or markup.

### Files changed

- `vault.css`
- `index.html`
- `sw.js`
- `tests/p019-vault-ownership.test.js`
- `docs/VAULT_RECOVERY_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No production JavaScript module, generated PE runtime, crypto code, recovery owner, file owner, fixture, dependency or truth schema changed.

### Automated validation

Targeted production-module results:

- `node --test tests/p019-vault-ownership.test.js` - 147 passed, 0 failed.
- `node --test tests/pe-persistence-contract.test.js` - 96 passed, 0 failed.
- `node --test tests/device-changes-resolution.test.js` - 69 passed, 0 failed.
- `node --test tests/p018-popout-isolation.test.js` - 15 passed, 0 failed.
- Total: 327 passed, 0 failed.
- `node --check sw.js` and `node --check tests/p019-vault-ownership.test.js` - passed.
- `git diff --check` - passed.

P024 adds focused assertions that the five action IDs remain single and canonical, the visible labels are concise, the initial startup gate still has only View and Discard, the shared overlays are top-aligned and internally scrollable, password text remains 16px, the viewer has no forced body minimum, the action strip wraps, the Pocket surface/selected-row tokens are used, deliberate mobile bottom/stretch rules are absent, and the `pocket-shell-v5` asset list remains coherent.

The existing executable P023 tests continue to prove read-only preview, focus containment, reset behaviour, wrong-password safety, Keep, exact Discard, all three output routes, atomic adoption, conversion and owner/session protections. The P018 and PE suites continue to prove the unchanged popup and persistence boundaries.

The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

### Disposable production-browser validation

- Desktop 1280x800: the small viewer was 760px wide, 312px high and 62px from the top; its five actions fitted one 40px strip.
- Desktop large recovery: a 20-node document with long Notes produced a 760px by 482px panel. The tree (`618px` scroll height within `331px`) and content (`987px` within `331px`) scrolled independently while the outer card did not.
- 390x800: the startup choice panel was 370px wide and 72px from the top; the password panel used the same placement and a 16px field. The small viewer was 370px wide and 528px high at 44px from the top.
- 390x800 large recovery: tree and content stacked in one column, both scrolled independently, the five actions wrapped into a compact strip, and the page had no horizontal overflow.
- 320x640/700: the prompt retained 10px outer margins at 64px from the top. The large viewer remained inset, had no horizontal overflow and used bounded internal/card scrolling where its content required it.
- 390x360 and a 320px-high embedded production viewport: prompts moved to a safe 10px top inset. The one-password prompt fit; the two-password Vault-creation panel was limited to 296px and scrolled internally (`379px` content), with both fields still 16px.
- Keyboard focus remained inside both modal surfaces, useful initial focus and visible focus styling remained, Escape kept recovery for later, and reloading offered the encrypted recovery again.
- A wrong recovery password remained in the shared dialog and announced the existing calm error through the live status region.
- Disposable Keep, confirmed Discard, Save as Vault, Save as JSON and Add to file flows all completed. Each successful output wrote exactly its queued disposable destination and produced the accepted status; dirty-Vault Cancel retained the Vault, and Discard-and-continue opened only the queued disposable file.
- The same shared compact owner was observed for startup recovery, recovery unlock, Vault unlock, JSON-to-Vault password creation, Vault-to-JSON confidentiality warning, recovery confirmation and dirty-Vault switching.
- A fresh production load recorded zero console warnings or errors.

### Remaining physical acceptance

Physical browser acceptance is still required for actual phone safe-area rendering, touch ergonomics and native File System Access pickers. Use only disposable Pocket/Vault files and passwords. The checklist is in `docs/VAULT_RECOVERY_CONTRACT.md` section 13. Manual Vault lock/padlock work and unrelated command/menu cleanup remain out of scope for P024.

## POCKET TASK P023 — COMPLETE VAULT RECOVERY FLOW

Title: Complete Vault recovery flow

Status: encrypted browser recovery now opens first in a dedicated read-only tree/content viewer and can be persisted to a newly selected Vault or JSON file, or safely restored/imported into an explicitly selected existing JSON file or Vault. The main Choose file action classifies JSON and Vault content through one doorway, and current-file encryption/decryption is expressed as atomic conversion to a new destination. Focused automated and isolated synthetic-browser validation is complete against the P022 baseline. Murray's physical browser acceptance remains.

Commit title:

- `P023 Complete Vault recovery flow`

### Baseline and scope

- Repository: `MSHND/notespace`
- Required and confirmed starting `origin/main`: `3080fc1409e4fdf2b2c73d2d950669c67019ceb2`
- Starting title: `P022 Add encrypted Vault browser recovery`
- Implementation date: 2026-07-31
- Branch: `main`
- Node: `v24.14.0`
- P023 does not change the Pocket Vault v1 envelope, truth payload schema, canonical Main Save or PE Save owners, P012 source/revision protections, P016 FILE/DEVICE/BASE ownership, P017 permission ownership or P022 encrypted capture model.
- No personal Pocket truth file, Vault, password, file handle or browser storage was inspected. Browser work used only disposable synthetic data, passwords and in-memory file handles on an isolated local origin.

### View-first encrypted recovery

An encrypted browser record now gates ordinary startup behind exactly **View recovery** and **Discard recovery**. Discard requires confirmation, needs no password and removes only the exact browser record. View asks for the original Vault password; Cancel returns to the two startup choices, and a wrong password reveals no content and leaves the record intact.

Successful authentication opens `PocketVaultRecoveryViewer`. It clones the validated recovered document into a dedicated read-only surface that displays capture time, hierarchy, expandable branches, node selection, Notes and supported structural Outline content. It never replaces the main tree, installs a document owner, activates a Vault key, records an operation, opens PE or writes browser/truth storage. Keep for later closes the viewer, clears the live decrypted references and retains the encrypted record.

After viewing, the available explicit actions are:

- **Keep for later**
- **Save as new encrypted Vault**
- **Save as plain JSON**
- **Add to existing Pocket file**
- **Discard recovery**

New Vault and JSON outputs become authoritative only after the selected destination write closes and the prepared recovered document is adopted successfully. The exact browser record is then cleared. Cancellation, credential failure, encryption failure, permission denial, stale flow, write failure or adoption failure leaves recovery intact.

### Smart file classification and existing-file recovery

`PocketFileOpening` owns the one user-facing **Choose file** doorway. It reads and parses one selected file, validates a Vault envelope before considering plain Pocket JSON, and returns a classified candidate without adopting it. Filename and extension are diagnostic only. Unsupported or damaged content reaches no permission, write or owner rotation. The separate Open encrypted Vault control is retired.

Recovery Add to existing uses the same classifier. Existing destinations are permission-checked and reread immediately before persistence; changed bytes fail closed.

- A matching Vault ID plus the exact recovery base revision permits a confirmed whole-document restore as the next encrypted revision.
- A matching Vault with a newer/different revision is never blindly overwritten. Pocket offers the safe contained fallback beneath one timestamped Recovered root.
- A different Vault keeps its stable Vault ID, content and revision lineage, and receives the fresh-ID contained import as its next encrypted revision.
- A plain JSON destination receives the same contained import through the JSON write path.

Only after the correct JSON or Vault write succeeds does Pocket install that exact destination as the sole active owner and establish the written payload as baseline.

### Document-owned conversion

The command palette no longer exposes a separate encrypted-file opener or non-authoritative readable-copy action.

- A current JSON document can be converted to a new encrypted Vault. The source JSON is untouched, and the new Vault becomes active only after successful encryption and persistence.
- A current Vault can be converted to a new readable JSON file after an explicit warning. The source Vault is untouched, and the new JSON becomes active only after successful persistence.

Both routes require a provably different destination and retain the source owner, dirty state and recovery on cancellation or failure. Successful Vault-to-JSON conversion clears only an exact matching encrypted browser record.

### Files changed

Production:

- `index.html`
- `vault.css`
- `sw.js`
- `js/pocket-file-opening.js`
- `js/pocket-vault-recovery-viewer.js`
- `js/pocket-io-browser.js`
- `js/pocket-overlays-init.js`
- `js/pocket-state.js`
- `js/pocket-vault-io-browser.js`
- `js/pocket-vault-recovery.js`

Tests:

- `tests/p019-vault-ownership.test.js`

Documentation:

- `docs/ARCHITECTURE.md`
- `docs/VAULT_OWNERSHIP_CONTRACT.md`
- `docs/VAULT_RECOVERY_CONTRACT.md`
- `docs/CODEX_REPORT.md`

The service-worker shell advances to `pocket-shell-v4` and includes both new canonical P023 modules so an installed/offline update cannot serve the new HTML without its file-opening or recovery-viewer owner.

No package, dependency, crypto primitive, Vault envelope field, truth schema, generated PE runtime, fixture or personal data file changed.

### Executable validation

- `node --test tests/p019-vault-ownership.test.js`: **146 passed, 0 failed**
- `node --test tests/pe-persistence-contract.test.js`: **96 passed, 0 failed**
- `node --test tests/device-changes-resolution.test.js`: **69 passed, 0 failed**
- `node --test tests/p018-popout-isolation.test.js`: **15 passed, 0 failed**
- Combined focused result: **326 passed, 0 failed**
- Changed JavaScript syntax checks: **PASS**
- `git diff --check`: **PASS**

The broad `node tools/pocket-check.js` and `npm run check` commands were not run.

### Isolated browser validation

An isolated local in-app-browser origin exercised the production page with synthetic encrypted recovery and synthetic in-memory file handles.

- Startup showed exactly View recovery and Discard recovery.
- Password Cancel returned to the startup decision.
- A wrong password showed the calm rejection without revealing or deleting content.
- The correct disposable password opened the cloned viewer; branch collapse/expand, selection, Notes and indented Outline display worked.
- Keep for later survived reload.
- Both initial and post-view Discard used confirmation and removed only the synthetic browser record.
- The same Choose file control opened a plain JSON file and an encrypted Vault by content.
- No separate Open encrypted Vault command was present.
- JSON-to-Vault and Vault-to-JSON conversion each wrote exactly one new synthetic destination while leaving the source at zero writes.
- Recovery import to plain JSON, a different Vault and a divergent same-ID Vault each wrote only the selected destination once and displayed/adopted the preserved destination plus one contained Recovered root.
- The divergent same-ID Vault was recognised despite a different filename and offered the contained fallback rather than overwrite.
- A fresh direct production-page load produced no console warnings or errors.

The forced iframe reload used by the disposable harness produced an in-app-browser observer error outside the served production-script instrumentation; a direct production reload did not reproduce it. Real browser reload/focus/storage behaviour therefore remains part of physical acceptance.

This browser pass did not invoke a real operating-system file picker or inspect any personal browser state or file. The synthetic browser artifacts were kept outside the committed application.

### Known limits and physical acceptance

- Browser localStorage remains finite and browser-managed.
- Only one encrypted Vault recovery record is retained.
- Recovery inspection/output remains bounded to 10,000 nodes and approximately 5,000,000 serialised characters.
- Contained import deliberately does not broadly merge recovered root/data extras or tombstones.
- Same-Vault clean restore relies on stable Vault ID and monotonic saved revision; divergent revisions use the contained fallback.
- The final destination reread narrows but cannot eliminate the platform-level external-write race after comparison.
- Password recovery, key escrow, cloud backup, multi-device recovery and automatic file reopening remain out of scope.

Physical browser acceptance remains required for real picker permission, File System Access write/close, reload persistence, focus containment, service-worker update and browser-storage behaviour. The exact P023 checklist is in `docs/VAULT_RECOVERY_CONTRACT.md`, section 13.

## POCKET TASK P022 — ENCRYPTED BROWSER RECOVERY FOR UNSAVED VAULT STATE

Title: Add encrypted Vault browser recovery

Status: unsaved changes under an active encrypted Vault now receive a separately encrypted browser safety copy. A retained copy is handled through the canonical, synchronously gated Vault dialog and can be unlocked only for an explicit output action. Focused automated and isolated synthetic-browser validation is complete against the accepted P021 baseline. Murray's physical browser acceptance remains.

Commit title:

- `P022 Add encrypted Vault browser recovery`

### Baseline and scope

- Repository: `MSHND/notespace`
- Required and confirmed starting `origin/main`: `5fc1b031b7df18301e88ab95f76b73a6c4bb8655`
- Starting title: `P021 Reset Vault dialog controls between actions`
- Implementation date: 2026-07-30
- Branch: `main`
- Node: `v23.11.0`
- P022 adds an encrypted recovery layer for dirty Vault-owned state. It does not change the Pocket Vault v1 envelope, the Pocket truth payload schema, the canonical Main Save or PE Save owners, P012 source/revision checks, or ordinary JSON recovery.
- No personal Pocket truth file, Vault, password, file handle or browser storage was inspected. Browser interaction used only an isolated in-app-browser origin populated with synthetic encrypted test data.

### Encrypted-only capture and ownership

`PocketVaultRecovery` is the single owner of the new browser record at `pocketLite.vaultRecovery.encrypted.v1`. The stored outer record contains only its recovery schema/version, capture time, covered operation sequence and a standard authenticated Vault envelope. The complete canonical Pocket payload is inside the ciphertext. No readable title, Notes, Outline/editor content, root/data extras, tombstones, password, `CryptoKey`, original filename or writable handle is persisted.

`recordOp()` retains operation ownership. Its existing safety call now schedules a serial encrypted capture when the current truth owner is a Vault. The capture freezes the current canonical payload, current highest operation sequence, exact Pocket document session and exact active Vault identity; seals with the active non-extractable in-memory Vault key and a fresh nonce; then rechecks both identities before storage. Latest-current capture wins only within the exact record chain created by that page. A retained recovery from startup, another page/session or another Vault is preserved instead of silently overwritten or cleared. Capture failure leaves the document dirty and reports that encrypted recovery could not be updated.

The recovery record is browser safety data only. It has no file authority, does not remember the original Vault, and cannot adopt a tree or destination. Ordinary non-Vault local-safety records retain their established keys and behaviour. Vault capture does not create plaintext workspace, trail, auto-cache, last-save or PiP content.

### Live Save and stable save-race refresh

A successful encrypted truth write notifies the recovery owner only after the writable stream closes and Vault/session ownership remains current. If the write covers all operations, only the exact matching encrypted recovery is removed. If newer operations arose during the write, the exact payload written becomes the new Vault revision and the newest visible dirty state is immediately recaptured against that advanced session. Covered operations retire while newer operations and their encrypted recovery remain.

Failed encryption, permission, picker, write, close or stale-session outcomes retain the previous encrypted recovery. If refreshing recovery after a successful truth write fails, the truth write remains successful, newer operations remain dirty and Pocket warns rather than claiming those changes have browser recovery. Exact raw-record ownership prevents an older completion or another page/session from clearing a changed recovery.

### Synchronous startup gate and password boundary

The new script loads directly after the canonical Vault IO owner. During initialisation it synchronously detects a retained record and opens the permanent accessible Vault dialog before ordinary document actions can proceed. `pocket-overlays-init.js` explicitly defers its normal file-gate or PiP startup adoption callback until the recovery choice finishes, avoiding a hidden source-session rotation behind the modal. The shared modal continues to own `role="dialog"`, `aria-modal="true"`, focus containment, inert background state and its P021 control reset. File open/create, Vault create/export, PiP opening, tree mutation and whole-document shortcuts remain gated while the flow is active.

The first view offers exactly:

- **Unlock recovery**
- **Delete recovery**
- **Not now**

Delete requires confirmation but no password and affects only the exact browser record opened by the flow. Not now closes the modal without decrypting or deleting. Unlock uses the original Vault password to authenticate and decrypt the envelope in memory. A wrong password reveals nothing and leaves the blob, retry and Cancel intact. Decryption also validates the recovered Pocket structure, but never adopts it as the visible tree or active document.

After a correct password, the dialog offers exactly:

- **Save as new encrypted Vault**
- **Save as plain JSON**
- **Add to an existing Pocket file**
- **Keep for later**
- **Discard recovery**

Keep for later releases the decrypted in-memory flow state and leaves the encrypted record. Discard uses the same explicit-delete confirmation. The plain JSON action presents a readable-content warning before its picker.

### Explicit output destinations

All three output routes are bound to the exact recovery-flow token and starting Pocket session. Each asks the user for its destination and is output-only: neither successful decryption nor a successful recovery write adopts the output handle, payload or file session.

- **Save as new encrypted Vault** asks for a new destination and new confirmed password, creates a fresh Vault identity and writes revision 1.
- **Save as plain JSON** writes a canonical readable Pocket payload only after its explicit confidentiality warning.
- **Add to an existing Pocket file** reads and validates an explicitly selected plain JSON destination, fresh-remaps every recovered node ID and parent, places the recovered tree beneath one `Recovered <date/time>` top-level wrapper, asks for final confirmation, then rereads the exact destination bytes immediately before writing. Any intervening change fails closed.

Full Vault and JSON outputs preserve the complete recovered document. The contained add-to-existing route preserves recovered nodes, Notes, supported or opaque editor metadata, generic node extras and order, while deliberately retaining the destination's document metadata and tombstones instead of attempting a broad merge. Cancellation, failure or stale ownership writes nothing and preserves recovery. Successful output clears only the exact recovery record; cleanup failure is reported rather than hidden.

### Files changed

Production:

- `index.html`
- `vault.css`
- `sw.js`
- `js/pocket-state.js`
- `js/pocket-storage.js`
- `js/pocket-history-status.js`
- `js/pocket-io-browser.js`
- `js/pocket-vault-io-browser.js`
- `js/pocket-vault-recovery.js`
- `js/pocket-overlays-init.js`

Tests:

- `tests/p019-vault-ownership.test.js`

Documentation:

- `docs/VAULT_RECOVERY_CONTRACT.md`
- `docs/VAULT_OWNERSHIP_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No package, dependency, fixture, Pocket truth schema, Vault crypto module, generated PE runtime or personal data file changed.

### Executable validation

- `node --test tests/p019-vault-ownership.test.js`: **133 passed, 0 failed**
- `node --test tests/pe-persistence-contract.test.js`: **96 passed, 0 failed**
- `node --test tests/device-changes-resolution.test.js`: **69 passed, 0 failed**
- `node --test tests/p018-popout-isolation.test.js`: **15 passed, 0 failed**
- Combined focused result: **313 passed, 0 failed**
- Production JavaScript syntax checks: **PASS for every `js/*.js` file**
- Changed test JavaScript syntax check: **PASS**
- Service-worker syntax check: **PASS**
- Generated PE runtime: **unchanged by P022**
- `git diff --check`: **PASS**

The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

### Isolated browser validation

An isolated local in-app-browser origin exercised the real startup dialog with synthetic encrypted data. The warning appeared with initial focus on **Unlock recovery**; Delete opened confirmation and Cancel returned safely; a wrong password showed the calm error without revealing or deleting content; the correct synthetic password exposed all five required actions; the plain JSON warning opened and cancelled safely; **Keep for later** survived a reload; and final confirmed Delete removed the synthetic record. No console warning or error appeared.

This browser pass did not invoke a real file picker or perform a recovery output write. It did not inspect Murray's personal browser storage, Pocket file or Vault.

### Known limits and physical acceptance

- Browser localStorage is finite and may be cleared by the browser or user.
- P022 retains one encrypted Vault recovery record. A waiting record from another Vault is preserved, which can temporarily prevent the newly active Vault from establishing its own recovery.
- Recovery output validation is bounded to 10,000 nodes and approximately 5,000,000 serialised characters.
- Add to existing imports only the recovered node tree; it does not merge recovered root/data extras or tombstones.
- The final destination reread narrows but cannot eliminate a platform-level external-write race after the freshness check.
- Password recovery, key escrow, multi-device recovery, cloud backup, automatic adoption, automatic merge and rollback detection remain out of scope.

Physical browser acceptance remains required for real picker permissions, File System Access write/close behaviour, reload persistence, focus containment and storage/quota behaviour. The exact P022 checklist is in `docs/VAULT_RECOVERY_CONTRACT.md`, section 14.

## POCKET TASK P021 — RESET VAULT DIALOG CONTROLS BETWEEN ACTIONS

Title: Reset Vault dialog controls between actions

Status: the permanent shared Vault dialog controls now start every Create, Unlock, readable-export and dirty-switch action in a known interactive state. Focused local validation is complete against the exact accepted P020 baseline. Murray's physical browser acceptance remains.

Commit title:

- `P021 Reset Vault dialog controls between actions`

### Baseline and scope

- Repository: `MSHND/notespace`
- Required and confirmed starting `origin/main`: `35fa30783e9aeceed75b619cd7918ec51f539911`
- Starting title: `P020 Preserve inline renames during Vault switch`
- Implementation date: 2026-07-30
- Branch: `main`
- Node: `v23.11.0`
- P021 changes only the lifecycle of the existing permanent Vault dialog controls. It does not change the Vault envelope, cryptography, file/session ownership, candidate adoption, encrypted Save, readable-export destination, dirty-switch decision, PE implementation, P016 recovery policy or P020 inline-draft handling.
- No personal Pocket truth file, real Vault, browser storage, password, real file handle or network resource was accessed.

### Confirmed defect

`js/pocket-vault-io-browser.js` uses one permanent DOM control set for Create, Unlock, readable export and dirty-owner switching.

The old `setDialogBusy(true)` disabled only controls inside the currently visible section. A successful Create or Unlock then called `closeDialog()`, whose section reset hid and cleared content but did not re-enable the buttons. The next dialog created a fresh logical record with `busy: false` while the reused Submit and Cancel elements could remain physically disabled. `vault.css` correctly renders disabled Vault actions with reduced opacity and a wait cursor, producing the observed stuck Unlock dialog.

The earlier production-source tests dispatched the credential form listener directly. That correctly exercised submit logic but bypassed the browser button's disabled-click behaviour, so the persistent DOM state was not characterised.

### Canonical control reset

P021 defines one exact list containing all seven reusable action buttons:

- credential Submit and Cancel;
- readable-export Confirm and Cancel; and
- dirty-switch Save, Discard and Cancel.

Before a dialog record is created, `resetDialogControls()` unconditionally enables that full set, enables the password field and returns confirmation to its neutral disabled state. The section reset then hides all modes, clears both credential values and clears the error. Only after this neutral reset does the selected mode establish its record, reveal its section and apply mode-specific presentation.

While an asynchronous action is pending, `setDialogBusy()` updates the exact active record and disables the full shared button set regardless of hidden ancestry. This blocks duplicate submissions and hidden cross-mode actions. A failed credential or switch action re-enables the full set, retains the current error and restores useful focus so retry or Cancel is immediately available.

Success, Cancel, Escape and ordinary close synchronously:

1. reset the originating record to non-busy;
2. enable every reusable action;
3. clear and neutralise the credential fields and sections;
4. hide the overlay and remove background inertness;
5. clear the active record; and
6. resolve the originating Promise once.

No CSS or markup change was required.

### Mode and asynchronous isolation

Create explicitly shows and enables confirmation. Unlock explicitly hides and disables confirmation. Both modes start with an enabled password field, enabled Submit and enabled Cancel. Readable-export and dirty-switch actions receive the same fresh neutral reset before their own controls are revealed.

Direct Export-confirm and Switch-discard actions are mode-gated, so a hidden control cannot close another dialog mode. `bindDialogUi()` remains guarded by its one existing owner and repeated `init()` calls do not duplicate form, button, keyboard or focus listeners.

Every asynchronous completion continues to compare its captured dialog record with the exact current record before changing busy/error/close state. P021 also changes credential forgetting so local password variables are always released, while shared permanent input elements are cleared only if their originating record is still active. A deliberately invalidated old completion therefore cannot erase text or reset controls in a newer dialog.

### Production-source test coverage

`tests/p019-vault-ownership.test.js` now checks physical `disabled`, `hidden`, focus and credential-field state against the actual production module. It no longer relies only on direct form dispatch for the regression.

New P021 coverage includes:

- successful Create followed by Unlock in the same DOM;
- a second successful Unlock plus later Cancel and Escape;
- pending Create and Unlock duplicate-submit blocking;
- failed Unlock re-enable, retry and success;
- readable-export isolation;
- repeated dirty-switch isolation;
- failed encrypted Save re-enable and Cancel;
- confirmation-field Create/Unlock isolation;
- deliberate old-dialog invalidation followed by a newer dialog, using a narrow VM-only exposure of the real private close function;
- stale completion leaving the newer password, error and controls untouched; and
- repeated initialisation/opening with unchanged listener counts.

All pre-existing P019 ownership, P020 inline-draft, P018 popup, P017 permission, P016 recovery, P012 PE binding and cryptographic cases remain in their existing focused suites.

### Files changed

Production:

- `js/pocket-vault-io-browser.js`

Tests:

- `tests/p019-vault-ownership.test.js`

Documentation:

- `docs/VAULT_OWNERSHIP_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No HTML, CSS, service worker, generated PE runtime, crypto module, Vault envelope, fixture, package, dependency or other production file changed.

### Executable validation

- `node --test tests/p019-vault-ownership.test.js`: **122 passed, 0 failed**
- `node --test tests/pe-persistence-contract.test.js`: **96 passed, 0 failed**
- `node --test tests/device-changes-resolution.test.js`: **69 passed, 0 failed**
- `node --test tests/p018-popout-isolation.test.js`: **15 passed, 0 failed**
- Combined focused result: **302 passed, 0 failed**
- Production JavaScript syntax checks: **PASS for every `js/*.js` file**
- Changed test JavaScript syntax check: **PASS**
- Service-worker syntax check: **PASS**
- Generated PE runtime: **unchanged by P021**
- `git diff --check`: **PASS**

The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

### Architecture and regression boundary

P021 preserves the P019 encrypted truth owner, the P020 canonical inline-draft commit boundary, exact handle/session checks, Vault candidate single-flight ownership, P017 permission modal, P018 popup isolation, P012 PE source/revision validation, explicit readable-copy export and no plaintext browser recovery for Vault owners. It introduces no autosave, background write, file watcher, cloud path, alternate Save owner, duplicate binding or truth-file migration.

### Physical browser acceptance

Physical browser acceptance remains required with disposable JSON/Vault files and the disposable password specified by the task. The exact P021 checklist is in `docs/VAULT_OWNERSHIP_CONTRACT.md`, section 17, steps 54–66. It covers Create then Unlock, PE persistence, idle button state, Cancel, wrong-password retry, readable-export and switch isolation.

## POCKET TASK P020 — PRESERVE INLINE RENAMES DURING VAULT SWITCH

Title: Preserve inline renames during Vault switch

Status: the P019 dirty-Vault switch now resolves active inline renames and provisional new-item titles through the canonical inline editor before encrypted persistence. Focused local validation is complete against the exact accepted P019 baseline. Murray's physical browser acceptance remains.

Commit title:

- `P020 Preserve inline renames during Vault switch`

### Baseline and scope

- Repository: `MSHND/notespace`
- Required and confirmed starting `origin/main`: `05dd4a62b128702471a4524c0d80b8d0b9441f64`
- Starting title: `P019 Make Vault the encrypted truth owner`
- Implementation date: 2026-07-27
- Branch: `main`
- Node: `v23.11.0`
- P020 is a narrow dirty-owner-switch correction. It does not change the Vault envelope, cryptographic parameters, truth payload schema, active owner kinds, PE implementation, browser-recovery privacy or plaintext-export policy.
- No personal Pocket truth file, real Vault, browser storage, password, real file handle or network resource was accessed.

### Confirmed defect and correction

`hasUnsavedInlineTitleDraft()` already counted the live inline input as unsaved, but P019 `saveBeforeOwnerSwitch()` resolved only a Details draft before calling `exportTree()`. The inline value therefore remained outside `state.nodes` and the operation history. With an earlier operation it was omitted from the encrypted payload; as the only change it could produce `no-changes`.

P020 keeps `commitInlineEdit()` as the sole inline mutation owner and adds a structured owner-switch adapter:

1. inspect the exact active `[data-edit-id]` input and node;
2. retain its full current value before any Details render;
3. reject blank, over-limit, missing, stale or otherwise unresolved drafts without invoking the destructive ordinary blank-title path;
4. resolve any open Details editor through `saveDetailsEditor()` and verify it closed;
5. revalidate the exact dialog, document owner, handle, Pocket session, Vault session and prepared candidate;
6. commit the captured value once through `commitInlineEdit()`;
7. require the inline edit to be resolved, with the canonical commit producing its ordinary `rename` or `add_below` operation; and
8. call canonical `exportTree()` once.

If Details Save rebuilt the tree, the adapter restores only the already captured exact inline value into the newly rendered input after proving the edit object and node are unchanged. It does not read `document.activeElement`, infer from `originalLabel`, scrape text in `exportTree()` or add a second Enter/Save handler.

The production inline renderer now marks its local input lifecycle finished only after the canonical commit or cancel actually resolves that edit. Focus moving into the permission or Vault-switch modal can therefore be rejected by the ordinary mutation gate without consuming the input's later Enter, Tab or blur behaviour. Cancel and failed Save-and-continue leave a genuinely usable draft, not merely visible text.

### Narrow dialog authority and race safety

The Vault-switch modal makes ordinary mutation unavailable while its decision is pending. P020 therefore extends the existing dialog-token pattern to authorise only the canonical inline commit for the current busy Save-and-continue action. Direct or stale tokens remain blocked.

The switch dialog now carries the prepared candidate's continuation guard. JSON load, Create New and Vault-open callers supply their actual source/candidate checks. `allowsDialogSave()` verifies:

- the exact dialog token and busy switch mode;
- the active file/Vault source session;
- owner kind and Vault-session ID; and
- the prepared candidate's current authority.

`exportTree()` passes that same token into the encrypted writer. Candidate and session identity are rechecked after encryption, permission, writable creation and data write. A stale request aborts before close where the platform still permits it. Candidate adoption remains after confirmed encrypted persistence only.

For P017-selected JSON files, the candidate remains authoritative when the permission owner deliberately releases its single-use token immediately before dirty-Vault resolution. That narrow transition retains the exact source session and prepared candidate, while final adoption still requires both source-session identity and the candidate continuation guard. The permission-gated Save-and-continue flow is covered end to end.

### User-visible outcomes

- **Save and continue** commits an active rename or valid inline new item into the model and operation history before encryption.
- An inline-only rename now produces an encrypted write rather than `no-changes`.
- A valid provisional item produces one node and one ordinary `add_below` operation.
- A failed encrypted write leaves the committed model change dirty and retryable without a duplicate rename/add operation.
- A blank, over-limit, missing, stale or unresolved draft cancels the pending switch, retains the current Vault and draft, performs zero writes and reports: `Finish or cancel the current rename before switching files. Nothing was saved or changed.`
- **Cancel** retains the exact typed draft and performs zero writes.
- **Discard and continue** does not commit the draft or write the Vault; successful candidate adoption explicitly abandons the old in-memory draft.

### Files changed

Production:

- `js/pocket-editor-copy.js`
- `js/pocket-history-status.js`
- `js/pocket-render.js`
- `js/pocket-io-browser.js`
- `js/pocket-vault-io-browser.js`

Tests:

- `tests/p019-vault-ownership.test.js`

Documentation:

- `docs/VAULT_OWNERSHIP_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No HTML, CSS, service worker, generated PE runtime, crypto module, Vault envelope, fixture, package or dependency file changed.

### Executable validation

P020 extends the existing production-source VM suite rather than adding a copied implementation. The new coverage uses real synthetic inline input elements, actual source functions, fake in-memory handles and authenticated Vault envelopes. It decrypts completed writes and proves that the canonical payload contains the exact inline title and earlier tree changes.

Covered P020 cases include:

- prior operation plus inline rename;
- inline rename as the only unsaved change;
- valid inline new item with no duplicate node or operation;
- blank, missing-input, stale-ID, missing-node, over-limit and reported/unresolved commit failures;
- Cancel and Discard semantics;
- live-staged and render-rebuilt Details plus inline drafts;
- failed encrypted persistence and retry;
- production-rendered blur followed by Cancel and a later successful Enter commit;
- P017 permission-gated JSON preparation followed by dirty-Vault Save-and-continue;
- stale owner/session, candidate and token rejection;
- candidate invalidation during a deferred encrypted write; and
- candidate invalidation after encrypted persistence but before queued adoption.

Exact focused results:

- `node --test tests/p019-vault-ownership.test.js`: **113 passed, 0 failed**
- `node --test tests/pe-persistence-contract.test.js`: **96 passed, 0 failed**
- `node --test tests/device-changes-resolution.test.js`: **69 passed, 0 failed**
- `node --test tests/p018-popout-isolation.test.js`: **15 passed, 0 failed**
- Combined: **293 passed, 0 failed**
- Generated PE runtime: **unchanged by P020; actual generated-program compilation passed in all relevant PE persistence cases**
- Production JavaScript syntax checks: **PASS for every `js/*.js` file**
- Changed test syntax check: **PASS**
- `git diff --check`: **PASS**

The prohibited `node tools/pocket-check.js` and `npm run check` commands were not run.

### P019 architecture retained

P020 retains the P019 active owner model, non-extractable in-memory key, fresh AES-GCM nonce per Save, revision-after-close rule, old JSON handle isolation, no plaintext fallback, explicit readable export, Vault recovery privacy, PiP block, atomic candidate adoption, P017 permission ownership, P018 popup ownership and P012 stale-PE rejection.

### Physical browser acceptance

Physical acceptance remains required with disposable data and a disposable Vault password. The exact focused P020 checklist is in `docs/VAULT_OWNERSHIP_CONTRACT.md`, section 17, steps 41–53.

## POCKET TASK P019 — MAKE VAULT THE ENCRYPTED TRUTH OWNER

Title: Make Vault the encrypted truth owner

Status: implementation, documentation and focused local validation are complete against the exact accepted P018 baseline. Murray's physical browser acceptance remains. The exact-title commit containing this report must still be pushed and confirmed on `origin/main` before P019 can be reported complete.

P020 resolution note: commit `P020 Preserve inline renames during Vault switch` corrects only the dirty-owner Save-and-continue draft boundary described above. The P019 encrypted owner, crypto, persistence and recovery architecture remains unchanged.

Commit title:

- `P019 Make Vault the encrypted truth owner`

### Baseline and scope

- Repository: `MSHND/notespace`
- Required starting `origin/main`: `91b8c9f5a45579445918e513eb2dbf9c4f705bc1`
- Baseline title: `P018 Isolate PE popout sessions`
- Implementation date: 2026-07-27
- Branch: `main`
- P019 is a local encrypted-truth ownership task. It adds no cloud synchronisation, account, key escrow, password recovery, OS keychain integration, encrypted browser crash recovery, shared Vault or encrypted Document PiP.
- No truth-file or Vault envelope version migration, dependency, autosave, background write, file watcher, cross-tab channel or second PE implementation is introduced.
- No personal Pocket truth file, real Vault, browser localStorage, IndexedDB contents, real password or real File System Access handle may be inspected by the implementation or focused tests.

### Active owner model

The active document now has one explicit owner kind:

- `none`;
- `json`;
- `vault`; or
- `detached`.

`js/pocket-io-browser.js` keeps the exact handle, Pocket document-session ID, owner kind and transient Vault-session ID in one captured Save identity. Filenames are diagnostic only. JSON and Vault handles with the same name, and two same-name Vault handles, remain distinct owners.

`setPocketFileSession()` is the canonical ownership transition. A Vault owner requires an exact writable handle plus an activated unlocked Vault session. Moving to JSON, detached or none clears the old Vault key/session reference. A successful owner change rotates the Pocket document session, invalidating P012/P018 PE contexts and queued work.

The previous reachable wrong-file path is closed: successful Vault adoption removes the old JSON handle's authority, `writeTruthFile()` rejects a Vault owner, and canonical `exportTree()` sends Vault persistence only to the encrypted Vault writer.

### Vault v1 crypto and unlocked session

The P018 Vault v1 format remains compatible:

- AES-GCM;
- PBKDF2-SHA-256;
- 310,000 iterations;
- 16-byte salt;
- 12-byte nonce;
- base64url encoding; and
- `portal.export.v1+json` content.

`js/pocket-crypto.js` now validates the supported envelope settings, canonical encodings and fixed lengths before use. `unlockEnvelope()` returns decrypted payload plus a non-extractable AES key and exact envelope metadata. `sealWithUnlockedKey()` reuses that page-lifetime non-extractable key with a fresh random nonce for every Save.

`js/pocket-vault.js` retains one unlocked session in memory. It owns Vault ID, current successful revision and a fresh random Vault-session identity. The old origin-global `pocket.vault.state.v1` helpers are neutralised and cannot determine owner or revision.

Raw passwords are passed only to key derivation, not installed in Pocket state, owner labels, PE payload, truth payload or storage. Credential strings and both password fields are cleared immediately after unlock/key derivation, before create sealing, file writing or queued adoption; encoded password bytes are zeroed after Web Crypto imports the key material. The session and `CryptoKey` disappear on owner replacement or page reload. Revision advances by exactly one only after a successful encrypted write.

### Atomic open, creation and owner switching

`js/pocket-vault-io-browser.js` is the canonical browser Vault owner.

An opened Vault remains a pending candidate while Pocket:

1. completes shared P017 read/write permission;
2. reads and validates the envelope;
3. collects the password through an accessible dialog;
4. derives the key and authenticates/decrypts the payload;
5. validates decrypted structure before normalisation;
6. prepares the normalised document; and
7. resolves dirty-current-owner switching.

Only a fully ready candidate is serialised with the Save queue and adopted. The shared commit boundary stages state without rendering or storage effects while the old owner/key remain authoritative, rechecks the candidate, then rotates ownership once. A staging failure rolls state back without clearing the Vault key. Successful adoption clears document-bound Notes/rename drafts, undo snapshots, pending imports and menus so stale actions cannot mutate a same-ID item in the new owner. Cancellation, denial, read failure, invalid envelope, wrong password, authentication failure, invalid decrypted content, structural rejection or stale candidate leaves the old owner, tree, operations, dirty state, handle, key and document session unchanged with zero writes.

Vault decrypted data uses the active node/root normalisers through a lossless validation view. Root and nested data extras must survive meaningfully; ambiguous or destructively normalised content is rejected rather than opened with loss. Ordinary JSON root precedence remains unchanged.

The production Vault flow no longer uses `prompt()`, hidden file input or download-only adoption. **Open encrypted Vault…** uses `showOpenFilePicker()`. **Save as encrypted Vault…** uses `showSaveFilePicker()`, password confirmation, a new Vault ID, revision 1 and a completed encrypted write before it installs the new owner. Vault creation and readable JSON export require a destination proven distinct from the active file through exact-entry comparison; same-entry, unavailable and failed comparisons all fail closed.

A dirty Vault switch uses one accessible **Save changes to this Vault?** dialog:

- Save and continue waits for canonical encrypted persistence;
- Discard and continue writes nothing and adopts only the already prepared candidate;
- Cancel retains the dirty Vault and clears the candidate.

The current candidate token, dialog token, opaque prepared-adoption lease, document session and serial owner/save queue stop stale async work from adopting or writing after a newer decision. Only the flow which acquired a lease may release it. Create New rechecks its source session after asynchronous exact-handle comparison and before any dirty-owner decision.

### Main Save and readable export

Main Save remains `exportTree()`.

For a Vault owner it freezes the canonical payload and operation ceiling, verifies exact owner/session/handle/key identity, generates a fresh nonce, seals the next revision, checks the session around asynchronous permission and writable stages, writes only the captured Vault handle, closes the stream, and only then updates revision, baseline and covered operations.

Vault Save never falls back to:

- an old JSON handle;
- another Vault;
- a picker;
- a download;
- detached mode; or
- plaintext.

Failure retains the active Vault and dirty operations in memory.

**Export unencrypted JSON copy…** is a separate confirmed command. It always selects a new JSON handle, writes one readable copy, leaves the Vault owner/key/session unchanged and never grants the exported handle future Save authority.

The UI identifies the active source as `Encrypted Vault · <filename>`, gives Main Save the accessible name **Save encrypted Vault**, and reports encrypted Save status without exposing internal identifiers.

### PE ownership and encrypted persistence

P019 extends the transient P012 opening identity with:

- `sourceOwnerKind`; and
- `sourceVaultSessionId`.

The P018 page/popup bridge still validates first. The main-window apply owner then validates the Pocket document session, exact owner kind, Vault-session ID where required, node revision, editor support and non-lossy payload before mutation.

A PE opened under JSON cannot apply after Vault adoption. A Vault PE cannot apply after JSON, detached, another Vault, page reload or Vault-session replacement. The popup receives no password, key, salt, envelope or full Vault session.

After valid in-memory apply, PE Save invokes canonical `exportTree()`. It becomes clean only after encrypted Vault persistence succeeds. Applied-but-not-persisted retry keeps the updated node revision and dirty popup state, with no JSON or plaintext fallback.

### Recovery privacy and PiP

While Vault owns the document, decrypted content is excluded from:

- workspace state;
- local-safety current and trail writes;
- automatic cache;
- last-save snapshot;
- P016 FILE/DEVICE/BASE resolution;
- PiP snapshot persistence/restoration;
- PiP session export/adoption; and
- PiP-host Save.

Opening a Vault does not delete existing ordinary JSON recovery data. Recovery offers are suppressed over the Vault and resume only in an ordinary JSON context.

Unsaved Vault edits remain only in memory. A persistent notice says:

> Vault changes are not kept in browser recovery. Save the Vault to protect them.

The existing single `beforeunload` guard may warn for dirty work but does not save, encrypt or persist during unload. Document PiP is disabled with the explanation that its current transfer is not encrypted.

This deliberately leaves encrypted browser crash recovery for later work.

### Files changed

Production implementation observed in the shared P019 worktree:

- `index.html`
- `vault.css`
- `sw.js`
- `js/pocket-crypto.js`
- `js/pocket-device-changes.js`
- `js/pocket-editor-cutover-v3.js`
- `js/pocket-editor-copy.js`
- `js/pocket-history-status.js`
- `js/pocket-import.js`
- `js/pocket-io-browser.js`
- `js/pocket-node-popout-editor.js`
- `js/pocket-node-popout-model.js`
- `js/pocket-node-popout-runtime.js`
- `js/pocket-overlays-init.js`
- `js/pocket-pe-save-dirty.js`
- `js/pocket-state.js`
- `js/pocket-storage.js`
- `js/pocket-vault-io-browser.js`
- `js/pocket-vault.js`

Tests:

- `tests/p019-vault-ownership.test.js`
- `tests/pe-persistence-contract.test.js`
- `tests/fixtures/vault/p018-v1-envelope.json`

Documentation:

- `docs/VAULT_OWNERSHIP_CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/P015_ARCHITECTURE_SECURITY_AUDIT.md`
- `docs/PE_PERSISTENCE_CONTRACT.md`
- `docs/CODEX_REPORT.md`

### Focused validation

Required commands:

~~~sh
node --test tests/p019-vault-ownership.test.js
node --test tests/pe-persistence-contract.test.js
node --test tests/device-changes-resolution.test.js
node --test tests/p018-popout-isolation.test.js
find js -name '*.js' -print0 | xargs -0 -n1 node --check
git diff --check
~~~

Final results:

- Node version: **v23.11.0**
- P019 Vault ownership suite: **87 passed, 0 failed**
- Existing PE persistence suite: **96 passed, 0 failed**
- P016/P017 device-changes suite: **69 passed, 0 failed**
- P018 popup-isolation suite: **15 passed, 0 failed**
- Combined total/pass/fail: **267 passed, 0 failed**
- Existing P018 Vault v1 compatibility: **PASS**
- Non-extractable key assertion: **PASS**
- Encrypt/decrypt round trip: **PASS**
- Fresh-nonce repeated-Save assertion: **PASS**
- Wrong-password and ciphertext-tamper rejection: **PASS**
- Distinctive plaintext absent from written Vault bytes: **PASS**
- Generated runtime `new Function(...)`, where applicable: **PASS through the PE persistence suite**
- Production JavaScript syntax checks: **PASS for every `js/*.js` file and `sw.js`**
- Changed test JavaScript syntax checks: **PASS**
- JSON fixture parse checks, where applicable: **PASS, 7 fixtures parsed**
- `git diff --check`: **PASS**

Security review confirmations:

- old JSON handle cannot receive Vault plaintext: **PASS**
- passwords and keys absent from browser storage and payloads: **PASS**
- Vault browser recovery and PiP plaintext writes suppressed: **PASS**
- no Save failure falls back to download, picker or JSON: **PASS**
- stale queued owner/session writes rejected: **PASS**
- every successful encrypted Save uses a fresh nonce: **PASS**
- no prohibited checker command was run: **CONFIRMED**

### Physical browser acceptance

Murray's physical browser acceptance remains required. The exact 40-step disposable-file checklist is in `docs/VAULT_OWNERSHIP_CONTRACT.md`, section 17.

It covers active Vault creation, encrypted Main and PE Save, reopening, old-JSON protection, explicit readable-copy export, no later writes to the copy, wrong-password preservation, dirty-switch Cancel/Discard/Save, page-lifetime key loss, JSON recovery preservation and Vault PiP blocking.

Use disposable JSON/Vault files and a disposable password only. Do not use Murray's real truth file or a future real Vault. Do not ask Murray to reproduce a crash.

### Completion boundary

Final parent SHA: `91b8c9f5a45579445918e513eb2dbf9c4f705bc1`

The exact-title P019 commit containing this report must be pushed directly to `origin/main`, fetched again, verified as the only child of the parent above and confirmed with a clean worktree before the task response may report COMPLETE.

## POCKET TASK P018 — ISOLATE PE POPOUT SESSIONS

Title: Isolate PE popout sessions

Status: implementation, documentation and focused local validation are complete against the exact accepted P017 baseline. The exact-title commit containing this report must still be pushed and confirmed on `origin/main` before P018 can be reported complete.

Commit title:

- `P018 Isolate PE popout sessions`

### Baseline and incident boundary

- Repository: `MSHND/notespace`
- Fetched starting `origin/main`: `3a50f8254e970c9687af680559b9a2307044bfb8`
- Baseline title: `P017 Show pending file permission over active tree`
- Implementation date: 2026-07-27
- Branch: `main`
- The worktree was clean after aligning local `main` to the required remote baseline.
- An unrelated earlier local-only commit was preserved on `local-preserve/a0d2a42-fix-pe-save`; it is not part of P018.
- No personal Pocket truth file, browser storage, real File System Access handle, browser profile or Incognito automation was inspected.
- No truth-file schema migration, dependency, autosave, background write, file watcher, cross-tab channel, cloud route, PE implementation or package script was added.

The reported Chrome freeze was not reproduced and P018 does not claim a confirmed browser-level root cause. The implementation removes the verified high-risk shared named-window ownership path without asking Murray to force another freeze or reboot.

### Ownership contract

`js/pocket-node-popout-window.js` remains the one canonical PE window owner.

Every loaded main Pocket page generates one random in-memory owner token. Every fresh PE creation generates a separate popup-instance token. `crypto.randomUUID()` is preferred; random bytes and a multi-part random fallback cover environments without it.

These popup tokens are separate from:

- P012 Pocket file-session identity; and
- the node's P012 revision identity.

Popup tokens contain no filename, node ID, label, truth content or personal data. They are injected only into the generated runtime transport after the ordinary opening payload is built. The runtime removes them from its working payload before constructing Save data. They never enter `state`, localStorage, IndexedDB, browser recovery, truth JSON, node fields or `node.editor`, and they are not reused after page reload or popup replacement.

### Fresh popup creation and independent pages

The fixed reusable cross-page popup target is retired.

New PE creation uses `window.open("", "_blank", ...)`, which requests a fresh browsing context. The canonical owner verifies that the returned window:

- is open and accessible;
- has the exact current main page as `opener`; and
- has no existing PE session surface.

Only then does Pocket assign a unique non-sensitive `window.name`, record the exact `Window` plus popup token, and write the generated PE document once. The generated runtime installs `PocketNodePopoutSession`; the owner validates both tokens before it focuses or trusts the popup.

Normal tabs, separate windows, Incognito-like contexts, browser profiles, reloaded pages and stale windows therefore have independent page owners. Two independent main pages can keep their own PE windows open simultaneously. Opening, replacing or saving page B's PE does not inspect, focus, rewrite, close or wait on page A's PE.

If a foreign/inaccessible value is returned from popup creation, Pocket performs no document write, focus, close or retry on it and reports a calm private-window failure. Existing popup documents are never rewritten in place.

### Clean, dirty, Cancel, Discard and Save replacement

Each main page owns at most one current PE and one pending-open payload.

- Clean replacement revalidates the exact owned session, requests one owned close, clears the reference only after that request, then creates a fresh popup and token.
- Dirty replacement retains one pending item, requests the owned PE's unsaved dialog once and performs one verified attention focus.
- Repeated dirty open requests do not create another popup or focus/dialog loop; the one pending slot holds the latest request.
- Cancel clears only that owner's pending item and returns to the same dirty PE with zero writes.
- Discard closes the old exact PE and opens the pending item fresh with zero apply or truth writes.
- Save reaches the existing canonical apply/truth-write path exactly once. Only successful persistence or a genuinely unchanged save clears dirty state; successful Save & Close then opens the pending item in a fresh popup.

No second PE implementation, Save path or cross-session coordination surface was added.

### Owner-bound Save bridge and stale rejection

The generated runtime no longer calls `window.opener.PocketNodePopoutEditor.applyAndSave()` directly. It calls:

~~~text
PocketNodePopoutWindow.applyAndSaveFromOwnedPopup(
  ownerToken,
  popupToken,
  payload,
  callerWindow
)
~~~

The window owner verifies the page token, current popup token, exact caller `Window`, accessible current reference and runtime session identity. Only after all popup ownership checks succeed may it delegate to `PocketNodePopoutEditor.applyAndSave()`.

The unchanged editor owner then runs the P017/P016 file gates, P012 file-session check, node lookup, node-revision check, unsupported-editor gate and non-lossy save preflight. Popup ownership supplements rather than replaces those protections.

Wrong owners, wrong popup tokens, replaced popups, reloaded pages and disconnected/stale sessions return:

~~~text
reason: popup-session-changed
status: This editor belongs to an earlier Pocket window — not saved
~~~

The full message explains that nothing changed and asks the user to copy anything needed before reopening from the current Pocket window. Rejection performs no tree mutation, operation, export, picker or truth write and leaves the local draft dirty.

### Opener loss and close safety

If the main page closes or reloads, the old PE remains locally responsive. Save performs one bounded bridge lookup and fails quickly as `popup-session-changed`; it never polls or reconnects to the new page.

Clean Close remains immediate. Dirty Close uses the existing in-window Save/Discard/Cancel dialog. Cancel returns to editing, and Discard can close even when the opener is gone.

The generated runtime registers one `beforeunload` handler. It does not save, reopen, poll, focus another window or wait during browser shutdown.

### Recovery and permission behavior

P018 does not change browser safety snapshots, operation tracking, `buildPocketPayload()`, device-change recovery, Main Save or truth-file write ownership. The successful unsaved main-tree recovery observed after reboot remains on the existing P016/P017 path.

PE remains dirty until truth persistence succeeds. No automatic or background truth-file write is added.

The P017 file-permission modal and P016 file/device decision overlay still block new PE opening through `requirePocketFileForChanges()`. An existing owned PE Save reaches the existing permission gate only after popup ownership succeeds, so `file-permission-pending` remains intact and a stale PE cannot bypass either overlay.

### Files changed

Production:

- `js/pocket-node-popout-window.js`
- `js/pocket-node-popout-runtime.js`

Tests:

- `tests/p018-popout-isolation.test.js`
- `tests/pe-persistence-contract.test.js`

Documentation:

- `docs/PE_PERSISTENCE_CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/CODEX_REPORT.md`

No template, model, editor, bridge, persistence, recovery, index, service worker, package, fixture or unrelated application file changed.

### Focused validation

P018 two-owner production harness:

~~~sh
node --test tests/p018-popout-isolation.test.js
~~~

Result:

~~~text
15 tests, 15 passed, 0 failed
~~~

Existing PE contract:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

Result:

~~~text
96 tests, 96 passed, 0 failed
~~~

P016/P017 device, permission and recovery contract:

~~~sh
node --test tests/device-changes-resolution.test.js
~~~

Result:

~~~text
69 tests, 69 passed, 0 failed
~~~

Combined focused result:

~~~text
180 tests, 180 passed, 0 failed
~~~

The P018 harness executes the actual production template, runtime and window-owner modules in independent browser-like VM page contexts sharing one synthetic popup broker. It covers unique owner and popup tokens, UUID fallback, normal/Incognito-like simultaneity, dirty independence, one PE/pending slot, clean replacement, Save, Discard, Cancel, foreign-window return, wrong tokens/caller, replaced popup, stale reload, same-filename isolation, generated-runtime compilation and P017/P016 open gates.

The existing PE runtime harness executes actual generated code and verifies transient identity exposure, bridge-only Save, transport-token removal from outgoing payloads, one `beforeunload` registration, disconnected-opener Save rejection, retained dirty state and local Cancel/Discard behavior.

Static and generated validation:

- all 61 production JavaScript files under `js/`: passed `node --check`;
- both changed test JavaScript files: passed `node --check`;
- production runtime builder plus `new Function(...)`: passed for a 41,598-character generated program;
- `git diff --check`: passed;
- final name/stat/status review is required again immediately before commit.

`node tools/pocket-check.js` and `npm run check` were not run.

### Physical browser acceptance

Murray's physical browser acceptance remains required. The exact 24-step disposable normal/Incognito checklist is in `docs/PE_PERSISTENCE_CONTRACT.md`, section 20. It covers simultaneous responsiveness, dirty independence, Incognito Cancel/Discard/Save, owner-local pending behavior, exact-file Save, stale popup rejection after reload, local Discard and fresh-page replacement.

Use disposable files only. Do not use Murray's real truth file for simultaneous-session testing. Stop immediately if Chrome becomes sluggish or unresponsive, and do not intentionally force another freeze or reboot.

### Completion boundary

Final parent SHA: `3a50f8254e970c9687af680559b9a2307044bfb8`

The exact-title P018 commit containing this report must be pushed directly to `origin/main`, fetched again, verified as the only child of the parent above and confirmed with a clean worktree before the task response may report COMPLETE.

## POCKET TASK P017 — SHOW PENDING FILE PERMISSION OVER THE ACTIVE TREE

Title: Show pending file permission over the active tree

Status: implementation, documentation and focused local validation are complete against the exact accepted P016 baseline. The exact-title commit containing this report must still be pushed and confirmed on `origin/main` before P017 can be reported complete.

Commit title:

- `P017 Show pending file permission over active tree`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched starting `origin/main`: `eae949c6a11b8d8d7058072cda4d5b31cbc98f63`
- Baseline title: `P016 Handle file and device changes safely`
- Implementation date: 2026-07-26
- Branch: `main`
- Local `main`, `HEAD` and `origin/main` were identical, with zero ahead/behind divergence and a clean worktree before implementation.
- No personal Pocket truth file, browser localStorage contents, real Vault, uploaded JSON or real File System Access handle was inspected.
- No truth-file schema migration, dependency, autosave, background write, file watcher, cloud route, PE implementation or package script was added.

P017 corrects the selected-file permission step only. It preserves P016's meaningful FILE/DEVICE/BASE comparison and detached adoption model, P012 PE source identity and revision protections, and all accepted P006 to P014 editor behaviour.

### Confirmed root cause

The selected-file loader correctly retained a candidate handle in `pendingPocketFileHandle` when Chrome reported `prompt`. Its only Continue/Cancel UI was the permission branch in `buildPocketFileGate()`. `renderTree()` builds that gate only when `canShowPocketTree()` is false, so an already-active File A kept its tree and made File B's permission choice invisible. `canModifyPocket()` also remained true for A while B was pending.

The earlier async Continue path captured B, awaited permission, then cleared the shared pending state before B was read or parsed. It had no busy guard, request token or source-session recheck. Cancellation, duplicate activation or another document-session adoption could therefore leave stale async work able to load B.

### Implementation contract

`js/pocket-io-browser.js` remains the canonical owner of file opening, pending permission and handle adoption. It now provides `isPocketFilePermissionPromptOpen()` as the shared gate and owns one accessible permission dialog with the approved title, body, filename, support text, Continue and Cancel controls.

While the dialog is open:

- File A's handle, tree, document session, PE identity, operations and dirty state remain authoritative;
- File B is only a pending object-identity candidate and has no write authority;
- the visible background is inert and focus remains inside the dialog;
- `canModifyPocket()` returns false;
- tree mutation, bulk delete, undo/inline commit, Main Save, PE open/apply, popout, PiP return, Create New, another Open action, command palette and P016 review adoption are gated; and
- no candidate or active-file write is initiated.

Continue is single-flight. It captures a monotonic request token and the active source session, asks only B for read/write permission, and retains A as active while permission, `getFile()`, text reading, parsing and normalisation complete. The token and source-session check run after asynchronous boundaries and immediately before adoption. Cancel or Escape invalidates the token, so a later permission result cannot load B.

Only a valid B reaches the existing `setPocketFileSession()` adoption boundary. The permission dialog and its inert state are removed immediately before that synchronous adoption, then the document session rotates. If the new selected file differs from browser-held changes, the unchanged P016 owner opens next and receives focus with its existing Combine eligibility.

Denial, dismissal, permission failure, read failure, invalid JSON or another rejected load clears only B's pending state and reports:

> That file was not opened. Your current Pocket file is unchanged.

Cancel or Escape reports:

> Open cancelled. Your current Pocket file is unchanged.

A routine successful write/session refresh for already-active A does not dismiss a pending B choice. A genuine session rotation revokes it. Matching filenames never substitute for handle identity.

The same modal is used when no file is active. The ordinary no-file gate remains behind it and cannot become editable until a valid file is adopted. The permission-specific branch and Continue/Cancel controls were removed from `buildPocketFileGate()`, leaving one UI and one pending owner.

### Files changed

Production and shell:

- `index.html`
- `file-permission.css`
- `sw.js`
- `js/pocket-state.js`
- `js/pocket-render.js`
- `js/pocket-io-browser.js`
- `js/pocket-device-changes.js`
- `js/pocket-overlays-init.js`
- `js/pocket-history-status.js`
- `js/pocket-multi-select.js`
- `js/pocket-node-popout-editor.js`

Tests and documentation:

- `tests/device-changes-resolution.test.js`
- `docs/DEVICE_CHANGES_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No PE generated-runtime source, package file, fixture, workflow or unrelated application surface changed.

### Focused validation

Node:

~~~text
v23.11.0
~~~

Existing PE regression command:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

Result:

~~~text
94 tests, 94 passed, 0 failed
~~~

Extended P016/P017 focused command:

~~~sh
node --test tests/device-changes-resolution.test.js
~~~

Result:

~~~text
69 tests, 69 passed, 0 failed
~~~

Combined focused result:

~~~text
163 tests, 163 passed, 0 failed
~~~

The 15 P017 cases execute actual production file-session, selected-file load, tree-action, canonical PE, Save, PiP and P016 comparison paths in controlled VM contexts. They cover active A/pending B ownership, all required gates, delayed single-flight adoption, denial/dismissal/failure, button and Escape cancellation, read and parse failure, initial no-file opening, valid P016 hand-off, same-name handle identity, dialog semantics and focus containment, retirement of the duplicate gate UI, in-flight cancellation revocation, preservation of a pending candidate across a routine active-file session refresh, rejection of a concurrent already-granted candidate and prevention of an in-flight File A save falling through to a picker after File B becomes pending.

Static validation:

- every production JavaScript file under `js/`: passed `node --check`;
- changed test JavaScript and `sw.js`: passed `node --check`;
- every committed JSON fixture: passed `JSON.parse`;
- Markdown code fences: balanced;
- `git diff --check`: passed;
- final diff review: only the task-relevant files listed above changed.

`node tools/pocket-check.js` and `npm run check` were not run.

### Physical browser acceptance

Murray's physical browser acceptance remains required. The exact 22-step disposable A/B checklist is in `docs/DEVICE_CHANGES_CONTRACT.md`, section 18. It covers a pending B over dirty A, filename display, interaction blocking, Cancel, Continue and Chrome grant, P016 hand-off, denial, invalid JSON, a private-window device copy and valid Combine ancestry.

### Completion boundary

Final parent SHA: `eae949c6a11b8d8d7058072cda4d5b31cbc98f63`

The exact-title P017 commit containing this report must be pushed directly to `origin/main`, fetched again, verified as a child of the parent above and confirmed with a clean worktree before the task response may report COMPLETE.

## POCKET TASK P016 — HANDLE FILE AND DEVICE CHANGES SAFELY

Title: Handle file and device changes safely

Status: implementation, documentation and focused local validation are complete against the exact P015 baseline. The resulting Git commit uses the exact title below; its SHA and remote confirmation are reported by the completion response because a commit cannot contain its own SHA.

Commit title:

- `P016 Handle file and device changes safely`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched GitHub-visible starting `origin/main`: `b5733cf7854dcae166270f72f619e4e626de9f14`
- Baseline title: `P015 Audit architecture and failure modes`
- Implementation date: 2026-07-26
- Branch: `main`
- Local `main`, `HEAD` and `origin/main` were identical, with zero ahead/behind divergence and a clean worktree before implementation.
- PR #6 was not merged, cherry-picked, modified or used.
- P016 resolves P015-F01. It changes recovery and browser-held device adoption only. It does not address Vault ownership, Document PiP return ownership, destructive import normalisation or external-file freshness.
- No personal Pocket truth file, real browser handle, browser localStorage contents or uploaded user JSON was inspected.
- No truth-file schema migration occurred.

### Product behaviour

When a selected file and the current browser safety copy differ in meaningful content, Pocket now presents one accessible decision screen with the approved choices:

- Use the file;
- Use the device changes;
- Combine what can be combined; and
- Review the differences.

The comparison is content-based. Export timestamps, generated guard values, node `updatedAt` values without a content change and object key order do not create a false difference. User content, including IDs, parents, order, labels, Notes, first-class editor metadata, generic extras, root/data extras and tombstones, remains meaningful.

Use the file retains the selected file handle and tree and performs no write. It clears the current safety entry only after the device version is preserved in the bounded earlier-version trail. A storage failure leaves the decision open and both versions unchanged.

Use the device changes and every combined result clear the selected handle, rotate the document session and open an explicit `detachedDeviceChanges` document. The tree remains visible, editable and dirty, but has no authority to write the previously selected file. Before device adoption, Pocket stores a canonical safety document matching the exact normalised tree it will display. If that replacement cannot be made safely, adoption fails closed. Save uses the existing picker path. Cancellation leaves the detached state and browser safety intact. A successful picked-file write adopts only that destination.

The same decision owner handles ordinary file opening, manual previous-version review and Phone mode. Phone mode no longer silently adopts browser-held content.

### Comparison and combination owner

`js/pocket-device-changes.js` owns deterministic JSON-safe comparison, stable BASE fingerprinting, direct review, conservative combination eligibility, per-field three-way combination, unresolved choices, Keep both subtree duplication and final structural validation.

Combination requires:

- a stored normalised BASE payload;
- a matching deterministic BASE fingerprint;
- credible shared node ancestry;
- unambiguous supported document shapes with no raw-versus-normalised content difference;
- valid node relationships; and
- bounded processing size.

The merge combines independent node fields, root-extra keys, data-extra keys and tombstone entries. Divergent values require an explicit choice. Manual node-field choices update `updatedAt` from the content sources which actually contribute to the result. Keep both retains the FILE subtree under its IDs, duplicates the DEVICE subtree and moved descendants under fresh IDs, reconciles overlapping source copies in either resolution order, deterministically places multiple sibling duplicates even when the original FILE orders are equal, restores superseded FILE tombstones and avoids duplicate nested duplication. Delete-versus-edit provides Keep the item or Leave it removed, not Keep both. Ancestor choices are presented before dependent descendants, removing an ancestor covers only descendants also removed by that side, and a descendant retained or moved by the deleting side keeps that safe placement while independently merged content survives.

Before adoption, the complete result is round-tripped through the actual active node and root-extra normalisers without changing either source. If that check would drop or truncate meaningful content, including a union of otherwise valid extras which exceeds the current persistence budgets, combination fails closed.

Pre-P016 and pressure-degraded safety entries without BASE remain usable for Use the file, Use the device changes and two-version review. Combination is disabled with:

> Pocket doesn’t have the earlier shared version needed to combine these safely.

### Baseline, browser changes and save coverage

`state.documentBaseline` records the last full payload successfully loaded from or written to a truth file. It is not advanced by comparison, detached adoption, picker cancellation or a failed write.

The complete DEVICE payload remains the authoritative browser-held content. Browser safety may store an optional `pocket.deviceChanges.v1` envelope beside it, never inside a node or truth JSON. The envelope records:

- BASE fingerprint and source labels;
- capture time and source filename;
- deterministic semantic change descriptors;
- one stable monotonic sequence per meaningful transition; and
- the highest pending sequence.

Descriptors cover add, title, Notes, Outline, first-class metadata, generic extras, urgent, copy-context, move, sibling order, node/subtree deletion, root extras, data extras and tombstones. Descriptors identify semantics without duplicating full before/after content. They do not reconstruct or override content. BASE, FILE and DEVICE remain the only authorities for comparison and combination.

The sequence high-water mark survives browser safety rewrites, detached adoption, PiP snapshots and Save retries. At Save start Pocket freezes the truth payload and captures the highest covered sequence. An in-flight covered transition cannot be discarded. After confirmed persistence, Pocket:

- establishes BASE from the normalised meaningful document corresponding to the exact payload written;
- removes only operations at or below the captured sequence ceiling;
- retains higher-sequence operations as dirty;
- stores the current visible DEVICE against the newly written BASE; and
- emits a new browser envelope containing only higher-sequence descriptors.

The browser key `pocketLite.deviceChange.sequence.v1` persists only the monotonic sequence high-water. It contains no user content and is never serialised into truth JSON.

A failed, cancelled, stale-session or otherwise rejected Save clears no sequence and advances no BASE.

Valid zero-node documents remain complete DEVICE safety payloads and can be opened, combined and explicitly saved. Deleting the final item therefore remains dirty and leaves Save available. Timestamped but tree-less corrupt safety objects are rejected rather than being mistaken for an empty Pocket document.

While the details editor is open, continued typing refreshes the complete DEVICE payload without allocating a new sequence for every keystroke. If a draft included in an in-flight write is later continued or cancelled, Pocket retains a higher-sequence transition and safety copy for the visible post-write state.

Under storage pressure Pocket prioritises the full DEVICE payload. It first tries DEVICE plus optional BASE and change metadata, then retries with optional BASE and `pocket.deviceChanges.v1` metadata omitted. If DEVICE-only storage also fails, adoption fails closed unless the existing current entry already matches the exact visible document. Missing, incomplete or misleading change metadata never overrides DEVICE.

P016 does not broaden or repair the existing selected-file normaliser. The established `portal.export.v1` root/data precedence and other destructive-normalisation risks remain P015 findings. A raw selected file or device entry which differs meaningfully after current normalisation, or has conflicting top-level and nested tree copies, cannot be combined automatically. Direct device adoption narrowly preserves safe raw data extras while ensuring its stored safety copy matches the visible canonical tree.

`pocket.deviceChanges.v1` is a browser-only safety schema. It is absent from the top-level and nested truth payloads and does not constitute a truth-file schema migration.

### Files changed

Production and shell:

- `index.html`
- `device-changes.css`
- `sw.js`
- `js/pocket-device-changes.js`
- `js/pocket-editor-copy.js`
- `js/pocket-editor-handoff.js`
- `js/pocket-editor-rebase.js`
- `js/pocket-history-status.js`
- `js/pocket-import.js`
- `js/pocket-state.js`
- `js/pocket-storage.js`
- `js/pocket-io-browser.js`
- `js/pocket-phone-mode.js`
- `js/pocket-overlays-init.js`

Tests and documentation:

- `tests/pe-persistence-contract.test.js`
- `tests/device-changes-resolution.test.js`
- `docs/DEVICE_CHANGES_CONTRACT.md`
- `docs/P015_ARCHITECTURE_SECURITY_AUDIT.md`
- `docs/CODEX_REPORT.md`

The PE harness loads the new active `pocket-device-changes.js` owner in actual `index.html` order and now asserts the restored recovery operation's positive sequence as well as its type. No existing production contract was weakened. No package file, dependency, truth-file schema, PE generated runtime or personal data file changed.

### Focused validation

Node:

~~~text
v23.11.0
~~~

Existing PE regression command:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

Result:

~~~text
94 tests, 94 passed, 0 failed
~~~

P016 focused command:

~~~sh
node --test tests/device-changes-resolution.test.js
~~~

Result:

~~~text
54 tests, 54 passed, 0 failed
~~~

Combined focused result:

~~~text
148 tests, 148 passed, 0 failed
~~~

The P016 suite executes actual comparison, operation-history, storage, file-session and canonical PE apply/save production source with synthetic documents, controlled VM contexts, in-memory localStorage and instrumented fake handles. It covers meaningful comparison, no-BASE review, BASE validation and pressure fallback, ambiguous and lossy-input rejection, three-way combination, differences requiring a choice, Keep both and tombstones, structural rejection, exact visible-device safety, detached session rotation, A/B same-name and different-name write isolation, picker cancellation, successful picked-destination adoption, PE source-identity rejection and detached PE Save, Phone/manual routing and user-facing focus/keyboard wording.

The 54 focused cases also cover deterministic descriptors for every supported mutation category, stable per-transition sequences, high-water restoration, full-DEVICE authority over misleading metadata, no truth-JSON leakage, DEVICE-first pressure fallback, valid zero-node documents, corrupt tree-less safety rejection, continued-draft refresh, PiP decision isolation, moved-out DEVICE branches under Keep both, duplicate-order Keep both permutation stability, contributor-correct manual-choice revisions, active-normaliser extras-budget rejection, dependency-safe parent/descendant delete-versus-edit choices, ancestor restoration, and sequence-ceiling handling of newer edits during a delayed write.

Static validation:

- all production JavaScript under `js/`: passed `node --check`;
- changed test JavaScript and `sw.js`: passed `node --check`;
- every committed JSON fixture: passed `JSON.parse`;
- Markdown code fences: balanced;
- `git diff --check`: passed;
- final diff review: only the task-relevant production, focused test and documentation files listed above changed.

`node tools/pocket-check.js` and `npm run check` were not run.

### Physical browser acceptance

Murray's physical browser acceptance remains required. The exact 32-step disposable-file checklist is in `docs/DEVICE_CHANGES_CONTRACT.md`, section 17.

It covers file/device decisions, cancellation safety, same-name and different-name A/B files, detached Save to a new destination, automatic and choice-required combination, Keep both with descendants/Notes/Outline, pre-P016 no-BASE handling, review, Phone mode, stale PE rejection and reopen-after-save persistence. The contract adds a separate delayed-write save-race rehearsal without changing the required 32 numbered steps.

### Completion boundary

Final parent SHA: `b5733cf7854dcae166270f72f619e4e626de9f14`

The exact-title P016 commit containing this report must be pushed directly to `origin/main`, fetched again, verified as a child of the parent above and confirmed with a clean worktree before the task response may report COMPLETE.

## POCKET TASK P015 — AUDIT ARCHITECTURE, SECURITY AND FAILURE MODES

Title: Audit architecture, security and failure modes

Status: report-only audit complete against the exact P014 baseline. The audit found six reachable RED ownership/data-integrity paths, fourteen YELLOW reliability, availability, hardening or architectural gaps, ten confirmed GREEN boundaries and six INFORMATIONAL items. No implementation or runtime behaviour changed.

Commit title:

- `P015 Audit architecture and failure modes`

### Baseline and scope

- Repository: `MSHND/notespace`
- Fetched GitHub-visible starting `origin/main`: `29224a3218a7dd12c40ac5d0503394282e7624d3`
- Baseline title: `P014 Retire legacy node.pe shadow`
- Branch: `main`
- Local `main`, `HEAD` and `origin/main` were identical, with zero ahead/behind divergence and a clean worktree before the audit.
- PR #6 was not merged, cherry-picked, modified or used.
- The audit inspected the active P014 repository rather than relying on older handovers.
- Scope covered 95 tracked files, 60 production JavaScript files, active `index.html` load order, global owners and wrappers, document adoption, truth writes, recovery, PiP, Vault, normalisation, generated code, DOM and messaging surfaces, browser storage, size handling, tests, CI, dependencies and network surfaces.
- No personal Pocket truth file, real Vault, browser localStorage, IndexedDB contents or uploaded user JSON was inspected.
- No external scanner or service received repository content.

### Files changed

- Added `docs/P015_ARCHITECTURE_SECURITY_AUDIT.md`
- Updated `docs/CODEX_REPORT.md`

No production JavaScript, HTML, CSS, package, test, fixture, workflow, schema, runtime configuration or existing architecture/migration document changed.

### Audit method and commands

The audit used line-numbered active-source inspection, repository-wide symbol/sink searches, script-order and global-owner tracing, actual-source Node VM probes with synthetic inputs, focused test review and execution, syntax checks and Git validation.

Commands included:

- `git fetch origin`
- `git status --short --branch`
- `git rev-parse HEAD`
- `git rev-parse origin/main`
- `git log --oneline --decorate`
- `git ls-files`
- `gh run list --repo MSHND/notespace --branch main --limit 10 --json databaseId,workflowName,headSha,status,conclusion,event,createdAt`
- targeted `rg`, `nl`, `sed` and `find` inspections
- `node --version`
- `node --test tests/pe-persistence-contract.test.js`
- `find js -name '*.js' -print0 | xargs -0 -n1 node --check`
- separate `node --check` runs for `sw.js`, the focused test and repository tools
- `git diff --check`
- `git diff --name-only`
- `git diff --cached --check`
- `git diff --cached --name-only`

`node tools/pocket-check.js` and `npm run check` were not run.

### Validation result

- Node: `v23.11.0`
- Focused command: `node --test tests/pe-persistence-contract.test.js`
- Focused result: 94 tests, 94 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo
- Production JavaScript syntax: all 60 files under `js/` passed `node --check`
- Relevant non-production JavaScript syntax: `sw.js`, `tests/pe-persistence-contract.test.js`, `tools/pocket-check.js` and `tools/pocket-mod-index.js` passed `node --check`
- Markdown: required P015 headings are present once and in order; stable finding IDs are unique; tables were reviewed; there are no unbalanced code fences
- Git: `git diff --check` passed
- Final changed-file review: documentation only

### Finding counts

- RED: 6
- YELLOW: 14
- GREEN: 10
- INFORMATIONAL: 6

### RED findings

1. `P015-F01` Recovery adoption can overwrite the wrong active truth file
2. `P015-F02` Opening a Vault retains the previous JSON truth handle
3. `P015-F03` Document PiP return is not bound to its opening document
4. `P015-F04` Destructive load normalisation is silent and later Save commits the loss
5. `P015-F05` Root-shape recognition can accept valid content as an empty editable document
6. `P015-F06` No save-time disk freshness check permits last-writer-wins loss

### Current-risk summary

Ordinary single-file Notes and Outline editing remains acceptable when one valid current Pocket file is used in one tab. P011 unsupported-editor preservation, P012 PE source/revision binding and lossless preflight, P013 independent Notes/Outline semantics, P014 `node.pe` retirement, explicit file gating, queued handle checks and canonical popup escaping were confirmed.

The unsafe boundaries are whole-document adoption and hostile/ambiguous input, not the accepted PE content model:

- recovery, Vault and returned PiP can replace in-memory state while keeping a different writable handle;
- post-load external or second-tab changes have no save-time freshness check;
- destructive node/root normalisation can become permanent on a later explicit Save;
- recovery can fail, be cleared during a save race, or remain stale after Undo without accurately preserving the newest visible tree;
- Vault envelope validation, revision and plaintext-recovery contracts are incomplete;
- the loaded legacy editor/message layer remains security and maintenance debt;
- several visible Edit controls lose selected-node identity in capture routing; and
- tracked CI does not run the 94-case focused source suite.

The report distinguishes these from dormant loaders, dormant legacy popup injection, documentation drift, CSP deployment uncertainty and disproved prototype-pollution concerns.

### Recommended next task

The recommended next task is **P016: Bind recovery restore to document ownership**.

It should cover automatic recovery offer, manual previous-version restore and Phone-mode automatic restore for different-name and same-name A/B sources. It must decide whether cross-source recovery is rejected, opened read-only or allowed only after an explicit destination confirmation. No implementation prompt or approval is assumed by P015.

### Completion boundary

The detailed evidence, line references, mitigations, coverage gaps, ownership/storage/security maps and provisional P016–P026 sequence are in `docs/P015_ARCHITECTURE_SECURITY_AUDIT.md`.

This report remains documentation-only. No truth-file migration occurred, no personal data was accessed and no production or test behaviour changed. Completion is gated on committing with the exact title above, pushing to `origin/main`, fetching again, proving the pushed commit's parent is the P014 baseline, confirming only the two permitted documentation files changed and confirming the final worktree is clean.

## POCKET TASK P014 — RETIRE THE LEGACY NODE.PE SHADOW

Title: Retire legacy node.pe shadow

Status: legacy `node.pe` retired from the active node model, search and every normalised adoption route. Focused automated validation is complete; Murray's physical browser acceptance remains.

Commit title:

- `P014 Retire legacy node.pe shadow`

### Baseline and product decision

- Repository: `MSHND/notespace`
- GitHub-visible, fetched and exact starting `origin/main`: `2185b776089106fd80c95581abf52a40426cde47`
- Baseline title: `P013 Show Outline content indicator`
- Local branch: `main`
- Local `main` matched `origin/main`, with a clean worktree and zero ahead/behind commits before implementation.
- Superseded PR #6 was not merged, cherry-picked, modified or used as a working branch.
- Murray had manually retained the legacy-only pe content he wanted and selected full retirement rather than preservation, promotion, synchronisation or a compatibility view.
- No personal, uploaded or active Pocket truth JSON was inspected, copied, modified or written.

### Retirement semantics

The active model now has three PE content owners:

- `node.label` for the shared title;
- `node.details` for Notes; and
- accepted `node.editor.outline` for Outline.

`node.pe` is no longer content or first-class metadata. The canonical `normaliseNodes()` owner in `js/pocket-import.js` omits it on every normalised load/adoption route. `pe` remains in `RESERVED_NODE_KEYS`, so malformed, scalar, array, cyclic, known-schema, unknown-schema, extension-rich and very large values cannot reappear through generic extras. `node.editor` remains an uncapped opaque first-class field and retains the P011-P013 recognition and preservation contract.

`applyLoadedState()` no longer creates a `pocket.pe.v1` shadow from Notes. The retired synthesis helpers and pe-specific metadata constants/normalisers are removed. Loading Notes leaves Notes, loading Outline preserves editor plus any independent Notes, and loading a title-only or pe-only node leaves an ordinary title-only node.

Retirement is load-only normalisation, not a write-on-load migration:

- no operation is recorded;
- Pocket is not marked dirty;
- no truth or backup file is written;
- no picker opens;
- the active file session is not changed merely because pe was omitted; and
- unchanged Save retains its established `no-changes` behavior.

After one real current user edit, the normal controlled explicit save naturally writes the already-normalised top-level and nested trees without `pe`. Newly built local-safety snapshots, safety-trail entries, PiP snapshots, auto-cache, last-save snapshots and truth/Vault payloads also omit `pe`.

### Search, indicators, copy context and PE

The obsolete `js/pocket-filter-pe-search.js` wrapper and its `index.html` entry are removed. Search stays read-only and includes path, label, Notes, accepted supported Outline text and existing task/profile fields. It never reads pe title, text or rows and no longer temporarily mutates `node.details`.

`js/pocket-render.js` now shares one `supportedOutlineForNode()` helper between accepted Outline search and the P013 content indicator. This keeps unsupported or malformed editor shapes out of both interpretation paths. Notes retain badge-tooltip precedence.

`js/pocket-node-popout-model.js` no longer checks pe cloneability or makes cyclic pe data read-only. PE opening and saving depend only on current title, Notes and editor data. A pe-only legacy node opens as empty editable Notes, shows no content badge, does not match pe-only searches and uses the label for copy context.

### Files changed and deleted

Production:

- `index.html` — removes the retired search wrapper from the active script list.
- `js/pocket-data.js` — keeps `pe` reserved with an explicit retirement comment.
- `js/pocket-editor-metadata.js` — keeps only first-class editor ownership and removes pe constants, normalisers and exposure.
- `js/pocket-import.js` — makes central node normalisation omit `pe` on every adoption route.
- `js/pocket-storage.js` — removes Notes-to-pe synthesis and its dormant helpers.
- `js/pocket-node-popout-model.js` — removes the remaining active pe cloneability/editability dependency.
- `js/pocket-render.js` — removes reliance on the deleted wrapper and shares exact supported-Outline recognition for search and indicators.
- `js/pocket-pe-import-preserve.js` — corrects its visible-version ownership comment without removing unrelated active behavior.
- Deleted: `js/pocket-filter-pe-search.js`.

Tests and documentation:

- `tests/pe-persistence-contract.test.js`
- `docs/PE_PERSISTENCE_CONTRACT.md`
- `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/MIGRATION_STATUS.md`
- `docs/CODEX_REPORT.md`

The generated PE runtime, template, editor schema, root schema, truth-write owner, file-session protections, PE apply/save owner, fixtures and dependencies did not change.

### Focused validation

Node:

~~~text
v24.14.0
~~~

Focused command:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

Result:

~~~text
tests 94
pass 94
fail 0
cancelled 0
skipped 0
todo 0
~~~

The suite executes actual active production source with synthetic fixtures, controlled VM contexts, in-memory handles and instrumented DOM/storage/write surfaces. P014 coverage includes:

1. details-only, Outline-only, combined and pe-only loading;
2. matching and conflicting current content versus stale pe;
3. every required pe shape, including cyclic and above-limit objects;
4. unchanged uncapped editor preservation and unsupported-editor read-only behavior;
5. generic-extras budget and reserved-key behavior;
6. ordinary, alternate-root, change-log, local-safety, trail, auto-cache, PiP and Vault adoption;
7. zero-operation/no-write loading and unchanged Save;
8. one real edit followed by a controlled successful explicit export without pe in either tree;
9. newly built browser recovery and truth/Vault representations without pe;
10. label, Notes, supported Outline, task and profile search with pe fields excluded and no temporary mutation;
11. Notes/Outline indicators, pe-only absence, tooltip precedence and render immutability;
12. details-first copy and label fallback;
13. current PE opening/saving plus the complete P006-P013 identity, non-lossy, retry and runtime regressions; and
14. a focused source scan proving the wrapper and pe data-path owners are gone.

Targeted static checks:

- `node --check` passed for every changed JavaScript file and the focused test file.
- `git diff --check` passed.
- The generated PE runtime did not change, so no additional generated-source validation was required; its existing build, `new Function(...)` compilation and controlled runtime cases remained green within the 94-test suite.
- `node tools/pocket-check.js` was not run.
- `npm run check` was not run because it invokes the prohibited checker.

### Remaining CURRENT-RISK items

P014 removes the former load-time pe-synthesis risk. Four existing characterisations remain:

- duplicate non-empty block IDs retained in the detached read view, with explicit changed Outline save blocked;
- read-view slicing at row 401, with raw preservation and changed Outline rejection;
- read-view slicing after 4,000 block-text characters, with raw preservation and changed Outline rejection; and
- `portal.export.v1` top-level precedence dropping nested-only data extras.

### Physical browser acceptance checklist

1. Load the ordinary current truth file.
2. Confirm normal Notes nodes still open and save normally.
3. Confirm Outline nodes still open and save normally.
4. Search for known Notes text.
5. Search for known Outline text.
6. Confirm a stale legacy-only pe term no longer appears in search.
7. Make one harmless current edit and Save.
8. Refresh and reopen the truth file.
9. Confirm current Notes and Outline remain intact.
10. Confirm no unexpected content badges or empty legacy content appear.
11. Cancel or fail a save, confirm PE remains dirty/open, then retry successfully.
12. Recheck same-node-ID cross-file rejection if practical.

## POCKET TASK P013 — TREE INDICATOR CORRECTION

Title: Show Outline content in the tree indicator

Status: render-only P013 browser-acceptance correction implemented and validated. Murray's physical browser acceptance remains.

Commit title:

- `P013 Show Outline content indicator`

### Baseline and scope

- Repository: `MSHND/notespace`
- GitHub-visible and fetched `origin/main`: `b5a2efabd5cc30b689e012e336339a76e6b3356f`
- Parent title: `P013 Separate Notes and Outline content`
- Local branch: `main`
- Local `main` matched `origin/main`, with a clean worktree and zero ahead/behind commits before implementation.
- Superseded PR #6 was not merged, cherry-picked, modified or used as a working branch.
- No personal or active Pocket truth file was inspected or modified.
- The generated PE runtime, PE model, editor, persistence routes, schemas, search rule and copy-context implementation did not change.

### Correction

The existing main-tree `detailBadge` with visible text `...` now means that the node contains meaningful additional content beyond its title:

- meaningful normalised Notes in `node.details`; or
- a supported meaningful `pocket.nodeEditor.v1` Outline.

Exactly one badge renders when either or both sections are meaningful. Notes keep the existing first-line tooltip and take precedence when both sections exist. An Outline-only node uses its first nonblank cleaned Outline row, limited to 180 characters. A structural-only meaningful Outline uses `Has outline`.

No badge renders for absent content, `editor: null`, an empty Outline array, or rows containing only blank depth-0 uncollapsed placeholders. Unsupported and malformed editor metadata is not interpreted; meaningful Notes may still produce the normal badge.

`treeContentIndicatorForNode()` is a small derived render helper in `js/pocket-render.js`. It calls the already-loaded `PocketEditorMetadata.classifyEditorMeta()` and `isMeaningfulOutline()` contract. Rendering does not mutate the node or raw editor metadata, create Notes or editor data, record an operation, write browser recovery state, export truth, open a picker or alter file-session identity.

### Files changed

- `js/pocket-render.js` — derives the single existing badge from meaningful Notes or a supported meaningful Outline.
- `tests/pe-persistence-contract.test.js` — executes the actual renderer with a controlled DOM/state harness and covers every required indicator, preservation, save/rerender, search, copy and row-listener case.
- `docs/PE_PERSISTENCE_CONTRACT.md` — records the corrected stable tree-indicator contract.
- `docs/CODEX_REPORT.md` — records this follow-up without truncating prior P010–P013 history.

No runtime, model, editor, persistence, schema, fixture, dependency, `index.html`, personal JSON or retired PE file changed.

### Validation

Node:

~~~text
v24.14.0
~~~

Focused command:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

Result:

~~~text
tests 87
pass 87
fail 0
cancelled 0
skipped 0
todo 0
~~~

The new actual-source renderer cases prove:

1. Notes-only renders one badge with the first Notes line.
2. Textual Outline-only renders one badge with the first nonblank cleaned Outline row.
3. Notes plus Outline renders one badge and the Notes tooltip wins.
4. Blank depth and blank collapsed structural Outlines each render one `Has outline` badge.
5. Absent, empty and blank-placeholder Outline states render no badge.
6. Unsupported and malformed editor metadata render no badge without Notes, while Notes still supplies the normal badge.
7. Every rendered source node, state node, operation list, browser storage and write/picker surface remains unchanged.
8. A successful Outline save adds the badge on rerender; a successful clear removes it; Notes remain absent and independent.
9. Outline text remains searchable, copy context remains details-first, and click, double-click and context-menu listener ownership remains present.

Targeted static checks:

- `node --check js/pocket-render.js` passed.
- `node --check tests/pe-persistence-contract.test.js` passed.
- `git diff --check` passed.
- The unchanged generated PE runtime continued to build, compile and pass its existing controlled tests within the 87-test suite.
- `node tools/pocket-check.js` was not run.
- `npm run check` was not run because it invokes the prohibited checker.

### Physical browser acceptance checklist

1. Confirm a Notes-only node shows `...`.
2. Confirm an Outline-only node shows `...`.
3. Confirm a node with both sections still shows only one `...`.
4. Hover Notes content and confirm the first Notes line appears.
5. Hover Outline-only content and confirm the first nonblank Outline row appears.
6. Clear an Outline-only node's Outline, save, and confirm the badge disappears.
7. Confirm an ordinary title-only node still has no badge.

## POCKET TASK P013

Title: Separate Notes and Outline content

Status: independent Notes/Outline sections, corrected structural-only Outline preservation, P012 non-lossy safety and focused automated validation implemented. Murray's physical browser acceptance remains.

Commit title:

- `P013 Separate Notes and Outline content`

### Baseline

- Repository: `MSHND/notespace`
- GitHub-visible and fetched `origin/main`: `70e1cd3a01ea661465c25a1c1b502f86c8d6804b`
- Baseline title: `P012 Bind PE saves to source identity`
- Local branch: `main`
- Local `main` matched `origin/main`, with a clean worktree and zero ahead/behind commits before implementation.
- PR #6 was inspected only as conceptual context. It was not merged, cherry-picked, checked out, modified or applied wholesale.
- No personal or active Pocket truth file was inspected or modified.

### Implemented current behavior

- The visible controls are **Notes** and **Outline**, not Text and Outline modes.
- The shared title truth remains `node.label`.
- Notes truth remains `node.details`.
- Outline truth remains accepted `node.editor` using the unchanged `pocket.nodeEditor.v1` schema.
- No `node.notes`, root-schema change or editor-schema change was introduced.
- A node may have Notes only, Outline only, both sections or neither.
- Accepted Outline opens the Outline tab; otherwise Notes opens. The selected tab is runtime-only.
- Tab switching does not convert, project, mirror or synchronise content and does not mark PE dirty.
- Opening Outline on a Notes-only node shows one fresh blank depth-0 uncollapsed runtime row without copying Notes, recording an operation or creating editor metadata.
- Every canonical Save submits both independent sections through `PocketNodePopoutEditor.applyAndSave()`, regardless of the visible tab.
- The main-window owner compares title, Notes and Outline independently and mutates only sections that actually changed.
- Title-only and Notes-only saves preserve the unchanged raw supported editor object, including top-level and row extensions.
- Outline-only saves preserve Notes exactly and do not create an indented Notes projection.
- Both sections may be edited before one Save and persist together with one operation and one `updatedAt` change.
- Clearing Notes removes only `details`; clearing Outline removes only `editor`; clearing both removes both optional content fields.
- Existing details on older Outline nodes remain Notes exactly as stored. No equality heuristic or migration runs.
- Structured multiline paste remains the sole use of the P008 indentation parser.
- Compatibility popouts no longer contain Notes-to-Outline or Outline-to-Notes conversion helpers, and their unbound save path continues to fail closed at P012 identity validation.

### Meaningful Outline and raw preservation contract

`PocketEditorMetadata.isMeaningfulOutline()` is now the shared rule used by current-v1 recognition and the save/comparison boundary. An Outline is meaningful when at least one row has:

- nonblank text;
- depth greater than zero; or
- `collapsed === true`.

Null, an empty array, and arrays made only of blank depth-0 uncollapsed placeholders represent absent Outline. Therefore blank structural rows at depth 1, blank collapsed rows and hierarchies containing blank structural rows remain meaningful.

When the submitted editable Outline is semantically unchanged, `prepareSave()` preserves the existing raw `node.editor` object rather than canonicalising it. This applies to Notes-only and title-only saves, including stored raw cases whose editing view hides row 401, text after character 4,000 or duplicate IDs.

When Outline actually changes or is deliberately cleared, the existing P012 stored-raw scan and incoming non-lossy validation both run before mutation. Clearing to empty incoming content cannot bypass an unsafe stored raw Outline. A safe deliberate edit to only blank depth-0 uncollapsed placeholder content removes `node.editor`.

### P011/P012 protections retained

- Unsupported or malformed non-null editor data remains wholly read-only; Notes are not selectively editable around it.
- File-session source identity, filename diagnostics and PiP identity remain bound to the popup.
- Same-ID cross-file, stale-node and missing-node saves reject before mutation.
- Stored-raw and incoming non-lossy preflight remains mandatory for actual Outline changes.
- Failed truth export adopts only the applied node revision, keeps PE dirty and supports retry.
- Successful save-as identity adoption, queued stale-write rejection, edit-generation protection and Save & Close persistence rules remain unchanged.
- No autosave, background write, picker-on-open, file watcher, cloud sync, new Enter owner or second PE was added.

### Files changed

Production:

- `js/pocket-editor-metadata.js` — owns the shared meaningful-Outline rule.
- `js/pocket-node-popout-model.js` — validates and compares Notes/Outline independently, preserves unchanged raw Outline and gates actual Outline changes.
- `js/pocket-node-popout-editor.js` — mutates only changed sections and records one combined operation.
- `js/pocket-node-popout-runtime.js` — removes implicit conversion and makes tabs presentation-only while sending both sections.
- `js/pocket-node-popout-template.js` — labels the sections Notes and Outline.
- `js/pocket-editor-popout.js` — removes destructive conversion from the first compatibility popup and keeps it fail closed.
- `js/pocket-editor-popout-v2.js` — removes the same conversion from the loaded v2 compatibility popup.

Tests and documentation:

- `tests/pe-persistence-contract.test.js`
- `docs/PE_PERSISTENCE_CONTRACT.md`
- `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`
- `docs/CODEX_REPORT.md`

No `index.html`, `package.json`, dependency, fixture, production JSON example or retired `pocket-editor-popout-default.js` file changed.

### Focused validation

Node:

~~~text
v24.14.0
~~~

Focused command:

~~~sh
node --test tests/pe-persistence-contract.test.js
~~~

Result:

~~~text
tests 84
pass 84
fail 0
cancelled 0
skipped 0
todo 0
~~~

The suite executes actual active source with synthetic fixtures, isolated VM contexts and in-memory handles. P013 coverage includes Notes-only, Outline-only, both sections, old details projections, independent title/Notes/Outline edits, combined save, independent clears, absent placeholders, structural-only blank Outlines, raw supported extensions, unsafe stored raw preservation/rejection, tab switching, compatibility conversion removal and no-operation recognition. Existing P006-P012 tests remain green.

Generated-runtime validation builds with `PocketNodePopoutRuntime.build()`, compiles with `new Function(...)`, and uses controlled execution for:

- Notes-only, Outline-only, combined and absent-Outline payloads;
- blank depth structural Outline and blank collapsed Outline;
- independent clear-Notes and clear-Outline outgoing payloads;
- tab switching with unsaved edits in both sections;
- both-section Save independent of the visible tab;
- unsupported-editor read-only behavior;
- failed export and retry;
- stale-node and switched-file rejection;
- raw-size and duplicate-ID rejection;
- P006 Copy, structured Paste, Duplicate and Delete;
- P007 Escape ordering; and
- P008 structured-paste indentation.

Targeted static checks:

- `node --check` passed for all seven changed JavaScript files.
- `git diff --check` passed.
- Generated source compiled without syntax errors.
- `node tools/pocket-check.js` was not run.
- `npm run check` was not run because it invokes the prohibited checker.

### Remaining CURRENT-RISK items

P013 resolves destructive Text/Outline conversion and reclassifies accepted details/Outline drift as supported independent content. The focused suite still characterises:

- duplicate non-empty block IDs retained in the read view, with explicit changed Outline save blocked;
- read-view slicing at row 401, with raw preservation and changed Outline rejection;
- read-view slicing after 4,000 block-text characters, with raw preservation and changed Outline rejection;
- load-time `node.pe` synthesis affecting a later explicit export shape; and
- `portal.export.v1` top-level precedence dropping nested-only data extras.

P014 remains the separate `node.pe` task.

### Physical browser acceptance checklist

1. Save and reopen a Notes-only node; confirm Outline remains absent until meaningfully edited.
2. Save and reopen an Outline-only node; confirm Notes remains empty.
3. Edit both sections on one node before one Save; reopen and confirm both.
4. Edit Notes on an Outline node; confirm IDs, depths, collapse, order and text remain unchanged.
5. Edit Outline; confirm Notes remains exactly unchanged.
6. Clear Notes independently and reopen.
7. Clear Outline independently and reopen.
8. Switch tabs repeatedly with unsaved edits in both; confirm no conversion and dirty state reflects edits, not switching.
9. Paste a structured multiline Outline and confirm hierarchy.
10. Exercise selection, subtree Copy, Duplicate and Delete.
11. Confirm dirty-close protection and P007 Escape layering.
12. Cancel or fail a save, confirm PE stays open/dirty, then retry successfully.
13. Reproduce the P012 same-node-ID cross-file rejection.
14. Confirm blank depth/collapsed structural Outline content survives a Notes-only save.

## POCKET TASK P012

Title: Bind PE saves to source identity and block lossy saves

Status: source-bound PE saves, optimistic node-revision checks, non-lossy raw save preflight and failed-export retry implemented and validated. Physical browser acceptance remains.

Commit title:

- `P012 Bind PE saves to source identity`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Expected and confirmed starting `origin/main`: `a79b16638818681ea06ab1b4264341475bce766f`
- Starting commit: `P011 Consolidate PE editor recognition`
- Local `main` matched `origin/main`, and the working tree was clean before P012.
- `git fetch origin` found no commits newer than the expected P011 baseline.
- Murray supplied physical-browser acceptance for P011 ordinary Text, ordinary Outline and unsupported-editor compatibility views.
- No personal or active Pocket truth file outside the repository was inspected.

### Outcome

P012 makes an editable PE save conditional on both the document session and the node revision it opened. It also checks the unsliced save payload before any normaliser can truncate or structurally alter user content.

The resulting boundary is:

- every canonical opening carries a JSON-safe file-session token, diagnostic filename and PiP flag, plus the exact normalised `node.updatedAt`;
- the main-window apply owner checks the active document session before resolving a node ID;
- the explicitly resolved node must still exist and retain the opening revision;
- P011 unsupported-editor recognition is re-run against current state;
- Text and Outline payloads are checked against the current persistence limits before mutation;
- explicit Outline save rejects duplicate or invalid row IDs, unsafe depths, malformed rows, non-meaningful metadata and hidden stored-raw loss;
- no failed preflight changes node state, operations, browser safety state, PiP state or truth-write surfaces;
- changed apply returns its new node revision even when truth persistence fails;
- the popup adopts that revision, remains dirty, and can retry the pending truth export; and
- a successful picked-file save returns the new safe document identity for the still-open popup to adopt.

Normal successful Text and v1 Outline saves retain their established behaviour. No truth-file schema field or node field was added.

### Files changed

Production files:

- `js/pocket-editor-copy.js`
- `js/pocket-editor-cutover-v3.js`
- `js/pocket-editor-popout.js`
- `js/pocket-history-status.js`
- `js/pocket-import.js`
- `js/pocket-io-browser.js`
- `js/pocket-node-popout-editor.js`
- `js/pocket-node-popout-model.js`
- `js/pocket-node-popout-runtime.js`
- `js/pocket-node-popout-target.js`
- `js/pocket-pe-save-dirty.js`
- `js/pocket-storage.js`
- `js/pocket-vault-io-browser.js`

Test and documentation files:

- `tests/pe-persistence-contract.test.js`
- `docs/PE_PERSISTENCE_CONTRACT.md`
- `docs/CODEX_REPORT.md`

No fixture, `package.json`, `index.html`, dependency, production JSON example or retired `pocket-editor-popout-default.js` file changed.

### Source identity design

`js/pocket-io-browser.js` now owns two explicit popup-safe helpers:

- `capturePocketEditorSourceIdentity()` returns only `fileSessionId`, `sourceFileName` and `sourcePipSession`; and
- `isPocketEditorSourceIdentityCurrent(identity)` treats the numeric session ID as authoritative.

The display name and PiP flag are diagnostics. They are not treated as unique identity. The object contains no writable handle, picker callback, permission, file object or mutable application state.

`PocketNodePopoutModel.buildPayload()` includes those three fields plus `originalUpdatedAt`. The latter is the exact normalised node timestamp at opening, not a new clock value. The generated popup returns the binding unchanged on every attempt and cannot create a replacement identity.

The main-window apply order is:

1. confirm a current modifiable Pocket document;
2. validate the source-identity shape;
3. compare the source session with the active document session;
4. validate and resolve the explicit target ID through `PocketNodePopoutTarget.getById()`;
5. confirm the node still exists;
6. require the original node revision;
7. compare it with the current node revision;
8. re-run the P011 unsupported-editor classification;
9. run stored-raw and incoming raw save preflight;
10. calculate and apply a mutation only after every gate passes; and
11. record an operation and request export only after successful apply.

This ordering prevents an editor opened from file A from resolving a same-ID node in file B.

### Document-session increment rules

`pocketFileSessionId` remains runtime-only. P012 makes session renewal deliberate:

- every successfully loaded selected file creates a new session, including a successful reload of the same handle;
- a newly created Pocket file creates a new session;
- a picked truth-file target creates a new session only after its write succeeds and it becomes active;
- PiP snapshot adoption creates a new session;
- local safety, returned PiP and Vault whole-document adoption create a new session; and
- a routine successful write to the already active handle does not create a new session.

Changing only the display name does not rotate identity. `setPocketFileSession()` accepts `forceNewSession: true` only at document-adoption boundaries. Existing queued-save handle and session checks remain in place.

Selected-file validation happens before adoption. An unreadable or invalid candidate does not first clear or replace the current document session. The post-adoption paths contain no asynchronous gap in which a later document switch could be relabelled as the earlier load or picked save.

### Node-revision contract

`originalUpdatedAt` is required on every editable save. `PocketNodePopoutEditor.applyPayload()` compares it exactly with the resolved node's current normalised `updatedAt`.

Rejections are:

- `missing-node-revision` when the opening revision is absent or malformed;
- `node-revision-changed` when the item changed after opening; and
- `missing-node` when the original item no longer exists.

An edit to another node does not invalidate the target PE. Active persistent mutations of PE-owned label, details and editor content already refresh `updatedAt`. Whole-document recovery/adoption paths additionally rotate the document session. PE's own timestamp update is monotonic by at least one millisecond when the clock has not advanced, so two successive saves from the same still-open popup receive distinct revisions.

### Non-lossy save preflight

`PocketNodePopoutModel.validateSavePayload()` is the authoritative incoming-payload check. `prepareSave()` invokes it before the current canonical normalisers. Outline saves also scan the preserved supported raw editor before applying a normalised editing view.

Accepted maxima:

| Value | Maximum |
| --- | ---: |
| Normalised title | 220 characters |
| Normalised readable body | 4,000 characters |
| Outline rows | 400 |
| CR-normalised row text | 4,000 characters |
| Cleaned row ID | 80 characters |
| Integer depth | 0 through 8 |

Outline save additionally requires:

- exact `schema: "pocket.nodeEditor.v1"`;
- exact `mode: "outline"`;
- an array-valued, JSON-compatible and meaningful Outline;
- object-valued rows;
- non-empty string IDs by save time;
- unique cleaned IDs;
- finite integer depths;
- boolean collapse state when supplied; and
- independently safe readable body length.

Boundary tests accept title 219/220, body 3,999/4,000, row counts 399/400, row text 3,999/4,000, ID length 80 and depths 0/8. They reject the next value, missing or duplicate IDs, ID length 81, depth -1/9/fractional/non-finite, scalar rows, invalid collapse state, empty/non-meaningful Outline and wrong schema.

Text mode validates title and readable body and ignores an unused Outline member. It deliberately retains the P013-unresolved behaviour in which an explicit changed Text save can delete accepted Outline metadata.

There is no truncation option, silent repair, row deletion, duplicate-ID regeneration, merge or last-writer-wins path.

### Rejection reasons and messages

The structured apply/save contract now preserves specific reasons including:

- `no-pocket-file`
- `missing-source-identity`
- `file-session-changed`
- `missing-node`
- `missing-node-revision`
- `node-revision-changed`
- `unsupported-editor`
- `title-too-long`
- `details-too-long`
- `outline-too-many-blocks`
- `outline-block-text-too-long`
- `invalid-outline-id`
- `outline-id-too-long`
- `duplicate-outline-block-id`
- `invalid-outline-depth`
- `invalid-outline-block`
- `invalid-outline`
- `cancelled`
- `stale-guard`
- `permission-denied`
- `write-failed`
- `downloaded-copy`
- `export-unavailable`

The generated runtime maps the safety cases to calm, direct status and alert text. File switches, stale nodes, missing nodes and exact limit failures tell the user that nothing was applied. Ordinary IO failures explain that the editor content remains available for retry. Save and Save & Close leave the popup dirty and open after every rejection.

### Apply, export and revision handshake

A successful in-memory change returns `nodeUpdatedAt`. The popup adopts that revision whenever `applied: true`, even when export is cancelled, paused by the stale guard or throws. It does not adopt a different source identity from a failed result.

`getPocketUnsavedOperationCount()` is a narrow read-only helper over lexical `state.ops`. `PocketNodePopoutEditor` no longer assumes that lexical state is exposed as `window.state`. After an applied-but-unpersisted result:

- the operation remains pending;
- the popup remains dirty;
- a retry sends the returned node revision;
- unchanged apply passes its revision check; and
- pending lexical operations force another `exportTree({ returnDetails: true })` call.

On successful truth persistence the result includes the current safe source identity. A picked-file save includes proof that the new session was adopted from the queued save's expected session. The popup adopts that new identity only on success.

The generated runtime also tracks an edit generation. A successful response for an earlier generation cannot clear or close over newer popup edits made while the export was in flight.

### Export-result propagation

`applyAndSave()` retains the apply-time node revision and meaningful export reason. Controlled tests cover:

- cancelled export;
- stale guard;
- file-session change;
- missing active file;
- write failure;
- unavailable export surface;
- downloaded copy; and
- thrown export.

The existing export queue still captures the file session before enqueueing. A delayed file-A write followed by a switch to file B reports `file-session-changed`, never writes B and never clears B's state as though A had saved.

### Legacy and cutover routes

The canonical generated runtime saves only through `PocketNodePopoutEditor.applyAndSave()`. Its older apply-only fallback has been removed.

Active compatibility surfaces now fail closed:

- `PocketEditorPopout.apply()` delegates dynamically to canonical `PocketNodePopoutEditor.apply()`;
- the P011/P012 cutover does not open an unbound legacy editor when the safe popup cannot open; and
- `__pocketPeApplyAndSave` delegates to canonical `applyAndSave()` rather than applying, clearing dirty state and exporting independently.

An already constructed old payload lacks P012 identity and therefore rejects before mutation. No second PE implementation or retired default editor was restored.

### P010/P011 CURRENT-RISK results

P012 replaces these previously characterised risks with stable safety assertions:

- PE openings now include file-session and original-node revision identity.
- Unchanged retry sees lexical pending operations without exposing `state`.
- Explicit Outline save blocks row 401 before applying.
- Explicit Outline save blocks 4,001-character row text before applying.
- Explicit save rejects title/body content which would be truncated.
- Explicit Outline save rejects duplicate internal row IDs.

Read-time normalisation remains characterised separately because raw P011 preservation and the editable view are distinct layers.

Seven exact CURRENT-RISK tests intentionally remain:

- `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
- `CURRENT-RISK: Outline normalisation silently slices block 401`
- `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
- `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
- `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
- `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
- `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`

The first three now describe read-view normalisation only. P012 prevents those observations from causing a lossy explicit Outline save.

### Focused test result

Node version:

```text
v23.11.0
```

Command:

```sh
node --test tests/pe-persistence-contract.test.js
```

Result:

```text
tests 77
suites 0
pass 77
fail 0
cancelled 0
skipped 0
todo 0
```

The evolved suite executes actual production source in controlled VM and generated-runtime contexts. It uses synthetic fixtures and in-memory handles only. It does not open a real picker, create a real `FileSystemFileHandle`, use the network, access a personal Pocket file or write a truth file.

Coverage includes:

- safe opening bindings and absence of handles;
- valid, missing, malformed and mismatched source identities;
- same-name different sessions;
- same-handle reload renewal and same-handle write stability;
- file A/B with the same node ID;
- PiP identity, returned-PiP/Vault adoption and picked-file adoption;
- matching, missing, stale, unrelated and deleted node revisions;
- successful first and second saves;
- exact raw preflight boundaries and rejection no-mutation assertions;
- stored-raw loss hidden by editable-view normalisation;
- cancelled, stale-guard and thrown-export retries;
- queued file-session switching;
- generated Text, Outline and P011 read-only runtime compilation;
- runtime dirty, close, revision and source-identity handshakes;
- P006 Copy, Paste, Duplicate and Delete paths;
- P007 Escape ordering;
- P008 indentation parsing and round trip;
- details-first copy context;
- one active main-tree Enter owner; and
- no truth-file write during load or recognition.

### Generated-runtime validation

`PocketNodePopoutRuntime.build()` produced programs compiled with `new Function(...)` for:

- editable Text with `outline: null`;
- native current-v1 Outline;
- P011 unsupported-editor read-only Text;
- stale and switched-file failures;
- oversized Text and Outline payloads;
- duplicate-ID rejection; and
- failed-export retry.

Controlled execution confirms:

- source binding returns unchanged on each attempt;
- editable Outline save emits the exact v1 schema;
- unsliced oversized and duplicate Outline data reaches the authoritative main-window preflight;
- rejected Save and Save & Close retain content, dirty state and the open window;
- applied export failure adopts only the apply-time revision;
- a later retry sends that revision and the original source identity;
- successful save-as identity is adopted;
- successful Save & Close closes only after persistence;
- P011 read-only mode still never saves or becomes dirty; and
- P006, P007 and P008 runtime paths remain intact.

### Validation and safety confirmations

The final validation set includes:

- `node --version`;
- `node --check` for every changed JavaScript file;
- `node --test tests/pe-persistence-contract.test.js`;
- generated-runtime build, `new Function(...)` compilation and controlled execution in that suite;
- `JSON.parse()` over every committed fixture;
- `git diff --check`;
- Markdown fence, heading and table review;
- exact CURRENT-RISK name matching between tests and documentation;
- full changed-path and production diff review;
- confirmation that `package.json` and `index.html` did not change;
- confirmation that no temporary file or personal data was added;
- confirmation that rejection paths invoke no export, picker, writer, workspace safety save or PiP snapshot;
- confirmation that no mutable lexical state object was exposed globally;
- confirmation that no active legacy route bypasses the canonical P012 owner; and
- confirmation that existing export queue/session checks remain active.

No truth-file migration, autosave, background write, file watcher, cloud synchronisation, silent writable-handle reuse, automatic merge, automatic downgrade or new PE implementation was introduced.

`node tools/pocket-check.js` and `npm run check` were not run, as required.

### Physical browser checks still required

Murray should physically confirm:

- ordinary Text Save and Save & Close;
- native current-v1 Outline Save and Save & Close;
- file A/B same-ID rejection;
- stale-node and deleted-node rejection;
- 4,001-character body rejection;
- 401-row, 4,001-character row and duplicate-ID Outline rejection;
- cancelled or failed truth export followed by retry;
- picked-file/save-as identity adoption for a still-open PE;
- P011 unsupported-editor read-only behaviour; and
- rejection-specific status, content retention, Escape and dirty-close behaviour at normal popup dimensions.

### Git identification

This report is included in the commit titled `P012 Bind PE saves to source identity`. Its resulting SHA is not embedded in the same commit because adding that SHA would create a different commit. Completion is gated on pushing that commit to `origin/main`, fetching again, confirming local `main` and `origin/main` resolve to the same commit, and confirming the worktree is clean.

---

## POCKET TASK P011

Title: Consolidate PE editor recognition

Status: first-class PE metadata ownership, exact editor recognition and read-only compatibility handling implemented and validated. Physical browser acceptance remains.

Commit title:

- `P011 Consolidate PE editor recognition`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Expected and confirmed starting `origin/main`: `8699d91a35ae941a49c42d28c216548e552635fd`
- Starting commit: `P010 Specify PE persistence contract`
- Local `main` matched `origin/main`, and the working tree was clean before P011.
- No personal or active Pocket truth file outside the repository was inspected.

### Outcome

P011 makes `editor` and `pe` deliberate first-class node fields, gives the active PE one exact recognition contract, and prevents unsupported or malformed editor data from reaching an editable fallback.

The resulting boundary is:

- load and recovery preserve JSON-compatible `editor` and `pe` values opaquely without the generic extras count or size caps;
- the active PE interprets only an exact supported `pocket.nodeEditor.v1` Outline;
- absent and explicit-null editor states remain ordinary editable Text;
- unsupported, future and malformed non-null editor states open as readable, read-only Text projections;
- no read path rewrites opaque editor data or writes the selected truth file;
- unrelated edits and exports preserve untouched raw first-class metadata; and
- an explicit edit of a supported v1 Outline writes the existing canonical v1 representation.

No new persistence schema or migration was introduced.

### Files changed

Production files:

- `js/pocket-data.js`
- `js/pocket-editor-metadata.js`
- `js/pocket-pe-import-preserve.js`
- `js/pocket-import.js`
- `js/pocket-node-popout-model.js`
- `js/pocket-node-popout-template.js`
- `js/pocket-node-popout-runtime.js`
- `js/pocket-node-popout-editor.js`
- `js/pocket-editor-cutover-v3.js`

`js/pocket-editor-cutover-v3.js` is included because the cutover previously treated a failed canonical open as permission to use a legacy editable popup. P011 must block that fallback for unsupported or malformed editor data, otherwise the read-only contract could be bypassed.

Test and documentation files:

- `tests/pe-persistence-contract.test.js`
- `docs/PE_PERSISTENCE_CONTRACT.md`
- `docs/CODEX_REPORT.md`

The six synthetic P010 fixtures are unchanged. No dependency, package script, production JSON example or retired PE implementation was added or modified.

### Canonical load owner

`js/pocket-import.js` remains the final `normaliseNodes()` owner in actual `index.html` load order, but it is now deliberate rather than accidental:

- `js/pocket-editor-metadata.js` supplies recognition, normalisation and JSON-compatible cloning helpers without replacing `normaliseNodes()`;
- `js/pocket-pe-import-preserve.js` no longer wraps node normalisation and now owns only the existing visible PE version marker patch;
- `editor` and `pe` are reserved node keys, so generic extras cannot consume their first-24 field budget or overwrite them by property order; and
- the canonical owner copies both fields after ordinary node construction through the first-class metadata helper.

The focused suite confirms that the final lexical and window-visible `normaliseNodes()` identity is the canonical `js/pocket-import.js` owner.

### Uncapped opaque first-class preservation

For truth-file JSON values, `editor` and `pe` are preserved as detached JSON-compatible clones outside the generic extras limits. This removes the prior 8,000-character object loss path and the shared 24-field budget interaction.

Coverage includes:

- small and large current v1 Outline objects;
- large unknown-schema editor objects;
- large legacy `pe` objects;
- explicit nulls, scalars and arrays;
- cyclic non-JSON in-memory `editor` and `pe` values that fail closed without discarding their nodes;
- unsupported and malformed editor objects;
- load, export and reload;
- unrelated-node edits followed by explicit export; and
- local safety snapshot, safety trail, auto-cache and PiP recovery routes.

Opaque preservation is not semantic acceptance. Raw unsupported data can survive intact while the active PE refuses to edit it.

The standalone PE still ignores JSON-compatible legacy `pe` content for mode and content selection. It checks only first-class cloneability, so an impossible cyclic in-memory `pe` fails closed before editing or export just like an impossible cyclic `editor`.

### Exact editor-recognition gate

The shared metadata contract classifies editor state as one of:

- `none` for an absent field or `editor: null`;
- `supported-v1-outline` for an exact supported Outline; or
- `unsupported-or-malformed` for every other present, non-null value.

Supported editor metadata must have all of:

- `schema === "pocket.nodeEditor.v1"`;
- `mode === "outline"`;
- an array-valued `outline`; and
- at least one meaningful retained block.

Unknown schemas are no longer accepted by shape, relabelled as v1 or stripped in the PE view as if they were supported. Malformed current-schema objects, scalars and arrays also fail closed. Existing supported v1 block normalisation, including current ID, depth, collapse, ordering and size limits, remains the canonical editable view.

### Read-only compatibility view

Unsupported or malformed editor data produces a Text-mode payload containing the normalised title and readable `details` projection, plus an explicit read-only reason and message. The raw opaque editor object is not embedded in the generated popup program or HTML.

The template and generated runtime jointly enforce the view:

- a visible read-only banner explains why editing is unavailable;
- the title and body remain selectable for copy but are read-only;
- Save, Save & Close, Text and Outline controls are disabled;
- no Outline is initialised or rendered from unsupported metadata;
- input events, mode switching, buttons and save shortcuts cannot mark the popup dirty or invoke apply/save;
- unsaved-dialog and `beforeunload` protection stay inactive because no edit is possible; and
- Close and Escape still close the readable popup normally.

This is compatibility presentation only. There is no hidden preserve-on-save branch because saving is unavailable.

### Apply defence and cutover bypass fix

The main-window apply owner reclassifies the current node before accepting any payload. If its stored editor is unsupported or malformed:

- `apply()` returns failure, with optional structured details for callers that request them;
- `applyAndSave()` reports `unsupported-editor`;
- the node is not mutated;
- no operation is recorded; and
- no export or truth-write route is invoked.

The cutover attempts the canonical standalone read-only open first. If that open fails, unsupported or malformed nodes do not fall through to either legacy editable bridge. Ordinary Text and supported v1 nodes retain the established fallback behaviour for a genuine canonical-open failure.

### Raw v1 extensions and explicit canonicalisation

Load ownership and PE interpretation are deliberately separate for supported v1 data too:

- raw v1 editor and block extension fields remain in state after load;
- an unrelated edit and later explicit export preserve that untouched raw v1 object exactly;
- opening the node uses a detached canonical editable view; and
- explicitly saving an edit to that v1 Outline replaces the raw object with the canonical `pocket.nodeEditor.v1` shape, so unrecognised extensions are removed only at that explicit edit boundary.

The generated editable Outline runtime now emits the exact v1 schema in its save payload. This makes canonicalisation intentional and testable rather than a silent read-time migration.

### Legacy `pe` synthesis

P011 does not change `ensurePeFromLegacyDetails()`:

- a details-bearing node without its own `pe` field can still gain an in-memory Text `pocket.pe.v1` projection during load;
- any own `pe` value, including null, still prevents synthesis; and
- the standalone node PE still does not use legacy `node.pe` as its editable model.

This remains an explicitly named CURRENT-RISK compatibility behaviour. Consolidating first-class preservation does not endorse or expand it.

### P010 CURRENT-RISK results

P011 resolves P010 CURRENT-RISK categories 1, 2, 3, 4 and 10:

1. `normaliseNodes()` ownership is now deliberate and tested.
2. `editor` and `pe` are reserved outside the generic first-24 extras budget.
3. first-class editor metadata is no longer dropped above the generic 8,000-character object cap.
4. unknown Outline-like schemas are exact-gated and never rewritten as v1 merely because their shape resembles Outline.
10. malformed and unknown raw objects remain preserved while PE exposes an explicit read-only Text view rather than shape-based interpretation.

The following exact CURRENT-RISK categories remain:

- `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
- `CURRENT-RISK: Outline normalisation silently slices block 401`
- `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
- `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
- `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
- `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
- `CURRENT-RISK: PE opening payload has no file-session or original-revision identity`
- `CURRENT-RISK: Outline apply accepts independent details/editor content and silently enforces title/body limits`
- `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`
- `CURRENT-RISK: unchanged PE save cannot see lexical unsaved operations through window.state`

These retained assertions cover duplicate IDs, the block-401 and block-text-4,001 truncation boundaries, legacy `pe` synthesis, details/Outline drift, root/data extras precedence, missing source identity, apply limits and drift, Text deletion semantics, and the lexical-state visibility gap.

### Generated-runtime validation

`PocketNodePopoutRuntime.build()` returned programs that compiled with `new Function(...)` for:

- ordinary editable Text with `outline: null`;
- a valid saved v1 Outline; and
- an unsupported or rejected editor state represented by the read-only Text payload.

The controlled generated-runtime tests confirm:

- an editable Outline save includes `schema: "pocket.nodeEditor.v1"`;
- read-only controls and fields are disabled at both template and runtime layers;
- programmatic input, mode, Save, Save & Close and shortcut attempts do not call apply/save or create dirty state;
- no unsupported raw editor content is embedded in the generated program or HTML;
- read-only Text remains selectable and closable; and
- the unsaved dialog and unload guard remain inactive.

P008 regression coverage remains green for:

- two-space and four-space indentation;
- tabs and mixed tab/space indentation;
- common leading indentation;
- blank-line filtering;
- depth clamping;
- structured-paste base-depth alignment;
- Text to Outline to Text round trips with normalised two-space projection; and
- one fresh blank depth-0 uncollapsed row for empty or whitespace-only Text.

### Focused test result

Node version:

```text
v23.11.0
```

Command:

```sh
node --test tests/pe-persistence-contract.test.js
```

Result:

```text
tests 53
suites 0
pass 53
fail 0
cancelled 0
skipped 0
todo 0
```

The suite uses actual repository source in isolated VM contexts and controlled in-memory browser/file surfaces. It creates no file handle, invokes no picker, performs no network access and writes no truth file.

### Additional validation

Passed:

- `node --check` for all nine changed production JavaScript files;
- `node --check tests/pe-persistence-contract.test.js`;
- generated-runtime compilation and controlled execution;
- fixture inventory and JSON parsing through the focused suite; and
- `git diff --check`.

The final review confirms:

- no synthetic fixture changed;
- no personal Pocket truth file was read or written;
- no truth-file migration, background write, autosave, watcher, cloud synchronisation or silent handle reuse was added;
- no new dependency or package script was added;
- no retired PE file was restored or modified;
- P006 outline actions, P007 Escape order, P008 indentation conversion, details-first copy context and the one active main-tree Enter owner remain covered or unchanged;
- `node tools/pocket-check.js` was not run; and
- `npm run check` was not run.

### Still requiring Murray's physical browser acceptance

- Unsupported and malformed nodes visibly open in the standalone read-only compatibility view.
- The banner wording, disabled controls, selectable text and close/Escape feel are acceptable in the real popup.
- A failed canonical read-only open does not expose a legacy editable fallback.
- Ordinary Text and native v1 Outline editing, Save and Save & Close still feel unchanged against a selected disposable truth file.
- Large current v1, unknown-schema and legacy `pe` values survive a real open and unrelated explicit save without silent migration.
- Explicitly editing a supported v1 Outline canonicalises only that edited editor object as documented.

### Git identification

This report is included in the commit titled `P011 Consolidate PE editor recognition`. Its resulting SHA is intentionally not embedded in the same commit because adding that SHA would create a different commit. Completion remains gated on pushing that exact commit to `origin/main`, fetching again, confirming local `main` and `origin/main` resolve to it, and confirming the worktree is clean.

---

## POCKET TASK P010

Title: Specify and test the current PE persistence contract

Status: production-neutral characterisation suite and durable contract completed against current `origin/main`.

Commit title:

- `P010 Specify PE persistence contract`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Expected and confirmed starting `origin/main`: `1b74ff1efaf857b0fd40ede400c9ae7933a97461`
- Starting commit: `P009 Audit PE data model migration`
- Murray had accepted P009 before this task.
- `git fetch origin` found no commits newer than the expected P009 baseline.
- Local `main` matched `origin/main`, and the working tree was clean before P010.
- No personal or active Pocket truth file outside the repository was inspected.

### Outcome

P010 adds an executable baseline for the current PE persistence contract without changing production behaviour.

The durable contract is:

- `docs/PE_PERSISTENCE_CONTRACT.md`

It separates:

- intended stable behaviour;
- current compatibility behaviour;
- explicitly named CURRENT-RISK characterisation behaviour;
- unsupported or unknown input states; and
- future desired behaviour that P010 does not implement.

No current truth-file migration occurred. Every known weakness tested by P010 remains present in production after this task.

### Files changed

Added:

- `docs/PE_PERSISTENCE_CONTRACT.md`
- `tests/pe-persistence-contract.test.js`
- `tests/fixtures/pe-persistence/legacy-text.json`
- `tests/fixtures/pe-persistence/current-outline-v1.json`
- `tests/fixtures/pe-persistence/empty-text.json`
- `tests/fixtures/pe-persistence/malformed-editor.json`
- `tests/fixtures/pe-persistence/unknown-editor-schema.json`
- `tests/fixtures/pe-persistence/root-precedence.json`

Updated:

- `docs/CODEX_REPORT.md`

No helper file was necessary. No production JavaScript, HTML, CSS, runtime configuration, production JSON example, dependency or package script changed.

### Fixture inventory

- `legacy-text.json`: ordinary indented Text with no `editor` or `pe`.
- `current-outline-v1.json`: small native v1 Outline with stable IDs, nested depth, collapse and deliberate details drift.
- `empty-text.json`: whitespace-only details.
- `malformed-editor.json`: small v1-labelled editor object with a non-array Outline.
- `unknown-editor-schema.json`: small future editor schema with Outline-like content and unknown fields.
- `root-precedence.json`: disagreeing top-level/nested trees, tombstones and synthetic root/data/node extras.

All fixtures are synthetic, parseable and below 5,000 characters. Large limit cases are generated in memory, so no oversized fixture was committed.

### Test harness design

The focused CommonJS test uses Node built-ins only:

- `node:test`
- `node:assert/strict`
- `node:fs`
- `node:path`
- `node:vm`

The harness:

- derives relevant classic-script order from actual `index.html`;
- executes actual repository source in fresh VM contexts;
- preserves the real top-level lexical `state` binding instead of masking it with `window.state`;
- exercises actual `normaliseDetails()`, extras normalisers, `normaliseInput()`, `applyLoadedState()`, `buildPocketPayload()`, PE model/target/editor functions, `recordOp()`, generated runtime and copy-context code;
- uses minimal DOM and `localStorage` shims;
- instruments `exportTree()`, `writeTruthFile()` and picker surfaces separately;
- uses only in-memory controlled export outcomes for `applyAndSave()`;
- creates no file handle;
- writes no temporary file;
- performs no network access; and
- exposes private generated-runtime parser functions only by modifying the returned program string in memory, then returning before DOM initialisation. The executed functions are the actual generated functions, not copied parser logic.

The generated empty-row test additionally invokes actual `renderOutline()` with a small in-memory element shim.

### Exact focused test result

Node version:

```text
v23.11.0
```

Command:

```sh
node --test tests/pe-persistence-contract.test.js
```

Result:

```text
tests 41
suites 0
pass 41
fail 0
cancelled 0
skipped 0
todo 0
```

The test file also passed:

```sh
node --check tests/pe-persistence-contract.test.js
```

### Exact CURRENT-RISK tests captured

1. `CURRENT-RISK: index load order leaves pocket-import.js as active normaliseNodes owner`
2. `CURRENT-RISK: editor and pe share the first-24 generic extras budget`
3. `CURRENT-RISK: active load drops editor metadata above the generic 8,000-character object cap`
4. `CURRENT-RISK: unknown Outline-like schema is accepted, rewritten as v1, and stripped of unknown fields`
5. `CURRENT-RISK: active PE model retains duplicate non-empty block IDs`
6. `CURRENT-RISK: Outline normalisation silently slices block 401`
7. `CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters`
8. `CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open`
9. `CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode`
10. `CURRENT-RISK: small malformed and unknown editor objects survive load but PE interprets only their shape`
11. `CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export`
12. `CURRENT-RISK: PE opening payload has no file-session or original-revision identity`
13. `CURRENT-RISK: Outline apply accepts independent details/editor content and silently enforces title/body limits`
14. `CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details`
15. `CURRENT-RISK: unchanged PE save cannot see lexical unsaved operations through window.state`

These are observations, not approved future policy. Later fixes should replace their expectations and names in the same task.

### Verified limits and behaviours

The actual-source suite confirms:

- final `normaliseNodes()` ownership belongs to `js/pocket-import.js` after current index load;
- simply restoring the intermediate editor-aware owner is insufficient because generic extras can overwrite its explicit editor value;
- node extras retain the first 24 accepted values;
- node-extra objects survive at `JSON.stringify(...).length === 8000` and are dropped at 8,001;
- root extras retain the first 32 accepted values, strings to 2,000 and objects to 12,000;
- details normalisation removes carriage returns, converts tabs, strips trailing and outer whitespace, collapses long blank runs, and slices at 4,000;
- current root precedence for export, MTT, sync, change snapshot, array and unknown shapes;
- small valid and exact-8,000 editor objects survive the active loader while 8,001 does not;
- active PE acceptance and rejection rules for Text, empty, flat, nested, blank, malformed and unknown-schema editor states;
- missing-ID creation, duplicate-ID retention, depth clamp/rounding, array order, unknown-field removal and collapse handling;
- 399/400/401 block and 3,999/4,000/4,001 block-text boundaries;
- current load-time `node.pe` synthesis and its later export effect;
- root guard, timestamp, dual-tree, tombstone, extras and clone behaviour;
- compact Text, empty, native Outline, malformed, unknown-schema, drift and extras round trips;
- PE opening payload keys and identity omissions;
- Outline and Text application, current caps, unchanged detection and operation recording;
- controlled success, cancellation, downloaded copy, throw and unavailable export results;
- the real lexical `state` versus `window.state` visibility gap;
- details-first copy context; and
- the shared P008 indentation parser and empty rendering fallback.

### Generated runtime result

`PocketNodePopoutRuntime.build()` returned programs that compiled with `new Function(...)` for:

- Text mode with `outline: null`;
- valid saved Outline mode; and
- a rejected/empty metadata state normalised to Text.

The actual generated parser passed:

- two-space hierarchy;
- four-space hierarchy;
- tabs;
- mixed tab/space indentation;
- common leading indentation;
- blank-line filtering;
- depth clamp;
- shared structured-paste base alignment; and
- Text to Outline to Text hierarchy with normalised two-space output.

Actual generated rendering supplied one fresh blank depth-0 uncollapsed row after empty/whitespace-only Text produced no parser blocks.

### No-write and production-neutral confirmation

- `applyLoadedState()` recorded no operation and invoked no truth export, truth writer or picker.
- Its observed writes were browser `localStorage` safety/workspace snapshots only.
- Controlled `applyAndSave()` tests invoked only an in-memory `exportTree()` stub.
- The `writeTruthFile()` and picker spies stayed at zero throughout.
- No `FileSystemFileHandle` or real truth file was created or opened.
- No personal Pocket truth file was read or written.
- No production file changed.
- `package.json` did not change.
- No dependency was added.
- No retired PE file was restored or modified.
- `node tools/pocket-check.js` was not run.
- `npm run check` was not run.

### Repository validation

The final validation set includes:

- `node --version`;
- `node --check tests/pe-persistence-contract.test.js`;
- `node --test tests/pe-persistence-contract.test.js`;
- `git diff --check`;
- `JSON.parse()` over every committed fixture;
- exact 19-section heading order verification;
- balanced Markdown fence verification for both changed documents;
- executable-to-documented matching for all 15 CURRENT-RISK test names;
- existence checks for every source file and named function in the contract evidence table;
- complete staged-diff and changed-path review;
- confirmation that `package.json`, `index.html` and `js/` have no diff;
- confirmation that no temporary artefact remains; and
- an independent read-only review that reproduced 41 passes and found no blocker.

### Remaining work for P011

P011 can now change load ownership against an executable baseline. It should, subject to its own approved prompt:

- establish one deliberate first-class node/editor load owner;
- reserve `editor` and `pe` from generic extras;
- exact-gate supported editor schemas;
- preserve unknown schemas opaquely;
- avoid read-time shape mutation and silent truth migration;
- preserve current small v1 Outline behaviour;
- decide how to retain `data` extras on `portal.export.v1` reload; and
- explicitly scope the lexical `state` access gap rather than casually exposing mutable state globally.

P010 does not approve or implement any of those fixes.

### Git identification

This report is included in the commit titled `P010 Specify PE persistence contract`. Its resulting SHA is not embedded in the same commit because adding that SHA would create a different commit. Completion is gated on pushing that commit to `origin/main`, fetching again, confirming local `main` and `origin/main` resolve to the same commit, and confirming the worktree is clean.

---

## POCKET TASK P009

Title: Audit the PE data model and design a safe migration path

Status: documentation-only architecture audit completed against current `origin/main`.

Commit title:

- `P009 Audit PE data model migration`

### Starting point

- Repository: `MSHND/notespace`
- Local repository: `/Users/murrayhenderson/Library/Mobile Documents/com~apple~CloudDocs/MSHND-notespace`
- Configured origin: `https://github.com/MSHND/notespace.git`
- Expected and confirmed starting `origin/main`: `26b6937b54cdd0b383054b1b4fa607d5e159e33e`
- Starting commit: `P008 Fix PE text-to-outline indentation`
- P008 browser acceptance was supplied by Murray in the task.
- `git fetch origin` found no commits newer than the expected P008 baseline.
- Local `main` matched `origin/main`, and the working tree was clean before the audit.
- No personal Pocket truth file outside the repository was inspected.

### Audit scope

The audit traced the active routes for:

- JSON parse, root-shape recognition and node normalisation;
- state adoption and `nodeMap()`;
- node creation defaults;
- PE edit routing and payload construction;
- Text and Outline initialisation;
- Text-to-Outline and Outline-to-Text conversion;
- structured multiline paste;
- runtime save-payload construction;
- PE application, change detection and operation recording;
- truth-file export and active-file session protection;
- browser recovery, PiP, cache, last-save and Vault representations;
- stale-file checks;
- legacy popout fallback behaviour;
- search and details-first copy-context consumers; and
- repository fixtures and architecture documentation.

The current implementation was inspected directly rather than inferred from prior reports.

### Principal verified findings

#### The intended PE-aware load normaliser is not active

`index.html` loads, in this order:

1. `js/pocket-editor-metadata.js`
2. `js/pocket-pe-import-preserve.js`
3. `js/pocket-storage.js`
4. `js/pocket-import.js`

The first two scripts install editor-aware versions of `normaliseNodes()`. The later top-level declaration in `js/pocket-import.js` replaces them. An in-memory VM probe using the actual source order confirmed that the final owner is the generic importer.

`editor` and `pe` are not reserved core fields in `js/pocket-data.js`. They therefore pass through `normaliseNodeExtras()`, which allows at most 24 extras and only 8,000 serialised characters for an object value.

The probe confirmed:

- a small unknown editor object survived unchanged as a generic extra;
- an editor object over 8,000 characters was absent after load normalisation;
- `portal.export.v1` used the top-level tree when root and nested copies disagreed; and
- `portal.mtt.web.v1` used the nested `data` tree.

This is the audit's highest-priority persistence weakness. A current PE can save editor metadata much larger than the generic load cap, so a large saved Outline can lose its structural metadata on hard refresh and fall back to the at-most-4,000-character details projection.

The older editor-aware normaliser cannot simply be reactivated. It uses a different meaningful-Outline rule and can let generic extras overwrite its normalised editor value.

#### Current canonicality depends on mode

- `node.label` is the title truth.
- For Text, `node.details` is the active content truth and accepted Outline metadata is absent.
- For a supported saved Outline, `node.editor.outline` is the active content winner.
- An Outline save also writes an indented `node.details` compatibility projection.
- Array position is operationally authoritative. Block `order` is regenerated as `index + 1`.
- Saving an Outline while in Text deletes `node.editor`, losing IDs, depths, collapse state and any content beyond the details limit.
- Empty or whitespace-only content has no `details` and no meaningful editor metadata, and reopens in Text.

#### Active editor validation is lossy and does not check schema

`PocketNodePopoutModel.normaliseEditorMeta()`:

- does not verify the incoming schema;
- rewrites accepted metadata as `pocket.nodeEditor.v1`;
- retains the first 400 blocks;
- retains the first 4,000 characters per block;
- clamps rounded depth to 0 through 8;
- creates missing IDs;
- retains duplicate non-empty IDs;
- replaces incoming order with array index plus one; and
- removes unknown editor and block fields when metadata is rewritten.

A second actual-model probe confirmed those behaviours, including unknown-schema coercion, duplicate-ID retention, missing-ID generation, 400/4,000 caps, 8/0 depth clamping, sequential order and current empty-Outline rules.

Duplicate IDs are operationally unsafe because selection and text synchronisation use ID sets and first-match lookup.

#### Persisted Outline and Text limits do not align

`node.details` is capped at 4,000 characters. A current Outline can contain up to 400 blocks with up to 4,000 characters per block in the active model. Runtime content is not warned or blocked before apply-time normalisation.

Reachable consequences include:

- a full Outline plus a truncated details projection;
- loss of all Outline-only content when saving that node as Text;
- more than 400 short Text lines producing a runtime Outline whose saved editor contains only the first 400 rows;
- oversized block tails being sliced on changed save; and
- a saved editor over 8,000 serialised characters being dropped by the next file load.

Text normalisation also removes carriage returns, converts tabs to two spaces, trims outer and trailing-line whitespace, collapses three or more newlines to two, and then slices. Text-to-Outline deliberately ignores all blank lines.

#### `node.pe` is a stale third representation

`applyLoadedState()` calls `ensurePeFromLegacyDetails()`, adding a `pocket.pe.v1` Text copy to every details-bearing node that lacks one. No operation is recorded. Opening alone does not write, but the next unrelated explicit export can persist that added object.

The active standalone PE reads and writes only `node.details` and `node.editor`; it never synchronises `node.pe`. `js/pocket-filter-pe-search.js` still indexes `node.pe`, so stale legacy content can affect search.

#### Unknown and future metadata is not safely gated

Small unknown editor schemas can survive an unrelated export as generic extras, but the active PE ignores the schema identifier. A structurally Outline-like future object can be opened and rewritten as v1 on any actual edit, losing unknown fields. Future root schemas with a top-level tree can load, but export always emits `portal.export.v1`. Unknown root and node fields survive only within bounded extras rules.

No safe older-version editing contract exists. The readable `details` projection is useful compatibility, but it is not proof that older versions preserve or round-trip editor metadata.

#### PE apply has a source-identity gap

The truth export queue correctly captures and verifies the active file session. The PE payload itself contains a node ID but no file-session token or original node revision. `applyPayload()` resolves that ID against the current `nodeMap()`.

If file A's PE remains open, file B becomes active, and B has the same node ID, the popup can apply A's content to B before export captures B's valid session. A missing ID safely rejects. This is a verified static route and was not tested against personal files.

#### Recovery mirrors the same model

Local safety, PiP, cache, last-save and Vault representations copy the same in-memory node fields in different wrappers and with different caps. Readers that call current normalisation inherit the editor/extras limitation.

The selected local JSON remains the only document truth. Browser storage is recovery support. Opening a file does not write it. Main Save and canonical PE Save still use explicit truth-file persistence, and PE remains dirty when persistence fails.

The adjacent `js/pocket-pe-save-dirty.js` wrapper still wraps bridge open/apply surfaces and exposes legacy `__pocketPeApplyAndSave`, but the current generated node-popout runtime saves directly through `PocketNodePopoutEditor.applyAndSave()`. The legacy helper is therefore not the canonical current save owner.

### Recommendation

The durable report recommends **Option A: retain the broad current v1 model and strengthen its contracts**.

No truth-file schema migration is recommended now. The immediate work is safety hardening:

- one deliberate first-class node/editor load owner;
- exact schema recognition;
- opaque preservation for unknown schemas and fields;
- visible validation instead of silent truncation;
- unique block-ID enforcement;
- explicit array-order ownership;
- no automatic creation of new legacy `node.pe` shadows;
- explicit semantics for converting a saved Outline to Text; and
- PE binding to its originating file session and node revision.

For Outline, keep `editor.outline` canonical and `details` as a derived compatibility projection until Murray chooses otherwise. This best fits Pocket's explicit local ownership, inspectable JSON, simple recovery and small-app scale.

The recommended immediate next task is P010, a non-writing contract and synthetic-fixture test pass. A v2 or unified content schema should be reconsidered only after current v1 is safe and a real product requirement justifies migration.

### Documentation produced

- `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`

The migration-plan report contains all required sections:

1. Executive Summary
2. Current Truth Model
3. Data Flow Map
4. Current Invariants
5. Duplicated or Derived Data
6. Limits and Data-Loss Analysis
7. Compatibility Matrix
8. Options
9. Recommendation
10. Proposed Target JSON
11. Migration Policy
12. Proposed Implementation Phases
13. Test and Acceptance Plan
14. Open Product Decisions for Murray
15. Non-goals

It also includes an evidence index, concrete JSON examples, P010 through P016 tentative phase boundaries and explicit distinctions between verified behaviour, inferred risk, proposed design and product choices.

### Files changed

- `docs/PE_DATA_MODEL_MIGRATION_PLAN.md`
- `docs/CODEX_REPORT.md`

No JavaScript, HTML, CSS, JSON fixture, runtime configuration, dependency, retired PE file or personal truth file was changed.

### Checks performed

- Confirmed the repository root and configured `MSHND/notespace` origin.
- Ran `git status` before the audit and confirmed a clean working tree.
- Ran `git fetch origin`.
- Confirmed starting local `HEAD` and `origin/main` were both `26b6937b54cdd0b383054b1b4fa607d5e159e33e`.
- Confirmed no commits were newer than the expected P008 baseline.
- Searched the repository for the requested model fields, schemas, normalisers, payload builders, conversions, apply/save owners, export/serialisation, recovery and migration references.
- Inspected all current active route files and adjacent legacy/recovery consumers named in the evidence index.
- Executed the exact-load-order VM probe described above against current source.
- Executed the active-model boundary probe described above against current source.
- Confirmed all named report functions and files exist on current main.
- Confirmed the fifteen required numbered headings occur once and in order.
- Confirmed Markdown code fences are balanced.
- Reviewed Markdown tables and heading boundaries.
- Ran `git diff --check`.
- Reviewed the complete documentation diff.
- Confirmed only the two expected documentation files changed.
- Confirmed no temporary validation files or personal data were added.
- Confirmed no runtime file changed.

No JavaScript syntax check was needed because no JavaScript changed. `node tools/pocket-check.js` and `npm run check` were not run, as required.

### Product decisions still requiring Murray

The report asks Murray to decide, before future implementation:

- the conflict winner when Outline and details disagree;
- what Text means on an existing Outline;
- the future of legacy `node.pe`;
- the user experience at content limits;
- the older-version compatibility promise;
- the unsupported-editor-schema experience; and
- the trigger for any later real migration.

Codex recommends Outline as winner for a supported schema, projection-only Text plus explicit Convert to Text, preserve-but-stop-generating legacy `pe`, block rather than truncate, readable older-version fallback only, read-only unknown schemas, and explicit previewed migration with a verified backup.

### Git identification

This report is included in the commit titled `P009 Audit PE data model migration`. Its resulting SHA is not embedded in the same commit because adding that SHA would create a different commit. The completion response is gated on pushing that commit to `origin/main`, fetching again, confirming local `main` and `origin/main` resolve to the same commit, and confirming the worktree is clean.
