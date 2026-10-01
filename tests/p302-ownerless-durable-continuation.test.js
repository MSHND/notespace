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

function unavailableRegistrationCredential() {
  const base = fixtures.nativeRegistrationCredential();
  return {
    getClientExtensionResults() { return { prf: { enabled: false } }; },
    toJSON() {
      const value = base.toJSON();
      value.clientExtensionResults = { prf: { enabled: false } };
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
    orchestratorResume: 0,
    picker: 0,
    recoveryWrite: 0,
    adoption: 0,
  };
  const accountIntents = [];
  const authenticationInputs = [];
  const contentCalls = [];
  const envelopeCalls = [];
  const recoveryCalls = [];
  const recoveryPackageCalls = [];
  const recoveryDestinationIds = [];
  const recoveryWritePayloads = [];
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
  const recoveryResponses = (options.recoveryResponses || []).slice();
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

  const realActivationModule = context.PocketSyncActivation;
  context.PocketSyncActivation = Object.freeze(Object.assign({}, realActivationModule, {
    createActivationOrchestrator(input) {
      const orchestrator = realActivationModule.createActivationOrchestrator(input);
      return Object.freeze(Object.assign({}, orchestrator, {
        async resume(...args) {
          counters.orchestratorResume += 1;
          return orchestrator.resume(...args);
        },
      }));
    },
  }));

  const realSecurity = context.PocketSyncSecurityContract;
  context.PocketSyncSecurityContract = Object.freeze(Object.assign({}, realSecurity, {
    buildRecoveryPackage(input) {
      counters.recoveryPackage += 1;
      recoveryPackageCalls.push(plain(input));
      options.onBuildRecoveryPackage?.({
        input: plain(input),
        call: counters.recoveryPackage,
        setOwnerKind: (value) => { ownerKind = value; },
      });
      if ((options.recoveryPackageFailures || 0) >= counters.recoveryPackage) {
        throw new Error("synthetic recovery package build failure");
      }
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
          return options.unavailablePrf === true
            ? unavailableRegistrationCredential()
            : fixtures.nativeRegistrationCredential();
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
    async showSaveFilePicker() {
      counters.picker += 1;
      options.onPrepareRecoveryCopyDestination?.({
        call: counters.picker,
        setOwnerKind: (value) => { ownerKind = value; },
      });
      if (options.allowRecoveryPicker !== true) {
        throw new Error("Recovery Copy picker unreachable in this slice");
      }
      if ((options.recoveryPickerCancellations || 0) >= counters.picker) return null;
      if ((options.recoveryPickerFailures || 0) >= counters.picker) {
        throw new Error("synthetic Recovery Copy destination failure");
      }
      const destinationId = `p307-destination-${counters.picker}`;
      recoveryDestinationIds.push(destinationId);
      return Object.freeze({
        destinationId,
        async createWritable() {
          return Object.freeze({
            async write(payload) {
              counters.recoveryWrite += 1;
              recoveryWritePayloads.push(payload);
              options.onRecoveryWrite?.({
                payload,
                call: counters.recoveryWrite,
                destinationId,
                setOwnerKind: (value) => { ownerKind = value; },
              });
              if ((options.recoveryWriteFailures || 0) >= counters.recoveryWrite) {
                throw new Error("synthetic Recovery Copy write failure");
              }
            },
            async close() {},
            async abort() {},
          });
        },
      });
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
      async initialiseRecovery(input) {
        counters.recovery += 1;
        recoveryCalls.push(plain(input));
        options.onInitialiseRecovery?.({
          input,
          call: counters.recovery,
          setOwnerKind: (value) => { ownerKind = value; },
        });
        let next = recoveryResponses.length > 0
          ? recoveryResponses.shift()
          : {
            status: "committed",
            keySetVersion: input.expectedKeySetVersion + 1,
            recoveryVersion: 1,
            recoveryCopyRequired: true,
            accountLocator: `recovery-locator-p305-${counters.recovery}`,
          };
        if (typeof next === "function") next = await next(input, counters.recovery);
        if (next === "throw") throw new Error("synthetic recovery initialisation unavailable");
        if (next instanceof Error) throw next;
        return Object.freeze(next);
      },
      async beginRecovery() {
        counters.recovery += 1;
        throw new Error("recovery begin unreachable before P305 stop");
      },
      async finishRecovery() {
        counters.recovery += 1;
        throw new Error("recovery finish unreachable before P305 stop");
      },
      async rotateRecovery() {
        counters.recovery += 1;
        throw new Error("recovery rotation unreachable before P305 stop");
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
    recoveryCalls,
    recoveryPackageCalls,
    recoveryDestinationIds,
    recoveryWritePayloads,
    readActivation,
    canonicalDraft,
    setOwnerKind(value) { ownerKind = value; },
    pushDiscovery(value) { discoveryResponses.push(value); },
    pushContent(value) { contentResponses.push(value); },
    pushEnvelope(value) { envelopeResponses.push(value); },
    pushRecovery(value) { recoveryResponses.push(value); },
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

test("P303 device-envelope continuation still hard-stops at device-envelope-committed within that invocation", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const { started } = await advanceNewAccountToContentCommitted(h);
  const committed = await h.runtime.continueOwnerlessFirstCreate({
    activationId: started.activationId,
  });
  assert.equal(committed.stage, "device-envelope-committed");
  assert.equal(h.envelopeCalls.length, 1);
  assert.equal(h.envelopeCalls[0].envelope.envelopeKind, "device");
  assert.equal(h.counters.recovery, 0);
  assert.equal(h.counters.recoveryPackage, 0);
  assert.equal(h.counters.picker, 0);
  assert.equal(h.counters.adoption, 0);
});

test("P303 keeps its device-envelope owner boundary and UI integration remains dormant", () => {
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


function assertNoPostPrf(harness) {
  assert.equal(harness.counters.recovery, 0);
  assert.equal(harness.counters.recoveryPackage, 0);
  assert.equal(harness.counters.picker, 0);
  assert.equal(harness.counters.adoption, 0);
}

async function advanceToDeviceEnvelopeCommitted(harness, accountPath) {
  const advanced = accountPath === "new-account"
    ? await advanceNewAccountToContentCommitted(harness)
    : await advanceExistingAccountToContentCommitted(harness);
  const result = await harness.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "device-envelope-committed");
  const draft = await harness.canonicalDraft(advanced.started.activationId);
  assert.equal(draft.stage, "device-envelope-committed");
  assert.equal(draft.keySetVersion, 1);
  assert.equal(draft.recoveryVersion, 0);
  return { started: advanced.started, result, draft };
}

async function advanceToPrfTerminal(harness, accountPath, mode) {
  const advanced = await advanceToDeviceEnvelopeCommitted(harness, accountPath);
  assert.equal(advanced.draft.prfStatus, mode);
  const result = await harness.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  const expectedStage = mode === "available"
    ? "prf-envelope-committed"
    : "prf-envelope-skipped";
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, expectedStage);
  const draft = await harness.canonicalDraft(advanced.started.activationId);
  assert.equal(draft.stage, expectedStage);
  assert.equal(draft.keySetVersion, mode === "available" ? 2 : 1);
  assert.equal(draft.recoveryVersion, 0);
  assert.equal(draft.accountLocator, null);
  return { started: advanced.started, result, draft };
}

async function advanceToRecoveryInitialised(harness, accountPath, mode) {
  const advanced = await advanceToPrfTerminal(harness, accountPath, mode);
  const result = await harness.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "recovery-initialised");
  const draft = await harness.canonicalDraft(advanced.started.activationId);
  assert.equal(draft.stage, "recovery-initialised");
  assert.equal(draft.keySetVersion, mode === "available" ? 3 : 2);
  assert.equal(draft.recoveryVersion, 1);
  assert.notEqual(draft.accountLocator, null);
  assert.notEqual(draft.accountLocator, draft.account.accountId);
  assert.equal(draft.recoveryPackage, null);
  assert.equal(draft.recoveryCopyStored, false);
  return { started: advanced.started, result, draft };
}

async function advanceToRecoveryCopyPending(harness, accountPath, mode) {
  const advanced = await advanceToRecoveryInitialised(harness, accountPath, mode);
  const result = await harness.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "recovery-copy-pending");
  const draft = await harness.canonicalDraft(advanced.started.activationId);
  assert.equal(draft.stage, "recovery-copy-pending");
  assert.equal(draft.keySetVersion, mode === "available" ? 3 : 2);
  assert.equal(draft.recoveryVersion, 1);
  assert.notEqual(draft.recoveryPackage, null);
  assert.equal(draft.recoveryCopyStored, false);
  return { started: advanced.started, result, draft };
}

function assertNoPostRecovery(harness) {
  assert.equal(harness.counters.recoveryPackage, 0);
  assert.equal(harness.counters.picker, 0);
  assert.equal(harness.counters.adoption, 0);
}

test("P304 AVAILABLE uses P295 for both account paths, exact staged envelope and one-stage hard stop", async () => {
  for (const accountPath of ["new-account", "existing-unbound"]) {
    const h = createHarness({
      discoveryResponses: ["not-configured", "not-configured"],
    });
    const advanced = await advanceToDeviceEnvelopeCommitted(h, accountPath);
    assert.equal(advanced.draft.prfStatus, "available");
    assert.notEqual(advanced.draft.prfEnvelope, null);
    const stagedEnvelope = plain(advanced.draft.prfEnvelope);
    const beforeAuthentication = h.counters.beginAuthentication;
    const beforeRegistration = h.counters.beginRegistration;
    const beforeEnvelope = h.envelopeCalls.length;

    const result = await h.runtime.continueOwnerlessFirstCreate({
      activationId: advanced.started.activationId,
    });

    assert.deepEqual(plain(result), {
      ok: true,
      reason: "ownerless-prf-envelope-committed",
      activationId: advanced.started.activationId,
      accountPath,
      syncedPocketId: advanced.draft.syncedPocketId,
      deviceId: advanced.draft.deviceId,
      stage: "prf-envelope-committed",
      locallyDurable: true,
      remotelyCommitted: true,
      confirmedRemoteRevision: 1,
      keySetVersion: 2,
    });
    assert.equal(h.counters.beginAuthentication, beforeAuthentication);
    assert.equal(h.counters.beginRegistration, beforeRegistration);
    assert.equal(h.envelopeCalls.length, beforeEnvelope + 1);
    const prfCall = h.envelopeCalls.at(-1);
    assert.equal(prfCall.envelope.envelopeKind, "passkey-prf");
    assert.equal(prfCall.expectedKeySetVersion, 1);
    assert.equal(prfCall.attemptKind, "new-change");
    assert.equal(prfCall.operationId, advanced.draft.ids.prfEnvelopeOperationId);
    assert.equal(prfCall.logicalChangeId, advanced.draft.ids.prfEnvelopeLogicalChangeId);
    assert.deepEqual(prfCall.envelope, stagedEnvelope);

    const terminal = await h.canonicalDraft(advanced.started.activationId);
    assert.equal(terminal.stage, "prf-envelope-committed");
    assert.equal(terminal.prfStatus, "available");
    assert.equal(terminal.keySetVersion, 2);
    assert.equal(terminal.recoveryVersion, 0);
    assert.equal(terminal.pendingOperation, null);
    assert.deepEqual(plain(terminal.prfEnvelope), stagedEnvelope);
    assertNoPostPrf(h);
  }
});

test("P304 AVAILABLE reload reauthenticates exact pinned account, ignores raw PRF and P278 zeroes it", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const advanced = await advanceToDeviceEnvelopeCommitted(first, "new-account");
  const accountId = advanced.draft.account.accountId;
  const stagedEnvelope = plain(advanced.draft.prfEnvelope);

  const second = createHarness({
    shared: first.shared,
    authenticationAccountIds: [accountId],
    envelopeResponses: [{
      status: "committed",
      keySetVersion: 2,
    }],
  });
  assert.equal(second.derivedPrfReference, null);
  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "prf-envelope-committed");
  assert.equal(second.counters.beginAuthentication, 1);
  assert.equal(second.counters.finishAuthentication, 1);
  assert.equal(second.authenticationInputs.length, 1);
  assert.equal(second.authenticationInputs[0].accountLocator, accountId);
  assert.equal(second.counters.beginRegistration, 0);
  assert.equal(second.counters.finishRegistration, 0);
  assert.equal(second.envelopeCalls.length, 1);
  assert.equal(second.envelopeCalls[0].expectedKeySetVersion, 1);
  assert.deepEqual(second.envelopeCalls[0].envelope, stagedEnvelope);
  assert.equal(second.derivedPrfReference, null,
    "reauthentication raw PRF must not rebuild or replace the staged PRF envelope");
  assert.ok(second.privatePrfReference instanceof Uint8Array);
  assert.deepEqual(Array.from(second.privatePrfReference), new Array(32).fill(0));
  assert.equal(JSON.stringify(result).includes("outputBytes"), false);
  const terminal = await second.canonicalDraft(advanced.started.activationId);
  assert.equal(JSON.stringify(terminal).includes("outputBytes"), false);
  assert.deepEqual(plain(terminal.prfEnvelope), stagedEnvelope);
  assertNoPostPrf(second);
});

test("P304 AVAILABLE auth mismatch, cancellation and failure publish zero PRF envelope", async () => {
  for (const mode of ["mismatch", "cancel", "failure"]) {
    const first = createHarness({
      discoveryResponses: ["not-configured", "not-configured"],
    });
    const advanced = await advanceToDeviceEnvelopeCommitted(first, "new-account");
    const accountId = advanced.draft.account.accountId;
    const options = { shared: first.shared };
    if (mode === "mismatch") options.authenticationAccountIds = ["another-account"];
    if (mode === "cancel") options.authenticationCancelled = true;
    if (mode === "failure") options.authenticationFailure = true;
    const second = createHarness(options);

    const result = await second.runtime.continueOwnerlessFirstCreate({
      activationId: advanced.started.activationId,
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
    assert.equal(second.counters.finishRegistration, 0);
    const after = await second.canonicalDraft(advanced.started.activationId);
    assert.equal(after.stage, "device-envelope-committed");
    assert.equal(after.keySetVersion, 1);
    assert.equal(after.account.accountId, accountId);
    assertNoPostPrf(second);
  }
});

test("P304 validates exact device-envelope-committed durable state before authentication or PRF publication", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const advanced = await advanceToDeviceEnvelopeCommitted(first, "new-account");

  const second = createHarness({
    shared: first.shared,
    readActivationTransform(found) {
      if (found.draft?.stage !== "device-envelope-committed") return found;
      return Object.freeze({
        record: Object.freeze(Object.assign({}, plain(found.record), {
          usage: Object.freeze(Object.assign({}, plain(found.record.usage), {
            masterKeyGeneration: 9,
          })),
        })),
        draft: found.draft,
      });
    },
  });
  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");
  assert.equal(second.counters.beginAuthentication, 0);
  assert.equal(second.counters.envelope, 0);
  assertNoPostPrf(second);
});

test("P304 AVAILABLE ambiguity is durable and explicit retry reuses exact IDs and staged envelope", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    envelopeResponses: [{
      status: "committed",
      keySetVersion: 1,
      masterKeyGeneration: 1,
      masterKeyContentEncryptionLimit: 2 ** 20,
    }, "throw"],
  });
  const advanced = await advanceToDeviceEnvelopeCommitted(h, "new-account");
  const stagedEnvelope = plain(advanced.draft.prfEnvelope);

  const first = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "prf-envelope-failed");
  assert.equal(first.resumable, true);
  assert.equal(h.envelopeCalls.length, 2);
  const firstPrfCall = h.envelopeCalls[1];
  assert.equal(firstPrfCall.expectedKeySetVersion, 1);
  assert.equal(firstPrfCall.attemptKind, "new-change");
  assert.deepEqual(firstPrfCall.envelope, stagedEnvelope);
  let pending = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(pending.stage, "device-envelope-committed");
  assert.equal(pending.pendingOperation, "prf-envelope");
  assert.equal(pending.keySetVersion, 1);

  h.pushEnvelope({
    status: "committed",
    keySetVersion: 2,
  });
  const second = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.stage, "prf-envelope-committed");
  assert.equal(h.envelopeCalls.length, 3);
  const retry = h.envelopeCalls[2];
  assert.equal(retry.attemptKind, "idempotent-retry");
  assert.equal(retry.expectedKeySetVersion, 1);
  assert.equal(retry.operationId, firstPrfCall.operationId);
  assert.equal(retry.logicalChangeId, firstPrfCall.logicalChangeId);
  assert.deepEqual(retry.envelope, firstPrfCall.envelope);
  pending = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(pending.stage, "prf-envelope-committed");
  assert.equal(pending.keySetVersion, 2);
  assert.equal(pending.pendingOperation, null);
  assertNoPostPrf(h);
});

