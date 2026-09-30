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
const NOW = Date.parse("2036-07-01T00:00:00.000Z");

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
      return `${prefix}_p296_${nextNodeId}`;
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
    ceremonyId: "ceremony-p296",
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
    accountId: "account-new-p296",
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
    accountId: "account-existing-p296",
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

function recoverySuccess(input, locator = "locator-p296") {
  return Object.freeze({
    conflict: false,
    status: "committed",
    recoveryVersion: 1,
    recoveryCopyRequired: true,
    keySetVersion: input.expectedKeySetVersion + 1,
    accountLocator: locator,
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
  const contentCalls = [];
  const envelopeCalls = [];
  const recoveryCalls = [];
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
        if (input.envelope?.envelopeKind === "passkey-prf") return prfEnvelopeSuccess();
        throw new Error("unexpected envelope kind");
      },
    }),
    recoveryService: Object.freeze({
      async initialiseRecovery(input) {
        counters.recovery += 1;
        recoveryCalls.push(plain(input));
        if (typeof options.recoveryInitialise === "function") {
          return options.recoveryInitialise(input, counters.recovery);
        }
        return recoverySuccess(
          input,
          `locator-p296-${options.accountPath}-${options.prfMode}`
        );
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
    recoveryCalls,
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
    syncedPocketId: `pocket-p296-${accountPath}-${suffix}`,
    deviceId: `device-p296-${accountPath}-${suffix}`,
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

async function toPrfTerminal(harness, accountPath, prfMode, suffix) {
  const staged = await harness.orchestrator.activate(
    harness.activateDependencies,
    activateOptions(accountPath, suffix)
  );
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(staged.stage, "device-staged");

  const existingRaw = bytes(32, 41);
  const accountReady = accountPath === "existing-unbound"
    ? await harness.orchestrator.resume(
      harness.resumeDependencies(async (consumer) => consumer(existingReady(prfMode, existingRaw))),
      resumeOptions(staged.activationId)
    )
    : await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(staged.activationId)
    );
  assert.equal(accountReady.ok, true, JSON.stringify(accountReady));
  assert.equal(accountReady.reason, "ownerless-account-ready");
  assert.equal(accountReady.stage, "account-ready");

  if (accountPath === "new-account" && prfMode === "available") {
    assert.deepEqual(Array.from(harness.newAccountRawReference), new Array(32).fill(0));
  }

  const content = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(content.ok, true, JSON.stringify(content));
  assert.equal(content.reason, "ownerless-content-committed");
  assert.equal(content.stage, "content-committed");
  assert.equal(harness.counters.content, 1);
  assert.equal(harness.counters.envelope, 0);
  assert.equal(harness.counters.recovery, 0);

  const device = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(device.ok, true, JSON.stringify(device));
  assert.equal(device.reason, "ownerless-device-envelope-committed");
  assert.equal(device.stage, "device-envelope-committed");
  assert.equal(device.keySetVersion, 1);
  assert.equal(harness.counters.envelope, 1);
  assert.equal(harness.counters.recovery, 0);

  const prf = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(prf.ok, true, JSON.stringify(prf));
  assert.equal(
    prf.reason,
    prfMode === "available"
      ? "ownerless-prf-envelope-committed"
      : "ownerless-prf-envelope-skipped"
  );
  assert.equal(
    prf.stage,
    prfMode === "available" ? "prf-envelope-committed" : "prf-envelope-skipped"
  );
  assert.equal(prf.keySetVersion, prfMode === "available" ? 2 : 1);
  assert.equal(
    harness.counters.envelope,
    prfMode === "available" ? 2 : 1
  );
  assert.equal(
    harness.counters.recovery,
    0,
    "P295 same-resume hard stop must remain before recovery"
  );

  const canonical = await readCanonical(harness, staged.activationId);
  assert.equal(
    canonical.draft.stage,
    prfMode === "available" ? "prf-envelope-committed" : "prf-envelope-skipped"
  );
  assert.equal(canonical.draft.confirmedRemoteRevision, 1);
  assert.equal(canonical.draft.keySetVersion, prfMode === "available" ? 2 : 1);
  assert.equal(canonical.draft.recoveryVersion, 0);
  assert.equal(canonical.draft.accountLocator, null);
  assert.equal(canonical.draft.pendingOperation, null);
  assert.equal(canonical.draft.recoveryPackage, null);
  assert.equal(canonical.draft.recoveryCopyStored, false);
  assert.equal(canonical.draft.adopted, false);
  assert.equal(canonical.found.record.remote.confirmedRevision, 1);
  assert.equal(canonical.found.record.remote.pending, null);
  assert.equal(canonical.found.record.remote.conflict, null);
  assert.equal(canonical.found.record.usage.masterKeyGeneration, 1);
  assert.equal(canonical.found.record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
  return { staged, canonical };
}

function assertSafeRecoveryResult(result, accountPath, expectedKeySetVersion) {
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId", "deviceId",
    "stage", "locallyDurable", "remotelyCommitted", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "recoveryCopyRequired",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ownerless-recovery-initialised");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "recovery-initialised");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.keySetVersion, expectedKeySetVersion);
  assert.equal(result.recoveryVersion, 1);
  assert.equal(result.recoveryCopyRequired, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /accountLocator|accountId|credentialId|prf|recoveryRoot|recoveryAuthorisation|recoveryEnvelope/
  );
}

test("P296 both account paths and both PRF terminals converge through one shared recovery initialisation and hard-stop at recovery-initialised", async () => {
  for (const accountPath of ["existing-unbound", "new-account"]) {
    for (const prfMode of ["available", "skipped"]) {
      const harness = createHarness({ accountPath, prfMode });
      const ready = await toPrfTerminal(
        harness,
        accountPath,
        prfMode,
        `${prfMode}-success`
      );
      const before = ready.canonical.draft;
      const rootBefore = before.recoveryRoot;
      const authorisationBefore = plain(before.recoveryAuthorisation);
      const verifierBefore = plain(before.recoveryVerifier);
      const envelopeBefore = plain(before.recoveryEnvelope);
      const ceremonyCounts = {
        bridge: harness.counters.bridge,
        register: harness.counters.register,
        finish: harness.counters.finish,
        authenticate: harness.counters.authenticate,
        content: harness.counters.content,
        envelope: harness.counters.envelope,
      };
      const expectedStart = prfMode === "available" ? 2 : 1;
      const expectedEnd = expectedStart + 1;
      const expectedLocator = `locator-p296-${accountPath}-${prfMode}`;

      const result = await harness.orchestrator.resume(
        harness.resumeDependencies(),
        resumeOptions(ready.staged.activationId)
      );
      assertSafeRecoveryResult(result, accountPath, expectedEnd);
      assert.equal(harness.counters.recovery, 1);
      assert.deepEqual({
        bridge: harness.counters.bridge,
        register: harness.counters.register,
        finish: harness.counters.finish,
        authenticate: harness.counters.authenticate,
        content: harness.counters.content,
        envelope: harness.counters.envelope,
      }, ceremonyCounts, "P296 repeats no earlier ceremony or remote step");

      assert.deepEqual(harness.recoveryCalls[0], {
        apiVersion: 1,
        operationId: before.ids.recoveryOperationId,
        logicalChangeId: before.ids.recoveryLogicalChangeId,
        attemptKind: "new-change",
        syncedPocketId: before.syncedPocketId,
        expectedKeySetVersion: expectedStart,
        recoveryVerifier: verifierBefore,
        recoveryEnvelope: envelopeBefore,
      });

      const committed = await readCanonical(harness, ready.staged.activationId);
      assert.equal(committed.draft.stage, "recovery-initialised");
      assert.equal(committed.draft.keySetVersion, expectedEnd);
      assert.equal(committed.draft.recoveryVersion, 1);
      assert.equal(committed.draft.accountLocator, expectedLocator);
      assert.notEqual(committed.draft.accountLocator, committed.draft.account.accountId);
      assert.equal(committed.draft.pendingOperation, null);
      assert.equal(committed.draft.confirmedRemoteRevision, 1);
      assert.equal(committed.draft.recoveryCopyStored, false);
      assert.equal(committed.draft.recoveryPackage, null);
      assert.equal(committed.draft.recoveryRoot, rootBefore);
      assert.deepEqual(plain(committed.draft.recoveryAuthorisation), authorisationBefore);
      assert.deepEqual(plain(committed.draft.recoveryVerifier), verifierBefore);
      assert.deepEqual(plain(committed.draft.recoveryEnvelope), envelopeBefore);
      assert.equal(committed.draft.adopted, false);
      assert.equal(committed.found.record.remote.confirmedRevision, 1);
      assert.equal(committed.found.record.remote.pending, null);
      assert.equal(committed.found.record.remote.conflict, null);
      assert.equal(committed.found.record.usage.masterKeyGeneration, 1);
      assert.equal(committed.found.record.usage.masterKeyContentEncryptionLimit, 2 ** 20);
    }
  }
});

test("P296 ambiguous recovery attempt is durable on both PRF branches and only a later explicit resume idempotently retries", async () => {
  for (const prfMode of ["available", "skipped"]) {
    let remoteCalls = 0;
    const harness = createHarness({
      accountPath: "existing-unbound",
      prfMode,
      recoveryInitialise: async (input) => {
        remoteCalls += 1;
        if (remoteCalls === 1) throw new Error("synthetic ambiguous recovery transport loss");
        return recoverySuccess(input, `locator-p296-retry-${prfMode}`);
      },
    });
    const ready = await toPrfTerminal(
      harness,
      "existing-unbound",
      prfMode,
      `${prfMode}-retry`
    );
    const draft = ready.canonical.draft;
    const startVersion = prfMode === "available" ? 2 : 1;

    const first = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assert.equal(first.ok, false);
    assert.equal(first.reason, "recovery-initialisation-failed");
    assert.equal(first.locallyDurable, true);
    assert.equal(first.remotelyCommitted, true);
    assert.equal(first.resumable, true);
    assert.equal(remoteCalls, 1, "zero automatic retry required");

    const pending = await readCanonical(harness, ready.staged.activationId);
    assert.equal(
      pending.draft.stage,
      prfMode === "available" ? "prf-envelope-committed" : "prf-envelope-skipped"
    );
    assert.equal(pending.draft.keySetVersion, startVersion);
    assert.equal(pending.draft.recoveryVersion, 0);
    assert.equal(pending.draft.accountLocator, null);
    assert.equal(pending.draft.pendingOperation, "recovery-initialisation");

    const second = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assertSafeRecoveryResult(second, "existing-unbound", startVersion + 1);
    assert.equal(remoteCalls, 2);

    assert.deepEqual(harness.recoveryCalls.map((call) => ({
      operationId: call.operationId,
      logicalChangeId: call.logicalChangeId,
      attemptKind: call.attemptKind,
      syncedPocketId: call.syncedPocketId,
      expectedKeySetVersion: call.expectedKeySetVersion,
      recoveryVerifier: call.recoveryVerifier,
      recoveryEnvelope: call.recoveryEnvelope,
    })), [
      {
        operationId: draft.ids.recoveryOperationId,
        logicalChangeId: draft.ids.recoveryLogicalChangeId,
        attemptKind: "new-change",
        syncedPocketId: draft.syncedPocketId,
        expectedKeySetVersion: startVersion,
        recoveryVerifier: plain(draft.recoveryVerifier),
        recoveryEnvelope: plain(draft.recoveryEnvelope),
      },
      {
        operationId: draft.ids.recoveryOperationId,
        logicalChangeId: draft.ids.recoveryLogicalChangeId,
        attemptKind: "idempotent-retry",
        syncedPocketId: draft.syncedPocketId,
        expectedKeySetVersion: startVersion,
        recoveryVerifier: plain(draft.recoveryVerifier),
        recoveryEnvelope: plain(draft.recoveryEnvelope),
      },
    ]);
  }
});

test("P296 recovery conflict is durable on both PRF branches and later resume never overwrites remote truth", async () => {
  for (const prfMode of ["available", "skipped"]) {
    let remoteCalls = 0;
    const harness = createHarness({
      accountPath: "existing-unbound",
      prfMode,
      recoveryInitialise: async () => {
        remoteCalls += 1;
        return Object.freeze({
          conflict: true,
          actualKeySetVersion: 8,
          recoveryVersion: 1,
        });
      },
    });
    const ready = await toPrfTerminal(
      harness,
      "existing-unbound",
      prfMode,
      `${prfMode}-conflict`
    );
    const startVersion = prfMode === "available" ? 2 : 1;

    const first = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assert.equal(first.ok, false);
    assert.equal(first.reason, "recovery-initialisation-failed");
    assert.equal(first.conflict, true);
    assert.equal(first.resumable, false);
    assert.equal(remoteCalls, 1);

    const conflicted = await readCanonical(harness, ready.staged.activationId);
    assert.equal(
      conflicted.draft.stage,
      prfMode === "available" ? "prf-envelope-committed" : "prf-envelope-skipped"
    );
    assert.equal(conflicted.draft.keySetVersion, startVersion);
    assert.equal(conflicted.draft.recoveryVersion, 0);
    assert.equal(conflicted.draft.accountLocator, null);
    assert.equal(conflicted.draft.pendingOperation, "recovery-conflict");

    const second = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assert.equal(second.ok, false);
    assert.equal(second.reason, "recovery-initialisation-failed");
    assert.equal(second.conflict, true);
    assert.equal(second.resumable, false);
    assert.equal(remoteCalls, 1, "durable conflict must never trigger another remote call");
  }
});

test("P296 rejects every malformed recovery success witness, including invalid/equal accountLocator, without false initialisation", async () => {
  const variants = [
    {
      name: "wrong status",
      make(input) {
        return { ...recoverySuccess(input), status: "accepted" };
      },
    },
    {
      name: "wrong recoveryVersion",
      make(input) {
        return { ...recoverySuccess(input), recoveryVersion: 2 };
      },
    },
    {
      name: "recoveryCopyRequired false",
      make(input) {
        return { ...recoverySuccess(input), recoveryCopyRequired: false };
      },
    },
    {
      name: "wrong keySetVersion",
      make(input) {
        return { ...recoverySuccess(input), keySetVersion: input.expectedKeySetVersion + 2 };
      },
    },
    {
      name: "noncanonical accountLocator",
      make(input) {
        return { ...recoverySuccess(input), accountLocator: " locator-with-space " };
      },
    },
  ];

  for (const prfMode of ["available", "skipped"]) {
    for (const variant of variants) {
      const harness = createHarness({
        accountPath: "existing-unbound",
        prfMode,
        recoveryInitialise: async (input) => Object.freeze(variant.make(input)),
      });
      const ready = await toPrfTerminal(
        harness,
        "existing-unbound",
        prfMode,
        `${prfMode}-invalid-${variant.name}`
      );
      const result = await harness.orchestrator.resume(
        harness.resumeDependencies(),
        resumeOptions(ready.staged.activationId)
      );
      assert.equal(result.ok, false, `${prfMode}: ${variant.name}`);
      assert.equal(
        result.reason,
        "ownerless-activation-state-invalid",
        `${prfMode}: ${variant.name}`
      );
      const pending = await readCanonical(harness, ready.staged.activationId);
      assert.equal(
        pending.draft.stage,
        prfMode === "available" ? "prf-envelope-committed" : "prf-envelope-skipped"
      );
      assert.equal(pending.draft.keySetVersion, prfMode === "available" ? 2 : 1);
      assert.equal(pending.draft.recoveryVersion, 0);
      assert.equal(pending.draft.accountLocator, null);
      assert.equal(pending.draft.pendingOperation, "recovery-initialisation");
      assert.equal(harness.counters.recovery, 1);
    }

    let accountId = null;
    const equalHarness = createHarness({
      accountPath: "existing-unbound",
      prfMode,
      recoveryInitialise: async (input) => recoverySuccess(input, accountId),
    });
    const equalReady = await toPrfTerminal(
      equalHarness,
      "existing-unbound",
      prfMode,
      `${prfMode}-equal-account`
    );
    accountId = equalReady.canonical.draft.account.accountId;
    const equalResult = await equalHarness.orchestrator.resume(
      equalHarness.resumeDependencies(),
      resumeOptions(equalReady.staged.activationId)
    );
    assert.equal(equalResult.ok, false, `${prfMode}: locator equal accountId`);
    assert.equal(equalResult.reason, "ownerless-activation-state-invalid");
    const equalPending = await readCanonical(equalHarness, equalReady.staged.activationId);
    assert.equal(equalPending.draft.recoveryVersion, 0);
    assert.equal(equalPending.draft.accountLocator, null);
    assert.equal(equalPending.draft.pendingOperation, "recovery-initialisation");
  }
});

test("P296 semantic none/replaceable currentness fails closed across the remote recovery await", async () => {
  let stale = false;
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    target(count) {
      return stale
        ? { ownerKind: "json", continuityId: "json-owner" }
        : { ownerKind: "none", continuityId: `transient-none-${count}` };
    },
    recoveryInitialise: async (input) => {
      stale = true;
      return recoverySuccess(input, "locator-p296-stale");
    },
  });
  const ready = await toPrfTerminal(
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
  assert.equal(harness.counters.recovery, 1);

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "prf-envelope-committed");
  assert.equal(pending.draft.keySetVersion, 2);
  assert.equal(pending.draft.recoveryVersion, 0);
  assert.equal(pending.draft.accountLocator, null);
  assert.equal(pending.draft.pendingOperation, "recovery-initialisation");
});

test("P296 canonical owner owns recovery transitions, only one initialiseRecovery pipeline exists, and ownerless hard-stops before Recovery Copy/runtime UI", () => {
  const ownerless = source(OWNERLESS);
  for (const builder of [
    "buildRecoveryInitialisationPending",
    "buildRecoveryConflict",
    "buildRecoveryInitialised",
  ]) assert.match(ownerless, new RegExp(`function ${builder}\\s*\\(`));

  const builderStart = ownerless.indexOf("function exactRecoveryTerminal");
  const builderEnd = ownerless.indexOf("function classifyCompletion", builderStart);
  const builderSection = ownerless.slice(builderStart, builderEnd);
  assert.doesNotMatch(builderSection, /buildRecoveryPackage|prepareRecoveryCopyDestination|writeRecoveryCopy/);

  const activation = source(ACTIVATION);
  assert.equal((activation.match(/async function initialiseRecovery\s*\(/g) || []).length, 1);
  assert.doesNotMatch(activation, /initialiseOwnerlessRecovery|ownerlessInitialiseRecovery/);

  const recoveryStart = activation.indexOf("async function initialiseRecovery");
  const recoveryEnd = activation.indexOf("async function preparePackage", recoveryStart);
  const recoverySection = activation.slice(recoveryStart, recoveryEnd);
  assert.match(recoverySection, /config\.recoveryService\.initialiseRecovery/);
  assert.match(recoverySection, /recoveryOperationId/);
  assert.match(recoverySection, /recoveryLogicalChangeId/);
  assert.match(recoverySection, /expectedKeySetVersion:\s*execution\.draft\.keySetVersion/);
  assert.match(recoverySection, /recoveryVerifier:\s*execution\.draft\.recoveryVerifier/);
  assert.match(recoverySection, /recoveryEnvelope:\s*execution\.draft\.recoveryEnvelope/);
  assert.match(recoverySection, /error\?\.code === execution\.currentFailureCode/);
  assert.match(recoverySection, /recoveryPendingDraft\(execution\)/);
  assert.match(recoverySection, /recoveryConflictDraft\(execution\)/);
  assert.match(recoverySection, /recoveryInitialisedDraft\(/);

  const ownerlessStart = activation.indexOf("async function resumeOwnerless");
  const ownerlessEnd = activation.indexOf("async function resume(", ownerlessStart + 10);
  const ownerlessResume = activation.slice(ownerlessStart, ownerlessEnd);
  assert.match(ownerlessResume, /initialiseRecovery\(execution\)/);
  const recoveryTerminalStart = ownerlessResume.indexOf(
    'if (execution.draft.stage === "prf-envelope-committed"'
  );
  const recoveryInitialisedStart = ownerlessResume.indexOf(
    'if (execution.draft.stage === "recovery-initialised")'
  );
  const recoveryTerminalSection = ownerlessResume.slice(
    recoveryTerminalStart,
    recoveryInitialisedStart
  );
  assert.doesNotMatch(
    recoveryTerminalSection,
    /preparePackage\(execution\)/,
    "P296 recovery resume must still hard-stop before P297 package construction"
  );
  assert.match(ownerlessResume, /preparePackage\(execution\)/);
  assert.doesNotMatch(ownerlessResume, /writePackage\(execution\)/);
  assert.doesNotMatch(
    ownerlessResume,
    /prepareRecoveryCopyDestination|writeRecoveryCopy|adoptSyncedOwner/
  );

  assert.match(
    activation,
    /const OWNERLESS_RESUME_DEPENDENCY_FIELDS = Object\.freeze\(\[\s*"captureTarget", "isTargetReplaceable", "withExistingAccountReady",\s*"buildRecoveryPackage",\s*\]\)/
  );
  assert.doesNotMatch(source("index.html"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /ownerless-first-create|PocketSyncOwnerlessActivationDraft|findOwnerlessActivation/);
});
