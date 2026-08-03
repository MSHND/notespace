# Synced Pocket key and recovery remote client

## Status and boundary

P038 extends the single dormant `window.PocketSyncRemoteClient` module created by P032 so its browser/service shapes match the P036/P037 key-envelope and recovery service core. The module remains absent from `index.html`, `sw.js` and current Pocket loaders. It selects no origin, creates no HTTP service, performs no activation or key work, stores nothing and changes no owner or Save path.

The original seven P032 suffixes remain unchanged. P038 adds:

| Operation | Same-origin suffix |
| --- | --- |
| `listEnvelopes` | `/pockets/envelopes/list` |
| `downloadEnvelope` | `/pockets/envelopes/download` |
| `addEnvelope` | `/pockets/envelopes/add` |
| `revokeEnvelope` | `/pockets/envelopes/revoke` |
| `initialiseRecovery` | `/account/recovery/initialise` |
| `beginRecovery` | `/account/recovery/begin` |
| `finishRecovery` | `/account/recovery/finish` |
| `rotateRecovery` | `/account/recovery/rotate` |

Identifiers remain in exact JSON bodies, never paths or queries.

## Services and validation

`createEnvelopeService({ transport })` exposes exactly `listEnvelopes`, `downloadEnvelope`, `addEnvelope` and `revokeEnvelope`. `createRecoveryService({ transport, now? })` exposes exactly `initialiseRecovery`, `beginRecovery`, `finishRecovery` and `rotateRecovery`. Both validate before transport, validate and deeply freeze results, retain no state, create no identifiers and never retry.

Sixteen public request/response validators enforce exact allowlists, opaque identifier limits, canonical base64url, safe advanceable versions, envelope-kind target/KDF relationships, deterministic metadata ordering, ISO timestamps, request/response correlation and HTTP/body agreement. Envelope reads never accept locators, verifiers or proofs. Recovery begin never accepts the stored verifier value; recovery finish never accepts a content-unlocked claim, session token, root or package.

P038 calls P028/P029's production `validateOpaqueMasterKeyEnvelopeRecord` for every encrypted master-key envelope. It does not copy or weaken the five-field AES-GCM record validation. It calls P031's production registration validators for recovery begin options, finish credentials and finish account/credential identity. Client-only PRF result bytes are rejected or removed by that existing boundary and never sent.

## Transport and ambiguity

All eight routes use P032's POST-only same-origin credentials/mode, JSON content type, no-store cache, redirect rejection and no-referrer policy. Requests and responses use the 262,144-byte small-JSON limit. List, download, begin and finish accept HTTP 200 only. Add, revoke, initialise and rotate accept 200 or 409, then require the exact committed or conflict body. Status/body disagreement fails closed.

Network ambiguity remains `remote-unavailable` with `retryable: true`, but P038 sends no retry. A deliberate later caller may make an explicit idempotent retry with unchanged operation identity and `attemptKind`; the client neither invents nor alters those values.

## Secret and ownership boundary

The module generates, derives, wraps and unwraps no keys. It creates no proof or recovery package. Raw master keys, recovery roots, wrapping keys, PRF output, complete recovery packages, readable Pocket content, filenames, paths and handles are outside every accepted shape. It uses no browser storage, cookie parsing, logging, timers, workers or background process.

Focused tests run the production client in a VM against the actual P036/P037 service core and deterministic P034 store through a test-only in-process transport. All eight operations, a stored committed replay and a durable conflict pass both production boundaries.

## P039 boundary

P039 should provide reviewed local orchestration: local key/recovery-root generation, P029 wrapping/unwrapping, recovery-package creation and confirmation, device-first persistence, explicit staged activation and owner-safe cancellation. It must still not deploy a service. The real HTTP/cookie adapter, WebAuthn/recovery-proof adapters, durable database, selected origin and deployment controls remain separate work.