test("P304 AVAILABLE conflict remains durable and never republishes", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    envelopeResponses: [{
      status: "committed",
      keySetVersion: 1,
      masterKeyGeneration: 1,
      masterKeyContentEncryptionLimit: 2 ** 20,
    }, { conflict: true, actualKeySetVersion: 5 }],
  });
  const advanced = await advanceToDeviceEnvelopeCommitted(h, "new-account");

  const first = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "prf-envelope-failed");
  assert.equal(first.conflict, true);
  assert.equal(first.resumable, false);
  assert.equal(h.envelopeCalls.length, 2);
  let conflicted = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(conflicted.stage, "device-envelope-committed");
  assert.equal(conflicted.pendingOperation, "prf-envelope-conflict");
  assert.equal(conflicted.keySetVersion, 1);

  const second = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "prf-envelope-failed");
  assert.equal(second.conflict, true);
  assert.equal(second.resumable, false);
  assert.equal(h.envelopeCalls.length, 2, "durable conflict must never republish");
  conflicted = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(conflicted.pendingOperation, "prf-envelope-conflict");
  assertNoPostPrf(h);
});

test("P304 AVAILABLE malformed committed response never falsely advances", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    envelopeResponses: [{
      status: "committed",
      keySetVersion: 1,
      masterKeyGeneration: 1,
      masterKeyContentEncryptionLimit: 2 ** 20,
    }, {
      status: "committed",
      keySetVersion: 3,
    }],
  });
  const advanced = await advanceToDeviceEnvelopeCommitted(h, "new-account");

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");
  assert.equal(h.envelopeCalls.length, 2);
  const pending = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(pending.stage, "device-envelope-committed");
  assert.equal(pending.pendingOperation, "prf-envelope");
  assert.equal(pending.keySetVersion, 1);
  assertNoPostPrf(h);
});

