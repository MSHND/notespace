# Handover workflow

This repo uses a relay workflow between Murray, Nara, and Codex.

Roles:

- Murray gives consent and chooses the next step.
- Nara inspects repo-visible state, synthesises results, and names the next small intentional step.
- Codex runs local commands, applies local edits, and writes results back into repo-visible files.

Normal loop:

1. Murray says: check.
2. Nara reads repo-visible files and reports the state.
3. Nara suggests the next smallest intentional step.
4. Murray says yes or redirects.
5. Nara writes the next instruction into `docs/CODEX_NEXT.md` and uses `docs/CODEX_REPORT.md` for the report target.
6. Murray asks Codex to read the repo-level `AGENTS.md` and `docs/CODEX_NEXT.md`.
7. Codex acts locally, updates `docs/CODEX_REPORT.md`, and stops.
8. Murray says: check.

Rules:

- New behaviour starts in small, named, dormant files.
- Large files are only touched after replacement structure exists.
- Every change needs read-back or local check.
- If anything breaks or truncates, stop feature work and repair first.
- Do not delete legacy files until a separate cleanup step is explicitly named.

Current recent milestone:

The first safe prune removed `js/pocket-enter-preflight.js` from the live `index.html` load order. The file remains in the repo. `npm run check` passes after the prune.
