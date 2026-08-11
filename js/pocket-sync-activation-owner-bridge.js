/* Dormant P039 to P042 to P043 activation-owner composition. */

(function initialisePocketSyncActivationOwnerBridge(global) {
  "use strict";

  function frozen(value) {
    return Object.freeze(value);
  }

  function createActivationOwnerBridge(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).length !== 2
        || !Object.prototype.hasOwnProperty.call(input, "syncedOwnerController")
        || !Object.prototype.hasOwnProperty.call(input, "ownerSaveBoundary")) {
      throw new Error("Pocket Sync activation owner bridge configuration is invalid.");
    }
    const controller = input.syncedOwnerController;
    const boundary = input.ownerSaveBoundary;
    if (!controller || typeof controller.adoptReadyActivation !== "function"
        || typeof controller.releaseSyncedOwner !== "function"
        || !boundary || typeof boundary.installSyncedOwnerForSave !== "function") {
      throw new Error("Pocket Sync activation owner bridge configuration is invalid.");
    }

    async function adoptSyncedOwner(ownerDescriptor) {
      let adopted;
      try { adopted = await controller.adoptReadyActivation(ownerDescriptor); }
      catch (_error) { return frozen({ ok: false }); }
      if (!adopted || adopted.ok !== true) return frozen({ ok: false });
      let installed = false;
      try { installed = boundary.installSyncedOwnerForSave(controller) === true; }
      catch (_error) { installed = false; }
      if (!installed) {
        try { controller.releaseSyncedOwner(); } catch (_error) {}
        return frozen({ ok: false });
      }
      return frozen({ ok: true });
    }

    return frozen({ adoptSyncedOwner });
  }

  global.PocketSyncActivationOwnerBridge = frozen({ createActivationOwnerBridge });
})(typeof window !== "undefined" ? window : globalThis);
