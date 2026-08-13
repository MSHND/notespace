"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const { createSharedDeviceStoreState, createMemoryDeviceStoreDriver } = require("./helpers/p030-memory-device-store-driver.js");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadProduction(options = {}) {
  const storage = new Map(Object.entries(options.localStorageSeed || {}).map(([key, value]) => [String(key), String(value)]));
  const storageCalls = [];
  const document = {
    body: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
    activeElement: null,
    getElementById() { return null; },
    addEventListener() {},
    createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, click() {} }; },
  };
  const context = { crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, Object, Array, Number, String, Boolean, JSON, Date, Error, TypeError, Promise, Set,
    Map, URL, Blob, structuredClone, document,
    HTMLElement: class HTMLElement {}, HTMLInputElement: class HTMLInputElement {}, HTMLTextAreaElement: class HTMLTextAreaElement {}, HTMLButtonElement: class HTMLButtonElement {},
    location: { href: "https://pocket.test/index.html" }, navigator: { clipboard: {} },
    localStorage: { getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
      setItem(key, value) { const entry = { type: "set", key: String(key), value: String(value) }; storage.set(entry.key, entry.value); storageCalls.push(entry); },
      removeItem(key) { const entry = { type: "remove", key: String(key) }; storage.delete(entry.key); storageCalls.push(entry); } },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, confirm() { return true; }, alert() {}, open() { return null; },
    refreshMeta() {}, renderTree() {}, refocusTreeNavigation() {}, softlyEnsureSelectionVisible() {}, repairVisibleSelectionAfterRender() {},
    collapseAllNodes() {}, expandPathToNode() {}, focusRowByNodeId() {}, stopMovePadRepeat() {}, getExpandableIds() { return []; }, getPath(id) { return String(id || ""); },
    isDetailsEditorOpen() { return false; }, hasUnsavedDetailsEditorChanges() { return false; }, saveDetailsEditor() {}, flashSaveChip() {}, setStatus() {},
    __localStorage: { values: storage, calls: storageCalls },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary") };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  const browserFiles = options.browserPersistence === true ? [
    "js/pocket-state.js", "js/pocket-data.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-editor-copy.js", "js/pocket-history-status.js",
    "js/pocket-render.js", "js/pocket-io-browser.js", "js/pocket-device-changes.js",
  ] : [];
  for (const file of browserFiles.concat(["js/pocket-sync-security-contract.js", "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js", "js/pocket-sync-owner-controller.js",
    "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js",
    "js/pocket-sync-activation.js", "js/pocket-sync-additional-device.js",
    "js/pocket-owner-save-boundary.js", "js/pocket-sync-activation-owner-bridge.js",
    "js/pocket-sync-browser-runtime.js"])) {
    vm.runInContext(source(file), context, { filename: file });
  }
  if (options.browserPersistence === true) {
    context.refreshMeta = () => {};
    context.renderTree = () => {};
    context.refocusTreeNavigation = () => {};
    context.softlyEnsureSelectionVisible = () => {};
    context.repairVisibleSelectionAfterRender = () => {};
    context.setStatus = () => {};
    context.flashSaveChip = () => {};
    if (options.captureSessionTransitions === true) {
      const productionSetSession = context.setPocketFileSession;
      context.__sessionTransitions = [];
      context.setPocketFileSession = (...input) => {
        context.__sessionTransitions.push(plain(input[2] || {}));
        return productionSetSession(...input);
      };
    }
  }
  return context;
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createIndexedDb() {
  const records = new Map();
  let reads = 0;
  let beforeRead = null;
  let storeCreated = false;
  const store = {
    keyPath: "syncedPocketId", autoIncrement: false, indexNames: [],
    get(key) {
      const request = {};
      queueMicrotask(() => {
        reads += 1;
        request.result = beforeRead?.({ key, reads, value: records.get(key) }) ?? records.get(key);
        request.onsuccess?.();
      });
      return request;
    },
    getAll() { const request = {}; queueMicrotask(() => { request.result = [...records.values()]; request.onsuccess?.(); }); return request; },
    add(value) { if (records.has(value.syncedPocketId)) throw new Error("duplicate"); const request = {};
      queueMicrotask(() => { records.set(value.syncedPocketId, value); request.onsuccess?.(); }); return request; },
    put(value) { const request = {}; queueMicrotask(() => { records.set(value.syncedPocketId, value); request.onsuccess?.(); }); return request; },
  };
  const database = {
    version: 1, get objectStoreNames() { return storeCreated ? ["pockets"] : []; },
    createObjectStore(name, options) { if (name !== "pockets" || options?.keyPath !== "syncedPocketId") throw new Error("schema invalid"); storeCreated = true; return store; },
    transaction() { const transaction = { error: null, objectStore: () => store,
      abort() { queueMicrotask(() => transaction.onabort?.()); } }; setImmediate(() => transaction.oncomplete?.()); return transaction; },
    close() {}, onversionchange: null,
  };
  return { records, setBeforeRead(callback) { beforeRead = callback; },
    indexedDB: { open(name, version) { if (name !== "pocket.sync.device.v1" || version !== 1) throw new Error("database invalid");
      const request = { result: database, transaction: { abort() {} } };
      queueMicrotask(() => { if (!storeCreated) request.onupgradeneeded?.({ oldVersion: 0 }); request.onsuccess?.(); }); return request; } } };
}

