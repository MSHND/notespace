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
const NOW = Date.parse("2036-05-01T00:00:00.000Z");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function bytes(length, seed = 1) {
  return Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

const PRF_INPUT = b64(bytes(32, 9));
const CREDENTIAL_ID = b64(bytes(32, 121));

function loadProduction() {
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
      return `${prefix}_p294_${nextNodeId}`;
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
    FIRST_USE,
    OWNERLESS,
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

function registrationContinuation(input) {
  return Object.freeze({
    apiVersion: 1,
    operationId: input.operationId,
    ceremonyId: "ceremony-p294",
    deviceId: input.deviceId,
    prfEvaluationInput: PRF_INPUT,
    credential: Object.freeze({ id: CREDENTIAL_ID }),
  });
}

function registrationResult() {
  return Object.freeze({
    ok: true,
    accountAuthenticated: true,
    contentUnlocked: false,
    accountId: "account-new-p294",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: Object.freeze({
      status: "unavailable",
      evaluationInput: PRF_INPUT,
    }),
  });
}

function existingReady() {
  return Object.freeze({
    accountPath: "existing-unbound",
    accountId: "account-existing-p294",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: Object.freeze({
      status: "unavailable",
      evaluationInput: PRF_INPUT,
    }),
  });
}

function createHarness(options = {}) {
  const production = loadProduction();
  const shared = createSharedDeviceStoreState();
  const rawStore = production.deviceStoreModule.createStore(
    createMemoryDeviceStoreDriver(shared)
  );
  const counters = {
    register: 0,
    finish: 0,
    authenticate: 0,
    content: 0,
    envelope: 0,
    recovery: 0,
    bridge: 0,
    captureTarget: 0,
  };
  const envelopeCalls = [];
  const contentCalls = [];
  const accountClient = options.accountPath === "new-account"
    ? Object.freeze({
      async authenticatePasskey() {
        counters.authenticate += 1;
        throw new Error("forbidden authenticate");
      },
      async finishRegistration() {
        counters.finish += 1;
        throw new Error("unexpected separate finish");
      },
      async registerPasskey(input, onCredentialReady) {
        counters.register += 1;
        await onCredentialReady(Object.freeze({
          continuation: registrationContinuation(input),
          prf: Object.freeze({
            status: "unavailable",
            evaluationInput: PRF_INPUT,
          }),
        }));
        return registrationResult();
      },
    })
    : Object.freeze({
      async registerPasskey() {
        counters.register += 1;
        throw new Error("forbidden register");
      },
      async finishRegistration() {
        counters.finish += 1;
        throw new Error("forbidden finish");
      },
      async authenticatePasskey() {
        counters.authenticate += 1;
        throw new Error("forbidden authenticate");
      },
    });

  const deviceStore = Object.freeze({
    FORMAT: production.deviceStoreModule.FORMAT,
    open: (...args) => rawStore.open(...args),
    readPocket: (...args) => rawStore.readPocket(...args),
    readActivation: (...args) => rawStore.readActivation(...args),
    createPocket: (...args) => rawStore.createPocket(...args),
    replacePocket: (...args) => rawStore.replacePocket(...args),
    reservePocketEncryptionUsage: (...args) => rawStore.reservePocketEncryptionUsage(...args),
  });

  let randomCounter = 0;
  const orchestrator = production.activation.createActivationOrchestrator({
    securityContract: production.security,
    crypto: production.crypto,
    deviceStore,
    accountClient,
    contentService: Object.freeze({
      async conditionalUpload(input) {
        counters.content += 1;
        contentCalls.push(plain(input));
        if (typeof options.contentUpload === "function") {
          return options.contentUpload(input, counters.content);
        }
        return Object.freeze({
          conflict: false,
          status: "committed",
          revision: 1,
        });
      },
    }),
    envelopeService: Object.freeze({
      async addEnvelope(input) {
        counters.envelope += 1;
        envelopeCalls.push(plain(input));
        if (typeof options.envelopeAdd === "function") {
          return options.envelopeAdd(input, counters.envelope);
        }
        throw new Error("unexpected envelope publication");
      },
    }),
    recoveryService: Object.freeze({
      async initialiseRecovery() {
        counters.recovery += 1;
        throw new Error("forbidden recovery");
      },
    }),
    randomBytes(length) {
      randomCounter += 1;
      return bytes(length, randomCounter * 7);
    },
    now: () => NOW,
  });

  const target = () => {
    counters.captureTarget += 1;
    if (typeof options.target === "function") {
      return options.target(counters.captureTarget);
    }
    return { ownerKind: "none", transientId: `none-${counters.captureTarget}` };
  };
  const replaceable = (value) => typeof options.replaceable === "function"
    ? options.replaceable(value, counters.captureTarget)
    : true;

  return {
    production,
    rawStore,
    orchestrator,
    counters,
    contentCalls,
    envelopeCalls,
    activateDependencies: Object.freeze({
      captureTarget: target,
      isTargetReplaceable: replaceable,
    }),
    resumeDependencies(bridge = async () => {
      counters.bridge += 1;
      throw new Error("unexpected existing-account bridge");
    }) {
      return Object.freeze({
        captureTarget: target,
        isTargetReplaceable: replaceable,
        async buildRecoveryPackage() {
          throw new Error("unexpected recovery package build before P297 boundary");
        },
        async prepareRecoveryCopyDestination() {
          throw new Error("unexpected Recovery Copy destination before P298 boundary");
        },
        async writeRecoveryCopy() {
          throw new Error("unexpected Recovery Copy write before P298 boundary");
        },
        async withExistingAccountReady(consumer) {
          counters.bridge += 1;
          return bridge(consumer);
        },
      });
    },
  };
}

function activateOptions(accountPath, suffix = "one") {
  return {
    activationMode: "ownerless-first-create",
    accountPath,
    syncedPocketId: `pocket-p294-${accountPath}-${suffix}`,
    deviceId: `device-p294-${accountPath}-${suffix}`,
  };
}

function resumeOptions(activationId) {
  return {
    activationMode: "ownerless-first-create",
    activationId,
  };
}

async function readCanonical(harness, activationId) {
  const found = await harness.rawStore.readActivation(activationId);
  assert.notEqual(found, null);
  const draft = harness.production.ownerless.validate(found.draft, {
    securityContract: harness.production.security,
    crypto: harness.production.crypto,
  });
  return { found, draft };
}

async function toContentCommitted(harness, accountPath, suffix = "one") {
  const staged = await harness.orchestrator.activate(
    harness.activateDependencies,
    activateOptions(accountPath, suffix)
  );
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(staged.stage, "device-staged");

  const accountReady = accountPath === "existing-unbound"
    ? await harness.orchestrator.resume(
      harness.resumeDependencies(async (consumer) => consumer(existingReady())),
      resumeOptions(staged.activationId)
    )
    : await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(staged.activationId)
    );

  assert.equal(accountReady.ok, true, JSON.stringify(accountReady));
  assert.equal(accountReady.reason, "ownerless-account-ready");
  assert.equal(accountReady.stage, "account-ready");
  assert.equal(harness.counters.content, 0);
  assert.equal(harness.counters.envelope, 0);

  const contentCommitted = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(contentCommitted.ok, true, JSON.stringify(contentCommitted));
  assert.equal(contentCommitted.reason, "ownerless-content-committed");
  assert.equal(contentCommitted.stage, "content-committed");
  assert.equal(contentCommitted.confirmedRemoteRevision, 1);
  assert.equal(harness.counters.content, 1);
  assert.equal(harness.counters.envelope, 0, "P293 must still hard-stop before envelope publication");

  const canonical = await readCanonical(harness, staged.activationId);
  assert.equal(canonical.draft.stage, "content-committed");
  assert.equal(canonical.draft.confirmedRemoteRevision, 1);
  assert.equal(canonical.draft.keySetVersion, 0);
  assert.equal(canonical.draft.pendingOperation, null);
  assert.equal(canonical.draft.recoveryVersion, 0);
  assert.equal(canonical.draft.recoveryCopyStored, false);
  assert.equal(canonical.draft.adopted, false);
  assert.equal(canonical.found.record.remote.confirmedRevision, 1);
  assert.equal(canonical.found.record.remote.pending, null);
  assert.equal(canonical.found.record.remote.conflict, null);
  return { staged, canonical };
}

function assertSafeDeviceCommittedResult(result, accountPath) {
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId", "deviceId",
    "stage", "locallyDurable", "remotelyCommitted", "confirmedRemoteRevision",
    "keySetVersion",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ownerless-device-envelope-committed");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "device-envelope-committed");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.keySetVersion, 1);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /accountId|credentialId|prf|encryptedEnvelope|recoveryRoot|recoveryAuthorisation/);
}

function successEnvelopeResponse() {
  return Object.freeze({
    conflict: false,
    status: "committed",
    keySetVersion: 1,
    masterKeyGeneration: 1,
    masterKeyContentEncryptionLimit: 2 ** 20,
  });
}

test("P294 both ownerless account paths converge through the one shared device-envelope commit and hard-stop there", async () => {
  for (const accountPath of ["existing-unbound", "new-account"]) {
    const harness = createHarness({
      accountPath,
      envelopeAdd: async () => successEnvelopeResponse(),
    });
    const ready = await toContentCommitted(harness, accountPath, "success");
    const before = ready.canonical.draft;
    const envelope = plain(before.deviceEnvelope);
    const ids = plain(before.ids);
    const accountCallsBefore = {
      bridge: harness.counters.bridge,
      register: harness.counters.register,
      finish: harness.counters.finish,
      authenticate: harness.counters.authenticate,
    };

    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assertSafeDeviceCommittedResult(result, accountPath);
    assert.equal(harness.counters.envelope, 1);
    assert.equal(harness.counters.content, 1, "content must not upload again");
    assert.equal(harness.counters.recovery, 0);
    assert.deepEqual({
      bridge: harness.counters.bridge,
      register: harness.counters.register,
      finish: harness.counters.finish,
      authenticate: harness.counters.authenticate,
    }, accountCallsBefore, "device-envelope step must repeat no account ceremony");

    const call = harness.envelopeCalls[0];
    assert.deepEqual(call, {
      apiVersion: 1,
      operationId: ids.deviceEnvelopeOperationId,
      logicalChangeId: ids.deviceEnvelopeLogicalChangeId,
      attemptKind: "new-change",
      syncedPocketId: before.syncedPocketId,
      expectedKeySetVersion: 0,
      envelope,
    });

    const committed = await readCanonical(harness, ready.staged.activationId);
    assert.equal(committed.draft.stage, "device-envelope-committed");
    assert.equal(committed.draft.keySetVersion, 1);
    assert.equal(committed.draft.pendingOperation, null);
    assert.equal(committed.draft.confirmedRemoteRevision, 1);
    assert.equal(committed.draft.recoveryVersion, 0);
    assert.equal(committed.draft.recoveryCopyStored, false);
    assert.equal(committed.draft.adopted, false);
    assert.equal(committed.found.record.remote.confirmedRevision, 1);
    assert.equal(committed.found.record.remote.pending, null);
    assert.equal(committed.found.record.remote.conflict, null);
    assert.equal(committed.found.record.usage.masterKeyGeneration, 1);
    assert.equal(committed.found.record.usage.masterKeyContentEncryptionLimit, 2 ** 20);

    assert.equal(
      harness.counters.envelope,
      1,
      "the P294 device-envelope resume itself must publish exactly one envelope"
    );
    assert.equal(
      harness.counters.recovery,
      0,
      "the P294 device-envelope resume itself must still stop before recovery"
    );
  }
});

test("P294 ambiguous device-envelope attempt is durably resumable and only a later explicit resume idempotently retries", async () => {
  let callNumber = 0;
  const harness = createHarness({
    accountPath: "existing-unbound",
    envelopeAdd: async () => {
      callNumber += 1;
      if (callNumber === 1) throw new Error("synthetic ambiguous envelope transport loss");
      return successEnvelopeResponse();
    },
  });
  const ready = await toContentCommitted(harness, "existing-unbound", "retry");
  const draft = ready.canonical.draft;
  const envelope = plain(draft.deviceEnvelope);

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(first.ok, false);
  assert.equal(first.reason, "device-envelope-failed");
  assert.equal(first.locallyDurable, true);
  assert.equal(first.remotelyCommitted, true);
  assert.equal(first.resumable, true);
  assert.equal(harness.counters.envelope, 1, "zero automatic retry required");

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "content-committed");
  assert.equal(pending.draft.keySetVersion, 0);
  assert.equal(pending.draft.pendingOperation, "device-envelope");
  assert.equal(pending.draft.confirmedRemoteRevision, 1);
  assert.equal(pending.found.record.remote.confirmedRevision, 1);

  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assertSafeDeviceCommittedResult(second, "existing-unbound");
  assert.equal(harness.counters.envelope, 2);
  assert.deepEqual(harness.envelopeCalls.map((call) => ({
    operationId: call.operationId,
    logicalChangeId: call.logicalChangeId,
    attemptKind: call.attemptKind,
    syncedPocketId: call.syncedPocketId,
    expectedKeySetVersion: call.expectedKeySetVersion,
    envelope: call.envelope,
  })), [
    {
      operationId: draft.ids.deviceEnvelopeOperationId,
      logicalChangeId: draft.ids.deviceEnvelopeLogicalChangeId,
      attemptKind: "new-change",
      syncedPocketId: draft.syncedPocketId,
      expectedKeySetVersion: 0,
      envelope,
    },
    {
      operationId: draft.ids.deviceEnvelopeOperationId,
      logicalChangeId: draft.ids.deviceEnvelopeLogicalChangeId,
      attemptKind: "idempotent-retry",
      syncedPocketId: draft.syncedPocketId,
      expectedKeySetVersion: 0,
      envelope,
    },
  ]);
  assert.equal(harness.counters.recovery, 0);
});

