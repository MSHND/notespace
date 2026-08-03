"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { CryptoKey } = globalThis;
const {
  createSharedDeviceStoreState,
  createMemoryDeviceStoreDriver,
} = require("./helpers/p030-memory-device-store-driver.js");

const REPO_ROOT = path.resolve(__dirname, "..");
const MODULE_PATH = "js/pocket-sync-device-store.js";
const SENTINEL = "P030-READABLE-THOUGHT-MUST-NOT-PERSIST";

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function clone(value) {
  return structuredClone(value);
}

function loadProductionModules() {
  const context = {
    crypto: webcrypto,
    CryptoKey,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Error,
    Promise,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const relativePath of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-crypto.js",
    MODULE_PATH,
  ]) {
    vm.runInContext(source(relativePath), context, { filename: relativePath });
  }
  return {
    deviceStore: context.PocketSyncDeviceStore,
    crypto: context.PocketSyncCrypto,
    security: context.PocketSyncSecurityContract,
  };
}

async function buildDeviceState(apis, options = {}) {
  const syncedPocketId = options.syncedPocketId || "pocket-p030-disposable";
  const deviceId = options.deviceId || "device-p030-disposable";
  const envelopeId = options.envelopeId || "envelope-p030-device";
  const confirmedRevision = options.confirmedRevision ?? 0;
  const pending = options.pending !== false;
  const contentRevision = options.contentRevision
    ?? (pending ? confirmedRevision + 1 : confirmedRevision);
  const deviceWrappingKey = options.deviceWrappingKey
    || await apis.crypto.generateDeviceWrappingKey();
  const envelopeContext = {
    syncedPocketId,
    envelopeId,
    envelopeKind: "device",
    envelopeVersion: 1,
  };
  const bundle = await apis.crypto.createMasterKeyBundle([
    { context: envelopeContext, wrappingKey: deviceWrappingKey },
  ]);
  const contentContext = {
    syncedPocketId,
    revision: contentRevision,
    contentType: "portal.export.v1+json",
  };
  const contentRecord = await apis.crypto.sealContent(
    options.payload || { kind: "p030-disposable", thoughts: ["Synthetic encrypted content"] },
    bundle.masterKey,
    contentContext
  );
  const operationId = options.operationId || "operation-p030-disposable";
  return {
    record: {
      kind: "pocket.sync.device-state",
      schemaVersion: 1,
      storeRevision: options.storeRevision || 1,
      syncedPocketId,
      deviceId,
      deviceWrappingKey,
      deviceEnvelope: {
        context: envelopeContext,
        metadata: {
          contractVersion: 1,
          syncedPocketId,
          envelopeId,
          kind: "device",
          version: 1,
          deviceId,
          createdAt: "2030-01-01T00:00:00.000Z",
          kdf: "none",
        },
        record: bundle.envelopes[0].record,
      },
      content: {
        context: contentContext,
        record: contentRecord,
      },
      remote: {
        confirmedRevision,
        pending: pending ? {
          expectedRevision: confirmedRevision,
          operationId,
          logicalChangeId: options.logicalChangeId || "change-p030-disposable",
          attemptKind: options.attemptKind || "new-change",
        } : null,
        conflict: options.conflict || null,
      },
      usage: {
        masterKeyGeneration: options.masterKeyGeneration || 1,
        contentEncryptionsOnDevice: options.contentEncryptionsOnDevice ?? 1,
        envelopeEncryptionsOnDevice: options.envelopeEncryptionsOnDevice ?? 1,
      },
    },
    masterKey: bundle.masterKey,
  };
}

async function openMemoryStore(apis, sharedState = createSharedDeviceStoreState()) {
  const driver = createMemoryDeviceStoreDriver(sharedState);
  const store = apis.deviceStore.createStore(driver);
  await store.open();
  return { store, driver, sharedState };
}

function committedRecord(base, overrides = {}) {
  const next = clone(base);
  next.storeRevision = overrides.storeRevision || base.storeRevision + 1;
  next.remote.confirmedRevision = overrides.confirmedRevision ?? next.content.context.revision;
  next.remote.pending = null;
  next.remote.conflict = null;
  if (overrides.usage) next.usage = Object.assign(next.usage, overrides.usage);
  return next;
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code && !error.message.includes(SENTINEL));
}

function expectValidationCode(action, code) {
  assert.throws(action, (error) => error && error.code === code && !error.message.includes(SENTINEL));
}

