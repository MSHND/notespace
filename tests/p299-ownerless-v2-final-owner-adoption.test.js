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
    "js/pocket-sync-owner-controller.js",
    ACTIVATION,
    "js/pocket-sync-activation-owner-bridge.js",
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    ownerless: context.PocketSyncOwnerlessActivationDraft,
    deviceStoreModule: context.PocketSyncDeviceStore,
    ownerControllerModule: context.PocketSyncOwnerController,
    activation: context.PocketSyncActivation,
    activationOwnerBridge: context.PocketSyncActivationOwnerBridge,
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
  const driver = createMemoryDeviceStoreDriver(shared);
  const rawStore = production.deviceStoreModule.createStore(driver);
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
    adopt: 0,
    install: 0,
    release: 0,
  };
  const contentCalls = [];
  const envelopeCalls = [];
  const recoveryCalls = [];
  const packageCalls = [];
  const writeCalls = [];
  const adoptionDescriptors = [];
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
    readRecoveryAttempt: (...args) => rawStore.readRecoveryAttempt(...args),
    createPocket: (...args) => rawStore.createPocket(...args),
    replacePocket: (...args) => rawStore.replacePocket(...args),
    reservePocketEncryptionUsage: (...args) => rawStore.reservePocketEncryptionUsage(...args),
  });

  let randomCounter = 0;
  const contentService = Object.freeze({
    async conditionalUpload(input) {
      counters.content += 1;
      contentCalls.push(plain(input));
      return Object.freeze({
        conflict: false,
        status: "committed",
        revision: 1,
      });
    },
  });
  const ownerController = production.ownerControllerModule.createSyncedOwnerController({
    crypto: production.crypto,
    deviceStore,
    contentService,
    randomBytes(length) {
      randomCounter += 1;
      return bytes(length, randomCounter * 11);
    },
  });
  const orchestrator = production.activation.createActivationOrchestrator({
    securityContract: production.security,
    crypto: production.crypto,
    deviceStore,
    accountClient,
    contentService,
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
    driver,
    orchestrator,
    counters,
    contentCalls,
    envelopeCalls,
    recoveryCalls,
    packageCalls,
    writeCalls,
    adoptionDescriptors,
    ownerController,
    get ownerInstalled() { return ownerController.getSyncedOwnerState() !== null; },
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
        async adoptSyncedOwner(ownerDescriptor) {
          const bridge = production.activationOwnerBridge.createActivationOwnerBridge({
            syncedOwnerController: Object.freeze({
              async adoptReadyActivation(descriptor) {
                counters.adopt += 1;
                adoptionDescriptors.push(plain(descriptor));
                if (options.adoptionRejects === true) return Object.freeze({ ok: false });
                return ownerController.adoptReadyActivation(descriptor);
              },
              releaseSyncedOwner() {
                counters.release += 1;
                return ownerController.releaseSyncedOwner();
              },
            }),
            ownerSaveBoundary: Object.freeze({
              installSyncedOwnerForSave(controller) {
                counters.install += 1;
                if (controller !== ownerController || options.installFails === true) return false;
                return true;
              },
            }),
          });
          const result = await bridge.adoptSyncedOwner(ownerDescriptor);
          if (result?.ok === true && options.finalisationFails === true) {
            driver.failAt("during-commit");
          }
          return result;
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

async function toReadyForAdoption(harness, accountPath, prfMode, suffix) {
  const pending = await toRecoveryCopyPending(harness, accountPath, prfMode, suffix);
  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(pending.staged.activationId)
  );
  assertSafeReadyResult(
    result,
    accountPath,
    prfMode === "available" ? 3 : 2
  );
  assert.equal(harness.counters.adopt, 0, "P298 must still stop before P299 owner adoption");
  const canonical = await readCanonical(harness, pending.staged.activationId);
  assert.equal(canonical.draft.stage, "ready-for-adoption");
  assert.equal(canonical.draft.recoveryCopyStored, true);
  assert.equal(canonical.draft.adopted, false);
  return { staged: pending.staged, canonical };
}

function assertSafeActivatedResult(result, accountPath, expectedKeySetVersion) {
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId", "deviceId",
    "stage", "locallyDurable", "remotelyCommitted", "confirmedRemoteRevision",
    "keySetVersion", "recoveryVersion", "recoveryCopyStored", "adopted",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ownerless-activated");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "adopted");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  assert.equal(result.keySetVersion, expectedKeySetVersion);
  assert.equal(result.recoveryVersion, 1);
  assert.equal(result.recoveryCopyStored, true);
  assert.equal(result.adopted, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /ownerlessReadiness|"accountId":|"credentialId":|"prfEvaluationInput":|"outputBytes":|"recoveryRoot":|"recoveryAuthorisation":|"recoveryPackage":|"masterKey":|"ciphertext":/
  );
}

function readinessExpected() {
  return {
    activationPhase: "pre-adoption",
    targetCurrentOrReplaceable: true,
    canonicalPayloadPreparedLocally: true,
    masterKeyCreatedLocally: true,
    deviceRecordDurable: true,
    accountIdentityAuthenticatedAndPinned: true,
    accountEligibleForFirstCreation: true,
    initialRemoteCommitSucceeded: true,
    recoveryEnvelopeExists: true,
    recoveryCopyStored: true,
    syncedOwnerAdopted: false,
  };
}

test("P299 both account paths and both PRF branches adopt once through the activation-owner bridge, persist canonical adopted truth, and return only safe completion", async () => {
  for (const accountPath of ["existing-unbound", "new-account"]) {
    for (const prfMode of ["available", "skipped"]) {
      const harness = createHarness({ accountPath, prfMode });
      const ready = await toReadyForAdoption(
        harness,
        accountPath,
        prfMode,
        accountPath + "-" + prfMode + "-success"
      );
      const before = plain(ready.canonical.draft);
      const beforeRemote = plain(ready.canonical.found.record.remote);
      const beforeAccount = plain(before.account);
      const beforeRecoveryEnvelope = plain(before.recoveryEnvelope);
      const beforeRecoveryVerifier = plain(before.recoveryVerifier);
      const beforePrfEnvelope = plain(before.prfEnvelope);
      const beforeStoreRevision = ready.canonical.found.record.storeRevision;
      const remoteCounts = {
        content: harness.counters.content,
        envelope: harness.counters.envelope,
        recovery: harness.counters.recovery,
        package: harness.counters.package,
        destination: harness.counters.destination,
        write: harness.counters.write,
      };

      const result = await harness.orchestrator.resume(
        harness.resumeDependencies(),
        resumeOptions(ready.staged.activationId)
      );
      assertSafeActivatedResult(result, accountPath, prfMode === "available" ? 3 : 2);
      assert.equal(harness.counters.adopt, 1);
      assert.equal(harness.counters.install, 1);
      assert.equal(harness.counters.release, 0);
      assert.equal(harness.ownerInstalled, true);
      assert.deepEqual({
        content: harness.counters.content,
        envelope: harness.counters.envelope,
        recovery: harness.counters.recovery,
        package: harness.counters.package,
        destination: harness.counters.destination,
        write: harness.counters.write,
      }, remoteCounts, "P299 performs no remote, Recovery Copy, or reconstruction work");

      assert.equal(harness.adoptionDescriptors.length, 1);
      const descriptor = harness.adoptionDescriptors[0];
      assert.deepEqual(Object.keys(descriptor), [
        "ownerKind", "activationId", "syncedPocketId", "deviceId",
        "confirmedRemoteRevision", "syncPending", "ownerlessReadiness",
      ]);
      assert.equal(descriptor.ownerKind, "synced");
      assert.equal(descriptor.activationId, ready.staged.activationId);
      assert.equal(descriptor.confirmedRemoteRevision, 1);
      assert.equal(descriptor.syncPending, false);
      assert.deepEqual(descriptor.ownerlessReadiness, readinessExpected());
      assert.deepEqual(
        plain(harness.production.security.validateOwnerlessActivationReadiness(
          descriptor.ownerlessReadiness
        )),
        { ok: true, ready: true }
      );
      assert.doesNotMatch(
        JSON.stringify(descriptor),
        /"accountId":|"credentialId":|"prfEvaluationInput":|"outputBytes":|"recoveryRoot":|"recoveryAuthorisation":|"recoveryPackage":|"masterKey":|"ciphertext":/
      );

      const adopted = await readCanonical(harness, ready.staged.activationId);
      assert.equal(adopted.draft.stage, "adopted");
      assert.equal(adopted.draft.adopted, true);
      assert.equal(adopted.draft.recoveryCopyStored, true);
      assert.equal(adopted.draft.recoveryRoot, null);
      assert.equal(adopted.draft.recoveryAuthorisation, null);
      assert.equal(adopted.draft.recoveryPackage, null);
      assert.equal(adopted.draft.pendingOperation, null);
      assert.equal(adopted.found.record.storeRevision, beforeStoreRevision + 1);
      assert.deepEqual(plain(adopted.draft.account), beforeAccount);
      assert.deepEqual(plain(adopted.draft.recoveryEnvelope), beforeRecoveryEnvelope);
      assert.deepEqual(plain(adopted.draft.recoveryVerifier), beforeRecoveryVerifier);
      assert.deepEqual(plain(adopted.draft.prfEnvelope), beforePrfEnvelope);
      assert.equal(adopted.draft.accountLocator, before.accountLocator);
      assert.equal(adopted.draft.confirmedRemoteRevision, before.confirmedRemoteRevision);
      assert.equal(adopted.draft.keySetVersion, before.keySetVersion);
      assert.equal(adopted.draft.recoveryVersion, before.recoveryVersion);
      assert.deepEqual(plain(adopted.found.record.remote), beforeRemote);
      assert.deepEqual(
        plain(harness.production.ownerless.classifyAdopted(adopted.draft, {
          securityContract: harness.production.security,
          crypto: harness.production.crypto,
        })),
        {
          state: "adopted",
          activationId: ready.staged.activationId,
          syncedPocketId: adopted.draft.syncedPocketId,
          deviceId: adopted.draft.deviceId,
        }
      );
    }
  }
});

test("P299 rechecks ownerless currentness immediately before the ownership-changing call and stale target means zero adoption", async () => {
  const harness = createHarness({ accountPath: "existing-unbound", prfMode: "available" });
  const ready = await toReadyForAdoption(harness, "existing-unbound", "available", "stale-before-adopt");
  const before = plain(ready.canonical.draft);
  const beforeRevision = ready.canonical.found.record.storeRevision;
  let checks = 0;
  const base = harness.resumeDependencies();
  const dependencies = Object.freeze({
    ...base,
    captureTarget() {
      checks += 1;
      return checks === 1
        ? { ownerKind: "none", transientId: "p299-current" }
        : { ownerKind: "json", continuityId: "p299-replacement" };
    },
    isTargetReplaceable() { return true; },
  });

  const result = await harness.orchestrator.resume(
    dependencies,
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(checks, 2);
  assert.equal(harness.counters.adopt, 0);
  assert.equal(harness.counters.install, 0);

  const after = await readCanonical(harness, ready.staged.activationId);
  assert.deepEqual(plain(after.draft), before);
  assert.equal(after.found.record.storeRevision, beforeRevision);
});

test("P299 owner-adapter rejection leaves exact ready-for-adoption truth intact and resumable with no automatic retry", async () => {
  const harness = createHarness({ accountPath: "new-account", prfMode: "skipped", adoptionRejects: true });
  const ready = await toReadyForAdoption(harness, "new-account", "skipped", "adoption-rejected");
  const before = plain(ready.canonical.draft);
  const beforeRevision = ready.canonical.found.record.storeRevision;

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.deepEqual(plain(result), {
    ok: false,
    reason: "ownerless-adoption-failed",
    activationId: ready.staged.activationId,
    adopted: false,
    locallyDurable: true,
    remotelyCommitted: true,
    recoveryCopyStored: true,
    recoveryCopyRequired: false,
    resumable: true,
  });
  assert.equal(harness.counters.adopt, 1);
  assert.equal(harness.counters.install, 0);
  const after = await readCanonical(harness, ready.staged.activationId);
  assert.deepEqual(plain(after.draft), before);
  assert.equal(after.found.record.storeRevision, beforeRevision);
});

test("P299 successful owner change followed by durable finalisation failure is terminal and never performs a second adoption or stale-target recheck", async () => {
  const harness = createHarness({ accountPath: "existing-unbound", prfMode: "skipped", finalisationFails: true });
  const ready = await toReadyForAdoption(harness, "existing-unbound", "skipped", "finalisation-fails");
  const before = plain(ready.canonical.draft);
  const beforeTargetChecks = harness.counters.captureTarget;

  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.deepEqual(plain(result), {
    ok: false,
    reason: "ownerless-adoption-finalisation-failed",
    activationId: ready.staged.activationId,
    adopted: true,
    locallyDurable: true,
    remotelyCommitted: true,
    recoveryCopyStored: true,
    resumable: false,
  });
  assert.equal(harness.counters.adopt, 1);
  assert.equal(harness.counters.install, 1);
  assert.equal(harness.ownerInstalled, true);
  assert.equal(harness.counters.captureTarget, beforeTargetChecks + 2);

  const durable = await readCanonical(harness, ready.staged.activationId);
  assert.equal(durable.draft.stage, "ready-for-adoption");
  assert.equal(durable.draft.adopted, false);
  assert.deepEqual(plain(durable.draft), before);
});

test("P299 exact adopted resume converges without target checks, repeat adoption, remote work, Recovery Copy work, or reconstruction", async () => {
  const harness = createHarness({ accountPath: "new-account", prfMode: "available" });
  const ready = await toReadyForAdoption(harness, "new-account", "available", "adopted-replay");
  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assertSafeActivatedResult(first, "new-account", 3);
  const adoptedBefore = await readCanonical(harness, ready.staged.activationId);
  const snapshot = {
    adopt: harness.counters.adopt,
    install: harness.counters.install,
    content: harness.counters.content,
    envelope: harness.counters.envelope,
    recovery: harness.counters.recovery,
    package: harness.counters.package,
    destination: harness.counters.destination,
    write: harness.counters.write,
    target: harness.counters.captureTarget,
    revision: adoptedBefore.found.record.storeRevision,
  };

  const base = harness.resumeDependencies();
  const replayDependencies = Object.freeze({
    ...base,
    captureTarget() { throw new Error("adopted replay must not inspect retired target"); },
    isTargetReplaceable() { throw new Error("adopted replay must not inspect retired target"); },
    async adoptSyncedOwner() { throw new Error("adopted replay must not adopt again"); },
    async buildRecoveryPackage() { throw new Error("adopted replay must not rebuild package"); },
    async prepareRecoveryCopyDestination() { throw new Error("adopted replay must not prepare copy"); },
    async writeRecoveryCopy() { throw new Error("adopted replay must not write copy"); },
  });
  const replay = await harness.orchestrator.resume(
    replayDependencies,
    resumeOptions(ready.staged.activationId)
  );
  assertSafeActivatedResult(replay, "new-account", 3);

  const adoptedAfter = await readCanonical(harness, ready.staged.activationId);
  assert.deepEqual({
    adopt: harness.counters.adopt,
    install: harness.counters.install,
    content: harness.counters.content,
    envelope: harness.counters.envelope,
    recovery: harness.counters.recovery,
    package: harness.counters.package,
    destination: harness.counters.destination,
    write: harness.counters.write,
    target: harness.counters.captureTarget,
    revision: adoptedAfter.found.record.storeRevision,
  }, snapshot);
  assert.deepEqual(plain(adoptedAfter.draft), plain(adoptedBefore.draft));
});

test("P299 source shape has one shared adopter, exact ownerless readiness, canonical buildAdopted finalisation, P298 hard stop, and no runtime/UI wiring", () => {
  const activation = source(ACTIVATION);
  const ownerless = source(OWNERLESS);

  assert.equal((activation.match(/async function adopt\s*\(/g) || []).length, 1);
  assert.match(ownerless, /function buildAdopted\s*\(/);
  assert.match(
    activation,
    /const OWNERLESS_RESUME_DEPENDENCY_FIELDS = Object\.freeze\(\[\s*"captureTarget", "isTargetReplaceable", "withExistingAccountReady",\s*"buildRecoveryPackage", "prepareRecoveryCopyDestination", "writeRecoveryCopy",\s*"adoptSyncedOwner",\s*\]\)/
  );

  const adoptStart = activation.indexOf("async function adopt(execution)");
  const successStart = activation.indexOf("function successResult", adoptStart);
  const adopt = activation.slice(adoptStart, successStart);
  assert.match(adopt, /validateOwnerlessActivationReadiness\(readinessInput\)/);
  for (const field of [
    'activationPhase: "pre-adoption"',
    "targetCurrentOrReplaceable: true",
    "canonicalPayloadPreparedLocally: true",
    "masterKeyCreatedLocally: true",
    "deviceRecordDurable: true",
    "accountIdentityAuthenticatedAndPinned: true",
    "accountEligibleForFirstCreation: true",
    "initialRemoteCommitSucceeded: true",
    "recoveryEnvelopeExists: true",
    "recoveryCopyStored: true",
    "syncedOwnerAdopted: false",
  ]) assert.ok(adopt.includes(field), field);
  assert.match(adopt, /ownerlessReadiness: readinessInput/);
  assert.match(
    adopt,
    /await ensureCurrent\(execution\);\s*let adopted;\s*try \{ adopted = await execution\.dependencies\.adoptSyncedOwner\(owner\);/
  );
  const afterAdoption = adopt.slice(adopt.indexOf("execution.dependencies.adoptSyncedOwner(owner)"));
  assert.doesNotMatch(afterAdoption, /ensureCurrent\(execution\)|checked\(execution/);
  assert.match(afterAdoption, /await persistAdoptedDraft\(execution\)/);

  const persistStart = activation.indexOf("async function persistAdoptedDraft");
  const persistEnd = activation.indexOf("function changedDraft", persistStart);
  const persist = activation.slice(persistStart, persistEnd);
  assert.match(persist, /ownerless\.buildAdopted/);
  assert.doesNotMatch(persist, /checked\(execution/);

  const builderStart = ownerless.indexOf("function buildAdopted");
  const builderEnd = ownerless.indexOf("function classifyCompletion", builderStart);
  const builder = ownerless.slice(builderStart, builderEnd);
  assert.match(builder, /stage:\s*"adopted"/);
  assert.match(builder, /adopted:\s*true/);
  assert.match(builder, /draft\.stage !== "ready-for-adoption"/);
  assert.match(builder, /draft\.recoveryCopyStored !== true/);

  const ownerlessStart = activation.indexOf("async function resumeOwnerless");
  const ownerlessEnd = activation.indexOf("async function resume(", ownerlessStart + 10);
  const ownerlessResume = activation.slice(ownerlessStart, ownerlessEnd);
  const adoptedStart = ownerlessResume.indexOf('if (execution.draft.stage === "adopted")');
  const firstCurrentCheck = ownerlessResume.indexOf("await ensureCurrent(execution)");
  assert.notEqual(adoptedStart, -1);
  assert.ok(adoptedStart < firstCurrentCheck);
  assert.match(ownerlessResume, /ownerless\.classifyAdopted/);
  assert.match(ownerlessResume, /return await adopt\(execution\)/);

  const recoveryCopyStart = ownerlessResume.indexOf('if (execution.draft.stage === "recovery-copy-pending")');
  const recoveryCopyTail = ownerlessResume.slice(recoveryCopyStart);
  const readyReturn = recoveryCopyTail.indexOf("return ownerlessReadyForAdoptionResult(execution.draft);");
  assert.notEqual(readyReturn, -1);
  assert.doesNotMatch(
    recoveryCopyTail.slice(0, readyReturn),
    /adopt\(execution\)|adoptSyncedOwner/,
    "P298 same-resume write still stops before P299"
  );

  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /ownerless-first-create|PocketSyncOwnerlessActivationDraft|findOwnerlessActivation/);
  assert.doesNotMatch(source("index.html"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
});
