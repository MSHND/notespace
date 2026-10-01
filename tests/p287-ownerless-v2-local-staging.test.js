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

const ROOT = path.resolve(__dirname, "..");
const ACTIVATION = "js/pocket-sync-activation.js";
const OWNERLESS = "js/pocket-sync-ownerless-activation-draft.js";
const FIRST_USE = "js/pocket-first-use-document.js";
const DEVICE_STORE = "js/pocket-sync-device-store.js";
const NOW = Date.parse("2036-02-01T00:00:00.000Z");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function loadProduction(options = {}) {
  let nextNodeId = 0;
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
    TypeError,
    Promise,
    Set,
    makeId(prefix) {
      nextNodeId += 1;
      return `${prefix}_p287_${nextNodeId}`;
    },
    nowIso() { return new Date(NOW).toISOString(); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-crypto.js",
    ...(options.firstUse === false ? [] : [FIRST_USE]),
    ...(options.ownerless === false ? [] : [OWNERLESS]),
    DEVICE_STORE,
    ACTIVATION,
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    context,
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    ownerless: context.PocketSyncOwnerlessActivationDraft,
    deviceStoreModule: context.PocketSyncDeviceStore,
    activation: context.PocketSyncActivation,
  };
}

function createHarness(options = {}) {
  const production = loadProduction(options);
  const counters = {
    crypto: 0,
    store: 0,
    account: 0,
    remote: 0,
    captureTarget: 0,
    replaceable: 0,
  };
  let capturedPayload = null;

  if (production.context.PocketFirstUseDocument) {
    const canonical = production.context.PocketFirstUseDocument;
    production.context.PocketFirstUseDocument = Object.freeze({
      buildFreshPayload(...args) {
        const payload = canonical.buildFreshPayload(...args);
        capturedPayload = plain(payload);
        return payload;
      },
    });
  }

  const shared = createSharedDeviceStoreState();
  const rawStore = production.deviceStoreModule.createStore(
    createMemoryDeviceStoreDriver(shared)
  );

  const crypto = Object.freeze(Object.assign({}, production.crypto, {
    async generateDeviceWrappingKey(...args) {
      counters.crypto += 1;
      return production.crypto.generateDeviceWrappingKey(...args);
    },
    async createDerivedWrappingKey(...args) {
      counters.crypto += 1;
      return production.crypto.createDerivedWrappingKey(...args);
    },
    async createRecoveryAuthorisationKeyPair(...args) {
      counters.crypto += 1;
      return production.crypto.createRecoveryAuthorisationKeyPair(...args);
    },
    async createMasterKeyBundle(...args) {
      counters.crypto += 1;
      return production.crypto.createMasterKeyBundle(...args);
    },
    async sealContent(...args) {
      counters.crypto += 1;
      return production.crypto.sealContent(...args);
    },
  }));

  const deviceStore = Object.freeze({
    FORMAT: production.deviceStoreModule.FORMAT,
    async open(...args) { counters.store += 1; return rawStore.open(...args); },
    async readPocket(...args) { counters.store += 1; return rawStore.readPocket(...args); },
    async readActivation(...args) { counters.store += 1; return rawStore.readActivation(...args); },
    async createPocket(...args) { counters.store += 1; return rawStore.createPocket(...args); },
    async replacePocket(...args) { counters.store += 1; return rawStore.replacePocket(...args); },
    async reservePocketEncryptionUsage(...args) {
      counters.store += 1;
      return rawStore.reservePocketEncryptionUsage(...args);
    },
  });

  const accountClient = Object.freeze({
    async registerPasskey() { counters.account += 1; throw new Error("forbidden account call"); },
    async finishRegistration() { counters.account += 1; throw new Error("forbidden account call"); },
    async authenticatePasskey() { counters.account += 1; throw new Error("forbidden account call"); },
  });
  const contentService = Object.freeze({
    async conditionalUpload() { counters.remote += 1; throw new Error("forbidden remote call"); },
  });
  const envelopeService = Object.freeze({
    async addEnvelope() { counters.remote += 1; throw new Error("forbidden remote call"); },
  });
  const recoveryService = Object.freeze({
    async initialiseRecovery() { counters.remote += 1; throw new Error("forbidden remote call"); },
  });

  let randomSequence = 0;
  const orchestrator = production.activation.createActivationOrchestrator({
    securityContract: production.security,
    crypto,
    deviceStore,
    accountClient,
    contentService,
    envelopeService,
    recoveryService,
    randomBytes(length) {
      randomSequence += 1;
      return bytes(length, randomSequence * 7);
    },
    now: () => NOW,
  });

  const dependencies = Object.freeze({
    captureTarget() {
      counters.captureTarget += 1;
      if (typeof options.target === "function") {
        return options.target(counters.captureTarget);
      }
      return { ownerKind: "none", transientId: `none-${counters.captureTarget}` };
    },
    isTargetReplaceable(target) {
      counters.replaceable += 1;
      if (typeof options.replaceable === "function") {
        return options.replaceable(target, counters.replaceable);
      }
      return true;
    },
  });

  return {
    production,
    orchestrator,
    dependencies,
    rawStore,
    counters,
    get capturedPayload() { return capturedPayload; },
  };
}

