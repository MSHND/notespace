"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SECRET = "P309-SECRET-MUST-NOT-ENTER-BOOKKEEPING";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createHarness(options = {}) {
  const payload = Object.freeze({ mainThoughtTree: [{ id: "root", label: "saved" }] });
  const calls = {
    start: [],
    continue: [],
    activate: 0,
    resume: 0,
    openExisting: 0,
    recoverExisting: 0,
    resumeRecovery: 0,
    findRecoveryAttempt: 0,
    admitAcceptedDeleteRestore: 0,
    storeIds: [],
    revisionIds: [],
    downloadIds: [],
    uiInstall: 0,
  };
  const startResults = (options.startResults || []).slice();
  const continueResults = (options.continueResults || []).slice();
  const activateResult = options.activateResult || { ok: false, reason: "activation-test-failure" };

  function next(queue, fallback) {
    const value = queue.length ? queue.shift() : fallback;
    if (value instanceof Error) throw value;
    return value;
  }

  const context = {
    Uint8Array, Buffer, Date, Object, Array, Number, String, Boolean, Error, Promise,
    document: { currentScript: { dataset: { serviceRoot: "/pocket-sync/v1" } } },
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(9);
        return bytes;
      },
    },
    buildPocketPayload() { return payload; },
    hasPocketUnsavedChanges() { return false; },
    PocketDeviceChanges: {
      fingerprintDocument(value) { return JSON.stringify(value); },
    },
    PocketSyncCrypto: {
      FORMAT: { contentType: "portal.export.v1+json" },
      encodeBase64Url(bytes) { return Buffer.from(bytes).toString("base64url"); },
      async openMasterKeyBundle() { return { masterKey: Object.freeze({ opaque: true }) }; },
      async openContent() { return payload; },
    },
    PocketSyncDeviceStore: {
      async open() {},
      async readStoredRecord(syncedPocketId) {
        calls.storeIds.push(syncedPocketId);
        return {
          remote: { pending: null, conflict: null },
          deviceEnvelope: { record: Object.freeze({}), context: Object.freeze({}) },
          deviceWrappingKey: Object.freeze({}),
        };
      },
    },
    PocketSyncRemoteClient: {
      createBrowserJsonTransport() { return Object.freeze({}); },
      createAccountService() { return Object.freeze({}); },
      createEnvelopeService() { return Object.freeze({}); },
      createRecoveryService() { return Object.freeze({}); },
      createContentService() {
        return Object.freeze({
          async readRevision(input) {
            calls.revisionIds.push(input.syncedPocketId);
            return Object.freeze({ recordPresent: true, revision: 7 });
          },
          async downloadEncryptedRecord(input) {
            calls.downloadIds.push(input.syncedPocketId);
            return Object.freeze({ encryptedRecord: Object.freeze({ opaque: true }) });
          },
        });
      },
    },
    PocketSyncBrowserRuntime: {
      createRuntime() {
        const runtime = {
          async activate() {
            calls.activate += 1;
            if (activateResult instanceof Error) throw activateResult;
            return activateResult;
          },
          async resume(input) { calls.resume += 1; return { ok: false, input }; },
          async openExisting(input) { calls.openExisting += 1; return { ok: false, input }; },
          async recoverExisting() { calls.recoverExisting += 1; return { ok: false }; },
          async resumeRecovery(input) { calls.resumeRecovery += 1; return { ok: false, input }; },
          async findRecoveryAttempt() { calls.findRecoveryAttempt += 1; return { ok: true }; },
          async admitAcceptedDeleteRestore(input) {
            calls.admitAcceptedDeleteRestore += 1;
            return { ok: false, input };
          },
        };
        if (!options.omitStart) {
          runtime.startOwnerlessFirstCreate = async function startOwnerlessFirstCreate(input) {
            calls.start.push(input);
            return next(startResults, { ok: false, reason: "ownerless-test-start-empty" });
          };
        }
        if (!options.omitContinue) {
          runtime.continueOwnerlessFirstCreate = async function continueOwnerlessFirstCreate(input) {
            calls.continue.push(input);
            return next(continueResults, { ok: false, reason: "ownerless-test-continue-empty" });
          };
        }
        return runtime;
      },
    },
    PocketSyncUi: {
      install(integration) {
        calls.uiInstall += 1;
        calls.installedIntegration = integration;
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-local-integration.js"), context, {
    filename: "js/pocket-sync-local-integration.js",
  });

  return {
    context,
    calls,
    create() { return context.PocketSyncLocalIntegration.create(); },
  };
}

const EXISTING_METHODS = Object.freeze([
  "activate", "resume", "openExisting", "getLatestOpenDiagnostic",
  "captureSwitchTarget", "saveSwitchTarget", "discardSwitchTarget",
  "recoverExisting", "resumeRecovery", "findRecoveryAttempt", "verifyRoundTrip",
  "admitAcceptedDeleteRestore",
]);

