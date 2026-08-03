# Synced Pocket security and recovery architecture

## 1. Status and boundary

P028 locks the provider-neutral security, device-storage and recovery design for the future Synced Pocket. P029 supplies its concrete, still-unloaded Web Crypto foundation. Neither task enables sync, loads a new production module, adds an account, contacts a service, selects infrastructure or changes current local JSON/Vault ownership and recovery.

The product contract assumes a Pocket-owned account/sync service: Pocket controls the human-facing account relationship and security policy. That does not select or expose any hosting, storage or identity provider.

The unloaded `PocketSyncSecurityContract` is a deterministic, DOM-free, storage-free and network-free contract. P027's exact human copy and orchestration remain unchanged. Future production implementation must satisfy both contracts.

Security contract version 1 and remote API contract version 1 are explicit. Product v1 permits one ordinary Synced Pocket per account, while all records carry an opaque synced Pocket ID so later schemas can represent more than one without using filenames as identity.

## 2. Trust split

Account authentication and content decryption are separate:

- a passkey authenticates an account and authorises account operations;
- a random Pocket master key encrypts Pocket content locally;
- independent key envelopes make that same master key available through approved unlock paths; and
- the service stores opaque encrypted records, public authentication material, wrapped key envelopes and operational metadata, never readable Pocket content or raw unlock secrets.

A successful passkey sign-in alone does not unlock content. No server-held password, passkey private key or service secret becomes the Pocket content key.

## 3. Pocket master key and content records

Each Synced Pocket receives a cryptographically random 256-bit master key generated locally. The master key is not derived from a filename, passphrase, account identifier, passkey credential identifier or recovery locator.

Every content record and master-key envelope uses AES-GCM-256 with a fresh random 12-byte nonce and a 128-bit tag. Nonce reuse with one key is forbidden. Content AAD binds the exact format, version, algorithm, synced Pocket ID, revision and `portal.export.v1+json` content type. Envelope AAD binds the exact format, version, algorithm, synced Pocket ID, envelope ID, kind and envelope version. See [Synced Pocket cryptographic format](SYNC_CRYPTO_FORMAT.md).

Master-key access uses multiple independent envelopes. Removing or replacing one device, PRF, transfer or recovery envelope does not require re-encrypting the whole content record; only the affected wrapping relationship changes. Content re-encryption remains available for an actual master-key rotation.

Raw master-key bytes exist for the minimum practical time. Temporary byte buffers are cleared on a best-effort basis and non-extractable Web Crypto keys are preferred after import/derivation. This reduces exposure; it is not a claim of perfect zeroisation in JavaScript or protection from a fully compromised browser/device.

## 4. Envelope kinds

Version 1 recognises exactly:

1. `device` — the master key wrapped to durable local device-key material;
2. `passkey-prf` — the master key wrapped to a key derived locally from an actual WebAuthn PRF result;
3. `device-transfer` — a one-time envelope delivered through an approved additional-device pairing; and
4. `recovery` — the master key wrapped to a key derived from the offline recovery root.

Each envelope has an opaque ID, kind, version, synced Pocket ID, creation metadata and optional revocation metadata. Envelope payloads are AES-GCM-256 authenticated ciphertext protecting exactly the 32-byte master key. A `device` envelope records `kdf: none`; derived envelopes record `kdf: HKDF-SHA-256`, a canonical 32-byte public salt and derivation version 1. Metadata never contains the raw wrapping key, derivation input or master key.

## 5. Passkey and optional PRF

Passkeys are the account authentication method. The WebAuthn PRF extension is an optional local key-unlock enhancement, not an assumption about all passkeys.

Pocket may use the `passkey-prf` path only when the actual registration/authentication ceremony reports usable PRF extension output. Platform capability guesses, a successful passkey assertion, an extension request, or a credential's existence are insufficient. Missing PRF support/output is an unavailable capability and allows the next approved unlock path. Present but malformed, too-short or cryptographically invalid PRF/envelope material fails closed and must not silently fall through.

