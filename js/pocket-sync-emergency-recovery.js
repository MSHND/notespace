/* Synced Pocket dormant emergency-recovery orchestration.

This module is intentionally unloaded. It stages and resumes recovery to a
new device without adding UI, ownership, Save integration or a proof algorithm.
*/

(function initialisePocketSyncEmergencyRecovery(global) {
  "use strict";

  const POLICY = Object.freeze({
    version: 1,
    allowedRecoveryTargetOwners: Object.freeze(["none", "detached"]),
    oldRecoveryRootBits: 256,
    replacementRecoveryRootBits: 256,
    replacementRecoveryCopyRequired: true,
    explicitResumeOnly: true,
    deviceFirstStaging: true,
    ownerAdoptionAbsent: true,
    deviceEnvelopeRequired: true,
    passkeyPrfEnvelopeCreated: false,
    recoveryRotationRequired: true,
    finalStage: "ready-for-adoption",
  });
  const FACTORY_FIELDS = Object.freeze([
    "securityContract", "crypto", "deviceStore", "accountContract", "contentService",
    "envelopeService", "recoveryService", "webAuthn", "randomBytes", "now",
  ]);
  const DEPENDENCY_FIELDS = Object.freeze([
    "captureRecoveryTarget", "isRecoveryTargetCurrent", "readRecoveryPackage",
    "prepareReplacementRecoveryCopyDestination", "buildRecoveryPackage",
    "writeReplacementRecoveryCopy", "validateRecoveredPayload",
  ]);
  const ID_FIELDS = Object.freeze([
    "recoveryOperationId", "revisionReadOperationId", "contentDownloadOperationId",
    "deviceEnvelopeId", "deviceEnvelopeOperationId", "deviceEnvelopeLogicalChangeId",
    "replacementRecoveryEnvelopeId", "rotationOperationId", "rotationLogicalChangeId",
  ]);
  const DRAFT_FIELDS = Object.freeze([
    "kind", "schemaVersion", "recoveryAttemptId", "stage", "targetOwnerKind",
    "targetContinuityId", "syncedPocketId", "deviceId", "ids", "oldRecoveryPackage",
    "beginRequest", "beginResponse", "finishRequest", "finishResponse",
    "confirmedRemoteRevision", "content", "deviceEnvelope", "replacementRecoveryRoot",
    "replacementRecoveryVerifier", "replacementRecoveryAuthorisation", "replacementRecoveryEnvelope", "replacementAccountLocator",
    "replacementRecoveryPackage", "account", "keySetVersion", "recoveryVersion", "deviceGrant",
    "pendingOperation", "replacementRecoveryCopyStored", "createdAt", "updatedAt",
  ]);
  const STAGES = Object.freeze({
    "package-staged": 0,
    "begin-pending": 1,
    "ceremony-ready": 2,
    "finish-ready": 3,
    "finish-pending": 4,
    "recovery-authenticated": 5,
    "content-ready": 6,
    "device-envelope-pending": 7,
    "device-envelope-committed": 8,
    "rotation-pending": 9,
    "recovery-rotated": 10,
    "replacement-copy-pending": 11,
    "ready-for-adoption": 12,
  });
  const PENDING = Object.freeze([
    null, "begin-recovery", "finish-recovery", "revision-read", "content-download",
    "device-envelope", "device-envelope-conflict", "recovery-rotation",
    "recovery-rotation-conflict", "begin-attention-expired", "begin-attention-not-found",
    "begin-attention-rejected", "begin-attention-generic-rejected",
    "begin-attention-request-rejected",
    "begin-attention-authentication-rejected", "begin-attention-authorisation-rejected",
    "begin-attention-conflict", "begin-attention-response-invalid",
    "begin-attention-service-state-invalid", "begin-attention-storage-failed",
    "begin-attention-server-contract-invalid", "begin-attention-server-internal",
    "begin-attention-http-shell-rejected", "begin-attention-redirect-rejected",
    "begin-attention-unclassified-rejected",
  ]);
  const BEGIN_ATTENTION_OPERATIONS = Object.freeze({
    "recovery-begin-expired": "begin-attention-expired",
    "recovery-begin-not-found": "begin-attention-not-found",
    "recovery-begin-rejected": "begin-attention-generic-rejected",
    "recovery-begin-request-rejected": "begin-attention-request-rejected",
    "recovery-begin-authentication-rejected": "begin-attention-authentication-rejected",
    "recovery-begin-authorisation-rejected": "begin-attention-authorisation-rejected",
    "recovery-begin-conflict": "begin-attention-conflict",
    "recovery-begin-response-invalid": "begin-attention-response-invalid",
    "recovery-begin-service-state-invalid": "begin-attention-service-state-invalid",
    "recovery-begin-storage-failed": "begin-attention-storage-failed",
    "recovery-begin-server-contract-invalid": "begin-attention-server-contract-invalid",
    "recovery-begin-server-internal": "begin-attention-server-internal",
    "recovery-begin-http-shell-rejected": "begin-attention-http-shell-rejected",
    "recovery-begin-redirect-rejected": "begin-attention-redirect-rejected",
    "recovery-begin-rejected": "begin-attention-unclassified-rejected",
  });
  const BEGIN_ATTENTION_REASONS = Object.freeze({
    "begin-attention-expired": "recovery-begin-expired",
    "begin-attention-not-found": "recovery-begin-not-found",
    "begin-attention-rejected": "recovery-begin-rejected",
    "begin-attention-generic-rejected": "recovery-begin-rejected",
    "begin-attention-request-rejected": "recovery-begin-request-rejected",
    "begin-attention-authentication-rejected": "recovery-begin-authentication-rejected",
    "begin-attention-authorisation-rejected": "recovery-begin-authorisation-rejected",
    "begin-attention-conflict": "recovery-begin-conflict",
    "begin-attention-response-invalid": "recovery-begin-response-invalid",
    "begin-attention-service-state-invalid": "recovery-begin-service-state-invalid",
    "begin-attention-storage-failed": "recovery-begin-storage-failed",
    "begin-attention-server-contract-invalid": "recovery-begin-server-contract-invalid",
    "begin-attention-server-internal": "recovery-begin-server-internal",
    "begin-attention-http-shell-rejected": "recovery-begin-http-shell-rejected",
    "begin-attention-redirect-rejected": "recovery-begin-redirect-rejected",
    "begin-attention-unclassified-rejected": "recovery-begin-rejected",
  });
  const BASE64URL = /^[A-Za-z0-9_-]+$/;

  function recoveryError(code) {
    const error = new Error(`Pocket Sync emergency recovery ${code}.`);
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
      throw recoveryError(code);
    }
    return value;
  }

  function identifier(value, code = "recovery-state-invalid") {
    if (typeof value !== "string" || value.length < 1 || value.length > 160
        || value !== value.trim()) throw recoveryError(code);
    return value;
  }

  function positive(value, code = "recovery-state-invalid") {
    if (!Number.isSafeInteger(value) || value < 1) throw recoveryError(code);
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
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_error) { throw recoveryError("recovery-state-invalid"); }
  }

  function safeFailure(reason, extra) {
    return deepFreeze(Object.assign({
      ok: false,
      reason,
      adopted: false,
      readyForAdoption: false,
    }, extra || {}));
  }

  function byteLength(value) {
    if (typeof value !== "string" || value.length === 0 || value.length % 4 === 1
        || !BASE64URL.test(value)) return -1;
    try {
      const binary = global.atob(value.replace(/-/g, "+").replace(/_/g, "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "="));
      const canonical = global.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_")
        .replace(/=+$/g, "");
      return canonical === value ? binary.length : -1;
    } catch (_error) { return -1; }
  }

  function decodeBase64Url(value, size) {
    if (byteLength(value) !== size) throw recoveryError("recovery-state-invalid");
    const binary = global.atob(value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function canonicalTime(value) {
    return typeof value === "string" && value === value.trim() && value.length > 0
      && value.length <= 80 && Number.isFinite(Date.parse(value));
  }

  function requireMethods(value, names, code, exact = false) {
    if (!isObject(value) || names.some((name) => typeof value[name] !== "function")
        || (exact && (Object.keys(value).length !== names.length
          || Object.keys(value).some((name) => !names.includes(name))))) {
      throw recoveryError(code);
    }
    return value;
  }

  function validateFactory(input) {
    const config = exactObject(input, FACTORY_FIELDS, "recovery-factory-invalid");
    requireMethods(config.securityContract, [
      "buildRecoveryPackage", "validateOpaqueEncryptedRecord",
      "validateOpaqueMasterKeyEnvelopeRecord",
    ], "recovery-security-contract-invalid");
    requireMethods(config.crypto, [
      "encodeBase64Url", "generateDeviceWrappingKey", "deriveWrappingKey",
      "createDerivedWrappingKey", "createRecoveryAuthorisationKeyPair", "digestRecoveryCredential",
      "signRecoveryAuthorisation", "validateRecoveryAuthorisation",
      "openMasterKeyBundle", "openContent", "sealContent", "validateContentRecord",
      "validateContentContext", "validateMasterKeyEnvelope", "validateEnvelopeContext",
    ], "recovery-crypto-invalid");
    requireMethods(config.deviceStore, [
      "open", "readStoredRecord", "readRecoveryAttempt", "findRecoveryAttempt",
      "createRecoveryStaging", "replaceRecoveryStaging", "reserveRecoveryStagingEncryptionUsage",
      "promoteRecoveryStaging", "discardRecoveryStaging",
    ], "recovery-device-store-invalid");
    requireMethods(config.accountContract, [
      "serializeRegistrationCredential", "validateFinishRegistrationRequest",
    ],
      "recovery-account-contract-invalid");
    requireMethods(config.contentService, ["readRevision", "downloadEncryptedRecord"],
      "recovery-content-service-invalid");
    requireMethods(config.envelopeService, ["addEnvelope"],
      "recovery-envelope-service-invalid");
    requireMethods(config.recoveryService, ["beginRecovery", "finishRecovery", "rotateRecovery"],
      "recovery-remote-service-invalid");
    requireMethods(config.webAuthn, ["createCredential"], "recovery-webauthn-invalid", true);
    if (typeof config.randomBytes !== "function" || typeof config.now !== "function") {
      throw recoveryError("recovery-factory-invalid");
    }
    return config;
  }

  function validateDependencies(input) {
    const value = exactObject(input, DEPENDENCY_FIELDS, "recovery-dependencies-invalid");
    if (DEPENDENCY_FIELDS.some((field) => typeof value[field] !== "function")) {
      throw recoveryError("recovery-dependencies-invalid");
    }
    return value;
  }

  function validateRecoverOptions(input) {
    const value = exactObject(input, ["deviceId"], "invalid-recovery-input");
    return Object.freeze({ deviceId: identifier(value.deviceId, "invalid-recovery-input") });
  }

  function validateResumeOptions(input) {
    const value = exactObject(input, ["recoveryAttemptId"], "invalid-recovery-input");
    return Object.freeze({
      recoveryAttemptId: identifier(value.recoveryAttemptId, "invalid-recovery-input"),
    });
  }

  function validateRestartOptions(input) {
    const value = exactObject(input, ["recoveryAttemptId"], "invalid-recovery-input");
    return Object.freeze({
      recoveryAttemptId: identifier(value.recoveryAttemptId, "invalid-recovery-input"),
    });
  }

  function targetIdentity(target) {
    if (!isObject(target) || !POLICY.allowedRecoveryTargetOwners.includes(target.ownerKind)) {
      throw recoveryError("unsupported-recovery-target");
    }
    const candidate = target.continuityId ?? target.sessionId ?? target.id;
    if ((typeof candidate !== "string" && !Number.isSafeInteger(candidate))
        || String(candidate).trim().length === 0 || String(candidate).length > 160) {
      throw recoveryError("invalid-recovery-input");
    }
    return Object.freeze({
      ownerKind: target.ownerKind,
      continuityId: `${target.ownerKind}:${String(candidate)}`,
    });
  }

  function recoveryTargetMatches(identity, draft) {
    return identity.ownerKind === draft.targetOwnerKind
      && (identity.ownerKind === "none" || identity.continuityId === draft.targetContinuityId);
  }

  function timestamp(now) {
    let value;
    try { value = now(); } catch (_error) { throw recoveryError("recovery-state-invalid"); }
    if (!Number.isFinite(value)) throw recoveryError("recovery-state-invalid");
    return new Date(value).toISOString();
  }

  function freshBytes(randomBytes, length) {
    let value;
    try { value = randomBytes(length); } catch (_error) { throw recoveryError("device-staging-failed"); }
    if (!(value instanceof Uint8Array) || value.byteLength !== length) {
      throw recoveryError("device-staging-failed");
    }
    return new Uint8Array(value);
  }

  function freshId(config) {
    const value = freshBytes(config.randomBytes, 32);
    try { return config.crypto.encodeBase64Url(value); }
    finally { value.fill(0); }
  }

  function validatePackage(input, config, code = "recovery-package-invalid") {
    const value = exactObject(input, [
      "kind", "localOnly", "remoteUploadAllowed", "packageVersion", "accountLocator",
      "syncedPocketId", "rootMaterial", "rootBits", "recoveryAuthorisation", "checksum", "instructions",
    ], code);
    const built = config.securityContract.buildRecoveryPackage({
      packageVersion: value.packageVersion,
      accountLocator: value.accountLocator,
      syncedPocketId: value.syncedPocketId,
      rootMaterial: value.rootMaterial,
      rootBits: value.rootBits,
      recoveryAuthorisation: value.recoveryAuthorisation,
      checksum: value.checksum,
      instructions: value.instructions,
    });
    if (!built || built.ok !== true || value.kind !== "pocket-recovery-package"
        || value.localOnly !== true || value.remoteUploadAllowed !== false
        || value.packageVersion !== 2 || value.rootBits !== 256
        || byteLength(value.rootMaterial) !== 32) throw recoveryError(code);
    return deepFreeze(jsonClone(built.value));
  }

  function validateProof(input) {
    const value = exactObject(input, ["version", "algorithm", "signature"], "recovery-proof-failed");
    const size = byteLength(value.signature);
    if (value.version !== 1 || value.algorithm !== "Ed25519" || size < 32 || size > 1024) {
      throw recoveryError("recovery-proof-failed");
    }
    return deepFreeze(jsonClone(value));
  }

  function validateEnvelope(input, kind, config) {
    const value = exactObject(input, [
      "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
      "kdf", "kdfSalt", "derivationVersion", "encryptedEnvelope",
    ], "recovery-state-invalid");
    identifier(value.envelopeId);
    positive(value.envelopeVersion);
    if (value.envelopeKind !== kind) throw recoveryError("recovery-state-invalid");
    const opaque = config.securityContract.validateOpaqueMasterKeyEnvelopeRecord(
      value.encryptedEnvelope
    );
    if (!opaque || opaque.ok !== true) throw recoveryError("recovery-state-invalid");
    if (kind === "device") {
      identifier(value.deviceId);
      if (value.credentialId !== null || value.kdf !== "none" || value.kdfSalt !== null
          || value.derivationVersion !== null) throw recoveryError("recovery-state-invalid");
    } else if (value.deviceId !== null || value.credentialId !== null
        || value.kdf !== "HKDF-SHA-256" || byteLength(value.kdfSalt) !== 32
        || value.derivationVersion !== 1) throw recoveryError("recovery-state-invalid");
    return value;
  }

  function validateEncryptedContent(input, syncedPocketId, config) {
    if (input === null) return null;
    const value = exactObject(input, ["context", "record"], "recovery-state-invalid");
    try {
      const context = config.crypto.validateContentContext(value.context);
      config.crypto.validateContentRecord(value.record);
      if (context.syncedPocketId !== syncedPocketId || context.revision < 1) {
        throw recoveryError("recovery-state-invalid");
      }
    } catch (_error) { throw recoveryError("recovery-state-invalid"); }
    return value;
  }

  function validateRecoveryVerifier(input) {
    if (input === null) return null;
    const value = exactObject(input, ["version", "algorithm", "publicKeyFormat", "publicKey"],
      "recovery-state-invalid");
    if (value.version !== 1 || value.algorithm !== "Ed25519"
        || value.publicKeyFormat !== "spki" || byteLength(value.publicKey) < 32
        || byteLength(value.publicKey) > 4096) throw recoveryError("recovery-state-invalid");
    return value;
  }

  function validateRecoveryAuthorisation(input) {
    const value = exactObject(input, ["version", "algorithm", "privateKeyFormat", "privateKey"],
      "recovery-state-invalid");
    if (value.version !== 1 || value.algorithm !== "Ed25519" || value.privateKeyFormat !== "pkcs8"
        || byteLength(value.privateKey) < 32 || byteLength(value.privateKey) > 4096) {
      throw recoveryError("recovery-state-invalid");
    }
    return value;
  }

  function validateSafeAccount(input) {
    if (input === null) return null;
    const value = exactObject(input, [
      "accountId", "credentialId", "credentialVersion", "accountPolicyVersion",
    ], "recovery-state-invalid");
    identifier(value.accountId);
    identifier(value.credentialId);
    positive(value.credentialVersion);
    positive(value.accountPolicyVersion);
    return value;
  }

  function validateDraft(input, config) {
    const draft = exactObject(input, DRAFT_FIELDS, "recovery-state-invalid");
    if (draft.kind !== "pocket.sync.emergency-recovery-draft" || draft.schemaVersion !== 1
        || !Object.prototype.hasOwnProperty.call(STAGES, draft.stage)
        || !POLICY.allowedRecoveryTargetOwners.includes(draft.targetOwnerKind)
        || !PENDING.includes(draft.pendingOperation)
        || (BEGIN_ATTENTION_REASONS[draft.pendingOperation]
          && draft.stage !== "begin-pending")
        || typeof draft.replacementRecoveryCopyStored !== "boolean"
        || !canonicalTime(draft.createdAt) || !canonicalTime(draft.updatedAt)) {
      throw recoveryError("recovery-state-invalid");
    }
    [draft.recoveryAttemptId, draft.targetContinuityId, draft.syncedPocketId, draft.deviceId]
      .forEach((value) => identifier(value));
    if (draft.ids !== null) {
      const ids = exactObject(draft.ids, ID_FIELDS, "recovery-state-invalid");
      ID_FIELDS.forEach((field) => identifier(ids[field]));
    }
    if (draft.oldRecoveryPackage !== null) validatePackage(draft.oldRecoveryPackage, config,
      "recovery-state-invalid");
    if (draft.replacementRecoveryPackage !== null) validatePackage(
      draft.replacementRecoveryPackage, config, "recovery-state-invalid"
    );
    if (draft.replacementRecoveryRoot !== null
        && byteLength(draft.replacementRecoveryRoot) !== 32) {
      throw recoveryError("recovery-state-invalid");
    }
    validateSafeAccount(draft.account);
    if (draft.content !== null) validateEncryptedContent(draft.content, draft.syncedPocketId, config);
    if (draft.deviceEnvelope !== null) validateEnvelope(draft.deviceEnvelope, "device", config);
    if (draft.replacementRecoveryEnvelope !== null) {
      validateEnvelope(draft.replacementRecoveryEnvelope, "recovery", config);
    }
    if (!Number.isSafeInteger(draft.confirmedRemoteRevision)
        || draft.confirmedRemoteRevision < 0
        || !Number.isSafeInteger(draft.keySetVersion) || draft.keySetVersion < 0
        || !Number.isSafeInteger(draft.recoveryVersion) || draft.recoveryVersion < 0) {
      throw recoveryError("recovery-state-invalid");
    }
    if (draft.deviceGrant !== null) {
      const grant = exactObject(draft.deviceGrant, ["masterKeyGeneration",
        "masterKeyContentEncryptionLimit"], "recovery-state-invalid");
      if (grant.masterKeyGeneration !== 1
          || grant.masterKeyContentEncryptionLimit !== 2 ** 20) {
        throw recoveryError("recovery-state-invalid");
      }
    }
    if (draft.beginRequest !== null) {
      const request = exactObject(draft.beginRequest,
        ["apiVersion", "operationId", "accountLocator", "deviceId"], "recovery-state-invalid");
      if (request.apiVersion !== 1 || request.deviceId !== draft.deviceId) {
        throw recoveryError("recovery-state-invalid");
      }
    }
    if (draft.finishRequest !== null) {
      exactObject(draft.finishRequest, ["apiVersion", "operationId", "recoveryCeremonyId",
        "deviceId", "proof", "credential"], "recovery-state-invalid");
      validateProof(draft.finishRequest.proof);
      try {
        config.accountContract.validateFinishRegistrationRequest({
          apiVersion: 1,
          operationId: draft.finishRequest.operationId,
          ceremonyId: draft.finishRequest.recoveryCeremonyId,
          deviceId: draft.finishRequest.deviceId,
          credential: draft.finishRequest.credential,
        });
      } catch (_error) { throw recoveryError("recovery-state-invalid"); }
    }
    const final = draft.stage === "ready-for-adoption";
    if (!final && STAGES[draft.stage] >= STAGES["ceremony-ready"]
        && STAGES[draft.stage] < STAGES["recovery-rotated"]
        && draft.beginResponse === null) {
      throw recoveryError("recovery-state-invalid");
    }
    if (!final && STAGES[draft.stage] >= STAGES["finish-ready"]
        && STAGES[draft.stage] < STAGES["recovery-rotated"]
        && draft.finishRequest === null) {
      throw recoveryError("recovery-state-invalid");
    }
    if (!final && STAGES[draft.stage] >= STAGES["recovery-authenticated"]
        && STAGES[draft.stage] < STAGES["recovery-rotated"]
        && (draft.finishResponse === null || draft.account === null
          || draft.recoveryVersion < 1 || draft.keySetVersion < 1)) {
      throw recoveryError("recovery-state-invalid");
    }
    if (!final && STAGES[draft.stage] >= STAGES["content-ready"]
        && (draft.content === null || draft.deviceEnvelope === null
          || draft.confirmedRemoteRevision < 1)) throw recoveryError("recovery-state-invalid");
    if (!final && STAGES[draft.stage] >= STAGES["device-envelope-committed"]
        && (draft.keySetVersion < 2 || draft.deviceGrant === null)) {
      throw recoveryError("recovery-state-invalid");
    }
    if (!final && STAGES[draft.stage] >= STAGES["rotation-pending"]
        && (draft.replacementRecoveryRoot === null
          || draft.replacementRecoveryVerifier === null
          || draft.replacementRecoveryAuthorisation === null
          || draft.replacementRecoveryEnvelope === null)) {
      throw recoveryError("recovery-state-invalid");
    }
    if (draft.replacementRecoveryVerifier !== null) {
      validateRecoveryVerifier(draft.replacementRecoveryVerifier);
    }
    if (draft.replacementRecoveryAuthorisation !== null) {
      validateRecoveryAuthorisation(draft.replacementRecoveryAuthorisation);
    }
    if (!final && STAGES[draft.stage] >= STAGES["recovery-rotated"]
        && draft.replacementAccountLocator === null) throw recoveryError("recovery-state-invalid");
    if (draft.stage === "replacement-copy-pending"
        && draft.replacementRecoveryPackage === null) throw recoveryError("recovery-state-invalid");
    if (draft.stage === "ready-for-adoption") {
      if (!draft.replacementRecoveryCopyStored || draft.account === null || draft.ids !== null
          || draft.oldRecoveryPackage !== null || draft.beginRequest !== null
          || draft.beginResponse !== null || draft.finishRequest !== null
          || draft.finishResponse !== null || draft.content !== null || draft.deviceEnvelope !== null
          || draft.replacementRecoveryRoot !== null || draft.replacementRecoveryVerifier !== null
          || draft.replacementRecoveryAuthorisation !== null
          || draft.replacementRecoveryEnvelope !== null
          || draft.replacementAccountLocator !== null || draft.replacementRecoveryPackage !== null
          || draft.pendingOperation !== null) throw recoveryError("recovery-state-invalid");
    } else if (draft.ids === null
        || (STAGES[draft.stage] < STAGES["recovery-rotated"]
          && draft.oldRecoveryPackage === null)) {
      throw recoveryError("recovery-state-invalid");
    }
    return deepFreeze(jsonClone(draft));
  }

  function successResult(draft) {
    return deepFreeze({
      ok: true,
      reason: "recovery-ready",
      recoveryAttemptId: draft.recoveryAttemptId,
      adopted: false,
      readyForAdoption: true,
      locallyDurable: true,
      remotelyCommitted: true,
      replacementRecoveryCopyStored: true,
      confirmedRemoteRevision: draft.confirmedRemoteRevision,
      keySetVersion: draft.keySetVersion,
      recoveryVersion: draft.recoveryVersion,
      syncPending: false,
    });
  }

  function beginAttentionReason(draft) {
    return draft.stage === "begin-pending"
      ? BEGIN_ATTENTION_REASONS[draft.pendingOperation] || null : null;
  }

  function isLegacyPreAuthorityBeginAttention(draft) {
    return draft.stage === "begin-pending"
      && ["begin-attention-rejected", "begin-attention-generic-rejected"].includes(draft.pendingOperation)
      && draft.beginResponse === null
      && draft.finishRequest === null
      && draft.finishResponse === null
      && draft.confirmedRemoteRevision === 0
      && draft.content === null
      && draft.deviceEnvelope === null
      && draft.replacementRecoveryRoot === null
      && draft.replacementRecoveryVerifier === null
      && draft.replacementRecoveryAuthorisation === null
      && draft.replacementRecoveryEnvelope === null
      && draft.replacementAccountLocator === null
      && draft.replacementRecoveryPackage === null
      && draft.account === null
      && draft.keySetVersion === 0
      && draft.recoveryVersion === 0
      && draft.deviceGrant === null
      && draft.replacementRecoveryCopyStored === false;
  }

  function createRecoveryOrchestrator(configuration) {
    const config = validateFactory(configuration);
    const format = config.deviceStore.FORMAT || global.PocketSyncDeviceStore?.FORMAT;
    if (!format || format.recoveryStagingKind !== "pocket.sync.recovery-staging"
        || !Number.isSafeInteger(format.recordSchemaVersion)) {
      throw recoveryError("recovery-device-store-invalid");
    }

    async function ensureTarget(execution) {
      let current = false;
      try {
        current = execution.dependencies.isRecoveryTargetCurrent(execution.target) === true;
      } catch (_error) {}
      if (!current) throw recoveryError("recovery-target-changed");
    }

    async function checked(execution, promise) {
      const value = await promise;
      await ensureTarget(execution);
      return value;
    }

    function changedDraft(draft, changes) {
      return Object.assign({}, jsonClone(draft), changes);
    }

    async function reserveDeviceWrappingKeyUsage(execution, increment) {
      const current = execution.record;
      if (!current) throw recoveryError("recovery-state-invalid");
      const reserved = await checked(execution,
        config.deviceStore.reserveRecoveryStagingEncryptionUsage(
          current.syncedPocketId,
          current.storeRevision,
          current.usage.deviceWrappingKeyEncryptions,
          increment
        ));
      execution.record = reserved;
      return reserved;
    }

    async function persistDraft(execution, nextInput, alreadyReserved = false) {
      const current = execution.record;
      const nextRevision = current ? current.storeRevision + 1 : 1;
      const nextDraft = validateDraft(Object.assign({}, nextInput, {
        updatedAt: timestamp(config.now),
      }), config);
      const context = {
        syncedPocketId: nextDraft.syncedPocketId,
        revision: nextRevision,
        contentType: config.crypto.FORMAT.contentType,
      };
      const key = current ? current.deviceWrappingKey : execution.deviceWrappingKey;
      if (current && !alreadyReserved) await reserveDeviceWrappingKeyUsage(execution, 1);
      const reserved = execution.record;
      const deviceWrappingKeyEncryptions = reserved
        ? reserved.usage.deviceWrappingKeyEncryptions : 1;
      const encrypted = await checked(execution, config.crypto.sealContent(nextDraft, key, context));
      const nextRecord = {
        kind: format.recoveryStagingKind,
        schemaVersion: format.recoveryStagingSchemaVersion,
        storeRevision: nextRevision,
        syncedPocketId: nextDraft.syncedPocketId,
        deviceId: nextDraft.deviceId,
        deviceWrappingKey: key,
        recoveryDraft: { context, record: encrypted },
        usage: { deviceWrappingKeyEncryptions },
      };
      const stored = current
        ? await checked(execution, config.deviceStore.replaceRecoveryStaging(
          nextDraft.syncedPocketId, reserved.storeRevision, nextRecord
        ))
        : await checked(execution, config.deviceStore.createRecoveryStaging(nextRecord));
      execution.record = stored;
      execution.draft = nextDraft;
      return nextDraft;
    }

    function remoteFailure(reason, execution, extra) {
      return safeFailure(reason, Object.assign({
        recoveryAttemptId: execution.draft.recoveryAttemptId,
        locallyDurable: true,
        remotelyCommitted: STAGES[execution.draft.stage] >= STAGES["recovery-authenticated"],
        resumable: true,
      }, extra || {}));
    }

    async function persistBeginAttention(reason, execution) {
      const pendingOperation = BEGIN_ATTENTION_OPERATIONS[reason];
      if (!pendingOperation) return safeFailure("recovery-state-invalid", {
        recoveryAttemptId: execution.draft.recoveryAttemptId,
        locallyDurable: execution.record !== null,
        remotelyCommitted: false,
        resumable: false,
      });
      try {
        await persistDraft(execution, changedDraft(execution.draft, { pendingOperation }));
      } catch (_error) {
        return safeFailure("recovery-state-invalid", {
          recoveryAttemptId: execution.draft.recoveryAttemptId,
          locallyDurable: execution.record !== null,
          remotelyCommitted: false,
          resumable: false,
        });
      }
      return remoteFailure(reason, execution, { resumable: false });
    }

    async function beginFailure(error, execution) {
      if (error?.retryable === true) return remoteFailure("recovery-begin-unavailable", execution);
      if (error?.status === 410) {
        return persistBeginAttention("recovery-begin-expired", execution);
      }
      if (error?.status === 404) {
        return persistBeginAttention("recovery-begin-not-found", execution);
      }
      if (error?.status === 400) {
        return persistBeginAttention("recovery-begin-request-rejected", execution);
      }
      if (error?.status === 401) {
        return persistBeginAttention("recovery-begin-authentication-rejected", execution);
      }
      if (error?.status === 403) {
        return persistBeginAttention("recovery-begin-authorisation-rejected", execution);
      }
      if (error?.status === 409) {
        return persistBeginAttention("recovery-begin-conflict", execution);
      }
      if ([405, 413, 415].includes(error?.status)) {
        return persistBeginAttention("recovery-begin-http-shell-rejected", execution);
      }
      if (error?.code === "remote-redirect-rejected") {
        return persistBeginAttention("recovery-begin-redirect-rejected", execution);
      }
      if (error?.recoveryBeginFailureClass === "service-state-invalid") {
        return persistBeginAttention("recovery-begin-service-state-invalid", execution);
      }
      if (error?.recoveryBeginFailureClass === "storage-failed") {
        return persistBeginAttention("recovery-begin-storage-failed", execution);
      }
      if (error?.recoveryBeginFailureClass === "server-contract-invalid") {
        return persistBeginAttention("recovery-begin-server-contract-invalid", execution);
      }
      if (error?.status === 500 || error?.recoveryBeginFailureClass === "server-internal") {
        return persistBeginAttention("recovery-begin-server-internal", execution);
      }
      if (Number.isSafeInteger(error?.status)) {
        return persistBeginAttention("recovery-begin-rejected", execution);
      }
      return persistBeginAttention("recovery-begin-response-invalid", execution);
    }

    async function beginRecovery(execution) {
      if (STAGES[execution.draft.stage] >= STAGES["ceremony-ready"]) return null;
      const request = execution.draft.beginRequest || {
        apiVersion: 1,
        operationId: execution.draft.ids.recoveryOperationId,
        accountLocator: execution.draft.oldRecoveryPackage.accountLocator,
        deviceId: execution.draft.deviceId,
      };
      if (execution.draft.stage !== "begin-pending") {
        await persistDraft(execution, changedDraft(execution.draft, {
          stage: "begin-pending", beginRequest: request, pendingOperation: "begin-recovery",
        }));
      }
      let response;
      try { response = await checked(execution, config.recoveryService.beginRecovery(request)); }
      catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return beginFailure(error, execution);
      }
      if (response.operationId !== request.operationId
          || response.recoveryVersion < 1
          || !Number.isSafeInteger(response.keySetVersion) || response.keySetVersion < 1) {
        return persistBeginAttention("recovery-begin-response-invalid", execution);
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "ceremony-ready", beginResponse: response, recoveryVersion: response.recoveryVersion,
        pendingOperation: null,
      }));
      return null;
    }

    async function restartLegacyBeginAttention(dependenciesInput, optionsInput) {
      let dependencies;
      let options;
      try {
        dependencies = validateDependencies(dependenciesInput);
        options = validateRestartOptions(optionsInput);
      } catch (_error) { return safeFailure("invalid-recovery-input"); }
      const execution = {
        dependencies, target: null, identity: null, destination: null, record: null, draft: null,
      };
      try {
        execution.target = dependencies.captureRecoveryTarget();
        execution.identity = targetIdentity(execution.target);
        if (execution.identity.ownerKind !== "none") return safeFailure("recovery-state-invalid");
        await ensureTarget(execution);
        await config.deviceStore.open();
        const matching = await config.deviceStore.findRecoveryAttempt({
          targetOwnerKind: execution.identity.ownerKind,
          targetContinuityId: execution.identity.continuityId,
        });
        if (matching?.state !== "match" || matching.recoveryAttemptId !== options.recoveryAttemptId) {
          return safeFailure("recovery-state-invalid");
        }
        const found = await config.deviceStore.readRecoveryAttempt(options.recoveryAttemptId);
        if (!found?.record || !found?.draft
            || found.record.kind !== format.recoveryStagingKind) {
          return safeFailure("recovery-state-invalid");
        }
        execution.record = found.record;
        execution.draft = validateDraft(found.draft, config);
        if (execution.draft.recoveryAttemptId !== options.recoveryAttemptId
            || !recoveryTargetMatches(execution.identity, execution.draft)
            || !isLegacyPreAuthorityBeginAttention(execution.draft)) {
          return safeFailure("recovery-state-invalid");
        }
        await ensureTarget(execution);
        await config.deviceStore.discardRecoveryStaging(
          execution.record.syncedPocketId,
          execution.record.storeRevision
        );
        return deepFreeze({ ok: true, recoveryRestarted: true, adopted: false,
          sourceOwnerPreserved: true });
      } catch (_error) {
        return safeFailure("recovery-state-invalid", {
          recoveryAttemptId: options.recoveryAttemptId,
          locallyDurable: execution.record !== null,
          resumable: false,
        });
      }
    }

    async function prepareFinish(execution) {
      if (STAGES[execution.draft.stage] >= STAGES["finish-ready"]) return null;
      if (Date.parse(execution.draft.beginResponse.expiresAt) <= config.now()) {
        return remoteFailure("recovery-ceremony-expired", execution, { resumable: false });
      }
      let proof;
      let serialised;
      try {
        let credential;
        try {
          credential = await checked(execution, config.webAuthn.createCredential(
            execution.draft.beginResponse.publicKeyCreationOptions
          ));
        } catch (error) {
          if (error?.code === "recovery-target-changed") throw error;
          return remoteFailure(error?.name === "NotAllowedError"
            ? "recovery-credential-cancelled" : "recovery-credential-failed", execution);
        }
        serialised = config.accountContract.serializeRegistrationCredential(
          credential,
          execution.draft.beginResponse.prfEvaluationInput
        );
        const credentialDigest = await checked(execution,
          config.crypto.digestRecoveryCredential(serialised.credential));
        try {
          proof = validateProof(await checked(execution, config.crypto.signRecoveryAuthorisation(
            execution.draft.oldRecoveryPackage.recoveryAuthorisation,
            {
              recoveryCeremonyId: execution.draft.beginResponse.recoveryCeremonyId,
              operationId: execution.draft.ids.recoveryOperationId,
              challenge: execution.draft.beginResponse.challenge,
              syncedPocketId: execution.draft.syncedPocketId,
              deviceId: execution.draft.deviceId,
              recoveryVersion: execution.draft.recoveryVersion,
              keySetVersion: execution.draft.beginResponse.keySetVersion,
              expiresAt: execution.draft.beginResponse.expiresAt,
              credentialDigest,
            }
          )));
        } finally { credentialDigest.fill(0); }
        const request = {
          apiVersion: 1,
          operationId: execution.draft.ids.recoveryOperationId,
          recoveryCeremonyId: execution.draft.beginResponse.recoveryCeremonyId,
          deviceId: execution.draft.deviceId,
          proof,
          credential: serialised.credential,
        };
        await persistDraft(execution, changedDraft(execution.draft, {
          stage: "finish-ready", finishRequest: request, pendingOperation: null,
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure(error?.code === "recovery-proof-failed"
          ? "recovery-proof-failed" : "recovery-credential-failed", execution);
      } finally {
        if (serialised?.prf?.outputBytes) serialised.prf.outputBytes.fill(0);
      }
      return null;
    }

    async function finishRecovery(execution) {
      if (STAGES[execution.draft.stage] >= STAGES["recovery-authenticated"]) return null;
      if (execution.draft.stage !== "finish-pending") {
        await persistDraft(execution, changedDraft(execution.draft, {
          stage: "finish-pending", pendingOperation: "finish-recovery",
        }));
      }
      let response;
      try {
        response = await checked(execution,
          config.recoveryService.finishRecovery(execution.draft.finishRequest));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("recovery-finish-unavailable", execution);
      }
      if (response.syncedPocketId !== execution.draft.syncedPocketId
          || response.recoveryVersion !== execution.draft.recoveryVersion
          || response.recoveryEnvelope?.envelopeVersion !== execution.draft.recoveryVersion
          || response.credentialId !== execution.draft.finishRequest.credential.id) {
        return remoteFailure("recovery-finish-failed", execution, { resumable: false });
      }
      const account = {
        accountId: response.accountId,
        credentialId: response.credentialId,
        credentialVersion: response.credentialVersion,
        accountPolicyVersion: response.accountPolicyVersion,
      };
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "recovery-authenticated", finishResponse: response, account,
        keySetVersion: response.keySetVersion, pendingOperation: null,
      }));
      return null;
    }

    function recoveryEnvelopeContext(draft) {
      return {
        syncedPocketId: draft.syncedPocketId,
        envelopeId: draft.finishResponse.recoveryEnvelope.envelopeId,
        envelopeKind: "recovery",
        envelopeVersion: draft.recoveryVersion,
      };
    }

    async function openMaster(execution, additionalPlans) {
      const root = decodeBase64Url(execution.draft.oldRecoveryPackage.rootMaterial, 32);
      try {
        const envelope = execution.draft.finishResponse.recoveryEnvelope;
        const context = recoveryEnvelopeContext(execution.draft);
        const wrappingKey = await checked(execution, config.crypto.deriveWrappingKey(
          root, envelope.kdfSalt, context
        ));
        return await checked(execution, config.crypto.openMasterKeyBundle(
          envelope.encryptedEnvelope, wrappingKey, context, additionalPlans || []
        ));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        throw recoveryError("recovery-envelope-open-failed");
      } finally { root.fill(0); }
    }

    async function recoverContent(execution) {
      if (STAGES[execution.draft.stage] >= STAGES["content-ready"]) return null;
      const deviceContext = {
        syncedPocketId: execution.draft.syncedPocketId,
        envelopeId: execution.draft.ids.deviceEnvelopeId,
        envelopeKind: "device",
        envelopeVersion: 1,
      };
      let bundle;
      try {
        bundle = await openMaster(execution, []);
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("recovery-envelope-open-failed", execution, { resumable: false });
      }
      if (execution.draft.pendingOperation !== "revision-read") {
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: "revision-read",
        }));
      }
      let revision;
      try {
        revision = await checked(execution, config.contentService.readRevision({
          apiVersion: 1,
          operationId: execution.draft.ids.revisionReadOperationId,
          syncedPocketId: execution.draft.syncedPocketId,
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("remote-content-unavailable", execution);
      }
      if (!revision.recordPresent || revision.revision < 1) {
        return remoteFailure("remote-content-unavailable", execution, { resumable: false });
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        confirmedRemoteRevision: revision.revision,
        pendingOperation: "content-download",
      }));
      let downloaded;
      try {
        downloaded = await checked(execution, config.contentService.downloadEncryptedRecord({
          apiVersion: 1,
          operationId: execution.draft.ids.contentDownloadOperationId,
          syncedPocketId: execution.draft.syncedPocketId,
          revision: execution.draft.confirmedRemoteRevision,
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("remote-content-changed", execution);
      }
      if (downloaded.revision !== execution.draft.confirmedRemoteRevision) {
        return remoteFailure("remote-content-changed", execution);
      }
      const contentContext = {
        syncedPocketId: execution.draft.syncedPocketId,
        revision: downloaded.revision,
        contentType: config.crypto.FORMAT.contentType,
      };
      let payload;
      try {
        payload = await checked(execution, config.crypto.openContent(
          downloaded.encryptedRecord,
          bundle.masterKey,
          contentContext
        ));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("remote-content-unavailable", execution, { resumable: false });
      }
      let valid;
      try { valid = await checked(execution, execution.dependencies.validateRecoveredPayload(payload)); }
      catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        valid = null;
      }
      payload = null;
      if (!(valid === true || (isObject(valid) && valid.ok === true))) {
        return remoteFailure("recovered-content-invalid", execution, { resumable: false });
      }
      let wrapped;
      try {
        // This transition creates both a device-key-wrapped master-key envelope
        // and the next encrypted recovery draft. Reserve capacity before either.
        await reserveDeviceWrappingKeyUsage(execution, 2);
        wrapped = await openMaster(execution, [{
          context: deviceContext,
          wrappingKey: execution.record.deviceWrappingKey,
        }]);
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("recovery-envelope-open-failed", execution, { resumable: false });
      }
      const deviceEnvelope = {
        envelopeId: deviceContext.envelopeId,
        envelopeKind: "device",
        envelopeVersion: 1,
        deviceId: execution.draft.deviceId,
        credentialId: null,
        kdf: "none",
        kdfSalt: null,
        derivationVersion: null,
        encryptedEnvelope: wrapped.envelopes[0].record,
      };
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "content-ready",
        content: { context: contentContext, record: downloaded.encryptedRecord },
        deviceEnvelope,
        pendingOperation: null,
      }), true);
      return null;
    }

    function attemptKind(draft, pending) {
      return draft.pendingOperation === pending ? "idempotent-retry" : "new-change";
    }

    async function addDeviceEnvelope(execution) {
      if (STAGES[execution.draft.stage] >= STAGES["device-envelope-committed"]) return null;
      if (execution.draft.pendingOperation === "device-envelope-conflict") {
        return remoteFailure("device-envelope-conflict", execution, { resumable: false });
      }
      const kind = attemptKind(execution.draft, "device-envelope");
      if (execution.draft.stage !== "device-envelope-pending" || kind === "idempotent-retry") {
        await persistDraft(execution, changedDraft(execution.draft, {
          stage: "device-envelope-pending", pendingOperation: "device-envelope",
        }));
      }
      let response;
      try {
        response = await checked(execution, config.envelopeService.addEnvelope({
          apiVersion: 1,
          operationId: execution.draft.ids.deviceEnvelopeOperationId,
          logicalChangeId: execution.draft.ids.deviceEnvelopeLogicalChangeId,
          attemptKind: kind,
          syncedPocketId: execution.draft.syncedPocketId,
          expectedKeySetVersion: execution.draft.keySetVersion,
          envelope: execution.draft.deviceEnvelope,
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("device-envelope-failed", execution);
      }
      if (response.conflict === true) {
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: "device-envelope-conflict",
        }));
        return remoteFailure("device-envelope-conflict", execution, { resumable: false });
      }
      if (response.keySetVersion !== execution.draft.keySetVersion + 1) {
        return remoteFailure("device-envelope-failed", execution, { resumable: false });
      }
      if (response.masterKeyGeneration !== 1
          || response.masterKeyContentEncryptionLimit !== 2 ** 20) {
        return remoteFailure("device-envelope-failed", execution, { resumable: false });
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "device-envelope-committed", keySetVersion: response.keySetVersion,
        pendingOperation: null, deviceGrant: {
          masterKeyGeneration: response.masterKeyGeneration,
          masterKeyContentEncryptionLimit: response.masterKeyContentEncryptionLimit,
        },
      }));
      return null;
    }

    async function prepareReplacement(execution) {
      if (execution.draft.replacementRecoveryRoot !== null) return null;
      const oldRoot = decodeBase64Url(execution.draft.oldRecoveryPackage.rootMaterial, 32);
      const nextRoot = freshBytes(config.randomBytes, 32);
      if (config.crypto.encodeBase64Url(oldRoot) === config.crypto.encodeBase64Url(nextRoot)) {
        oldRoot.fill(0); nextRoot.fill(0); throw recoveryError("recovery-state-invalid");
      }
      const nextVersion = execution.draft.recoveryVersion + 1;
      const context = {
        syncedPocketId: execution.draft.syncedPocketId,
        envelopeId: execution.draft.ids.replacementRecoveryEnvelopeId,
        envelopeKind: "recovery",
        envelopeVersion: nextVersion,
      };
      try {
        const derived = await checked(execution, config.crypto.createDerivedWrappingKey(
          nextRoot, context
        ));
        const authorisation = await checked(execution,
          config.crypto.createRecoveryAuthorisationKeyPair());
        const verifier = authorisation.recoveryVerifier;
        const currentContext = {
          syncedPocketId: execution.draft.syncedPocketId,
          envelopeId: execution.draft.deviceEnvelope.envelopeId,
          envelopeKind: "device",
          envelopeVersion: 1,
        };
        const bundle = await checked(execution, config.crypto.openMasterKeyBundle(
          execution.draft.deviceEnvelope.encryptedEnvelope,
          execution.record.deviceWrappingKey,
          currentContext,
          [{ context, wrappingKey: derived.key }]
        ));
        const envelope = {
          envelopeId: context.envelopeId,
          envelopeKind: "recovery",
          envelopeVersion: nextVersion,
          deviceId: null,
          credentialId: null,
          kdf: derived.kdf,
          kdfSalt: derived.kdfSalt,
          derivationVersion: derived.derivationVersion,
          encryptedEnvelope: bundle.envelopes[0].record,
        };
        await persistDraft(execution, changedDraft(execution.draft, {
          replacementRecoveryRoot: config.crypto.encodeBase64Url(nextRoot),
          replacementRecoveryVerifier: verifier,
          replacementRecoveryAuthorisation: authorisation.recoveryAuthorisation,
          replacementRecoveryEnvelope: envelope,
        }));
      } finally { oldRoot.fill(0); nextRoot.fill(0); }
      return null;
    }

    async function rotateRecovery(execution) {
      if (STAGES[execution.draft.stage] >= STAGES["recovery-rotated"]) return null;
      if (execution.draft.pendingOperation === "recovery-rotation-conflict") {
        return remoteFailure("recovery-rotation-conflict", execution, { resumable: false });
      }
      const kind = attemptKind(execution.draft, "recovery-rotation");
      if (execution.draft.stage !== "rotation-pending" || kind === "idempotent-retry") {
        await persistDraft(execution, changedDraft(execution.draft, {
          stage: "rotation-pending", pendingOperation: "recovery-rotation",
        }));
      }
      let response;
      try {
        response = await checked(execution, config.recoveryService.rotateRecovery({
          apiVersion: 1,
          operationId: execution.draft.ids.rotationOperationId,
          logicalChangeId: execution.draft.ids.rotationLogicalChangeId,
          attemptKind: kind,
          recoveryOperationId: execution.draft.ids.recoveryOperationId,
          syncedPocketId: execution.draft.syncedPocketId,
          expectedKeySetVersion: execution.draft.keySetVersion,
          expectedRecoveryVersion: execution.draft.recoveryVersion,
          recoveryVerifier: execution.draft.replacementRecoveryVerifier,
          recoveryEnvelope: execution.draft.replacementRecoveryEnvelope,
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("recovery-rotation-failed", execution);
      }
      if (response.conflict === true) {
        await persistDraft(execution, changedDraft(execution.draft, {
          pendingOperation: "recovery-rotation-conflict",
        }));
        return remoteFailure("recovery-rotation-conflict", execution, { resumable: false });
      }
      if (response.keySetVersion !== execution.draft.keySetVersion + 1
          || response.recoveryVersion !== execution.draft.recoveryVersion + 1
          || response.previousRecoveryInvalidated !== true
          || response.replacementCopyRequired !== true) {
        return remoteFailure("recovery-rotation-failed", execution, { resumable: false });
      }
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "recovery-rotated",
        keySetVersion: response.keySetVersion,
        recoveryVersion: response.recoveryVersion,
        replacementAccountLocator: response.accountLocator,
        oldRecoveryPackage: null,
        beginRequest: null,
        beginResponse: null,
        finishRequest: null,
        finishResponse: null,
        pendingOperation: null,
      }));
      return null;
    }

    async function prepareReplacementPackage(execution) {
      if (STAGES[execution.draft.stage] >= STAGES["replacement-copy-pending"]) return null;
      let built;
      try {
        built = await checked(execution, execution.dependencies.buildRecoveryPackage({
          packageVersion: 2,
          accountLocator: execution.draft.replacementAccountLocator,
          syncedPocketId: execution.draft.syncedPocketId,
          rootMaterial: execution.draft.replacementRecoveryRoot,
          rootBits: 256,
          recoveryAuthorisation: execution.draft.replacementRecoveryAuthorisation,
          instructions: [config.securityContract.RECOVERY_COPY.body],
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("replacement-recovery-copy-not-stored", execution,
          { replacementRecoveryCopyRequired: true });
      }
      const candidate = built?.ok === true && built.value ? built.value : built;
      const recoveryPackage = validatePackage(candidate, config, "recovery-state-invalid");
      await persistDraft(execution, changedDraft(execution.draft, {
        stage: "replacement-copy-pending",
        replacementRecoveryPackage: recoveryPackage,
      }));
      return null;
    }

    async function writeReplacementPackage(execution) {
      if (execution.draft.replacementRecoveryCopyStored) return null;
      if (!execution.destination) {
        let result;
        try {
          result = await checked(execution,
            execution.dependencies.prepareReplacementRecoveryCopyDestination());
        } catch (error) {
          if (error?.code === "recovery-target-changed") throw error;
          result = null;
        }
        execution.destination = result?.ok === true ? result.destination : null;
      }
      if (!execution.destination) return remoteFailure(
        "replacement-recovery-copy-not-stored", execution,
        { replacementRecoveryCopyRequired: true }
      );
      let written;
      try {
        written = await checked(execution, execution.dependencies.writeReplacementRecoveryCopy({
          destination: execution.destination,
          recoveryPackage: execution.draft.replacementRecoveryPackage,
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        written = null;
      }
      if (!(written === true || written?.ok === true)) return remoteFailure(
        "replacement-recovery-copy-not-stored", execution,
        { replacementRecoveryCopyRequired: true }
      );
      try {
        await persistDraft(execution, changedDraft(execution.draft, {
          replacementRecoveryCopyStored: true,
        }));
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("device-finalisation-failed", execution, { resumable: true });
      }
      return null;
    }

    async function finalise(execution) {
      const current = execution.record;
      const nextRevision = current.storeRevision + 1;
      const deviceGrant = execution.draft.deviceGrant;
      const safeDraft = validateDraft(changedDraft(execution.draft, {
        stage: "ready-for-adoption",
        ids: null,
        oldRecoveryPackage: null,
        beginRequest: null,
        beginResponse: null,
        finishRequest: null,
        finishResponse: null,
        content: null,
        deviceEnvelope: null,
        replacementRecoveryRoot: null,
        replacementRecoveryVerifier: null,
        replacementRecoveryAuthorisation: null,
        replacementRecoveryEnvelope: null,
        replacementAccountLocator: null,
        replacementRecoveryPackage: null,
        deviceGrant: null,
        pendingOperation: null,
        replacementRecoveryCopyStored: true,
        updatedAt: timestamp(config.now),
      }), config);
      const draftContext = {
        syncedPocketId: safeDraft.syncedPocketId,
        revision: nextRevision,
        contentType: config.crypto.FORMAT.contentType,
      };
      const envelope = execution.draft.deviceEnvelope;
      const createdAt = timestamp(config.now);
      try {
        await reserveDeviceWrappingKeyUsage(execution, 1);
        const reserved = execution.record;
        const deviceWrappingKeyEncryptions = reserved.usage.deviceWrappingKeyEncryptions;
        const encryptedDraft = await checked(execution, config.crypto.sealContent(
          safeDraft, reserved.deviceWrappingKey, draftContext
        ));
        const finalRecord = {
          kind: format.recordKind,
          schemaVersion: format.recordSchemaVersion,
          storeRevision: nextRevision,
          syncedPocketId: safeDraft.syncedPocketId,
          deviceId: safeDraft.deviceId,
          deviceWrappingKey: reserved.deviceWrappingKey,
          deviceEnvelope: {
            context: {
              syncedPocketId: safeDraft.syncedPocketId,
              envelopeId: envelope.envelopeId,
              envelopeKind: "device",
              envelopeVersion: 1,
            },
            metadata: {
              contractVersion: 1,
              syncedPocketId: safeDraft.syncedPocketId,
              envelopeId: envelope.envelopeId,
              kind: "device",
              version: 1,
              deviceId: safeDraft.deviceId,
              createdAt,
              kdf: "none",
            },
            record: envelope.encryptedEnvelope,
          },
          content: execution.draft.content,
          remote: { confirmedRevision: safeDraft.confirmedRemoteRevision, pending: null, conflict: null },
          usage: {
            masterKeyGeneration: deviceGrant.masterKeyGeneration,
            masterKeyContentEncryptions: 0,
            masterKeyContentEncryptionLimit: deviceGrant.masterKeyContentEncryptionLimit,
            deviceWrappingKeyEncryptions,
          },
          activationDraft: null,
          recoveryDraft: { context: draftContext, record: encryptedDraft },
          additionalDeviceDraft: null,
        };
        const stored = await checked(execution, config.deviceStore.promoteRecoveryStaging(
          safeDraft.syncedPocketId, reserved.storeRevision, finalRecord
        ));
        execution.record = stored;
        execution.draft = safeDraft;
      } catch (error) {
        if (error?.code === "recovery-target-changed") throw error;
        return remoteFailure("device-finalisation-failed", execution, { resumable: true });
      }
      return successResult(execution.draft);
    }

    async function continueRecovery(execution) {
      for (const step of [beginRecovery, prepareFinish, finishRecovery, recoverContent,
        addDeviceEnvelope, prepareReplacement, rotateRecovery, prepareReplacementPackage,
        writeReplacementPackage]) {
        const result = await step(execution);
        if (result) return result;
      }
      return finalise(execution);
    }

    async function recover(dependenciesInput, optionsInput) {
      let dependencies;
      let options;
      try {
        dependencies = validateDependencies(dependenciesInput);
        options = validateRecoverOptions(optionsInput);
      } catch (_error) { return safeFailure("invalid-recovery-input"); }
      let target;
      let identity;
      try {
        target = dependencies.captureRecoveryTarget();
        identity = targetIdentity(target);
      } catch (error) {
        return safeFailure(error?.code === "unsupported-recovery-target"
          ? error.code : "invalid-recovery-input");
      }
      const execution = {
        dependencies, target, identity, destination: null, record: null, draft: null,
        deviceWrappingKey: null,
      };
      try {
        await ensureTarget(execution);
        const packageInput = await checked(execution, dependencies.readRecoveryPackage());
        let recoveryPackage;
        try { recoveryPackage = validatePackage(packageInput, config); }
        catch (_error) { return safeFailure("recovery-package-invalid"); }
        try {
          await checked(execution, config.crypto.validateRecoveryAuthorisation(
            recoveryPackage.recoveryAuthorisation
          ));
        } catch (_error) { return safeFailure("recovery-package-invalid"); }
        await checked(execution, config.deviceStore.open());
        if (await checked(execution,
          config.deviceStore.readStoredRecord(recoveryPackage.syncedPocketId)) !== null) {
          return safeFailure("device-staging-failed");
        }
        const destination = await checked(
          execution, dependencies.prepareReplacementRecoveryCopyDestination()
        );
        execution.destination = destination?.ok === true ? destination.destination : null;
        if (!execution.destination) return safeFailure("replacement-copy-destination-deferred");
        const recoveryAttemptId = freshId(config);
        if (await checked(execution,
          config.deviceStore.readRecoveryAttempt(recoveryAttemptId)) !== null) {
          return safeFailure("device-staging-failed");
        }
        const ids = {};
        ID_FIELDS.forEach((field) => { ids[field] = freshId(config); });
        execution.deviceWrappingKey = await checked(
          execution, config.crypto.generateDeviceWrappingKey()
        );
        const createdAt = timestamp(config.now);
        const draft = {
          kind: "pocket.sync.emergency-recovery-draft",
          schemaVersion: 1,
          recoveryAttemptId,
          stage: "package-staged",
          targetOwnerKind: identity.ownerKind,
          targetContinuityId: identity.continuityId,
          syncedPocketId: recoveryPackage.syncedPocketId,
          deviceId: options.deviceId,
          ids,
          oldRecoveryPackage: recoveryPackage,
          beginRequest: null,
          beginResponse: null,
          finishRequest: null,
          finishResponse: null,
          confirmedRemoteRevision: 0,
          content: null,
          deviceEnvelope: null,
          replacementRecoveryRoot: null,
          replacementRecoveryVerifier: null,
          replacementRecoveryAuthorisation: null,
          replacementRecoveryEnvelope: null,
          replacementAccountLocator: null,
          replacementRecoveryPackage: null,
          account: null,
          keySetVersion: 0,
          recoveryVersion: 0,
          deviceGrant: null,
          pendingOperation: null,
          replacementRecoveryCopyStored: false,
          createdAt,
          updatedAt: createdAt,
        };
        await persistDraft(execution, draft);
        return await continueRecovery(execution);
      } catch (error) {
        if (error?.code === "recovery-target-changed") return safeFailure(error.code, {
          recoveryAttemptId: execution.draft?.recoveryAttemptId,
          locallyDurable: execution.record !== null,
          resumable: execution.record !== null,
        });
        return safeFailure(error?.code === "recovery-envelope-open-failed"
          ? error.code : "recovery-state-invalid", {
          recoveryAttemptId: execution.draft?.recoveryAttemptId,
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
      } catch (_error) { return safeFailure("invalid-recovery-input"); }
      const execution = {
        dependencies, target: null, identity: null, destination: null, record: null, draft: null,
      };
      try {
        await config.deviceStore.open();
        const found = await config.deviceStore.readRecoveryAttempt(options.recoveryAttemptId);
        if (!found) return safeFailure("recovery-state-invalid");
        execution.record = found.record;
        execution.draft = validateDraft(found.draft, config);
        if (execution.draft.recoveryAttemptId !== options.recoveryAttemptId) {
          return safeFailure("recovery-state-invalid");
        }
        if (execution.draft.stage === "ready-for-adoption") return successResult(execution.draft);
        const attentionReason = beginAttentionReason(execution.draft);
        if (attentionReason) {
          return remoteFailure(attentionReason, execution, { resumable: false });
        }
        try {
          execution.target = dependencies.captureRecoveryTarget();
          execution.identity = targetIdentity(execution.target);
        } catch (error) {
          return safeFailure(error?.code === "unsupported-recovery-target"
            ? error.code : "invalid-recovery-input");
        }
        await ensureTarget(execution);
        if (!recoveryTargetMatches(execution.identity, execution.draft)) {
          return safeFailure("recovery-target-changed", {
            recoveryAttemptId: options.recoveryAttemptId, locallyDurable: true, resumable: true,
          });
        }
        return await continueRecovery(execution);
      } catch (error) {
        if (error?.code === "recovery-target-changed") return safeFailure(error.code, {
          recoveryAttemptId: options.recoveryAttemptId, locallyDurable: true, resumable: true,
        });
        return safeFailure("recovery-state-invalid", {
          recoveryAttemptId: options.recoveryAttemptId, locallyDurable: true, resumable: false,
        });
      }
    }

    return Object.freeze({ recover, resume, restartLegacyBeginAttention });
  }

  global.PocketSyncEmergencyRecovery = Object.freeze({ POLICY, createRecoveryOrchestrator });
})(typeof window !== "undefined" ? window : globalThis);
