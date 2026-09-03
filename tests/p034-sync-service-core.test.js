"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const serviceModule = require("../sync-service/pocket-sync-service-core.js");
const {
  createMemoryServiceStore,
  FAILURE_POINTS,
} = require("./helpers/p034-memory-service-store.js");

const ROOT = path.resolve(__dirname, "..");
const MODULE_PATH = "sync-service/pocket-sync-service-core.js";
const NOW = Date.parse("2032-01-01T00:00:00.000Z");
const ORIGIN = "https://sync.pocket.example";
const RP_ID = "sync.pocket.example";
const CREDENTIAL_ALGORITHMS = Object.freeze([-7]);

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function bytes(length, start = 1) {
  return Uint8Array.from({ length }, (_value, index) => (start + index) & 255);
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function deterministicRandom() {
  let call = 0;
  return function randomBytes(length) {
    call += 1;
    return bytes(length, call * 23);
  };
}

function credentialId(seed = 121) {
  return b64(bytes(32, seed));
}

function registrationCredential(id = credentialId()) {
  return {
    id,
    rawId: id,
    response: {
      clientDataJSON: b64(bytes(17, 2)),
      attestationObject: b64(bytes(24, 4)),
      authenticatorData: b64(bytes(19, 6)),
      transports: ["internal"],
      publicKey: b64(bytes(23, 8)),
      publicKeyAlgorithm: -7,
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: { prf: { enabled: true } },
    type: "public-key",
  };
}

function authenticationCredential(id = credentialId()) {
  return {
    id,
    rawId: id,
    response: {
      clientDataJSON: b64(bytes(17, 12)),
      authenticatorData: b64(bytes(19, 14)),
      signature: b64(bytes(64, 16)),
      userHandle: null,
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    type: "public-key",
  };
}

function encryptedRecord(seed = 31) {
  return {
    format: "pocket.sync.content.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    nonce: b64(bytes(12, seed)),
    ciphertext: b64(bytes(32, seed + 30)),
  };
}

function context(sessionId = null, overrides = {}) {
  return Object.assign({
    method: "POST",
    origin: ORIGIN,
    fetchSite: "same-origin",
    contentType: "application/json",
    sessionId,
  }, overrides);
}

function call(body, sessionId = null, contextOverrides = {}) {
  return { context: context(sessionId, contextOverrides), body };
}

function beginRegistrationBody(operationId = "register-operation", overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    operationId,
    accountIntent: "create-or-add-credential",
    deviceId: "device-opaque",
  }, overrides);
}

function beginAuthenticationBody(operationId = "authenticate-operation", overrides = {}) {
  return Object.assign({ apiVersion: 1, operationId }, overrides);
}

function uploadBody(operationId = "upload-operation", overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    syncedPocketId: "pocket-opaque",
    expectedRevision: 0,
    operationId,
    logicalChangeId: `${operationId}-change`,
    attemptKind: "new-change",
    encryptedRecord: encryptedRecord(),
  }, overrides);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function objectHeadStore() {
  return Object.freeze({
    async putObject() { return { ok: true, created: true }; }, async getObject() { return null; },
    async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: false })); },
    async initialiseHead() { return { schema: "pocket.starling.head.v1", revision: 0, sealRef: null }; },
    async readHead() { return null; }, async compareAndSetHead() { return { ok: false, reason: "head-conflict" }; },
  });
}

function errorCode(code) {
  return (error) => error && error.code === code;
}

function loadBrowserContracts() {
  const contextValue = {
    Object,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Error,
    Promise,
    Set,
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  };
  contextValue.window = contextValue;
  contextValue.globalThis = contextValue;
  vm.createContext(contextValue);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-account-client.js",
    "js/pocket-sync-remote-client.js",
  ]) {
    vm.runInContext(source(file), contextValue, { filename: file });
  }
  return {
    account: contextValue.PocketSyncAccountClient,
    remote: contextValue.PocketSyncRemoteClient,
  };
}

function createHarness(options = {}) {
  const driver = options.driver || createMemoryServiceStore();
  let currentTime = options.now ?? NOW;
  const verifierCalls = { registration: 0, authentication: 0 };
  let recoveryProofCalls = 0;
  const verifier = Object.freeze({
    async verifyRegistration(input) {
      verifierCalls.registration += 1;
      if (options.verifyRegistration) return options.verifyRegistration(input);
      return {
        credentialId: input.credential.id,
        publicKey: b64(bytes(64, 81)),
        publicKeyAlgorithm: -7,
        signCount: options.registrationSignCount ?? 0,
        transports: ["internal"],
        backupEligible: true,
        backedUp: false,
      };
    },
    async verifyAuthentication(input) {
      verifierCalls.authentication += 1;
      if (options.verifyAuthentication) return options.verifyAuthentication(input);
      const signCount = options.authenticationSignCount === undefined
        ? (input.storedCredential.signCount === 0 ? 1 : input.storedCredential.signCount + 1)
        : options.authenticationSignCount;
      return {
        credentialId: input.credential.id,
        signCount,
        backedUp: true,
      };
    },
  });
  const config = {
    store: driver.store,
    objectHeadStore: objectHeadStore(),
    webAuthnVerifier: verifier,
    recoveryProofVerifier: Object.freeze({
      async verifyRecoveryProof() {
        recoveryProofCalls += 1;
        return { verified: true };
      },
    }),
    randomBytes: options.randomBytes || deterministicRandom(),
    now: () => currentTime,
    trustedOrigin: ORIGIN,
    rpId: RP_ID,
    rpName: "Pocket",
    credentialAlgorithms: CREDENTIAL_ALGORITHMS,
    ceremonyLifetimeMs: 5 * 60 * 1000,
    sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
  };
  const core = serviceModule.createServiceCore(Object.assign(config, options.config || {}));
  return {
    core,
    driver,
    verifierCalls,
    get recoveryProofCalls() { return recoveryProofCalls; },
    config,
    setTime(value) { currentTime = value; },
  };
}

async function register(harness, options = {}) {
  const operationId = options.operationId || "register-operation";
  const id = options.credentialId || credentialId();
  const sessionId = options.sessionId || null;
  const begin = await harness.core.beginRegistration(call(
    beginRegistrationBody(operationId, { deviceId: options.deviceId || "device-opaque" }),
    sessionId
  ));
  const finish = await harness.core.finishRegistration(call({
    apiVersion: 1,
    operationId,
    ceremonyId: begin.body.ceremonyId,
    deviceId: options.deviceId || "device-opaque",
    credential: registrationCredential(id),
  }, sessionId));
  return {
    begin,
    finish,
    accountId: finish.body.accountId,
    credentialId: id,
    sessionId: finish.session.sessionId,
  };
}

async function authenticate(harness, registration, options = {}) {
  const operationId = options.operationId || "authenticate-operation";
  const sessionId = options.sessionId === undefined ? registration.sessionId : options.sessionId;
  const beginBody = beginAuthenticationBody(operationId);
  if (sessionId === null) beginBody.accountLocator = registration.accountId;
  const begin = await harness.core.beginAuthentication(call(beginBody, sessionId));
  const finish = await harness.core.finishAuthentication(call({
    apiVersion: 1,
    operationId,
    ceremonyId: begin.body.ceremonyId,
    credential: authenticationCredential(options.credentialId || registration.credentialId),
  }, sessionId));
  return { begin, finish, sessionId: finish.session.sessionId };
}

