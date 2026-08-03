# Synced Pocket threat model

## 1. Scope and security goals

This model covers the future Synced Pocket account, encrypted device record, remote encrypted record, key envelopes, recovery package and additional-device transfer defined by P027/P028. It does not change the threat model of today's local JSON and Vault owners.

The primary goals are:

- the remote service cannot read Pocket content or obtain raw content-unlock secrets;
- one account/device/Pocket cannot adopt another's records or envelopes;
- remote concurrency cannot silently overwrite a newer revision;
- losing one passkey, device or envelope does not necessarily lose the Pocket;
- recovery does not give the service the raw recovery root;
- explicit owner/session boundaries remain intact during activation and Save; and
- failures preserve a locally durable encrypted record without hidden background writes.

Availability against every device loss, service outage or human loss of all recovery methods is not guaranteed. A human who loses every valid device, passkey/recovery authorisation and recovery copy may permanently lose access.

## 2. Assets

High-value secret assets:

- readable Pocket content;
- the 256-bit Pocket master key;
- device wrapping keys;
- client-only WebAuthn PRF output and derived wrapping keys;
- the raw recovery root and complete recovery package;
- ephemeral device-transfer private/transport keys; and
- live authenticated sessions and recovery proofs.

Integrity/availability assets:

- account-to-credential, account-to-device and account-to-Pocket bindings;
- synced Pocket ID and record format versions;
- encrypted content record, nonce and authenticated context;
- confirmed remote revision and exact pending encrypted record;
- envelope set, versions and revocations;
- recovery-authorisation version/rotation state; and
- local JSON/Vault owner/session plus existing safety recovery data.

Privacy-sensitive metadata includes record sizes, timing, device/credential counts, revision cadence, account activity and encrypted-record retention even when content is unreadable.

## 3. Trust boundaries

### Human and recovery copy

The human is trusted to approve intended passkey/device-transfer actions and keep the recovery copy somewhere appropriate. Pocket must make destructive/recovery effects understandable and cannot assume every storage choice is secure.

### Browser/device client

The client performs content encryption/decryption, key wrapping, PRF handling and source-owner checks. Ordinary browser/device protection and non-extractable keys reduce exposure. A fully compromised browser, origin script, extension, OS or device can observe readable content and may misuse unlocked keys; client JavaScript cannot prove otherwise.

### Authenticator

The WebAuthn authenticator protects passkey private material and produces assertions/optional PRF results subject to its platform guarantees. Pocket does not assume all passkeys provide PRF or hardware-backed protection.

### Remote service

The service is trusted to enforce account authorisation, conditional revisions, idempotency, expiry, rate limits, revocation and deletion policy. It is not trusted with readable Pocket content or raw content-unlock secrets. Client authenticated encryption detects content/envelope tampering but cannot force availability, honest retention or deletion.

### Existing local files and browser recovery

Local JSON/Vault files, file handles, source sessions and browser safety copies remain under their current owners. They are not imported into remote metadata or silently deleted after activation.

## 4. Adversaries and required controls

