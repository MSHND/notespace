"use strict";

const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const EXPIRES = "2030-01-01T00:05:00.000Z";

function bytes(length, start = 1) {
  return Uint8Array.from({ length }, (_unused, index) => (start + index) & 255);
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

const PRF_INPUT = b64(bytes(32, 9));
const PRF_OUTPUT = bytes(32, 101);
const PRF_OUTPUT_TEXT = b64(PRF_OUTPUT);
const CHALLENGE = b64(bytes(32, 41));
const USER_ID = b64(bytes(16, 71));
const CREDENTIAL_ID = b64(bytes(32, 121));

function registrationOptions(overrides = {}) {
  return Object.assign({
    rp: { id: "pocket.example", name: "Pocket" },
    user: { id: USER_ID, name: "account-opaque", displayName: "Pocket account" },
    challenge: CHALLENGE,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 120000,
    excludeCredentials: [],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
    extensions: { prf: { eval: { first: PRF_INPUT } } },
  }, overrides);
}

function authenticationOptions(overrides = {}) {
  return Object.assign({
    challenge: CHALLENGE,
    timeout: 120000,
    rpId: "pocket.example",
    allowCredentials: [{ type: "public-key", id: CREDENTIAL_ID, transports: ["internal"] }],
    userVerification: "required",
    extensions: { prf: { eval: { first: PRF_INPUT } } },
  }, overrides);
}

function beginRegistration(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "register-operation",
    ceremonyId: "register-ceremony",
    expiresAt: EXPIRES,
    prfEvaluationInput: PRF_INPUT,
    publicKeyCreationOptions: registrationOptions(),
  }, overrides);
}

function beginAuthentication(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "authentication-operation",
    ceremonyId: "authentication-ceremony",
    expiresAt: EXPIRES,
    prfEvaluationInput: PRF_INPUT,
    publicKeyRequestOptions: authenticationOptions(),
  }, overrides);
}

function finishRegistration(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "register-operation",
    ceremonyId: "register-ceremony",
    accountId: "account-opaque",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prfEvaluationInput: PRF_INPUT,
  }, overrides);
}

function finishAuthentication(overrides = {}) {
  return Object.assign({}, finishRegistration(), {
    operationId: "authentication-operation",
    ceremonyId: "authentication-ceremony",
  }, overrides);
}

function nativeRegistrationCredential() {
  const extensions = { prf: { enabled: true, results: { first: PRF_OUTPUT.buffer.slice(0) } } };
  return {
    getClientExtensionResults() { return extensions; },
    toJSON() {
      return {
        id: CREDENTIAL_ID,
        rawId: CREDENTIAL_ID,
        response: {
          clientDataJSON: b64(bytes(17, 2)),
          attestationObject: b64(bytes(24, 4)),
          authenticatorData: b64(bytes(19, 6)),
          transports: ["internal"],
          publicKey: b64(bytes(23, 8)),
          publicKeyAlgorithm: -7,
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: {
          prf: { enabled: true, results: { first: PRF_OUTPUT_TEXT } },
        },
        type: "public-key",
      };
    },
  };
}

function nativeAuthenticationCredential() {
  const extensions = { prf: { results: { first: PRF_OUTPUT.buffer.slice(0) } } };
  return {
    getClientExtensionResults() { return extensions; },
    toJSON() {
      return {
        id: CREDENTIAL_ID,
        rawId: CREDENTIAL_ID,
        response: {
          clientDataJSON: b64(bytes(17, 12)),
          authenticatorData: b64(bytes(19, 14)),
          signature: b64(bytes(64, 16)),
          userHandle: null,
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: { prf: { results: { first: PRF_OUTPUT_TEXT } } },
        type: "public-key",
      };
    },
  };
}

function encryptedRecord(overrides = {}) {
  return Object.assign({
    format: "pocket.sync.content.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    nonce: b64(bytes(12, 31)),
    ciphertext: b64(bytes(32, 61)),
  }, overrides);
}

function readRequest(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    operationId: "read-operation",
    syncedPocketId: "pocket-opaque",
  }, overrides);
}

function emptyRevision(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "read-operation",
    syncedPocketId: "pocket-opaque",
    revision: 0,
    recordPresent: false,
    contentFormat: null,
    contentVersion: null,
    encryptedRecordSize: 0,
  }, overrides);
}

function positiveRevision(overrides = {}) {
  return Object.assign({}, emptyRevision(), {
    revision: 8,
    recordPresent: true,
    contentFormat: "pocket.sync.content.opaque",
    contentVersion: 1,
    encryptedRecordSize: 32,
  }, overrides);
}

function downloadRequest(overrides = {}) {
  return Object.assign({}, readRequest(), { operationId: "download-operation", revision: 8 }, overrides);
}

function downloadResponse(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "download-operation",
    syncedPocketId: "pocket-opaque",
    revision: 8,
    encryptedRecordSize: 32,
    encryptedRecord: encryptedRecord(),
  }, overrides);
}

function uploadRequest(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    syncedPocketId: "pocket-opaque",
    expectedRevision: 7,
    operationId: "upload-operation",
    logicalChangeId: "logical-change",
    attemptKind: "new-change",
    encryptedRecord: encryptedRecord(),
  }, overrides);
}

function committed(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    status: "committed",
    wrote: true,
    revision: 8,
    operationId: "upload-operation",
    replayed: false,
  }, overrides);
}

function conflict(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: false,
    status: "conflict",
    wrote: false,
    conflict: true,
    actualRevision: 9,
    operationId: "upload-operation",
  }, overrides);
}

function headers(values = {}) {
  const normalised = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get(name) { return normalised[name.toLowerCase()] ?? null; } };
}

function textResponse(body, options = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status: options.status ?? 200,
    redirected: options.redirected ?? false,
    headers: headers({
      "Content-Type": options.contentType ?? "application/json",
      ...(options.contentLength === undefined ? {} : { "Content-Length": String(options.contentLength) }),
    }),
    body: null,
    async text() { return text; },
  };
}

module.exports = {
  NOW,
  EXPIRES,
  PRF_INPUT,
  PRF_OUTPUT,
  PRF_OUTPUT_TEXT,
  CREDENTIAL_ID,
  bytes,
  b64,
  registrationOptions,
  authenticationOptions,
  beginRegistration,
  beginAuthentication,
  finishRegistration,
  finishAuthentication,
  nativeRegistrationCredential,
  nativeAuthenticationCredential,
  encryptedRecord,
  readRequest,
  emptyRevision,
  positiveRevision,
  downloadRequest,
  downloadResponse,
  uploadRequest,
  committed,
  conflict,
  headers,
  textResponse,
};
