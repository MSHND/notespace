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
  envelopeFormat: "pocket.sync.master-key-envelope.opaque",
  envelopeVersion: 1,
  envelopeAlgorithm: "AES-GCM-256",
  envelopeCiphertextByteLength: 48,
  hkdfSaltByteLength: 32,
  recoveryProofMinimumBytes: 32,
  recoveryProofMaximumBytes: 1024,
  randomByteLength: 32,
  nonceByteLength: 12,
  authenticationTagByteLength: 16,
  maximumIdentifierLength: 160,
  maximumRpNameLength: 120,
  maximumPublicKeyBytes: 4096,
  maximumCeremonyLifetimeMs: 10 * 60 * 1000,
  maximumSessionLifetimeMs: 90 * 24 * 60 * 60 * 1000,
  maximumContentEncryptionsPerMasterKey: 2 ** 31,
  deviceContentEncryptionAllowance: 2 ** 20,
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
  keySets: "keySets",
  envelopes: "envelopes",
  recoveryLocators: "recoveryLocators",
  recoveryCeremonies: "recoveryCeremonies",
  keyOperations: "keyOperations",
  persistenceAuthorities: "persistenceAuthorities",
});

const COLLECTION_NAMES = Object.freeze(Object.values(COLLECTIONS));
const FACTORY_FIELDS = Object.freeze([
  "store",
  "objectHeadStore",
  "webAuthnVerifier",
  "recoveryProofVerifier",
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
    "mode",
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
  keySets: Object.freeze([
    "kind", "schemaVersion", "storeVersion", "accountId", "syncedPocketId",
    "keySetVersion", "envelopeIds", "recoveryStatus", "recoveryVersion",
    "recoveryEnvelopeId", "recoveryVerifier", "accountLocator",
    "recoveryOperationId", "recoveryCredentialId", "masterKeyGeneration",
    "masterKeyContentEncryptionsReserved", "createdAt", "updatedAt",
  ]),
  envelopes: Object.freeze([
    "kind", "schemaVersion", "storeVersion", "accountId", "syncedPocketId",
    "envelopeId", "envelopeKind", "envelopeVersion", "status", "deviceId",
    "credentialId", "kdf", "kdfSalt", "derivationVersion",
    "encryptedEnvelopeSize", "encryptedEnvelope", "createdAt", "revokedAt",
  ]),
  recoveryLocators: Object.freeze([
    "kind", "schemaVersion", "storeVersion", "accountLocator", "accountId",
    "syncedPocketId", "recoveryVersion", "status", "createdAt", "revokedAt",
  ]),
  recoveryCeremonies: Object.freeze([
    "kind", "schemaVersion", "storeVersion", "operationId", "recoveryCeremonyId",
    "requestDigest", "accountId", "syncedPocketId", "deviceId", "challenge",
    "recoveryVersion", "keySetVersion", "prfEvaluationInput",
    "publicKeyCreationOptions", "expiresAt", "finishDigest",
    "completedCredentialId", "completedSessionId", "completedKeySetVersion",
  ]),
  keyOperations: Object.freeze([
    "kind", "schemaVersion", "storeVersion", "accountId", "syncedPocketId",
    "operationId", "logicalChangeId", "operationKind", "expectedKeySetVersion",
    "requestDigest", "result",
  ]),
  persistenceAuthorities: Object.freeze([
    "kind", "schemaVersion", "storeVersion", "accountId", "syncedPocketId",
    "authorityRevision", "currentMode", "transition", "rollbackRevision", "adoptionHead",
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

function validateMasterKeyEnvelope(input, code = "service-envelope-invalid") {
  const record = exactObject(input, [
    "format", "version", "algorithm", "nonce", "ciphertext",
  ], ["format", "version", "algorithm", "nonce", "ciphertext"], code);
  if (record.format !== POLICY.envelopeFormat
      || record.version !== POLICY.envelopeVersion
      || record.algorithm !== POLICY.envelopeAlgorithm
      || canonicalBase64urlByteLength(record.nonce) !== POLICY.nonceByteLength
      || canonicalBase64urlByteLength(record.ciphertext)
        !== POLICY.envelopeCiphertextByteLength) {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  return frozen(record);
}

function validateRecoveryVerifier(input, code = "service-request-invalid") {
  const value = exactObject(input, ["version", "algorithm", "publicKeyFormat", "publicKey"],
    ["version", "algorithm", "publicKeyFormat", "publicKey"], code);
  if (value.version !== 1 || value.algorithm !== "Ed25519" || value.publicKeyFormat !== "spki"
      || canonicalBase64urlByteLength(value.publicKey) < 32
      || canonicalBase64urlByteLength(value.publicKey) > POLICY.maximumPublicKeyBytes) {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  return frozen(value);
}

function validateRecoveryProof(input) {
  const value = exactObject(input, ["version", "algorithm", "signature"], [
    "version", "algorithm", "signature",
  ]);
  const size = canonicalBase64urlByteLength(value.signature);
  if (value.version !== 1 || value.algorithm !== "Ed25519"
      || size < POLICY.recoveryProofMinimumBytes
      || size > POLICY.recoveryProofMaximumBytes) {
    throw serviceError("service-request-invalid");
  }
  return frozen(value);
}

function validateEnvelopeBinding(value, options = {}) {
  const code = options.code || "service-envelope-invalid";
  identifier(value.envelopeId, code);
  positiveInteger(value.envelopeVersion, code);
  if (!["device", "passkey-prf", "device-transfer", "recovery"].includes(value.envelopeKind)) {
    throw serviceError(code);
  }
  if (options.kind !== undefined && value.envelopeKind !== options.kind) {
    throw serviceError(code);
  }
  if (options.allowRecovery === false && value.envelopeKind === "recovery") {
    throw serviceError(code);
  }
  if (value.envelopeKind === "device") {
    identifier(value.deviceId, code);
    if (value.credentialId !== null || value.kdf !== "none"
        || value.kdfSalt !== null || value.derivationVersion !== null) {
      throw serviceError(code);
    }
  } else {
    if (value.deviceId !== null
        || value.kdf !== "HKDF-SHA-256"
        || canonicalBase64urlByteLength(value.kdfSalt) !== POLICY.hkdfSaltByteLength
        || value.derivationVersion !== 1) {
      throw serviceError(code);
    }
    if (value.envelopeKind === "passkey-prf") {
      identifier(value.credentialId, code);
    } else if (value.credentialId !== null) {
      throw serviceError(code);
    }
  }
  return value;
}

function validateEnvelopeInput(input, options = {}) {
  const code = options.code || "service-envelope-invalid";
  const value = exactObject(input, [
    "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
    "kdf", "kdfSalt", "derivationVersion", "encryptedEnvelope",
  ], [
    "envelopeId", "envelopeKind", "envelopeVersion", "deviceId", "credentialId",
    "kdf", "kdfSalt", "derivationVersion", "encryptedEnvelope",
  ], code);
  validateEnvelopeBinding(value, options);
  return frozen({
    envelopeId: value.envelopeId,
    envelopeKind: value.envelopeKind,
    envelopeVersion: value.envelopeVersion,
    deviceId: value.deviceId,
    credentialId: value.credentialId,
    kdf: value.kdf,
    kdfSalt: value.kdfSalt,
    derivationVersion: value.derivationVersion,
    encryptedEnvelope: validateMasterKeyEnvelope(value.encryptedEnvelope, code),
  });
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
  const bootstrap = type === "authentication-bootstrap";
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
    "bootstrap",
  ], [
    "apiVersion",
    "ok",
    "operationId",
    "ceremonyId",
    "accountId",
    "credentialId",
    "credentialVersion",
    "accountPolicyVersion",
    ...(bootstrap ? ["bootstrap"] : ["prfEvaluationInput"]),
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
  if (bootstrap) {
    if (body.bootstrap !== true || body.prfEvaluationInput !== undefined) {
      throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
    }
  } else {
    if (body.bootstrap !== undefined) throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
    canonicalBinary(body.prfEvaluationInput, { minimum: 32, maximum: 32 }, code);
  }
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
  const bootstrap = ceremonyType === "authentication-bootstrap";
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
    "bootstrap",
    optionsField,
  ];
  const required = fields.filter((field) => (field !== "prfEvaluationInput" || !bootstrap)
    && (field !== "bootstrap" || bootstrap));
  const body = exactObject(input, fields, required, code);
  if (body.apiVersion !== 1 || body.ok !== true) throw serviceError(code, 500);
  identifier(body.operationId, code);
  identifier(body.ceremonyId, code);
  isoTimestamp(body.expiresAt, code);
  if (bootstrap) {
    if (body.bootstrap !== true || body.prfEvaluationInput !== undefined) throw serviceError(code, 500);
  } else {
    if (body.bootstrap !== undefined) throw serviceError(code, 500);
    canonicalBinary(body.prfEvaluationInput, { minimum: 32, maximum: 32 }, code);
  }
  if (ceremonyType === "registration") {
    validateRegistrationOptions(body[optionsField], body.prfEvaluationInput, code);
  } else if (!bootstrap) {
    validateAuthenticationOptions(body[optionsField], body.prfEvaluationInput, code);
  } else {
    validateDiscoverableAuthenticationOptions(body[optionsField], code);
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
          || !["account-bound", "discoverable"].includes(input.mode)
          || input.operationId !== key
          || !DIGEST_PATTERN.test(input.requestDigest)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.operationId, "service-state-invalid");
      identifier(input.ceremonyId, "service-state-invalid");
      if (input.mode === "discoverable") {
        if (input.ceremonyType !== "authentication" || input.accountId !== null
            || input.priorSessionId !== null) throw serviceError("service-state-invalid", 500);
      } else {
        identifier(input.accountId, "service-state-invalid");
      }
      if (input.priorSessionId !== null) identifier(input.priorSessionId, "service-state-invalid");
      if (input.ceremonyType === "registration") {
        identifier(input.deviceId, "service-state-invalid");
      } else if (input.deviceId !== null) {
        throw serviceError("service-state-invalid", 500);
      }
      canonicalBinary(input.challenge, { minimum: 32, maximum: 32 }, "service-state-invalid");
      if (input.mode === "discoverable") {
        if (input.prfEvaluationInput !== null) throw serviceError("service-state-invalid", 500);
      } else {
        canonicalBinary(input.prfEvaluationInput, { minimum: 32, maximum: 32 }, "service-state-invalid");
      }
      isoTimestamp(input.expiresAt);
      const beginBody = validateBeginBody(input.beginBody,
        input.mode === "discoverable" ? "authentication-bootstrap" : input.ceremonyType);
      const options = input.ceremonyType === "registration"
        ? beginBody.publicKeyCreationOptions
        : beginBody.publicKeyRequestOptions;
      if (beginBody.operationId !== input.operationId
          || beginBody.ceremonyId !== input.ceremonyId
          || beginBody.expiresAt !== input.expiresAt
          || (input.mode !== "discoverable" && beginBody.prfEvaluationInput !== input.prfEvaluationInput)
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
          input.mode === "discoverable" ? "authentication-bootstrap" : input.ceremonyType
        );
        if (completedResult.body.operationId !== input.operationId
            || completedResult.body.ceremonyId !== input.ceremonyId
            || (input.mode !== "discoverable" && (completedResult.body.accountId !== input.accountId
              || completedResult.body.prfEvaluationInput !== input.prfEvaluationInput))) {
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
    case COLLECTIONS.keySets: {
      if (input.kind !== "pocket.sync.service-key-set"
          || input.syncedPocketId !== key
          || !Array.isArray(input.envelopeIds)
          || new Set(input.envelopeIds).size !== input.envelopeIds.length
          || !["unconfigured", "ready", "rotation-required"].includes(input.recoveryStatus)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountId, "service-state-invalid");
      identifier(input.syncedPocketId, "service-state-invalid");
      positiveInteger(input.keySetVersion, "service-state-invalid");
      positiveInteger(input.masterKeyGeneration, "service-state-invalid");
      const reserved = nonNegativeInteger(
        input.masterKeyContentEncryptionsReserved,
        "service-state-invalid"
      );
      if (reserved > POLICY.maximumContentEncryptionsPerMasterKey
          || reserved % POLICY.deviceContentEncryptionAllowance !== 0) {
        throw serviceError("service-state-invalid", 500);
      }
      input.envelopeIds.forEach((value) => identifier(value, "service-state-invalid"));
      nonNegativeInteger(input.recoveryVersion, "service-state-invalid");
      isoTimestamp(input.createdAt);
      isoTimestamp(input.updatedAt);
      if (input.recoveryStatus === "unconfigured") {
        if (input.recoveryVersion !== 0 || input.recoveryEnvelopeId !== null
            || input.recoveryVerifier !== null || input.accountLocator !== null
            || input.recoveryOperationId !== null || input.recoveryCredentialId !== null) {
          throw serviceError("service-state-invalid", 500);
        }
      } else {
        positiveInteger(input.recoveryVersion, "service-state-invalid");
        identifier(input.recoveryEnvelopeId, "service-state-invalid");
        identifier(input.accountLocator, "service-state-invalid");
        if (!input.envelopeIds.includes(input.recoveryEnvelopeId)) {
          throw serviceError("service-state-invalid", 500);
        }
        validateRecoveryVerifier(input.recoveryVerifier, "service-state-invalid");
        if (input.recoveryStatus === "ready") {
          if (input.recoveryOperationId !== null || input.recoveryCredentialId !== null) {
            throw serviceError("service-state-invalid", 500);
          }
        } else {
          identifier(input.recoveryOperationId, "service-state-invalid");
          identifier(input.recoveryCredentialId, "service-state-invalid");
        }
      }
      break;
    }
    case COLLECTIONS.envelopes: {
      if (input.kind !== "pocket.sync.service-envelope"
          || input.envelopeId !== key
          || !["active", "revoked"].includes(input.status)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountId, "service-state-invalid");
      identifier(input.syncedPocketId, "service-state-invalid");
      validateEnvelopeBinding(input, { code: "service-state-invalid" });
      isoTimestamp(input.createdAt);
      if (input.status === "active") {
        if (input.encryptedEnvelopeSize !== POLICY.envelopeCiphertextByteLength
            || input.revokedAt !== null) throw serviceError("service-state-invalid", 500);
        validateMasterKeyEnvelope(input.encryptedEnvelope, "service-state-invalid");
      } else if (input.encryptedEnvelopeSize !== 0
          || input.encryptedEnvelope !== null || input.revokedAt === null) {
        throw serviceError("service-state-invalid", 500);
      } else {
        isoTimestamp(input.revokedAt);
      }
      break;
    }
    case COLLECTIONS.recoveryLocators:
      if (input.kind !== "pocket.sync.service-recovery-locator"
          || input.accountLocator !== key
          || !["active", "revoked"].includes(input.status)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountLocator, "service-state-invalid");
      identifier(input.accountId, "service-state-invalid");
      identifier(input.syncedPocketId, "service-state-invalid");
      positiveInteger(input.recoveryVersion, "service-state-invalid");
      isoTimestamp(input.createdAt);
      if (input.status === "active" && input.revokedAt !== null) {
        throw serviceError("service-state-invalid", 500);
      }
      if (input.status === "revoked") isoTimestamp(input.revokedAt);
      break;
    case COLLECTIONS.recoveryCeremonies: {
      if (input.kind !== "pocket.sync.service-recovery-ceremony"
          || input.operationId !== key || !DIGEST_PATTERN.test(input.requestDigest)) {
        throw serviceError("service-state-invalid", 500);
      }
      [input.operationId, input.recoveryCeremonyId, input.accountId,
        input.syncedPocketId, input.deviceId].forEach((value) => (
        identifier(value, "service-state-invalid")
      ));
      canonicalBinary(input.challenge, { minimum: 32, maximum: 32 }, "service-state-invalid");
      positiveInteger(input.recoveryVersion, "service-state-invalid");
      positiveInteger(input.keySetVersion, "service-state-invalid");
      canonicalBinary(input.prfEvaluationInput, { minimum: 32, maximum: 32 }, "service-state-invalid");
      validateRegistrationOptions(input.publicKeyCreationOptions, input.prfEvaluationInput);
      if (input.publicKeyCreationOptions.challenge !== input.challenge
          || input.publicKeyCreationOptions.user.name !== input.accountId
          || input.publicKeyCreationOptions.user.displayName !== input.accountId) {
        throw serviceError("service-state-invalid", 500);
      }
      isoTimestamp(input.expiresAt);
      const pending = input.finishDigest === null
        && input.completedCredentialId === null && input.completedSessionId === null
        && input.completedKeySetVersion === null;
      const completed = typeof input.finishDigest === "string"
        && DIGEST_PATTERN.test(input.finishDigest)
        && typeof input.completedCredentialId === "string"
        && typeof input.completedSessionId === "string"
        && Number.isSafeInteger(input.completedKeySetVersion);
      if (!pending && !completed) throw serviceError("service-state-invalid", 500);
      if (completed) {
        identifier(input.completedCredentialId, "service-state-invalid");
        identifier(input.completedSessionId, "service-state-invalid");
        positiveInteger(input.completedKeySetVersion, "service-state-invalid");
      }
      break;
    }
    case COLLECTIONS.persistenceAuthorities: {
      if (input.kind !== "pocket.sync.persistence-authority"
          || input.syncedPocketId !== key
          || !["whole-record", "starling"].includes(input.currentMode)) {
        throw serviceError("service-state-invalid", 500);
      }
      identifier(input.accountId, "service-state-invalid");
      identifier(input.syncedPocketId, "service-state-invalid");
      positiveInteger(input.authorityRevision, "service-state-invalid");
      if (input.currentMode === "whole-record") {
        if (input.rollbackRevision !== null || input.adoptionHead !== null) {
          throw serviceError("service-state-invalid", 500);
        }
        if (input.transition !== null) {
          if (!sameKeys(input.transition, ["transitionId", "expectedAuthorityRevision"])) {
            throw serviceError("service-state-invalid", 500);
          }
          identifier(input.transition.transitionId, "service-state-invalid");
          positiveInteger(input.transition.expectedAuthorityRevision, "service-state-invalid");
          if (input.transition.expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER
              || input.transition.expectedAuthorityRevision + 1 !== input.authorityRevision) {
            throw serviceError("service-state-invalid", 500);
          }
        }
      } else {
        if (input.transition !== null
            || !Number.isSafeInteger(input.rollbackRevision) || input.rollbackRevision < 1
            || !validateStarlingHead(input.adoptionHead, "service-state-invalid")) {
          throw serviceError("service-state-invalid", 500);
        }
      }
      break;
    }
    case COLLECTIONS.keyOperations: {
      if (input.kind !== "pocket.sync.service-key-operation"
          || input.storeVersion !== 1 || !DIGEST_PATTERN.test(input.requestDigest)
          || !["add-envelope", "revoke-envelope", "initialise-recovery", "rotate-recovery"]
            .includes(input.operationKind)) {
        throw serviceError("service-state-invalid", 500);
      }
      [input.accountId, input.syncedPocketId, input.operationId, input.logicalChangeId]
        .forEach((value) => identifier(value, "service-state-invalid"));
      nonNegativeInteger(input.expectedKeySetVersion, "service-state-invalid");
      if (key !== operationKey(input.accountId, input.syncedPocketId, input.operationId)
          || !isObject(input.result)) throw serviceError("service-state-invalid", 500);
      if (input.result.status === "committed") {
        if (!sameKeys(input.result, ["status", "keySetVersion", "details"])) {
          throw serviceError("service-state-invalid", 500);
        }
        positiveInteger(input.result.keySetVersion, "service-state-invalid");
        if (input.result.keySetVersion !== input.expectedKeySetVersion + 1
            || !isObject(input.result.details)) throw serviceError("service-state-invalid", 500);
        if (["add-envelope", "revoke-envelope"].includes(input.operationKind)) {
          const allowanceDetails = sameKeys(input.result.details, [
            "masterKeyGeneration", "masterKeyContentEncryptionLimit",
          ]) && input.result.details.masterKeyGeneration === 1
            && input.result.details.masterKeyContentEncryptionLimit
              === POLICY.deviceContentEncryptionAllowance;
          if (!sameKeys(input.result.details, []) && !allowanceDetails) {
            throw serviceError("service-state-invalid", 500);
          }
        } else if (input.operationKind === "initialise-recovery") {
          if (!sameKeys(input.result.details, [
            "recoveryVersion", "accountLocator", "recoveryCopyRequired",
          ]) || input.result.details.recoveryVersion !== 1
              || input.result.details.recoveryCopyRequired !== true) {
            throw serviceError("service-state-invalid", 500);
          }
          identifier(input.result.details.accountLocator, "service-state-invalid");
        } else if (!sameKeys(input.result.details, [
          "recoveryVersion", "accountLocator", "previousRecoveryInvalidated",
          "replacementCopyRequired",
        ]) || input.result.details.previousRecoveryInvalidated !== true
            || input.result.details.replacementCopyRequired !== true) {
          throw serviceError("service-state-invalid", 500);
        } else {
          positiveInteger(input.result.details.recoveryVersion, "service-state-invalid");
          identifier(input.result.details.accountLocator, "service-state-invalid");
        }
      } else if (input.result.status === "conflict") {
        if (!sameKeys(input.result, ["status", "actualKeySetVersion", "actualRecoveryVersion"])) {
          throw serviceError("service-state-invalid", 500);
        }
        nonNegativeInteger(input.result.actualKeySetVersion, "service-state-invalid");
        nonNegativeInteger(input.result.actualRecoveryVersion, "service-state-invalid");
      } else throw serviceError("service-state-invalid", 500);
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
      || !isObject(input.objectHeadStore)
      || !sameKeys(input.objectHeadStore, ["putObject", "getObject", "presence", "initialiseHead", "readHead", "compareAndSetHead"])
      || ["putObject", "getObject", "presence", "initialiseHead", "readHead", "compareAndSetHead"].some((field) => typeof input.objectHeadStore[field] !== "function")
      || !isObject(input.webAuthnVerifier)
      || !sameKeys(input.webAuthnVerifier, ["verifyRegistration", "verifyAuthentication"])
      || typeof input.webAuthnVerifier.verifyRegistration !== "function"
      || typeof input.webAuthnVerifier.verifyAuthentication !== "function"
      || !isObject(input.recoveryProofVerifier)
      || !sameKeys(input.recoveryProofVerifier, ["verifyRecoveryProof"])
      || typeof input.recoveryProofVerifier.verifyRecoveryProof !== "function"
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

function validateDiscoverableAuthenticationOptions(input, code = "service-state-invalid") {
  const options = exactObject(input, ["challenge", "timeout", "rpId", "userVerification"],
    ["challenge", "rpId", "userVerification"], code);
  if (options.userVerification !== "required") {
    throw serviceError(code, code === "service-state-invalid" ? 500 : 400);
  }
  plainIdentifier(options.rpId, code);
  canonicalBinary(options.challenge, { minimum: 32 }, code);
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

function validateReadSyncedPocketRequest(input) {
  const value = exactObject(input, ["apiVersion", "operationId"], ["apiVersion", "operationId"]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({ apiVersion: 1, operationId: identifier(value.operationId) });
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

function validateReadPersistenceAuthorityRequest(input) {
  const value = exactObject(input, ["apiVersion", "operationId", "syncedPocketId"],
    ["apiVersion", "operationId", "syncedPocketId"]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId) });
}

function validateAuthorityFenceRequest(input) {
  const fields = ["apiVersion", "operationId", "syncedPocketId",
    "expectedAuthorityRevision", "transitionId"];
  const value = exactObject(input, fields, fields);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  const expectedAuthorityRevision = positiveInteger(value.expectedAuthorityRevision);
  if (expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER) {
    throw serviceError("service-request-invalid");
  }
  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId), expectedAuthorityRevision,
    transitionId: identifier(value.transitionId) });
}

function validateStarlingHead(input, code = "service-request-invalid") {
  const status = code === "service-state-invalid" ? 500 : 400;
  if (!isObject(input) || !sameKeys(input, ["schema", "revision", "sealRef"])
      || input.schema !== "pocket.starling.head.v1"
      || !Number.isSafeInteger(input.revision) || input.revision < 1
      || typeof input.sealRef !== "string" || input.sealRef.length < 1
      || input.sealRef.length > POLICY.maximumIdentifierLength
      || input.sealRef !== input.sealRef.trim()) {
    throw serviceError(code, status);
  }
  return frozen({ schema: input.schema, revision: input.revision, sealRef: input.sealRef });
}

function sameStarlingHead(left, right) {
  return !!left && !!right && left.schema === right.schema
    && left.revision === right.revision && left.sealRef === right.sealRef;
}

function validateAuthorityAdoptionRequest(input) {
  const fields = ["apiVersion", "operationId", "syncedPocketId", "expectedAuthorityRevision",
    "transitionId", "rollbackRevision", "adoptionHead"];
  const value = exactObject(input, fields, fields);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  const expectedAuthorityRevision = positiveInteger(value.expectedAuthorityRevision);
  if (expectedAuthorityRevision >= Number.MAX_SAFE_INTEGER) {
    throw serviceError("service-request-invalid");
  }
  return frozen({
    apiVersion: 1,
    operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId),
    expectedAuthorityRevision,
    transitionId: identifier(value.transitionId),
    rollbackRevision: positiveInteger(value.rollbackRevision),
    adoptionHead: validateStarlingHead(value.adoptionHead),
  });
}

function validateObjectHeadRequest(input, fields) {
  const value = exactObject(input, fields, fields);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  identifier(value.operationId);
  identifier(value.syncedPocketId);
  return frozen(value);
}

function validateKeyMutation(value, fields) {
  exactObject(value, fields, fields);
  if (value.apiVersion !== 1
      || !["new-change", "idempotent-retry"].includes(value.attemptKind)) {
    throw serviceError("service-request-invalid");
  }
  const expectedKeySetVersion = nonNegativeInteger(value.expectedKeySetVersion);
  if (expectedKeySetVersion >= Number.MAX_SAFE_INTEGER) {
    throw serviceError("service-request-invalid");
  }
  return {
    apiVersion: 1,
    operationId: identifier(value.operationId),
    logicalChangeId: identifier(value.logicalChangeId),
    attemptKind: value.attemptKind,
    syncedPocketId: identifier(value.syncedPocketId),
    expectedKeySetVersion,
  };
}

function validateListEnvelopesRequest(input) {
  const value = exactObject(input, ["apiVersion", "operationId", "syncedPocketId"], [
    "apiVersion", "operationId", "syncedPocketId",
  ]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId) });
}

function validateDownloadEnvelopeRequest(input) {
  const value = exactObject(input, [
    "apiVersion", "operationId", "syncedPocketId", "envelopeId",
  ], ["apiVersion", "operationId", "syncedPocketId", "envelopeId"]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
    syncedPocketId: identifier(value.syncedPocketId), envelopeId: identifier(value.envelopeId) });
}

function validateAddEnvelopeRequest(input) {
  const fields = ["apiVersion", "operationId", "logicalChangeId", "attemptKind",
    "syncedPocketId", "expectedKeySetVersion", "envelope"];
  const value = exactObject(input, fields, fields);
  return frozen({ ...validateKeyMutation(value, fields),
    envelope: validateEnvelopeInput(value.envelope, { allowRecovery: false }) });
}

function validateRevokeEnvelopeRequest(input) {
  const fields = ["apiVersion", "operationId", "logicalChangeId", "attemptKind",
    "syncedPocketId", "envelopeId", "expectedKeySetVersion"];
  const value = exactObject(input, fields, fields);
  return frozen({ ...validateKeyMutation(value, fields), envelopeId: identifier(value.envelopeId) });
}

function validateInitialiseRecoveryRequest(input) {
  const fields = ["apiVersion", "operationId", "logicalChangeId", "attemptKind",
    "syncedPocketId", "expectedKeySetVersion", "recoveryVerifier", "recoveryEnvelope"];
  const value = exactObject(input, fields, fields);
  const verifier = validateRecoveryVerifier(value.recoveryVerifier);
  if (verifier.version !== 1) throw serviceError("service-request-invalid");
  const envelope = validateEnvelopeInput(value.recoveryEnvelope, { kind: "recovery" });
  if (envelope.envelopeVersion !== 1) throw serviceError("service-envelope-invalid");
  return frozen({ ...validateKeyMutation(value, fields), recoveryVerifier: verifier,
    recoveryEnvelope: envelope });
}

function validateBeginRecoveryRequest(input) {
  const value = exactObject(input, [
    "apiVersion", "operationId", "accountLocator", "deviceId",
  ], ["apiVersion", "operationId", "accountLocator", "deviceId"]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
    accountLocator: identifier(value.accountLocator), deviceId: identifier(value.deviceId) });
}

function validateFinishRecoveryRequest(input) {
  const value = exactObject(input, [
    "apiVersion", "operationId", "recoveryCeremonyId", "deviceId", "proof", "credential",
  ], ["apiVersion", "operationId", "recoveryCeremonyId", "deviceId", "proof", "credential"]);
  if (value.apiVersion !== 1) throw serviceError("service-request-invalid");
  return frozen({ apiVersion: 1, operationId: identifier(value.operationId),
    recoveryCeremonyId: identifier(value.recoveryCeremonyId),
    deviceId: identifier(value.deviceId), proof: validateRecoveryProof(value.proof),
    credential: validateRegistrationCredential(value.credential) });
}

function validateRotateRecoveryRequest(input) {
  const fields = ["apiVersion", "operationId", "logicalChangeId", "attemptKind",
    "recoveryOperationId", "syncedPocketId", "expectedKeySetVersion",
    "expectedRecoveryVersion", "recoveryVerifier", "recoveryEnvelope"];
  const value = exactObject(input, fields, fields);
  const request = validateKeyMutation(value, fields);
  return frozen({ ...request, recoveryOperationId: identifier(value.recoveryOperationId),
    expectedRecoveryVersion: positiveInteger(value.expectedRecoveryVersion),
    recoveryVerifier: validateRecoveryVerifier(value.recoveryVerifier),
    recoveryEnvelope: validateEnvelopeInput(value.recoveryEnvelope, { kind: "recovery" }) });
}

function createServiceCore(input) {
  const config = validateFactoryConfig(input);
  const {
    store,
    objectHeadStore,
    webAuthnVerifier,
    recoveryProofVerifier,
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

  async function withPocketAuthorityLock(syncedPocketId, callback) {
    let pending;
    try {
      const lock = store.transact.withPocketAuthorityLock;
      if (typeof lock !== "function") throw serviceError("service-core-invalid", 500);
      pending = lock(syncedPocketId, callback);
      if (!thenable(pending)) throw serviceError("service-core-invalid", 500);
      return await pending;
    } catch (error) {
      if (error && typeof error.code === "string" && error.code.startsWith("service-")) throw error;
      throw mapTransactionError(error);
    }
  }

  function transactAuthorityMutation(syncedPocketId, callback) {
    return withPocketAuthorityLock(syncedPocketId, () => transact("readwrite", callback));
  }

  function initialPersistenceAuthority(account, syncedPocketId) {
    return frozen({
      kind: "pocket.sync.persistence-authority", schemaVersion: 1, storeVersion: 1,
      accountId: account.accountId, syncedPocketId, authorityRevision: 1,
      currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null,
    });
  }

  function persistenceAuthoritySnapshot(authority) {
    return frozen({
      schema: "pocket.sync.persistence-authority.v1",
      authorityRevision: authority.authorityRevision,
      currentMode: authority.currentMode,
      transition: authority.transition,
      rollbackRevision: authority.rollbackRevision,
      adoptionHead: authority.adoptionHead,
    });
  }

  function persistenceAuthorityIsSteady(authority) {
    return authority.currentMode === "whole-record" && authority.transition === null;
  }

  function persistenceAuthorityIsStarlingSteady(authority) {
    return authority.currentMode === "starling" && authority.transition === null
      && Number.isSafeInteger(authority.rollbackRevision) && authority.rollbackRevision >= 1
      && !!authority.adoptionHead;
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

  async function readPersistenceAuthorityRecord(transaction, account, syncedPocketId, options = {}) {
    const authority = await readRecord(transaction, COLLECTIONS.persistenceAuthorities, syncedPocketId);
    if (authority === null) {
      if (options.allowMissing === true) return null;
      throw serviceError("service-state-invalid", 500);
    }
    if (authority.accountId !== account.accountId || authority.syncedPocketId !== syncedPocketId) {
      throw serviceError("service-state-invalid", 500);
    }
    return authority;
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

  function keyMutationDigest(accountId, kind, request) {
    const logical = { ...request };
    delete logical.attemptKind;
    return sha256([1, "key-operation", accountId, kind, logical]);
  }

  function recoveryBeginDigest(request) {
    return sha256([1, "recovery", "begin", request.operationId,
      request.accountLocator, request.deviceId]);
  }

  function recoveryFinishDigest(request) {
    return sha256([1, "recovery", "finish", request.operationId,
      request.recoveryCeremonyId, request.deviceId, request.proof, request.credential]);
  }

  function recoveryCredentialDigest(credential) {
    return createHash("sha256").update(canonicalJson([
      "pocket.sync.recovery-credential.v1", credential,
    ]), "utf8").digest("base64url");
  }

  function envelopeRecord(accountId, syncedPocketId, envelope, at) {
    return frozen({
      kind: "pocket.sync.service-envelope",
      schemaVersion: 1,
      storeVersion: 1,
      accountId,
      syncedPocketId,
      envelopeId: envelope.envelopeId,
      envelopeKind: envelope.envelopeKind,
      envelopeVersion: envelope.envelopeVersion,
      status: "active",
      deviceId: envelope.deviceId,
      credentialId: envelope.credentialId,
      kdf: envelope.kdf,
      kdfSalt: envelope.kdfSalt,
      derivationVersion: envelope.derivationVersion,
      encryptedEnvelopeSize: POLICY.envelopeCiphertextByteLength,
      encryptedEnvelope: envelope.encryptedEnvelope,
      createdAt: timestamp(at),
      revokedAt: null,
    });
  }

  function envelopeMetadata(record) {
    return frozen({
      envelopeId: record.envelopeId,
      envelopeKind: record.envelopeKind,
      envelopeVersion: record.envelopeVersion,
      status: record.status,
      deviceId: record.deviceId,
      credentialId: record.credentialId,
      kdf: record.kdf,
      kdfSalt: record.kdfSalt,
      derivationVersion: record.derivationVersion,
      createdAt: record.createdAt,
      revokedAt: record.revokedAt,
    });
  }

  function envelopeDownload(record) {
    return frozen({
      envelopeId: record.envelopeId,
      envelopeKind: record.envelopeKind,
      envelopeVersion: record.envelopeVersion,
      deviceId: record.deviceId,
      credentialId: record.credentialId,
      kdf: record.kdf,
      kdfSalt: record.kdfSalt,
      derivationVersion: record.derivationVersion,
      encryptedEnvelopeSize: record.encryptedEnvelopeSize,
      encryptedEnvelope: record.encryptedEnvelope,
    });
  }

  async function requireOwnedPocket(transaction, account, syncedPocketId) {
    if (account.syncedPocketId !== syncedPocketId) {
      throw serviceError("service-authorisation-failed", 403);
    }
    const pocket = await readRecord(transaction, COLLECTIONS.pockets, syncedPocketId);
    if (pocket === null || pocket.accountId !== account.accountId) {
      throw serviceError("service-state-invalid", 500);
    }
    return pocket;
  }

  async function loadKeySetState(transaction, account, syncedPocketId) {
    const keySet = await readRecord(transaction, COLLECTIONS.keySets, syncedPocketId);
    if (keySet === null) return frozen({ keySet: null, envelopes: Object.freeze([]), locator: null });
    if (keySet.accountId !== account.accountId || keySet.syncedPocketId !== syncedPocketId) {
      throw serviceError("service-state-invalid", 500);
    }
    const envelopes = [];
    for (const envelopeId of keySet.envelopeIds) {
      const envelope = await readRecord(transaction, COLLECTIONS.envelopes, envelopeId);
      if (envelope === null || envelope.accountId !== account.accountId
          || envelope.syncedPocketId !== syncedPocketId) {
        throw serviceError("service-state-invalid", 500);
      }
      envelopes.push(envelope);
    }
    let locator = null;
    if (keySet.accountLocator !== null) {
      locator = await readRecord(transaction, COLLECTIONS.recoveryLocators, keySet.accountLocator);
      if (locator === null || locator.status !== "active"
          || locator.accountId !== account.accountId
          || locator.syncedPocketId !== syncedPocketId
          || locator.recoveryVersion !== keySet.recoveryVersion) {
        throw serviceError("service-state-invalid", 500);
      }
      const recoveryEnvelope = envelopes.find((item) => item.envelopeId === keySet.recoveryEnvelopeId);
      if (!recoveryEnvelope || recoveryEnvelope.status !== "active"
          || recoveryEnvelope.envelopeKind !== "recovery"
          || recoveryEnvelope.envelopeVersion !== keySet.recoveryVersion) {
        throw serviceError("service-state-invalid", 500);
      }
    }
    return frozen({ keySet, envelopes, locator });
  }

  function keyOperationWrapper(operation, replayed) {
    if (operation.result.status === "conflict") {
      const body = {
        apiVersion: 1, ok: false, status: "conflict", wrote: false, conflict: true,
        operationId: operation.operationId,
        actualKeySetVersion: operation.result.actualKeySetVersion,
      };
      if (operation.operationKind === "rotate-recovery") {
        body.actualRecoveryVersion = operation.result.actualRecoveryVersion;
      }
      return frozen({ status: 409, body, session: null });
    }
    return frozen({ status: 200, body: {
      apiVersion: 1, ok: true, status: "committed", wrote: true,
      operationId: operation.operationId, replayed,
      keySetVersion: operation.result.keySetVersion,
      ...operation.result.details,
    }, session: null });
  }

  async function existingKeyOperation(transaction, account, request, operationKind, digest) {
    const key = operationKey(account.accountId, request.syncedPocketId, request.operationId);
    const operation = await readRecord(transaction, COLLECTIONS.keyOperations, key);
    if (operation === null) return null;
    if (operation.requestDigest !== digest || operation.operationKind !== operationKind
        || operation.logicalChangeId !== request.logicalChangeId
        || operation.expectedKeySetVersion !== request.expectedKeySetVersion) {
      throw serviceError("service-operation-reuse", 409);
    }
    if (request.attemptKind !== "idempotent-retry") {
      throw serviceError("service-operation-reuse", 409);
    }
    return keyOperationWrapper(operation, true);
  }

  async function recordKeyOperation(transaction, account, request, operationKind, digest, result) {
    const record = frozen({
      kind: "pocket.sync.service-key-operation", schemaVersion: 1, storeVersion: 1,
      accountId: account.accountId, syncedPocketId: request.syncedPocketId,
      operationId: request.operationId, logicalChangeId: request.logicalChangeId,
      operationKind, expectedKeySetVersion: request.expectedKeySetVersion,
      requestDigest: digest, result,
    });
    await insertRecord(transaction, COLLECTIONS.keyOperations,
      operationKey(account.accountId, request.syncedPocketId, request.operationId), record);
    return record;
  }

  async function requireRecoveryRotationCredential(transaction, account, credential, request) {
    const ceremony = await readRecord(
      transaction,
      COLLECTIONS.recoveryCeremonies,
      request.recoveryOperationId
    );
    if (ceremony === null
        || ceremony.operationId !== request.recoveryOperationId
        || ceremony.finishDigest === null
        || ceremony.completedCredentialId === null
        || ceremony.completedSessionId === null
        || ceremony.completedKeySetVersion === null) {
      throw serviceError("service-state-invalid", 500);
    }
    if (ceremony.accountId !== account.accountId
        || ceremony.syncedPocketId !== request.syncedPocketId
        || ceremony.completedCredentialId !== credential.credentialId) {
      throw serviceError("service-authorisation-failed", 403);
    }
    return ceremony;
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

  async function authoriseObjectHead(context, syncedPocketId) {
    const at = clockMilliseconds();
    return transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      if (account.syncedPocketId !== syncedPocketId) throw serviceError("service-authorisation-failed", 403);
      return account;
    });
  }

  async function objectHeadCall(method, args) {
    try { return await objectHeadStore[method](...args); }
    catch (error) {
      if (error?.code === "object-head-store-state-invalid") throw serviceError("service-state-invalid", 500);
      if (error?.code === "object-head-store-storage-failed") throw serviceError("service-storage-failed", 503, { retryable: true });
      if (typeof error?.code === "string" && error.code.startsWith("object-head-store-")) {
        throw serviceError("service-request-invalid", 400);
      }
      throw serviceError("service-storage-failed", 503, { retryable: true });
    }
  }

  async function putOpaqueObject(value) {
    const { context, body } = invocation(value);
    const request = validateObjectHeadRequest(body, ["apiVersion", "operationId", "syncedPocketId", "storageRef", "record"]);
    await authoriseObjectHead(context, request.syncedPocketId);
    const result = await objectHeadCall("putObject", [request.syncedPocketId, request.storageRef, request.record]);
    return frozen({ status: 200, body: { apiVersion: 1, ok: true, operationId: request.operationId,
      syncedPocketId: request.syncedPocketId, storageRef: request.storageRef, created: result.created === true }, session: null });
  }

  async function getOpaqueObject(value) {
    const { context, body } = invocation(value);
    const request = validateObjectHeadRequest(body, ["apiVersion", "operationId", "syncedPocketId", "storageRef"]);
    await authoriseObjectHead(context, request.syncedPocketId);
    const record = await objectHeadCall("getObject", [request.syncedPocketId, request.storageRef]);
    return frozen({ status: 200, body: { apiVersion: 1, ok: true, operationId: request.operationId,
      syncedPocketId: request.syncedPocketId, storageRef: request.storageRef, present: record !== null, record }, session: null });
  }

  async function objectPresence(value) {
    const { context, body } = invocation(value);
    const request = validateObjectHeadRequest(body, ["apiVersion", "operationId", "syncedPocketId", "storageRefs"]);
    await authoriseObjectHead(context, request.syncedPocketId);
    const rows = await objectHeadCall("presence", [request.syncedPocketId, request.storageRefs]);
    return frozen({ status: 200, body: { apiVersion: 1, ok: true, operationId: request.operationId,
      syncedPocketId: request.syncedPocketId, rows }, session: null });
  }

  async function initialiseShadowHead(value) {
    const { context, body } = invocation(value);
    const request = validateObjectHeadRequest(body, ["apiVersion", "operationId", "syncedPocketId"]);
    const account = await authoriseObjectHead(context, request.syncedPocketId);
    return withPocketAuthorityLock(request.syncedPocketId, async () => {
      const authority = await transact("readonly", (transaction) =>
        readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId));
      if (!persistenceAuthorityIsSteady(authority)) {
        throw serviceError("service-persistence-authority-transition-active", 409);
      }
      const head = await objectHeadCall("initialiseHead", [request.syncedPocketId]);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId, head }, session: null });
    });
  }

  async function readShadowHead(value) {
    const { context, body } = invocation(value);
    const request = validateObjectHeadRequest(body, ["apiVersion", "operationId", "syncedPocketId"]);
    await authoriseObjectHead(context, request.syncedPocketId);
    const head = await objectHeadCall("readHead", [request.syncedPocketId]);
    return frozen({ status: 200, body: { apiVersion: 1, ok: true, operationId: request.operationId, syncedPocketId: request.syncedPocketId, head }, session: null });
  }

  async function compareAndSetShadowHead(value) {
    const { context, body } = invocation(value);
    const legacyFields = ["apiVersion", "operationId", "syncedPocketId", "expectedHead", "candidateSealStorageRef"];
    const authoritativeFields = [...legacyFields, "expectedAuthorityRevision"];
    const authoritative = isObject(body) && Object.prototype.hasOwnProperty.call(body, "expectedAuthorityRevision");
    const request = validateObjectHeadRequest(body, authoritative ? authoritativeFields : legacyFields);
    if (authoritative) positiveInteger(request.expectedAuthorityRevision);
    const account = await authoriseObjectHead(context, request.syncedPocketId);
    return withPocketAuthorityLock(request.syncedPocketId, async () => {
      const authority = await transact("readonly", (transaction) =>
        readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId));
      if (authority.currentMode === "whole-record") {
        if (!persistenceAuthorityIsSteady(authority)) {
          throw serviceError("service-persistence-authority-transition-active", 409);
        }
        if (authoritative) return authorityConflictWrapper(request, authority);
      } else if (persistenceAuthorityIsStarlingSteady(authority)) {
        if (!authoritative || request.expectedAuthorityRevision !== authority.authorityRevision) {
          return authorityConflictWrapper(request, authority);
        }
      } else {
        return authorityConflictWrapper(request, authority);
      }
      const result = await objectHeadCall("compareAndSetHead", [request.syncedPocketId,
        request.expectedHead, request.candidateSealStorageRef]);
      return frozen({ status: result.ok ? 200 : 409, body: { apiVersion: 1,
        ok: result.ok === true, operationId: request.operationId,
        syncedPocketId: request.syncedPocketId, ...result }, session: null });
    });
  }

  async function completedReplay(transaction, ceremony, digest, atMilliseconds) {
    if (ceremony.finishDigest !== digest) {
      throw serviceError("service-operation-reuse", 409);
    }
    const result = validateResultWrapper(
      ceremony.completedResult,
      ceremony.mode === "discoverable" ? "authentication-bootstrap" : ceremony.ceremonyType
    );
    const authorised = await authoriseSession(
      transaction,
      result.session.sessionId,
      atMilliseconds
    );
    if ((ceremony.mode !== "discoverable" && authorised.account.accountId !== ceremony.accountId)
        || authorised.account.accountId !== result.body.accountId
        || authorised.credential.credentialId !== result.body.credentialId
        || (ceremony.mode !== "discoverable" && authorised.session.accountId !== ceremony.accountId)
        || authorised.session.credentialId !== result.body.credentialId) {
      throw serviceError("service-state-invalid", 500);
    }
    return result;
  }

  function discoverableAuthenticationFailure(ceremony) {
    if (ceremony.mode === "discoverable") {
      return serviceError("service-authentication-failed", 400);
    }
    return null;
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

  function discoverableAuthenticationOptions(challenge) {
    return frozen({
      challenge,
      timeout: ceremonyLifetimeMs,
      rpId,
      userVerification: "required",
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
        mode: "account-bound",
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

      const discoverable = context.sessionId === null && request.accountLocator === undefined;
      let account = null;
      let credentials = null;
      if (context.sessionId !== null) {
        const authorised = await authoriseSession(transaction, context.sessionId, at);
        account = authorised.account;
        credentials = authorised.credentials;
        if (request.accountLocator !== undefined
            && request.accountLocator !== account.accountId) {
          throw serviceError("service-authorisation-failed", 403);
        }
      } else if (!discoverable) {
        account = await readRecord(transaction, COLLECTIONS.accounts, request.accountLocator);
        if (account === null) throw serviceError("service-account-unresolved", 404);
        credentials = await loadAccountCredentials(transaction, account);
      }
      if (!discoverable && credentials.length < 1) throw serviceError("service-account-unresolved", 404);
      const ceremonyId = randomToken();
      const challenge = randomToken();
      const expiresAt = expiry(at, ceremonyLifetimeMs);
      const beginBody = discoverable ? frozen({
        apiVersion: 1,
        ok: true,
        operationId: request.operationId,
        ceremonyId,
        expiresAt,
        bootstrap: true,
        publicKeyRequestOptions: discoverableAuthenticationOptions(challenge),
      }) : frozen({
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
      if (discoverable) validateDiscoverableAuthenticationOptions(
        beginBody.publicKeyRequestOptions, "service-state-invalid"
      );
      else validateAuthenticationOptions(beginBody.publicKeyRequestOptions,
        account.prfEvaluationInput, "service-state-invalid");
      const ceremony = frozen({
        kind: "pocket.sync.service-ceremony",
        schemaVersion: 1,
        storeVersion: 1,
        ceremonyType: "authentication",
        mode: discoverable ? "discoverable" : "account-bound",
        operationId: request.operationId,
        ceremonyId,
        requestDigest: digest,
        accountId: discoverable ? null : account.accountId,
        priorSessionId: context.sessionId,
        deviceId: null,
        challenge,
        prfEvaluationInput: discoverable ? null : account.prfEvaluationInput,
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

  async function callRecoveryProofVerifier(inputValue) {
    let promise;
    try {
      promise = recoveryProofVerifier.verifyRecoveryProof(frozen(inputValue));
      if (!thenable(promise)) throw serviceError("service-recovery-proof-failed", 400);
      const result = await promise;
      if (!sameKeys(result, ["verified"]) || result.verified !== true) {
        throw serviceError("service-recovery-proof-failed", 400);
      }
      return frozen(result);
    } catch (_error) {
      throw serviceError("service-recovery-proof-failed", 400);
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

  function finishBody(ceremony, credentialId, accountId = ceremony.accountId) {
    const body = {
      apiVersion: 1,
      ok: true,
      operationId: ceremony.operationId,
      ceremonyId: ceremony.ceremonyId,
      accountId,
      credentialId,
      credentialVersion: POLICY.credentialVersion,
      accountPolicyVersion: POLICY.accountPolicyVersion,
    };
    if (ceremony.mode === "discoverable") {
      body.bootstrap = true;
    } else {
      body.prfEvaluationInput = ceremony.prfEvaluationInput;
    }
    return frozen(body);
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
      } else if (ceremony.mode === "discoverable") {
        const credential = await readRecord(transaction, COLLECTIONS.credentials, request.credential.id);
        if (credential === null) throw discoverableAuthenticationFailure(ceremony);
        account = await readRecord(transaction, COLLECTIONS.accounts, credential.accountId);
        if (account === null || !account.credentialIds.includes(credential.credentialId)) {
          throw discoverableAuthenticationFailure(ceremony);
        }
      } else {
        account = await readRecord(transaction, COLLECTIONS.accounts, ceremony.accountId);
        if (account === null) throw serviceError("service-state-invalid", 500);
      }
      if ((ceremony.mode !== "discoverable" && account.accountId !== ceremony.accountId)
          || !account.credentialIds.includes(request.credential.id)) {
        throw discoverableAuthenticationFailure(ceremony)
          || serviceError("service-authorisation-failed", 403);
      }
      const credential = await readRecord(
        transaction,
        COLLECTIONS.credentials,
        request.credential.id
      );
      if (credential === null || credential.accountId !== account.accountId) {
        throw discoverableAuthenticationFailure(ceremony)
          || serviceError("service-authorisation-failed", 403);
      }
      return frozen({ ceremony, account, priorSession, credential, replay: null });
    });
    if (prepared.replay) return prepared.replay;

    let verified;
    try {
      const rawVerified = await callVerifier("verifyAuthentication", {
        trustedOrigin,
        rpId,
        challenge: prepared.ceremony.challenge,
        publicKeyRequestOptions: prepared.ceremony.beginBody.publicKeyRequestOptions,
        credential: request.credential,
        storedCredential: prepared.credential,
      });
      verified = validateAuthenticationVerifierResult(rawVerified);
    } catch (error) {
      if (prepared.ceremony.mode === "discoverable"
          && error?.code === "service-webauthn-failed") {
        throw serviceError("service-authentication-failed", 400);
      }
      throw error;
    }
    if (verified.credentialId !== request.credential.id
        || verified.credentialId !== prepared.credential.credentialId
        || (prepared.credential.signCount > 0
          && verified.signCount <= prepared.credential.signCount)) {
      throw discoverableAuthenticationFailure(prepared.ceremony)
        || serviceError("service-webauthn-failed", 400);
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
      } else if (ceremony.mode === "discoverable") {
        const selected = await readRecord(transaction, COLLECTIONS.credentials, request.credential.id);
        if (selected === null) throw discoverableAuthenticationFailure(ceremony);
        account = await readRecord(transaction, COLLECTIONS.accounts, selected.accountId);
        if (account === null || !account.credentialIds.includes(selected.credentialId)) {
          throw discoverableAuthenticationFailure(ceremony);
        }
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
          || (ceremony.mode !== "discoverable" && account.accountId !== ceremony.accountId)
          || credential.accountId !== account.accountId) {
        throw discoverableAuthenticationFailure(ceremony)
          || serviceError("service-transaction-conflict", 409, { retryable: true });
      }
      if (account.storeVersion !== prepared.account.storeVersion
          || credential.storeVersion !== prepared.credential.storeVersion
          || (prepared.priorSession !== null
            && (!priorSession
              || priorSession.storeVersion !== prepared.priorSession.storeVersion))) {
        throw serviceError("service-transaction-conflict", 409, { retryable: true });
      }
      if (credential.signCount > 0 && verified.signCount <= credential.signCount) {
        throw discoverableAuthenticationFailure(ceremony)
          || serviceError("service-webauthn-failed", 400);
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
      const bodyValue = finishBody(ceremony, currentCredential.credentialId, account.accountId);
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

  async function readSyncedPocket(value) {
    const { context, body } = invocation(value);
    const request = validateReadSyncedPocketRequest(body);
    const at = clockMilliseconds();
    return transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      return frozen({ status: 200, body: {
        apiVersion: 1, ok: true, operationId: request.operationId,
        status: account.syncedPocketId === null ? "not-configured" : "ready",
        syncedPocketId: account.syncedPocketId,
      }, session: null });
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
    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {
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
      const authority = account.syncedPocketId === null
        ? null
        : await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);
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
      if (pocket !== null) {
        if (!persistenceAuthorityIsSteady(authority)) {
          throw serviceError("service-persistence-authority-transition-active", 409);
        }
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
          await insertRecord(transaction, COLLECTIONS.persistenceAuthorities,
            request.syncedPocketId, initialPersistenceAuthority(account, request.syncedPocketId));
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

  async function readPersistenceAuthority(value) {
    const { context, body } = invocation(value);
    const request = validateReadPersistenceAuthorityRequest(body);
    const at = clockMilliseconds();
    return withPocketAuthorityLock(request.syncedPocketId, () => transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId,
        authority: persistenceAuthoritySnapshot(authority) }, session: null });
    }));
  }

  function authorityConflictWrapper(request, authority) {
    return frozen({ status: 409, body: { apiVersion: 1, ok: false,
      operationId: request.operationId, syncedPocketId: request.syncedPocketId,
      status: "conflict", reason: "authority-conflict",
      authority: persistenceAuthoritySnapshot(authority) }, session: null });
  }

  async function acquirePersistenceAuthorityFence(value) {
    const { context, body } = invocation(value);
    const request = validateAuthorityFenceRequest(body);
    const at = clockMilliseconds();
    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);
      if (authority.transition !== null
          && authority.transition.transitionId === request.transitionId
          && authority.transition.expectedAuthorityRevision === request.expectedAuthorityRevision) {
        return frozen({ status: 200, body: { apiVersion: 1, ok: true,
          operationId: request.operationId, syncedPocketId: request.syncedPocketId,
          status: "fenced", replayed: true, authority: persistenceAuthoritySnapshot(authority) },
          session: null });
      }
      if (!persistenceAuthorityIsSteady(authority)
          || authority.authorityRevision !== request.expectedAuthorityRevision) {
        return authorityConflictWrapper(request, authority);
      }
      const next = frozen({ ...authority, storeVersion: authority.storeVersion + 1,
        authorityRevision: authority.authorityRevision + 1,
        transition: { transitionId: request.transitionId,
          expectedAuthorityRevision: request.expectedAuthorityRevision } });
      await replaceRecord(transaction, COLLECTIONS.persistenceAuthorities,
        request.syncedPocketId, authority, next);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId,
        status: "fenced", replayed: false, authority: persistenceAuthoritySnapshot(next) },
        session: null });
    });
  }

  async function commitStarlingAuthorityAdoption(value) {
    const { context, body } = invocation(value);
    const request = validateAuthorityAdoptionRequest(body);
    const at = clockMilliseconds();
    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);
      if (authority.authorityRevision !== request.expectedAuthorityRevision
          || authority.currentMode !== "whole-record"
          || authority.transition === null
          || authority.transition.transitionId !== request.transitionId
          || authority.transition.expectedAuthorityRevision + 1 !== authority.authorityRevision
          || authority.rollbackRevision !== null || authority.adoptionHead !== null) {
        return authorityConflictWrapper(request, authority);
      }
      const pocket = await readRecord(transaction, COLLECTIONS.pockets, request.syncedPocketId);
      if (!pocket || pocket.accountId !== account.accountId
          || pocket.revision !== request.rollbackRevision) {
        return authorityConflictWrapper(request, authority);
      }
      const actualHead = await objectHeadCall("readHead", [request.syncedPocketId]);
      if (!sameStarlingHead(actualHead, request.adoptionHead)) {
        return authorityConflictWrapper(request, authority);
      }
      if (authority.authorityRevision >= Number.MAX_SAFE_INTEGER) {
        return authorityConflictWrapper(request, authority);
      }
      const next = frozen({
        ...authority,
        storeVersion: authority.storeVersion + 1,
        authorityRevision: authority.authorityRevision + 1,
        currentMode: "starling",
        transition: null,
        rollbackRevision: request.rollbackRevision,
        adoptionHead: request.adoptionHead,
      });
      await replaceRecord(transaction, COLLECTIONS.persistenceAuthorities,
        request.syncedPocketId, authority, next);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId,
        status: "adopted", authority: persistenceAuthoritySnapshot(next) }, session: null });
    });
  }

  async function releasePersistenceAuthorityFence(value) {
    const { context, body } = invocation(value);
    const request = validateAuthorityFenceRequest(body);
    const at = clockMilliseconds();
    return transactAuthorityMutation(request.syncedPocketId, async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const authority = await readPersistenceAuthorityRecord(transaction, account, request.syncedPocketId);
      if (authority.authorityRevision !== request.expectedAuthorityRevision
          || authority.transition === null
          || authority.transition.transitionId !== request.transitionId) {
        return authorityConflictWrapper(request, authority);
      }
      const next = frozen({ ...authority, storeVersion: authority.storeVersion + 1,
        authorityRevision: authority.authorityRevision + 1, transition: null });
      await replaceRecord(transaction, COLLECTIONS.persistenceAuthorities,
        request.syncedPocketId, authority, next);
      return frozen({ status: 200, body: { apiVersion: 1, ok: true,
        operationId: request.operationId, syncedPocketId: request.syncedPocketId,
        status: "released", authority: persistenceAuthoritySnapshot(next) }, session: null });
    });
  }

  async function listEnvelopes(value) {
    const { context, body } = invocation(value);
    const request = validateListEnvelopesRequest(body);
    const at = clockMilliseconds();
    return transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const state = await loadKeySetState(transaction, account, request.syncedPocketId);
      return frozen({ status: 200, body: {
        apiVersion: 1, ok: true, operationId: request.operationId,
        syncedPocketId: request.syncedPocketId,
        keySetVersion: state.keySet ? state.keySet.keySetVersion : 0,
        recoveryStatus: state.keySet ? state.keySet.recoveryStatus : "unconfigured",
        recoveryVersion: state.keySet ? state.keySet.recoveryVersion : 0,
        envelopes: state.envelopes.slice().sort((a, b) => (a.envelopeId < b.envelopeId ? -1
          : (a.envelopeId > b.envelopeId ? 1 : 0)))
          .map(envelopeMetadata),
      }, session: null });
    });
  }

  async function downloadEnvelope(value) {
    const { context, body } = invocation(value);
    const request = validateDownloadEnvelopeRequest(body);
    const at = clockMilliseconds();
    return transact("readonly", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const state = await loadKeySetState(transaction, account, request.syncedPocketId);
      const envelope = state.envelopes.find((item) => item.envelopeId === request.envelopeId);
      if (!envelope) {
        const unlisted = await readRecord(transaction, COLLECTIONS.envelopes, request.envelopeId);
        if (unlisted && unlisted.accountId === account.accountId
            && unlisted.syncedPocketId === request.syncedPocketId) {
          throw serviceError("service-state-invalid", 500);
        }
        throw serviceError("service-envelope-not-found", 404);
      }
      if (envelope.status !== "active") throw serviceError("service-envelope-revoked", 410);
      return frozen({ status: 200, body: {
        apiVersion: 1, ok: true, operationId: request.operationId,
        syncedPocketId: request.syncedPocketId,
        keySetVersion: state.keySet.keySetVersion, envelope: envelopeDownload(envelope),
      }, session: null });
    });
  }

  async function addEnvelope(value) {
    const { context, body } = invocation(value);
    const request = validateAddEnvelopeRequest(body);
    const at = clockMilliseconds();
    return transact("readwrite", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const digest = keyMutationDigest(account.accountId, "add-envelope", request);
      const replay = await existingKeyOperation(transaction, account, request, "add-envelope", digest);
      if (replay) return replay;
      const state = await loadKeySetState(transaction, account, request.syncedPocketId);
      const actual = state.keySet ? state.keySet.keySetVersion : 0;
      if (actual !== request.expectedKeySetVersion) {
        const result = frozen({ status: "conflict", actualKeySetVersion: actual,
          actualRecoveryVersion: state.keySet ? state.keySet.recoveryVersion : 0 });
        const operation = await recordKeyOperation(transaction, account, request,
          "add-envelope", digest, result);
        return keyOperationWrapper(operation, false);
      }
      if (await readRecord(transaction, COLLECTIONS.envelopes, request.envelope.envelopeId)) {
        throw serviceError("service-envelope-invalid", 400);
      }
      if (request.envelope.envelopeKind === "passkey-prf") {
        const credential = await readRecord(transaction, COLLECTIONS.credentials,
          request.envelope.credentialId);
        if (!credential || credential.accountId !== account.accountId || credential.status !== "active") {
          throw serviceError("service-authorisation-failed", 403);
        }
      }
      const allocatingDeviceGrant = request.envelope.envelopeKind === "device";
      const currentReserved = state.keySet
        ? state.keySet.masterKeyContentEncryptionsReserved : 0;
      if (allocatingDeviceGrant
          && currentReserved + POLICY.deviceContentEncryptionAllowance
            > POLICY.maximumContentEncryptionsPerMasterKey) {
        return frozen({ status: 409, body: {
          apiVersion: 1, ok: false, status: "master-key-rotation-required", wrote: false,
          operationId: request.operationId,
        }, session: null });
      }
      const record = envelopeRecord(account.accountId, request.syncedPocketId, request.envelope, at);
      await insertRecord(transaction, COLLECTIONS.envelopes, record.envelopeId, record);
      const nextVersion = request.expectedKeySetVersion + 1;
      const keySet = state.keySet ? frozen({ ...state.keySet,
        storeVersion: state.keySet.storeVersion + 1, keySetVersion: nextVersion,
        envelopeIds: [...state.keySet.envelopeIds, record.envelopeId],
        masterKeyContentEncryptionsReserved: allocatingDeviceGrant
          ? currentReserved + POLICY.deviceContentEncryptionAllowance : currentReserved,
        updatedAt: timestamp(at),
      }) : frozen({
        kind: "pocket.sync.service-key-set", schemaVersion: 1, storeVersion: 1,
        accountId: account.accountId, syncedPocketId: request.syncedPocketId,
        keySetVersion: nextVersion, envelopeIds: [record.envelopeId],
        recoveryStatus: "unconfigured", recoveryVersion: 0, recoveryEnvelopeId: null,
        recoveryVerifier: null, accountLocator: null, recoveryOperationId: null,
        recoveryCredentialId: null, masterKeyGeneration: 1,
        masterKeyContentEncryptionsReserved: allocatingDeviceGrant
          ? POLICY.deviceContentEncryptionAllowance : 0,
        createdAt: timestamp(at), updatedAt: timestamp(at),
      });
      if (state.keySet) await replaceRecord(transaction, COLLECTIONS.keySets,
        request.syncedPocketId, state.keySet, keySet);
      else await insertRecord(transaction, COLLECTIONS.keySets, request.syncedPocketId, keySet);
      const result = frozen({ status: "committed", keySetVersion: nextVersion, details:
        allocatingDeviceGrant ? { masterKeyGeneration: keySet.masterKeyGeneration,
          masterKeyContentEncryptionLimit: POLICY.deviceContentEncryptionAllowance } : {} });
      const operation = await recordKeyOperation(transaction, account, request,
        "add-envelope", digest, result);
      return keyOperationWrapper(operation, false);
    });
  }

  async function revokeEnvelope(value) {
    const { context, body } = invocation(value);
    const request = validateRevokeEnvelopeRequest(body);
    const at = clockMilliseconds();
    return transact("readwrite", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const digest = keyMutationDigest(account.accountId, "revoke-envelope", request);
      const replay = await existingKeyOperation(transaction, account, request, "revoke-envelope", digest);
      if (replay) return replay;
      const state = await loadKeySetState(transaction, account, request.syncedPocketId);
      const actual = state.keySet ? state.keySet.keySetVersion : 0;
      if (actual !== request.expectedKeySetVersion) {
        const result = frozen({ status: "conflict", actualKeySetVersion: actual,
          actualRecoveryVersion: state.keySet ? state.keySet.recoveryVersion : 0 });
        const operation = await recordKeyOperation(transaction, account, request,
          "revoke-envelope", digest, result);
        return keyOperationWrapper(operation, false);
      }
      const envelope = state.envelopes.find((item) => item.envelopeId === request.envelopeId);
      if (!envelope) {
        const unlisted = await readRecord(transaction, COLLECTIONS.envelopes, request.envelopeId);
        if (unlisted && unlisted.accountId === account.accountId
            && unlisted.syncedPocketId === request.syncedPocketId) {
          throw serviceError("service-state-invalid", 500);
        }
        throw serviceError("service-envelope-not-found", 404);
      }
      if (envelope.status !== "active") throw serviceError("service-envelope-revoked", 410);
      if (envelope.envelopeKind === "recovery") throw serviceError("service-envelope-invalid", 400);
      const revoked = frozen({ ...envelope, storeVersion: envelope.storeVersion + 1,
        status: "revoked", encryptedEnvelopeSize: 0, encryptedEnvelope: null,
        revokedAt: timestamp(at) });
      await replaceRecord(transaction, COLLECTIONS.envelopes, envelope.envelopeId, envelope, revoked);
      const nextVersion = request.expectedKeySetVersion + 1;
      const keySet = frozen({ ...state.keySet, storeVersion: state.keySet.storeVersion + 1,
        keySetVersion: nextVersion, updatedAt: timestamp(at) });
      await replaceRecord(transaction, COLLECTIONS.keySets, request.syncedPocketId,
        state.keySet, keySet);
      const result = frozen({ status: "committed", keySetVersion: nextVersion, details: {} });
      const operation = await recordKeyOperation(transaction, account, request,
        "revoke-envelope", digest, result);
      return keyOperationWrapper(operation, false);
    });
  }

  async function initialiseRecovery(value) {
    const { context, body } = invocation(value);
    const request = validateInitialiseRecoveryRequest(body);
    const at = clockMilliseconds();
    return transact("readwrite", async (transaction) => {
      const { account } = await authoriseSession(transaction, context.sessionId, at);
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      const digest = keyMutationDigest(account.accountId, "initialise-recovery", request);
      const replay = await existingKeyOperation(transaction, account, request,
        "initialise-recovery", digest);
      if (replay) return replay;
      const state = await loadKeySetState(transaction, account, request.syncedPocketId);
      const actual = state.keySet ? state.keySet.keySetVersion : 0;
      if (actual !== request.expectedKeySetVersion) {
        const result = frozen({ status: "conflict", actualKeySetVersion: actual,
          actualRecoveryVersion: state.keySet ? state.keySet.recoveryVersion : 0 });
        const operation = await recordKeyOperation(transaction, account, request,
          "initialise-recovery", digest, result);
        return keyOperationWrapper(operation, false);
      }
      if (state.keySet && state.keySet.recoveryStatus !== "unconfigured") {
        throw serviceError("service-recovery-already-configured", 409);
      }
      if (await readRecord(transaction, COLLECTIONS.envelopes,
        request.recoveryEnvelope.envelopeId)) throw serviceError("service-envelope-invalid", 400);
      const accountLocator = randomToken();
      await ensureGeneratedKeyAvailable(transaction, COLLECTIONS.recoveryLocators, accountLocator);
      const envelope = envelopeRecord(account.accountId, request.syncedPocketId,
        request.recoveryEnvelope, at);
      const locator = frozen({ kind: "pocket.sync.service-recovery-locator", schemaVersion: 1,
        storeVersion: 1, accountLocator, accountId: account.accountId,
        syncedPocketId: request.syncedPocketId, recoveryVersion: 1, status: "active",
        createdAt: timestamp(at), revokedAt: null });
      await insertRecord(transaction, COLLECTIONS.envelopes, envelope.envelopeId, envelope);
      await insertRecord(transaction, COLLECTIONS.recoveryLocators, accountLocator, locator);
      const nextVersion = request.expectedKeySetVersion + 1;
      const keySet = state.keySet ? frozen({ ...state.keySet,
        storeVersion: state.keySet.storeVersion + 1, keySetVersion: nextVersion,
        envelopeIds: [...state.keySet.envelopeIds, envelope.envelopeId],
        recoveryStatus: "ready", recoveryVersion: 1, recoveryEnvelopeId: envelope.envelopeId,
        recoveryVerifier: request.recoveryVerifier, accountLocator,
        recoveryOperationId: null, recoveryCredentialId: null, updatedAt: timestamp(at),
      }) : frozen({ kind: "pocket.sync.service-key-set", schemaVersion: 1, storeVersion: 1,
        accountId: account.accountId, syncedPocketId: request.syncedPocketId,
        keySetVersion: nextVersion, envelopeIds: [envelope.envelopeId],
        recoveryStatus: "ready", recoveryVersion: 1, recoveryEnvelopeId: envelope.envelopeId,
        recoveryVerifier: request.recoveryVerifier, accountLocator,
        recoveryOperationId: null, recoveryCredentialId: null,
        masterKeyGeneration: 1, masterKeyContentEncryptionsReserved: 0,
        createdAt: timestamp(at), updatedAt: timestamp(at) });
      if (state.keySet) await replaceRecord(transaction, COLLECTIONS.keySets,
        request.syncedPocketId, state.keySet, keySet);
      else await insertRecord(transaction, COLLECTIONS.keySets, request.syncedPocketId, keySet);
      const details = frozen({ recoveryVersion: 1, accountLocator, recoveryCopyRequired: true });
      const result = frozen({ status: "committed", keySetVersion: nextVersion, details });
      const operation = await recordKeyOperation(transaction, account, request,
        "initialise-recovery", digest, result);
      return keyOperationWrapper(operation, false);
    });
  }

  function recoveryBeginBody(ceremony) {
    return frozen({
      apiVersion: 1, ok: true, operationId: ceremony.operationId,
      recoveryCeremonyId: ceremony.recoveryCeremonyId, expiresAt: ceremony.expiresAt,
      recoveryVersion: ceremony.recoveryVersion, challenge: ceremony.challenge,
      keySetVersion: ceremony.keySetVersion,
      prfEvaluationInput: ceremony.prfEvaluationInput,
      publicKeyCreationOptions: ceremony.publicKeyCreationOptions,
    });
  }

  async function beginRecovery(value) {
    const { context, body } = invocation(value);
    if (context.sessionId !== null) throw serviceError("service-request-context-invalid", 400);
    const request = validateBeginRecoveryRequest(body);
    const at = clockMilliseconds();
    const digest = recoveryBeginDigest(request);
    return transact("readwrite", async (transaction) => {
      const existing = await readRecord(transaction, COLLECTIONS.recoveryCeremonies,
        request.operationId);
      if (existing) {
        if (existing.requestDigest !== digest) throw serviceError("service-operation-reuse", 409);
        if (existing.finishDigest !== null) throw serviceError("service-ceremony-complete", 409);
        if (Date.parse(existing.expiresAt) <= at) throw serviceError("service-ceremony-expired", 410);
        const account = await readRecord(transaction, COLLECTIONS.accounts, existing.accountId);
        if (!account) throw serviceError("service-state-invalid", 500);
        const state = await loadKeySetState(transaction, account, existing.syncedPocketId);
        if (!state.keySet || state.keySet.recoveryStatus !== "ready"
            || state.keySet.recoveryVersion !== existing.recoveryVersion
            || state.keySet.keySetVersion !== existing.keySetVersion) {
          throw serviceError("service-recovery-unavailable", 404);
        }
        return frozen({ status: 200,
          body: recoveryBeginBody(existing), session: null });
      }
      const locator = await readRecord(transaction, COLLECTIONS.recoveryLocators,
        request.accountLocator);
      if (!locator || locator.status !== "active") {
        throw serviceError("service-recovery-unavailable", 404);
      }
      const account = await readRecord(transaction, COLLECTIONS.accounts, locator.accountId);
      if (!account || account.syncedPocketId !== locator.syncedPocketId) {
        throw serviceError("service-recovery-unavailable", 404);
      }
      await requireOwnedPocket(transaction, account, locator.syncedPocketId);
      const credentials = await loadAccountCredentials(transaction, account);
      const state = await loadKeySetState(transaction, account, locator.syncedPocketId);
      if (!state.keySet || state.keySet.recoveryStatus !== "ready"
          || state.keySet.accountLocator !== request.accountLocator
          || state.keySet.recoveryVersion !== locator.recoveryVersion) {
        throw serviceError("service-recovery-unavailable", 404);
      }
      const recoveryCeremonyId = randomToken();
      const challenge = randomToken();
      const userId = randomToken();
      const expiresAt = expiry(at, ceremonyLifetimeMs);
      const publicKeyCreationOptions = registrationOptions(account.accountId, userId,
        account.prfEvaluationInput, challenge, credentials);
      const ceremony = frozen({
        kind: "pocket.sync.service-recovery-ceremony", schemaVersion: 1, storeVersion: 1,
        operationId: request.operationId, recoveryCeremonyId, requestDigest: digest,
        accountId: account.accountId, syncedPocketId: locator.syncedPocketId,
        deviceId: request.deviceId, challenge, recoveryVersion: state.keySet.recoveryVersion,
        keySetVersion: state.keySet.keySetVersion,
        prfEvaluationInput: account.prfEvaluationInput, publicKeyCreationOptions,
        expiresAt, finishDigest: null, completedCredentialId: null,
        completedSessionId: null, completedKeySetVersion: null,
      });
      await insertRecord(transaction, COLLECTIONS.recoveryCeremonies,
        request.operationId, ceremony);
      return frozen({ status: 200,
        body: recoveryBeginBody(ceremony), session: null });
    });
  }

  function recoveryFinishBody(ceremony, credentialId, keySet, envelope) {
    return frozen({
      apiVersion: 1, ok: true, operationId: ceremony.operationId,
      recoveryCeremonyId: ceremony.recoveryCeremonyId,
      accountId: ceremony.accountId, credentialId,
      credentialVersion: POLICY.credentialVersion,
      accountPolicyVersion: POLICY.accountPolicyVersion,
      prfEvaluationInput: ceremony.prfEvaluationInput,
      syncedPocketId: ceremony.syncedPocketId,
      keySetVersion: keySet.keySetVersion, recoveryVersion: keySet.recoveryVersion,
      recoveryEnvelope: envelopeDownload(envelope), replacementCopyRequired: true,
    });
  }

  async function recoveryFinishReplay(transaction, ceremony, digest, at) {
    if (ceremony.finishDigest !== digest) throw serviceError("service-operation-reuse", 409);
    const account = await readRecord(transaction, COLLECTIONS.accounts, ceremony.accountId);
    if (!account) throw serviceError("service-state-invalid", 500);
    const state = await loadKeySetState(transaction, account, ceremony.syncedPocketId);
    if (!state.keySet || state.keySet.recoveryStatus !== "rotation-required"
        || state.keySet.recoveryOperationId !== ceremony.operationId
        || state.keySet.recoveryCredentialId !== ceremony.completedCredentialId
        || state.keySet.keySetVersion !== ceremony.completedKeySetVersion) {
      throw serviceError("service-ceremony-complete", 409);
    }
    const authorised = await authoriseSession(transaction, ceremony.completedSessionId, at);
    if (authorised.account.accountId !== account.accountId
        || authorised.credential.credentialId !== ceremony.completedCredentialId) {
      throw serviceError("service-state-invalid", 500);
    }
    const envelope = state.envelopes.find((item) => item.envelopeId === state.keySet.recoveryEnvelopeId);
    return frozen({ status: 200,
      body: recoveryFinishBody(ceremony, ceremony.completedCredentialId, state.keySet, envelope),
      session: { action: "set", sessionId: authorised.session.sessionId,
        expiresAt: authorised.session.expiresAt, replaceSessionId: null } });
  }

  async function finishRecovery(value) {
    const { context, body } = invocation(value);
    if (context.sessionId !== null) throw serviceError("service-request-context-invalid", 400);
    const request = validateFinishRecoveryRequest(body);
    const at = clockMilliseconds();
    const digest = recoveryFinishDigest(request);
    const prepared = await transact("readonly", async (transaction) => {
      const ceremony = await readRecord(transaction, COLLECTIONS.recoveryCeremonies,
        request.operationId);
      if (!ceremony || ceremony.recoveryCeremonyId !== request.recoveryCeremonyId
          || ceremony.deviceId !== request.deviceId) throw serviceError("service-ceremony-invalid", 400);
      if (ceremony.finishDigest !== null) {
        return frozen({ replay: await recoveryFinishReplay(transaction, ceremony, digest, at) });
      }
      if (Date.parse(ceremony.expiresAt) <= at) throw serviceError("service-ceremony-expired", 410);
      const account = await readRecord(transaction, COLLECTIONS.accounts, ceremony.accountId);
      if (!account) throw serviceError("service-state-invalid", 500);
      const state = await loadKeySetState(transaction, account, ceremony.syncedPocketId);
      if (!state.keySet || state.keySet.recoveryStatus !== "ready"
          || state.keySet.recoveryVersion !== ceremony.recoveryVersion
          || state.keySet.keySetVersion !== ceremony.keySetVersion) {
        throw serviceError("service-recovery-unavailable", 404);
      }
      return frozen({ ceremony, account, keySet: state.keySet, replay: null });
    });
    if (prepared.replay) return prepared.replay;
    await callRecoveryProofVerifier({ syncedPocketId: prepared.ceremony.syncedPocketId,
      deviceId: request.deviceId, operationId: request.operationId,
      recoveryCeremonyId: request.recoveryCeremonyId,
      challenge: prepared.ceremony.challenge, recoveryVersion: prepared.ceremony.recoveryVersion,
      keySetVersion: prepared.ceremony.keySetVersion, expiresAt: prepared.ceremony.expiresAt,
      credentialDigest: recoveryCredentialDigest(request.credential),
      storedVerifier: prepared.keySet.recoveryVerifier, proof: request.proof });
    const rawVerified = await callVerifier("verifyRegistration", { trustedOrigin, rpId,
      challenge: prepared.ceremony.challenge,
      publicKeyCreationOptions: prepared.ceremony.publicKeyCreationOptions,
      credential: request.credential });
    const verified = validateRegistrationVerifierResult(rawVerified, credentialAlgorithms);
    if (verified.credentialId !== request.credential.id) {
      throw serviceError("service-webauthn-failed", 400);
    }
    const commitAt = clockMilliseconds();
    return transact("readwrite", async (transaction) => {
      const ceremony = await readRecord(transaction, COLLECTIONS.recoveryCeremonies,
        request.operationId);
      if (!ceremony) throw serviceError("service-ceremony-invalid", 400);
      if (ceremony.finishDigest !== null) {
        return recoveryFinishReplay(transaction, ceremony, digest, commitAt);
      }
      if (ceremony.storeVersion !== prepared.ceremony.storeVersion
          || ceremony.recoveryCeremonyId !== request.recoveryCeremonyId
          || ceremony.deviceId !== request.deviceId
          || Date.parse(ceremony.expiresAt) <= commitAt) {
        throw serviceError("service-transaction-conflict", 409, { retryable: true });
      }
      const account = await readRecord(transaction, COLLECTIONS.accounts, ceremony.accountId);
      if (!account || account.storeVersion !== prepared.account.storeVersion) {
        throw serviceError("service-transaction-conflict", 409, { retryable: true });
      }
      const state = await loadKeySetState(transaction, account, ceremony.syncedPocketId);
      if (!state.keySet || state.keySet.storeVersion !== prepared.keySet.storeVersion
          || state.keySet.recoveryStatus !== "ready") {
        throw serviceError("service-transaction-conflict", 409, { retryable: true });
      }
      if (await readRecord(transaction, COLLECTIONS.credentials, verified.credentialId)) {
        throw serviceError("service-webauthn-failed", 400);
      }
      const createdAt = timestamp(commitAt);
      const credential = frozen({ kind: "pocket.sync.service-credential", schemaVersion: 1,
        storeVersion: 1, credentialId: verified.credentialId, accountId: account.accountId,
        credentialVersion: 1, status: "active", publicKey: verified.publicKey,
        publicKeyAlgorithm: verified.publicKeyAlgorithm, signCount: verified.signCount,
        transports: verified.transports, backupEligible: verified.backupEligible,
        backedUp: verified.backedUp, createdAt });
      await insertRecord(transaction, COLLECTIONS.credentials, credential.credentialId, credential);
      const updatedAccount = frozen({ ...account, storeVersion: account.storeVersion + 1,
        credentialIds: [...account.credentialIds, credential.credentialId] });
      await replaceRecord(transaction, COLLECTIONS.accounts, account.accountId,
        account, updatedAccount);
      const session = await createSession(transaction, account.accountId,
        credential.credentialId, null, commitAt);
      const updatedKeySet = frozen({ ...state.keySet,
        storeVersion: state.keySet.storeVersion + 1,
        keySetVersion: state.keySet.keySetVersion + 1,
        recoveryStatus: "rotation-required", recoveryOperationId: ceremony.operationId,
        recoveryCredentialId: credential.credentialId, updatedAt: timestamp(commitAt) });
      await replaceRecord(transaction, COLLECTIONS.keySets, ceremony.syncedPocketId,
        state.keySet, updatedKeySet);
      const completed = frozen({ ...ceremony, storeVersion: ceremony.storeVersion + 1,
        finishDigest: digest, completedCredentialId: credential.credentialId,
        completedSessionId: session.record.sessionId,
        completedKeySetVersion: updatedKeySet.keySetVersion });
      await replaceRecord(transaction, COLLECTIONS.recoveryCeremonies,
        ceremony.operationId, ceremony, completed);
      const envelope = state.envelopes.find((item) => item.envelopeId === state.keySet.recoveryEnvelopeId);
      return frozen({ status: 200,
        body: recoveryFinishBody(completed, credential.credentialId, updatedKeySet, envelope),
        session: session.instruction });
    });
  }

  async function rotateRecovery(value) {
    const { context, body } = invocation(value);
    const request = validateRotateRecoveryRequest(body);
    if (request.recoveryVerifier.version !== 1
        || request.recoveryEnvelope.envelopeVersion !== request.expectedRecoveryVersion + 1) {
      throw serviceError("service-request-invalid");
    }
    const at = clockMilliseconds();
    return transact("readwrite", async (transaction) => {
      const authorised = await authoriseSession(transaction, context.sessionId, at);
      const { account, credential } = authorised;
      await requireOwnedPocket(transaction, account, request.syncedPocketId);
      await requireRecoveryRotationCredential(transaction, account, credential, request);
      const digest = keyMutationDigest(account.accountId, "rotate-recovery", request);
      const replay = await existingKeyOperation(transaction, account, request,
        "rotate-recovery", digest);
      if (replay) return replay;
      const state = await loadKeySetState(transaction, account, request.syncedPocketId);
      const actualKeySetVersion = state.keySet ? state.keySet.keySetVersion : 0;
      const actualRecoveryVersion = state.keySet ? state.keySet.recoveryVersion : 0;
      if (actualKeySetVersion !== request.expectedKeySetVersion
          || actualRecoveryVersion !== request.expectedRecoveryVersion) {
        const result = frozen({ status: "conflict", actualKeySetVersion,
          actualRecoveryVersion });
        const operation = await recordKeyOperation(transaction, account, request,
          "rotate-recovery", digest, result);
        return keyOperationWrapper(operation, false);
      }
      if (!state.keySet || state.keySet.recoveryStatus !== "rotation-required") {
        throw serviceError("service-recovery-rotation-required", 409);
      }
      if (state.keySet.recoveryOperationId !== request.recoveryOperationId
          || state.keySet.recoveryCredentialId !== credential.credentialId) {
        throw serviceError("service-authorisation-failed", 403);
      }
      if (await readRecord(transaction, COLLECTIONS.envelopes,
        request.recoveryEnvelope.envelopeId)) throw serviceError("service-envelope-invalid", 400);
      const newLocatorId = randomToken();
      await ensureGeneratedKeyAvailable(transaction, COLLECTIONS.recoveryLocators, newLocatorId);
      const oldEnvelope = state.envelopes.find((item) =>
        item.envelopeId === state.keySet.recoveryEnvelopeId);
      const oldLocator = state.locator;
      const newEnvelope = envelopeRecord(account.accountId, request.syncedPocketId,
        request.recoveryEnvelope, at);
      const newLocator = frozen({ kind: "pocket.sync.service-recovery-locator",
        schemaVersion: 1, storeVersion: 1, accountLocator: newLocatorId,
        accountId: account.accountId, syncedPocketId: request.syncedPocketId,
        recoveryVersion: request.recoveryEnvelope.envelopeVersion, status: "active",
        createdAt: timestamp(at), revokedAt: null });
      await insertRecord(transaction, COLLECTIONS.envelopes,
        newEnvelope.envelopeId, newEnvelope);
      await insertRecord(transaction, COLLECTIONS.recoveryLocators, newLocatorId, newLocator);
      const revokedEnvelope = frozen({ ...oldEnvelope,
        storeVersion: oldEnvelope.storeVersion + 1, status: "revoked",
        encryptedEnvelopeSize: 0, encryptedEnvelope: null, revokedAt: timestamp(at) });
      const revokedLocator = frozen({ ...oldLocator,
        storeVersion: oldLocator.storeVersion + 1, status: "revoked", revokedAt: timestamp(at) });
      await replaceRecord(transaction, COLLECTIONS.envelopes, oldEnvelope.envelopeId,
        oldEnvelope, revokedEnvelope);
      await replaceRecord(transaction, COLLECTIONS.recoveryLocators, oldLocator.accountLocator,
        oldLocator, revokedLocator);
      const nextVersion = request.expectedKeySetVersion + 1;
      const keySet = frozen({ ...state.keySet, storeVersion: state.keySet.storeVersion + 1,
        keySetVersion: nextVersion,
        envelopeIds: [...state.keySet.envelopeIds, newEnvelope.envelopeId],
        recoveryStatus: "ready", recoveryVersion: request.recoveryEnvelope.envelopeVersion,
        recoveryEnvelopeId: newEnvelope.envelopeId,
        recoveryVerifier: request.recoveryVerifier, accountLocator: newLocatorId,
        recoveryOperationId: null, recoveryCredentialId: null, updatedAt: timestamp(at) });
      await replaceRecord(transaction, COLLECTIONS.keySets, request.syncedPocketId,
        state.keySet, keySet);
      const details = frozen({ recoveryVersion: request.recoveryEnvelope.envelopeVersion,
        accountLocator: newLocatorId, previousRecoveryInvalidated: true,
        replacementCopyRequired: true });
      const result = frozen({ status: "committed", keySetVersion: nextVersion, details });
      const operation = await recordKeyOperation(transaction, account, request,
        "rotate-recovery", digest, result);
      return keyOperationWrapper(operation, false);
    });
  }

  return Object.freeze({
    beginRegistration,
    finishRegistration,
    beginAuthentication,
    finishAuthentication,
    readSyncedPocket,
    readRevision,
    downloadEncryptedRecord,
    conditionalUpload,
    readPersistenceAuthority,
    acquirePersistenceAuthorityFence,
    commitStarlingAuthorityAdoption,
    releasePersistenceAuthorityFence,
    listEnvelopes,
    downloadEnvelope,
    addEnvelope,
    revokeEnvelope,
    initialiseRecovery,
    beginRecovery,
    finishRecovery,
    rotateRecovery,
    putOpaqueObject,
    getOpaqueObject,
    objectPresence,
    initialiseShadowHead,
    readShadowHead,
    compareAndSetShadowHead,
  });
}

module.exports = Object.freeze({
  POLICY,
  COLLECTIONS,
  createServiceCore,
});