async function createBrowserJourney(options = {}) {
  const a = loadProduction();
  const b = loadProduction({
    browserPersistence: options.browserPersistence === true,
    captureSessionTransitions: options.captureSessionTransitions === true,
    localStorageSeed: options.localStorageSeed,
  });
  const serviceDriver = createMemoryServiceStore();
  const origin = "https://sync.pocket.example";
  const now = Date.parse("2041-01-01T00:00:00.000Z");
  let serviceRandom = 0;
  const core = createServiceCore({
    store: serviceDriver.store,
    webAuthnVerifier: {
      async verifyRegistration(input) { return { credentialId: input.credential.id,
        publicKey: Buffer.from(bytes(64, 101)).toString("base64url"), publicKeyAlgorithm: -7,
        signCount: 0, transports: ["internal"], backupEligible: true, backedUp: false }; },
      async verifyAuthentication(input) { return { credentialId: input.credential.id,
        signCount: input.storedCredential.signCount + 1, backedUp: true }; },
    },
    recoveryProofVerifier: { async verifyRecoveryProof() { return { verified: true }; } },
    randomBytes(length) { serviceRandom += 1; return bytes(length, serviceRandom * 7); },
    now: () => now, trustedOrigin: origin, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
  });
  let aSessionId = null;
  let bSessionId = null;
  const remoteCalls = [];
  let serverDeviceInvalid = false;
  let failReadRevision = false;
  function transportFor(readSession, writeSession) { return Object.freeze({ async request(route, body) {
    remoteCalls.push({ route, body: plain(body) });
    if (failReadRevision && route === "readRevision") throw new Error("synthetic revision read failure");
    const response = await core[route]({ context: { method: "POST", origin, fetchSite: "same-origin",
      contentType: "application/json", sessionId: readSession() }, body: plain(body) });
    if (response.session?.action === "set") writeSession(response.session.sessionId);
    const responseBody = serverDeviceInvalid && route === "listEnvelopes"
      ? Object.assign({}, response.body, { envelopes: response.body.envelopes.filter((item) => item.envelopeKind !== "device") })
      : response.body;
    return { status: response.status, body: responseBody };
  } }); }
  const aTransport = transportFor(() => aSessionId, (value) => { aSessionId = value; });
  const bTransport = transportFor(() => bSessionId, (value) => { bSessionId = value; });
  const aRemote = a.PocketSyncRemoteClient;
  const aDeviceStore = a.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(createSharedDeviceStoreState()));
  let activationRandom = 0;
  const activateA = a.PocketSyncActivation.createActivationOrchestrator({
    securityContract: a.PocketSyncSecurityContract, crypto: a.PocketSyncCrypto, deviceStore: aDeviceStore,
    accountClient: a.PocketSyncAccountClient.createClient({
      accountService: aRemote.createAccountService({ transport: aTransport, now: () => now }),
      webAuthn: { async createCredential() { return fixtures.nativeRegistrationCredential(); }, async getCredential() {} }, now: () => now,
    }),
    contentService: aRemote.createContentService({ transport: aTransport }), envelopeService: aRemote.createEnvelopeService({ transport: aTransport }),
    recoveryService: aRemote.createRecoveryService({ transport: aTransport, now: () => now }),
    randomBytes(length) { activationRandom += 1; return bytes(length, 151 + activationRandom); }, now: () => now,
  });
  const source = Object.freeze({ ownerKind: "json", continuityId: "device-a-source" });
  const created = await activateA.activate({
    captureSourceSession: () => source, isSourceSessionCurrent: (value) => value === source,
    hasUnsavedSourceChanges: () => false, async saveLocalSource() { return { ok: true }; },
    async freezePayload() {
      if (options.browserPersistence === true) {
        const sentinel = options.remoteSentinel || "P052c readable Device A content";
        return {
          schema: "portal.export.v1",
          mainThoughtTree: [{ id: "p052h1-remote", label: sentinel, details: sentinel, children: [] }],
          mainThoughtTreeTombstones: [],
          data: { mainThoughtTree: [{ id: "p052h1-remote", label: sentinel, details: sentinel, children: [] }], mainThoughtTreeTombstones: [] },
        };
      }
      return { schema: "portal.export.v1", notes: [options.remoteSentinel || "P052c readable Device A content"] };
    },
    async prepareRecoveryCopyDestination() { return { ok: true, destination: { kind: "test" } }; },
    async buildRecoveryPackage(input) { return a.PocketSyncSecurityContract.buildRecoveryPackage({ ...plain(input), checksum: "p052c" }); },
    async writeRecoveryCopy() { return { ok: true }; }, async adoptSyncedOwner() { return { ok: true }; },
  }, { syncedPocketId: "pocket-p052c-browser", deviceId: "device-a-p052c" });
  assert.equal(created.ok, true, JSON.stringify(created));

  const idb = createIndexedDb();
  let ownerKind = options.ownerKind || "detached";
  let continuity = 61;
  let visible = null;
  let commits = 0;
  let detachedDirty = options.detachedDirty === true;
  let dirtyBeforeCommit = options.dirtyBeforeCommit === true;
  let targetChangesBeforeCommit = options.targetChangesBeforeCommit === true;
  let commitFails = options.commitFails === true;
  let installFails = options.installFails === true;
  let ownerAdoptionFailsAfterCommit = options.ownerAdoptionFailsAfterCommit === true;
  let prfUnavailable = false;
  let dirtySignalThrows = options.dirtySignalThrows === true;
  if (options.browserPersistence !== true) {
    b.capturePocketFileSaveSession = () => ({ id: continuity, ownerKind });
    b.isPocketFileSaveSessionCurrent = (session) => !!session && session.id === continuity && session.ownerKind === ownerKind;
    if (options.dirtySignalMissing !== true) {
      b.hasPocketUnsavedChanges = () => {
        if (dirtySignalThrows) throw new Error("synthetic dirty signal failure");
        return detachedDirty;
      };
    }
    b.setPocketFileSession = () => {
      if (installFails) throw new Error("synthetic boundary install failure");
      ownerKind = "synced"; continuity += 1;
    };
    b.isPocketPayloadShape = (payload) => payload?.schema === "portal.export.v1";
    b.normaliseInput = (payload) => payload;
    b.commitPreparedPocketDocument = (payload, _metadata, guard) => {
      commits += 1;
      if (dirtyBeforeCommit) detachedDirty = true;
      if (targetChangesBeforeCommit) continuity += 1;
      if (ownerAdoptionFailsAfterCommit) {
        idb.setBeforeRead(({ value }) => value && Object.assign({}, value, {
          content: Object.assign({}, value.content, { context: Object.assign({}, value.content.context, { revision: 99 }) }),
        }));
      }
      if (commitFails || guard.canContinue() !== true) return { ok: false };
      visible = plain(payload);
      return { ok: true };
    };
  }
  const bRemote = b.PocketSyncRemoteClient;
  const environment = {
    crypto: webcrypto, indexedDB: idb.indexedDB, now: () => now,
    navigator: { credentials: { async create() { throw new Error("not used"); },
      async get() {
        if (!prfUnavailable) return fixtures.nativeAuthenticationCredential();
        const credential = fixtures.nativeAuthenticationCredential();
        return { getClientExtensionResults() { return {}; }, toJSON() {
          const json = credential.toJSON(); json.clientExtensionResults = {}; return json;
        } };
      } } },
  };
  const runtime = b.PocketSyncBrowserRuntime.createRuntime({
    accountService: bRemote.createAccountService({ transport: bTransport, now: () => now }),
    contentService: bRemote.createContentService({ transport: bTransport }), envelopeService: bRemote.createEnvelopeService({ transport: bTransport }),
    recoveryService: bRemote.createRecoveryService({ transport: bTransport, now: () => now }),
    discoveryService: bRemote.createPocketDiscoveryService({ transport: bTransport }), environment,
  });
  const opened = await runtime.openExisting();
  return { b, core, idb, opened, remoteCalls, runtime, serviceDriver,
    readRemoteRevision: () => bRemote.createContentService({ transport: bTransport }).readRevision({
      apiVersion: 1, operationId: "p052h2-read-revision", syncedPocketId: "pocket-p052c-browser",
    }),
    openExisting: () => runtime.openExisting(), clearFaults() { targetChangesBeforeCommit = false; commitFails = false;
      installFails = false; ownerAdoptionFailsAfterCommit = false; idb.setBeforeRead(null); }, setPrfUnavailable(value) { prfUnavailable = value === true; },
    setDetachedDirty(value) { detachedDirty = value === true; }, setDirtyBeforeCommit(value) { dirtyBeforeCommit = value === true; },
    setDirtySignalThrows(value) { dirtySignalThrows = value === true; },
    setReadRevisionFailure(value) { failReadRevision = value === true; },
    setServerDeviceInvalid(value) { serverDeviceInvalid = value === true; },
    get ownerKind() { return options.browserPersistence === true ? b.capturePocketFileSaveSession().ownerKind : ownerKind; },
    get visible() { return options.browserPersistence === true ? plain(vm.runInContext("state.nodes", b)) : visible; },
    get commits() { return commits; } };
}

