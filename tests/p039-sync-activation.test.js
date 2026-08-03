"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const {
  createSharedDeviceStoreState,
  createMemoryDeviceStoreDriver,
} = require("./helpers/p030-memory-device-store-driver.js");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-sync-activation.js";
const ORIGIN = "https://sync.pocket.example";
const NOW = Date.parse("2039-01-01T00:00:00.000Z");
const READABLE = "P039-READABLE-POCKET-MUST-STAY-LOCAL";
const ROOT_SENTINEL = "P039-RAW-RECOVERY-ROOT";

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

function loadProduction(extra = {}) {
  const context = Object.assign({
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
  }, extra);
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-crypto.js",
    "js/pocket-sync-device-store.js",
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-remote-client.js",
    MODULE,
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    context,
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    deviceStore: context.PocketSyncDeviceStore,
    account: context.PocketSyncAccountClient,
    remote: context.PocketSyncRemoteClient,
    activation: context.PocketSyncActivation,
  };
}

function registrationCredential(prfAvailable = true) {
  if (prfAvailable) return fixtures.nativeRegistrationCredential();
  return {
    getClientExtensionResults() { return { prf: { enabled: false } }; },
    toJSON() {
      const value = fixtures.nativeRegistrationCredential().toJSON();
      value.clientExtensionResults = { prf: { enabled: false } };
      return value;
    },
  };
}

function createHarness(options = {}) {
  const production = loadProduction();
  const serviceDriver = createMemoryServiceStore();
  let serviceRandom = 0;
  const core = createServiceCore({
    store: serviceDriver.store,
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) {
        return {
          credentialId: input.credential.id,
          publicKey: b64(64, 201),
          publicKeyAlgorithm: -7,
          signCount: 0,
          transports: ["internal"],
          backupEligible: true,
          backedUp: false,
        };
      },
      async verifyAuthentication(input) {
        return {
          credentialId: input.credential.id,
          signCount: input.storedCredential.signCount + 1,
          backedUp: true,
        };
      },
    }),
    recoveryProofVerifier: Object.freeze({
      async verifyRecoveryProof() { return { verified: true }; },
    }),
    randomBytes(length) {
      serviceRandom += 1;
      return bytes(length, serviceRandom * 13);
    },
    now: () => NOW,
    trustedOrigin: ORIGIN,
    rpId: "sync.pocket.example",
    rpName: "Pocket",
    credentialAlgorithms: Object.freeze([-7]),
    ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000,
  });
  let sessionId = null;
  const remoteCalls = [];
  let ambiguousRoute = options.ambiguousRoute || null;
  const transport = Object.freeze({
    async request(route, body) {
      remoteCalls.push({ route, body: plain(body) });
      if (options.conflictRoute === route) {
        if (route === "conditionalUpload") {
          return { status: 409, body: {
            apiVersion: 1, ok: false, status: "conflict", wrote: false,
            conflict: true, actualRevision: body.expectedRevision + 1,
            operationId: body.operationId,
          } };
        }
        return { status: 409, body: {
          apiVersion: 1, ok: false, status: "conflict", wrote: false,
          conflict: true, actualKeySetVersion: body.expectedKeySetVersion + 1,
          operationId: body.operationId,
        } };
      }
      const result = await core[route]({
        context: {
          method: "POST",
          origin: ORIGIN,
          fetchSite: "same-origin",
          contentType: "application/json",
          sessionId,
        },
        body: plain(body),
      });
      if (ambiguousRoute === route) {
        ambiguousRoute = null;
        const error = new Error("synthetic ambiguous network result");
        error.retryable = true;
        throw error;
      }
      if (result.session?.action === "set") sessionId = result.session.sessionId;
      return { status: result.status, body: result.body };
    },
  });
  const accountService = production.remote.createAccountService({ transport, now: () => NOW });
  let passkeyCreates = 0;
  const accountClient = production.account.createClient({
    accountService,
    webAuthn: Object.freeze({
      async createCredential() {
        passkeyCreates += 1;
        return registrationCredential(options.prfAvailable !== false);
      },
      async getCredential() { throw new Error("not used"); },
    }),
    now: () => NOW,
  });
  const contentService = production.remote.createContentService({ transport });
  const envelopeService = production.remote.createEnvelopeService({ transport });
  const recoveryService = production.remote.createRecoveryService({ transport, now: () => NOW });
  const sharedDeviceState = createSharedDeviceStoreState();
  const deviceDriver = createMemoryDeviceStoreDriver(sharedDeviceState);
  const deviceStore = production.deviceStore.createStore(deviceDriver);
  let activationRandom = 0;
  const activationConfig = {
    securityContract: production.security,
    crypto: production.crypto,
    deviceStore,
    accountClient,
    contentService,
    envelopeService,
    recoveryService,
    randomBytes(length) {
      activationRandom += 1;
      if (options.rootSentinel === true && activationRandom === 14) {
        const value = new Uint8Array(length);
        value.set(Buffer.from(ROOT_SENTINEL).subarray(0, length));
        return value;
      }
      return bytes(length, activationRandom * 7);
    },
    now: () => NOW,
  };
  const orchestrator = production.activation.createActivationOrchestrator(activationConfig);
  const events = [];
  const copies = [];
  const adopted = [];
  let current = true;
  let copyShouldFail = options.copyFails === true;
  let adoptionShouldFail = options.adoptionFails === true;
  const sourceSession = Object.freeze({
    ownerKind: options.ownerKind || "json",
    continuityId: options.continuityId || "source-session-one",
    handle: Object.freeze({ secret: "source-handle" }),
  });
  const dependencies = Object.freeze({
    captureSourceSession() { events.push("capture"); return sourceSession; },
    isSourceSessionCurrent(session) { return current && session === sourceSession; },
    hasUnsavedSourceChanges() { return options.dirty === true; },
    async saveLocalSource() {
      events.push("source-save");
      return options.saveCancelled ? { ok: false, cancelled: true } : { ok: true };
    },
    async freezePayload() {
      events.push("freeze");
      return { schema: "portal.export.v1", nodes: [{ id: "one", label: READABLE }] };
    },
    async prepareRecoveryCopyDestination() {
      events.push("prepare-copy");
      return options.deferDestination ? { ok: false, deferred: true }
        : { ok: true, destination: Object.freeze({ kind: "synthetic-destination" }) };
    },
    async buildRecoveryPackage(input) {
      events.push("build-package");
      return production.security.buildRecoveryPackage({
        ...plain(input),
        checksum: "P039-CHECKSUM",
      });
    },
    async writeRecoveryCopy(input) {
      events.push("write-copy");
      copies.push(plain(input.recoveryPackage));
      return copyShouldFail ? { ok: false, cancelled: true } : { ok: true };
    },
    async adoptSyncedOwner(owner) {
      events.push("adopt");
      adopted.push(plain(owner));
      return adoptionShouldFail ? { ok: false } : { ok: true };
    },
  });
  return {
    ...production,
    core,
    serviceDriver,
    deviceStore,
    sharedDeviceState,
    orchestrator,
    activationConfig,
    dependencies,
    sourceSession,
    events,
    copies,
    adopted,
    remoteCalls,
    get passkeyCreates() { return passkeyCreates; },
    allowCopy() { copyShouldFail = false; },
    allowAdoption() { adoptionShouldFail = false; },
    staleSource() { current = false; },
  };
}

