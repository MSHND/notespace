/* Same-origin production Sync bootstrap. The server serves this as an external script. */

(function initialisePocketSyncProductionBootstrap(global) {
  "use strict";

  try { global.PocketSyncBrowserIntegration?.create?.(); } catch (_error) {}
})(typeof window !== "undefined" ? window : globalThis);
