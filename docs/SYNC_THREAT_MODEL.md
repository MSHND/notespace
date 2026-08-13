# Synced Pocket threat model

## 1. Scope and security goals

This model covers the future Synced Pocket account, encrypted device/remote records, key envelopes, recovery package and additional-device transfer defined by P027/P028, P029's concrete cryptographic format, P030's concrete unloaded encrypted device store, P031's unloaded account/passkey client, P032/P038's unloaded same-origin remote client, P034-P037's dormant service state machines and P039's dormant activation orchestrator. It does not change the threat model of today's local JSON and Vault owners.

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
- local `storeRevision`, encryption-use counters and complete-record atomicity;
- envelope set, versions and revocations;
- recovery-authorisation version/rotation state; and
- local JSON/Vault owner/session plus existing safety recovery data.

Privacy-sensitive metadata includes record sizes, timing, device/credential counts, revision cadence, account activity and encrypted-record retention even when content is unreadable.

## 3. Trust boundaries

### Human and recovery copy

The human is trusted to approve intended passkey/device-transfer actions and keep the recovery copy somewhere appropriate. Pocket must make destructive/recovery effects understandable and cannot assume every storage choice is secure.

### Browser/device client

The client performs content encryption/decryption, key wrapping, PRF handling, source-owner checks and whole-record IndexedDB persistence. Ordinary browser/device protection and non-extractable keys reduce exposure. A fully compromised browser, origin script, extension, OS or device can observe readable content, modify its database and may misuse unlocked keys; client JavaScript cannot prove otherwise.

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
| Malicious remote response | Substitutes identifiers/revisions, returns conflict as success or injects readable/unknown fields | P032 exact response allowlists repeat operation/Pocket/revision identity and require HTTP 200 committed versus HTTP 409 conflict consistency | The client cannot prove a malicious service returned the globally newest record |
| Cross-origin redirect or URL leakage | Sends credentials/opaque IDs to another origin or places them in logs/history | Same-origin path-only root, POST body identifiers, `redirect: error`, `referrerPolicy: no-referrer` and same-origin fetch mode | Compromised same-origin code can issue its own requests outside this module |
| Persisted bearer token theft | Reuses long-lived client-managed credentials | P032 has no bearer token/header/storage and relies on a future browser-managed same-origin cookie | Secure/HttpOnly/SameSite scope, expiry and rotation must be correctly implemented by the future server |
| CSRF or session fixation | Uses or plants an authenticated browser session | P034 rejects any context not exact POST, trusted Origin, same-origin Fetch Metadata and JSON; completion atomically rotates the session | P036 must map real headers/cookies correctly and add deployment abuse controls; compromised same-origin code remains in origin |
| Oversized or confusing HTTP body | Exhausts memory or treats HTML/error text as trusted JSON | Declared and streamed UTF-8 bounds, stream cancellation, exact JSON content type, object-only parse and status allowlists | Repeated large responses can still consume bandwidth before the bound is reached |
| Concurrent legitimate device | Silently overwrites newer work | Expected revision and atomic conditional write; conflict returns `wrote: false` | Human conflict resolution/merge UI remains future work |
| Retried request after lost response | Creates multiple revisions | P034 stores one immutable committed/conflict outcome under the account/Pocket/operation key and exact logical digest | P032 cannot distinguish a lost response without a later explicit retry |
| Operation-ID replay or changed-payload reuse | Replays a write or associates one result with different ciphertext/revision | P034's canonical digest covers every logical identity and encrypted-record field except attempt kind; changed reuse and `new-change` replay fail | A production database must preserve the same atomic uniqueness guarantees |
| Network ambiguity after dispatch | Client assumes failure or success after the server may have committed | One request only; unavailable result stays ambiguous and later explicit reconciliation uses the stable operation identity | Human-visible pending/reconciliation behavior remains future Save integration |
| Stolen encrypted remote/device store | Offline content disclosure | 256-bit random master key and independently wrapped envelopes | Weak platform/device protection may expose a device wrapping path |
| Lost or stolen unlocked device | Reads/modifies Pocket | Device lock, account/device revocation, short sessions, explicit envelope revocation | Content visible while unlocked may be captured; revocation cannot erase an offline copy already obtained |
| Compromised same-origin code/XSS | Exfiltrates content or keys | Strict CSP/dependency review, minimal raw-key lifetime, narrow modules, no remote readable fields | In-scope runtime compromise can defeat client E2EE while active; P028 does not claim otherwise |
| Malicious extension/OS | Reads memory or UI | Platform protections and non-extractable keys where available | Browser JavaScript cannot defend against a fully privileged attacker |
| Passkey phishing/replay or ceremony substitution | Account takeover or wrong credential binding | P034 binds type, operation, challenge, account, prior session and exact finish digest; P035 requires the configured RP ID to equal the trusted-origin hostname; P036's real verifier must enforce WebAuthn cryptography/origin/RP/user verification | P034 deliberately injects rather than implements the standards verifier; broader RP scope would need public-suffix-aware review |
| PRF result leakage | Converts optional local unlock material into a remote/logging secret | Inspect before serialisation, require exactly 32 bytes, copy locally, strip all PRF results from finish requests and require caller clearing | Same-origin compromise or careless future callers can still copy live result bytes |
| Account authentication confused with content unlock | Bypasses envelope policy | P028/P031 explicitly return authentication success with content still locked; only a validated credential-bound envelope may open the master key | Future orchestration remains security-critical and is not implemented |
| PRF capability confusion | Treats passkey sign-in as content unlock | Use only actual valid client extension output; client-only domain-separated derivation | Platform bugs remain possible; recovery must not depend solely on PRF |
| Invalid envelope injection | Silent fallback hides corruption/attack | Selected candidate with missing/invalid material fails closed and returns a structured reason | Human may need another explicit recovery attempt after diagnosing failure |
| Recovery-package theft | Account/content recovery by attacker | High-entropy root, local-only package, safe storage guidance, rate limiting, rotation after use | Recovery copy is intentionally powerful; possession plus successful protocol may recover access |
| Recovery proof replay | Reuses old recovery access | Challenge-bound proof, short-lived ceremony, versioned verifier, atomic rotation invalidating old authorisation | Failed partial rotations require careful rollback to prior valid state |
| Account enumeration | Reveals who uses Pocket | Opaque locator, non-distinguishing errors, rate limits | Traffic and external identity data may still correlate activity |
| Device pairing interception | Steals master key envelope | Ephemeral authenticated agreement, explicit trusted-device approval, transcript binding, expiry/single-use | Approval on a compromised trusted device is not trustworthy |
| Pairing prompt trick | Human approves attacker device | Display distinguishable device/pairing context and require explicit approval | Social engineering cannot be eliminated |
| Metadata injection | Sends filenames/notes outside ciphertext | Per-shape allowlists; reject unknown fields; plaintext sentinel tests | Ciphertext size/timing metadata remains |
| AES-GCM nonce reuse | Breaks confidentiality/authentication under one key | P029 obtains a fresh random 12-byte nonce for every content/envelope encryption and exposes no caller nonce input | Durable cross-device counting and master-key rotation remain future work |
| Ciphertext, nonce or tag tampering | Causes corrupted or attacker-controlled plaintext | AES-GCM uses a 128-bit tag; authentication failure returns no content or raw master key | Service can still delete, replay or withhold opaque records; revision policy handles replay separately |
| Context transplant | Moves ciphertext to another Pocket, revision or envelope purpose | Compact JSON AAD binds format/version/algorithm plus Pocket ID and content revision/type or envelope ID/kind/version | Client must supply the intended current context correctly |
| Cross-purpose derived-key reuse | Lets one unlock secret act in another role | HKDF-SHA-256 uses distinct versioned kind labels and binds Pocket ID, envelope ID/version and a 32-byte salt | A compromised runtime can still invoke keys available in that runtime |
| Malformed opaque record | Exploits permissive decoding or version confusion | Strict field allowlists, exact version/algorithm/length checks and canonical unpadded base64url fail closed | New formats require explicit version and migration review |
| Malformed or maliciously modified local database record | Injects plaintext, wrong identities/keys or weakened formats | P030 validates the complete strict record, restored `CryptoKey` and P028/P029 content/envelope boundaries before returning it; no silent repair/deletion | Same-origin or device compromise can replace both data and executing validation code |
| Local database rollback | Restores an older confirmed revision or lower usage count | Whole-record replacement rejects remote revision and same-generation usage rollback | A privileged attacker can restore an entire older database snapshot; remote comparison is still required when integrated |
| Stale concurrent tab | Silently overwrites a newer local Save | Transactional `storeRevision` compare-and-swap lets only one same-revision writer win | Later UI must explain the stable local conflict result |
| IndexedDB transaction interruption | Leaves pending/content/revision fields from different moments | One whole-record readwrite transaction; success only on `complete`; abort retains prior state | Browser storage corruption outside IndexedDB's transaction guarantees remains platform risk |
| CryptoKey clone or restoration failure | Encourages raw/extractable key fallback or creates unreadable state | Stable fail-closed unsupported result; no export, serialisation, plaintext or extractable substitute | Browser/device implementations differ, so activation must verify support before owner adoption |
| Browser storage eviction or site-data clearing | Removes the encrypted device record and device key | State is not called impossible to lose; remote ciphertext and human recovery copy remain essential | Offline reopening on that device may require recovery or another trusted-device path |
| Excessive AES-GCM key use | Raises random-nonce collision and usage risk | P029 declares a `2^31` ceiling; P030 schema 4 durably reserves monotonic counters per long-lived master and device wrapping key before AES-GCM use, accepting safe over-count after interruption | Per-device counts cannot prove a global cross-device total; remote/account enforcement and rotation remain required |
| Activation interruption | Two active owners or partial conversion | Capture/recheck source session; durable device and conditional remote commit; mandatory recovery; adopt once at end | Staged encrypted records may need later garbage collection but are not truth |
| Service outage | Save appears lost | Device-first durable encrypted record, explicit pending state and explicit Save retry | Other devices cannot receive updates during outage |
| Rate limiting or unavailable service | Prevents account/content operations | Stable retryable unavailable/rate-limited client errors, no hidden retry storm, device-first pending design | The service can deny availability indefinitely; P032 provides no offline delivery |
| Missing server validation | Client validation is mistaken for authentication, authorization or atomic persistence | Server must independently verify WebAuthn, session/account/Pocket ownership, schema, sizes, revision CAS, idempotency and abuse limits | P032 is a defense-in-depth client boundary, never a replacement for a trusted implementation and audit |
| Account deletion misuse | Irreversible remote loss | Fresh authorisation, challenge, explicit confirm, idempotency and clear inventory | Service retention/deletion behaviour requires operational audit; local files remain separate |
| Old client/schema | Misreads or weakens record | Explicit security/API/record/envelope versions and fail-closed unknown versions | Migration and minimum-version policy are future implementation work |