test("P052 remains dormant until explicitly created and a new device without PRF requires recovery before mutation", async () => {
  const calls = [];
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/pocket-sync-additional-device.js"), "utf8"), context);
  assert.deepEqual(calls, []);
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: { FORMAT: { contentType: "portal.export.v1+json" }, generateDeviceWrappingKey() {}, deriveWrappingKey() {}, openMasterKeyBundle() {}, openContent() {}, sealContent() {}, encodeBase64Url() { return "opaque"; }, validateNonExtractableAesKey() {} },
    deviceStore: { open() {}, readPocket() {}, createPocket() {}, replacePocket() {} },
    accountClient: { async authenticatePasskey() { calls.push("authenticate"); return { ok: true, accountAuthenticated: true, contentUnlocked: false, accountId: "account", credentialId: "credential", prf: { status: "unavailable" } }; } },
    discoveryService: { async readSyncedPocket() { calls.push("discovery"); return { status: "ready", syncedPocketId: "pocket" }; } },
    contentService: { async readRevision() {}, async downloadEncryptedRecord() {} },
    envelopeService: { async listEnvelopes() {}, async downloadEnvelope() {}, async addEnvelope() { calls.push("add"); } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0,
  });
  const result = await opener.openExisting({
    captureTarget: () => ({ ownerKind: "none", id: 1 }), isTargetCurrent: () => true,
    validatePayload: () => true, adoptOpenedPocket: async () => true,
  });
  assert.equal(result.reason, "recovery-required");
  assert.deepEqual(calls, ["authenticate", "discovery"]);
});

test("P052a opens a real P029 content record with its authenticated content context and continues from device B's envelope", async () => {
  const context = loadProduction();
  const crypto = context.PocketSyncCrypto;
  const syncedPocketId = "pocket-p052a-real";
  const credentialId = "credential-p052a-real";
  const prf = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
  const prfContext = { syncedPocketId, envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1 };
  const salt = Uint8Array.from({ length: 32 }, (_value, index) => index + 41);
  const prfWrappingKey = await crypto.deriveWrappingKey(prf, Buffer.from(salt).toString("base64url"), prfContext);
  const original = await crypto.createMasterKeyBundle([{ context: prfContext, wrappingKey: prfWrappingKey }]);
  const payload = { schema: "portal.export.v1", thoughts: ["P052a real encrypted content"] };
  const contentContext = { syncedPocketId, revision: 1, contentType: crypto.FORMAT.contentType };
  const encryptedRecord = await crypto.sealContent(payload, original.masterKey, contentContext);
  const store = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver());
  let randomCounter = 1;
  let added = null;
  const transientMasterKeys = new Set();
  let masterKeyBundleCalls = 0;
  let initialMasterKeyWasUsed = false;
  const openerCrypto = Object.freeze({ ...crypto,
    async openMasterKeyBundle(...input) {
      const bundle = await crypto.openMasterKeyBundle(...input);
      masterKeyBundleCalls += 1;
      if (masterKeyBundleCalls === 1) transientMasterKeys.add(bundle.masterKey);
      return bundle;
    },
    async openContent(record, key, content) {
      if (transientMasterKeys.has(key)) {
        if (initialMasterKeyWasUsed) throw new Error("discarded initial PRF master key");
        initialMasterKeyWasUsed = true;
      }
      return crypto.openContent(record, key, content);
    },
  });
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: openerCrypto,
    deviceStore: { open: () => store.open(), readPocket: (value) => store.readPocket(value),
      createPocket: async (value) => { try { return await store.createPocket(value); }
        catch (error) { throw new Error(`create:${error.code}`); } },
      replacePocket: (id, revision, value) => store.replacePocket(id, revision, value) },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
      contentUnlocked: false, accountId: "account-p052a-real", credentialId,
      prf: { status: "available", outputBytes: Uint8Array.from(prf) } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId }; } },
    contentService: { async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() { return { syncedPocketId, revision: 1, encryptedRecord }; } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
      envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1,
      deviceId: null, credentialId, kdf: "HKDF-SHA-256", kdfSalt: Buffer.from(salt).toString("base64url"), derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
        envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId, kdf: "HKDF-SHA-256",
        kdfSalt: Buffer.from(salt).toString("base64url"), derivationVersion: 1, encryptedEnvelope: original.envelopes[0].record } }; },
      async addEnvelope(request) { added = request; return { status: "committed", keySetVersion: 2,
        masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; } },
    randomBytes(length) { const value = new Uint8Array(length); value.fill(randomCounter++); return value; },
    now: () => Date.parse("2035-01-01T00:00:00.000Z"),
  });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: 7 }),
    isTargetCurrent: () => true, validatePayload: (value) => value?.schema === "portal.export.v1",
    adoptOpenedPocket: async ({ masterKey, payload: received }) => {
      assert.deepEqual(received, payload);
      await crypto.openContent(encryptedRecord, masterKey, contentContext);
      return true;
    } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(added.attemptKind, "new-change");
  const record = await store.readPocket(syncedPocketId);
  assert.equal(record.usage.deviceWrappingKeyEncryptions, 2);
  assert.equal(record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const durable = await crypto.openMasterKeyBundle(record.deviceEnvelope.record,
    record.deviceWrappingKey, record.deviceEnvelope.context, []);
  assert.deepEqual(await crypto.openContent(record.content.record, durable.masterKey, record.content.context), payload);
});

