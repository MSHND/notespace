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
  const shared = options.shared || createSharedDeviceStoreState();
  const counters = {
    target: 0,
    driver: 0,
    storeOpen: 0,
    finder: 0,
    readActivation: 0,
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
  const authenticationInputs = [];
  const contentCalls = [];
  const envelopeCalls = [];
  const discoveryResponses = (
    options.discoveryResponses || options.discoveryStatuses || ["not-configured"]
  ).slice();
  const contentResponses = (options.contentResponses || [{ status: "committed", revision: 1 }]).slice();
  const envelopeResponses = (options.envelopeResponses || [{
    status: "committed",
    keySetVersion: 1,
    masterKeyGeneration: 1,
    masterKeyContentEncryptionLimit: 2 ** 20,
  }]).slice();
  const authenticationAccountIds = (options.authenticationAccountIds || []).slice();
  let ownerKind = options.ownerKind || "none";
  let nextNodeId = 0;
  let derivedPrfReference = null;
  let privatePrfReference = null;
  let passkeyPrfEnvelopeFailures = options.passkeyPrfEnvelopeFailures || 0;
  let finishRegistrationFailures = options.finishRegistrationFailures
    ?? (options.finishRegistrationFailure ? 1 : 0);
  let lastAuthenticationAccountLocator = null;

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
      return `${prefix}_p302_${nextNodeId}`;
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
      const contextInput = rest[0] || null;
      if (contextInput?.envelopeKind === "passkey-prf") {
        derivedPrfReference = input;
        if (passkeyPrfEnvelopeFailures > 0) {
          passkeyPrfEnvelopeFailures -= 1;
          throw new Error("synthetic passkey PRF envelope failure");
        }
      }
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
        async readActivation(...args) {
          counters.readActivation += 1;
          if (options.readActivationMode === "failure") {
            throw new Error("synthetic activation read failure");
          }
          if (options.readActivationMode === "missing") return null;
          const found = await store.readActivation(...args);
          if (options.readActivationMode === "invalid" && found) {
            return Object.freeze({
              record: found.record,
              draft: Object.freeze(Object.assign({}, plain(found.draft), {
                schemaVersion: 99,
              })),
            });
          }
          if (typeof options.readActivationTransform === "function" && found) {
            return options.readActivationTransform(found, counters.readActivation);
          }
          return found;
        },
      }));
    },
  }));
  context.PocketSyncDeviceStore = wrappedStoreModule;

  const realAccountModule = context.PocketSyncAccountClient;
  context.PocketSyncAccountClient = Object.freeze(Object.assign({}, realAccountModule, {
    createClient(input) {
      const client = realAccountModule.createClient(input);
      return Object.freeze({
        registerPasskey: client.registerPasskey,
        finishRegistration: client.finishRegistration,
        async authenticatePasskey(input, consumer) {
          authenticationInputs.push(plain(input));
          const wrapped = typeof consumer === "function"
            ? async (authenticated) => {
              if (authenticated?.prf?.outputBytes instanceof Uint8Array) {
                privatePrfReference = authenticated.prf.outputBytes;
              }
              return consumer(authenticated);
            }
            : consumer;
          return client.authenticatePasskey(input, wrapped);
        },
      });
    },
  }));

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
        ceremonyId: `register-p302-${counters.beginRegistration}`,
      });
    },
    async finishRegistration(input) {
      counters.finishRegistration += 1;
      if (finishRegistrationFailures > 0) {
        finishRegistrationFailures -= 1;
        throw new Error("synthetic registration finish failure");
      }
      return fixtures.finishRegistration({
        operationId: input.operationId,
        ceremonyId: input.ceremonyId,
        accountId: "account-new-p302",
      });
    },
    async beginAuthentication(input) {
      counters.beginAuthentication += 1;
      lastAuthenticationAccountLocator = input.accountLocator || null;
      options.onBeginAuthentication?.({ setOwnerKind: (value) => { ownerKind = value; }, input });
      if (options.authenticationFailure) throw new Error("synthetic authentication failure");
      return fixtures.beginAuthentication({
        operationId: input.operationId,
        ceremonyId: `authentication-p302-${counters.beginAuthentication}`,
      });
    },
    async finishAuthentication(input) {
      counters.finishAuthentication += 1;
      const accountId = authenticationAccountIds.length > 0
        ? authenticationAccountIds.shift()
        : lastAuthenticationAccountLocator || "account-existing-p302";
      return fixtures.finishAuthentication({
        operationId: input.operationId,
        ceremonyId: input.ceremonyId,
        accountId,
      });
    },
  });

  const discoveryService = options.omitDiscovery === true ? undefined : Object.freeze({
    async readSyncedPocket(input) {
      counters.discovery += 1;
      if (options.discoveryFailure) throw new Error("synthetic discovery failure");
      let next = discoveryResponses.length > 0
        ? discoveryResponses.shift()
        : "not-configured";
      if (typeof next === "function") next = await next(input, counters.discovery);
      if (next === "throw") throw new Error("synthetic discovery failure");
      if (next === "invalid") return { invalid: true };
      if (typeof next === "string") {
        if (!["ready", "not-configured"].includes(next)) return { invalid: true };
        next = {
          status: next,
          syncedPocketId: next === "ready" ? "pocket-existing-p302" : null,
        };
      }
      if (!next || !["ready", "not-configured"].includes(next.status)) return { invalid: true };
      return Object.freeze({
        apiVersion: 1,
        ok: true,
        operationId: input.operationId,
        status: next.status,
        syncedPocketId: next.status === "ready" ? next.syncedPocketId : null,
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
          if (options.authenticationCancelled === true) {
            const error = new Error("synthetic authentication cancellation");
            error.name = "NotAllowedError";
            throw error;
          }
          return options.unavailablePrf === true
            ? unavailableAuthenticationCredential()
            : fixtures.nativeAuthenticationCredential();
        },
      },
    },
    showSaveFilePicker() {
      counters.picker += 1;
      throw new Error("Recovery Copy picker unreachable before P302 stop");
    },
  };

  const runtime = context.PocketSyncBrowserRuntime.createRuntime({
    accountService,
    contentService: Object.freeze({
      async conditionalUpload(input) {
        counters.content += 1;
        contentCalls.push(plain(input));
        options.onConditionalUpload?.({
          input,
          call: counters.content,
          setOwnerKind: (value) => { ownerKind = value; },
        });
        const next = contentResponses.length > 0
          ? contentResponses.shift()
          : { status: "committed", revision: 1 };
        if (next === "throw") throw new Error("synthetic content upload unavailable");
        if (next instanceof Error) throw next;
        return Object.freeze(next);
      },
      async readRevision() {
        counters.content += 1;
        throw new Error("content revision read unreachable in P302");
      },
      async downloadEncryptedRecord() {
        counters.content += 1;
        throw new Error("content download unreachable in P302");
      },
    }),
    envelopeService: Object.freeze({
      async addEnvelope(input) {
        counters.envelope += 1;
        envelopeCalls.push(plain(input));
        options.onAddEnvelope?.({
          input,
          call: counters.envelope,
          setOwnerKind: (value) => { ownerKind = value; },
        });
        const next = envelopeResponses.length > 0
          ? envelopeResponses.shift()
          : {
            status: "committed",
            keySetVersion: input.expectedKeySetVersion + 1,
            masterKeyGeneration: 1,
            masterKeyContentEncryptionLimit: 2 ** 20,
          };
        if (next === "throw") throw new Error("synthetic envelope unavailable");
        if (next instanceof Error) throw next;
        return Object.freeze(next);
      },
    }),
    recoveryService: Object.freeze({
      async initialiseRecovery() {
        counters.recovery += 1;
        throw new Error("recovery initialisation unreachable before P302 stop");
      },
      async beginRecovery() {
        counters.recovery += 1;
        throw new Error("recovery begin unreachable before P302 stop");
      },
      async finishRecovery() {
        counters.recovery += 1;
        throw new Error("recovery finish unreachable before P302 stop");
      },
      async rotateRecovery() {
        counters.recovery += 1;
        throw new Error("recovery rotation unreachable before P302 stop");
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
    authenticationInputs,
    contentCalls,
    envelopeCalls,
    readActivation,
    canonicalDraft,
    setOwnerKind(value) { ownerKind = value; },
    pushDiscovery(value) { discoveryResponses.push(value); },
    pushContent(value) { contentResponses.push(value); },
    pushEnvelope(value) { envelopeResponses.push(value); },
    get derivedPrfReference() { return derivedPrfReference; },
    get privatePrfReference() { return privatePrfReference; },
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

function assertNoPostContent(harness) {
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


test("P302 keeps the global surface fixed, adds one runtime operation and stays unwired", () => {
  const h = createHarness();
  assert.deepEqual(Object.keys(h.context.PocketSyncBrowserRuntime), ["createRuntime"]);
  assert.deepEqual(Object.keys(h.runtime), [
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
    "activateOwnerless", "resumeOwnerless", "findOwnerlessActivation",
    "prepareExistingAccount", "readActivation",
  ]) assert.equal(Object.prototype.hasOwnProperty.call(h.runtime, forbidden), false);

  for (const file of [
    "js/pocket-sync-local-integration.js",
    "js/pocket-sync-ui.js",
    "js/pocket-doorway-capabilities.js",
    "index.html",
    "sw.js",
  ]) {
    assert.doesNotMatch(source(file), /continueOwnerlessFirstCreate/);
  }
});

test("P302 validates exact input and current ownerless target before durable lookup or account work", async () => {
  {
    const h = createHarness();
    const result = await h.runtime.continueOwnerlessFirstCreate({});
    assert.deepEqual(plain(result), {
      ok: false,
      reason: "invalid-ownerless-first-create-continuation-input",
    });
    assert.equal(h.counters.target, 0);
    assert.equal(h.counters.storeOpen, 0);
    assert.equal(h.counters.readActivation, 0);
    assert.equal(h.counters.beginAuthentication, 0);
    assert.equal(h.counters.content, 0);
  }
  {
    const h = createHarness({ ownerKind: "json" });
    const result = await h.runtime.continueOwnerlessFirstCreate({
      activationId: "missing-activation",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ownerless-target-stale");
    assert.equal(h.counters.storeOpen, 0);
    assert.equal(h.counters.readActivation, 0);
    assert.equal(h.counters.beginAuthentication, 0);
    assert.equal(h.counters.content, 0);
  }
  for (const readActivationMode of ["missing", "failure", "invalid"]) {
    const h = createHarness({ readActivationMode });
    const result = await h.runtime.continueOwnerlessFirstCreate({
      activationId: "missing-or-invalid-activation",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ownerless-activation-state-invalid");
    assert.equal(result.activationId, "missing-or-invalid-activation");
    assert.equal(h.counters.beginAuthentication, 0);
    assert.equal(h.counters.beginRegistration, 0);
    assert.equal(h.counters.discovery, 0);
    assert.equal(h.counters.content, 0);
  }
});

test("P302 existing-unbound device-staged continuation reuses P280/P288 with zero registration", async () => {
  const h = createHarness({
    passkeyPrfEnvelopeFailures: 1,
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const staged = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  assert.equal(staged.ok, false);
  assert.equal(staged.reason, "ownerless-account-ready-failed");
  assert.equal(typeof staged.activationId, "string");
  let draft = await h.canonicalDraft(staged.activationId);
  assert.equal(draft.stage, "device-staged");
  assert.equal(draft.account, null);
  assert.equal(h.counters.beginRegistration, 0);

  const beforeAuthentication = h.counters.beginAuthentication;
  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: staged.activationId,
  });
  await assertAccountReady(h, result, "existing-unbound", "available");
  assert.equal(h.counters.beginAuthentication, beforeAuthentication + 1);
  assert.equal(h.counters.beginRegistration, 0);
  assert.equal(h.counters.finishRegistration, 0);
  assert.equal(h.counters.firstCreateConductor, 2);
  assert.ok(h.privatePrfReference instanceof Uint8Array);
  assert.deepEqual(Array.from(h.privatePrfReference), new Array(32).fill(0));
  draft = await h.canonicalDraft(staged.activationId);
  assert.equal(draft.account.accountId, "account-existing-p302");
  assertNoDownstream(h);
});

test("P302 staged existing-unbound attempt stops safely when P280 finds an already-bound Pocket", async () => {
  const h = createHarness({
    passkeyPrfEnvelopeFailures: 1,
    discoveryResponses: ["not-configured", "ready"],
  });
  const staged = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  assert.equal(staged.reason, "ownerless-account-ready-failed");
  const before = await h.canonicalDraft(staged.activationId);
  assert.equal(before.stage, "device-staged");

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: staged.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-existing-account-bound-attention");
  const after = await h.canonicalDraft(staged.activationId);
  assert.equal(after.stage, "device-staged");
  assert.equal(after.account, null);
  assert.equal(h.counters.beginRegistration, 0);
  assert.equal(h.counters.content, 0);
  assertNoDownstream(h);
});

test("P302 new-account device-staged continuation resumes exact registration continuation without a second registration", async () => {
  const h = createHarness({
    finishRegistrationFailures: 1,
    discoveryResponses: ["not-configured"],
  });
  const staged = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  assert.equal(staged.ok, false);
  assert.equal(staged.reason, "ownerless-account-ready-failed");
  assert.equal(staged.resumable, true);
  let draft = await h.canonicalDraft(staged.activationId);
  assert.equal(draft.stage, "device-staged");
  assert.equal(draft.pendingOperation, "account-registration-finish");
  assert.notEqual(draft.registrationContinuation, null);
  assert.equal(h.counters.beginRegistration, 1);
  assert.equal(h.counters.credentialCreate, 1);
  assert.equal(h.counters.finishRegistration, 1);

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: staged.activationId,
  });
  await assertAccountReady(h, result, "new-account", "available");
  assert.equal(h.counters.beginRegistration, 1);
  assert.equal(h.counters.credentialCreate, 1);
  assert.equal(h.counters.finishRegistration, 2);
  assert.deepEqual(h.accountIntents, ["create-new-account"]);
  assert.equal(h.counters.discovery, 1);
  draft = await h.canonicalDraft(staged.activationId);
  assert.equal(draft.account.accountId, "account-new-p302");
  assertNoDownstream(h);
});

test("P302 same-runtime P301 account-ready witness avoids redundant authentication and commits content once", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    contentResponses: [{ status: "committed", revision: 1 }],
  });
  const started = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  const ready = await assertAccountReady(h, started, "new-account", "available");
  assert.equal(h.counters.beginAuthentication, 0);

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.deepEqual(plain(result), {
    ok: true,
    reason: "ownerless-content-committed",
    activationId: started.activationId,
    accountPath: "new-account",
    syncedPocketId: ready.syncedPocketId,
    deviceId: ready.deviceId,
    stage: "content-committed",
    locallyDurable: true,
    remotelyCommitted: true,
    confirmedRemoteRevision: 1,
  });
  assert.equal(h.counters.beginAuthentication, 0);
  assert.equal(h.counters.discovery, 2);
  assert.equal(h.counters.content, 1);
  assert.equal(h.contentCalls[0].expectedRevision, 0);
  assert.equal(h.contentCalls[0].attemptKind, "new-change");
  const draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.stage, "content-committed");
  assert.equal(draft.confirmedRemoteRevision, 1);
  assertNoPostContent(h);
});

test("P302 new runtime reauthenticates the exact pinned account inside P278 consumer and zeroes raw PRF", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured"],
  });
  const started = await first.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  const draft = await first.canonicalDraft(started.activationId);
  const accountId = draft.account.accountId;
  assert.equal(accountId, "account-new-p302");

  const second = createHarness({
    shared: first.shared,
    authenticationAccountIds: [accountId],
    discoveryResponses: ["not-configured"],
    contentResponses: [{ status: "committed", revision: 1 }],
  });
  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "content-committed");
  assert.equal(second.counters.beginAuthentication, 1);
  assert.equal(second.counters.finishAuthentication, 1);
  assert.equal(second.authenticationInputs.length, 1);
  assert.equal(second.authenticationInputs[0].accountLocator, accountId);
  assert.ok(second.privatePrfReference instanceof Uint8Array);
  assert.deepEqual(Array.from(second.privatePrfReference), new Array(32).fill(0));
  assert.equal(JSON.stringify(result).includes("outputBytes"), false);
  const committed = await second.canonicalDraft(started.activationId);
  assert.equal(JSON.stringify(committed).includes("outputBytes"), false);
  assert.equal(second.counters.content, 1);
  assertNoPostContent(second);
});

test("P302 mismatched, cancelled and failed pinned-account reauthentication perform zero upload", async () => {
  for (const mode of ["mismatch", "cancel", "failure"]) {
    const first = createHarness({ discoveryResponses: ["not-configured"] });
    const started = await first.runtime.startOwnerlessFirstCreate({
      accountPath: "new-account",
    });
    const draft = await first.canonicalDraft(started.activationId);
    const options = {
      shared: first.shared,
      discoveryResponses: ["not-configured"],
    };
    if (mode === "mismatch") options.authenticationAccountIds = ["another-account"];
    if (mode === "cancel") options.authenticationCancelled = true;
    if (mode === "failure") options.authenticationFailure = true;
    const second = createHarness(options);
    const result = await second.runtime.continueOwnerlessFirstCreate({
      activationId: started.activationId,
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.reason,
      mode === "mismatch"
        ? "ownerless-account-mismatch-attention"
        : "ownerless-account-authentication-failed"
    );
    assert.equal(second.counters.discovery, 0);
    assert.equal(second.counters.content, 0);
    const after = await second.canonicalDraft(started.activationId);
    assert.equal(after.stage, "account-ready");
    assert.equal(after.account.accountId, draft.account.accountId);
    assertNoDownstream(second);
  }
});

test("P302 binding preflight blocks unexpected ready, different Pocket and unavailable discovery before upload", async () => {
  for (const mode of ["same-unexpected", "different", "invalid", "failure"]) {
    const h = createHarness({
      discoveryResponses: ["not-configured"],
      contentResponses: [{ status: "committed", revision: 1 }],
    });
    const started = await h.runtime.startOwnerlessFirstCreate({
      accountPath: "new-account",
    });
    const draft = await h.canonicalDraft(started.activationId);
    if (mode === "same-unexpected") {
      h.pushDiscovery({ status: "ready", syncedPocketId: draft.syncedPocketId });
    } else if (mode === "different") {
      h.pushDiscovery({ status: "ready", syncedPocketId: "another-pocket" });
    } else if (mode === "invalid") {
      h.pushDiscovery("invalid");
    } else {
      h.pushDiscovery("throw");
    }

    const beforeContent = h.counters.content;
    const result = await h.runtime.continueOwnerlessFirstCreate({
      activationId: started.activationId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ownerless-account-binding-attention");
    assert.equal(h.counters.content, beforeContent);
    const after = await h.canonicalDraft(started.activationId);
    assert.equal(after.stage, "account-ready");
    assert.equal(after.pendingOperation, null);
    assertNoDownstream(h);
  }
});

test("P302 ambiguous content upload remains durable and ready-same-pocket is admitted only for exact idempotent retry", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    contentResponses: ["throw"],
  });
  const started = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  const first = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "initial-remote-unavailable");
  assert.equal(first.resumable, true);
  let pending = await h.canonicalDraft(started.activationId);
  assert.equal(pending.stage, "account-ready");
  assert.equal(pending.pendingOperation, "content-upload");
  assert.equal(h.contentCalls.length, 1);
  const operationId = h.contentCalls[0].operationId;
  const logicalChangeId = h.contentCalls[0].logicalChangeId;
  assert.equal(h.contentCalls[0].attemptKind, "new-change");

  h.pushDiscovery({
    status: "ready",
    syncedPocketId: pending.syncedPocketId,
  });
  h.pushContent({ status: "committed", revision: 1 });
  const second = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.stage, "content-committed");
  assert.equal(h.contentCalls.length, 2);
  assert.equal(h.contentCalls[1].attemptKind, "idempotent-retry");
  assert.equal(h.contentCalls[1].operationId, operationId);
  assert.equal(h.contentCalls[1].logicalChangeId, logicalChangeId);
  pending = await h.canonicalDraft(started.activationId);
  assert.equal(pending.stage, "content-committed");
  assert.equal(pending.confirmedRemoteRevision, 1);
  assertNoPostContent(h);
});

