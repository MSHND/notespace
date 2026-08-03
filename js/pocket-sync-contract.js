/* Synced Pocket foundation.

This module is intentionally not loaded by index.html. It defines the future
ownership and Save orchestration contract without selecting a backend, storage
surface, account system or content-key mechanism.
*/

(function initialisePocketSyncContract(global) {
  "use strict";

  const COPY = Object.freeze({
    turnOnSync: Object.freeze({
      title: "Turn on sync",
      body: "Keep your Pocket available on your other devices. Your synced data will be protected so only you can read it.",
    }),
    syncReady: Object.freeze({
      title: "Sync is ready",
      body: "Your Pocket is protected and available on your devices.",
    }),
    status: Object.freeze({
      synced: "Saved · Synced",
      pending: "Saved on this device · Sync pending",
      conflict: "Pocket found newer changes from another device.",
    }),
  });

  function plainJsonNotice(displayName) {
    const filename = String(displayName || "").trim().slice(0, 160);
    if (!filename) throw new TypeError("A displayed filename is required.");
    return Object.freeze({
      title: "Your original file will stay where it is",
      body: `${filename} is readable and will not be changed or deleted. After sync is working, you can decide whether to keep or remove it.`,
    });
  }

  function validRevision(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function validSyncedPocketId(value) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 160;
  }

  function failure(reason, extra = {}) {
    return Object.freeze({
      ok: false,
      reason,
      adopted: false,
      sourceOwnerPreserved: true,
      ...extra,
    });
  }

  function requiredFunction(dependencies, name) {
    const candidate = dependencies && dependencies[name];
    if (typeof candidate !== "function") {
      throw new TypeError(`Missing sync dependency: ${name}`);
    }
    return candidate;
  }

  function encryptedRecordFrom(sealed) {
    if (!sealed || typeof sealed !== "object" || Array.isArray(sealed)) return null;
    const record = sealed.encryptedRecord;
    return record && typeof record === "object" && !Array.isArray(record) ? record : null;
  }

  async function activate(dependencies, options = {}) {
    const syncedPocketId = String(options.syncedPocketId || "").trim();
    const expectedRemoteRevision = options.expectedRemoteRevision ?? 0;
    if (!validSyncedPocketId(syncedPocketId)) return failure("invalid-synced-pocket-id");
    if (!validRevision(expectedRemoteRevision)) return failure("invalid-remote-revision");

    let stage = "source-validation";
    let sourceSession;
    try {
      const captureSourceSession = requiredFunction(dependencies, "captureSourceSession");
      const isSourceSessionCurrent = requiredFunction(dependencies, "isSourceSessionCurrent");
      sourceSession = captureSourceSession();
      if (!sourceSession || !["json", "vault"].includes(sourceSession.ownerKind)) {
        return failure("unsupported-source-owner");
      }
      const sourceIsCurrent = () => isSourceSessionCurrent(sourceSession) === true;
      if (!sourceIsCurrent()) return failure("source-session-changed");

      const hasUnsavedSourceChanges = requiredFunction(dependencies, "hasUnsavedSourceChanges");
      if (hasUnsavedSourceChanges(sourceSession) === true) {
        stage = "source-save";
        const sourceSave = await requiredFunction(dependencies, "saveLocalSource")(sourceSession);
        if (!sourceIsCurrent()) return failure("source-session-changed");
        if (!sourceSave || sourceSave.ok !== true) {
          return failure(sourceSave && sourceSave.cancelled === true
            ? "source-save-cancelled"
            : "source-save-failed");
        }
      }

      if (!sourceIsCurrent()) return failure("source-session-changed");
      stage = "payload-freeze";
      const payload = await requiredFunction(dependencies, "freezePayload")(sourceSession);
      if (!sourceIsCurrent()) return failure("source-session-changed");

      stage = "local-seal";
      const sealed = await requiredFunction(dependencies, "sealPayload")(payload, { syncedPocketId });
      const encryptedRecord = encryptedRecordFrom(sealed);
      if (!encryptedRecord) return failure("seal-failed");
      if (!sourceIsCurrent()) return failure("source-session-changed");

      stage = "device-persistence";
      const deviceWrite = await requiredFunction(dependencies, "writeEncryptedDeviceRecord")({
        syncedPocketId,
        encryptedRecord,
        confirmedRemoteRevision: expectedRemoteRevision,
        syncPending: true,
      });
      if (!deviceWrite || deviceWrite.ok !== true) return failure("device-save-failed");
      if (!sourceIsCurrent()) return failure("source-session-changed");

      stage = "remote-read";
      const remoteState = await requiredFunction(dependencies, "readRemoteState")({ syncedPocketId });
      if (!remoteState || remoteState.ok !== true) return failure("initial-remote-unavailable");
      if (!validRevision(remoteState.revision)) return failure("invalid-remote-state");
      if (remoteState.revision !== expectedRemoteRevision) {
        return failure("newer-remote", {
          locallySaved: true,
          conflict: true,
          status: COPY.status.conflict,
        });
      }
      if (!sourceIsCurrent()) return failure("source-session-changed");

      stage = "remote-write";
      const remoteWrite = await requiredFunction(dependencies, "conditionalWriteRemote")({
        syncedPocketId,
        expectedRevision: expectedRemoteRevision,
        encryptedRecord,
      });
      if (!remoteWrite || remoteWrite.ok !== true) {
        return failure(remoteWrite && remoteWrite.conflict === true
          ? "newer-remote"
          : "initial-remote-write-failed", {
          locallySaved: true,
          conflict: remoteWrite && remoteWrite.conflict === true,
          status: remoteWrite && remoteWrite.conflict === true ? COPY.status.conflict : "",
        });
      }
      if (!validRevision(remoteWrite.revision)
          || remoteWrite.revision !== expectedRemoteRevision + 1) {
        return failure("invalid-remote-state");
      }
      if (!sourceIsCurrent()) return failure("source-session-changed");

      stage = "synced-owner-adoption";
      const owner = Object.freeze({
        ownerKind: "synced",
        syncedPocketId,
        confirmedRemoteRevision: remoteWrite.revision,
        syncPending: false,
      });
      const adopted = await requiredFunction(dependencies, "adoptSyncedOwner")(owner);
      if (!(adopted === true || (adopted && adopted.ok === true))) {
        return failure("synced-owner-adoption-failed", { locallySaved: true, remotelySynced: true });
      }
      return Object.freeze({
        ok: true,
        reason: "activated",
        adopted: true,
        sourceOwnerPreserved: false,
        locallySaved: true,
        remotelySynced: true,
        syncPending: false,
        confirmedRemoteRevision: remoteWrite.revision,
        owner,
        status: COPY.status.synced,
      });
    } catch (_error) {
      return failure(`${stage}-failed`);
    }
  }

  function pendingSaveResult(state, encryptedRecord, reason = "sync-pending") {
    return Object.freeze({
      ok: true,
      reason,
      locallySaved: true,
      remotelySynced: false,
      syncPending: true,
      conflict: false,
      confirmedRemoteRevision: state.confirmedRemoteRevision,
      pendingEncryptedRecord: encryptedRecord,
      status: COPY.status.pending,
    });
  }

  function conflictSaveResult(state, encryptedRecord, actualRemoteRevision) {
    return Object.freeze({
      ok: false,
      reason: "newer-remote",
      locallySaved: true,
      remotelySynced: false,
      syncPending: true,
      conflict: true,
      confirmedRemoteRevision: state.confirmedRemoteRevision,
      actualRemoteRevision: validRevision(actualRemoteRevision) ? actualRemoteRevision : null,
      pendingEncryptedRecord: encryptedRecord,
      status: COPY.status.conflict,
    });
  }

  async function save(dependencies, state, options = {}) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return failure("invalid-synced-state", { sourceOwnerPreserved: false });
    }
    const syncedPocketId = String(state.syncedPocketId || "").trim();
    if (state.ownerKind !== "synced"
        || !validSyncedPocketId(syncedPocketId)
        || !validRevision(state.confirmedRemoteRevision)) {
      return failure("invalid-synced-state", { sourceOwnerPreserved: false });
    }

    let encryptedRecord = null;
    const reusePending = options.hasNewChanges === false
      && state.pendingEncryptedRecord
      && typeof state.pendingEncryptedRecord === "object"
      && !Array.isArray(state.pendingEncryptedRecord);
    try {
      if (reusePending) {
        encryptedRecord = state.pendingEncryptedRecord;
      } else {
        const payload = await requiredFunction(dependencies, "freezePayload")();
        const sealed = await requiredFunction(dependencies, "sealPayload")(payload, { syncedPocketId });
        encryptedRecord = encryptedRecordFrom(sealed);
        if (!encryptedRecord) {
          return failure("seal-failed", {
            sourceOwnerPreserved: false,
            locallySaved: false,
            remainsDirty: true,
          });
        }
      }

      const deviceWrite = await requiredFunction(dependencies, "writeEncryptedDeviceRecord")({
        syncedPocketId,
        encryptedRecord,
        confirmedRemoteRevision: state.confirmedRemoteRevision,
        syncPending: true,
      });
      if (!deviceWrite || deviceWrite.ok !== true) {
        return failure("device-save-failed", {
          sourceOwnerPreserved: false,
          locallySaved: false,
          remotelySynced: false,
          syncPending: !!state.pendingEncryptedRecord,
          pendingEncryptedRecord: state.pendingEncryptedRecord || null,
          confirmedRemoteRevision: state.confirmedRemoteRevision,
          remainsDirty: true,
        });
      }

      let remoteState;
      try {
        remoteState = await requiredFunction(dependencies, "readRemoteState")({ syncedPocketId });
      } catch (_error) {
        return pendingSaveResult(state, encryptedRecord);
      }
      if (!remoteState || remoteState.ok !== true) {
        return pendingSaveResult(state, encryptedRecord);
      }
      if (!validRevision(remoteState.revision)) {
        return pendingSaveResult(state, encryptedRecord, "invalid-remote-state");
      }
      if (remoteState.revision !== state.confirmedRemoteRevision) {
        return conflictSaveResult(state, encryptedRecord, remoteState.revision);
      }

      let remoteWrite;
      try {
        remoteWrite = await requiredFunction(dependencies, "conditionalWriteRemote")({
          syncedPocketId,
          expectedRevision: state.confirmedRemoteRevision,
          encryptedRecord,
        });
      } catch (_error) {
        return pendingSaveResult(state, encryptedRecord);
      }
      if (!remoteWrite || remoteWrite.ok !== true) {
        return remoteWrite && remoteWrite.conflict === true
          ? conflictSaveResult(state, encryptedRecord, remoteWrite.actualRevision)
          : pendingSaveResult(state, encryptedRecord);
      }
      if (!validRevision(remoteWrite.revision)
          || remoteWrite.revision !== state.confirmedRemoteRevision + 1) {
        return pendingSaveResult(state, encryptedRecord, "invalid-remote-state");
      }
      return Object.freeze({
        ok: true,
        reason: "synced",
        locallySaved: true,
        remotelySynced: true,
        syncPending: false,
        conflict: false,
        confirmedRemoteRevision: remoteWrite.revision,
        pendingEncryptedRecord: null,
        status: COPY.status.synced,
      });
    } catch (_error) {
      return failure("sync-save-failed", {
        sourceOwnerPreserved: false,
        locallySaved: false,
        remainsDirty: true,
      });
    }
  }

  function retryPending(dependencies, state) {
    if (!state || !state.pendingEncryptedRecord) {
      return Promise.resolve(failure("no-pending-sync", { sourceOwnerPreserved: false }));
    }
    return save(dependencies, state, { hasNewChanges: false });
  }

  global.PocketSyncContract = Object.freeze({
    COPY,
    plainJsonNotice,
    activate,
    save,
    retryPending,
  });
})(typeof window !== "undefined" ? window : globalThis);