test("P052a replays an ambiguous durable device-envelope mutation exactly once", async () => {
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context);
  let next = 0;
  const calls = [];
  let record = null;
  let createCount = 0;
  let failGrantPersistence = true;
  const masterKey = { key: "master" };
  const crypto = {
    FORMAT: { contentType: "portal.export.v1+json" },
    encodeBase64Url() { next += 1; return `id-${next}`; }, randomBytes() { return new Uint8Array(32); },
    async generateDeviceWrappingKey() { return { key: "device" }; },
    async deriveWrappingKey() { return { key: "prf" }; },
    validateNonExtractableAesKey() {},
    async openMasterKeyBundle(_record, _key, _context, plans) {
      return { masterKey, envelopes: plans.map((plan) => ({ context: plan.context, record: { wrapped: plan.context.envelopeId } })) };
    },
    async openContent(value) { return value.value || value; },
    async sealContent(value) { return { value }; },
  };
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto,
    deviceStore: { async open() {}, async readPocket() { return record; },
      async createPocket(value) { createCount += 1; record = value; return value; },
      async replacePocket(_id, _revision, value) {
        if (failGrantPersistence) { failGrantPersistence = false; throw new Error("local persistence unavailable"); }
        record = value; return value;
      } },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
      contentUnlocked: false, accountId: "account", credentialId: "credential",
      prf: { status: "available", outputBytes: new Uint8Array(32) } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId: "pocket" }; } },
    contentService: { async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() { return { syncedPocketId: "pocket", revision: 1,
        encryptedRecord: { value: { schema: "portal.export.v1" } } }; } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
      envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null,
      credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf",
        envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential",
        kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, encryptedEnvelope: { wrapped: "prf" } } }; },
      async addEnvelope(request) { calls.push(request); return { status: "committed", keySetVersion: 2,
        masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0,
  });
  const dependencies = { captureTarget: () => ({ ownerKind: "detached", id: "target" }),
    isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true };
  assert.equal((await opener.openExisting(dependencies)).reason, "additional-device-open-failed");
  const staged = record;
  assert.notEqual(staged, null);
  assert.equal((await opener.openExisting(dependencies)).ok, true);
  assert.equal(createCount, 1);
  assert.deepEqual(calls.map((request) => request.attemptKind), ["new-change", "idempotent-retry"]);
  assert.equal(calls[0].operationId, calls[1].operationId);
  assert.equal(calls[0].logicalChangeId, calls[1].logicalChangeId);
  assert.deepEqual(calls[0].envelope, calls[1].envelope);
  assert.equal(record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
});

test("P052b maps a wrong real P029 PRF unlock to recovery-required before device mutation", async () => {
  const context = loadProduction();
  const crypto = context.PocketSyncCrypto;
  const syncedPocketId = "pocket-p052b-prf";
  const prfContext = { syncedPocketId, envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1 };
  const correctPrf = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
  const wrongPrf = Uint8Array.from({ length: 32 }, (_value, index) => index + 71);
  const salt = Buffer.from(Uint8Array.from({ length: 32 }, (_value, index) => index + 31)).toString("base64url");
  const key = await crypto.deriveWrappingKey(correctPrf, salt, prfContext);
  const bundle = await crypto.createMasterKeyBundle([{ context: prfContext, wrappingKey: key }]);
  let mutations = 0;
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto,
    deviceStore: { async open() {}, async readPocket() { return null; }, async createPocket() { mutations += 1; }, async replacePocket() { mutations += 1; } },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
      contentUnlocked: false, accountId: "account-p052b-prf", credentialId: "credential-p052b-prf",
      prf: { status: "available", outputBytes: wrongPrf } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId }; } },
    contentService: { async readRevision() { throw new Error("must not read content"); }, async downloadEncryptedRecord() { throw new Error("must not download"); } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
      envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null,
      credentialId: "credential-p052b-prf", kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
        envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential-p052b-prf",
        kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, encryptedEnvelope: bundle.envelopes[0].record } }; },
      async addEnvelope() { mutations += 1; } },
    randomBytes(length) { return new Uint8Array(length); }, now: () => 0,
  });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: "prf" }),
    isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
  assert.equal(result.reason, "recovery-required");
  assert.equal(mutations, 0);
});

