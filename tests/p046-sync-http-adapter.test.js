"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { createHttpAdapter, POLICY, ROUTES } = require("../sync-service/pocket-sync-http-adapter.js");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";
const SERVICE_ROOT = "/pocket-sync/v1";
const NOW = Date.parse("2032-01-01T00:00:00.000Z");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function bytes(length, start = 1) {
  return Uint8Array.from({ length }, (_value, index) => (start + index) & 255);
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function randomBytes() {
  let call = 0;
  return (length) => bytes(length, ++call * 23);
}

function registrationCredential(id = b64(bytes(32, 121))) {
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

function authenticationCredential(id = b64(bytes(32, 121))) {
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

function encryptedRecord() {
  return {
    format: "pocket.sync.content.opaque",
    version: 1,
    algorithm: "AES-GCM-256",
    nonce: b64(bytes(12, 31)),
    ciphertext: b64(bytes(32, 61)),
  };
}

function createCoreHarness(options = {}) {
  const driver = createMemoryServiceStore();
  const core = createServiceCore({
    store: driver.store,
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) {
        return {
          credentialId: input.credential.id,
          publicKey: b64(bytes(64, 81)), publicKeyAlgorithm: -7, signCount: 0,
          transports: ["internal"], backupEligible: true, backedUp: false,
        };
      },
      async verifyAuthentication(input) {
        if (options.verifyAuthentication) return options.verifyAuthentication(input);
        return {
          credentialId: input.credential.id,
          signCount: input.storedCredential.signCount === 0 ? 1 : input.storedCredential.signCount + 1,
          backedUp: true,
        };
      },
    }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes: randomBytes(), now: () => NOW,
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket",
    credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
  });
  return { core, driver, adapter: createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT }) };
}

function request(route, body = {}, overrides = {}) {
  const headers = new Headers({
    Origin: ORIGIN,
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
    ...overrides.headers,
  });
  return new Request(`${ORIGIN}${SERVICE_ROOT}${ROUTES[route]}`, {
    method: overrides.method || "POST", headers,
    body: overrides.body === undefined ? JSON.stringify(body) : overrides.body,
  });
}

async function responseBody(response) {
  return response.json();
}

function loadBrowserClient() {
  const context = {
    Object, Array, Number, String, Boolean, JSON, Date, Error, Promise, Set,
    ArrayBuffer, Uint8Array, TextEncoder, TextDecoder,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  ["js/pocket-sync-security-contract.js", "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js"]
    .forEach((file) => vm.runInContext(source(file), context, { filename: file }));
  return { api: context.PocketSyncRemoteClient, context };
}

function browserFetchBridge(adapter) {
  let sessionCookie = "";
  const seenClientOptions = [];
  const fetch = async (url, options) => {
    seenClientOptions.push(options);
    const headers = new Headers(options.headers);
    headers.set("Origin", ORIGIN);
    headers.set("Sec-Fetch-Site", "same-origin");
    if (sessionCookie) headers.set("Cookie", sessionCookie);
    const result = await adapter.handle(new Request(`${ORIGIN}${url}`, {
      method: options.method, headers, body: options.body,
    }));
    const setCookie = result.headers.get("Set-Cookie");
    if (setCookie) sessionCookie = setCookie.split(";")[0];
    return result;
  };
  return { fetch, seenClientOptions, get sessionCookie() { return sessionCookie; } };
}

test("P046 exports only a frozen provider-neutral HTTP adapter surface", () => {
  assert.deepEqual(Object.keys(require("../sync-service/pocket-sync-http-adapter.js")), ["POLICY", "ROUTES", "createHttpAdapter"]);
  assert.equal(Object.isFrozen(POLICY), true);
  assert.equal(Object.isFrozen(ROUTES), true);
  assert.doesNotMatch(source("sync-service/pocket-sync-http-adapter.js"), /cloudflare|netlify|aws|vercel|express|fastify|next\.js|firebase|supabase/i);
  assert.doesNotMatch(source("index.html"), /pocket-sync-http-adapter\.js/);
  assert.doesNotMatch(source("sw.js"), /pocket-sync-http-adapter\.js/);
  const core = Object.fromEntries(Object.keys(ROUTES).map((method) => [method, async () => ({
    status: 200, body: { apiVersion: 1, ok: true }, session: null,
  })]));
  for (const serviceRoot of ["", "/", "https://other.example/v1", "//other/v1", "/v1?x=1", "/v1/%2e%2e", "/v1//x"]) {
    assert.throws(() => createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot }), /http-adapter-invalid/);
  }
  assert.throws(() => createHttpAdapter({ core, trustedOrigin: "http://sync.pocket.example", serviceRoot: SERVICE_ROOT }), /http-adapter-invalid/);
});

