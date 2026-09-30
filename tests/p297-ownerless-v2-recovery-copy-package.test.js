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
      return `${prefix}_p297_${nextNodeId}`;
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
    ceremonyId: "ceremony-p297",
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
    accountId: "account-new-p297",
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
    accountId: "account-existing-p297",
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

function recoverySuccess(input, locator = "locator-p297") {
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
    package: 0,
    bridge: 0,
    captureTarget: 0,
  };
  const contentCalls = [];
  const envelopeCalls = [];
  const recoveryCalls = [];
  const packageCalls = [];
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
          `locator-p297-${options.accountPath}-${options.prfMode}`
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
    packageCalls,
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
        async buildRecoveryPackage(input) {
          counters.package += 1;
          packageCalls.push(plain(input));
          if (typeof options.buildRecoveryPackage === "function") {
            return options.buildRecoveryPackage(input, production.security, counters.package);
          }
          return production.security.buildRecoveryPackage({
            ...plain(input),
            checksum: `P297-CHECKSUM-${counters.package}`,
          });
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
    syncedPocketId: `pocket-p297-${accountPath}-${suffix}`,
    deviceId: `device-p297-${accountPath}-${suffix}`,
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


async function toRecoveryInitialised(harness, accountPath, prfMode, suffix) {
  const ready = await toPrfTerminal(harness, accountPath, prfMode, suffix);
  assert.equal(harness.counters.package, 0, "P296 same-resume hard stop must precede P297");

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  const expectedKeySetVersion = prfMode === "available" ? 3 : 2;
  assertSafeRecoveryResult(result, accountPath, expectedKeySetVersion);
  assert.equal(harness.counters.package, 0, "recovery resume must not also build Recovery Copy package");

  const canonical = await readCanonical(harness, ready.staged.activationId);
  assert.equal(canonical.draft.stage, "recovery-initialised");
  assert.equal(canonical.draft.keySetVersion, expectedKeySetVersion);
  assert.equal(canonical.draft.recoveryVersion, 1);
  assert.equal(canonical.draft.pendingOperation, null);
  assert.equal(canonical.draft.recoveryPackage, null);
  assert.equal(canonical.draft.recoveryCopyStored, false);
  assert.equal(canonical.draft.adopted, false);
  return { staged: ready.staged, canonical };
}

function assertSafePackagePendingResult(result, accountPath, expectedKeySetVersion) {
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId", "deviceId",
    "stage", "locallyDurable", "remotelyCommitted", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "recoveryCopyRequired",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ownerless-recovery-copy-pending");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "recovery-copy-pending");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.keySetVersion, expectedKeySetVersion);
  assert.equal(result.recoveryVersion, 1);
  assert.equal(result.recoveryCopyRequired, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /recoveryPackage|recoveryRoot|recoveryAuthorisation|accountLocator|accountId|credentialId|checksum|recoveryEnvelope|recoveryVerifier|outputBytes/
  );
}

test("P297 both account paths and both PRF branches converge through the one shared package owner and stop at recovery-copy-pending", async () => {
  for (const accountPath of ["existing-unbound", "new-account"]) {
    for (const prfMode of ["available", "skipped"]) {
      const harness = createHarness({ accountPath, prfMode });
      const ready = await toRecoveryInitialised(
        harness,
        accountPath,
        prfMode,
        `${accountPath}-${prfMode}-package`
      );
      const before = ready.canonical.draft;
      const beforeRemote = plain(ready.canonical.found.record.remote);
      const beforeUsage = plain(ready.canonical.found.record.usage);
      const beforeCounts = plain(harness.counters);
      const expectedKeySetVersion = prfMode === "available" ? 3 : 2;

      const result = await harness.orchestrator.resume(
        harness.resumeDependencies(),
        resumeOptions(ready.staged.activationId)
      );
      assertSafePackagePendingResult(result, accountPath, expectedKeySetVersion);
      assert.equal(harness.counters.package, 1);
      assert.equal(harness.counters.recovery, beforeCounts.recovery);
      assert.equal(harness.counters.content, beforeCounts.content);
      assert.equal(harness.counters.envelope, beforeCounts.envelope);
      assert.equal(harness.counters.register, beforeCounts.register);
      assert.equal(harness.counters.finish, beforeCounts.finish);
      assert.equal(harness.counters.authenticate, beforeCounts.authenticate);
      assert.equal(harness.counters.bridge, beforeCounts.bridge);

      assert.deepEqual(harness.packageCalls[0], {
        packageVersion: 2,
        accountLocator: before.accountLocator,
        syncedPocketId: before.syncedPocketId,
        rootMaterial: before.recoveryRoot,
        rootBits: 256,
        recoveryAuthorisation: plain(before.recoveryAuthorisation),
        instructions: [harness.production.security.RECOVERY_COPY.body],
      });

      const pending = await readCanonical(harness, ready.staged.activationId);
      assert.equal(pending.draft.stage, "recovery-copy-pending");
      assert.equal(pending.draft.confirmedRemoteRevision, before.confirmedRemoteRevision);
      assert.equal(pending.draft.keySetVersion, before.keySetVersion);
      assert.equal(pending.draft.recoveryVersion, before.recoveryVersion);
      assert.equal(pending.draft.accountLocator, before.accountLocator);
      assert.equal(pending.draft.recoveryRoot, before.recoveryRoot);
      assert.deepEqual(
        plain(pending.draft.recoveryAuthorisation),
        plain(before.recoveryAuthorisation)
      );
      assert.equal(pending.draft.recoveryCopyStored, false);
      assert.equal(pending.draft.pendingOperation, null);
      assert.equal(pending.draft.adopted, false);
      assert.deepEqual(plain(pending.found.record.remote), beforeRemote);
      assert.equal(pending.found.record.usage.masterKeyGeneration, beforeUsage.masterKeyGeneration);
      assert.equal(
        pending.found.record.usage.masterKeyContentEncryptionLimit,
        beforeUsage.masterKeyContentEncryptionLimit
      );

      const recoveryPackage = plain(pending.draft.recoveryPackage);
      assert.equal(recoveryPackage.kind, "pocket-recovery-package");
      assert.equal(recoveryPackage.localOnly, true);
      assert.equal(recoveryPackage.remoteUploadAllowed, false);
      assert.equal(recoveryPackage.packageVersion, 2);
      assert.equal(recoveryPackage.accountLocator, before.accountLocator);
      assert.equal(recoveryPackage.syncedPocketId, before.syncedPocketId);
      assert.equal(recoveryPackage.rootMaterial, before.recoveryRoot);
      assert.equal(recoveryPackage.rootBits, 256);
      assert.deepEqual(
        recoveryPackage.recoveryAuthorisation,
        plain(before.recoveryAuthorisation)
      );
      assert.equal(recoveryPackage.checksum, "P297-CHECKSUM-1");
      assert.deepEqual(
        recoveryPackage.instructions,
        [harness.production.security.RECOVERY_COPY.body]
      );
    }
  }
});

test("P297 package-build failure is resumable, performs zero automatic retry, and leaves canonical recovery-initialised truth intact", async () => {
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    async buildRecoveryPackage() {
      throw new Error("synthetic local package build failure");
    },
  });
  const ready = await toRecoveryInitialised(
    harness,
    "existing-unbound",
    "available",
    "build-failure"
  );
  const before = plain(ready.canonical.draft);

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-recovery-copy-preparation-failed");
  assert.equal(result.resumable, true);
  assert.equal(result.recoveryCopyRequired, true);
  assert.equal(harness.counters.package, 1, "zero automatic retry required");
  assert.doesNotMatch(JSON.stringify(result), /recoveryRoot|recoveryAuthorisation|accountLocator|checksum/);

  const after = await readCanonical(harness, ready.staged.activationId);
  assert.equal(after.draft.stage, "recovery-initialised");
  assert.equal(after.draft.recoveryPackage, null);
  assert.equal(after.draft.recoveryCopyStored, false);
  assert.equal(after.draft.pendingOperation, null);
  assert.equal(after.draft.recoveryRoot, before.recoveryRoot);
  assert.deepEqual(plain(after.draft.recoveryAuthorisation), before.recoveryAuthorisation);
});

