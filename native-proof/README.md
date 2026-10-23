# Pocket portable core — isolated Stage 0 proof

**Candidate only. No accepted Pocket application code or real Pocket data.**

This is the first centrally versioned source for the platform-independent Pocket
foundation. The C11 sources are byte-for-byte from the corrected 22 October
2026 disposable native proof, *not* the production browser application's
semantic implementation. This is not a migration or second canonical model.

## Run the portable core test

From the repository root on a machine with a C11 compiler and Bash:

    bash native-proof/scripts/check-portable-core.sh

The test compiles the same source on Linux and macOS and uses only in-memory
disposable data. Windows can compile the C11 files with an appropriate C toolchain.
GitHub Actions runs the test on this isolated branch whenever the proof files
change. Its results can be viewed from any device with repository access.

**A genuinely interactive browser test surface is NOT yet implemented.**
Neither this C11 test nor a GitHub Actions result is a substitute for Mac,
Windows, iOS or Web presentation acceptance.

## Provenance and open work

- Existing schematic owner: 11.9.1.6, Stage 0 disposable proof.
- Native status-fix source ZIP SHA-256:
  933855a16385ede51b6c19b205bd43ed820ce63758cfbb9bd7c2465435cfb90e.
- Accepted main at candidate branch creation:
  97ad08b68d269c4a7565ad6d7987dc33e7c9c875.
- This first commit centralises **only** the C11 underlayer. The Swift/AppKit
  test application remains preserved in its original source package pending
  separately verified integration. The branch is not a working native build.
- Known OPEN issue: if an edit returns to the exact saved text, the revision
  still advances and may still appear dirty. The test documents current
  behaviour; it does not silently fix Undo, Save or revision conflict guards.
- C11 core is a narrow prototype: no full Pocket node model, portable Undo
  owner, account, E2EE, Sync, persistent history or production data.
- No live Pocket deployment, canonical source adoption, provider/account
  changes, app publication or automatic native-binary distribution.

Next: verify the central GitHub check, then expand source and build adapters
under separate small proofs; make a browser-accessible *real-core* harness
before claiming an any-device interactive workflow.
