# Synced Pocket remote client

## Scope and status

P032 adds the unloaded `PocketSyncRemoteClient` boundary between Pocket's already-encrypted local state and a future version 1 same-origin account/content service. It is absent from `index.html` and `sw.js`, performs no work when loaded, and does not enable sync. No backend, provider, service origin, account session, UI, live owner, Save integration, storage, token manager, envelope operation or service-worker behavior is selected or implemented.

The module composes the existing foundations instead of replacing them:

- P027 owns source-to-synced activation and device-first Save semantics;
- P028 owns exact encrypted-record and conditional-write validation;
- P029 owns local encryption and authenticated formats;
- P030 owns the encrypted device record; and
- P031 owns WebAuthn ceremony validation, browser conversion and client-only PRF handling.

The product principles remain unchanged: the service never receives readable Pocket content or unlock material, Save is explicit, there is no automatic/background retry, conflicts never overwrite newer data, and humans never configure a provider, URL, folder or token.

## Public boundary

`PocketSyncRemoteClient` exports frozen `POLICY` and `ROUTES` values, exact request/response validators, and three factories:

- `createBrowserJsonTransport({ serviceRoot, fetch, TextEncoder?, TextDecoder? })` returns exactly `{ request }`;
- `createAccountService({ transport, now? })` returns exactly P031's four account methods; and
- `createContentService({ transport })` returns `readRevision`, `downloadEncryptedRecord` and `conditionalUpload`.

All public shapes use `apiVersion: 1`, exact allowlists and opaque identifiers of at most 160 characters. The module does not choose an origin or provider.

## Transport and route map

The caller must supply a same-origin absolute-path service root such as `/pocket-sync/v1`. A single trailing slash is normalized. Empty/root-only paths, scheme-relative or full URLs, query strings, fragments, credentials, backslashes, encoded path tricks, empty segments and dot segments fail before `fetch`.

Locked route suffixes are:

| Operation | Suffix |
| --- | --- |
| `beginRegistration` | `/account/passkeys/registration/begin` |
| `finishRegistration` | `/account/passkeys/registration/finish` |
| `beginAuthentication` | `/account/passkeys/authentication/begin` |
| `finishAuthentication` | `/account/passkeys/authentication/finish` |
| `readRevision` | `/pockets/revision/read` |
| `downloadEncryptedRecord` | `/pockets/content/download` |
| `conditionalUpload` | `/pockets/content/conditional-upload` |

Every request is one `POST` with `mode: "same-origin"`, `credentials: "same-origin"`, `cache: "no-store"`, `redirect: "error"`, `referrerPolicy: "no-referrer"`, `Accept: application/json` and `Content-Type: application/json`. Identifiers are in the JSON body, never the URL. The request is validated as finite plain JSON and stringified exactly once.

Only exact JSON object responses are accepted. Redirected responses, missing or non-JSON content types, empty/malformed JSON, arrays, `null`, unexpected statuses and unknown fields fail closed. Account/revision/download operations accept HTTP 200 only; conditional upload accepts 200 or 409 and then requires the matching body form. Declared and actual UTF-8 response sizes are bounded; an oversized stream is cancelled immediately.

Small account/revision JSON is limited to 262,144 bytes. Encrypted content download/upload JSON is limited to 16,777,216 bytes. The downloaded `encryptedRecordSize` is the decoded ciphertext length including the 16-byte authentication tag, excluding the nonce and JSON/base64url framing.

## Browser session boundary

Future authentication is a browser-managed, same-origin secure session cookie. The client supplies `credentials: "same-origin"`; it does not create, inspect or persist session state. There is no bearer-token header, token storage, refresh manager or cross-origin API in v1.

The future server must set and validate the cookie with an appropriate Secure, HttpOnly, SameSite, scope, rotation and expiry policy; bind the session to verified account ceremonies; prevent session fixation; enforce CSRF defenses appropriate to the final deployment; and revalidate account, credential and Pocket ownership on every request. P032 cannot provide those server controls.

## P031 account service

`createAccountService` directly satisfies P031's exact injected service contract: `beginRegistration`, `finishRegistration`, `beginAuthentication` and `finishAuthentication`. P032 calls P031's production validators before and after transport and does not copy their WebAuthn rules.

P031 owns the original begin response, browser gesture, expiry boundaries and begin-to-finish PRF-input continuity. P032 is intentionally stateless: it holds no ceremony cache. It validates each finish request and binds the returned operation, ceremony and credential identities. For the finish response's public PRF input, P032 validates its canonical form while P031 compares it to the original begin response. Raw PRF result bytes never enter P032 requests.

## Content service

### Read revision

The request is exactly `{ apiVersion, operationId, syncedPocketId }`. A response repeats both identifiers and returns either:

- empty state: revision 0, `recordPresent: false`, null content format/version and size 0; or
- present state: a positive revision, `recordPresent: true`, format `pocket.sync.content.opaque`, version 1 and a positive decoded ciphertext size.

Timestamps and filenames are not accepted. Time never chooses a winner.

### Download encrypted record

The request is exactly `{ apiVersion, operationId, syncedPocketId, revision }` with a positive revision. The response repeats those values, supplies the decoded ciphertext size and one exact P028 opaque AES-GCM record. Non-canonical base64url, wrong nonce/tag size, readable fields, identity substitution and revision substitution fail closed.

### Conditional upload

The request requires explicit `apiVersion: 1` and is validated through P028's `buildConditionalWriteRequest`. It carries only the opaque Pocket ID, expected revision, operation ID, logical-change ID, attempt kind and encrypted record. The remote client additionally requires `expectedRevision` to be a non-negative safe integer strictly below `Number.MAX_SAFE_INTEGER`, so the next revision remains safe.

HTTP 200 must be the exact committed result: it wrote, returned a safe-integer revision exactly equal to `expectedRevision + 1`, repeats the operation ID and states whether an idempotent retry replayed the original result. A `new-change` may not claim replay. HTTP 409 must be the exact non-writing conflict result with a safe-integer `actualRevision` greater than the expected revision. A conflict can never be represented as success.

The client never retries automatically. A deliberate idempotent retry must reuse the exact logical request and may receive the original committed result without creating a revision. A network failure after dispatch is reported as unavailable even if the server might have committed; the client does not guess, send a second request or convert ambiguity into success. Durable server-side operation-ID ownership and rejection of reuse with different ciphertext remain mandatory server work.

## Error model and readable-content exclusion

Errors use stable non-secret codes for invalid roots/routes/requests/responses, redirects, content type, size, authentication/authorization, rate limiting, service unavailability and other rejection. Only unavailable/timeout-class failures and rate limiting are marked retryable; no retry is performed. Native network messages and response bodies are not copied into errors or logs.

Exact schemas exclude readable Pocket content, filenames, paths, handles, keys, PRF results, recovery roots and recovery packages. P032 performs no encryption/decryption and has no logging or telemetry surface. A compromised same-origin runtime can still observe data available in that runtime; this narrow boundary does not replace CSP, dependency review or server validation.

## Remaining implementation

Still required are the actual same-origin service and origin selection; server-side WebAuthn verification; secure session creation/persistence/CSRF enforcement; durable conditional-write/idempotency storage; rate/abuse controls; envelope, recovery, device-transfer and deletion operations; content-envelope orchestration; conflict UI; live synced-owner adoption; Save integration; and production security review. P032 stays unloaded until those pieces form one reviewed owner transition and Save path.