test("P034 service module is dormant, server-side only, and exports one frozen safety core", () => {
  assert.deepEqual(Object.keys(serviceModule), ["POLICY", "COLLECTIONS", "createServiceCore"]);
  assert.equal(Object.isFrozen(serviceModule), true);
  assert.equal(Object.isFrozen(serviceModule.POLICY), true);
  assert.equal(Object.isFrozen(serviceModule.COLLECTIONS), true);
  assert.deepEqual(Object.values(serviceModule.COLLECTIONS), [
    "accounts",
    "credentials",
    "sessions",
    "ceremonies",
    "pockets",
    "operations",
    "keySets",
    "envelopes",
    "recoveryLocators",
    "recoveryCeremonies",
    "keyOperations",
    "persistenceAuthorities",
  ]);
  assert.doesNotMatch(source("index.html"), /pocket-sync-service-core/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-service-core/);
  assert.doesNotMatch(source("js/pocket-sync-contract.js"), /pocket-sync-service-core/);
  assert.equal(fs.existsSync(path.join(ROOT, MODULE_PATH)), true);
  assert.equal(
    fs.readdirSync(path.join(ROOT, "js")).some((name) => name.includes("sync-service-core")),
    false
  );
});

test("module load is inert and production source has no deployed runtime machinery", () => {
  const text = source(MODULE_PATH);
  assert.match(text, /require\("node:crypto"\)/);
  for (const forbidden of [
    /\bfetch\s*\(/,
    /\.listen\s*\(/,
    /\bexpress\b/i,
    /\bfastify\b/i,
    /require\(["'](?:node:)?(?:fs|http|https|net|tls)["']\)/,
    /process\.env/,
    /process\.argv/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /setTimeout/,
    /setInterval/,
    /new Worker/,
    /\b(?:queue|polling|telemetry)\b/i,
    /console\./,
    /Authorization/i,
    /Bearer\s/,
  ]) assert.doesNotMatch(text, forbidden);
  assert.doesNotThrow(() => delete require.cache[require.resolve(`../${MODULE_PATH}`)]);
  const loaded = require(`../${MODULE_PATH}`);
  assert.deepEqual(Object.keys(loaded), ["POLICY", "COLLECTIONS", "createServiceCore"]);
});

test("factory configuration, store boundary, origin and lifetimes are exact", () => {
  const harness = createHarness();
  assert.deepEqual(Object.keys(harness.core), [
    "beginRegistration",
    "finishRegistration",
    "beginAuthentication",
    "finishAuthentication",
    "readSyncedPocket",
    "readRevision",
    "downloadEncryptedRecord",
    "conditionalUpload",
    "readPersistenceAuthority",
    "acquirePersistenceAuthorityFence",
    "releasePersistenceAuthorityFence",
    "listEnvelopes",
    "downloadEnvelope",
    "addEnvelope",
    "revokeEnvelope",
    "initialiseRecovery",
    "beginRecovery",
    "finishRecovery",
    "rotateRecovery",
    "putOpaqueObject",
    "getOpaqueObject",
    "objectPresence",
    "initialiseShadowHead",
    "readShadowHead",
    "compareAndSetShadowHead",
  ]);
  assert.equal(Object.isFrozen(harness.core), true);
  for (const field of Object.keys(harness.config)) {
    const invalid = { ...harness.config };
    delete invalid[field];
    assert.throws(() => serviceModule.createServiceCore(invalid), errorCode("service-core-invalid"));
  }
  assert.throws(
    () => serviceModule.createServiceCore({ ...harness.config, extra: true }),
    errorCode("service-core-invalid")
  );
  for (const trustedOrigin of [
    "http://sync.pocket.example",
    "https://sync.pocket.example/path",
    "https://user@sync.pocket.example",
    "https://SYNC.pocket.example",
  ]) {
    assert.throws(
      () => serviceModule.createServiceCore({ ...harness.config, trustedOrigin }),
      errorCode("service-core-invalid")
    );
  }
  assert.throws(
    () => serviceModule.createServiceCore({ ...harness.config, rpId: "other.example" }),
    errorCode("service-core-invalid")
  );
  assert.throws(
    () => serviceModule.createServiceCore({ ...harness.config, credentialAlgorithms: [] }),
    errorCode("service-core-invalid")
  );
  assert.throws(
    () => serviceModule.createServiceCore({ ...harness.config, ceremonyLifetimeMs: 600001 }),
    errorCode("service-core-invalid")
  );
  assert.throws(
    () => serviceModule.createServiceCore({ ...harness.config, sessionLifetimeMs: 7776000001 }),
    errorCode("service-core-invalid")
  );
  assert.throws(
    () => serviceModule.createServiceCore({
      ...harness.config,
      store: { ...harness.config.store, extra() {} },
    }),
    errorCode("service-core-invalid")
  );
});

test("request security context rejects before body, store, randomness or verifier access", async () => {
  let randomCalls = 0;
  const harness = createHarness({
    randomBytes(length) { randomCalls += 1; return bytes(length); },
  });
  const initialCounters = harness.driver.counters();
  const missingOrigin = context();
  delete missingOrigin.origin;
  const cases = [
    context(null, { method: "GET" }),
    missingOrigin,
    context(null, { origin: "https://other.example" }),
    context(null, { origin: "null" }),
    context(null, { fetchSite: "cross-site" }),
    context(null, { fetchSite: "same-site" }),
    context(null, { contentType: "application/x-www-form-urlencoded" }),
    { ...context(), extra: true },
  ];
  for (const requestContext of cases) {
    await assert.rejects(
      harness.core.beginRegistration({
        context: requestContext,
        body: beginRegistrationBody(),
      }),
      (error) => ["service-request-context-invalid", "service-origin-rejected"].includes(error.code)
    );
  }
  assert.deepEqual(harness.driver.counters(), initialCounters);
  assert.equal(randomCalls, 0);
  assert.deepEqual(harness.verifierCalls, { registration: 0, authentication: 0 });
});

test("registration begin persists only one reusable pending ceremony with P031-valid options", async () => {
  const browser = loadBrowserContracts();
  const harness = createHarness();
  const request = beginRegistrationBody();
  const first = await harness.core.beginRegistration(call(request));
  const snapshot = harness.driver.snapshot();
  assert.equal(Object.keys(snapshot.ceremonies).length, 1);
  assert.equal(Object.keys(snapshot.accounts).length, 0);
  assert.equal(Object.keys(snapshot.credentials).length, 0);
  assert.equal(Object.keys(snapshot.sessions).length, 0);
  const checked = browser.account.validateBeginRegistrationResponse(first.body, request.operationId, NOW);
  assert.equal(checked.publicKeyCreationOptions.authenticatorSelection.residentKey, "required");
  assert.equal(checked.publicKeyCreationOptions.authenticatorSelection.userVerification, "required");
  assert.equal(checked.publicKeyCreationOptions.attestation, "none");
  assert.deepEqual(plain(checked.publicKeyCreationOptions.pubKeyCredParams), [
    { type: "public-key", alg: -7 },
  ]);
  assert.deepEqual(Object.keys(checked.publicKeyCreationOptions.extensions.prf.eval), ["first"]);
  assert.equal(checked.prfEvaluationInput, checked.publicKeyCreationOptions.extensions.prf.eval.first);
  const second = await harness.core.beginRegistration(call(request));
  assert.deepEqual(plain(second), plain(first));
  assert.equal(Object.keys(harness.driver.snapshot().ceremonies).length, 1);
  await assert.rejects(
    harness.core.beginRegistration(call(beginRegistrationBody("register-operation", {
      deviceId: "changed-device",
    }))),
    errorCode("service-operation-reuse")
  );
  harness.setTime(Date.parse(first.body.expiresAt));
  await assert.rejects(
    harness.core.beginRegistration(call(request)),
    errorCode("service-ceremony-expired")
  );
});

test("registration finish verifies once and atomically creates exact account, credential, session and result", async () => {
  const browser = loadBrowserContracts();
  const harness = createHarness();
  const registration = await register(harness);
  assert.equal(harness.verifierCalls.registration, 1);
  const snapshot = harness.driver.snapshot();
  assert.equal(Object.keys(snapshot.accounts).length, 1);
  assert.equal(Object.keys(snapshot.credentials).length, 1);
  assert.equal(Object.keys(snapshot.sessions).length, 1);
  assert.equal(snapshot.ceremonies["register-operation"].finishDigest.length, 64);
  assert.equal(
    snapshot.accounts[registration.accountId].prfEvaluationInput,
    registration.begin.body.prfEvaluationInput
  );
  browser.account.validateFinishRegistrationResponse(registration.finish.body, {
    operationId: "register-operation",
    ceremonyId: registration.begin.body.ceremonyId,
    credentialId: registration.credentialId,
    prfEvaluationInput: registration.begin.body.prfEvaluationInput,
  });
  const replay = await harness.core.finishRegistration(call({
    apiVersion: 1,
    operationId: "register-operation",
    ceremonyId: registration.begin.body.ceremonyId,
    deviceId: "device-opaque",
    credential: registrationCredential(registration.credentialId),
  }));
  assert.deepEqual(plain(replay), plain(registration.finish));
  assert.equal(harness.verifierCalls.registration, 1);
  await assert.rejects(
    harness.core.finishRegistration(call({
      apiVersion: 1,
      operationId: "register-operation",
      ceremonyId: registration.begin.body.ceremonyId,
      deviceId: "device-opaque",
      credential: registrationCredential(credentialId(171)),
    })),
    errorCode("service-operation-reuse")
  );
});

test("registration transaction failure leaves no partial account, credential or session", async () => {
  for (const point of ["after-staged-writes-before-commit", "during-commit"]) {
    const harness = createHarness();
    const begin = await harness.core.beginRegistration(call(beginRegistrationBody()));
    const before = harness.driver.snapshot();
    harness.driver.failAt(point);
    await assert.rejects(
      harness.core.finishRegistration(call({
        apiVersion: 1,
        operationId: "register-operation",
        ceremonyId: begin.body.ceremonyId,
        deviceId: "device-opaque",
        credential: registrationCredential(),
      })),
      errorCode("service-storage-failed")
    );
    assert.deepEqual(harness.driver.snapshot(), before, point);
  }
});

test("adding a credential reuses account PRF input and rotates the session atomically", async () => {
  const harness = createHarness();
  const first = await register(harness);
  const second = await register(harness, {
    operationId: "register-second",
    credentialId: credentialId(181),
    deviceId: "device-two",
    sessionId: first.sessionId,
  });
  const snapshot = harness.driver.snapshot();
  const account = snapshot.accounts[first.accountId];
  assert.deepEqual(account.credentialIds, [first.credentialId, second.credentialId]);
  assert.equal(second.begin.body.prfEvaluationInput, first.begin.body.prfEvaluationInput);
  assert.equal(snapshot.sessions[first.sessionId].status, "revoked");
  assert.equal(snapshot.sessions[first.sessionId].replacedBy, second.sessionId);
  assert.equal(snapshot.sessions[second.sessionId].status, "active");
  assert.equal(second.finish.session.replaceSessionId, first.sessionId);

  const beginThird = await harness.core.beginRegistration(call(
    beginRegistrationBody("register-third", { deviceId: "device-three" }),
    second.sessionId
  ));
  const before = harness.driver.snapshot();
  harness.driver.failAt("during-commit");
  await assert.rejects(
    harness.core.finishRegistration(call({
      apiVersion: 1,
      operationId: "register-third",
      ceremonyId: beginThird.body.ceremonyId,
      deviceId: "device-three",
      credential: registrationCredential(credentialId(201)),
    }, second.sessionId)),
    errorCode("service-storage-failed")
  );
  assert.deepEqual(harness.driver.snapshot(), before);
  assert.equal(harness.driver.snapshot().sessions[second.sessionId].status, "active");
});

test("authentication resolves non-enumerating locator/session paths and builds P031-valid options", async () => {
  const browser = loadBrowserContracts();
  const harness = createHarness();
  const registration = await register(harness);
  const bootstrap = await harness.core.beginAuthentication(call(
    beginAuthenticationBody("missing-locator")
  ));
  assert.equal(bootstrap.body.bootstrap, true);
  assert.equal(bootstrap.body.prfEvaluationInput, undefined);
  assert.equal(bootstrap.body.publicKeyRequestOptions.allowCredentials, undefined);
  browser.account.validateBeginAuthenticationResponse(bootstrap.body, "missing-locator", NOW);
  await assert.rejects(
    harness.core.beginAuthentication(call(beginAuthenticationBody(
      "unknown-locator", { accountLocator: "unknown-account" }
    ))),
    errorCode("service-account-unresolved")
  );
  const explicit = await harness.core.beginAuthentication(call(beginAuthenticationBody(
    "authentication-explicit",
    { accountLocator: registration.accountId }
  )));
  browser.account.validateBeginAuthenticationResponse(
    explicit.body,
    "authentication-explicit",
    NOW
  );
  assert.equal(explicit.body.publicKeyRequestOptions.userVerification, "required");
  assert.equal(explicit.body.publicKeyRequestOptions.extensions.prf.eval.first, registration.begin.body.prfEvaluationInput);
  const sessionBegin = await harness.core.beginAuthentication(call(
    beginAuthenticationBody("authentication-session"),
    registration.sessionId
  ));
  assert.equal(sessionBegin.body.prfEvaluationInput, registration.begin.body.prfEvaluationInput);
});

test("authentication completion updates verifier state, rotates a session, and never claims content unlock", async () => {
  const browser = loadBrowserContracts();
  const harness = createHarness();
  const registration = await register(harness);
  const authentication = await authenticate(harness, registration);
  assert.equal(harness.verifierCalls.authentication, 1);
  const snapshot = harness.driver.snapshot();
  assert.equal(snapshot.credentials[registration.credentialId].signCount, 1);
  assert.equal(snapshot.credentials[registration.credentialId].backedUp, true);
  assert.equal(snapshot.sessions[registration.sessionId].status, "revoked");
  assert.equal(snapshot.sessions[registration.sessionId].replacedBy, authentication.sessionId);
  assert.equal(snapshot.sessions[authentication.sessionId].status, "active");
  assert.equal(Object.hasOwn(authentication.finish.body, "contentUnlocked"), false);
  assert.equal(Object.hasOwn(authentication.finish.body, "contentKey"), false);
  browser.account.validateFinishAuthenticationResponse(authentication.finish.body, {
    operationId: "authenticate-operation",
    ceremonyId: authentication.begin.body.ceremonyId,
    credentialId: registration.credentialId,
    prfEvaluationInput: registration.begin.body.prfEvaluationInput,
  });
  const replay = await harness.core.finishAuthentication(call({
    apiVersion: 1,
    operationId: "authenticate-operation",
    ceremonyId: authentication.begin.body.ceremonyId,
    credential: authenticationCredential(registration.credentialId),
  }, registration.sessionId));
  assert.deepEqual(plain(replay), plain(authentication.finish));
  assert.equal(harness.verifierCalls.authentication, 1);
});

test("P052i1 discoverable failures are generic and completed bootstrap replay is idempotent", async () => {
  const failing = createHarness({ verifyAuthentication() {
    return { credentialId: credentialId(201), signCount: 1, backedUp: true };
  } });
  const registration = await register(failing);
  const beginKnown = await failing.core.beginAuthentication(call(beginAuthenticationBody("discoverable-known-invalid")));
  const beforeKnown = failing.driver.snapshot();
  await assert.rejects(failing.core.finishAuthentication(call({ apiVersion: 1,
    operationId: "discoverable-known-invalid", ceremonyId: beginKnown.body.ceremonyId,
    credential: authenticationCredential(registration.credentialId),
  })), errorCode("service-authentication-failed"));
  assert.deepEqual(failing.driver.snapshot(), beforeKnown);

  const beginUnknown = await failing.core.beginAuthentication(call(beginAuthenticationBody("discoverable-unknown")));
  const beforeUnknown = failing.driver.snapshot();
  await assert.rejects(failing.core.finishAuthentication(call({ apiVersion: 1,
    operationId: "discoverable-unknown", ceremonyId: beginUnknown.body.ceremonyId,
    credential: authenticationCredential(credentialId(211)),
  })), errorCode("service-authentication-failed"));
  assert.deepEqual(failing.driver.snapshot(), beforeUnknown);
  assert.equal(failing.verifierCalls.authentication, 1);

  const harness = createHarness();
  const valid = await register(harness);
  const begin = await harness.core.beginAuthentication(call(beginAuthenticationBody("discoverable-replay")));
  const request = { apiVersion: 1, operationId: "discoverable-replay", ceremonyId: begin.body.ceremonyId,
    credential: authenticationCredential(valid.credentialId) };
  const completed = await harness.core.finishAuthentication(call(request));
  const snapshot = harness.driver.snapshot();
  const replay = await harness.core.finishAuthentication(call(request));
  assert.deepEqual(plain(replay), plain(completed));
  assert.equal(replay.body.prfEvaluationInput, undefined);
  assert.equal(harness.verifierCalls.authentication, 1);
  assert.deepEqual(harness.driver.snapshot(), snapshot);
  const bound = await harness.core.beginAuthentication(call(
    beginAuthenticationBody("after-discoverable-replay"), completed.session.sessionId
  ));
  assert.equal(bound.body.bootstrap, undefined);
  assert.equal(bound.body.prfEvaluationInput, valid.begin.body.prfEvaluationInput);
});

test("authentication rejects credential substitution and non-advancing non-zero counters", async () => {
  const harness = createHarness({ registrationSignCount: 5, authenticationSignCount: 5 });
  const first = await register(harness, { credentialId: credentialId(91) });
  const second = await register(harness, {
    operationId: "register-other-account",
    credentialId: credentialId(191),
    deviceId: "device-other",
  });
  const begin = await harness.core.beginAuthentication(call(beginAuthenticationBody(
    "authentication-substitution",
    { accountLocator: first.accountId }
  )));
  await assert.rejects(
    harness.core.finishAuthentication(call({
      apiVersion: 1,
      operationId: "authentication-substitution",
      ceremonyId: begin.body.ceremonyId,
      credential: authenticationCredential(second.credentialId),
    })),
    errorCode("service-authorisation-failed")
  );
  const validBegin = await harness.core.beginAuthentication(call(beginAuthenticationBody(
    "authentication-counter",
    { accountLocator: first.accountId }
  )));
  await assert.rejects(
    harness.core.finishAuthentication(call({
      apiVersion: 1,
      operationId: "authentication-counter",
      ceremonyId: validBegin.body.ceremonyId,
      credential: authenticationCredential(first.credentialId),
    })),
    errorCode("service-webauthn-failed")
  );

  const zeroHarness = createHarness({ authenticationSignCount: 0 });
  const zeroRegistration = await register(zeroHarness);
  const zeroAuth = await authenticate(zeroHarness, zeroRegistration, { sessionId: null });
  assert.equal(
    zeroHarness.driver.snapshot().credentials[zeroRegistration.credentialId].signCount,
    0
  );
  assert.equal(zeroAuth.finish.status, 200);
});

test("session errors are non-secret, clear invalid cookies, and content reads do not mutate sessions", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const request = { apiVersion: 1, operationId: "read-operation", syncedPocketId: "pocket-opaque" };
  await assert.rejects(harness.core.readRevision(call(request)), (error) => {
    assert.equal(error.code, "service-authentication-required");
    assert.equal(error.clearSession, false);
    return true;
  });
  const unknown = "unknown-session";
  await assert.rejects(harness.core.readRevision(call(request, unknown)), (error) => {
    assert.equal(error.code, "service-session-invalid");
    assert.equal(error.clearSession, true);
    assert.doesNotMatch(error.message, new RegExp(unknown));
    return true;
  });
  const before = harness.driver.snapshot();
  await harness.core.readRevision(call(request, registration.sessionId));
  assert.deepEqual(harness.driver.snapshot(), before);
  harness.setTime(Date.parse(registration.finish.session.expiresAt));
  await assert.rejects(
    harness.core.readRevision(call(request, registration.sessionId)),
    (error) => error.code === "service-session-expired" && error.clearSession === true
  );
});

test("unbound read and first upload produce exact P032 responses and atomic Pocket ownership", async () => {
  const browser = loadBrowserContracts();
  const harness = createHarness();
  const registration = await register(harness);
  const readRequest = {
    apiVersion: 1,
    operationId: "read-empty",
    syncedPocketId: "pocket-opaque",
  };
  const empty = await harness.core.readRevision(call(readRequest, registration.sessionId));
  browser.remote.validateReadRevisionResponse(empty.body, readRequest);
  assert.equal(empty.body.revision, 0);
  const request = uploadBody();
  const uploaded = await harness.core.conditionalUpload(call(request, registration.sessionId));
  browser.remote.validateConditionalUploadResponse(200, uploaded.body, request);
  assert.equal(uploaded.body.revision, 1);
  const snapshot = harness.driver.snapshot();
  assert.equal(snapshot.accounts[registration.accountId].syncedPocketId, "pocket-opaque");
  assert.equal(snapshot.pockets["pocket-opaque"].revision, 1);
  assert.equal(Object.keys(snapshot.operations).length, 1);
  assert.equal(Object.hasOwn(Object.values(snapshot.operations)[0], "encryptedRecord"), false);
});

test("first-upload transaction failure leaves the account unbound and creates no Pocket or operation", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const before = harness.driver.snapshot();
  harness.driver.failAt("after-staged-writes-before-commit");
  await assert.rejects(
    harness.core.conditionalUpload(call(uploadBody(), registration.sessionId)),
    errorCode("service-storage-failed")
  );
  assert.deepEqual(harness.driver.snapshot(), before);
  assert.equal(harness.driver.snapshot().accounts[registration.accountId].syncedPocketId, null);
});

test("another account cannot bind or access an existing Pocket", async () => {
  const driver = createMemoryServiceStore();
  const first = createHarness({ driver });
  const firstRegistration = await register(first);
  await first.core.conditionalUpload(call(uploadBody(), firstRegistration.sessionId));

  let randomCall = 0;
  const second = createHarness({
    driver,
    randomBytes(length) {
      randomCall += 1;
      return bytes(length, 101 + randomCall * 17);
    },
  });
  const secondRegistration = await register(second, {
    operationId: "second-account-registration",
    credentialId: credentialId(211),
    deviceId: "second-device",
  });
  const before = driver.snapshot();
  await assert.rejects(
    second.core.conditionalUpload(call(uploadBody("second-account-upload"), secondRegistration.sessionId)),
    errorCode("service-authorisation-failed")
  );
  await assert.rejects(
    second.core.downloadEncryptedRecord(call({
      apiVersion: 1,
      operationId: "second-account-download",
      syncedPocketId: "pocket-opaque",
      revision: 1,
    }, secondRegistration.sessionId)),
    errorCode("service-authorisation-failed")
  );
  assert.deepEqual(driver.snapshot(), before);
});

test("positive revision read/download pass P032 and no historical revision is available", async () => {
  const browser = loadBrowserContracts();
  const harness = createHarness();
  const registration = await register(harness);
  await harness.core.conditionalUpload(call(uploadBody(), registration.sessionId));
  const readRequest = {
    apiVersion: 1,
    operationId: "read-positive",
    syncedPocketId: "pocket-opaque",
  };
  const read = await harness.core.readRevision(call(readRequest, registration.sessionId));
  browser.remote.validateReadRevisionResponse(read.body, readRequest);
  const downloadRequest = {
    apiVersion: 1,
    operationId: "download-current",
    syncedPocketId: "pocket-opaque",
    revision: 1,
  };
  const download = await harness.core.downloadEncryptedRecord(call(
    downloadRequest,
    registration.sessionId
  ));
  browser.remote.validateDownloadResponse(download.body, downloadRequest);
  const second = uploadBody("upload-second", {
    expectedRevision: 1,
    encryptedRecord: encryptedRecord(55),
  });
  await harness.core.conditionalUpload(call(second, registration.sessionId));
  await assert.rejects(
    harness.core.downloadEncryptedRecord(call(downloadRequest, registration.sessionId)),
    errorCode("service-record-not-found")
  );
  await assert.rejects(
    harness.core.readRevision(call({ ...readRequest, syncedPocketId: "other-pocket" }, registration.sessionId)),
    errorCode("service-authorisation-failed")
  );
});

test("conditional upload has durable exact idempotency and rejects changed operation reuse", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const request = uploadBody();
  const committed = await harness.core.conditionalUpload(call(request, registration.sessionId));
  assert.equal(committed.body.replayed, false);
  await assert.rejects(
    harness.core.conditionalUpload(call(request, registration.sessionId)),
    errorCode("service-operation-reuse")
  );
  const retry = { ...request, attemptKind: "idempotent-retry" };
  const replay = await harness.core.conditionalUpload(call(retry, registration.sessionId));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.revision, 1);
  for (const changed of [
    { logicalChangeId: "different-change" },
    { expectedRevision: 1 },
    { encryptedRecord: encryptedRecord(71) },
    { encryptedRecord: { ...request.encryptedRecord, nonce: encryptedRecord(91).nonce } },
    {
      encryptedRecord: {
        ...request.encryptedRecord,
        ciphertext: encryptedRecord(92).ciphertext,
      },
    },
    { syncedPocketId: "other-pocket" },
  ]) {
    await assert.rejects(
      harness.core.conditionalUpload(call({ ...retry, ...changed }, registration.sessionId)),
      (error) => ["service-operation-reuse", "service-authorisation-failed"].includes(error.code)
    );
  }
  const firstSeenRetry = uploadBody("first-seen-retry", {
    expectedRevision: 1,
    attemptKind: "idempotent-retry",
    encryptedRecord: encryptedRecord(101),
  });
  const firstSeenResult = await harness.core.conditionalUpload(call(
    firstSeenRetry,
    registration.sessionId
  ));
  assert.equal(firstSeenResult.body.replayed, false);
  assert.equal(firstSeenResult.body.revision, 2);
});

