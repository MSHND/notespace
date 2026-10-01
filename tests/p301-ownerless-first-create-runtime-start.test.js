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
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const NOW = fixtures.NOW;

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function unavailableAuthenticationCredential() {
  const base = fixtures.nativeAuthenticationCredential();
  return {
    getClientExtensionResults() { return {}; },
    toJSON() {
      const value = base.toJSON();
      value.clientExtensionResults = {};
      return value;
    },
  };
}

function createHarness(options = {}) {
  const shared = createSharedDeviceStoreState();
  const counters = {
    target: 0,
    driver: 0,
    storeOpen: 0,
    finder: 0,
    firstCreateConductor: 0,
    beginRegistration: 0,
    finishRegistration: 0,
    beginAuthentication: 0,
    finishAuthentication: 0,
    credentialCreate: 0,
    credentialGet: 0,
    discovery: 0,
    content: 0,
    envelope: 0,
    recovery: 0,
    recoveryPackage: 0,
    picker: 0,
    adoption: 0,
  };
  const accountIntents = [];
  let ownerKind = options.ownerKind || "none";
  let nextNodeId = 0;
  let derivedPrfReference = null;
  const discoveryStatuses = (options.discoveryStatuses || ["not-configured"]).slice();

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
      return `${prefix}_p301_${nextNodeId}`;
    },
    nowIso() { return new Date(NOW).toISOString(); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    capturePocketFileSaveSession() {
      counters.target += 1;
      if (typeof options.ownerKindAtCapture === "function") {
        ownerKind = options.ownerKindAtCapture(counters.target, ownerKind);
      }
      return {
        ownerKind,
        id: counters.target,
        vaultSessionId: "",
      };
    },
    hasPocketUnsavedChanges() { return false; },
    hasUnsavedDetailsEditorChanges() { return false; },
    hasUnsavedInlineTitleDraft() { return false; },
    PocketNodePopoutWindow: Object.freeze({ hasUnsavedChanges() { return false; } }),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-crypto.js",
    "js/pocket-first-use-document.js",
    "js/pocket-sync-ownerless-activation-draft.js",
    "js/pocket-sync-device-store.js",
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-first-create.js",
    "js/pocket-sync-activation.js",
  ]) vm.runInContext(source(file), context, { filename: file });

  const realSecurity = context.PocketSyncSecurityContract;
  context.PocketSyncSecurityContract = Object.freeze(Object.assign({}, realSecurity, {
    buildRecoveryPackage(input) {
      counters.recoveryPackage += 1;
      return realSecurity.buildRecoveryPackage(input);
    },
  }));

  const realCrypto = context.PocketSyncCrypto;
  context.PocketSyncCrypto = Object.freeze(Object.assign({}, realCrypto, {
    async createDerivedWrappingKey(input, ...rest) {
      derivedPrfReference = input;
      return realCrypto.createDerivedWrappingKey(input, ...rest);
    },
  }));

  const realStoreModule = context.PocketSyncDeviceStore;
  const wrappedStoreModule = Object.freeze(Object.assign({}, realStoreModule, {
    createIndexedDbDriver() {
      counters.driver += 1;
      return createMemoryDeviceStoreDriver(shared);
    },
    createStore(driver) {
      const store = realStoreModule.createStore(driver);
      return Object.freeze(Object.assign({}, store, {
        async open(...args) {
          counters.storeOpen += 1;
          return store.open(...args);
        },
        async findOwnerlessActivation(...args) {
          counters.finder += 1;
          if (options.finder === "ambiguous") return Object.freeze({ state: "ambiguous" });
          if (options.finder === "invalid") return Object.freeze({ state: "match" });
          if (options.finder === "failure") throw new Error("synthetic finder failure");
          return store.findOwnerlessActivation(...args);
        },
      }));
    },
  }));
  context.PocketSyncDeviceStore = wrappedStoreModule;

  const realFirstCreate = context.PocketSyncFirstCreate;
  if (options.omitFirstCreate === true) {
    context.PocketSyncFirstCreate = undefined;
  } else {
    context.PocketSyncFirstCreate = Object.freeze({
      createConductor(input) {
        counters.firstCreateConductor += 1;
        return realFirstCreate.createConductor(input);
      },
    });
  }

  for (const file of [
    "js/pocket-sync-emergency-recovery.js",
    "js/pocket-sync-owner-controller.js",
    "js/pocket-owner-save-boundary.js",
    "js/pocket-sync-activation-owner-bridge.js",
  ]) vm.runInContext(source(file), context, { filename: file });

  const realBridge = context.PocketSyncActivationOwnerBridge;
  context.PocketSyncActivationOwnerBridge = Object.freeze({
    createActivationOwnerBridge(input) {
      const bridge = realBridge.createActivationOwnerBridge(input);
      return Object.freeze({
        async adoptSyncedOwner(...args) {
          counters.adoption += 1;
          return bridge.adoptSyncedOwner(...args);
        },
      });
    },
  });

  vm.runInContext(source("js/pocket-sync-browser-runtime.js"), context, {
    filename: "js/pocket-sync-browser-runtime.js",
  });

  const accountService = Object.freeze({
    async beginRegistration(input) {
      counters.beginRegistration += 1;
      accountIntents.push(input.accountIntent);
      options.onBeginRegistration?.({ setOwnerKind: (value) => { ownerKind = value; }, input });
      if (options.beginRegistrationFailure) throw new Error("synthetic registration begin failure");
      return fixtures.beginRegistration({
        operationId: input.operationId,
        ceremonyId: `register-p301-${counters.beginRegistration}`,
      });
    },
    async finishRegistration(input) {
      counters.finishRegistration += 1;
      if (options.finishRegistrationFailure) throw new Error("synthetic registration finish failure");
      return fixtures.finishRegistration({
        operationId: input.operationId,
        ceremonyId: input.ceremonyId,
        accountId: "account-new-p301",
      });
    },
    async beginAuthentication(input) {
      counters.beginAuthentication += 1;
      options.onBeginAuthentication?.({ setOwnerKind: (value) => { ownerKind = value; }, input });
      if (options.authenticationFailure) throw new Error("synthetic authentication failure");
      return fixtures.beginAuthentication({
        operationId: input.operationId,
        ceremonyId: `authentication-p301-${counters.beginAuthentication}`,
      });
    },
    async finishAuthentication(input) {
      counters.finishAuthentication += 1;
      return fixtures.finishAuthentication({
        operationId: input.operationId,
        ceremonyId: input.ceremonyId,
        accountId: "account-existing-p301",
      });
    },
  });

  const discoveryService = options.omitDiscovery === true ? undefined : Object.freeze({
    async readSyncedPocket(input) {
      counters.discovery += 1;
      if (options.discoveryFailure) throw new Error("synthetic discovery failure");
      const status = discoveryStatuses.length > 0 ? discoveryStatuses.shift() : "not-configured";
      if (!["ready", "not-configured"].includes(status)) return { invalid: true };
      return Object.freeze({
        apiVersion: 1,
        ok: true,
        operationId: input.operationId,
        status,
        syncedPocketId: status === "ready" ? "pocket-existing-p301" : null,
      });
    },
  });

  const environment = {
    crypto: webcrypto,
    CryptoKey,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    now: () => NOW,
    indexedDB: {},
    navigator: {
      credentials: {
        async create() {
          counters.credentialCreate += 1;
          return fixtures.nativeRegistrationCredential();
        },
        async get() {
          counters.credentialGet += 1;
          return options.unavailablePrf === true
            ? unavailableAuthenticationCredential()
            : fixtures.nativeAuthenticationCredential();
        },
      },
    },
    showSaveFilePicker() {
      counters.picker += 1;
      throw new Error("Recovery Copy picker unreachable before P301 stop");
    },
  };

  const runtime = context.PocketSyncBrowserRuntime.createRuntime({
    accountService,
    contentService: Object.freeze({
      async conditionalUpload() {
        counters.content += 1;
        throw new Error("content upload unreachable before P301 stop");
      },
      async readRevision() {
        counters.content += 1;
        throw new Error("content revision read unreachable before P301 stop");
      },
      async downloadEncryptedRecord() {
        counters.content += 1;
        throw new Error("content download unreachable before P301 stop");
      },
    }),
    envelopeService: Object.freeze({
      async addEnvelope() {
        counters.envelope += 1;
        throw new Error("envelope add unreachable before P301 stop");
      },
    }),
    recoveryService: Object.freeze({
      async initialiseRecovery() {
        counters.recovery += 1;
        throw new Error("recovery initialisation unreachable before P301 stop");
      },
      async beginRecovery() {
        counters.recovery += 1;
        throw new Error("recovery begin unreachable before P301 stop");
      },
      async finishRecovery() {
        counters.recovery += 1;
        throw new Error("recovery finish unreachable before P301 stop");
      },
      async rotateRecovery() {
        counters.recovery += 1;
        throw new Error("recovery rotation unreachable before P301 stop");
      },
    }),
    ...(options.omitDiscovery === true ? {} : { discoveryService }),
    environment,
  });

  async function readActivation(activationId) {
    const store = realStoreModule.createStore(createMemoryDeviceStoreDriver(shared));
    await store.open();
    return store.readActivation(activationId);
  }

  async function canonicalDraft(activationId) {
    const found = await readActivation(activationId);
    assert.notEqual(found, null);
    return context.PocketSyncOwnerlessActivationDraft.validate(found.draft, {
      securityContract: context.PocketSyncSecurityContract,
      crypto: context.PocketSyncCrypto,
    });
  }

  return {
    context,
    runtime,
    shared,
    counters,
    accountIntents,
    readActivation,
    canonicalDraft,
    setOwnerKind(value) { ownerKind = value; },
    get derivedPrfReference() { return derivedPrfReference; },
  };
}

