# Synced Pocket cryptographic format

## 1. Scope and status

P029 implements the provider-neutral cryptographic foundation for a future Synced Pocket in the unloaded `PocketSyncCrypto` browser/global module. The module is not referenced by `index.html` or `sw.js`. It performs no DOM work, storage, network access, account operation, WebAuthn ceremony, owner adoption or current Save-path change.

This format is separate from the existing local Pocket Vault. Vault v1 remains PBKDF2-SHA-256/AES-GCM and is neither migrated nor reused by this module.

## 2. Version 1 parameters

- content and master-key-envelope protection: AES-GCM with a 256-bit key;
- external algorithm name: `AES-GCM-256`;
- nonce: 12 random bytes for every encryption;
- authentication tag: 128 bits, appended to the Web Crypto ciphertext;
- Pocket master key: exactly 32 random bytes from `crypto.getRandomValues`, then imported non-extractable with only `encrypt` and `decrypt` usages;
- derived wrapping keys: HKDF with SHA-256 to a non-extractable AES-GCM-256 key;
- external KDF name: `HKDF-SHA-256`;
- HKDF salt: exactly 32 random bytes; and
- external byte encoding: canonical unpadded base64url.

The master key is independent random material. It is not derived from an account, passkey, PRF result, recovery root, transfer secret, Pocket ID, filename, password or passphrase. Account authentication answers who may request records; a valid local wrapping path answers who can decrypt them.

## 3. Opaque content record

The exact version 1 top level is:

```json
{
  "format": "pocket.sync.content.opaque",
  "version": 1,
  "algorithm": "AES-GCM-256",
  "nonce": "<canonical unpadded base64url>",
  "ciphertext": "<canonical unpadded base64url>"
}
```

No other field is accepted. The nonce decodes to exactly 12 bytes. Ciphertext includes the 16-byte tag and therefore decodes to at least 16 bytes. The encrypted plaintext is compact UTF-8 JSON.

Content AAD is the exact UTF-8 encoding of this compact JSON array:

```json
["pocket.sync.content.opaque",1,"AES-GCM-256",syncedPocketId,revision,"portal.export.v1+json"]
```

The synced Pocket ID, non-negative integer revision and fixed content type remain outside the record but are authenticated. A change to any bound value causes authenticated decryption to fail. Timestamps and object-property order have no authority.

## 4. Opaque master-key envelope

The exact version 1 top level is:

```json
{
  "format": "pocket.sync.master-key-envelope.opaque",
  "version": 1,
  "algorithm": "AES-GCM-256",
  "nonce": "<canonical unpadded base64url>",
  "ciphertext": "<canonical unpadded base64url>"
}
```

No other field is accepted. The plaintext is exactly the 32-byte master key, so ciphertext decodes to exactly 48 bytes: 32 protected bytes plus the 16-byte tag. Envelope metadata is separate.

Envelope AAD is the exact UTF-8 encoding of:

```json
["pocket.sync.master-key-envelope.opaque",1,"AES-GCM-256",syncedPocketId,envelopeId,envelopeKind,envelopeVersion]
```

Supported kinds are `device`, `passkey-prf`, `device-transfer` and `recovery`. Pocket ID, envelope ID, kind and positive integer version are authenticated; changing any one rejects opening.

## 5. Wrapping keys and HKDF

A `device` envelope uses a separately generated non-extractable AES-GCM-256 key and metadata `kdf: "none"`. It has no HKDF salt or derivation version.

The other envelope kinds use high-entropy input of at least 32 bytes, a canonical base64url salt that decodes to exactly 32 bytes, `kdf: "HKDF-SHA-256"` and `derivationVersion: 1`. Their exact labels are:

- `passkey-prf`: `pocket.sync.passkey-prf.master-key-wrapping.v1`
- `device-transfer`: `pocket.sync.device-transfer.master-key-wrapping.v1`
- `recovery`: `pocket.sync.recovery.master-key-wrapping.v1`

HKDF `info` is the exact UTF-8 encoding of:

