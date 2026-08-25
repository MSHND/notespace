/* Explicit local-owner decisions before a requested existing-Synced switch. */
(function initialisePocketSyncedSwitchGate(global) {
  "use strict";

  function frozen(value) { return Object.freeze(value); }

  function capture() {
    let session;
    try { session = global.capturePocketFileSaveSession?.(); }
    catch (_error) { return null; }
    if (!session || !["json", "vault"].includes(session.ownerKind) || !Number.isSafeInteger(session.id)) return null;
    return frozen({ ownerKind: session.ownerKind, id: session.id,
      vaultSessionId: typeof session.vaultSessionId === "string" ? session.vaultSessionId : "" });
  }

  function isCurrent(expected) {
    const current = capture();
    return !!expected && !!current
      && expected.ownerKind === current.ownerKind
      && expected.id === current.id
      && expected.vaultSessionId === current.vaultSessionId;
  }

  function hasDraft() {
    try {
      return global.hasUnsavedDetailsEditorChanges?.() === true
        || global.hasUnsavedInlineTitleDraft?.() === true;
    } catch (_error) { return true; }
  }

  function isDirty(expected) {
    if (!isCurrent(expected)) return false;
    try { return global.hasPocketUnsavedChanges?.() === true; }
    catch (_error) { return true; }
  }

  function discardPermit(expected) {
    if (!isCurrent(expected) || !isDirty(expected) || hasDraft()) return null;
    return frozen({ ownerKind: expected.ownerKind, continuityId: String(expected.id) });
  }

  async function save(expected) {
    if (!isCurrent(expected)) return frozen({ ok: false, reason: "source-session-changed" });
    if (hasDraft()) return frozen({ ok: false, reason: "editor-draft-active" });
    if (!isDirty(expected)) return frozen({ ok: true });
    if (typeof global.exportTree !== "function") return frozen({ ok: false, reason: "save-unavailable" });
    let result;
    try { result = await global.exportTree({ returnDetails: true, downloadFallback: false }); }
    catch (_error) { return frozen({ ok: false, reason: "save-failed" }); }
    if (!isCurrent(expected)) return frozen({ ok: false, reason: "source-session-changed" });
    if (!result?.ok) return frozen({ ok: false, reason: result?.reason || "save-failed" });
    if (isDirty(expected)) return frozen({ ok: false, reason: "source-still-dirty" });
    return frozen({ ok: true });
  }

  global.PocketSyncedSwitchGate = frozen({ capture, isCurrent, isDirty, discardPermit, save });
})(typeof window !== "undefined" ? window : globalThis);