test("P039 module is one dormant, inert and exact frozen activation boundary", () => {
  let reads = 0;
  const environment = {};
  for (const name of ["crypto", "indexedDB", "localStorage", "sessionStorage", "fetch",
    "navigator", "document", "setTimeout", "setInterval", "Worker", "Date"]) {
    Object.defineProperty(environment, name, {
      get() { reads += 1; throw new Error(name); },
    });
  }
  const context = { Object, Array, Number, String, Boolean, JSON, Error, Promise };
  Object.assign(context, environment);
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  assert.doesNotThrow(() => vm.runInContext(source(MODULE), context, { filename: MODULE }));
  assert.equal(reads, 0);
  assert.deepEqual(Object.keys(context.PocketSyncActivation), ["POLICY", "createActivationOrchestrator"]);
  assert.equal(Object.isFrozen(context.PocketSyncActivation), true);
  assert.equal(Object.isFrozen(context.PocketSyncActivation.POLICY), true);
  assert.doesNotMatch(source("index.html"), /pocket-sync-activation\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-activation\.js/);
  assert.doesNotMatch(source("js/pocket-sync-contract.js"), /PocketSyncActivation/);
});

test("actual P029-P038 modules complete activation device-first and adopt last", async () => {
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.orchestrator), ["activate", "resume"]);
  assert.equal(Object.isFrozen(harness.orchestrator), true);
  assert.throws(
    () => harness.activation.createActivationOrchestrator({ ...harness.activationConfig, extra: true }),
    (error) => error.code === "activation-factory-invalid"
  );
  const missingFactoryField = { ...harness.activationConfig };
  delete missingFactoryField.crypto;
  assert.throws(
    () => harness.activation.createActivationOrchestrator(missingFactoryField),
    (error) => error.code === "activation-factory-invalid"
  );
  const result = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039",
    deviceId: "device-p039",
  });
  assert.equal(result.ok, true, JSON.stringify({ result, events: harness.events,
    remote: harness.remoteCalls.map((call) => call.route) }));
  assert.equal(result.reason, "activated");
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.recoveryVersion, 1);
  assert.deepEqual(Object.keys(result.owner), [
    "ownerKind", "activationId", "syncedPocketId", "deviceId",
    "confirmedRemoteRevision", "syncPending",
  ]);
  assert.equal(harness.passkeyCreates, 1);
  assert.equal(harness.adopted.length, 1);
  assert.deepEqual(harness.remoteCalls.map((call) => call.route), [
    "beginRegistration", "finishRegistration", "conditionalUpload",
    "addEnvelope", "addEnvelope", "initialiseRecovery",
  ]);
  assert.ok(harness.events.indexOf("write-copy") < harness.events.indexOf("adopt"));
  const raw = Array.from(harness.sharedDeviceState.records.values())[0];
  const rawText = JSON.stringify(raw);
  assert.doesNotMatch(rawText, new RegExp(READABLE));
  assert.doesNotMatch(rawText, /rootMaterial|pocket-recovery-package|accountLocator/);
  assert.equal(raw.activationDraft.record.format, "pocket.sync.content.opaque");
  const found = await harness.deviceStore.readActivation(result.activationId);
  assert.equal(found.draft.stage, "adopted");
  assert.equal(found.draft.recoveryRoot, null);
  assert.equal(found.draft.recoveryPackage, null);
  assert.equal(found.draft.registrationContinuation, null);
  assert.equal(found.draft.recoveryCopyStored, true);
  const serviceText = JSON.stringify(harness.serviceDriver.snapshot());
  assert.doesNotMatch(serviceText, new RegExp(READABLE));
  assert.doesNotMatch(serviceText, /rootMaterial|pocket-recovery-package/);
});

