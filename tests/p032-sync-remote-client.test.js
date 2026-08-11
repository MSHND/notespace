"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const MODULE_PATH = "js/pocket-sync-remote-client.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function loadProduction(extra = {}) {
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
    Set,
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  }, extra);
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-sync-security-contract.js",
    "js/pocket-sync-account-client.js",
    MODULE_PATH,
  ]) {
    vm.runInContext(source(file), context, { filename: file });
  }
  return {
    api: context.PocketSyncRemoteClient,
    account: context.PocketSyncAccountClient,
    security: context.PocketSyncSecurityContract,
    context,
  };
}

function remoteErrorCode(code) {
  return (error) => error && error.code === code;
}

function validTransport(handler) {
  return Object.freeze({ async request(route, body) { return handler(route, body); } });
}

function contentService(api, handler) {
  return api.createContentService({ transport: validTransport(handler) });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("P032 module remains inert when P045 loads its injected-client contract", () => {
  assert.doesNotThrow(() => new vm.Script(source(MODULE_PATH)));
  assert.match(source("index.html"), /pocket-sync-remote-client\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-remote-client\.js/);
  assert.doesNotMatch(source("js/pocket-sync-contract.js"), /PocketSyncRemoteClient/);
});

test("module load performs no fetch, location, storage, cookie, timer, or worker access", () => {
  let reads = 0;
  const environment = {};
  [
    "fetch",
    "location",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "document",
    "navigator",
    "setTimeout",
    "setInterval",
    "Worker",
    "SharedWorker",
  ].forEach((name) => {
    Object.defineProperty(environment, name, {
      configurable: true,
      get() { reads += 1; throw new Error(`unexpected ${name}`); },
    });
  });
  assert.doesNotThrow(() => loadProduction(environment));
  assert.equal(reads, 0);
});

test("policy and route map are exact and deeply frozen", () => {
  const { api } = loadProduction();
  assert.deepEqual(JSON.parse(JSON.stringify(api.POLICY)), {
    apiVersion: 1,
    automaticRetry: false,
    sameOriginOnly: true,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    requestMethod: "POST",
    requestContentType: "application/json",
    responseContentType: "application/json",
    bearerTokenStorage: false,
    backgroundWork: false,
    smallJsonLimitBytes: 262144,
    contentJsonLimitBytes: 16777216,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.ROUTES)), {
    beginRegistration: "/account/passkeys/registration/begin",
    finishRegistration: "/account/passkeys/registration/finish",
    beginAuthentication: "/account/passkeys/authentication/begin",
    finishAuthentication: "/account/passkeys/authentication/finish",
    readRevision: "/pockets/revision/read",
    downloadEncryptedRecord: "/pockets/content/download",
    conditionalUpload: "/pockets/content/conditional-upload",
    listEnvelopes: "/pockets/envelopes/list",
    downloadEnvelope: "/pockets/envelopes/download",
    addEnvelope: "/pockets/envelopes/add",
    revokeEnvelope: "/pockets/envelopes/revoke",
    initialiseRecovery: "/account/recovery/initialise",
    beginRecovery: "/account/recovery/begin",
    finishRecovery: "/account/recovery/finish",
    rotateRecovery: "/account/recovery/rotate",
  });
  assert.equal(Object.isFrozen(api.POLICY), true);
  assert.equal(Object.isFrozen(api.ROUTES), true);
});

test("service root accepts one same-origin path and rejects every unsafe form before fetch", async () => {
  const { api } = loadProduction();
  let calls = 0;
  const fetch = async () => { calls += 1; return fixtures.textResponse({ ok: true }); };
  const transport = api.createBrowserJsonTransport({ serviceRoot: "/test/pocket-sync/v1/", fetch });
  await transport.request("readRevision", { apiVersion: 1 });
  assert.equal(calls, 1);
  for (const root of [
    "",
    "/",
    "https://service.example/v1",
    "//service.example/v1",
    "/v1?mode=test",
    "/v1#fragment",
    "/v1/../other",
    "/v1\\other",
    "//v1",
    "/v1//other",
    "/v1@service",
    "/v1/%2e%2e/other",
  ]) {
    assert.throws(
      () => api.createBrowserJsonTransport({ serviceRoot: root, fetch }),
      remoteErrorCode("remote-service-root-invalid"),
      root
    );
  }
  assert.equal(calls, 1);
});