## 5. Recovery-specific analysis

The recovery root has at least 256 bits of local randomness and is not a password. The version-2 package carries that root, a portable Ed25519 PKCS8 recovery-signing private key, opaque account locator and Pocket ID, checksum and instructions. It contains no notes. A checksum detects transcription/file damage; it is not an authentication secret.

Your recovery copy contains the secret needed to authorise recovery. Pocket's server stores only an Ed25519 SPKI public verification key. The server can verify a recovery signature, but cannot create one. The recovery root decrypts the recovery envelope; the separate signing private key authorises the recovery ceremony. Neither is uploaded, logged or retained in ordinary readable browser state.

The server verifies one canonical, domain-separated transcript binding the ceremony, operation, challenge, Pocket, device, recovery and key-set versions, expiry and digest of the exact new WebAuthn credential. It stores no symmetric recovery secret, recovery root or signing private key. Each successful recovery rotation atomically installs a fresh public verifier with the new envelope and recovery version, and the replacement copy contains the matching new private key. Database compromise alone therefore does not provide recovery-signing authority, although a compromised service can still deny service and hostile delivered client code remains a separate threat.

## 6. Concrete crypto failure and memory boundary

P029 retains raw master-key bytes only while importing and creating envelopes, and decrypted raw bytes only while importing/rewrapping. Plaintext JSON and derivation inputs likewise use temporary copies. Buffers are overwritten in `finally` where practical, but JavaScript garbage collection, engine copies, browser compromise and same-origin code mean perfect erasure is not claimed. Non-extractable `CryptoKey` prevents ordinary export, not authorised use by compromised code.