test("P294 device-envelope conflict is durable and later resume never republishes over remote key-set truth", async () => {
  const harness = createHarness({
    accountPath: "existing-unbound",
    envelopeAdd: async () => Object.freeze({
      conflict: true,
      actualKeySetVersion: 4,
    }),
  });
  const ready = await toContentCommitted(harness, "existing-unbound", "conflict");

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(first.ok, false);
  assert.equal(first.reason, "device-envelope-failed");
  assert.equal(first.conflict, true);
  assert.equal(first.resumable, false);
  assert.equal(harness.counters.envelope, 1);

  const conflicted = await readCanonical(harness, ready.staged.activationId);
  assert.equal(conflicted.draft.stage, "content-committed");
  assert.equal(conflicted.draft.keySetVersion, 0);
  assert.equal(conflicted.draft.pendingOperation, "device-envelope-conflict");
  assert.equal(conflicted.draft.confirmedRemoteRevision, 1);

  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(second.ok, false);
  assert.equal(second.reason, "device-envelope-failed");
  assert.equal(second.conflict, true);
  assert.equal(second.resumable, false);
  assert.equal(harness.counters.envelope, 1, "conflict must never trigger a later overwrite attempt");
  assert.equal(harness.counters.recovery, 0);
});

test("P294 rejects malformed committed device-envelope success responses without a false durable commit", async () => {
  const variants = [
    {
      name: "wrong keySetVersion",
      response: { ...successEnvelopeResponse(), keySetVersion: 2 },
    },
    {
      name: "wrong masterKeyGeneration",
      response: { ...successEnvelopeResponse(), masterKeyGeneration: 2 },
    },
    {
      name: "wrong masterKeyContentEncryptionLimit",
      response: { ...successEnvelopeResponse(), masterKeyContentEncryptionLimit: (2 ** 20) - 1 },
    },
  ];

  for (const variant of variants) {
    const harness = createHarness({
      accountPath: "existing-unbound",
      envelopeAdd: async () => Object.freeze(variant.response),
    });
    const ready = await toContentCommitted(harness, "existing-unbound", variant.name);

    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assert.equal(result.ok, false, variant.name);
    assert.equal(result.reason, "ownerless-activation-state-invalid", variant.name);
    assert.equal(harness.counters.envelope, 1, variant.name);

    const pending = await readCanonical(harness, ready.staged.activationId);
    assert.equal(pending.draft.stage, "content-committed", variant.name);
    assert.equal(pending.draft.keySetVersion, 0, variant.name);
    assert.equal(pending.draft.pendingOperation, "device-envelope", variant.name);
    assert.equal(pending.draft.confirmedRemoteRevision, 1, variant.name);
    assert.equal(harness.counters.recovery, 0, variant.name);
  }
});

