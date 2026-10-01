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
const DEVICE_STORE = "js/pocket-sync-device-store.js";
const NOW = Date.parse("2036-06-01T00:00:00.000Z");

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
      return `${prefix}_p295_${nextNodeId}`;
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
    "js/pocket-first-use-document.js",
    OWNERLESS,
    DEVICE_STORE,
    ACTIVATION,
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
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
    ceremonyId: "ceremony-p295",
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
    accountId: "account-new-p295",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: Object.freeze({
      status: "unavailable",
      evaluationInput: PRF_INPUT,
    }),
  });
}

function existingReady(mode, raw) {
  return Object.freeze({
    accountPath: "existing-unbound",
    accountId: "account-existing-p295",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: mode === "available"
      ? Object.freeze({
        status: "available",
        evaluationInput: PRF_INPUT,
        outputBytes: raw,
      })
      : Object.freeze({
        status: "unavailable",
        evaluationInput: PRF_INPUT,
      }),
  });
}

function deviceEnvelopeSuccess() {
  return Object.freeze({
    conflict: false,
    status: "committed",
    keySetVersion: 1,
    masterKeyGeneration: 1,
    masterKeyContentEncryptionLimit: 2 ** 20,
  });
}

function prfEnvelopeSuccess() {
  return Object.freeze({
    conflict: false,
    status: "committed",
    keySetVersion: 2,
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
  let newAccountRawReference = null;

  const accountClient = options.accountPath === "new-account"
    ? Object.freeze({
      async authenticatePasskey() {
        counters.authenticate += 1;
        throw new Error("forbidden authenticate");
      },
      async finishRegistration() {
        counters.finish += 1;
        return registrationResult();
      },
      async registerPasskey(input, onCredentialReady) {
        counters.register += 1;
        const raw = bytes(32, 71);
        newAccountRawReference = raw;
        await onCredentialReady(Object.freeze({
          continuation: registrationContinuation(input),
          prf: options.prfMode === "available"
            ? Object.freeze({
              status: "available",
              evaluationInput: PRF_INPUT,
              outputBytes: raw,
            })
            : Object.freeze({
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
        if (input.envelope?.envelopeKind === "device") return deviceEnvelopeSuccess();
        if (typeof options.prfEnvelopeAdd === "function") {
          return options.prfEnvelopeAdd(input, envelopeCalls.filter(
            (call) => call.envelope?.envelopeKind === "passkey-prf"
          ).length);
        }
        return prfEnvelopeSuccess();
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
    if (typeof options.target === "function") return options.target(counters.captureTarget);
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
    get newAccountRawReference() { return newAccountRawReference; },
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
        async adoptSyncedOwner() {
          throw new Error("unexpected owner adoption before P299 boundary");
        },
        async withExistingAccountReady(consumer) {
          counters.bridge += 1;
          return bridge(consumer);
        },
      });
    },
  };
}

function activateOptions(accountPath, suffix) {
  return {
    activationMode: "ownerless-first-create",
    accountPath,
    syncedPocketId: `pocket-p295-${accountPath}-${suffix}`,
    deviceId: `device-p295-${accountPath}-${suffix}`,
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

async function toDeviceEnvelopeCommitted(harness, accountPath, prfMode, suffix) {
  const staged = await harness.orchestrator.activate(
    harness.activateDependencies,
    activateOptions(accountPath, suffix)
  );
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(staged.stage, "device-staged");

  const existingRaw = bytes(32, 41);
  const accountResult = accountPath === "existing-unbound"
    ? await harness.orchestrator.resume(
      harness.resumeDependencies(async (consumer) => consumer(existingReady(prfMode, existingRaw))),
      resumeOptions(staged.activationId)
    )
    : await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(staged.activationId)
    );

  assert.equal(accountResult.ok, true, JSON.stringify(accountResult));
  assert.equal(accountResult.reason, "ownerless-account-ready");
  assert.equal(accountResult.stage, "account-ready");

  let canonical = await readCanonical(harness, staged.activationId);
  assert.equal(canonical.draft.prfStatus, prfMode === "available" ? "available" : "skipped");
  assert.equal(canonical.draft.prfEnvelope === null, prfMode !== "available");
  assert.equal(JSON.stringify(canonical.draft).includes("outputBytes"), false);
  assert.equal(JSON.stringify(accountResult).includes("outputBytes"), false);
  if (accountPath === "new-account" && prfMode === "available") {
    assert.deepEqual(Array.from(harness.newAccountRawReference), new Array(32).fill(0));
  }

  const contentResult = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(contentResult.ok, true, JSON.stringify(contentResult));
  assert.equal(contentResult.reason, "ownerless-content-committed");
  assert.equal(contentResult.stage, "content-committed");
  assert.equal(harness.counters.content, 1);
  assert.equal(harness.counters.envelope, 0);

  const deviceResult = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(deviceResult.ok, true, JSON.stringify(deviceResult));
  assert.equal(deviceResult.reason, "ownerless-device-envelope-committed");
  assert.equal(deviceResult.stage, "device-envelope-committed");
  assert.equal(deviceResult.keySetVersion, 1);
  assert.equal(harness.counters.envelope, 1);
  assert.equal(harness.counters.recovery, 0);

  canonical = await readCanonical(harness, staged.activationId);
  assert.equal(canonical.draft.stage, "device-envelope-committed");
  assert.equal(canonical.draft.confirmedRemoteRevision, 1);
  assert.equal(canonical.draft.keySetVersion, 1);
  assert.equal(canonical.draft.pendingOperation, null);
  assert.equal(canonical.found.record.remote.confirmedRevision, 1);
  assert.equal(canonical.found.record.remote.pending, null);
  assert.equal(canonical.found.record.remote.conflict, null);
  assert.equal(canonical.found.record.usage.masterKeyGeneration, 1);
  assert.equal(canonical.found.record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  assert.equal(JSON.stringify(canonical.draft).includes("outputBytes"), false);

  return { staged, canonical };
}

function assertSafeTerminal(result, accountPath, mode) {
  const committed = mode === "available";
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId", "deviceId",
    "stage", "locallyDurable", "remotelyCommitted", "confirmedRemoteRevision",
    "keySetVersion",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, committed
    ? "ownerless-prf-envelope-committed"
    : "ownerless-prf-envelope-skipped");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, committed ? "prf-envelope-committed" : "prf-envelope-skipped");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.keySetVersion, committed ? 2 : 1);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized,
    /accountId|credentialId|prfEvaluationInput|outputBytes|encryptedEnvelope|recoveryRoot/);
}

test("P295 available and skipped PRF resolution converge for both account paths and hard-stop before recovery", async () => {
  for (const accountPath of ["existing-unbound", "new-account"]) {
    for (const prfMode of ["available", "skipped"]) {
      const harness = createHarness({ accountPath, prfMode });
      const ready = await toDeviceEnvelopeCommitted(
        harness,
        accountPath,
        prfMode,
        `${prfMode}-success`
      );
      const before = ready.canonical.draft;
      const ceremonyCounts = {
        bridge: harness.counters.bridge,
        register: harness.counters.register,
        finish: harness.counters.finish,
        authenticate: harness.counters.authenticate,
      };

      const result = await harness.orchestrator.resume(
        harness.resumeDependencies(),
        resumeOptions(ready.staged.activationId)
      );
      assertSafeTerminal(result, accountPath, prfMode);
      assert.deepEqual({
        bridge: harness.counters.bridge,
        register: harness.counters.register,
        finish: harness.counters.finish,
        authenticate: harness.counters.authenticate,
      }, ceremonyCounts, "P295 must repeat no account/passkey ceremony");
      assert.equal(harness.counters.recovery, 0, "P295 must hard-stop before recovery");

      const canonical = await readCanonical(harness, ready.staged.activationId);
      assert.equal(canonical.draft.confirmedRemoteRevision, 1);
      assert.equal(canonical.draft.pendingOperation, null);
      assert.equal(canonical.draft.recoveryVersion, 0);
      assert.equal(canonical.draft.accountLocator, null);
      assert.equal(canonical.draft.recoveryCopyStored, false);
      assert.equal(canonical.draft.adopted, false);
      assert.equal(canonical.found.record.remote.confirmedRevision, 1);
      assert.equal(canonical.found.record.remote.pending, null);
      assert.equal(canonical.found.record.remote.conflict, null);
      assert.equal(canonical.found.record.usage.masterKeyGeneration, 1);
      assert.equal(canonical.found.record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
      assert.equal(JSON.stringify(canonical.draft).includes("outputBytes"), false);

      if (prfMode === "available") {
        assert.equal(harness.counters.envelope, 2);
        assert.equal(canonical.draft.stage, "prf-envelope-committed");
        assert.equal(canonical.draft.keySetVersion, 2);
        assert.equal(canonical.draft.prfStatus, "available");
        assert.notEqual(canonical.draft.prfEnvelope, null);

        const call = harness.envelopeCalls[1];
        assert.deepEqual(call, {
          apiVersion: 1,
          operationId: before.ids.prfEnvelopeOperationId,
          logicalChangeId: before.ids.prfEnvelopeLogicalChangeId,
          attemptKind: "new-change",
          syncedPocketId: before.syncedPocketId,
          expectedKeySetVersion: 1,
          envelope: plain(before.prfEnvelope),
        });
      } else {
        assert.equal(harness.counters.envelope, 1, "skipped PRF must publish zero PRF envelope");
        assert.equal(canonical.draft.stage, "prf-envelope-skipped");
        assert.equal(canonical.draft.keySetVersion, 1);
        assert.equal(canonical.draft.prfStatus, "skipped");
        assert.equal(canonical.draft.prfEnvelope, null);
      }
    }
  }
});

test("P295 ambiguous available-PRF publication is durably resumable and only a later explicit resume idempotently retries", async () => {
  let prfCalls = 0;
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    prfEnvelopeAdd: async () => {
      prfCalls += 1;
      if (prfCalls === 1) throw new Error("synthetic ambiguous PRF envelope transport loss");
      return prfEnvelopeSuccess();
    },
  });
  const ready = await toDeviceEnvelopeCommitted(
    harness,
    "existing-unbound",
    "available",
    "retry"
  );
  const draft = ready.canonical.draft;
  const envelope = plain(draft.prfEnvelope);

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(first.ok, false);
  assert.equal(first.reason, "prf-envelope-failed");
  assert.equal(first.locallyDurable, true);
  assert.equal(first.remotelyCommitted, true);
  assert.equal(first.resumable, true);
  assert.equal(prfCalls, 1, "zero automatic retry required");
  assert.equal(harness.counters.envelope, 2);

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "device-envelope-committed");
  assert.equal(pending.draft.keySetVersion, 1);
  assert.equal(pending.draft.pendingOperation, "prf-envelope");
  assert.equal(pending.draft.confirmedRemoteRevision, 1);
  assert.equal(JSON.stringify(pending.draft).includes("outputBytes"), false);

  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assertSafeTerminal(second, "existing-unbound", "available");
  assert.equal(prfCalls, 2);
  assert.equal(harness.counters.envelope, 3);

  const prfEnvelopeCalls = harness.envelopeCalls.filter(
    (call) => call.envelope?.envelopeKind === "passkey-prf"
  );
  assert.deepEqual(prfEnvelopeCalls.map((call) => ({
    operationId: call.operationId,
    logicalChangeId: call.logicalChangeId,
    attemptKind: call.attemptKind,
    syncedPocketId: call.syncedPocketId,
    expectedKeySetVersion: call.expectedKeySetVersion,
    envelope: call.envelope,
  })), [
    {
      operationId: draft.ids.prfEnvelopeOperationId,
      logicalChangeId: draft.ids.prfEnvelopeLogicalChangeId,
      attemptKind: "new-change",
      syncedPocketId: draft.syncedPocketId,
      expectedKeySetVersion: 1,
      envelope,
    },
    {
      operationId: draft.ids.prfEnvelopeOperationId,
      logicalChangeId: draft.ids.prfEnvelopeLogicalChangeId,
      attemptKind: "idempotent-retry",
      syncedPocketId: draft.syncedPocketId,
      expectedKeySetVersion: 1,
      envelope,
    },
  ]);
  assert.equal(harness.counters.recovery, 0);
});

test("P295 available-PRF conflict is durable and later resume never republishes over remote key-set truth", async () => {
  let prfCalls = 0;
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    prfEnvelopeAdd: async () => {
      prfCalls += 1;
      return Object.freeze({ conflict: true, actualKeySetVersion: 5 });
    },
  });
  const ready = await toDeviceEnvelopeCommitted(
    harness,
    "existing-unbound",
    "available",
    "conflict"
  );

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(first.ok, false);
  assert.equal(first.reason, "prf-envelope-failed");
  assert.equal(first.conflict, true);
  assert.equal(first.resumable, false);
  assert.equal(prfCalls, 1);

  const conflicted = await readCanonical(harness, ready.staged.activationId);
  assert.equal(conflicted.draft.stage, "device-envelope-committed");
  assert.equal(conflicted.draft.keySetVersion, 1);
  assert.equal(conflicted.draft.pendingOperation, "prf-envelope-conflict");

  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(second.ok, false);
  assert.equal(second.reason, "prf-envelope-failed");
  assert.equal(second.conflict, true);
  assert.equal(second.resumable, false);
  assert.equal(prfCalls, 1, "durable conflict must never republish");
  assert.equal(harness.counters.recovery, 0);
});

