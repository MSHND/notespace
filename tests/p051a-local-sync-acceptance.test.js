"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const { createHttpAdapter } = require("../sync-service/pocket-sync-http-adapter.js");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const { createSharedDeviceStoreState, createMemoryDeviceStoreDriver } = require("./helpers/p030-memory-device-store-driver.js");

const ROOT = path.resolve(__dirname, "..");

function p168ObjectHeadStore() {
  let head = { schema: "pocket.starling.head.v1", revision: 0, sealRef: null };
  return Object.freeze({
    async putObject() { return { ok: true, created: true }; },
    async getObject() { return null; },
    async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: false })); },
    async initialiseHead() { return head; },
    async readHead() { return head; },
    async compareAndSetHead(_pocket, expected, candidate) {
      if (head.revision !== expected.revision || head.sealRef !== expected.sealRef) {
        return { ok: false, reason: "head-conflict", head };
      }
      head = { schema: head.schema, revision: head.revision + 1, sealRef: candidate };
      return { ok: true, head };
    },
  });
}

const ORIGIN = "https://sync.pocket.example";
const SERVICE_ROOT = "/pocket-sync/v1";
const NOW = Date.parse("2042-01-01T00:00:00.000Z");
const READABLE = "P051A-READABLE-POCKET-MUST-STAY-LOCAL";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function registrationCredential() {
  const id = b64(bytes(32, 121));
  return {
    id, rawId: id, type: "public-key", authenticatorAttachment: "platform",
    response: {
      clientDataJSON: b64(bytes(17, 2)), attestationObject: b64(bytes(24, 4)),
      authenticatorData: b64(bytes(19, 6)), transports: ["internal"],
      publicKey: b64(bytes(23, 8)), publicKeyAlgorithm: -7,
    },
    clientExtensionResults: { prf: { enabled: true } },
  };
}

function createAdapterHarness() {
  const driver = createMemoryServiceStore();
  let randomCall = 0;
  const core = createServiceCore({
    store: driver.store,
    objectHeadStore: p168ObjectHeadStore(),
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) {
        return { credentialId: input.credential.id, publicKey: b64(bytes(64, 81)),
          publicKeyAlgorithm: -7, signCount: 0, transports: ["internal"],
          backupEligible: true, backedUp: false };
      },
      async verifyAuthentication() { throw new Error("not used"); },
    }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes(length) { randomCall += 1; return bytes(length, randomCall * 19); },
    now: () => NOW, trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
  });
  return { driver, adapter: createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT }) };
}

function browserFetch(adapter, observations) {
  let cookie = "";
  return async (url, options) => {
    const observation = { url, options: JSON.parse(JSON.stringify(options)), requestHeaders: null, setCookie: null };
    observations.push(observation);
    const headers = new Headers(options.headers);
    headers.set("Origin", ORIGIN);
    headers.set("Sec-Fetch-Site", "same-origin");
    if (cookie) headers.set("Cookie", cookie);
    observation.requestHeaders = Object.fromEntries(headers.entries());
    const response = await adapter.handle(new Request(`${ORIGIN}${url}`, {
      method: options.method, headers, body: options.body,
    }));
    const setCookie = response.headers.get("Set-Cookie");
    if (setCookie) {
      observation.setCookie = setCookie;
      cookie = setCookie.split(";", 1)[0];
    }
    return response;
  };
}

function response() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? null : Buffer.from(value); },
  };
}

async function localRequest(handler, method, url) {
  const result = response();
  await handler({ method, url }, result);
  return result;
}

function loadBrowserContext(adapter, observations) {
  let sessionId = 1;
  let ownerKind = "json";
  const context = {
    crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    fetch: browserFetch(adapter, observations),
    document: { currentScript: { dataset: { serviceRoot: SERVICE_ROOT } } },
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    capturePocketFileSaveSession() { return { id: sessionId, ownerKind, vaultSessionId: "" }; },
    isPocketFileSaveSessionCurrent(value) { return !!value && value.id === sessionId && value.ownerKind === ownerKind; },
    setPocketFileSession(_handle, _name, options = {}) { ownerKind = options.ownerKind || "json"; sessionId += 1; },
    buildPocketPayload() { return { mainThoughtTree: [{ id: "saved", label: READABLE }] }; },
    hasPocketUnsavedChanges() { return false; },
    PocketDeviceChanges: { fingerprintDocument(value) { return JSON.stringify(value); } },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js", "js/pocket-device-changes.js", "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js", "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js",
    "js/pocket-sync-activation.js", "js/pocket-sync-emergency-recovery.js", "js/pocket-sync-owner-controller.js", "js/pocket-owner-save-boundary.js",
    "js/pocket-sync-activation-owner-bridge.js", "js/pocket-sync-browser-runtime.js",
  ]) vm.runInContext(source(file), context, { filename: file });
  return context;
}