test("recovery-copy failure pauses safely and explicit resume reuses remote state and package", async () => {
  const harness = createHarness({ copyFails: true });
  const paused = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-paused",
    deviceId: "device-p039-paused",
  });
  assert.equal(paused.ok, false);
  assert.equal(paused.reason, "recovery-copy-not-stored");
  assert.equal(paused.resumable, true);
  assert.equal(harness.adopted.length, 0);
  const remoteCount = harness.remoteCalls.length;
  const firstPackage = JSON.stringify(harness.copies[0]);
  harness.allowCopy();
  const resumed = await harness.orchestrator.resume(harness.dependencies, {
    activationId: paused.activationId,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.remoteCalls.length, remoteCount);
  assert.equal(JSON.stringify(harness.copies[1]), firstPackage);
  assert.equal(harness.passkeyCreates, 1);
  assert.equal(harness.adopted.length, 1);
});

test("temporary recovery material exists only inside the encrypted draft until copy confirmation", async () => {
  const harness = createHarness({ copyFails: true, rootSentinel: true });
  const paused = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-encrypted-root",
    deviceId: "device-p039-encrypted-root",
  });
  const found = await harness.deviceStore.readActivation(paused.activationId);
  assert.equal(Buffer.from(found.draft.recoveryRoot, "base64url").byteLength, 32);
  assert.equal(found.draft.recoveryPackage.rootMaterial, found.draft.recoveryRoot);
  const raw = Array.from(harness.sharedDeviceState.records.values())[0];
  const rawText = JSON.stringify(raw);
  assert.doesNotMatch(rawText, new RegExp(found.draft.recoveryRoot));
  assert.doesNotMatch(rawText, /rootMaterial|pocket-recovery-package/);
  assert.doesNotMatch(JSON.stringify(paused), /root|package|locator|ciphertext/i);
});

test("PRF absence is an explicit durable skip and does not block mandatory recovery", async () => {
  const harness = createHarness({ prfAvailable: false });
  const result = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-no-prf",
    deviceId: "device-p039-no-prf",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(harness.remoteCalls.map((call) => call.route), [
    "beginRegistration", "finishRegistration", "conditionalUpload",
    "addEnvelope", "initialiseRecovery",
  ]);
  const found = await harness.deviceStore.readActivation(result.activationId);
  assert.equal(found.draft.prfStatus, "skipped");
  assert.equal(found.draft.prfEnvelope, null);
  assert.equal(found.draft.stage, "adopted");
});