function assertNoDownstream(harness) {
  assert.equal(harness.counters.content, 0);
  assert.equal(harness.counters.envelope, 0);
  assert.equal(harness.counters.recovery, 0);
  assert.equal(harness.counters.recoveryPackage, 0);
  assert.equal(harness.counters.picker, 0);
  assert.equal(harness.counters.adoption, 0);
}

async function assertAccountReady(harness, result, accountPath, prfStatus) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reason, "ownerless-account-ready");
  assert.equal(result.accountPath, accountPath);
  assert.equal(result.stage, "account-ready");
  assert.equal(result.locallyDurable, true);
  const draft = await harness.canonicalDraft(result.activationId);
  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.activationMode, "ownerless-first-create");
  assert.equal(draft.accountPath, accountPath);
  assert.equal(draft.stage, "account-ready");
  assert.notEqual(draft.account, null);
  assert.equal(draft.registrationContinuation, null);
  assert.equal(draft.pendingOperation, null);
  assert.equal(draft.prfStatus, prfStatus);
  assert.equal(draft.prfEnvelope === null, prfStatus !== "available");
  assert.equal(draft.confirmedRemoteRevision, 0);
  assert.equal(draft.keySetVersion, 0);
  assert.equal(draft.recoveryVersion, 0);
  assert.equal(draft.accountLocator, null);
  assert.equal(draft.recoveryCopyStored, false);
  assert.equal(draft.adopted, false);
  assert.equal(JSON.stringify(draft).includes("outputBytes"), false);
  assertNoDownstream(harness);
  return draft;
}

