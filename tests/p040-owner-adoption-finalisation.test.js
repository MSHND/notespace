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
const MODULE = "js/pocket-sync-activation.js";
const NOW = Date.parse("2040-01-01T00:00:00.000Z");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(length, seed = 1) {
  return Buffer.from(bytes(length, seed)).toString("base64url");
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
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    deviceStoreModule: context.PocketSyncDeviceStore,
    activation: context.PocketSyncActivation,
  };
}

function createHarness(options = {}) {
  const production = loadProduction();
  const sharedState = createSharedDeviceStoreState();
  const driver = createMemoryDeviceStoreDriver(sharedState);
  const deviceStore = production.deviceStoreModule.createStore(driver);
  let randomSequence = 0;
  let current = true;
  let sourceChecks = 0;
  let sourceCaptures = 0;
  let ownerCalls = 0;
  let copyWrites = 0;
  let passkeyCreates = 0;
  let sealCalls = 0;
  let checksAtOwnerStart = null;
  let sealsAtOwnerStart = null;
  let remoteCallsAtOwnerStart = null;
  let copyWritesAtOwnerStart = null;
  let passkeyCreatesAtOwnerStart = null;
  let readyRevision = null;
  let readySnapshot = null;
  const remoteCalls = [];
  const owners = [];
  const sourceSession = Object.freeze({ ownerKind: "json", continuityId: "p040-source" });
  const crypto = Object.freeze(Object.assign({}, production.crypto, {
    async sealContent(...args) {
      sealCalls += 1;
      return production.crypto.sealContent(...args);
    },
  }));
  const security = options.staleBeforeAdoption ? Object.freeze(Object.assign({}, production.security, {
    validateActivationReadiness(input) {
      const result = production.security.validateActivationReadiness(input);
      if (input?.activationPhase === "pre-adoption") current = false;
      return result;
    },
  })) : production.security;
  const accountClient = Object.freeze({
    async registerPasskey(input, onCredentialReady) {
      passkeyCreates += 1;
      const evaluationInput = b64(32, 71);
      const continuation = {
        apiVersion: 1,
        operationId: input.operationId,
        ceremonyId: "p040-ceremony",
        deviceId: input.deviceId,
        prfEvaluationInput: evaluationInput,
        credential: { id: "p040-credential" },
      };
      await onCredentialReady(Object.freeze({
        continuation,
        prf: Object.freeze({ status: "unavailable", evaluationInput }),
      }));
      return Object.freeze({
        ok: true,
        accountAuthenticated: true,
        contentUnlocked: false,
        accountId: "p040-account",
        credentialId: "p040-credential",
        credentialVersion: 1,
        accountPolicyVersion: 1,
        prf: Object.freeze({ status: "unavailable", evaluationInput }),
      });
    },
    async finishRegistration() { throw new Error("not expected"); },
    async authenticatePasskey() { throw new Error("not expected"); },
  });
  const contentService = Object.freeze({
    async conditionalUpload(request) {
      remoteCalls.push({ route: "content", request: plain(request) });
      return Object.freeze({ status: "committed", revision: 1 });
    },
  });
  const envelopeService = Object.freeze({
    async addEnvelope(request) {
      remoteCalls.push({ route: "envelope", request: plain(request) });
      return Object.freeze({
        status: "committed",
        keySetVersion: request.expectedKeySetVersion + 1,
      });
    },
  });
  const recoveryService = Object.freeze({
    async initialiseRecovery(request) {
      remoteCalls.push({ route: "recovery", request: plain(request) });
      return Object.freeze({
        status: "committed",
        keySetVersion: request.expectedKeySetVersion + 1,
        recoveryVersion: 1,
        recoveryCopyRequired: true,
        accountLocator: "p040-account-locator",
      });
    },
  });
  const orchestrator = production.activation.createActivationOrchestrator({
    securityContract: security,
    crypto,
    deviceStore,
    accountClient,
    contentService,
    envelopeService,
    recoveryService,
    randomBytes(length) {
      randomSequence += 1;
      return bytes(length, randomSequence * 5);
    },
    now: () => NOW,
  });
  const dependencies = Object.freeze({
    captureSourceSession() { sourceCaptures += 1; return sourceSession; },
    isSourceSessionCurrent(session) {
      sourceChecks += 1;
      return current && session === sourceSession;
    },
    hasUnsavedSourceChanges() { return false; },
    async saveLocalSource() { return { ok: true }; },
    async freezePayload() { return { nodes: [{ id: "one", label: "P040 readable" }] }; },
    async prepareRecoveryCopyDestination() { return { ok: true, destination: { id: "copy" } }; },
    async buildRecoveryPackage(input) {
      return production.security.buildRecoveryPackage({
        ...plain(input),
        checksum: "P040-CHECKSUM",
      });
    },
    async writeRecoveryCopy() { copyWrites += 1; return { ok: true }; },
    async adoptSyncedOwner(owner) {
      ownerCalls += 1;
      owners.push(plain(owner));
      checksAtOwnerStart = sourceChecks;
      sealsAtOwnerStart = sealCalls;
      remoteCallsAtOwnerStart = remoteCalls.length;
      copyWritesAtOwnerStart = copyWrites;
      passkeyCreatesAtOwnerStart = passkeyCreates;
      readySnapshot = JSON.stringify(Array.from(sharedState.records.entries()));
      readyRevision = Array.from(sharedState.records.values())[0].storeRevision;
      if (options.ownerFails) return { ok: false };
      current = false;
      if (options.finalisationFails) driver.failAt("during-commit");
      return { ok: true };
    },
  });
  return {
    ...production,
    orchestrator,
    deviceStore,
    driver,
    sharedState,
    dependencies,
    sourceSession,
    remoteCalls,
    owners,
    get sourceChecks() { return sourceChecks; },
    get sourceCaptures() { return sourceCaptures; },
    get ownerCalls() { return ownerCalls; },
    get copyWrites() { return copyWrites; },
    get passkeyCreates() { return passkeyCreates; },
    get sealCalls() { return sealCalls; },
    get checksAtOwnerStart() { return checksAtOwnerStart; },
    get sealsAtOwnerStart() { return sealsAtOwnerStart; },
    get remoteCallsAtOwnerStart() { return remoteCallsAtOwnerStart; },
    get copyWritesAtOwnerStart() { return copyWritesAtOwnerStart; },
    get passkeyCreatesAtOwnerStart() { return passkeyCreatesAtOwnerStart; },
    get readyRevision() { return readyRevision; },
    get readySnapshot() { return readySnapshot; },
    retireSource() { current = false; },
  };
}

