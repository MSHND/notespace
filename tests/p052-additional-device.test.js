"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

test("P052 remains dormant until explicitly created and PRF absence requires recovery before discovery or device mutation", async () => {
  const calls = [];
  const context = { Object, Array, Number, String, Boolean, Error, Promise, Uint8Array, Date };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/pocket-sync-additional-device.js"), "utf8"), context);
  assert.deepEqual(calls, []);
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: { generateDeviceWrappingKey() {}, deriveWrappingKey() {}, openMasterKeyBundle() {}, openContent() {}, sealContent() {}, encodeBase64Url() { return "opaque"; }, validateNonExtractableAesKey() {} },
    deviceStore: { open() {}, readPocket() {}, createPocket() {}, replacePocket() {} },
    accountClient: { async authenticatePasskey() { calls.push("authenticate"); return { ok: true, accountAuthenticated: true, contentUnlocked: false, accountId: "account", credentialId: "credential", prf: { status: "unavailable" } }; } },
    discoveryService: { async readSyncedPocket() { calls.push("discovery"); } },
    contentService: { async readRevision() {}, async downloadEncryptedRecord() {} },
    envelopeService: { async listEnvelopes() {}, async downloadEnvelope() {}, async addEnvelope() { calls.push("add"); } },
    randomBytes() { return new Uint8Array(32); }, now: () => 0,
  });
  const result = await opener.openExisting({
    captureTarget: () => ({ ownerKind: "none", id: 1 }), isTargetCurrent: () => true,
    validatePayload: () => true, adoptOpenedPocket: async () => true,
  });
  assert.equal(result.reason, "recovery-required");
  assert.deepEqual(calls, ["authenticate"]);
});