test("P309 keeps the top-level surface fixed and extends only the frozen active integration", () => {
  const h = createHarness();
  assert.deepEqual(Object.keys(h.context.PocketSyncLocalIntegration), ["create"]);
  assert.deepEqual(Object.keys(h.context.PocketSyncBrowserIntegration), ["create"]);
  assert.equal(Object.isFrozen(h.context.PocketSyncLocalIntegration), true);
  assert.equal(Object.isFrozen(h.context.PocketSyncBrowserIntegration), true);

  const integration = h.create();
  assert.equal(Object.isFrozen(integration), true);
  assert.equal(h.context.PocketSyncActiveIntegration, integration);
  assert.equal(h.calls.installedIntegration, integration);
  assert.equal(h.calls.uiInstall, 1);
  assert.deepEqual(Object.keys(integration), [
    ...EXISTING_METHODS,
    "startOwnerlessFirstCreate",
    "continueOwnerlessFirstCreate",
  ]);
  for (const method of EXISTING_METHODS) assert.equal(typeof integration[method], "function", method);
});

test("P309 create requires both accepted ownerless runtime operations", () => {
  assert.throws(
    () => createHarness({ omitStart: true }).create(),
    /ownerless local integration foundation unavailable/
  );
  assert.throws(
    () => createHarness({ omitContinue: true }).create(),
    /ownerless local integration foundation unavailable/
  );
});

test("P309 start delegates exactly once, preserves input/result, never chains continuation, and never adopts existing-pocket authority", async () => {
  const existingPocket = Object.freeze({
    ok: true,
    status: "existing-pocket",
    syncedPocketId: "remote-existing-pocket",
  });
  const accountReady = Object.freeze({
    ok: true,
    reason: "ownerless-account-ready",
    activationId: "activation-start-p309",
    accountPath: "existing-unbound",
    stage: "account-ready",
    locallyDurable: true,
    adopted: false,
  });
  const h = createHarness({ startResults: [existingPocket, accountReady] });
  const integration = h.create();

  const existingInput = Object.freeze({ accountPath: "existing-unbound" });
  const first = await integration.startOwnerlessFirstCreate(existingInput);
  assert.equal(first, existingPocket);
  assert.equal(h.calls.start.length, 1);
  assert.equal(h.calls.start[0], existingInput);
  assert.equal(h.calls.continue.length, 0);
  assert.deepEqual(plain(await integration.verifyRoundTrip()), {
    ok: false, reason: "sync-not-activated",
  });

  const accountInput = Object.freeze({ accountPath: "existing-unbound" });
  const second = await integration.startOwnerlessFirstCreate(accountInput);
  assert.equal(second, accountReady);
  assert.equal(h.calls.start.length, 2);
  assert.equal(h.calls.start[1], accountInput);
  assert.equal(h.calls.continue.length, 0);
  assert.deepEqual(plain(await integration.verifyRoundTrip()), {
    ok: false, reason: "sync-not-activated",
  });
});

test("P309 continuation delegates one invocation at a time and intermediate/failure/terminal-partial truth never establishes integration authority", async () => {
  const intermediate = Object.freeze({
    ok: true,
    reason: "ownerless-ready-for-adoption",
    activationId: "activation-p309",
    accountPath: "new-account",
    syncedPocketId: "intermediate-pocket",
    stage: "ready-for-adoption",
    locallyDurable: true,
    remotelyCommitted: true,
    adopted: false,
  });
  const ordinaryFailure = Object.freeze({
    ok: false,
    reason: "ownerless-target-stale",
    activationId: "activation-p309",
    locallyDurable: true,
  });
  const terminalPartial = Object.freeze({
    ok: false,
    reason: "ownerless-adoption-finalisation-failed",
    activationId: "activation-p309",
    adopted: true,
    locallyDurable: true,
    remotelyCommitted: true,
    recoveryCopyStored: true,
    resumable: false,
    syncedPocketId: "must-not-be-remembered",
  });
  const h = createHarness({ continueResults: [intermediate, ordinaryFailure, terminalPartial] });
  const integration = h.create();

  for (const expected of [intermediate, ordinaryFailure, terminalPartial]) {
    const input = Object.freeze({ activationId: "activation-p309" });
    const before = h.calls.continue.length;
    const result = await integration.continueOwnerlessFirstCreate(input);
    assert.equal(result, expected);
    assert.equal(h.calls.continue.length, before + 1);
    assert.equal(h.calls.continue.at(-1), input);
    assert.equal(h.calls.start.length, 0);
    assert.deepEqual(plain(await integration.verifyRoundTrip()), {
      ok: false, reason: "sync-not-activated",
    });
  }
  assert.equal(h.calls.continue.length, 3, "no automatic continuation loop");
});