test("browser transport and injected services enforce exact method surfaces", () => {
  const { api } = loadProduction();
  const transport = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    fetch: async () => fixtures.textResponse({ ok: true }),
  });
  assert.deepEqual(Object.keys(transport), ["request"]);
  assert.throws(() => api.createContentService({ transport: {} }), remoteErrorCode("remote-transport-invalid"));
  assert.throws(() => api.createContentService({
    transport: { async request() {}, extra() {} },
  }), remoteErrorCode("remote-transport-invalid"));
});

test("fetch uses the exact same-origin POST policy without identifiers in the path", async () => {
  const { api } = loadProduction();
  const calls = [];
  const request = { apiVersion: 1, operationId: "secret-operation", syncedPocketId: "secret-pocket" };
  const before = JSON.stringify(request);
  const transport = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    async fetch(url, options) {
      calls.push({ url, options });
      return fixtures.textResponse({ ok: true }, { contentType: "application/json; charset=utf-8" });
    },
  });
  await transport.request("readRevision", request);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/test/pocket-sync/v1/pockets/revision/read");
  assert.doesNotMatch(calls[0].url, /secret-operation|secret-pocket|\?/);
  assert.deepEqual(Object.keys(calls[0].options).sort(), [
    "body", "cache", "credentials", "headers", "method", "mode", "redirect", "referrerPolicy",
  ]);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.mode, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.deepEqual(plain(calls[0].options.headers), { Accept: "application/json", "Content-Type": "application/json" });
  assert.equal(Object.hasOwn(calls[0].options.headers, "Authorization"), false);
  assert.equal(calls[0].options.body, before);
  assert.equal(JSON.stringify(request), before);
});

test("request body is JSON-stringified exactly once", async () => {
  let serialisations = 0;
  const json = {
    parse: JSON.parse,
    stringify(value) { serialisations += 1; return JSON.stringify(value); },
  };
  const { api } = loadProduction({ JSON: json });
  const transport = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    fetch: async () => fixtures.textResponse({ ok: true }),
  });
  await transport.request("readRevision", { apiVersion: 1 });
  assert.equal(serialisations, 1);
});

test("oversized, undefined, cyclic, and unsupported requests fail before fetch", async () => {
  const { api } = loadProduction();
  let calls = 0;
  const transport = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    fetch: async () => { calls += 1; return fixtures.textResponse({ ok: true }); },
  });
  await assert.rejects(
    transport.request("beginRegistration", { value: "x".repeat(262144) }),
    remoteErrorCode("remote-request-invalid")
  );
  await assert.rejects(transport.request("beginRegistration", { value: undefined }), remoteErrorCode("remote-request-invalid"));
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(transport.request("beginRegistration", cyclic), remoteErrorCode("remote-request-invalid"));
  await assert.rejects(transport.request("missingRoute", {}), remoteErrorCode("remote-route-invalid"));
  assert.equal(calls, 0);
});

test("redirect, content type, empty, malformed, array, and null responses fail closed", async () => {
  const { api } = loadProduction();
  const cases = [
    [fixtures.textResponse({}, { redirected: true }), "remote-redirect-rejected"],
    [fixtures.textResponse({}, { contentType: "text/html" }), "remote-content-type-invalid"],
    [fixtures.textResponse(""), "remote-response-invalid"],
    [fixtures.textResponse("{bad json"), "remote-response-invalid"],
    [fixtures.textResponse([]), "remote-response-invalid"],
    [fixtures.textResponse(null), "remote-response-invalid"],
  ];
  for (const [response, code] of cases) {
    const transport = api.createBrowserJsonTransport({
      serviceRoot: "/test/pocket-sync/v1",
      fetch: async () => response,
    });
    await assert.rejects(transport.request("readRevision", {}), remoteErrorCode(code));
  }
});

test("declared and fallback actual response limits fail without exposing the body", async () => {
  const { api } = loadProduction();
  let reads = 0;
  const declared = fixtures.textResponse({ secret: "not read" }, { contentLength: 262145 });
  declared.text = async () => { reads += 1; return "secret"; };
  const declaredTransport = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    fetch: async () => declared,
  });
  await assert.rejects(declaredTransport.request("readRevision", {}), (error) => {
    assert.equal(error.code, "remote-response-too-large");
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
  assert.equal(reads, 0);
  const actualTransport = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    fetch: async () => fixtures.textResponse(`{"value":"${"x".repeat(262144)}"}`),
  });
  await assert.rejects(actualTransport.request("readRevision", {}), remoteErrorCode("remote-response-too-large"));
});

