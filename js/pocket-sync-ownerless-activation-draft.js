/* Ownerless first-create activation-v2 draft contract.

This module is intentionally unloaded. It defines the exact encrypted local
schema-v2 draft semantics and discovery identity only. It does not execute or
resume activation, call account/remote services, adopt an owner, or expose UI.
*/

(function initialisePocketSyncOwnerlessActivationDraft(global) {
  "use strict";

  const FIELDS = Object.freeze([
    "kind", "schemaVersion", "activationMode", "accountPath", "activationId",
    "stage", "syncedPocketId", "deviceId", "ids", "content", "deviceEnvelope",
    "prfEnvelope", "prfStatus", "recoveryEnvelope", "recoveryVerifier",
    "recoveryAuthorisation", "recoveryRoot", "recoveryPackage",
    "registrationContinuation", "account", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "accountLocator", "pendingOperation",
    "recoveryCopyStored", "adopted", "createdAt", "updatedAt",
  ]);
  const IDENTIFIER_FIELDS = Object.freeze([
    "deviceEnvelopeId", "prfEnvelopeId", "recoveryEnvelopeId",
    "registrationOperationId", "contentOperationId", "contentLogicalChangeId",
    "deviceEnvelopeOperationId", "deviceEnvelopeLogicalChangeId",
    "prfEnvelopeOperationId", "prfEnvelopeLogicalChangeId",
    "recoveryOperationId", "recoveryLogicalChangeId",
  ]);
  const STAGES = Object.freeze({
    "local-material-ready": 1,
    "device-staged": 2,
    "account-ready": 3,
    "content-committed": 4,
    "device-envelope-committed": 5,
    "prf-envelope-committed": 6,
    "prf-envelope-skipped": 6,
    "recovery-initialised": 7,
    "recovery-copy-pending": 8,
    "ready-for-adoption": 9,
    adopted: 10,
  });
  const ACCOUNT_PATHS = Object.freeze(["existing-unbound", "new-account"]);
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
  const POLICY = Object.freeze({
    kind: "pocket.sync.activation-draft",
    schemaVersion: 2,
    activationMode: "ownerless-first-create",
    fields: FIELDS,
    identifierFields: IDENTIFIER_FIELDS,
    stages: STAGES,
    accountPaths: ACCOUNT_PATHS,
    pendingOperations: PENDING_OPERATIONS,
  });
  const BASE64URL = /^[A-Za-z0-9_-]+$/;

  function contractError(code = "ownerless-activation-state-invalid") {
    const error = new Error(`Pocket ownerless activation draft ${code}.`);
    error.code = code;
    return error;
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function exactObject(value, fields, code = "ownerless-activation-state-invalid") {
    if (!isObject(value)
        || Object.keys(value).length !== fields.length
        || !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
      throw contractError(code);
    }
    return value;
  }

  function identifier(value, code = "ownerless-activation-state-invalid") {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > 160
        || value !== value.trim()) {
      throw contractError(code);
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
      throw contractError();
    }
  }

  function canonicalTime(value) {
    return typeof value === "string"
      && value === value.trim()
      && value.length > 0
      && value.length <= 80
      && Number.isFinite(Date.parse(value));
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

  function containsRawPrf(value, seen = new Set()) {
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "outputBytes")) return true;
    return Object.values(value).some((child) => containsRawPrf(child, seen));
  }

  function requireMethods(value, names) {
    if (!isObject(value) || names.some((name) => typeof value[name] !== "function")) {
      throw contractError("ownerless-activation-contract-invalid");
    }
    return value;
  }

  function validateFactory(input) {
    const config = exactObject(input, ["securityContract", "crypto"],
      "ownerless-activation-contract-invalid");
    requireMethods(config.securityContract, [
      "buildRecoveryPackage", "validateOpaqueMasterKeyEnvelopeRecord",
    ]);
    requireMethods(config.crypto, ["validateContentContext", "validateContentRecord"]);
    return config;
  }

  function validateEnvelope(input, kind, config) {
    const value = exactObject(input, [
      "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
      "kdf", "kdfSalt", "derivationVersion", "encryptedEnvelope",
    ]);
    identifier(value.envelopeId);
    if (value.envelopeKind !== kind || !Number.isSafeInteger(value.envelopeVersion)
        || value.envelopeVersion < 1) throw contractError();
    const opaque = config.securityContract.validateOpaqueMasterKeyEnvelopeRecord(value.encryptedEnvelope);
    if (!opaque || opaque.ok !== true) throw contractError();
    if (kind === "device") {
      identifier(value.deviceId);
      if (value.credentialId !== null || value.kdf !== "none"
          || value.kdfSalt !== null || value.derivationVersion !== null) throw contractError();
    } else {
      if (value.deviceId !== null || value.kdf !== "HKDF-SHA-256"
          || byteLength(value.kdfSalt) !== 32 || value.derivationVersion !== 1) {
        throw contractError();
      }
      if (kind === "passkey-prf") identifier(value.credentialId);
      else if (value.credentialId !== null) throw contractError();
    }
    return value;
  }

  function validateRecoveryVerifier(input) {
    const value = exactObject(input, ["version", "algorithm", "publicKeyFormat", "publicKey"]);
    if (value.version !== 1 || value.algorithm !== "Ed25519"
        || value.publicKeyFormat !== "spki"
        || byteLength(value.publicKey) < 32 || byteLength(value.publicKey) > 4096) {
      throw contractError();
    }
    return value;
  }

  function validateRecoveryAuthorisation(input) {
    const value = exactObject(input, ["version", "algorithm", "privateKeyFormat", "privateKey"]);
    if (value.version !== 1 || value.algorithm !== "Ed25519"
        || value.privateKeyFormat !== "pkcs8"
        || byteLength(value.privateKey) < 32 || byteLength(value.privateKey) > 4096) {
      throw contractError();
    }
    return value;
  }

  function validateStoredPackage(input, config) {
    if (input === null) return null;
    const value = exactObject(input, [
      "kind", "localOnly", "remoteUploadAllowed", "packageVersion", "accountLocator",
      "syncedPocketId", "rootMaterial", "rootBits", "recoveryAuthorisation", "checksum", "instructions",
    ]);
    const checked = config.securityContract.buildRecoveryPackage({
      packageVersion: value.packageVersion,
      accountLocator: value.accountLocator,
      syncedPocketId: value.syncedPocketId,
      rootMaterial: value.rootMaterial,
      rootBits: value.rootBits,
      recoveryAuthorisation: value.recoveryAuthorisation,
      checksum: value.checksum,
      instructions: value.instructions,
    });
    if (!checked || checked.ok !== true
        || value.kind !== "pocket-recovery-package"
        || value.localOnly !== true
        || value.remoteUploadAllowed !== false) throw contractError();
    return checked.value;
  }

  function validateRegistrationContinuation(input, draft, ids) {
    if (input === null) return null;
    const value = exactObject(input, [
      "apiVersion", "operationId", "ceremonyId", "deviceId", "prfEvaluationInput", "credential",
    ]);
    if (value.apiVersion !== 1
        || value.operationId !== ids.registrationOperationId
        || value.deviceId !== draft.deviceId
        || byteLength(value.prfEvaluationInput) !== 32
        || !isObject(value.credential)) throw contractError();
    identifier(value.ceremonyId);
    identifier(value.credential.id);
    return value;
  }

  function validateAccount(input) {
    if (input === null) return null;
    const value = exactObject(input, [
      "accountId", "credentialId", "credentialVersion", "accountPolicyVersion",
      "prfEvaluationInput",
    ]);
    identifier(value.accountId);
    identifier(value.credentialId);
    if (!Number.isSafeInteger(value.credentialVersion) || value.credentialVersion < 1
        || !Number.isSafeInteger(value.accountPolicyVersion) || value.accountPolicyVersion < 1
        || byteLength(value.prfEvaluationInput) !== 32) throw contractError();
    return value;
  }

  function stageAtLeast(draft, stage) {
    return STAGES[draft.stage] >= STAGES[stage];
  }

  function validateStageOperation(draft) {
    const registrationPending = ["account-registration", "account-registration-finish"]
      .includes(draft.pendingOperation);
    if (draft.accountPath === "existing-unbound") {
      if (registrationPending || draft.registrationContinuation !== null) throw contractError();
    }
    if (draft.accountPath === "new-account") {
      if (stageAtLeast(draft, "account-ready")) {
        if (registrationPending || draft.registrationContinuation !== null) throw contractError();
      } else if (draft.registrationContinuation !== null && !registrationPending) {
        throw contractError();
      }
      if (draft.pendingOperation === "account-registration-finish"
          && draft.registrationContinuation === null) throw contractError();
    }
    if (stageAtLeast(draft, "account-ready") !== (draft.account !== null)) {
      throw contractError();
    }
    if (stageAtLeast(draft, "ready-for-adoption") && draft.pendingOperation !== null) {
      throw contractError();
    }
  }

  function validate(input, configInput) {
    const config = validateFactory(configInput);
    if (containsRawPrf(input)) throw contractError();
    const draft = exactObject(input, FIELDS);
    if (draft.kind !== POLICY.kind
        || draft.schemaVersion !== POLICY.schemaVersion
        || draft.activationMode !== POLICY.activationMode
        || !ACCOUNT_PATHS.includes(draft.accountPath)
        || !Object.prototype.hasOwnProperty.call(STAGES, draft.stage)
        || !PENDING_OPERATIONS.includes(draft.pendingOperation)
        || typeof draft.recoveryCopyStored !== "boolean"
        || typeof draft.adopted !== "boolean"
        || !canonicalTime(draft.createdAt)
        || !canonicalTime(draft.updatedAt)) throw contractError();

    for (const value of [draft.activationId, draft.syncedPocketId, draft.deviceId]) identifier(value);

    const ids = exactObject(draft.ids, IDENTIFIER_FIELDS);
    IDENTIFIER_FIELDS.forEach((field) => identifier(ids[field]));

    const content = exactObject(draft.content, ["context", "record"]);
    try {
      const context = config.crypto.validateContentContext(content.context);
      config.crypto.validateContentRecord(content.record);
      if (context.syncedPocketId !== draft.syncedPocketId || context.revision !== 1) {
        throw contractError();
      }
    } catch (_error) {
      throw contractError();
    }

    validateEnvelope(draft.deviceEnvelope, "device", config);
    validateEnvelope(draft.recoveryEnvelope, "recovery", config);
    validateRecoveryVerifier(draft.recoveryVerifier);
    if (draft.recoveryAuthorisation !== null) validateRecoveryAuthorisation(draft.recoveryAuthorisation);

    if (!Number.isSafeInteger(draft.confirmedRemoteRevision)
        || ![0, 1].includes(draft.confirmedRemoteRevision)
        || !Number.isSafeInteger(draft.keySetVersion) || draft.keySetVersion < 0
        || ![0, 1].includes(draft.recoveryVersion)
        || !["pending", "available", "skipped"].includes(draft.prfStatus)) {
      throw contractError();
    }

    if (draft.prfEnvelope !== null) validateEnvelope(draft.prfEnvelope, "passkey-prf", config);
    if ((draft.prfStatus === "available") !== (draft.prfEnvelope !== null)) throw contractError();
    if (draft.recoveryRoot !== null && byteLength(draft.recoveryRoot) !== 32) throw contractError();

    validateRegistrationContinuation(draft.registrationContinuation, draft, ids);
    const account = validateAccount(draft.account);
    validateStageOperation(draft);

    if (stageAtLeast(draft, "content-committed") !== (draft.confirmedRemoteRevision === 1)) {
      throw contractError();
    }
    if (stageAtLeast(draft, "device-envelope-committed") && draft.keySetVersion < 1) {
      throw contractError();
    }

    if (stageAtLeast(draft, "recovery-initialised")) {
      if (draft.recoveryVersion !== 1 || draft.accountLocator === null
          || draft.keySetVersion < 2) throw contractError();
      identifier(draft.accountLocator);
      if (account && draft.accountLocator === account.accountId) throw contractError();
    } else if (draft.recoveryVersion !== 0 || draft.accountLocator !== null) {
      throw contractError();
    }

    const recoveryPackage = validateStoredPackage(draft.recoveryPackage, config);
    if (!stageAtLeast(draft, "ready-for-adoption") && draft.recoveryAuthorisation === null) {
      throw contractError();
    }
    if (draft.stage === "recovery-copy-pending" && recoveryPackage === null) throw contractError();

    if (stageAtLeast(draft, "ready-for-adoption")) {
      if (!draft.recoveryCopyStored || draft.recoveryRoot !== null
          || recoveryPackage !== null || draft.recoveryAuthorisation !== null) {
        throw contractError();
      }
    } else {
      if (draft.recoveryCopyStored || draft.recoveryRoot === null) throw contractError();
    }

    if (draft.stage === "prf-envelope-committed" && draft.prfStatus !== "available") {
      throw contractError();
    }
    if (draft.stage === "prf-envelope-skipped" && draft.prfStatus !== "skipped") {
      throw contractError();
    }
    if ((draft.stage === "adopted") !== draft.adopted) throw contractError();

    return deepFreeze(jsonClone(draft));
  }

  function buildInitialDraft(input, configInput) {
    const value = exactObject(input, [
      "accountPath", "activationId", "syncedPocketId", "deviceId", "ids",
      "content", "deviceEnvelope", "recoveryEnvelope", "recoveryVerifier",
      "recoveryAuthorisation", "recoveryRoot", "createdAt",
    ], "ownerless-activation-builder-invalid");
    if (!ACCOUNT_PATHS.includes(value.accountPath)) {
      throw contractError("ownerless-activation-builder-invalid");
    }
    const draft = {
      kind: POLICY.kind,
      schemaVersion: POLICY.schemaVersion,
      activationMode: POLICY.activationMode,
      accountPath: value.accountPath,
      activationId: value.activationId,
      stage: "device-staged",
      syncedPocketId: value.syncedPocketId,
      deviceId: value.deviceId,
      ids: value.ids,
      content: value.content,
      deviceEnvelope: value.deviceEnvelope,
      prfEnvelope: null,
      prfStatus: "pending",
      recoveryEnvelope: value.recoveryEnvelope,
      recoveryVerifier: value.recoveryVerifier,
      recoveryAuthorisation: value.recoveryAuthorisation,
      recoveryRoot: value.recoveryRoot,
      recoveryPackage: null,
      registrationContinuation: null,
      account: null,
      confirmedRemoteRevision: 0,
      keySetVersion: 0,
      recoveryVersion: 0,
      accountLocator: null,
      pendingOperation: null,
      recoveryCopyStored: false,
      adopted: false,
      createdAt: value.createdAt,
      updatedAt: value.createdAt,
    };
    return validate(draft, configInput);
  }

  function classifyCompletion(input, configInput, expectedStage, expectedAdopted) {
    let draft;
    try {
      draft = validate(input, configInput);
    } catch (_error) {
      throw contractError("ownerless-activation-completion-invalid");
    }
    if (draft.stage !== expectedStage || draft.adopted !== expectedAdopted) return null;
    return Object.freeze({
      state: expectedStage,
      activationId: draft.activationId,
      syncedPocketId: draft.syncedPocketId,
      deviceId: draft.deviceId,
    });
  }

  function classifyReadyForAdoption(input, configInput) {
    return classifyCompletion(input, configInput, "ready-for-adoption", false);
  }

  function classifyAdopted(input, configInput) {
    return classifyCompletion(input, configInput, "adopted", true);
  }

  function classifyDiscoveryCandidate(input) {
    if (!isObject(input)) throw contractError("ownerless-activation-discovery-invalid");
    if (input.kind !== POLICY.kind) throw contractError("ownerless-activation-discovery-invalid");
    if (input.schemaVersion === 1) return null;
    if (input.schemaVersion !== POLICY.schemaVersion
        || input.activationMode !== POLICY.activationMode) {
      throw contractError("ownerless-activation-discovery-invalid");
    }
    exactObject(input, FIELDS, "ownerless-activation-discovery-invalid");
    if (!ACCOUNT_PATHS.includes(input.accountPath)
        || !Object.prototype.hasOwnProperty.call(STAGES, input.stage)
        || containsRawPrf(input)) {
      throw contractError("ownerless-activation-discovery-invalid");
    }
    return Object.freeze({ activationId: identifier(
      input.activationId,
      "ownerless-activation-discovery-invalid"
    ) });
  }

  global.PocketSyncOwnerlessActivationDraft = Object.freeze({
    POLICY,
    validate,
    buildInitialDraft,
    classifyReadyForAdoption,
    classifyAdopted,
    classifyDiscoveryCandidate,
  });
})(typeof window !== "undefined" ? window : globalThis);