test("destination deferral and source Save cancellation stop before keys, storage, remote calls or adoption", async (t) => {
  for (const scenario of [
    { name: "deferred destination", options: { deferDestination: true }, reason: "recovery-copy-destination-deferred" },
    { name: "cancelled source Save", options: { dirty: true, saveCancelled: true }, reason: "source-save-cancelled" },
  ]) await t.test(scenario.name, async () => {
    const harness = createHarness(scenario.options);
    const result = await harness.orchestrator.activate(harness.dependencies, {
      syncedPocketId: `pocket-${scenario.name.replaceAll(" ", "-")}`,
      deviceId: "device-p039-stop",
    });
    assert.equal(result.reason, scenario.reason);
    assert.equal(harness.remoteCalls.length, 0);
    assert.equal(harness.sharedDeviceState.records.size, 0);
    assert.equal(harness.passkeyCreates, 0);
    assert.equal(harness.adopted.length, 0);
  });
});

test("source-session replacement and malformed resume state fail closed without adoption", async () => {
  const harness = createHarness({ copyFails: true });
  const paused = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-stale",
    deviceId: "device-p039-stale",
  });
  harness.staleSource();
  const result = await harness.orchestrator.resume(harness.dependencies, {
    activationId: paused.activationId,
  });
  assert.equal(result.reason, "source-session-changed");
  assert.equal(harness.adopted.length, 0);
});

test("an impossible encrypted draft fails closed without repair, remote work or adoption", async () => {
  const harness = createHarness({ copyFails: true });
  const paused = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-impossible-draft",
    deviceId: "device-p039-impossible-draft",
  });
  const found = await harness.deviceStore.readActivation(paused.activationId);
  const impossibleDraft = plain(found.draft);
  impossibleDraft.stage = "ready-for-adoption";
  const encrypted = await harness.crypto.sealContent(
    impossibleDraft,
    found.record.deviceWrappingKey,
    found.record.activationDraft.context
  );
  const malformedRecord = structuredClone(found.record);
  malformedRecord.activationDraft.record = encrypted;
  harness.sharedDeviceState.records.set(malformedRecord.syncedPocketId, malformedRecord);
  const before = JSON.stringify(malformedRecord);
  const remoteCount = harness.remoteCalls.length;

  const result = await harness.orchestrator.resume(harness.dependencies, {
    activationId: paused.activationId,
  });

  assert.equal(result.reason, "activation-state-invalid");
  assert.equal(result.resumable, false);
  assert.equal(harness.remoteCalls.length, remoteCount);
  assert.equal(harness.adopted.length, 0);
  assert.equal(JSON.stringify(harness.sharedDeviceState.records.get(malformedRecord.syncedPocketId)), before);
});

test("ambiguous content commit resumes with one exact idempotent retry and no duplicate state", async () => {
  const harness = createHarness({ ambiguousRoute: "conditionalUpload" });
  const first = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-ambiguous",
    deviceId: "device-p039-ambiguous",
  });
  assert.equal(first.reason, "initial-remote-unavailable");
  assert.equal(first.resumable, true);
  const resumed = await harness.orchestrator.resume(harness.dependencies, {
    activationId: first.activationId,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const uploads = harness.remoteCalls.filter((call) => call.route === "conditionalUpload");
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].body.attemptKind, "new-change");
  assert.equal(uploads[1].body.attemptKind, "idempotent-retry");
  assert.equal(uploads[0].body.operationId, uploads[1].body.operationId);
  assert.equal(harness.passkeyCreates, 1);
});

test("ambiguous passkey finish resumes the safe P031 continuation without a second credential", async () => {
  const harness = createHarness({ ambiguousRoute: "finishRegistration" });
  const first = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-account-ambiguous",
    deviceId: "device-p039-account-ambiguous",
  });
  assert.equal(first.reason, "account-registration-failed");
  assert.equal(first.resumable, true);
  assert.equal(harness.passkeyCreates, 1);
  const resumed = await harness.orchestrator.resume(harness.dependencies, {
    activationId: first.activationId,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.passkeyCreates, 1);
  const finishes = harness.remoteCalls.filter((call) => call.route === "finishRegistration");
  assert.equal(finishes.length, 2);
  assert.equal(finishes[0].body.credential.id, finishes[1].body.credential.id);
});

