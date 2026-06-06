# Next local action

Read the repo-level `AGENTS.md` first.

Purpose: inspect editor and PE load-order bloat. Report only.

Do not change app behaviour.
Do not edit `index.html`.
Do not delete files.
Do not modify PE/editor scripts.

Local steps:

1. Run `npm run check`.
2. Inspect the editor and PE-related script tags currently loaded by `index.html`.
3. Identify likely legacy, duplicate, wrapper, or transition files.
4. Suggest one smallest safe next cleanup step.
5. Update `docs/CODEX_REPORT.md` with results.

Report should include:

- Check result.
- Editor/PE-related scripts found.
- Likely legacy or duplicate files.
- Suggested next cleanup step.
- Any concerns.