test("P052c keeps tampered PRF envelopes recoverable but local derivation failures local", async () => {
  const context = loadProduction();
  const crypto = context.PocketSyncCrypto;
  const syncedPocketId = "pocket-p052c-prf";
  const credentialId = "credential-p052c-prf";
  const prfContext = { syncedPocketId, envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1 };
  const prf = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
  const salt = Buffer.from(Uint8Array.from({ length: 32 }, (_value, index) => index + 41)).toString("base64url");
  const wrappingKey = await crypto.deriveWrappingKey(prf, salt, prfContext);
  const bundle = await crypto.createMasterKeyBundle([{ context: prfContext, wrappingKey }]);
  async function openWith(cryptoInput, encryptedEnvelope) {
    let mutations = 0;
    const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
      crypto: cryptoInput,
      deviceStore: { async open() {}, async readPocket() { return null; }, async createPocket() { mutations += 1; }, async replacePocket() { mutations += 1; } },
      accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
        contentUnlocked: false, accountId: "account-p052c-prf", credentialId,
        prf: { status: "available", outputBytes: Uint8Array.from(prf) } }; } },
      discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId }; } },
      contentService: { async readRevision() { throw new Error("must not read content"); }, async downloadEncryptedRecord() { throw new Error("must not download"); } },
      envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{
        envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId, kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, status: "active" }] }; },
        async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
          envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId, kdf: "HKDF-SHA-256", kdfSalt: salt, derivationVersion: 1, encryptedEnvelope } }; },
        async addEnvelope() { mutations += 1; } },
      randomBytes(length) { return new Uint8Array(length); }, now: () => 0,
    });
    const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: "prf" }),
      isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
    return { result, mutations };
  }
  const tampered = Object.assign({}, bundle.envelopes[0].record, {
    ciphertext: `${bundle.envelopes[0].record.ciphertext[0] === "A" ? "B" : "A"}${bundle.envelopes[0].record.ciphertext.slice(1)}`,
  });
  const tamperedResult = await openWith(crypto, tampered);
  assert.equal(tamperedResult.result.reason, "recovery-required");
  assert.equal(tamperedResult.mutations, 0);
  const localCrypto = Object.freeze({ ...crypto, async deriveWrappingKey() {
    const error = new Error("synthetic local derivation failure"); error.code = "wrapping-key-derivation-failed"; throw error;
  } });
  const localResult = await openWith(localCrypto, bundle.envelopes[0].record);
  assert.equal(localResult.result.reason, "additional-device-open-failed");
  assert.equal(localResult.result.reason === "recovery-required", false);
  assert.equal(localResult.mutations, 0);
});

test("P052b preserves a reviewed irreversible adoption partial state", async () => {
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context);
  const masterKey = {};
  const crypto = { FORMAT: { contentType: "portal.export.v1+json" }, encodeBase64Url: () => "id",
    async generateDeviceWrappingKey() { return {}; }, async deriveWrappingKey() { return {}; },
    validateNonExtractableAesKey() {}, async sealContent(value) { return { value }; },
    async openContent(value) { return value.value || { schema: "portal.export.v1" }; },
    async openMasterKeyBundle(_record, _key, _context, plans) { return { masterKey,
      envelopes: plans.map((plan) => ({ context: plan.context, record: { value: {} } })) }; } };
  let record = null;
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({ crypto,
    deviceStore: { async open() {}, async readPocket() { return record; }, async createPocket(value) { record = value; },
      async replacePocket(_id, _revision, value) { record = value; return value; } },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true, contentUnlocked: false,
      accountId: "account", credentialId: "credential", prf: { status: "available", outputBytes: new Uint8Array(32) } }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId: "pocket" }; } },
    contentService: { async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() { return { syncedPocketId: "pocket", revision: 1, encryptedRecord: { value: { schema: "portal.export.v1" } } }; } },
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{ envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, deviceId: null, credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt", derivationVersion: 1, encryptedEnvelope: {} } }; },
      async addEnvelope() { return { status: "committed", keySetVersion: 2, masterKeyGeneration: 1, masterKeyContentEncryptionLimit: 2 ** 20 }; } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0 });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: "partial" }),
    isTargetCurrent: () => true, validatePayload: () => true,
    adoptOpenedPocket: async () => ({ ok: false, partialState: "visible-payload-committed-detached" }) });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, reason: "owner-adoption-failed", adopted: false,
    partialState: "visible-payload-committed-detached" });
});

