# Codex report

Status: report-only investigation of PE unsaved-change protection when opening another item.

Files changed:

- `docs/CODEX_REPORT.md`

Findings:

- Open-another flow: `pocket-editor-cutover-v3.js` routes edit/double-click to `PocketPeEditor.open(node.id)`, `pocket-pe-node-popout-bridge.js` delegates to `PocketNodePopoutEditor.open`, then `PocketNodePopoutWindow.open(payload)` reuses the named window `pocketNodePopoutEditor`.
- Replacement point: `PocketNodePopoutWindow.open` calls `window.open("", "pocketNodePopoutEditor", ...)`, then `document.open/write/close`; this overwrites the current popup document when that named popup already exists.
- Dirty state lives only inside the popup runtime closure: `dirty`, `allowedToClose`, `setDirty`, `closeSafely`, and the unsaved dialog DOM handlers in `pocket-node-popout-runtime.js`.
- Main window cannot currently make a reliable dirty-state decision: the popup window reference is private in `pocket-node-popout-window.js`, and the runtime exposes no `hasUnsavedChanges` or replacement-guard API.
- Existing warning is bypassed because main-window replacement does not call popup `closeSafely()` or `showUnsavedDialog()`; it writes a new document into the named popup.
- `beforeunload` is not enough here: it is browser-owned, not the existing PE dialog flow, and the observed behaviour shows it is not protecting this replacement path.

Safest design:

- Keep dirty-state ownership in `pocket-node-popout-runtime.js`.
- Add a tiny same-origin popup session API from the runtime, for example `hasUnsavedChanges()` and `requestUnsavedProtection()`.
- Have `pocket-node-popout-window.js` check the existing `editorWindow` before `document.open/write`.
- If the current popup is dirty, focus it, ask it to show its existing unsaved dialog, return `false`, and do not open the new node yet.
- Keep `pocket-node-popout-editor.js` as coordinator only; do not change `apply`, node writes, persistence, target lookup, model building, or bridge/cutover routing in the first fix.
- Avoid queuing the requested new node in the first pass; blocking and focusing the dirty popup is the smallest safe protection.

What should not be touched:

- Save / Save & close / Cmd/Ctrl+S behaviour.
- Escape and close-button unsaved dialog behaviour.
- Popup styling, template markup, script order, PE migration/data logic, legacy fields, outline cap behaviour, bridge/cutover routing, and script pruning.

Risks and checks for a future implementation:

- Risks: stale or closed popup reference, cross-window access exceptions, accidentally blocking clean popup replacement, changing save/close semantics, or adding queued-open complexity too early.
- Syntax checks: `node --check js/pocket-node-popout-runtime.js`, `node --check js/pocket-node-popout-window.js`, `node --check js/pocket-node-popout-editor.js` if edited, plus `node tools/pocket-check.js`.
- Manual checks: open node A, edit without saving, attempt to open node B, confirm node A stays open and protection appears; verify clean popup replacement still works; verify Save, Save & close, Cmd/Ctrl+S, Escape, text mode, and outline mode still pass.

Smallest future implementation step:

- Add the runtime dirty/protect API and a pre-write guard in `PocketNodePopoutWindow.open`; when dirty, focus the current popup, show the existing unsaved dialog, return `false`, and leave all save/apply plumbing untouched.