PRF output remains on the client. Before key wrapping/unwrapping it is passed through HKDF-SHA-256 to a non-extractable AES-GCM-256 wrapping key. The exact versioned info binds the kind-specific label, synced Pocket ID, envelope ID and envelope version. It is never serialised into a WebAuthn response sent to the service, never used directly as the content key and never the sole recovery method.

This follows WebAuthn Level 3's optional-extension processing and its explicit distinction between PRF `enabled` and actual `results`: [Web Authentication Level 3 — PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension). The Web Crypto model supports non-extractable keys and authenticated encryption: [Web Cryptography Level 2](https://www.w3.org/TR/webcrypto/).

## 6. Unlock selection and failure semantics

The deterministic priority is:

1. valid durable `device` envelope;
2. valid actual `passkey-prf` ceremony output plus its envelope;
3. approved `device-transfer` envelope;
4. valid offline `recovery` package and envelope; then
5. unavailable.

An unlock path is selected only when its capability, required envelope and cryptographic material all validate. Once a higher-priority candidate supplies material that fails validation, Pocket returns a structured failure for that path. It does not hide corruption or attack by trying a lower path. Missing envelope material for an otherwise selected candidate is likewise a structured failure.

## 7. Trusted-device store

The intended future browser store is IndexedDB behind a replaceable platform adapter. P028 does not open or write that store.

The future durable device store may contain only:

- a non-extractable Web Crypto device key, or device key material wrapped to an origin/device protection boundary;
- a wrapped master-key envelope;
- opaque account, device and synced Pocket IDs;
- the latest encrypted content record;
- the last confirmed remote revision;
- the exact pending encrypted sync record and its operation identifiers;
- a conflict marker; and
- envelope, record, migration and schema versions.

It must not contain:

- a raw master key or raw recovery root;
- readable Pocket content;
- a Vault password or passkey private key;
- a remote bearer token with unlimited lifetime;
- a local JSON/Vault file handle or display filename;
- a truth-file/Vault source ownership token;
- a browser-safety recovery payload; or
- a silent writable handle to the former source file.

The device record is an encrypted replica of the synced owner, not another truth owner. Current browser safety recovery remains owned by existing local JSON/Vault paths until a later reviewed integration explicitly defines a synced-owner recovery record.

Web clients cannot honestly promise hardware-backed key storage or integrity on every browser. Non-extractability limits ordinary application export; it does not defeat same-origin code execution, browser compromise, device compromise, malicious extensions or memory inspection. End-to-end encryption still trusts the currently served Pocket client: a compromised Pocket release running while unlocked could read content or invoke available keys.

## 8. Remote-safe record boundary

The remote service may receive:

- opaque account, credential, device, envelope and synced Pocket IDs;
- public passkey registration/authentication material required by WebAuthn;
- opaque encrypted content records and authenticated envelope ciphertext;
- expected/current revisions, content sizes, schema versions and operation identifiers;
- recovery authorisation verifier/version material derived for that one purpose; and
- operational timestamps, revocation state and deletion state.

It must never receive readable node labels, Notes, Outline, attachments, historical filenames, local filesystem paths/handles, Vault handles, source-owner tokens, raw master keys, raw device wrapping keys, raw PRF output, raw recovery roots, complete recovery packages or browser-safety recovery payloads.

Strict allowlists apply per request/record. Unknown fields fail validation. An opaque content record has exact format `pocket.sync.content.opaque`, version 1, algorithm `AES-GCM-256`, a canonical 12-byte nonce and ciphertext containing at least the 16-byte tag; readable fields cannot be added beside it. A master-key envelope uses exact format `pocket.sync.master-key-envelope.opaque` and exactly 48 ciphertext bytes.

## 9. Mandatory recovery

Activation creates a random recovery root with at least 256 bits of entropy locally. The root is never uploaded. Two stable, distinct derivation labels prevent cross-use:

- recovery account authorisation: `pocket.sync.recovery.account-authorisation.v1`;
- master-key wrapping: `pocket.sync.recovery.master-key-wrapping.v1`.