test("P302 content conflict remains durable and non-overwriting", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    contentResponses: [{ conflict: true, actualRevision: 1 }],
  });
  const started = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "initial-remote-conflict");
  assert.equal(result.conflict, true);
  assert.equal(result.resumable, false);
  const draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.stage, "account-ready");
  assert.equal(draft.pendingOperation, "content-conflict");
  assert.equal(draft.confirmedRemoteRevision, 0);
  assert.equal(h.counters.content, 1);
  assertNoPostContent(h);
});

test("P302 owner change across content await returns target-stale and does not falsely persist content success", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    contentResponses: [{ status: "committed", revision: 1 }],
    onConditionalUpload({ setOwnerKind }) {
      setOwnerKind("json");
    },
  });
  const started = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  const draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.stage, "account-ready");
  assert.equal(draft.pendingOperation, "content-upload");
  assert.equal(draft.confirmedRemoteRevision, 0);
  assert.equal(h.counters.content, 1);
  assertNoPostContent(h);
});

test("P302 content continuation still hard-stops at content-committed within that invocation", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    contentResponses: [{ status: "committed", revision: 1 }],
  });
  const started = await h.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  const committed = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(committed.stage, "content-committed");
  assert.equal(h.counters.content, 1);
  assert.equal(h.counters.envelope, 0);
  assert.equal(h.counters.recovery, 0);
  assert.equal(h.counters.adoption, 0);
});

