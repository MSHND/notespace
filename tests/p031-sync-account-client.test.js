"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const MODULE_PATH = "js/pocket-sync-account-client.js";
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const EXPIRES = "2030-01-01T00:05:00.000Z";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function loadClient(extra = {}) {
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
    ArrayBuffer,
    Uint8Array,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  }, extra);
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(MODULE_PATH), context, { filename: MODULE_PATH });
  return { api: context.PocketSyncAccountClient, context };
}

function loadCrypto() {
  const context = {
    crypto: webcrypto,
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
    Error,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-crypto.js"), context, { filename: "js/pocket-sync-crypto.js" });
  return context.PocketSyncCrypto;
}

function bytes(length, start = 1) {
  return Uint8Array.from({ length }, (_unused, index) => (start + index) & 255);
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

const PRF_INPUT = b64(bytes(32, 9));
const PRF_OUTPUT = bytes(32, 101);
const PRF_OUTPUT_TEXT = b64(PRF_OUTPUT);
const CHALLENGE = b64(bytes(32, 41));
const USER_ID = b64(bytes(16, 71));
const CREDENTIAL_ID = b64(bytes(32, 121));

function registrationOptions(overrides = {}) {
  return Object.assign({
    rp: { id: "pocket.example", name: "Pocket" },
    user: { id: USER_ID, name: "account-opaque", displayName: "Pocket account" },
    challenge: CHALLENGE,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 120000,
    excludeCredentials: [],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
    extensions: { prf: { eval: { first: PRF_INPUT } } },
  }, overrides);
}

function authenticationOptions(overrides = {}) {
  return Object.assign({
    challenge: CHALLENGE,
    timeout: 120000,
    rpId: "pocket.example",
    allowCredentials: [{ type: "public-key", id: CREDENTIAL_ID, transports: ["internal"] }],
    userVerification: "required",
    extensions: { prf: { eval: { first: PRF_INPUT } } },
  }, overrides);
}

function beginRegistration(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "register-operation",
    ceremonyId: "register-ceremony",
    expiresAt: EXPIRES,
    prfEvaluationInput: PRF_INPUT,
    publicKeyCreationOptions: registrationOptions(),
  }, overrides);
}

function beginAuthentication(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "authentication-operation",
    ceremonyId: "authentication-ceremony",
    expiresAt: EXPIRES,
    prfEvaluationInput: PRF_INPUT,
    publicKeyRequestOptions: authenticationOptions(),
  }, overrides);
}

function finishRegistration(overrides = {}) {
  return Object.assign({
    apiVersion: 1,
    ok: true,
    operationId: "register-operation",
    ceremonyId: "register-ceremony",
    accountId: "account-opaque",
    credentialId: CREDENTIAL_ID,
    credentialVersion: 1,
    accountPolicyVersion: 1,
    prfEvaluationInput: PRF_INPUT,
  }, overrides);
}

function finishAuthentication(overrides = {}) {
  return Object.assign({}, finishRegistration(), {
    operationId: "authentication-operation",
    ceremonyId: "authentication-ceremony",
  }, overrides);
}

function extensionResults(kind = "registration", output = PRF_OUTPUT) {
  const prf = { results: { first: output.buffer.slice(0) } };
  if (kind === "registration") prf.enabled = true;
  return { prf };
}