async function installDraft(harness, found, mutate) {
  const draft = plain(found.draft);
  mutate(draft);
  const record = structuredClone(found.record);
  record.activationDraft.record = await harness.crypto.sealContent(
    draft,
    record.deviceWrappingKey,
    record.activationDraft.context
  );
  harness.sharedState.records.set(record.syncedPocketId, record);
}

test("P040 preserves the dormant exact activation surfaces", () => {
  const production = loadProduction();
  assert.deepEqual(Object.keys(production.activation), ["POLICY", "createActivationOrchestrator"]);
  assert.equal(Object.isFrozen(production.activation), true);
  assert.match(source("index.html"), /pocket-sync-activation\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-activation\.js/);
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.orchestrator), ["activate", "resume"]);
  assert.equal(Object.isFrozen(harness.orchestrator), true);
});

test("successful adoption retires the source then durably finalises without another source check", async () => {
  const harness = createHarness();
  const result = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "p040-pocket-success",
    deviceId: "p040-device-success",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reason, "activated");
  assert.equal(result.adopted, true);
  assert.equal(result.sourceOwnerPreserved, false);
  assert.equal(harness.sourceChecks, harness.checksAtOwnerStart);
  assert.equal(harness.ownerCalls, 1);
  assert.deepEqual(Object.keys(harness.owners[0]), [
    "ownerKind", "activationId", "syncedPocketId", "deviceId",
    "confirmedRemoteRevision", "syncPending",
  ]);
  const found = await harness.deviceStore.readActivation(result.activationId);
  assert.equal(found.draft.stage, "adopted");
  assert.equal(found.draft.adopted, true);
  assert.equal(found.record.storeRevision, harness.readyRevision + 1);
  assert.equal(harness.sealCalls, harness.sealsAtOwnerStart + 1);
  assert.equal(harness.remoteCalls.length, harness.remoteCallsAtOwnerStart);
  assert.equal(harness.copyWrites, harness.copyWritesAtOwnerStart);
  assert.equal(harness.passkeyCreates, harness.passkeyCreatesAtOwnerStart);
  assert.deepEqual(harness.remoteCalls.map((call) => call.route), [
    "content", "envelope", "recovery",
  ]);
  assert.equal(harness.passkeyCreates, 1);
  assert.equal(harness.copyWrites, 1);

  const before = {
    captures: harness.sourceCaptures,
    checks: harness.sourceChecks,
    owners: harness.ownerCalls,
    remote: harness.remoteCalls.length,
    copies: harness.copyWrites,
    seals: harness.sealCalls,
    revision: found.record.storeRevision,
  };
  const replay = await harness.orchestrator.resume(harness.dependencies, {
    activationId: result.activationId,
  });
  assert.equal(replay.ok, true);
  const after = await harness.deviceStore.readActivation(result.activationId);
  assert.deepEqual({
    captures: harness.sourceCaptures,
    checks: harness.sourceChecks,
    owners: harness.ownerCalls,
    remote: harness.remoteCalls.length,
    copies: harness.copyWrites,
    seals: harness.sealCalls,
    revision: after.record.storeRevision,
  }, before);
});