function ownerlessOptions(accountPath = "existing-unbound", overrides = {}) {
  return Object.assign({
    activationMode: "ownerless-first-create",
    accountPath,
    syncedPocketId: `pocket-p287-${accountPath}`,
    deviceId: `device-p287-${accountPath}`,
  }, overrides);
}

async function assertSuccessfulStage(accountPath) {
  const harness = createHarness();
  const result = await harness.orchestrator.activate(
    harness.dependencies,
    ownerlessOptions(accountPath)
  );
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId",
    "deviceId", "stage", "locallyDurable",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ownerless-local-staged");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "device-staged");
  assert.equal(result.locallyDurable, true);
  assert.equal(harness.counters.account, 0);
  assert.equal(harness.counters.remote, 0);
  assert.ok(harness.counters.crypto > 0);
  assert.ok(harness.counters.store > 0);

  const found = await harness.rawStore.readActivation(result.activationId);
  assert.notEqual(found, null);
  const draft = found.draft;
  const validated = harness.production.ownerless.validate(draft, {
    securityContract: harness.production.security,
    crypto: harness.production.crypto,
  });
  assert.equal(validated.kind, "pocket.sync.activation-draft");
  assert.equal(validated.schemaVersion, 2);
  assert.equal(validated.activationMode, "ownerless-first-create");
  assert.equal(validated.accountPath, accountPath);
  assert.equal(validated.stage, "device-staged");
  assert.equal(validated.account, null);
  assert.equal(validated.registrationContinuation, null);
  assert.equal(validated.pendingOperation, null);
  assert.equal(validated.confirmedRemoteRevision, 0);
  assert.equal(validated.keySetVersion, 0);
  assert.equal(validated.recoveryVersion, 0);
  assert.equal(validated.accountLocator, null);
  assert.equal(validated.prfEnvelope, null);
  assert.equal(validated.prfStatus, "pending");
  assert.equal(validated.recoveryCopyStored, false);
  assert.equal(validated.adopted, false);
  assert.equal(Object.hasOwn(validated, "sourceOwnerKind"), false);
  assert.equal(Object.hasOwn(validated, "sourceContinuityId"), false);
  assert.equal(Object.hasOwn(validated, "sourceSaved"), false);
  assert.equal(JSON.stringify(validated).includes("outputBytes"), false);

  const record = found.record;
  const opened = await harness.production.crypto.openMasterKeyBundle(
    record.deviceEnvelope.record,
    record.deviceWrappingKey,
    record.deviceEnvelope.context
  );
  const payload = await harness.production.crypto.openContent(
    record.content.record,
    opened.masterKey,
    record.content.context
  );
  assert.deepEqual(plain(payload), harness.capturedPayload);
  assert.equal(payload.schema, "portal.export.v1");
  assert.equal(payload.mainThoughtTree[0].label, "Things on my mind");
  return { harness, result, draft, payload };
}

test("P287 preserves exact public activation surfaces and uses explicit ownerless mode only", async () => {
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.production.activation), [
    "POLICY", "createActivationOrchestrator", "createStrandedActivationClassifier",
  ]);
  assert.deepEqual(Object.keys(harness.orchestrator), ["activate", "resume"]);

  const malformedV1 = await harness.orchestrator.activate({}, {
    accountPath: "existing-unbound",
    syncedPocketId: "not-ownerless",
    deviceId: "device",
  });
  assert.equal(malformedV1.reason, "invalid-activation-input");
  assert.equal(harness.counters.crypto, 0);
  assert.equal(harness.counters.store, 0);

  const explicitBad = createHarness();
  const result = await explicitBad.orchestrator.activate(explicitBad.dependencies, {
    activationMode: "other",
    accountPath: "existing-unbound",
    syncedPocketId: "pocket",
    deviceId: "device",
  });
  assert.deepEqual(plain(result), { ok: false, reason: "invalid-ownerless-activation-input" });
  assert.equal(explicitBad.counters.crypto, 0);
  assert.equal(explicitBad.counters.store, 0);
});

test("P287 canonical P284 builder creates exact device-staged drafts for both account paths", async () => {
  const existing = await assertSuccessfulStage("existing-unbound");
  const created = await assertSuccessfulStage("new-account");
  for (const item of [existing, created]) {
    assert.equal(item.draft.recoveryRoot.length > 0, true);
    assert.equal(item.draft.recoveryAuthorisation !== null, true);
    assert.equal(item.draft.recoveryPackage, null);
  }
});