test("conditional upload preserves P033's safely advanceable revision boundary", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const beforeCounters = harness.driver.counters();
  await assert.rejects(
    harness.core.conditionalUpload(call(uploadBody("unsafe-revision", {
      expectedRevision: Number.MAX_SAFE_INTEGER,
    }), registration.sessionId)),
    errorCode("service-request-invalid")
  );
  assert.deepEqual(harness.driver.counters(), beforeCounters);
  await assert.rejects(
    harness.core.conditionalUpload(call(uploadBody("last-safe-advance", {
      expectedRevision: Number.MAX_SAFE_INTEGER - 1,
    }), registration.sessionId)),
    errorCode("service-state-invalid")
  );
});

test("conflicts are durable non-writes and retry returns the original conflict", async () => {
  const browser = loadBrowserContracts();
  const harness = createHarness();
  const registration = await register(harness);
  await harness.core.conditionalUpload(call(uploadBody(), registration.sessionId));
  const conflictRequest = uploadBody("conflict-operation", {
    expectedRevision: 0,
    encryptedRecord: encryptedRecord(81),
  });
  const beforePocket = harness.driver.snapshot().pockets["pocket-opaque"];
  const conflict = await harness.core.conditionalUpload(call(
    conflictRequest,
    registration.sessionId
  ));
  browser.remote.validateConditionalUploadResponse(409, conflict.body, conflictRequest);
  assert.equal(conflict.body.actualRevision, 1);
  assert.deepEqual(harness.driver.snapshot().pockets["pocket-opaque"], beforePocket);
  await harness.core.conditionalUpload(call(uploadBody("advance-operation", {
    expectedRevision: 1,
    encryptedRecord: encryptedRecord(111),
  }), registration.sessionId));
  const replay = await harness.core.conditionalUpload(call({
    ...conflictRequest,
    attemptKind: "idempotent-retry",
  }, registration.sessionId));
  assert.equal(replay.status, 409);
  assert.equal(replay.body.actualRevision, 1);
  await assert.rejects(
    harness.core.conditionalUpload(call(uploadBody("future-operation", {
      expectedRevision: 3,
    }), registration.sessionId)),
    errorCode("service-state-invalid")
  );
});