test("P052b accepts a production Device A activation, Device B adoption and ordinary Device B Save", async () => {
  const context = loadProduction();
  const serviceDriver = createMemoryServiceStore();
  const origin = "https://sync.pocket.example";
  const now = Date.parse("2040-01-01T00:00:00.000Z");
  let random = 0;
  const core = createServiceCore({
    store: serviceDriver.store,
    webAuthnVerifier: {
      async verifyRegistration(input) { return { credentialId: input.credential.id,
        publicKey: Buffer.from(bytes(64, 91)).toString("base64url"), publicKeyAlgorithm: -7,
        signCount: 0, transports: ["internal"], backupEligible: true, backedUp: false }; },
      async verifyAuthentication(input) { return { credentialId: input.credential.id,
        signCount: input.storedCredential.signCount + 1, backedUp: true }; },
    },
    recoveryProofVerifier: { async verifyRecoveryProof() { return { verified: true }; } },
    randomBytes(length) { random += 1; return bytes(length, random * 9); },
    now: () => now, trustedOrigin: origin, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
  });
  let sessionId = null;
  const routes = [];
  const transport = Object.freeze({ async request(route, body) {
    routes.push(route);
    const response = await core[route]({ context: { method: "POST", origin, fetchSite: "same-origin",
      contentType: "application/json", sessionId }, body: plain(body) });
    if (response.session?.action === "set") sessionId = response.session.sessionId;
    return { status: response.status, body: response.body };
  } });
  const accountService = context.PocketSyncRemoteClient.createAccountService({ transport, now: () => now });
  const contentService = context.PocketSyncRemoteClient.createContentService({ transport });
  const envelopeService = context.PocketSyncRemoteClient.createEnvelopeService({ transport });
  const discoveryService = context.PocketSyncRemoteClient.createPocketDiscoveryService({ transport });
  const recoveryService = context.PocketSyncRemoteClient.createRecoveryService({ transport, now: () => now });
  const aStore = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(createSharedDeviceStoreState()));
  let activationRandom = 0;
  const activation = context.PocketSyncActivation.createActivationOrchestrator({
    securityContract: context.PocketSyncSecurityContract, crypto: context.PocketSyncCrypto,
    deviceStore: aStore,
    accountClient: context.PocketSyncAccountClient.createClient({ accountService,
      webAuthn: { async createCredential() { return fixtures.nativeRegistrationCredential(); }, async getCredential() {} }, now: () => now }),
    contentService, envelopeService, recoveryService,
    randomBytes(length) { activationRandom += 1; return bytes(length, 181 + activationRandom); }, now: () => now,
  });
  const sourceTarget = Object.freeze({ ownerKind: "json", continuityId: "source-a" });
  const activated = await activation.activate({
    captureSourceSession: () => sourceTarget, isSourceSessionCurrent: (value) => value === sourceTarget,
    hasUnsavedSourceChanges: () => false, async saveLocalSource() { return { ok: true }; },
    async freezePayload() { return { schema: "portal.export.v1", notes: ["Device A initial content"] }; },
    async prepareRecoveryCopyDestination() { return { ok: true, destination: { kind: "test" } }; },
    async buildRecoveryPackage(input) { return context.PocketSyncSecurityContract.buildRecoveryPackage({ ...plain(input), checksum: "p052b" }); },
    async writeRecoveryCopy() { return { ok: true }; }, async adoptSyncedOwner() { return { ok: true }; },
  }, { syncedPocketId: "pocket-p052b-acceptance", deviceId: "device-a-p052b" });
  assert.equal(activated.ok, true, JSON.stringify(activated));

  const bStore = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(createSharedDeviceStoreState()));
  let ownerRandom = 0;
  const bOwner = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto: context.PocketSyncCrypto, deviceStore: bStore, contentService,
    randomBytes(length) { ownerRandom += 1; return bytes(length, 211 + ownerRandom); },
  });
  let bRandom = 0;
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: context.PocketSyncCrypto, deviceStore: bStore,
    accountClient: context.PocketSyncAccountClient.createClient({ accountService,
      webAuthn: { async createCredential() {}, async getCredential() { return fixtures.nativeAuthenticationCredential(); } }, now: () => now }),
    discoveryService, contentService, envelopeService,
    randomBytes(length) { bRandom += 1; return bytes(length, 231 + bRandom); }, now: () => now,
  });
  const bTarget = Object.freeze({ ownerKind: "detached", id: "device-b-view" });
  let visible = null;
  const opened = await opener.openExisting({ captureTarget: () => bTarget, isTargetCurrent: () => true,
    validatePayload: (payload) => payload?.schema === "portal.export.v1",
    async adoptOpenedPocket(input) {
      visible = input.payload;
      return bOwner.adoptSyncedOwner({ syncedPocketId: input.syncedPocketId, masterKey: input.masterKey });
    },
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.deepEqual(plain(visible), { schema: "portal.export.v1", notes: ["Device A initial content"] });
  const saved = await bOwner.saveSyncedOwner({ async freezePayload() {
    return { schema: "portal.export.v1", notes: ["Device B ordinary Save"] };
  } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.confirmedRemoteRevision, 2);
  assert.deepEqual(plain((await bOwner.getSyncedOwnerState())), {
    syncedPocketId: "pocket-p052b-acceptance", confirmedRemoteRevision: 2,
    knownRemoteRevision: 2, pending: false, generation: 1,
  });
  const remoteText = JSON.stringify(serviceDriver.snapshot());
  assert.doesNotMatch(remoteText, /Device A initial content|Device B ordinary Save/);
  assert.deepEqual(routes.filter((route) => route === "conditionalUpload"), ["conditionalUpload", "conditionalUpload"]);
});

test("P052c public browser Device B adoption joins visible truth, owner authority and boundary Save", async () => {
  const journey = await createBrowserJourney();
  assert.deepEqual(plain(journey.opened), {
    ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1,
  });
  const authentications = journey.remoteCalls.filter((call) => call.route === "beginAuthentication");
  assert.equal(authentications.length, 2);
  assert.deepEqual(Object.keys(authentications[0].body).sort(), ["apiVersion", "operationId"]);
  assert.equal(authentications[1].body.accountLocator, undefined);
  const finishIndex = journey.remoteCalls.findIndex((call) => call.route === "finishAuthentication");
  assert.ok(finishIndex >= 0);
  assert.ok(journey.remoteCalls.findIndex((call, index) => index > finishIndex
    && call.route === "beginAuthentication") > finishIndex);
  assert.deepEqual(journey.visible, { schema: "portal.export.v1", notes: ["P052c readable Device A content"] });
  assert.equal(journey.commits, 1);
  assert.equal(journey.ownerKind, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  const before = [...journey.idb.records.values()][0];
  assert.equal(before.schemaVersion, 5);
  assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const addCalls = journey.remoteCalls.filter((call) => call.route === "addEnvelope");
  assert.equal(addCalls.length, 3);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052c Device B boundary Save"] }; },
  });
  assert.deepEqual(plain(saved), {
    ownerKind: "synced", target: "synced", ok: true, reason: "saved", confirmedRemoteRevision: 2,
  });
  const after = [...journey.idb.records.values()][0];
  assert.equal(after.usage.masterKeyContentEncryptions, before.usage.masterKeyContentEncryptions + 1);
  assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 3);
  const remoteText = JSON.stringify(journey.serviceDriver.snapshot());
  const requests = JSON.stringify(journey.remoteCalls);
  assert.doesNotMatch(remoteText, /P052c readable Device A content|P052c Device B boundary Save|"masterKey":|"deviceWrappingKey":/);
  assert.doesNotMatch(requests, /P052c readable Device A content|P052c Device B boundary Save/);
  assert.deepEqual(Object.keys(plain(journey.opened)), ["ok", "reason", "confirmedRemoteRevision"]);
});