test("P301 keeps global runtime surface fixed and adds exactly one programmatic instance operation", () => {
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.context.PocketSyncBrowserRuntime), ["createRuntime"]);
  assert.deepEqual(Object.keys(harness.runtime), [
    "activate",
    "resume",
    "openExisting",
    "recoverExisting",
    "resumeRecovery",
    "restartLegacyRecovery",
    "findRecoveryAttempt",
    "admitAcceptedDeleteRestore",
    "startOwnerlessFirstCreate",
    "continueOwnerlessFirstCreate",
  ]);
  for (const forbidden of [
    "activateOwnerless",
    "resumeOwnerless",
    "findOwnerlessActivation",
    "prepareExistingAccount",
  ]) assert.equal(Object.prototype.hasOwnProperty.call(harness.runtime, forbidden), false);

  for (const file of [
    "js/pocket-sync-local-integration.js",
    "js/pocket-sync-ui.js",
    "js/pocket-doorway-capabilities.js",
    "index.html",
  ]) {
    assert.doesNotMatch(source(file), /startOwnerlessFirstCreate|continueOwnerlessFirstCreate/);
  }
  assert.doesNotMatch(source("sw.js"), /pocket-sync-first-create\.js|pocket-sync-ownerless-activation-draft\.js/);
});

test("P301 invalid accountPath and unavailable foundations fail before target, discovery or account ceremony", async () => {
  {
    const harness = createHarness();
    const result = await harness.runtime.startOwnerlessFirstCreate({ accountPath: "other" });
    assert.deepEqual(plain(result), { ok: false, reason: "invalid-ownerless-first-create-input" });
    assert.equal(harness.counters.target, 0);
    assert.equal(harness.counters.storeOpen, 0);
    assert.equal(harness.counters.finder, 0);
    assert.equal(harness.counters.beginAuthentication, 0);
    assert.equal(harness.counters.beginRegistration, 0);
    assert.equal(harness.shared.records.size, 0);
  }
  {
    const harness = createHarness({ omitFirstCreate: true });
    const result = await harness.runtime.startOwnerlessFirstCreate({
      accountPath: "new-account",
    });
    assert.deepEqual(plain(result), { ok: false, reason: "ownerless-foundation-unavailable" });
    assert.equal(harness.counters.target, 0);
    assert.equal(harness.counters.storeOpen, 0);
    assert.equal(harness.counters.beginRegistration, 0);
    assert.equal(harness.shared.records.size, 0);
  }
  {
    const harness = createHarness({ omitDiscovery: true });
    const result = await harness.runtime.startOwnerlessFirstCreate({
      accountPath: "new-account",
    });
    assert.deepEqual(plain(result), { ok: false, reason: "ownerless-foundation-unavailable" });
    assert.equal(harness.counters.target, 0);
    assert.equal(harness.counters.storeOpen, 0);
    assert.equal(harness.counters.beginRegistration, 0);
    assert.equal(harness.shared.records.size, 0);
  }
});