test("concurrent writes serialize so at most one revision commits and retries remain singular", async () => {
  const driver = createMemoryServiceStore();
  const firstCore = createHarness({ driver });
  const registration = await register(firstCore);
  const secondCore = createHarness({ driver });
  const [left, right] = await Promise.all([
    firstCore.core.conditionalUpload(call(uploadBody("concurrent-left"), registration.sessionId)),
    secondCore.core.conditionalUpload(call(uploadBody("concurrent-right", {
      encryptedRecord: encryptedRecord(88),
    }), registration.sessionId)),
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  assert.equal(driver.snapshot().pockets["pocket-opaque"].revision, 1);
  assert.equal(Object.keys(driver.snapshot().operations).length, 2);

  const firstSeenRetry = uploadBody("concurrent-first-seen-retry", {
    expectedRevision: 1,
    attemptKind: "idempotent-retry",
    encryptedRecord: encryptedRecord(166),
  });
  const [firstRetry, secondRetry] = await Promise.all([
    firstCore.core.conditionalUpload(call(firstSeenRetry, registration.sessionId)),
    secondCore.core.conditionalUpload(call(firstSeenRetry, registration.sessionId)),
  ]);
  assert.deepEqual(
    [firstRetry.body.replayed, secondRetry.body.replayed].sort(),
    [false, true]
  );
  assert.equal(firstRetry.body.revision, 2);
  assert.equal(secondRetry.body.revision, 2);
  assert.equal(Object.keys(driver.snapshot().operations).length, 3);

  const retryRequest = uploadBody("concurrent-left", { attemptKind: "idempotent-retry" });
  const [retryA, retryB] = await Promise.all([
    firstCore.core.conditionalUpload(call(retryRequest, registration.sessionId)),
    secondCore.core.conditionalUpload(call(retryRequest, registration.sessionId)),
  ]);
  assert.equal(retryA.body.replayed, true);
  assert.equal(retryB.body.replayed, true);
  assert.equal(Object.keys(driver.snapshot().operations).length, 3);
});

test("all injected transaction failures preserve the prior complete snapshot", async () => {
  for (const point of FAILURE_POINTS) {
    const harness = createHarness();
    const registration = await register(harness);
    const before = harness.driver.snapshot();
    harness.driver.failAt(point);
    const action = point === "before-first-read"
      ? harness.core.readRevision(call({
        apiVersion: 1,
        operationId: "read-failure",
        syncedPocketId: "pocket-opaque",
      }, registration.sessionId))
      : harness.core.conditionalUpload(call(uploadBody(`failure-${point}`), registration.sessionId));
    await assert.rejects(action, errorCode("service-storage-failed"), point);
    assert.deepEqual(harness.driver.snapshot(), before, point);
  }
});

test("malformed stored records fail closed without repair, deletion or reset", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const snapshot = harness.driver.snapshot();
  const malformed = {
    ...snapshot.accounts[registration.accountId],
    unknownField: true,
  };
  harness.driver.unsafeReplaceForTest("accounts", registration.accountId, malformed);
  const before = harness.driver.snapshot();
  await assert.rejects(
    harness.core.readRevision(call({
      apiVersion: 1,
      operationId: "read-malformed",
      syncedPocketId: "pocket-opaque",
    }, registration.sessionId)),
    errorCode("service-state-invalid")
  );
  assert.deepEqual(harness.driver.snapshot(), before);
});

test("malformed stored relationships and impossible operation outcomes fail closed", async () => {
  const ceremonyHarness = createHarness();
  await ceremonyHarness.core.beginRegistration(call(beginRegistrationBody()));
  const ceremonySnapshot = ceremonyHarness.driver.snapshot();
  const ceremony = ceremonySnapshot.ceremonies["register-operation"];
  ceremonyHarness.driver.unsafeReplaceForTest("ceremonies", "register-operation", {
    ...ceremony,
    challenge: b64(bytes(32, 201)),
  });
  const ceremonyBefore = ceremonyHarness.driver.snapshot();
  await assert.rejects(
    ceremonyHarness.core.beginRegistration(call(beginRegistrationBody())),
    errorCode("service-state-invalid")
  );
  assert.deepEqual(ceremonyHarness.driver.snapshot(), ceremonyBefore);

  const operationHarness = createHarness();
  const registration = await register(operationHarness);
  await operationHarness.core.conditionalUpload(call(uploadBody(), registration.sessionId));
  const operationSnapshot = operationHarness.driver.snapshot();
  const operationKey = Object.keys(operationSnapshot.operations)[0];
  operationHarness.driver.unsafeReplaceForTest("operations", operationKey, {
    ...operationSnapshot.operations[operationKey],
    result: { status: "committed", revision: 7 },
  });
  const operationBefore = operationHarness.driver.snapshot();
  await assert.rejects(
    operationHarness.core.conditionalUpload(call(uploadBody("upload-operation", {
      attemptKind: "idempotent-retry",
    }), registration.sessionId)),
    errorCode("service-state-invalid")
  );
  assert.deepEqual(operationHarness.driver.snapshot(), operationBefore);

  const ownershipHarness = createHarness();
  const ownershipRegistration = await register(ownershipHarness);
  await ownershipHarness.core.conditionalUpload(call(
    uploadBody(),
    ownershipRegistration.sessionId
  ));
  const ownershipSnapshot = ownershipHarness.driver.snapshot();
  ownershipHarness.driver.unsafeReplaceForTest(
    "accounts",
    ownershipRegistration.accountId,
    {
      ...ownershipSnapshot.accounts[ownershipRegistration.accountId],
      storeVersion: ownershipSnapshot.accounts[ownershipRegistration.accountId].storeVersion + 1,
      syncedPocketId: null,
    }
  );
  const ownershipBefore = ownershipHarness.driver.snapshot();
  await assert.rejects(
    ownershipHarness.core.conditionalUpload(call(uploadBody("upload-operation", {
      attemptKind: "idempotent-retry",
    }), ownershipRegistration.sessionId)),
    errorCode("service-state-invalid")
  );
  assert.deepEqual(ownershipHarness.driver.snapshot(), ownershipBefore);
});

test("transaction objects and Promise-returning methods have one exact surface", async () => {
  const harness = createHarness();
  const base = harness.config;
  const extraTransactionStore = Object.freeze({
    async transact(_mode, callback) {
      return callback({
        async get() { return null; },
        async insert() {},
        async replace() {},
        async remove() {},
        extra() {},
      });
    },
  });
  const extraCore = serviceModule.createServiceCore({ ...base, store: extraTransactionStore });
  await assert.rejects(
    extraCore.beginRegistration(call(beginRegistrationBody())),
    errorCode("service-core-invalid")
  );

  const synchronousGetStore = Object.freeze({
    async transact(_mode, callback) {
      return callback(Object.freeze({
        get() { return null; },
        async insert() {},
        async replace() {},
        async remove() {},
      }));
    },
  });
  const synchronousCore = serviceModule.createServiceCore({ ...base, store: synchronousGetStore });
  await assert.rejects(
    synchronousCore.beginRegistration(call(beginRegistrationBody())),
    errorCode("service-core-invalid")
  );
});

test("deterministic test store enforces insert-only and store-version compare-and-swap", async () => {
  const driver = createMemoryServiceStore();
  const first = { storeVersion: 1, value: "first" };
  await driver.store.transact("readwrite", async (transaction) => {
    assert.deepEqual(Object.keys(transaction), ["get", "insert", "replace", "remove"]);
    await transaction.insert("accounts", "test-key", first);
  });
  const inserted = driver.snapshot();
  await assert.rejects(
    driver.store.transact("readwrite", (transaction) => (
      transaction.insert("accounts", "test-key", first)
    )),
    errorCode("store-duplicate")
  );
  await assert.rejects(
    driver.store.transact("readwrite", (transaction) => (
      transaction.replace("accounts", "test-key", 2, { storeVersion: 3 })
    )),
    errorCode("store-version-conflict")
  );
  assert.deepEqual(driver.snapshot(), inserted);
  await driver.store.transact("readwrite", (transaction) => (
    transaction.replace("accounts", "test-key", 1, { storeVersion: 2, value: "second" })
  ));
  await assert.rejects(
    driver.store.transact("readwrite", (transaction) => (
      transaction.remove("accounts", "test-key", 1)
    )),
    errorCode("store-version-conflict")
  );
  await driver.store.transact("readwrite", (transaction) => (
    transaction.remove("accounts", "test-key", 2)
  ));
  assert.deepEqual(driver.snapshot().accounts, {});
});

test("generated account collisions fail once without retry or partial state", async () => {
  const driver = createMemoryServiceStore();
  const first = createHarness({ driver });
  await register(first);
  let randomCalls = 0;
  const collision = createHarness({
    driver,
    randomBytes(length) {
      randomCalls += 1;
      return bytes(length, 23);
    },
  });
  const before = driver.snapshot();
  await assert.rejects(
    collision.core.beginRegistration(call(beginRegistrationBody("collision-operation"))),
    errorCode("service-random-collision")
  );
  assert.equal(randomCalls, 2);
  assert.deepEqual(driver.snapshot(), before);
});

test("authentication commit failure preserves credential, ceremony and prior session atomically", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const begin = await harness.core.beginAuthentication(call(
    beginAuthenticationBody("authentication-failure"),
    registration.sessionId
  ));
  const before = harness.driver.snapshot();
  harness.driver.failAt("during-commit");
  await assert.rejects(
    harness.core.finishAuthentication(call({
      apiVersion: 1,
      operationId: "authentication-failure",
      ceremonyId: begin.body.ceremonyId,
      credential: authenticationCredential(registration.credentialId),
    }, registration.sessionId)),
    errorCode("service-storage-failed")
  );
  assert.deepEqual(harness.driver.snapshot(), before);
  assert.equal(harness.driver.snapshot().sessions[registration.sessionId].status, "active");
});

