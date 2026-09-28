"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const MODULE_PATH = "js/pocket-sync-first-create.js";
const ACCOUNT_PATH = "js/pocket-sync-account-client.js";

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadFirstCreate(extra = {}) {
  const context = Object.assign({
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Error,
    Promise,
    Uint8Array,
  }, extra);
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(MODULE_PATH), context, { filename: MODULE_PATH });
  return { api: context.PocketSyncFirstCreate, context };
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function rawBytes(start = 1) {
  return Uint8Array.from({ length: 32 }, (_unused, index) => (start + index) & 255);
}

function accountBound(overrides = {}) {
  const raw = Object.prototype.hasOwnProperty.call(overrides, "raw")
    ? overrides.raw
    : rawBytes(21);
  const prf = overrides.prf || (raw === null
    ? Object.freeze({ status: "unavailable", evaluationInput: "prf-input-safe" })
    : Object.freeze({ status: "available", evaluationInput: "prf-input-safe", outputBytes: raw }));
  return Object.freeze({
    ok: true,
    accountAuthenticated: true,
    contentUnlocked: false,
    accountId: "account-a",
    credentialId: "credential-a",
    credentialVersion: 1,
    accountPolicyVersion: 1,
    bootstrap: false,
    prf,
    ...overrides,
  });
}

function bootstrap(overrides = {}) {
  return Object.freeze({
    ok: true,
    accountAuthenticated: true,
    contentUnlocked: false,
    accountId: "account-a",
    credentialId: "credential-bootstrap",
    credentialVersion: 1,
    accountPolicyVersion: 1,
    bootstrap: true,
    prf: Object.freeze({ status: "not-requested", evaluationInput: null }),
    ...overrides,
  });
}

function p278LikeClient(sequence, hooks = {}) {
  const queue = sequence.slice();
  const calls = [];
  let registerCalls = 0;
  return {
    calls,
    get registerCalls() { return registerCalls; },
    async registerPasskey() {
      registerCalls += 1;
      throw new Error("registration must remain unreachable");
    },
    async authenticatePasskey(input, consumer) {
      calls.push({ input: plain(input), hasConsumer: typeof consumer === "function" });
      const step = queue.shift();
      if (!step) throw new Error("unexpected authentication");
      if (step.error) throw step.error;
      const authenticated = step.result;
      hooks.beforeConsumer?.(authenticated, calls.length);
      try {
        if (typeof consumer === "function") {
          hooks.consumerEntered?.(authenticated, calls.length);
          await consumer(authenticated);
          hooks.consumerExited?.(authenticated, calls.length);
        }
        if (authenticated.prf?.outputBytes) {
          return Object.freeze({
            ...authenticated,
            prf: Object.freeze({
              status: "handled",
              evaluationInput: authenticated.prf.evaluationInput,
            }),
          });
        }
        return authenticated;
      } finally {
        if (authenticated.prf?.outputBytes instanceof Uint8Array) {
          authenticated.prf.outputBytes.fill(0);
        }
        hooks.afterFinally?.(authenticated, calls.length);
      }
    },
  };
}

function operationOwner() {
  let count = 0;
  const values = [];
  return {
    values,
    next() {
      count += 1;
      const value = `operation-${count}`;
      values.push(value);
      return value;
    },
  };
}

function discovery(status, hooks = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async readSyncedPocket(input) {
      calls += 1;
      hooks.onRead?.(input, calls);
      return {
        apiVersion: 1,
        ok: true,
        operationId: input.operationId,
        status,
        syncedPocketId: status === "ready" ? "pocket-existing" : null,
      };
    },
  };
}

test("P280 validates its tiny dependency surface and private consumer before any ceremony", async () => {
  const { api } = loadFirstCreate();
  assert.deepEqual(Object.keys(api), ["createConductor"]);

  assert.throws(
    () => api.createConductor({}),
    (error) => error.code === "first-create-input-invalid"
  );
  assert.throws(
    () => api.createConductor({
      accountClient: { authenticatePasskey() {} },
      discoveryService: { readSyncedPocket() {} },
      createOperationId() { return "operation"; },
      extraOwner: true,
    }),
    (error) => error.code === "first-create-input-invalid"
  );

  let authenticationCalls = 0;
  let operationCalls = 0;
  const conductor = api.createConductor({
    accountClient: {
      async authenticatePasskey() {
        authenticationCalls += 1;
        throw new Error("must not run");
      },
    },
    discoveryService: { async readSyncedPocket() { throw new Error("must not run"); } },
    createOperationId() {
      operationCalls += 1;
      return "operation";
    },
  });

  await assert.rejects(
    conductor.prepareExistingAccount(),
    (error) => error.code === "first-create-input-invalid"
  );
  assert.equal(authenticationCalls, 0);
  assert.equal(operationCalls, 0);
});