test("P301 requires a current none replaceable target before encrypted-attempt discovery", async () => {
  const harness = createHarness({ ownerKind: "json" });
  const result = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  assert.deepEqual(plain(result), { ok: false, reason: "ownerless-target-stale" });
  assert.ok(harness.counters.target >= 1);
  assert.equal(harness.counters.storeOpen, 0);
  assert.equal(harness.counters.finder, 0);
  assert.equal(harness.counters.beginAuthentication, 0);
  assert.equal(harness.counters.beginRegistration, 0);
  assert.equal(harness.shared.records.size, 0);
});

test("P301 ownerless discovery ambiguity, invalid response and failure stop before account ceremony", async () => {
  for (const finder of ["ambiguous", "invalid", "failure"]) {
    const harness = createHarness({ finder });
    const result = await harness.runtime.startOwnerlessFirstCreate({
      accountPath: "new-account",
    });
    assert.deepEqual(plain(result), {
      ok: false,
      reason: "ownerless-discovery-needs-attention",
    });
    assert.equal(harness.counters.storeOpen, 1);
    assert.equal(harness.counters.finder, 1);
    assert.equal(harness.counters.beginAuthentication, 0);
    assert.equal(harness.counters.beginRegistration, 0);
    assert.equal(harness.counters.credentialCreate, 0);
    assert.equal(harness.shared.records.size, 0);
  }
});

test("P301 existing-unbound existing Pocket wins without ownerless staging or registration", async () => {
  const harness = createHarness({ discoveryStatuses: ["ready"] });
  const result = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  assert.deepEqual(plain(result), {
    ok: true,
    status: "existing-pocket",
    syncedPocketId: "pocket-existing-p301",
  });
  assert.equal(harness.counters.firstCreateConductor, 1);
  assert.equal(harness.counters.beginAuthentication, 1);
  assert.equal(harness.counters.finishAuthentication, 1);
  assert.equal(harness.counters.discovery, 1);
  assert.equal(harness.counters.beginRegistration, 0);
  assert.equal(harness.counters.finishRegistration, 0);
  assert.equal(harness.shared.records.size, 0);
  assertNoDownstream(harness);
});

