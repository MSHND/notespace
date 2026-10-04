"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://pocket.murrayhenderson.com.au";
const SERVICE_ROOT = "/pocket-sync/v1";

function loadRemoteClient() {
  const context = {
    Object, Array, String, Boolean, Number, Error, Promise, Set, Map,
    Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, URL,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "js/pocket-sync-remote-client.js"), "utf8"),
    context,
    { filename: "pocket-sync-remote-client.js" }
  );
  return context.PocketSyncRemoteClient;
}

function jsonResponse(body = { apiVersion: 1, ok: true }, status = 200) {
  const responseText = JSON.stringify(body);
  return {
    status,
    redirected: false,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return "application/json";
        return null;
      },
    },
    body: null,
    async text() { return responseText; },
  };
}

function nodeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(body = null) { this.body = body; },
  };
}

test("P333 browser Sync POST policy preserves same-origin Origin semantics without widening transport", async () => {
  const api = loadRemoteClient();
  const calls = [];
  const transport = api.createBrowserJsonTransport({
    serviceRoot: SERVICE_ROOT,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse();
    },
  });

  await transport.request("beginAuthentication", {
    apiVersion: 1,
    operationId: "p333-operation",
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, SERVICE_ROOT + api.ROUTES.beginAuthentication);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.credentials, "same-origin");
  assert.equal(call.options.mode, "same-origin");
  assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.referrerPolicy, "same-origin");
  assert.deepEqual(
    Object.fromEntries(Object.entries(call.options.headers)),
    { Accept: "application/json", "Content-Type": "application/json" }
  );
  assert.equal(Object.hasOwn(call.options.headers, "Authorization"), false);
  assert.equal(api.POLICY.automaticRetry, false);
  assert.equal(api.POLICY.sameOriginOnly, true);

  for (const unsafeRoot of [
    "https://other.example/pocket-sync/v1",
    "//other.example/pocket-sync/v1",
    "/pocket-sync/v1?x=1",
    "/pocket-sync/v1#x",
  ]) {
    assert.throws(
      () => api.createBrowserJsonTransport({ serviceRoot: unsafeRoot, fetch: async () => jsonResponse() }),
      (error) => error && error.code === "remote-service-root-invalid"
    );
  }
});

test("P333 server boundary still rejects non-trusted Origin and non-same-origin Fetch Metadata", async () => {
  const adapterModule = require("../sync-service/pocket-sync-http-adapter.js");
  const createHttpAdapter = adapterModule.createHttpAdapter;
  const ROUTES = adapterModule.ROUTES;
  let coreCalls = 0;
  const core = Object.freeze(Object.fromEntries(Object.keys(ROUTES).map((name) => [
    name,
    async () => {
      coreCalls += 1;
      return Object.freeze({ status: 200, body: Object.freeze({ apiVersion: 1, ok: true }), session: null });
    },
  ])));
  const adapter = createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT });
  const target = ORIGIN + SERVICE_ROOT + ROUTES.readRevision;

  async function send(origin, fetchSite) {
    const headers = { "Content-Type": "application/json" };
    if (origin !== undefined) headers.Origin = origin;
    if (fetchSite !== undefined) headers["Sec-Fetch-Site"] = fetchSite;
    return adapter.handle(new Request(target, {
      method: "POST",
      headers,
      body: "{}",
    }));
  }

  assert.equal((await send("null", "same-origin")).status, 403);
  assert.equal((await send("https://other.example", "same-origin")).status, 403);
  assert.equal((await send(ORIGIN, undefined)).status, 403);
  assert.equal((await send(ORIGIN, "same-site")).status, 403);
  assert.equal(coreCalls, 0);

  assert.equal((await send(ORIGIN, "same-origin")).status, 200);
  assert.equal(coreCalls, 1);
});

test("P333 leaves private-alpha admission and production Referrer-Policy strict", async () => {
  const alphaModule = require("../sync-service/pocket-sync-private-alpha-gate.js");
  const policyModule = require("../sync-service/pocket-sync-production-security-policy.js");
  const ROUTES = require("../sync-service/pocket-sync-http-adapter.js").ROUTES;

  let downstream = 0;
  const gate = alphaModule.createPrivateAlphaGate({
    accessSecret: "p333-test-only-private-alpha-secret-000000",
    trustedOrigin: ORIGIN,
    serviceRoot: SERVICE_ROOT,
    async handler() { downstream += 1; },
  });
  const denied = nodeResponse();
  await gate({
    method: "POST",
    url: SERVICE_ROOT + ROUTES.beginAuthentication,
    headers: {},
  }, denied);
  assert.equal(denied.statusCode, 404);
  assert.equal(downstream, 0);

  const securedResponse = nodeResponse();
  const secured = policyModule.createProductionSecurityPolicy((_request, response) => response.end());
  await secured({}, securedResponse);
  assert.equal(securedResponse.headers["referrer-policy"], "same-origin");
  assert.equal(securedResponse.headers["content-security-policy"].includes("connect-src 'self'"), true);
});

test("P333 source contains one same-origin request-policy owner and does not weaken server checks", () => {
  const remote = fs.readFileSync(path.join(ROOT, "js/pocket-sync-remote-client.js"), "utf8");
  const adapter = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-http-adapter.js"), "utf8");
  const alpha = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-private-alpha-gate.js"), "utf8");
  const production = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-production-security-policy.js"), "utf8");

  assert.match(remote, /referrerPolicy:\s*"same-origin"/);
  assert.doesNotMatch(remote, /referrerPolicy:\s*"no-referrer"/);
  assert.match(remote, /mode:\s*"same-origin"/);
  assert.match(remote, /credentials:\s*POLICY\.credentials/);
  assert.match(remote, /redirect:\s*POLICY\.redirect/);

  assert.match(adapter, /origin !== trustedOrigin \|\| fetchSite !== "same-origin"/);
  assert.match(alpha, /if \(apiPath\(request\)\) return emptyResponse\(response, 404\);/);
  assert.match(production, /"referrer-policy": Object\.freeze\(\{ name: "Referrer-Policy", value: "same-origin" \}\)/);
});
