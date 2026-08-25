/* Same-origin Sync composition. Local HTTPS and production bootstraps load this module. */

(function initialisePocketSyncLocalIntegration(global) {
  "use strict";

  function frozen(value) {
    return Object.freeze(value);
  }

  function safeFailure(reason) {
    return frozen({ ok: false, reason });
  }

  function currentServiceRoot() {
    const script = global.document?.currentScript;
    const root = script?.dataset?.serviceRoot;
    if (typeof root !== "string" || !root.startsWith("/") || root.startsWith("//")
        || root.includes("\\") || root.includes("?") || root.includes("#")) return null;
    return root;
  }

  const configuredServiceRoot = currentServiceRoot();

  function operationId() {
    const crypto = global.crypto;
    const encoder = global.PocketSyncCrypto?.encodeBase64Url;
    if (!crypto || typeof crypto.getRandomValues !== "function" || typeof encoder !== "function") return null;
    try { return encoder(crypto.getRandomValues(new Uint8Array(32))); }
    catch (_error) { return null; }
  }

  function currentPayload() {
    if (typeof global.buildPocketPayload !== "function") return null;
    try { return global.buildPocketPayload(new Date(0).toISOString()); }
    catch (_error) { return null; }
  }

  function recordFingerprint(value) {
    const fingerprint = global.PocketDeviceChanges?.fingerprintDocument;
    if (typeof fingerprint !== "function") return "";
    try { return fingerprint(value); }
    catch (_error) { return ""; }
  }

  function create() {
    const serviceRoot = configuredServiceRoot;
    const remote = global.PocketSyncRemoteClient;
    const browser = global.PocketSyncBrowserRuntime;
    if (!serviceRoot || !remote || !browser
        || typeof remote.createBrowserJsonTransport !== "function"
      || typeof remote.createAccountService !== "function"
        || typeof remote.createContentService !== "function"
        || typeof remote.createEnvelopeService !== "function"
        || typeof remote.createRecoveryService !== "function"
        || typeof browser.createRuntime !== "function") {
      throw new Error("Pocket Sync local integration foundation unavailable.");
    }
    const transport = remote.createBrowserJsonTransport({ serviceRoot });
    const contentService = remote.createContentService({ transport });
    const runtime = browser.createRuntime({
      accountService: remote.createAccountService({ transport }),
      ...(typeof remote.createPocketDiscoveryService === "function"
        ? { discoveryService: remote.createPocketDiscoveryService({ transport }) } : {}),
      contentService,
      envelopeService: remote.createEnvelopeService({ transport }),
      recoveryService: remote.createRecoveryService({ transport }),
    });
    let syncedPocketId = null;

    function remember(result) {
      if (result?.ok === true && result.owner?.ownerKind === "synced"
          && typeof result.owner.syncedPocketId === "string") {
        syncedPocketId = result.owner.syncedPocketId;
      }
      return result;
    }

    async function activate() {
      try { return remember(await runtime.activate()); }
      catch (_error) { return safeFailure("activation-unavailable"); }
    }

    async function resume(input) {
      try { return remember(await runtime.resume(input)); }
      catch (_error) { return safeFailure("activation-unavailable"); }
    }

    async function openExisting(input) {
      try { return remember(await runtime.openExisting(input)); }
      catch (_error) { return safeFailure("additional-device-unavailable"); }
    }

    function captureSwitchTarget() {
      try { return global.PocketSyncedSwitchGate?.capture?.() || null; }
      catch (_error) { return null; }
    }

    async function saveSwitchTarget(target) {
      try { return await global.PocketSyncedSwitchGate?.save?.(target) || safeFailure("save-unavailable"); }
      catch (_error) { return safeFailure("save-failed"); }
    }

    function discardSwitchTarget(target) {
      try { return global.PocketSyncedSwitchGate?.discardPermit?.(target) || null; }
      catch (_error) { return null; }
    }

    async function recoverExisting() {
      try { return remember(await runtime.recoverExisting()); }
      catch (_error) { return safeFailure("recovery-unavailable"); }
    }

    async function resumeRecovery(input) {
      try { return remember(await runtime.resumeRecovery(input)); }
      catch (_error) { return safeFailure("recovery-unavailable"); }
    }

    async function findRecoveryAttempt() {
      try { return await runtime.findRecoveryAttempt(); }
      catch (_error) { return safeFailure("recovery-discovery-needs-attention"); }
    }

    async function verifyRoundTrip() {
      if (!syncedPocketId) return safeFailure("sync-not-activated");
      try {
        if (global.hasPocketUnsavedChanges?.() === true) return safeFailure("source-has-unsaved-changes");
        const store = global.PocketSyncDeviceStore;
        const crypto = global.PocketSyncCrypto;
        if (!store || !crypto || typeof store.open !== "function" || typeof store.readStoredRecord !== "function"
            || typeof crypto.openMasterKeyBundle !== "function" || typeof crypto.openContent !== "function") {
          return safeFailure("round-trip-unavailable");
        }
        const savedPayload = currentPayload();
        const savedFingerprint = recordFingerprint(savedPayload);
        if (!savedPayload || !savedFingerprint) return safeFailure("round-trip-unavailable");
        await store.open();
        const localRecord = await store.readStoredRecord(syncedPocketId);
        if (!localRecord || localRecord.remote?.pending !== null || localRecord.remote?.conflict !== null) {
          return safeFailure("round-trip-not-ready");
        }
        const revisionOperation = operationId();
        if (!revisionOperation) return safeFailure("round-trip-unavailable");
        const revision = await contentService.readRevision({
          apiVersion: 1, operationId: revisionOperation, syncedPocketId,
        });
        if (!revision || revision.recordPresent !== true || !Number.isSafeInteger(revision.revision)
            || revision.revision < 1) return safeFailure("round-trip-not-ready");
        const downloadOperation = operationId();
        if (!downloadOperation) return safeFailure("round-trip-unavailable");
        const remote = await contentService.downloadEncryptedRecord({
          apiVersion: 1, operationId: downloadOperation, syncedPocketId, revision: revision.revision,
        });
        const bundle = await crypto.openMasterKeyBundle(
          localRecord.deviceEnvelope.record,
          localRecord.deviceWrappingKey,
          localRecord.deviceEnvelope.context
        );
        let decrypted = null;
        try {
          decrypted = await crypto.openContent(remote.encryptedRecord, bundle.masterKey, {
            syncedPocketId,
            revision: revision.revision,
            contentType: crypto.FORMAT.contentType,
          });
          if (recordFingerprint(decrypted) !== savedFingerprint) return safeFailure("round-trip-mismatch");
          return frozen({ ok: true, revision: revision.revision, matchesCurrentSavedPocket: true });
        } finally {
          decrypted = null;
        }
      } catch (_error) {
        return safeFailure("round-trip-unavailable");
      }
    }

    const integration = frozen({
      activate, resume, openExisting, captureSwitchTarget, saveSwitchTarget, discardSwitchTarget,
      recoverExisting, resumeRecovery, findRecoveryAttempt, verifyRoundTrip,
    });
    try { global.PocketSyncUi?.install?.(integration); } catch (_error) {}
    return integration;
  }

  const integrationApi = frozen({ create });
  global.PocketSyncBrowserIntegration = integrationApi;
  global.PocketSyncLocalIntegration = integrationApi;
})(typeof window !== "undefined" ? window : globalThis);
