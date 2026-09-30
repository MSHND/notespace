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
const NOW = Date.parse("2036-04-01T00:00:00.000Z");

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
      return `${prefix}_p293_${nextNodeId}`;
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
    ceremonyId: "ceremony-p293",
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
    accountId: "account-new-p293",
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
    accountId: "account-existing-p293",
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
  const contentCalls = [];
  const accountClient = options.accountPath === "new-account"
    ? Object.freeze({
      async authenticatePasskey() {
        counters.authenticate += 1;
        throw new Error("forbidden authenticate");
      },
      async finishRegistration(continuation) {
        counters.finish += 1;
        assert.equal(continuation.operationId, continuation.operationId);
        return registrationResult();
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
        throw new Error("unexpected content upload");
      },
    }),
    envelopeService: Object.freeze({
      async addEnvelope() {
        counters.envelope += 1;
        throw new Error("forbidden envelope");
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

function activateOptions(accountPath, suffix = "one") {
  return {
    activationMode: "ownerless-first-create",
    accountPath,
    syncedPocketId: `pocket-p293-${accountPath}-${suffix}`,
    deviceId: `device-p293-${accountPath}-${suffix}`,
  };
}

function resumeOptions(activationId) {
  return {
    activationMode: "ownerless-first-create",
    activationId,
  };
}

async function toAccountReady(harness, accountPath, suffix = "one") {
  const staged = await harness.orchestrator.activate(
    harness.activateDependencies,
    activateOptions(accountPath, suffix)
  );
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(staged.stage, "device-staged");

  const result = accountPath === "existing-unbound"
    ? await harness.orchestrator.resume(
      harness.resumeDependencies(async (consumer) => consumer(existingReady())),
      resumeOptions(staged.activationId)
    )
    : await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(staged.activationId)
    );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reason, "ownerless-account-ready");
  assert.equal(result.stage, "account-ready");
  assert.equal(harness.counters.content, 0, "P288 account-ready stop must remain exact");

  const found = await harness.rawStore.readActivation(staged.activationId);
  const draft = harness.production.ownerless.validate(found.draft, {
    securityContract: harness.production.security,
    crypto: harness.production.crypto,
  });
  assert.equal(draft.stage, "account-ready");
  assert.equal(draft.accountPath, accountPath);
  assert.equal(draft.pendingOperation, null);
  assert.equal(draft.confirmedRemoteRevision, 0);
  assert.equal(found.record.remote.confirmedRevision, 0);
  assert.equal(found.record.remote.pending.expectedRevision, 0);
  assert.equal(found.record.remote.pending.operationId, draft.ids.contentOperationId);
  assert.equal(found.record.remote.pending.logicalChangeId, draft.ids.contentLogicalChangeId);
  assert.equal(found.record.remote.pending.attemptKind, "new-change");
  assert.equal(found.record.remote.conflict, null);
  return { staged, found, draft };
}

async function readCanonical(harness, activationId) {
  const found = await harness.rawStore.readActivation(activationId);
  const draft = harness.production.ownerless.validate(found.draft, {
    securityContract: harness.production.security,
    crypto: harness.production.crypto,
  });
  return { found, draft };
}

function assertSafeCommittedResult(result, accountPath) {
  assert.deepEqual(Object.keys(result), [
    "ok", "reason", "activationId", "accountPath", "syncedPocketId", "deviceId",
    "stage", "locallyDurable", "remotelyCommitted", "confirmedRemoteRevision",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ownerless-content-committed");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "content-committed");
  assert.equal(result.locallyDurable, true);
  assert.equal(result.remotelyCommitted, true);
  assert.equal(result.confirmedRemoteRevision, 1);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /accountId|credentialId|prf|encryptedRecord|recoveryRoot/);
}

test("P293 both ownerless account paths converge through the one shared first content commit and hard-stop at content-committed", async () => {
  for (const accountPath of ["existing-unbound", "new-account"]) {
    const harness = createHarness({
      accountPath,
      contentUpload: async () => Object.freeze({
        conflict: false,
        status: "committed",
        revision: 1,
      }),
    });
    const ready = await toAccountReady(harness, accountPath, "success");
    const ids = plain(ready.draft.ids);
    const encryptedRecord = plain(ready.draft.content.record);

    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(ready.staged.activationId)
    );
    assertSafeCommittedResult(result, accountPath);
    assert.equal(harness.counters.content, 1);
    assert.equal(harness.counters.envelope, 0);
    assert.equal(harness.counters.recovery, 0);
    assert.equal(harness.counters.bridge, accountPath === "existing-unbound" ? 1 : 0);
    assert.equal(harness.counters.register, accountPath === "new-account" ? 1 : 0);
    assert.equal(harness.counters.authenticate, 0);

    const call = harness.contentCalls[0];
    assert.equal(call.apiVersion, 1);
    assert.equal(call.syncedPocketId, ready.draft.syncedPocketId);
    assert.equal(call.expectedRevision, 0);
    assert.equal(call.operationId, ids.contentOperationId);
    assert.equal(call.logicalChangeId, ids.contentLogicalChangeId);
    assert.equal(call.attemptKind, "new-change");
    assert.deepEqual(call.encryptedRecord, encryptedRecord);

    const committed = await readCanonical(harness, ready.staged.activationId);
    assert.equal(committed.draft.stage, "content-committed");
    assert.equal(committed.draft.confirmedRemoteRevision, 1);
    assert.equal(committed.draft.pendingOperation, null);
    assert.equal(committed.draft.keySetVersion, 0);
    assert.equal(committed.draft.recoveryVersion, 0);
    assert.equal(committed.draft.recoveryCopyStored, false);
    assert.equal(committed.draft.adopted, false);
    assert.equal(committed.found.record.remote.confirmedRevision, 1);
    assert.equal(committed.found.record.remote.pending, null);
    assert.equal(committed.found.record.remote.conflict, null);

    assert.equal(harness.counters.content, 1, "P293 content step uploads exactly once");
    assert.equal(
      harness.counters.envelope,
      0,
      "the P293 content-commit resume itself must still stop before device-envelope publication"
    );
    assert.equal(
      harness.counters.recovery,
      0,
      "the P293 content-commit resume itself must still stop before recovery"
    );
  }
});

test("P293 unavailable first attempt is durably resumable and the next explicit resume is one idempotent retry with exact witness", async () => {
  let callNumber = 0;
  const harness = createHarness({
    accountPath: "existing-unbound",
    contentUpload: async () => {
      callNumber += 1;
      if (callNumber === 1) throw new Error("synthetic ambiguous transport loss");
      return Object.freeze({ conflict: false, status: "committed", revision: 1 });
    },
  });
  const ready = await toAccountReady(harness, "existing-unbound", "retry");
  const operationId = ready.draft.ids.contentOperationId;
  const logicalChangeId = ready.draft.ids.contentLogicalChangeId;
  const encryptedRecord = plain(ready.draft.content.record);

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(first.ok, false);
  assert.equal(first.reason, "initial-remote-unavailable");
  assert.equal(first.locallyDurable, true);
  assert.equal(first.remotelyCommitted, false);
  assert.equal(first.resumable, true);
  assert.equal(harness.counters.content, 1, "no automatic retry is permitted");

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "account-ready");
  assert.equal(pending.draft.confirmedRemoteRevision, 0);
  assert.equal(pending.draft.pendingOperation, "content-upload");
  assert.deepEqual(plain(pending.found.record.remote.pending), {
    expectedRevision: 0,
    operationId,
    logicalChangeId,
    attemptKind: "new-change",
  });
  assert.equal(pending.found.record.remote.confirmedRevision, 0);
  assert.equal(pending.found.record.remote.conflict, null);

  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assertSafeCommittedResult(second, "existing-unbound");
  assert.equal(harness.counters.content, 2);
  assert.deepEqual(harness.contentCalls.map((call) => ({
    expectedRevision: call.expectedRevision,
    operationId: call.operationId,
    logicalChangeId: call.logicalChangeId,
    attemptKind: call.attemptKind,
    encryptedRecord: call.encryptedRecord,
  })), [
    { expectedRevision: 0, operationId, logicalChangeId, attemptKind: "new-change", encryptedRecord },
    { expectedRevision: 0, operationId, logicalChangeId, attemptKind: "idempotent-retry", encryptedRecord },
  ]);
  assert.equal(harness.counters.envelope, 0);
  assert.equal(harness.counters.recovery, 0);
});