test("a genuine pre-adoption source change blocks the owner transition", async () => {
  const harness = createHarness({ staleBeforeAdoption: true });
  const result = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "p040-pocket-stale",
    deviceId: "p040-device-stale",
  });
  assert.equal(result.reason, "source-session-changed");
  assert.equal(harness.ownerCalls, 0);
  const found = await harness.deviceStore.readActivation(result.activationId);
  assert.equal(found.draft.stage, "ready-for-adoption");
  assert.equal(found.draft.adopted, false);
});

test("owner-adapter failure preserves the ready source-bound state for resume", async () => {
  const harness = createHarness({ ownerFails: true });
  const result = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "p040-pocket-owner-failure",
    deviceId: "p040-device-owner-failure",
  });
  assert.equal(result.reason, "owner-adoption-failed");
  assert.equal(result.adopted, false);
  assert.equal(result.sourceOwnerPreserved, true);
  assert.equal(result.resumable, true);
  const found = await harness.deviceStore.readActivation(result.activationId);
  assert.equal(found.draft.stage, "ready-for-adoption");
  assert.equal(found.draft.adopted, false);
});

test("post-adoption persistence failure reports the transitioned owner honestly", async () => {
  const harness = createHarness({ finalisationFails: true });
  const result = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "p040-pocket-finalisation-failure",
    deviceId: "p040-device-finalisation-failure",
  });
  assert.deepEqual(plain(result), {
    ok: false,
    reason: "owner-adoption-finalisation-failed",
    adopted: true,
    sourceOwnerPreserved: false,
    activationId: result.activationId,
    locallyDurable: true,
    remotelyCommitted: true,
    recoveryCopyStored: true,
    resumable: false,
  });
  assert.equal(harness.ownerCalls, 1);
  assert.equal(harness.sourceChecks, harness.checksAtOwnerStart);
  assert.equal(JSON.stringify(Array.from(harness.sharedState.records.entries())), harness.readySnapshot);
  const found = await harness.deviceStore.readActivation(result.activationId);
  assert.equal(found.draft.stage, "ready-for-adoption");
  assert.equal(found.draft.adopted, false);
  assert.doesNotMatch(JSON.stringify(result), /during-commit|ciphertext|locator|source-session-changed/i);
});

test("adopted draft corruption fails closed before source capture", async (t) => {
  for (const scenario of [
    { name: "adopted flag false", mutate(draft) { draft.adopted = false; } },
    { name: "missing adopted field", mutate(draft) { delete draft.adopted; } },
  ]) await t.test(scenario.name, async () => {
    const harness = createHarness();
    const activated = await harness.orchestrator.activate(harness.dependencies, {
      syncedPocketId: `p040-pocket-${scenario.name.replaceAll(" ", "-")}`,
      deviceId: "p040-device-malformed",
    });
    const found = await harness.deviceStore.readActivation(activated.activationId);
    await installDraft(harness, found, scenario.mutate);
    const captures = harness.sourceCaptures;
    const result = await harness.orchestrator.resume(harness.dependencies, {
      activationId: activated.activationId,
    });
    assert.equal(result.reason, "activation-state-invalid");
    assert.equal(harness.sourceCaptures, captures);
    assert.equal(harness.ownerCalls, 1);
  });
});

test("a non-adopted resume still requires the original JSON or Vault continuity", async () => {
  const harness = createHarness({ ownerFails: true });
  const first = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "p040-pocket-continuity",
    deviceId: "p040-device-continuity",
  });
  harness.retireSource();
  const resumed = await harness.orchestrator.resume(harness.dependencies, {
    activationId: first.activationId,
  });
  assert.equal(resumed.reason, "source-session-changed");
  assert.equal(harness.ownerCalls, 1);
});
