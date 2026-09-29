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
const NOW = Date.parse("2036-01-01T00:00:00.000Z");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(length, seed = 1) {
  return Buffer.from(bytes(length, seed)).toString("base64url");
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
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
    "js/pocket-sync-activation.js",
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    deviceStoreModule: context.PocketSyncDeviceStore,
    activation: context.PocketSyncActivation,
  };
}

function createHarness(ownerKind, options = {}) {
  const production = loadProduction();
  const sharedState = createSharedDeviceStoreState();
  const driver = createMemoryDeviceStoreDriver(sharedState);
  const store = production.deviceStoreModule.createStore(driver);
  const events = [];
  let current = true;
  let randomSequence = 0;
  let stagedDraft = null;

  const crypto = Object.freeze(Object.assign({}, production.crypto, {
    async sealContent(value, ...rest) {
      if (value?.kind === "pocket.sync.activation-draft"
          && value.schemaVersion === 1
          && value.stage === "device-staged"
          && stagedDraft === null) {
        stagedDraft = plain(value);
      }
      return production.crypto.sealContent(value, ...rest);
    },
  }));

  const deviceStore = Object.freeze({
    FORMAT: production.deviceStoreModule.FORMAT,
    open: (...args) => store.open(...args),
    readPocket: (...args) => store.readPocket(...args),
    readActivation: (...args) => store.readActivation(...args),
    createPocket: (...args) => store.createPocket(...args),
    replacePocket: (...args) => store.replacePocket(...args),
    reservePocketEncryptionUsage: (...args) => store.reservePocketEncryptionUsage(...args),
  });

  const accountClient = Object.freeze({
    async registerPasskey(input, onCredentialReady) {
      events.push("account-register");
      const evaluationInput = b64(32, 71);
      const continuation = {
        apiVersion: 1,
        operationId: input.operationId,
        ceremonyId: "p286-ceremony",
        deviceId: input.deviceId,
        prfEvaluationInput: evaluationInput,
        credential: { id: "p286-credential" },
      };
      await onCredentialReady(Object.freeze({
        continuation,
        prf: Object.freeze({ status: "unavailable", evaluationInput }),
      }));
      return Object.freeze({
        ok: true,
        accountAuthenticated: true,
        contentUnlocked: false,
        accountId: "p286-account",
        credentialId: "p286-credential",
        credentialVersion: 1,
        accountPolicyVersion: 1,
        prf: Object.freeze({ status: "unavailable", evaluationInput }),
      });
    },
    async finishRegistration() { throw new Error("not expected"); },
    async authenticatePasskey() { throw new Error("not expected"); },
  });

  const contentService = Object.freeze({
    async conditionalUpload() {
      events.push("content");
      return Object.freeze({ status: "committed", revision: 1 });
    },
  });
  const envelopeService = Object.freeze({
    async addEnvelope(request) {
      events.push(`envelope:${request.envelope.envelopeKind}`);
      return Object.freeze({
        status: "committed",
        keySetVersion: request.expectedKeySetVersion + 1,
        ...(request.envelope.envelopeKind === "device" ? {
          masterKeyGeneration: 1,
          masterKeyContentEncryptionLimit: 2 ** 20,
        } : {}),
      });
    },
  });
  const recoveryService = Object.freeze({
    async initialiseRecovery(request) {
      events.push("recovery");
      return Object.freeze({
        status: "committed",
        keySetVersion: request.expectedKeySetVersion + 1,
        recoveryVersion: 1,
        recoveryCopyRequired: true,
        accountLocator: "p286-account-locator",
      });
    },
  });

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

  const sourceSession = Object.freeze({
    ownerKind,
    continuityId: `p286-${ownerKind}-source`,
  });
  const dependencies = Object.freeze({
    captureSourceSession() {
      events.push("capture");
      return sourceSession;
    },
    isSourceSessionCurrent(session) {
      events.push("current");
      return current && session === sourceSession;
    },
    hasUnsavedSourceChanges() {
      events.push("dirty");
      return options.dirty === true;
    },
    async saveLocalSource() {
      events.push("source-save");
      if (options.saveThrows) throw new Error("synthetic save failure");
      return options.saveCancelled
        ? { ok: false, cancelled: true }
        : { ok: true };
    },
    async freezePayload() {
      events.push("freeze");
      return { schema: "portal.export.v1", nodes: [{ id: "one", ownerKind }] };
    },
    async prepareRecoveryCopyDestination() {
      events.push("prepare-copy");
      return { ok: true, destination: { id: "p286-copy" } };
    },
    async buildRecoveryPackage(input) {
      events.push("build-package");
      return production.security.buildRecoveryPackage({
        ...plain(input),
        checksum: "P286-CHECKSUM",
      });
    },
    async writeRecoveryCopy() {
      events.push("write-copy");
      return { ok: true };
    },
    async adoptSyncedOwner() {
      events.push("adopt");
      current = false;
      return { ok: true };
    },
  });

  return {
    production,
    orchestrator,
    store,
    dependencies,
    events,
    get stagedDraft() { return stagedDraft; },
  };
}