test("P297 rejects structurally valid packages bound to the wrong Pocket, locator, root, authorisation or instructions", async () => {
  const variants = [
    ["locator", (input) => ({ ...plain(input), accountLocator: "wrong-locator-p297" })],
    ["Pocket", (input) => ({ ...plain(input), syncedPocketId: "wrong-pocket-p297" })],
    ["root", (input) => ({ ...plain(input), rootMaterial: b64(bytes(32, 211)) })],
    ["root bits", (input) => ({ ...plain(input), rootBits: 512 })],
    ["authorisation", (input) => ({
      ...plain(input),
      recoveryAuthorisation: {
        ...plain(input.recoveryAuthorisation),
        privateKey: b64(bytes(64, 173)),
      },
    })],
    ["instructions", (input) => ({ ...plain(input), instructions: ["wrong instructions"] })],
  ];

  for (const [name, mutate] of variants) {
    const harness = createHarness({
      accountPath: "existing-unbound",
      prfMode: "skipped",
      buildRecoveryPackage(input, security) {
        return security.buildRecoveryPackage({
          ...mutate(input),
          checksum: `P297-WRONG-${name}`,
        });
      },
    });
    const ready = await toRecoveryInitialised(
      harness,
      "existing-unbound",
      "skipped",
      `wrong-${name}`
    );

    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, "ownerless-recovery-copy-preparation-failed", name);
    assert.equal(result.resumable, true, name);
    assert.equal(harness.counters.package, 1, name);

    const after = await readCanonical(harness, ready.staged.activationId);
    assert.equal(after.draft.stage, "recovery-initialised", name);
    assert.equal(after.draft.recoveryPackage, null, name);
    assert.equal(after.draft.recoveryCopyStored, false, name);
  }
});