test("P302 never exposes or invokes post-content ownerless stages", () => {
  const runtime = source("js/pocket-sync-browser-runtime.js");
  assert.match(runtime, /continueOwnerlessFirstCreate/);
  assert.match(runtime, /readActivation\(activationId\)/);
  assert.match(runtime, /accountLocator:\s*pinnedAccountId/);
  assert.match(runtime, /draft\.pendingOperation !== "content-upload"/);
  assert.match(runtime, /orchestrator\.resume\(/);
  assert.doesNotMatch(source("js/pocket-sync-local-integration.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-ui.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-doorway-capabilities.js"), /continueOwnerlessFirstCreate/);
});


function assertNoPostEnvelope(harness) {
  assert.equal(harness.counters.recovery, 0);
  assert.equal(harness.counters.recoveryPackage, 0);
  assert.equal(harness.counters.picker, 0);
  assert.equal(harness.counters.adoption, 0);
}

async function advanceNewAccountToContentCommitted(harness) {
  const started = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "new-account",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.stage, "account-ready");
  const committed = await harness.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.equal(committed.stage, "content-committed");
  assert.equal(harness.counters.envelope, 0);
  return { started, committed };
}

async function advanceExistingAccountToContentCommitted(harness) {
  const started = await harness.runtime.startOwnerlessFirstCreate({
    accountPath: "existing-unbound",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.stage, "account-ready");
  const committed = await harness.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.equal(committed.stage, "content-committed");
  assert.equal(harness.counters.envelope, 0);
  return { started, committed };
}

test("P303 admits exact content-committed through P294 and hard-stops at device-envelope-committed", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const { started } = await advanceNewAccountToContentCommitted(h);
  const beforeRegistration = h.counters.beginRegistration;
  const beforeAuthentication = h.counters.beginAuthentication;

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });

  assert.deepEqual(plain(result), {
    ok: true,
    reason: "ownerless-device-envelope-committed",
    activationId: started.activationId,
    accountPath: "new-account",
    syncedPocketId: result.syncedPocketId,
    deviceId: result.deviceId,
    stage: "device-envelope-committed",
    locallyDurable: true,
    remotelyCommitted: true,
    confirmedRemoteRevision: 1,
    keySetVersion: 1,
  });
  assert.equal(h.counters.beginRegistration, beforeRegistration);
  assert.equal(h.counters.beginAuthentication, beforeAuthentication);
  assert.equal(h.envelopeCalls.length, 1);
  const call = h.envelopeCalls[0];
  assert.equal(call.expectedKeySetVersion, 0);
  assert.equal(call.attemptKind, "new-change");

  const draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.stage, "device-envelope-committed");
  assert.equal(draft.confirmedRemoteRevision, 1);
  assert.equal(draft.keySetVersion, 1);
  assert.equal(draft.recoveryVersion, 0);
  assert.equal(draft.pendingOperation, null);
  assert.equal(call.operationId, draft.ids.deviceEnvelopeOperationId);
  assert.equal(call.logicalChangeId, draft.ids.deviceEnvelopeLogicalChangeId);
  assert.deepEqual(call.envelope, plain(draft.deviceEnvelope));
  assertNoPostEnvelope(h);
});