```json
[derivationLabel,syncedPocketId,envelopeId,envelopeVersion]
```

The kind selects the label. The label, Pocket ID, envelope ID, envelope version and salt all change the effective key. PRF output, recovery roots and transfer secrets remain local. Only the salt is public metadata. Caller-owned input bytes are copied and not modified; internal copies are cleared on a best-effort basis.

## 6. Master-key lifecycle

`createMasterKeyBundle(envelopePlans)` requires at least one valid plan and unique envelope IDs. It generates 32 random master-key bytes, imports a non-extractable runtime key, wraps those same bytes under every requested wrapping key with fresh nonces, and clears the temporary raw buffer in `finally`. It returns only the runtime `CryptoKey` and opaque envelopes.

`openMasterKeyBundle(sourceEnvelope, sourceWrappingKey, sourceContext, additionalEnvelopePlans)` authenticates and decrypts exactly 32 bytes, imports a new non-extractable runtime key, optionally creates new envelopes while the temporary bytes exist, and clears them in `finally`. There is no public raw master-key export operation.

`sealContent` serialises compact JSON, uses fresh randomness and exact content AAD, then clears the plaintext byte buffer. `openContent` validates before decryption, authenticates before parsing, rejects invalid UTF-8/JSON without exposing partial content, and clears decrypted byte buffers.

JavaScript and Web Crypto cannot promise perfect memory erasure. Best-effort overwriting narrows accidental lifetime; it does not defeat a compromised runtime, browser, device, extension or same-origin script.

## 7. Base64url and validation

All external byte strings use the RFC 4648 URL-safe alphabet with no `=` padding. Validation decodes and re-encodes to reject padding, invalid alphabet, impossible length and non-canonical unused bits. Records and contexts use strict allowlists and exact algorithms/versions. Failures use stable, non-secret error codes and messages and never log plaintext, secrets or ciphertext.

Unknown versions fail closed. A future algorithm, format, AAD layout, label or derivation change requires a new explicit version plus migration and backward-compatibility review; v1 data must never be reinterpreted under changed parameters.

## 8. Nonce and encryption-use policy

Every content or envelope encryption obtains a new 12-byte nonce through `crypto.getRandomValues`. No production API accepts a nonce. The module policy ceiling is `2^31` encryptions per AES-GCM key, conservatively below `2^32`; later durable device state and master-key rotation must enforce cross-device operational limits because this unloaded stateless module cannot count globally.

Nonce uniqueness for a key is mandatory. Authentication failure is terminal for that attempt: Pocket does not return partial data or silently try altered context.

## 9. Test vectors and interoperability

Primitive known-answer tests use:

- [RFC 5869 HKDF-SHA-256 test case 1](https://www.rfc-editor.org/rfc/rfc5869.html), checking both PRK and 42-byte OKM; and
- the NIST AES-256-GCM empty-plaintext vector with a zero key/nonce and tag `530f8afbc74536b9a963b4f1c4cb738b`, consistent with [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final).

`tests/fixtures/p029-sync-crypto-vectors.json` contains static, synthetic Pocket regression vectors for exact content AAD/ciphertext, direct device wrapping, recovery HKDF info/derived-key behaviour and recovery envelope ciphertext. Fixed keys, salts and nonces are test-only and never production inputs.

Browser and Node implementations must use the standards-compatible [Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/). AES-GCM implementations must preserve 96-bit nonce uniqueness and unambiguous AAD encoding as described by [RFC 5116](https://www.rfc-editor.org/rfc/rfc5116.html). Cross-platform implementations must reproduce the committed fixture bytes exactly before integration.

## 10. Remaining work

P029 does not implement durable device-key storage, global encryption counting/rotation, WebAuthn PRF ceremonies, transfer protocol, recovery-package production, account/backend adapters, remote enforcement, UI, synced owner adoption or production loading. The next boundary is a versioned durable encrypted-device store and migration design that consumes these formats without exposing raw keys or changing current JSON/Vault ownership.
