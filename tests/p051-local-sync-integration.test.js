"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const { createLocalIntegrationHandler } = require("../sync-service/pocket-sync-local-integration-server.js");

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

test("P051 local host serves only reviewed browser assets, injects its local module and reserves the API root", async () => {
  let apiCalls = 0;
  const handler = createLocalIntegrationHandler({
    application: { async handle(_request, result) { apiCalls += 1; result.statusCode = 204; result.end(); } },
    browserRoot: ROOT,
    serviceRoot: "/pocket-sync/v1",
  });
  const index = await serve(handler, "GET", "/");
  assert.equal(index.statusCode, 200);
  assert.match(index.body.toString("utf8"), /pocket-sync-local-integration\.js/);
  assert.match(index.body.toString("utf8"), /pocket-sync-emergency-recovery\.js/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), /pocket-sync-local-integration\.js/);
  const head = await serve(handler, "HEAD", "/");
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, null);
  assert.equal((await serve(handler, "POST", "/")).statusCode, 405);
  for (const target of ["/../package.json", "/%2e%2e/package.json", "/js%5cpocket-sync-crypto.js", "/%00index.html", "/sync-service/pocket-sync-server.js"]) {
    assert.equal((await serve(handler, "GET", target)).statusCode, 404);
  }
  assert.equal((await serve(handler, "GET", "/pocket-sync/v1/account/passkeys/registration/begin")).statusCode, 204);
  assert.equal(apiCalls, 1);
  assert.match(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), /if \(request\.method !== "GET"\) return;/);
});

test("P054 local integration is inert until create and returns only explicit provider-neutral recovery operations", async () => {
  const calls = [];
  const payload = { mainThoughtTree: [{ id: "root", label: "saved" }] };
  const context = {
    Uint8Array, Buffer, Date, Object, Array, Number, String, Boolean, Error, Promise,
    document: { currentScript: { dataset: { serviceRoot: "/pocket-sync/v1" } } },
    crypto: { getRandomValues(bytes) { calls.push("random"); bytes.fill(7); return bytes; } },
    buildPocketPayload() { return payload; },
    hasPocketUnsavedChanges() { return false; },
    PocketDeviceChanges: { fingerprintDocument(value) { return JSON.stringify(value); } },
    PocketSyncCrypto: {
      FORMAT: { contentType: "portal.export.v1+json" },
      encodeBase64Url(bytes) { return Buffer.from(bytes).toString("base64url"); },
      async openMasterKeyBundle() { calls.push("open-master"); return { masterKey: {} }; },
      async openContent() { calls.push("open-content"); return payload; },
    },
    PocketSyncDeviceStore: {
      async open() { calls.push("store-open"); },
      async readStoredRecord() {
        return { remote: { pending: null, conflict: null }, deviceEnvelope: { record: {}, context: {} }, deviceWrappingKey: {} };
      },
    },
    PocketSyncRemoteClient: {
      createBrowserJsonTransport({ serviceRoot }) { calls.push(`transport:${serviceRoot}`); return {}; },
      createAccountService() { return {}; },
      createEnvelopeService() { return {}; },
      createRecoveryService() { return {}; },
      createContentService() {
        return {
          async readRevision() { calls.push("read-revision"); return { recordPresent: true, revision: 2 }; },
          async downloadEncryptedRecord() { calls.push("download"); return { encryptedRecord: {} }; },
        };
      },
    },
    PocketSyncBrowserRuntime: {
      createRuntime() {
        calls.push("runtime");
        return {
          async activate() { return { ok: true, owner: { ownerKind: "synced", syncedPocketId: "opaque-pocket" } }; },
          async resume() { return { ok: false }; },
          async recoverExisting() { return { ok: false, reason: "recovery-package-invalid" }; },
          async resumeRecovery(input) { return { ok: false, recoveryAttemptId: input.recoveryAttemptId }; },
          async findRecoveryAttempt() { return { ok: true }; },
        };
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/pocket-sync-local-integration.js"), "utf8"), context);
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(context.PocketSyncLocalIntegration), ["create"]);
  assert.equal(Object.isFrozen(context.PocketSyncLocalIntegration), true);
  const integration = context.PocketSyncLocalIntegration.create();
  assert.deepEqual(Object.keys(integration), ["activate", "resume", "openExisting", "recoverExisting", "resumeRecovery", "findRecoveryAttempt", "verifyRoundTrip"]);
  assert.equal(Object.isFrozen(integration), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await integration.verifyRoundTrip())), { ok: false, reason: "sync-not-activated" });
  assert.equal((await integration.activate()).ok, true);
  assert.equal((await integration.recoverExisting()).reason, "recovery-package-invalid");
  assert.deepEqual(JSON.parse(JSON.stringify(await integration.resumeRecovery({ recoveryAttemptId: "existing-recovery" }))), { ok: false, recoveryAttemptId: "existing-recovery" });
  assert.deepEqual(JSON.parse(JSON.stringify(await integration.verifyRoundTrip())), { ok: true, revision: 2, matchesCurrentSavedPocket: true });
  assert.equal(JSON.stringify(await integration.verifyRoundTrip()).includes("saved"), false);
  assert.equal(calls.includes("transport:/pocket-sync/v1"), true);
  assert.equal(calls.includes("open-master"), true);
  assert.equal(calls.includes("open-content"), true);
});