test("P295 rejects available-PRF committed response unless keySetVersion is exactly 2", async () => {
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    prfEnvelopeAdd: async () => Object.freeze({
      conflict: false,
      status: "committed",
      keySetVersion: 3,
    }),
  });
  const ready = await toDeviceEnvelopeCommitted(
    harness,
    "existing-unbound",
    "available",
    "bad-version"
  );

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "device-envelope-committed");
  assert.equal(pending.draft.keySetVersion, 1);
  assert.equal(pending.draft.pendingOperation, "prf-envelope");
  assert.equal(pending.draft.confirmedRemoteRevision, 1);
  assert.equal(harness.counters.recovery, 0);
});

test("P295 semantic none/replaceable currentness fails closed if ownership changes across PRF-envelope await", async () => {
  let stale = false;
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    target(count) {
      return stale
        ? { ownerKind: "json", continuityId: "json-owner" }
        : { ownerKind: "none", continuityId: `transient-none-${count}` };
    },
    prfEnvelopeAdd: async () => {
      stale = true;
      return prfEnvelopeSuccess();
    },
  });
  const ready = await toDeviceEnvelopeCommitted(
    harness,
    "existing-unbound",
    "available",
    "stale"
  );

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(result.locallyDurable, true);

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "device-envelope-committed");
  assert.equal(pending.draft.keySetVersion, 1);
  assert.equal(pending.draft.pendingOperation, "prf-envelope");
  assert.equal(pending.draft.confirmedRemoteRevision, 1);
  assert.equal(harness.counters.recovery, 0);
});

