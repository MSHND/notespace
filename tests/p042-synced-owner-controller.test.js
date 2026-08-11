"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const {
  createSharedDeviceStoreState,
  createMemoryDeviceStoreDriver,
} = require("./helpers/p030-memory-device-store-driver.js");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-sync-owner-controller.js";
const SENTINEL = "P042-READABLE-POCKET-MUST-NEVER-REACH-REMOTE";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("timed out waiting for test boundary");
}

function loadProduction() {
  const context = {
    crypto: webcrypto,
    CryptoKey: globalThis.CryptoKey,
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
    TypeError,
    Promise,
    Set,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js",
    MODULE,
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    crypto: context.PocketSyncCrypto,
    deviceStore: context.PocketSyncDeviceStore,
    controller: context.PocketSyncOwnerController,
  };
}

async function buildRecord(apis, syncedPocketId, options = {}) {
  const deviceId = options.deviceId || `device-${syncedPocketId}`;
  const revision = options.revision ?? (options.recoveryAttemptId ? 1 : 0);
  const deviceWrappingKey = await apis.crypto.generateDeviceWrappingKey();
  const envelopeContext = {
    syncedPocketId,
    envelopeId: `envelope-${syncedPocketId}`,
    envelopeKind: "device",
    envelopeVersion: 1,
  };
  const bundle = await apis.crypto.createMasterKeyBundle([
    { context: envelopeContext, wrappingKey: deviceWrappingKey },
  ]);
  const contentContext = {
    syncedPocketId,
    revision,
    contentType: apis.crypto.FORMAT.contentType,
  };
  const content = {
    context: contentContext,
    record: await apis.crypto.sealContent({ initial: syncedPocketId }, bundle.masterKey, contentContext),
  };
  let recoveryDraft = null;
  if (options.recoveryAttemptId) {
    const draftContext = {
      syncedPocketId,
      revision: 1,
      contentType: apis.crypto.FORMAT.contentType,
    };
    recoveryDraft = {
      context: draftContext,
      record: await apis.crypto.sealContent({
        recoveryAttemptId: options.recoveryAttemptId,
        stage: options.recoveryStage || "ready-for-adoption",
        syncedPocketId,
        targetOwnerKind: options.targetOwnerKind || "none",
        targetContinuityId: options.targetContinuityId || "none:recovery-target",
      }, deviceWrappingKey, draftContext),
    };
  }
  return {
    masterKey: bundle.masterKey,
    record: {
      kind: "pocket.sync.device-state",
      schemaVersion: 3,
      storeRevision: 1,
      syncedPocketId,
      deviceId,
      deviceWrappingKey,
      deviceEnvelope: {
        context: envelopeContext,
        metadata: {
          contractVersion: 1,
          syncedPocketId,
          envelopeId: envelopeContext.envelopeId,
          kind: "device",
          version: 1,
          deviceId,
          createdAt: "2042-01-01T00:00:00.000Z",
          kdf: "none",
        },
        record: bundle.envelopes[0].record,
      },
      content,
      remote: { confirmedRevision: revision, pending: null, conflict: null },
      usage: {
        masterKeyGeneration: 1,
        contentEncryptionsOnDevice: 1,
        envelopeEncryptionsOnDevice: 1,
      },
      activationDraft: null,
      recoveryDraft,
    },
  };
}

async function createHarness(options = {}) {
  const apis = loadProduction();
  const state = createSharedDeviceStoreState();
  const driver = createMemoryDeviceStoreDriver(state);
  const store = apis.deviceStore.createStore(driver);
  await store.open();
  const records = new Map();
  for (const input of options.records || [{ id: "pocket-a" }]) {
    const built = await buildRecord(apis, input.id, input);
    await store.createPocket(built.record);
    records.set(input.id, built);
  }
  const events = [];
  const calls = [];
  const contentService = options.contentService || Object.freeze({
    async conditionalUpload(input) {
      events.push("upload");
      calls.push(input);
      return {
        status: "committed",
        wrote: true,
        operationId: input.operationId,
        revision: input.expectedRevision + 1,
      };
    },
  });
  const crypto = Object.freeze({
    ...apis.crypto,
    async sealContent(...input) {
      events.push("encrypt");
      return apis.crypto.sealContent(...input);
    },
  });
  const baseReplace = store.replacePocket.bind(store);
  let replaceCount = 0;
  const deviceStore = Object.freeze({
    readPocket: store.readPocket.bind(store),
    readRecoveryAttempt: store.readRecoveryAttempt.bind(store),
    async replacePocket(...input) {
      replaceCount += 1;
      events.push(replaceCount === 1 ? "persist-pending" : "persist-confirmed");
      return baseReplace(...input);
    },
  });
  let randomSeed = 19;
  const controller = apis.controller.createSyncedOwnerController({
    crypto,
    deviceStore,
    contentService,
    randomBytes(length) { randomSeed += 1; return bytes(length, randomSeed); },
  });
  return { apis, state, driver, store, records, events, calls, controller };
}