test("P293 conflict is durably visible and a later resume never overwrites or retries remote truth", async () => {
  const harness = createHarness({
    accountPath: "existing-unbound",
    contentUpload: async () => Object.freeze({
      conflict: true,
      actualRevision: 7,
    }),
  });
  const ready = await toAccountReady(harness, "existing-unbound", "conflict");
  const operationId = ready.draft.ids.contentOperationId;

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(first.ok, false);
  assert.equal(first.reason, "initial-remote-conflict");
  assert.equal(first.conflict, true);
  assert.equal(first.resumable, false);
  assert.equal(first.remotelyCommitted, false);
  assert.equal(harness.counters.content, 1);

  const conflicted = await readCanonical(harness, ready.staged.activationId);
  assert.equal(conflicted.draft.stage, "account-ready");
  assert.equal(conflicted.draft.confirmedRemoteRevision, 0);
  assert.equal(conflicted.draft.pendingOperation, "content-conflict");
  assert.deepEqual(plain(conflicted.found.record.remote.conflict), {
    actualRevision: 7,
    operationId,
  });
  assert.equal(conflicted.found.record.remote.confirmedRevision, 0);

  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(second.ok, false);
  assert.equal(second.reason, "initial-remote-conflict");
  assert.equal(second.conflict, true);
  assert.equal(second.resumable, false);
  assert.equal(harness.counters.content, 1, "visible conflict must never trigger an overwrite retry");
  assert.equal(harness.counters.envelope, 0);
  assert.equal(harness.counters.recovery, 0);
});