The service may store a versioned verifier derived for account recovery and an encrypted recovery envelope. The verifier cannot be used to derive the master-key wrapping value, and neither record reveals the raw recovery root. The recovery package is generated locally and contains its format version, opaque account locator, opaque synced Pocket ID, root material, human-checkable checksum and instructions. It contains no Pocket notes and is never an uploadable remote request.

The locked recovery step is:

> **Save your recovery copy**
>
> This lets you get back into your Pocket if your devices or sign-in are unavailable. Keep it somewhere safe.
>
> **Save recovery copy**
>
> **I’ll do this later**

“I’ll do this later” pauses activation. It does not adopt the synced owner, replace the current JSON/Vault owner or show **Sync is ready**. There is no warning-only completion path.

The eventual package may be saved as a small Pocket recovery file and rendered locally as a printable QR code or grouped fallback code. The visual encoding and word list are deferred. The experience must use ordinary recovery language, not cryptocurrency-wallet aesthetics or vocabulary.

After successful emergency recovery, Pocket can register a new passkey, unwrap the master key locally, create a new recovery root/version, replace the recovery authorisation verifier and master-key envelope, invalidate the old recovery authorisation and require the human to save a new recovery copy. Partial rotation is not reported as complete.

## 10. Activation readiness

**Sync is ready** is permitted only after all of these have succeeded for the same captured source session:

1. dirty source content was saved through its existing owner;
2. the source owner/session is still current;
3. the 256-bit master key was created locally;
4. the trusted encrypted device record is durable;
5. the initial encrypted remote record was conditionally committed;
6. an account credential was registered;
7. a valid recovery envelope exists;
8. the recovery copy was saved by the human; and
9. adoption of the staged synced owner succeeded.

Missing recovery, cancellation, changed source ownership or any persistence/remote failure leaves the original owner active. No partially staged record silently becomes truth.

## 11. Additional-device transfer

The future human journey is:

1. open Pocket on the new device;
2. use passkey sign-in;
3. continue directly if valid actual PRF output plus its envelope unlocks the master key;
4. otherwise choose **Approve from another device** or **Use recovery copy**;
5. import the master key locally;
6. create the new device's own durable local key envelope;
7. fetch and decrypt the latest encrypted Pocket record; and
8. show the Pocket.

Where PRF and recovery are not selected, a future approved-device flow may transfer only the master-key envelope:

1. the new device creates an ephemeral authenticated key-agreement key;
2. an already trusted device displays/accepts a short-lived pairing request;
3. the human explicitly approves the named pairing on the trusted device;
4. both devices authenticate the ephemeral transcript and derive a transport key;
5. the trusted device sends the master key only inside an authenticated encrypted transfer envelope;
6. the new device establishes its own durable device envelope; and
7. the pairing expires and becomes single-use.

The service relays opaque pairing messages only. It never receives plaintext Pocket content or the master key. Pairing identifiers are random, rate-limited, scoped to the account and synced Pocket, short-lived and unusable after approval, rejection or expiry. P028 defines this architecture only; it does not implement pairing.

## 12. Recovery and existing local safety

P028 does not change the current browser safety-copy model, Vault recovery prompt, JSON/Vault file format, Vault crypto, Main Save, PE Save, P016/P017 gates or source-session checks. P027 remains unloaded. No synced secrets enter truth JSON, Vault files, node data, local-source recovery payloads or historical filenames.

Future synced recovery must be implemented as a separately versioned encrypted device record behind the existing one-owner discipline. It must not cause current local safety data to be uploaded or repurposed.

## 13. Remaining implementation review gates

The architecture and concrete cryptographic format are locked; production integration is still absent. Before loading sync code, later work must supply and review:

- a versioned durable browser/device store with migrations, failure handling, encryption-use accounting and master-key rotation consistent with the P029 format and vectors;
- real WebAuthn ceremonies and server-side verification;
- endpoint-independent request adapters implementing the remote API contract;
- additional-device and recovery UI with abuse/rate controls;
- conflict review and account deletion UI;
- synced-owner integration behind the existing ownership/Save seams; and
- security review for origin policy, content security, dependencies and operational controls.
