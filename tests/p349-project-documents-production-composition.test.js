"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createPrivateAlphaGate } = require("../sync-service/pocket-sync-private-alpha-gate.js");
const {
  createProductionIntegrationHandler,
  createProductionRequestHandler,
  createProductionServer,
} = require("../sync-service/pocket-sync-production-server.js");

const BROWSER_ROOT = path.resolve(__dirname, "..");
const SERVICE_ROOT = "/pocket-sync/v1";
const TRUSTED_ORIGIN = "https://pocket.example";
const ACCESS_SECRET = "p349-private-alpha-secret-that-is-long-enough";

function application() {
  return {
    async handle(_request, response) {
      response.statusCode = 299;
      response.end("sync");
    },
    async preflight() { return true; },
    async close() { return true; },
  };
}

function request(url, method = "GET") {
  return { url, method, headers: {}, rawHeaders: [] };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    headers,
    body: Buffer.alloc(0),
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(body) { this.body = body ? Buffer.from(body) : Buffer.alloc(0); },
  };
}

function snapshot(res) {
  return {
    statusCode: res.statusCode,
    headers: [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
    body: res.body.toString("base64"),
  };
}

function oldProductionRequestHandler(app) {
  const integration = createProductionIntegrationHandler({
    application: app,
    browserRoot: BROWSER_ROOT,
    serviceRoot: SERVICE_ROOT,
  });
  return createPrivateAlphaGate({
    accessSecret: ACCESS_SECRET,
    trustedOrigin: TRUSTED_ORIGIN,
    serviceRoot: SERVICE_ROOT,
    handler: integration,
  });
}

test("P349 optional project-document route is dispatched before private-alpha browser/sync handling", async () => {
  const calls = [];
  const projectDocuments = {
    matches(req) { return req.url === "/project-docs/mcp"; },
    async handle(_req, res) {
      calls.push("project");
      res.statusCode = 204;
      res.setHeader("X-P349", "project-docs");
      res.end();
      return true;
    },
    async preflight() { return true; },
    async close() { return true; },
  };
  const handler = createProductionRequestHandler({
    application: application(),
    browserRoot: BROWSER_ROOT,
    serviceRoot: SERVICE_ROOT,
    privateAlpha: { accessSecret: ACCESS_SECRET, trustedOrigin: TRUSTED_ORIGIN },
    projectDocuments,
  });

  const res = response();
  await handler(request("/project-docs/mcp", "POST"), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.getHeader("x-p349"), "project-docs");
  assert.deepEqual(calls, ["project"]);
});

test("P349 non-project requests preserve the exact existing private-alpha/browser/sync path", async () => {
  const appA = application();
  const appB = application();
  const oldHandler = oldProductionRequestHandler(appA);
  const projectDocuments = {
    matches() { return false; },
    async handle() { throw new Error("must not run"); },
    async preflight() { return true; },
    async close() { return true; },
  };
  const newHandler = createProductionRequestHandler({
    application: appB,
    browserRoot: BROWSER_ROOT,
    serviceRoot: SERVICE_ROOT,
    privateAlpha: { accessSecret: ACCESS_SECRET, trustedOrigin: TRUSTED_ORIGIN },
    projectDocuments,
  });

  for (const [url, method] of [
    ["/", "GET"],
    ["/pocket-alpha", "GET"],
    ["/pocket-sync/v1/object", "GET"],
    ["/styles.css", "GET"],
  ]) {
    const before = response();
    const after = response();
    await oldHandler(request(url, method), before);
    await newHandler(request(url, method), after);
    assert.deepEqual(snapshot(after), snapshot(before), method + " " + url);
  }
});

test("P349 production server remains startable with project documents absent", async () => {
  const calls = [];
  const app = {
    async handle(_request, response) { response.statusCode = 200; response.end(); },
    async preflight() { calls.push("sync-preflight"); return true; },
    async close() { calls.push("sync-close"); return true; },
  };
  const fakeHttp = {
    createServer(handler) {
      assert.equal(typeof handler, "function");
      return {
        listen(port, host, callback) {
          calls.push(["listen", port, host]);
          callback();
        },
        close(callback) {
          calls.push("server-close");
          callback();
        },
      };
    },
  };

  const server = createProductionServer({
    application: app,
    browserRoot: BROWSER_ROOT,
    serviceRoot: SERVICE_ROOT,
    listen: { host: "0.0.0.0", port: 10000 },
    privateAlpha: { accessSecret: ACCESS_SECRET, trustedOrigin: TRUSTED_ORIGIN },
    http: fakeHttp,
  });
  await server.listen();
  await server.close();

  assert.deepEqual(calls, [
    "sync-preflight",
    ["listen", 10000, "0.0.0.0"],
    "server-close",
    "sync-close",
  ]);
});
