"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const {
  createLocalServerConfig,
  createProductionServerConfig,
} = require("../sync-service/pocket-sync-server-config.js");
const { createProductionServer } = require("../sync-service/pocket-sync-production-server.js");
const { createPrivateAlphaGate } = require("../sync-service/pocket-sync-private-alpha-gate.js");

const ORIGIN = "https://pocket.murrayhenderson.com.au";
const SERVICE_ROOT = "/pocket-sync/v1";
const TEST_SECRET = "test-only-private-alpha-code-0123456789";
const ROTATED_TEST_SECRET = "rotated-test-only-private-alpha-9876543210";
const START_TIME = Date.parse("2042-01-01T00:00:00.000Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function environment(overrides = {}) {
  return {
    POCKET_SYNC_DATABASE_URL: "postgres://operator:secret@127.0.0.1/pocket",
    POCKET_SYNC_TRUSTED_ORIGIN: ORIGIN,
    POCKET_SYNC_RP_ID: "pocket.murrayhenderson.com.au",
    POCKET_ALPHA_ACCESS_SECRET: TEST_SECRET,
    PORT: "3000",
    ...overrides,
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? null : Buffer.from(value); },
  };
}

function request(method, url, options = {}) {
  const body = options.body === undefined ? Buffer.alloc(0) : Buffer.from(options.body, "utf8");
  const stream = Readable.from(body.byteLength > 0 ? [body] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = {};
  const rawHeaders = [];
  for (const [name, value] of Object.entries(options.headers || {})) {
    stream.headers[name.toLowerCase()] = value;
    if (Array.isArray(value)) {
      for (const item of value) rawHeaders.push(name, item);
    } else {
      rawHeaders.push(name, value);
    }
  }
  if (options.body !== undefined && stream.headers["content-length"] === undefined) {
    stream.headers["content-length"] = String(body.byteLength);
    rawHeaders.push("Content-Length", String(body.byteLength));
  }
  stream.rawHeaders = options.rawHeaders || rawHeaders;
  return stream;
}

async function send(handler, input) {
  const result = response();
  await handler(input, result);
  return result;
}

function gateHarness(secret = TEST_SECRET) {
  let currentTime = START_TIME;
  const downstream = [];
  const handler = createPrivateAlphaGate({
    accessSecret: secret,
    trustedOrigin: ORIGIN,
    serviceRoot: SERVICE_ROOT,
    now() { return currentTime; },
    randomBytes(length) { return Uint8Array.from({ length }, (_value, index) => index + 1); },
    async handler(input, result) {
      downstream.push({ method: input.method, url: input.url });
      result.statusCode = input.url.startsWith(SERVICE_ROOT) ? 204 : 200;
      result.end(input.method === "HEAD" ? undefined : "P074 owner");
    },
  });
  return {
    handler,
    downstream,
    advance(milliseconds) { currentTime += milliseconds; },
  };
}

async function admit(handler, secret = TEST_SECRET, overrides = {}) {
  const body = `accessCode=${encodeURIComponent(secret)}`;
  return send(handler, request("POST", "/pocket-alpha/access", {
    ...overrides,
    body: overrides.body === undefined ? body : overrides.body,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(overrides.headers || {}),
    },
  }));
}

function cookiePair(result) {
  return String(result.headers["set-cookie"] || "").split(";", 1)[0];
}