test("ambiguous envelope and recovery mutations use exact explicit idempotent retries", async (t) => {
  for (const route of ["addEnvelope", "initialiseRecovery"]) {
    await t.test(route, async () => {
      const harness = createHarness({ ambiguousRoute: route });
      const first = await harness.orchestrator.activate(harness.dependencies, {
        syncedPocketId: `pocket-p039-${route}`,
        deviceId: `device-p039-${route}`,
      });
      assert.equal(first.resumable, true);
      const resumed = await harness.orchestrator.resume(harness.dependencies, {
        activationId: first.activationId,
      });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      const calls = harness.remoteCalls.filter((call) => call.route === route);
      assert.ok(calls.length >= 2);
      assert.equal(calls[0].body.attemptKind, "new-change");
      assert.equal(calls[1].body.attemptKind, "idempotent-retry");
      assert.equal(calls[0].body.operationId, calls[1].body.operationId);
      assert.equal(harness.passkeyCreates, 1);
    });
  }
});

test("owner adoption failure leaves ready encrypted state and resume performs adoption only", async () => {
  const harness = createHarness({ adoptionFails: true });
  const first = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-adoption",
    deviceId: "device-p039-adoption",
  });
  assert.equal(first.reason, "owner-adoption-failed");
  assert.equal(first.resumable, true);
  const remoteCount = harness.remoteCalls.length;
  const copyCount = harness.copies.length;
  harness.allowAdoption();
  const resumed = await harness.orchestrator.resume(harness.dependencies, {
    activationId: first.activationId,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(harness.remoteCalls.length, remoteCount);
  assert.equal(harness.copies.length, copyCount);
  assert.equal(harness.passkeyCreates, 1);
  assert.equal(harness.adopted.length, 2);
});

test("an existing remote revision produces a durable conflict and never adopts", async () => {
  const harness = createHarness({ conflictRoute: "conditionalUpload" });
  const result = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-conflict",
    deviceId: "device-p039-conflict",
  });
  assert.equal(result.reason, "initial-remote-conflict");
  assert.equal(result.conflict, true);
  assert.equal(result.resumable, false);
  assert.equal(harness.adopted.length, 0);
  assert.equal(harness.remoteCalls.some((call) => call.route === "addEnvelope"), false);
  const found = await harness.deviceStore.readActivation(result.activationId);
  assert.equal(found.draft.pendingOperation, "content-conflict");
  assert.equal(found.record.remote.conflict.actualRevision, 1);
});

test("resume after completed adoption is a safe local replay with no new work", async () => {
  const harness = createHarness();
  const first = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "pocket-p039-adopted-replay",
    deviceId: "device-p039-adopted-replay",
  });
  const remoteCount = harness.remoteCalls.length;
  const eventCount = harness.events.length;
  const second = await harness.orchestrator.resume(harness.dependencies, {
    activationId: first.activationId,
  });
  assert.equal(second.ok, true);
  assert.equal(harness.remoteCalls.length, remoteCount);
  assert.equal(harness.adopted.length, 1);
  assert.equal(harness.events.slice(eventCount).includes("write-copy"), false);
});

test("dirty JSON and Vault owners save once before the one payload freeze", async (t) => {
  for (const ownerKind of ["json", "vault"]) await t.test(ownerKind, async () => {
    const harness = createHarness({ dirty: true, ownerKind });
    const result = await harness.orchestrator.activate(harness.dependencies, {
      syncedPocketId: `pocket-p039-${ownerKind}`,
      deviceId: `device-p039-${ownerKind}`,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(harness.events.filter((event) => event === "source-save").length, 1);
    assert.equal(harness.events.filter((event) => event === "freeze").length, 1);
    assert.ok(harness.events.indexOf("source-save") < harness.events.indexOf("freeze"));
  });
});

test("invalid calls fail before seams and exported success/failure values contain no secrets", async () => {
  const harness = createHarness();
  const bad = await harness.orchestrator.activate(harness.dependencies, {
    syncedPocketId: "",
    deviceId: "device",
  });
  assert.equal(bad.reason, "invalid-activation-input");
  assert.equal(harness.events.length, 0);
  const unsupported = await harness.orchestrator.activate(Object.freeze({
    ...harness.dependencies,
    captureSourceSession() { return { ownerKind: "synced", continuityId: "not-a-source" }; },
  }), {
    syncedPocketId: "pocket-p039-unsupported",
    deviceId: "device-p039-unsupported",
  });
  assert.equal(unsupported.reason, "unsupported-source-owner");
  assert.equal(harness.remoteCalls.length, 0);
  const text = source(MODULE);
  assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|fetch\s*\(|setTimeout|setInterval|Worker|console\./i);
  assert.doesNotMatch(source("package.json"), /p039|sync-activation/);
});
