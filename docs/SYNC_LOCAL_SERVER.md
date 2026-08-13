# Synced Pocket local server composition

## Status and boundary

P049 adds a locally runnable, production-shaped HTTPS server composition. P051 adds a separate developer-operated same-origin Pocket + Sync composition through `npm run sync:local`. It remains local development infrastructure only: normal `index.html` is product-neutral, no user-facing Sync setup is added, and neither command selects a provider or makes Sync product-ready.

The server composes Node HTTPS, P046's same-origin HTTP/session adapter, the P034-P037 service core, P047's PostgreSQL store, P048's WebAuthn verifier, P050/P050a's Ed25519 recovery verifier and one ordinary `pg` pool. Node 24 or later is required: startup rejects platforms that cannot preserve separate response `Set-Cookie` values. The runtime accepts explicit configuration and does not read process configuration itself. `sync-service/pocket-sync-server.js` remains the API-only local operator entrypoint, binding only `127.0.0.1`.

The server terminates HTTPS itself. It does not accept HTTP for localhost, trust `Forwarded` or `X-Forwarded-*` headers, derive trusted identity from `Host`, add CORS, run a web framework, retry operations or run migrations automatically. The configured HTTPS origin is the sole source for the service core, HTTP adapter and WebAuthn verifier.

## Recovery verifier

P050/P050a provide the reviewed Ed25519 recovery-proof verifier. Before either local host listens it proves the installed Node Web Crypto implementation can import a public SPKI key and verify a known-valid Ed25519 signature. The server receives public verification material only; it never receives recovery roots or private signing keys.

## Local operator sequence

This is developer-operated infrastructure, not Pocket UI configuration.

1. Make an ordinary local PostgreSQL instance available.
2. Obtain a locally trusted HTTPS certificate and key. Do not commit either file.
3. Set `POCKET_SYNC_DATABASE_URL`, `POCKET_SYNC_TLS_CERT_FILE`, `POCKET_SYNC_TLS_KEY_FILE`, `POCKET_SYNC_TRUSTED_ORIGIN` and `POCKET_SYNC_RP_ID`.
4. Use one canonical HTTPS origin, for example `https://pocket.local.test:8443`, and set the RP ID to its exact hostname, `pocket.local.test`.
5. Optionally set `POCKET_SYNC_PORT` (default `8443`), `POCKET_SYNC_SERVICE_ROOT` (default `/pocket-sync/v1`) and `POCKET_SYNC_RP_NAME`.
6. Apply the checked-in schema explicitly with `npm run sync:db:migrate`.
7. Start the API-only service with `npm run sync:server`, or the same-origin local Pocket + Sync host with `npm run sync:local`.

The migration command reads only `sync-service/migrations/001-pocket-sync-store.sql`, uses the operator connection value through `pg`, verifies the resulting fixed `public.pocket_sync_records` and `public.pocket_sync_schema` contract, closes its pool and exits. The same verifier runs before either local server listens. It does not create databases or users, accept a migration-path argument, print credentials or inspect record data.

## P051 local-browser acceptance

`sync:local` binds only `127.0.0.1` and serves the reviewed Pocket browser assets from the configured HTTPS origin. It injects one local-only module into the in-memory index response. It does not write another index file, expose repository files, add CORS or turn ordinary hosting into Sync hosting. Static responses are GET/HEAD only, no-store and cannot shadow the Sync API root.

After explicitly preparing PostgreSQL, trusted TLS material and the environment values above, run `npm run sync:db:migrate`, then `npm run sync:local`. Open the configured HTTPS origin, load or create an ordinary local JSON or Vault Pocket, then in the browser console run `const sync = PocketSyncLocalIntegration.create()`. Run `await sync.activate()`, complete the real passkey and recovery-copy prompts, edit the Pocket and use its ordinary **save** action. Finally run `await sync.verifyRoundTrip()` and require `{ ok: true, revision: 2, matchesCurrentSavedPocket: true }` or a later revision. The same injected integration now exposes only explicit `recoverExisting()` and `resumeRecovery({ recoveryAttemptId })` recovery calls. They use native local-file consent and still do not create a Pocket recovery screen or select a production provider. This documents an implemented local path; it does not claim that a physical browser/passkey smoke test has been run.

## Deferred before any deployment

P051 does not provide public deployment, selected infrastructure provider, rate or abuse controls, backup/restore policy, hosted PostgreSQL, physical browser/passkey acceptance, product-facing Sync enablement, background sync or a second-device journey. The loopback default is not an internet-safety claim.