test("P075 production config owns a bounded alpha secret outside Sync application config", () => {
  const config = createProductionServerConfig({ environment: environment() });
  assert.equal(config.productionShell.alphaAccessSecret, TEST_SECRET);
  assert.equal(Object.hasOwn(config.runtime, "alphaAccessSecret"), false);
  assert.equal(Object.hasOwn(config.application, "alphaAccessSecret"), false);
  assert.equal(JSON.stringify(config.runtime).includes(TEST_SECRET), false);
  for (const value of [undefined, "", "short", ` ${TEST_SECRET}`, "x".repeat(31), "x".repeat(513), "é".repeat(257)]) {
    assert.throws(() => createProductionServerConfig({
      environment: environment({ POCKET_ALPHA_ACCESS_SECRET: value }),
    }), (error) => error?.code === "sync-server-config-invalid");
  }

  const localEnvironment = environment({
    POCKET_ALPHA_ACCESS_SECRET: undefined,
    POCKET_SYNC_TLS_CERT_FILE: "cert.pem",
    POCKET_SYNC_TLS_KEY_FILE: "key.pem",
  });
  const local = createLocalServerConfig({
    environment: localEnvironment,
    readFile(file) { return new Uint8Array(file === "cert.pem" ? [1] : [2]); },
  });
  assert.equal(local.runtime.trustedOrigin, ORIGIN);
  assert.equal(Object.hasOwn(local, "productionShell"), false);
  assert.throws(() => createProductionServer({
    application: { async handle() {}, async preflight() {}, async close() {} },
    browserRoot: "/test/browser-root",
    serviceRoot: SERVICE_ROOT,
    listen: { host: "0.0.0.0", port: 3000 },
  }), (error) => error?.code === "sync-production-composition-failed");
});

test("P075 doorway accepts only an exact-origin bounded form and never reveals the code", async () => {
  const harness = gateHarness();
  const doorway = await send(harness.handler, request("GET", "/pocket-alpha"));
  assert.equal(doorway.statusCode, 200);
  assert.match(doorway.body.toString("utf8"), /<form method="post" action="\/pocket-alpha\/access">/);
  assert.doesNotMatch(doorway.body.toString("utf8"), /Pocket|Sync/);
  assert.equal(doorway.headers["cache-control"], "no-store");
  assert.equal(doorway.headers["x-content-type-options"], "nosniff");

  const wrong = await admit(harness.handler, "wrong-test-only-code-0123456789012345");
  assert.equal(wrong.statusCode, 403);
  assert.equal(Object.hasOwn(wrong.headers, "set-cookie"), false);
  assert.equal(wrong.body.toString("utf8").includes(TEST_SECRET), false);

  for (const input of [
    request("POST", "/pocket-alpha/access", {
      body: `accessCode=${encodeURIComponent(TEST_SECRET)}`,
      headers: { Origin: "https://wrong.example", "X-Forwarded-Host": "pocket.murrayhenderson.com.au", "X-Forwarded-Proto": "https", "Content-Type": "application/x-www-form-urlencoded" },
    }),
    request("POST", "/pocket-alpha/access", {
      body: `accessCode=${encodeURIComponent(TEST_SECRET)}`,
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    }),
    request("POST", "/pocket-alpha/access", {
      body: `accessCode=${encodeURIComponent(TEST_SECRET)}&accessCode=duplicate`,
      headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
    }),
    request("POST", "/pocket-alpha/access", {
      body: `accessCode=${encodeURIComponent(TEST_SECRET)}&extra=value`,
      headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
    }),
    request("POST", "/pocket-alpha/access", {
      body: `accessCode=${"x".repeat(1100)}`,
      headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
    }),
  ]) {
    const rejected = await send(harness.handler, input);
    assert.ok([400, 403].includes(rejected.statusCode));
    assert.equal(Object.hasOwn(rejected.headers, "set-cookie"), false);
    assert.equal(JSON.stringify(rejected).includes(TEST_SECRET), false);
  }

  const accepted = await admit(harness.handler);
  assert.equal(accepted.statusCode, 303);
  assert.equal(accepted.headers.location, "/");
  assert.match(accepted.headers["set-cookie"], /^__Host-pocket-alpha-access=[A-Za-z0-9_.-]+; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800; Expires=/);
  assert.equal(accepted.headers["set-cookie"].includes(TEST_SECRET), false);
  assert.equal(JSON.stringify(accepted).includes(TEST_SECRET), false);
  assert.equal(harness.downstream.length, 0);
});

