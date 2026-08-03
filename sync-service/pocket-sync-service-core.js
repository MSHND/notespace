"use strict";

const { createHash } = require("node:crypto");

const POLICY = Object.freeze({
  apiVersion: 1,
  schemaVersion: 1,
  accountPolicyVersion: 1,
  credentialVersion: 1,
  contentFormat: "pocket.sync.content.opaque",
  contentVersion: 1,
  contentAlgorithm: "AES-GCM-256",
  randomByteLength: 32,
  nonceByteLength: 12,
  authenticationTagByteLength: 16,
  maximumIdentifierLength: 160,
  maximumRpNameLength: 120,
  maximumPublicKeyBytes: 4096,
  maximumCeremonyLifetimeMs: 10 * 60 * 1000,
  maximumSessionLifetimeMs: 90 * 24 * 60 * 60 * 1000,
  automaticRetry: false,
  backgroundWork: false,
});

const COLLECTIONS = Object.freeze({
  accounts: "accounts",
  credentials: "credentials",
  sessions: "sessions",
  ceremonies: "ceremonies",
  pockets: "pockets",
  operations: "operations",
});

const COLLECTION_NAMES = Object.freeze(Object.values(COLLECTIONS));
const FACTORY_FIELDS = Object.freeze([
  "store",
  "webAuthnVerifier",
  "randomBytes",
  "now",
  "trustedOrigin",
  "rpId",
  "rpName",
  "credentialAlgorithms",
  "ceremonyLifetimeMs",
  "sessionLifetimeMs",
]);
const CONTEXT_FIELDS = Object.freeze([
  "method",
  "origin",
  "fetchSite",
  "contentType",
  "sessionId",
]);
const TRANSACTION_FIELDS = Object.freeze(["get", "insert", "replace", "remove"]);
const TRANSPORTS = Object.freeze([
  "usb",
  "nfc",
  "ble",
  "smart-card",
  "hybrid",
  "internal",
]);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

const RECORD_FIELDS = Object.freeze({
  accounts: Object.freeze([
    "kind",
    "schemaVersion",
    "storeVersion",
    "accountId",
    "accountPolicyVersion",
    "prfEvaluationInput",
    "credentialIds",
    "syncedPocketId",
    "createdAt",
  ]),
  credentials: Object.freeze([
    "kind",
    "schemaVersion",
    "storeVersion",
    "credentialId",
    "accountId",
    "credentialVersion",
    "status",
    "publicKey",
    "publicKeyAlgorithm",
    "signCount",
    "transports",
    "backupEligible",
    "backedUp",
    "createdAt",
  ]),
  sessions: Object.freeze([
    "kind",
    "schemaVersion",
    "storeVersion",
    "sessionId",
    "accountId",
    "credentialId",
    "status",
    "createdAt",
    "expiresAt",
    "replacedBy",
  ]),
  ceremonies: Object.freeze([
    "kind",
    "schemaVersion",
    "storeVersion",
    "ceremonyType",
    "operationId",
    "ceremonyId",
    "requestDigest",
    "accountId",
    "priorSessionId",
    "deviceId",
    "challenge",
    "prfEvaluationInput",
    "expiresAt",
    "beginBody",
    "finishDigest",
    "completedResult",
  ]),
  pockets: Object.freeze([
    "kind",
    "schemaVersion",
    "storeVersion",
    "accountId",
    "syncedPocketId",
    "revision",
    "encryptedRecordSize",
    "encryptedRecord",
    "createdAt",
  ]),
  operations: Object.freeze([
    "kind",
    "schemaVersion",
    "storeVersion",
    "accountId",
    "syncedPocketId",
    "operationId",
    "logicalChangeId",
    "expectedRevision",
    "requestDigest",
    "result",
  ]),
});

function serviceError(code, status = 400, options = {}) {
  const error = new Error(`Pocket Sync service core ${code}.`);
  error.code = code;
  error.status = status;
  if (typeof options.retryable === "boolean") error.retryable = options.retryable;
  if (typeof options.clearSession === "boolean") error.clearSession = options.clearSession;
  return error;
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, allowed, required, code = "service-request-invalid") {
  if (!isObject(value)
      || Object.keys(value).some((field) => !allowed.includes(field))
      || required.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw serviceError(code);
  }
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const copy = {};
    Object.keys(value).forEach((field) => {
      copy[field] = clone(value[field]);
    });
    return copy;
  }
  return value;
}

function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (isObject(value)) {
    const copy = {};
    Object.keys(value).forEach((field) => {
      copy[field] = frozen(value[field]);
    });
    return Object.freeze(copy);
  }
  return value;
}

