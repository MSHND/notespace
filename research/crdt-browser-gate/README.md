# Disposable Pocket real-browser engine experiment

**Proof-only branch. No Pocket production implementation or deployment.**

The harness is stored in source.tar.gz to transfer exact binary bytes through the GitHub connector. SHA-256: 22e4f5c2018ff427c1e27b4067d1b30464b0fb81032369462817edf76b2ec6b9. Extract it to inspect human-readable source (app.mjs, index.html, package.json, tests/browser-gate.test.mjs).

Uses actual Chromium via Playwright and the genuine pinned Yjs 13.6.33 and Automerge 3.5.0 libraries. One case per engine executes native browser keyboard events, undo, Unicode prefix/edit/cursor positions, Save-to-test-file/reopen of CRDT bytes and anchors, deletion of selected text before promotion, Chromium CDP-generated composition events, independent offline Chromium processes reconciling disjoint edits and a guarded structural Undo after a second actor edits the nested idea.

**Important limits**: This is a *textarea* browser harness, not Pocket's PE, a full rich-text editor or actual native OS IME. CDP composition proves Chromium event plumbing only, not real Japanese macOS/Windows/iOS IMEs. The explicit reference-policy Undo guard belongs to experimental Pocket-shaped code, not the engine itself. Cross-process state transfer is manual test-harness exchange, **not** encrypted Pocket Sync. Test snapshots are local test-file bytes, **not** Pocket's trusted Save. Passing does not establish real Pocket suitability or production E2EE/privacy.

Browser runner publishes captured TAP, environment versions and install log. Research workflow has read-only GitHub permission and cannot deploy. No adoption authorised.