test("P304 AVAILABLE owner change across PRF await returns target-stale without false advancement", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    onAddEnvelope({ input, setOwnerKind }) {
      if (input.envelope?.envelopeKind === "passkey-prf") setOwnerKind("json");
    },
  });
  const advanced = await advanceToDeviceEnvelopeCommitted(h, "new-account");

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(h.envelopeCalls.length, 2);
  const pending = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(pending.stage, "device-envelope-committed");
  assert.equal(pending.pendingOperation, "prf-envelope");
  assert.equal(pending.keySetVersion, 1);
  assertNoPostPrf(h);
});

test("P304 SKIPPED records P295 terminal with zero new authentication and zero PRF-envelope publication", async () => {
  const h = createHarness({
    unavailablePrf: true,
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const advanced = await advanceToDeviceEnvelopeCommitted(h, "existing-unbound");
  assert.equal(advanced.draft.prfStatus, "skipped");
  assert.equal(advanced.draft.prfEnvelope, null);
  assert.equal(advanced.draft.pendingOperation, null);
  const beforeAuthentication = h.counters.beginAuthentication;
  const beforeRegistration = h.counters.beginRegistration;
  const beforeEnvelope = h.envelopeCalls.length;

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.deepEqual(plain(result), {
    ok: true,
    reason: "ownerless-prf-envelope-skipped",
    activationId: advanced.started.activationId,
    accountPath: "existing-unbound",
    syncedPocketId: advanced.draft.syncedPocketId,
    deviceId: advanced.draft.deviceId,
    stage: "prf-envelope-skipped",
    locallyDurable: true,
    remotelyCommitted: true,
    confirmedRemoteRevision: 1,
    keySetVersion: 1,
  });
  assert.equal(h.counters.beginAuthentication, beforeAuthentication);
  assert.equal(h.counters.beginRegistration, beforeRegistration);
  assert.equal(h.envelopeCalls.length, beforeEnvelope,
    "skipped terminal must publish no PRF envelope");
  const terminal = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(terminal.stage, "prf-envelope-skipped");
  assert.equal(terminal.prfStatus, "skipped");
  assert.equal(terminal.prfEnvelope, null);
  assert.equal(terminal.keySetVersion, 1);
  assert.equal(terminal.recoveryVersion, 0);
  assertNoPostPrf(h);
});

test("P305 both account paths and both PRF outcomes converge through P296 recovery initialisation and hard-stop", async () => {
  for (const accountPath of ["new-account", "existing-unbound"]) {
    for (const mode of ["available", "skipped"]) {
      const h = createHarness({
        unavailablePrf: mode === "skipped",
        discoveryResponses: ["not-configured", "not-configured"],
      });
      const advanced = await advanceToPrfTerminal(h, accountPath, mode);
      const beforeAuthentication = h.counters.beginAuthentication;
      const beforeRegistration = h.counters.beginRegistration;
      const beforeEnvelope = h.counters.envelope;
      const expectedStart = mode === "available" ? 2 : 1;
      const expectedEnd = expectedStart + 1;

      const result = await h.runtime.continueOwnerlessFirstCreate({
        activationId: advanced.started.activationId,
      });

      assert.deepEqual(plain(result), {
        ok: true,
        reason: "ownerless-recovery-initialised",
        activationId: advanced.started.activationId,
        accountPath,
        syncedPocketId: advanced.draft.syncedPocketId,
        deviceId: advanced.draft.deviceId,
        stage: "recovery-initialised",
        locallyDurable: true,
        remotelyCommitted: true,
        confirmedRemoteRevision: 1,
        keySetVersion: expectedEnd,
        recoveryVersion: 1,
        recoveryCopyRequired: true,
      });
      assert.equal(h.counters.beginAuthentication, beforeAuthentication);
      assert.equal(h.counters.beginRegistration, beforeRegistration);
      assert.equal(h.counters.envelope, beforeEnvelope);
      assert.equal(h.counters.recovery, 1);
      assert.equal(h.recoveryCalls.length, 1);
      assert.deepEqual(h.recoveryCalls[0], {
        apiVersion: 1,
        operationId: advanced.draft.ids.recoveryOperationId,
        logicalChangeId: advanced.draft.ids.recoveryLogicalChangeId,
        attemptKind: "new-change",
        syncedPocketId: advanced.draft.syncedPocketId,
        expectedKeySetVersion: expectedStart,
        recoveryVerifier: plain(advanced.draft.recoveryVerifier),
        recoveryEnvelope: plain(advanced.draft.recoveryEnvelope),
      });

      const terminal = await h.canonicalDraft(advanced.started.activationId);
      assert.equal(terminal.stage, "recovery-initialised");
      assert.equal(terminal.keySetVersion, expectedEnd);
      assert.equal(terminal.recoveryVersion, 1);
      assert.equal(terminal.accountLocator, "recovery-locator-p305-1");
      assert.notEqual(terminal.accountLocator, terminal.account.accountId);
      assert.equal(terminal.pendingOperation, null);
      assert.equal(terminal.recoveryPackage, null);
      assert.equal(terminal.recoveryCopyStored, false);
      assert.equal(terminal.adopted, false);
      assertNoPostRecovery(h);
    }
  }
});

test("P305 validates exact PRF-terminal durable state before recovery work", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const advanced = await advanceToPrfTerminal(first, "new-account", "available");
  const second = createHarness({
    shared: first.shared,
    readActivationTransform(found) {
      if (found.draft?.stage !== "prf-envelope-committed") return found;
      return Object.freeze({
        record: Object.freeze(Object.assign({}, plain(found.record), {
          usage: Object.freeze(Object.assign({}, plain(found.record.usage), {
            masterKeyGeneration: 9,
          })),
        })),
        draft: found.draft,
      });
    },
  });
  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");
  assert.equal(second.counters.beginAuthentication, 0);
  assert.equal(second.counters.recovery, 0);
  assertNoPostRecovery(second);
});

test("P305 ambiguous recovery stays durable and explicit retry reuses exact IDs and recovery material", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    recoveryResponses: [
      "throw",
      (input) => ({
        status: "committed",
        keySetVersion: input.expectedKeySetVersion + 1,
        recoveryVersion: 1,
        recoveryCopyRequired: true,
        accountLocator: "recovery-locator-p305-retry",
      }),
    ],
  });
  const advanced = await advanceToPrfTerminal(h, "new-account", "available");

  const first = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "recovery-initialisation-failed");
  assert.equal(first.resumable, true);
  assert.equal(h.counters.recovery, 1);
  let pending = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(pending.stage, "prf-envelope-committed");
  assert.equal(pending.pendingOperation, "recovery-initialisation");
  assert.equal(pending.recoveryVersion, 0);

  const second = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.stage, "recovery-initialised");
  assert.equal(h.counters.recovery, 2);
  assert.deepEqual(h.recoveryCalls.map((call) => ({
    operationId: call.operationId,
    logicalChangeId: call.logicalChangeId,
    attemptKind: call.attemptKind,
    expectedKeySetVersion: call.expectedKeySetVersion,
    recoveryVerifier: call.recoveryVerifier,
    recoveryEnvelope: call.recoveryEnvelope,
  })), [
    {
      operationId: advanced.draft.ids.recoveryOperationId,
      logicalChangeId: advanced.draft.ids.recoveryLogicalChangeId,
      attemptKind: "new-change",
      expectedKeySetVersion: 2,
      recoveryVerifier: plain(advanced.draft.recoveryVerifier),
      recoveryEnvelope: plain(advanced.draft.recoveryEnvelope),
    },
    {
      operationId: advanced.draft.ids.recoveryOperationId,
      logicalChangeId: advanced.draft.ids.recoveryLogicalChangeId,
      attemptKind: "idempotent-retry",
      expectedKeySetVersion: 2,
      recoveryVerifier: plain(advanced.draft.recoveryVerifier),
      recoveryEnvelope: plain(advanced.draft.recoveryEnvelope),
    },
  ]);
  pending = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(pending.pendingOperation, null);
  assertNoPostRecovery(h);
});