function nativeRegistrationCredential(extensions = extensionResults()) {
  const json = {
    id: CREDENTIAL_ID,
    rawId: CREDENTIAL_ID,
    response: {
      clientDataJSON: b64(bytes(17, 2)),
      attestationObject: b64(bytes(24, 4)),
      authenticatorData: b64(bytes(19, 6)),
      transports: ["internal"],
      publicKey: b64(bytes(23, 8)),
      publicKeyAlgorithm: -7,
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: {
      prf: { enabled: true, results: { first: PRF_OUTPUT_TEXT } },
    },
    type: "public-key",
  };
  return {
    getClientExtensionResults() { return extensions; },
    toJSON() { return json; },
  };
}

function nativeAuthenticationCredential(extensions = extensionResults("authentication")) {
  const json = {
    id: CREDENTIAL_ID,
    rawId: CREDENTIAL_ID,
    response: {
      clientDataJSON: b64(bytes(17, 12)),
      authenticatorData: b64(bytes(19, 14)),
      signature: b64(bytes(64, 16)),
      userHandle: null,
    },
    authenticatorAttachment: "platform",
    clientExtensionResults: { prf: { results: { first: PRF_OUTPUT_TEXT } } },
    type: "public-key",
  };
  return {
    getClientExtensionResults() { return extensions; },
    toJSON() { return json; },
  };
}

function manualRegistrationCredential(extensions = extensionResults()) {
  return {
    id: CREDENTIAL_ID,
    rawId: bytes(32, 121).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: bytes(17, 2).buffer,
      attestationObject: bytes(24, 4).buffer,
      getAuthenticatorData() { return bytes(19, 6).buffer; },
      getTransports() { return ["internal"]; },
      getPublicKey() { return bytes(23, 8).buffer; },
      getPublicKeyAlgorithm() { return -7; },
    },
    getClientExtensionResults() { return extensions; },
  };
}

function manualAuthenticationCredential(extensions = extensionResults("authentication")) {
  return {
    id: CREDENTIAL_ID,
    rawId: bytes(32, 121).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: bytes(17, 12).buffer,
      authenticatorData: bytes(19, 14).buffer,
      signature: bytes(64, 16).buffer,
      userHandle: null,
    },
    getClientExtensionResults() { return extensions; },
  };
}

function service(overrides = {}) {
  return {
    async beginRegistration() { return beginRegistration(); },
    async finishRegistration() { return finishRegistration(); },
    async beginAuthentication() { return beginAuthentication(); },
    async finishAuthentication() { return finishAuthentication(); },
    ...overrides,
  };
}

function errorCode(error) {
  return error && error.code;
}

test("P031 account client is dormant and absent from production loaders", () => {
  assert.doesNotThrow(() => new vm.Script(source(MODULE_PATH)));
  assert.doesNotMatch(source("index.html"), /pocket-sync-account-client\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-account-client\.js/);
  assert.doesNotMatch(source("js/pocket-sync-contract.js"), /PocketSyncAccountClient/);
});

test("module load has no browser, service, storage, crypto, or network side effects", () => {
  let reads = 0;
  const environment = {};
  ["navigator", "PublicKeyCredential", "localStorage", "indexedDB", "crypto", "fetch"].forEach((name) => {
    Object.defineProperty(environment, name, { get() { reads += 1; throw new Error(name); } });
  });
  assert.doesNotThrow(() => loadClient(environment));
  assert.equal(reads, 0);
});

test("policy is passkey-only and account authentication never implies content unlock", () => {
  const { api } = loadClient();
  assert.deepEqual(JSON.parse(JSON.stringify(api.POLICY)), {
    apiVersion: 1,
    credentialType: "public-key",
    prfEvaluationInputBytes: 32,
    prfOutputBytes: 32,
    minimumChallengeBytes: 32,
    userVerification: "required",
    residentKey: "required",
    attestation: "none",
    conditionalMediation: false,
    automaticRetry: false,
    accountAuthenticationUnlocksContent: false,
  });
  assert.doesNotMatch(source(MODULE_PATH), /password|oauth|magic.link|recovery.phrase/i);
});

test("PRF evaluation input is canonical base64url and exactly 32 bytes", () => {
  const { api } = loadClient();
  assert.equal(api.validatePrfEvaluationInput(PRF_INPUT), PRF_INPUT);
  assert.throws(() => api.validatePrfEvaluationInput(`${PRF_INPUT}=`), (error) => error.code === "prf-evaluation-input-invalid");
  assert.throws(() => api.validatePrfEvaluationInput(b64(bytes(31))), (error) => error.code === "prf-evaluation-input-invalid");
  assert.throws(() => api.validatePrfEvaluationInput(b64(bytes(33))), (error) => error.code === "prf-evaluation-input-invalid");
});