test("stale ceremony, account, credential and session versions fail before partial completion", async () => {
  let releaseRegistration;
  let registrationVerifierStarted;
  const registrationStarted = new Promise((resolve) => { registrationVerifierStarted = resolve; });
  const registrationGate = new Promise((resolve) => { releaseRegistration = resolve; });
  const registrationHarness = createHarness({
    async verifyRegistration(input) {
      registrationVerifierStarted();
      await registrationGate;
      return {
        credentialId: input.credential.id,
        publicKey: b64(bytes(64, 81)),
        publicKeyAlgorithm: -7,
        signCount: 0,
        transports: ["internal"],
        backupEligible: true,
        backedUp: false,
      };
    },
  });
  const registrationBegin = await registrationHarness.core.beginRegistration(call(
    beginRegistrationBody("stale-ceremony")
  ));
  const registrationFinish = registrationHarness.core.finishRegistration(call({
    apiVersion: 1,
    operationId: "stale-ceremony",
    ceremonyId: registrationBegin.body.ceremonyId,
    deviceId: "device-opaque",
    credential: registrationCredential(),
  }));
  await registrationStarted;
  const pending = registrationHarness.driver.snapshot().ceremonies["stale-ceremony"];
  registrationHarness.driver.unsafeReplaceForTest("ceremonies", "stale-ceremony", {
    ...pending,
    storeVersion: pending.storeVersion + 1,
  });
  releaseRegistration();
  await assert.rejects(registrationFinish, errorCode("service-transaction-conflict"));
  assert.equal(Object.keys(registrationHarness.driver.snapshot().accounts).length, 0);
  assert.equal(Object.keys(registrationHarness.driver.snapshot().sessions).length, 0);

  let releaseAuthentication;
  let authenticationVerifierStarted;
  const authenticationStarted = new Promise((resolve) => { authenticationVerifierStarted = resolve; });
  const authenticationGate = new Promise((resolve) => { releaseAuthentication = resolve; });
  const authenticationHarness = createHarness({
    async verifyAuthentication(input) {
      authenticationVerifierStarted();
      await authenticationGate;
      return {
        credentialId: input.credential.id,
        signCount: 1,
        backedUp: true,
      };
    },
  });
  const registration = await register(authenticationHarness);
  const authBegin = await authenticationHarness.core.beginAuthentication(call(
    beginAuthenticationBody("stale-authentication"),
    registration.sessionId
  ));
  const authFinish = authenticationHarness.core.finishAuthentication(call({
    apiVersion: 1,
    operationId: "stale-authentication",
    ceremonyId: authBegin.body.ceremonyId,
    credential: authenticationCredential(registration.credentialId),
  }, registration.sessionId));
  await authenticationStarted;
  const snapshot = authenticationHarness.driver.snapshot();
  authenticationHarness.driver.unsafeReplaceForTest(
    "credentials",
    registration.credentialId,
    {
      ...snapshot.credentials[registration.credentialId],
      storeVersion: snapshot.credentials[registration.credentialId].storeVersion + 1,
    }
  );
  authenticationHarness.driver.unsafeReplaceForTest(
    "accounts",
    registration.accountId,
    {
      ...snapshot.accounts[registration.accountId],
      storeVersion: snapshot.accounts[registration.accountId].storeVersion + 1,
    }
  );
  authenticationHarness.driver.unsafeReplaceForTest(
    "sessions",
    registration.sessionId,
    {
      ...snapshot.sessions[registration.sessionId],
      storeVersion: snapshot.sessions[registration.sessionId].storeVersion + 1,
    }
  );
  releaseAuthentication();
  await assert.rejects(authFinish, errorCode("service-transaction-conflict"));
  const after = authenticationHarness.driver.snapshot();
  assert.equal(after.sessions[registration.sessionId].status, "active");
  assert.equal(Object.keys(after.sessions).length, 1);
});

