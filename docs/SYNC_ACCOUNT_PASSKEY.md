# Synced Pocket account and passkey client

## Status and boundary

P031 adds the dormant `PocketSyncAccountClient` foundation for future Synced Pocket account registration and authentication. It is not loaded by `index.html` or `sw.js`, exposes no UI, contacts no service at module load and does not enable sync. Current JSON/Vault ownership, Save, Vault recovery and browser safety recovery are unchanged.

The module accepts two injected boundaries: a four-method Pocket account service and a WebAuthn adapter. No provider, endpoint, transport, account database or server implementation is selected. The server remains responsible for challenge, origin, relying-party, signature, credential/account, expiry and policy verification.

This follows Pocket's product principles: safety through fail-closed identity and expiry checks; security through local-only PRF material and content-key separation; disappearing software through one deliberate browser gesture and no technical setup; and lightness through a narrow dependency-free module with no persistent machinery.

## Account service boundary

The injected account service has exactly four asynchronous methods:

- `beginRegistration(request)`;
- `finishRegistration(request)`;
- `beginAuthentication(request)`; and
- `finishAuthentication(request)`.

Every operation uses `apiVersion: 1`, an opaque operation ID, an opaque short-lived ceremony ID and an explicit expiry. Registration begins with the intent `create-or-add-credential` and an opaque device ID. Authentication may carry an opaque account locator. Unknown fields, mismatched operation/ceremony/credential identities, changed PRF input and unsupported versions fail closed.

The client performs no retry. Service exceptions become the stable display-safe reason `account-service-failed`; raw service messages are not exposed.

## Ceremony order

Registration validates the caller request, calls begin once, validates identity/options/expiry, calls WebAuthn create once, inspects PRF output, serialises a filtered public credential, rechecks expiry, calls finish once and validates the bound result. Authentication follows the same order with begin authentication, WebAuthn get and finish authentication. Cancellation, missing capability, malformed options/credential/PRF, expiry and identity mismatch stop before finish. Neither path retries.

## WebAuthn policy

Version 1 is passkey-only. Registration requires:

- credential type `public-key`;
- resident key `required`;
- user verification `required`;
- attestation `none`; and
- one PRF evaluation input under `extensions.prf.eval.first`.

Authentication also requires user verification and one PRF evaluation input. Conditional mediation is not requested. RP, user, challenge, credential descriptors, algorithms, timeouts and extensions use strict allowlists. Challenges decode to at least 32 bytes. Binary JSON is canonical unpadded base64url.

Where supported, the client prefers `PublicKeyCredential.parseCreationOptionsFromJSON()`, `parseRequestOptionsFromJSON()` and credential `toJSON()`. The strict fallback converts every WebAuthn binary member to an independent `ArrayBuffer` for browser calls and serialises the public, server-verifiable credential response back to canonical base64url.

## PRF handling

The account service owns one public random PRF evaluation input for each account/version and supplies that same value in each ceremony for the account. It must be canonical base64url decoding to exactly 32 bytes. The client does not generate, derive from user data, or persist that value.

Registration distinguishes:

- `unavailable` — the extension is absent or reports disabled;
- `enabled-no-output` — PRF is enabled but this registration produced no output; and
- `available` — an exact 32-byte first result is present.

Authentication distinguishes `unavailable` and `available`. A present malformed result fails as `prf-output-invalid` before the finish request.

The raw result is copied into a fresh local `Uint8Array`. It is returned only to the immediate caller for the later approved envelope-unlock path; the caller must clear it. This is best-effort lifetime reduction, not a perfect-zeroisation claim: browser engines, garbage collection and compromised same-origin code may retain or observe copies. It is never included in account-service requests, remote metadata, truth JSON, Vault data, device-store records, browser recovery or WebAuthn JSON sent to the server.

The client calls `getClientExtensionResults()` before credential serialisation. Registration retains only the public `prf.enabled` boolean. Authentication sends an empty client-extension result. Any `prf.results` material emitted by native `toJSON()` is removed from the service-bound credential.

## Authentication is not content unlock

Successful registration/authentication returns:

```json
{
  "ok": true,
  "accountAuthenticated": true,
  "contentUnlocked": false
}
```

Account authentication authorises account operations. Content remains locked until a separately validated P028 envelope path opens the random P029 Pocket master key. A passkey assertion, credential ID or PRF request is never itself the content key.

If usable PRF output is available, later reviewed orchestration may pass its local copy to P029 HKDF derivation for the exact credential-bound `passkey-prf` envelope. Missing output selects no PRF envelope. Invalid output fails closed. P031 does not implement that orchestration or store any envelope.

## Cancellation, expiry and failure

User cancellation maps to `passkey-registration-cancelled` or `passkey-authentication-cancelled`. Unsupported WebAuthn maps to `passkey-not-supported`; other browser failures map to `passkey-security-failed`. Errors contain stable codes rather than browser/service messages.

Expiry is checked before invoking WebAuthn and again after the user gesture, before finish. Expired or identity-mismatched ceremonies do not call finish. There is no automatic retry, polling, background task, conditional UI, fallback account method or secret-bearing log.

## Separation from P027-P030

- P027 still owns future activation and explicit Save ordering.
- P028 still owns account/content separation, unlock priority, recovery and metadata policy.
- P029 still owns AES-GCM/HKDF formats and non-extractable key operations.
- P030 still owns the dormant encrypted device record and local compare-and-swap.
- P031 owns only strict client-side account/WebAuthn ceremony conversion and PRF extraction.

P031 adds no live owner, account session persistence, token store, device-store write, remote content operation, recovery flow, key derivation, encryption, UI, production loader or service-worker change.

## Future integration checklist

Before production loading, later work must provide and review:

1. deployment composition and physical browser/authenticator acceptance testing for P034-P048's complete WebAuthn ceremony, expiry, replay and account/credential/device enforcement;
2. an account-session design with CSRF, XSS, logging, revocation, rate-limit and enumeration controls;
3. explicit UI/copy and accessible cancellation/error behavior;
4. credential-bound creation/use/revocation of `passkey-prf` envelopes without exposing PRF output;
5. activation atomicity with P027-P030 and mandatory recovery;
6. whole-account encryption-use accounting and rotation; and
7. focused physical browser testing across supported authenticators and PRF unavailable/enabled/result states.

No approved P027 human copy changes in P031.
