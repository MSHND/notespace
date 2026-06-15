/* Display-only sync readiness line for the existing Pocket health status. */
(function initialisePocketHealthSync(global) {
  "use strict";

  const originalShowPocketHealth = typeof global.showPocketHealth === "function"
    ? global.showPocketHealth
    : null;

  function clean(value, max) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max || 120);
  }

  function list(values, maxItems) {
    if (!Array.isArray(values)) return [];
    return values.map((value) => clean(value, 90)).filter(Boolean).slice(0, maxItems || 2);
  }

  function pluralOps(count) {
    return `${count} unsaved op${count === 1 ? "" : "s"}`;
  }

  function syncLabel(sync) {
    const stateName = clean(sync && sync.state, 40) || "unknown";
    const opCount = Math.max(0, Math.round(Number(sync && sync.unsavedOpCount) || 0));

    if (stateName === "clean") return "Sync: clean";
    if (stateName === "dirty") return `Sync: dirty${opCount ? ` - ${pluralOps(opCount)}` : ""}`;
    if (stateName === "saving") return "Sync: saving";
    if (stateName === "conflict") return "Sync blocked: stale file risk";
    if (stateName === "pe_dirty") return "Sync blocked: PE draft open";
    if (stateName === "details_dirty") return "Sync blocked: old details draft open";
    if (stateName === "needs_file") return "Sync blocked: no file handle";
    return `Sync: ${stateName}`;
  }

  function formatSyncHealthText() {
    const getStatus = global.__pocketLiteGetSyncStatus || global.getPocketSyncStatus;
    if (typeof getStatus !== "function") return "Sync: unavailable";

    let sync;
    try {
      sync = getStatus();
    } catch (error) {
      const message = clean(error && error.message, 80);
      return message ? `Sync: unavailable - ${message}` : "Sync: unavailable";
    }

    if (!sync || typeof sync !== "object") return "Sync: unavailable";

    const blockers = list(sync.blockers, 2);
    const warnings = list(sync.warnings, 2);
    const parts = [syncLabel(sync)];

    if (blockers.length) parts.push(blockers.join("; "));
    if (warnings.length) parts.push(`warning: ${warnings.join("; ")}`);
    if (sync.canAutoWrite === false) parts.push("auto-write off");

    return parts.join(" - ");
  }

  function appendToHealthToast(syncText) {
    try {
      if (typeof el === "object" && el && el.titleToast && el.titleToast.textContent) {
        el.titleToast.textContent = `${el.titleToast.textContent} - ${syncText}`;
        return true;
      }
    } catch (_error) {
      return false;
    }
    return false;
  }

  function showPocketHealthWithSync() {
    if (originalShowPocketHealth) originalShowPocketHealth.apply(this, arguments);

    const syncText = formatSyncHealthText();
    if (!appendToHealthToast(syncText) && typeof global.setStatus === "function") {
      global.setStatus(`Health: ${syncText}`, "ok", { durationMs: 12000 });
    }
  }

  if (originalShowPocketHealth) {
    global.showPocketHealth = showPocketHealthWithSync;
  }
})(window);