test("registration and authentication requests have exact stable shapes", () => {
  const { api } = loadClient();
  const registration = api.validateBeginRegistrationRequest({
    apiVersion: 1,
    operationId: "register-operation",
    accountIntent: "create-or-add-credential",
    deviceId: "device-opaque",
  });
  assert.deepEqual(Object.keys(registration), ["apiVersion", "operationId", "accountIntent", "deviceId"]);
  const authentication = api.validateBeginAuthenticationRequest({
    apiVersion: 1,
    operationId: "authentication-operation",
    accountLocator: "account-opaque",
  });
  assert.deepEqual(Object.keys(authentication), ["apiVersion", "operationId", "accountLocator"]);
  assert.throws(() => api.validateBeginRegistrationRequest({ ...registration, extra: true }), (e) => e.code === "registration-request-invalid");
  assert.throws(() => api.validateBeginAuthenticationRequest({ ...authentication, password: "no" }), (e) => e.code === "authentication-request-invalid");
});

test("server options require RP, user, challenge, UV, resident key, attestation and one PRF input", () => {
  const { api } = loadClient();
  assert.equal(api.validateRegistrationOptions(registrationOptions(), PRF_INPUT).attestation, "none");
  assert.equal(api.validateAuthenticationOptions(authenticationOptions(), PRF_INPUT).userVerification, "required");
  assert.throws(() => api.validateRegistrationOptions(registrationOptions({ attestation: "direct" }), PRF_INPUT), (e) => e.code === "registration-options-invalid");
  assert.throws(() => api.validateRegistrationOptions(registrationOptions({ authenticatorSelection: { residentKey: "preferred", userVerification: "required" } }), PRF_INPUT), (e) => e.code === "registration-options-invalid");
  assert.throws(() => api.validateAuthenticationOptions(authenticationOptions({ userVerification: "preferred" }), PRF_INPUT), (e) => e.code === "authentication-options-invalid");
  assert.throws(() => api.validateAuthenticationOptions(authenticationOptions({ extensions: { prf: { eval: { first: PRF_INPUT, second: PRF_INPUT } } } }), PRF_INPUT), (e) => e.code === "authentication-options-invalid");
});

test("native WebAuthn parsers are preferred and receive validated JSON", () => {
  const { api } = loadClient();
  let creationCalls = 0;
  let requestCalls = 0;
  const native = {
    parseCreationOptionsFromJSON(options) { creationCalls += 1; assert.equal(options.challenge, CHALLENGE); return { native: "create" }; },
    parseRequestOptionsFromJSON(options) { requestCalls += 1; assert.equal(options.challenge, CHALLENGE); return { native: "get" }; },
  };
  assert.equal(api.parseRegistrationOptions(registrationOptions(), PRF_INPUT, native).native, "create");
  assert.equal(api.parseAuthenticationOptions(authenticationOptions(), PRF_INPUT, native).native, "get");
  assert.equal(creationCalls, 1);
  assert.equal(requestCalls, 1);
});

test("fallback parsing decodes every WebAuthn buffer into independent ArrayBuffers", () => {
  const { api } = loadClient();
  const registrationSource = registrationOptions({
    excludeCredentials: [{ type: "public-key", id: CREDENTIAL_ID, transports: ["internal"] }],
  });
  const authenticationSource = authenticationOptions();
  const beforeRegistration = JSON.stringify(registrationSource);
  const beforeAuthentication = JSON.stringify(authenticationSource);
  const registration = api.parseRegistrationOptions(registrationSource, PRF_INPUT);
  const authentication = api.parseAuthenticationOptions(authenticationSource, PRF_INPUT);
  assert.ok(registration.challenge instanceof ArrayBuffer);
  assert.ok(registration.user.id instanceof ArrayBuffer);
  assert.deepEqual(Array.from(new Uint8Array(registration.challenge)), Array.from(bytes(32, 41)));
  assert.deepEqual(Array.from(new Uint8Array(registration.user.id)), Array.from(bytes(16, 71)));
  assert.deepEqual(Array.from(new Uint8Array(registration.excludeCredentials[0].id)), Array.from(bytes(32, 121)));
  assert.ok(registration.extensions.prf.eval.first instanceof ArrayBuffer);
  assert.notEqual(registration.challenge, registration.extensions.prf.eval.first);
  assert.ok(authentication.allowCredentials[0].id instanceof ArrayBuffer);
  assert.ok(authentication.extensions.prf.eval.first instanceof ArrayBuffer);
  assert.deepEqual(Array.from(new Uint8Array(authentication.challenge)), Array.from(bytes(32, 41)));
  assert.deepEqual(Array.from(new Uint8Array(authentication.allowCredentials[0].id)), Array.from(bytes(32, 121)));
  assert.deepEqual(Array.from(new Uint8Array(authentication.extensions.prf.eval.first)), Array.from(bytes(32, 9)));
  assert.equal(JSON.stringify(registrationSource), beforeRegistration);
  assert.equal(JSON.stringify(authenticationSource), beforeAuthentication);
});

