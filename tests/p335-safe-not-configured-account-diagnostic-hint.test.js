"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const SECRET = "P335-SYNTHETIC-SECRET-MUST-NOT-CROSS";
const GOOD_ACCOUNT_ID = "p335-account-linked-x2-DE";
const GOOD_SUFFIX = "x2-DE";

function additionalContext() {
  const context = {
    Object, Array, Number, String, Boolean, Date, Promise, Error, Uint8Array,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context,
    { filename: "js/pocket-sync-additional-device.js" });
  return context;
}

function additionalHarness({ accountId = GOOD_ACCOUNT_ID, discovery = { status: "not-configured", syncedPocketId: null } } = {}) {
  const context = additionalContext();
  const counts = { authenticate: 0, discovery: 0 };
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: {
      FORMAT: { contentType: "portal.export.v1+json" },
      async generateDeviceWrappingKey() {},
      async deriveWrappingKey() {},
      async openMasterKeyBundle() {},
      async openContent() {},
      async sealContent() {},
      encodeBase64Url() { return "p335-operation"; },
      validateNonExtractableAesKey() {},
    },
    deviceStore: {
      async open() {},
      async readPocket() { return null; },
      async createPocket() {},
      async replacePocket() {},
      async reservePocketEncryptionUsage() {},
    },
    accountClient: {
      async authenticatePasskey() {
        counts.authenticate += 1;
        return {
          ok: true,
          accountAuthenticated: true,
          contentUnlocked: false,
          accountId,
          credentialId: "p335-private-credential",
          prf: { status: "unavailable", outputBytes: null },
        };
      },
    },
    discoveryService: {
      async readSyncedPocket() {
        counts.discovery += 1;
        return discovery;
      },
    },
    contentService: {
      async readRevision() { throw new Error("must not read content in P335 proof"); },
      async downloadEncryptedRecord() { throw new Error("must not download content in P335 proof"); },
    },
    envelopeService: {
      async listEnvelopes() { throw new Error("must not list envelopes in P335 proof"); },
      async downloadEnvelope() { throw new Error("must not download envelope in P335 proof"); },
      async addEnvelope() { throw new Error("must not add envelope in P335 proof"); },
    },
    randomBytes() { return new Uint8Array(32); },
    now() { return 0; },
  });
  const dependencies = {
    captureTarget() { return { ownerKind: "none", continuityId: "p335-target" }; },
    isTargetCurrent() { return true; },
    validatePayload() { return true; },
    async adoptOpenedPocket() { throw new Error("must not adopt in P335 proof"); },
  };
  return { opener, dependencies, counts };
}

function localIntegrationProjection(results) {
  const context = {
    Object, Array, Number, String, Boolean, Date, Promise, Error, Uint8Array,
    document: { currentScript: { dataset: { serviceRoot: "/sync" } } },
    PocketSyncRemoteClient: {
      createBrowserJsonTransport() { return {}; },
      createAccountService() { return {}; },
      createContentService() { return {}; },
      createEnvelopeService() { return {}; },
      createRecoveryService() { return {}; },
    },
    PocketSyncBrowserRuntime: {
      createRuntime() {
        let index = 0;
        return {
          async openExisting() { return results[Math.min(index++, results.length - 1)]; },
          async activate() { return { ok: false }; },
          async resume() { return { ok: false }; },
          async recoverExisting() { return { ok: false }; },
          async resumeRecovery() { return { ok: false }; },
          async findRecoveryAttempt() { return { ok: true }; },
          async startOwnerlessFirstCreate() { return { ok: false }; },
          async continueOwnerlessFirstCreate() { return { ok: false }; },
        };
      },
    },
    PocketSyncUi: { install() {} },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-local-integration.js"), context,
    { filename: "js/pocket-sync-local-integration.js" });
  return context.PocketSyncLocalIntegration.create();
}

test("P335 not-configured failure exposes only the last five safe account characters with no extra auth/discovery", async () => {
  const harness = additionalHarness();
  const result = await harness.opener.openExisting(harness.dependencies);

  assert.deepEqual(plain(result), {
    ok: false,
    reason: "synced-pocket-not-configured",
    adopted: false,
    authenticatedAccountSuffix: GOOD_SUFFIX,
  });
  assert.deepEqual(harness.counts, { authenticate: 1, discovery: 1 });
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes(GOOD_ACCOUNT_ID), false);
  assert.equal(serialised.includes("p335-private-credential"), false);
  assert.equal(serialised.includes(SECRET), false);
});

test("P335 ready discovery carries no account hint and preserves the existing call count", async () => {
  const harness = additionalHarness({
    discovery: { status: "ready", syncedPocketId: "p335-pocket" },
  });
  const result = await harness.opener.openExisting(harness.dependencies);

  assert.equal(result.reason, "recovery-required");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "authenticatedAccountSuffix"), false);
  assert.deepEqual(harness.counts, { authenticate: 1, discovery: 1 });
});

test("P335 malformed account suffix is omitted even on exact not-configured discovery", async () => {
  const harness = additionalHarness({ accountId: "p335-account-bad!?" });
  const result = await harness.opener.openExisting(harness.dependencies);

  assert.deepEqual(plain(result), {
    ok: false,
    reason: "synced-pocket-not-configured",
    adopted: false,
  });
  assert.deepEqual(harness.counts, { authenticate: 1, discovery: 1 });
});

test("P335 latest-open projection admits only exact safe not-configured suffix metadata", async () => {
  const fullAccountId = `${SECRET}-full-account-${GOOD_SUFFIX}`;
  const results = [
    {
      ok: false,
      reason: "synced-pocket-not-configured",
      adopted: false,
      authenticatedAccountSuffix: GOOD_SUFFIX,
      accountId: fullAccountId,
      credentialId: `${SECRET}-credential`,
      prfOutput: `${SECRET}-prf`,
      syntheticSecret: SECRET,
    },
    {
      ok: false,
      reason: "synced-pocket-not-configured",
      adopted: false,
      authenticatedAccountSuffix: "bad!?",
      accountId: fullAccountId,
    },
    {
      ok: false,
      reason: "synced-pocket-not-configured",
      adopted: false,
      accountId: fullAccountId,
    },
    {
      ok: false,
      reason: "additional-device-open-failed",
      adopted: false,
      authenticatedAccountSuffix: GOOD_SUFFIX,
      accountId: fullAccountId,
    },
  ];
  const integration = localIntegrationProjection(results);

  await integration.openExisting();
  const accepted = integration.getLatestOpenDiagnostic();
  assert.deepEqual(plain(accepted), {
    ok: false,
    reason: "synced-pocket-not-configured",
    adopted: false,
    authenticatedAccountSuffix: GOOD_SUFFIX,
  });
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(JSON.stringify(accepted).includes(SECRET), false);
  assert.equal(JSON.stringify(accepted).includes(fullAccountId), false);
  assert.equal(JSON.stringify(accepted).includes("credential"), false);
  assert.equal(JSON.stringify(accepted).includes("prf"), false);

  await integration.openExisting();
  assert.deepEqual(plain(integration.getLatestOpenDiagnostic()), {
    ok: false,
    reason: "synced-pocket-not-configured",
    adopted: false,
  });

  await integration.openExisting();
  assert.deepEqual(plain(integration.getLatestOpenDiagnostic()), {
    ok: false,
    reason: "synced-pocket-not-configured",
    adopted: false,
  });

  await integration.openExisting();
  assert.deepEqual(plain(integration.getLatestOpenDiagnostic()), {
    ok: false,
    reason: "additional-device-open-failed",
    adopted: false,
  });
});