Authentication-tag failure, malformed UTF-8/JSON and context mismatch are terminal for that operation. No partial plaintext is returned, no lower-trust context is guessed and errors contain stable non-secret reasons. Exact bytes and migration rules are in [Synced Pocket cryptographic format](SYNC_CRYPTO_FORMAT.md).

Successful use rotates both roles atomically enough that the old authorisation becomes invalid and a replacement local recovery copy is required. The UI must not claim recovery completed before rotation. Rate limiting, challenge expiry and non-enumerating errors reduce online abuse without converting the recovery root into a server-held secret.

## 7. Encrypted device-store failure boundary

P030 stores exactly one current encrypted record per opaque Pocket ID. Unknown fields and schema versions fail closed, and failed reads do not silently delete or repair evidence. Initial `add` and later whole-record replacements resolve only after IndexedDB transaction completion. The database has no history, operation log, telemetry, secondary index or duplicate pending ciphertext.

IndexedDB durability is a browser acceptance boundary, not a guarantee against eviction, site-data clearing, compromised local software or device loss. P030 does not request `navigator.storage.persist()`. Non-extractable `CryptoKey` prevents ordinary export but is not necessarily hardware-backed and remains usable by authorised or compromised same-origin code.

## 8. Original readable file risk

Turning on sync does not encrypt, move or delete the original JSON source. That file remains readable wherever the human left it. This is intentional transparency and protects against destructive conversion, but it means synced encryption does not retroactively protect that historical copy. Pocket must keep showing the exact P027 original-file notice and must never upload its filename/path.

