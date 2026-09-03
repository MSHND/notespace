/* Explicit, dormant opening of an existing Synced Pocket on another device. */
(function initialisePocketSyncAdditionalDevice(global) {
  "use strict";

  const LIMIT = 2 ** 20;
  const FACTORY = ["crypto", "deviceStore", "accountClient", "discoveryService", "contentService", "envelopeService", "randomBytes", "now"];
  const AUTHORITY_FACTORY = ["persistenceAuthorityService", "objectHeadService"];
  const DEPENDENCIES = ["captureTarget", "isTargetCurrent", "validatePayload", "adoptOpenedPocket"];
  const ACTIVATION_DRAFT_FIELDS = Object.freeze([
    "kind", "schemaVersion", "activationId", "stage", "sourceOwnerKind",
    "sourceContinuityId", "syncedPocketId", "deviceId", "ids", "content",
    "deviceEnvelope", "prfEnvelope", "prfStatus", "recoveryEnvelope",
    "recoveryVerifier", "recoveryAuthorisation", "recoveryRoot", "recoveryPackage",
    "registrationContinuation", "account", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "accountLocator", "pendingOperation",
    "sourceSaved", "recoveryCopyStored", "adopted", "createdAt", "updatedAt",
  ]);
  const fail = (reason, extra = {}) => Object.freeze(Object.assign({ ok: false, reason, adopted: false }, extra));
  const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const id = (value) => typeof value === "string" && value.length > 0 && value.length <= 160 && value === value.trim();
  const freeze = (value) => Object.freeze(value);

  function validFactory(value) {
    if (!object(value) || Object.keys(value).some((key) => ![...FACTORY, ...AUTHORITY_FACTORY, "strandedActivationClassifier"].includes(key))
        || FACTORY.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return null;
    const authorityCount = AUTHORITY_FACTORY.filter((key) => Object.prototype.hasOwnProperty.call(value, key)).length;
    if (![0, AUTHORITY_FACTORY.length].includes(authorityCount)) return null;
    const required = {
      crypto: ["generateDeviceWrappingKey", "deriveWrappingKey", "openMasterKeyBundle", "openContent", "sealContent", "encodeBase64Url", "validateNonExtractableAesKey"],
      deviceStore: ["open", "readPocket", "createPocket", "replacePocket", "reservePocketEncryptionUsage"],
      accountClient: ["authenticatePasskey"],
      discoveryService: ["readSyncedPocket"],
      contentService: ["readRevision", "downloadEncryptedRecord"],
      envelopeService: ["listEnvelopes", "downloadEnvelope", "addEnvelope"],
    };
    if (Object.keys(required).some((name) => !object(value[name]) || required[name].some((method) => typeof value[name][method] !== "function"))
        || !object(value.crypto.FORMAT) || typeof value.crypto.FORMAT.contentType !== "string"
        || typeof value.randomBytes !== "function" || typeof value.now !== "function"
        || (authorityCount === AUTHORITY_FACTORY.length
          && (!object(value.persistenceAuthorityService)
            || typeof value.persistenceAuthorityService.read !== "function"
            || !object(value.objectHeadService)
            || typeof value.objectHeadService.readShadowHead !== "function"
            || typeof value.objectHeadService.getOpaqueObject !== "function"))
        || (value.strandedActivationClassifier !== undefined
          && (!object(value.strandedActivationClassifier)
            || typeof value.strandedActivationClassifier.classify !== "function"))) return null;
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
    if (!object(value) || !["none", "detached", "json", "vault"].includes(value.ownerKind)) return null;
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

  function remoteContent(config, syncedPocketId, revision, encryptedRecord) {
    return { context: { syncedPocketId, revision, contentType: config.crypto.FORMAT.contentType }, record: encryptedRecord };
  }

  async function readCurrent(config, syncedPocketId, operationId, masterKey, dependencies) {
    const revision = await config.contentService.readRevision({ apiVersion: 1, operationId, syncedPocketId });
    if (!revision || revision.recordPresent !== true || !Number.isSafeInteger(revision.revision) || revision.revision < 1) return null;
    const downloadId = randomId(config);
    if (!downloadId) return null;
    const downloaded = await config.contentService.downloadEncryptedRecord({ apiVersion: 1, operationId: downloadId, syncedPocketId, revision: revision.revision });
    if (!downloaded || downloaded.syncedPocketId !== syncedPocketId || downloaded.revision !== revision.revision) return null;
    const content = remoteContent(config, syncedPocketId, revision.revision, downloaded.encryptedRecord);
    const payload = await config.crypto.openContent(content.record, masterKey, content.context);
    if (dependencies.validatePayload(payload) !== true) return null;
    return { content, revision: revision.revision, payload };
  }

  function authorityMode(value) {
    const authority = value?.authority;
    if (!object(authority) || authority.schema !== "pocket.sync.persistence-authority.v1"
        || !Number.isSafeInteger(authority.authorityRevision) || authority.authorityRevision < 1) return null;
    if (authority.currentMode === "whole-record") {
      if (authority.transition !== null || authority.rollbackRevision !== null || authority.adoptionHead !== null) return null;
      return freeze({ mode: "whole-record", authorityRevision: authority.authorityRevision });
    }
    const head = authority.adoptionHead;
    if (authority.currentMode !== "starling" || authority.transition !== null
        || !Number.isSafeInteger(authority.rollbackRevision) || authority.rollbackRevision < 1
        || !object(head) || head.schema !== "pocket.starling.head.v1"
        || !Number.isSafeInteger(head.revision) || head.revision < 1
        || typeof head.sealRef !== "string" || !head.sealRef) return null;
    return freeze({ mode: "starling", authorityRevision: authority.authorityRevision,
      rollbackRevision: authority.rollbackRevision,
      adoptionHead: freeze({ schema: head.schema, revision: head.revision, sealRef: head.sealRef }) });
  }

  async function readAuthority(config, syncedPocketId) {
    if (!config.persistenceAuthorityService) return freeze({ mode: "legacy" });
    const operationId = randomId(config);
    if (!operationId) return null;
    try {
      return authorityMode(await config.persistenceAuthorityService.read({
        apiVersion: 1, operationId, syncedPocketId,
      }));
    } catch (_error) { return null; }
  }

  async function readRollbackContent(config, syncedPocketId, revision) {
    const operationId = randomId(config);
    if (!operationId) return null;
    try {
      const current = await config.contentService.readRevision({ apiVersion: 1, operationId, syncedPocketId });
      if (!current || current.recordPresent !== true || current.revision !== revision) return null;
      const downloadId = randomId(config);
      if (!downloadId) return null;
      const downloaded = await config.contentService.downloadEncryptedRecord({
        apiVersion: 1, operationId: downloadId, syncedPocketId, revision,
      });
      if (!downloaded || downloaded.syncedPocketId !== syncedPocketId || downloaded.revision !== revision) return null;
      return freeze({ content: remoteContent(config, syncedPocketId, revision, downloaded.encryptedRecord), revision });
    } catch (_error) { return null; }
  }

  function starlingPayload(document) {
    if (!object(document) || typeof document.schema !== "string" || !document.schema
        || typeof document.writtenAt !== "string" || !document.writtenAt
        || !Array.isArray(document.nodes) || !Array.isArray(document.tombstones)
        || !object(document.rootExtras) || !object(document.dataExtras)) return null;
    let nodes; let tombstones; let rootExtras; let dataExtras;
    try {
      nodes = JSON.parse(JSON.stringify(document.nodes));
      tombstones = JSON.parse(JSON.stringify(document.tombstones));
      rootExtras = JSON.parse(JSON.stringify(document.rootExtras));
      dataExtras = JSON.parse(JSON.stringify(document.dataExtras));
    } catch (_error) { return null; }
    return {
      ...rootExtras,
      schema: "portal.export.v1",
      exportedAt: document.writtenAt,
      writtenAt: document.writtenAt,
      mainThoughtTree: nodes,
      mainThoughtTreeTombstones: tombstones,
      data: { ...dataExtras, mainThoughtTree: nodes, mainThoughtTreeTombstones: tombstones },
    };
  }

  async function readStarlingCurrent(config, syncedPocketId, masterKey, semanticAuthority,
    dependencies, authority) {
    const remoteOpen = global.PocketStarlingRemoteOpenShadow;
    const materialize = global.PocketStarlingMaterializeShadow;
    if (!semanticAuthority || !remoteOpen || typeof remoteOpen.createRemoteOpener !== "function"
        || !materialize || typeof materialize.materializeAccepted !== "function") return null;
    let opened;
    try {
      opened = await remoteOpen.createRemoteOpener({
        objectHeadService: config.objectHeadService,
        operationIdFactory: () => randomId(config),
      }).openRemote({ masterKey, context: { syncedPocketId }, semanticAuthority });
    } catch (_error) { return null; }
    if (!opened || opened.outcome !== "opened" || !opened.session
        || !object(opened.head) || opened.head.schema !== "pocket.starling.head.v1"
        || !Number.isSafeInteger(opened.head.revision) || opened.head.revision < 1) return null;
    let materialized;
    try { materialized = await materialize.materializeAccepted(opened.session); }
    catch (_error) { return null; }
    const payload = materialized?.ok === true ? starlingPayload(materialized.document) : null;
    if (!payload || dependencies.validatePayload(payload) !== true) return null;
    const rollback = await readRollbackContent(config, syncedPocketId, authority.rollbackRevision);
    if (!rollback) return null;
    return freeze({ kind: "starling", payload, content: rollback.content,
      revision: rollback.revision, head: opened.head, authorityRevision: authority.authorityRevision });
  }

  async function selectCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies) {
    const authority = await readAuthority(config, syncedPocketId);
    if (!authority) return null;
    if (authority.mode === "legacy") {
      const current = await readCurrent(config, syncedPocketId, randomId(config), masterKey, dependencies);
      return current ? freeze({ kind: "whole-record", ...current }) : null;
    }
    if (authority.mode === "starling") {
      return readStarlingCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies, authority);
    }
    if (authority.mode !== "whole-record") return null;
    const current = await readCurrent(config, syncedPocketId, randomId(config), masterKey, dependencies);
    if (!current) return null;
    const after = await readAuthority(config, syncedPocketId);
    if (!after) return null;
    if (after.mode === "starling") {
      return readStarlingCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies, after);
    }
    if (after.mode !== "whole-record" || after.authorityRevision !== authority.authorityRevision) return null;
    return freeze({ kind: "whole-record", ...current });
  }

  async function completedActivationDraft(config, record) {
    if (record.activationDraft === null) return true;
    let draft;
    try {
      draft = await config.crypto.openContent(record.activationDraft.record,
        record.deviceWrappingKey, record.activationDraft.context);
    } catch (_error) { return false; }
    return object(draft) && Object.keys(draft).length === ACTIVATION_DRAFT_FIELDS.length
      && ACTIVATION_DRAFT_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(draft, field))
      && draft.kind === "pocket.sync.activation-draft" && draft.schemaVersion === 1
      && id(draft.activationId) && ["json", "vault"].includes(draft.sourceOwnerKind)
      && id(draft.sourceContinuityId) && draft.syncedPocketId === record.syncedPocketId
      && draft.deviceId === record.deviceId && draft.stage === "adopted"
      && draft.adopted === true && draft.sourceSaved === true && draft.recoveryCopyStored === true
      && draft.pendingOperation === null && draft.recoveryRoot === null
      && draft.recoveryPackage === null && draft.registrationContinuation === null
      && object(draft.ids) && Object.keys(draft.ids).length === 12 && Object.values(draft.ids).every(id)
      && object(draft.account) && id(draft.account.accountId) && id(draft.account.credentialId)
      && Number.isSafeInteger(draft.account.credentialVersion) && draft.account.credentialVersion >= 1
      && Number.isSafeInteger(draft.account.accountPolicyVersion) && draft.account.accountPolicyVersion >= 1
      && object(draft.content)
      && draft.content.context?.syncedPocketId === record.syncedPocketId
      && draft.content.context?.revision === 1
      && Number.isSafeInteger(draft.confirmedRemoteRevision)
      && draft.confirmedRemoteRevision === 1 && record.remote.confirmedRevision >= 1
      && Number.isSafeInteger(draft.keySetVersion) && draft.keySetVersion >= 2
      && draft.recoveryVersion === 1 && id(draft.accountLocator);
  }

  async function strandedActivationDraft(config, record, syncedPocketId) {
    if (!record || record.kind !== "pocket.sync.device-state" || record.schemaVersion !== 5
        || record.syncedPocketId !== syncedPocketId || !id(record.deviceId)
        || record.activationDraft === null || record.additionalDeviceDraft !== null
        || record.recoveryDraft !== null || record.remote?.confirmedRevision !== 0
        || record.remote?.conflict !== null
        || typeof config.strandedActivationClassifier?.classify !== "function") {
      return false;
    }
    let draft;
    try {
      draft = await config.crypto.openContent(record.activationDraft.record,
        record.deviceWrappingKey, record.activationDraft.context);
    } catch (_error) { return false; }
    try {
      return config.strandedActivationClassifier.classify(draft, {
        syncedPocketId, deviceId: record.deviceId,
      }) === "exact-stranded";
    } catch (_error) { return false; }
  }

  async function completedDeviceRecord(config, record, syncedPocketId) {
    const metadata = record?.deviceEnvelope?.metadata;
    const context = record?.deviceEnvelope?.context;
    const structurallyCompleted = !!record && record.kind === "pocket.sync.device-state" && record.schemaVersion === 5
      && record.syncedPocketId === syncedPocketId && id(record.deviceId)
      && Number.isSafeInteger(record.storeRevision) && record.storeRevision >= 1
      && record.additionalDeviceDraft === null && record.recoveryDraft === null
      && record.usage?.masterKeyGeneration === 1
      && Number.isSafeInteger(record.usage?.masterKeyContentEncryptions)
      && record.usage.masterKeyContentEncryptions >= 0
      && record.usage.masterKeyContentEncryptions <= LIMIT
      && record.usage.masterKeyContentEncryptionLimit === LIMIT
      && record.remote?.pending === null && record.remote?.conflict === null
      && Number.isSafeInteger(record.remote?.confirmedRevision) && record.remote.confirmedRevision >= 1
      && record.content?.context?.syncedPocketId === syncedPocketId
      && record.content.context.revision === record.remote.confirmedRevision
      && record.content.context.contentType === "portal.export.v1+json"
      && metadata?.syncedPocketId === syncedPocketId && metadata.deviceId === record.deviceId
      && metadata.kind === "device" && metadata.version === 1 && metadata.kdf === "none"
      && id(metadata.envelopeId) && context?.syncedPocketId === syncedPocketId
      && context.envelopeId === metadata.envelopeId && context.envelopeKind === "device"
      && context.envelopeVersion === 1;
    return structurallyCompleted && completedActivationDraft(config, record);
  }

  async function nextActivationDraft(config, current, storeRevision) {
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

  function listedDeviceEnvelope(record, listed) {
    const metadata = record.deviceEnvelope.metadata;
    const matches = listed?.envelopes?.filter((item) => item.status === "active"
      && item.envelopeKind === "device" && item.envelopeId === metadata.envelopeId) || [];
    return matches.length === 1 && matches[0].envelopeVersion === metadata.version
      && matches[0].deviceId === record.deviceId && matches[0].credentialId === null
      && matches[0].kdf === metadata.kdf && matches[0].kdfSalt === null
      && matches[0].derivationVersion === null;
  }

  async function adoptOpened(config, dependencies, captured, syncedPocketId, record, masterKey, semanticAuthority = null) {
    const latest = await selectCurrent(config, syncedPocketId, masterKey, semanticAuthority, dependencies);
    if (!latest || !sameTarget(dependencies, captured)) return fail("additional-device-target-stale");
    if (latest.kind === "starling" && latest.revision !== record.remote.confirmedRevision) {
      return fail("additional-device-state-invalid");
    }
    if (latest.kind === "whole-record" && latest.revision !== record.remote.confirmedRevision) {
      const stored = await config.deviceStore.readPocket(syncedPocketId);
      if (!(await completedDeviceRecord(config, stored, syncedPocketId))) return fail("additional-device-state-invalid");
      const current = stored.activationDraft === null ? stored : await config.deviceStore.reservePocketEncryptionUsage(
        syncedPocketId,
        stored.storeRevision,
        stored.usage,
        { masterKeyContentEncryptions: 0, deviceWrappingKeyEncryptions: 1 }
      );
      const refreshed = Object.assign({}, current, { storeRevision: current.storeRevision + 1,
        content: latest.content, remote: { confirmedRevision: latest.revision, pending: null, conflict: null } });
      refreshed.activationDraft = await nextActivationDraft(config, current, refreshed.storeRevision);
      record = await config.deviceStore.replacePocket(syncedPocketId, current.storeRevision, refreshed);
    }
    if (dependencies.isTargetCurrent() !== true) return fail("additional-device-target-stale");
    const adopted = await dependencies.adoptOpenedPocket({ syncedPocketId, masterKey, payload: latest.payload,
      confirmedRemoteRevision: latest.revision, target: captured });
    if (adopted === true || adopted?.ok === true) {
      return freeze({ ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: latest.revision });
    }
    if (["additional-device-target-stale", "additional-device-target-dirty"].includes(adopted?.reason)) {
      return fail(adopted.reason);
    }
    return adopted?.partialState === "visible-payload-committed-detached"
      ? fail("owner-adoption-failed", { partialState: adopted.partialState })
      : fail("owner-adoption-failed");
  }

  async function openCompletedDevice(config, dependencies, captured, syncedPocketId, record) {
    if (!(await completedDeviceRecord(config, record, syncedPocketId))) return fail("additional-device-state-invalid");
    const listed = await config.envelopeService.listEnvelopes({ apiVersion: 1,
      operationId: randomId(config), syncedPocketId });
    if (!Number.isSafeInteger(listed?.keySetVersion) || listed.keySetVersion < 1
        || !listedDeviceEnvelope(record, listed)) return fail("remote-device-state-invalid");
    let bundle;
    try {
      bundle = config.persistenceAuthorityService
        ? await config.crypto.openMasterKeyBundle(record.deviceEnvelope.record,
          record.deviceWrappingKey, record.deviceEnvelope.context, [], { semanticAuthority: true })
        : await config.crypto.openMasterKeyBundle(record.deviceEnvelope.record,
          record.deviceWrappingKey, record.deviceEnvelope.context, []);
      config.crypto.validateNonExtractableAesKey(bundle?.masterKey);
    } catch (_error) { return fail("additional-device-open-failed"); }
    return adoptOpened(config, dependencies, captured, syncedPocketId, record,
      bundle.masterKey, bundle.semanticAuthority || null);
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
      let authentication = await config.accountClient.authenticatePasskey({ apiVersion: 1, operationId: randomId(config) });
      if (authentication?.bootstrap === true) {
        if (authentication.ok !== true || authentication.accountAuthenticated !== true
            || authentication.contentUnlocked !== false || !id(authentication.accountId)
            || !id(authentication.credentialId)) return fail("additional-device-open-failed");
        const bootstrapAccountId = authentication.accountId;
        authentication = await config.accountClient.authenticatePasskey({ apiVersion: 1, operationId: randomId(config) });
        if (authentication?.accountId !== bootstrapAccountId) {
          return fail("additional-device-open-failed");
        }
      }
      if (!authentication || authentication.ok !== true || authentication.accountAuthenticated !== true
          || authentication.contentUnlocked !== false || !id(authentication.accountId) || !id(authentication.credentialId)) {
        return fail("additional-device-open-failed");
      }
      const discovery = await config.discoveryService.readSyncedPocket({ apiVersion: 1, operationId: randomId(config) });
      if (!discovery || discovery.status !== "ready" || !id(discovery.syncedPocketId)) return fail("synced-pocket-not-configured");
      await config.deviceStore.open();
      let record;
      try { record = await config.deviceStore.readPocket(discovery.syncedPocketId); }
      catch (_error) { return fail("additional-device-state-invalid"); }
      if (record && record.additionalDeviceDraft === null) {
        if (await strandedActivationDraft(config, record, discovery.syncedPocketId)) {
          return fail("local-activation-attention", { sourceOwnerPreserved: true });
        }
        return await openCompletedDevice(config, dependencies, captured, discovery.syncedPocketId, record);
      }
      if (authentication.prf?.status !== "available" || !(authentication.prf.outputBytes instanceof Uint8Array)
          || authentication.prf.outputBytes.byteLength !== 32) return fail("recovery-required");
      prf = authentication.prf.outputBytes;
      const listed = await config.envelopeService.listEnvelopes({ apiVersion: 1, operationId: randomId(config), syncedPocketId: discovery.syncedPocketId });
      const matches = listed?.envelopes?.filter((item) => item.status === "active" && item.envelopeKind === "passkey-prf" && item.credentialId === authentication.credentialId) || [];
      if (matches.length === 0) return fail("recovery-required");
      if (matches.length !== 1 || !Number.isSafeInteger(listed.keySetVersion) || listed.keySetVersion < 1) return fail("remote-key-state-invalid");
      const selected = matches[0];
      const downloaded = await config.envelopeService.downloadEnvelope({ apiVersion: 1, operationId: randomId(config), syncedPocketId: discovery.syncedPocketId, envelopeId: selected.envelopeId });
      if (!downloaded || downloaded.keySetVersion !== listed.keySetVersion || downloaded.envelope?.envelopeId !== selected.envelopeId
          || downloaded.envelope.envelopeKind !== "passkey-prf" || downloaded.envelope.credentialId !== authentication.credentialId
          || downloaded.envelope.envelopeVersion !== selected.envelopeVersion
          || downloaded.envelope.deviceId !== selected.deviceId || downloaded.envelope.kdf !== selected.kdf
          || downloaded.envelope.kdfSalt !== selected.kdfSalt
          || downloaded.envelope.derivationVersion !== selected.derivationVersion) return fail("remote-key-state-invalid");
      const context = { syncedPocketId: discovery.syncedPocketId, envelopeId: selected.envelopeId, envelopeKind: "passkey-prf", envelopeVersion: selected.envelopeVersion };
      let opened;
      let wrappingKey;
      try {
        wrappingKey = await config.crypto.deriveWrappingKey(prf, downloaded.envelope.kdfSalt, context);
      } catch (_error) { return fail("additional-device-open-failed"); }
      prf.fill(0); prf = null;
      try {
        opened = config.persistenceAuthorityService
          ? await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
            wrappingKey, context, [], { semanticAuthority: true })
          : await config.crypto.openMasterKeyBundle(downloaded.envelope.encryptedEnvelope,
            wrappingKey, context, []);
      } catch (error) {
        return error?.code === "master-key-envelope-authentication-failed"
          ? fail("recovery-required") : fail("additional-device-open-failed");
      }
      try { config.crypto.validateNonExtractableAesKey(opened?.masterKey); }
      catch (_error) { return fail("additional-device-open-failed"); }
      const current = await selectCurrent(config, discovery.syncedPocketId, opened.masterKey,
        opened.semanticAuthority || null, dependencies);
      if (!current) return fail("remote-content-invalid");
      let draft;
      let envelope;
      let resuming = false;
      if (record) {
        resuming = true;
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
          contentType: config.crypto.FORMAT.contentType };
        const encryptedDraft = await config.crypto.sealContent(draft, deviceKey, draftContext);
        record = { kind: "pocket.sync.device-state", schemaVersion: 5, storeRevision: 1,
          syncedPocketId: discovery.syncedPocketId, deviceId, deviceWrappingKey: deviceKey,
          deviceEnvelope: deviceEnvelope(envelopeId, discovery.syncedPocketId, deviceId,
            rewrapped.envelopes[0].record, createdAt), content: current.content,
          remote: { confirmedRevision: current.revision, pending: null, conflict: null },
          usage: { masterKeyGeneration: 1, masterKeyContentEncryptions: 0,
            masterKeyContentEncryptionLimit: 0, deviceWrappingKeyEncryptions: 2 },
          activationDraft: null, recoveryDraft: null,
          additionalDeviceDraft: { context: draftContext, record: encryptedDraft } };
        await config.deviceStore.createPocket(record);
        envelope = { envelopeId, envelopeKind: "device", envelopeVersion: 1, deviceId,
          credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null,
          encryptedEnvelope: rewrapped.envelopes[0].record };
      }
      const response = await config.envelopeService.addEnvelope({ apiVersion: 1,
        operationId: draft.operationId, logicalChangeId: draft.logicalChangeId,
        attemptKind: resuming ? "idempotent-retry" : "new-change",
        syncedPocketId: discovery.syncedPocketId,
        expectedKeySetVersion: draft.expectedKeySetVersion, envelope });
      if (!response || response.status === "master-key-rotation-required") return fail("master-key-rotation-required");
      if (response.status !== "committed" || response.keySetVersion !== draft.expectedKeySetVersion + 1 || response.masterKeyGeneration !== 1 || response.masterKeyContentEncryptionLimit !== LIMIT) return fail("key-set-changed");
      const finalRecord = Object.assign({}, record, { storeRevision: record.storeRevision + 1,
        usage: Object.assign({}, record.usage, { masterKeyContentEncryptionLimit: LIMIT }),
        additionalDeviceDraft: null });
      await config.deviceStore.replacePocket(discovery.syncedPocketId, record.storeRevision, finalRecord);
      const durableBundle = config.persistenceAuthorityService
        ? await config.crypto.openMasterKeyBundle(
          finalRecord.deviceEnvelope.record,
          finalRecord.deviceWrappingKey,
          finalRecord.deviceEnvelope.context,
          [],
          { semanticAuthority: true }
        )
        : await config.crypto.openMasterKeyBundle(
          finalRecord.deviceEnvelope.record,
          finalRecord.deviceWrappingKey,
          finalRecord.deviceEnvelope.context,
          []
        );
      config.crypto.validateNonExtractableAesKey(durableBundle?.masterKey);
      const latest = await selectCurrent(config, discovery.syncedPocketId, durableBundle.masterKey,
        durableBundle.semanticAuthority || null, dependencies);
      if (!latest || !sameTarget(dependencies, captured)) return fail("additional-device-target-stale");
      if (latest.kind === "starling" && latest.revision !== current.revision) {
        return fail("additional-device-state-invalid");
      }
      if (latest.kind === "whole-record" && latest.revision !== current.revision) {
        const stored = await config.deviceStore.readPocket(discovery.syncedPocketId);
        const refreshed = Object.assign({}, stored, { storeRevision: stored.storeRevision + 1, content: latest.content, remote: { confirmedRevision: latest.revision, pending: null, conflict: null } });
        await config.deviceStore.replacePocket(discovery.syncedPocketId, stored.storeRevision, refreshed);
      }
      if (dependencies.isTargetCurrent() !== true) return fail("additional-device-target-stale");
      const adopted = await dependencies.adoptOpenedPocket({ syncedPocketId: discovery.syncedPocketId,
        masterKey: durableBundle.masterKey, payload: latest.payload,
        confirmedRemoteRevision: latest.revision, target: captured });
      if (adopted === true || adopted?.ok === true) {
        return freeze({ ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: latest.revision });
      }
      if (["additional-device-target-stale", "additional-device-target-dirty"].includes(adopted?.reason)) {
        return fail(adopted.reason);
      }
      return adopted?.partialState === "visible-payload-committed-detached"
        ? fail("owner-adoption-failed", { partialState: adopted.partialState })
        : fail("owner-adoption-failed");
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
