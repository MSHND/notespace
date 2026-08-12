/* Synced Pocket dormant owner and explicit Save controller.

This module is dormant until a later explicit owner-adoption flow supplies a
controller. It owns one in-memory synced target and uses the existing encrypted
device record for explicit, conditional Saves.
*/

(function initialisePocketSyncOwnerController(global) {
  "use strict";

  const OWNER_INPUT_FIELDS = Object.freeze(["syncedPocketId", "masterKey"]);
  const ACTIVATION_OWNER_FIELDS = Object.freeze([
    "ownerKind", "activationId", "syncedPocketId", "deviceId",
    "confirmedRemoteRevision", "syncPending",
  ]);
  const ACTIVATION_DRAFT_FIELDS = Object.freeze([
    "kind", "schemaVersion", "activationId", "stage", "sourceOwnerKind",
    "sourceContinuityId", "syncedPocketId", "deviceId", "ids", "content",
    "deviceEnvelope", "prfEnvelope", "prfStatus", "recoveryEnvelope",
    "recoveryVerifier", "recoveryRoot", "recoveryPackage",
    "registrationContinuation", "account", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "accountLocator", "pendingOperation",
    "sourceSaved", "recoveryCopyStored", "adopted", "createdAt", "updatedAt",
  ]);
  const SAVE_INPUT_FIELDS = Object.freeze(["freezePayload"]);
  const RECOVERY_DEPENDENCY_FIELDS = Object.freeze([
    "captureRecoveryTarget", "isRecoveryTargetCurrent",
  ]);
  const RECOVERY_TARGET_OWNERS = Object.freeze(["none", "detached"]);

  function controllerError(code) {
    const error = new Error(`Pocket Sync owner controller ${code}.`);
    error.code = code;
    return error;
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exactObject(value, fields, code) {
    if (!isObject(value) || Object.keys(value).length !== fields.length
        || !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
      throw controllerError(code);
    }
    return value;
  }

  function identifier(value, code) {
    if (typeof value !== "string" || value.length < 1 || value.length > 160
        || value !== value.trim()) throw controllerError(code);
    return value;
  }

  function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (isObject(value)) {
      const copy = {};
      Object.keys(value).forEach((field) => { copy[field] = freeze(value[field]); });
      return Object.freeze(copy);
    }
    return value;
  }

  function result(reason, extra) {
    return freeze(Object.assign({ ok: false, reason }, extra || {}));
  }

  function validateFactory(input) {
    const config = exactObject(input, ["crypto", "deviceStore", "contentService", "randomBytes"],
      "owner-controller-factory-invalid");
    const crypto = config.crypto;
    if (!isObject(crypto) || ["sealContent", "openContent", "openMasterKeyBundle", "encodeBase64Url",
      "validateNonExtractableAesKey"].some((name) => typeof crypto[name] !== "function")
        || !isObject(crypto.FORMAT) || typeof crypto.FORMAT.contentType !== "string") {
      throw controllerError("owner-controller-crypto-invalid");
    }
    if (!isObject(config.deviceStore) || ["readPocket", "readRecoveryAttempt", "replacePocket"]
      .some((name) => typeof config.deviceStore[name] !== "function")) {
      throw controllerError("owner-controller-device-store-invalid");
    }
    if (!isObject(config.contentService)
        || typeof config.contentService.conditionalUpload !== "function"
        || typeof config.randomBytes !== "function") {
      throw controllerError("owner-controller-factory-invalid");
    }
    return config;
  }

  function validateRecoveryDependencies(input) {
    const dependencies = exactObject(input, RECOVERY_DEPENDENCY_FIELDS,
      "recovery-adoption-dependencies-invalid");
    if (RECOVERY_DEPENDENCY_FIELDS.some((name) => typeof dependencies[name] !== "function")) {
      throw controllerError("recovery-adoption-dependencies-invalid");
    }
    return dependencies;
  }

  function targetIdentity(target) {
    if (!isObject(target) || !RECOVERY_TARGET_OWNERS.includes(target.ownerKind)) {
      throw controllerError("recovery-target-invalid");
    }
    const candidate = target.continuityId ?? target.sessionId ?? target.id;
    if ((typeof candidate !== "string" && !Number.isSafeInteger(candidate))
        || String(candidate).trim().length === 0 || String(candidate).length > 160) {
      throw controllerError("recovery-target-invalid");
    }
    return Object.freeze({
      ownerKind: target.ownerKind,
      continuityId: `${target.ownerKind}:${String(candidate)}`,
    });
  }

  function recoveryCandidate(input) {
    if (!isObject(input) || input.ok !== true || input.readyForAdoption !== true
        || input.adopted !== false || input.locallyDurable !== true
        || input.remotelyCommitted !== true || input.replacementRecoveryCopyStored !== true
        || input.syncPending !== false || input.reason !== "recovery-ready"
        || !Number.isSafeInteger(input.confirmedRemoteRevision)
        || input.confirmedRemoteRevision < 1) {
      throw controllerError("recovery-not-eligible");
    }
    return Object.freeze({
      recoveryAttemptId: identifier(input.recoveryAttemptId, "recovery-not-eligible"),
      confirmedRemoteRevision: input.confirmedRemoteRevision,
    });
  }

  function activationOwner(input) {
    const value = exactObject(input, ACTIVATION_OWNER_FIELDS, "activation-not-eligible");
    if (value.ownerKind !== "synced"
        || value.confirmedRemoteRevision !== 1
        || value.syncPending !== false) {
      throw controllerError("activation-not-eligible");
    }
    return Object.freeze({
      activationId: identifier(value.activationId, "activation-not-eligible"),
      syncedPocketId: identifier(value.syncedPocketId, "activation-not-eligible"),
      deviceId: identifier(value.deviceId, "activation-not-eligible"),
    });
  }

  function activationRecordIsReady(found, requested) {
    const record = found?.record;
    const draft = found?.draft;
    if (!isObject(draft) || Object.keys(draft).length !== ACTIVATION_DRAFT_FIELDS.length
        || !ACTIVATION_DRAFT_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(draft, field))) {
      return false;
    }
    if (!record || !draft || record.kind !== "pocket.sync.device-state"
        || record.syncedPocketId !== requested.syncedPocketId
        || record.deviceId !== requested.deviceId
        || record.remote?.confirmedRevision !== 1
        || record.remote?.pending !== null || record.remote?.conflict !== null
        || draft.activationId !== requested.activationId
        || draft.syncedPocketId !== requested.syncedPocketId
        || draft.deviceId !== requested.deviceId
        || draft.stage !== "ready-for-adoption"
        || draft.adopted !== false
        || draft.sourceSaved !== true
        || draft.recoveryCopyStored !== true
        || draft.confirmedRemoteRevision !== 1
        || draft.pendingOperation !== null
        || draft.kind !== "pocket.sync.activation-draft"
        || draft.schemaVersion !== 1
        || !["json", "vault"].includes(draft.sourceOwnerKind)
        || typeof draft.sourceContinuityId !== "string" || draft.sourceContinuityId.length < 1
        || !Number.isSafeInteger(draft.keySetVersion) || draft.keySetVersion < 2
        || draft.recoveryVersion !== 1 || typeof draft.accountLocator !== "string"
        || draft.accountLocator.length < 1 || draft.recoveryRoot !== null
        || draft.recoveryPackage !== null || draft.registrationContinuation !== null
        || !isObject(draft.account) || !isObject(draft.content)
        || draft.content.context?.syncedPocketId !== requested.syncedPocketId
        || draft.content.context?.revision !== 1) return false;
    return true;
  }

  function ownerSnapshot(owner) {
    if (!owner) return null;
    return freeze({
      syncedPocketId: owner.syncedPocketId,
      confirmedRemoteRevision: owner.record.remote.confirmedRevision,
      knownRemoteRevision: owner.knownRemoteRevision,
      pending: owner.record.remote.pending !== null,
      generation: owner.generation,
    });
  }

  function increment(value, code) {
    if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
      throw controllerError(code);
    }
    return value + 1;
  }

  function classifyRemoteError(error) {
    if (error?.outcome === "definite-failure" || error?.definite === true) {
      return "remote-failed";
    }
    // A rejected transport does not prove whether its conditional write arrived.
    return "remote-outcome-unknown";
  }

  function createSyncedOwnerController(configuration) {
    const config = validateFactory(configuration);
    let generation = 0;
    let owner = null;

    function advanceGeneration() {
      generation = increment(generation, "owner-generation-exhausted");
      return generation;
    }

    function installOwner(record, masterKey) {
      const nextGeneration = advanceGeneration();
      owner = {
        token: Object.freeze({ generation: nextGeneration }),
        generation: nextGeneration,
        syncedPocketId: record.syncedPocketId,
        record,
        masterKey,
        knownRemoteRevision: record.remote.confirmedRevision,
      };
      return ownerSnapshot(owner);
    }

    function captureSyncedOwnerSaveSession() {
      if (!owner) return null;
      return Object.freeze({
        token: owner.token,
        generation: owner.generation,
        syncedPocketId: owner.syncedPocketId,
      });
    }

    function isSyncedOwnerSaveSessionCurrent(session) {
      return !!owner && isObject(session) && session.token === owner.token
        && session.generation === owner.generation
        && session.syncedPocketId === owner.syncedPocketId;
    }

    function releaseSyncedOwner() {
      advanceGeneration();
      owner = null;
      return true;
    }

    async function refreshOwnerRecord(session, capturedOwner) {
      let stored;
      try { stored = await config.deviceStore.readPocket(capturedOwner.syncedPocketId); }
      catch (_error) { return false; }
      if (!isSyncedOwnerSaveSessionCurrent(session)) return false;
      if (!stored || stored.syncedPocketId !== capturedOwner.syncedPocketId) return false;
      if (stored.storeRevision === capturedOwner.record.storeRevision) return true;
      if (stored.remote?.confirmedRevision !== capturedOwner.record.remote.confirmedRevision
          || stored.remote?.pending !== null || stored.remote?.conflict !== null
          || stored.content?.context?.revision !== capturedOwner.record.content.context.revision) {
        return false;
      }
      try {
        await config.crypto.openContent(
          stored.content.record,
          capturedOwner.masterKey,
          stored.content.context
        );
      } catch (_error) { return false; }
      if (!isSyncedOwnerSaveSessionCurrent(session)) return false;
      owner.record = stored;
      owner.knownRemoteRevision = stored.remote.confirmedRevision;
      return true;
    }

    async function adoptSyncedOwner(input) {
      let requested;
      try {
        requested = exactObject(input, OWNER_INPUT_FIELDS, "owner-adoption-input-invalid");
        identifier(requested.syncedPocketId, "owner-adoption-input-invalid");
        config.crypto.validateNonExtractableAesKey(requested.masterKey);
      } catch (_error) {
        return result("owner-adoption-invalid");
      }
      let record;
      try { record = await config.deviceStore.readPocket(requested.syncedPocketId); }
      catch (_error) { return result("owner-adoption-state-unavailable"); }
      if (!record || record.syncedPocketId !== requested.syncedPocketId) {
        return result("owner-adoption-state-invalid");
      }
      try {
        await config.crypto.openContent(record.content.record, requested.masterKey, record.content.context);
      } catch (_error) { return result("owner-adoption-state-invalid"); }
      return freeze({ ok: true, owner: installOwner(record, requested.masterKey) });
    }

    async function adoptReadyRecovery(input, dependenciesInput) {
      let candidate;
      let dependencies;
      try {
        candidate = recoveryCandidate(input);
        dependencies = validateRecoveryDependencies(dependenciesInput);
      } catch (error) { return result(error.code || "recovery-not-eligible"); }

      let found;
      try { found = await config.deviceStore.readRecoveryAttempt(candidate.recoveryAttemptId); }
      catch (_error) { return result("recovery-state-unavailable"); }
      if (!found || !found.record || !found.draft || found.record.kind !== "pocket.sync.device-state"
          || found.draft.stage !== "ready-for-adoption"
          || found.draft.recoveryAttemptId !== candidate.recoveryAttemptId
          || found.draft.syncedPocketId !== found.record.syncedPocketId
          || found.record.remote.confirmedRevision !== candidate.confirmedRemoteRevision) {
        return result("recovery-not-eligible");
      }

      let capturedTarget;
      try {
        capturedTarget = dependencies.captureRecoveryTarget();
        const identity = targetIdentity(capturedTarget);
        if (identity.ownerKind !== found.draft.targetOwnerKind
            || identity.continuityId !== found.draft.targetContinuityId
            || dependencies.isRecoveryTargetCurrent(capturedTarget) !== true) {
          return result("recovery-target-stale");
        }
      } catch (_error) { return result("recovery-target-stale"); }

      let bundle;
      try {
        bundle = await config.crypto.openMasterKeyBundle(
          found.record.deviceEnvelope.record,
          found.record.deviceWrappingKey,
          found.record.deviceEnvelope.context,
          []
        );
        config.crypto.validateNonExtractableAesKey(bundle?.masterKey);
      } catch (_error) { return result("recovery-state-invalid"); }

      // Recheck at the ownership boundary: P041 recovery must not adopt a moved target.
      try {
        if (dependencies.isRecoveryTargetCurrent(capturedTarget) !== true) {
          return result("recovery-target-stale");
        }
      } catch (_error) { return result("recovery-target-stale"); }
      return freeze({ ok: true, owner: installOwner(found.record, bundle.masterKey), recoveryAttemptId: candidate.recoveryAttemptId });
    }

    async function adoptReadyActivation(input) {
      let requested;
      try { requested = activationOwner(input); }
      catch (_error) { return result("activation-not-eligible"); }
      if (typeof config.deviceStore.readActivation !== "function") {
        return result("activation-state-unavailable");
      }
      let found;
      try { found = await config.deviceStore.readActivation(requested.activationId); }
      catch (_error) { return result("activation-state-unavailable"); }
      if (!activationRecordIsReady(found, requested)) return result("activation-not-eligible");

      let bundle;
      try {
        bundle = await config.crypto.openMasterKeyBundle(
          found.record.deviceEnvelope.record,
          found.record.deviceWrappingKey,
          found.record.deviceEnvelope.context,
          []
        );
        config.crypto.validateNonExtractableAesKey(bundle?.masterKey);
        await config.crypto.openContent(
          found.record.content.record,
          bundle.masterKey,
          found.record.content.context
        );
      } catch (_error) { return result("activation-state-invalid"); }
      return freeze({ ok: true, owner: installOwner(found.record, bundle.masterKey) });
    }

    async function nextRecoveryDraft(current, storeRevision) {
      if (current.recoveryDraft === null) return null;
      const draft = await config.crypto.openContent(
        current.recoveryDraft.record,
        current.deviceWrappingKey,
        current.recoveryDraft.context
      );
      const context = {
        syncedPocketId: current.syncedPocketId,
        revision: storeRevision,
        contentType: config.crypto.FORMAT.contentType,
      };
      return {
        context,
        record: await config.crypto.sealContent(draft, current.deviceWrappingKey, context),
      };
    }

    async function nextActivationDraft(current, storeRevision) {
      if (current.activationDraft === null) return null;
      const draft = await config.crypto.openContent(
        current.activationDraft.record,
        current.deviceWrappingKey,
        current.activationDraft.context
      );
      const context = {
        syncedPocketId: current.syncedPocketId,
        revision: storeRevision,
        contentType: config.crypto.FORMAT.contentType,
      };
      return {
        context,
        record: await config.crypto.sealContent(draft, current.deviceWrappingKey, context),
      };
    }

    async function nextRecord(current, content, remote, masterKeyContentEncryptions) {
      const storeRevision = increment(current.storeRevision, "device-store-revision-exhausted");
      return {
        kind: current.kind,
        schemaVersion: current.schemaVersion,
        storeRevision,
        syncedPocketId: current.syncedPocketId,
        deviceId: current.deviceId,
        deviceWrappingKey: current.deviceWrappingKey,
        deviceEnvelope: current.deviceEnvelope,
        content,
        remote,
        usage: {
          masterKeyGeneration: current.usage.masterKeyGeneration,
          masterKeyContentEncryptions,
          deviceWrappingKeyEncryptions: current.usage.deviceWrappingKeyEncryptions
            + (current.activationDraft === null ? 0 : 1)
            + (current.recoveryDraft === null ? 0 : 1),
        },
        activationDraft: await nextActivationDraft(current, storeRevision),
        recoveryDraft: await nextRecoveryDraft(current, storeRevision),
      };
    }

    async function replaceOwnerRecord(session, previous, next) {
      const stored = await config.deviceStore.replacePocket(
        previous.syncedPocketId, previous.storeRevision, next
      );
      if (isSyncedOwnerSaveSessionCurrent(session)) owner.record = stored;
      return stored;
    }

    function freshId() {
      let bytes;
      try { bytes = config.randomBytes(32); }
      catch (_error) { throw controllerError("save-id-generation-failed"); }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
        throw controllerError("save-id-generation-failed");
      }
      try { return config.crypto.encodeBase64Url(new Uint8Array(bytes)); }
      catch (_error) { throw controllerError("save-id-generation-failed"); }
      finally { bytes.fill(0); }
    }

    async function saveSyncedOwner(input) {
      let save;
      try {
        save = exactObject(input, SAVE_INPUT_FIELDS, "synced-save-input-invalid");
        if (typeof save.freezePayload !== "function") throw controllerError("synced-save-input-invalid");
      } catch (_error) { return result("save-input-invalid"); }

      const session = captureSyncedOwnerSaveSession();
      if (!session) return result("no-synced-owner");
      const capturedOwner = owner;
      if (!await refreshOwnerRecord(session, capturedOwner)) {
        return isSyncedOwnerSaveSessionCurrent(session)
          ? result("owner-state-unavailable") : result("stale-owner-session");
      }
      let encryptedRecord;
      let content;
      let pending;
      const retryingPending = capturedOwner.record.remote.pending !== null;
      if (retryingPending) {
        if (capturedOwner.record.remote.conflict !== null) return result("revision-conflict", { conflict: true });
        pending = Object.assign({}, capturedOwner.record.remote.pending, { attemptKind: "idempotent-retry" });
        encryptedRecord = capturedOwner.record.content.record;
        content = capturedOwner.record.content;
      } else {
        let payload;
        try { payload = await save.freezePayload(); }
        catch (_error) { return result("payload-freeze-failed"); }
        try {
          const expectedRevision = capturedOwner.record.remote.confirmedRevision;
          const contentContext = {
            syncedPocketId: capturedOwner.syncedPocketId,
            revision: increment(expectedRevision, "remote-revision-exhausted"),
            contentType: config.crypto.FORMAT.contentType,
          };
          encryptedRecord = await config.crypto.sealContent(payload, capturedOwner.masterKey, contentContext);
          content = { context: contentContext, record: encryptedRecord };
          pending = {
            expectedRevision,
            operationId: freshId(),
            logicalChangeId: freshId(),
            attemptKind: "new-change",
          };
        } catch (_error) { return result("payload-encryption-failed"); }
      }

      let pendingRecord;
      try { pendingRecord = await nextRecord(
        capturedOwner.record,
        content,
        { confirmedRevision: pending.expectedRevision, pending, conflict: null },
        retryingPending
          ? capturedOwner.record.usage.masterKeyContentEncryptions
          : increment(capturedOwner.record.usage.masterKeyContentEncryptions, "content-encryption-limit-reached")
      ); } catch (_error) { return result("pending-persistence-failed"); }
      try { await replaceOwnerRecord(session, capturedOwner.record, pendingRecord); }
      catch (_error) {
        return isSyncedOwnerSaveSessionCurrent(session)
          ? result("pending-persistence-failed") : result("stale-owner-session");
      }
      // The encrypted pending record is durable before a remote mutation is attempted.
      if (!isSyncedOwnerSaveSessionCurrent(session)) return result("stale-owner-session");

      let response;
      try {
        response = await config.contentService.conditionalUpload({
          apiVersion: 1,
          syncedPocketId: capturedOwner.syncedPocketId,
          expectedRevision: pending.expectedRevision,
          operationId: pending.operationId,
          logicalChangeId: pending.logicalChangeId,
          attemptKind: pending.attemptKind,
          encryptedRecord,
        });
      } catch (error) {
        if (!isSyncedOwnerSaveSessionCurrent(session)) return result("stale-owner-session");
        return result(classifyRemoteError(error));
      }
      if (!isSyncedOwnerSaveSessionCurrent(session)) return result("stale-owner-session");

      if (response?.conflict === true) {
        if (!Number.isSafeInteger(response.actualRevision)
            || response.actualRevision <= pending.expectedRevision) {
          return result("remote-outcome-unknown");
        }
        let conflictRecord;
        try { conflictRecord = await nextRecord(owner.record, owner.record.content, {
          confirmedRevision: owner.record.remote.confirmedRevision,
          pending: owner.record.remote.pending,
          conflict: { actualRevision: response.actualRevision, operationId: pending.operationId },
        }, owner.record.usage.masterKeyContentEncryptions); } catch (_error) {
          return result("revision-conflict", { conflict: true });
        }
        try { await replaceOwnerRecord(session, owner.record, conflictRecord); }
        catch (_error) {}
        if (!isSyncedOwnerSaveSessionCurrent(session)) return result("stale-owner-session");
        return result("revision-conflict", { conflict: true });
      }
      if (response?.status !== "committed" || response.wrote !== true
          || response.operationId !== pending.operationId
          || response.revision !== pending.expectedRevision + 1) {
        // An unconfirmed response is not safe to replay automatically.
        return result("remote-outcome-unknown");
      }

      owner.knownRemoteRevision = response.revision;
      let confirmedRecord;
      try { confirmedRecord = await nextRecord(owner.record, owner.record.content, {
        confirmedRevision: response.revision,
        pending: null,
        conflict: null,
      }, owner.record.usage.masterKeyContentEncryptions); } catch (_error) {
        return result("remote-success-local-confirmation-failed", { knownRemoteRevision: response.revision });
      }
      try { await replaceOwnerRecord(session, owner.record, confirmedRecord); }
      catch (_error) {
        return isSyncedOwnerSaveSessionCurrent(session)
          ? result("remote-success-local-confirmation-failed", { knownRemoteRevision: response.revision })
          : result("stale-owner-session");
      }
      if (!isSyncedOwnerSaveSessionCurrent(session)) return result("stale-owner-session");
      return freeze({ ok: true, reason: retryingPending ? "pending-reconciled" : "saved",
        confirmedRemoteRevision: response.revision });
    }

    return Object.freeze({
      adoptSyncedOwner,
      adoptReadyActivation,
      adoptReadyRecovery,
      releaseSyncedOwner,
      captureSyncedOwnerSaveSession,
      isSyncedOwnerSaveSessionCurrent,
      getSyncedOwnerState: () => ownerSnapshot(owner),
      saveSyncedOwner,
    });
  }

  global.PocketSyncOwnerController = Object.freeze({ createSyncedOwnerController });
})(typeof window !== "undefined" ? window : globalThis);