A source Vault remains protected under its existing Vault format, but P028 does not claim that Vault v1 and the synced encrypted-record format are interchangeable.

### P039 activation failure boundary

| Failure or attacker action | P039 enforcement | Remaining boundary |
| --- | --- | --- |
| Source owner swapped during activation | Owner kind and opaque continuity value are captured; the injected current-session check runs after asynchronous boundaries and before adoption | A future live adapter must supply a continuity value that changes on every owner/session rotation |
| Dirty source not saved | Existing JSON/Vault Save runs before the one payload freeze; cancellation/failure stops before keys, device staging or remote work | The existing Save boundary remains responsible for physical file durability |
| Payload changes during activation | One frozen payload feeds P029 once; a later source-session change stops adoption | Same-session in-memory edits must make the live source check fail or be prevented by future UI |
| Duplicate passkey after ambiguous finish | P031 hands P039 a server-safe credential continuation before finish; resume submits that exact finish without another WebAuthn create | Ambiguity before durable credential continuation cannot be guessed and remains a non-complete activation |
| Duplicate Pocket/envelope/recovery creation | Stable operation/logical-change IDs are encrypted before use; pending dispatch is durable; explicit resume uses exact idempotent retry | Permanent abandonment can leave authorised opaque remote orphan state |
| Recovery-copy write fails or is deferred | No owner adoption; exact root/package/locator/envelopes survive only inside the encrypted draft for explicit resume | A compromised recovery-copy writer can copy, corrupt or disclose the deliberately powerful package |
| Recovery root lost after remote initialisation | Root and package remain encrypted locally until copy confirmation; cleanup occurs only afterward | Site-data loss before package storage can make the staged remote recovery envelope unusable |
| Raw root/package leaks through device storage | P029 encrypts the complete draft with the non-extractable device key; raw-store sentinel tests reject plaintext exposure | Same-origin code or a compromised device able to invoke the key can open the draft |
| Operation IDs regenerated | All identifiers are generated once, persisted before first use and reused from the draft | Random collision fails without a retry loop; no global anti-rollback transparency exists |
| Adoption before recovery confirmation | Pre-adoption P028 readiness requires local device durability, revision 1, credential, recovery envelope and confirmed copy | The future injected owner adapter must be idempotent and preserve its own session invariants |
| Adoption after source-session change | Immediate source recheck stops the owner call | A malicious live adapter that lies about current source defeats this injected boundary |
| Deliberate source retirement mistaken for session theft | P040 performs the last source check immediately before the owner call and performs no retired-source check after explicit success | The future owner adapter must make its transition atomic and reject stale authority itself |
| Owner adopted but final draft still ready | A dedicated post-adoption P030 compare-and-swap finaliser records `adopted`; failure reports `owner-adoption-finalisation-failed` with the synced owner honestly active | P040 adds no repair UI or automatic retry for this narrow split state |
| False claim that the source owner survived | Post-transition failure explicitly returns `adopted: true` and `sourceOwnerPreserved: false`; it never maps storage failure to source-session change | A caller must treat this result as a transitioned owner requiring later operational repair |
| Duplicate owner adoption on replay | A valid adopted draft returns success before source capture or the owner adapter; a ready draft may retry only the injected idempotent adapter | Adapter idempotency remains required if it succeeded but the final local marker failed |
| Adopted replay requires retired source | Resume loads and validates the encrypted draft first; adopted state returns without JSON/Vault capture or validation | Corrupt adopted state fails closed and still requires explicit repair outside P040 |
| Stale activation writer | P030 whole-record `storeRevision` compare-and-swap rejects the stale replacement | Future UI must explain a stable local conflict instead of silently resetting |
| Malformed or impossible draft | Exact decrypted fields, stages, identities, versions, envelope records and secret-presence rules fail closed; no repair/reset | Database rollback can restore an older internally valid encrypted draft |
| Partially completed activation | Confirmed stages are persisted before the next mutation; resume starts at the first unconfirmed step | No background cleanup or remote rollback guess exists |