function browserValue(context, value) {
  context.__p051aValue = JSON.stringify(value);
  return vm.runInContext("JSON.parse(__p051aValue)", context);
}

async function createOwnedRecord(context, store, syncedPocketId) {
  const crypto = context.PocketSyncCrypto;
  const deviceWrappingKey = await crypto.generateDeviceWrappingKey();
  const envelopeContext = { syncedPocketId, envelopeId: "device-envelope", envelopeKind: "device", envelopeVersion: 1 };
  const bundle = await crypto.createMasterKeyBundle([{ context: envelopeContext, wrappingKey: deviceWrappingKey }]);
  const contentContext = { syncedPocketId, revision: 0, contentType: crypto.FORMAT.contentType };
  const record = {
    kind: "pocket.sync.device-state", schemaVersion: 5, storeRevision: 1, syncedPocketId, deviceId: "local-device",
    deviceWrappingKey,
    deviceEnvelope: { context: envelopeContext, metadata: {
      contractVersion: 1, syncedPocketId, envelopeId: "device-envelope", kind: "device", version: 1,
      deviceId: "local-device", createdAt: "2042-01-01T00:00:00.000Z", kdf: "none",
    }, record: bundle.envelopes[0].record },
    content: { context: contentContext, record: await crypto.sealContent({ initial: true }, bundle.masterKey, contentContext) },
    remote: { confirmedRevision: 0, pending: null, conflict: null },
    usage: { masterKeyGeneration: 1, masterKeyContentEncryptions: 1, masterKeyContentEncryptionLimit: 2 ** 20, deviceWrappingKeyEncryptions: 1 },
    activationDraft: null, recoveryDraft: null, additionalDeviceDraft: null,
  };
  await store.createPocket(record);
  return bundle.masterKey;
}