function fakeSchemaIndexedDb() {
  const observations = {
    opens: [],
    stores: [],
    indexes: [],
    closeCount: 0,
    database: null,
  };
  const indexedDb = {
    open(name, version) {
      observations.opens.push({ name, version });
      const request = {};
      queueMicrotask(() => {
        const store = {
          keyPath: "syncedPocketId",
          autoIncrement: false,
          indexNames: [],
          createIndex(...args) {
            observations.indexes.push(args);
          },
        };
        const database = {
          version: 1,
          objectStoreNames: [],
          createObjectStore(storeName, options) {
            observations.stores.push({ storeName, options: clone(options) });
            this.objectStoreNames.push(storeName);
            return store;
          },
          transaction() {
            return {
              objectStore: () => store,
              abort() {},
            };
          },
          close() {
            observations.closeCount += 1;
          },
          onversionchange: null,
        };
        observations.database = database;
        request.result = database;
        request.transaction = { abort() {} };
        request.onupgradeneeded?.({ oldVersion: 0 });
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { indexedDb, observations };
}

function fakeCloneFailureIndexedDb() {
  const store = {
    keyPath: "syncedPocketId",
    autoIncrement: false,
    indexNames: [],
    get() {
      const request = {};
      queueMicrotask(() => {
        request.result = undefined;
        request.onsuccess?.();
      });
      return request;
    },
    add() {
      const error = new Error("The runtime cannot clone this key");
      error.name = "DataCloneError";
      throw error;
    },
  };
  const database = {
    version: 1,
    objectStoreNames: ["pockets"],
    transaction() {
      const transaction = {
        error: null,
        objectStore: () => store,
        abort() {
          queueMicrotask(() => transaction.onabort?.());
        },
      };
      return transaction;
    },
    close() {},
    onversionchange: null,
  };
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
  };
}

let apis;
let initial;

test.before(async () => {
  apis = loadProductionModules();
  initial = await buildDeviceState(apis);
});

test("P030 is dormant and absent from production loaders", () => {
  assert.doesNotThrow(() => new vm.Script(source(MODULE_PATH)));
  assert.doesNotMatch(source("index.html"), /pocket-sync-device-store\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-device-store\.js/);
  assert.doesNotMatch(source("js/pocket-state.js"), /ownerKind:\s*["']synced["']/);
});

test("database, object-store, key-path and record constants are exact", () => {
  assert.deepEqual(plain(apis.deviceStore.CONFIG), {
    databaseName: "pocket.sync.device.v1",
    databaseVersion: 1,
    objectStoreName: "pockets",
    keyPath: "syncedPocketId",
    indexes: [],
  });
  assert.deepEqual(plain(apis.deviceStore.FORMAT), {
    recordKind: "pocket.sync.device-state",
    recordSchemaVersion: 2,
    firstStoreRevision: 1,
  });
  assert.deepEqual(plain(apis.deviceStore.MIGRATION_POLICY), {
    currentDatabaseVersion: 1,
    currentRecordSchemaVersion: 2,
    registeredRecordMigrations: ["1-to-2-encrypted-activation-draft"],
    destructiveResetAllowed: false,
  });
});

test("production IndexedDB upgrade creates exactly one key-path store and no indexes", async () => {
  const fake = fakeSchemaIndexedDb();
  const driver = apis.deviceStore.createIndexedDbDriver(fake.indexedDb);
  await driver.open();
  assert.deepEqual(fake.observations.opens, [{ name: "pocket.sync.device.v1", version: 1 }]);
  assert.deepEqual(fake.observations.stores, [{
    storeName: "pockets",
    options: { keyPath: "syncedPocketId" },
  }]);
  assert.deepEqual(fake.observations.indexes, []);
  fake.observations.database.onversionchange();
  assert.equal(fake.observations.closeCount, 1);
});

test("memory driver receives the same one-store schema and stays separate from recent-file storage", async () => {
  const { sharedState } = await openMemoryStore(apis);
  assert.deepEqual(sharedState.configuration, {
    databaseName: "pocket.sync.device.v1",
    databaseVersion: 1,
    objectStoreName: "pockets",
    keyPath: "syncedPocketId",
    indexes: [],
  });
  assert.match(source("js/pocket-state.js"), /pocketLite\.recentFile\.v1/);
  assert.match(source("js/pocket-state.js"), /RECENT_POCKET_FILE_STORE\s*=\s*"recentFile"/);
  assert.notEqual(sharedState.configuration.databaseName, "pocketLite.recentFile.v1");
  assert.notEqual(sharedState.configuration.objectStoreName, "recentFile");
});

test("valid initial creation is insert-only and resolves only after transaction commit", async () => {
  const { store, driver, sharedState } = await openMemoryStore(apis);
  const release = driver.holdCommit();
  let settled = false;
  const creation = store.createPocket(initial.record).then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(sharedState.records.has(initial.record.syncedPocketId), false);
  release();
  const created = await creation;
  assert.equal(created.storeRevision, 1);
  assert.equal(sharedState.records.has(initial.record.syncedPocketId), true);
  await expectCode(store.createPocket(initial.record), "device-store-already-exists");
  const wrongRevision = clone(initial.record);
  wrongRevision.syncedPocketId = "pocket-other-initial";
  wrongRevision.deviceEnvelope.context.syncedPocketId = wrongRevision.syncedPocketId;
  wrongRevision.deviceEnvelope.metadata.syncedPocketId = wrongRevision.syncedPocketId;
  wrongRevision.content.context.syncedPocketId = wrongRevision.syncedPocketId;
  wrongRevision.storeRevision = 2;
  await expectCode(store.createPocket(wrongRevision), "device-store-revision-invalid");
});

test("missing read returns null and a valid read returns the complete encrypted state", async () => {
  const { store } = await openMemoryStore(apis);
  assert.equal(await store.readPocket("missing-pocket"), null);
  await store.createPocket(initial.record);
  const restored = await store.readPocket(initial.record.syncedPocketId);
  assert.equal(restored.kind, "pocket.sync.device-state");
  assert.equal(restored.storeRevision, 1);
  assert.equal(restored.content.record.ciphertext, initial.record.content.record.ciphertext);
  assert.equal(restored.deviceEnvelope.record.ciphertext, initial.record.deviceEnvelope.record.ciphertext);
  assert.deepEqual(Object.keys(restored.remote.pending).sort(), [
    "attemptKind", "expectedRevision", "logicalChangeId", "operationId",
  ]);
  assert.equal(Object.hasOwn(restored.remote.pending, "encryptedRecord"), false);
});

test("a corrupt stored record fails closed without deletion or repair", async () => {
  const sharedState = createSharedDeviceStoreState();
  const corrupt = clone(initial.record);
  corrupt.nodeLabel = SENTINEL;
  sharedState.records.set(corrupt.syncedPocketId, corrupt);
  const { store } = await openMemoryStore(apis, sharedState);
  await expectCode(store.readPocket(corrupt.syncedPocketId), "device-state-invalid");
  assert.equal(sharedState.records.has(corrupt.syncedPocketId), true);
  assert.equal(sharedState.records.get(corrupt.syncedPocketId).nodeLabel, SENTINEL);
});

test("restored non-extractable device key reopens the envelope and stored content", async () => {
  const { store } = await openMemoryStore(apis);
  await store.createPocket(initial.record);
  const restored = await store.readPocket(initial.record.syncedPocketId);
  const key = restored.deviceWrappingKey;
  assert.equal(key.type, "secret");
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, "AES-GCM");
  assert.equal(key.algorithm.length, 256);
  assert.deepEqual([...key.usages].sort(), ["decrypt", "encrypt"]);
  await assert.rejects(webcrypto.subtle.exportKey("raw", key));
  const opened = await apis.crypto.openMasterKeyBundle(
    restored.deviceEnvelope.record,
    key,
    restored.deviceEnvelope.context
  );
  await assert.rejects(webcrypto.subtle.exportKey("raw", opened.masterKey));
  assert.deepEqual(plain(await apis.crypto.openContent(
    restored.content.record,
    opened.masterKey,
    restored.content.context
  )), { kind: "p030-disposable", thoughts: ["Synthetic encrypted content"] });
});

test("successful compare-and-swap advances exactly one and atomically replaces the record", async () => {
  const { store } = await openMemoryStore(apis);
  await store.createPocket(initial.record);
  const next = committedRecord(initial.record);
  const replaced = await store.replacePocket(initial.record.syncedPocketId, 1, next);
  assert.equal(replaced.storeRevision, 2);
  assert.equal(replaced.remote.confirmedRevision, 1);
  assert.equal(replaced.remote.pending, null);
  const restored = await store.readPocket(initial.record.syncedPocketId);
  assert.equal(restored.storeRevision, 2);
  assert.equal(restored.content.record.ciphertext, next.content.record.ciphertext);
});

test("stale compare-and-swap leaves the newer record untouched", async () => {
  const { store } = await openMemoryStore(apis);
  await store.createPocket(initial.record);
  const winner = committedRecord(initial.record);
  await store.replacePocket(initial.record.syncedPocketId, 1, winner);
  const stale = clone(winner);
  stale.storeRevision = 2;
  stale.usage.envelopeEncryptionsOnDevice = 2;
  await expectCode(
    store.replacePocket(initial.record.syncedPocketId, 1, stale),
    "device-store-revision-conflict"
  );
  const restored = await store.readPocket(initial.record.syncedPocketId);
  assert.equal(restored.storeRevision, 2);
  assert.equal(restored.usage.envelopeEncryptionsOnDevice, 1);
});

test("two store instances share state and only one same-revision writer wins", async () => {
  const shared = createSharedDeviceStoreState();
  const first = await openMemoryStore(apis, shared);
  const second = await openMemoryStore(apis, shared);
  await first.store.createPocket(initial.record);
  assert.equal((await first.store.readPocket(initial.record.syncedPocketId)).storeRevision, 1);
  assert.equal((await second.store.readPocket(initial.record.syncedPocketId)).storeRevision, 1);
  const firstNext = committedRecord(initial.record);
  const secondNext = committedRecord(initial.record, {
    usage: { envelopeEncryptionsOnDevice: 2 },
  });
  const results = await Promise.allSettled([
    first.store.replacePocket(initial.record.syncedPocketId, 1, firstNext),
    second.store.replacePocket(initial.record.syncedPocketId, 1, secondNext),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.code, "device-store-revision-conflict");
  const restored = await second.store.readPocket(initial.record.syncedPocketId);
  assert.equal(restored.storeRevision, 2);
  assert.equal(restored.usage.envelopeEncryptionsOnDevice, 1);
});

test("all injected transaction failures roll back the whole prior pending record", async () => {
  for (const point of [
    "before-read",
    "after-read-before-validation",
    "after-validation-before-write",
    "after-write-before-commit",
    "during-commit",
  ]) {
    const { store, driver } = await openMemoryStore(apis);
    await store.createPocket(initial.record);
    driver.failAt(point);
    await assert.rejects(store.replacePocket(
      initial.record.syncedPocketId,
      1,
      committedRecord(initial.record)
    ), point);
    const restored = await store.readPocket(initial.record.syncedPocketId);
    assert.equal(restored.storeRevision, 1, point);
    assert.equal(restored.remote.confirmedRevision, 0, point);
    assert.ok(restored.remote.pending, point);
    assert.equal(restored.content.record.ciphertext, initial.record.content.record.ciphertext, point);
    assert.deepEqual(plain(restored.usage), plain(initial.record.usage), point);
  }
});

test("staged request success is not reported or exposed before transaction completion", async () => {
  const { store, driver, sharedState } = await openMemoryStore(apis);
  await store.createPocket(initial.record);
  const release = driver.holdCommit();
  let settled = false;
  const replacement = store.replacePocket(
    initial.record.syncedPocketId,
    1,
    committedRecord(initial.record)
  ).then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(sharedState.records.get(initial.record.syncedPocketId).storeRevision, 1);
  release();
  await replacement;
  assert.equal(sharedState.records.get(initial.record.syncedPocketId).storeRevision, 2);
});

test("top-level kind, fields and schema versions fail closed", () => {
  const extra = clone(initial.record);
  extra.nodeLabel = SENTINEL;
  expectValidationCode(() => apis.deviceStore.validateRecord(extra), "device-state-invalid");
  const wrongKind = clone(initial.record);
  wrongKind.kind = "other";
  expectValidationCode(() => apis.deviceStore.validateRecord(wrongKind), "device-state-kind-invalid");
  const higher = clone(initial.record);
  higher.schemaVersion = 3;
  expectValidationCode(() => apis.deviceStore.migrateRecord(higher), "device-state-schema-unsupported");
  const lower = clone(initial.record);
  lower.schemaVersion = 0;
  expectValidationCode(() => apis.deviceStore.migrateRecord(lower), "device-state-migration-unavailable");
});

test("malformed, extractable and wrong-usage device keys fail closed", async () => {
  const malformed = clone(initial.record);
  malformed.deviceWrappingKey = { algorithm: { name: "AES-GCM", length: 256 } };
  expectValidationCode(() => apis.deviceStore.validateRecord(malformed), "device-wrapping-key-invalid");

  const spoofed = clone(initial.record);
  spoofed.deviceWrappingKey = {
    [Symbol.toStringTag]: "CryptoKey",
    type: "secret",
    extractable: false,
    algorithm: { name: "AES-GCM", length: 256 },
    usages: ["encrypt", "decrypt"],
  };
  expectValidationCode(() => apis.deviceStore.validateRecord(spoofed), "device-wrapping-key-invalid");

  const extractable = clone(initial.record);
  extractable.deviceWrappingKey = await webcrypto.subtle.importKey(
    "raw", new Uint8Array(32), "AES-GCM", true, ["encrypt", "decrypt"]
  );
  expectValidationCode(() => apis.deviceStore.validateRecord(extractable), "device-wrapping-key-invalid");

  const wrongUsage = clone(initial.record);
  wrongUsage.deviceWrappingKey = await webcrypto.subtle.importKey(
    "raw", new Uint8Array(32), "AES-GCM", false, ["encrypt"]
  );
  expectValidationCode(() => apis.deviceStore.validateRecord(wrongUsage), "device-wrapping-key-invalid");
});

test("content and device-envelope records delegate to strict P029 validation", () => {
  const badContent = clone(initial.record);
  badContent.content.record.algorithm = "authenticated-encryption";
  expectValidationCode(() => apis.deviceStore.validateRecord(badContent), "device-content-invalid");
  const shortContentNonce = clone(initial.record);
  shortContentNonce.content.record.nonce = "AAAAAAAAAAAAAAA";
  expectValidationCode(() => apis.deviceStore.validateRecord(shortContentNonce), "device-content-invalid");
  const badEnvelope = clone(initial.record);
  badEnvelope.deviceEnvelope.record.algorithm = "AES-GCM";
  expectValidationCode(() => apis.deviceStore.validateRecord(badEnvelope), "device-envelope-invalid");
  const shortEnvelope = clone(initial.record);
  shortEnvelope.deviceEnvelope.record.ciphertext = "AAAAAAAAAAAAAAAAAAAAAA";
  expectValidationCode(() => apis.deviceStore.validateRecord(shortEnvelope), "device-envelope-invalid");
});

test("Pocket, envelope and device identities must agree everywhere", () => {
  const cases = [
    (record) => { record.syncedPocketId = "other-pocket"; },
    (record) => { record.content.context.syncedPocketId = "other-pocket"; },
    (record) => { record.deviceEnvelope.context.syncedPocketId = "other-pocket"; },
    (record) => { record.deviceEnvelope.metadata.syncedPocketId = "other-pocket"; },
    (record) => { record.deviceEnvelope.context.envelopeId = "other-envelope"; },
    (record) => { record.deviceEnvelope.metadata.envelopeId = "other-envelope"; },
    (record) => { record.deviceId = "other-device"; },
    (record) => { record.deviceEnvelope.metadata.deviceId = "other-device"; },
  ];
  for (const mutate of cases) {
    const record = clone(initial.record);
    mutate(record);
    assert.throws(() => apis.deviceStore.validateRecord(record));
  }
});

test("device envelope kind and concrete no-KDF metadata are exact", () => {
  const wrongContextKind = clone(initial.record);
  wrongContextKind.deviceEnvelope.context.envelopeKind = "recovery";
  assert.throws(() => apis.deviceStore.validateRecord(wrongContextKind));
  const wrongMetadataKind = clone(initial.record);
  wrongMetadataKind.deviceEnvelope.metadata.kind = "recovery";
  assert.throws(() => apis.deviceStore.validateRecord(wrongMetadataKind));
  const wrongKdf = clone(initial.record);
  wrongKdf.deviceEnvelope.metadata.kdf = "HKDF-SHA-256";
  expectValidationCode(
    () => apis.deviceStore.validateRecord(wrongKdf),
    "device-envelope-metadata-invalid"
  );
  const salt = clone(initial.record);
  salt.deviceEnvelope.metadata.kdfSalt = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  expectValidationCode(
    () => apis.deviceStore.validateRecord(salt),
    "device-envelope-metadata-invalid"
  );
});

test("pending state binds one content record to a valid P028 conditional request", () => {
  const accepted = apis.deviceStore.validateRecord(initial.record);
  assert.equal(accepted.remote.pending.expectedRevision, accepted.remote.confirmedRevision);
  assert.equal(accepted.content.context.revision, accepted.remote.confirmedRevision + 1);
  assert.equal(Object.hasOwn(accepted.remote.pending, "encryptedRecord"), false);
  const request = apis.security.buildConditionalWriteRequest({
    syncedPocketId: accepted.syncedPocketId,
    expectedRevision: accepted.remote.pending.expectedRevision,
    operationId: accepted.remote.pending.operationId,
    logicalChangeId: accepted.remote.pending.logicalChangeId,
    attemptKind: accepted.remote.pending.attemptKind,
    encryptedRecord: accepted.content.record,
  });
  assert.equal(request.ok, true);

  for (const mutate of [
    (record) => { record.remote.pending.expectedRevision = 1; },
    (record) => { record.content.context.revision = 2; },
    (record) => { record.remote.pending.operationId = ""; },
    (record) => { record.remote.pending.logicalChangeId = ""; },
    (record) => { record.remote.pending.attemptKind = "automatic-retry"; },
    (record) => { record.remote.pending.encryptedRecord = record.content.record; },
  ]) {
    const record = clone(initial.record);
    mutate(record);
    assert.throws(() => apis.deviceStore.validateRecord(record));
  }
});

test("no-pending state requires matching confirmed content and no conflict", () => {
  const valid = committedRecord(initial.record);
  assert.equal(apis.deviceStore.validateRecord(valid).remote.pending, null);
  const wrongRevision = clone(valid);
  wrongRevision.remote.confirmedRevision = 0;
  assert.throws(() => apis.deviceStore.validateRecord(wrongRevision));
  const strayConflict = clone(valid);
  strayConflict.remote.conflict = { actualRevision: 2, operationId: "operation-p030" };
  expectValidationCode(() => apis.deviceStore.validateRecord(strayConflict), "device-conflict-invalid");
});

test("conflict state requires its pending operation and a newer actual revision", () => {
  const conflict = clone(initial.record);
  conflict.remote.conflict = {
    actualRevision: 2,
    operationId: conflict.remote.pending.operationId,
  };
  const accepted = apis.deviceStore.validateRecord(conflict);
  assert.ok(accepted.remote.pending);
  assert.equal(accepted.content.record.ciphertext, initial.record.content.record.ciphertext);
  const noPending = clone(conflict);
  noPending.remote.pending = null;
  assert.throws(() => apis.deviceStore.validateRecord(noPending));
  const wrongOperation = clone(conflict);
  wrongOperation.remote.conflict.operationId = "other-operation";
  assert.throws(() => apis.deviceStore.validateRecord(wrongOperation));
  const oldActual = clone(conflict);
  oldActual.remote.conflict.actualRevision = 0;
  assert.throws(() => apis.deviceStore.validateRecord(oldActual));
});

test("confirmed remote revision cannot roll back during replacement", async () => {
  const { store } = await openMemoryStore(apis);
  await store.createPocket(initial.record);
  const committed = committedRecord(initial.record);
  await store.replacePocket(initial.record.syncedPocketId, 1, committed);
  const rollback = clone(initial.record);
  rollback.storeRevision = 3;
  await expectCode(
    store.replacePocket(initial.record.syncedPocketId, 2, rollback),
    "device-remote-revision-rollback"
  );
  assert.equal((await store.readPocket(initial.record.syncedPocketId)).remote.confirmedRevision, 1);
});

test("usage counters cannot roll back within one master-key generation", async () => {
  const { store } = await openMemoryStore(apis);
  await store.createPocket(initial.record);
  const rollback = committedRecord(initial.record, {
    usage: { contentEncryptionsOnDevice: 0 },
  });
  await expectCode(
    store.replacePocket(initial.record.syncedPocketId, 1, rollback),
    "device-usage-rollback"
  );
  assert.deepEqual(plain((await store.readPocket(initial.record.syncedPocketId)).usage), plain(initial.record.usage));
});

test("usage ceiling fails closed while a higher master-key generation may reset counters", async () => {
  const ceiling = apis.crypto.POLICY.maximumEncryptionsPerKey;
  const atCeiling = clone(initial.record);
  atCeiling.usage.contentEncryptionsOnDevice = ceiling;
  expectValidationCode(() => apis.deviceStore.validateRecord(atCeiling), "device-usage-limit-reached");
  const envelopeCeiling = clone(initial.record);
  envelopeCeiling.usage.envelopeEncryptionsOnDevice = ceiling;
  expectValidationCode(() => apis.deviceStore.validateRecord(envelopeCeiling), "device-usage-limit-reached");

  const { store } = await openMemoryStore(apis);
  await store.createPocket(initial.record);
  const rotated = committedRecord(initial.record, {
    usage: {
      masterKeyGeneration: 2,
      contentEncryptionsOnDevice: 0,
      envelopeEncryptionsOnDevice: 0,
    },
  });
  const result = await store.replacePocket(initial.record.syncedPocketId, 1, rotated);
  assert.deepEqual(plain(result.usage), {
    masterKeyGeneration: 2,
    contentEncryptionsOnDevice: 0,
    envelopeEncryptionsOnDevice: 0,
  });
});

test("distinctive readable content remains inside ciphertext only", async () => {
  const state = await buildDeviceState(apis, {
    payload: { nodeLabel: SENTINEL, notes: SENTINEL, outline: [SENTINEL] },
  });
  const accepted = apis.deviceStore.validateRecord(state.record);
  assert.doesNotMatch(JSON.stringify(accepted), new RegExp(SENTINEL));
  const opened = await apis.crypto.openContent(
    accepted.content.record,
    state.masterKey,
    accepted.content.context
  );
  assert.equal(opened.nodeLabel, SENTINEL);
});

test("persistent record strictness rejects every forbidden plaintext or authority field", () => {
  const forbidden = [
    "nodeLabel", "nodes", "notes", "outline", "rawJsonPayload", "filename", "filesystemPath",
    "fileHandle", "formerTruthFileHandle", "vaultPassword", "recoveryRoot", "recoveryPackage",
    "prfOutput", "transferSecret", "rawMasterKey", "rawWrappingKey", "browserSafetyRecoveryPayload",
    "accountPassword", "remoteAccessToken", "uiState", "searchState", "filterState", "selectedNode",
    "collapsedNodes", "encryptedHistory", "eventLog", "telemetry",
  ];
  for (const field of forbidden) {
    const record = clone(initial.record);
    record[field] = SENTINEL;
    expectValidationCode(() => apis.deviceStore.validateRecord(record), "device-state-invalid");
  }
});

test("production source has no competing storage, network, worker, timer or logging path", () => {
  const moduleSource = source(MODULE_PATH).toLowerCase();
  for (const forbidden of [
    "localstorage", "sessionstorage", "caches.", "cache.open", "opfs", "showopenfilepicker",
    "showsavefilepicker", "filesystemfilehandle", "fetch(", "xmlhttprequest", "websocket",
    "serviceworker", "broadcastchannel", "sharedworker", "settimeout", "setinterval",
    "requestanimationframe", "polling", "telemetry", "console.", "require(", "deleteDatabase".toLowerCase(),
  ]) {
    assert.equal(moduleSource.includes(forbidden), false, forbidden);
  }
  assert.equal((moduleSource.match(/createobjectstore\(/g) || []).length, 1);
  assert.equal(moduleSource.includes("createindex("), false);
  for (const forbiddenStore of ["history", "operations", "logs", "settings", "migrations"]) {
    assert.equal(apis.deviceStore.CONFIG.objectStoreName.includes(forbiddenStore), false);
  }
});

test("production IndexedDB open failures are stable and non-secret", async () => {
  const blocked = {
    open() {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    },
  };
  await expectCode(
    apis.deviceStore.createIndexedDbDriver(blocked).open(),
    "device-store-open-blocked"
  );
  const higherVersion = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.error = { name: "VersionError" };
        request.onerror?.();
      });
      return request;
    },
  };
  await expectCode(
    apis.deviceStore.createIndexedDbDriver(higherVersion).open(),
    "device-store-database-version-unsupported"
  );
  await expectCode(
    apis.deviceStore.createIndexedDbDriver(null).open(),
    "indexeddb-unavailable"
  );
});

test("production IndexedDB maps CryptoKey clone failure to a stable unsupported result", async () => {
  const driver = apis.deviceStore.createIndexedDbDriver(fakeCloneFailureIndexedDb());
  const store = apis.deviceStore.createStore(driver);
  await store.open();
  await expectCode(store.createPocket(initial.record), "device-key-storage-unsupported");
});
