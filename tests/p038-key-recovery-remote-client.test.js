"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const MODULE_PATH = "js/pocket-sync-remote-client.js";
const ORIGIN = "https://sync.pocket.example";
const NOW = Date.parse("2034-01-01T00:00:00.000Z");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function loadProduction(extra = {}) {
  const context = Object.assign({
    Object, Array, Number, String, Boolean, JSON, Date, Error, Promise, Set,
    ArrayBuffer, Uint8Array, TextEncoder, TextDecoder,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  }, extra);
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-account-client.js",
    MODULE_PATH,
  ]) vm.runInContext(source(file), context, { filename: file });
  return { api: context.PocketSyncRemoteClient, account: context.PocketSyncAccountClient,
    security: context.PocketSyncSecurityContract, context };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorCode(code) {
  return (error) => error && error.code === code;
}

function validTransport(handler) {
  return Object.freeze({ async request(route, body) { return handler(route, body); } });
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(length, seed = 1) {
  return Buffer.from(bytes(length, seed)).toString("base64url");
}

function encryptedEnvelope(seed = 1) {
  return { format: "pocket.sync.master-key-envelope.opaque", version: 1,
    algorithm: "AES-GCM-256", nonce: b64(12, seed), ciphertext: b64(48, seed + 20) };
}

function envelope(kind = "device", version = 1, id = `${kind}-envelope`) {
  const derived = kind !== "device";
  return {
    envelopeId: id,
    envelopeKind: kind,
    envelopeVersion: version,
    deviceId: kind === "device" ? "device-one" : null,
    credentialId: kind === "passkey-prf" ? "credential-one" : null,
    kdf: derived ? "HKDF-SHA-256" : "none",
    kdfSalt: derived ? b64(32, 40 + version) : null,
    derivationVersion: derived ? 1 : null,
    encryptedEnvelope: encryptedEnvelope(60 + version),
  };
}

function verifier(_version) {
  return { version: 1, algorithm: "Ed25519", publicKeyFormat: "spki",
    publicKey: b64(32, 120) };
}

function proof() {
  return { version: 1, algorithm: "Ed25519", signature: b64(64, 150) };
}

function mutation(overrides = {}) {
  return Object.assign({ apiVersion: 1, operationId: "key-operation",
    logicalChangeId: "key-change", attemptKind: "new-change",
    syncedPocketId: "pocket-one", expectedKeySetVersion: 0 }, overrides);
}

function committed(request, overrides = {}) {
  return Object.assign({ apiVersion: 1, ok: true, status: "committed", wrote: true,
    operationId: request.operationId, replayed: false,
    keySetVersion: request.expectedKeySetVersion + 1 }, overrides);
}

function conflict(request, overrides = {}) {
  return Object.assign({ apiVersion: 1, ok: false, status: "conflict", wrote: false,
    conflict: true, operationId: request.operationId,
    actualKeySetVersion: request.expectedKeySetVersion + 2 }, overrides);
}

function registrationCredential(id) {
  return { id, rawId: id, response: { clientDataJSON: b64(17, 2),
    attestationObject: b64(24, 4), authenticatorData: b64(19, 6),
    transports: ["internal"], publicKey: b64(23, 8), publicKeyAlgorithm: -7 },
  authenticatorAttachment: "platform", clientExtensionResults: { prf: { enabled: true } },
  type: "public-key" };
}

test("P038 keeps one dormant client with exact frozen route, export and service surfaces", () => {
  const { api } = loadProduction();
  assert.match(source("index.html"), /pocket-sync-remote-client\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-remote-client\.js/);
  assert.doesNotMatch(source("js/pocket-sync-contract.js"), /PocketSyncRemoteClient/);
  assert.deepEqual(Object.keys(api.ROUTES), ["beginRegistration", "finishRegistration",
    "beginAuthentication", "finishAuthentication", "readSyncedPocket", "readRevision", "downloadEncryptedRecord",
    "conditionalUpload", "listEnvelopes", "downloadEnvelope", "addEnvelope",
    "revokeEnvelope", "initialiseRecovery", "beginRecovery", "finishRecovery",
    "rotateRecovery"]);
  assert.deepEqual(Object.keys(api), ["POLICY", "ROUTES", "validateReadRevisionRequest",
    "validateReadRevisionResponse", "validateReadSyncedPocketRequest", "validateReadSyncedPocketResponse", "validateDownloadRequest", "validateDownloadResponse",
    "validateConditionalUploadRequest", "validateConditionalUploadResponse",
    "validateListEnvelopesRequest", "validateListEnvelopesResponse",
    "validateDownloadEnvelopeRequest", "validateDownloadEnvelopeResponse",
    "validateAddEnvelopeRequest", "validateAddEnvelopeResponse",
    "validateRevokeEnvelopeRequest", "validateRevokeEnvelopeResponse",
    "validateInitialiseRecoveryRequest", "validateInitialiseRecoveryResponse",
    "validateBeginRecoveryRequest", "validateBeginRecoveryResponse",
    "validateFinishRecoveryRequest", "validateFinishRecoveryResponse",
    "validateRotateRecoveryRequest", "validateRotateRecoveryResponse",
    "createBrowserJsonTransport", "createAccountService", "createContentService",
    "createPocketDiscoveryService", "createEnvelopeService", "createRecoveryService"]);
  const transport = validTransport(() => ({ status: 200, body: {} }));
  assert.deepEqual(Object.keys(api.createEnvelopeService({ transport })),
    ["listEnvelopes", "downloadEnvelope", "addEnvelope", "revokeEnvelope"]);
  assert.deepEqual(Object.keys(api.createRecoveryService({ transport })),
    ["initialiseRecovery", "beginRecovery", "finishRecovery", "rotateRecovery"]);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.ROUTES), true);
});

