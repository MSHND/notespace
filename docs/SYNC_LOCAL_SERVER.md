# Synced Pocket local server composition

## Status and boundary

P049 adds a locally runnable, production-shaped HTTPS server composition. It is development infrastructure only. It does not load any browser Sync code, change Pocket ownership, provide a user-facing setup flow, select a hosting provider or make Sync product-ready.

The server composes Node HTTPS, P046's same-origin HTTP/session adapter, the P034-P037 service core, P047's PostgreSQL store, P048's WebAuthn verifier and one ordinary `pg` pool. Node 24 or later is required: startup rejects platforms that cannot preserve separate response `Set-Cookie` values. The runtime accepts explicit configuration and does not read process configuration itself. `sync-service/pocket-sync-server.js` is the separate local operator entrypoint that reads environment values, builds that configuration and binds only `127.0.0.1`.

The server terminates HTTPS itself. It does not accept HTTP for localhost, trust `Forwarded` or `X-Forwarded-*` headers, derive trusted identity from `Host`, add CORS, run a web framework, retry operations or run migrations automatically. The configured HTTPS origin is the sole source for the service core, HTTP adapter and WebAuthn verifier.

## Recovery limitation

Recovery completion deliberately fails closed in the local P049 executable until a reviewed production recovery-proof verifier exists. P050 must first resolve whether database compromise alone may forge account recovery authorisation; no recovery-proof algorithm has been selected or implemented.

The local entrypoint injects an exact one-method verifier that always rejects. It never returns a successful verification result. Ordinary registration, authentication and encrypted content routes can be exercised, but recovery completion cannot create a credential or session through this executable.

## Local operator sequence

This is developer-operated infrastructure, not Pocket UI configuration.

1. Make an ordinary local PostgreSQL instance available.
2. Obtain a locally trusted HTTPS certificate and key. Do not commit either file.
3. Set `POCKET_SYNC_DATABASE_URL`, `POCKET_SYNC_TLS_CERT_FILE`, `POCKET_SYNC_TLS_KEY_FILE`, `POCKET_SYNC_TRUSTED_ORIGIN` and `POCKET_SYNC_RP_ID`.
4. Use one canonical HTTPS origin, for example `https://pocket.local.test:8443`, and set the RP ID to its exact hostname, `pocket.local.test`.
5. Optionally set `POCKET_SYNC_PORT` (default `8443`), `POCKET_SYNC_SERVICE_ROOT` (default `/pocket-sync/v1`) and `POCKET_SYNC_RP_NAME`.
6. Apply the checked-in schema explicitly with `npm run sync:db:migrate`.
7. Start only the local server with `npm run sync:server`.

The migration command reads only `sync-service/migrations/001-pocket-sync-store.sql`, uses the operator connection value through `pg`, closes its pool and exits. It does not create databases or users, accept a migration-path argument, print credentials or inspect record data.

## Deferred before any deployment

P049 does not provide a production recovery-proof verifier, public deployment, selected infrastructure provider, rate or abuse controls, backup/restore policy, hosted PostgreSQL, physical browser/passkey acceptance or product-facing Sync enablement. The loopback default is not an internet-safety claim.
