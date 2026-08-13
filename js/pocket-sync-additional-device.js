/* Explicit, dormant opening of an existing Synced Pocket on another device. */
(function initialisePocketSyncAdditionalDevice(global) {
  "use strict";

  const LIMIT = 2 ** 20;
  const FACTORY = ["crypto", "deviceStore", "accountClient", "discoveryService", "contentService", "envelopeService", "randomBytes", "now"];
  const DEPENDENCIES = ["captureTarget", "isTargetCurrent", "validatePayload", "adoptOpenedPocket"];
  const fail = (reason) => Object.freeze({ ok: false, reason, adopted: false });
  const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const id = (value) => typeof value === "string" && value.length > 0 && value.length <= 160 && value === value.trim();
  const freeze = (value) => Object.freeze(value);

  function validFactory(value) {
    if (!object(value) || Object.keys(value).length !== FACTORY.length
        || FACTORY.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return null;
    const required = {
      crypto: ["generateDeviceWrappingKey", "deriveWrappingKey", "openMasterKeyBundle", "openContent", "sealContent", "encodeBase64Url", "validateNonExtractableAesKey"],
      deviceStore: ["open", "readPocket", "createPocket", "replacePocket"],
      accountClient: ["authenticatePasskey"],
      discoveryService: ["readSyncedPocket"],
      contentService: ["readRevision", "downloadEncryptedRecord"],
      envelopeService: ["listEnvelopes", "downloadEnvelope", "addEnvelope"],
    };
    if (Object.keys(required).some((name) => !object(value[name]) || required[name].some((method) => typeof value[name][method] !== "function"))
        || typeof value.randomBytes !== "function" || typeof value.now !== "function") return null;
    return value;
  }

  function validDependencies(value) {
    if (!object(value) || Object.keys(value).length !== DEPENDENCIES.length
        || DEPENDENCIES.some((key) => typeof value[key] !== "function")) return null;
    return value;
  }

  function randomId(config) {
    try { return config.crypto.encodeBase64Url(config.randomBytes(32)); } catch (_error) { return null; }
  }

  function target(value) {
    if (!object(value) || !["none", "detached"].includes(value.ownerKind)) return null;
    const continuityId = value.continuityId ?? value.id ?? value.sessionId;
    if ((typeof continuityId !== "string" && !Number.isSafeInteger(continuityId)) || String(continuityId).trim() === "") return null;
    return freeze({ ownerKind: value.ownerKind, continuityId: `${value.ownerKind}:${String(continuityId)}` });
  }

  function sameTarget(dependencies, captured) {
    try {
      const current = target(dependencies.captureTarget());
      return !!current && current.ownerKind === captured.ownerKind
        && current.continuityId === captured.continuityId
        && dependencies.isTargetCurrent() === true;
    } catch (_error) { return false; }
  }

  function deviceEnvelope(envelopeId, syncedPocketId, deviceId, record, createdAt) {
    return {
      context: { syncedPocketId, envelopeId, envelopeKind: "device", envelopeVersion: 1 },
      metadata: { contractVersion: 1, syncedPocketId, envelopeId, kind: "device", version: 1, deviceId, createdAt, kdf: "none" },
      record,
    };
  }

  function remoteContent(syncedPocketId, revision, encryptedRecord) {
    return { context: { syncedPocketId, revision, contentType: "pocket.sync.content.opaque" }, record: encryptedRecord };
  }

  async function readCurrent(config, syncedPocketId, operationId, masterKey, dependencies) {
    const revision = await config.contentService.readRevision({ apiVersion: 1, operationId, syncedPocketId });
    if (!revision || revision.recordPresent !== true || !Number.isSafeInteger(revision.revision) || revision.revision < 1) return null;
    const downloadId = randomId(config);
    if (!downloadId) return null;
    const downloaded = await config.contentService.downloadEncryptedRecord({ apiVersion: 1, operationId: downloadId, syncedPocketId, revision: revision.revision });
    if (!downloaded || downloaded.syncedPocketId !== syncedPocketId || downloaded.revision !== revision.revision) return null;
    const content = remoteContent(syncedPocketId, revision.revision, downloaded.encryptedRecord);
    const payload = await config.crypto.openContent(content.record, masterKey, content.context);
    if (dependencies.validatePayload(payload) !== true) return null;
    return { content, revision: revision.revision, payload };
  }

  async function openExisting(dependenciesInput) {
    const config = validFactory(this);
    const dependencies = validDependencies(dependenciesInput);
    if (!config || !dependencies) return fail("additional-device-input-invalid");
    let captured;
    try { captured = target(dependencies.captureTarget()); } catch (_error) { captured = null; }
    if (!captured || !sameTarget(dependencies, captured)) return fail("additional-device-target-invalid");
    let prf = null;
    try {
      const authentication = await config.accountClient.authenticatePasskey({ apiVersion: 1, operationId: randomId(config) });
      if (!authentication || authentication.ok !== true || authentication.accountAuthenticated !== true
          || authentication.contentUnlocked !== false || !id(authentication.accountId) || !id(authentication.credentialId)
          || authentication.prf?.status !== "available" || !(authentication.prf.outputBytes instanceof Uint8Array)
          || authentication.prf.outputBytes.byteLength !== 32) return fail("recovery-required");
      prf = authentication.prf.outputBytes;
      const discovery = await config.discoveryService.readSyncedPocket({ apiVersion: 1, operationId: randomId(config) });
      if (!discovery || discovery.status !== "ready" || !id(discovery.syncedPocketId)) return fail("synced-pocket-not-configured");
      const listed = await config.envelopeService.listEnvelopes({ apiVersion: 1, operationId: randomId(config), syncedPocketId: discovery.syncedPocketId });
      const matches = listed?.envelopes?.filter((item) => item.status === "active" && item.envelopeKind === "passkey-prf" && item.credentialId === authentication.credentialId) || [];
      if (matches.length === 0) return fail("recovery-required");
      if (matches.length !== 1 || !Number.isSafeInteger(listed.keySetVersion) || listed.keySetVersion < 1) return fail("remote-key-state-invalid");
      const selected = matches[0];
      const downloaded = await config.envelopeService.downloadEnvelope({ apiVersion: 1, operationId: randomId(config), syncedPocketId: discovery.syncedPocketId, envelopeId: selected.envelopeId });
      if (!downloaded || downloaded.keySetVersion !== listed.keySetVersion || downloaded.envelope?.envelopeId !== selected.envelopeId
          || downloaded.envelope.envelopeKind !== "passkey-prf" || downloaded.envelope.credentialId !== authentication.credentialId) return fail("remote-key-state-invalid");
      const context = { syncedPocketId: discovery.syncedPocketId, envelopeId: selected.envelopeId, envelopeKind: "passkey-prf", envelopeVersion: selected.envelopeVersion };
      const wrappingKey = await config.crypto.deriveWrappingKey(prf, downloaded.envelope.kdfSalt, context);
      prf.fill(0); prf = null;
      const opened = await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope, wrappingKey, context, []);
      config.crypto.validateNonExtractableAesKey(opened?.masterKey);
      const current = await readCurrent(config, discovery.syncedPocketId, randomId(config), opened.masterKey, dependencies);
      if (!current) return fail("remote-content-invalid");
      await config.deviceStore.open();
      let record = await config.deviceStore.readPocket(discovery.syncedPocketId);
      let draft;
      let envelope;
      if (record !== null) {
        if (record.additionalDeviceDraft === null || record.storeRevision !== 1) return fail("additional-device-state-invalid");
        draft = await config.crypto.openContent(record.additionalDeviceDraft.record,
          record.deviceWrappingKey, record.additionalDeviceDraft.context);
        const metadata = record.deviceEnvelope?.metadata;
        if (!object(draft) || draft.pendingOperation !== "device-envelope"
            || draft.targetOwnerKind !== captured.ownerKind || draft.targetContinuityId !== captured.continuityId
            || !Number.isSafeInteger(draft.expectedKeySetVersion) || draft.expectedKeySetVersion < 1
            || ![draft.attemptId, draft.operationId, draft.logicalChangeId, metadata?.envelopeId, metadata?.deviceId].every(id)
            || draft.attemptId !== draft.operationId || metadata.syncedPocketId !== discovery.syncedPocketId
            || record.usage.masterKeyContentEncryptionLimit !== 0) return fail("additional-device-state-invalid");
        envelope = { envelopeId: metadata.envelopeId, envelopeKind: "device", envelopeVersion: 1,
          deviceId: metadata.deviceId, credentialId: null, kdf: "none", kdfSalt: null,
          derivationVersion: null, encryptedEnvelope: record.deviceEnvelope.record };
      } else {
        const deviceId = randomId(config); const envelopeId = randomId(config);
        const operationId = randomId(config); const logicalChangeId = randomId(config);
        if (![deviceId, envelopeId, operationId, logicalChangeId].every(Boolean)) return fail("local-crypto-failed");
        const deviceKey = await config.crypto.generateDeviceWrappingKey();
        const deviceContext = { syncedPocketId: discovery.syncedPocketId, envelopeId, envelopeKind: "device", envelopeVersion: 1 };
        const rewrapped = await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
          wrappingKey, context, [{ context: deviceContext, wrappingKey: deviceKey }]);
        const createdAt = new Date(config.now()).toISOString();
        draft = { kind: "pocket.sync.additional-device-draft", schemaVersion: 1, attemptId: operationId,
          targetOwnerKind: captured.ownerKind, targetContinuityId: captured.continuityId,
          expectedKeySetVersion: listed.keySetVersion, operationId, logicalChangeId,
          pendingOperation: "device-envelope", createdAt };
        const draftContext = { syncedPocketId: discovery.syncedPocketId, revision: 1,
          contentType: "pocket.sync.content.opaque" };
        const encryptedDraft = await config.crypto.sealContent(draft, deviceKey, draftContext);
        record = { kind: "pocket.sync.device-state", schemaVersion: 5, storeRevision: 1,
          syncedPocketId: discovery.syncedPocketId, deviceId, deviceWrappingKey: deviceKey,
          deviceEnvelope: deviceEnvelope(envelopeId, discovery.syncedPocketId, deviceId,
            rewrapped.envelopes[0].record, createdAt), content: current.content,
          remote: { confirmedRevision: current.revision, pending: null, conflict: null },
          usage: { masterKeyGeneration: 1, masterKeyContentEncryptions: 0,
            masterKeyContentEncryptionLimit: 0, deviceWrappingKeyEncryptions: 1 },
          activationDraft: null, recoveryDraft: null,
          additionalDeviceDraft: { context: draftContext, record: encryptedDraft } };
        await config.deviceStore.createPocket(record);
        envelope = { envelopeId, envelopeKind: "device", envelopeVersion: 1, deviceId,
          credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null,
          encryptedEnvelope: rewrapped.envelopes[0].record };
      }
      const response = await config.envelopeService.addEnvelope({ apiVersion: 1,
        operationId: draft.operationId, logicalChangeId: draft.logicalChangeId,
        attemptKind: "new-change", syncedPocketId: discovery.syncedPocketId,
        expectedKeySetVersion: draft.expectedKeySetVersion, envelope });
      if (!response || response.status === "master-key-rotation-required") return fail("master-key-rotation-required");
      if (response.status !== "committed" || response.keySetVersion !== draft.expectedKeySetVersion + 1 || response.masterKeyGeneration !== 1 || response.masterKeyContentEncryptionLimit !== LIMIT) return fail("key-set-changed");
      const finalRecord = Object.assign({}, record, { storeRevision: record.storeRevision + 1,
        usage: Object.assign({}, record.usage, { masterKeyContentEncryptionLimit: LIMIT }),
        additionalDeviceDraft: null });
      await config.deviceStore.replacePocket(discovery.syncedPocketId, record.storeRevision, finalRecord);
      const latest = await readCurrent(config, discovery.syncedPocketId, randomId(config), opened.masterKey, dependencies);
      if (!latest || !sameTarget(dependencies, captured)) return fail("additional-device-target-stale");
      if (latest.revision !== current.revision) {
        const stored = await config.deviceStore.readPocket(discovery.syncedPocketId);
        const refreshed = Object.assign({}, stored, { storeRevision: stored.storeRevision + 1, content: latest.content, remote: { confirmedRevision: latest.revision, pending: null, conflict: null } });
        await config.deviceStore.replacePocket(discovery.syncedPocketId, stored.storeRevision, refreshed);
      }
      if (dependencies.isTargetCurrent() !== true) return fail("additional-device-target-stale");
      const adopted = await dependencies.adoptOpenedPocket({ syncedPocketId: discovery.syncedPocketId, masterKey: opened.masterKey, payload: latest.payload, confirmedRemoteRevision: latest.revision });
      return adopted === true || adopted?.ok === true ? freeze({ ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: latest.revision }) : fail("owner-adoption-failed");
    } catch (_error) { return fail("additional-device-open-failed"); }
    finally { if (prf instanceof Uint8Array) prf.fill(0); }
  }

  function createAdditionalDeviceOpener(configuration) {
    const config = validFactory(configuration);
    if (!config) throw new Error("Pocket Sync additional device configuration is invalid.");
    return freeze({ openExisting: openExisting.bind(config) });
  }
  global.PocketSyncAdditionalDevice = freeze({ createAdditionalDeviceOpener });
})(typeof window !== "undefined" ? window : globalThis);