test("P046 maps real browser JSON transport through core, cookie session, and encrypted upload", async () => {
  const { adapter } = createCoreHarness();
  const browser = loadBrowserClient();
  const remote = browser.api;
  const bridge = browserFetchBridge(adapter);
  const transport = remote.createBrowserJsonTransport({ serviceRoot: SERVICE_ROOT, fetch: bridge.fetch });
  const begin = await transport.request("beginRegistration", {
    apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque",
  });
  const finish = await transport.request("finishRegistration", {
    apiVersion: 1, operationId: "register-operation", ceremonyId: begin.body.ceremonyId,
    deviceId: "device-opaque", credential: registrationCredential(),
  });
  assert.equal(finish.status, 200);
  assert.match(bridge.sessionCookie, /^__Host-pocket-sync-session=[A-Za-z0-9_-]{1,160}$/);
  assert.equal(JSON.stringify(finish.body).includes(bridge.sessionCookie.slice(28)), false);
  assert.equal(Object.hasOwn(bridge.seenClientOptions[1].headers, "Cookie"), false);
  const revision = await transport.request("readRevision", {
    apiVersion: 1, operationId: "read-operation", syncedPocketId: "pocket-opaque",
  });
  assert.equal(revision.body.revision, 0);
  const uploaded = await transport.request("conditionalUpload", {
    apiVersion: 1, syncedPocketId: "pocket-opaque", expectedRevision: 0,
    operationId: "upload-operation", logicalChangeId: "upload-change", attemptKind: "new-change",
    encryptedRecord: encryptedRecord(),
  });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.revision, 1);
  const conflictRequest = {
    apiVersion: 1, syncedPocketId: "pocket-opaque", expectedRevision: 0,
    operationId: "conflict-operation", logicalChangeId: "conflict-change", attemptKind: "new-change",
    encryptedRecord: encryptedRecord(),
  };
  const conflictTransport = await transport.request("conditionalUpload", conflictRequest);
  browser.context.__conflictRequest = JSON.stringify(conflictRequest);
  browser.context.__conflictResponse = JSON.stringify(conflictTransport.body);
  const conflict = vm.runInContext(
    "PocketSyncRemoteClient.validateConditionalUploadResponse(409, JSON.parse(__conflictResponse), JSON.parse(__conflictRequest))",
    browser.context
  );
  assert.deepEqual(JSON.parse(JSON.stringify(conflict)), {
    ok: false, status: "conflict", wrote: false, conflict: true,
    actualRevision: 1, operationId: "conflict-operation",
  });
});

test("P046 emits one secure HttpOnly host cookie and rotates it without fixation", async () => {
  const { adapter } = createCoreHarness();
  const firstBegin = await adapter.handle(request("beginRegistration", {
    apiVersion: 1, operationId: "register-operation", accountIntent: "create-or-add-credential", deviceId: "device-opaque",
  }));
  const first = await responseBody(firstBegin);
  const registration = await adapter.handle(request("finishRegistration", {
    apiVersion: 1, operationId: "register-operation", ceremonyId: first.ceremonyId,
    deviceId: "device-opaque", credential: registrationCredential(),
  }));
  const firstCookie = registration.headers.get("Set-Cookie");
  assert.match(firstCookie, /^__Host-pocket-sync-session=[A-Za-z0-9_-]+; Path=\/; Secure; HttpOnly; SameSite=Strict; Expires=/);
  assert.doesNotMatch(firstCookie, /Domain=/i);
  const firstSession = firstCookie.split(";")[0].slice("__Host-pocket-sync-session=".length);
  assert.equal(JSON.stringify(await responseBody(registration)).includes(firstSession), false);
  const authBegin = await adapter.handle(request("beginAuthentication", { apiVersion: 1, operationId: "auth-operation" }, {
    headers: { Cookie: firstCookie.split(";")[0] },
  }));
  const auth = await responseBody(authBegin);
  const rotated = await adapter.handle(request("finishAuthentication", {
    apiVersion: 1, operationId: "auth-operation", ceremonyId: auth.ceremonyId, credential: authenticationCredential(),
  }, { headers: { Cookie: firstCookie.split(";")[0] } }));
  const secondCookie = rotated.headers.get("Set-Cookie");
  const secondSession = secondCookie.split(";")[0].slice("__Host-pocket-sync-session=".length);
  assert.notEqual(secondSession, firstSession);
  const old = await adapter.handle(request("readRevision", { apiVersion: 1, operationId: "old-read", syncedPocketId: "pocket-opaque" }, {
    headers: { Cookie: `__Host-pocket-sync-session=${firstSession}` },
  }));
  assert.equal(old.status, 401);
  assert.match(old.headers.get("Set-Cookie"), /Max-Age=0/);
  const fresh = await adapter.handle(request("readRevision", { apiVersion: 1, operationId: "fresh-read", syncedPocketId: "pocket-opaque" }, {
    headers: { Cookie: `__Host-pocket-sync-session=${secondSession}` },
  }));
  assert.equal(fresh.status, 200);
});

