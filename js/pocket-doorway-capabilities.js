/* Capability-only Pocket doorway routing. Owns no document or Sync truth. */
(function initialisePocketDoorwayCapabilities(global) {
  "use strict";

  function read() {
    const localOpen = typeof global.showOpenFilePicker === "function";
    const localNew = typeof global.showSaveFilePicker === "function";
    let syncedOpen = false;
    try {
      syncedOpen = global.PocketSyncUi?.canOpenExisting?.() === true;
    } catch (_error) {
      syncedOpen = false;
    }
    return Object.freeze({
      localOpen,
      localNew,
      syncedOpen,
      anyOpen: localOpen || syncedOpen,
      anyAction: localOpen || localNew || syncedOpen,
    });
  }

  global.PocketDoorwayCapabilities = Object.freeze({ read });
})(typeof window !== "undefined" ? window : globalThis);
