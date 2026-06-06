# Next local action

Read the repo-level `AGENTS.md` first.

Purpose: browser smoke test after two safe load-order prunes.

Do not change files unless updating `docs/CODEX_REPORT.md`.
Do not delete files.
Do not prune more scripts.
Do not modify PE/editor behaviour.

Local/manual steps:

1. Pull latest `main`.
2. Run `npm run check`.
3. Open Pocket in a browser.
4. Hard refresh.
5. Open an existing Pocket JSON if needed.
6. Select any normal node.
7. Open item details / PE.
8. Confirm the PE window opens.
9. Edit the body text lightly or make a harmless temporary test note.
10. Save or close according to current app behaviour.
11. Confirm the app does not show obvious console errors.
12. Confirm no unexpected file edits occurred, except this report.
13. Update `docs/CODEX_REPORT.md` with results.

Report should include:

- Browser used.
- Check result.
- Whether PE/item details opened.
- Whether save/close behaved normally.
- Any console errors.
- Files changed.
- Suggested next step.

Stop if anything looks wrong.
