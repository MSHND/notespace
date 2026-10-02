/* Capability-only Pocket doorway routing. Owns no document or Sync truth. */
(function initialisePocketDoorwayCapabilities(global) {
  "use strict";

  function read() {
    const localOpen = typeof global.showOpenFilePicker === "function";
    const localNew = typeof global.showSaveFilePicker === "function";
    let syncedOpen = false;
    let syncedNew = false;
    try {
      syncedOpen = global.PocketSyncUi?.canOpenExisting?.() === true;
    } catch (_error) {
      syncedOpen = false;
    }
    try {
      syncedNew = global.PocketSyncUi?.canCreateNew?.() === true;
    } catch (_error) {
      syncedNew = false;
    }
    const anyOpen = localOpen || syncedOpen;
    const anyNew = localNew || syncedNew;
    return Object.freeze({
      localOpen,
      localNew,
      syncedOpen,
      syncedNew,
      anyOpen,
      anyNew,
      anyAction: anyOpen || anyNew,
    });
  }

  global.PocketDoorwayCapabilities = Object.freeze({ read });
})(typeof window !== "undefined" ? window : globalThis);