## 9. Service-core failure boundary

P034-P036 convert previously specified server duties into one executable dormant state machine:

| Failure or attacker action | P034 enforcement | Remaining boundary |
| --- | --- | --- |
| Malformed persisted service state | Every read validates the exact record kind, version, identity and fields; malformed state fails and is never repaired or treated as absent | A real adapter must surface storage corruption safely and restore only through reviewed operational recovery |
| Stale transaction writer | Store-version compare-and-swap plus a single atomic transaction rejects stale replacements | The production database adapter must supply equivalent isolation and uniqueness |
| Partial session rotation | Replacement-session insert, prior-session revocation and completed ceremony commit together | A later HTTP adapter must issue/clear the browser cookie only from the committed session instruction |
| Ceremony replay | Pending begin is digest-idempotent; finish is one-time and exact replay returns its stored result | Abuse/rate controls and cleanup remain deployment work |
| Changed finish under one operation | Finish digest binds ceremony type, session context, operation, ceremony, device where applicable and exact public credential response | Correct WebAuthn verification still depends on a reviewed injected adapter |
| Changed ciphertext under one operation ID | Canonical upload digest includes exact encrypted record, Pocket, revisions and logical identities; changed reuse fails | Digest availability does not make the ciphertext readable or prove remote availability |
| Account-to-Pocket substitution | Content routes require the active session account and its one bound Pocket; first binding commits with revision 1 | Multi-Pocket accounts require a later explicit schema/policy version |
| Credential-to-account substitution | Stored account credential list, credential owner and session credential relationship are revalidated | Compromise of the future verifier or database/runtime remains privileged compromise |
| Session expiry or revocation | Content calls fail with a non-secret clear-session instruction and do not slide expiry | Cleanup of expired records is intentionally absent |
| Verifier-adapter compromise | Strict result allowlists, credential identity and counter/backup continuity limit accepted mutations | A verifier that falsely proves a signature can still authenticate an attacker; adapter selection/review remains critical |
| Operation digest ambiguity | SHA-256 inputs use explicitly ordered fields and unambiguous operation keys | Changing canonicalisation requires a compatibility/security review |
| Conflict replay after later writes | Stored conflict result is immutable and replayed exactly rather than recalculated | The human-facing later reconciliation path remains unimplemented |
| Transaction or commit failure | Success resolves only after commit; injected failures preserve the previous complete snapshot | Service database backup, rollback detection and disaster recovery remain future operational design |

