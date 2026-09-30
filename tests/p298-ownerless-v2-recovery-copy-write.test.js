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
    destination: 0,
    write: 0,
  };
  const contentCalls = [];
  const envelopeCalls = [];
  const recoveryCalls = [];
  const packageCalls = [];
  const writeCalls = [];
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
    writeCalls,
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
          counters.destination += 1;
          if (typeof options.prepareRecoveryCopyDestination === "function") {
            return options.prepareRecoveryCopyDestination(counters.destination);
          }
          return Object.freeze({
            ok: true,
            destination: Object.freeze({
              kind: "synthetic-p298-destination",
              id: `destination-${counters.destination}`,
            }),
          });
        },
        async writeRecoveryCopy(input) {
          counters.write += 1;
          writeCalls.push(plain(input));
          if (typeof options.writeRecoveryCopy === "function") {
            return options.writeRecoveryCopy(input, counters.write);
          }
          return Object.freeze({ ok: true });
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

async function toRecoveryCopyPending(harness, accountPath, prfMode, suffix) {
  const ready = await toRecoveryInitialised(harness, accountPath, prfMode, suffix);
  assert.equal(harness.counters.package, 0);
  assert.equal(harness.counters.destination, 0);
  assert.equal(harness.counters.write, 0);

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assertSafePackagePendingResult(
    result,
    accountPath,
    prfMode === "available" ? 3 : 2
  );
  assert.equal(harness.counters.package, 1);
  assert.equal(
    harness.counters.destination,
    0,
    "P297 same-resume hard stop must precede destination preparation"
  );
  assert.equal(
    harness.counters.write,
    0,
    "P297 same-resume hard stop must precede Recovery Copy writing"
  );

  const canonical = await readCanonical(harness, ready.staged.activationId);
  assert.equal(canonical.draft.stage, "recovery-copy-pending");
  assert.notEqual(canonical.draft.recoveryPackage, null);
  assert.equal(canonical.draft.recoveryCopyStored, false);
  assert.equal(canonical.draft.adopted, false);
  return { staged: ready.staged, canonical };
}

function assertSafeReadyResult(result, accountPath, expectedKeySetVersion) {
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId", "deviceId",
    "stage", "locallyDurable", "remotelyCommitted", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "recoveryCopyRequired",
    "recoveryCopyStored", "adopted",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ownerless-ready-for-adoption");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "ready-for-adoption");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.keySetVersion, expectedKeySetVersion);
  assert.equal(result.recoveryVersion, 1);
  assert.equal(result.recoveryCopyRequired, false);
  assert.equal(result.recoveryCopyStored, true);
  assert.equal(result.adopted, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /recoveryPackage|recoveryRoot|recoveryAuthorisation|accountLocator|accountId|credentialId|checksum|recoveryEnvelope|recoveryVerifier|outputBytes/
  );
}

function assertOwnerlessCopyFailure(result) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-recovery-copy-not-stored");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.resumable, true);
  assert.equal(result.recoveryCopyRequired, true);
}