test("P294 semantic none/replaceable currentness survives transient identity and fails closed if ownership changes across envelope await", async () => {
  let stale = false;
  const harness = createHarness({
    accountPath: "existing-unbound",
    target(count) {
      return stale
        ? { ownerKind: "json", continuityId: "json-owner" }
        : { ownerKind: "none", continuityId: `transient-none-${count}` };
    },
    envelopeAdd: async () => {
      stale = true;
      return successEnvelopeResponse();
    },
  });
  const ready = await toContentCommitted(harness, "existing-unbound", "stale");

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(result.locallyDurable, true);
  assert.equal(harness.counters.envelope, 1);

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "content-committed");
  assert.equal(pending.draft.pendingOperation, "device-envelope");
  assert.equal(pending.draft.keySetVersion, 0);
  assert.equal(pending.draft.confirmedRemoteRevision, 1);
  assert.equal(harness.counters.recovery, 0);
});

test("P294 canonical owner owns device-envelope v2 transitions, one shared addEnvelope pipeline remains, and ownerless stays runtime-dormant", () => {
  const ownerless = source(OWNERLESS);
  assert.match(ownerless, /function buildDeviceEnvelopePending\s*\(/);
  assert.match(ownerless, /function buildDeviceEnvelopeConflict\s*\(/);
  assert.match(ownerless, /function buildDeviceEnvelopeCommitted\s*\(/);

  const activation = source(ACTIVATION);
  assert.equal((activation.match(/async function addEnvelope\s*\(/g) || []).length, 1);
  assert.doesNotMatch(activation, /addOwnerlessDeviceEnvelope|commitOwnerlessDeviceEnvelope/);

  const envelopeStart = activation.indexOf("async function addEnvelope");
  const envelopeEnd = activation.indexOf("async function initialiseRecovery", envelopeStart);
  const envelopeSection = activation.slice(envelopeStart, envelopeEnd);
  assert.match(envelopeSection, /config\.envelopeService\.addEnvelope/);
  assert.match(envelopeSection, /deviceEnvelopeOperationId/);
  assert.match(envelopeSection, /deviceEnvelopeLogicalChangeId/);
  assert.match(envelopeSection, /expectedKeySetVersion:\s*execution\.draft\.keySetVersion/);
  assert.match(envelopeSection, /envelopePendingDraft\(execution, isDevice, operation\)/);
  assert.match(envelopeSection, /envelopeConflictDraft\(execution, isDevice, conflictOperation\)/);
  assert.match(envelopeSection, /envelopeCommittedDraft\(/);

  assert.doesNotMatch(source("index.html"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /ownerless-first-create|PocketSyncOwnerlessActivationDraft|findOwnerlessActivation/);
});