test("P075 gate blocks Pocket and every Sync route until a valid admission cookie", async () => {
  const harness = gateHarness();
  for (const input of [
    request("GET", "/"),
    request("HEAD", "/index.html"),
    request("POST", `${SERVICE_ROOT}/account/passkeys/registration/begin`),
    request("POST", `${SERVICE_ROOT}/account/passkeys/authentication/begin`),
    request("POST", `${SERVICE_ROOT}/account/recovery/begin`),
    request("POST", `${SERVICE_ROOT}/pockets/content/download`),
    request("POST", `${SERVICE_ROOT}/pockets/envelopes/list`),
  ]) {
    const rejected = await send(harness.handler, input);
    if (input.url === "/" || input.url === "/index.html") {
      assert.equal(rejected.statusCode, 303);
      assert.equal(rejected.headers.location, "/pocket-alpha");
    } else {
      assert.equal(rejected.statusCode, 404);
    }
  }
  assert.deepEqual(harness.downstream, []);

  const staticAsset = await send(harness.handler, request("GET", "/js/pocket-sync-production-bootstrap.js"));
  assert.equal(staticAsset.statusCode, 200);
  assert.deepEqual(harness.downstream, [{ method: "GET", url: "/js/pocket-sync-production-bootstrap.js" }]);
  harness.downstream.length = 0;

  const accepted = await admit(harness.handler);
  const alphaCookie = cookiePair(accepted);
  const admittedRoot = await send(harness.handler, request("GET", "/", {
    headers: { Cookie: `${alphaCookie}; __Host-pocket-sync-session=separate-sync-cookie` },
  }));
  assert.equal(admittedRoot.statusCode, 200);
  const admittedApi = await send(harness.handler, request("POST", `${SERVICE_ROOT}/pockets/revision/read`, {
    headers: { Cookie: alphaCookie, Host: "wrong.example", "X-Forwarded-Host": "wrong.example", "X-Forwarded-Proto": "http" },
  }));
  assert.equal(admittedApi.statusCode, 204);
  assert.deepEqual(harness.downstream, [
    { method: "GET", url: "/" },
    { method: "POST", url: `${SERVICE_ROOT}/pockets/revision/read` },
  ]);
  const alreadyAdmitted = await send(harness.handler, request("GET", "/pocket-alpha", { headers: { Cookie: alphaCookie } }));
  assert.equal(alreadyAdmitted.statusCode, 303);
  assert.equal(alreadyAdmitted.headers.location, "/");
});

test("P075 admission cookies fail closed when malformed, duplicated, forged, expired or rotated", async () => {
  const harness = gateHarness();
  const accepted = await admit(harness.handler);
  const alphaCookie = cookiePair(accepted);
  const token = alphaCookie.slice(alphaCookie.indexOf("=") + 1);
  const forgedToken = `${token.slice(0, -10)}${token.at(-10) === "A" ? "B" : "A"}${token.slice(-9)}`;
  for (const cookie of [
    "__Host-pocket-alpha-access=malformed",
    `__Host-pocket-alpha-access=${forgedToken}`,
    `${alphaCookie}; ${alphaCookie}`,
  ]) {
    const rejected = await send(harness.handler, request("POST", `${SERVICE_ROOT}/pockets/revision/read`, {
      headers: { Cookie: cookie },
    }));
    assert.equal(rejected.statusCode, 404);
  }
  assert.deepEqual(harness.downstream, []);

  harness.advance(WEEK_MS + 1000);
  const expired = await send(harness.handler, request("GET", "/", { headers: { Cookie: alphaCookie } }));
  assert.equal(expired.statusCode, 303);
  assert.equal(expired.headers.location, "/pocket-alpha");
  assert.deepEqual(harness.downstream, []);

  const rotated = gateHarness(ROTATED_TEST_SECRET);
  const oldCookie = await send(rotated.handler, request("POST", `${SERVICE_ROOT}/pockets/revision/read`, {
    headers: { Cookie: alphaCookie },
  }));
  assert.equal(oldCookie.statusCode, 404);
  assert.deepEqual(rotated.downstream, []);
});