test("P303 same-runtime witness avoids redundant authentication for both account paths", async () => {
  for (const accountPath of ["new-account", "existing-unbound"]) {
    const h = createHarness({
      discoveryResponses: ["not-configured", "not-configured"],
    });
    const advanced = accountPath === "new-account"
      ? await advanceNewAccountToContentCommitted(h)
      : await advanceExistingAccountToContentCommitted(h);
    const beforeAuthentication = h.counters.beginAuthentication;
    const beforeRegistration = h.counters.beginRegistration;

    const result = await h.runtime.continueOwnerlessFirstCreate({
      activationId: advanced.started.activationId,
    });
    assert.equal(result.stage, "device-envelope-committed");
    assert.equal(h.counters.beginAuthentication, beforeAuthentication);
    assert.equal(h.counters.beginRegistration, beforeRegistration);
    assert.equal(h.envelopeCalls.length, 1);
    assert.equal(h.envelopeCalls[0].expectedKeySetVersion, 0);
    assert.equal(h.envelopeCalls[0].attemptKind, "new-change");
    assertNoPostEnvelope(h);
  }
});

test("P303 reload reauthenticates exact pinned account in P278 lifetime and zeroes raw PRF", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const { started } = await advanceNewAccountToContentCommitted(first);
  const committedDraft = await first.canonicalDraft(started.activationId);
  const accountId = committedDraft.account.accountId;

  const second = createHarness({
    shared: first.shared,
    authenticationAccountIds: [accountId],
  });
  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "device-envelope-committed");
  assert.equal(second.counters.beginAuthentication, 1);
  assert.equal(second.counters.finishAuthentication, 1);
  assert.equal(second.authenticationInputs.length, 1);
  assert.equal(second.authenticationInputs[0].accountLocator, accountId);
  assert.equal(second.counters.beginRegistration, 0);
  assert.equal(second.counters.finishRegistration, 0);
  assert.equal(second.envelopeCalls.length, 1);
  assert.ok(second.privatePrfReference instanceof Uint8Array);
  assert.deepEqual(Array.from(second.privatePrfReference), new Array(32).fill(0));
  assert.equal(JSON.stringify(result).includes("outputBytes"), false);
  const durable = await second.canonicalDraft(started.activationId);
  assert.equal(JSON.stringify(durable).includes("outputBytes"), false);
  assertNoPostEnvelope(second);
});