test("P309 wrapper exceptions collapse only unexpected throws to one frozen secret-safe adapter failure", async () => {
  const h = createHarness({
    startResults: [new Error(SECRET)],
    continueResults: [new Error(SECRET)],
  });
  const integration = h.create();

  const start = await integration.startOwnerlessFirstCreate({ accountPath: "new-account" });
  const continuation = await integration.continueOwnerlessFirstCreate({ activationId: "activation-p309" });
  for (const result of [start, continuation]) {
    assert.deepEqual(plain(result), {
      ok: false,
      reason: "ownerless-first-create-unavailable",
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  assert.equal(h.calls.start.length, 1);
  assert.equal(h.calls.continue.length, 1);
});

test("P309 exact ownerless-activated adopted success feeds only canonical syncedPocketId into existing verifyRoundTrip memory", async () => {
  const malformedTerminal = Object.freeze({
    ok: true,
    reason: "ownerless-activated",
    activationId: "activation-p309",
    accountPath: "new-account",
    syncedPocketId: "   ",
    deviceId: "device-p309",
    stage: "adopted",
    locallyDurable: true,
    remotelyCommitted: true,
    confirmedRemoteRevision: 1,
    keySetVersion: 3,
    recoveryVersion: 1,
    recoveryCopyStored: true,
    adopted: true,
  });
  const adopted = Object.freeze({
    ok: true,
    reason: "ownerless-activated",
    activationId: "activation-p309",
    accountPath: "new-account",
    syncedPocketId: "canonical-ownerless-pocket",
    deviceId: "device-p309",
    stage: "adopted",
    locallyDurable: true,
    remotelyCommitted: true,
    confirmedRemoteRevision: 1,
    keySetVersion: 3,
    recoveryVersion: 1,
    recoveryCopyStored: true,
    adopted: true,
  });
  const h = createHarness({ continueResults: [malformedTerminal, adopted] });
  const integration = h.create();

  assert.equal(
    await integration.continueOwnerlessFirstCreate({ activationId: "activation-p309" }),
    malformedTerminal
  );
  assert.deepEqual(plain(await integration.verifyRoundTrip()), {
    ok: false, reason: "sync-not-activated",
  });

  const result = await integration.continueOwnerlessFirstCreate({
    activationId: "activation-p309",
  });
  assert.equal(result, adopted);
  assert.equal(h.calls.continue.length, 2);

  const roundTrip = await integration.verifyRoundTrip();
  assert.deepEqual(plain(roundTrip), {
    ok: true,
    revision: 7,
    matchesCurrentSavedPocket: true,
  });
  assert.deepEqual(h.calls.storeIds, ["canonical-ownerless-pocket"]);
  assert.deepEqual(h.calls.revisionIds, ["canonical-ownerless-pocket"]);
  assert.deepEqual(h.calls.downloadIds, ["canonical-ownerless-pocket"]);
  assert.equal(JSON.stringify({
    storeIds: h.calls.storeIds,
    revisionIds: h.calls.revisionIds,
    downloadIds: h.calls.downloadIds,
  }).includes(SECRET), false);
  assert.equal(JSON.stringify(result).includes("ownerlessReadiness"), false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /accountId|credentialId|outputBytes|recoveryRoot|recoveryAuthorisation|recoveryPackage|masterKey|ciphertext/
  );
});

test("P309 preserves historical synced-owner remembering and reuses the same verifyRoundTrip path", async () => {
  const historical = Object.freeze({
    ok: true,
    owner: Object.freeze({
      ownerKind: "synced",
      syncedPocketId: "historical-pocket",
    }),
  });
  const h = createHarness({ activateResult: historical });
  const integration = h.create();

  assert.equal(await integration.activate(), historical);
  assert.equal(h.calls.activate, 1);
  assert.deepEqual(plain(await integration.verifyRoundTrip()), {
    ok: true,
    revision: 7,
    matchesCurrentSavedPocket: true,
  });
  assert.deepEqual(h.calls.storeIds, ["historical-pocket"]);
  assert.deepEqual(h.calls.revisionIds, ["historical-pocket"]);
  assert.deepEqual(h.calls.downloadIds, ["historical-pocket"]);
});

test("P309 remains programmatic LocalIntegration-only; visible product and runtime owners stay unwired/unmodified by composition", () => {
  const local = source("js/pocket-sync-local-integration.js");
  assert.match(local, /runtime\.startOwnerlessFirstCreate\(input\)/);
  assert.match(local, /runtime\.continueOwnerlessFirstCreate\(input\)/);
  assert.match(local, /ownerless-first-create-unavailable/);

  const verifyStart = local.indexOf("async function verifyRoundTrip()");
  const verifyEnd = local.indexOf("const integration = frozen", verifyStart);
  assert.ok(verifyStart >= 0 && verifyEnd > verifyStart);
  assert.doesNotMatch(local.slice(verifyStart, verifyEnd), /ownerless/i,
    "verifyRoundTrip remains the existing shared verification path");

  for (const file of [
    "js/pocket-sync-ui.js",
    "js/pocket-doorway-capabilities.js",
    "index.html",
    "sw.js",
  ]) {
    assert.doesNotMatch(
      source(file),
      /startOwnerlessFirstCreate|continueOwnerlessFirstCreate/,
      file
    );
  }

  assert.match(source("js/pocket-sync-browser-runtime.js"), /startOwnerlessFirstCreate/);
  assert.match(source("js/pocket-sync-browser-runtime.js"), /continueOwnerlessFirstCreate/);
});
