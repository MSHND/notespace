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
    retireSyncedOwner();
    syncedGeneration += 1;
    syncedController = controller;
    try {
      global.setPocketFileSession(null, "Synced Pocket", {
        ownerKind: "synced",
        forceNewSession: true,
      });
    } catch (_error) {
      syncedController = null;
      syncedGeneration += 1;
      try { controller.releaseSyncedOwner?.(); } catch (_releaseError) {}
      return false;
    }
    return true;
  }

  global.PocketOwnerSaveBoundary = frozen({
    captureOwnerSaveSession,
    isOwnerSaveSessionCurrent,
    save,
    installSyncedOwnerForSave,
    retireSyncedOwner,
    hasSyncedOwner: () => isSyncedController(syncedController)
      && syncedController.captureSyncedOwnerSaveSession() !== null,
  });
})(window);