test("malformed public binary is rejected before a browser credential call", async () => {
  const { api } = loadClient();
  let creates = 0;
  const adapter = api.createBrowserWebAuthnAdapter({
    navigator: { credentials: { async create() { creates += 1; } } },
  });
  const invalid = registrationOptions({ challenge: "not+base64" });
  await assert.rejects(adapter.createCredential(invalid), (e) => e.code === "registration-options-invalid");
  await assert.rejects(adapter.createCredential(registrationOptions({ challenge: b64(bytes(31)) })), (e) => e.code === "registration-options-invalid");
  await assert.rejects(adapter.createCredential(registrationOptions({ extensions: { prf: { eval: { first: b64(bytes(31)) } } } })), (e) => e.code === "registration-options-invalid");
  await assert.rejects(adapter.createCredential(registrationOptions({ mediation: "conditional" })), (e) => e.code === "registration-options-invalid");
  assert.equal(creates, 0);
});

test("PRF result states are explicit and malformed output is rejected", () => {
  const { api } = loadClient();
  assert.equal(api.inspectPrfResult("registration", {}, PRF_INPUT).status, "unavailable");
  assert.equal(api.inspectPrfResult("registration", { prf: { enabled: true } }, PRF_INPUT).status, "enabled-no-output");
  assert.equal(api.inspectPrfResult("authentication", {}, PRF_INPUT).status, "unavailable");
  const available = api.inspectPrfResult("authentication", extensionResults("authentication"), PRF_INPUT);
  assert.equal(available.status, "available");
  assert.deepEqual(Array.from(available.outputBytes), Array.from(PRF_OUTPUT));
  assert.notEqual(available.outputBytes.buffer, PRF_OUTPUT.buffer);
  assert.throws(() => api.inspectPrfResult("authentication", extensionResults("authentication", bytes(31)), PRF_INPUT), (e) => e.code === "prf-output-invalid");
  assert.throws(() => api.inspectPrfResult("authentication", { prf: { results: { first: PRF_OUTPUT.buffer, second: PRF_OUTPUT.buffer } } }, PRF_INPUT), (e) => e.code === "prf-output-invalid");
  assert.throws(() => api.inspectPrfResult("authentication", { prf: { results: { first: "not-binary" } } }, PRF_INPUT), (e) => e.code === "prf-output-invalid");
  assert.throws(() => api.inspectPrfResult("registration", { prf: { enabled: false, results: { first: PRF_OUTPUT.buffer } } }, PRF_INPUT), (e) => e.code === "prf-output-invalid");
  assert.throws(() => api.inspectPrfResult("authentication", extensionResults("authentication"), null), (e) => e.code === "prf-output-invalid");
});

test("available P031 PRF bytes feed P029 HKDF as a non-extractable AES-GCM-256 key", async () => {
  const { api } = loadClient();
  const cryptoApi = loadCrypto();
  const result = api.inspectPrfResult("authentication", extensionResults("authentication"), PRF_INPUT);
  const derived = await cryptoApi.deriveWrappingKey(
    result.outputBytes,
    b64(bytes(32, 151)),
    {
      syncedPocketId: "pocket-p031-tests",
      envelopeId: "credential-envelope-p031",
      envelopeKind: "passkey-prf",
      envelopeVersion: 1,
    }
  );
  assert.equal(derived.type, "secret");
  assert.equal(derived.extractable, false);
  assert.equal(derived.algorithm.name, "AES-GCM");
  assert.equal(derived.algorithm.length, 256);
  assert.deepEqual([...derived.usages].sort(), ["decrypt", "encrypt"]);
  result.outputBytes.fill(0);
});

