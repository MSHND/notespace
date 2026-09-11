/* One explicit persistence decision for JSON, Vault and dormant synced owners. */

(function initialisePocketOwnerSaveBoundary(global) {
  "use strict";

  let syncedController = null;
  let syncedGeneration = 0;
  let concurrentRebaseLease = null;
  let concurrentRebaseOrdinal = 0;

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

  function captureOperationHighWater(input) {
    if (typeof input?.captureOperationHighWater !== "function") return 0;
    try {
      const value = Number(input.captureOperationHighWater());
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch (_error) { return 0; }
  }

  function beginConcurrentRebaseLease(session, ceiling, input) {
    if (concurrentRebaseLease !== null || !session || session.ownerKind !== "synced"
        || !Number.isSafeInteger(ceiling) || ceiling < 1
        || !isOwnerSaveSessionCurrent(session)) return null;
    const highWater = captureOperationHighWater(input);
    if (highWater !== ceiling) return null;
    concurrentRebaseOrdinal += 1;
    const token = frozen({ kind: "p197-rebase-lease", id: concurrentRebaseOrdinal });
    concurrentRebaseLease = { token, session, ceiling, captureOperationHighWater: input.captureOperationHighWater };
    return token;
  }

  function isConcurrentRebaseLeaseCurrent(token, expectedLocalSession = null, ceiling = null) {
    const lease = concurrentRebaseLease;
    if (!lease || token !== lease.token || !isOwnerSaveSessionCurrent(lease.session)) return false;
    if (expectedLocalSession && (lease.session.localSession.id !== expectedLocalSession.id
        || lease.session.localSession.ownerKind !== expectedLocalSession.ownerKind)) return false;
    if (ceiling !== null && ceiling !== lease.ceiling) return false;
    try {
      const highWater = Number(lease.captureOperationHighWater());
      return Number.isSafeInteger(highWater) && highWater === lease.ceiling;
    } catch (_error) { return false; }
  }

  function releaseConcurrentRebaseLease(token) {
    if (!concurrentRebaseLease || token !== concurrentRebaseLease.token) return false;
    concurrentRebaseLease = null;
    return true;
  }

  function isConcurrentRebaseLeaseActive() {
    return concurrentRebaseLease !== null;
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

  async function save(input = {}) {
    if (typeof input.freezePayload !== "function") {
      return { ok: false, reason: "save-input-invalid" };
    }
    if (isConcurrentRebaseLeaseActive()) {
      return { ok: false, reason: "concurrent-rebase-lease-active" };
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
      if (result?.ok === false && result.reason === "starling-save-head-conflict"
          && Number.isSafeInteger(result.rebaseCeiling) && result.rebaseCeiling >= 1
          && typeof session.controller.rebaseConcurrentSyncedOwner === "function") {
        const leaseToken = beginConcurrentRebaseLease(session, result.rebaseCeiling, input);
        if (!leaseToken) {
          return { ok: false, reason: "concurrent-rebase-local-state-advanced", ownerKind: "synced", target: "synced" };
        }
        let rebased;
        try {
          rebased = await session.controller.rebaseConcurrentSyncedOwner({
            expectedSession: session.controllerSession,
            ceiling: result.rebaseCeiling,
          });
        } catch (_error) {
          rebased = { ok: false, reason: "starling-rebase-unsettled" };
        }
        if (!rebased?.ok) {
          releaseConcurrentRebaseLease(leaseToken);
          return Object.assign({ ownerKind: "synced", target: "synced" }, rebased || {
            ok: false,
            reason: "starling-rebase-unsettled",
          });
        }
        if (!isConcurrentRebaseLeaseCurrent(leaseToken, session.localSession, result.rebaseCeiling)) {
          releaseConcurrentRebaseLease(leaseToken);
          return {
            ok: false,
            reason: "concurrent-rebase-local-adoption-required",
            remoteCommitted: rebased.remoteCommitted === true,
            ownerKind: "synced",
            target: "synced",
          };
        }
        return Object.assign({
          ownerKind: "synced",
          target: "synced",
          concurrentRebase: true,
          rebaseLease: leaseToken,
        }, rebased);
      }
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
    if (isConcurrentRebaseLeaseActive()) return false;
    if (!syncedController) return false;
    syncedGeneration += 1;
    const retired = syncedController;
    syncedController = null;
    try { retired.releaseSyncedOwner?.(); } catch (_error) {}
    return true;
  }

  function installSyncedOwnerForSave(controller) {
    if (isConcurrentRebaseLeaseActive()) return false;
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
    save,
    installSyncedOwnerForSave,
    retireSyncedOwner,
    isConcurrentRebaseLeaseActive,
    isConcurrentRebaseLeaseCurrent,
    releaseConcurrentRebaseLease,
    hasSyncedOwner: () => isSyncedController(syncedController)
      && syncedController.captureSyncedOwnerSaveSession() !== null,
  });
})(window);