test("revoked and malformed session relationships fail content authorisation", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const authentication = await authenticate(harness, registration);
  const request = {
    apiVersion: 1,
    operationId: "read-session-state",
    syncedPocketId: "pocket-opaque",
  };
  await assert.rejects(
    harness.core.readRevision(call(request, registration.sessionId)),
    (error) => error.code === "service-session-invalid" && error.clearSession === true
  );
  const snapshot = harness.driver.snapshot();
  harness.driver.unsafeReplaceForTest("sessions", authentication.sessionId, {
    ...snapshot.sessions[authentication.sessionId],
    accountId: "missing-account",
  });
  const before = harness.driver.snapshot();
  await assert.rejects(
    harness.core.readRevision(call(request, authentication.sessionId)),
    errorCode("service-state-invalid")
  );
  assert.deepEqual(harness.driver.snapshot(), before);
});

test("strict schemas preserve exact service record fields", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  await harness.core.conditionalUpload(call(uploadBody(), registration.sessionId));
  const snapshot = harness.driver.snapshot();
  const expected = {
    accounts: [
      "accountId", "accountPolicyVersion", "createdAt", "credentialIds", "kind",
      "prfEvaluationInput", "schemaVersion", "storeVersion", "syncedPocketId",
    ],
    credentials: [
      "accountId", "backedUp", "backupEligible", "createdAt", "credentialId",
      "credentialVersion", "kind", "publicKey", "publicKeyAlgorithm", "schemaVersion",
      "signCount", "status", "storeVersion", "transports",
    ],
    sessions: [
      "accountId", "createdAt", "credentialId", "expiresAt", "kind", "replacedBy",
      "schemaVersion", "sessionId", "status", "storeVersion",
    ],
    ceremonies: [
      "accountId", "beginBody", "ceremonyId", "ceremonyType", "challenge",
      "completedResult", "deviceId", "expiresAt", "finishDigest", "kind", "mode", "operationId",
      "prfEvaluationInput", "priorSessionId", "requestDigest", "schemaVersion", "storeVersion",
    ],
    pockets: [
      "accountId", "createdAt", "encryptedRecord", "encryptedRecordSize", "kind",
      "revision", "schemaVersion", "storeVersion", "syncedPocketId",
    ],
    operations: [
      "accountId", "expectedRevision", "kind", "logicalChangeId", "operationId",
      "requestDigest", "result", "schemaVersion", "storeVersion", "syncedPocketId",
    ],
  };
  for (const collection of Object.keys(expected)) {
    const record = Object.values(snapshot[collection])[0];
    assert.deepEqual(Object.keys(record).sort(), expected[collection].slice().sort(), collection);
    assert.equal(record.schemaVersion, 1);
    assert.equal(Number.isSafeInteger(record.storeVersion), true);
  }
});