test("P287 rejects caller payload substitution and malformed explicit ownerless shapes before effects", async () => {
  for (const options of [
    ownerlessOptions("existing-unbound", { payload: { injected: true } }),
    ownerlessOptions("other"),
    { activationMode: "ownerless-first-create", accountPath: "new-account",
      syncedPocketId: "pocket-only" },
  ]) {
    const harness = createHarness();
    const result = await harness.orchestrator.activate(harness.dependencies, options);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid-ownerless-activation-input");
    assert.equal(harness.counters.crypto, 0);
    assert.equal(harness.counters.store, 0);
    assert.equal(harness.counters.account, 0);
    assert.equal(harness.counters.remote, 0);
  }
});

test("P287 fails closed before crypto/store when canonical ownerless or first-use owner is absent", async () => {
  const missingContract = createHarness({ ownerless: false });
  assert.deepEqual(plain(await missingContract.orchestrator.activate(
    missingContract.dependencies,
    ownerlessOptions()
  )), { ok: false, reason: "ownerless-contract-unavailable" });
  assert.equal(missingContract.counters.crypto, 0);
  assert.equal(missingContract.counters.store, 0);

  const missingFirstUse = createHarness({ firstUse: false });
  assert.deepEqual(plain(await missingFirstUse.orchestrator.activate(
    missingFirstUse.dependencies,
    ownerlessOptions()
  )), { ok: false, reason: "ownerless-first-use-unavailable" });
  assert.equal(missingFirstUse.counters.crypto, 0);
  assert.equal(missingFirstUse.counters.store, 0);
});

test("P287 ownerless guard ignores transient none-owner identity but fails on semantic target change", async () => {
  const transient = createHarness({
    target(count) {
      return { ownerKind: "none", continuityId: `ephemeral-none-${count}` };
    },
  });
  const success = await transient.orchestrator.activate(
    transient.dependencies,
    ownerlessOptions()
  );
  assert.equal(success.ok, true);
  assert.ok(transient.counters.captureTarget > 5);

  const changedOwner = createHarness({
    target(count) {
      return count < 4
        ? { ownerKind: "none", continuityId: `none-${count}` }
        : { ownerKind: "json", continuityId: "json-now-owns-it" };
    },
  });
  const staleOwner = await changedOwner.orchestrator.activate(
    changedOwner.dependencies,
    ownerlessOptions()
  );
  assert.equal(staleOwner.ok, false);
  assert.equal(staleOwner.reason, "ownerless-target-stale");
  assert.equal("sourceOwnerPreserved" in staleOwner, false);
  assert.equal(changedOwner.counters.account, 0);
  assert.equal(changedOwner.counters.remote, 0);

  const nonReplaceable = createHarness({
    replaceable(_target, count) { return count < 4; },
  });
  const staleReplacement = await nonReplaceable.orchestrator.activate(
    nonReplaceable.dependencies,
    ownerlessOptions()
  );
  assert.equal(staleReplacement.ok, false);
  assert.equal(staleReplacement.reason, "ownerless-target-stale");
  assert.equal("sourceOwnerPreserved" in staleReplacement, false);

  const captureFailure = createHarness({
    target() { throw new Error("synthetic target capture failure"); },
  });
  const staleCapture = await captureFailure.orchestrator.activate(
    captureFailure.dependencies,
    ownerlessOptions()
  );
  assert.deepEqual(plain(staleCapture), { ok: false, reason: "ownerless-target-stale" });
});

test("P287 successful local staging performs zero account, remote, Recovery Copy or adoption work", async () => {
  const { harness, result } = await assertSuccessfulStage("existing-unbound");
  assert.equal(harness.counters.account, 0);
  assert.equal(harness.counters.remote, 0);
  assert.equal(JSON.stringify(result).includes("source"), false);
  assert.equal(JSON.stringify(result).includes("recovery"), false);
  assert.equal(JSON.stringify(result).includes("prf"), false);
  assert.equal(JSON.stringify(result).includes("content"), false);
  assert.equal(JSON.stringify(result).includes("key"), false);
});

test("P287 remains dormant below production runtime and UI composition", () => {
  const activation = source(ACTIVATION);
  assert.equal((source("index.html").match(/pocket-sync-ownerless-activation-draft\.js/g) || []).length, 1);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.match(source("js/pocket-sync-browser-runtime.js"), /startOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /function\s+(?:activateOwnerless|resumeOwnerless|findOwnerlessActivation)\s*\(/);
  assert.doesNotMatch(source("index.html"), /New Synced Pocket/);
  assert.match(activation, /global\.PocketSyncOwnerlessActivationDraft/);
  assert.match(activation, /global\.PocketFirstUseDocument/);
  assert.doesNotMatch(activation, /readSyncedPocket/);
  assert.doesNotMatch(activation, /function\s+(?:activateV2|stageOwnerless|prepareOwnerless)\s*\(/);
});