test("P297 rejects a package that violates the locked local-only / remote-upload-forbidden wrapper", async () => {
  for (const [field, value] of [["localOnly", false], ["remoteUploadAllowed", true]]) {
    const harness = createHarness({
      accountPath: "new-account",
      prfMode: "available",
      buildRecoveryPackage(input, security) {
        const valid = security.buildRecoveryPackage({
          ...plain(input),
          checksum: "P297-FLAG-CHECKSUM",
        });
        return { ...plain(valid.value), [field]: value };
      },
    });
    const ready = await toRecoveryInitialised(
      harness,
      "new-account",
      "available",
      `flag-${field}`
    );
    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assert.equal(result.ok, false, field);
    assert.equal(result.reason, "ownerless-recovery-copy-preparation-failed", field);
    const after = await readCanonical(harness, ready.staged.activationId);
    assert.equal(after.draft.stage, "recovery-initialised", field);
    assert.equal(after.draft.recoveryPackage, null, field);
  }
});

test("P297 semantic none/replaceable currentness fails closed across the async package build", async () => {
  let stale = false;
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    target(count) {
      return stale
        ? { ownerKind: "json", continuityId: "json-owner" }
        : { ownerKind: "none", continuityId: `transient-none-${count}` };
    },
    buildRecoveryPackage(input, security) {
      stale = true;
      return security.buildRecoveryPackage({
        ...plain(input),
        checksum: "P297-STALE-CHECKSUM",
      });
    },
  });
  const ready = await toRecoveryInitialised(
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
  assert.equal(harness.counters.package, 1);

  const after = await readCanonical(harness, ready.staged.activationId);
  assert.equal(after.draft.stage, "recovery-initialised");
  assert.equal(after.draft.recoveryPackage, null);
  assert.equal(after.draft.recoveryCopyStored, false);
});

test("P297 canonical owner/dependency/boundary source shape stays narrow and ownerless runtime/UI remains dormant", () => {
  const activation = source(ACTIVATION);
  const ownerless = source(OWNERLESS);

  assert.equal((activation.match(/async function preparePackage\s*\(/g) || []).length, 1);
  assert.match(ownerless, /function buildRecoveryCopyPending\s*\(/);
  assert.match(
    activation,
    /const OWNERLESS_RESUME_DEPENDENCY_FIELDS = Object\.freeze\(\[\s*"captureTarget", "isTargetReplaceable", "withExistingAccountReady",\s*"buildRecoveryPackage", "prepareRecoveryCopyDestination", "writeRecoveryCopy",\s*\]\)/
  );

  const dependenciesStart = activation.indexOf("const OWNERLESS_RESUME_DEPENDENCY_FIELDS");
  const dependenciesEnd = activation.indexOf("]);", dependenciesStart);
  const dependencies = activation.slice(dependenciesStart, dependenciesEnd);
  assert.match(dependencies, /prepareRecoveryCopyDestination/);
  assert.match(dependencies, /writeRecoveryCopy/);
  assert.doesNotMatch(dependencies, /adoptSyncedOwner/);

  const ownerlessStart = activation.indexOf("async function resumeOwnerless");
  const ownerlessEnd = activation.indexOf("async function resume(", ownerlessStart + 10);
  const ownerlessResume = activation.slice(ownerlessStart, ownerlessEnd);
  const recoveryInitialisedStart = ownerlessResume.indexOf(
    'if (execution.draft.stage === "recovery-initialised")'
  );
  const recoveryCopyPendingStart = ownerlessResume.indexOf(
    'if (execution.draft.stage === "recovery-copy-pending")'
  );
  const recoveryInitialisedSection = ownerlessResume.slice(
    recoveryInitialisedStart,
    recoveryCopyPendingStart
  );
  assert.match(recoveryInitialisedSection, /preparePackage\(execution\)/);
  assert.doesNotMatch(
    recoveryInitialisedSection,
    /writePackage\(execution\)/,
    "P297 must still stop at recovery-copy-pending on the same resume"
  );
  assert.match(ownerlessResume.slice(recoveryCopyPendingStart), /writePackage\(execution\)/);
  assert.doesNotMatch(ownerlessResume, /adoptSyncedOwner/);

  const prepareStart = activation.indexOf("async function preparePackage");
  const prepareEnd = activation.indexOf("function recoveryCopyWriteFailure", prepareStart);
  const prepare = activation.slice(prepareStart, prepareEnd);
  assert.match(prepare, /checked\(execution, execution\.dependencies\.buildRecoveryPackage/);
  assert.match(prepare, /error\?\.code === execution\.currentFailureCode/);
  assert.match(prepare, /ownerless\.buildRecoveryCopyPending/);

  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /ownerless-first-create|PocketSyncOwnerlessActivationDraft|findOwnerlessActivation/);
  assert.doesNotMatch(source("index.html"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
});
