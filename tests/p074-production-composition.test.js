"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const {
  createLocalServerConfig,
  createProductionServerConfig,
} = require("../sync-service/pocket-sync-server-config.js");
const {
  createProductionIntegrationHandler,
  createProductionServer,
} = require("../sync-service/pocket-sync-production-server.js");
const { createSyncServerApplication } = require("../sync-service/pocket-sync-server-runtime.js");

const ROOT = path.resolve(__dirname, "..");
const SERVICE_ROOT = "/pocket-sync/v1";

function baseEnvironment(overrides = {}) {
  return {
    POCKET_SYNC_DATABASE_URL: "postgres://operator:secret@127.0.0.1/pocket",
    POCKET_SYNC_TRUSTED_ORIGIN: "https://pocket.murrayhenderson.com.au",
    POCKET_SYNC_RP_ID: "pocket.murrayhenderson.com.au",
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

async function serve(handler, method, url) {
  const result = response();
  await handler({ method, url }, result);
  return result;
}

test("P074 separates production application config from local HTTPS listener TLS", () => {
  const production = createProductionServerConfig({ environment: baseEnvironment({ PORT: "43123" }) });
  assert.deepEqual(production.listen, { host: "0.0.0.0", port: 43123 });
  assert.equal(Object.hasOwn(production.runtime, "tls"), false);
  assert.equal(Object.hasOwn(production.application, "tls"), false);
  assert.doesNotThrow(() => createProductionServerConfig({
    environment: baseEnvironment({
      POCKET_SYNC_TLS_CERT_FILE: "not-read.pem",
      POCKET_SYNC_TLS_KEY_FILE: "not-read.key",
    }),
  }));

  const local = createLocalServerConfig({
    environment: baseEnvironment({
      POCKET_SYNC_TLS_CERT_FILE: "cert.pem",
      POCKET_SYNC_TLS_KEY_FILE: "key.pem",
    }),
    readFile(file) { return new Uint8Array(file === "cert.pem" ? [1, 2] : [3, 4]); },
  });
  assert.deepEqual(local.listen, { host: "127.0.0.1", port: 8443 });
  assert.equal(Object.hasOwn(local.runtime, "tls"), false);
  assert.deepEqual([...local.tls.cert], [1, 2]);
  assert.deepEqual([...local.tls.key], [3, 4]);
  assert.throws(() => createSyncServerApplication({ ...production.runtime, tls: { cert: "x", key: "y" } }),
    (error) => error?.code === "sync-server-runtime-failed");
});

test("P074 production config enforces exact HTTPS origin, RP identity and 0.0.0.0 PORT", () => {
  for (const overrides of [
    { POCKET_SYNC_TRUSTED_ORIGIN: "http://pocket.murrayhenderson.com.au" },
    { POCKET_SYNC_TRUSTED_ORIGIN: "https://other.example" },
    { POCKET_SYNC_RP_ID: "other.example" },
    { PORT: undefined },
    { PORT: "0" },
    { PORT: "65536" },
    { PORT: "3000.5" },
    { POCKET_SYNC_SERVICE_ROOT: "https://other.example/api" },
  ]) {
    assert.throws(() => createProductionServerConfig({ environment: baseEnvironment(overrides) }),
      (error) => error?.code === "sync-server-config-invalid");
  }
  const defaults = createProductionServerConfig({ environment: baseEnvironment() });
  assert.deepEqual(defaults.listen, { host: "0.0.0.0", port: 3000 });
  assert.equal(defaults.runtime.rpName, "Pocket");
  assert.equal(defaults.runtime.serviceRoot, SERVICE_ROOT);
});

test("P074 production composition keeps origin and RP decisions on configured values", () => {
  const source = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-production-server.js"), "utf8");
  assert.match(source, /createSyncServerApplication\(config\.runtime\)/);
  assert.doesNotMatch(source, /X-Forwarded-(?:Host|Proto)|request\.headers\.host|headers\.host/i);
  const config = createProductionServerConfig({ environment: baseEnvironment() });
  assert.equal(config.runtime.trustedOrigin, "https://pocket.murrayhenderson.com.au");
  assert.equal(config.runtime.rpId, "pocket.murrayhenderson.com.au");
});

test("P074 production composition serves reviewed same-origin assets, external bootstrap and API", async () => {
  let apiCalls = 0;
  const handler = createProductionIntegrationHandler({
    application: {
      async handle(_request, result) { apiCalls += 1; result.statusCode = 204; result.end(); },
    },
    browserRoot: ROOT,
    serviceRoot: SERVICE_ROOT,
  });
  const index = await serve(handler, "GET", "/");
  const indexText = index.body.toString("utf8");
  assert.equal(index.statusCode, 200);
  assert.match(indexText, /pocket-sync-additional-device\.js/);
  assert.match(indexText, /pocket-sync-emergency-recovery\.js/);
  assert.match(indexText, /pocket-sync-production-bootstrap\.js/);
  assert.match(indexText, /data-service-root="\/pocket-sync\/v1"/);
  assert.doesNotMatch(indexText, /<script>\s*window\./);
  assert.equal(index.headers["cache-control"], "no-store");
  assert.equal(index.headers["x-content-type-options"], "nosniff");
  assert.equal((await serve(handler, "GET", "/js/pocket-sync-production-bootstrap.js")).statusCode, 200);
  assert.equal((await serve(handler, "GET", `${SERVICE_ROOT}/account/passkeys/registration/begin`)).statusCode, 204);
  assert.equal(apiCalls, 1);
  for (const pathName of [
    "/package.json", "/tests/p074-production-composition.test.js", "/../package.json",
    "/%2e%2e/package.json", "/index.html?file=package.json", "/js%5cpocket-sync-crypto.js",
  ]) assert.equal((await serve(handler, "GET", pathName)).statusCode, 404, pathName);
  assert.equal((await serve(handler, "POST", "/")).statusCode, 405);
});

test("P074 production bootstrap delegates to the existing Sync integration/UI owner", () => {
  let calls = 0;
  const context = {
    PocketSyncBrowserIntegration: { create() { calls += 1; } },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/pocket-sync-production-bootstrap.js"), "utf8"), context);
  assert.equal(calls, 1);
});

test("P074 production listener validates 0.0.0.0 and closes the application conservatively", async () => {
  const state = { listen: null, closes: 0, preflights: 0, applicationCloses: 0 };
  class ControlledServer extends EventEmitter {
    listen(port, host, callback) { state.listen = { port, host }; callback(); }
    close(callback) { state.closes += 1; callback(); }
  }
  const application = {
    async handle() {},
    async preflight() { state.preflights += 1; },
    async close() { state.applicationCloses += 1; },
  };
  const server = createProductionServer({
    application,
    browserRoot: ROOT,
    serviceRoot: SERVICE_ROOT,
    listen: { host: "0.0.0.0", port: 43123 },
    http: { createServer() { return new ControlledServer(); } },
  });
  await server.listen();
  assert.deepEqual(state.listen, { host: "0.0.0.0", port: 43123 });
  assert.equal(state.preflights, 1);
  await server.close();
  await server.close();
  assert.equal(state.closes, 1);
  assert.equal(state.applicationCloses, 1);
  assert.throws(() => createProductionServer({
    application, browserRoot: ROOT, serviceRoot: SERVICE_ROOT,
    listen: { host: "127.0.0.1", port: 43123 }, http: { createServer() {} },
  }), (error) => error?.code === "sync-production-composition-failed");
});