const EXACT_V1_DRAFT_FIELDS = [
  "kind", "schemaVersion", "activationId", "stage", "sourceOwnerKind",
  "sourceContinuityId", "syncedPocketId", "deviceId", "ids", "content",
  "deviceEnvelope", "prfEnvelope", "prfStatus", "recoveryEnvelope",
  "recoveryVerifier", "recoveryAuthorisation", "recoveryRoot", "recoveryPackage",
  "registrationContinuation", "account", "confirmedRemoteRevision",
  "keySetVersion", "recoveryVersion", "accountLocator", "pendingOperation",
  "sourceSaved", "recoveryCopyStored", "adopted", "createdAt", "updatedAt",
];

for (const ownerKind of ["json", "vault"]) {
  test(`P286 preserves the full v1 ${ownerKind} path, order and exact first durable draft`, async () => {
    const harness = createHarness(ownerKind, { dirty: true });
    const result = await harness.orchestrator.activate(harness.dependencies, {
      syncedPocketId: `p286-${ownerKind}-pocket`,
      deviceId: `p286-${ownerKind}-device`,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.reason, "activated");

    const meaningful = harness.events.filter((event) => event !== "current");
    assert.deepEqual(meaningful, [
      "capture",
      "dirty",
      "source-save",
      "freeze",
      "prepare-copy",
      "account-register",
      "content",
      "envelope:device",
      "recovery",
      "build-package",
      "write-copy",
      "adopt",
    ]);

    const draft = harness.stagedDraft;
    assert.notEqual(draft, null);
    assert.deepEqual(Object.keys(draft), EXACT_V1_DRAFT_FIELDS);
    assert.equal(draft.kind, "pocket.sync.activation-draft");
    assert.equal(draft.schemaVersion, 1);
    assert.equal(draft.stage, "device-staged");
    assert.equal(draft.sourceOwnerKind, ownerKind);
    assert.equal(draft.sourceContinuityId, `${ownerKind}:p286-${ownerKind}-source`);
    assert.equal(draft.sourceSaved, true);
    assert.equal(draft.account, null);
    assert.equal(draft.pendingOperation, null);
    assert.equal(draft.confirmedRemoteRevision, 0);
    assert.equal(draft.recoveryCopyStored, false);
    assert.equal(draft.adopted, false);
    assert.equal(Object.prototype.hasOwnProperty.call(draft, "activationMode"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(draft, "accountPath"), false);
  });
}

test("P286 preserves dirty-source Save cancellation and failure before payload/local material", async () => {
  for (const [options, reason] of [
    [{ dirty: true, saveCancelled: true }, "source-save-cancelled"],
    [{ dirty: true, saveThrows: true }, "local-crypto-failed"],
  ]) {
    const harness = createHarness("json", options);
    const result = await harness.orchestrator.activate(harness.dependencies, {
      syncedPocketId: "p286-save-pocket",
      deviceId: "p286-save-device",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.deepEqual(harness.events.filter((event) => event !== "current"), [
      "capture", "dirty", "source-save",
    ]);
    assert.equal(harness.stagedDraft, null);
  }
});