test("P301 existing-unbound composes real P280/P278 and P287/P288 inside one private raw-PRF lifetime", async () => {
  const harness = createHarness({ discoveryStatuses: ["not-configured"] });
  const result = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  await assertAccountReady(harness, result, "existing-unbound", "available");
  assert.equal(harness.counters.firstCreateConductor, 1);
  assert.equal(harness.counters.beginAuthentication, 1);
  assert.equal(harness.counters.finishAuthentication, 1);
  assert.equal(harness.counters.discovery, 1);
  assert.equal(harness.counters.beginRegistration, 0);
  assert.equal(harness.counters.finishRegistration, 0);
  assert.ok(harness.derivedPrfReference instanceof Uint8Array);
  assert.deepEqual(Array.from(harness.derivedPrfReference), new Array(32).fill(0));
  const publicText = JSON.stringify(result);
  for (const forbidden of [
    "account-existing-p301",
    fixtures.CREDENTIAL_ID,
    "credentialVersion",
    "accountPolicyVersion",
    "prf",
    "outputBytes",
  ]) assert.equal(publicText.includes(forbidden), false, forbidden);
});

test("P301 existing-unbound unavailable PRF reaches exact account-ready skipped state with zero registration", async () => {
  const harness = createHarness({
    unavailablePrf: true,
    discoveryStatuses: ["not-configured"],
  });
  const result = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  await assertAccountReady(harness, result, "existing-unbound", "skipped");
  assert.equal(harness.counters.beginAuthentication, 1);
  assert.equal(harness.counters.beginRegistration, 0);
  assert.equal(harness.counters.finishRegistration, 0);
});

test("P301 existing-unbound auth and discovery failures never infer the new-account path", async () => {
  for (const options of [
    { authenticationFailure: true },
    { discoveryFailure: true },
  ]) {
    const harness = createHarness(options);
    const result = await harness.runtime.startOwnerlessFirstCreate({
      accountPath: "existing-unbound",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /^first-create-/);
    assert.equal(harness.counters.beginRegistration, 0);
    assert.equal(harness.counters.finishRegistration, 0);
    assert.equal(harness.counters.credentialCreate, 0);
    assert.equal(harness.shared.records.size, 0);
    assertNoDownstream(harness);
  }
});

test("P301 new-account bypasses P280, uses exact create-new-account registration, binds not-configured and stops account-ready", async () => {
  const harness = createHarness({ discoveryStatuses: ["not-configured"] });
  const result = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  await assertAccountReady(harness, result, "new-account", "available");
  assert.equal(harness.counters.firstCreateConductor, 0);
  assert.equal(harness.counters.beginAuthentication, 0);
  assert.equal(harness.counters.finishAuthentication, 0);
  assert.equal(harness.counters.beginRegistration, 1);
  assert.equal(harness.counters.finishRegistration, 1);
  assert.deepEqual(harness.accountIntents, ["create-new-account"]);
  assert.equal(harness.counters.discovery, 1);
  assert.ok(harness.derivedPrfReference instanceof Uint8Array);
  assert.deepEqual(Array.from(harness.derivedPrfReference), new Array(32).fill(0));
});

test("P301 new-account ambiguous registration leaves P288 continuation durable and performs no automatic second registration", async () => {
  const harness = createHarness({ finishRegistrationFailure: true });
  const first = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "ownerless-account-ready-failed");
  assert.equal(first.locallyDurable, true);
  assert.equal(first.resumable, true);
  assert.equal(harness.counters.beginRegistration, 1);
  assert.equal(harness.counters.finishRegistration, 1);
  assert.deepEqual(harness.accountIntents, ["create-new-account"]);
  assert.equal(harness.counters.discovery, 0);
  const found = await harness.readActivation(first.activationId);
  assert.notEqual(found, null);
  assert.equal(found.draft.stage, "device-staged");
  assert.equal(found.draft.pendingOperation, "account-registration-finish");
  assert.notEqual(found.draft.registrationContinuation, null);
  assert.equal(JSON.stringify(found.draft).includes("outputBytes"), false);
  assertNoDownstream(harness);

  const before = {
    begin: harness.counters.beginRegistration,
    finish: harness.counters.finishRegistration,
    create: harness.counters.credentialCreate,
  };
  const second = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  assert.deepEqual(plain(second), {
    ok: false,
    reason: "ownerless-attempt-exists",
    activationId: first.activationId,
  });
  assert.deepEqual({
    begin: harness.counters.beginRegistration,
    finish: harness.counters.finishRegistration,
    create: harness.counters.credentialCreate,
  }, before);
});