test("submitted PRF output and compromised verifier extras are rejected without persistence", async () => {
  const sentinel = "P034-RAW-PRF-OUTPUT-SENTINEL";
  const harness = createHarness();
  const begin = await harness.core.beginRegistration(call(beginRegistrationBody()));
  const unsafeCredential = registrationCredential();
  unsafeCredential.clientExtensionResults.prf.results = { first: sentinel };
  const before = harness.driver.snapshot();
  await assert.rejects(
    harness.core.finishRegistration(call({
      apiVersion: 1,
      operationId: "register-operation",
      ceremonyId: begin.body.ceremonyId,
      deviceId: "device-opaque",
      credential: unsafeCredential,
    })),
    errorCode("service-request-invalid")
  );
  assert.deepEqual(harness.driver.snapshot(), before);

  const compromised = createHarness({
    verifyRegistration(input) {
      return {
        credentialId: input.credential.id,
        publicKey: b64(bytes(64, 81)),
        publicKeyAlgorithm: -7,
        signCount: 0,
        transports: ["internal"],
        backupEligible: true,
        backedUp: false,
        rawPrfOutput: sentinel,
      };
    },
  });
  const compromisedBegin = await compromised.core.beginRegistration(call(beginRegistrationBody()));
  await assert.rejects(
    compromised.core.finishRegistration(call({
      apiVersion: 1,
      operationId: "register-operation",
      ceremonyId: compromisedBegin.body.ceremonyId,
      deviceId: "device-opaque",
      credential: registrationCredential(),
    })),
    errorCode("service-webauthn-failed")
  );
  assert.equal(JSON.stringify(compromised.driver.snapshot()).includes(sentinel), false);
});