test("P303 auth mismatch, cancellation and failure publish zero envelope", async () => {
  for (const mode of ["mismatch", "cancel", "failure"]) {
    const first = createHarness({
      discoveryResponses: ["not-configured", "not-configured"],
    });
    const { started } = await advanceNewAccountToContentCommitted(first);
    const draft = await first.canonicalDraft(started.activationId);
    const options = { shared: first.shared };
    if (mode === "mismatch") options.authenticationAccountIds = ["another-account"];
    if (mode === "cancel") options.authenticationCancelled = true;
    if (mode === "failure") options.authenticationFailure = true;
    const second = createHarness(options);

    const result = await second.runtime.continueOwnerlessFirstCreate({
      activationId: started.activationId,
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.reason,
      mode === "mismatch"
        ? "ownerless-account-mismatch-attention"
        : "ownerless-account-authentication-failed"
    );
    assert.equal(second.counters.envelope, 0);
    assert.equal(second.counters.beginRegistration, 0);
    const after = await second.canonicalDraft(started.activationId);
    assert.equal(after.stage, "content-committed");
    assert.equal(after.keySetVersion, 0);
    assert.equal(after.account.accountId, draft.account.accountId);
    assertNoPostEnvelope(second);
  }
});

test("P303 rejects malformed content-committed durable state before authentication or envelope", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const { started } = await advanceNewAccountToContentCommitted(first);

  const second = createHarness({
    shared: first.shared,
    readActivationTransform(found) {
      if (found.draft?.stage !== "content-committed") return found;
      return Object.freeze({
        record: found.record,
        draft: Object.freeze(Object.assign({}, plain(found.draft), {
          keySetVersion: 9,
        })),
      });
    },
  });
  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");
  assert.equal(second.counters.beginAuthentication, 0);
  assert.equal(second.counters.envelope, 0);
  assertNoPostEnvelope(second);
});

