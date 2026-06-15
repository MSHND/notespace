/* Read-only sync readiness/status summary. */
(function initialisePocketSyncStatus(global) {
  "use strict";

  function clean(value, max) {
    return String(value || "").trim().slice(0, max || 160);
  }

  function plural(count, singular, pluralText) {
    return `${count} ${count === 1 ? singular : (pluralText || `${singular}s`)}`;
  }

  function readBool(fn) {
    try {
      return typeof fn === "function" && !!fn();
    } catch (_error) {
      return false;
    }
  }

  function readValue(fn, fallback) {
    try {
      return typeof fn === "function" ? fn() : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function appState() {
    try {
      return typeof state === "object" && state ? state : null;
    } catch (_error) {
      return null;
    }
  }

  function hasTruthFileHandle() {
    try {
      return typeof truthFileHandle !== "undefined" && !!truthFileHandle;
    } catch (_error) {
      return false;
    }
  }

  function hasStandalonePeDraft() {
    const popout = global.PocketNodePopoutWindow;
    return !!(popout && typeof popout.hasUnsavedChanges === "function" && readBool(popout.hasUnsavedChanges));
  }

  function emptyStatus(stateName, blocker) {
    return {
      state: stateName,
      canAutoWrite: false,
      canManualSave: false,
      blockers: blocker ? [blocker] : [],
      warnings: [],
      unsavedOpCount: 0,
      hasUnsavedOps: false,
      hasOldDetailsDraft: false,
      hasStandalonePeDraft: false,
      hasConflictGuard: false,
      saveInProgress: false,
      hasTruthFileHandle: false,
      sourceFileName: "",
      sourceWrittenAt: "",
      lastBackupAt: "",
      localSafetyAt: ""
    };
  }

  function getPocketSyncStatus() {
    const current = appState();
    if (!current) return emptyStatus("unknown", "app state unavailable");

    const blockers = [];
    const warnings = [];
    const ops = Array.isArray(current.ops) ? current.ops : [];
    const unsavedOpCount = ops.length;
    const hasUnsavedOps = unsavedOpCount > 0;
    const hasOldDetailsDraft = readBool(global.hasUnsavedDetailsEditorChanges);
    const peDraft = hasStandalonePeDraft();
    const guard = current.conflictGuard || {};
    const hasConflictGuard = !!guard.active;
    const saveInProgress = !!current.saveInProgress;
    const truthHandle = hasTruthFileHandle();
    const backupMeta = readValue(global.readLastBackupMeta, null);
    const localSafety = readValue(global.readLocalSafetySnapshot, null);
    const hasNodes = Array.isArray(current.nodes) && current.nodes.length > 0;

    let stateName = "clean";

    if (saveInProgress) {
      stateName = "saving";
      blockers.push("save already in progress");
    } else if (peDraft) {
      stateName = "pe_dirty";
      blockers.push("standalone PE has unapplied edits");
    } else if (hasOldDetailsDraft) {
      stateName = "details_dirty";
      blockers.push("old details overlay has unapplied edits");
    } else if (hasConflictGuard) {
      stateName = "conflict";
      blockers.push(clean(guard.reason, 140) || "possible stale file risk");
    } else if (hasUnsavedOps && !truthHandle) {
      stateName = "needs_file";
      blockers.push("no file handle; manual save needs picker");
    } else if (hasUnsavedOps) {
      stateName = "dirty";
    }

    if (hasUnsavedOps) warnings.push(`${plural(unsavedOpCount, "unbacked operation")}`);
    if (!truthHandle && stateName !== "needs_file") warnings.push("no file handle yet");
    if (!backupMeta) warnings.push("last backup unknown");

    return {
      state: stateName,
      canAutoWrite: false,
      canManualSave: !!(hasNodes && !saveInProgress && !peDraft && !hasOldDetailsDraft),
      blockers,
      warnings,
      unsavedOpCount,
      hasUnsavedOps,
      hasOldDetailsDraft,
      hasStandalonePeDraft: peDraft,
      hasConflictGuard,
      saveInProgress,
      hasTruthFileHandle: truthHandle,
      sourceFileName: clean(current.source && current.source.fileName, 160),
      sourceWrittenAt: clean(current.source && current.source.writtenAt, 60),
      lastBackupAt: clean(backupMeta && backupMeta.exportedAt, 60),
      localSafetyAt: clean(localSafety && localSafety.capturedAt, 60)
    };
  }

  global.getPocketSyncStatus = getPocketSyncStatus;
  global.__pocketLiteGetSyncStatus = getPocketSyncStatus;
})(window);
