"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { createMemoryDeviceStoreDriver } = require("./helpers/p030-memory-device-store-driver.js");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadProduction() {
  const context = { crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, Object, Array, Number, String, Boolean, JSON, Date, Error, Promise,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary") };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ["js/pocket-sync-security-contract.js", "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js", "js/pocket-sync-additional-device.js"]) {
    vm.runInContext(source(file), context, { filename: file });
  }
  return context;
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
      if (masterKeyBundleCalls <= 2) transientMasterKeys.add(bundle.masterKey);
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