test("streamed oversized response cancels its reader and stops", async () => {
  const { api } = loadProduction();
  let reads = 0;
  let cancels = 0;
  const response = {
    status: 200,
    redirected: false,
    headers: fixtures.headers({ "Content-Type": "application/json" }),
    body: {
      getReader() {
        return {
          async read() { reads += 1; return { done: false, value: new Uint8Array(262145) }; },
          async cancel() { cancels += 1; },
        };
      },
    },
  };
  const transport = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    fetch: async () => response,
  });
  await assert.rejects(transport.request("readRevision", {}), remoteErrorCode("remote-response-too-large"));
  assert.equal(reads, 1);
  assert.equal(cancels, 1);
});

test("network and rejected HTTP statuses map once to stable secret-safe errors", async () => {
  const { api } = loadProduction();
  const mappings = new Map([
    [401, "remote-authentication-required"],
    [403, "remote-authorisation-failed"],
    [408, "remote-unavailable"],
    [429, "remote-rate-limited"],
    [502, "remote-unavailable"],
    [503, "remote-unavailable"],
    [504, "remote-unavailable"],
    [418, "remote-request-rejected"],
  ]);
  for (const [status, code] of mappings) {
    let calls = 0;
    const transport = api.createBrowserJsonTransport({
      serviceRoot: "/test/pocket-sync/v1",
      fetch: async () => { calls += 1; return fixtures.textResponse("PRIVATE SERVER BODY", { status }); },
    });
    await assert.rejects(transport.request("readRevision", {}), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /PRIVATE SERVER BODY/);
      return true;
    });
    assert.equal(calls, 1);
  }
  let calls = 0;
  const network = api.createBrowserJsonTransport({
    serviceRoot: "/test/pocket-sync/v1",
    fetch: async () => { calls += 1; throw new Error("native network and URL secret"); },
  });
  await assert.rejects(network.request("readRevision", {}), (error) => {
    assert.equal(error.code, "remote-unavailable");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /native network|URL secret/);
    return true;
  });
  assert.equal(calls, 1);
});

test("account service exposes exactly P031's four accepted methods", () => {
  const { api, account } = loadProduction();
  const transport = validTransport(() => ({ status: 200, body: {} }));
  const service = api.createAccountService({ transport, now: () => fixtures.NOW });
  assert.deepEqual(Object.keys(service), [
    "beginRegistration",
    "finishRegistration",
    "beginAuthentication",
    "finishAuthentication",
  ]);
  assert.doesNotThrow(() => account.createClient({
    accountService: service,
    webAuthn: { async createCredential() {}, async getCredential() {} },
    now: () => fixtures.NOW,
  }));
});

test("account contract and security contract are required without fallback copies", () => {
  const loaded = loadProduction();
  const transport = validTransport(() => ({ status: 200, body: {} }));
  loaded.context.PocketSyncAccountClient = null;
  assert.throws(
    () => loaded.api.createAccountService({ transport }),
    remoteErrorCode("remote-account-contract-unavailable")
  );
  loaded.context.PocketSyncSecurityContract = null;
  assert.throws(
    () => loaded.api.createContentService({ transport }),
    remoteErrorCode("remote-security-contract-unavailable")
  );
});

test("begin registration validates before one exact transport call and validates response identity", async () => {
  const { api } = loadProduction();
  const calls = [];
  const service = api.createAccountService({
    transport: validTransport((route, body) => {
      calls.push([route, body]);
      return { status: 200, body: fixtures.beginRegistration() };
    }),
    now: () => fixtures.NOW,
  });
  await assert.rejects(service.beginRegistration({ apiVersion: 1, extra: true }), () => true);
  assert.equal(calls.length, 0);
  const result = await service.beginRegistration({
    apiVersion: 1,
    operationId: "register-operation",
    accountIntent: "create-or-add-credential",
    deviceId: "device-opaque",
  });
  assert.equal(result.ceremonyId, "register-ceremony");
  assert.deepEqual(calls.map(([route]) => route), ["beginRegistration"]);
  assert.deepEqual(Object.keys(calls[0][1]), ["apiVersion", "operationId", "accountIntent", "deviceId"]);
  const mismatch = api.createAccountService({
    transport: validTransport(() => ({ status: 200, body: fixtures.beginRegistration({ operationId: "other" }) })),
    now: () => fixtures.NOW,
  });
  await assert.rejects(mismatch.beginRegistration({
    apiVersion: 1,
    operationId: "register-operation",
    accountIntent: "create-or-add-credential",
    deviceId: "device-opaque",
  }), (error) => error.code === "passkey-ceremony-mismatch");
});

