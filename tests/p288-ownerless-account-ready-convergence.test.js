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
const ACCOUNT_CLIENT = "js/pocket-sync-account-client.js";
const FIRST_CREATE = "js/pocket-sync-first-create.js";
const NOW = Date.parse("2036-03-01T00:00:00.000Z");
const EXPIRES = "2036-03-01T00:05:00.000Z";

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
const PRF_OUTPUT = bytes(32, 101);
const CHALLENGE = b64(bytes(32, 41));

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
      return `${prefix}_p288_${nextNodeId}`;
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
    ACCOUNT_CLIENT,
    FIRST_CREATE,
    ACTIVATION,
  ]) vm.runInContext(source(file), context, { filename: file });
  return {
    context,
    security: context.PocketSyncSecurityContract,
    crypto: context.PocketSyncCrypto,
    ownerless: context.PocketSyncOwnerlessActivationDraft,
    deviceStoreModule: context.PocketSyncDeviceStore,
    accountClientModule: context.PocketSyncAccountClient,
    firstCreate: context.PocketSyncFirstCreate,
    activation: context.PocketSyncActivation,
  };
}

function forbiddenAccount(counters) {
  return Object.freeze({
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
}

function createHarness(options = {}) {
  const production = options.production || loadProduction();
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
  const accountClient = options.accountClient || forbiddenAccount(counters);
  const deviceStore = Object.freeze({
    FORMAT: production.deviceStoreModule.FORMAT,
    open: (...args) => rawStore.open(...args),
    readPocket: (...args) => rawStore.readPocket(...args),
    readActivation: (...args) => rawStore.readActivation(...args),
    createPocket: (...args) => rawStore.createPocket(...args),
    replacePocket: (...args) => rawStore.replacePocket(...args),
    reservePocketEncryptionUsage: (...args) => rawStore.reservePocketEncryptionUsage(...args),
  });
  const orchestrator = production.activation.createActivationOrchestrator({
    securityContract: production.security,
    crypto: production.crypto,
    deviceStore,
    accountClient,
    contentService: Object.freeze({
      async conditionalUpload() {
        counters.content += 1;
        throw new Error("forbidden content");
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
      createHarness.random = (createHarness.random || 0) + 1;
      return bytes(length, createHarness.random * 7);
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

function activateOptions(accountPath) {
  return {
    activationMode: "ownerless-first-create",
    accountPath,
    syncedPocketId: `pocket-p288-${accountPath}`,
    deviceId: `device-p288-${accountPath}`,
  };
}

function resumeOptions(activationId) {
  return {
    activationMode: "ownerless-first-create",
    activationId,
  };
}

async function stage(harness, accountPath) {
  const result = await harness.orchestrator.activate(
    harness.activateDependencies,
    activateOptions(accountPath)
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, "device-staged");
  return result;
}

function availableReady(raw = bytes(32, 31)) {
  return Object.freeze({
    accountPath: "existing-unbound",
    accountId: "account-existing-p288",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: Object.freeze({
      status: "available",
      evaluationInput: PRF_INPUT,
      outputBytes: raw,
    }),
  });
}

function unavailableReady() {
  return Object.freeze({
    accountPath: "existing-unbound",
    accountId: "account-existing-p288",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: Object.freeze({
      status: "unavailable",
      evaluationInput: PRF_INPUT,
    }),
  });
}

function registrationContinuation(input) {
  return Object.freeze({
    apiVersion: 1,
    operationId: input.operationId,
    ceremonyId: "ceremony-p288",
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
    accountId: "account-new-p288",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: Object.freeze({
      status: "unavailable",
      evaluationInput: PRF_INPUT,
    }),
  });
}

async function assertCanonicalReady(harness, activationId, accountPath, expectedPrfStatus) {
  const found = await harness.rawStore.readActivation(activationId);
  assert.notEqual(found, null);
  const draft = harness.production.ownerless.validate(found.draft, {
    securityContract: harness.production.security,
    crypto: harness.production.crypto,
  });
  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.activationMode, "ownerless-first-create");
  assert.equal(draft.accountPath, accountPath);
  assert.equal(draft.stage, "account-ready");
  assert.notEqual(draft.account, null);
  assert.equal(draft.registrationContinuation, null);
  assert.equal(draft.pendingOperation, null);
  assert.equal(draft.prfStatus, expectedPrfStatus);
  assert.equal(draft.prfEnvelope === null, expectedPrfStatus !== "available");
  assert.equal(draft.confirmedRemoteRevision, 0);
  assert.equal(draft.keySetVersion, 0);
  assert.equal(draft.recoveryVersion, 0);
  assert.equal(draft.recoveryCopyStored, false);
  assert.equal(draft.adopted, false);
  assert.equal(JSON.stringify(draft).includes("outputBytes"), false);
  return draft;
}

test("P288 preserves public surfaces and only explicit activationMode enters ownerless resume", async () => {
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.production.activation), [
    "POLICY", "createActivationOrchestrator", "createStrandedActivationClassifier",
  ]);
  assert.deepEqual(Object.keys(harness.orchestrator), ["activate", "resume"]);

  const staged = await stage(harness, "existing-unbound");
  const before = { ...harness.counters };
  const implicit = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    { activationId: staged.activationId }
  );
  assert.equal(implicit.ok, false);
  assert.equal(implicit.reason, "invalid-activation-input");
  assert.equal(harness.counters.bridge, before.bridge);

  const malformed = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    { activationMode: "other", activationId: staged.activationId }
  );
  assert.deepEqual(plain(malformed), { ok: false, reason: "invalid-ownerless-resume-input" });
  assert.equal(harness.counters.bridge, before.bridge);
  assert.equal(harness.counters.register, 0);
  assert.equal(harness.counters.finish, 0);
  assert.equal(harness.counters.authenticate, 0);
});

test("P288 existing-unbound private bridge converges available and unavailable PRF to canonical account-ready", async () => {
  for (const mode of ["available", "unavailable"]) {
    const harness = createHarness();
    const staged = await stage(harness, "existing-unbound");
    const raw = bytes(32, 31);
    let callbackInside = false;
    const ready = mode === "available" ? availableReady(raw) : unavailableReady();
    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(async (consumer) => {
        callbackInside = true;
        await consumer(ready);
        assert.equal(callbackInside, true);
        callbackInside = false;
        return { ok: true };
      }),
      resumeOptions(staged.activationId)
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.reason, "ownerless-account-ready");
    assert.equal(result.stage, "account-ready");
    assert.equal(result.accountPath, "existing-unbound");
    assert.equal(harness.counters.bridge, 1);
    assert.equal(harness.counters.register, 0);
    assert.equal(harness.counters.finish, 0);
    assert.equal(harness.counters.authenticate, 0);
    assert.equal(harness.counters.content, 0);
    assert.equal(harness.counters.envelope, 0);
    assert.equal(harness.counters.recovery, 0);
    const draft = await assertCanonicalReady(
      harness,
      staged.activationId,
      "existing-unbound",
      mode === "available" ? "available" : "skipped"
    );
    assert.equal(draft.account.prfEvaluationInput, PRF_INPUT);
    assert.equal(JSON.stringify(result).includes("account-existing"), false);
    assert.equal(JSON.stringify(result).includes(PRF_INPUT), false);
  }
});

test("P288 existing-unbound refuses missing, duplicate or malformed private ready without durable advance", async () => {
  for (const bridge of [
    async () => ({ ok: true }),
    async (consumer) => {
      await consumer(availableReady(bytes(32, 41)));
      await consumer(availableReady(bytes(32, 51)));
    },
    async (consumer) => consumer(Object.freeze({
      ...availableReady(bytes(32, 61)),
      accountPath: "new-account",
    })),
  ]) {
    const harness = createHarness();
    const staged = await stage(harness, "existing-unbound");
    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(bridge),
      resumeOptions(staged.activationId)
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ownerless-account-ready-failed");
    const found = await harness.rawStore.readActivation(staged.activationId);
    assert.equal(found.draft.stage, "device-staged");
    assert.equal(found.draft.account, null);
    assert.equal(harness.counters.register, 0);
    assert.equal(harness.counters.finish, 0);
    assert.equal(harness.counters.authenticate, 0);
  }
});

test("P288 new-account uses exact create-new-account intent and persists continuation before finish", async () => {
  for (const mode of ["available", "unavailable"]) {
    let harness;
    let staged;
    let observedPending = null;
    let rawReference = null;
    const counters = { register: 0, finish: 0, authenticate: 0 };
    const accountClient = Object.freeze({
      async authenticatePasskey() {
        counters.authenticate += 1;
        throw new Error("forbidden authenticate");
      },
      async finishRegistration() {
        counters.finish += 1;
        throw new Error("unexpected separate finish");
      },
      async registerPasskey(input, onCredentialReady) {
        counters.register += 1;
        assert.deepEqual(plain(input), {
          apiVersion: 1,
          operationId: input.operationId,
          accountIntent: "create-new-account",
          deviceId: staged.deviceId,
        });
        const continuation = registrationContinuation(input);
        const raw = bytes(32, 71);
        rawReference = raw;
        await onCredentialReady(Object.freeze({
          continuation,
          prf: mode === "available"
            ? Object.freeze({ status: "available", evaluationInput: PRF_INPUT, outputBytes: raw })
            : Object.freeze({ status: "unavailable", evaluationInput: PRF_INPUT }),
        }));
        const found = await harness.rawStore.readActivation(staged.activationId);
        observedPending = found.draft;
        assert.equal(observedPending.stage, "device-staged");
        assert.equal(observedPending.pendingOperation, "account-registration-finish");
        assert.notEqual(observedPending.registrationContinuation, null);
        assert.equal(JSON.stringify(observedPending).includes("outputBytes"), false);
        return registrationResult();
      },
    });
    harness = createHarness({ accountClient });
    staged = await stage(harness, "new-account");
    const result = await harness.orchestrator.resume(
      harness.resumeDependencies(),
      resumeOptions(staged.activationId)
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.reason, "ownerless-account-ready");
    assert.equal(result.accountPath, "new-account");
    assert.equal(harness.counters.bridge, 0);
    assert.equal(counters.register, 1);
    assert.equal(counters.finish, 0);
    assert.equal(counters.authenticate, 0);
    assert.notEqual(observedPending, null);
    if (mode === "available") {
      assert.deepEqual(Array.from(rawReference), new Array(32).fill(0));
    }
    await assertCanonicalReady(
      harness,
      staged.activationId,
      "new-account",
      mode === "available" ? "available" : "skipped"
    );
    assert.equal(harness.counters.content, 0);
    assert.equal(harness.counters.envelope, 0);
    assert.equal(harness.counters.recovery, 0);
  }
});

test("P288 interrupted new-account resume finishes durable continuation without creating another credential", async () => {
  let harness;
  let staged;
  let registerCalls = 0;
  let finishCalls = 0;
  let rawReference = null;
  const accountClient = Object.freeze({
    async authenticatePasskey() { throw new Error("forbidden authenticate"); },
    async registerPasskey(input, onCredentialReady) {
      registerCalls += 1;
      const continuation = registrationContinuation(input);
      rawReference = bytes(32, 81);
      await onCredentialReady(Object.freeze({
        continuation,
        prf: Object.freeze({
          status: "available",
          evaluationInput: PRF_INPUT,
          outputBytes: rawReference,
        }),
      }));
      throw new Error("synthetic interruption after durable callback");
    },
    async finishRegistration(continuation) {
      finishCalls += 1;
      assert.equal(continuation.operationId, staged ? (await harness.rawStore.readActivation(staged.activationId)).draft.ids.registrationOperationId : continuation.operationId);
      return registrationResult();
    },
  });
  harness = createHarness({ accountClient });
  staged = await stage(harness, "new-account");

  const first = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(first.ok, false);
  assert.equal(first.reason, "ownerless-account-ready-failed");
  assert.equal(registerCalls, 1);
  assert.equal(finishCalls, 0);
  assert.deepEqual(Array.from(rawReference), new Array(32).fill(0));

  const pending = await harness.rawStore.readActivation(staged.activationId);
  assert.equal(pending.draft.stage, "device-staged");
  assert.equal(pending.draft.pendingOperation, "account-registration-finish");
  assert.notEqual(pending.draft.registrationContinuation, null);
  assert.equal(pending.draft.prfStatus, "available");

  const second = await harness.orchestrator.resume(
    harness.resumeDependencies(),
    resumeOptions(staged.activationId)
  );
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.stage, "account-ready");
  assert.equal(registerCalls, 1);
  assert.equal(finishCalls, 1);
  await assertCanonicalReady(harness, staged.activationId, "new-account", "available");
});

test("P288 semantic target guard tolerates transient none identity and fails closed on ownership change", async () => {
  const transient = createHarness({
    target(count) { return { ownerKind: "none", continuityId: `ephemeral-${count}` }; },
  });
  const staged = await stage(transient, "existing-unbound");
  const result = await transient.orchestrator.resume(
    transient.resumeDependencies(async (consumer) => consumer(availableReady(bytes(32, 91)))),
    resumeOptions(staged.activationId)
  );
  assert.equal(result.ok, true);

  let bridgeCalls = 0;
  let stalePhase = false;
  const stale = createHarness({
    target(count) {
      return stalePhase
        ? { ownerKind: "json", continuityId: "json-owner" }
        : { ownerKind: "none", continuityId: `none-${count}` };
    },
  });
  const staleStage = await stage(stale, "existing-unbound");
  stalePhase = true;
  const staleResult = await stale.orchestrator.resume(
    stale.resumeDependencies(async (consumer) => {
      bridgeCalls += 1;
      return consumer(availableReady(bytes(32, 101)));
    }),
    resumeOptions(staleStage.activationId)
  );
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.reason, "ownerless-target-stale");
  assert.equal(bridgeCalls, 0);
});

