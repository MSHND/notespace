/* Synced Pocket local activation orchestration.

This module is intentionally unloaded. It joins the reviewed sync contracts
without adding UI, a live synced owner, background work, or deployment state.
*/

(function initialisePocketSyncActivation(global) {
  "use strict";

  const POLICY = Object.freeze({
    version: 1,
    allowedSourceOwners: Object.freeze(["json", "vault"]),
    initialRemoteRevision: 0,
    finalRemoteRevision: 1,
    masterKeyBits: 256,
    recoveryRootBits: 256,
    recoveryVersion: 1,
    explicitResumeOnly: true,
    recoveryCopyRequired: true,
    deviceFirstPersistence: true,
    ownerAdoptionLast: true,
  });
  const FACTORY_FIELDS = Object.freeze([
    "securityContract", "crypto", "deviceStore", "accountClient", "contentService",
    "envelopeService", "recoveryService", "randomBytes", "now",
  ]);
  const DEPENDENCY_FIELDS = Object.freeze([
    "captureSourceSession", "isSourceSessionCurrent", "hasUnsavedSourceChanges",
    "saveLocalSource", "freezePayload", "prepareRecoveryCopyDestination",
    "buildRecoveryPackage", "writeRecoveryCopy", "adoptSyncedOwner",
  ]);
  const IDENTIFIER_FIELDS = Object.freeze([
    "deviceEnvelopeId", "prfEnvelopeId", "recoveryEnvelopeId",
    "registrationOperationId", "contentOperationId", "contentLogicalChangeId",
    "deviceEnvelopeOperationId", "deviceEnvelopeLogicalChangeId",
    "prfEnvelopeOperationId", "prfEnvelopeLogicalChangeId",
    "recoveryOperationId", "recoveryLogicalChangeId",
  ]);
  const DRAFT_FIELDS = Object.freeze([
    "kind", "schemaVersion", "activationId", "stage", "sourceOwnerKind",
    "sourceContinuityId", "syncedPocketId", "deviceId", "ids", "content",
    "deviceEnvelope", "prfEnvelope", "prfStatus", "recoveryEnvelope",
    "recoveryVerifier", "recoveryRoot", "recoveryPackage",
    "registrationContinuation", "account", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "accountLocator", "pendingOperation",
    "sourceSaved", "recoveryCopyStored", "adopted", "createdAt", "updatedAt",
  ]);
  const STAGES = Object.freeze({
    "source-ready": 0,
    "local-material-ready": 1,
    "device-staged": 2,
    "account-registered": 3,
    "content-committed": 4,
    "device-envelope-committed": 5,
    "prf-envelope-committed": 6,
    "prf-envelope-skipped": 6,
    "recovery-initialised": 7,
    "recovery-copy-pending": 8,
    "ready-for-adoption": 9,
    adopted: 10,
  });
  const PENDING_OPERATIONS = Object.freeze([
    null,
    "account-registration",
    "account-registration-finish",
    "content-upload",
    "content-conflict",
    "device-envelope",
    "device-envelope-conflict",
    "prf-envelope",
    "prf-envelope-conflict",
    "recovery-initialisation",
    "recovery-conflict",
  ]);
  const BASE64URL = /^[A-Za-z0-9_-]+$/;

  function activationError(code) {
    const error = new Error(`Pocket Sync activation ${code}.`);
    error.code = code;
    return error;
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exactObject(value, fields, code) {
    if (!isObject(value)
        || Object.keys(value).length !== fields.length
        || !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
      throw activationError(code);
    }
    return value;
  }

  function identifier(value, code = "activation-input-invalid") {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > 160
        || value !== value.trim()) {
      throw activationError(code);
    }
    return value;
  }

  function deepFreeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
    if (isObject(value)) {
      const copy = {};
      Object.keys(value).forEach((field) => { copy[field] = deepFreeze(value[field]); });
      return Object.freeze(copy);
    }
    return value;
  }

  function jsonClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      throw activationError("activation-state-invalid");
    }
  }

  function safeFailure(reason, extra) {
    return deepFreeze(Object.assign({
      ok: false,
      reason,
      adopted: false,
      sourceOwnerPreserved: true,
    }, extra || {}));
  }

  function byteLength(value) {
    if (typeof value !== "string"
        || value.length === 0
        || value.length % 4 === 1
        || !BASE64URL.test(value)) return -1;
    try {
      const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
      const binary = global.atob(normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "="));
      let canonical = "";
      for (let index = 0; index < binary.length; index += 1) canonical += binary[index];
      const encoded = global.btoa(canonical)
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      return encoded === value ? binary.length : -1;
    } catch (_error) {
      return -1;
    }
  }

  function decodeBase64Url(value, expectedBytes) {
    if (byteLength(value) !== expectedBytes) throw activationError("activation-state-invalid");
    const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = global.atob(normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function canonicalTime(value) {
    return typeof value === "string"
      && value === value.trim()
      && value.length > 0
      && value.length <= 80
      && Number.isFinite(Date.parse(value));
  }

  function requireMethods(value, names, code) {
    if (!isObject(value) || names.some((name) => typeof value[name] !== "function")) {
      throw activationError(code);
    }
    return value;
  }

  function validateFactory(input) {
    const config = exactObject(input, FACTORY_FIELDS, "activation-factory-invalid");
    requireMethods(config.securityContract, [
      "validateActivationReadiness", "buildRecoveryPackage",
      "validateOpaqueEncryptedRecord", "validateOpaqueMasterKeyEnvelopeRecord",
    ], "activation-security-contract-invalid");
    requireMethods(config.crypto, [
      "encodeBase64Url", "generateDeviceWrappingKey", "createDerivedWrappingKey",
      "createRecoveryAuthorisationVerifier", "createMasterKeyBundle",
      "openMasterKeyBundle", "sealContent", "openContent", "validateContentRecord",
      "validateMasterKeyEnvelope",
    ], "activation-crypto-invalid");
    requireMethods(config.deviceStore, [
      "open", "readPocket", "readActivation", "createPocket", "replacePocket",
      "reservePocketEncryptionUsage",
    ], "activation-device-store-invalid");
    requireMethods(config.accountClient, [
      "registerPasskey", "finishRegistration", "authenticatePasskey",
    ], "activation-account-client-invalid");
    requireMethods(config.contentService, ["conditionalUpload"], "activation-content-service-invalid");
    requireMethods(config.envelopeService, ["addEnvelope"], "activation-envelope-service-invalid");
    requireMethods(config.recoveryService, ["initialiseRecovery"], "activation-recovery-service-invalid");
    if (typeof config.randomBytes !== "function" || typeof config.now !== "function") {
      throw activationError("activation-factory-invalid");
    }
    return config;
  }

  function validateDependencies(input) {
    const dependencies = exactObject(input, DEPENDENCY_FIELDS, "activation-dependencies-invalid");
    if (DEPENDENCY_FIELDS.some((field) => typeof dependencies[field] !== "function")) {
      throw activationError("activation-dependencies-invalid");
    }
    return dependencies;
  }

  function validateActivateOptions(input) {
    const value = exactObject(input, ["syncedPocketId", "deviceId"], "activation-input-invalid");
    return Object.freeze({
      syncedPocketId: identifier(value.syncedPocketId),
      deviceId: identifier(value.deviceId),
    });
  }

  function validateResumeOptions(input) {
    const value = exactObject(input, ["activationId"], "activation-input-invalid");
    return Object.freeze({ activationId: identifier(value.activationId) });
  }

  function sourceContinuity(session) {
    if (!isObject(session) || !POLICY.allowedSourceOwners.includes(session.ownerKind)) {
      throw activationError("unsupported-source-owner");
    }
    const candidate = session.continuityId ?? session.sessionId ?? session.id;
    if ((typeof candidate !== "string" && !Number.isSafeInteger(candidate))
        || String(candidate).trim().length === 0
        || String(candidate).length > 160) {
      throw activationError("source-session-invalid");
    }
    return Object.freeze({
      ownerKind: session.ownerKind,
      continuityId: `${session.ownerKind}:${String(candidate)}`,
    });
  }

  function validateTimestamp(now) {
    let milliseconds;
    try { milliseconds = now(); } catch (_error) { throw activationError("activation-clock-invalid"); }
    if (!Number.isFinite(milliseconds)) throw activationError("activation-clock-invalid");
    return new Date(milliseconds).toISOString();
  }

  function freshBytes(randomBytes, length) {
    let value;
    try { value = randomBytes(length); } catch (_error) { throw activationError("local-crypto-failed"); }
    if (!(value instanceof Uint8Array) || value.byteLength !== length) {
      throw activationError("local-crypto-failed");
    }
    return new Uint8Array(value);
  }

  function freshId(config) {
    const bytes = freshBytes(config.randomBytes, 32);
    try { return config.crypto.encodeBase64Url(bytes); } finally { bytes.fill(0); }
  }

  function validateEnvelope(input, kind, config) {
    const fields = [
      "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
      "kdf", "kdfSalt", "derivationVersion", "encryptedEnvelope",
    ];
    const value = exactObject(input, fields, "activation-state-invalid");
    identifier(value.envelopeId, "activation-state-invalid");
    if (value.envelopeKind !== kind || !Number.isSafeInteger(value.envelopeVersion)
        || value.envelopeVersion < 1) throw activationError("activation-state-invalid");
    const opaque = config.securityContract.validateOpaqueMasterKeyEnvelopeRecord(
      value.encryptedEnvelope
    );
    if (!opaque || opaque.ok !== true) throw activationError("activation-state-invalid");
    if (kind === "device") {
      identifier(value.deviceId, "activation-state-invalid");
      if (value.credentialId !== null || value.kdf !== "none"
          || value.kdfSalt !== null || value.derivationVersion !== null) {
        throw activationError("activation-state-invalid");
      }
    } else {
      if (value.deviceId !== null || value.kdf !== "HKDF-SHA-256"
          || byteLength(value.kdfSalt) !== 32 || value.derivationVersion !== 1) {
        throw activationError("activation-state-invalid");
      }
      if (kind === "passkey-prf") identifier(value.credentialId, "activation-state-invalid");
      else if (value.credentialId !== null) throw activationError("activation-state-invalid");
    }
    return value;
  }

  function validateRecoveryVerifier(input) {
    const value = exactObject(input, [
      "format", "version", "kdf", "kdfSalt", "derivationVersion", "verifier",
    ], "activation-state-invalid");
    if (value.format !== "pocket.sync.recovery-authorisation-verifier.opaque"
        || value.version !== 1 || value.kdf !== "HKDF-SHA-256"
        || byteLength(value.kdfSalt) !== 32 || value.derivationVersion !== 1
        || byteLength(value.verifier) !== 32) throw activationError("activation-state-invalid");
    return value;
  }

  function validateStoredPackage(input, config) {
    if (input === null) return null;
    const value = exactObject(input, [
      "kind", "localOnly", "remoteUploadAllowed", "packageVersion", "accountLocator",
      "syncedPocketId", "rootMaterial", "rootBits", "checksum", "instructions",
    ], "activation-state-invalid");
    const checked = config.securityContract.buildRecoveryPackage({
      packageVersion: value.packageVersion,
      accountLocator: value.accountLocator,
      syncedPocketId: value.syncedPocketId,
      rootMaterial: value.rootMaterial,
      rootBits: value.rootBits,
      checksum: value.checksum,
      instructions: value.instructions,
    });
    if (!checked || checked.ok !== true
        || value.kind !== "pocket-recovery-package"
        || value.localOnly !== true
        || value.remoteUploadAllowed !== false) {
      throw activationError("activation-state-invalid");
    }
    return checked.value;
  }

  function stageAtLeast(draft, stage) {
    return STAGES[draft.stage] >= STAGES[stage];
  }

  function validateDraft(input, config) {
    const draft = exactObject(input, DRAFT_FIELDS, "activation-state-invalid");
    if (draft.kind !== "pocket.sync.activation-draft"
        || draft.schemaVersion !== 1
        || !Object.prototype.hasOwnProperty.call(STAGES, draft.stage)
        || !POLICY.allowedSourceOwners.includes(draft.sourceOwnerKind)
        || !PENDING_OPERATIONS.includes(draft.pendingOperation)
        || typeof draft.sourceSaved !== "boolean"
        || typeof draft.recoveryCopyStored !== "boolean"
        || typeof draft.adopted !== "boolean"
        || !canonicalTime(draft.createdAt)
        || !canonicalTime(draft.updatedAt)) throw activationError("activation-state-invalid");
    for (const value of [draft.activationId, draft.sourceContinuityId,
      draft.syncedPocketId, draft.deviceId]) identifier(value, "activation-state-invalid");
    const ids = exactObject(draft.ids, IDENTIFIER_FIELDS, "activation-state-invalid");
    IDENTIFIER_FIELDS.forEach((field) => identifier(ids[field], "activation-state-invalid"));
    const content = exactObject(draft.content, ["context", "record"], "activation-state-invalid");
    try {
      const context = config.crypto.validateContentContext(content.context);
      config.crypto.validateContentRecord(content.record);
      if (context.syncedPocketId !== draft.syncedPocketId || context.revision !== 1) {
        throw activationError("activation-state-invalid");
      }
    } catch (_error) { throw activationError("activation-state-invalid"); }
    validateEnvelope(draft.deviceEnvelope, "device", config);
    validateEnvelope(draft.recoveryEnvelope, "recovery", config);
    validateRecoveryVerifier(draft.recoveryVerifier);
    if (!Number.isSafeInteger(draft.confirmedRemoteRevision)
        || ![0, 1].includes(draft.confirmedRemoteRevision)
        || !Number.isSafeInteger(draft.keySetVersion) || draft.keySetVersion < 0
        || ![0, 1].includes(draft.recoveryVersion)) {
      throw activationError("activation-state-invalid");
    }
    if (!["pending", "available", "skipped"].includes(draft.prfStatus)) {
      throw activationError("activation-state-invalid");
    }
    if (draft.prfEnvelope !== null) validateEnvelope(draft.prfEnvelope, "passkey-prf", config);
    if (draft.prfStatus === "available" && draft.prfEnvelope === null) {
      throw activationError("activation-state-invalid");
    }
    if (draft.prfStatus !== "available" && draft.prfEnvelope !== null) {
      throw activationError("activation-state-invalid");
    }
    if (draft.recoveryRoot !== null && byteLength(draft.recoveryRoot) !== 32) {
      throw activationError("activation-state-invalid");
    }
    const recoveryPackage = validateStoredPackage(draft.recoveryPackage, config);
    if (draft.registrationContinuation !== null) {
      const continuation = exactObject(draft.registrationContinuation, [
        "apiVersion", "operationId", "ceremonyId", "deviceId", "prfEvaluationInput", "credential",
      ], "activation-state-invalid");
      if (continuation.apiVersion !== 1
          || continuation.operationId !== ids.registrationOperationId
          || continuation.deviceId !== draft.deviceId
          || byteLength(continuation.prfEvaluationInput) !== 32
          || !isObject(continuation.credential)) throw activationError("activation-state-invalid");
      identifier(continuation.ceremonyId, "activation-state-invalid");
      identifier(continuation.credential.id, "activation-state-invalid");
    }
    if (draft.account !== null) {
      const account = exactObject(draft.account, [
        "accountId", "credentialId", "credentialVersion", "accountPolicyVersion",
        "prfEvaluationInput",
      ], "activation-state-invalid");
      identifier(account.accountId, "activation-state-invalid");
      identifier(account.credentialId, "activation-state-invalid");
      if (!Number.isSafeInteger(account.credentialVersion) || account.credentialVersion < 1
          || !Number.isSafeInteger(account.accountPolicyVersion) || account.accountPolicyVersion < 1
          || byteLength(account.prfEvaluationInput) !== 32) {
        throw activationError("activation-state-invalid");
      }
    }
    if (stageAtLeast(draft, "account-registered") && draft.account === null) {
      throw activationError("activation-state-invalid");
    }
    if (stageAtLeast(draft, "content-committed") !== (draft.confirmedRemoteRevision === 1)) {
      throw activationError("activation-state-invalid");
    }
    if (stageAtLeast(draft, "device-envelope-committed") && draft.keySetVersion < 1) {
      throw activationError("activation-state-invalid");
    }
    if (stageAtLeast(draft, "recovery-initialised")) {
      if (draft.recoveryVersion !== 1 || draft.accountLocator === null
          || draft.keySetVersion < 2) throw activationError("activation-state-invalid");
      identifier(draft.accountLocator, "activation-state-invalid");
    } else if (draft.recoveryVersion !== 0 || draft.accountLocator !== null) {
      throw activationError("activation-state-invalid");
    }
    if (draft.stage === "recovery-copy-pending" && recoveryPackage === null) {
      throw activationError("activation-state-invalid");
    }
    if (stageAtLeast(draft, "ready-for-adoption")) {
      if (!draft.recoveryCopyStored || draft.recoveryRoot !== null || recoveryPackage !== null) {
        throw activationError("activation-state-invalid");
      }
    } else if (draft.recoveryRoot === null) {
      throw activationError("activation-state-invalid");
    }
    if ((draft.stage === "adopted") !== draft.adopted) {
      throw activationError("activation-state-invalid");
    }
    return deepFreeze(jsonClone(draft));
  }

  function validateDestination(result) {
    if (!result || result.ok !== true || !("destination" in result)) return null;
    return result.destination;
  }

  function successWrite(result) {
    return result === true || (result && result.ok === true);
  }

  function remoteAttemptKind(draft, operation) {
    return draft.pendingOperation === operation ? "idempotent-retry" : "new-change";
  }

  function envelopeInput(context, record, metadata) {
    return deepFreeze({
      envelopeId: context.envelopeId,
      envelopeKind: context.envelopeKind,
      envelopeVersion: context.envelopeVersion,
      deviceId: context.envelopeKind === "device" ? metadata.deviceId : null,
      credentialId: context.envelopeKind === "passkey-prf" ? metadata.credentialId : null,
      kdf: metadata.kdf,
      kdfSalt: metadata.kdfSalt ?? null,
      derivationVersion: metadata.derivationVersion ?? null,
      encryptedEnvelope: record,
    });
  }

  function cloneRecord(record, changes) {
    return {
      kind: record.kind,
      schemaVersion: record.schemaVersion,
      storeRevision: record.storeRevision,
      syncedPocketId: record.syncedPocketId,
      deviceId: record.deviceId,
      deviceWrappingKey: record.deviceWrappingKey,
      deviceEnvelope: record.deviceEnvelope,
      content: record.content,
      remote: changes?.remote || record.remote,
      usage: changes?.usage || record.usage,
      activationDraft: record.activationDraft,
      recoveryDraft: record.recoveryDraft,
    };
  }

  function createActivationOrchestrator(configuration) {
    const config = validateFactory(configuration);
    const deviceFormat = config.deviceStore.FORMAT || global.PocketSyncDeviceStore?.FORMAT;
    if (!deviceFormat
        || deviceFormat.recordKind !== "pocket.sync.device-state"
        || !Number.isSafeInteger(deviceFormat.recordSchemaVersion)
        || deviceFormat.recordSchemaVersion < 1) {
      throw activationError("activation-device-store-invalid");
    }

    async function ensureCurrent(execution) {
      let current;
      try { current = execution.dependencies.isSourceSessionCurrent(execution.sourceSession); }
      catch (_error) { current = false; }
      if (current !== true) throw activationError("source-session-changed");
    }

    async function checked(execution, promise) {
      const value = await promise;
      await ensureCurrent(execution);
      return value;
    }

    async function reserveDeviceWrappingKeyUsage(execution, increment) {
      const current = execution.record;
      if (!current) throw activationError("activation-state-invalid");
      const reserved = await checked(execution, config.deviceStore.reservePocketEncryptionUsage(
        current.syncedPocketId,
        current.storeRevision,
        current.usage,
        { masterKeyContentEncryptions: 0, deviceWrappingKeyEncryptions: increment }
      ));
      execution.record = reserved;
      return reserved;
    }

    async function persistDraft(execution, nextDraftInput, changes) {
      const current = execution.record;
      const nextRevision = current ? current.storeRevision + 1 : 1;
      const nextDraft = validateDraft(Object.assign({}, nextDraftInput, {
        updatedAt: validateTimestamp(config.now),
      }), config);
      const draftContext = {
        syncedPocketId: nextDraft.syncedPocketId,
        revision: nextRevision,
        contentType: config.crypto.FORMAT.contentType,
      };
      const deviceKey = current ? current.deviceWrappingKey : execution.deviceWrappingKey;
      if (current) await reserveDeviceWrappingKeyUsage(execution, 1);
      const reserved = execution.record;
      const encryptedDraft = await checked(
        execution,
        config.crypto.sealContent(nextDraft, deviceKey, draftContext)
      );
      const usage = reserved ? reserved.usage : execution.initialUsage;
      let nextRecord;
      if (current) {
        nextRecord = cloneRecord(reserved, { remote: changes?.remote, usage });
        nextRecord.storeRevision = nextRevision;
      } else {
        nextRecord = execution.initialRecord;
      }
      nextRecord.activationDraft = { context: draftContext, record: encryptedDraft };
      nextRecord.usage = usage;
      nextRecord.schemaVersion = deviceFormat.recordSchemaVersion;
      const stored = current
        ? await checked(execution, config.deviceStore.replacePocket(
          nextDraft.syncedPocketId,
          reserved.storeRevision,
          nextRecord
        ))
        : await checked(execution, config.deviceStore.createPocket(nextRecord));
      execution.record = stored;
      execution.draft = nextDraft;
      return nextDraft;
    }

    async function persistAdoptedDraft(execution) {
      const current = execution.record;
      if (!current || execution.draft.stage !== "ready-for-adoption"
          || execution.draft.adopted !== false) {
        throw activationError("activation-state-invalid");
      }
      const nextRevision = current.storeRevision + 1;
      const nextDraft = validateDraft(Object.assign({}, jsonClone(execution.draft), {
        stage: "adopted",
        adopted: true,
        updatedAt: validateTimestamp(config.now),
      }), config);
      const draftContext = {
        syncedPocketId: nextDraft.syncedPocketId,
        revision: nextRevision,
        contentType: config.crypto.FORMAT.contentType,
      };
      await reserveDeviceWrappingKeyUsage(execution, 1);
      const reserved = execution.record;
      const encryptedDraft = await config.crypto.sealContent(
        nextDraft,
        reserved.deviceWrappingKey,
        draftContext
      );
      const usage = reserved.usage;
      const nextRecord = cloneRecord(reserved, { usage });
      nextRecord.storeRevision = nextRevision;
      nextRecord.activationDraft = { context: draftContext, record: encryptedDraft };
      nextRecord.usage = usage;
      nextRecord.schemaVersion = deviceFormat.recordSchemaVersion;
      const stored = await config.deviceStore.replacePocket(
        nextDraft.syncedPocketId,
        reserved.storeRevision,
        nextRecord
      );
      execution.record = stored;
      execution.draft = nextDraft;
      return nextDraft;
    }

    function changedDraft(draft, changes) {
      return Object.assign({}, jsonClone(draft), changes);
    }

    async function preparePrfEnvelope(execution, credentialReady) {
      const continuation = jsonClone(credentialReady.continuation);
      let prfEnvelope = null;
      let prfStatus = "skipped";
      const output = credentialReady.prf?.outputBytes;
      if (credentialReady.prf?.status === "available" && output instanceof Uint8Array) {
        try {
          const context = {
            syncedPocketId: execution.draft.syncedPocketId,
            envelopeId: execution.draft.ids.prfEnvelopeId,
            envelopeKind: "passkey-prf",
            envelopeVersion: 1,
          };
          const derived = await checked(
            execution,
            config.crypto.createDerivedWrappingKey(output, context)
          );
          const bundle = await checked(
            execution,
            config.crypto.openMasterKeyBundle(
              execution.record.deviceEnvelope.record,
              execution.record.deviceWrappingKey,
              execution.record.deviceEnvelope.context,
              [{ context, wrappingKey: derived.key }]
            )
          );
          prfEnvelope = envelopeInput(context, bundle.envelopes[0].record, {
            credentialId: continuation.credential.id,
            kdf: derived.kdf,
            kdfSalt: derived.kdfSalt,
            derivationVersion: derived.derivationVersion,
          });
          prfStatus = "available";
        } finally {
          output.fill(0);
        }
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        registrationContinuation: continuation,
        prfEnvelope,
        prfStatus,
        pendingOperation: "account-registration-finish",
      }));
    }

    function accountState(result) {
      if (!result || result.ok !== true || result.accountAuthenticated !== true
          || result.contentUnlocked !== false) throw activationError("account-registration-failed");
      return {
        accountId: identifier(result.accountId, "account-registration-failed"),
        credentialId: identifier(result.credentialId, "account-registration-failed"),
        credentialVersion: result.credentialVersion,
        accountPolicyVersion: result.accountPolicyVersion,
        prfEvaluationInput: result.prf?.evaluationInput,
      };
    }

    async function completeAccount(execution) {
      if (stageAtLeast(execution.draft, "account-registered")) return null;
      let result;
      try {
        if (execution.draft.registrationContinuation) {
          result = await checked(
            execution,
            config.accountClient.finishRegistration(execution.draft.registrationContinuation)
          );
        } else {
          if (execution.draft.pendingOperation !== "account-registration") {
            await persistDraft(execution, changedDraft(execution.draft, {
              pendingOperation: "account-registration",
            }));
          }
          result = await checked(execution, config.accountClient.registerPasskey({
            apiVersion: 1,
            operationId: execution.draft.ids.registrationOperationId,
            accountIntent: "create-or-add-credential",
            deviceId: execution.draft.deviceId,
          }, (ready) => preparePrfEnvelope(execution, ready)));
        }
      } catch (error) {
        if (error?.code === "source-session-changed") throw error;
        return safeFailure("account-registration-failed", {
          activationId: execution.draft.activationId,
          locallyDurable: true,
          resumable: execution.draft.registrationContinuation !== null,
        });
      }
      const account = accountState(result);
      if (execution.draft.registrationContinuation
          && account.prfEvaluationInput !== execution.draft.registrationContinuation.prfEvaluationInput) {
        throw activationError("activation-state-invalid");
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        account,
        stage: "account-registered",
        pendingOperation: null,
      }));
      return null;
    }

    async function commitContent(execution) {
      if (stageAtLeast(execution.draft, "content-committed")) return null;
      if (execution.draft.pendingOperation === "content-conflict") {
        return safeFailure("initial-remote-conflict", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: false, conflict: true, resumable: false,
        });
      }
      const attemptKind = remoteAttemptKind(execution.draft, "content-upload");
      if (execution.draft.pendingOperation !== "content-upload" || attemptKind === "idempotent-retry") {
        const pending = Object.assign({}, execution.record.remote.pending, { attemptKind });
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: "content-upload",
        }), { remote: Object.assign({}, execution.record.remote, { pending, conflict: null }) });
      }
      let response;
      try {
        response = await checked(execution, config.contentService.conditionalUpload({
          apiVersion: 1,
          syncedPocketId: execution.draft.syncedPocketId,
          expectedRevision: 0,
          operationId: execution.draft.ids.contentOperationId,
          logicalChangeId: execution.draft.ids.contentLogicalChangeId,
          attemptKind,
          encryptedRecord: execution.draft.content.record,
        }));
      } catch (error) {
        if (error?.code === "source-session-changed") throw error;
        return safeFailure("initial-remote-unavailable", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: false, resumable: true,
        });
      }
      if (response.conflict === true) {
        const remote = Object.assign({}, execution.record.remote, {
          conflict: {
            actualRevision: response.actualRevision,
            operationId: execution.draft.ids.contentOperationId,
          },
        });
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: "content-conflict",
        }), { remote });
        return safeFailure("initial-remote-conflict", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: false, conflict: true, resumable: false,
        });
      }
      if (response.status !== "committed" || response.revision !== 1) {
        throw activationError("activation-state-invalid");
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "content-committed",
        confirmedRemoteRevision: 1,
        pendingOperation: null,
      }), { remote: { confirmedRevision: 1, pending: null, conflict: null } });
      return null;
    }

    async function addEnvelope(execution, kind) {
      const isDevice = kind === "device";
      const operation = isDevice ? "device-envelope" : "prf-envelope";
      const conflictOperation = `${operation}-conflict`;
      const committedStage = isDevice ? "device-envelope-committed" : "prf-envelope-committed";
      if (stageAtLeast(execution.draft, committedStage)) return null;
      if (execution.draft.pendingOperation === conflictOperation) {
        return safeFailure(`${operation}-failed`, {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, conflict: true, resumable: false,
        });
      }
      const attemptKind = remoteAttemptKind(execution.draft, operation);
      if (execution.draft.pendingOperation !== operation || attemptKind === "idempotent-retry") {
        await persistDraft(execution, changedDraft(execution.draft, { pendingOperation: operation }));
      }
      const ids = execution.draft.ids;
      const envelope = isDevice ? execution.draft.deviceEnvelope : execution.draft.prfEnvelope;
      let response;
      try {
        response = await checked(execution, config.envelopeService.addEnvelope({
          apiVersion: 1,
          operationId: isDevice ? ids.deviceEnvelopeOperationId : ids.prfEnvelopeOperationId,
          logicalChangeId: isDevice
            ? ids.deviceEnvelopeLogicalChangeId : ids.prfEnvelopeLogicalChangeId,
          attemptKind,
          syncedPocketId: execution.draft.syncedPocketId,
          expectedKeySetVersion: execution.draft.keySetVersion,
          envelope,
        }));
      } catch (error) {
        if (error?.code === "source-session-changed") throw error;
        return safeFailure(`${operation}-failed`, {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, resumable: true,
        });
      }
      if (response.conflict === true) {
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: conflictOperation,
        }));
        return safeFailure(`${operation}-failed`, {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, conflict: true, resumable: false,
        });
      }
      if (response.status !== "committed"
          || response.keySetVersion !== execution.draft.keySetVersion + 1) {
        throw activationError("activation-state-invalid");
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: committedStage,
        keySetVersion: response.keySetVersion,
        pendingOperation: null,
      }));
      return null;
    }

    async function initialiseRecovery(execution) {
      if (stageAtLeast(execution.draft, "recovery-initialised")) return null;
      if (execution.draft.pendingOperation === "recovery-conflict") {
        return safeFailure("recovery-initialisation-failed", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, conflict: true, resumable: false,
        });
      }
      const attemptKind = remoteAttemptKind(execution.draft, "recovery-initialisation");
      if (execution.draft.pendingOperation !== "recovery-initialisation"
          || attemptKind === "idempotent-retry") {
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: "recovery-initialisation",
        }));
      }
      let response;
      try {
        response = await checked(execution, config.recoveryService.initialiseRecovery({
          apiVersion: 1,
          operationId: execution.draft.ids.recoveryOperationId,
          logicalChangeId: execution.draft.ids.recoveryLogicalChangeId,
          attemptKind,
          syncedPocketId: execution.draft.syncedPocketId,
          expectedKeySetVersion: execution.draft.keySetVersion,
          recoveryVerifier: execution.draft.recoveryVerifier,
          recoveryEnvelope: execution.draft.recoveryEnvelope,
        }));
      } catch (error) {
        if (error?.code === "source-session-changed") throw error;
        return safeFailure("recovery-initialisation-failed", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, resumable: true,
        });
      }
      if (response.conflict === true) {
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: "recovery-conflict",
        }));
        return safeFailure("recovery-initialisation-failed", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, conflict: true, resumable: false,
        });
      }
      if (response.status !== "committed"
          || response.recoveryVersion !== 1
          || response.recoveryCopyRequired !== true
          || response.keySetVersion !== execution.draft.keySetVersion + 1) {
        throw activationError("activation-state-invalid");
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "recovery-initialised",
        keySetVersion: response.keySetVersion,
        recoveryVersion: 1,
        accountLocator: identifier(response.accountLocator, "activation-state-invalid"),
        pendingOperation: null,
      }));
      return null;
    }

    async function preparePackage(execution) {
      if (stageAtLeast(execution.draft, "recovery-copy-pending")) return null;
      const rootMaterial = execution.draft.recoveryRoot;
      let built;
      try {
        built = await checked(execution, execution.dependencies.buildRecoveryPackage({
          packageVersion: 1,
          accountLocator: execution.draft.accountLocator,
          syncedPocketId: execution.draft.syncedPocketId,
          rootMaterial,
          rootBits: 256,
          instructions: [config.securityContract.RECOVERY_COPY.body],
        }));
      } catch (error) {
        if (error?.code === "source-session-changed") throw error;
        return safeFailure("recovery-copy-write-failed", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, resumable: true, recoveryCopyRequired: true,
        });
      }
      const candidate = built && built.ok === true && built.value ? built.value : built;
      const recoveryPackage = validateStoredPackage(candidate, config);
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "recovery-copy-pending",
        recoveryPackage,
      }));
      return null;
    }

    async function writePackage(execution) {
      if (execution.draft.recoveryCopyStored) return null;
      if (!execution.destination) {
        let prepared;
        try {
          prepared = await checked(
            execution,
            execution.dependencies.prepareRecoveryCopyDestination()
          );
      } catch (error) {
        if (error?.code === "source-session-changed") throw error;
        prepared = null;
        }
        execution.destination = validateDestination(prepared);
      }
      if (!execution.destination) {
        return safeFailure("recovery-copy-not-stored", {
          activationId: execution.draft.activationId,
          locallyDurable: true,
          remotelyCommitted: true,
          resumable: true,
          recoveryCopyRequired: true,
        });
      }
      let result;
      try {
        result = await checked(execution, execution.dependencies.writeRecoveryCopy({
          destination: execution.destination,
          recoveryPackage: execution.draft.recoveryPackage,
        }));
      } catch (error) {
        if (error?.code === "source-session-changed") throw error;
        result = null;
      }
      if (!successWrite(result)) {
        return safeFailure("recovery-copy-not-stored", {
          activationId: execution.draft.activationId,
          locallyDurable: true,
          remotelyCommitted: true,
          resumable: true,
          recoveryCopyRequired: true,
        });
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "ready-for-adoption",
        recoveryCopyStored: true,
        recoveryRoot: null,
        recoveryPackage: null,
        registrationContinuation: null,
        pendingOperation: null,
      }));
      return null;
    }

    async function adopt(execution) {
      if (execution.draft.stage === "adopted") {
        return successResult(execution.draft);
      }
      if (execution.draft.stage !== "ready-for-adoption") {
        throw activationError("activation-state-invalid");
      }
      const readiness = config.securityContract.validateActivationReadiness({
        activationPhase: "pre-adoption",
        sourceSaved: execution.draft.sourceSaved,
        sourceSessionCurrent: true,
        masterKeyCreatedLocally: true,
        deviceRecordDurable: true,
        initialRemoteCommitSucceeded: execution.draft.confirmedRemoteRevision === 1,
        accountCredentialRegistered: execution.draft.account !== null,
        recoveryEnvelopeExists: execution.draft.recoveryVersion === 1,
        recoveryCopyStored: execution.draft.recoveryCopyStored,
        syncedOwnerAdopted: false,
      });
      if (!readiness || readiness.ok !== true) throw activationError("activation-state-invalid");
      const owner = deepFreeze({
        ownerKind: "synced",
        activationId: execution.draft.activationId,
        syncedPocketId: execution.draft.syncedPocketId,
        deviceId: execution.draft.deviceId,
        confirmedRemoteRevision: 1,
        syncPending: false,
      });
      await ensureCurrent(execution);
      let adopted;
      try { adopted = await execution.dependencies.adoptSyncedOwner(owner); }
      catch (_error) { adopted = null; }
      const accepted = adopted === true || (isObject(adopted)
        && Object.keys(adopted).length === 1 && adopted.ok === true);
      if (!accepted) {
        return safeFailure("owner-adoption-failed", {
          activationId: execution.draft.activationId, locallyDurable: true,
          remotelyCommitted: true, resumable: true, recoveryCopyRequired: false,
        });
      }
      try {
        await persistAdoptedDraft(execution);
      } catch (_error) {
        return safeFailure("owner-adoption-finalisation-failed", {
          activationId: execution.draft.activationId,
          adopted: true,
          sourceOwnerPreserved: false,
          locallyDurable: true,
          remotelyCommitted: true,
          recoveryCopyStored: true,
          resumable: false,
        });
      }
      return successResult(execution.draft, owner);
    }

    function successResult(draft, ownerInput) {
      const owner = ownerInput || deepFreeze({
        ownerKind: "synced",
        activationId: draft.activationId,
        syncedPocketId: draft.syncedPocketId,
        deviceId: draft.deviceId,
        confirmedRemoteRevision: 1,
        syncPending: false,
      });
      return deepFreeze({
        ok: true,
        reason: "activated",
        activationId: draft.activationId,
        adopted: true,
        sourceOwnerPreserved: false,
        locallyDurable: true,
        remotelyCommitted: true,
        recoveryCopyStored: true,
        syncPending: false,
        confirmedRemoteRevision: 1,
        keySetVersion: draft.keySetVersion,
        recoveryVersion: 1,
        owner,
      });
    }

    async function continueActivation(execution) {
      const steps = [
        completeAccount,
        commitContent,
        (value) => addEnvelope(value, "device"),
      ];
      for (const step of steps) {
        const result = await step(execution);
        if (result) return result;
      }
      if (!stageAtLeast(execution.draft, "prf-envelope-committed")) {
        if (execution.draft.prfStatus === "available") {
          const result = await addEnvelope(execution, "passkey-prf");
          if (result) return result;
        } else if (execution.draft.prfStatus === "skipped") {
          await persistDraft(execution, changedDraft(execution.draft, {
            stage: "prf-envelope-skipped",
            pendingOperation: null,
          }));
        } else {
          throw activationError("activation-state-invalid");
        }
      }
      const recovery = await initialiseRecovery(execution);
      if (recovery) return recovery;
      const packaged = await preparePackage(execution);
      if (packaged) return packaged;
      const written = await writePackage(execution);
      if (written) return written;
      return adopt(execution);
    }

    async function activate(dependenciesInput, optionsInput) {
      let dependencies;
      let options;
      try {
        dependencies = validateDependencies(dependenciesInput);
        options = validateActivateOptions(optionsInput);
      } catch (_error) {
        return safeFailure("invalid-activation-input");
      }
      let sourceSession;
      let continuity;
      try {
        sourceSession = dependencies.captureSourceSession();
        continuity = sourceContinuity(sourceSession);
      } catch (error) {
        return safeFailure(error?.code === "unsupported-source-owner"
          ? "unsupported-source-owner" : "invalid-activation-input");
      }
      const execution = { dependencies, sourceSession, destination: null, record: null, draft: null };
      try {
        await ensureCurrent(execution);
        let dirty;
        try { dirty = dependencies.hasUnsavedSourceChanges(sourceSession); }
        catch (_error) { return safeFailure("source-save-failed"); }
        if (dirty === true) {
          const saved = await checked(execution, dependencies.saveLocalSource(sourceSession));
          if (!saved || saved.ok !== true) {
            return safeFailure(saved && saved.cancelled === true
              ? "source-save-cancelled" : "source-save-failed");
          }
        } else if (dirty !== false) {
          return safeFailure("source-save-failed");
        }
        const payload = await checked(execution, dependencies.freezePayload(sourceSession));
        const prepared = await checked(execution, dependencies.prepareRecoveryCopyDestination());
        execution.destination = validateDestination(prepared);
        if (!execution.destination) {
          return safeFailure("recovery-copy-destination-deferred", {
            resumable: false, remotelyCommitted: false, locallyDurable: false,
          });
        }
        const activationId = freshId(config);
        const ids = {};
        IDENTIFIER_FIELDS.forEach((field) => { ids[field] = freshId(config); });
        const recoveryRootBytes = freshBytes(config.randomBytes, 32);
        const createdAt = validateTimestamp(config.now);
        let recoveryDerived;
        let verifier;
        try {
          execution.deviceWrappingKey = await checked(
            execution,
            config.crypto.generateDeviceWrappingKey()
          );
          const recoveryContext = {
            syncedPocketId: options.syncedPocketId,
            envelopeId: ids.recoveryEnvelopeId,
            envelopeKind: "recovery",
            envelopeVersion: 1,
          };
          recoveryDerived = await checked(
            execution,
            config.crypto.createDerivedWrappingKey(recoveryRootBytes, recoveryContext)
          );
          verifier = await checked(
            execution,
            config.crypto.createRecoveryAuthorisationVerifier(recoveryRootBytes)
          );
          const deviceContext = {
            syncedPocketId: options.syncedPocketId,
            envelopeId: ids.deviceEnvelopeId,
            envelopeKind: "device",
            envelopeVersion: 1,
          };
          const bundle = await checked(execution, config.crypto.createMasterKeyBundle([
            { context: deviceContext, wrappingKey: execution.deviceWrappingKey },
            { context: recoveryContext, wrappingKey: recoveryDerived.key },
          ]));
          const contentContext = {
            syncedPocketId: options.syncedPocketId,
            revision: 1,
            contentType: config.crypto.FORMAT.contentType,
          };
          const contentRecord = await checked(
            execution,
            config.crypto.sealContent(payload, bundle.masterKey, contentContext)
          );
          const deviceEnvelope = envelopeInput(deviceContext, bundle.envelopes[0].record, {
            deviceId: options.deviceId, kdf: "none",
          });
          const recoveryEnvelope = envelopeInput(recoveryContext, bundle.envelopes[1].record, {
            kdf: recoveryDerived.kdf,
            kdfSalt: recoveryDerived.kdfSalt,
            derivationVersion: recoveryDerived.derivationVersion,
          });
          const draft = {
            kind: "pocket.sync.activation-draft",
            schemaVersion: 1,
            activationId,
            stage: "device-staged",
            sourceOwnerKind: continuity.ownerKind,
            sourceContinuityId: continuity.continuityId,
            syncedPocketId: options.syncedPocketId,
            deviceId: options.deviceId,
            ids,
            content: { context: contentContext, record: contentRecord },
            deviceEnvelope,
            prfEnvelope: null,
            prfStatus: "pending",
            recoveryEnvelope,
            recoveryVerifier: verifier,
            recoveryRoot: config.crypto.encodeBase64Url(recoveryRootBytes),
            recoveryPackage: null,
            registrationContinuation: null,
            account: null,
            confirmedRemoteRevision: 0,
            keySetVersion: 0,
            recoveryVersion: 0,
            accountLocator: null,
            pendingOperation: null,
            sourceSaved: true,
            recoveryCopyStored: false,
            adopted: false,
            createdAt,
            updatedAt: createdAt,
          };
          execution.initialUsage = {
            masterKeyGeneration: 1,
            masterKeyContentEncryptions: 1,
            deviceWrappingKeyEncryptions: 2,
          };
          execution.initialRecord = {
            kind: deviceFormat.recordKind,
            schemaVersion: deviceFormat.recordSchemaVersion,
            storeRevision: 1,
            syncedPocketId: options.syncedPocketId,
            deviceId: options.deviceId,
            deviceWrappingKey: execution.deviceWrappingKey,
            deviceEnvelope: {
              context: deviceContext,
              metadata: {
                contractVersion: 1,
                syncedPocketId: options.syncedPocketId,
                envelopeId: ids.deviceEnvelopeId,
                kind: "device",
                version: 1,
                deviceId: options.deviceId,
                createdAt,
                kdf: "none",
              },
              record: bundle.envelopes[0].record,
            },
            content: { context: contentContext, record: contentRecord },
            remote: {
              confirmedRevision: 0,
              pending: {
                expectedRevision: 0,
                operationId: ids.contentOperationId,
                logicalChangeId: ids.contentLogicalChangeId,
                attemptKind: "new-change",
              },
              conflict: null,
            },
            usage: execution.initialUsage,
            activationDraft: null,
            recoveryDraft: null,
          };
          await checked(execution, config.deviceStore.open());
          if (await checked(execution, config.deviceStore.readPocket(options.syncedPocketId)) !== null) {
            return safeFailure("device-staging-failed");
          }
          await persistDraft(execution, draft);
        } finally {
          recoveryRootBytes.fill(0);
        }
        return await continueActivation(execution);
      } catch (error) {
        if (error?.code === "source-session-changed") return safeFailure("source-session-changed", {
          activationId: execution.draft?.activationId,
          locallyDurable: execution.record !== null,
          resumable: execution.record !== null,
        });
        return safeFailure(error?.code === "activation-state-invalid"
          ? "activation-state-invalid" : "local-crypto-failed", {
          activationId: execution.draft?.activationId,
          locallyDurable: execution.record !== null,
          resumable: execution.record !== null,
        });
      }
    }

    async function resume(dependenciesInput, optionsInput) {
      let dependencies;
      let options;
      try {
        dependencies = validateDependencies(dependenciesInput);
        options = validateResumeOptions(optionsInput);
      } catch (_error) {
        return safeFailure("invalid-activation-input");
      }
      const execution = {
        dependencies, sourceSession: null, destination: null, record: null, draft: null,
      };
      try {
        await config.deviceStore.open();
        const found = await config.deviceStore.readActivation(options.activationId);
        if (!found) return safeFailure("activation-state-invalid");
        execution.record = found.record;
        execution.draft = validateDraft(found.draft, config);
        if (execution.draft.activationId !== options.activationId) {
          return safeFailure("activation-state-invalid");
        }
        if (execution.draft.stage === "adopted") return successResult(execution.draft);
        let continuity;
        try {
          execution.sourceSession = dependencies.captureSourceSession();
          continuity = sourceContinuity(execution.sourceSession);
        } catch (error) {
          return safeFailure(error?.code === "unsupported-source-owner"
            ? "unsupported-source-owner" : "invalid-activation-input");
        }
        await ensureCurrent(execution);
        if (execution.draft.activationId !== options.activationId
            || execution.draft.sourceOwnerKind !== continuity.ownerKind
            || execution.draft.sourceContinuityId !== continuity.continuityId) {
          return safeFailure("source-session-changed", {
            activationId: options.activationId,
            locallyDurable: true,
            resumable: true,
          });
        }
        await ensureCurrent(execution);
        return await continueActivation(execution);
      } catch (error) {
        if (error?.code === "source-session-changed") return safeFailure("source-session-changed", {
          activationId: options.activationId, locallyDurable: true, resumable: true,
        });
        return safeFailure("activation-state-invalid", {
          activationId: options.activationId, locallyDurable: true, resumable: false,
        });
      }
    }

    return Object.freeze({ activate, resume });
  }

  global.PocketSyncActivation = Object.freeze({ POLICY, createActivationOrchestrator });
})(typeof window !== "undefined" ? window : globalThis);