The core starts no background cleanup, timer, queue, polling or retry. Expired/revoked records remain validated state until a later explicitly designed maintenance boundary. It logs no identifiers, credentials, errors or ciphertext.

### P036 key and recovery enforcement

| Failure or attacker action | P036 enforcement | Remaining boundary |
| --- | --- | --- |
| Envelope or credential substitution | Exact envelope kind/KDF/size plus account/Pocket/credential relationships are revalidated | A compromised client with legitimate wrapping material can still create a malicious but well-formed envelope |
| Stale key-set writer | Expected key-set version and immutable operation outcome make conflict a durable non-write | A production database must preserve transaction isolation and uniqueness |
| Revoked ciphertext retention | Revocation atomically replaces the active record with a ciphertext-free tombstone | Ciphertext already copied before revocation cannot be recalled |
| Recovery-locator replay | Active locator, account/Pocket/recovery version and ready key set must all agree | Online guessing/rate controls remain adapter/deployment work |
| Old locator after rotation | Old locator is revoked in the same transaction that installs the new locator | A copied old package remains locally present but cannot start service recovery |
| Verifier/envelope version mismatch | Initialisation fixes both at version 1; rotation requires both at exactly current plus one | Client-side derivation/opening still requires P037 orchestration |
| Proof replay or changed proof | Ceremony challenge/version/expiry and exact finish digest bind one proof/credential request | Security of the proof itself depends on the later reviewed verifier algorithm |
| Concurrent recovery finish | One ceremony commit creates one credential/session and marks one version rotation-required; exact concurrent replay returns that result | Transaction adapter correctness remains essential |
| Multiple credentials from one recovery version | `rotation-required` blocks another begin; only exact finish replay is allowed before rotation | A malicious authorised recovered credential can refuse to rotate, causing denial of recovery completion |
| Cross-credential rotation replay | The completed recovery ceremony durably binds the recovery operation to its created credential; that credential is required before an initial rotation or stored replay can return a replacement locator | Compromise of the recovered credential still grants its intended rotation authority |
| Malformed or cross-route envelope response | P038 exact allowlists, kind/KDF rules, 48-byte P029 envelope validation and operation/Pocket/envelope correlation reject substituted responses | A compromised same-origin runtime can still observe valid opaque values available to that runtime |
| HTTP/body disagreement on key mutation | P038 accepts 200 only for exact committed bodies and 409 only for exact conflicts; malformed status/body pairs fail closed | Network failure after dispatch remains ambiguous until an explicit idempotent retry |
| Recovery verifier disclosure | Recovery begin accepts only public verifier derivation metadata and rejects the stored verifier value or an envelope | The later proof adapter must still protect its internal verification material and abuse boundary |
| Recovery package or PRF leakage | Exact requests reject package/root fields; P031 registration serialisation removes client-only PRF result bytes before finish recovery transport; P041 keeps package/root encrypted locally and clears transient PRF output | A compromised same-origin runtime can still inspect secrets while deliberately used |
| Partial verifier/envelope/locator rotation | New records, old revocations, key-set update and immutable result commit together | Operational database rollback could resurrect old state unless deployment rollback policy is designed |
| Compromised recovery-proof adapter | Exact input/output isolation prevents direct store mutation or secret return | A verifier that falsely approves a proof can authorise account recovery and new passkey creation |
| Database disclosure of derived verifier | Stored verifier is purpose-specific and distinct from recovery wrapping material | Proof-algorithm strength and offline-guessing resistance remain P038 review work |
| Authorised malicious envelope replacement | Ownership, version and idempotency remain enforced | An authorised client can deny future unlock by installing unusable encrypted material; the service cannot inspect it |
| Malformed persisted key/recovery state | Every accessed record and cross-record relationship fails closed without repair/reset | A real adapter needs safe corruption reporting and reviewed restore procedures |