test("P052h1 public Device B adoption uses production browser storage privacy through ordinary Save", async () => {
  const legacySentinel = "P052H1 LEGACY JSON SAFETY";
  const remoteSentinel = "P052H1 REMOTE SENTINEL";
  const editedSentinel = "P052H1 EDITED SENTINEL";
  const legacySafetyRaw = JSON.stringify({
    schema: "pocket.localSafety.v1",
    capturedAt: "2040-01-01T00:00:00.000Z",
    reason: "ordinary-json-change",
    source: { schema: "portal.export.v1", fileName: "ordinary.json", writtenAt: "2040-01-01T00:00:00.000Z" },
    selectedId: "legacy-node",
    focusRootId: "",
    collapsedIds: [],
    ops: [],
    operationHighWater: 0,
    payload: {
      schema: "portal.export.v1",
      mainThoughtTree: [{ id: "legacy-node", label: legacySentinel, details: legacySentinel, children: [] }],
      mainThoughtTreeTombstones: [],
      data: { mainThoughtTree: [{ id: "legacy-node", label: legacySentinel, details: legacySentinel, children: [] }], mainThoughtTreeTombstones: [] },
    },
  });
  const legacyProbe = loadProduction({ browserPersistence: true,
    localStorageSeed: { "pocketLite.localSafety.snapshot.v1": legacySafetyRaw } });
  assert.equal(legacyProbe.readLocalSafetySnapshot().norm.nodes[0].label, legacySentinel);
  const journey = await createBrowserJourney({
    browserPersistence: true,
    captureSessionTransitions: true,
    remoteSentinel,
    localStorageSeed: {
      "pocketLite.localSafety.snapshot.v1": legacySafetyRaw,
      "pocketLite.localSafety.trail.v1": legacySentinel,
      "pocketLite.pipSnapshot.v1": legacySentinel,
      "pocketLite.autoCache.v1": legacySentinel,
    },
  });
  assert.equal(journey.opened.ok, true, JSON.stringify(journey.opened));
  assert.equal(journey.ownerKind, "synced");
  assert.deepEqual(plain(journey.b.capturePocketFileSaveSession()).storagePrivacy, "synced");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(journey.b.__sessionTransitions.filter((entry) => entry.ownerKind === "synced").length, 1);
  assert.equal(journey.visible.some((node) => node.label === remoteSentinel), true);
  assert.equal(JSON.stringify(journey.visible).includes(legacySentinel), false);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.localSafety.snapshot.v1"), legacySafetyRaw);
  assert.equal(journey.b.clearLocalSafetySnapshot(), false);
  assert.equal(journey.b.__pocketLiteExportSessionState(), null);
  let popupCalls = 0;
  journey.b.open = () => { popupCalls += 1; return null; };
  await journey.b.openPipWindow();
  assert.equal(popupCalls, 0);
  const grantsBeforeSave = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  const state = vm.runInContext("state", journey.b);
  state.nodes.push({ id: "p052h1-edit", label: editedSentinel, children: [] });
  journey.b.recordOp({ type: "p052h1-edit", id: "p052h1-edit", changed: editedSentinel });
  const saved = await journey.b.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.reason, "synced-save");
  const remoteRevision = await journey.readRemoteRevision();
  assert.equal(remoteRevision.recordPresent, true);
  assert.equal(remoteRevision.revision, 2);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantsBeforeSave);
  const writes = JSON.stringify(journey.b.__localStorage.calls);
  assert.equal(writes.includes(remoteSentinel), false);
  assert.equal(writes.includes(editedSentinel), false);
  assert.doesNotMatch(writes, /masterKey|deviceWrappingKey|prf|recovery/i);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.localSafety.snapshot.v1"), legacySafetyRaw);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.localSafety.trail.v1"), legacySentinel);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.pipSnapshot.v1"), legacySentinel);
  assert.equal(journey.b.__localStorage.values.get("pocketLite.autoCache.v1"), legacySentinel);
});

test("P052c production browser adoption keeps visible truth and authority coherent across final transition failures", async () => {
  const targetChanged = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(targetChanged.opened.ok, false);
  assert.equal(targetChanged.visible, null);
  assert.equal(targetChanged.ownerKind, "detached");
  assert.equal(targetChanged.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);

  const commitFailed = await createBrowserJourney({ commitFails: true });
  assert.equal(commitFailed.opened.ok, false);
  assert.equal(commitFailed.visible, null);
  assert.equal(commitFailed.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);

  const adoptionFailed = await createBrowserJourney({ ownerAdoptionFailsAfterCommit: true });
  assert.deepEqual(plain(adoptionFailed.opened), {
    ok: false, reason: "owner-adoption-failed", adopted: false,
    partialState: "visible-payload-committed-detached",
  });
  assert.notEqual(adoptionFailed.visible, null);
  assert.equal(adoptionFailed.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);

  const installFailed = await createBrowserJourney({ installFails: true });
  assert.deepEqual(plain(installFailed.opened), {
    ok: false, reason: "owner-adoption-failed", adopted: false,
    partialState: "visible-payload-committed-detached",
  });
  assert.notEqual(installFailed.visible, null);
  assert.equal(installFailed.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
});

test("P052d resumes completed Device B enrolment after post-grant browser failures without another grant", async () => {
  for (const [name, options] of Object.entries({
    target: { targetChangesBeforeCommit: true }, commit: { commitFails: true },
    adoption: { ownerAdoptionFailsAfterCommit: true }, install: { installFails: true },
  })) {
    const journey = await createBrowserJourney(options);
    assert.equal(journey.opened.ok, false, name);
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false, name);
    const before = [...journey.idb.records.values()][0];
    assert.equal(before.additionalDeviceDraft, null, name);
    assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20, name);
    const metadata = plain(before.deviceEnvelope.metadata);
    const grantCalls = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
    journey.clearFaults();
    const retry = await journey.openExisting();
    assert.deepEqual(plain(retry), { ok: true, reason: "synced-pocket-opened", confirmedRemoteRevision: 1 }, name);
    const after = [...journey.idb.records.values()][0];
    assert.deepEqual(plain(after.deviceEnvelope.metadata), metadata, name);
    assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20, name);
    assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grantCalls, name);
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true, name);
    const saved = await journey.b.PocketOwnerSaveBoundary.save({
      expectedSession: journey.b.capturePocketFileSaveSession(),
      async freezePayload() { return { schema: "portal.export.v1", notes: [`P052d ${name} retry Save`] }; },
    });
    assert.equal(saved.ok, true, name);
    assert.equal(saved.confirmedRemoteRevision, 2, name);
  }
});

test("P052f retries a completed Device B owner-eligibility failure without another grant", async () => {
  const journey = await createBrowserJourney({ commitFails: true });
  assert.equal(journey.opened.ok, false);
  assert.equal(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  const [before] = [...journey.idb.records.values()];
  assert.equal(before.additionalDeviceDraft, null);
  assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const deviceId = before.deviceId;
  const metadata = plain(before.deviceEnvelope.metadata);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  let completedReadSeen = false;
  journey.idb.setBeforeRead(({ value }) => {
    if (!completedReadSeen) { completedReadSeen = true; return value; }
    return value && Object.assign({}, value, {
      content: Object.assign({}, value.content, { context: Object.assign({}, value.content.context, { revision: 99 }) }),
    });
  });
  const rejected = await journey.openExisting();
  assert.equal(rejected.reason, "owner-adoption-failed");
  assert.equal(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  journey.idb.setBeforeRead(null);
  assert.equal((await journey.openExisting()).ok, true);
  const after = [...journey.idb.records.values()][0];
  assert.equal(after.deviceId, deviceId);
  assert.deepEqual(plain(after.deviceEnvelope.metadata), metadata);
  assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052f completed retry Save"] }; },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.confirmedRemoteRevision, 2);
});

test("P052e refuses a dirty detached target before any Device B mutation", async () => {
  const journey = await createBrowserJourney({ detachedDirty: true });
  assert.equal(journey.opened.reason, "additional-device-target-dirty");
  assert.equal(journey.visible, null);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.idb.records.size, 0);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 2);
});