function sameKeys(value, fields) {
  return isObject(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every((field) => fields.includes(field));
}

function identifier(value, code = "service-request-invalid") {
  if (typeof value !== "string"
      || value.length < 1
      || value.length > POLICY.maximumIdentifierLength
      || value !== value.trim()
      || !BASE64URL_PATTERN.test(value)) {
    throw serviceError(code);
  }
  return value;
}

function plainIdentifier(value, code = "service-request-invalid") {
  if (typeof value !== "string"
      || value.length < 1
      || value.length > POLICY.maximumIdentifierLength
      || value !== value.trim()) {
    throw serviceError(code);
  }
  return value;
}

function nonNegativeInteger(value, code = "service-request-invalid") {
  if (!Number.isSafeInteger(value) || value < 0) throw serviceError(code);
  return value;
}

function positiveInteger(value, code = "service-request-invalid") {
  if (!Number.isSafeInteger(value) || value < 1) throw serviceError(code);
  return value;
}

function canonicalBase64urlByteLength(value) {
  if (typeof value !== "string"
      || value.length === 0
      || value.length % 4 === 1
      || !BASE64URL_PATTERN.test(value)) {
    return -1;
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const remainder = value.length % 4;
  const finalValue = alphabet.indexOf(value[value.length - 1]);
  if ((remainder === 2 && (finalValue & 15) !== 0)
      || (remainder === 3 && (finalValue & 3) !== 0)) {
    return -1;
  }
  return Math.floor(value.length * 6 / 8);
}

function canonicalBinary(value, options = {}, code = "service-request-invalid") {
  const length = canonicalBase64urlByteLength(value);
  const minimum = options.minimum === undefined ? 1 : options.minimum;
  const maximum = options.maximum === undefined ? Number.MAX_SAFE_INTEGER : options.maximum;
  if (length < minimum || length > maximum) throw serviceError(code);
  return value;
}

function isoTimestamp(value, code = "service-state-invalid") {
  if (typeof value !== "string" || value.length > 80) throw serviceError(code, 500);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw serviceError(code, 500);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((field) => (
      `${JSON.stringify(field)}:${canonicalJson(value[field])}`
    )).join(",")}}`;
  }
  throw serviceError("service-request-invalid");
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function validateEncryptedRecord(input, code = "service-request-invalid") {
  const record = exactObject(input, [
    "format",
    "version",
    "algorithm",
    "nonce",
    "ciphertext",
  ], [
    "format",
    "version",
    "algorithm",
    "nonce",
    "ciphertext",
  ], code);
  if (record.format !== POLICY.contentFormat
      || record.version !== POLICY.contentVersion
      || record.algorithm !== POLICY.contentAlgorithm
      || canonicalBase64urlByteLength(record.nonce) !== POLICY.nonceByteLength
      || canonicalBase64urlByteLength(record.ciphertext) < POLICY.authenticationTagByteLength) {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  return frozen(record);
}

function validateCredentialDescriptor(input, code) {
  const descriptor = exactObject(input, ["type", "id", "transports"], ["type", "id"], code);
  if (descriptor.type !== "public-key") throw serviceError(code);
  const value = {
    type: "public-key",
    id: canonicalBinary(identifier(descriptor.id, code), { maximum: 1024 }, code),
  };
  if (descriptor.transports !== undefined) {
    if (!Array.isArray(descriptor.transports)
        || new Set(descriptor.transports).size !== descriptor.transports.length
        || descriptor.transports.some((transport) => !TRANSPORTS.includes(transport))) {
      throw serviceError(code);
    }
    value.transports = descriptor.transports.slice();
  }
  return frozen(value);
}

function validateRegistrationCredential(input) {
  const code = "service-request-invalid";
  const credential = exactObject(input, [
    "id",
    "rawId",
    "response",
    "authenticatorAttachment",
    "clientExtensionResults",
    "type",
  ], ["id", "rawId", "response", "clientExtensionResults", "type"], code);
  const id = canonicalBinary(identifier(credential.id, code), { maximum: 1024 }, code);
  if (credential.type !== "public-key" || credential.rawId !== id) throw serviceError(code);
  canonicalBinary(credential.rawId, { maximum: 1024 }, code);
  const response = exactObject(credential.response, [
    "clientDataJSON",
    "authenticatorData",
    "transports",
    "publicKey",
    "publicKeyAlgorithm",
    "attestationObject",
  ], ["clientDataJSON", "attestationObject"], code);
  const normalisedResponse = {
    clientDataJSON: canonicalBinary(response.clientDataJSON, {}, code),
    attestationObject: canonicalBinary(response.attestationObject, {}, code),
  };
  if (response.authenticatorData !== undefined) {
    normalisedResponse.authenticatorData = canonicalBinary(response.authenticatorData, {}, code);
  }
  if (response.transports !== undefined) {
    if (!Array.isArray(response.transports)
        || new Set(response.transports).size !== response.transports.length
        || response.transports.some((transport) => !TRANSPORTS.includes(transport))) {
      throw serviceError(code);
    }
    normalisedResponse.transports = response.transports.slice();
  }
  if (response.publicKey !== undefined && response.publicKey !== null) {
    normalisedResponse.publicKey = canonicalBinary(
      response.publicKey,
      { maximum: POLICY.maximumPublicKeyBytes },
      code
    );
  }
  if (response.publicKeyAlgorithm !== undefined) {
    normalisedResponse.publicKeyAlgorithm = nonNegativeOrSignedInteger(response.publicKeyAlgorithm, code);
  }
  const extensions = exactObject(credential.clientExtensionResults, ["prf"], [], code);
  const safeExtensions = {};
  if (extensions.prf !== undefined) {
    const prf = exactObject(extensions.prf, ["enabled"], ["enabled"], code);
    if (typeof prf.enabled !== "boolean") throw serviceError(code);
    safeExtensions.prf = { enabled: prf.enabled };
  }
  const normalised = {
    id,
    rawId: id,
    response: normalisedResponse,
    clientExtensionResults: safeExtensions,
    type: "public-key",
  };
  if (credential.authenticatorAttachment !== undefined
      && credential.authenticatorAttachment !== null) {
    normalised.authenticatorAttachment = identifier(credential.authenticatorAttachment, code);
  }
  return frozen(normalised);
}

function nonNegativeOrSignedInteger(value, code) {
  if (!Number.isSafeInteger(value)) throw serviceError(code);
  return value;
}

function validateAuthenticationCredential(input) {
  const code = "service-request-invalid";
  const credential = exactObject(input, [
    "id",
    "rawId",
    "response",
    "authenticatorAttachment",
    "clientExtensionResults",
    "type",
  ], ["id", "rawId", "response", "clientExtensionResults", "type"], code);
  const id = canonicalBinary(identifier(credential.id, code), { maximum: 1024 }, code);
  if (credential.type !== "public-key" || credential.rawId !== id) throw serviceError(code);
  const response = exactObject(credential.response, [
    "clientDataJSON",
    "authenticatorData",
    "signature",
    "userHandle",
  ], ["clientDataJSON", "authenticatorData", "signature"], code);
  const normalisedResponse = {
    clientDataJSON: canonicalBinary(response.clientDataJSON, {}, code),
    authenticatorData: canonicalBinary(response.authenticatorData, {}, code),
    signature: canonicalBinary(response.signature, {}, code),
  };
  if (response.userHandle !== undefined) {
    normalisedResponse.userHandle = response.userHandle === null
      ? null
      : canonicalBinary(response.userHandle, {}, code);
  }
  if (!isObject(credential.clientExtensionResults)
      || Object.keys(credential.clientExtensionResults).length !== 0) {
    throw serviceError(code);
  }
  const normalised = {
    id,
    rawId: id,
    response: normalisedResponse,
    clientExtensionResults: {},
    type: "public-key",
  };
  if (credential.authenticatorAttachment !== undefined
      && credential.authenticatorAttachment !== null) {
    normalised.authenticatorAttachment = identifier(credential.authenticatorAttachment, code);
  }
  return frozen(normalised);
}

function validateRegistrationVerifierResult(input, algorithms) {
  const result = exactObject(input, [
    "credentialId",
    "publicKey",
    "publicKeyAlgorithm",
    "signCount",
    "transports",
    "backupEligible",
    "backedUp",
  ], [
    "credentialId",
    "publicKey",
    "publicKeyAlgorithm",
    "signCount",
    "transports",
    "backupEligible",
    "backedUp",
  ], "service-webauthn-failed");
  const transports = validateTransportList(result.transports, "service-webauthn-failed");
  if (!Number.isSafeInteger(result.publicKeyAlgorithm)
      || !algorithms.includes(result.publicKeyAlgorithm)
      || typeof result.backupEligible !== "boolean"
      || typeof result.backedUp !== "boolean") {
    throw serviceError("service-webauthn-failed", 400);
  }
  return frozen({
    credentialId: canonicalBinary(
      identifier(result.credentialId, "service-webauthn-failed"),
      { maximum: 1024 },
      "service-webauthn-failed"
    ),
    publicKey: canonicalBinary(
      result.publicKey,
      { maximum: POLICY.maximumPublicKeyBytes },
      "service-webauthn-failed"
    ),
    publicKeyAlgorithm: result.publicKeyAlgorithm,
    signCount: nonNegativeInteger(result.signCount, "service-webauthn-failed"),
    transports,
    backupEligible: result.backupEligible,
    backedUp: result.backedUp,
  });
}

function validateAuthenticationVerifierResult(input) {
  const result = exactObject(input, [
    "credentialId",
    "signCount",
    "backedUp",
  ], ["credentialId", "signCount", "backedUp"], "service-webauthn-failed");
  if (typeof result.backedUp !== "boolean") throw serviceError("service-webauthn-failed");
  return frozen({
    credentialId: canonicalBinary(
      identifier(result.credentialId, "service-webauthn-failed"),
      { maximum: 1024 },
      "service-webauthn-failed"
    ),
    signCount: nonNegativeInteger(result.signCount, "service-webauthn-failed"),
    backedUp: result.backedUp,
  });
}

function validateTransportList(value, code) {
  if (!Array.isArray(value)
      || new Set(value).size !== value.length
      || value.some((transport) => !TRANSPORTS.includes(transport))) {
    throw serviceError(code);
  }
  return Object.freeze(value.slice());
}

function validateFinishBody(input, type, code = "service-state-invalid") {
  const body = exactObject(input, [
    "apiVersion",
    "ok",
    "operationId",
    "ceremonyId",
    "accountId",
    "credentialId",
    "credentialVersion",
    "accountPolicyVersion",
    "prfEvaluationInput",
  ], [
    "apiVersion",
    "ok",
    "operationId",
    "ceremonyId",
    "accountId",
    "credentialId",
    "credentialVersion",
    "accountPolicyVersion",
    "prfEvaluationInput",
  ], code);
  if (!type || body.apiVersion !== 1 || body.ok !== true
      || body.credentialVersion !== POLICY.credentialVersion
      || body.accountPolicyVersion !== POLICY.accountPolicyVersion) {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  identifier(body.operationId, code);
  identifier(body.ceremonyId, code);
  identifier(body.accountId, code);
  identifier(body.credentialId, code);
  canonicalBinary(body.prfEvaluationInput, { minimum: 32, maximum: 32 }, code);
  return frozen(body);
}

function validateSessionInstruction(input, code = "service-state-invalid") {
  const value = exactObject(input, [
    "action",
    "sessionId",
    "expiresAt",
    "replaceSessionId",
  ], ["action", "sessionId", "expiresAt", "replaceSessionId"], code);
  if (value.action !== "set") throw serviceError(code, 500);
  identifier(value.sessionId, code);
  isoTimestamp(value.expiresAt, code);
  if (value.replaceSessionId !== null) identifier(value.replaceSessionId, code);
  return frozen(value);
}

function validateResultWrapper(input, ceremonyType, code = "service-state-invalid") {
  const value = exactObject(input, ["status", "body", "session"], [
    "status",
    "body",
    "session",
  ], code);
  if (value.status !== 200) throw serviceError(code, 500);
  return frozen({
    status: 200,
    body: validateFinishBody(value.body, ceremonyType, code),
    session: validateSessionInstruction(value.session, code),
  });
}

function validateBeginBody(input, ceremonyType, code = "service-state-invalid") {
  const optionsField = ceremonyType === "registration"
    ? "publicKeyCreationOptions"
    : "publicKeyRequestOptions";
  const fields = [
    "apiVersion",
    "ok",
    "operationId",
    "ceremonyId",
    "expiresAt",
    "prfEvaluationInput",
    optionsField,
  ];
  const body = exactObject(input, fields, fields, code);
  if (body.apiVersion !== 1 || body.ok !== true) throw serviceError(code, 500);
  identifier(body.operationId, code);
  identifier(body.ceremonyId, code);
  isoTimestamp(body.expiresAt, code);
  canonicalBinary(body.prfEvaluationInput, { minimum: 32, maximum: 32 }, code);
  if (ceremonyType === "registration") {
    validateRegistrationOptions(body[optionsField], body.prfEvaluationInput, code);
  } else {
    validateAuthenticationOptions(body[optionsField], body.prfEvaluationInput, code);
  }
  return frozen(body);
}

function validateStoredRecord(collection, input, key) {
  if (!COLLECTION_NAMES.includes(collection)
      || !sameKeys(input, RECORD_FIELDS[collection])) {
    throw serviceError("service-state-invalid", 500);
  }
  if (input.schemaVersion !== POLICY.schemaVersion) {
    throw serviceError("service-state-invalid", 500);
  }
  positiveInteger(input.storeVersion, "service-state-invalid");
  switch (collection) {
    case COLLECTIONS.accounts:
      if (input.kind !== "pocket.sync.service-account"
          || input.accountPolicyVersion !== POLICY.accountPolicyVersion
          || input.accountId !== key
          || !Array.isArray(input.credentialIds)
          || input.credentialIds.length < 1
          || new Set(input.credentialIds).size !== input.credentialIds.length) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountId, "service-state-invalid");
      canonicalBinary(input.prfEvaluationInput, { minimum: 32, maximum: 32 }, "service-state-invalid");
      input.credentialIds.forEach((value) => identifier(value, "service-state-invalid"));
      if (input.syncedPocketId !== null) identifier(input.syncedPocketId, "service-state-invalid");
      isoTimestamp(input.createdAt);
      break;
    case COLLECTIONS.credentials:
      if (input.kind !== "pocket.sync.service-credential"
          || input.credentialVersion !== POLICY.credentialVersion
          || input.status !== "active"
          || input.credentialId !== key
          || typeof input.backupEligible !== "boolean"
          || typeof input.backedUp !== "boolean") {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.credentialId, "service-state-invalid");
      identifier(input.accountId, "service-state-invalid");
      canonicalBinary(input.publicKey, { maximum: POLICY.maximumPublicKeyBytes }, "service-state-invalid");
      nonNegativeOrSignedInteger(input.publicKeyAlgorithm, "service-state-invalid");
      nonNegativeInteger(input.signCount, "service-state-invalid");
      validateTransportList(input.transports, "service-state-invalid");
      isoTimestamp(input.createdAt);
      break;
    case COLLECTIONS.sessions:
      if (input.kind !== "pocket.sync.service-session"
          || !["active", "revoked"].includes(input.status)
          || input.sessionId !== key) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.sessionId, "service-state-invalid");
      identifier(input.accountId, "service-state-invalid");
      identifier(input.credentialId, "service-state-invalid");
      isoTimestamp(input.createdAt);
      isoTimestamp(input.expiresAt);
      if (input.status === "active" && input.replacedBy !== null) {
        throw serviceError("service-state-invalid", 500);
      }
      if (input.status === "revoked") {
        identifier(input.replacedBy, "service-state-invalid");
        if (input.replacedBy === input.sessionId) {
          throw serviceError("service-state-invalid", 500);
        }
      }
      break;
    case COLLECTIONS.ceremonies: {
      if (input.kind !== "pocket.sync.service-ceremony"
          || !["registration", "authentication"].includes(input.ceremonyType)
          || input.operationId !== key
          || !DIGEST_PATTERN.test(input.requestDigest)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.operationId, "service-state-invalid");
      identifier(input.ceremonyId, "service-state-invalid");
      identifier(input.accountId, "service-state-invalid");
      if (input.priorSessionId !== null) identifier(input.priorSessionId, "service-state-invalid");
      if (input.ceremonyType === "registration") {
        identifier(input.deviceId, "service-state-invalid");
      } else if (input.deviceId !== null) {
        throw serviceError("service-state-invalid", 500);
      }
      canonicalBinary(input.challenge, { minimum: 32, maximum: 32 }, "service-state-invalid");
      canonicalBinary(input.prfEvaluationInput, { minimum: 32, maximum: 32 }, "service-state-invalid");
      isoTimestamp(input.expiresAt);
      const beginBody = validateBeginBody(input.beginBody, input.ceremonyType);
      const options = input.ceremonyType === "registration"
        ? beginBody.publicKeyCreationOptions
        : beginBody.publicKeyRequestOptions;
      if (beginBody.operationId !== input.operationId
          || beginBody.ceremonyId !== input.ceremonyId
          || beginBody.expiresAt !== input.expiresAt
          || beginBody.prfEvaluationInput !== input.prfEvaluationInput
          || options.challenge !== input.challenge
          || (input.ceremonyType === "registration"
            && (options.user.name !== input.accountId
              || options.user.displayName !== input.accountId))) {
        throw serviceError("service-state-invalid", 500);
      }
      const pending = input.finishDigest === null && input.completedResult === null;
      const completed = typeof input.finishDigest === "string"
        && DIGEST_PATTERN.test(input.finishDigest)
        && input.completedResult !== null;
      if (!pending && !completed) throw serviceError("service-state-invalid", 500);
      if (completed) {
        const completedResult = validateResultWrapper(
          input.completedResult,
          input.ceremonyType
        );
        if (completedResult.body.operationId !== input.operationId
            || completedResult.body.ceremonyId !== input.ceremonyId
            || completedResult.body.accountId !== input.accountId
            || completedResult.body.prfEvaluationInput !== input.prfEvaluationInput) {
          throw serviceError("service-state-invalid", 500);
        }
      }
      break;
    }
    case COLLECTIONS.pockets:
      if (input.kind !== "pocket.sync.service-pocket"
          || input.syncedPocketId !== key
          || input.revision < 1
          || input.encryptedRecordSize !== canonicalBase64urlByteLength(input.encryptedRecord?.ciphertext)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountId, "service-state-invalid");
      identifier(input.syncedPocketId, "service-state-invalid");
      positiveInteger(input.revision, "service-state-invalid");
      positiveInteger(input.encryptedRecordSize, "service-state-invalid");
      validateEncryptedRecord(input.encryptedRecord, "service-state-invalid");
      isoTimestamp(input.createdAt);
      break;
    case COLLECTIONS.operations: {
      if (input.kind !== "pocket.sync.service-operation"
          || input.storeVersion !== 1
          || !DIGEST_PATTERN.test(input.requestDigest)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountId, "service-state-invalid");
      identifier(input.syncedPocketId, "service-state-invalid");
      identifier(input.operationId, "service-state-invalid");
      identifier(input.logicalChangeId, "service-state-invalid");
      nonNegativeInteger(input.expectedRevision, "service-state-invalid");
      const expectedKey = operationKey(input.accountId, input.syncedPocketId, input.operationId);
      if (key !== expectedKey || !isObject(input.result)) {
        throw serviceError("service-state-invalid", 500);
      }
      if (input.result.status === "committed") {
        if (!sameKeys(input.result, ["status", "revision"])) {
          throw serviceError("service-state-invalid", 500);
        }
        positiveInteger(input.result.revision, "service-state-invalid");
        if (input.expectedRevision >= Number.MAX_SAFE_INTEGER
            || input.result.revision !== input.expectedRevision + 1) {
          throw serviceError("service-state-invalid", 500);
        }
      } else if (input.result.status === "conflict") {
        if (!sameKeys(input.result, ["status", "actualRevision"])) {
          throw serviceError("service-state-invalid", 500);
        }
        positiveInteger(input.result.actualRevision, "service-state-invalid");
        if (input.result.actualRevision <= input.expectedRevision) {
          throw serviceError("service-state-invalid", 500);
        }
      } else {
        throw serviceError("service-state-invalid", 500);
      }
      break;
    }
    default:
      throw serviceError("service-state-invalid", 500);
  }
  return frozen(input);
}

function operationKey(accountId, syncedPocketId, operationId) {
  return [accountId, syncedPocketId, operationId]
    .map((value) => Buffer.from(value, "utf8").toString("base64url"))
    .join(".");
}

function validateOrigin(value) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw serviceError("service-core-invalid");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw serviceError("service-core-invalid");
  }
  if (parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.pathname !== "/"
      || parsed.search !== ""
      || parsed.hash !== ""
      || parsed.origin !== value) {
    throw serviceError("service-core-invalid");
  }
  return parsed;
}

function validateRpId(rpId, trustedOrigin) {
  const trustedOriginHostname = trustedOrigin.hostname;
  if (typeof rpId !== "string"
      || rpId !== rpId.trim()
      || rpId !== rpId.toLowerCase()
      || rpId.endsWith(".")
      || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(rpId)
      || rpId !== trustedOriginHostname) {
    throw serviceError("service-core-invalid");
  }
  return rpId;
}

function validateFactoryConfig(input) {
  exactObject(input, FACTORY_FIELDS, FACTORY_FIELDS, "service-core-invalid");
  if (!isObject(input.store)
      || !sameKeys(input.store, ["transact"])
      || typeof input.store.transact !== "function"
      || !isObject(input.webAuthnVerifier)
      || !sameKeys(input.webAuthnVerifier, ["verifyRegistration", "verifyAuthentication"])
      || typeof input.webAuthnVerifier.verifyRegistration !== "function"
      || typeof input.webAuthnVerifier.verifyAuthentication !== "function"
      || typeof input.randomBytes !== "function"
      || typeof input.now !== "function") {
    throw serviceError("service-core-invalid");
  }
  const origin = validateOrigin(input.trustedOrigin);
  validateRpId(input.rpId, origin);
  if (typeof input.rpName !== "string"
      || input.rpName !== input.rpName.trim()
      || input.rpName.length < 1
      || input.rpName.length > POLICY.maximumRpNameLength) {
    throw serviceError("service-core-invalid");
  }
  if (!Array.isArray(input.credentialAlgorithms)
      || input.credentialAlgorithms.length < 1
      || new Set(input.credentialAlgorithms).size !== input.credentialAlgorithms.length
      || input.credentialAlgorithms.some((algorithm) => !Number.isSafeInteger(algorithm))) {
    throw serviceError("service-core-invalid");
  }
  const ceremonyLifetime = positiveInteger(input.ceremonyLifetimeMs, "service-core-invalid");
  const sessionLifetime = positiveInteger(input.sessionLifetimeMs, "service-core-invalid");
  if (ceremonyLifetime > POLICY.maximumCeremonyLifetimeMs
      || sessionLifetime > POLICY.maximumSessionLifetimeMs) {
    throw serviceError("service-core-invalid");
  }
  return Object.freeze({
    ...input,
    credentialAlgorithms: Object.freeze(input.credentialAlgorithms.slice()),
  });
}

function validateRegistrationOptions(input, expectedPrfInput, code = "service-state-invalid") {
  const options = exactObject(input, [
    "rp",
    "user",
    "challenge",
    "pubKeyCredParams",
    "timeout",
    "excludeCredentials",
    "authenticatorSelection",
    "attestation",
    "extensions",
  ], [
    "rp",
    "user",
    "challenge",
    "pubKeyCredParams",
    "authenticatorSelection",
    "attestation",
    "extensions",
  ], code);
  const rp = exactObject(options.rp, ["id", "name"], ["id", "name"], code);
  const user = exactObject(options.user, ["id", "name", "displayName"], [
    "id",
    "name",
    "displayName",
  ], code);
  const selection = exactObject(options.authenticatorSelection, [
    "residentKey",
    "userVerification",
  ], ["residentKey", "userVerification"], code);
  const extensions = exactObject(options.extensions, ["prf"], ["prf"], code);
  const prf = exactObject(extensions.prf, ["eval"], ["eval"], code);
  const evaluation = exactObject(prf.eval, ["first"], ["first"], code);
  if (selection.residentKey !== "required"
      || selection.userVerification !== "required"
      || options.attestation !== "none"
      || !Array.isArray(options.pubKeyCredParams)
      || options.pubKeyCredParams.length < 1
      || !Array.isArray(options.excludeCredentials || [])) {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  if (typeof rp.name !== "string" || rp.name !== rp.name.trim() || rp.name.length < 1) {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  plainIdentifier(rp.id, code);
  plainIdentifier(rp.name, code);
  plainIdentifier(user.name, code);
  plainIdentifier(user.displayName, code);
  canonicalBinary(user.id, { maximum: 64 }, code);
  canonicalBinary(options.challenge, { minimum: 32 }, code);
  canonicalBinary(evaluation.first, { minimum: 32, maximum: 32 }, code);
  if (evaluation.first !== expectedPrfInput) throw serviceError(code, 500);
  options.pubKeyCredParams.forEach((parameter) => {
    const value = exactObject(parameter, ["type", "alg"], ["type", "alg"], code);
    if (value.type !== "public-key" || !Number.isSafeInteger(value.alg)) {
      throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
    }
  });
  (options.excludeCredentials || []).forEach((value) => validateCredentialDescriptor(value, code));
  if (options.timeout !== undefined) positiveInteger(options.timeout, code);
  return frozen(options);
}

function validateAuthenticationOptions(input, expectedPrfInput, code = "service-state-invalid") {
  const options = exactObject(input, [
    "challenge",
    "timeout",
    "rpId",
    "allowCredentials",
    "userVerification",
    "extensions",
  ], ["challenge", "rpId", "userVerification", "extensions"], code);
  const extensions = exactObject(options.extensions, ["prf"], ["prf"], code);
  const prf = exactObject(extensions.prf, ["eval"], ["eval"], code);
  const evaluation = exactObject(prf.eval, ["first"], ["first"], code);
  if (options.userVerification !== "required" || !Array.isArray(options.allowCredentials || [])) {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  plainIdentifier(options.rpId, code);
  canonicalBinary(options.challenge, { minimum: 32 }, code);
  canonicalBinary(evaluation.first, { minimum: 32, maximum: 32 }, code);
  if (evaluation.first !== expectedPrfInput) throw serviceError(code, 500);
  (options.allowCredentials || []).forEach((value) => validateCredentialDescriptor(value, code));
  if (options.timeout !== undefined) positiveInteger(options.timeout, code);
  return frozen(options);
}

function validateBeginRegistrationRequest(input) {
  const value = exactObject(input, [
    "apiVersion",
    "operationId",
    "accountIntent",
    "deviceId",
  ], ["apiVersion", "operationId", "accountIntent", "deviceId"]);
  if (value.apiVersion !== POLICY.apiVersion
      || value.accountIntent !== "create-or-add-credential") {
    throw serviceError("service-request-invalid");
  }
  return frozen({
    apiVersion: 1,
    operationId: identifier(value.operationId),
    accountIntent: "create-or-add-credential",
    deviceId: identifier(value.deviceId),
  });
}

function validateBeginAuthenticationRequest(input) {
  const value = exactObject(input, [
    "apiVersion",
    "operationId",
    "accountLocator",
  ], ["apiVersion", "operationId"]);
  if (value.apiVersion !== POLICY.apiVersion) throw serviceError("service-request-invalid");
  const result = {
    apiVersion: 1,
    operationId: identifier(value.operationId),
  };
  if (value.accountLocator !== undefined) result.accountLocator = identifier(value.accountLocator);
  return frozen(result);
}

function validateFinishRegistrationRequest(input) {
  const value = exactObject(input, [
    "apiVersion",
    "operationId",
    "ceremonyId",
    "deviceId",
    "credential",
  ], ["apiVersion", "operationId", "ceremonyId", "deviceId", "credential"]);
  if (value.apiVersion !== POLICY.apiVersion) throw serviceError("service-request-invalid");
  return frozen({
    apiVersion: 1,
    operationId: identifier(value.operationId),
    ceremonyId: identifier(value.ceremonyId),
    deviceId: identifier(value.deviceId),
    credential: validateRegistrationCredential(value.credential),
  });
}

function validateFinishAuthenticationRequest(input) {
  const value = exactObject(input, [
    "apiVersion",
    "operationId",
    "ceremonyId",
    "credential",
  ], ["apiVersion", "operationId", "ceremonyId", "credential"]);
  if (value.apiVersion !== POLICY.apiVersion) throw serviceError("service-request-invalid");
  return frozen({
    apiVersion: 1,
    operationId: identifier(value.operationId),
    ceremonyId: identifier(value.ceremonyId),
    credential: validateAuthenticationCredential(value.credential),
  });
}

function validateReadRevisionRequest(input) {
  const value = exactObject(input, [
    "apiVersion",
    "operationId",
    "syncedPocketId",
  ], ["apiVersion", "operationId", "syncedPocketId"]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({
    apiVersion: 1,
    operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId),
  });
}

function validateDownloadRequest(input) {
  const value = exactObject(input, [
    "apiVersion",
    "operationId",
    "syncedPocketId",
    "revision",
  ], ["apiVersion", "operationId", "syncedPocketId", "revision"]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({
    apiVersion: 1,
    operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId),
    revision: positiveInteger(value.revision),
  });
}

function validateConditionalRequest(input) {
  const value = exactObject(input, [
    "apiVersion",
    "syncedPocketId",
    "expectedRevision",
    "operationId",
    "logicalChangeId",
    "attemptKind",
    "encryptedRecord",
  ], [
    "apiVersion",
    "syncedPocketId",
    "expectedRevision",
    "operationId",
    "logicalChangeId",
    "attemptKind",
    "encryptedRecord",
  ]);
  if (value.apiVersion !== 1
      || !Number.isSafeInteger(value.expectedRevision)
      || value.expectedRevision < 0
      || value.expectedRevision >= Number.MAX_SAFE_INTEGER
      || !["new-change", "idempotent-retry"].includes(value.attemptKind)) {
    throw serviceError("service-request-invalid");
  }
  return frozen({
    apiVersion: 1,
    syncedPocketId: identifier(value.syncedPocketId),
    expectedRevision: value.expectedRevision,
    operationId: identifier(value.operationId),
    logicalChangeId: identifier(value.logicalChangeId),
    attemptKind: value.attemptKind,
    encryptedRecord: validateEncryptedRecord(value.encryptedRecord),
  });
}

function createServiceCore(input) {
  const config = validateFactoryConfig(input);
  const {
    store,
    webAuthnVerifier,
    randomBytes,
    now,
    trustedOrigin,
    rpId,
    rpName,
    credentialAlgorithms,
    ceremonyLifetimeMs,
    sessionLifetimeMs,
  } = config;

  function validateContext(value) {
    const context = exactObject(
      value,
      CONTEXT_FIELDS,
      CONTEXT_FIELDS,
      "service-request-context-invalid"
    );
    if (context.origin !== trustedOrigin) {
      throw serviceError("service-origin-rejected", 403);
    }
    if (context.method !== "POST"
        || context.fetchSite !== "same-origin"
        || typeof context.contentType !== "string"
        || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(context.contentType)) {
      throw serviceError("service-request-context-invalid", 400);
    }
    if (context.sessionId !== null) identifier(context.sessionId, "service-request-context-invalid");
    return frozen(context);
  }

  function invocation(value) {
    const request = exactObject(
      value,
      ["context", "body"],
      ["context", "body"],
      "service-request-context-invalid"
    );
    return Object.freeze({ context: validateContext(request.context), body: request.body });
  }

  function clockMilliseconds() {
    let value;
    try {
      value = now();
    } catch (_error) {
      throw serviceError("service-core-invalid", 500);
    }
    if (!Number.isFinite(value)) throw serviceError("service-core-invalid", 500);
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) throw serviceError("service-core-invalid", 500);
    return value;
  }

  function timestamp(milliseconds) {
    const value = new Date(milliseconds).toISOString();
    isoTimestamp(value);
    return value;
  }

  function expiry(milliseconds, lifetime) {
    const value = milliseconds + lifetime;
    if (!Number.isSafeInteger(value)) throw serviceError("service-core-invalid", 500);
    return timestamp(value);
  }

  function randomToken() {
    let bytes;
    try {
      bytes = randomBytes(POLICY.randomByteLength);
    } catch (_error) {
      throw serviceError("service-core-invalid", 500);
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== POLICY.randomByteLength) {
      throw serviceError("service-core-invalid", 500);
    }
    return Buffer.from(bytes).toString("base64url");
  }

  function validateTransaction(transaction) {
    if (!isObject(transaction)
        || !sameKeys(transaction, TRANSACTION_FIELDS)
        || TRANSACTION_FIELDS.some((field) => typeof transaction[field] !== "function")) {
      throw serviceError("service-core-invalid", 500);
    }
    return transaction;
  }

  function thenable(value) {
    return value && typeof value.then === "function";
  }

  async function transactionCall(transaction, method, args) {
    const result = transaction[method](...args);
    if (!thenable(result)) throw serviceError("service-core-invalid", 500);
    return result;
  }

  function mapTransactionError(error) {
    if (error && typeof error.code === "string" && error.code.startsWith("service-")) {
      return error;
    }
    if (error && ["store-version-conflict", "store-duplicate"].includes(error.code)) {
      return serviceError("service-transaction-conflict", 409, { retryable: true });
    }
    return serviceError("service-storage-failed", 503, { retryable: true });
  }

  async function transact(mode, callback) {
    let promise;
    try {
      promise = store.transact(mode, async (candidate) => callback(validateTransaction(candidate)));
      if (!thenable(promise)) throw serviceError("service-core-invalid", 500);
      return await promise;
    } catch (error) {
      throw mapTransactionError(error);
    }
  }

  async function readRecord(transaction, collection, key) {
    let raw;
    try {
      raw = await transactionCall(transaction, "get", [collection, key]);
    } catch (error) {
      throw error;
    }
    if (raw === null) return null;
    if (raw === undefined) throw serviceError("service-state-invalid", 500);
    try {
      return validateStoredRecord(collection, raw, key);
    } catch (_error) {
      throw serviceError("service-state-invalid", 500);
    }
  }

  async function insertRecord(transaction, collection, key, record) {
    validateStoredRecord(collection, record, key);
    await transactionCall(transaction, "insert", [collection, key, clone(record)]);
  }

  async function replaceRecord(transaction, collection, key, prior, record) {
    if (record.storeVersion !== prior.storeVersion + 1) {
      throw serviceError("service-state-invalid", 500);
    }
    validateStoredRecord(collection, record, key);
    await transactionCall(transaction, "replace", [
      collection,
      key,
      prior.storeVersion,
      clone(record),
    ]);
  }

  async function ensureGeneratedKeyAvailable(transaction, collection, key) {
    const existing = await readRecord(transaction, collection, key);
    if (existing !== null) throw serviceError("service-random-collision", 409);
  }

  function beginDigest(type, request, sessionId) {
    return sha256([
      1,
      type,
      sessionId,
      request,
    ]);
  }

  function finishDigest(type, request, sessionId) {
    return sha256([
      1,
      type,
      sessionId,
      request.operationId,
      request.ceremonyId,
      type === "registration" ? request.deviceId : null,
      request.credential,
    ]);
  }

  function uploadDigest(accountId, request) {
    return sha256([
      1,
      accountId,
      request.syncedPocketId,
      request.expectedRevision,
      request.operationId,
      request.logicalChangeId,
      [
        request.encryptedRecord.format,
        request.encryptedRecord.version,
        request.encryptedRecord.algorithm,
        request.encryptedRecord.nonce,
        request.encryptedRecord.ciphertext,
      ],
    ]);
  }

  async function authoriseSession(transaction, sessionId, atMilliseconds) {
    if (sessionId === null) {
      throw serviceError("service-authentication-required", 401, { clearSession: false });
    }
    const session = await readRecord(transaction, COLLECTIONS.sessions, sessionId);
    if (session === null) {
      throw serviceError("service-session-invalid", 401, { clearSession: true });
    }
    if (session.status !== "active") {
      throw serviceError("service-session-invalid", 401, { clearSession: true });
    }
    if (Date.parse(session.expiresAt) <= atMilliseconds) {
      throw serviceError("service-session-expired", 401, { clearSession: true });
    }
    const account = await readRecord(transaction, COLLECTIONS.accounts, session.accountId);
    if (account === null) throw serviceError("service-state-invalid", 500);
    const credentials = await loadAccountCredentials(transaction, account);
    const credential = credentials.find((item) => item.credentialId === session.credentialId);
    if (credential === undefined
        || credential.accountId !== account.accountId
        || !account.credentialIds.includes(credential.credentialId)) {
      throw serviceError("service-state-invalid", 500);
    }
    return Object.freeze({ session, account, credential, credentials });
  }

  async function completedReplay(transaction, ceremony, digest, atMilliseconds) {
    if (ceremony.finishDigest !== digest) {
      throw serviceError("service-operation-reuse", 409);
    }
    const result = validateResultWrapper(ceremony.completedResult, ceremony.ceremonyType);
    const authorised = await authoriseSession(
      transaction,
      result.session.sessionId,
      atMilliseconds
    );
    if (authorised.account.accountId !== ceremony.accountId
        || authorised.account.accountId !== result.body.accountId
        || authorised.credential.credentialId !== result.body.credentialId
        || authorised.session.accountId !== ceremony.accountId
        || authorised.session.credentialId !== result.body.credentialId) {
      throw serviceError("service-state-invalid", 500);
    }
    return result;
  }

  function ensurePendingCeremony(ceremony, type, request, context, digest, atMilliseconds) {
    if (ceremony.ceremonyType !== type
        || ceremony.operationId !== request.operationId
        || ceremony.ceremonyId !== request.ceremonyId
        || ceremony.priorSessionId !== context.sessionId
        || ceremony.finishDigest !== null
        || ceremony.completedResult !== null) {
      throw serviceError("service-ceremony-invalid", 400);
    }
    if (type === "registration" && ceremony.deviceId !== request.deviceId) {
      throw serviceError("service-ceremony-invalid", 400);
    }
    if (Date.parse(ceremony.expiresAt) <= atMilliseconds) {
      throw serviceError("service-ceremony-expired", 410);
    }
    if (!DIGEST_PATTERN.test(digest)) throw serviceError("service-ceremony-invalid", 400);
  }

  function registrationOptions(accountId, userId, prfEvaluationInput, challenge, credentials) {
    return frozen({
      rp: { id: rpId, name: rpName },
      user: { id: userId, name: accountId, displayName: accountId },
      challenge,
      pubKeyCredParams: credentialAlgorithms.map((alg) => ({ type: "public-key", alg })),
      timeout: ceremonyLifetimeMs,
      excludeCredentials: credentials.map((credential) => ({
        type: "public-key",
        id: credential.credentialId,
        transports: credential.transports.slice(),
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      attestation: "none",
      extensions: { prf: { eval: { first: prfEvaluationInput } } },
    });
  }

  function authenticationOptions(prfEvaluationInput, challenge, credentials) {
    return frozen({
      challenge,
      timeout: ceremonyLifetimeMs,
      rpId,
      allowCredentials: credentials.map((credential) => ({
        type: "public-key",
        id: credential.credentialId,
        transports: credential.transports.slice(),
      })),
      userVerification: "required",
      extensions: { prf: { eval: { first: prfEvaluationInput } } },
    });
  }

  async function loadAccountCredentials(transaction, account) {
    const values = [];
    for (const credentialId of account.credentialIds) {
      const credential = await readRecord(transaction, COLLECTIONS.credentials, credentialId);
      if (credential === null || credential.accountId !== account.accountId) {
        throw serviceError("service-state-invalid", 500);
      }
      values.push(credential);
    }
    return Object.freeze(values);
  }

  async function beginRegistration(value) {
    const { context, body } = invocation(value);
    const request = validateBeginRegistrationRequest(body);
    const at = clockMilliseconds();
    const digest = beginDigest("registration", request, context.sessionId);
    return transact("readwrite", async (transaction) => {
      const existing = await readRecord(transaction, COLLECTIONS.ceremonies, request.operationId);
      if (existing !== null) {
        if (existing.requestDigest !== digest) {
          throw serviceError("service-operation-reuse", 409);
        }
        if (existing.finishDigest !== null) {
          throw serviceError("service-ceremony-complete", 409);
        }
        if (Date.parse(existing.expiresAt) <= at) {
          throw serviceError("service-ceremony-expired", 410);
        }
        if (context.sessionId !== null) {
          const authorised = await authoriseSession(transaction, context.sessionId, at);
          if (authorised.account.accountId !== existing.accountId) {
            throw serviceError("service-state-invalid", 500);
          }
        }
        return frozen({ status: 200, body: existing.beginBody, session: null });
      }

      let account = null;
      let credentials = Object.freeze([]);
      if (context.sessionId !== null) {
        const authorised = await authoriseSession(transaction, context.sessionId, at);
        account = authorised.account;
        credentials = authorised.credentials;
      }
      const accountId = account ? account.accountId : randomToken();
      const prfEvaluationInput = account ? account.prfEvaluationInput : randomToken();
      if (!account) await ensureGeneratedKeyAvailable(transaction, COLLECTIONS.accounts, accountId);
      const ceremonyId = randomToken();
      const challenge = randomToken();
      const userId = randomToken();
      const expiresAt = expiry(at, ceremonyLifetimeMs);
      const beginBody = frozen({
        apiVersion: 1,
        ok: true,
        operationId: request.operationId,
        ceremonyId,
        expiresAt,
        prfEvaluationInput,
        publicKeyCreationOptions: registrationOptions(
          accountId,
          userId,
          prfEvaluationInput,
          challenge,
          credentials
        ),
      });
      validateRegistrationOptions(
        beginBody.publicKeyCreationOptions,
        prfEvaluationInput,
        "service-state-invalid"
      );
      const ceremony = frozen({
        kind: "pocket.sync.service-ceremony",
        schemaVersion: 1,
        storeVersion: 1,
        ceremonyType: "registration",
        operationId: request.operationId,
        ceremonyId,
        requestDigest: digest,
        accountId,
        priorSessionId: context.sessionId,
        deviceId: request.deviceId,
        challenge,
        prfEvaluationInput,
        expiresAt,
        beginBody,
        finishDigest: null,
        completedResult: null,
      });
      await insertRecord(transaction, COLLECTIONS.ceremonies, request.operationId, ceremony);
      return frozen({ status: 200, body: beginBody, session: null });
    });
  }

  async function beginAuthentication(value) {
    const { context, body } = invocation(value);
    const request = validateBeginAuthenticationRequest(body);
    const at = clockMilliseconds();
    const digest = beginDigest("authentication", request, context.sessionId);
    return transact("readwrite", async (transaction) => {
      const existing = await readRecord(transaction, COLLECTIONS.ceremonies, request.operationId);
      if (existing !== null) {
        if (existing.requestDigest !== digest) throw serviceError("service-operation-reuse", 409);
        if (existing.finishDigest !== null) throw serviceError("service-ceremony-complete", 409);
        if (Date.parse(existing.expiresAt) <= at) {
          throw serviceError("service-ceremony-expired", 410);
        }
        if (context.sessionId !== null) {
          const authorised = await authoriseSession(transaction, context.sessionId, at);
          if (authorised.account.accountId !== existing.accountId) {
            throw serviceError("service-state-invalid", 500);
          }
        } else {
          const account = await readRecord(transaction, COLLECTIONS.accounts, existing.accountId);
          if (account === null) throw serviceError("service-state-invalid", 500);
        }
        return frozen({ status: 200, body: existing.beginBody, session: null });
      }

      let account;
      let credentials;
      if (context.sessionId !== null) {
        const authorised = await authoriseSession(transaction, context.sessionId, at);
        account = authorised.account;
        credentials = authorised.credentials;
        if (request.accountLocator !== undefined
            && request.accountLocator !== account.accountId) {
          throw serviceError("service-authorisation-failed", 403);
        }
      } else {
        if (request.accountLocator === undefined) {
          throw serviceError("service-account-unresolved", 404);
        }
        account = await readRecord(transaction, COLLECTIONS.accounts, request.accountLocator);
        if (account === null) throw serviceError("service-account-unresolved", 404);
        credentials = await loadAccountCredentials(transaction, account);
      }
      if (credentials.length < 1) throw serviceError("service-account-unresolved", 404);
      const ceremonyId = randomToken();
      const challenge = randomToken();
      const expiresAt = expiry(at, ceremonyLifetimeMs);
      const beginBody = frozen({
        apiVersion: 1,
        ok: true,
        operationId: request.operationId,
        ceremonyId,
        expiresAt,
        prfEvaluationInput: account.prfEvaluationInput,
        publicKeyRequestOptions: authenticationOptions(
          account.prfEvaluationInput,
          challenge,
          credentials
        ),
      });
      validateAuthenticationOptions(
        beginBody.publicKeyRequestOptions,
        account.prfEvaluationInput,
        "service-state-invalid"
      );
      const ceremony = frozen({
        kind: "pocket.sync.service-ceremony",
        schemaVersion: 1,
        storeVersion: 1,
        ceremonyType: "authentication",
        operationId: request.operationId,
        ceremonyId,
        requestDigest: digest,
        accountId: account.accountId,
        priorSessionId: context.sessionId,
        deviceId: null,
        challenge,
        prfEvaluationInput: account.prfEvaluationInput,
        expiresAt,
        beginBody,
        finishDigest: null,
        completedResult: null,
      });
      await insertRecord(transaction, COLLECTIONS.ceremonies, request.operationId, ceremony);
      return frozen({ status: 200, body: beginBody, session: null });
    });
  }

  async function callVerifier(method, inputValue) {
    let promise;
    try {
      promise = webAuthnVerifier[method](frozen(inputValue));
      if (!thenable(promise)) throw serviceError("service-webauthn-failed", 400);
      return await promise;
    } catch (_error) {
      throw serviceError("service-webauthn-failed", 400);
    }
  }

  async function createSession(transaction, accountId, credentialId, priorSession, at) {
    const sessionId = randomToken();
    await ensureGeneratedKeyAvailable(transaction, COLLECTIONS.sessions, sessionId);
    const expiresAt = expiry(at, sessionLifetimeMs);
    const record = frozen({
      kind: "pocket.sync.service-session",
      schemaVersion: 1,
      storeVersion: 1,
      sessionId,
      accountId,
      credentialId,
      status: "active",
      createdAt: timestamp(at),
      expiresAt,
      replacedBy: null,
    });
    if (priorSession !== null) {
      const revoked = frozen({
        ...priorSession,
        storeVersion: priorSession.storeVersion + 1,
        status: "revoked",
        replacedBy: sessionId,
      });
      await replaceRecord(
        transaction,
        COLLECTIONS.sessions,
        priorSession.sessionId,
        priorSession,
        revoked
      );
    }
    await insertRecord(transaction, COLLECTIONS.sessions, sessionId, record);
    return frozen({
      instruction: {
        action: "set",
        sessionId,
        expiresAt,
        replaceSessionId: priorSession ? priorSession.sessionId : null,
      },
      record,
    });
  }

  function finishBody(ceremony, credentialId) {
    return frozen({
      apiVersion: 1,
      ok: true,
      operationId: ceremony.operationId,
      ceremonyId: ceremony.ceremonyId,
      accountId: ceremony.accountId,
      credentialId,
      credentialVersion: POLICY.credentialVersion,
      accountPolicyVersion: POLICY.accountPolicyVersion,
      prfEvaluationInput: ceremony.prfEvaluationInput,
    });
  }

  async function finishRegistration(value) {
    const { context, body } = invocation(value);
    const request = validateFinishRegistrationRequest(body);
    const at = clockMilliseconds();
    const digest = finishDigest("registration", request, context.sessionId);
    const prepared = await transact("readonly", async (transaction) => {
      const ceremony = await readRecord(
        transaction,
        COLLECTIONS.ceremonies,
        request.operationId
      );
      if (ceremony === null) throw serviceError("service-ceremony-invalid", 400);
      if (ceremony.finishDigest !== null) {
        return frozen({ replay: await completedReplay(transaction, ceremony, digest, at) });
      }
      ensurePendingCeremony(ceremony, "registration", request, context, digest, at);
      let account = null;
      let priorSession = null;
      if (context.sessionId !== null) {
        const authorised = await authoriseSession(transaction, context.sessionId, at);
        account = authorised.account;
        priorSession = authorised.session;
        if (account.accountId !== ceremony.accountId) {
          throw serviceError("service-authorisation-failed", 403);
        }
      }
      return frozen({ ceremony, account, priorSession, replay: null });
    });
    if (prepared.replay) return prepared.replay;

    const rawVerified = await callVerifier("verifyRegistration", {
      trustedOrigin,
      rpId,
      challenge: prepared.ceremony.challenge,
      publicKeyCreationOptions: prepared.ceremony.beginBody.publicKeyCreationOptions,
      credential: request.credential,
    });
    const verified = validateRegistrationVerifierResult(rawVerified, credentialAlgorithms);
    if (verified.credentialId !== request.credential.id) {
      throw serviceError("service-webauthn-failed", 400);
    }
    const commitAt = clockMilliseconds();

    return transact("readwrite", async (transaction) => {
      const ceremony = await readRecord(
        transaction,
        COLLECTIONS.ceremonies,
        request.operationId
      );
      if (ceremony === null) throw serviceError("service-ceremony-invalid", 400);
      if (ceremony.finishDigest !== null) {
        return completedReplay(transaction, ceremony, digest, commitAt);
      }
      ensurePendingCeremony(ceremony, "registration", request, context, digest, commitAt);
      if (ceremony.storeVersion !== prepared.ceremony.storeVersion) {
        throw serviceError("service-transaction-conflict", 409, { retryable: true });
      }

      let account = null;
      let priorSession = null;
      if (context.sessionId !== null) {
        const authorised = await authoriseSession(transaction, context.sessionId, commitAt);
        account = authorised.account;
        priorSession = authorised.session;
        if (account.accountId !== ceremony.accountId
            || !prepared.account
            || account.storeVersion !== prepared.account.storeVersion
            || !prepared.priorSession
            || priorSession.storeVersion !== prepared.priorSession.storeVersion) {
          throw serviceError("service-transaction-conflict", 409, { retryable: true });
        }
      } else {
        const collision = await readRecord(
          transaction,
          COLLECTIONS.accounts,
          ceremony.accountId
        );
        if (collision !== null) throw serviceError("service-random-collision", 409);
      }

      const existingCredential = await readRecord(
        transaction,
        COLLECTIONS.credentials,
        verified.credentialId
      );
      if (existingCredential !== null) throw serviceError("service-webauthn-failed", 400);
      const createdAt = timestamp(commitAt);
      const credential = frozen({
        kind: "pocket.sync.service-credential",
        schemaVersion: 1,
        storeVersion: 1,
        credentialId: verified.credentialId,
        accountId: ceremony.accountId,
        credentialVersion: 1,
        status: "active",
        publicKey: verified.publicKey,
        publicKeyAlgorithm: verified.publicKeyAlgorithm,
        signCount: verified.signCount,
        transports: verified.transports,
        backupEligible: verified.backupEligible,
        backedUp: verified.backedUp,
        createdAt,
      });
      await insertRecord(
        transaction,
        COLLECTIONS.credentials,
        credential.credentialId,
        credential
      );

      if (account === null) {
        account = frozen({
          kind: "pocket.sync.service-account",
          schemaVersion: 1,
          storeVersion: 1,
          accountId: ceremony.accountId,
          accountPolicyVersion: 1,
          prfEvaluationInput: ceremony.prfEvaluationInput,
          credentialIds: [credential.credentialId],
          syncedPocketId: null,
          createdAt,
        });
        await insertRecord(
          transaction,
          COLLECTIONS.accounts,
          account.accountId,
          account
        );
      } else {
        if (account.prfEvaluationInput !== ceremony.prfEvaluationInput
            || account.credentialIds.includes(credential.credentialId)) {
          throw serviceError("service-state-invalid", 500);
        }
        const updatedAccount = frozen({
          ...account,
          storeVersion: account.storeVersion + 1,
          credentialIds: [...account.credentialIds, credential.credentialId],
        });
        await replaceRecord(
          transaction,
          COLLECTIONS.accounts,
          account.accountId,
          account,
          updatedAccount
        );
        account = updatedAccount;
      }

      const session = await createSession(
        transaction,
        account.accountId,
        credential.credentialId,
        priorSession,
        commitAt
      );
      const bodyValue = finishBody(ceremony, credential.credentialId);
      const result = frozen({ status: 200, body: bodyValue, session: session.instruction });
      const completed = frozen({
        ...ceremony,
        storeVersion: ceremony.storeVersion + 1,
        finishDigest: digest,
        completedResult: result,
      });
      await replaceRecord(
        transaction,
        COLLECTIONS.ceremonies,
        ceremony.operationId,
        ceremony,
        completed
      );
      return result;
    });
  }

  async function finishAuthentication(value) {
    const { context, body } = invocation(value);
    const request = validateFinishAuthenticationRequest(body);
    const at = clockMilliseconds();
    const digest = finishDigest("authentication", request, context.sessionId);
    const prepared = await transact("readonly", async (transaction) => {
      const ceremony = await readRecord(
        transaction,
        COLLECTIONS.ceremonies,
        request.operationId
      );
      if (ceremony === null) throw serviceError("service-ceremony-invalid", 400);
      if (ceremony.finishDigest !== null) {
        return frozen({ replay: await completedReplay(transaction, ceremony, digest, at) });
      }
      ensurePendingCeremony(ceremony, "authentication", request, context, digest, at);
      let account;
      let priorSession = null;
      if (context.sessionId !== null) {
        const authorised = await authoriseSession(transaction, context.sessionId, at);
        account = authorised.account;
        priorSession = authorised.session;
      } else {
        account = await readRecord(transaction, COLLECTIONS.accounts, ceremony.accountId);
        if (account === null) throw serviceError("service-state-invalid", 500);
      }
      if (account.accountId !== ceremony.accountId
          || !account.credentialIds.includes(request.credential.id)) {
        throw serviceError("service-authorisation-failed", 403);
      }
      const credential = await readRecord(
        transaction,
        COLLECTIONS.credentials,
        request.credential.id
      );
      if (credential === null || credential.accountId !== account.accountId) {
        throw serviceError("service-authorisation-failed", 403);
      }
      return frozen({ ceremony, account, priorSession, credential, replay: null });
    });
    if (prepared.replay) return prepared.replay;

    const rawVerified = await callVerifier("verifyAuthentication", {
      trustedOrigin,
      rpId,
      challenge: prepared.ceremony.challenge,
      publicKeyRequestOptions: prepared.ceremony.beginBody.publicKeyRequestOptions,
      credential: request.credential,
      storedCredential: prepared.credential,
    });
    const verified = validateAuthenticationVerifierResult(rawVerified);
    if (verified.credentialId !== request.credential.id
        || verified.credentialId !== prepared.credential.credentialId
        || (prepared.credential.signCount > 0
          && verified.signCount <= prepared.credential.signCount)) {
      throw serviceError("service-webauthn-failed", 400);
    }
    const commitAt = clockMilliseconds();

    return transact("readwrite", async (transaction) => {
      const ceremony = await readRecord(
        transaction,
        COLLECTIONS.ceremonies,
        request.operationId
      );
      if (ceremony === null) throw serviceError("service-ceremony-invalid", 400);
      if (ceremony.finishDigest !== null) {
        return completedReplay(transaction, ceremony, digest, commitAt);
      }
      ensurePendingCeremony(ceremony, "authentication", request, context, digest, commitAt);
      if (ceremony.storeVersion !== prepared.ceremony.storeVersion) {
        throw serviceError("service-transaction-conflict", 409, { retryable: true });
      }

      let account;
      let priorSession = null;
      if (context.sessionId !== null) {
        const authorised = await authoriseSession(transaction, context.sessionId, commitAt);
        account = authorised.account;
        priorSession = authorised.session;
      } else {
        account = await readRecord(transaction, COLLECTIONS.accounts, ceremony.accountId);
        if (account === null) throw serviceError("service-state-invalid", 500);
      }
      const credential = await readRecord(
        transaction,
        COLLECTIONS.credentials,
        request.credential.id
      );
      if (credential === null
          || account.accountId !== ceremony.accountId
          || credential.accountId !== account.accountId
          || account.storeVersion !== prepared.account.storeVersion
          || credential.storeVersion !== prepared.credential.storeVersion
          || (prepared.priorSession !== null
            && (!priorSession
              || priorSession.storeVersion !== prepared.priorSession.storeVersion))) {
        throw serviceError("service-transaction-conflict", 409, { retryable: true });
      }
      if (credential.signCount > 0 && verified.signCount <= credential.signCount) {
        throw serviceError("service-webauthn-failed", 400);
      }
      let currentCredential = credential;
      if (verified.signCount !== credential.signCount || verified.backedUp !== credential.backedUp) {
        currentCredential = frozen({
          ...credential,
          storeVersion: credential.storeVersion + 1,
          signCount: verified.signCount,
          backedUp: verified.backedUp,
        });
        await replaceRecord(
          transaction,
          COLLECTIONS.credentials,
          credential.credentialId,
          credential,
          currentCredential
        );
      }
      const session = await createSession(
        transaction,
        account.accountId,
        currentCredential.credentialId,
        priorSession,
        commitAt
      );
      const bodyValue = finishBody(ceremony, currentCredential.credentialId);
      const result = frozen({ status: 200, body: bodyValue, session: session.instruction });
      const completed = frozen({
        ...ceremony,
        storeVersion: ceremony.storeVersion + 1,
        finishDigest: digest,
        completedResult: result,
      });
      await replaceRecord(
        transaction,
        COLLECTIONS.ceremonies,
        ceremony.operationId,
        ceremony,
        completed
      );
      return result;
    });
  }

  async function readRevision(value) {
    const { context, body } = invocation(value);
    const request = validateReadRevisionRequest(body);
    const at = clockMilliseconds();
    return transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      if (account.syncedPocketId === null) {
        return frozen({
          status: 200,
          body: {
            apiVersion: 1,
            ok: true,
            operationId: request.operationId,
            syncedPocketId: request.syncedPocketId,
            revision: 0,
            recordPresent: false,
            contentFormat: null,
            contentVersion: null,
            encryptedRecordSize: 0,
          },
          session: null,
        });
      }
      if (account.syncedPocketId !== request.syncedPocketId) {
        throw serviceError("service-authorisation-failed", 403);
      }
      const pocket = await readRecord(
        transaction,
        COLLECTIONS.pockets,
        request.syncedPocketId
      );
      if (pocket === null || pocket.accountId !== account.accountId) {
        throw serviceError("service-state-invalid", 500);
      }
      return frozen({
        status: 200,
        body: {
          apiVersion: 1,
          ok: true,
          operationId: request.operationId,
          syncedPocketId: request.syncedPocketId,
          revision: pocket.revision,
          recordPresent: true,
          contentFormat: POLICY.contentFormat,
          contentVersion: POLICY.contentVersion,
          encryptedRecordSize: pocket.encryptedRecordSize,
        },
        session: null,
      });
    });
  }

  async function downloadEncryptedRecord(value) {
    const { context, body } = invocation(value);
    const request = validateDownloadRequest(body);
    const at = clockMilliseconds();
    return transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      if (account.syncedPocketId !== request.syncedPocketId) {
        throw serviceError("service-authorisation-failed", 403);
      }
      const pocket = await readRecord(
        transaction,
        COLLECTIONS.pockets,
        request.syncedPocketId
      );
      if (pocket === null || pocket.accountId !== account.accountId) {
        throw serviceError("service-record-not-found", 404);
      }
      if (pocket.revision !== request.revision) {
        throw serviceError("service-record-not-found", 404);
      }
      return frozen({
        status: 200,
        body: {
          apiVersion: 1,
          ok: true,
          operationId: request.operationId,
          syncedPocketId: request.syncedPocketId,
          revision: pocket.revision,
          encryptedRecordSize: pocket.encryptedRecordSize,
          encryptedRecord: pocket.encryptedRecord,
        },
        session: null,
      });
    });
  }

  function storedOperationResult(operation, attemptKind) {
    if (attemptKind !== "idempotent-retry") {
      throw serviceError("service-operation-reuse", 409);
    }
    if (operation.result.status === "committed") {
      return frozen({
        status: 200,
        body: {
          apiVersion: 1,
          ok: true,
          status: "committed",
          wrote: true,
          revision: operation.result.revision,
          operationId: operation.operationId,
          replayed: true,
        },
        session: null,
      });
    }
    return frozen({
      status: 409,
      body: {
        apiVersion: 1,
        ok: false,
        status: "conflict",
        wrote: false,
        conflict: true,
        actualRevision: operation.result.actualRevision,
        operationId: operation.operationId,
      },
      session: null,
    });
  }

  async function conditionalUpload(value) {
    const { context, body } = invocation(value);
    const request = validateConditionalRequest(body);
    const at = clockMilliseconds();
    return transact("readwrite", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      if (account.syncedPocketId !== null
          && account.syncedPocketId !== request.syncedPocketId) {
        throw serviceError("service-authorisation-failed", 403);
      }
      let pocket = null;
      if (account.syncedPocketId !== null) {
        pocket = await readRecord(
          transaction,
          COLLECTIONS.pockets,
          request.syncedPocketId
        );
        if (pocket === null || pocket.accountId !== account.accountId) {
          throw serviceError("service-state-invalid", 500);
        }
      }
      const digest = uploadDigest(account.accountId, request);
      const key = operationKey(account.accountId, request.syncedPocketId, request.operationId);
      const existingOperation = await readRecord(transaction, COLLECTIONS.operations, key);
      if (existingOperation !== null) {
        if (existingOperation.requestDigest !== digest
            || existingOperation.logicalChangeId !== request.logicalChangeId
            || existingOperation.expectedRevision !== request.expectedRevision) {
          throw serviceError("service-operation-reuse", 409);
        }
        const recordedRevision = existingOperation.result.status === "committed"
          ? existingOperation.result.revision
          : existingOperation.result.actualRevision;
        if (pocket === null || pocket.revision < recordedRevision) {
          throw serviceError("service-state-invalid", 500);
        }
        return storedOperationResult(existingOperation, request.attemptKind);
      }
      const actualRevision = pocket ? pocket.revision : 0;
      if (actualRevision < request.expectedRevision) {
        throw serviceError("service-state-invalid", 500);
      }

      let operationResult;
      let wrapper;
      if (actualRevision === request.expectedRevision) {
        const nextRevision = request.expectedRevision + 1;
        if (!Number.isSafeInteger(nextRevision)) {
          throw serviceError("service-request-invalid", 400);
        }
        const encryptedRecordSize = canonicalBase64urlByteLength(
          request.encryptedRecord.ciphertext
        );
        const pocketRecord = frozen({
          kind: "pocket.sync.service-pocket",
          schemaVersion: 1,
          storeVersion: pocket ? pocket.storeVersion + 1 : 1,
          accountId: account.accountId,
          syncedPocketId: request.syncedPocketId,
          revision: nextRevision,
          encryptedRecordSize,
          encryptedRecord: request.encryptedRecord,
          createdAt: pocket ? pocket.createdAt : timestamp(at),
        });
        if (pocket) {
          await replaceRecord(
            transaction,
            COLLECTIONS.pockets,
            request.syncedPocketId,
            pocket,
            pocketRecord
          );
        } else {
          const collision = await readRecord(
            transaction,
            COLLECTIONS.pockets,
            request.syncedPocketId
          );
          if (collision !== null) {
            throw serviceError("service-authorisation-failed", 403);
          }
          await insertRecord(
            transaction,
            COLLECTIONS.pockets,
            request.syncedPocketId,
            pocketRecord
          );
          const boundAccount = frozen({
            ...account,
            storeVersion: account.storeVersion + 1,
            syncedPocketId: request.syncedPocketId,
          });
          await replaceRecord(
            transaction,
            COLLECTIONS.accounts,
            account.accountId,
            account,
            boundAccount
          );
        }
        operationResult = frozen({ status: "committed", revision: nextRevision });
        wrapper = frozen({
          status: 200,
          body: {
            apiVersion: 1,
            ok: true,
            status: "committed",
            wrote: true,
            revision: nextRevision,
            operationId: request.operationId,
            replayed: false,
          },
          session: null,
        });
      } else {
        operationResult = frozen({ status: "conflict", actualRevision });
        wrapper = frozen({
          status: 409,
          body: {
            apiVersion: 1,
            ok: false,
            status: "conflict",
            wrote: false,
            conflict: true,
            actualRevision,
            operationId: request.operationId,
          },
          session: null,
        });
      }

      const operation = frozen({
        kind: "pocket.sync.service-operation",
        schemaVersion: 1,
        storeVersion: 1,
        accountId: account.accountId,
        syncedPocketId: request.syncedPocketId,
        operationId: request.operationId,
        logicalChangeId: request.logicalChangeId,
        expectedRevision: request.expectedRevision,
        requestDigest: digest,
        result: operationResult,
      });
      await insertRecord(transaction, COLLECTIONS.operations, key, operation);
      return wrapper;
    });
  }

  return Object.freeze({
    beginRegistration,
    finishRegistration,
    beginAuthentication,
    finishAuthentication,
    readRevision,
    downloadEncryptedRecord,
    conditionalUpload,
  });
}

module.exports = Object.freeze({
  POLICY,
  COLLECTIONS,
  createServiceCore,
});