test("P051a crosses production P032 transport, P046 adapter and secure cookie continuity", async () => {
  const { adapter } = createAdapterHarness();
  const seen = [];
  const context = loadBrowserContext(adapter, seen);
  const remote = context.PocketSyncRemoteClient;
  const transport = remote.createBrowserJsonTransport({ serviceRoot: SERVICE_ROOT });
  const account = remote.createAccountService({ transport, now: () => NOW });
  const begin = await account.beginRegistration(browserValue(context, {
    apiVersion: 1, operationId: "register-p051a", accountIntent: "create-or-add-credential", deviceId: "local-device",
  }));
  await account.finishRegistration(browserValue(context, {
    apiVersion: 1, operationId: "register-p051a", ceremonyId: begin.ceremonyId,
    deviceId: "local-device", credential: registrationCredential(),
  }));
  const content = remote.createContentService({ transport });
  const revision = await content.readRevision(browserValue(context,
    { apiVersion: 1, operationId: "read-p051a", syncedPocketId: "opaque-pocket" }));
  assert.equal(revision.revision, 0);
  assert.equal(seen.every((entry) => entry.options.method === "POST"), true);
  assert.equal(seen.every((entry) => entry.options.headers.Authorization === undefined), true);
  assert.equal(seen.every((entry) => entry.options.mode === "same-origin"), true);
  assert.equal(seen.some((entry) => entry.options.headers.Cookie), false);
  assert.match(seen[1].setCookie, /^__Host-pocket-sync-session=[A-Za-z0-9_-]+; Path=\/; Secure; HttpOnly; SameSite=Strict;/);
  assert.match(seen[2].requestHeaders.cookie, /^__Host-pocket-sync-session=[A-Za-z0-9_-]+$/);
  const rejected = await adapter.handle(new Request(`${ORIGIN}${SERVICE_ROOT}/pockets/revision/read`, {
    method: "POST", headers: { Origin: "https://wrong.example", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.has("Access-Control-Allow-Origin"), false);
});

test("P051a local host serves every currently referenced browser asset and reserves Sync POSTs", async () => {
  const { createLocalIntegrationHandler } = require("../sync-service/pocket-sync-local-integration-server.js");
  let apiCalls = 0;
  const handler = createLocalIntegrationHandler({
    application: { async handle(_request, result) { apiCalls += 1; result.statusCode = 204; result.end(); } },
    browserRoot: ROOT, serviceRoot: SERVICE_ROOT,
  });
  const paths = new Set(["/", "/sw.js"]);
  for (const file of ["index.html", "sw.js"]) {
    for (const match of source(file).matchAll(/["']((?:\.\/)?(?:js\/|icons\/|assets\/)?[A-Za-z0-9._/-]+\.(?:js|css|json|png|svg|webp|ico))["']/g)) {
      paths.add(`/${match[1].replace(/^\.\//, "")}`);
    }
  }
  for (const asset of paths) assert.equal((await localRequest(handler, "GET", asset)).statusCode, 200, asset);
  for (const privatePath of ["/package.json", "/tests/p051a-local-sync-acceptance.test.js", "/sync-service/pocket-sync-server.js"]) {
    assert.equal((await localRequest(handler, "GET", privatePath)).statusCode, 404);
  }
  assert.equal((await localRequest(handler, "POST", `${SERVICE_ROOT}/account/passkeys/registration/begin`)).statusCode, 204);
  assert.equal(apiCalls, 1);
  assert.doesNotMatch(source("index.html"), /pocket-sync-local-integration\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-local-integration\.js/);
});

test("P051a composes one real content service into ordinary owner-aware Save without sending readable data", async () => {
  const { adapter, driver } = createAdapterHarness();
  const seen = [];
  const context = loadBrowserContext(adapter, seen);
  const originalRemote = context.PocketSyncRemoteClient;
  const originalBrowser = context.PocketSyncBrowserRuntime;
  let composedContent = null;
  let runtimeInput = null;
  context.PocketSyncRemoteClient = Object.freeze({ ...originalRemote,
    createContentService(input) { composedContent = originalRemote.createContentService(input); return composedContent; },
  });
  context.PocketSyncBrowserRuntime = Object.freeze({
    createRuntime(input) { runtimeInput = input; return originalBrowser.createRuntime(input); },
  });
  vm.runInContext(source("js/pocket-sync-local-integration.js"), context, { filename: "js/pocket-sync-local-integration.js" });
  context.PocketSyncLocalIntegration.create();
  assert.equal(runtimeInput.contentService, composedContent);

  const transport = originalRemote.createBrowserJsonTransport({ serviceRoot: SERVICE_ROOT });
  const account = originalRemote.createAccountService({ transport, now: () => NOW });
  const begin = await account.beginRegistration(browserValue(context, {
    apiVersion: 1, operationId: "register-save", accountIntent: "create-or-add-credential", deviceId: "local-device",
  }));
  await account.finishRegistration(browserValue(context, {
    apiVersion: 1, operationId: "register-save", ceremonyId: begin.ceremonyId,
    deviceId: "local-device", credential: registrationCredential(),
  }));
  const state = createSharedDeviceStoreState();
  const store = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(state));
  await store.open();
  const syncedPocketId = "pocket-p051a";
  const masterKey = await createOwnedRecord(context, store, syncedPocketId);
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto: context.PocketSyncCrypto,
    deviceStore: Object.freeze({
      readPocket: store.readPocket.bind(store), readRecoveryAttempt: store.readRecoveryAttempt.bind(store),
      reservePocketEncryptionUsage: store.reservePocketEncryptionUsage.bind(store), replacePocket: store.replacePocket.bind(store),
    }),
    contentService: composedContent,
    randomBytes(length) { return bytes(length, 33); },
  });
  assert.equal((await controller.adoptSyncedOwner({ syncedPocketId, masterKey })).ok, true);
  assert.equal(context.PocketOwnerSaveBoundary.installSyncedOwnerForSave(controller), true);
  const saved = await context.PocketOwnerSaveBoundary.save({
    expectedSession: context.capturePocketFileSaveSession(),
    async freezePayload() { return { mainThoughtTree: [{ id: "saved", label: READABLE }] }; },
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.confirmedRemoteRevision, 1);
  assert.equal((await store.readPocket(syncedPocketId)).remote.confirmedRevision, 1);
  const remoteText = JSON.stringify(seen);
  assert.equal(remoteText.includes(READABLE), false);
  assert.equal(remoteText.includes("masterKey"), false);
  assert.equal(JSON.stringify(driver.snapshot()).includes(READABLE), false);
});

test("P051a verifyRoundTrip safely rejects every unavailable or mismatched local acceptance state", async () => {
  const calls = [];
  const current = { mainThoughtTree: [{ id: "saved", label: READABLE }] };
  const state = { activated: false, unsaved: false, pending: false, absent: false, decryptFails: false, mismatch: false };
  const context = {
    Uint8Array, Buffer, Date, Object, Array, Number, String, Boolean, Error, Promise,
    document: { currentScript: { dataset: { serviceRoot: SERVICE_ROOT } } },
    crypto: { getRandomValues(value) { value.fill(9); return value; } },
    buildPocketPayload() { return current; },
    hasPocketUnsavedChanges() { return state.unsaved; },
    PocketDeviceChanges: { fingerprintDocument(value) { return JSON.stringify(value); } },
    PocketSyncCrypto: {
      FORMAT: { contentType: "portal.export.v1+json" },
      encodeBase64Url(value) { return Buffer.from(value).toString("base64url"); },
      async openMasterKeyBundle() { calls.push("open-master"); return { masterKey: { private: "must-not-return" } }; },
      async openContent() {
        calls.push("open-content");
        if (state.decryptFails) throw new Error("native decryption detail");
        return state.mismatch ? { mainThoughtTree: [{ id: "other", label: "remote secret" }] } : current;
      },
    },
    PocketSyncDeviceStore: {
      async open() { calls.push("store-open"); },
      async readStoredRecord() {
        calls.push("read-record");
        return { remote: { pending: state.pending ? {} : null, conflict: null },
          deviceEnvelope: { record: { encrypted: "must-not-return" }, context: {} }, deviceWrappingKey: { key: "must-not-return" } };
      },
    },
    PocketSyncRemoteClient: {
      createBrowserJsonTransport() { return {}; },
      createAccountService() { return {}; }, createEnvelopeService() { return {}; }, createRecoveryService() { return {}; },
      createContentService() {
        return {
          async readRevision() { calls.push("read-revision"); return state.absent ? { recordPresent: false, revision: 0 } : { recordPresent: true, revision: 2 }; },
          async downloadEncryptedRecord() { calls.push("download"); return { encryptedRecord: { opaque: true } }; },
        };
      },
    },
    PocketSyncBrowserRuntime: {
      createRuntime() {
        return { async activate() {
          state.activated = true;
          return { ok: true, owner: { ownerKind: "synced", syncedPocketId: "opaque-pocket" } };
        }, async resume() { return { ok: false }; } };
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-local-integration.js"), context, { filename: "js/pocket-sync-local-integration.js" });
  const probe = context.PocketSyncLocalIntegration.create();
  const safe = async () => JSON.parse(JSON.stringify(await probe.verifyRoundTrip()));
  assert.deepEqual(await safe(), { ok: false, reason: "sync-not-activated" });
  assert.deepEqual(calls, []);
  await probe.activate();
  state.unsaved = true;
  assert.deepEqual(await safe(), { ok: false, reason: "source-has-unsaved-changes" });
  assert.deepEqual(calls, []);
  state.unsaved = false;
  state.pending = true;
  assert.deepEqual(await safe(), { ok: false, reason: "round-trip-not-ready" });
  assert.equal(calls.includes("download"), false);
  calls.length = 0;
  state.pending = false;
  state.absent = true;
  assert.deepEqual(await safe(), { ok: false, reason: "round-trip-not-ready" });
  assert.equal(calls.includes("download"), false);
  calls.length = 0;
  state.absent = false;
  state.decryptFails = true;
  assert.deepEqual(await safe(), { ok: false, reason: "round-trip-unavailable" });
  calls.length = 0;
  state.decryptFails = false;
  state.mismatch = true;
  assert.deepEqual(await safe(), { ok: false, reason: "round-trip-mismatch" });
  calls.length = 0;
  state.mismatch = false;
  const success = await safe();
  assert.deepEqual(success, { ok: true, revision: 2, matchesCurrentSavedPocket: true });
  for (const result of [success, await safe()]) {
    assert.equal(JSON.stringify(result).includes(READABLE), false);
    assert.equal(JSON.stringify(result).includes("must-not-return"), false);
  }
});