test("P052i1 exposes indistinguishable discoverable credential failures without cookies", async () => {
  const { adapter } = createCoreHarness({ verifyAuthentication() {
    return { credentialId: b64(bytes(32, 201)), signCount: 1, backedUp: true };
  } });
  const registeredBegin = await adapter.handle(request("beginRegistration", {
    apiVersion: 1, operationId: "enumeration-register", accountIntent: "create-or-add-credential", deviceId: "device-opaque",
  }));
  const registrationBegin = await responseBody(registeredBegin);
  await adapter.handle(request("finishRegistration", { apiVersion: 1,
    operationId: "enumeration-register", ceremonyId: registrationBegin.ceremonyId,
    deviceId: "device-opaque", credential: registrationCredential(),
  }));
  async function failedFinish(operationId, credential) {
    const begun = await adapter.handle(request("beginAuthentication", { apiVersion: 1, operationId }));
    const begin = await responseBody(begun);
    const result = await adapter.handle(request("finishAuthentication", {
      apiVersion: 1, operationId, ceremonyId: begin.ceremonyId, credential,
    }));
    return { status: result.status, body: await responseBody(result), cookie: result.headers.get("Set-Cookie") };
  }
  const known = await failedFinish("enumeration-known", authenticationCredential());
  const unknown = await failedFinish("enumeration-unknown", authenticationCredential(b64(bytes(32, 211))));
  assert.deepEqual(unknown, known);
  assert.deepEqual(known, { status: 400, body: { apiVersion: 1, ok: false,
    reason: "service-authentication-failed" }, cookie: null });
});

test("P046 rejects request security failures before body/core work", async () => {
  let calls = 0;
  const core = Object.fromEntries(Object.keys(ROUTES).map((method) => [method, async () => {
    calls += 1; return { status: 200, body: { apiVersion: 1, ok: true }, session: null };
  }]));
  const adapter = createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT });
  const cases = [
    [request("readRevision", {}, { method: "GET", body: null }), 405],
    [request("readRevision", {}, { method: "OPTIONS", body: null }), 405],
    [request("readRevision", {}, { headers: { Origin: "https://other.example" } }), 403],
    [request("readRevision", {}, { headers: { Origin: "" } }), 403],
    [request("readRevision", {}, { headers: { "Sec-Fetch-Site": "cross-site" } }), 403],
    [request("readRevision", {}, { headers: { "Sec-Fetch-Site": "same-site" } }), 403],
    [request("readRevision", {}, { headers: { "Sec-Fetch-Site": "" } }), 403],
    [request("readRevision", {}, { headers: { "Content-Type": "text/plain" } }), 415],
    [request("readRevision", {}, { headers: { "Content-Encoding": "gzip" } }), 415],
    [request("readRevision", {}, { headers: { Authorization: "Bearer secret" } }), 400],
    [request("readRevision", {}, { headers: { Cookie: "__Host-pocket-sync-session=bad; __Host-pocket-sync-session=other" } }), 400],
    [request("readRevision", {}, { headers: { Cookie: "__Host-pocket-sync-session=\"quoted\"" } }), 400],
  ];
  for (const [input, status] of cases) assert.equal((await adapter.handle(input)).status, status);
  assert.equal((await adapter.handle(new Request(`${ORIGIN}${SERVICE_ROOT}/unknown`, {
    method: "POST", headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: "{}",
  }))).status, 404);
  assert.equal((await adapter.handle(new Request(`${ORIGIN}${SERVICE_ROOT}${ROUTES.readRevision}?x=1`, {
    method: "POST", headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: "{}",
  }))).status, 404);
  let bodyReads = 0;
  const preBodyRejected = {
    url: `${ORIGIN}${SERVICE_ROOT}${ROUTES.readRevision}`, method: "GET",
    headers: new Headers({ Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }),
    body: { getReader() { bodyReads += 1; throw new Error("body should remain unread"); } },
  };
  assert.equal((await adapter.handle(preBodyRejected)).status, 405);
  assert.equal(bodyReads, 0);
  assert.equal(calls, 0);
});

