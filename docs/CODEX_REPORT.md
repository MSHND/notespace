# Codex report

Status: report-only design for opening the blocked PE after resolving unsaved changes.

Files changed:

- `docs/CODEX_REPORT.md`

Findings:

- The blocked item B request is available inside `PocketNodePopoutWindow.open(payload, helpers)` at the moment the dirty-popup guard returns `false`.
- Safest place to remember it: `js/pocket-node-popout-window.js`, beside the existing private `editorWindow` reference.
- Keep one private pending slot only, for example `pendingOpen = { payload, helpers }`.
- Do not store this in bridge/cutover; those layers only route open requests.
- `pocket-node-popout-editor.js` can remain the coordinator for public `open/apply` and should not need save/apply changes for the first pass.

Recommended design:

- When `PocketNodePopoutWindow.open` blocks because the current popup is dirty, store the blocked payload/helpers in the single pending slot, focus the current popup, and request the existing unsaved dialog.
- Expose tiny opener-side methods from `PocketNodePopoutWindow`, for example `resumePendingOpen()` and `cancelPendingOpen()`.
- Runtime calls `resumePendingOpen()` after a successful Save & close, or after Exit without saving.
- Runtime calls `cancelPendingOpen()` from Go back to editing / dialog cancel paths.
- If `resumePendingOpen()` returns `true`, the runtime should skip the normal close because the opener has replaced the current popup with item B.
- If there is no pending open, Save & close and Exit without saving continue their current close behaviour.
- To avoid queue complexity, keep only one pending request; if another blocked open is requested before resolution, the latest requested item can replace the pending slot.

Important flow details:

- Resume should happen only after save succeeds; failed saves must not open item B.
- Discard can resume immediately after dirty state is cleared.
- Go back to editing must clear the pending slot so a later normal Save & close does not unexpectedly open item B.
- Replacing the current popup document instead of closing and reopening avoids popup-blocker and close-timer races.

What should remain untouched:

- Save/apply plumbing, node writes, persistence, popup styling, template markup, unsaved dialog wording, script order, PE migration/data logic, legacy fields, outline cap behaviour, and bridge/cutover routing.

Risks and checks:

- Risks: stale pending payload, opening B after a failed save, opening B after Go back, close timer racing a replacement, or accidentally changing normal Save & close with no pending item.
- Checks: `node --check js/pocket-node-popout-runtime.js`, `node --check js/pocket-node-popout-window.js`, `node --check js/pocket-node-popout-editor.js` if edited, and `node tools/pocket-check.js`.
- Manual checks: dirty A -> open B -> Save & close opens B; dirty A -> open B -> Exit without saving opens B; dirty A -> open B -> Go back keeps A and does not open B; failed save does not open B; normal Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still work.

Smallest future implementation step:

- Add the single pending slot plus `resumePendingOpen()` / `cancelPendingOpen()` to `PocketNodePopoutWindow`, then have the runtime call those hooks from the existing unsaved dialog resolution paths only.