test("P303 ambiguous envelope is durable and explicit retry is exact idempotent retry", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    envelopeResponses: ["throw"],
  });
  const { started } = await advanceNewAccountToContentCommitted(h);

  const first = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "device-envelope-failed");
  assert.equal(first.resumable, true);
  assert.equal(h.envelopeCalls.length, 1);
  const firstCall = h.envelopeCalls[0];
  assert.equal(firstCall.expectedKeySetVersion, 0);
  assert.equal(firstCall.attemptKind, "new-change");
  let pending = await h.canonicalDraft(started.activationId);
  assert.equal(pending.stage, "content-committed");
  assert.equal(pending.pendingOperation, "device-envelope");
  assert.equal(pending.keySetVersion, 0);

  h.pushEnvelope({
    status: "committed",
    keySetVersion: 1,
    masterKeyGeneration: 1,
    masterKeyContentEncryptionLimit: 2 ** 20,
  });
  const second = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.stage, "device-envelope-committed");
  assert.equal(h.envelopeCalls.length, 2);
  const retry = h.envelopeCalls[1];
  assert.equal(retry.attemptKind, "idempotent-retry");
  assert.equal(retry.expectedKeySetVersion, 0);
  assert.equal(retry.operationId, firstCall.operationId);
  assert.equal(retry.logicalChangeId, firstCall.logicalChangeId);
  assert.deepEqual(retry.envelope, firstCall.envelope);
  pending = await h.canonicalDraft(started.activationId);
  assert.equal(pending.stage, "device-envelope-committed");
  assert.equal(pending.pendingOperation, null);
  assert.equal(pending.keySetVersion, 1);
  assertNoPostEnvelope(h);
});