test("P298 both account paths and both PRF branches write the exact persisted package then stop at ready-for-adoption", async () => {
  for (const accountPath of ["existing-unbound", "new-account"]) {
    for (const prfMode of ["available", "skipped"]) {
      const harness = createHarness({ accountPath, prfMode });
      const pending = await toRecoveryCopyPending(
        harness,
        accountPath,
        prfMode,
        \`\${accountPath}-\${prfMode}-success\`
      );
      const before = plain(pending.canonical.draft);
      const beforeRemote = plain(pending.canonical.found.record.remote);
      const beforeAccount = plain(before.account);
      const beforeRecoveryEnvelope = plain(before.recoveryEnvelope);
      const beforeRecoveryVerifier = plain(before.recoveryVerifier);
      const beforePrfEnvelope = plain(before.prfEnvelope);
      const remoteCounts = {
        content: harness.counters.content,
        envelope: harness.counters.envelope,
        recovery: harness.counters.recovery,
        package: harness.counters.package,
      };

      const result = await harness.orchestrator.resume(
        harness.resumeDependencies(),
        resumeOptions(pending.staged.activationId)
      );
      const expectedKeySetVersion = prfMode === "available" ? 3 : 2;
      assertSafeReadyResult(result, accountPath, expectedKeySetVersion);
      assert.equal(harness.counters.destination, 1);
      assert.equal(harness.counters.write, 1);
      assert.deepEqual({
        content: harness.counters.content,
        envelope: harness.counters.envelope,
        recovery: harness.counters.recovery,
        package: harness.counters.package,
      }, remoteCounts, "P298 repeats no remote or package-construction step");

      assert.equal(harness.writeCalls.length, 1);
      assert.deepEqual(
        harness.writeCalls[0].recoveryPackage,
        before.recoveryPackage,
        "the exact persisted P297 package is handed to the existing writer"
      );
      assert.deepEqual(harness.writeCalls[0].destination, {
        kind: "synthetic-p298-destination",
        id: "destination-1",
      });

      const ready = await readCanonical(harness, pending.staged.activationId);
      assert.equal(ready.draft.stage, "ready-for-adoption");
      assert.equal(ready.draft.recoveryCopyStored, true);
      assert.equal(ready.draft.recoveryPackage, null);
      assert.equal(ready.draft.recoveryRoot, null);
      assert.equal(ready.draft.recoveryAuthorisation, null);
      assert.equal(ready.draft.adopted, false);
      assert.equal(ready.draft.accountLocator, before.accountLocator);
      assert.equal(ready.draft.confirmedRemoteRevision, before.confirmedRemoteRevision);
      assert.equal(ready.draft.keySetVersion, before.keySetVersion);
      assert.equal(ready.draft.recoveryVersion, before.recoveryVersion);
      assert.deepEqual(plain(ready.draft.account), beforeAccount);
      assert.deepEqual(plain(ready.draft.recoveryEnvelope), beforeRecoveryEnvelope);
      assert.deepEqual(plain(ready.draft.recoveryVerifier), beforeRecoveryVerifier);
      assert.deepEqual(plain(ready.draft.prfEnvelope), beforePrfEnvelope);
      assert.deepEqual(plain(ready.found.record.remote), beforeRemote);
      assert.equal(
        Object.prototype.hasOwnProperty.call(ready.draft, "destination"),
        false,
        "Recovery Copy destination remains execution-local"
      );
    }
  }
});

test("P298 destination cancellation is resumable and leaves the durable recovery-copy-pending state byte-for-byte unchanged", async () => {
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    prepareRecoveryCopyDestination: async () => Object.freeze({ ok: false, cancelled: true }),
  });
  const pending = await toRecoveryCopyPending(
    harness,
    "existing-unbound",
    "available",
    "destination-cancel"
  );
  const beforeDraft = plain(pending.canonical.draft);
  const beforeRevision = pending.canonical.found.record.storeRevision;

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(pending.staged.activationId)
  );
  assertOwnerlessCopyFailure(result);
  assert.equal(harness.counters.destination, 1);
  assert.equal(harness.counters.write, 0);

  const after = await readCanonical(harness, pending.staged.activationId);
  assert.deepEqual(plain(after.draft), beforeDraft);
  assert.equal(after.found.record.storeRevision, beforeRevision);
  assert.equal(after.draft.recoveryCopyStored, false);
  assert.notEqual(after.draft.recoveryPackage, null);
});

test("P298 write failure performs zero automatic retry, preserves the exact package, and only a later explicit resume reaches ready-for-adoption", async () => {
  let allowWrite = false;
  const harness = createHarness({
    accountPath: "new-account",
    prfMode: "skipped",
    writeRecoveryCopy: async () => allowWrite
      ? Object.freeze({ ok: true })
      : Object.freeze({ ok: false, cancelled: true }),
  });
  const pending = await toRecoveryCopyPending(
    harness,
    "new-account",
    "skipped",
    "write-retry"
  );
  const beforeDraft = plain(pending.canonical.draft);
  const beforeRevision = pending.canonical.found.record.storeRevision;

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(pending.staged.activationId)
  );
  assertOwnerlessCopyFailure(first);
  assert.equal(harness.counters.destination, 1);
  assert.equal(harness.counters.write, 1, "zero automatic write retry required");
  const paused = await readCanonical(harness, pending.staged.activationId);
  assert.deepEqual(plain(paused.draft), beforeDraft);
  assert.equal(paused.found.record.storeRevision, beforeRevision);

  allowWrite = true;
  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(pending.staged.activationId)
  );
  assertSafeReadyResult(second, "new-account", 2);
  assert.equal(harness.counters.destination, 2, "destination is execution-local and prepared again");
  assert.equal(harness.counters.write, 2);
  assert.deepEqual(
    harness.writeCalls[0].recoveryPackage,
    harness.writeCalls[1].recoveryPackage,
    "explicit retry reuses the exact persisted Recovery Copy package"
  );
});

test("P298 ownerless currentness fails closed across destination preparation before any write or durable advancement", async () => {
  let stale = false;
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "available",
    target() {
      return stale
        ? { ownerKind: "json", continuityId: "replacement-owner" }
        : { ownerKind: "none", continuityId: "transient-ownerless" };
    },
    prepareRecoveryCopyDestination: async () => {
      stale = true;
      return Object.freeze({
        ok: true,
        destination: Object.freeze({ kind: "synthetic-p298-stale-destination" }),
      });
    },
  });
  const pending = await toRecoveryCopyPending(
    harness,
    "existing-unbound",
    "available",
    "stale-destination"
  );
  const beforeDraft = plain(pending.canonical.draft);
  const beforeRevision = pending.canonical.found.record.storeRevision;

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(pending.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(harness.counters.destination, 1);
  assert.equal(harness.counters.write, 0);

  const after = await readCanonical(harness, pending.staged.activationId);
  assert.deepEqual(plain(after.draft), beforeDraft);
  assert.equal(after.found.record.storeRevision, beforeRevision);
});

test("P298 ownerless currentness fails closed across the Recovery Copy write and does not falsely persist ready state", async () => {
  let stale = false;
  const harness = createHarness({
    accountPath: "existing-unbound",
    prfMode: "skipped",
    target() {
      return stale
        ? { ownerKind: "vault", continuityId: "replacement-owner" }
        : { ownerKind: "none", continuityId: "transient-ownerless" };
    },
    writeRecoveryCopy: async () => {
      stale = true;
      return Object.freeze({ ok: true });
    },
  });
  const pending = await toRecoveryCopyPending(
    harness,
    "existing-unbound",
    "skipped",
    "stale-write"
  );
  const beforeDraft = plain(pending.canonical.draft);
  const beforeRevision = pending.canonical.found.record.storeRevision;

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(pending.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(harness.counters.destination, 1);
  assert.equal(harness.counters.write, 1);

  const after = await readCanonical(harness, pending.staged.activationId);
  assert.deepEqual(plain(after.draft), beforeDraft);
  assert.equal(after.found.record.storeRevision, beforeRevision);
  assert.equal(after.draft.stage, "recovery-copy-pending");
  assert.equal(after.draft.recoveryCopyStored, false);
});

test("P298 source shape reuses one writer, keeps P297 hard stop, owns v2 ready transition canonically, and contains zero owner adoption/runtime wiring", () => {
  const activation = source(ACTIVATION);
  const ownerless = source(OWNERLESS);

  assert.equal((activation.match(/async function writePackage\\s*\\(/g) || []).length, 1);
  assert.match(ownerless, /function buildReadyForAdoption\\s*\\(/);
  assert.match(
    activation,
    /const OWNERLESS_RESUME_DEPENDENCY_FIELDS = Object\\.freeze\\(\\[\\s*"captureTarget", "isTargetReplaceable", "withExistingAccountReady",\\s*"buildRecoveryPackage", "prepareRecoveryCopyDestination", "writeRecoveryCopy",\\s*\\]\\)/
  );

  const dependenciesStart = activation.indexOf("const OWNERLESS_RESUME_DEPENDENCY_FIELDS");
  const dependenciesEnd = activation.indexOf("]);", dependenciesStart);
  const dependencies = activation.slice(dependenciesStart, dependenciesEnd);
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
  assert.notEqual(recoveryInitialisedStart, -1);
  assert.notEqual(recoveryCopyPendingStart, -1);
  const p297Section = ownerlessResume.slice(recoveryInitialisedStart, recoveryCopyPendingStart);
  assert.match(p297Section, /preparePackage\\(execution\\)/);
  assert.doesNotMatch(p297Section, /writePackage\\(execution\\)/);
  const p298Section = ownerlessResume.slice(recoveryCopyPendingStart);
  assert.match(p298Section, /writePackage\\(execution\\)/);
  assert.match(p298Section, /ownerlessReadyForAdoptionResult\\(execution\\.draft\\)/);
  assert.doesNotMatch(ownerlessResume, /adopt\\(execution\\)|adoptSyncedOwner/);

  const writeStart = activation.indexOf("async function writePackage");
  const writeEnd = activation.indexOf("async function adopt(", writeStart);
  const write = activation.slice(writeStart, writeEnd);
  assert.match(write, /ownerless\\.buildReadyForAdoption/);
  assert.match(write, /execution\\.dependencies\\.prepareRecoveryCopyDestination\\(\\)/);
  assert.match(write, /execution\\.dependencies\\.writeRecoveryCopy/);
  assert.match(write, /recoveryPackage:\\s*execution\\.draft\\.recoveryPackage/);
  assert.equal(
    (write.match(/error\\?\\.code === execution\\.currentFailureCode/g) || []).length,
    2,
    "both local awaits preserve semantic ownerless currentness and historical v1 source currentness"
  );
  assert.match(write, /if \\(ownerless\\) \\{\\s*await persistDraft\\(execution, ownerlessReadyDraft\\)/);

  const builderStart = ownerless.indexOf("function buildReadyForAdoption");
  const builderEnd = ownerless.indexOf("function classifyCompletion", builderStart);
  const builder = ownerless.slice(builderStart, builderEnd);
  assert.match(builder, /stage:\\s*"ready-for-adoption"/);
  assert.match(builder, /recoveryCopyStored:\\s*true/);
  assert.match(builder, /recoveryRoot:\\s*null/);
  assert.match(builder, /recoveryAuthorisation:\\s*null/);
  assert.match(builder, /recoveryPackage:\\s*null/);
  assert.doesNotMatch(builder, /account:\\s*null|accountLocator:\\s*null|recoveryEnvelope:\\s*null|recoveryVerifier:\\s*null/);

  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /ownerless-first-create|PocketSyncOwnerlessActivationDraft|findOwnerlessActivation/);
  assert.doesNotMatch(source("index.html"), /pocket-sync-ownerless-activation-draft\\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\\.js/);
});