test("registration serialization prefers native toJSON and removes PRF result material", () => {
  const { api } = loadClient();
  const serialised = api.serializeRegistrationCredential(nativeRegistrationCredential(), PRF_INPUT);
  assert.equal(serialised.credential.id, CREDENTIAL_ID);
  assert.deepEqual(JSON.parse(JSON.stringify(serialised.credential.clientExtensionResults)), { prf: { enabled: true } });
  assert.doesNotMatch(JSON.stringify(serialised.credential), new RegExp(PRF_OUTPUT_TEXT));
  assert.equal(serialised.prf.status, "available");
});

test("authentication serialization removes all PRF result material", () => {
  const { api } = loadClient();
  const serialised = api.serializeAuthenticationCredential(nativeAuthenticationCredential(), PRF_INPUT);
  assert.deepEqual(JSON.parse(JSON.stringify(serialised.credential.clientExtensionResults)), {});
  assert.doesNotMatch(JSON.stringify(serialised.credential), new RegExp(PRF_OUTPUT_TEXT));
  assert.equal(serialised.prf.status, "available");
});

test("manual registration and authentication serialization remain server-verifiable", () => {
  const { api } = loadClient();
  const registration = api.serializeRegistrationCredential(manualRegistrationCredential(), PRF_INPUT);
  const authentication = api.serializeAuthenticationCredential(manualAuthenticationCredential(), PRF_INPUT);
  assert.equal(registration.credential.response.publicKeyAlgorithm, -7);
  assert.deepEqual(JSON.parse(JSON.stringify(registration.credential.response.transports)), ["internal"]);
  assert.equal(authentication.credential.response.userHandle, null);
  assert.deepEqual(JSON.parse(JSON.stringify(authentication.credential.clientExtensionResults)), {});
});

test("credential response shape, type and id/rawId consistency are strict", () => {
  const { api } = loadClient();
  const wrongType = nativeRegistrationCredential();
  const original = wrongType.toJSON();
  original.type = "not-public-key";
  wrongType.toJSON = () => original;
  assert.throws(() => api.serializeRegistrationCredential(wrongType, PRF_INPUT), (e) => e.code === "passkey-registration-response-invalid");
  const mismatch = nativeAuthenticationCredential();
  const json = mismatch.toJSON();
  json.rawId = b64(bytes(32, 122));
  mismatch.toJSON = () => json;
  assert.throws(() => api.serializeAuthenticationCredential(mismatch, PRF_INPUT), (e) => e.code === "passkey-authentication-response-invalid");
});

test("account service and WebAuthn interfaces reject extra or missing methods", () => {
  const { api } = loadClient();
  assert.throws(() => api.createClient({ accountService: { ...service(), extra() {} }, webAuthn: { createCredential() {}, getCredential() {} } }), (e) => e.code === "account-service-invalid");
  assert.throws(() => api.createClient({ accountService: service(), webAuthn: { createCredential() {} } }), (e) => e.code === "passkey-api-unavailable");
});