test("P303 envelope conflict remains durable and never republishes", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    envelopeResponses: [{ conflict: true, actualKeySetVersion: 1 }],
  });
  const { started } = await advanceNewAccountToContentCommitted(h);

  const first = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "device-envelope-failed");
  assert.equal(first.conflict, true);
  assert.equal(first.resumable, false);
  assert.equal(h.envelopeCalls.length, 1);
  let draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.stage, "content-committed");
  assert.equal(draft.pendingOperation, "device-envelope-conflict");
  assert.equal(draft.keySetVersion, 0);

  const second = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "device-envelope-failed");
  assert.equal(second.conflict, true);
  assert.equal(second.resumable, false);
  assert.equal(h.envelopeCalls.length, 1);
  draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.pendingOperation, "device-envelope-conflict");
  assert.equal(draft.keySetVersion, 0);
  assertNoPostEnvelope(h);
});

test("P303 malformed committed envelope response never falsely advances", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    envelopeResponses: [{
      status: "committed",
      keySetVersion: 1,
      masterKeyGeneration: 1,
      masterKeyContentEncryptionLimit: 123,
    }],
  });
  const { started } = await advanceNewAccountToContentCommitted(h);

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");
  assert.equal(h.envelopeCalls.length, 1);
  const draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.stage, "content-committed");
  assert.equal(draft.pendingOperation, "device-envelope");
  assert.equal(draft.keySetVersion, 0);
  assertNoPostEnvelope(h);
});