test("module load is inert and every new route uses the bounded same-origin transport policy", async () => {
  let reads = 0;
  const environment = {};
  for (const name of ["fetch", "location", "localStorage", "sessionStorage", "indexedDB",
    "document", "navigator", "setTimeout", "setInterval", "Worker"]) {
    Object.defineProperty(environment, name, { get() { reads += 1; throw new Error(name); } });
  }
  assert.doesNotThrow(() => loadProduction(environment));
  assert.equal(reads, 0);
  const { api } = loadProduction();
  const calls = [];
  const transport = api.createBrowserJsonTransport({ serviceRoot: "/sync/v1",
    async fetch(url, options) { calls.push({ url, options }); return fixtures.textResponse({ ok: true }); } });
  for (const route of Object.keys(api.ROUTES).slice(7)) await transport.request(route, {});
  assert.equal(calls.length, 9);
  for (const call of calls) {
    assert.match(call.url, /^\/sync\/v1\//);
    assert.doesNotMatch(call.url, /[?#]/);
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.mode, "same-origin");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.referrerPolicy, "no-referrer");
    assert.equal(Object.hasOwn(call.options.headers, "Authorization"), false);
  }
  const tooLarge = api.createBrowserJsonTransport({ serviceRoot: "/sync/v1",
    async fetch() { return fixtures.textResponse(`{"x":"${"a".repeat(262144)}"}`); } });
  await assert.rejects(tooLarge.request("downloadEnvelope", {}), errorCode("remote-response-too-large"));
});

test("browser transport permits 409 only for mutation routes and requires the small JSON bound", async () => {
  const { api } = loadProduction();
  for (const route of ["addEnvelope", "revokeEnvelope", "initialiseRecovery", "rotateRecovery"]) {
    const transport = api.createBrowserJsonTransport({ serviceRoot: "/sync/v1",
      async fetch() { return fixtures.textResponse({ conflict: true }, { status: 409 }); } });
    assert.equal((await transport.request(route, {})).status, 409, route);
  }
  for (const route of ["listEnvelopes", "downloadEnvelope", "beginRecovery", "finishRecovery"]) {
    const transport = api.createBrowserJsonTransport({ serviceRoot: "/sync/v1",
      async fetch() { return fixtures.textResponse({ conflict: true }, { status: 409 }); } });
    await assert.rejects(transport.request(route, {}), errorCode("remote-request-rejected"), route);
  }
});

test("P031 and P029 production contracts are mandatory without local fallback validators", () => {
  const loaded = loadProduction();
  const transport = validTransport(() => ({ status: 200, body: {} }));
  loaded.context.PocketSyncSecurityContract = null;
  assert.throws(() => loaded.api.createEnvelopeService({ transport }),
    errorCode("remote-security-contract-unavailable"));
  loaded.context.PocketSyncSecurityContract = loaded.security;
  loaded.context.PocketSyncAccountClient = null;
  assert.throws(() => loaded.api.createRecoveryService({ transport }),
    errorCode("remote-account-contract-unavailable"));
});

test("list and download validators enforce correlation, ordering, metadata and exact ciphertext", () => {
  const { api } = loadProduction();
  const request = { apiVersion: 1, operationId: "list-one", syncedPocketId: "pocket-one" };
  const metadata = { ...envelope("device"), status: "active",
    createdAt: "2034-01-01T00:00:00.000Z", revokedAt: null };
  delete metadata.encryptedEnvelope;
  const listed = api.validateListEnvelopesResponse({ apiVersion: 1, ok: true,
    operationId: "list-one", syncedPocketId: "pocket-one", keySetVersion: 1,
    recoveryStatus: "unconfigured", recoveryVersion: 0, envelopes: [metadata] }, request);
  assert.equal(listed.envelopes[0].envelopeId, "device-envelope");
  assert.equal(Object.isFrozen(listed.envelopes[0]), true);
  assert.throws(() => api.validateListEnvelopesResponse({ ...listed,
    envelopes: [metadata, metadata] }, request), errorCode("remote-response-invalid"));
  assert.throws(() => api.validateListEnvelopesResponse({ ...listed,
    accountLocator: "secret" }, request), errorCode("remote-response-invalid"));
  const downloadRequest = { ...request, operationId: "download-one", envelopeId: "device-envelope" };
  const downloaded = api.validateDownloadEnvelopeResponse({ apiVersion: 1, ok: true,
    operationId: "download-one", syncedPocketId: "pocket-one", keySetVersion: 1,
    envelope: { ...envelope("device"), encryptedEnvelopeSize: 48 } }, downloadRequest);
  assert.equal(downloaded.envelope.encryptedEnvelopeSize, 48);
  assert.throws(() => api.validateDownloadEnvelopeResponse({ ...downloaded,
    envelope: { ...downloaded.envelope, encryptedEnvelopeSize: 47 } }, downloadRequest),
  errorCode("remote-response-invalid"));
});

test("generic envelope mutations validate kinds, versions, status agreement and replay semantics", async () => {
  const { api } = loadProduction();
  for (const kind of ["device", "passkey-prf", "device-transfer"]) {
    assert.doesNotThrow(() => api.validateAddEnvelopeRequest({ ...mutation(), envelope: envelope(kind) }));
  }
  assert.throws(() => api.validateAddEnvelopeRequest({ ...mutation(), envelope: envelope("recovery") }),
    errorCode("remote-request-invalid"));
  assert.throws(() => api.validateAddEnvelopeRequest({ ...mutation(),
    expectedKeySetVersion: Number.MAX_SAFE_INTEGER, envelope: envelope("device") }),
  errorCode("remote-request-invalid"));
  const request = { ...mutation(), envelope: envelope("device") };
  assert.equal(api.validateAddEnvelopeResponse(200, committed(request, {
    masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }), request).wrote, true);
  assert.equal(api.validateAddEnvelopeResponse(409, conflict(request), request).conflict, true);
  assert.throws(() => api.validateAddEnvelopeResponse(200, conflict(request), request),
    errorCode("remote-response-invalid"));
  assert.throws(() => api.validateAddEnvelopeResponse(409, committed(request), request),
    errorCode("remote-response-invalid"));
  assert.throws(() => api.validateAddEnvelopeResponse(200,
    committed(request, { replayed: true }), request), errorCode("remote-response-invalid"));
  const retry = { ...request, attemptKind: "idempotent-retry" };
  assert.equal(api.validateAddEnvelopeResponse(200,
    committed(retry, { replayed: true, masterKeyGeneration: 1,
      masterKeyContentEncryptionLimit: 2 ** 20 }), retry).replayed, true);
  assert.doesNotThrow(() => api.validateRevokeEnvelopeRequest({ ...mutation(), envelopeId: "device-envelope" }));
});

test("recovery validators reject secret/package fields and bind versions, proof and account contracts", () => {
  const { api, account } = loadProduction();
  const initialise = { ...mutation(), recoveryVerifier: verifier(1),
    recoveryEnvelope: envelope("recovery", 1, "recovery-one") };
  const initRequest = api.validateInitialiseRecoveryRequest(initialise);
  const initResponse = api.validateInitialiseRecoveryResponse(200,
    committed(initRequest, { recoveryVersion: 1, accountLocator: "locator-one",
      recoveryCopyRequired: true }), initRequest);
  assert.equal(initResponse.accountLocator, "locator-one");
  assert.throws(() => api.validateInitialiseRecoveryRequest({ ...initialise,
    recoveryRoot: "secret" }), errorCode("remote-request-invalid"));
  assert.throws(() => api.validateInitialiseRecoveryRequest({ ...initialise,
    recoveryPackage: {} }), errorCode("remote-request-invalid"));
  const beginRequest = { apiVersion: 1, operationId: "recover-one",
    accountLocator: "locator-one", deviceId: "device-recovered" };
  const begin = fixtures.beginRegistration({ operationId: "recover-one",
    ceremonyId: "recovery-ceremony" });
  const beginResponse = { ...begin, recoveryCeremonyId: begin.ceremonyId,
    recoveryVersion: 1, keySetVersion: 3, challenge: begin.publicKeyCreationOptions.challenge };
  delete beginResponse.ceremonyId;
  assert.equal(api.validateBeginRecoveryResponse(beginResponse, beginRequest,
    () => fixtures.NOW).recoveryVersion, 1);
  assert.throws(() => api.validateBeginRecoveryResponse({ ...beginResponse, keySetVersion: 0 },
    beginRequest, () => fixtures.NOW), errorCode("remote-response-invalid"));
  const credential = account.serializeRegistrationCredential(
    fixtures.nativeRegistrationCredential(), fixtures.PRF_INPUT).credential;
  const finishRequest = { apiVersion: 1, operationId: "recover-one",
    recoveryCeremonyId: "recovery-ceremony", deviceId: "device-recovered", proof: proof(), credential };
  const validated = api.validateFinishRecoveryRequest(finishRequest);
  assert.deepEqual(plain(validated.credential.clientExtensionResults), { prf: { enabled: true } });
  assert.equal(Object.hasOwn(validated.credential.clientExtensionResults.prf, "results"), false);
  assert.doesNotMatch(JSON.stringify(validated), new RegExp(fixtures.PRF_OUTPUT_TEXT));
  assert.throws(() => api.validateFinishRecoveryRequest({ ...finishRequest,
    proof: { ...proof(), signature: "AA" } }), errorCode("remote-request-invalid"));
});

test("finish and rotate responses enforce identity, envelope and two-version conflict correlation", () => {
  const { api, account } = loadProduction();
  const credential = account.serializeRegistrationCredential(
    fixtures.nativeRegistrationCredential(), fixtures.PRF_INPUT).credential;
  const finishRequest = { apiVersion: 1, operationId: "recover-one",
    recoveryCeremonyId: "recovery-ceremony", deviceId: "device-recovered", proof: proof(), credential };
  const finishResponse = { ...fixtures.finishRegistration({ operationId: "recover-one",
    ceremonyId: "recovery-ceremony" }), recoveryCeremonyId: "recovery-ceremony",
    syncedPocketId: "pocket-one", keySetVersion: 4, recoveryVersion: 1,
    recoveryEnvelope: { ...envelope("recovery", 1, "recovery-one"), encryptedEnvelopeSize: 48 },
    replacementCopyRequired: true };
  delete finishResponse.ceremonyId;
  assert.equal(api.validateFinishRecoveryResponse(finishResponse, finishRequest).keySetVersion, 4);
  assert.throws(() => api.validateFinishRecoveryResponse({ ...finishResponse,
    contentUnlocked: true }, finishRequest), errorCode("remote-response-invalid"));
  const rotate = { ...mutation({ expectedKeySetVersion: 4 }), recoveryOperationId: "recover-one",
    expectedRecoveryVersion: 1, recoveryVerifier: verifier(1),
    recoveryEnvelope: envelope("recovery", 2, "recovery-two") };
  const rotated = api.validateRotateRecoveryResponse(200,
    committed(rotate, { recoveryVersion: 2, accountLocator: "locator-two",
      previousRecoveryInvalidated: true, replacementCopyRequired: true }), rotate);
  assert.equal(rotated.recoveryVersion, 2);
  assert.equal(api.validateRotateRecoveryResponse(409, conflict(rotate,
    { actualKeySetVersion: 4, actualRecoveryVersion: 2 }), rotate).conflict, true);
  assert.throws(() => api.validateRotateRecoveryResponse(409, conflict(rotate,
    { actualKeySetVersion: 4, actualRecoveryVersion: 1 }), rotate),
  errorCode("remote-response-invalid"));
});

function createCompatibilityHarness() {
  const driver = createMemoryServiceStore();
  let randomCall = 0;
  const core = createServiceCore({ store: driver.store,
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) { return { credentialId: input.credential.id,
        publicKey: b64(64, 201), publicKeyAlgorithm: -7, signCount: 0,
        transports: ["internal"], backupEligible: true, backedUp: false }; },
      async verifyAuthentication(input) { return { credentialId: input.credential.id,
        signCount: input.storedCredential.signCount + 1, backedUp: true }; },
    }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes(length) { randomCall += 1; return bytes(length, randomCall * 17); },
    now: () => NOW, trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: Object.freeze([-7]), ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000 });
  return { core, driver };
}

