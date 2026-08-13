# Synced Pocket deployment readiness

## Audit result

This map describes the repository at accepted commit `f1ba8100304b878f6e50de584921701481d3a346`. Source and tests are authoritative. Older Sync documents are useful design history, but several still describe components as unloaded or unimplemented after later work composed them.

The Sync path is production-shaped and substantially implemented locally: client-side encryption and device storage, passkey account ceremonies, a same-origin browser transport, secure-cookie HTTP adapter, transactional service core, PostgreSQL store and schema verification, explicit Save ownership, activation, additional-device opening and emergency recovery all exist. Automated tests cross the browser transport, HTTP/session adapter and service core without sending readable Pocket content.

It is **not ready for public deployment**. The repository has only a loopback local host, and the production bootstrap, public ingress policy, abuse controls, security headers/release integrity, database retention, backup/restore, health/observability and target-origin physical browser/passkey acceptance are not complete. The public account lifecycle also lacks logout, credential/session administration and account deletion.

## Current architecture

1. The normal Pocket page loads the browser Sync contracts, crypto, IndexedDB store, account client, remote client, activation, owner controller, browser runtime and minimal UI. Those modules do no network or passkey work at load. The normal page does not create the runtime or install the UI integration ([`index.html`](../index.html#L336), [`PocketSyncUi.install`](../js/pocket-sync-ui.js#L20)).
2. The only complete composition is the developer-operated local host. It serves reviewed static assets, injects the additional-device, recovery and local-integration modules, creates a relative-path transport, and installs the Sync UI ([`LOCAL_MODULE_TAG`](../sync-service/pocket-sync-local-integration-server.js#L13), [`PocketSyncLocalIntegration.create`](../js/pocket-sync-local-integration.js#L45)).
3. Browser requests use relative same-origin paths, `POST`, `credentials: same-origin`, `mode: same-origin`, `cache: no-store`, rejected redirects and no referrer. Request and response bodies are strictly validated and bounded ([`createBrowserJsonTransport`](../js/pocket-sync-remote-client.js#L300)).
4. The HTTP adapter accepts only the fifteen fixed API routes. It rejects wrong origins, non-`same-origin` Fetch Metadata, non-JSON bodies, content encoding and `Authorization`; it maps an opaque server-side session to one secure host-only cookie ([`createHttpAdapter`](../sync-service/pocket-sync-http-adapter.js#L218)).
5. The service core independently validates WebAuthn/account/session/Pocket relationships, encrypted record shapes, revisions, key sets, recovery state and idempotency inside injected transactions ([`createServiceCore`](../sync-service/pocket-sync-service-core.js#L1549)).
6. The PostgreSQL adapter stores strict JSONB records in one fixed table and uses insert-only or store-version compare-and-swap mutations inside database transactions ([`createPostgresStore`](../sync-service/pocket-sync-postgres-store.js#L138), [`001-pocket-sync-store.sql`](../sync-service/migrations/001-pocket-sync-store.sql)).
7. Readable Pocket content and the master key remain in the browser. The service receives opaque ciphertext, public WebAuthn material, public recovery-verification material and operational metadata. Ordinary Synced Save is device-first and sends only encrypted content through the owner-aware Save boundary ([`createSyncedOwnerController`](../js/pocket-sync-owner-controller.js#L250), [`PocketOwnerSaveBoundary`](../js/pocket-owner-save-boundary.js)).

## What is already implemented and proved locally

| Area | Current evidence | Boundary |
| --- | --- | --- |
| Encryption and local durability | AES-GCM content/envelope formats, non-extractable browser keys, encrypted IndexedDB records, usage accounting and compare-and-swap are implemented and covered by `tests/p029-*`, `p030-*` and `p042-*`. | Browser security still depends on the integrity of the served same-origin code and browser/device. |
| Account and passkeys | Registration, discoverable authentication, session rotation and real `@simplewebauthn/server` verification bind challenge, origin, RP ID, stored credential and user verification ([`createWebAuthnVerifier`](../sync-service/pocket-sync-webauthn-verifier.js#L140), [`tests/p048-webauthn-verifier.test.js`](../tests/p048-webauthn-verifier.test.js)). | Verifier tests use controlled library results; there is no recorded target-origin physical authenticator acceptance. |
| Recovery | Recovery uses an offline package with a client-held Ed25519 private key; the service stores and uses only the SPKI public verifier. Proofs bind the full recovery transcript ([`createRecoveryProofVerifier`](../sync-service/pocket-sync-recovery-proof-verifier.js#L72), [`tests/p050-asymmetric-recovery-authorisation.test.js`](../tests/p050-asymmetric-recovery-authorisation.test.js)). | Human storage, printing/import, lost-copy support and real-device recovery still need acceptance and operations policy. |
| Same-origin HTTP/session | Exact routes, origin/Fetch Metadata checks, request bounds, opaque errors, cookie rotation and cookie clearing are implemented and tested ([`pocket-sync-http-adapter.js`](../sync-service/pocket-sync-http-adapter.js), [`tests/p046-sync-http-adapter.test.js`](../tests/p046-sync-http-adapter.test.js)). | No deployed reverse proxy, security-header policy or penetration test proves the boundary on a public origin. |
| PostgreSQL | The store provides atomic transactions, insert-only writes and compare-and-swap; startup checks database reachability and exact schema v1 ([`createSyncServerApplication.preflight`](../sync-service/pocket-sync-server-runtime.js#L229), [`tests/p047-postgres-store.test.js`](../tests/p047-postgres-store.test.js)). | No hosted PostgreSQL, pool tuning, database TLS proof, retention job, backup or restore drill exists in this repository. |
| End-to-end local composition | The acceptance test crosses browser transport, secure-cookie continuity, service core, encrypted Save and local host asset isolation ([`tests/p051a-local-sync-acceptance.test.js`](../tests/p051a-local-sync-acceptance.test.js)). | It is an automated harness, not a physical browser/passkey run against PostgreSQL and public ingress. |
| Activation/open/recovery UI | The minimal doorway, activation, passkey-PRF second-device opening, recovery adoption and owner-aware Save path exist in the local injected composition ([`pocket-sync-browser-runtime.js`](../js/pocket-sync-browser-runtime.js), [`pocket-sync-additional-device.js`](../js/pocket-sync-additional-device.js), [`pocket-sync-ui.js`](../js/pocket-sync-ui.js)). | The normal hosted page does not create this composition. Approved-device pairing, conflict resolution and account administration are absent. |

## Hosted runtime components

A hosted environment using the current code needs all of the following:

| Component | Required responsibility |
| --- | --- |
| Canonical public HTTPS origin | Serve Pocket browser assets and the production Sync bootstrap from the same origin used by the API and WebAuthn. |
| Public ingress / reverse proxy | Terminate public traffic, forward the configured API root to the loopback HTTPS Node service, preserve the exact request path, `Origin`, `Sec-Fetch-Site`, `Cookie` and separate `Set-Cookie` values, and apply public TLS/security/abuse policy. The Node listener accepts only `127.0.0.1` ([`listenOptions`](../sync-service/pocket-sync-server-runtime.js#L185)). |
| Node.js service | Node 24 or later, the locked production dependencies, TLS material, service configuration and a supervised `npm run sync:server` or a new reviewed production composition. Node 24 is required for `Headers.getSetCookie()` ([`validatePlatform`](../sync-service/pocket-sync-server-runtime.js#L29)). |
| Static application host | Serve the exact reviewed application assets plus a production-safe external bootstrap. The current local host's injected inline bootstrap is a development mechanism, not a CSP-ready production design. |
| PostgreSQL | Durable database, user/database provisioning, network/TLS policy, schema v1, capacity, backups, monitoring and restore capability. |
| Migration job | Run `npm run sync:db:migrate` deliberately before the application version that needs the schema, then require schema preflight success. |
| Secrets/configuration facility | Supply the database URL and TLS private-key path without committing or logging them, rotate them safely, and restrict runtime access. |
| Process/health supervision | Start one or more instances, route only to ready instances, deliver termination signals, bound draining, restart failures and surface diagnostics. This is not supplied by the repository. |
| Browser secure context | Supported browsers with WebAuthn, Web Crypto, IndexedDB and the required local file/recovery-copy capabilities. |

The current service can sit behind provider-neutral ingress because it reconstructs the adapter URL from the configured trusted origin and request target rather than trusting `Host` or `X-Forwarded-*`. It still terminates HTTPS on loopback, so a proxy must use and validate that internal HTTPS connection or a separately reviewed runtime must change the arrangement.

## Environment, configuration and secrets

[`createLocalServerConfig`](../sync-service/pocket-sync-server-config.js#L69) is the only process-environment reader.

| Name | Required | Consumer | Meaning and deployment constraint |
| --- | --- | --- | --- |
| `POCKET_SYNC_DATABASE_URL` | Yes | migration command and Node runtime | PostgreSQL connection string. Treat as a secret. The code passes only `{ connectionString }` to `pg`; TLS mode, timeouts and pool sizing are not separately enforced. |
| `POCKET_SYNC_TLS_CERT_FILE` | Yes | Node runtime | Path to the certificate bytes used by the loopback HTTPS server. Certificate material is public, but its file integrity matters. |
| `POCKET_SYNC_TLS_KEY_FILE` | Yes | Node runtime | Path to the matching private key. Secret. |
| `POCKET_SYNC_TRUSTED_ORIGIN` | Yes | HTTP adapter, service core, WebAuthn verifier | One canonical HTTPS origin with no path/query/fragment. It may include a port. It must equal the browser origin exactly. |
| `POCKET_SYNC_RP_ID` | Yes | WebAuthn options and verifier | Exact lower-case hostname of the trusted origin, without port. Parent-domain RP scope is deliberately unsupported. |
| `POCKET_SYNC_RP_NAME` | No | WebAuthn registration options | Display name, default `Pocket local Sync`. A public deployment should set reviewed product copy. |
| `POCKET_SYNC_SERVICE_ROOT` | No | browser route composition and HTTP adapter | Same-origin absolute path root, default `/pocket-sync/v1`; no URL, query, fragment, encoded or dot-path tricks. |
| `POCKET_SYNC_PORT` | No | Node listener | Loopback port, default `8443`. Host is fixed to `127.0.0.1`. |

Ceremony lifetime (five minutes), session lifetime (30 days), credential algorithms (`ES256` and `RS256`) and encryption policies are currently code constants, not operator configuration. There is no server-side session-signing secret: session IDs are cryptographically random opaque values stored in PostgreSQL. Recovery signing private keys and recovery roots are client-only and must never be added to deployment secrets.

## Origin, TLS and WebAuthn constraints

- Frontend and API must be one exact HTTPS origin. There is no CORS mode and no bearer-token alternative.
- The RP ID must be the exact origin hostname. A later hostname change can strand existing passkeys, so the production hostname is a durable product/operations decision.
- The proxy must not rewrite the API path or public `Origin`; the adapter rejects queries, fragments, unknown routes and non-exact origins.
- `__Host-pocket-sync-session` is `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` and has no `Domain` attribute ([`sessionSetCookie`](../sync-service/pocket-sync-http-adapter.js#L209)). This is a strong implemented boundary, but its behaviour through the chosen proxy/browser path remains unverified.
- The application checks exact `Origin` and `Sec-Fetch-Site: same-origin` in addition to the strict cookie. This is the current CSRF boundary; no separate CSRF token exists.
- Public TLS termination, HSTS, certificate renewal, internal proxy-to-Node certificate validation and downgrade handling are deployment responsibilities not implemented here.
- The current static host sends `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, but no CSP, HSTS, frame restriction, Referrer Policy or Permissions Policy. Because served same-origin JavaScript can read an unlocked Pocket, deployment-grade content security and release integrity are blockers, not cosmetic headers.

## PostgreSQL and migration lifecycle

- Schema v1 consists of `public.pocket_sync_records` and `public.pocket_sync_schema`. Records are keyed by collection and opaque record key, with exact collection and JSON/store-version constraints ([`001-pocket-sync-store.sql`](../sync-service/migrations/001-pocket-sync-store.sql)).
- `npm run sync:db:migrate` reads only migration `001`, executes it and verifies the catalogue and schema-version row ([`applyLocalMigration`](../sync-service/pocket-sync-db-migrate.js#L17), [`verifyPocketSyncSchema`](../sync-service/pocket-sync-postgres-schema.js#L52)). The server never migrates automatically.
- Startup performs recovery-crypto capability, `SELECT 1` and exact schema verification before listening. A mismatch fails closed.
- The migration does not create the database or role. There is no migration lock, ordered migration ledger beyond one schema-version row, checksum, dry run, down migration, deployment orchestration or rollback runbook.
- The application creates an ordinary `pg.Pool` from the connection string with no explicit maximum, idle/connect/query/statement timeout, application name or TLS object ([`createSyncServerApplication`](../sync-service/pocket-sync-server-runtime.js#L194)). These values therefore depend on driver defaults and connection-string/provider behaviour.
- The service core never calls the store's `remove` method. Expired/revoked sessions, pending/completed ceremonies and immutable operation/key-operation results accumulate indefinitely. This is a demonstrated retention/resource gap, not merely an untested concern.
- The current record table stores only the latest encrypted Pocket content, not content history. Database backup is still required for account credentials, sessions, opaque recovery/key metadata and availability.

## Session and authentication boundary

Implemented:

- Registration and authentication require WebAuthn user verification and exact challenge/origin/RP binding.
- A successful ceremony creates a random database-backed session; a successful session-bound ceremony atomically creates the replacement and revokes the prior session.
- Sessions have a fixed expiry and do not slide. Invalid, revoked or expired sessions cause the cookie to be cleared.
- Account authentication never claims content unlock. Content requires a separately authenticated local envelope path.
- One v1 account may bind one Synced Pocket. Account and Pocket identifiers are opaque.

Still unproved or absent:

- There is no logout route, revoke-all-sessions route, credential list/revocation flow, account deletion implementation or operator-safe emergency revocation path. The API route map is exactly the fifteen Sync operations ([`CLIENT_ROUTES`](../sync-service/pocket-sync-http-adapter.js#L5)).
- New-account registration is open to any caller that can reach the same-origin endpoint and complete a passkey ceremony. Invite-only versus open beta is not encoded.
- Cookie/proxy behaviour, passkey discoverability, counter/backup behaviour and session rotation have not been accepted on the intended public origin and supported physical platforms.
- The 30-day session lifetime is hard-coded. Product risk, shared-device behaviour and support expectations need an explicit decision.

## Recovery verifier operations

- Activation generates a recovery root and Ed25519 keypair locally. PostgreSQL stores only an SPKI public verifier and encrypted recovery envelope; the saved recovery package retains the root and PKCS8 private signing material.
- Recovery proof binds ceremony, operation, challenge, Pocket, device, recovery/key-set versions, expiry and the new credential digest. The server's startup preflight proves Ed25519 support before listening.
- Successful recovery creates a new credential/session, then requires atomic recovery locator/verifier/envelope rotation and a replacement recovery copy. The old locator and old envelope ciphertext are revoked/removed from active state.
- No shared recovery service key is required. Operations instead require secure backup of the database records, clear human recovery-copy guidance, an incident procedure for suspected copy theft, and support rules that do not create an administrative bypass.
- Real import/export, cancellation, wrong-copy, expired ceremony, lost-response resume and replacement-copy scenarios still require physical browser acceptance. Recovery begin is unauthenticated except for possession of an opaque locator, so rate limiting and enumeration-resistant monitoring are mandatory.

## Request, rate and resource controls

Current controls:

- Small JSON requests/responses are limited to 256 KiB; encrypted content upload/download JSON is limited to 16 MiB. Declared and streamed byte counts are checked, invalid UTF-8 and non-object JSON are rejected, and oversized reads are cancelled ([`POLICY`](../sync-service/pocket-sync-http-adapter.js#L24), [`readBody`](../sync-service/pocket-sync-http-adapter.js#L154)).
- Identifiers, encrypted formats, decoded sizes, revisions, key-set versions and exact request fields are bounded by the browser client and service core.
- Conditional writes and key/recovery mutations are idempotent and compare-and-swap; the client performs no automatic retry.

Demonstrated gaps:

- There is no rate limiter, quota, concurrency cap, per-account/per-origin/per-network abuse policy or trusted-edge identity contract.
- The 16 MiB request body is buffered completely in process memory. There is no request deadline, socket deadline or abort signal. Concurrent slow or maximum-size requests therefore present an unmeasured exhaustion risk.
- The `pg` pool has no explicit size or wait/query timeout and each core operation opens a transaction. Capacity and failure behaviour under saturation are unmeasured.
- Unauthenticated registration, discoverable authentication and recovery-begin can create durable ceremony records. With no cleanup, an attacker can drive unbounded database growth even when cryptographic finish fails.
- The browser transport has no fetch timeout. A stalled request can leave the explicit setup/Save UI waiting indefinitely, although it does not silently claim success.

## Logging, observability and failure diagnosis

The confidentiality boundary is good: core, verifier and store errors are reduced to stable codes and do not log bodies, credentials, recovery proofs, ciphertext or native errors. However, the executable also suppresses all startup and request diagnostics. Top-level failure only sets a non-zero exit code; handled requests emit no request ID, safe event, latency, result class or metric.

Before public beta, add provider-neutral, body-free observability for startup/preflight, route/result class, rate-limit decisions, latency, database pool pressure, transaction failure classes, passkey/recovery ceremony outcomes, session invalidation, conditional-write conflicts and shutdown. Define alerting and redaction tests. Never log cookies, opaque identifiers in full, WebAuthn responses, recovery proofs, encrypted bodies or readable Pocket data.

## Backup, restore and durability

No backup or restore implementation or runbook exists. Before public deployment, the chosen PostgreSQL service must have encrypted backups, retention, point-in-time or equivalent recovery appropriate to the beta, access controls, monitoring and a tested restore into an isolated environment. Define and test RPO/RTO, database corruption/region-loss response, restore-time schema verification and how restored session/ceremony state is handled.

End-to-end encryption limits confidentiality exposure from database backups, but it does not make backup optional. Losing account public keys, Pocket ciphertext, envelope/recovery metadata or operation outcomes can make encrypted user data unavailable or make safe idempotent resume impossible. A local device record and recovery copy are valuable independent recovery paths, not a substitute for service durability.

## Deployment, startup, shutdown and health

Implemented:

- Startup validates Node capability, recovery verifier capability, database reachability and exact schema before listening.
- The executable handles `SIGINT` and `SIGTERM`, stops the HTTPS server and closes the PostgreSQL pool ([`startLocalServer`](../sync-service/pocket-sync-server.js#L7), [`createSyncServerRuntime.close`](../sync-service/pocket-sync-server-runtime.js#L290)).
- Startup and shutdown are idempotent within one process and failures return non-zero status.

Missing:

- No production build/deploy manifest, container/service definition, production static bootstrap, readiness/liveness endpoint or provider health integration.
- No startup log identifies which preflight failed. No health check revalidates database availability after startup.
- No graceful-drain deadline, forced close, in-flight request accounting or shutdown completion telemetry exists.
- No rolling-deploy, migration-before-code, rollback or certificate-rotation runbook exists.
- The listener is loopback-only and requires a separately configured public ingress.

## Physical browser/passkey acceptance required before shipping

Run these against the chosen canonical public origin, real ingress and PostgreSQL, not only a test adapter:

1. Registration and discoverable sign-in with each supported browser/OS/authenticator class, including user cancellation, user-verification failure, backed-up and single-device credentials, and a zero/non-zero signature counter.
2. Cookie issue, rotation, expiry and clearing through the real proxy; verify no cookie appears in JavaScript, URLs, bodies or logs.
3. Activation from JSON and Vault, including dirty-source Save, cancellation, resumption after each durable stage, local recovery-copy permission/write, and final owner transition.
4. Explicit Synced Save success, network ambiguity, service unavailable, idempotent retry, remote conflict and browser restart with a pending encrypted Save.
5. Another-device opening with real PRF available, enabled-without-output and unavailable paths; confirm the PRF result never reaches transport or logs.
6. Emergency recovery with correct, wrong, damaged and obsolete copies; interrupted finish/rotation; replacement-copy write failure and resume; rejection of the old locator after rotation.
7. IndexedDB persistence/eviction behaviour, storage pressure, multi-tab races, refresh/close during operations and an actual device without a local source file.
8. Security-header/CSP compatibility and a release-integrity check proving the browser received the intended reviewed assets.

A narrow target-origin smoke covering registration, session cookie, encrypted activation, Save/readback and emergency recovery is a blocker before any public exposure. The broader supported-platform matrix is required before public beta.

## Security and failure-honesty findings

| Finding | Evidence level | Consequence |
| --- | --- | --- |
| Normal static Pocket does not create the Sync integration; only the local server injects it. | Proven gap | A normal public static deployment cannot turn on or open Sync. |
| No server/edge rate limiting or database cleanup exists. | Proven gap | Unauthenticated ceremony creation and large/concurrent bodies can consume database, connections and memory. |
| No CSP/HSTS/frame/permissions policy is emitted, and the local composition injects inline executable script. | Proven gap | The current local serving shape is not an acceptable public release-integrity boundary for an E2EE web client. |
| No logout, credential/session administration or account deletion endpoints exist. | Proven product/operations gap | Users and support cannot deliberately end all account authority or delete the remote account state. |
| Startup and request failures are intentionally opaque externally and also unobservable operationally. | Proven operations gap | Safe diagnosis, alerting and incident response are not possible from current process output. |
| Database TLS, pool/timeouts, proxy header/cookie forwarding and internal TLS are correct for a future host. | Unverified risk | Misconfiguration could cause availability failure or weaken the intended boundary; current source neither proves nor detects all host policy. |
| Physical WebAuthn/PRF behaviour matches controlled tests on the chosen public hostname. | Unverified risk | Registration, sign-in or second-device unlock may fail on real supported platforms. |
| Backup restoration preserves a coherent, usable service. | Unverified risk | A provider backup may exist yet fail operational recovery or restore unsafe stale sessions/ceremonies. |
| The service remains responsive under concurrent 16 MiB uploads, slow clients and database saturation. | Unverified risk | Memory, pool or latency exhaustion may deny service. |

This audit did not demonstrate a source-level plaintext upload, master-key upload, authentication bypass or unsafe last-write-wins path. That is not a penetration-test claim. Public release still requires the controls and acceptance above.

## Remaining work, classified

| Classification | Remaining item | Exit evidence |
| --- | --- | --- |
| **BLOCKER BEFORE PUBLIC DEPLOYMENT** | Choose and implement one production same-origin composition for static assets, Sync bootstrap, API ingress and loopback service; remove reliance on the development inline injection. | Deployed target serves reviewed assets, installs Sync deliberately, routes all fifteen API paths and passes CSP/release-integrity checks. |
| **BLOCKER BEFORE PUBLIC DEPLOYMENT** | Fix the public origin, RP ID, DNS, TLS termination/internal TLS and secret-delivery model. | Configuration review plus target-origin TLS, Origin, RP-ID and cookie tests. |
| **BLOCKER BEFORE PUBLIC DEPLOYMENT** | Provision Node 24+ and PostgreSQL with schema v1, network access controls and deliberate migration ordering. | Clean environment migration, startup preflight and encrypted end-to-end local/public-ingress round trip. |
| **BLOCKER BEFORE PUBLIC DEPLOYMENT** | Add edge/application abuse controls and durable retention/cleanup for unauthenticated and expired records. | Documented limits, tests for registration/authentication/recovery and content routes, safe 429 behaviour, bounded cleanup and load/slow-client evidence. |
| **BLOCKER BEFORE PUBLIC DEPLOYMENT** | Establish deployment-grade CSP/security headers and reviewed asset/release integrity. | Header scan and physical-browser acceptance with no inline-policy bypass. |
| **BLOCKER BEFORE PUBLIC DEPLOYMENT** | Establish and test PostgreSQL backup/restore with approved RPO/RTO. | Successful isolated restore, schema verification and recovery/Save readback. |
| **BLOCKER BEFORE PUBLIC DEPLOYMENT** | Run a target-origin physical passkey/recovery smoke. | Real registration, session, activation, encrypted Save/readback and recovery succeed through production ingress. |
| **REQUIRED BEFORE PUBLIC BETA** | Implement logout, session/credential revocation and account deletion/retention behaviour with clear UI. | End-to-end revocation/deletion tests and support runbook; no local file is silently deleted. |
| **REQUIRED BEFORE PUBLIC BETA** | Add safe structured logs, metrics, request correlation, alerts and redaction tests. | Operators can diagnose startup, availability, abuse and conflicts without secret/body exposure. |
| **REQUIRED BEFORE PUBLIC BETA** | Add readiness/liveness integration, bounded graceful shutdown and rolling deploy/rollback procedures. | Health and drain tests during database loss, deployment and termination. |
| **REQUIRED BEFORE PUBLIC BETA** | Define pool, request/socket/fetch timeouts, concurrency limits and initial capacity. | Load, slow-client and database-saturation tests meet the chosen service objective. |
| **REQUIRED BEFORE PUBLIC BETA** | Complete the supported browser/OS/passkey/PRF/recovery acceptance matrix. | Recorded results for the declared support set and accessible failure/cancellation copy. |
| **REQUIRED BEFORE PUBLIC BETA** | Provide a calm remote-conflict review/resolution path. | Two-device conflict acceptance proves neither encrypted version is overwritten or stranded. |
| **REQUIRED BEFORE PUBLIC BETA** | Create migration, certificate/key rotation, backup, restore, incident and customer-support runbooks. | Dry runs with named ownership and rollback/communication triggers. |
| **SAFE TO DEFER** | Background sync, automatic retry, polling and autosave. | Explicit Save and explicit idempotent retry are safe v1 behaviour. |
| **SAFE TO DEFER** | Trusted-device pairing relay. | Passkey-PRF or recovery can remain the supported additional-device paths. |
| **SAFE TO DEFER** | Parent-domain RP IDs, multiple Synced Pockets per account and ciphertext history. | Exact-host, one-Pocket, current-record v1 remains internally coherent. |
| **SAFE TO DEFER** | Multi-region active/active, sophisticated autoscaling and provider-specific optimisations. | A measured single-region beta can scale only when evidence requires it. |
| **SAFE TO DEFER** | Full master-key rotation UI before the existing conservative usage limits approach exhaustion. | Monitor generation/allowance consumption and fail closed as current code does. |

## Decisions Murray/Nara need to make

1. Which long-lived public hostname/origin should own the WebAuthn RP ID, and what public RP display name should users see?
2. Which hosting model/provider and PostgreSQL service best fit the acceptable cost, maintenance burden, geographic placement and operator access model?
3. What RPO, RTO, availability objective and initial beta capacity are worth paying for?
4. Is beta registration invite-only/allowlisted or open self-registration?
5. Which browsers, operating systems and authenticator classes are supported at beta, and is passkey PRF a supported convenience or merely opportunistic?
6. What session lifetime and shared-device/logout expectations are acceptable?
7. What remote account/data retention and deletion policy should apply, including backup retention after deletion?
8. Who owns routine operations, security alerts, recovery-copy support and incident communication during beta?