test("P303 owner change across envelope await returns target-stale without false advancement", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    onAddEnvelope({ setOwnerKind }) {
      setOwnerKind("json");
    },
  });
  const { started } = await advanceNewAccountToContentCommitted(h);

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(h.envelopeCalls.length, 1);
  const draft = await h.canonicalDraft(started.activationId);
  assert.equal(draft.stage, "content-committed");
  assert.equal(draft.pendingOperation, "device-envelope");
  assert.equal(draft.keySetVersion, 0);
  assertNoPostEnvelope(h);
});

test("P303 exact device-envelope-committed replay performs zero authentication, envelope or downstream work", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const { started } = await advanceNewAccountToContentCommitted(first);
  const committed = await first.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(committed.stage, "device-envelope-committed");

  const second = createHarness({ shared: first.shared });
  const replay = await second.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.deepEqual(plain(replay), plain(committed));
  assert.equal(second.counters.beginAuthentication, 0);
  assert.equal(second.counters.finishAuthentication, 0);
  assert.equal(second.counters.envelope, 0);
  assert.equal(second.counters.recovery, 0);
  assert.equal(second.counters.recoveryPackage, 0);
  assert.equal(second.counters.picker, 0);
  assert.equal(second.counters.adoption, 0);
});

test("P303 keeps PRF-envelope, recovery, Recovery Copy, adoption and UI integration dormant", () => {
  const runtime = source("js/pocket-sync-browser-runtime.js");
  assert.match(runtime, /exactDeviceEnvelopeCommittedState/);
  assert.match(runtime, /continueOwnerlessDeviceEnvelopeWithCurrentAccount/);
  assert.match(runtime, /ownerless-device-envelope-committed/);
  assert.doesNotMatch(source("js/pocket-sync-local-integration.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-ui.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-doorway-capabilities.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("index.html"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("sw.js"), /continueOwnerlessFirstCreate/);
});
