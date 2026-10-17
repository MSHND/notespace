# Disposable Pocket CRDT engine gate

**Research only.** This is an isolated GitHub proof branch, not a Pocket implementation, code change, schema change or deployment.

Engine packages: exact top-level versions Yjs 13.6.33 and @automerge/automerge 3.5.0.

17 library-level checks (Y01-Y08, A01-A09). Passing them does **not** establish Pocket semantic conflict handling, production E2EE, editor IME behaviour, large-document performance, permission safety or suitability of either library.

Run is restricted to candidate/crdt-library-proof-20261017; GitHub Actions job has read-only permissions and contains no deployment steps. Artifact preserves install output, versions, TAP test results and package-lock.

Acceptance must examine each test and compare against Pocket-owned semantic editing, not merely count passing cases.