test("P046 bounds declared and streamed bodies and rejects malformed JSON without calling core", async () => {
  let calls = 0;
  const core = Object.fromEntries(Object.keys(ROUTES).map((method) => [method, async () => {
    calls += 1; return { status: 200, body: { apiVersion: 1, ok: true }, session: null };
  }]));
  const adapter = createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT });
  const declared = request("readRevision", {}, { headers: { "Content-Length": "262145" } });
  assert.equal((await adapter.handle(declared)).status, 413);
  let cancelled = false;
  const oversized = {
    url: `${ORIGIN}${SERVICE_ROOT}${ROUTES.readRevision}`, method: "POST",
    headers: new Headers({ Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }),
    body: { getReader() {
      let read = 0;
      return {
        async read() { return read++ === 0 ? { done: false, value: new Uint8Array(262145) } : { done: true }; },
        async cancel() { cancelled = true; },
      };
    } },
  };
  assert.equal((await adapter.handle(oversized)).status, 413);
  assert.equal(cancelled, true);
  const contentSized = await adapter.handle(request("conditionalUpload", {
    payload: "x".repeat(POLICY.smallJsonLimitBytes),
  }));
  assert.equal(contentSized.status, 200);
  for (const body of ["", "{", "[]", "null", "true"]) {
    assert.equal((await adapter.handle(request("readRevision", {}, { body }))).status, 400);
  }
  const invalidUtf8 = new Request(`${ORIGIN}${SERVICE_ROOT}${ROUTES.readRevision}`, {
    method: "POST", headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: new Uint8Array([0xc3, 0x28]),
  });
  assert.equal((await adapter.handle(invalidUtf8)).status, 400);
  assert.equal(calls, 1);
});

test("P046 bounds serialized core responses by their route-specific transport limit", async () => {
  const oversized = "x".repeat(POLICY.smallJsonLimitBytes);
  const core = Object.fromEntries(Object.keys(ROUTES).map((method) => [method, async () => ({
    status: 200, body: { apiVersion: 1, payload: oversized }, session: null,
  })]));
  const adapter = createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT });
  const ordinary = await adapter.handle(request("readRevision", {}));
  assert.equal(ordinary.status, 500);
  const content = await adapter.handle(request("downloadEncryptedRecord", {}));
  assert.equal(content.status, 200);
});

test("P046 dispatches each exact route once and preserves core conflicts", async () => {
  const calls = [];
  const core = Object.fromEntries(Object.keys(ROUTES).map((method) => [method, async (input) => {
    calls.push({ method, input });
    return method === "conditionalUpload"
      ? { status: 409, body: { apiVersion: 1, ok: false, status: "conflict" }, session: null }
      : { status: 200, body: { apiVersion: 1, ok: true }, session: null };
  }]));
  const adapter = createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT });
  for (const route of Object.keys(ROUTES)) {
    const response = await adapter.handle(request(route, {}));
    assert.equal(response.status, route === "conditionalUpload" ? 409 : 200);
  }
  assert.deepEqual(calls.map((item) => item.method), Object.keys(ROUTES));
  assert.deepEqual(Object.keys(calls[0].input.context), ["method", "origin", "fetchSite", "contentType", "sessionId"]);
});

test("P046 errors never echo readable or session-like sentinels", async () => {
  const readable = "READABLE-POCKET-NOTE-SENTINEL";
  const secret = "MASTER-KEY-SENTINEL";
  const session = "SESSION-SENTINEL";
  const core = Object.fromEntries(Object.keys(ROUTES).map((method) => [method, async () => {
    const error = new Error(`${readable} ${secret} ${session}`);
    error.code = "service-state-invalid";
    error.status = 500;
    throw error;
  }]));
  const adapter = createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT });
  const response = await adapter.handle(request("readRevision", { readable, secret }, {
    headers: { Cookie: `__Host-pocket-sync-session=${b64(bytes(32, 91))}` },
  }));
  const text = await response.text();
  assert.equal(response.status, 500);
  [readable, secret, session].forEach((value) => {
    assert.equal(text.includes(value), false);
    assert.equal([...response.headers.values()].join(" ").includes(value), false);
  });
});