test("actual P038 adapters accept all eight P036/P037 service operations without bypassing validators", async () => {
  const { api } = loadProduction();
  const { core, driver } = createCompatibilityHarness();
  const originalCredential = registrationCredential(b64(32, 11));
  const beginRegistration = await core.beginRegistration({ context: { method: "POST", origin: ORIGIN,
    fetchSite: "same-origin", contentType: "application/json", sessionId: null },
  body: { apiVersion: 1, operationId: "register", accountIntent: "create-or-add-credential",
    deviceId: "device-original" } });
  const finishRegistration = await core.finishRegistration({ context: { method: "POST", origin: ORIGIN,
    fetchSite: "same-origin", contentType: "application/json", sessionId: null },
  body: { apiVersion: 1, operationId: "register", ceremonyId: beginRegistration.body.ceremonyId,
    deviceId: "device-original", credential: originalCredential } });
  let originalSession = finishRegistration.session.sessionId;
  let recoveredSession = null;
  const invoke = async (route, body) => {
    const sessionId = ["beginRecovery", "finishRecovery"].includes(route) ? null
      : route === "rotateRecovery" ? recoveredSession : originalSession;
    const result = await core[route]({ context: { method: "POST", origin: ORIGIN,
      fetchSite: "same-origin", contentType: "application/json", sessionId }, body: plain(body) });
    if (route === "finishRecovery") recoveredSession = result.session.sessionId;
    return { status: result.status, body: result.body };
  };
  await core.conditionalUpload({ context: { method: "POST", origin: ORIGIN,
    fetchSite: "same-origin", contentType: "application/json", sessionId: originalSession },
  body: { apiVersion: 1, syncedPocketId: "pocket-one", expectedRevision: 0,
    operationId: "upload", logicalChangeId: "upload-change", attemptKind: "new-change",
    encryptedRecord: { format: "pocket.sync.content.opaque", version: 1,
      algorithm: "AES-GCM-256", nonce: b64(12, 22), ciphertext: b64(32, 32) } } });
  const transport = validTransport(invoke);
  const envelopes = api.createEnvelopeService({ transport });
  const recovery = api.createRecoveryService({ transport, now: () => NOW });
  assert.equal((await envelopes.listEnvelopes({ apiVersion: 1, operationId: "list-zero",
    syncedPocketId: "pocket-one" })).keySetVersion, 0);
  const addRequest = { ...mutation({ operationId: "add", logicalChangeId: "add-change" }),
    envelope: envelope("device") };
  assert.equal((await envelopes.addEnvelope(addRequest)).keySetVersion, 1);
  assert.equal((await envelopes.downloadEnvelope({ apiVersion: 1, operationId: "download",
    syncedPocketId: "pocket-one", envelopeId: "device-envelope" })).envelope.encryptedEnvelopeSize, 48);
  assert.equal((await envelopes.revokeEnvelope({ ...mutation({ operationId: "revoke",
    logicalChangeId: "revoke-change", expectedKeySetVersion: 1 }),
  envelopeId: "device-envelope" })).keySetVersion, 2);
  const initial = await recovery.initialiseRecovery({ ...mutation({ operationId: "init",
    logicalChangeId: "init-change", expectedKeySetVersion: 2 }), recoveryVerifier: verifier(1),
    recoveryEnvelope: envelope("recovery", 1, "recovery-one") });
  assert.equal(initial.recoveryVersion, 1);
  const begun = await recovery.beginRecovery({ apiVersion: 1, operationId: "recover",
    accountLocator: initial.accountLocator, deviceId: "device-recovered" });
  const recoveredCredential = registrationCredential(b64(32, 31));
  const finished = await recovery.finishRecovery({ apiVersion: 1, operationId: "recover",
    recoveryCeremonyId: begun.recoveryCeremonyId, deviceId: "device-recovered",
    proof: proof(), credential: recoveredCredential });
  assert.equal(finished.recoveryVersion, 1);
  const rotateRequest = { ...mutation({ operationId: "rotate", logicalChangeId: "rotate-change",
    expectedKeySetVersion: finished.keySetVersion }), recoveryOperationId: "recover",
    expectedRecoveryVersion: 1, recoveryVerifier: verifier(2),
    recoveryEnvelope: envelope("recovery", 2, "recovery-two") };
  const rotated = await recovery.rotateRecovery(rotateRequest);
  assert.equal(rotated.recoveryVersion, 2);
  const replayed = await recovery.rotateRecovery({ ...rotateRequest, attemptKind: "idempotent-retry" });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.accountLocator, rotated.accountLocator);
  const conflicted = await envelopes.addEnvelope({ ...mutation({ operationId: "conflict",
    logicalChangeId: "conflict-change", expectedKeySetVersion: 0 }),
  envelope: envelope("device-transfer", 1, "transfer-one") });
  assert.equal(conflicted.conflict, true);
  const snapshotText = JSON.stringify(driver.snapshot());
  for (const sentinel of ["RAW-MASTER-KEY", "RAW-RECOVERY-ROOT", "RAW-PRF-OUTPUT",
    "READABLE-POCKET-CONTENT"]) assert.doesNotMatch(snapshotText, new RegExp(sentinel));
});