async function adopt(harness, id = "pocket-a") {
  const result = await harness.controller.adoptSyncedOwner({
    syncedPocketId: id,
    masterKey: harness.records.get(id).masterKey,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function recoveryResult(recoveryAttemptId) {
  return {
    ok: true,
    reason: "recovery-ready",
    recoveryAttemptId,
    adopted: false,
    readyForAdoption: true,
    locallyDurable: true,
    remotelyCommitted: true,
    replacementRecoveryCopyStored: true,
    confirmedRemoteRevision: 1,
    syncPending: false,
  };
}

function recoveryDependencies(target, current = () => true) {
  return {
    captureRecoveryTarget() { return target; },
    isRecoveryTargetCurrent(value) { return value === target && current(); },
  };
}

test("P042 owner adoption creates a generation and invalidates replacement and released sessions", async () => {
  const harness = await createHarness({ records: [{ id: "pocket-a" }, { id: "pocket-b" }] });
  await adopt(harness, "pocket-a");
  const first = harness.controller.captureSyncedOwnerSaveSession();
  assert.equal(harness.controller.isSyncedOwnerSaveSessionCurrent(first), true);
  await adopt(harness, "pocket-b");
  const second = harness.controller.captureSyncedOwnerSaveSession();
  assert.equal(harness.controller.isSyncedOwnerSaveSessionCurrent(first), false);
  assert.equal(harness.controller.isSyncedOwnerSaveSessionCurrent(second), true);
  harness.controller.releaseSyncedOwner();
  assert.equal(harness.controller.isSyncedOwnerSaveSessionCurrent(second), false);

  await adopt(harness, "pocket-a");
  const third = harness.controller.captureSyncedOwnerSaveSession();
  assert.notEqual(third.generation, first.generation);
  assert.equal(harness.controller.isSyncedOwnerSaveSessionCurrent(first), false);
});

test("P042 adopts only a current P041 ready recovery and makes a fresh owner", async () => {
  const harness = await createHarness({ records: [
    { id: "pocket-old" },
    { id: "pocket-recovered", recoveryAttemptId: "recovery-p042", targetContinuityId: "none:recovery-target" },
  ] });
  await adopt(harness, "pocket-old");
  const old = harness.controller.captureSyncedOwnerSaveSession();
  const target = Object.freeze({ ownerKind: "none", continuityId: "recovery-target" });
  const adopted = await harness.controller.adoptReadyRecovery(
    recoveryResult("recovery-p042"), recoveryDependencies(target)
  );
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  assert.equal(adopted.owner.syncedPocketId, "pocket-recovered");
  assert.equal(harness.controller.isSyncedOwnerSaveSessionCurrent(old), false);
  const saved = await harness.controller.saveSyncedOwner({
    freezePayload: async () => ({ sentinel: SENTINEL }),
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(harness.calls[0].syncedPocketId, "pocket-recovered");
});

test("P042 rejects invalid, mismatched and stale P041 recovery candidates without replacing ownership", async () => {
  const harness = await createHarness({ records: [
    { id: "pocket-old" },
    { id: "pocket-recovery", recoveryAttemptId: "recovery-invalid", recoveryStage: "content-ready" },
    { id: "pocket-ready", recoveryAttemptId: "recovery-ready", targetContinuityId: "none:expected" },
  ] });
  await adopt(harness, "pocket-old");
  const before = harness.controller.getSyncedOwnerState();
  const invalid = await harness.controller.adoptReadyRecovery(
    recoveryResult("recovery-invalid"), recoveryDependencies({ ownerKind: "none", continuityId: "recovery-target" })
  );
  assert.equal(invalid.reason, "recovery-not-eligible");
  const mismatch = await harness.controller.adoptReadyRecovery(
    recoveryResult("recovery-ready"), recoveryDependencies({ ownerKind: "none", continuityId: "other" })
  );
  assert.equal(mismatch.reason, "recovery-target-stale");
  const stale = await harness.controller.adoptReadyRecovery(
    recoveryResult("recovery-ready"), recoveryDependencies({ ownerKind: "none", continuityId: "expected" }, () => false)
  );
  assert.equal(stale.reason, "recovery-target-stale");
  assert.deepEqual(harness.controller.getSyncedOwnerState(), before);
});

test("P042 revalidates a P041 recovery target immediately before ownership adoption", async () => {
  const harness = await createHarness({ records: [{
    id: "pocket-recovery", recoveryAttemptId: "recovery-recheck", targetContinuityId: "none:expected",
  }] });
  let checks = 0;
  const target = Object.freeze({ ownerKind: "none", continuityId: "expected" });
  const result = await harness.controller.adoptReadyRecovery(recoveryResult("recovery-recheck"), {
    captureRecoveryTarget() { return target; },
    isRecoveryTargetCurrent() { checks += 1; return checks === 1; },
  });
  assert.equal(result.reason, "recovery-target-stale");
  assert.equal(harness.controller.getSyncedOwnerState(), null);
  assert.equal(checks, 2);
});

test("P042 freezes once, encrypts before durable pending state, then conditionally confirms", async () => {
  const harness = await createHarness();
  await adopt(harness);
  let freezes = 0;
  const result = await harness.controller.saveSyncedOwner({
    async freezePayload() { freezes += 1; harness.events.push("freeze"); return { sentinel: SENTINEL }; },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(freezes, 1);
  assert.deepEqual(harness.events, ["freeze", "encrypt", "persist-pending", "upload", "persist-confirmed"]);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].expectedRevision, 0);
  assert.equal(JSON.stringify(harness.calls[0]).includes(SENTINEL), false);
  assert.equal(harness.calls[0].encryptedRecord.format, "pocket.sync.content.opaque");
  const record = await harness.store.readPocket("pocket-a");
  assert.equal(record.remote.confirmedRevision, 1);
  assert.equal(record.remote.pending, null);
});

test("P042 does not upload when pending encrypted persistence fails", async () => {
  const harness = await createHarness();
  await adopt(harness);
  harness.driver.failAt("after-validation-before-write");
  const result = await harness.controller.saveSyncedOwner({ freezePayload: async () => ({ sentinel: SENTINEL }) });
  assert.equal(result.reason, "pending-persistence-failed");
  assert.equal(harness.calls.length, 0);
});

test("P042 returns a conflict with encrypted pending work retained and no retry", async () => {
  const harness = await createHarness({ contentService: Object.freeze({
    async conditionalUpload(input) {
      harness.calls.push(input);
      return { conflict: true, actualRevision: input.expectedRevision + 2 };
    },
  }) });
  await adopt(harness);
  const result = await harness.controller.saveSyncedOwner({ freezePayload: async () => ({ sentinel: SENTINEL }) });
  assert.equal(result.reason, "revision-conflict");
  assert.equal(harness.calls.length, 1);
  const record = await harness.store.readPocket("pocket-a");
  assert.notEqual(record.remote.pending, null);
  assert.equal(record.remote.conflict.actualRevision, 2);
});

test("P042 keeps pending work for ambiguous and definite remote failures without retry", async () => {
  for (const [label, error, expected] of [
    ["ambiguous", Object.assign(new Error("transport lost"), { outcome: "unknown" }), "remote-outcome-unknown"],
    ["definite", Object.assign(new Error("server rejected"), { outcome: "definite-failure" }), "remote-failed"],
  ]) {
    const calls = [];
    const harness = await createHarness({ contentService: Object.freeze({
      async conditionalUpload(input) { calls.push(input); throw error; },
    }) });
    await adopt(harness);
    const result = await harness.controller.saveSyncedOwner({ freezePayload: async () => ({ sentinel: SENTINEL }) });
    assert.equal(result.reason, expected, label);
    assert.equal(calls.length, 1, label);
    assert.notEqual((await harness.store.readPocket("pocket-a")).remote.pending, null, label);
  }
});

test("P042 records known remote success separately when local confirmation fails", async () => {
  const harness = await createHarness();
  await adopt(harness);
  const original = harness.store.replacePocket.bind(harness.store);
  let calls = 0;
  const controller = harness.apis.controller.createSyncedOwnerController({
    crypto: harness.apis.crypto,
    deviceStore: Object.freeze({
      readPocket: harness.store.readPocket.bind(harness.store),
      readRecoveryAttempt: harness.store.readRecoveryAttempt.bind(harness.store),
      async replacePocket(...input) {
        calls += 1;
        if (calls === 2) throw new Error("local confirmation unavailable");
        return original(...input);
      },
    }),
    contentService: Object.freeze({
      async conditionalUpload(input) {
        return { status: "committed", wrote: true, operationId: input.operationId, revision: 1 };
      },
    }),
    randomBytes(length) { return bytes(length, 77); },
  });
  const key = harness.records.get("pocket-a").masterKey;
  assert.equal((await controller.adoptSyncedOwner({ syncedPocketId: "pocket-a", masterKey: key })).ok, true);
  const result = await controller.saveSyncedOwner({ freezePayload: async () => ({ sentinel: SENTINEL }) });
  assert.equal(result.reason, "remote-success-local-confirmation-failed");
  assert.equal(controller.getSyncedOwnerState().knownRemoteRevision, 1);
  assert.equal(controller.getSyncedOwnerState().confirmedRemoteRevision, 0);
  assert.notEqual((await harness.store.readPocket("pocket-a")).remote.pending, null);
});

test("P042 stale sessions never upload before replacement or mutate a replacement owner after upload", async () => {
  const beforeUpload = await createHarness({ records: [{ id: "pocket-a" }, { id: "pocket-b" }] });
  await adopt(beforeUpload, "pocket-a");
  const originalReplace = beforeUpload.store.replacePocket.bind(beforeUpload.store);
  const pendingGate = deferred();
  let first = true;
  let beforeUploadRemoteCalls = 0;
  const controllerBeforeUpload = beforeUpload.apis.controller.createSyncedOwnerController({
    crypto: beforeUpload.apis.crypto,
    deviceStore: Object.freeze({
      readPocket: beforeUpload.store.readPocket.bind(beforeUpload.store),
      readRecoveryAttempt: beforeUpload.store.readRecoveryAttempt.bind(beforeUpload.store),
      async replacePocket(...input) { if (first) { first = false; await pendingGate.promise; } return originalReplace(...input); },
    }),
    contentService: Object.freeze({
      async conditionalUpload() { beforeUploadRemoteCalls += 1; throw new Error("must not upload"); },
    }),
    randomBytes(length) { return bytes(length, 43); },
  });
  await controllerBeforeUpload.adoptSyncedOwner({ syncedPocketId: "pocket-a", masterKey: beforeUpload.records.get("pocket-a").masterKey });
  const pendingSave = controllerBeforeUpload.saveSyncedOwner({ freezePayload: async () => ({ sentinel: SENTINEL }) });
  await waitFor(() => first === false);
  await controllerBeforeUpload.adoptSyncedOwner({ syncedPocketId: "pocket-b", masterKey: beforeUpload.records.get("pocket-b").masterKey });
  pendingGate.resolve();
  assert.equal((await pendingSave).reason, "stale-owner-session");
  assert.equal(beforeUploadRemoteCalls, 0);
  assert.equal(controllerBeforeUpload.getSyncedOwnerState().syncedPocketId, "pocket-b");

  const inFlight = deferred();
  const afterUpload = await createHarness({ records: [{ id: "pocket-a" }, { id: "pocket-b" }], contentService: Object.freeze({
    async conditionalUpload(input) {
      afterUpload.calls.push(input);
      return inFlight.promise;
    },
  }) });
  await adopt(afterUpload, "pocket-a");
  const save = afterUpload.controller.saveSyncedOwner({ freezePayload: async () => ({ sentinel: SENTINEL }) });
  await waitFor(() => afterUpload.calls.length === 1);
  await afterUpload.controller.adoptSyncedOwner({ syncedPocketId: "pocket-b", masterKey: afterUpload.records.get("pocket-b").masterKey });
  inFlight.resolve({ status: "committed", wrote: true, operationId: afterUpload.calls[0].operationId, revision: 1 });
  assert.equal((await save).reason, "stale-owner-session");
  assert.equal(afterUpload.controller.getSyncedOwnerState().syncedPocketId, "pocket-b");
});

test("P042 does not apply a returned remote success to an owner replaced before local confirmation", async () => {
  const harness = await createHarness({ records: [{ id: "pocket-a" }, { id: "pocket-b" }] });
  const original = harness.store.replacePocket.bind(harness.store);
  const confirmationGate = deferred();
  let replacements = 0;
  const controller = harness.apis.controller.createSyncedOwnerController({
    crypto: harness.apis.crypto,
    deviceStore: Object.freeze({
      readPocket: harness.store.readPocket.bind(harness.store),
      readRecoveryAttempt: harness.store.readRecoveryAttempt.bind(harness.store),
      async replacePocket(...input) {
        replacements += 1;
        if (replacements === 2) await confirmationGate.promise;
        return original(...input);
      },
    }),
    contentService: Object.freeze({
      async conditionalUpload(input) {
        return { status: "committed", wrote: true, operationId: input.operationId, revision: 1 };
      },
    }),
    randomBytes(length) { return bytes(length, 65); },
  });
  await controller.adoptSyncedOwner({
    syncedPocketId: "pocket-a", masterKey: harness.records.get("pocket-a").masterKey,
  });
  const save = controller.saveSyncedOwner({ freezePayload: async () => ({ sentinel: SENTINEL }) });
  await waitFor(() => replacements === 2);
  await controller.adoptSyncedOwner({
    syncedPocketId: "pocket-b", masterKey: harness.records.get("pocket-b").masterKey,
  });
  confirmationGate.resolve();
  assert.equal((await save).reason, "stale-owner-session");
  assert.deepEqual(plain(controller.getSyncedOwnerState()), {
    syncedPocketId: "pocket-b",
    confirmedRemoteRevision: 0,
    knownRemoteRevision: 0,
    pending: false,
    generation: 2,
  });
});