test("P301 matched durable ownerless attempt is classified safely and never resumed by START", async () => {
  const harness = createHarness({ discoveryStatuses: ["not-configured"] });
  const first = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  await assertAccountReady(harness, first, "existing-unbound", "available");
  const before = { ...harness.counters };

  const second = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  assert.deepEqual(plain(second), {
    ok: false,
    reason: "ownerless-attempt-exists",
    activationId: first.activationId,
  });
  assert.equal(harness.counters.beginAuthentication, before.beginAuthentication);
  assert.equal(harness.counters.beginRegistration, before.beginRegistration);
  assert.equal(harness.counters.content, before.content);
  assert.equal(harness.counters.envelope, before.envelope);
  assert.equal(harness.counters.recovery, before.recovery);
  assert.equal(harness.counters.adoption, before.adoption);
});

test("P301 new-account binding attention preserves exact durable account-ready and stops before content", async () => {
  for (const mode of ["ready", "invalid", "failure"]) {
    const harness = createHarness({
      discoveryStatuses: mode === "ready" ? ["ready"] : mode === "invalid" ? ["invalid"] : [],
      discoveryFailure: mode === "failure",
    });
    const result = await harness.runtime.startOwnerlessFirstCreate({
      accountPath: "new-account",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ownerless-account-binding-attention");
    assert.equal(typeof result.activationId, "string");
    const draft = await harness.canonicalDraft(result.activationId);
    assert.equal(draft.stage, "account-ready");
    assert.equal(draft.accountPath, "new-account");
    assert.equal(draft.confirmedRemoteRevision, 0);
    assert.equal(draft.recoveryCopyStored, false);
    assert.equal(draft.adopted, false);
    assertNoDownstream(harness);
  }
});

test("P301 semantic none/replaceable guard remains authoritative across existing authentication and new registration awaits", async () => {
  {
    const harness = createHarness({
      discoveryStatuses: ["not-configured"],
      onBeginAuthentication({ setOwnerKind }) { setOwnerKind("json"); },
    });
    const result = await harness.runtime.startOwnerlessFirstCreate({
      accountPath: "existing-unbound",
    });
    assert.deepEqual(plain(result), { ok: false, reason: "ownerless-target-stale" });
    assert.equal(harness.shared.records.size, 0);
    assert.equal(harness.counters.beginRegistration, 0);
    assertNoDownstream(harness);
  }
  {
    const harness = createHarness({
      onBeginRegistration({ setOwnerKind }) { setOwnerKind("json"); },
    });
    const result = await harness.runtime.startOwnerlessFirstCreate({
      accountPath: "new-account",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ownerless-target-stale");
    assert.equal(harness.counters.beginRegistration, 1);
    assert.equal(harness.counters.discovery, 0);
    assertNoDownstream(harness);
  }
});

test("P301 source shape composes accepted owners and does not create a second ownerless pipeline", () => {
  const runtime = source("js/pocket-sync-browser-runtime.js");
  assert.match(runtime, /PocketSyncFirstCreate/);
  assert.match(runtime, /findOwnerlessActivation/);
  assert.match(runtime, /orchestrator\.activate\(ownerlessActivateDependencies\(\)/);
  assert.match(runtime, /orchestrator\.resume\(/);
  assert.match(runtime, /activationMode:\s*"ownerless-first-create"/);
  assert.match(runtime, /if \(input\.accountPath === "existing-unbound"\)/);
  assert.match(runtime, /stageOwnerlessStart\(\s*"existing-unbound"/);
  assert.match(runtime, /stageOwnerlessStart\(\s*"new-account"/);
  assert.match(runtime, /ownerBridge\.adoptSyncedOwner/);
  assert.doesNotMatch(runtime, /function\s+(?:activateOwnerless|resumeOwnerless|findOwnerlessActivation)\s*\(/);
  assert.doesNotMatch(source("js/pocket-sync-activation.js"), /PocketSyncFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-local-integration.js"), /startOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-ui.js"), /startOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-doorway-capabilities.js"), /startOwnerlessFirstCreate/);
});