### P041 emergency-recovery orchestration

| Failure or attacker action | P041 enforcement | Remaining boundary |
| --- | --- | --- |
| Malicious or swapped recovery package | Exact P028 package validation plus P029 Pocket/envelope AAD and AES-GCM authentication fail closed | A stolen valid package remains intentional recovery authority until rotation |
| Recovery target changes mid-process | Only `none`/`detached` targets are accepted; opaque continuity is rechecked after asynchronous boundaries | A live adapter must supply a continuity marker that changes reliably |
| Root, proof or package visible in raw device storage | One P029-encrypted whole recovery draft is the only staging representation; raw-store tests exclude those fields and sentinels | Same-origin compromise able to use the device key can open encrypted drafts |
| Duplicate credential after ambiguous finish | Exact proof/credential continuation is persisted before dispatch; explicit resume replays finish without WebAuthn | Abandonment before continuation durability cannot be guessed or auto-repaired |
| Stale or expired ceremony | P038 validates expiry and P041 stops without creating another ceremony automatically | The human must explicitly start a later reviewed recovery attempt |
| Returned recovery-envelope substitution | Pocket, kind, envelope ID/version and KDF context are authenticated locally by P029 | Compromise of valid old root remains within its intended authority |
| Content revision changes during recovery | Revision is read immediately before exact-revision download; mismatch stops before envelope addition/rotation | A later explicit resume may observe a new stable revision |
| Malformed decrypted Pocket | Readable content must pass the injected Pocket-domain validator and is never persisted/returned | The eventual production validator must remain aligned with current Pocket schema rules |
| Device envelope added but rotation incomplete | Stable encrypted IDs/envelope and key-set version permit explicit continuation; readiness remains false | The device envelope may remain remotely active if recovery is abandoned |
| Rotation commits but replacement copy is not stored | New root/package/locator remain only in the encrypted draft; resume repeats no remote operation and writes the exact package | Loss of local staged state before copy storage can make recovery authority unavailable |
| Old copy used after rotation | Service atomically revokes the old locator and erases old active envelope ciphertext | Previously exfiltrated ciphertext cannot be recalled, though its locator no longer starts recovery |
| Replacement package accidentally uploaded | Exact remote validators reject root/package fields and P041 sends the package only to the injected local writer | A malicious local writer can still disclose the human-authorised package |
| Duplicate rotation | Pending state precedes dispatch; exact explicit retry uses durable operation identity and P037 recovered-credential authorisation | Network ambiguity remains visible until explicit resume |
| Stale recovery-draft writer | P030 whole-record compare-and-swap rejects stale staging and promotion | Database rollback may restore an older internally valid encrypted stage |
| Ready state adopted prematurely | P041 has no owner adapter and returns `adopted: false`; the final record remains `ready-for-adoption` | P042 must enforce one explicit owner/session transition |

## 10. Abuse and privacy controls

Future service implementation must define conservative limits for ceremony creation, authentication failures, recovery attempts, pairing creation/approval, encrypted record sizes, envelope counts, device/credential counts and deletion attempts. Logs must exclude WebAuthn responses, PRF output, recovery proofs, ciphertext bodies and any submitted readable content.

Credential labels and device labels can become personal metadata. If later UI allows them, collection must be optional/minimal, display escaping mandatory and remote retention documented. P028's executable metadata allowlists use opaque IDs and do not admit labels.

## 11. Explicitly out of scope for P027-P041

P027-P041 do not provide:

- a formal cryptographic proof, global cross-device encryption-use counter or automatic master-key rotation;
- protection after arbitrary code execution in the active origin/browser/device;
- a backend, endpoint, provider, transport binding or deployment design;
- service availability, verifiable deletion or anti-rollback transparency infrastructure;
- conflict merge/review UI;
- production device-transfer or account/recovery UI;
- production synced-owner browser recovery; or
- any change to current local JSON/Vault recovery behaviour.

These are not silently assumed. Each requires a later reviewed implementation and focused tests before sync can be loaded in production.
