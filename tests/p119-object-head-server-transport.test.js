"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { ROUTES, createHttpAdapter } = require("../sync-service/pocket-sync-http-adapter.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";

function objectHeadStore() {
  return Object.freeze({
    async putObject() { return { ok: true, created: true }; }, async getObject() { return null; },
    async presence(_id, refs) { return refs.map((storageRef) => ({ storageRef, present: false })); },
    async initialiseHead() { return Object.freeze({ schema: "pocket.starling.head.v1", revision: 0, sealRef: null }); },
    async readHead() { return null; }, async compareAndSetHead() { return { ok: false, reason: "head-conflict" }; },
  });
}

function coreConfig(overrides = {}) {
  return {
    store: Object.freeze({ async transact(_mode, callback) { return callback(Object.freeze({ async get() { return null; }, async insert() {}, async replace() {}, async remove() {} })); } }),
    objectHeadStore: objectHeadStore(),
    webAuthnVerifier: Object.freeze({ async verifyRegistration() {}, async verifyAuthentication() {} }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() {} }), randomBytes() { return new Uint8Array(32); }, now() { return Date.parse("2032-01-01T00:00:00.000Z"); },
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket", credentialAlgorithms: [-7], ceremonyLifetimeMs: 300000, sessionLifetimeMs: 2592000000,
    ...overrides,
  };
}

function invocation(body) {
  return { context: { method: "POST", origin: ORIGIN, fetchSite: "same-origin", contentType: "application/json", sessionId: null }, body };
}

test("P119 requires the exact object/Head store surface and rejects unauthenticated calls", async () => {
  const config = coreConfig();
  for (const candidate of [undefined, {}, { ...objectHeadStore(), extra() {} },
    { ...objectHeadStore(), putObject: null }]) {
    assert.throws(() => createServiceCore({ ...config, objectHeadStore: candidate }), /service-core-invalid/);
  }
  const core = createServiceCore(config);
  for (const [method, body] of [
    ["putOpaqueObject", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", storageRef: "opaque", record: {} }],
    ["getOpaqueObject", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", storageRef: "opaque" }],
    ["objectPresence", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", storageRefs: [] }],
    ["initialiseShadowHead", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket" }],
    ["readShadowHead", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket" }],
    ["compareAndSetShadowHead", { apiVersion: 1, operationId: "op", syncedPocketId: "pocket", expectedHead: {}, candidateSealStorageRef: "opaque" }],
  ]) await assert.rejects(core[method](invocation(body)), (error) => error?.code === "service-authentication-required");
});

test("P119 keeps the transport contract bounded and maps safe object-store errors", async () => {
  const coreSource = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-service-core.js"), "utf8");
  const adapterSource = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-http-adapter.js"), "utf8");
  const runtimeSource = fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-server-runtime.js"), "utf8");
  assert.match(coreSource, /object-head-store-state-invalid[\s\S]*service-state-invalid/);
  assert.match(coreSource, /object-head-store-storage-failed[\s\S]*service-storage-failed/);
  assert.match(adapterSource, /putOpaqueObject[\s\S]*contentJsonLimitBytes/);
  assert.match(adapterSource, /getOpaqueObject[\s\S]*contentJsonLimitBytes/);
  assert.match(adapterSource, /compareAndSetShadowHead[\s\S]*Object\.freeze\(\[200, 409\]\)/);
  assert.match(runtimeSource, /createPostgresStore\(\{ pool \}\)[\s\S]*createObjectHeadPostgresStore\(\{ pool \}\)/);
  assert.doesNotMatch([coreSource, adapterSource].join("\n"), /deleteOpaqueObject|updateOpaqueObject|listOpaqueObject|forceSetHead|deleteHead/);
});

test("P119 exposes exactly six authenticated POST transport routes without browser adoption", () => {
  assert.deepEqual(Object.entries(ROUTES).filter(([name]) => /Object|Presence|ShadowHead/.test(name)), [
    ["putOpaqueObject", "/pockets/objects/put"], ["getOpaqueObject", "/pockets/objects/get"], ["objectPresence", "/pockets/objects/presence"],
    ["initialiseShadowHead", "/pockets/head/initialise"], ["readShadowHead", "/pockets/head/read"], ["compareAndSetShadowHead", "/pockets/head/compare-and-set"],
  ]);
  const core = Object.fromEntries(Object.keys(ROUTES).map((name) => [name, async () => ({ status: 200, body: { apiVersion: 1, ok: true }, session: null })]));
  assert.doesNotThrow(() => createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: "/pocket-sync/v1" }));
  const browser = ["js/pocket-sync-remote-client.js", "js/pocket-sync-owner-controller.js", "index.html"].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  assert.doesNotMatch(browser, /pockets\/(objects|head)/);
});