test("P280 account-bound unconfigured preflight uses one private authentication lifetime and returns no raw PRF", async () => {
  const { api } = loadFirstCreate();
  const raw = rawBytes(31);
  let insideAuthenticationConsumer = false;
  const accountClient = p278LikeClient(
    [{ result: accountBound({ raw }) }],
    {
      consumerEntered() { insideAuthenticationConsumer = true; },
      consumerExited() { insideAuthenticationConsumer = false; },
    }
  );
  const discoveryService = discovery("not-configured", {
    onRead() { assert.equal(insideAuthenticationConsumer, true); },
  });
  const ids = operationOwner();
  const conductor = api.createConductor({
    accountClient,
    discoveryService,
    createOperationId: () => ids.next(),
  });

  let readyCalls = 0;
  let privateRaw = null;
  const result = await conductor.prepareExistingAccount(async (ready) => {
    readyCalls += 1;
    assert.equal(insideAuthenticationConsumer, true);
    assert.equal(ready.accountPath, "existing-unbound");
    assert.equal(ready.accountId, "account-a");
    assert.equal(ready.credentialId, "credential-a");
    assert.equal(ready.credentialVersion, 1);
    assert.equal(ready.accountPolicyVersion, 1);
    assert.equal(ready.prf.status, "available");
    privateRaw = ready.prf.outputBytes;
    assert.deepEqual(Array.from(privateRaw), Array.from(rawBytes(31)));
  });

  assert.equal(accountClient.calls.length, 1);
  assert.equal(accountClient.calls[0].hasConsumer, true);
  assert.deepEqual(accountClient.calls[0].input, { apiVersion: 1, operationId: "operation-1" });
  assert.equal(discoveryService.calls, 1);
  assert.equal(readyCalls, 1);
  assert.equal(accountClient.registerCalls, 0);
  assert.deepEqual(ids.values, ["operation-1", "operation-2"]);
  assert.deepEqual(plain(result), {
    ok: true,
    status: "account-ready",
    accountPath: "existing-unbound",
    accountId: "account-a",
    credentialId: "credential-a",
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prf: { status: "available", evaluationInput: "prf-input-safe" },
  });
  assert.equal(JSON.stringify(result).includes("outputBytes"), false);
  assert.deepEqual(Array.from(privateRaw), new Array(32).fill(0));
});

test("P280 bootstrap is followed by one account-bound authentication and only the latter becomes account-ready", async () => {
  const { api } = loadFirstCreate();
  const raw = rawBytes(41);
  const accountClient = p278LikeClient([
    { result: bootstrap({ accountId: "account-same" }) },
    { result: accountBound({ accountId: "account-same", raw }) },
  ]);
  const discoveryService = discovery("not-configured");
  const ids = operationOwner();
  const conductor = api.createConductor({
    accountClient,
    discoveryService,
    createOperationId: () => ids.next(),
  });

  let readyCalls = 0;
  const result = await conductor.prepareExistingAccount(async (ready) => {
    readyCalls += 1;
    assert.equal(ready.accountId, "account-same");
    assert.equal(ready.prf.status, "available");
    assert.deepEqual(Array.from(ready.prf.outputBytes), Array.from(rawBytes(41)));
  });

  assert.equal(result.status, "account-ready");
  assert.equal(accountClient.calls.length, 2);
  assert.equal(accountClient.calls.every((call) => call.hasConsumer), true);
  assert.deepEqual(accountClient.calls.map((call) => call.input), [
    { apiVersion: 1, operationId: "operation-1" },
    { apiVersion: 1, operationId: "operation-2" },
  ]);
  assert.equal(discoveryService.calls, 1);
  assert.equal(readyCalls, 1);
  assert.equal(accountClient.registerCalls, 0);
  assert.deepEqual(ids.values, ["operation-1", "operation-2", "operation-3"]);
  assert.deepEqual(Array.from(raw), new Array(32).fill(0));
});