test("P305 recovery conflict remains durable and never republishes", async () => {
  const h = createHarness({
    unavailablePrf: true,
    discoveryResponses: ["not-configured", "not-configured"],
    recoveryResponses: [{
      conflict: true,
      actualKeySetVersion: 8,
      recoveryVersion: 1,
    }],
  });
  const advanced = await advanceToPrfTerminal(h, "existing-unbound", "skipped");

  const first = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "recovery-initialisation-failed");
  assert.equal(first.conflict, true);
  assert.equal(first.resumable, false);
  assert.equal(h.counters.recovery, 1);
  let conflicted = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(conflicted.stage, "prf-envelope-skipped");
  assert.equal(conflicted.pendingOperation, "recovery-conflict");

  const second = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "recovery-initialisation-failed");
  assert.equal(second.conflict, true);
  assert.equal(second.resumable, false);
  assert.equal(h.counters.recovery, 1);
  conflicted = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(conflicted.pendingOperation, "recovery-conflict");
  assertNoPostRecovery(h);
});

test("P305 malformed recovery success cannot falsely advance", async () => {
  for (const mode of ["wrong-version", "equal-account-locator"]) {
    let equalAccountId = null;
    const h = createHarness({
      discoveryResponses: ["not-configured", "not-configured"],
      recoveryResponses: [
        (input) => ({
          status: "committed",
          keySetVersion: mode === "wrong-version"
            ? input.expectedKeySetVersion + 2
            : input.expectedKeySetVersion + 1,
          recoveryVersion: 1,
          recoveryCopyRequired: true,
          accountLocator: mode === "equal-account-locator"
            ? equalAccountId
            : "recovery-locator-p305-malformed",
        }),
      ],
    });
    const advanced = await advanceToPrfTerminal(h, "new-account", "available");
    equalAccountId = advanced.draft.account.accountId;

    const result = await h.runtime.continueOwnerlessFirstCreate({
      activationId: advanced.started.activationId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ownerless-activation-state-invalid");
    assert.equal(h.counters.recovery, 1);
    const pending = await h.canonicalDraft(advanced.started.activationId);
    assert.equal(pending.stage, "prf-envelope-committed");
    assert.equal(pending.recoveryVersion, 0);
    assert.equal(pending.accountLocator, null);
    assert.equal(pending.pendingOperation, "recovery-initialisation");
    assertNoPostRecovery(h);
  }
});

test("P305 owner change across recovery await returns target-stale without false advancement", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    onInitialiseRecovery({ setOwnerKind }) {
      setOwnerKind("json");
    },
  });
  const advanced = await advanceToPrfTerminal(h, "new-account", "available");

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(h.counters.recovery, 1);
  const pending = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(pending.stage, "prf-envelope-committed");
  assert.equal(pending.recoveryVersion, 0);
  assert.equal(pending.accountLocator, null);
  assert.equal(pending.pendingOperation, "recovery-initialisation");
  assertNoPostRecovery(h);
});