| Adversary/event | Risk | Required control | Residual limitation |
| --- | --- | --- | --- |
| Passive network observer | Learns content or credentials | Secure transport plus client-side authenticated encryption; no readable remote fields | Timing, size and traffic patterns remain observable to relevant infrastructure |
| Malicious/compromised service reader | Reads stored Pocket | Service receives opaque ciphertext/envelopes only; raw PRF/root/master keys stay local | Service sees allowed metadata and can deny availability |
| Service/database writer | Substitutes, replays or rolls back records | Authenticated context binds Pocket/version/purpose; monotonic conditional revisions; client checks expected revision | A malicious service can withhold the newest record; cross-device/witness designs are deferred |
| Concurrent legitimate device | Silently overwrites newer work | Expected revision and atomic conditional write; conflict returns `wrote: false` | Human conflict resolution/merge UI remains future work |
| Retried request after lost response | Creates multiple revisions | Same operation ID maps to the same result; different content under one ID fails | Service must durably enforce idempotency |
| Stolen encrypted remote/device store | Offline content disclosure | 256-bit random master key and independently wrapped envelopes | Weak platform/device protection may expose a device wrapping path |
| Lost or stolen unlocked device | Reads/modifies Pocket | Device lock, account/device revocation, short sessions, explicit envelope revocation | Content visible while unlocked may be captured; revocation cannot erase an offline copy already obtained |
| Compromised same-origin code/XSS | Exfiltrates content or keys | Strict CSP/dependency review, minimal raw-key lifetime, narrow modules, no remote readable fields | In-scope runtime compromise can defeat client E2EE while active; P028 does not claim otherwise |
| Malicious extension/OS | Reads memory or UI | Platform protections and non-extractable keys where available | Browser JavaScript cannot defend against a fully privileged attacker |
| Passkey phishing/replay | Account takeover | WebAuthn relying-party/origin binding, server challenge verification, expiry and user verification policy | Account auth alone still does not unlock content; session theft remains a separate risk |
| PRF capability confusion | Treats passkey sign-in as content unlock | Use only actual valid client extension output; client-only domain-separated derivation | Platform bugs remain possible; recovery must not depend solely on PRF |
| Invalid envelope injection | Silent fallback hides corruption/attack | Selected candidate with missing/invalid material fails closed and returns a structured reason | Human may need another explicit recovery attempt after diagnosing failure |
| Recovery-package theft | Account/content recovery by attacker | High-entropy root, local-only package, safe storage guidance, rate limiting, rotation after use | Recovery copy is intentionally powerful; possession plus successful protocol may recover access |
| Recovery proof replay | Reuses old recovery access | Challenge-bound proof, short-lived ceremony, versioned verifier, atomic rotation invalidating old authorisation | Failed partial rotations require careful rollback to prior valid state |
| Account enumeration | Reveals who uses Pocket | Opaque locator, non-distinguishing errors, rate limits | Traffic and external identity data may still correlate activity |
| Device pairing interception | Steals master key envelope | Ephemeral authenticated agreement, explicit trusted-device approval, transcript binding, expiry/single-use | Approval on a compromised trusted device is not trustworthy |
| Pairing prompt trick | Human approves attacker device | Display distinguishable device/pairing context and require explicit approval | Social engineering cannot be eliminated |
| Metadata injection | Sends filenames/notes outside ciphertext | Per-shape allowlists; reject unknown fields; plaintext sentinel tests | Ciphertext size/timing metadata remains |
| Nonce reuse | Breaks authenticated-encryption security | Fresh nonce per encryption and versioned record validation | Correct implementation/randomness must be reviewed and tested later |
| Activation interruption | Two active owners or partial conversion | Capture/recheck source session; durable device and conditional remote commit; mandatory recovery; adopt once at end | Staged encrypted records may need later garbage collection but are not truth |
| Service outage | Save appears lost | Device-first durable encrypted record, explicit pending state and explicit Save retry | Other devices cannot receive updates during outage |
| Account deletion misuse | Irreversible remote loss | Fresh authorisation, challenge, explicit confirm, idempotency and clear inventory | Service retention/deletion behaviour requires operational audit; local files remain separate |
| Old client/schema | Misreads or weakens record | Explicit security/API/record/envelope versions and fail-closed unknown versions | Migration and minimum-version policy are future implementation work |

## 5. Recovery-specific analysis

The recovery root has at least 256 bits of local randomness and is not a password. The package carries the root, version, opaque account locator, opaque Pocket ID, checksum and instructions. It contains no notes. A checksum detects transcription/file damage; it is not an authentication secret.

Two domain-separated derivations ensure that a recovery account-authorisation proof is not a master-key wrapping key and vice versa. The service stores only the account-authorisation verifier/version and encrypted recovery envelope. It must not request or log the root.

Successful use rotates both roles atomically enough that the old authorisation becomes invalid and a replacement local recovery copy is required. The UI must not claim recovery completed before rotation. Rate limiting, challenge expiry and non-enumerating errors reduce online abuse without converting the recovery root into a server-held secret.

## 6. Original readable file risk

Turning on sync does not encrypt, move or delete the original JSON source. That file remains readable wherever the human left it. This is intentional transparency and protects against destructive conversion, but it means synced encryption does not retroactively protect that historical copy. Pocket must keep showing the exact P027 original-file notice and must never upload its filename/path.

A source Vault remains protected under its existing Vault format, but P028 does not claim that Vault v1 and the synced encrypted-record format are interchangeable.

## 7. Abuse and privacy controls

Future service implementation must define conservative limits for ceremony creation, authentication failures, recovery attempts, pairing creation/approval, encrypted record sizes, envelope counts, device/credential counts and deletion attempts. Logs must exclude WebAuthn responses, PRF output, recovery proofs, ciphertext bodies and any submitted readable content.

Credential labels and device labels can become personal metadata. If later UI allows them, collection must be optional/minimal, display escaping mandatory and remote retention documented. P028's executable metadata allowlists use opaque IDs and do not admit labels.

## 8. Explicitly out of scope for P028

P028 does not provide:

- a formal cryptographic proof or algorithm/parameter selection;
- protection after arbitrary code execution in the active origin/browser/device;
- a backend, endpoint, provider, transport binding or deployment design;
- service availability, verifiable deletion or anti-rollback transparency infrastructure;
- conflict merge/review UI;
- production device-transfer or account/recovery UI;
- production synced-owner browser recovery; or
- any change to current local JSON/Vault recovery behaviour.

These are not silently assumed. Each requires a later reviewed implementation and focused tests before sync can be loaded in production.
