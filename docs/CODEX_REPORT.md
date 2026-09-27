# Pocket — Last Report

## P272 — MAIN BACKSPACE / MAC DELETE ROUTING

Status: COMPLETE

Baseline:
- accepted main: `96beb8ee58153f869bc981bdb06606022fabaf6b`
- candidate: `candidate/p272`

Candidate head:
- `1831cbd7110ff8be3a2f1f6121c30dcbbe125e10` before this report-only commit

Implementation:
- Main plain Backspace with a non-empty Filter query continues through the existing Filter Backspace owner.
- The keypress that removes the last Filter character remains Filter-edit only.
- A subsequent plain Backspace with an already-empty Filter routes to the existing `deleteSelected()` owner.
- No OS/macOS detection was added.
- Existing Delete / `-` / Subtract routing is unchanged.
- Editable fields, inline editing, Move mode, modifier Backspace and blocked surfaces do not trigger Main deletion.

Files changed:
- `js/pocket-tree-actions.js`
- `tests/p272-main-backspace-delete-routing.test.js`
- `docs/CODEX_REPORT.md` (this report only)

Proof:
- Focused P272 routing proof added and included in normal Pocket check.
- GitHub Actions Pocket check run `36304924009` completed SUCCESS at implementation/test SHA `1831cbd7110ff8be3a2f1f6121c30dcbbe125e10`.
- Prior implementation-only SHA `2ff37ad95d8610d9f80b52e367b33c85ab8fee32` also passed Pocket check.
- Compare from baseline to implementation/test SHA: 2 commits ahead, 0 behind; only the routing file plus focused P272 test changed.

Boundaries verified:
- `main` remained exactly `96beb8ee58153f869bc981bdb06606022fabaf6b`.
- No deploy.
- No Render/provider/database/Sync changes.
- P273 not started.