test("P306 both account paths and both PRF branches advance exactly once through P297 to recovery-copy-pending", async () => {
  for (const accountPath of ["new-account", "existing-unbound"]) {
    for (const mode of ["available", "skipped"]) {
      const h = createHarness({
        unavailablePrf: mode === "skipped",
        discoveryResponses: ["not-configured", "not-configured"],
      });
      const advanced = await advanceToRecoveryInitialised(h, accountPath, mode);
      const before = {
        beginRegistration: h.counters.beginRegistration,
        finishRegistration: h.counters.finishRegistration,
        beginAuthentication: h.counters.beginAuthentication,
        finishAuthentication: h.counters.finishAuthentication,
        credentialCreate: h.counters.credentialCreate,
        credentialGet: h.counters.credentialGet,
        discovery: h.counters.discovery,
        content: h.counters.content,
        envelope: h.counters.envelope,
        recovery: h.counters.recovery,
        orchestratorResume: h.counters.orchestratorResume,
        packageCalls: h.recoveryPackageCalls.length,
      };
      const beforeDraft = plain(advanced.draft);

      const result = await h.runtime.continueOwnerlessFirstCreate({
        activationId: advanced.started.activationId,
      });

      assert.deepEqual(plain(result), {
        ok: true,
        reason: "ownerless-recovery-copy-pending",
        activationId: advanced.started.activationId,
        accountPath,
        syncedPocketId: advanced.draft.syncedPocketId,
        deviceId: advanced.draft.deviceId,
        stage: "recovery-copy-pending",
        locallyDurable: true,
        remotelyCommitted: true,
        confirmedRemoteRevision: 1,
        keySetVersion: mode === "available" ? 3 : 2,
        recoveryVersion: 1,
        recoveryCopyRequired: true,
      });
      assert.equal(h.counters.orchestratorResume, before.orchestratorResume + 1);
      assert.equal(h.counters.beginRegistration, before.beginRegistration);
      assert.equal(h.counters.finishRegistration, before.finishRegistration);
      assert.equal(h.counters.beginAuthentication, before.beginAuthentication);
      assert.equal(h.counters.finishAuthentication, before.finishAuthentication);
      assert.equal(h.counters.credentialCreate, before.credentialCreate);
      assert.equal(h.counters.credentialGet, before.credentialGet);
      assert.equal(h.counters.discovery, before.discovery);
      assert.equal(h.counters.content, before.content);
      assert.equal(h.counters.envelope, before.envelope);
      assert.equal(h.counters.recovery, before.recovery);
      assert.equal(h.counters.picker, 0);
      assert.equal(h.counters.recoveryWrite, 0);
      assert.equal(h.counters.adoption, 0);

      const packageBuildInput = h.recoveryPackageCalls[before.packageCalls];
      assert.notEqual(packageBuildInput, undefined);
      assert.equal(packageBuildInput.packageVersion, 2);
      assert.equal(packageBuildInput.accountLocator, beforeDraft.accountLocator);
      assert.equal(packageBuildInput.syncedPocketId, beforeDraft.syncedPocketId);
      assert.equal(packageBuildInput.rootMaterial, beforeDraft.recoveryRoot);
      assert.equal(packageBuildInput.rootBits, 256);
      assert.deepEqual(
        packageBuildInput.recoveryAuthorisation,
        beforeDraft.recoveryAuthorisation
      );
      assert.deepEqual(
        packageBuildInput.instructions,
        [h.context.PocketSyncSecurityContract.RECOVERY_COPY.body]
      );

      const pending = await h.canonicalDraft(advanced.started.activationId);
      assert.equal(pending.stage, "recovery-copy-pending");
      assert.equal(pending.confirmedRemoteRevision, 1);
      assert.equal(pending.keySetVersion, mode === "available" ? 3 : 2);
      assert.equal(pending.recoveryVersion, 1);
      assert.equal(pending.pendingOperation, null);
      assert.equal(pending.recoveryCopyStored, false);
      assert.equal(pending.adopted, false);
      assert.equal(pending.accountLocator, beforeDraft.accountLocator);
      assert.equal(pending.recoveryRoot, beforeDraft.recoveryRoot);
      assert.deepEqual(plain(pending.recoveryAuthorisation), beforeDraft.recoveryAuthorisation);
      assert.deepEqual(plain(pending.recoveryVerifier), beforeDraft.recoveryVerifier);
      assert.deepEqual(plain(pending.recoveryEnvelope), beforeDraft.recoveryEnvelope);
      assert.deepEqual(plain(pending.account), beforeDraft.account);
      assert.equal(pending.recoveryPackage.kind, "pocket-recovery-package");
      assert.equal(pending.recoveryPackage.localOnly, true);
      assert.equal(pending.recoveryPackage.remoteUploadAllowed, false);
      assert.equal(pending.recoveryPackage.packageVersion, 2);
      assert.equal(pending.recoveryPackage.accountLocator, beforeDraft.accountLocator);
      assert.equal(pending.recoveryPackage.syncedPocketId, beforeDraft.syncedPocketId);
      assert.equal(pending.recoveryPackage.rootMaterial, beforeDraft.recoveryRoot);
      assert.equal(pending.recoveryPackage.rootBits, 256);
      assert.deepEqual(
        plain(pending.recoveryPackage.recoveryAuthorisation),
        beforeDraft.recoveryAuthorisation
      );
      assert.deepEqual(
        plain(pending.recoveryPackage.instructions),
        [h.context.PocketSyncSecurityContract.RECOVERY_COPY.body]
      );
      assert.doesNotMatch(
        JSON.stringify(result),
        /recoveryPackage|recoveryRoot|recoveryAuthorisation|accountLocator|accountId|credentialId|checksum|recoveryEnvelope|recoveryVerifier|outputBytes/
      );
    }
  }
});

test("P306 validates exact recovery-initialised durable truth before package work", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const advanced = await advanceToRecoveryInitialised(first, "new-account", "available");
  const second = createHarness({
    shared: first.shared,
    readActivationTransform(found) {
      if (found.draft?.stage !== "recovery-initialised") return found;
      return Object.freeze({
        record: Object.freeze(Object.assign({}, plain(found.record), {
          usage: Object.freeze(Object.assign({}, plain(found.record.usage), {
            masterKeyContentEncryptionLimit: 9,
          })),
        })),
        draft: found.draft,
      });
    },
  });

  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-state-invalid");
  assert.equal(second.counters.orchestratorResume, 0);
  assert.equal(second.counters.recoveryPackage, 0);
  assert.equal(second.counters.beginAuthentication, 0);
  assert.equal(second.counters.discovery, 0);
  assert.equal(second.counters.content, 0);
  assert.equal(second.counters.envelope, 0);
  assert.equal(second.counters.recovery, 0);
  assert.equal(second.counters.picker, 0);
  assert.equal(second.counters.recoveryWrite, 0);
  assert.equal(second.counters.adoption, 0);
});

test("P306 package-build failure is resumable with zero automatic retry and explicit retry succeeds once", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    recoveryPackageFailures: 1,
  });
  const advanced = await advanceToRecoveryInitialised(h, "existing-unbound", "available");
  const before = plain(advanced.draft);
  const resumesBefore = h.counters.orchestratorResume;

  const failed = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "ownerless-recovery-copy-preparation-failed");
  assert.equal(failed.resumable, true);
  assert.equal(failed.recoveryCopyRequired, true);
  assert.equal(h.counters.orchestratorResume, resumesBefore + 1);
  assert.equal(h.counters.recoveryPackage, 1, "no automatic package retry");
  let after = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(after.stage, "recovery-initialised");
  assert.equal(after.recoveryPackage, null);
  assert.equal(after.recoveryCopyStored, false);
  assert.equal(after.pendingOperation, null);
  assert.equal(after.recoveryRoot, before.recoveryRoot);
  assert.deepEqual(plain(after.recoveryAuthorisation), before.recoveryAuthorisation);
  assert.equal(h.counters.picker, 0);
  assert.equal(h.counters.recoveryWrite, 0);
  assert.equal(h.counters.adoption, 0);

  const retryResumesBefore = h.counters.orchestratorResume;
  const retried = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.stage, "recovery-copy-pending");
  assert.equal(h.counters.orchestratorResume, retryResumesBefore + 1);
  after = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(after.stage, "recovery-copy-pending");
  assert.notEqual(after.recoveryPackage, null);
  assert.equal(h.counters.picker, 0);
  assert.equal(h.counters.recoveryWrite, 0);
  assert.equal(h.counters.adoption, 0);
});

