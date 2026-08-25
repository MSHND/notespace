/* Deliberate replacement of the visible truth owned by an existing Synced Pocket. */
(function initialisePocketSyncedTruthHandover(global) {
  "use strict";

  let busy = false;
  let refreshInstalled = () => {};

  function currentSession() {
    try { return global.capturePocketFileSaveSession?.() || null; }
    catch (_error) { return null; }
  }

  function hasOpenDraft() {
    try {
      return global.hasPocketUnsavedChanges?.() === true
        || global.hasUnsavedDetailsEditorChanges?.() === true
        || global.hasUnsavedInlineTitleDraft?.() === true;
    } catch (_error) { return true; }
  }

  function isCurrentSyncedOwner(session) {
    return !!session
      && session.ownerKind === "synced"
      && global.isPocketFileSaveSessionCurrent?.(session) === true
      && global.PocketOwnerSaveBoundary?.hasSyncedOwner?.() === true
      && hasOpenDraft() === false;
  }

  function say(message, tone) {
    try { global.setStatus?.(message, tone || "warn", { durationMs: 6200 }); }
    catch (_error) {}
  }

  function copyPayload(payload) {
    try { return JSON.parse(JSON.stringify(payload)); }
    catch (_error) { return null; }
  }

  function selectedPayload(inspected) {
    if (!inspected?.ok || inspected.kind !== "json" || !inspected.payload
        || global.isPocketPayloadShape?.(inspected.payload) !== true
        || typeof global.normaliseInput !== "function") return null;
    const payload = copyPayload(inspected.payload);
    if (!payload || global.isPocketPayloadShape?.(payload) !== true) return null;
    try {
      const norm = global.normaliseInput(payload);
      return global.isPocketPayloadShape?.(norm) === true ? { payload, norm } : null;
    } catch (_error) { return null; }
  }

  function confirmReplacement(fileName) {
    if (typeof global.confirm !== "function") return false;
    try {
      return global.confirm(`Use “${fileName || "this Pocket file"}” as the synced Pocket’s contents? The selected file will remain unchanged.`) === true;
    } catch (_error) { return false; }
  }

  async function begin() {
    if (busy) return false;
    const sourceSession = currentSession();
    if (!isCurrentSyncedOwner(sourceSession)) {
      say("Save or finish current changes before replacing Synced Pocket contents.");
      return false;
    }
    const opening = global.PocketFileOpening;
    if (!opening || typeof opening.chooseExistingFile !== "function") {
      say("Pocket file selection is not available in this browser.");
      return false;
    }
    busy = true;
    refreshInstalled();
    try {
      const inspected = await opening.chooseExistingFile({
        canContinue: () => isCurrentSyncedOwner(sourceSession),
      });
      if (!inspected?.ok) {
        if (inspected?.reason !== "cancelled" && inspected?.reason !== "candidate-changed") {
          say("That file is not a supported Pocket JSON. Synced Pocket is unchanged.");
        }
        return false;
      }
      if (inspected.kind === "vault") {
        say("Choose a normal Pocket JSON to replace Synced Pocket contents. Encrypted Vaults stay separate.");
        return false;
      }
      const candidate = selectedPayload(inspected);
      if (!candidate || !isCurrentSyncedOwner(sourceSession)) {
        say("Pocket changed while that file was checked. Synced Pocket is unchanged.");
        return false;
      }
      if (!confirmReplacement(inspected.fileName)) return false;
      if (!isCurrentSyncedOwner(sourceSession)) {
        say("Pocket changed before confirmation. Synced Pocket is unchanged.");
        return false;
      }
      const boundary = global.PocketOwnerSaveBoundary;
      const saved = await boundary.save({
        expectedSession: sourceSession,
        freezePayload: () => candidate.norm,
      });
      if (!saved?.ok || saved.ownerKind !== "synced" || saved.target !== "synced") {
        say("Synced Pocket could not replace its contents. The selected file is unchanged.");
        return false;
      }
      if (global.isPocketFileSaveSessionCurrent?.(sourceSession) !== true
          || boundary.hasSyncedOwner?.() !== true
          || typeof global.commitPreparedPocketDocument !== "function") {
        say("Synced Pocket saved the replacement but could not safely show it. Reopen Synced Pocket to continue.");
        return false;
      }
      const committed = global.commitPreparedPocketDocument(candidate.norm, {
        schema: candidate.norm.schema || "portal.export.v1",
        fileName: "Synced Pocket",
        writtenAt: candidate.norm.writtenAt || candidate.payload.writtenAt || candidate.payload.exportedAt || "",
      }, {
        ownerKind: "synced",
        displayName: "Synced Pocket",
        storagePrivate: "synced",
        forceNewSession: true,
        canContinue: () => boundary.hasSyncedOwner?.() === true,
      });
      if (!committed?.ok) {
        say("Synced Pocket saved the replacement but could not safely show it. Reopen Synced Pocket to continue.");
        return false;
      }
      say("Synced Pocket now uses the selected file’s contents.", "ok");
      return true;
    } catch (_error) {
      say("Synced Pocket could not replace its contents. The selected file is unchanged.");
      return false;
    } finally {
      busy = false;
      refreshInstalled();
    }
  }

  function install() {
    if (!global.document || global.PocketSyncedTruthHandoverInstalled) return false;
    const button = global.document.getElementById("cmdUseSyncedTruth");
    if (!(button instanceof global.HTMLButtonElement)) return false;
    global.PocketSyncedTruthHandoverInstalled = true;
    const refresh = () => {
      const available = isCurrentSyncedOwner(currentSession());
      button.hidden = !available;
      button.disabled = !available || busy;
    };
    button.addEventListener("click", () => { void begin(); });
    global.addEventListener?.("pocket-owner-state-changed", refresh);
    refreshInstalled = refresh;
    refresh();
    return true;
  }

  global.PocketSyncedTruthHandover = Object.freeze({ install, begin, refresh: () => refreshInstalled() });
  if (global.document?.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})(typeof window !== "undefined" ? window : globalThis);