test("registration ceremony calls the exact four-method boundary once and returns locked success", async () => {
  const { api } = loadClient();
  const calls = [];
  const accountService = service({
    async beginRegistration(request) { calls.push(["beginRegistration", request]); return beginRegistration(); },
    async finishRegistration(request) { calls.push(["finishRegistration", request]); return finishRegistration(); },
  });
  const webAuthn = {
    async createCredential(options) { calls.push(["createCredential", options]); return nativeRegistrationCredential(); },
    async getCredential() { throw new Error("unexpected"); },
  };
  const client = api.createClient({ accountService, webAuthn, now: () => NOW });
  const result = await client.registerPasskey({ apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque" });
  assert.deepEqual(calls.map(([name]) => name), ["beginRegistration", "createCredential", "finishRegistration"]);
  assert.equal(result.ok, true);
  assert.equal(result.accountAuthenticated, true);
  assert.equal(result.contentUnlocked, false);
  assert.equal(result.prf.status, "available");
  assert.doesNotMatch(JSON.stringify(calls[2][1]), new RegExp(PRF_OUTPUT_TEXT));
});

test("authentication ceremony calls the exact boundary once and returns locked success", async () => {
  const { api } = loadClient();
  const calls = [];
  const accountService = service({
    async beginAuthentication(request) { calls.push(["beginAuthentication", request]); return beginAuthentication(); },
    async finishAuthentication(request) { calls.push(["finishAuthentication", request]); return finishAuthentication(); },
  });
  const webAuthn = {
    async createCredential() { throw new Error("unexpected"); },
    async getCredential(options) { calls.push(["getCredential", options]); return nativeAuthenticationCredential(); },
  };
  const client = api.createClient({ accountService, webAuthn, now: () => NOW });
  const result = await client.authenticatePasskey({ apiVersion: 1, operationId: "authentication-operation", accountLocator: "account-opaque" });
  assert.deepEqual(calls.map(([name]) => name), ["beginAuthentication", "getCredential", "finishAuthentication"]);
  assert.equal(result.accountAuthenticated, true);
  assert.equal(result.contentUnlocked, false);
  assert.doesNotMatch(JSON.stringify(calls[2][1]), new RegExp(PRF_OUTPUT_TEXT));
});

test("PRF output is validated before finish and never crosses the account service boundary", async () => {
  const { api } = loadClient();
  let finishCalls = 0;
  const accountService = service({ async finishAuthentication() { finishCalls += 1; return finishAuthentication(); } });
  const webAuthn = {
    async createCredential() {},
    async getCredential() { return nativeAuthenticationCredential(extensionResults("authentication", bytes(31))); },
  };
  const client = api.createClient({ accountService, webAuthn, now: () => NOW });
  await assert.rejects(client.authenticatePasskey({ apiVersion: 1, operationId: "authentication-operation" }), (e) => e.code === "prf-output-invalid");
  assert.equal(finishCalls, 0);
});

test("operation, ceremony, credential and PRF input mismatch fail closed", async () => {
  const { api } = loadClient();
  const webAuthn = { async createCredential() { return nativeRegistrationCredential(); }, async getCredential() { return nativeAuthenticationCredential(); } };
  for (const changed of [
    { operationId: "other" },
    { ceremonyId: "other" },
    { credentialId: b64(bytes(32, 122)) },
    { prfEvaluationInput: b64(bytes(32, 10)) },
  ]) {
    const accountService = service({ async finishRegistration() { return finishRegistration(changed); } });
    const client = api.createClient({ accountService, webAuthn, now: () => NOW });
    await assert.rejects(client.registerPasskey({ apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque" }), (e) => e.code === "passkey-ceremony-mismatch");
  }
});

test("expired ceremonies fail before browser invocation and after a slow gesture", async () => {
  const { api } = loadClient();
  let browserCalls = 0;
  const webAuthn = { async createCredential() { browserCalls += 1; return nativeRegistrationCredential(); }, async getCredential() {} };
  let now = NOW;
  const expiredService = service({ async beginRegistration() { return beginRegistration({ expiresAt: "2029-12-31T23:59:59.000Z" }); } });
  await assert.rejects(api.createClient({ accountService: expiredService, webAuthn, now: () => now }).registerPasskey({ apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque" }), (e) => e.code === "passkey-ceremony-expired");
  assert.equal(browserCalls, 0);
  let finishCalls = 0;
  const slowWebAuthn = { async createCredential() { now = Date.parse(EXPIRES) + 1; return nativeRegistrationCredential(); }, async getCredential() {} };
  const accountService = service({ async finishRegistration() { finishCalls += 1; return finishRegistration(); } });
  await assert.rejects(api.createClient({ accountService, webAuthn: slowWebAuthn, now: () => now }).registerPasskey({ apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque" }), (e) => e.code === "passkey-ceremony-expired");
  assert.equal(finishCalls, 0);
});

test("browser cancellation and support failures map to stable secret-safe codes without retry", async () => {
  const { api } = loadClient();
  for (const [name, code] of [["NotAllowedError", "passkey-authentication-cancelled"], ["NotSupportedError", "passkey-not-supported"], ["SecurityError", "passkey-security-failed"]]) {
    let calls = 0;
    const webAuthn = { async createCredential() {}, async getCredential() { calls += 1; const error = new Error("secret server detail"); error.name = name; throw error; } };
    const client = api.createClient({ accountService: service(), webAuthn, now: () => NOW });
    await assert.rejects(client.authenticatePasskey({ apiVersion: 1, operationId: "authentication-operation" }), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret server detail/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("registration cancellation and missing WebAuthn API stop without finish or retry", async () => {
  const { api } = loadClient();
  let creates = 0;
  let finishes = 0;
  const cancelled = new Error("private authenticator detail");
  cancelled.name = "NotAllowedError";
  const client = api.createClient({
    accountService: service({ async finishRegistration() { finishes += 1; return finishRegistration(); } }),
    webAuthn: {
      async createCredential() { creates += 1; throw cancelled; },
      async getCredential() {},
    },
    now: () => NOW,
  });
  await assert.rejects(client.registerPasskey({
    apiVersion: 1,
    operationId: "register-operation",
    accountIntent: "create-or-add-credential",
    deviceId: "device-opaque",
  }), (error) => error.code === "passkey-registration-cancelled"
      && !error.message.includes("private authenticator detail"));
  assert.equal(creates, 1);
  assert.equal(finishes, 0);
  const adapter = api.createBrowserWebAuthnAdapter({});
  await assert.rejects(adapter.createCredential(registrationOptions()), (error) => error.code === "passkey-api-unavailable");
});

test("account service exceptions are mapped without leaking messages or retrying", async () => {
  const { api } = loadClient();
  let calls = 0;
  const accountService = service({ async beginAuthentication() { calls += 1; throw new Error("private service stack"); } });
  const client = api.createClient({ accountService, webAuthn: { async createCredential() {}, async getCredential() {} }, now: () => NOW });
  await assert.rejects(client.authenticatePasskey({ apiVersion: 1, operationId: "authentication-operation" }), (error) => {
    assert.equal(error.code, "account-service-failed");
    assert.doesNotMatch(error.message, /private service stack/);
    return true;
  });
  assert.equal(calls, 1);
});

test("browser adapter makes one create/get call and never requests conditional mediation", async () => {
  const { api } = loadClient();
  const calls = [];
  const environment = {
    navigator: { credentials: {
      async create(options) { calls.push(["create", options]); return "created"; },
      async get(options) { calls.push(["get", options]); return "got"; },
    } },
  };
  const adapter = api.createBrowserWebAuthnAdapter(environment);
  assert.equal(await adapter.createCredential(registrationOptions()), "created");
  assert.equal(await adapter.getCredential(authenticationOptions()), "got");
  assert.deepEqual(calls.map(([name]) => name), ["create", "get"]);
  assert.equal(Object.hasOwn(calls[1][1], "mediation"), false);
});

test("P031 tokens and PRF output cannot enter obvious persistence or remote payloads", () => {
  const moduleSource = source(MODULE_PATH);
  assert.doesNotMatch(moduleSource, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker|BroadcastChannel|SharedWorker|setTimeout|setInterval|console\.|telemetry|password|oauth|social.login/i);
  const { api } = loadClient();
  const result = api.serializeAuthenticationCredential(nativeAuthenticationCredential(), PRF_INPUT);
  const publicPayload = JSON.stringify(result.credential);
  assert.doesNotMatch(publicPayload, new RegExp(PRF_OUTPUT_TEXT));
  assert.equal(result.prf.outputBytes.byteLength, 32);
  result.prf.outputBytes.fill(0);
  assert.deepEqual(Array.from(result.prf.outputBytes), new Array(32).fill(0));
});

test("readable Pocket fields and secret sentinels cannot enter accepted account shapes", () => {
  const { api } = loadClient();
  const sentinel = "P031-READABLE-POCKET-NODE-MUST-NOT-CROSS";
  assert.throws(() => api.validateBeginRegistrationRequest({
    apiVersion: 1,
    operationId: "register-operation",
    accountIntent: "create-or-add-credential",
    deviceId: "device-opaque",
    nodeTitle: sentinel,
  }), (e) => !e.message.includes(sentinel));
  assert.throws(() => api.validateBeginAuthenticationResponse({
    ...beginAuthentication(),
    plaintextPocket: sentinel,
  }, "authentication-operation", NOW), (e) => !e.message.includes(sentinel));
});
