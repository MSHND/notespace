# Opening a Synced Pocket on another device

On another device, Pocket asks the existing discoverable passkey for a local
PRF result. The service never receives that result. Pocket uses it only to
unlock the existing encrypted master-key envelope, then creates a fresh
device-specific envelope.

Ordinary account authentication is not content unlock. If the passkey cannot
produce the required PRF result, or the matching active PRF envelope cannot be
opened, the routine flow returns `recovery-required`. It does not weaken
encryption, select another credential envelope, or begin recovery automatically.

The account session can read its single v1 Pocket identifier through the
same-origin authenticated `POST /account/synced-pocket/read` seam. The request
contains only API version and an opaque operation identifier; session identity,
not a client-supplied account identifier, chooses the account.

Each committed device envelope receives a conservative offline allowance of
`2**20` master-key content encryptions. The service atomically reserves that
allowance from the one `2**31` whole-master-key ceiling and never refunds or
reuses it. Ordinary Save consumes only its durable local device allowance, so
it does not need a network reservation before encryption. On exhaustion Pocket
fails closed with `master-key-rotation-required`; full master-key rotation is a
later boundary.

The local schema-5 record stores the allowance with its generation. A v4 record
migrates conservatively with its limit equal to its existing spent count, never
with a fresh allowance. The local-only `sync:local` integration exposes the
explicit `openExisting()` developer path; loading it does no work.

Before `addEnvelope` is sent, Pocket durably stages the exact device envelope,
operation identity and target continuity locally. A later explicit
`openExisting()` re-authenticates, reopens the same master key, and resumes that
same idempotent request. It never creates a second envelope for an interrupted
attempt or adopts the Pocket until the stored request has committed and the
target is still current.
