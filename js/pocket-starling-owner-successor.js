/* P164 rollback-safe post-bootstrap Starling successor mirror.

This wrapper keeps the existing whole-record Synced controller as the only live
Save owner. For one eligible explicit Save it durably records the exact P160
working set, prepares one physical Starling successor from the proved P162 base,
lets the whole-record Save become authoritative first, and only then attempts
one Head transition. Starling failures never turn a confirmed whole-record Save
into a user-facing failure.
*/
(function initialisePocketStarlingOwnerSuccessor(global) {
  "use strict";

  const baseOwnerApi = global.PocketSyncOwnerController;
  if (!baseOwnerApi || typeof baseOwnerApi.createSyncedOwnerController !== "function") return;

  const STATE_SCHEMA = "pocket.starling.owner-mirror-state.v1";
  const AUTHORITY_STATE_SCHEMA = "pocket.starling.owner-authority-state.v3";
  const LEGACY_AUTHORITY_STATE_SCHEMA = "pocket.starling.owner-authority-state.v2";
  const SWITCH_SCHEMA = "pocket.starling.authority-switch.v1";
  const SAVE_SCHEMA = "pocket.starling.authoritative-save.v1";
  const MIGRATION_SCHEMA = "pocket.starling.owner-migration.v1";
  const HEAD_SCHEMA = "pocket.starling.head.v1";
  const DELETE_RECEIPT_SCHEMA = "pocket.starling.accepted-delete-receipt.v1";
  const SWITCH_PHASES = Object.freeze(["prepared", "fenced", "commit-ambiguous"]);
  const SAVE_PHASES = Object.freeze(["captured", "prepared", "objects-present", "cas-ambiguous", "conflict"]);
  const PHASES = Object.freeze([
    "captured", "prepared", "objects-present", "cas-ambiguous", "conflict",
  ]);
  const BASE_FACTORY_FIELDS = Object.freeze([
    "crypto", "deviceStore", "contentService", "randomBytes", "starlingBootstrap",
  ]);
  const OPTIONAL_SUCCESSOR_FIELD = "starlingSuccessor";

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exact(value, fields) {
    return isObject(value) && Object.keys(value).length === fields.length
      && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (isObject(value)) {
      const copy = {};
      for (const key of Object.keys(value)) copy[key] = freeze(value[key]);
      return Object.freeze(copy);
    }
    return value;
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_error) { return null; }
  }

  function failure(reason) {
    return Object.freeze({ ok: false, reason });
  }

  function safeHead(value) {
    const head = global.PocketStarlingHeadShadow;
    return head && typeof head.validHead === "function" && head.validHead(value)
      ? Object.freeze({ schema: value.schema, revision: value.revision, sealRef: value.sealRef })
      : null;
  }

  function sameHead(left, right) {
    return !!left && !!right && left.schema === right.schema
      && left.revision === right.revision && left.sealRef === right.sealRef;
  }

  function currentScriptServiceRoot() {
    const value = global.document?.currentScript?.dataset?.serviceRoot;
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
      && !value.includes("\\") && !value.includes("?") && !value.includes("#")
      ? value : null;
  }

  function randomOperationId(kind, index) {
    const crypto = global.crypto;
    const encode = global.PocketSyncCrypto?.encodeBase64Url;
    if (!crypto || typeof crypto.getRandomValues !== "function" || typeof encode !== "function") {
      throw new Error("Pocket Starling successor operation-id-unavailable.");
    }
    const bytes = new Uint8Array(18);
    try {
      crypto.getRandomValues(bytes);
      return `p164-${String(kind).slice(0, 48)}-${index}-${encode(bytes)}`;
    } finally { bytes.fill(0); }
  }

  function defaultRemoteOptions() {
    const serviceRoot = currentScriptServiceRoot();
    const remote = global.PocketSyncRemoteClient;
    if (!serviceRoot || !remote || typeof remote.createBrowserJsonTransport !== "function"
        || typeof remote.createObjectHeadService !== "function"
        || typeof remote.createPersistenceAuthorityService !== "function"
        || typeof global.normaliseInput !== "function"
        || typeof global.normaliseRootExtras !== "function") return null;
    try {
      const transport = remote.createBrowserJsonTransport({ serviceRoot });
      return Object.freeze({
        objectHeadService: remote.createObjectHeadService({ transport }),
        persistenceAuthorityService: remote.createPersistenceAuthorityService({ transport }),
        operationIdFactory: randomOperationId,
        normaliseInput: global.normaliseInput,
        normaliseRootExtras: global.normaliseRootExtras,
      });
    } catch (_error) { return null; }
  }

  const productionRemoteOptions = defaultRemoteOptions();

  function checkedOptions(configuration, successorInput) {
    const bootstrap = isObject(configuration?.starlingBootstrap)
      ? configuration.starlingBootstrap : productionRemoteOptions;
    const successor = successorInput === undefined ? null : successorInput;
    if (successor !== null && (!exact(successor, ["ownerStateStore"])
        || !isObject(successor.ownerStateStore))) return null;
    const ownerStateStore = successor?.ownerStateStore || global.PocketStarlingOwnerState;
    if (!isObject(bootstrap) || !isObject(bootstrap.objectHeadService)
        || ["putOpaqueObject", "getOpaqueObject", "objectPresence", "readShadowHead",
          "compareAndSetShadowHead"].some((name) => typeof bootstrap.objectHeadService[name] !== "function")
        || typeof bootstrap.operationIdFactory !== "function"
        || typeof bootstrap.normaliseInput !== "function"
        || typeof bootstrap.normaliseRootExtras !== "function"
        || !ownerStateStore || ["open", "read", "write"].some((name) => typeof ownerStateStore[name] !== "function")) {
      return null;
    }
    const persistenceAuthorityService = isObject(bootstrap.persistenceAuthorityService)
      && ["read", "acquireFence", "commitStarlingAdoption", "releaseFence"]
        .every((name) => typeof bootstrap.persistenceAuthorityService[name] === "function")
      ? bootstrap.persistenceAuthorityService : null;
    return Object.freeze({
      objectHeadService: bootstrap.objectHeadService,
      persistenceAuthorityService,
      operationIdFactory: bootstrap.operationIdFactory,
      normaliseInput: bootstrap.normaliseInput,
      normaliseRootExtras: bootstrap.normaliseRootExtras,
      ownerStateStore,
    });
  }

  function splitConfiguration(input) {
    if (!isObject(input)) return { base: input, successor: undefined };
    const allowed = new Set([...BASE_FACTORY_FIELDS, OPTIONAL_SUCCESSOR_FIELD]);
    if (Object.keys(input).some((field) => !allowed.has(field))) {
      return { base: input, successor: undefined };
    }
    const base = {};
    for (const field of BASE_FACTORY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, field)) base[field] = input[field];
    }
    return { base, successor: input[OPTIONAL_SUCCESSOR_FIELD] };
  }

  function validatePreparation(value) {
    if (!exact(value, ["ceiling", "operations", "preservationProjection"])
        || !Number.isSafeInteger(value.ceiling) || value.ceiling < 1
        || !Array.isArray(value.operations) || !isObject(value.preservationProjection)) return null;
    const copied = clone(value);
    return copied ? freeze(copied) : null;
  }

  function resolvePreparation(payload) {
    const resolver = global.currentPocketStarlingOwnerSavePreparation;
    if (typeof resolver !== "function") return null;
    try { return validatePreparation(resolver(payload)); }
    catch (_error) { return null; }
  }

  function resolvePostBootstrapSaveWitness(payload, authority) {
  const resolver = global.PocketStarlingRealTruthAdmission?.currentPostBootstrapSaveWitness;
  if (typeof resolver !== "function") return null;
  let value;
  try { value = resolver(payload); }
  catch (_error) { return null; }
  const head = safeHead(value?.head);
  if (!exact(value, ["syncedPocketId", "authorityRevision", "sourceRevision", "head"])
      || typeof value.syncedPocketId !== "string" || !value.syncedPocketId
      || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 1
      || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1
      || value.authorityRevision !== authority?.authorityRevision || !head) return null;
  return freeze({ syncedPocketId: value.syncedPocketId,
    authorityRevision: value.authorityRevision, sourceRevision: value.sourceRevision, head });
}

  function resolveDeleteContinuity(preparation) {
    const resolver = global.currentPocketStarlingAcceptedDeleteContinuity;
    if (typeof resolver !== "function") return null;
    try { return validateDeleteContinuity(resolver(preparation)); }
    catch (_error) { return null; }
  }

  function validateAccepted(value) {
    if (!exact(value, ["sourceRevision", "head"])
        || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1) return null;
    const head = safeHead(value.head);
    return head && head.revision >= 1 ? freeze({ sourceRevision: value.sourceRevision, head }) : null;
  }

  function validateMigration(value) {
    if (value === null) return null;
    if (!exact(value, [
      "schema", "sourceRevision", "targetRevision", "ceiling", "operations",
      "preservationProjection", "expectedHead", "targetFingerprint", "descriptor",
      "phase", "casMayHaveRun",
    ]) || value.schema !== MIGRATION_SCHEMA
        || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1
        || value.targetRevision !== value.sourceRevision + 1
        || !Number.isSafeInteger(value.ceiling) || value.ceiling < 1
        || !Array.isArray(value.operations) || !isObject(value.preservationProjection)
        || typeof value.targetFingerprint !== "string" || !/^sha256:[A-Za-z0-9_-]{43}$/.test(value.targetFingerprint)
        || !PHASES.includes(value.phase) || typeof value.casMayHaveRun !== "boolean") return null;
    const expectedHead = safeHead(value.expectedHead);
    if (!expectedHead || expectedHead.revision < 1) return null;
    let descriptor = null;
    if (value.descriptor !== null) {
      try { descriptor = global.PocketStarlingDurablePublication?.validateDescriptor?.(value.descriptor); }
      catch (_error) { return null; }
      if (!descriptor || descriptor.syncedPocketId.length < 1
          || !sameHead(descriptor.expectedHead, expectedHead)) return null;
    }
    if (value.phase !== "captured" && !descriptor) return null;
    return freeze({
      schema: MIGRATION_SCHEMA,
      sourceRevision: value.sourceRevision,
      targetRevision: value.targetRevision,
      ceiling: value.ceiling,
      operations: clone(value.operations),
      preservationProjection: clone(value.preservationProjection),
      expectedHead,
      targetFingerprint: value.targetFingerprint,
      descriptor,
      phase: value.phase,
      casMayHaveRun: value.casMayHaveRun,
    });
  }

  function validateMirrorPlainState(value, ownerRecord) {
    if (!exact(value, ["schema", "owner", "accepted", "migration"])
        || value.schema !== STATE_SCHEMA || !exact(value.owner, [
          "syncedPocketId", "deviceId", "masterKeyGeneration",
        ]) || value.owner.syncedPocketId !== ownerRecord.syncedPocketId
        || value.owner.deviceId !== ownerRecord.deviceId
        || value.owner.masterKeyGeneration !== ownerRecord.usage?.masterKeyGeneration) return null;
    const accepted = validateAccepted(value.accepted);
    if (!accepted) return null;
    const migration = validateMigration(value.migration);
    if (value.migration !== null && !migration) return null;
    if (migration && (migration.sourceRevision !== accepted.sourceRevision
        || !sameHead(migration.expectedHead, accepted.head))) return null;
    return freeze({
      schema: STATE_SCHEMA,
      owner: {
        syncedPocketId: ownerRecord.syncedPocketId,
        deviceId: ownerRecord.deviceId,
        masterKeyGeneration: ownerRecord.usage.masterKeyGeneration,
      },
      accepted,
      migration,
    });
  }

  function validateAuthoritySnapshot(value) {
    if (!exact(value, ["schema", "authorityRevision", "currentMode", "transition",
      "rollbackRevision", "adoptionHead"])
        || value.schema !== "pocket.sync.persistence-authority.v1"
        || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 1
        || !["whole-record", "starling"].includes(value.currentMode)) return null;
    let transition = null;
    let rollbackRevision = null;
    let adoptionHead = null;
    if (value.currentMode === "whole-record") {
      if (value.rollbackRevision !== null || value.adoptionHead !== null) return null;
      if (value.transition !== null) {
        if (!exact(value.transition, ["transitionId", "expectedAuthorityRevision"])
            || typeof value.transition.transitionId !== "string" || !value.transition.transitionId
            || value.transition.transitionId !== value.transition.transitionId.trim()
            || !Number.isSafeInteger(value.transition.expectedAuthorityRevision)
            || value.transition.expectedAuthorityRevision < 1
            || value.transition.expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER
            || value.transition.expectedAuthorityRevision + 1 !== value.authorityRevision) return null;
        transition = freeze(value.transition);
      }
    } else {
      const head = safeHead(value.adoptionHead);
      if (value.transition !== null || !Number.isSafeInteger(value.rollbackRevision)
          || value.rollbackRevision < 1 || !head || head.revision < 1) return null;
      rollbackRevision = value.rollbackRevision;
      adoptionHead = head;
    }
    return freeze({ schema: value.schema, authorityRevision: value.authorityRevision,
      currentMode: value.currentMode, transition, rollbackRevision, adoptionHead });
  }

  function validateSwitchWitness(value) {
    if (value === null) return null;
    if (!exact(value, ["schema", "transitionId", "sourceAuthorityRevision", "fencedAuthorityRevision",
      "rollbackRevision", "adoptionHead", "phase", "commitMayHaveRun"])
        || value.schema !== SWITCH_SCHEMA || typeof value.transitionId !== "string"
        || !value.transitionId || value.transitionId !== value.transitionId.trim()
        || !Number.isSafeInteger(value.sourceAuthorityRevision) || value.sourceAuthorityRevision < 1
        || !Number.isSafeInteger(value.rollbackRevision) || value.rollbackRevision < 1
        || !SWITCH_PHASES.includes(value.phase) || typeof value.commitMayHaveRun !== "boolean") return null;
    const adoptionHead = safeHead(value.adoptionHead);
    if (!adoptionHead || adoptionHead.revision < 1) return null;
    if (value.phase === "prepared") {
      if (value.fencedAuthorityRevision !== null || value.commitMayHaveRun) return null;
    } else if (!Number.isSafeInteger(value.fencedAuthorityRevision)
        || value.fencedAuthorityRevision !== value.sourceAuthorityRevision + 1) return null;
    if (value.phase === "commit-ambiguous" && value.commitMayHaveRun !== true) return null;
    return freeze({ ...clone(value), adoptionHead });
  }

  function validateSaveWitness(value) {
    if (value === null) return null;
    if (!exact(value, ["schema", "authorityRevision", "expectedHead", "ceiling", "operations",
      "preservationProjection", "targetFingerprint", "descriptor", "phase", "casMayHaveRun",
      "deleteContinuity", "deleteRetention"])
        || value.schema !== SAVE_SCHEMA
        || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 1
        || !Number.isSafeInteger(value.ceiling) || value.ceiling < 1
        || !Array.isArray(value.operations) || !isObject(value.preservationProjection)
        || typeof value.targetFingerprint !== "string"
        || !/^sha256:[A-Za-z0-9_-]{43}$/.test(value.targetFingerprint)
        || !SAVE_PHASES.includes(value.phase) || typeof value.casMayHaveRun !== "boolean") return null;
    const expectedHead = safeHead(value.expectedHead);
    if (!expectedHead || expectedHead.revision < 1) return null;
    let descriptor = null;
    if (value.descriptor !== null) {
      try { descriptor = global.PocketStarlingDurablePublication?.validateDescriptor?.(value.descriptor); }
      catch (_error) { return null; }
      if (!descriptor || !sameHead(descriptor.expectedHead, expectedHead)) return null;
    }
    if (value.phase !== "captured" && !descriptor) return null;
    if (value.phase === "cas-ambiguous" && !value.casMayHaveRun) return null;
    const deleteContinuity = value.deleteContinuity === null ? null : validateDeleteContinuity(value.deleteContinuity);
    const deleteRetention = value.deleteRetention === null ? null : validateDeleteRetention(value.deleteRetention);
    if ((deleteRetention && !deleteContinuity)
        || (deleteContinuity && deleteRetention && deleteContinuity.nodeId !== deleteRetention.nodeId)) return null;
    return freeze({ schema: SAVE_SCHEMA, authorityRevision: value.authorityRevision, expectedHead,
      ceiling: value.ceiling, operations: clone(value.operations),
      preservationProjection: clone(value.preservationProjection), targetFingerprint: value.targetFingerprint,
      descriptor, phase: value.phase, casMayHaveRun: value.casMayHaveRun,
      deleteContinuity, deleteRetention });
  }

  function validateDeleteContinuity(value) {
    if (!exact(value, ["nodeId", "operationSequence"])
        || typeof value.nodeId !== "string" || !value.nodeId || value.nodeId.length > 80
        || !Number.isSafeInteger(value.operationSequence) || value.operationSequence < 1) return null;
    return freeze({ nodeId: value.nodeId, operationSequence: value.operationSequence });
  }

  function validateDeleteRetention(value) {
    if (!exact(value, ["nodeId", "retainedIndex"])
        || typeof value.nodeId !== "string" || !value.nodeId || value.nodeId.length > 80
        || !Number.isSafeInteger(value.retainedIndex) || value.retainedIndex < 0) return null;
    return freeze({ nodeId: value.nodeId, retainedIndex: value.retainedIndex });
  }

  function validateAcceptedDeleteReceipt(value, ownerRecord) {
    if (value === null) return null;
    if (!exact(value, ["schema", "syncedPocketId", "nodeId", "retainedIndex", "acceptedHead", "operationSequence"])
        || value.schema !== DELETE_RECEIPT_SCHEMA
        || value.syncedPocketId !== ownerRecord.syncedPocketId) return null;
    const retention = validateDeleteRetention({ nodeId: value.nodeId, retainedIndex: value.retainedIndex });
    const continuity = validateDeleteContinuity({ nodeId: value.nodeId, operationSequence: value.operationSequence });
    const acceptedHead = safeHead(value.acceptedHead);
    if (!retention || !continuity || retention.nodeId !== continuity.nodeId || !acceptedHead) return null;
    return freeze({ schema: DELETE_RECEIPT_SCHEMA, syncedPocketId: value.syncedPocketId,
      nodeId: retention.nodeId, retainedIndex: retention.retainedIndex, acceptedHead,
      operationSequence: continuity.operationSequence });
  }

  function validateAuthorityPlainState(value, ownerRecord) {
    const currentSchema = value?.schema;
    const fields = currentSchema === LEGACY_AUTHORITY_STATE_SCHEMA
      ? ["schema", "owner", "authority", "legacyMirror", "acceptedHead", "switchWitness", "saveWitness"]
      : ["schema", "owner", "authority", "legacyMirror", "acceptedHead", "switchWitness", "saveWitness", "acceptedDeleteReceipt"];
    if (!exact(value, fields)
        || ![AUTHORITY_STATE_SCHEMA, LEGACY_AUTHORITY_STATE_SCHEMA].includes(currentSchema) || !exact(value.owner, [
          "syncedPocketId", "deviceId", "masterKeyGeneration",
        ]) || value.owner.syncedPocketId !== ownerRecord.syncedPocketId
        || value.owner.deviceId !== ownerRecord.deviceId
        || value.owner.masterKeyGeneration !== ownerRecord.usage?.masterKeyGeneration) return null;
    const authority = validateAuthoritySnapshot(value.authority);
    const acceptedHead = safeHead(value.acceptedHead);
    const switchWitness = validateSwitchWitness(value.switchWitness);
    const saveWitness = validateSaveWitness(value.saveWitness);
    const acceptedDeleteReceipt = currentSchema === LEGACY_AUTHORITY_STATE_SCHEMA
      ? null : validateAcceptedDeleteReceipt(value.acceptedDeleteReceipt, ownerRecord);
    if (!authority || !acceptedHead || acceptedHead.revision < 1
        || (value.switchWitness !== null && !switchWitness)
        || (value.saveWitness !== null && !saveWitness)
        || (currentSchema !== LEGACY_AUTHORITY_STATE_SCHEMA && value.acceptedDeleteReceipt !== null && !acceptedDeleteReceipt)) return null;
    let legacyMirror = null;
    if (value.legacyMirror !== null) {
      legacyMirror = validateAccepted(value.legacyMirror);
      if (!legacyMirror || !sameHead(legacyMirror.head, acceptedHead)) return null;
    }
    if (authority.currentMode === "whole-record") {
      if (!legacyMirror || saveWitness !== null
          || legacyMirror.sourceRevision !== ownerRecord.remote?.confirmedRevision) return null;
      if (authority.transition === null) {
        if (switchWitness && switchWitness.phase !== "prepared") return null;
      } else {
        if (!switchWitness || switchWitness.transitionId !== authority.transition.transitionId
            || switchWitness.fencedAuthorityRevision !== authority.authorityRevision) return null;
      }
      if (switchWitness && (switchWitness.rollbackRevision !== legacyMirror.sourceRevision
          || !sameHead(switchWitness.adoptionHead, legacyMirror.head))) return null;
    } else {
      if (legacyMirror !== null || authority.transition !== null
          || authority.rollbackRevision !== ownerRecord.remote?.confirmedRevision
          || (switchWitness && (switchWitness.rollbackRevision !== authority.rollbackRevision
            || !sameHead(switchWitness.adoptionHead, authority.adoptionHead)))) return null;
      if (saveWitness && (saveWitness.authorityRevision !== authority.authorityRevision
          || !sameHead(saveWitness.expectedHead, acceptedHead))) return null;
    }
    return freeze({ schema: AUTHORITY_STATE_SCHEMA,
      owner: { syncedPocketId: ownerRecord.syncedPocketId, deviceId: ownerRecord.deviceId,
        masterKeyGeneration: ownerRecord.usage.masterKeyGeneration },
      authority, legacyMirror, acceptedHead, switchWitness, saveWitness, acceptedDeleteReceipt });
  }

  function validatePlainState(value, ownerRecord) {
    if (value?.schema === STATE_SCHEMA) return validateMirrorPlainState(value, ownerRecord);
    if (value?.schema === AUTHORITY_STATE_SCHEMA) return validateAuthorityPlainState(value, ownerRecord);
    return null;
  }

  function createSyncedOwnerController(configuration) {
    const split = splitConfiguration(configuration);
    const base = baseOwnerApi.createSyncedOwnerController(split.base);
    const options = checkedOptions(split.base, split.successor);
    let privateOwner = null;
    let accepted = null;
    let stateStoreOpened = false;
    let authorityOperationOrdinal = 0;
    let ownerOperationTail = Promise.resolve();

    function clearPrivate() {
      privateOwner = null;
      accepted = null;
    }

    function currentSession() {
      return base.captureSyncedOwnerSaveSession();
    }

    function currentPrivate() {
      const session = currentSession();
      return privateOwner && session
        && base.isSyncedOwnerSaveSessionCurrent(session) === true
        && privateOwner.token === session.token
        && privateOwner.generation === session.generation
        && privateOwner.syncedPocketId === session.syncedPocketId
        ? { session, owner: privateOwner } : null;
    }

    async function capturePrivateOwner() {
      if (!options) return false;
      const state = base.getSyncedOwnerState();
      const session = currentSession();
      if (!state || !session || !base.isSyncedOwnerSaveSessionCurrent(session)) return false;
      let record;
      let bundle;
      try {
        record = await split.base.deviceStore.readPocket(state.syncedPocketId);
        if (!record || record.syncedPocketId !== state.syncedPocketId) return false;
        bundle = await split.base.crypto.openMasterKeyBundle(
          record.deviceEnvelope.record,
          record.deviceWrappingKey,
          record.deviceEnvelope.context,
          [],
          { semanticAuthority: true }
        );
        split.base.crypto.validateNonExtractableAesKey(bundle?.masterKey);
        if (!bundle?.semanticAuthority) return false;
        await split.base.crypto.openContent(record.content.record, bundle.masterKey, record.content.context);
      } catch (_error) { return false; }
      if (!base.isSyncedOwnerSaveSessionCurrent(session)) return false;
      const current = base.getSyncedOwnerState();
      if (!current || current.generation !== state.generation
          || current.syncedPocketId !== state.syncedPocketId) return false;
      privateOwner = {
        token: session.token,
        generation: session.generation,
        syncedPocketId: session.syncedPocketId,
        record,
        masterKey: bundle.masterKey,
        semanticAuthority: bundle.semanticAuthority,
      };
      accepted = null;
      return true;
    }

    async function refreshPrivateOwner() {
      const current = currentPrivate();
      if (!current) return capturePrivateOwner();
      try {
        const record = await split.base.deviceStore.readPocket(current.owner.syncedPocketId);
        if (!record || record.syncedPocketId !== current.owner.syncedPocketId
            || record.deviceId !== current.owner.record.deviceId) return false;
        current.owner.record = record;
        return true;
      } catch (_error) { return false; }
    }

    async function ensureStateStoreOpen() {
      if (!options) return false;
      if (stateStoreOpened) return true;
      try {
        await options.ownerStateStore.open();
        stateStoreOpened = true;
        return true;
      } catch (_error) { return false; }
    }

    async function loadDurableState() {
      const current = currentPrivate();
      if (!current || !await ensureStateStoreOpen()) return null;
      let stored;
      try { stored = await options.ownerStateStore.read(current.owner.syncedPocketId); }
      catch (_error) { return null; }
      if (!stored) return null;
      if (stored.syncedPocketId !== current.owner.syncedPocketId
          || stored.deviceId !== current.owner.record.deviceId) return null;
      let plain;
      try {
        plain = await split.base.crypto.openContent(
          stored.encrypted.record,
          current.owner.record.deviceWrappingKey,
          stored.encrypted.context
        );
      } catch (_error) { return null; }
      return validatePlainState(plain, current.owner.record);
    }

    async function persistDurableState(plainInput) {
      const current = currentPrivate();
      if (!current || !await ensureStateStoreOpen()) return false;
      const plain = validatePlainState(plainInput, current.owner.record);
      if (!plain) return false;
      let record;
      try { record = await split.base.deviceStore.readPocket(current.owner.syncedPocketId); }
      catch (_error) { return false; }
      if (!record || record.deviceId !== current.owner.record.deviceId
          || record.usage?.masterKeyGeneration !== current.owner.record.usage?.masterKeyGeneration) return false;
      let reserved;
      try {
        reserved = await split.base.deviceStore.reservePocketEncryptionUsage(
          record.syncedPocketId,
          record.storeRevision,
          record.usage,
          { masterKeyContentEncryptions: 0, deviceWrappingKeyEncryptions: 1 }
        );
      } catch (_error) { return false; }
      if (!base.isSyncedOwnerSaveSessionCurrent(current.session)) return false;
      current.owner.record = reserved;
      let previous;
      try { previous = await options.ownerStateStore.read(record.syncedPocketId); }
      catch (_error) { return false; }
      if (previous && previous.deviceId !== reserved.deviceId) return false;
      const revision = previous ? previous.revision + 1 : 1;
      if (!Number.isSafeInteger(revision) || revision < 1) return false;
      const context = {
        syncedPocketId: reserved.syncedPocketId,
        revision,
        contentType: split.base.crypto.FORMAT.contentType,
      };
      let encryptedRecord;
      try {
        encryptedRecord = await split.base.crypto.sealContent(
          plain,
          reserved.deviceWrappingKey,
          context
        );
      } catch (_error) { return false; }
      try {
        await options.ownerStateStore.write({
          expectedRevision: previous ? previous.revision : null,
          record: {
            kind: global.PocketStarlingOwnerState.FORMAT.kind,
            schemaVersion: global.PocketStarlingOwnerState.FORMAT.schemaVersion,
            revision,
            syncedPocketId: reserved.syncedPocketId,
            deviceId: reserved.deviceId,
            encrypted: { context, record: encryptedRecord },
          },
        });
        return true;
      } catch (_error) { return false; }
    }

    function ownerBinding(record) {
      return Object.freeze({
        syncedPocketId: record.syncedPocketId,
        deviceId: record.deviceId,
        masterKeyGeneration: record.usage.masterKeyGeneration,
      });
    }

    function plainState(acceptedInput, migration) {
      const current = currentPrivate();
      const acceptedValue = validateAccepted(acceptedInput);
      if (!current || !acceptedValue) return null;
      return freeze({
        schema: STATE_SCHEMA,
        owner: ownerBinding(current.owner.record),
        accepted: acceptedValue,
        migration,
      });
    }

    function authorityPlainState(authorityInput, legacyMirrorInput, acceptedHeadInput,
      switchWitnessInput = null, saveWitnessInput = null, acceptedDeleteReceiptInput = null) {
      const current = currentPrivate();
      const authority = validateAuthoritySnapshot(authorityInput);
      const acceptedHead = safeHead(acceptedHeadInput);
      if (!current || !authority || !acceptedHead) return null;
      const candidate = {
        schema: AUTHORITY_STATE_SCHEMA,
        owner: ownerBinding(current.owner.record),
        authority,
        legacyMirror: legacyMirrorInput === null ? null : validateAccepted(legacyMirrorInput),
        acceptedHead,
        switchWitness: switchWitnessInput,
        saveWitness: saveWitnessInput,
        acceptedDeleteReceipt: acceptedDeleteReceiptInput,
      };
      return validateAuthorityPlainState(candidate, current.owner.record);
    }

    function nextOperationId(kind) {
      if (!options) return null;
      try {
        const value = options.operationIdFactory(`p168-${kind}`, authorityOperationOrdinal++);
        return typeof value === "string" && value.length > 0 && value.length <= 160
          && value === value.trim() ? value : null;
      } catch (_error) { return null; }
    }

    function freezeOnceInput(input) {
      if (!input || typeof input.freezePayload !== "function") return null;
      let frozenPromise = null;
      return Object.freeze({
        freezePayload() {
          if (frozenPromise === null) frozenPromise = Promise.resolve().then(() => input.freezePayload());
          return frozenPromise;
        },
      });
    }

    function serialiseOwnerOperation(callback) {
      const run = () => Promise.resolve().then(callback);
      const result = ownerOperationTail.then(run, run);
      ownerOperationTail = result.then(() => undefined, () => undefined);
      return result;
    }

    function wholeSteady(authority) {
      return authority?.currentMode === "whole-record" && authority.transition === null;
    }

    function starlingSteady(authority) {
      return authority?.currentMode === "starling" && authority.transition === null
        && Number.isSafeInteger(authority.rollbackRevision) && authority.rollbackRevision >= 1
        && !!safeHead(authority.adoptionHead);
    }

    async function readSharedAuthority() {
      const current = currentPrivate();
      const operationId = nextOperationId("authority-read");
      if (!current || !options?.persistenceAuthorityService || !operationId) return null;
      try {
        const result = await options.persistenceAuthorityService.read({
          apiVersion: 1, operationId, syncedPocketId: current.owner.syncedPocketId,
        });
        return validateAuthoritySnapshot(result?.authority);
      } catch (_error) { return null; }
    }

    function canonicalDocument(payload) {
      if (!isObject(payload) || payload.schema !== "portal.export.v1") return null;
      const logical = global.PocketStarlingObjectSealShadow;
      const bridge = global.PocketStarlingBridgeShadow;
      const placement = global.PocketStarlingPlacementShadow;
      if (!logical || typeof logical.canonical !== "function"
          || !bridge || typeof bridge.encode !== "function"
          || !placement || typeof placement.audit !== "function") return null;
      try {
        const parsed = options.normaliseInput(payload);
        const dataExtras = options.normaliseRootExtras(isObject(payload.data) ? payload.data : {});
        if (!isObject(parsed) || typeof parsed.schema !== "string" || !parsed.schema
            || typeof parsed.writtenAt !== "string" || !parsed.writtenAt
            || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.tombstones)) return null;
        const document = {
          schema: parsed.schema,
          writtenAt: parsed.writtenAt,
          nodes: parsed.nodes,
          tombstones: parsed.tombstones,
          rootExtras: isObject(parsed.rootExtras) ? parsed.rootExtras : {},
          dataExtras: isObject(dataExtras) ? dataExtras : {},
        };
        const encoded = bridge.encode(document, { capacity: 4 });
        if (!encoded || encoded.ok !== true || !encoded.bridge) return null;
        const relation = placement.audit(encoded.bridge.structural);
        if (!relation || relation.ok !== true || !relation.relation) return null;
        const byId = new Map(document.nodes.map((node) => [node.id, node]));
        if (byId.size !== document.nodes.length) return null;
        const nodes = [];
        const seen = new Set();
        const visit = (parentId) => {
          const children = relation.relation.children[parentId] || [];
          for (let index = 0; index < children.length; index += 1) {
            const nodeId = children[index];
            const node = byId.get(nodeId);
            if (!node || seen.has(nodeId)) return false;
            seen.add(nodeId);
            const nodePayload = {};
            for (const key of Object.keys(node)) {
              if (key !== "id" && key !== "parentId" && key !== "order") nodePayload[key] = node[key];
            }
            nodes.push({ id: nodeId, parentId, order: index, ...nodePayload });
            if (!visit(nodeId)) return false;
          }
          return true;
        };
        if (!visit("root") || seen.size !== document.nodes.length) return null;
        const projected = {
          schema: document.schema,
          writtenAt: document.writtenAt,
          nodes,
          tombstones: document.tombstones,
          rootExtras: document.rootExtras,
          dataExtras: document.dataExtras,
        };
        const canonical = logical.canonical(projected);
        if (!canonical || canonical.ok !== true || typeof canonical.bytes !== "string") return null;
        return Object.freeze({ document: freeze(JSON.parse(canonical.bytes)), bytes: canonical.bytes });
      } catch (_error) { return null; }
    }

    async function fingerprint(bytes) {
      if (typeof bytes !== "string" || !global.crypto?.subtle?.digest) return null;
      try {
        const digest = new Uint8Array(await global.crypto.subtle.digest(
          "SHA-256", new TextEncoder().encode(bytes)
        ));
        return `sha256:${split.base.crypto.encodeBase64Url(digest)}`;
      } catch (_error) { return null; }
    }

    async function freshOpen() {
      const current = currentPrivate();
      const remoteOpen = global.PocketStarlingRemoteOpenShadow;
      if (!current || !remoteOpen || typeof remoteOpen.createRemoteOpener !== "function") return null;
      try {
        return await remoteOpen.createRemoteOpener({
          objectHeadService: options.objectHeadService,
          operationIdFactory: options.operationIdFactory,
        }).openRemote({
          masterKey: current.owner.masterKey,
          context: { syncedPocketId: current.owner.syncedPocketId },
          semanticAuthority: current.owner.semanticAuthority,
        });
      } catch (_error) { return null; }
    }

    async function proveOpened(opened, expectedHead, expectedFingerprint, expectedBytes = null) {
      const materialize = global.PocketStarlingMaterializeShadow;
      const logical = global.PocketStarlingObjectSealShadow;
      if (!opened || opened.outcome !== "opened" || !opened.session
          || !sameHead(opened.head, expectedHead)
          || !materialize || typeof materialize.materializeAccepted !== "function"
          || !logical || typeof logical.canonical !== "function") return false;
      try {
        const materialized = await materialize.materializeAccepted(opened.session);
        if (!materialized || materialized.ok !== true || !materialized.document) return false;
        const canonical = logical.canonical(materialized.document);
        if (!canonical || canonical.ok !== true || typeof canonical.bytes !== "string") return false;
        if (expectedBytes !== null && canonical.bytes !== expectedBytes) return false;
        const actualFingerprint = await fingerprint(canonical.bytes);
        return actualFingerprint !== null && actualFingerprint === expectedFingerprint;
      } catch (_error) { return false; }
    }

    async function ensureAccepted(sourceRevision, durable = null) {
      const current = currentPrivate();
      if (!current) return null;
      if (accepted && accepted.token === current.session.token
          && accepted.generation === current.session.generation
          && accepted.sourceRevision === sourceRevision) return accepted;
      const candidates = [];
      if (durable?.accepted) candidates.push(durable.accepted);
      const bootstrap = base.getStarlingBootstrapState?.();
      if (bootstrap) candidates.push({ sourceRevision: bootstrap.sourceRevision, head: bootstrap.head });
      let metadata = null;
      for (const candidate of candidates) {
        const checked = validateAccepted(candidate);
        if (checked && checked.sourceRevision === sourceRevision) { metadata = checked; break; }
      }
      if (!metadata) return null;
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !opened.session || !sameHead(opened.head, metadata.head)) {
        return null;
      }
      const state = base.getSyncedOwnerState();
      const record = current.owner.record;
      if (state && state.pending === false && state.confirmedRemoteRevision === sourceRevision
          && record.remote?.confirmedRevision === sourceRevision && record.remote?.pending === null) {
        let payload;
        try {
          payload = await split.base.crypto.openContent(
            record.content.record, current.owner.masterKey, record.content.context
          );
        } catch (_error) { return null; }
        const canonical = canonicalDocument(payload);
        const expectedFingerprint = canonical && await fingerprint(canonical.bytes);
        if (!canonical || !expectedFingerprint
            || !await proveOpened(opened, metadata.head, expectedFingerprint, canonical.bytes)) return null;
      }
      accepted = {
        token: current.session.token,
        generation: current.session.generation,
        sourceRevision,
        head: metadata.head,
        session: opened.session,
      };
      return accepted;
    }

    async function prepareDescriptor(migration, durable) {
      const current = currentPrivate();
      const remoteEdit = global.PocketStarlingRemoteEditShadow;
      const durablePublication = global.PocketStarlingDurablePublication;
      if (!current || !remoteEdit || typeof remoteEdit.createEditor !== "function"
          || !durablePublication || typeof durablePublication.descriptorFromPrepared !== "function") return null;
      const source = await ensureAccepted(migration.sourceRevision, durable);
      if (!source || !sameHead(source.head, migration.expectedHead)) return null;
      try {
        const editor = await remoteEdit.createEditor({
          opened: { outcome: "opened", head: source.head, session: source.session },
          masterKey: current.owner.masterKey,
          context: { syncedPocketId: current.owner.syncedPocketId },
          semanticAuthority: current.owner.semanticAuthority,
        });
        const prepared = await editor.prepareWorkingSet(
          clone(migration.operations),
          clone(migration.preservationProjection)
        );
        if (!prepared || prepared.outcome !== "prepared") return null;
        const descriptor = durablePublication.descriptorFromPrepared(prepared);
        if (!descriptor || descriptor.syncedPocketId !== current.owner.syncedPocketId
            || !sameHead(descriptor.expectedHead, migration.expectedHead)) return null;
        return descriptor;
      } catch (_error) { return null; }
    }

    async function persistMigration(durable, migration) {
      const current = currentPrivate();
      if (!current) return null;
      const acceptedMeta = durable?.accepted || validateAccepted({
        sourceRevision: migration.sourceRevision,
        head: migration.expectedHead,
      });
      const nextPlain = plainState(acceptedMeta, migration);
      if (!nextPlain || !await persistDurableState(nextPlain)) return null;
      return nextPlain;
    }

    async function proveAndAccept(durable, migration, expectedBytes = null) {
      const current = currentPrivate();
      if (!current || !migration.descriptor) return false;
      const candidateHead = safeHead({
        schema: HEAD_SCHEMA,
        revision: migration.expectedHead.revision + 1,
        sealRef: migration.descriptor.candidateSealStorageRef,
      });
      if (!candidateHead) return false;
      const opened = await freshOpen();
      if (!await proveOpened(opened, candidateHead, migration.targetFingerprint, expectedBytes)) return false;
      const nextPlain = plainState({ sourceRevision: migration.targetRevision, head: candidateHead }, null);
      if (!nextPlain || !await persistDurableState(nextPlain)) return false;
      accepted = {
        token: current.session.token,
        generation: current.session.generation,
        sourceRevision: migration.targetRevision,
        head: candidateHead,
        session: opened.session,
      };
      return true;
    }

    async function completeMigration(durableInput, expectedBytes = null, callState = { casAttempted: false }) {
      let durable = durableInput;
      let migration = durable?.migration;
      const current = currentPrivate();
      if (!current || !migration) return false;
      const record = current.owner.record;
      if (record.remote?.confirmedRevision < migration.targetRevision
          || record.remote?.pending !== null || record.remote?.conflict !== null) return false;

      if (!migration.descriptor) {
        const descriptor = await prepareDescriptor(migration, durable);
        if (!descriptor) return false;
        migration = freeze({ ...migration, descriptor, phase: "prepared", casMayHaveRun: false });
        durable = await persistMigration(durable, migration);
        if (!durable) return false;
      }

      const coordinator = global.PocketStarlingDurablePublication?.createCoordinator?.({
        objectHeadService: options.objectHeadService,
        operationIdFactory: options.operationIdFactory,
      });
      if (!coordinator) return false;

      if (migration.casMayHaveRun) {
        let reconciled;
        try {
          reconciled = await coordinator.reconcile({
            descriptor: migration.descriptor,
            masterKey: current.owner.masterKey,
            context: { syncedPocketId: current.owner.syncedPocketId },
          });
        } catch (_error) { return false; }
        const outcomes = global.PocketStarlingHeadShadow?.OUTCOME;
        if (!outcomes) return false;
        if (reconciled.outcome === outcomes.COMMITTED) {
          return proveAndAccept(durable, migration, expectedBytes);
        }
        if (reconciled.outcome === outcomes.CONFLICT
            || reconciled.outcome === outcomes.COMMITTED_AND_SUPERSEDED) {
          const conflicted = freeze({ ...migration, phase: "conflict", casMayHaveRun: true });
          await persistMigration(durable, conflicted);
          return false;
        }
        if (reconciled.outcome !== outcomes.NOT_COMMITTED) return false;
        migration = freeze({ ...migration, phase: "objects-present", casMayHaveRun: false });
        durable = await persistMigration(durable, migration);
        if (!durable || callState.casAttempted) return false;
      }

      try {
        await coordinator.ensureObjects(migration.descriptor);
      } catch (_error) { return false; }
      if (migration.phase !== "objects-present") {
        migration = freeze({ ...migration, phase: "objects-present", casMayHaveRun: false });
        durable = await persistMigration(durable, migration);
        if (!durable) return false;
      }
      if (callState.casAttempted) return false;

      migration = freeze({ ...migration, phase: "cas-ambiguous", casMayHaveRun: true });
      durable = await persistMigration(durable, migration);
      if (!durable) return false;
      callState.casAttempted = true;

      let headResult;
      try { headResult = await coordinator.attemptHead(migration.descriptor); }
      catch (_error) {
        try {
          const reconciled = await coordinator.reconcile({
            descriptor: migration.descriptor,
            masterKey: current.owner.masterKey,
            context: { syncedPocketId: current.owner.syncedPocketId },
          });
          if (reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.COMMITTED) {
            return proveAndAccept(durable, migration, expectedBytes);
          }
          if (reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.CONFLICT
              || reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.COMMITTED_AND_SUPERSEDED) {
            await persistMigration(durable, freeze({ ...migration, phase: "conflict", casMayHaveRun: true }));
          }
        } catch (_reconcileError) {}
        return false;
      }
      if (headResult.outcome === "committed") {
        return proveAndAccept(durable, migration, expectedBytes);
      }
      if (headResult.outcome === "conflict") {
        await persistMigration(durable, freeze({ ...migration, phase: "conflict", casMayHaveRun: true }));
        return false;
      }
      if (headResult.outcome === "not-committed") {
        await persistMigration(durable, freeze({ ...migration, phase: "objects-present", casMayHaveRun: false }));
      }
      return false;
    }

    async function recoverPriorMigration() {
      if (!await refreshPrivateOwner()) return null;
      const durable = await loadDurableState();
      if (!durable?.migration) return durable;
      await completeMigration(durable, null, { casAttempted: false });
      return loadDurableState();
    }

    async function rollbackProof(revision, expectedHead) {
      const current = currentPrivate();
      const state = base.getSyncedOwnerState();
      if (!current || !state || state.pending !== false
          || state.confirmedRemoteRevision !== revision || state.knownRemoteRevision !== revision
          || current.owner.record.remote?.confirmedRevision !== revision
          || current.owner.record.remote?.pending !== null || current.owner.record.remote?.conflict !== null
          || current.owner.record.content?.context?.revision !== revision) return null;
      let payload;
      try {
        payload = await split.base.crypto.openContent(current.owner.record.content.record,
          current.owner.masterKey, current.owner.record.content.context);
      } catch (_error) { return null; }
      const canonical = canonicalDocument(payload);
      const targetFingerprint = canonical && await fingerprint(canonical.bytes);
      if (!canonical || !targetFingerprint) return null;
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !sameHead(opened.head, expectedHead)
          || !await proveOpened(opened, expectedHead, targetFingerprint, canonical.bytes)) return null;
      return Object.freeze({ payload, canonical, targetFingerprint, opened });
    }

    async function persistMirrorFromAuthority(durable) {
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA || !durable.legacyMirror) return false;
      const plain = plainState(durable.legacyMirror, null);
      return !!plain && persistDurableState(plain);
    }

    async function releaseOwnFence(durable, authority) {
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA || !durable.switchWitness
          || authority?.currentMode !== "whole-record" || authority.transition === null
          || authority.transition.transitionId !== durable.switchWitness.transitionId) return false;
      const operationId = nextOperationId("authority-release");
      if (!operationId) return false;
      try {
        const result = await options.persistenceAuthorityService.releaseFence({
          apiVersion: 1, operationId, syncedPocketId: durable.owner.syncedPocketId,
          expectedAuthorityRevision: authority.authorityRevision,
          transitionId: durable.switchWitness.transitionId,
        });
        const released = validateAuthoritySnapshot(result?.authority);
        if (!result?.ok || !released || !wholeSteady(released)) return false;
        return persistMirrorFromAuthority(durable);
      } catch (_error) {
        const observed = await readSharedAuthority();
        return !!observed && wholeSteady(observed) && persistMirrorFromAuthority(durable);
      }
    }

    async function reconcileSwitchState(durable, authority) {
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA || !durable.switchWitness) return null;
      const witness = durable.switchWitness;
      if (starlingSteady(authority)
          && authority.rollbackRevision === witness.rollbackRevision
          && sameHead(authority.adoptionHead, witness.adoptionHead)) {
        const opened = await freshOpen();
        if (!opened || opened.outcome !== "opened" || !opened.session || !safeHead(opened.head)) {
          return failure("authority-switch-local-confirmation-unsettled");
        }
        const next = authorityPlainState(authority, null, opened.head, null, null);
        if (!next || !await persistDurableState(next)) {
          return failure("authority-switch-local-confirmation-unsettled");
        }
        const current = currentPrivate();
        if (current) accepted = { token: current.session.token, generation: current.session.generation,
          sourceRevision: authority.rollbackRevision, head: opened.head, session: opened.session };
        return failure("authority-switch-reentry-confirmed");
      }
      if (authority?.currentMode === "whole-record" && authority.transition !== null
          && authority.transition.transitionId === witness.transitionId) {
        await releaseOwnFence(durable, authority);
        return failure("authority-switch-unsettled");
      }
      if (wholeSteady(authority) && witness.phase === "prepared") {
        if (!await persistMirrorFromAuthority(durable)) return failure("authority-switch-unsettled");
        return Object.freeze({ ok: true, reason: "authority-switch-not-started" });
      }
      return failure("authority-transition-conflict");
    }

    async function attemptAuthorityAdoption(payload, preparation, authority, durable) {
      const current = currentPrivate();
      const state = base.getSyncedOwnerState();
      if (!current || !state || !wholeSteady(authority) || durable?.migration
          || state.pending !== false || state.confirmedRemoteRevision !== state.knownRemoteRevision
          || current.owner.record.remote?.pending !== null || current.owner.record.remote?.conflict !== null
          || current.owner.record.remote?.confirmedRevision !== state.confirmedRemoteRevision
          || current.owner.record.content?.context?.revision !== state.confirmedRemoteRevision) {
        return Object.freeze({ kind: "ineligible" });
      }
      const sourceRevision = state.confirmedRemoteRevision;
      const source = await ensureAccepted(sourceRevision,
        durable?.schema === STATE_SCHEMA ? durable : null);
      if (!source || source.sourceRevision !== sourceRevision || !safeHead(source.head)
          || source.head.revision < 1) return Object.freeze({ kind: "ineligible" });
      const preProof = await rollbackProof(sourceRevision, source.head);
      if (!preProof) return Object.freeze({ kind: "ineligible" });
      const transitionId = nextOperationId("authority-transition");
      if (!transitionId) return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      const witnessPrepared = freeze({ schema: SWITCH_SCHEMA, transitionId,
        sourceAuthorityRevision: authority.authorityRevision, fencedAuthorityRevision: null,
        rollbackRevision: sourceRevision, adoptionHead: source.head,
        phase: "prepared", commitMayHaveRun: false });
      let local = authorityPlainState(authority,
        { sourceRevision, head: source.head }, source.head, witnessPrepared, null);
      if (!local || !await persistDurableState(local)) {
        return Object.freeze({ kind: "ineligible" });
      }

      const acquireId = nextOperationId("authority-acquire");
      if (!acquireId) return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      let acquired;
      try {
        acquired = await options.persistenceAuthorityService.acquireFence({
          apiVersion: 1, operationId: acquireId, syncedPocketId: current.owner.syncedPocketId,
          expectedAuthorityRevision: authority.authorityRevision, transitionId,
        });
      } catch (_error) {
        const observed = await readSharedAuthority();
        if (observed && wholeSteady(observed)) {
          await persistMirrorFromAuthority(local);
          return Object.freeze({ kind: "ineligible" });
        }
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      const fenced = validateAuthoritySnapshot(acquired?.authority);
      if (!acquired?.ok || !fenced || fenced.currentMode !== "whole-record"
          || fenced.authorityRevision !== authority.authorityRevision + 1
          || fenced.transition?.transitionId !== transitionId) {
        const observed = await readSharedAuthority();
        if (observed && wholeSteady(observed)) {
          await persistMirrorFromAuthority(local);
          return Object.freeze({ kind: "ineligible" });
        }
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      let witness = freeze({ ...witnessPrepared, fencedAuthorityRevision: fenced.authorityRevision,
        phase: "fenced" });
      local = authorityPlainState(fenced, { sourceRevision, head: source.head }, source.head, witness, null);
      if (!local || !await persistDurableState(local)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-local-confirmation-unsettled" });
      }

      if (!await refreshPrivateOwner()) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      }
      const revisionId = nextOperationId("rollback-revision-read");
      let remoteRevision = null;
      try {
        remoteRevision = revisionId && await split.base.contentService.readRevision({
          apiVersion: 1, operationId: revisionId, syncedPocketId: current.owner.syncedPocketId,
        });
      } catch (_error) {}
      const finalProof = remoteRevision?.recordPresent === true && remoteRevision.revision === sourceRevision
        ? await rollbackProof(sourceRevision, source.head) : null;
      if (!finalProof || !base.isSyncedOwnerSaveSessionCurrent(current.session)) {
        await releaseOwnFence(local, fenced);
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision, head: source.head, session: finalProof.opened.session };

      witness = freeze({ ...witness, phase: "commit-ambiguous", commitMayHaveRun: true });
      local = authorityPlainState(fenced, { sourceRevision, head: source.head }, source.head, witness, null);
      if (!local || !await persistDurableState(local)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-local-confirmation-unsettled" });
      }
      const commitId = nextOperationId("authority-adopt");
      if (!commitId) return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
      let committed = null;
      try {
        const result = await options.persistenceAuthorityService.commitStarlingAdoption({
          apiVersion: 1, operationId: commitId, syncedPocketId: current.owner.syncedPocketId,
          expectedAuthorityRevision: fenced.authorityRevision, transitionId,
          rollbackRevision: sourceRevision, adoptionHead: source.head,
        });
        if (result?.ok === true) committed = validateAuthoritySnapshot(result.authority);
      } catch (_error) {}
      if (!committed) {
        const observed = await readSharedAuthority();
        if (observed && starlingSteady(observed)
            && observed.authorityRevision === fenced.authorityRevision + 1
            && observed.rollbackRevision === sourceRevision
            && sameHead(observed.adoptionHead, source.head)) committed = observed;
        else if (observed && observed.currentMode === "whole-record"
            && observed.authorityRevision === fenced.authorityRevision
            && observed.transition?.transitionId === transitionId) {
          await releaseOwnFence(local, observed);
          return Object.freeze({ kind: "unsettled", reason: "authority-switch-unsettled" });
        } else return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      if (!starlingSteady(committed) || committed.authorityRevision !== fenced.authorityRevision + 1
          || committed.rollbackRevision !== sourceRevision || !sameHead(committed.adoptionHead, source.head)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-transition-conflict" });
      }
      const finalLocal = authorityPlainState(committed, null, source.head, null, null);
      if (!finalLocal || !await persistDurableState(finalLocal)) {
        return Object.freeze({ kind: "unsettled", reason: "authority-switch-local-confirmation-unsettled" });
      }
      return Object.freeze({ kind: "adopted", authority: committed,
        durable: finalLocal, payload, preparation });
    }

    async function ensureStarlingAccepted(durable, authority) {
      const current = currentPrivate();
      if (!current || !durable || durable.schema !== AUTHORITY_STATE_SCHEMA
          || durable.switchWitness !== null || !starlingSteady(authority)
          || durable.authority.currentMode !== "starling"
          || durable.authority.authorityRevision !== authority.authorityRevision
          || durable.authority.rollbackRevision !== authority.rollbackRevision
          || !sameHead(durable.authority.adoptionHead, authority.adoptionHead)) return null;
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !opened.session
          || !sameHead(opened.head, durable.acceptedHead)) return null;
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: authority.rollbackRevision, head: opened.head, session: opened.session };
      return accepted;
    }

    async function prepareAuthoritativeDescriptor(witness, durable, authority) {
      const current = currentPrivate();
      const remoteEdit = global.PocketStarlingRemoteEditShadow;
      const publication = global.PocketStarlingDurablePublication;
      const source = await ensureStarlingAccepted(durable, authority);
      if (!current || !source || !sameHead(source.head, witness.expectedHead)
          || !remoteEdit || typeof remoteEdit.createEditor !== "function"
          || !publication || typeof publication.descriptorFromPrepared !== "function") return null;
      try {
        const editor = await remoteEdit.createEditor({
          opened: { outcome: "opened", head: source.head, session: source.session },
          masterKey: current.owner.masterKey,
          context: { syncedPocketId: current.owner.syncedPocketId },
          semanticAuthority: current.owner.semanticAuthority,
        });
        const prepared = await editor.prepareWorkingSet(clone(witness.operations),
          clone(witness.preservationProjection));
        if (!prepared || prepared.outcome !== "prepared") return null;
        const descriptor = publication.descriptorFromPrepared(prepared);
        const deleteRetentions = Array.isArray(prepared.p170DeleteRetentions)
          ? prepared.p170DeleteRetentions.map(validateDeleteRetention).filter(Boolean) : [];
        const deleteRetention = witness.deleteContinuity && deleteRetentions.length === 1
          && deleteRetentions[0].nodeId === witness.deleteContinuity.nodeId
          ? deleteRetentions[0] : null;
        if (witness.deleteContinuity && !deleteRetention) return null;
        return descriptor && sameHead(descriptor.expectedHead, witness.expectedHead)
          ? Object.freeze({ descriptor, deleteRetention }) : null;
      } catch (_error) { return null; }
    }

    async function persistAuthoritativeWitness(durable, witness) {
      const next = authorityPlainState(durable.authority, null, durable.acceptedHead,
        null, witness, durable.acceptedDeleteReceipt);
      return next && await persistDurableState(next) ? next : null;
    }

    async function proveAndAcceptAuthoritative(durable, witness, expectedBytes = null) {
      if (!witness.descriptor) return false;
      const candidateHead = safeHead({ schema: HEAD_SCHEMA,
        revision: witness.expectedHead.revision + 1,
        sealRef: witness.descriptor.candidateSealStorageRef });
      if (!candidateHead) return false;
      const opened = await freshOpen();
      if (!await proveOpened(opened, candidateHead, witness.targetFingerprint, expectedBytes)) return false;
      const receipt = witness.deleteContinuity && witness.deleteRetention
        ? freeze({ schema: DELETE_RECEIPT_SCHEMA, syncedPocketId: currentPrivate()?.owner.syncedPocketId,
          nodeId: witness.deleteContinuity.nodeId, retainedIndex: witness.deleteRetention.retainedIndex,
          acceptedHead: candidateHead, operationSequence: witness.deleteContinuity.operationSequence })
        : null;
      const next = authorityPlainState(durable.authority, null, candidateHead, null, null, receipt);
      if (!next || !await persistDurableState(next)) return false;
      const current = currentPrivate();
      if (current) accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: durable.authority.rollbackRevision, head: candidateHead, session: opened.session };
      return true;
    }

    async function completeAuthoritativeSave(durableInput, expectedBytes = null,
      callState = { casAttempted: false }) {
      let durable = durableInput;
      let witness = durable?.saveWitness;
      const current = currentPrivate();
      if (!current || !witness || !starlingSteady(durable.authority)) return false;
      if (!witness.descriptor) {
        const prepared = await prepareAuthoritativeDescriptor(witness, durable, durable.authority);
        if (!prepared) return false;
        witness = freeze({ ...witness, descriptor: prepared.descriptor,
          deleteRetention: prepared.deleteRetention, phase: "prepared", casMayHaveRun: false });
        durable = await persistAuthoritativeWitness(durable, witness);
        if (!durable) return false;
      }
      const coordinator = global.PocketStarlingDurablePublication?.createCoordinator?.({
        objectHeadService: options.objectHeadService, operationIdFactory: options.operationIdFactory,
      });
      if (!coordinator) return false;
      if (witness.casMayHaveRun) {
        let reconciled;
        try { reconciled = await coordinator.reconcile({ descriptor: witness.descriptor,
          masterKey: current.owner.masterKey, context: { syncedPocketId: current.owner.syncedPocketId } }); }
        catch (_error) { return false; }
        const outcomes = global.PocketStarlingHeadShadow?.OUTCOME;
        if (!outcomes) return false;
        if (reconciled.outcome === outcomes.COMMITTED) {
          return proveAndAcceptAuthoritative(durable, witness, expectedBytes);
        }
        if ([outcomes.CONFLICT, outcomes.COMMITTED_AND_SUPERSEDED].includes(reconciled.outcome)) {
          await persistAuthoritativeWitness(durable,
            freeze({ ...witness, phase: "conflict", casMayHaveRun: true }));
          return false;
        }
        if (reconciled.outcome !== outcomes.NOT_COMMITTED) return false;
        witness = freeze({ ...witness, phase: "objects-present", casMayHaveRun: false });
        durable = await persistAuthoritativeWitness(durable, witness);
        if (!durable || callState.casAttempted) return false;
      }
      try { await coordinator.ensureObjects(witness.descriptor); }
      catch (_error) { return false; }
      if (witness.phase !== "objects-present") {
        witness = freeze({ ...witness, phase: "objects-present", casMayHaveRun: false });
        durable = await persistAuthoritativeWitness(durable, witness);
        if (!durable) return false;
      }
      if (callState.casAttempted) return false;
      witness = freeze({ ...witness, phase: "cas-ambiguous", casMayHaveRun: true });
      durable = await persistAuthoritativeWitness(durable, witness);
      if (!durable) return false;
      callState.casAttempted = true;
      let headResult;
      try { headResult = await coordinator.attemptHead(witness.descriptor, witness.authorityRevision); }
      catch (_error) {
        try {
          const reconciled = await coordinator.reconcile({ descriptor: witness.descriptor,
            masterKey: current.owner.masterKey, context: { syncedPocketId: current.owner.syncedPocketId } });
          if (reconciled.outcome === global.PocketStarlingHeadShadow.OUTCOME.COMMITTED) {
            return proveAndAcceptAuthoritative(durable, witness, expectedBytes);
          }
          if ([global.PocketStarlingHeadShadow.OUTCOME.CONFLICT,
            global.PocketStarlingHeadShadow.OUTCOME.COMMITTED_AND_SUPERSEDED].includes(reconciled.outcome)) {
            await persistAuthoritativeWitness(durable,
              freeze({ ...witness, phase: "conflict", casMayHaveRun: true }));
          }
        } catch (_reconcileError) {}
        return false;
      }
      if (headResult.outcome === "committed") {
        return proveAndAcceptAuthoritative(durable, witness, expectedBytes);
      }
      if (headResult.outcome === "conflict") {
        await persistAuthoritativeWitness(durable,
          freeze({ ...witness, phase: "conflict", casMayHaveRun: true }));
        return false;
      }
      if (headResult.outcome === "not-committed") {
        await persistAuthoritativeWitness(durable,
          freeze({ ...witness, phase: "objects-present", casMayHaveRun: false }));
      }
      return false;
    }

    async function savePreparedStarling(payload, preparation, authority, durable) {
      const source = await ensureStarlingAccepted(durable, authority);
      if (!source || !sameHead(source.head, durable.acceptedHead)) {
        return failure("starling-reentry-required");
      }
      const canonical = canonicalDocument(payload);
      const targetFingerprint = canonical && await fingerprint(canonical.bytes);
      if (!canonical || !targetFingerprint) return failure("starling-save-preparation-invalid");
      const continuity = resolveDeleteContinuity(preparation);
      let witness = freeze({ schema: SAVE_SCHEMA, authorityRevision: authority.authorityRevision,
        expectedHead: source.head, ceiling: preparation.ceiling, operations: preparation.operations,
        preservationProjection: preparation.preservationProjection, targetFingerprint,
        descriptor: null, phase: "captured", casMayHaveRun: false,
        deleteContinuity: continuity, deleteRetention: null });
      let local = authorityPlainState(authority, null, source.head, null, witness);
      if (!local || !await persistDurableState(local)) {
        return failure("starling-save-local-confirmation-unsettled");
      }
      const prepared = await prepareAuthoritativeDescriptor(witness, local, authority);
      if (!prepared) return failure("starling-save-unsettled");
      witness = freeze({ ...witness, descriptor: prepared.descriptor,
        deleteRetention: prepared.deleteRetention, phase: "prepared" });
      local = await persistAuthoritativeWitness(local, witness);
      if (!local) return failure("starling-save-local-confirmation-unsettled");
      const committed = await completeAuthoritativeSave(local, canonical.bytes, { casAttempted: false });
      return committed ? Object.freeze({ ok: true }) : failure("starling-save-unsettled");
    }

    async function dispatchAuthoritySave(input) {
      if (!await refreshPrivateOwner()) return failure("authority-owner-state-unavailable");
      let authority = await readSharedAuthority();
      if (!authority) return failure("authority-state-unavailable");
      let durable = await loadDurableState();
      const once = freezeOnceInput(input);
      if (!once) return failure("save-input-invalid");

      if (wholeSteady(authority)) {
        if (durable?.schema === AUTHORITY_STATE_SCHEMA && durable.switchWitness) {
          const reconciled = await reconcileSwitchState(durable, authority);
          if (!reconciled?.ok) return reconciled || failure("authority-switch-unsettled");
          durable = await loadDurableState();
        }
        if (durable?.schema === STATE_SCHEMA && durable.migration) {
          let migrationPayload = null;
          try { migrationPayload = await once.freezePayload(); }
          catch (_error) {}
          if (migrationPayload && resolvePostBootstrapSaveWitness(migrationPayload, authority)) {
            return failure("starling-cutover-legacy-migration-unsettled");
          }
          return saveWholeRecordWithMirror(once);
        }
        let payload;
        try { payload = await once.freezePayload(); }
        catch (_error) { return saveWholeRecordWithMirror(once); }
        const postBootstrapWitness = resolvePostBootstrapSaveWitness(payload, authority);
        const preparation = resolvePreparation(payload);
        if (!preparation) return postBootstrapWitness
          ? failure("starling-cutover-preparation-invalid")
          : saveWholeRecordWithMirror(once);
        const adoption = await attemptAuthorityAdoption(payload, preparation, authority, durable);
        if (adoption.kind === "ineligible") return postBootstrapWitness
          ? failure("starling-cutover-adoption-ineligible")
          : saveWholeRecordWithMirror(once);
        if (adoption.kind !== "adopted") return failure(adoption.reason || "authority-switch-unsettled");
        return savePreparedStarling(payload, preparation, adoption.authority, adoption.durable);
      }

      if (authority.currentMode === "whole-record") {
        if (durable?.schema === AUTHORITY_STATE_SCHEMA && durable.switchWitness) {
          return (await reconcileSwitchState(durable, authority)) || failure("authority-switch-unsettled");
        }
        return failure("authority-transition-conflict");
      }

      if (!starlingSteady(authority)) return failure("authority-state-invalid");
      if (durable?.schema === AUTHORITY_STATE_SCHEMA && durable.switchWitness) {
        return (await reconcileSwitchState(durable, authority)) || failure("authority-switch-unsettled");
      }
      if (!durable || durable.schema !== AUTHORITY_STATE_SCHEMA) {
        return failure("starling-reentry-required");
      }
      if (durable.saveWitness) {
        const confirmed = await completeAuthoritativeSave(durable, null, { casAttempted: false });
        return confirmed ? failure("starling-save-reentry-confirmed") : failure("starling-save-unsettled");
      }
      if (!await ensureStarlingAccepted(durable, authority)) return failure("starling-reentry-required");
      let payload;
      try { payload = await once.freezePayload(); }
      catch (_error) { return failure("payload-freeze-failed"); }
      const preparation = resolvePreparation(payload);
      if (!preparation) return failure("starling-save-preparation-invalid");
      return savePreparedStarling(payload, preparation, authority, durable);
    }

    async function bootstrapInitialStarlingBase() {
      if (!await refreshPrivateOwner()) await capturePrivateOwner();
      const current = currentPrivate();
      if (current && accepted && accepted.token === current.session.token
          && accepted.generation === current.session.generation) {
        return freeze({
          ok: true,
          reason: "already-ready",
          generation: current.session.generation,
          sourceRevision: accepted.sourceRevision,
          head: accepted.head,
        });
      }
      const durable = current ? await loadDurableState() : null;
      if (current && durable && !durable.migration) {
        const restored = await ensureAccepted(durable.accepted.sourceRevision, durable);
        if (restored) {
          return freeze({
            ok: true,
            reason: "reused",
            generation: current.session.generation,
            sourceRevision: restored.sourceRevision,
            head: restored.head,
          });
        }
      }
      const result = await base.bootstrapInitialStarlingBase();
      if (result?.ok === true) {
        await refreshPrivateOwner();
        const now = currentPrivate();
        if (now) {
          const opened = await freshOpen();
          if (opened?.outcome === "opened" && sameHead(opened.head, result.head)) {
            accepted = {
              token: now.session.token,
              generation: now.session.generation,
              sourceRevision: result.sourceRevision,
              head: safeHead(result.head),
              session: opened.session,
            };
          }
        }
      }
      return result;
    }

    function getStarlingBootstrapState() {
      const current = currentPrivate();
      if (current && accepted && accepted.token === current.session.token
          && accepted.generation === current.session.generation) {
        return freeze({
          ready: true,
          generation: current.session.generation,
          sourceRevision: accepted.sourceRevision,
          head: accepted.head,
        });
      }
      return base.getStarlingBootstrapState();
    }

    async function rebuildStarlingReentry(authority) {
      const current = currentPrivate();
      if (!current || !starlingSteady(authority)
          || current.owner.record.remote?.confirmedRevision !== authority.rollbackRevision
          || current.owner.record.remote?.pending !== null || current.owner.record.remote?.conflict !== null
          || current.owner.record.content?.context?.revision !== authority.rollbackRevision) return false;
      const opened = await freshOpen();
      const materialize = global.PocketStarlingMaterializeShadow;
      const logical = global.PocketStarlingObjectSealShadow;
      if (!opened || opened.outcome !== "opened" || !opened.session || !safeHead(opened.head)
          || !materialize || typeof materialize.materializeAccepted !== "function"
          || !logical || typeof logical.canonical !== "function") return false;
      try {
        const materialized = await materialize.materializeAccepted(opened.session);
        const canonical = materialized?.ok === true && materialized.document
          ? logical.canonical(materialized.document) : null;
        if (!canonical || canonical.ok !== true || typeof canonical.bytes !== "string") return false;
      } catch (_error) { return false; }
      const next = authorityPlainState(authority, null, opened.head, null, null);
      if (!next || !await persistDurableState(next)) return false;
      accepted = { token: current.session.token, generation: current.session.generation,
        sourceRevision: authority.rollbackRevision, head: opened.head, session: opened.session };
      return true;
    }

    async function adoptSyncedOwner(input) {
      const result = await base.adoptSyncedOwner(input);
      if (result?.ok !== true) return result;
      clearPrivate();
      if (!await capturePrivateOwner()) {
        try { base.releaseSyncedOwner(); } catch (_error) {}
        clearPrivate();
        return failure("owner-adoption-state-unavailable");
      }
      if (!options?.persistenceAuthorityService) return result;
      const authority = await readSharedAuthority();
      if (!authority) {
        try { base.releaseSyncedOwner(); } catch (_error) {}
        clearPrivate();
        return failure("authority-state-unavailable");
      }
      if (wholeSteady(authority)) return result;
      if (!starlingSteady(authority) || !await rebuildStarlingReentry(authority)) {
        try { base.releaseSyncedOwner(); } catch (_error) {}
        clearPrivate();
        return failure("starling-reentry-required");
      }
      return result;
    }

    async function adoptReadyActivation(input) {
      const result = await base.adoptReadyActivation(input);
      if (result?.ok === true) {
        clearPrivate();
        await capturePrivateOwner();
      }
      return result;
    }

    async function adoptReadyRecovery(input, dependencies) {
      const result = await base.adoptReadyRecovery(input, dependencies);
      if (result?.ok === true) {
        clearPrivate();
        await capturePrivateOwner();
      }
      return result;
    }

    function releaseSyncedOwner() {
      clearPrivate();
      return base.releaseSyncedOwner();
    }

    async function saveWholeRecordWithMirror(input) {
      if (!options || !input || typeof input.freezePayload !== "function") {
        return base.saveSyncedOwner(input);
      }
      if (!await refreshPrivateOwner()) {
        const result = await base.saveSyncedOwner(input);
        await refreshPrivateOwner();
        return result;
      }

      let durable = await recoverPriorMigration();
      const before = base.getSyncedOwnerState();
      const current = currentPrivate();
      if (!before || !current) return base.saveSyncedOwner(input);

      if (durable?.migration || before.pending === true) {
        const result = await base.saveSyncedOwner(input);
        await refreshPrivateOwner();
        if (result?.ok === true && durable?.migration) {
          durable = await loadDurableState();
          if (durable?.migration) await completeMigration(durable, null, { casAttempted: false });
        }
        return result;
      }

      let payload;
      try { payload = await input.freezePayload(); }
      catch (_error) { return base.saveSyncedOwner(input); }
      const preparation = resolvePreparation(payload);
      if (!preparation) return base.saveSyncedOwner(input);
      const source = await ensureAccepted(before.confirmedRemoteRevision, durable);
      if (!source || before.pending !== false
          || before.confirmedRemoteRevision !== before.knownRemoteRevision
          || source.sourceRevision !== before.confirmedRemoteRevision) {
        return base.saveSyncedOwner(input);
      }
      const canonical = canonicalDocument(payload);
      const targetFingerprint = canonical && await fingerprint(canonical.bytes);
      if (!canonical || !targetFingerprint) return base.saveSyncedOwner(input);

      const migration = freeze({
        schema: MIGRATION_SCHEMA,
        sourceRevision: before.confirmedRemoteRevision,
        targetRevision: before.confirmedRemoteRevision + 1,
        ceiling: preparation.ceiling,
        operations: preparation.operations,
        preservationProjection: preparation.preservationProjection,
        expectedHead: source.head,
        targetFingerprint,
        descriptor: null,
        phase: "captured",
        casMayHaveRun: false,
      });
      const initialPlain = plainState({ sourceRevision: source.sourceRevision, head: source.head }, migration);
      if (!initialPlain || !await persistDurableState(initialPlain)) {
        const result = await base.saveSyncedOwner(input);
        await refreshPrivateOwner();
        return result;
      }
      durable = initialPlain;

      const descriptor = await prepareDescriptor(migration, durable);
      if (descriptor) {
        const preparedMigration = freeze({ ...migration, descriptor, phase: "prepared" });
        const persisted = await persistMigration(durable, preparedMigration);
        if (persisted) durable = persisted;
      }

      const result = await base.saveSyncedOwner(input);
      await refreshPrivateOwner();
      if (result?.ok !== true) return result;
      if (result.confirmedRemoteRevision === migration.targetRevision) {
        durable = await loadDurableState();
        if (durable?.migration) {
          await completeMigration(durable, canonical.bytes, { casAttempted: false });
        }
      }
      return result;
    }

    async function saveSyncedOwner(input) {
      if (!options?.persistenceAuthorityService) return saveWholeRecordWithMirror(input);
      return serialiseOwnerOperation(() => dispatchAuthoritySave(input));
    }

    function validRestoreAdmissionInput(value) {
      if (!exact(value, ["nodeId", "operationSequence", "newParentId", "toIndex"])
          || typeof value.nodeId !== "string" || !value.nodeId || value.nodeId.length > 80
          || !Number.isSafeInteger(value.operationSequence) || value.operationSequence < 1
          || typeof value.newParentId !== "string" || !value.newParentId || value.newParentId.length > 80
          || !Number.isSafeInteger(value.toIndex) || value.toIndex < 0) return null;
      return freeze(value);
    }

    async function readActualHead() {
      const current = currentPrivate();
      const operationId = nextOperationId("restore-head-read");
      if (!current || !operationId) return null;
      try {
        const result = await options.objectHeadService.readShadowHead({ apiVersion: 1, operationId,
          syncedPocketId: current.owner.syncedPocketId });
        return safeHead(result?.head);
      } catch (_error) { return null; }
    }

    async function admitAcceptedDeleteRestore(input) {
      const requested = validRestoreAdmissionInput(input);
      if (!requested || !await refreshPrivateOwner()) return failure("restore-input-invalid");
      const current = currentPrivate();
      const durable = await loadDurableState();
      const receipt = durable?.acceptedDeleteReceipt;
      if (!current || !durable || durable.schema !== AUTHORITY_STATE_SCHEMA || !receipt
          || receipt.syncedPocketId !== current.owner.syncedPocketId
          || receipt.nodeId !== requested.nodeId
          || receipt.operationSequence !== requested.operationSequence) {
        return failure("restore-receipt-unavailable");
      }
      const authority = await readSharedAuthority();
      if (!authority || !starlingSteady(authority)
          || authority.authorityRevision !== durable.authority.authorityRevision
          || authority.rollbackRevision !== durable.authority.rollbackRevision
          || !sameHead(authority.adoptionHead, durable.authority.adoptionHead)) {
        return failure("restore-authority-conflict");
      }
      const actualHead = await readActualHead();
      if (!actualHead || !sameHead(actualHead, receipt.acceptedHead)) return failure("restore-head-conflict");
      const opened = await freshOpen();
      if (!opened || opened.outcome !== "opened" || !opened.session || !sameHead(opened.head, receipt.acceptedHead)) {
        return failure("restore-open-failed");
      }
      const logical = global.PocketStarlingLogicalEditShadow;
      if (!logical || typeof logical.createBase !== "function" || typeof logical.restoreBranch !== "function") {
        return failure("restore-logical-unavailable");
      }
      try {
        const baseResult = await logical.createBase({ acceptedSealRef: opened.session.acceptedSealRef,
          resolveLogical: opened.session.resolveLogical, syncedPocketId: current.owner.syncedPocketId,
          semanticAuthority: current.owner.semanticAuthority,
          semanticBaseProof: opened.session.semanticBaseProof });
        if (!baseResult?.ok || !baseResult.base) return failure("restore-open-failed");
        const proved = await logical.restoreBranch(baseResult.base, receipt.nodeId, receipt.retainedIndex,
          requested.newParentId, requested.toIndex);
        if (!proved?.ok || !proved.candidate) return failure(`restore-${proved?.reason || "admission-failed"}`);
      } catch (_error) { return failure("restore-admission-failed"); }
      return freeze({ ok: true, operation: { type: "restore", input: {
        nodeId: receipt.nodeId, fromIndex: receipt.retainedIndex,
        newParentId: requested.newParentId, toIndex: requested.toIndex,
      } } });
    }

    return Object.freeze({
      canAdoptSyncedOwner: base.canAdoptSyncedOwner,
      adoptSyncedOwner,
      adoptReadyActivation,
      adoptReadyRecovery,
      releaseSyncedOwner,
      captureSyncedOwnerSaveSession: base.captureSyncedOwnerSaveSession,
      isSyncedOwnerSaveSessionCurrent: base.isSyncedOwnerSaveSessionCurrent,
      getSyncedOwnerState: base.getSyncedOwnerState,
      saveSyncedOwner,
      admitAcceptedDeleteRestore,
      bootstrapInitialStarlingBase,
      getStarlingBootstrapState,
    });
  }

  global.PocketSyncOwnerController = Object.freeze({ createSyncedOwnerController });
})(typeof window !== "undefined" ? window : globalThis);