test("P288 real P278 account client plus P280 conductor keeps raw existing-account PRF inside private lifetime and zeroes it", async () => {
  const production = loadProduction();
  const accountService = Object.freeze({
    async beginRegistration() { throw new Error("registration unreachable"); },
    async finishRegistration() { throw new Error("registration unreachable"); },
    async beginAuthentication(input) {
      return {
        apiVersion: 1,
        ok: true,
        operationId: input.operationId,
        ceremonyId: "auth-ceremony-p288",
        expiresAt: EXPIRES,
        prfEvaluationInput: PRF_INPUT,
        publicKeyRequestOptions: {
          challenge: CHALLENGE,
          timeout: 120000,
          rpId: "pocket.example",
          allowCredentials: [{ type: "public-key", id: CREDENTIAL_ID, transports: ["internal"] }],
          userVerification: "required",
          extensions: { prf: { eval: { first: PRF_INPUT } } },
        },
      };
    },
    async finishAuthentication(input) {
      return {
        apiVersion: 1,
        ok: true,
        operationId: input.operationId,
        ceremonyId: input.ceremonyId,
        accountId: "account-real-p288",
        credentialId: CREDENTIAL_ID,
        credentialVersion: 1,
        accountPolicyVersion: 1,
        prfEvaluationInput: PRF_INPUT,
      };
    },
  });
  const credential = {
    getClientExtensionResults() {
      return { prf: { results: { first: PRF_OUTPUT.buffer.slice(0) } } };
    },
    toJSON() {
      return {
        id: CREDENTIAL_ID,
        rawId: CREDENTIAL_ID,
        response: {
          clientDataJSON: b64(bytes(17, 12)),
          authenticatorData: b64(bytes(19, 14)),
          signature: b64(bytes(64, 16)),
          userHandle: null,
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: {
          prf: { results: { first: b64(PRF_OUTPUT) } },
        },
        type: "public-key",
      };
    },
  };
  const realAccountClient = production.accountClientModule.createClient({
    accountService,
    webAuthn: Object.freeze({
      async createCredential() { throw new Error("registration unreachable"); },
      async getCredential() { return credential; },
    }),
    now: () => NOW,
  });
  let operation = 0;
  const conductor = production.firstCreate.createConductor({
    accountClient: realAccountClient,
    discoveryService: Object.freeze({
      async readSyncedPocket(input) {
        return {
          apiVersion: 1,
          ok: true,
          operationId: input.operationId,
          status: "not-configured",
          syncedPocketId: null,
        };
      },
    }),
    createOperationId() {
      operation += 1;
      return `p288-operation-${operation}`;
    },
  });

  const harness = createHarness({ production, accountClient: realAccountClient });
  const staged = await stage(harness, "existing-unbound");
  let rawReference = null;
  const result = await harness.orchestrator.resume(
    harness.resumeDependencies((consumer) => conductor.prepareExistingAccount(async (ready) => {
      rawReference = ready.prf.outputBytes;
      assert.deepEqual(Array.from(rawReference), Array.from(PRF_OUTPUT));
      await consumer(ready);
      assert.deepEqual(Array.from(rawReference), Array.from(PRF_OUTPUT));
    })),
    resumeOptions(staged.activationId)
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(Array.from(rawReference), new Array(32).fill(0));
  await assertCanonicalReady(harness, staged.activationId, "existing-unbound", "available");
});

test("P288 account-ready convergence performs zero downstream remote, recovery, copy or adoption work while P301 owns runtime entry", () => {
  const activation = source(ACTIVATION);
  assert.doesNotMatch(activation, /readSyncedPocket|PocketSyncFirstCreate/);
  const index = source("index.html");
  assert.equal((index.match(/pocket-sync-ownerless-activation-draft\.js/g) || []).length, 1);
  assert.equal((index.match(/pocket-sync-first-create\.js/g) || []).length, 1);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-ownerless-activation-draft\.js|pocket-sync-first-create\.js/);
  assert.match(source("js/pocket-sync-browser-runtime.js"), /startOwnerlessFirstCreate/);
  assert.doesNotMatch(source("js/pocket-sync-browser-runtime.js"),
    /function\s+(?:activateOwnerless|resumeOwnerless|findOwnerlessActivation)\s*\(/);
  assert.doesNotMatch(activation, /function\s+(?:resumeV2|accountReady)\s*\(/);
});
