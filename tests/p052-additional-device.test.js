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

function loadProduction() {
  const context = { crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, Object, Array, Number, String, Boolean, JSON, Date, Error, TypeError, Promise, Set,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary") };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ["js/pocket-sync-security-contract.js", "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js", "js/pocket-sync-owner-controller.js",
    "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js",
    "js/pocket-sync-activation.js", "js/pocket-sync-additional-device.js"]) {
    vm.runInContext(source(file), context, { filename: file });
  }
  return context;
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("P052 remains dormant until explicitly created and PRF absence requires recovery before discovery or device mutation", async () => {
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
    discoveryService: { async readSyncedPocket() { calls.push("discovery"); } },
    contentService: { async readRevision() {}, async downloadEncryptedRecord() {} },
    envelopeService: { async listEnvelopes() {}, async downloadEnvelope() {}, async addEnvelope() { calls.push("add"); } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0,
  });
  const result = await opener.openExisting({
    captureTarget: () => ({ ownerKind: "none", id: 1 }), isTargetCurrent: () => true,
    validatePayload: () => true, adoptOpenedPocket: async () => true,
  });
  assert.equal(result.reason, "recovery-required");
  assert.deepEqual(calls, ["authenticate"]);
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
      credentialId, status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
        envelopeKind: "passkey-prf", envelopeVersion: 1, credentialId, kdf: "HKDF-SHA-256",
        kdfSalt: Buffer.from(salt).toString("base64url"), encryptedEnvelope: original.envelopes[0].record } }; },
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
      envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1,
      credentialId: "credential", status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf",
        envelopeKind: "passkey-prf", envelopeVersion: 1, credentialId: "credential",
        kdfSalt: "salt", encryptedEnvelope: { wrapped: "prf" } } }; },
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
      envelopeId: "prf-envelope", envelopeKind: "passkey-prf", envelopeVersion: 1,
      credentialId: "credential-p052b-prf", status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf-envelope",
        envelopeKind: "passkey-prf", envelopeVersion: 1, credentialId: "credential-p052b-prf",
        kdf: "HKDF-SHA-256", kdfSalt: salt, encryptedEnvelope: bundle.envelopes[0].record } }; },
      async addEnvelope() { mutations += 1; } },
    randomBytes(length) { return new Uint8Array(length); }, now: () => 0,
  });
  const result = await opener.openExisting({ captureTarget: () => ({ ownerKind: "detached", id: "prf" }),
    isTargetCurrent: () => true, validatePayload: () => true, adoptOpenedPocket: async () => true });
  assert.equal(result.reason, "recovery-required");
  assert.equal(mutations, 0);
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
    envelopeService: { async listEnvelopes() { return { keySetVersion: 1, envelopes: [{ envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, credentialId: "credential", status: "active" }] }; },
      async downloadEnvelope() { return { keySetVersion: 1, envelope: { envelopeId: "prf", envelopeKind: "passkey-prf", envelopeVersion: 1, credentialId: "credential", kdfSalt: "salt", encryptedEnvelope: {} } }; },
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