test("finish registration binds route, request, operation, ceremony, and credential without a cache", async () => {
  const { api, account } = loadProduction();
  const credential = account.serializeRegistrationCredential(
    fixtures.nativeRegistrationCredential(),
    fixtures.PRF_INPUT
  ).credential;
  const calls = [];
  const service = api.createAccountService({
    transport: validTransport((route, body) => {
      calls.push([route, body]);
      return { status: 200, body: fixtures.finishRegistration() };
    }),
    now: () => fixtures.NOW,
  });
  const request = {
    apiVersion: 1,
    operationId: "register-operation",
    ceremonyId: "register-ceremony",
    deviceId: "device-opaque",
    credential,
  };
  assert.equal((await service.finishRegistration(request)).accountId, "account-opaque");
  assert.deepEqual(calls.map(([route]) => route), ["finishRegistration"]);
  assert.equal(calls[0][1].credential.id, fixtures.CREDENTIAL_ID);
  assert.doesNotMatch(JSON.stringify(calls[0][1]), new RegExp(fixtures.PRF_OUTPUT_TEXT));
  for (const changed of [
    { operationId: "other" },
    { ceremonyId: "other" },
    { credentialId: fixtures.b64(fixtures.bytes(32, 122)) },
  ]) {
    const mismatched = api.createAccountService({
      transport: validTransport(() => ({ status: 200, body: fixtures.finishRegistration(changed) })),
      now: () => fixtures.NOW,
    });
    await assert.rejects(mismatched.finishRegistration(request), (error) => error.code === "passkey-ceremony-mismatch");
  }
  assert.doesNotMatch(source(MODULE_PATH), /ceremonyCache|pendingCeremon|new Map\s*\(/);
});

test("begin and finish authentication use exact P031 routes and continuity", async () => {
  const { api, account } = loadProduction();
  const credential = account.serializeAuthenticationCredential(
    fixtures.nativeAuthenticationCredential(),
    fixtures.PRF_INPUT
  ).credential;
  const calls = [];
  const service = api.createAccountService({
    transport: validTransport((route, body) => {
      calls.push([route, body]);
      if (route === "beginAuthentication") return { status: 200, body: fixtures.beginAuthentication() };
      return { status: 200, body: fixtures.finishAuthentication() };
    }),
    now: () => fixtures.NOW,
  });
  await service.beginAuthentication({
    apiVersion: 1,
    operationId: "authentication-operation",
    accountLocator: "account-opaque",
  });
  await service.finishAuthentication({
    apiVersion: 1,
    operationId: "authentication-operation",
    ceremonyId: "authentication-ceremony",
    credential,
  });
  assert.deepEqual(calls.map(([route]) => route), ["beginAuthentication", "finishAuthentication"]);
  assert.deepEqual(Object.keys(calls[1][1]), ["apiVersion", "operationId", "ceremonyId", "credential"]);
  assert.deepEqual(plain(calls[1][1].credential.clientExtensionResults), {});
});

test("complete P031 registration through P032 is ordered, authenticated, and still locked", async () => {
  const { api, account } = loadProduction();
  const calls = [];
  const accountService = api.createAccountService({
    transport: validTransport((route, body) => {
      calls.push([route, body]);
      return {
        status: 200,
        body: route === "beginRegistration" ? fixtures.beginRegistration() : fixtures.finishRegistration(),
      };
    }),
    now: () => fixtures.NOW,
  });
  const client = account.createClient({
    accountService,
    webAuthn: {
      async createCredential() { calls.push(["webAuthnCreate"]); return fixtures.nativeRegistrationCredential(); },
      async getCredential() { throw new Error("unexpected"); },
    },
    now: () => fixtures.NOW,
  });
  const result = await client.registerPasskey({
    apiVersion: 1,
    operationId: "register-operation",
    accountIntent: "create-or-add-credential",
    deviceId: "device-opaque",
  });
  assert.deepEqual(calls.map(([route]) => route), ["beginRegistration", "webAuthnCreate", "finishRegistration"]);
  assert.equal(result.accountAuthenticated, true);
  assert.equal(result.contentUnlocked, false);
  assert.equal(result.prf.status, "available");
  assert.doesNotMatch(JSON.stringify(calls[2][1]), new RegExp(fixtures.PRF_OUTPUT_TEXT));
  result.prf.outputBytes.fill(0);
});

test("complete P031 authentication through P032 is ordered, authenticated, and still locked", async () => {
  const { api, account } = loadProduction();
  const calls = [];
  const accountService = api.createAccountService({
    transport: validTransport((route, body) => {
      calls.push([route, body]);
      return {
        status: 200,
        body: route === "beginAuthentication" ? fixtures.beginAuthentication() : fixtures.finishAuthentication(),
      };
    }),
    now: () => fixtures.NOW,
  });
  const client = account.createClient({
    accountService,
    webAuthn: {
      async createCredential() { throw new Error("unexpected"); },
      async getCredential() { calls.push(["webAuthnGet"]); return fixtures.nativeAuthenticationCredential(); },
    },
    now: () => fixtures.NOW,
  });
  const result = await client.authenticatePasskey({
    apiVersion: 1,
    operationId: "authentication-operation",
    accountLocator: "account-opaque",
  });
  assert.deepEqual(calls.map(([route]) => route), ["beginAuthentication", "webAuthnGet", "finishAuthentication"]);
  assert.equal(result.accountAuthenticated, true);
  assert.equal(result.contentUnlocked, false);
  assert.deepEqual(plain(calls[2][1].credential.clientExtensionResults), {});
  result.prf.outputBytes.fill(0);
});

test("content service exposes exactly revision, download, and conditional upload", () => {
  const { api } = loadProduction();
  const service = contentService(api, () => ({ status: 200, body: {} }));
  assert.deepEqual(Object.keys(service), ["readRevision", "downloadEncryptedRecord", "conditionalUpload"]);
});

test("read revision requires exact request and accepts only coherent empty state", async () => {
  const { api } = loadProduction();
  const calls = [];
  const service = contentService(api, (route, body) => {
    calls.push([route, body]);
    return { status: 200, body: fixtures.emptyRevision() };
  });
  const result = await service.readRevision(fixtures.readRequest());
  assert.equal(result.revision, 0);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(plain(calls), [["readRevision", fixtures.readRequest()]]);
  for (const invalid of [
    fixtures.readRequest({ extra: true }),
    fixtures.readRequest({ apiVersion: 2 }),
    fixtures.readRequest({ operationId: "" }),
  ]) {
    await assert.rejects(service.readRevision(invalid), remoteErrorCode("remote-request-invalid"));
  }
  for (const changed of [
    { recordPresent: true },
    { contentFormat: "pocket.sync.content.opaque" },
    { contentVersion: 1 },
    { encryptedRecordSize: 16 },
  ]) {
    const invalid = contentService(api, () => ({ status: 200, body: fixtures.emptyRevision(changed) }));
    await assert.rejects(invalid.readRevision(fixtures.readRequest()), remoteErrorCode("remote-response-invalid"));
  }
});

test("positive read revision requires exact record metadata and matching identifiers", async () => {
  const { api } = loadProduction();
  const valid = contentService(api, () => ({ status: 200, body: fixtures.positiveRevision() }));
  assert.equal((await valid.readRevision(fixtures.readRequest())).revision, 8);
  for (const changed of [
    { operationId: "other" },
    { syncedPocketId: "other" },
    { recordPresent: false },
    { contentFormat: "wrong" },
    { contentVersion: 2 },
    { encryptedRecordSize: 15 },
    { timestamp: "2030-01-01T00:00:00Z" },
  ]) {
    const invalid = contentService(api, () => ({ status: 200, body: fixtures.positiveRevision(changed) }));
    await assert.rejects(invalid.readRevision(fixtures.readRequest()), remoteErrorCode("remote-response-invalid"));
  }
});

test("download request requires a positive revision and valid response matches every identity", async () => {
  const { api } = loadProduction();
  const calls = [];
  const service = contentService(api, (route, body) => {
    calls.push([route, body]);
    return { status: 200, body: fixtures.downloadResponse() };
  });
  const result = await service.downloadEncryptedRecord(fixtures.downloadRequest());
  assert.equal(result.encryptedRecordSize, 32);
  assert.equal(result.encryptedRecord.format, "pocket.sync.content.opaque");
  assert.deepEqual(plain(calls), [["downloadEncryptedRecord", fixtures.downloadRequest()]]);
  await assert.rejects(
    service.downloadEncryptedRecord(fixtures.downloadRequest({ revision: 0 })),
    remoteErrorCode("remote-request-invalid")
  );
});

test("download rejects size, record, identifier, revision, canonicality, and readable fields", async () => {
  const { api } = loadProduction();
  const cases = [
    fixtures.downloadResponse({ encryptedRecordSize: 31 }),
    fixtures.downloadResponse({ operationId: "other" }),
    fixtures.downloadResponse({ syncedPocketId: "other" }),
    fixtures.downloadResponse({ revision: 7 }),
    fixtures.downloadResponse({ encryptedRecord: fixtures.encryptedRecord({ nonce: `${fixtures.encryptedRecord().nonce}=` }) }),
    fixtures.downloadResponse({ encryptedRecord: fixtures.encryptedRecord({ algorithm: "wrong" }) }),
    fixtures.downloadResponse({ plaintext: "READABLE POCKET SENTINEL" }),
  ];
  for (const body of cases) {
    const service = contentService(api, () => ({ status: 200, body }));
    await assert.rejects(service.downloadEncryptedRecord(fixtures.downloadRequest()), remoteErrorCode("remote-response-invalid"));
  }
});

test("conditional upload requires explicit API version and preserves P028 durable metadata exactly", async () => {
  const { api } = loadProduction();
  const calls = [];
  const service = contentService(api, (route, body) => {
    calls.push([route, body]);
    return { status: 200, body: fixtures.committed() };
  });
  const request = fixtures.uploadRequest();
  const before = JSON.stringify(request);
  const result = await service.conditionalUpload(request);
  assert.equal(result.status, "committed");
  assert.equal(result.revision, 8);
  assert.deepEqual(plain(calls), [["conditionalUpload", request]]);
  assert.equal(JSON.stringify(calls[0][1]), before);
  assert.equal(JSON.stringify(request), before);
  const missingVersion = fixtures.uploadRequest();
  delete missingVersion.apiVersion;
  await assert.rejects(service.conditionalUpload(missingVersion), remoteErrorCode("remote-request-invalid"));
  await assert.rejects(
    service.conditionalUpload(fixtures.uploadRequest({ readablePocket: "READABLE" })),
    remoteErrorCode("remote-request-invalid")
  );
});

test("P033 rejects an unadvanceable expected revision before transport", async () => {
  const { api } = loadProduction();
  let calls = 0;
  const service = contentService(api, () => {
    calls += 1;
    return { status: 200, body: fixtures.committed() };
  });

  await assert.rejects(
    service.conditionalUpload(fixtures.uploadRequest({
      expectedRevision: Number.MAX_SAFE_INTEGER,
    })),
    remoteErrorCode("remote-request-invalid")
  );
  assert.equal(calls, 0);
});

test("P033 accepts the final safe advance and rejects unsafe committed revisions", async () => {
  const { api } = loadProduction();
  let calls = 0;
  const finalSafe = contentService(api, () => {
    calls += 1;
    return {
      status: 200,
      body: fixtures.committed({ revision: Number.MAX_SAFE_INTEGER }),
    };
  });
  const result = await finalSafe.conditionalUpload(fixtures.uploadRequest({
    expectedRevision: Number.MAX_SAFE_INTEGER - 1,
  }));
  assert.equal(result.revision, Number.MAX_SAFE_INTEGER);
  assert.equal(calls, 1);

  const unsafe = contentService(api, () => ({
    status: 200,
    body: fixtures.committed({ revision: Number.MAX_SAFE_INTEGER + 1 }),
  }));
  await assert.rejects(
    unsafe.conditionalUpload(fixtures.uploadRequest()),
    remoteErrorCode("remote-response-invalid")
  );
});

test("committed and conflict bodies must agree with HTTP 200 and 409", async () => {
  const { api } = loadProduction();
  const committedService = contentService(api, () => ({ status: 200, body: fixtures.committed() }));
  assert.equal((await committedService.conditionalUpload(fixtures.uploadRequest())).wrote, true);
  const conflictService = contentService(api, () => ({ status: 409, body: fixtures.conflict() }));
  assert.deepEqual(
    JSON.parse(JSON.stringify(await conflictService.conditionalUpload(fixtures.uploadRequest()))),
    {
      ok: false,
      status: "conflict",
      wrote: false,
      conflict: true,
      actualRevision: 9,
      operationId: "upload-operation",
    }
  );
  const wrong200 = contentService(api, () => ({ status: 200, body: fixtures.conflict() }));
  await assert.rejects(wrong200.conditionalUpload(fixtures.uploadRequest()), remoteErrorCode("remote-response-invalid"));
  const wrong409 = contentService(api, () => ({ status: 409, body: fixtures.committed() }));
  await assert.rejects(wrong409.conditionalUpload(fixtures.uploadRequest()), remoteErrorCode("remote-response-invalid"));
});

test("conditional results enforce revision, operation identity, conflict ordering, and exact fields", async () => {
  const { api } = loadProduction();
  for (const body of [
    fixtures.committed({ revision: 9 }),
    fixtures.committed({ operationId: "other" }),
    fixtures.committed({ conflict: false }),
  ]) {
    const service = contentService(api, () => ({ status: 200, body }));
    await assert.rejects(service.conditionalUpload(fixtures.uploadRequest()), remoteErrorCode("remote-response-invalid"));
  }
  for (const body of [
    fixtures.conflict({ actualRevision: 7 }),
    fixtures.conflict({ operationId: "other" }),
    fixtures.conflict({ revision: 8 }),
  ]) {
    const service = contentService(api, () => ({ status: 409, body }));
    await assert.rejects(service.conditionalUpload(fixtures.uploadRequest()), remoteErrorCode("remote-response-invalid"));
  }
});

test("new changes cannot claim replay while idempotent retry may replay one revision", async () => {
  const { api } = loadProduction();
  const replay = contentService(api, () => ({ status: 200, body: fixtures.committed({ replayed: true }) }));
  await assert.rejects(replay.conditionalUpload(fixtures.uploadRequest()), remoteErrorCode("remote-response-invalid"));
  const retry = fixtures.uploadRequest({ attemptKind: "idempotent-retry" });
  const first = await replay.conditionalUpload(retry);
  assert.equal(first.replayed, true);
  assert.equal(first.revision, 8);
});

test("ambiguous post-dispatch failure is never retried or converted to success", async () => {
  const { api } = loadProduction();
  let calls = 0;
  const service = contentService(api, () => {
    calls += 1;
    const error = new Error("server may already have committed secret operation");
    throw error;
  });
  await assert.rejects(service.conditionalUpload(fixtures.uploadRequest()), (error) => {
    assert.equal(error.code, "remote-unavailable");
    assert.doesNotMatch(error.message, /committed secret operation/);
    return true;
  });
  assert.equal(calls, 1);
});

test("readable and PRF sentinels cannot enter accepted public remote shapes or errors", async () => {
  const { api } = loadProduction();
  const readable = "P032-READABLE-POCKET-MUST-NOT-CROSS";
  const service = contentService(api, () => ({ status: 200, body: fixtures.downloadResponse({ plaintext: readable }) }));
  await assert.rejects(service.downloadEncryptedRecord(fixtures.downloadRequest()), (error) => {
    assert.doesNotMatch(error.message, new RegExp(readable));
    return true;
  });
  assert.throws(() => api.validateReadRevisionRequest({ ...fixtures.readRequest(), notes: readable }), (error) => {
    assert.doesNotMatch(error.message, new RegExp(readable));
    return true;
  });
});

test("production source has no storage, token, worker, retry, logging, crypto, or owner machinery", () => {
  const moduleSource = source(MODULE_PATH);
  assert.doesNotMatch(moduleSource, /localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker|BroadcastChannel|SharedWorker|WebSocket|EventSource|XMLHttpRequest|setTimeout|setInterval|console\.|telemetry|oauth|provider.sdk/i);
  assert.doesNotMatch(moduleSource, /crypto\.subtle|\.encrypt\s*\(|\.decrypt\s*\(|setPocketFileSession|ownerKind|exportTree|Authorization\s*:/);
  assert.doesNotMatch(moduleSource, /while\s*\([^)]*(retry|attempt)|for\s*\([^)]*(retry|attempt)/i);
  assert.match(source("index.html"), /pocket-sync-remote-client\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-remote-client\.js/);
});