test("P306 ownerless target change across package construction cannot falsely advance", async () => {
  let changed = false;
  const h = createHarness({
    unavailablePrf: true,
    discoveryResponses: ["not-configured", "not-configured"],
    onBuildRecoveryPackage({ setOwnerKind, call }) {
      if (!changed && call === 1) {
        changed = true;
        setOwnerKind("json");
      }
    },
  });
  const advanced = await advanceToRecoveryInitialised(h, "new-account", "skipped");

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  const after = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(after.stage, "recovery-initialised");
  assert.equal(after.recoveryPackage, null);
  assert.equal(after.recoveryCopyStored, false);
  assert.equal(h.counters.picker, 0);
  assert.equal(h.counters.recoveryWrite, 0);
  assert.equal(h.counters.adoption, 0);
});

test("P307 both account paths and both PRF branches use P298 once and hard-stop ready-for-adoption", async () => {
  for (const accountPath of ["new-account", "existing-unbound"]) {
    for (const mode of ["available", "skipped"]) {
      const h = createHarness({
        unavailablePrf: mode === "skipped",
        discoveryResponses: ["not-configured", "not-configured"],
        allowRecoveryPicker: true,
      });
      const advanced = await advanceToRecoveryCopyPending(h, accountPath, mode);
      const beforeDraft = plain(advanced.draft);
      const beforeFound = await h.readActivation(advanced.started.activationId);
      const before = {
        beginRegistration: h.counters.beginRegistration,
        finishRegistration: h.counters.finishRegistration,
        beginAuthentication: h.counters.beginAuthentication,
        finishAuthentication: h.counters.finishAuthentication,
        credentialCreate: h.counters.credentialCreate,
        credentialGet: h.counters.credentialGet,
        discovery: h.counters.discovery,
        content: h.counters.content,
        envelope: h.counters.envelope,
        recovery: h.counters.recovery,
        orchestratorResume: h.counters.orchestratorResume,
        picker: h.counters.picker,
        write: h.counters.recoveryWrite,
        adoption: h.counters.adoption,
      };

      const result = await h.runtime.continueOwnerlessFirstCreate({
        activationId: advanced.started.activationId,
      });

      assert.deepEqual(plain(result), {
        ok: true,
        reason: "ownerless-ready-for-adoption",
        activationId: advanced.started.activationId,
        accountPath,
        syncedPocketId: beforeDraft.syncedPocketId,
        deviceId: beforeDraft.deviceId,
        stage: "ready-for-adoption",
        locallyDurable: true,
        remotelyCommitted: true,
        confirmedRemoteRevision: 1,
        keySetVersion: mode === "available" ? 3 : 2,
        recoveryVersion: 1,
        recoveryCopyRequired: false,
        recoveryCopyStored: true,
        adopted: false,
      });

      assert.equal(h.counters.orchestratorResume, before.orchestratorResume + 1);
      assert.equal(h.counters.picker, before.picker + 1);
      assert.equal(h.counters.recoveryWrite, before.write + 1);
      assert.equal(h.counters.adoption, before.adoption);
      assert.equal(h.counters.beginRegistration, before.beginRegistration);
      assert.equal(h.counters.finishRegistration, before.finishRegistration);
      assert.equal(h.counters.beginAuthentication, before.beginAuthentication);
      assert.equal(h.counters.finishAuthentication, before.finishAuthentication);
      assert.equal(h.counters.credentialCreate, before.credentialCreate);
      assert.equal(h.counters.credentialGet, before.credentialGet);
      assert.equal(h.counters.discovery, before.discovery);
      assert.equal(h.counters.content, before.content);
      assert.equal(h.counters.envelope, before.envelope);
      assert.equal(h.counters.recovery, before.recovery);

      const written = JSON.parse(h.recoveryWritePayloads.at(-1));
      assert.deepEqual(written, beforeDraft.recoveryPackage,
        "P298 writer must receive the exact persisted P297 package");
      assert.equal(h.recoveryDestinationIds.length, 1);

      const found = await h.readActivation(advanced.started.activationId);
      const ready = await h.canonicalDraft(advanced.started.activationId);
      assert.equal(ready.stage, "ready-for-adoption");
      assert.equal(ready.confirmedRemoteRevision, 1);
      assert.equal(ready.keySetVersion, mode === "available" ? 3 : 2);
      assert.equal(ready.recoveryVersion, 1);
      assert.equal(ready.recoveryCopyStored, true);
      assert.equal(ready.adopted, false);
      assert.equal(ready.recoveryPackage, null);
      assert.equal(ready.recoveryRoot, null);
      assert.equal(ready.recoveryAuthorisation, null);
      assert.equal(ready.accountLocator, beforeDraft.accountLocator);
      assert.deepEqual(plain(ready.account), beforeDraft.account);
      assert.deepEqual(plain(ready.recoveryEnvelope), beforeDraft.recoveryEnvelope);
      assert.deepEqual(plain(ready.recoveryVerifier), beforeDraft.recoveryVerifier);
      assert.deepEqual(plain(ready.prfEnvelope), beforeDraft.prfEnvelope);
      assert.deepEqual(plain(found.record.remote), plain(beforeFound.record.remote));
      assert.equal(
        found.record.usage.masterKeyGeneration,
        beforeFound.record.usage.masterKeyGeneration
      );
      assert.equal(
        found.record.usage.masterKeyContentEncryptionLimit,
        beforeFound.record.usage.masterKeyContentEncryptionLimit
      );
      assert.equal(Object.prototype.hasOwnProperty.call(plain(ready), "destination"), false);
      assert.doesNotMatch(
        JSON.stringify(result),
        /recoveryPackage|recoveryRoot|recoveryAuthorisation|accountLocator|accountId|credentialId|checksum|recoveryEnvelope|recoveryVerifier|outputBytes|destination|fileHandle/
      );
    }
  }
});

test("P307 validates exact recovery-copy-pending durable truth and package binding before destination or write", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
  });
  const advanced = await advanceToRecoveryCopyPending(first, "new-account", "available");

  for (const mode of ["usage", "package"]) {
    const second = createHarness({
      shared: first.shared,
      allowRecoveryPicker: true,
      readActivationTransform(found) {
        if (found.draft?.stage !== "recovery-copy-pending") return found;
        if (mode === "usage") {
          return Object.freeze({
            record: Object.freeze(Object.assign({}, plain(found.record), {
              usage: Object.freeze(Object.assign({}, plain(found.record.usage), {
                masterKeyGeneration: 9,
              })),
            })),
            draft: found.draft,
          });
        }
        return Object.freeze({
          record: found.record,
          draft: Object.freeze(Object.assign({}, plain(found.draft), {
            recoveryPackage: Object.freeze(Object.assign(
              {},
              plain(found.draft.recoveryPackage),
              { remoteUploadAllowed: true }
            )),
          })),
        });
      },
    });

    const result = await second.runtime.continueOwnerlessFirstCreate({
      activationId: advanced.started.activationId,
    });
    assert.equal(result.ok, false, mode);
    assert.equal(result.reason, "ownerless-activation-state-invalid", mode);
    assert.equal(second.counters.orchestratorResume, 0, mode);
    assert.equal(second.counters.picker, 0, mode);
    assert.equal(second.counters.recoveryWrite, 0, mode);
    assert.equal(second.counters.adoption, 0, mode);
    assert.equal(second.counters.beginAuthentication, 0, mode);
    assert.equal(second.counters.beginRegistration, 0, mode);
    assert.equal(second.counters.discovery, 0, mode);
    assert.equal(second.counters.content, 0, mode);
    assert.equal(second.counters.envelope, 0, mode);
    assert.equal(second.counters.recovery, 0, mode);
  }
});