test("service records exclude readable Pocket and unlock secrets; only Pocket stores ciphertext", async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const sentinel = "P034-READABLE-THOUGHT-SENTINEL";
  const secretFields = [
    { label: sentinel },
    { details: sentinel },
    { rawPrfOutput: sentinel },
    { masterKey: sentinel },
    { recoveryRoot: sentinel },
    { deviceWrappingKey: sentinel },
  ];
  for (const extra of secretFields) {
    await assert.rejects(
      harness.core.conditionalUpload(call({ ...uploadBody(), ...extra }, registration.sessionId)),
      (error) => {
        assert.equal(error.code, "service-request-invalid");
        assert.doesNotMatch(error.message, new RegExp(sentinel));
        return true;
      }
    );
  }
  const request = uploadBody();
  await harness.core.conditionalUpload(call(request, registration.sessionId));
  const snapshotText = JSON.stringify(harness.driver.snapshot());
  assert.doesNotMatch(snapshotText, new RegExp(sentinel));
  const ciphertext = request.encryptedRecord.ciphertext;
  assert.equal(snapshotText.split(ciphertext).length - 1, 1);
  const operation = Object.values(harness.driver.snapshot().operations)[0];
  assert.equal(typeof operation.requestDigest, "string");
  assert.equal(Object.hasOwn(operation, "encryptedRecord"), false);
  assert.equal(JSON.stringify(operation).includes(ciphertext), false);
});

test("package and production loader boundaries retain the P048/P049 server-only dependencies", () => {
  const packageJson = JSON.parse(source("package.json"));
  assert.deepEqual(Object.keys(packageJson), ["private", "engines", "scripts", "dependencies"]);
  assert.deepEqual(packageJson.dependencies, { "@simplewebauthn/server": "13.3.2", pg: "8.22.0" });
  assert.deepEqual(Object.keys(packageJson.scripts), [
    "check",
    "mod:dry-remove-enter-preflight",
    "mod:remove-enter-preflight",
    "sync:db:migrate",
    "sync:server",
    "sync:local",
    "sync:production",
    "sync:production:manifest",
  ]);
  assert.doesNotMatch(source("index.html"), /sync-service\//);
  assert.doesNotMatch(source("sw.js"), /sync-service\//);
});
