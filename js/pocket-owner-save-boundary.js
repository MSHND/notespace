/* One explicit persistence decision for JSON, Vault and dormant synced owners. */

(function initialisePocketOwnerSaveBoundary(global) {
  "use strict";

  let syncedController = null;
  let syncedGeneration = 0;

  function frozen(value) {
    return Object.freeze(value);
  }

  function isSyncedController(value) {
    return !!value
      && typeof value.captureSyncedOwnerSaveSession === "function"
      && typeof value.isSyncedOwnerSaveSessionCurrent === "function"
      && typeof value.saveSyncedOwner === "function";
  }

  function localSessionIsCurrent(session) {
    return typeof global.isPocketFileSaveSessionCurrent === "function"
      && global.isPocketFileSaveSessionCurrent(session) === true;
  }

  function captureOwnerSaveSession() {
    const localSession = typeof global.capturePocketFileSaveSession === "function"
      ? global.capturePocketFileSaveSession()
      : null;
    if (!localSession || typeof localSession.ownerKind !== "string") return null;
    if (localSession.ownerKind !== "synced") {
      return frozen({ ownerKind: localSession.ownerKind, localSession });
    }
    if (!isSyncedController(syncedController)) return null;
    const controllerSession = syncedController.captureSyncedOwnerSaveSession();
    if (!controllerSession) return null;
    return frozen({
      ownerKind: "synced",
      localSession,
      syncedGeneration,
      controller: syncedController,
      controllerSession,
    });
  }

  function isOwnerSaveSessionCurrent(session) {
    if (!session || !localSessionIsCurrent(session.localSession)) return false;
    if (session.ownerKind !== "synced") return true;
    return session.syncedGeneration === syncedGeneration
      && session.controller === syncedController
      && isSyncedController(syncedController)
      && syncedController.isSyncedOwnerSaveSessionCurrent(session.controllerSession) === true;
  }

  function staleResult(ownerKind) {
    return { ok: false, reason: "stale-owner-session", ownerKind };
  }

  function captureOwnerForAdoption() {
    try {
      const snapshot = global.capturePocketFileOwnerForAdoption?.();
      return snapshot && typeof snapshot === "object" ? snapshot : null;
    } catch (_error) { return null; }
  }

  function restoreOwnerAfterFailedAdoption(snapshot) {
    if (!snapshot || typeof global.restorePocketFileOwnerAfterFailedAdoption !== "function") {
      return false;
    }
    try { return global.restorePocketFileOwnerAfterFailedAdoption(snapshot) === true; }
    catch (_error) { return false; }
  }

  function syncedOwnerInstalled(controller) {
    let localSession;
    let controllerSession;
    try {
      localSession = global.capturePocketFileSaveSession?.();
      controllerSession = controller.captureSyncedOwnerSaveSession();
    } catch (_error) { return false; }
    return localSession?.ownerKind === "synced"
      && syncedController === controller
      && controllerSession !== null;
  }

  function abandonSyncedOwnerInstall(controller, previousOwner) {
    if (syncedController === controller) {
      syncedController = null;
      syncedGeneration += 1;
    }
    try { controller.releaseSyncedOwner?.(); } catch (_error) {}
    restoreOwnerAfterFailedAdoption(previousOwner);
    return false;
  }

  function resolveOrdinaryMainInlineDraft() {
    const inlineEditId = typeof global.state?.inlineEdit?.id === "string"
      ? global.state.inlineEdit.id
      : "";
    if (!inlineEditId) return { ok: true, active: false, committed: false };
    if (typeof global.captureActiveInlineEditForOwnerSwitch !== "function"
        || typeof global.commitActiveInlineEditForOwnerSwitch !== "function") {
      return { ok: false, active: true, reason: "inline-draft-commit-unavailable" };
    }

    let captured;
    try {
      captured = global.captureActiveInlineEditForOwnerSwitch();
    } catch (_error) {
      return { ok: false, active: true, reason: "inline-draft-capture-failed" };
    }
    if (!captured || captured.ok !== true) {
      return captured && typeof captured === "object"
        ? { ...captured, ok: false, active: captured.active !== false }
        : { ok: false, active: true, reason: "inline-draft-invalid" };
    }
    if (captured.active !== true) {
      return { ok: false, active: true, reason: "inline-draft-ambiguous" };
    }

    const expectedSession = typeof global.capturePocketFileSaveSession === "function"
      ? global.capturePocketFileSaveSession()
      : null;
    const sessionIsCurrent = () => {
      if (!expectedSession) return true;
      return typeof global.isPocketFileSaveSessionCurrent === "function"
        && global.isPocketFileSaveSessionCurrent(expectedSession) === true;
    };
    if (!sessionIsCurrent()) return { ok: false, active: true, reason: "stale-owner-session" };

    let committed;
    try {
      committed = global.commitActiveInlineEditForOwnerSwitch(captured, {
        isCurrent: sessionIsCurrent,
      });
    } catch (_error) {
      return { ok: false, active: true, reason: "inline-draft-commit-failed" };
    }
    if (!committed || committed.ok !== true) {
      return committed && typeof committed === "object"
        ? { ...committed, ok: false, active: committed.active !== false }
        : { ok: false, active: true, reason: "inline-draft-commit-failed" };
    }
    if (!sessionIsCurrent()) return { ok: false, active: true, reason: "stale-owner-session" };
    return { ...committed, ok: true, active: false, committed: true };
  }

  function installOrdinarySaveDraftResolver() {
    const original = global.saveCurrentContext;
    if (typeof original !== "function" || original.__pocketP210DraftResolver === true) return false;

    function saveCurrentContextWithDraftResolution(...args) {
      const resolved = resolveOrdinaryMainInlineDraft();
      if (!resolved || resolved.ok !== true) {
        if (typeof global.setStatus === "function") {
          global.setStatus("Finish or correct the active item name before saving.", "warn", { durationMs: 5200 });
        }
        return false;
      }
      return original.apply(this, args);
    }

    Object.defineProperty(saveCurrentContextWithDraftResolution, "__pocketP210DraftResolver", {
      value: true,
      enumerable: false,
    });
    global.saveCurrentContext = saveCurrentContextWithDraftResolution;
    return true;
  }

  async function save(input = {}) {
    if (typeof input.freezePayload !== "function") {
      return { ok: false, reason: "save-input-invalid" };
    }
    const expectedLocalSession = input.expectedSession || null;
    if (expectedLocalSession && !localSessionIsCurrent(expectedLocalSession)) {
      return staleResult(expectedLocalSession.ownerKind || "none");
    }
    const session = captureOwnerSaveSession();
    if (!session) return { ok: false, reason: "no-authoritative-owner" };
    if (expectedLocalSession && session.localSession !== expectedLocalSession
        && (session.localSession.id !== expectedLocalSession.id
          || session.localSession.ownerKind !== expectedLocalSession.ownerKind)) {
      return staleResult(session.ownerKind);
    }
    if (!isOwnerSaveSessionCurrent(session)) return staleResult(session.ownerKind);

    if (session.ownerKind === "synced") {
      const result = await session.controller.saveSyncedOwner({ freezePayload: input.freezePayload });
      if (!isOwnerSaveSessionCurrent(session)) return staleResult("synced");
      return Object.assign({ ownerKind: "synced", target: "synced" }, result || {
        ok: false,
        reason: "synced-save-failed",
      });
    }

    if (session.ownerKind === "none") return { ok: false, reason: "no-authoritative-owner" };
    let payload;
    try { payload = await input.freezePayload(); }
    catch (_error) { return { ok: false, reason: "payload-freeze-failed", ownerKind: session.ownerKind }; }
    if (!isOwnerSaveSessionCurrent(session)) return staleResult(session.ownerKind);

    let result;
    if (session.ownerKind === "vault") {
      const vaultIo = global.PocketVaultBrowserIo;
      result = vaultIo && typeof vaultIo.writeActiveVaultPayload === "function"
        ? await vaultIo.writeActiveVaultPayload(payload, {
          expectedSession: session.localSession,
          vaultDialogToken: input.vaultDialogToken,
        })
        : { ok: false, reason: "vault-locked" };
    } else {
      result = typeof global.writeTruthFile === "function"
        ? await global.writeTruthFile(payload, { expectedSession: session.localSession })
        : { ok: false, reason: "file-save-unavailable" };
    }
    const pickedFileAdoption = !!(
      result
      && result.ok === true
      && result.target === "picked-file"
      && result.adoptedFromSessionId === session.localSession.id
      && global.isPocketEditorSourceIdentityCurrent?.(result.sourceIdentity) === true
    );
    if (!isOwnerSaveSessionCurrent(session) && !pickedFileAdoption) return staleResult(session.ownerKind);
    return Object.assign({ ownerKind: session.ownerKind }, result || {
      ok: false,
      reason: "persistence-failed",
    });
  }

  function retireSyncedOwner() {
    if (!syncedController) return false;
    syncedGeneration += 1;
    const retired = syncedController;
    syncedController = null;
    try { retired.releaseSyncedOwner?.(); } catch (_error) {}
    return true;
  }

  function installSyncedOwnerForSave(controller) {
    if (!isSyncedController(controller)
        || controller.captureSyncedOwnerSaveSession() === null
        || !global.setPocketFileSession) return false;
    const previousOwner = captureOwnerForAdoption();
    retireSyncedOwner();
    syncedGeneration += 1;
    syncedController = controller;
    try {
      global.setPocketFileSession(null, "Synced Pocket", {
        ownerKind: "synced",
        forceNewSession: true,
      });
    } catch (_error) {
      return abandonSyncedOwnerInstall(controller, previousOwner);
    }
    if (!syncedOwnerInstalled(controller)) return abandonSyncedOwnerInstall(controller, previousOwner);
    return true;
  }

  global.PocketOwnerSaveBoundary = frozen({
    captureOwnerSaveSession,
    isOwnerSaveSessionCurrent,
    resolveOrdinaryMainInlineDraft,
    save,
    installSyncedOwnerForSave,
    retireSyncedOwner,
    hasSyncedOwner: () => isSyncedController(syncedController)
      && syncedController.captureSyncedOwnerSaveSession() !== null,
  });

  installOrdinarySaveDraftResolver();
})(window);