test("P280 bootstrap/account mismatch fails closed before discovery or account-ready", async () => {
  const { api } = loadFirstCreate();
  const raw = rawBytes(51);
  const accountClient = p278LikeClient([
    { result: bootstrap({ accountId: "account-a" }) },
    { result: accountBound({ accountId: "account-b", raw }) },
  ]);
  const discoveryService = discovery("not-configured");
  const ids = operationOwner();
  const conductor = api.createConductor({
    accountClient,
    discoveryService,
    createOperationId: () => ids.next(),
  });
  let readyCalls = 0;

  const result = await conductor.prepareExistingAccount(async () => {
    readyCalls += 1;
  });

  assert.deepEqual(plain(result), { ok: false, reason: "first-create-account-mismatch" });
  assert.equal(accountClient.calls.length, 2);
  assert.equal(discoveryService.calls, 0);
  assert.equal(readyCalls, 0);
  assert.equal(accountClient.registerCalls, 0);
  assert.deepEqual(Array.from(raw), new Array(32).fill(0));
});

test("P280 discovery ready means the existing Pocket wins without account-ready or content work", async () => {
  const { api } = loadFirstCreate();
  const raw = rawBytes(61);
  const accountClient = p278LikeClient([{ result: accountBound({ raw }) }]);
  const discoveryService = discovery("ready");
  const ids = operationOwner();
  const conductor = api.createConductor({
    accountClient,
    discoveryService,
    createOperationId: () => ids.next(),
  });
  let readyCalls = 0;

  const result = await conductor.prepareExistingAccount(async () => {
    readyCalls += 1;
  });

  assert.deepEqual(plain(result), {
    ok: true,
    status: "existing-pocket",
    syncedPocketId: "pocket-existing",
  });
  assert.equal(readyCalls, 0);
  assert.equal(discoveryService.calls, 1);
  assert.equal(accountClient.calls.length, 1);
  assert.equal(accountClient.registerCalls, 0);
  assert.deepEqual(Array.from(raw), new Array(32).fill(0));
});