test("P307 destination cancellation is resumable, writes zero bytes and preserves exact pending durable state", async () => {
  const h = createHarness({
    unavailablePrf: true,
    discoveryResponses: ["not-configured", "not-configured"],
    allowRecoveryPicker: true,
    recoveryPickerCancellations: 1,
  });
  const advanced = await advanceToRecoveryCopyPending(h, "existing-unbound", "skipped");
  const before = await h.readActivation(advanced.started.activationId);
  const resumesBefore = h.counters.orchestratorResume;

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-recovery-copy-not-stored");
  assert.equal(result.resumable, true);
  assert.equal(result.recoveryCopyRequired, true);
  assert.equal(h.counters.orchestratorResume, resumesBefore + 1);
  assert.equal(h.counters.picker, 1);
  assert.equal(h.counters.recoveryWrite, 0);
  assert.equal(h.counters.adoption, 0);

  const after = await h.readActivation(advanced.started.activationId);
  assert.deepEqual(plain(after.draft), plain(before.draft));
  assert.equal(after.record.storeRevision, before.record.storeRevision);
});

test("P307 write failure retries only on a later explicit call with the same persisted package and a fresh destination", async () => {
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    allowRecoveryPicker: true,
    recoveryWriteFailures: 1,
  });
  const advanced = await advanceToRecoveryCopyPending(h, "new-account", "available");
  const persistedPackage = plain(advanced.draft.recoveryPackage);
  const before = await h.readActivation(advanced.started.activationId);
  const resumesBefore = h.counters.orchestratorResume;

  const failed = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "ownerless-recovery-copy-not-stored");
  assert.equal(failed.resumable, true);
  assert.equal(failed.recoveryCopyRequired, true);
  assert.equal(h.counters.orchestratorResume, resumesBefore + 1);
  assert.equal(h.counters.picker, 1);
  assert.equal(h.counters.recoveryWrite, 1, "zero automatic write retry");
  let after = await h.readActivation(advanced.started.activationId);
  assert.deepEqual(plain(after.draft), plain(before.draft));
  assert.equal(after.record.storeRevision, before.record.storeRevision);
  assert.deepEqual(JSON.parse(h.recoveryWritePayloads[0]), persistedPackage);

  const retryResumesBefore = h.counters.orchestratorResume;
  const retried = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.stage, "ready-for-adoption");
  assert.equal(h.counters.orchestratorResume, retryResumesBefore + 1);
  assert.equal(h.counters.picker, 2);
  assert.equal(h.counters.recoveryWrite, 2);
  assert.deepEqual(h.recoveryDestinationIds, ["p307-destination-1", "p307-destination-2"]);
  assert.deepEqual(JSON.parse(h.recoveryWritePayloads[1]), persistedPackage);
  after = await h.canonicalDraft(advanced.started.activationId);
  assert.equal(after.stage, "ready-for-adoption");
  assert.equal(h.counters.adoption, 0);
});

test("P307 ownerless target change during destination preparation performs zero write and zero durable advancement", async () => {
  let changed = false;
  const h = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    allowRecoveryPicker: true,
    onPrepareRecoveryCopyDestination({ call, setOwnerKind }) {
      if (!changed && call === 1) {
        changed = true;
        setOwnerKind("json");
      }
    },
  });
  const advanced = await advanceToRecoveryCopyPending(h, "new-account", "available");
  const before = await h.readActivation(advanced.started.activationId);

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(h.counters.picker, 1);
  assert.equal(h.counters.recoveryWrite, 0);
  assert.equal(h.counters.adoption, 0);
  const after = await h.readActivation(advanced.started.activationId);
  assert.deepEqual(plain(after.draft), plain(before.draft));
  assert.equal(after.record.storeRevision, before.record.storeRevision);
});

test("P307 ownerless target change during Recovery Copy write cannot falsely persist ready state", async () => {
  let changed = false;
  const h = createHarness({
    unavailablePrf: true,
    discoveryResponses: ["not-configured", "not-configured"],
    allowRecoveryPicker: true,
    onRecoveryWrite({ call, setOwnerKind }) {
      if (!changed && call === 1) {
        changed = true;
        setOwnerKind("vault");
      }
    },
  });
  const advanced = await advanceToRecoveryCopyPending(h, "existing-unbound", "skipped");
  const before = await h.readActivation(advanced.started.activationId);

  const result = await h.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-target-stale");
  assert.equal(h.counters.picker, 1);
  assert.equal(h.counters.recoveryWrite, 1);
  assert.equal(h.counters.adoption, 0);
  const after = await h.readActivation(advanced.started.activationId);
  assert.deepEqual(plain(after.draft), plain(before.draft));
  assert.equal(after.record.storeRevision, before.record.storeRevision);
  assert.equal(after.draft.stage, "recovery-copy-pending");
  assert.equal(after.draft.recoveryCopyStored, false);
  assert.deepEqual(plain(after.draft.recoveryPackage), plain(before.draft.recoveryPackage));
});

test("P307 exact ready-for-adoption replay performs zero orchestrator/P299 or Recovery Copy work", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    allowRecoveryPicker: true,
  });
  const advanced = await advanceToRecoveryCopyPending(first, "new-account", "available");
  const ready = await first.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(ready.stage, "ready-for-adoption");

  const second = createHarness({
    shared: first.shared,
    allowRecoveryPicker: true,
  });
  const replay = await second.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.deepEqual(plain(replay), plain(ready));
  assert.equal(second.counters.orchestratorResume, 0);
  assert.equal(second.counters.picker, 0);
  assert.equal(second.counters.recoveryWrite, 0);
  assert.equal(second.counters.adoption, 0);
  assert.equal(second.counters.beginAuthentication, 0);
  assert.equal(second.counters.finishAuthentication, 0);
  assert.equal(second.counters.beginRegistration, 0);
  assert.equal(second.counters.finishRegistration, 0);
  assert.equal(second.counters.discovery, 0);
  assert.equal(second.counters.content, 0);
  assert.equal(second.counters.envelope, 0);
  assert.equal(second.counters.recovery, 0);
});