test("P052g retries a Device B completed while detached truth became dirty during onboarding", async () => {
  const journey = await createBrowserJourney({ dirtyBeforeCommit: true });
  assert.equal(journey.opened.reason, "additional-device-target-dirty");
  assert.equal(journey.visible, null);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  const [before] = [...journey.idb.records.values()];
  assert.equal(before.kind, "pocket.sync.device-state");
  assert.equal(before.schemaVersion, 5);
  assert.equal(before.additionalDeviceDraft, null);
  assert.equal(before.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  const deviceId = before.deviceId;
  const metadata = plain(before.deviceEnvelope.metadata);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setDirtyBeforeCommit(false);
  journey.setDetachedDirty(false);
  const retry = await journey.openExisting();
  assert.equal(retry.ok, true, JSON.stringify(retry));
  const [after] = [...journey.idb.records.values()];
  assert.equal(after.deviceId, deviceId);
  assert.deepEqual(plain(after.deviceEnvelope.metadata), metadata);
  assert.equal(after.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  assert.notEqual(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052g dirty transition retry Save"] }; },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.confirmedRemoteRevision, 2);
});

test("P052f reports a changing detached session as stale rather than dirty", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.reason, "additional-device-target-stale");
  assert.equal(journey.visible, null);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
});

test("P052f fails closed when the detached dirty-state signal is unavailable", async () => {
  for (const options of [{ dirtySignalMissing: true }, { dirtySignalThrows: true }]) {
    const journey = await createBrowserJourney(options);
    assert.equal(journey.opened.reason, "additional-device-target-dirty");
    assert.equal(journey.visible, null);
    assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
    assert.equal(journey.idb.records.size, 0);
    assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, 2);
  }
});

test("P052f keeps a none target on the public adoption and boundary Save path", async () => {
  const journey = await createBrowserJourney({ ownerKind: "none" });
  assert.equal(journey.opened.ok, true, JSON.stringify(journey.opened));
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  const saved = await journey.b.PocketOwnerSaveBoundary.save({
    expectedSession: journey.b.capturePocketFileSaveSession(),
    async freezePayload() { return { schema: "portal.export.v1", notes: ["P052f none target Save"] }; },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.confirmedRemoteRevision, 2);
});

test("P052e preserves a dirty detached partial retry without another Device B grant", async () => {
  const journey = await createBrowserJourney({ installFails: true });
  assert.equal(journey.opened.ok, false);
  const visible = plain(journey.visible);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setDetachedDirty(true);
  const retry = await journey.openExisting();
  assert.equal(retry.reason, "additional-device-target-dirty");
  assert.deepEqual(plain(journey.visible), visible);
  assert.equal(journey.ownerKind, "detached");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052e permits an explicit clean retry after a transient completed-state reopen failure", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setReadRevisionFailure(true);
  assert.equal((await journey.openExisting()).reason, "additional-device-open-failed");
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  journey.setReadRevisionFailure(false);
  assert.equal((await journey.openExisting()).ok, true);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052e rejects malformed completed local state without replacement identifiers", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  const [record] = [...journey.idb.records.values()];
  journey.idb.records.set(record.syncedPocketId, Object.assign({}, record, {
    content: Object.assign({}, record.content, { context: Object.assign({}, record.content.context, { revision: "invalid" }) }),
  }));
  journey.clearFaults();
  const rejected = await journey.openExisting();
  assert.equal(rejected.reason, "additional-device-state-invalid");
  assert.equal(journey.visible, null);
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052d reopens an enrolled Device B without PRF output but keeps new devices recoverable", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setPrfUnavailable(true);
  const retry = await journey.openExisting();
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
});

test("P052d refuses a completed Device B whose active server envelope disappeared", async () => {
  const journey = await createBrowserJourney({ targetChangesBeforeCommit: true });
  assert.equal(journey.opened.ok, false);
  const grants = journey.remoteCalls.filter((call) => call.route === "addEnvelope").length;
  journey.clearFaults();
  journey.setServerDeviceInvalid(true);
  const rejected = await journey.openExisting();
  assert.equal(rejected.reason, "remote-device-state-invalid");
  assert.equal(journey.b.PocketOwnerSaveBoundary.hasSyncedOwner(), false);
  assert.equal(journey.remoteCalls.filter((call) => call.route === "addEnvelope").length, grants);
  journey.setServerDeviceInvalid(false);
  assert.equal((await journey.openExisting()).ok, true);
});

test("P052d rejects listed/downloaded PRF metadata drift before Device B mutation", async () => {
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context);
  for (const changed of ["envelopeVersion", "kdfSalt", "derivationVersion"]) {
    let mutations = 0;
    const listed = { envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1,
      deviceId: null, credentialId: "credential", kdf: "HKDF-SHA-256", kdfSalt: "salt-a", derivationVersion: 1, status: "active" };
    const downloaded = Object.assign({}, listed, { kdfSalt: "salt-a", encryptedEnvelope: {} },
      changed === "envelopeVersion" ? { envelopeVersion: 2 }
        : (changed === "kdfSalt" ? { kdfSalt: "salt-b" } : { derivationVersion: 2 }));
    const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
      crypto: { FORMAT: { contentType: "portal.export.v1+json" }, encodeBase64Url: () => "id",
        async generateDeviceWrappingKey() {}, async deriveWrappingKey() {}, async openMasterKeyBundle() {},
        async openContent() {}, async sealContent() {}, validateNonExtractableAesKey() {} },
      deviceStore: { async open() {}, async readPocket() { return null; }, async createPocket() { mutations += 1; }, async replacePocket() { mutations += 1; } },
      accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
        contentUnlocked: false, accountId: "account", credentialId: "credential",
        prf: { status: "available", outputBytes: new Uint8Array(32) } }; } },
      discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId: "pocket" }; } },
      contentService: { async readRevision() { throw new Error("must not read"); }, async downloadEncryptedRecord() {} },
      envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [listed] }; },
        async downloadEnvelope() { return { keySetVersion: 1, envelope: downloaded }; }, async addEnvelope() { mutations += 1; } },
      randomBytes: () => new Uint8Array(32), now: () => 0,
    });
    const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: changed }),
      isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
    assert.equal(result.reason, "remote-key-state-invalid", changed);
    assert.equal(mutations, 0, changed);
  }
});