test("services validate before transport, freeze responses, preserve inputs and never retry", async () => {
  const { api } = loadProduction();
  let calls = 0;
  const request = { ...mutation(), envelope: envelope("device") };
  const before = JSON.stringify(request);
  const service = api.createEnvelopeService({ transport: validTransport(() => {
    calls += 1;
    return { status: 200, body: committed(request, { masterKeyGeneration: 1,
      masterKeyContentEncryptionLimit: 2 ** 20 }) };
  }) });
  const result = await service.addEnvelope(request);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(request), before);
  assert.equal(calls, 1);
  await assert.rejects(service.addEnvelope({ ...request, unknown: true }),
    errorCode("remote-request-invalid"));
  assert.equal(calls, 1);
  const unavailable = api.createEnvelopeService({ transport: validTransport(() => {
    calls += 1;
    throw new Error("ambiguous secret");
  }) });
  await assert.rejects(unavailable.addEnvelope(request), (error) =>
    error.code === "remote-unavailable" && error.retryable === true);
  assert.equal(calls, 2);
});

test("production client contains no secret handling, persistence, retry, owner or Save machinery", () => {
  const text = source(MODULE_PATH);
  assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie|setTimeout|setInterval|Worker|WebSocket|EventSource|XMLHttpRequest|console\.|telemetry/i);
  assert.doesNotMatch(text, /crypto\.subtle|\.encrypt\s*\(|\.decrypt\s*\(|deriveKey|recoveryPackage|setPocketFileSession|ownerKind|exportTree|Authorization\s*:/i);
  assert.doesNotMatch(text, /while\s*\([^)]*(retry|attempt)|for\s*\([^)]*(retry|attempt)/i);
  assert.doesNotMatch(source("package.json"), /p038|key-recovery-remote/);
});