test("P307 adopted remains unadmitted with zero mutation", async () => {
  const first = createHarness({
    discoveryResponses: ["not-configured", "not-configured"],
    allowRecoveryPicker: true,
  });
  const advanced = await advanceToRecoveryCopyPending(first, "new-account", "available");
  const ready = await first.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(ready.stage, "ready-for-adoption");

  let second;
  second = createHarness({
    shared: first.shared,
    allowRecoveryPicker: true,
    readActivationTransform(found) {
      if (found.draft?.stage !== "ready-for-adoption") return found;
      const draft = second.context.PocketSyncOwnerlessActivationDraft.buildAdopted(
        { draft: found.draft },
        {
          securityContract: second.context.PocketSyncSecurityContract,
          crypto: second.context.PocketSyncCrypto,
        }
      );
      return Object.freeze({ record: found.record, draft });
    },
  });

  const result = await second.runtime.continueOwnerlessFirstCreate({
    activationId: advanced.started.activationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ownerless-activation-stage-not-admitted");
  assert.equal(second.counters.orchestratorResume, 0);
  assert.equal(second.counters.picker, 0);
  assert.equal(second.counters.recoveryWrite, 0);
  assert.equal(second.counters.adoption, 0);
  assert.equal(second.counters.beginAuthentication, 0);
  assert.equal(second.counters.discovery, 0);
});

test("P305 uses P296 as sole recovery owner and leaves Recovery Copy, adoption and UI integration unwired", () => {
  const runtime = source("js/pocket-sync-browser-runtime.js");
  assert.match(runtime, /exactRecoveryInputState/);
  assert.match(runtime, /continueOwnerlessRecoveryInitialisation/);
  assert.match(runtime, /exactRecoveryInitialisedState/);
  assert.match(runtime, /ownerless-recovery-initialised/);

  const start = runtime.indexOf("async function continueOwnerlessRecoveryInitialisation");
  const end = runtime.indexOf("async function continueOwnerlessDeviceStaged", start);
  const section = runtime.slice(start, end);
  assert.match(section, /orchestrator\.resume/);
  assert.doesNotMatch(
    section,
    /buildRecoveryPackage|prepareRecoveryCopyDestination|writeRecoveryCopy|adoptSyncedOwner/
  );

  const activation = source("js/pocket-sync-activation.js");
  assert.equal((activation.match(/async function initialiseRecovery\s*\(/g) || []).length, 1);
  assert.match(activation, /recoveryOperationId/);
  assert.match(activation, /recoveryLogicalChangeId/);
  assert.match(activation, /expectedKeySetVersion:\s*execution\.draft\.keySetVersion/);

  assert.doesNotMatch(source("js/pocket-sync-local-integration.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-ui.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-doorway-capabilities.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("index.html"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("sw.js"), /continueOwnerlessFirstCreate/);
});



test("P307 keeps P298 as sole Recovery Copy writer, hard-stops before P299, and leaves integration unwired", () => {
  const runtime = source("js/pocket-sync-browser-runtime.js");
  assert.match(runtime, /exactRecoveryCopyPendingState/);
  assert.match(runtime, /continueOwnerlessRecoveryCopyPreparation/);
  assert.match(runtime, /continueOwnerlessRecoveryCopyWrite/);
  assert.match(runtime, /exactReadyForAdoptionState/);
  assert.match(runtime, /readyForAdoptionReplay/);

  const packageDepsStart = runtime.indexOf("function ownerlessRecoveryPackageDependencies");
  const writeDepsStart = runtime.indexOf("function ownerlessRecoveryWriteDependencies");
  const depsEnd = runtime.indexOf("function exactKeys", writeDepsStart);
  const packageDeps = runtime.slice(packageDepsStart, writeDepsStart);
  const writeDeps = runtime.slice(writeDepsStart, depsEnd);
  assert.match(packageDeps, /buildRecoveryPackage:\s*\(input\)\s*=>\s*buildRecoveryPackage/);
  assert.match(packageDeps, /prepareRecoveryCopyDestination:\s*downstreamForbidden/);
  assert.match(packageDeps, /writeRecoveryCopy:\s*downstreamForbidden/);
  assert.match(packageDeps, /adoptSyncedOwner:\s*downstreamForbidden/);
  assert.match(writeDeps, /prepareRecoveryCopyDestination:\s*recoveryPicker\(environment\)/);
  assert.match(writeDeps, /writeRecoveryCopy:\s*writeRecoveryCopy\(environment\)/);
  assert.match(writeDeps, /buildRecoveryPackage:\s*forbidden/);
  assert.match(writeDeps, /adoptSyncedOwner:\s*forbidden/);
  assert.match(writeDeps, /withExistingAccountReady:\s*forbidden/);

  const writeStart = runtime.indexOf("async function continueOwnerlessRecoveryCopyWrite");
  const writeEnd = runtime.indexOf("async function continueOwnerlessRecoveryCopyPreparation", writeStart);
  const writeSection = runtime.slice(writeStart, writeEnd);
  assert.match(writeSection, /orchestrator\.resume/);
  assert.match(writeSection, /ownerlessRecoveryWriteDependencies/);
  assert.doesNotMatch(
    writeSection,
    /buildRecoveryPackage\(|prepareRecoveryCopyDestination\(|writeRecoveryCopy\(|adoptSyncedOwner\(/
  );

  const dispatchStart = runtime.indexOf("async function continueOwnerlessFirstCreate");
  const dispatchEnd = runtime.indexOf("async function begin", dispatchStart);
  const dispatchSection = runtime.slice(dispatchStart, dispatchEnd);
  const readyIndex = dispatchSection.indexOf('draft.stage === "ready-for-adoption"');
  const pendingIndex = dispatchSection.indexOf('draft.stage === "recovery-copy-pending"');
  const initialisedIndex = dispatchSection.indexOf('draft.stage === "recovery-initialised"');
  assert.ok(readyIndex >= 0 && pendingIndex > readyIndex && initialisedIndex > pendingIndex);
  const readyReplaySection = dispatchSection.slice(readyIndex, pendingIndex);
  assert.match(readyReplaySection, /readyForAdoptionReplay/);
  assert.doesNotMatch(readyReplaySection, /orchestrator\.resume|continueOwnerlessRecoveryCopyWrite/);
  const pendingSection = dispatchSection.slice(pendingIndex, initialisedIndex);
  assert.match(pendingSection, /continueOwnerlessRecoveryCopyWrite/);

  const activation = source("js/pocket-sync-activation.js");
  assert.equal((activation.match(/async function preparePackage\s*\(/g) || []).length, 1);
  assert.equal((activation.match(/async function writePackage\s*\(/g) || []).length, 1);
  assert.equal((activation.match(/async function adopt\s*\(/g) || []).length, 1);
  assert.match(activation, /execution\.dependencies\.prepareRecoveryCopyDestination\(\)/);
  assert.match(activation, /execution\.dependencies\.writeRecoveryCopy/);
  assert.match(activation, /recoveryPackage:\s*execution\.draft\.recoveryPackage/);
  assert.match(activation, /ownerless\.buildReadyForAdoption/);

  const ownerlessStart = activation.indexOf("async function resumeOwnerless");
  const ownerlessEnd = activation.indexOf("async function resume(", ownerlessStart + 10);
  const ownerlessResume = activation.slice(ownerlessStart, ownerlessEnd);
  const pendingBranch = ownerlessResume.indexOf('execution.draft.stage === "recovery-copy-pending"');
  assert.notEqual(pendingBranch, -1);
  const p298Section = ownerlessResume.slice(pendingBranch);
  const p298Stop = p298Section.indexOf("return ownerlessReadyForAdoptionResult(execution.draft);");
  assert.notEqual(p298Stop, -1);
  assert.doesNotMatch(
    p298Section.slice(0, p298Stop),
    /adopt\(execution\)|adoptSyncedOwner/,
    "P298 same-resume write must stop before P299 adoption"
  );

  assert.doesNotMatch(source("js/pocket-sync-local-integration.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-ui.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-doorway-capabilities.js"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("index.html"), /continueOwnerlessFirstCreate/);
  assert.doesNotMatch(source("sw.js"), /continueOwnerlessFirstCreate/);
});