test("P293 rejects a non-1 committed revision and leaves the exact upload witness resumable", async () => {
  const harness = createHarness({
    accountPath: "existing-unbound",
    contentUpload: async () => Object.freeze({
      conflict: false,
      status: "committed",
      revision: 2,
    }),
  });
  const ready = await toAccountReady(harness, "existing-unbound", "bad-revision");
  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");
  assert.equal(harness.counters.content, 1);

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "account-ready");
  assert.equal(pending.draft.confirmedRemoteRevision, 0);
  assert.equal(pending.draft.pendingOperation, "content-upload");
  assert.equal(pending.found.record.remote.confirmedRevision, 0);
  assert.equal(pending.found.record.remote.pending.expectedRevision, 0);
  assert.equal(pending.found.record.remote.pending.operationId, ready.draft.ids.contentOperationId);
  assert.equal(
    pending.found.record.remote.pending.logicalChangeId,
    ready.draft.ids.contentLogicalChangeId
  );
  assert.equal(harness.counters.envelope, 0);
  assert.equal(harness.counters.recovery, 0);
});

test("P293 semantic none/replaceable currentness survives transient identity but stops if ownership changes across remote await", async () => {
  let stale = false;
  const harness = createHarness({
    accountPath: "existing-unbound",
    target(count) {
      return stale
        ? { ownerKind: "json", continuityId: "json-owner" }
        : { ownerKind: "none", continuityId: `transient-none-${count}` };
    },
    contentUpload: async () => {
      stale = true;
      return Object.freeze({ conflict: false, status: "committed", revision: 1 });
    },
  });
  const ready = await toAccountReady(harness, "existing-unbound", "stale");
  const result = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(ready.staged.activationId)
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(result.locallyDurable, true);
  assert.equal(harness.counters.content, 1);

  const pending = await readCanonical(harness, ready.staged.activationId);
  assert.equal(pending.draft.stage, "account-ready");
  assert.equal(pending.draft.pendingOperation, "content-upload");
  assert.equal(pending.draft.confirmedRemoteRevision, 0);
  assert.equal(pending.found.record.remote.pending.expectedRevision, 0);
  assert.equal(harness.counters.envelope, 0);
  assert.equal(harness.counters.recovery, 0);
});

test("P293 canonical owner owns all v2 content transitions; the runtime reuses one commitContent pipeline and stays UI-dormant", () => {
  const ownerless = source(OWNERLESS);
  assert.match(ownerless, /function buildContentUploadPending\s*\(/);
  assert.match(ownerless, /function buildContentConflict\s*\(/);
  assert.match(ownerless, /function buildContentCommitted\s*\(/);

  const activation = source(ACTIVATION);
  assert.equal((activation.match(/async function commitContent\s*\(/g) || []).length, 1);
  assert.doesNotMatch(activation, /commitOwnerlessContent|ownerlessCommitContent/);
  const contentStart = activation.indexOf("async function commitContent");
  const contentEnd = activation.indexOf("async function addEnvelope", contentStart);
  const contentSection = activation.slice(contentStart, contentEnd);
  assert.match(contentSection, /config\.contentService\.conditionalUpload/);
  assert.match(contentSection, /expectedRevision:\s*0/);
  assert.match(contentSection, /contentUploadPendingDraft\(execution\)/);
  assert.match(contentSection, /contentConflictDraft\(execution\)/);
  assert.match(contentSection, /contentCommittedDraft\(execution\)/);

  assert.equal((source("index.html").match(/pocket-sync-ownerless-activation-draft\.js/g) || []).length, 1);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /ownerless-first-create|PocketSyncOwnerlessActivationDraft|findOwnerlessActivation/);
});