test("P295 canonical owner owns every v2 PRF transition, one shared addEnvelope pipeline remains, raw PRF is absent, and runtime stays dormant", () => {
  const ownerless = source(OWNERLESS);
  for (const builder of [
    "buildPrfEnvelopePending",
    "buildPrfEnvelopeConflict",
    "buildPrfEnvelopeCommitted",
    "buildPrfEnvelopeSkipped",
  ]) assert.match(ownerless, new RegExp(`function ${builder}\\s*\\(`));
  const prfBuilderStart = ownerless.indexOf("function buildPrfEnvelopePending");
  const prfBuilderEnd = ownerless.indexOf("function classifyCompletion", prfBuilderStart);
  assert.doesNotMatch(ownerless.slice(prfBuilderStart, prfBuilderEnd), /outputBytes|rawPrf/i);

  const activation = source(ACTIVATION);
  assert.equal((activation.match(/async function addEnvelope\s*\(/g) || []).length, 1);
  assert.doesNotMatch(activation, /addOwnerlessPrfEnvelope|commitOwnerlessPrfEnvelope/);
  const envelopeStart = activation.indexOf("async function addEnvelope");
  const envelopeEnd = activation.indexOf("async function initialiseRecovery", envelopeStart);
  const envelopeSection = activation.slice(envelopeStart, envelopeEnd);
  assert.match(envelopeSection, /config\.envelopeService\.addEnvelope/);
  assert.match(envelopeSection, /prfEnvelopeOperationId/);
  assert.match(envelopeSection, /prfEnvelopeLogicalChangeId/);
  assert.match(envelopeSection, /expectedKeySetVersion:\s*execution\.draft\.keySetVersion/);
  assert.doesNotMatch(envelopeSection, /outputBytes|rawPrf/i);

  const dispatcherStart = activation.indexOf(
    'if (execution.draft.stage === "device-envelope-committed")'
  );
  const dispatcherEnd = activation.indexOf(
    'return ownerlessFailure("ownerless-activation-state-invalid"', dispatcherStart + 1000
  );
  assert.doesNotMatch(
    activation.slice(dispatcherStart, dispatcherEnd),
    /outputBytes|derive.*prf|registerPasskey|authenticatePasskey/i
  );

  assert.equal((source("index.html").match(/pocket-sync-ownerless-activation-draft\.js/g) || []).length, 1);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.match(source("js/pocket-sync-browser-runtime.js"), /startOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /function\\s+(?:activateOwnerless|resumeOwnerless|findOwnerlessActivation)\\s*\\(/);
});