test("P280 authentication failures never discover, register or infer another path", async () => {
  const { api } = loadFirstCreate();
  for (const error of [
    Object.assign(new Error("browser private NotAllowed detail"), { name: "NotAllowedError" }),
    Object.assign(new Error("service private failure"), { code: "account-service-failed" }),
  ]) {
    const accountClient = p278LikeClient([{ error }]);
    const discoveryService = discovery("not-configured");
    const ids = operationOwner();
    const conductor = api.createConductor({
      accountClient,
      discoveryService,
      createOperationId: () => ids.next(),
    });
    let readyCalls = 0;
    const result = await conductor.prepareExistingAccount(async () => { readyCalls += 1; });
    assert.deepEqual(plain(result), { ok: false, reason: "first-create-authentication-failed" });
    assert.equal(discoveryService.calls, 0);
    assert.equal(readyCalls, 0);
    assert.equal(accountClient.registerCalls, 0);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});

test("P280 unavailable PRF still yields safe existing-unbound account-ready metadata", async () => {
  const { api } = loadFirstCreate();
  const accountClient = p278LikeClient([{
    result: accountBound({ raw: null, prf: Object.freeze({
      status: "unavailable",
      evaluationInput: "prf-input-safe",
    }) }),
  }]);
  const discoveryService = discovery("not-configured");
  const ids = operationOwner();
  const conductor = api.createConductor({
    accountClient,
    discoveryService,
    createOperationId: () => ids.next(),
  });

  let readyCalls = 0;
  const result = await conductor.prepareExistingAccount(async (ready) => {
    readyCalls += 1;
    assert.equal(ready.prf.status, "unavailable");
    assert.equal(ready.prf.evaluationInput, "prf-input-safe");
    assert.equal(Object.prototype.hasOwnProperty.call(ready.prf, "outputBytes"), false);
  });

  assert.equal(readyCalls, 1);
  assert.equal(result.status, "account-ready");
  assert.deepEqual(plain(result.prf), {
    status: "unavailable",
    evaluationInput: "prf-input-safe",
  });
  assert.equal(accountClient.registerCalls, 0);
});

test("P280 private account-ready rejection is bounded, zeroes PRF through authentication ownership and does not retry", async () => {
  const { api } = loadFirstCreate();
  const raw = rawBytes(71);
  const accountClient = p278LikeClient([{ result: accountBound({ raw }) }]);
  const discoveryService = discovery("not-configured");
  const ids = operationOwner();
  const conductor = api.createConductor({
    accountClient,
    discoveryService,
    createOperationId: () => ids.next(),
  });
  let privateRaw = null;

  const result = await conductor.prepareExistingAccount(async (ready) => {
    privateRaw = ready.prf.outputBytes;
    throw new Error("private consumer detail");
  });

  assert.deepEqual(plain(result), { ok: false, reason: "first-create-account-ready-failed" });
  assert.equal(accountClient.calls.length, 1);
  assert.equal(discoveryService.calls, 1);
  assert.equal(accountClient.registerCalls, 0);
  assert.deepEqual(Array.from(privateRaw), new Array(32).fill(0));
  assert.equal(JSON.stringify(result).includes("private consumer detail"), false);
});

function bytes(length, start = 1) {
  return Uint8Array.from({ length }, (_unused, index) => (start + index) & 255);
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

test("P280 integrates with the accepted P278 consumer so real raw authentication PRF is zero after preflight settles", async () => {
  const NOW = Date.parse("2030-01-01T00:00:00.000Z");
  const EXPIRES = "2030-01-01T00:05:00.000Z";
  const CHALLENGE = b64(bytes(32, 41));
  const PRF_INPUT = b64(bytes(32, 9));
  const PRF_OUTPUT = bytes(32, 101);
  const CREDENTIAL_ID = b64(bytes(32, 121));

  const context = {
    Object, Array, Number, String, Boolean, JSON, Date, Error, Promise,
    ArrayBuffer, Uint8Array,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(ACCOUNT_PATH), context, { filename: ACCOUNT_PATH });
  vm.runInContext(source(MODULE_PATH), context, { filename: MODULE_PATH });

  const accountService = {
    async beginRegistration() { throw new Error("registration unreachable"); },
    async finishRegistration() { throw new Error("registration unreachable"); },
    async beginAuthentication(input) {
      return {
        apiVersion: 1,
        ok: true,
        operationId: input.operationId,
        ceremonyId: "authentication-ceremony",
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
        accountId: "account-real-p278",
        credentialId: CREDENTIAL_ID,
        credentialVersion: 1,
        accountPolicyVersion: 1,
        prfEvaluationInput: PRF_INPUT,
      };
    },
  };

  const nativeCredential = {
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

  const accountClient = context.PocketSyncAccountClient.createClient({
    accountService,
    webAuthn: {
      async createCredential() { throw new Error("registration unreachable"); },
      async getCredential() { return nativeCredential; },
    },
    now: () => NOW,
  });

  const operations = ["actual-auth", "actual-discovery"];
  const conductor = context.PocketSyncFirstCreate.createConductor({
    accountClient,
    discoveryService: {
      async readSyncedPocket(input) {
        return {
          apiVersion: 1,
          ok: true,
          operationId: input.operationId,
          status: "not-configured",
          syncedPocketId: null,
        };
      },
    },
    createOperationId() {
      const value = operations.shift();
      if (!value) throw new Error("unexpected operation id request");
      return value;
    },
  });

  let privateRaw = null;
  const result = await conductor.prepareExistingAccount(async (ready) => {
    assert.equal(ready.accountPath, "existing-unbound");
    assert.equal(ready.accountId, "account-real-p278");
    assert.equal(ready.prf.status, "available");
    privateRaw = ready.prf.outputBytes;
    assert.deepEqual(Array.from(privateRaw), Array.from(PRF_OUTPUT));
  });

  assert.equal(result.status, "account-ready");
  assert.equal(Object.prototype.hasOwnProperty.call(result.prf, "outputBytes"), false);
  assert.deepEqual(Array.from(privateRaw), new Array(32).fill(0));
  assert.deepEqual(operations, []);
});

test("P280 stays dormant below UI and contains no registration, content, recovery, Save or adoption owner", () => {
  const firstCreate = source(MODULE_PATH);
  assert.doesNotMatch(firstCreate, /registerPasskey/);
  assert.doesNotMatch(firstCreate, /create-new-account/);
  assert.doesNotMatch(firstCreate, /conditionalUpload|downloadContent|readRevision|addEnvelope|revokeEnvelope|initialiseRecovery|RecoveryCopy|adopt|saveCurrentContext/);

  const index = source("index.html");
  const sw = source("sw.js");
  const syncUi = source("js/pocket-sync-ui.js");
  const doorway = source("js/pocket-doorway-capabilities.js");
  const additional = source("js/pocket-sync-additional-device.js");
  const activation = source("js/pocket-sync-activation.js");

  assert.doesNotMatch(index, /pocket-sync-first-create\.js/);
  assert.doesNotMatch(sw, /pocket-sync-first-create\.js/);
  assert.doesNotMatch(syncUi, /PocketSyncFirstCreate/);
  assert.doesNotMatch(doorway, /PocketSyncFirstCreate/);
  assert.doesNotMatch(additional, /PocketSyncFirstCreate/);
  assert.doesNotMatch(activation, /PocketSyncFirstCreate/);
  assert.match(activation, /accountIntent:\s*"create-or-add-credential"/);
});
