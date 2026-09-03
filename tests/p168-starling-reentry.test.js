"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function completedRecord() {
  return {
    kind: "pocket.sync.device-state", schemaVersion: 5, syncedPocketId: "pocket", deviceId: "device",
    storeRevision: 1, activationDraft: null, additionalDeviceDraft: null, recoveryDraft: null,
    usage: { masterKeyGeneration: 1, masterKeyContentEncryptions: 0,
      masterKeyContentEncryptionLimit: 2 ** 20, deviceWrappingKeyEncryptions: 0 },
    remote: { confirmedRevision: 1, pending: null, conflict: null },
    content: { context: { syncedPocketId: "pocket", revision: 1,
      contentType: "portal.export.v1+json" }, record: { rollback: true } },
    deviceEnvelope: {
      metadata: { contractVersion: 1, syncedPocketId: "pocket", envelopeId: "envelope",
        kind: "device", version: 1, deviceId: "device", createdAt: "2045-01-01T00:00:00.000Z", kdf: "none" },
      context: { syncedPocketId: "pocket", envelopeId: "envelope", envelopeKind: "device", envelopeVersion: 1 },
      record: { envelope: true },
    },
  };
}

function load() {
  let random = 0;
  const state = { openContentCalls: 0, adopted: null, authorityReads: 0, rollbackDownloads: 0 };
  const materialized = { schema: "portal.export.v1", writtenAt: "2046-01-01T00:00:00.000Z",
    nodes: [{ id: "starling-node", parentId: "root", order: 0, label: "STARLING CURRENT" }],
    tombstones: [], rootExtras: {}, dataExtras: {} };
  const context = {
    Uint8Array, Object, Array, Number, String, Boolean, Date, Promise, Error, JSON,
    PocketStarlingRemoteOpenShadow: { createRemoteOpener() { return { async openRemote(input) {
      assert.equal(input.context.syncedPocketId, "pocket");
      assert.deepEqual(input.semanticAuthority, { semantic: true });
      return { outcome: "opened", head: { schema: "pocket.starling.head.v1", revision: 7,
        sealRef: "live-starling-seal" }, session: { materialized } };
    } }; } },
    PocketStarlingMaterializeShadow: { async materializeAccepted(session) {
      return { ok: true, document: session.materialized };
    } },
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-additional-device.js"), context,
    { filename: "js/pocket-sync-additional-device.js" });
  const record = completedRecord();
  const opener = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: {
      FORMAT: { contentType: "portal.export.v1+json" },
      async generateDeviceWrappingKey() { return {}; }, async deriveWrappingKey() { return {}; },
      async openMasterKeyBundle(_record, _key, _ctx, _plans, options) {
        assert.equal(options?.semanticAuthority, true);
        return { masterKey: { master: true }, envelopes: [], semanticAuthority: { semantic: true } };
      },
      async openContent() { state.openContentCalls += 1; throw new Error("rollback content must not be selected"); },
      async sealContent(value) { return { value }; },
      encodeBase64Url(bytes) { return Buffer.from(bytes).toString("base64url"); },
      validateNonExtractableAesKey() {},
    },
    deviceStore: {
      async open() {}, async readPocket() { return record; }, async createPocket() { throw new Error("unused"); },
      async replacePocket() { throw new Error("rollback refresh must not occur"); },
      async reservePocketEncryptionUsage() { throw new Error("unused"); },
    },
    accountClient: { async authenticatePasskey() { return { ok: true, accountAuthenticated: true,
      contentUnlocked: false, accountId: "account", credentialId: "credential" }; } },
    discoveryService: { async readSyncedPocket() { return { status: "ready", syncedPocketId: "pocket" }; } },
    contentService: {
      async readRevision() { return { recordPresent: true, revision: 1 }; },
      async downloadEncryptedRecord() { state.rollbackDownloads += 1;
        return { syncedPocketId: "pocket", revision: 1, encryptedRecord: { rollback: true } }; },
    },
    envelopeService: {
      async listEnvelopes() { return { keySetVersion: 2, envelopes: [{ status: "active",
        envelopeKind: "device", envelopeId: "envelope", envelopeVersion: 1, deviceId: "device",
        credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null }] }; },
      async downloadEnvelope() { throw new Error("unused"); },
      async addEnvelope() { throw new Error("unused"); },
    },
    persistenceAuthorityService: { async read() { state.authorityReads += 1; return { authority: {
      schema: "pocket.sync.persistence-authority.v1", authorityRevision: 9, currentMode: "starling",
      transition: null, rollbackRevision: 1,
      adoptionHead: { schema: "pocket.starling.head.v1", revision: 6, sealRef: "adoption-seal" },
    } }; } },
    objectHeadService: { async readShadowHead() { throw new Error("RemoteOpen owns Head read"); },
      async getOpaqueObject() { throw new Error("RemoteOpen owns object reads"); } },
    randomBytes(n) { random += 1; return Uint8Array.from({ length: n }, (_, i) => (random + i) & 255); },
    now() { return Date.parse("2046-01-01T00:00:00.000Z"); },
  });
  const dependencies = {
    captureTarget() { return { ownerKind: "none", continuityId: "target" }; },
    isTargetCurrent() { return true; },
    validatePayload(payload) { return payload?.mainThoughtTree?.[0]?.label === "STARLING CURRENT"; },
    async adoptOpenedPocket(input) { state.adopted = input; return true; },
  };
  return { opener, dependencies, state };
}

test("P168 additional-device reentry selects fresh Starling truth and never decrypts rollback R", async () => {
  const h = load();
  const result = await h.opener.openExisting(h.dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "synced-pocket-opened");
  assert.equal(h.state.authorityReads >= 1, true);
  assert.equal(h.state.rollbackDownloads, 1);
  assert.equal(h.state.openContentCalls, 0);
  assert.equal(h.state.adopted.confirmedRemoteRevision, 1);
  assert.equal(h.state.adopted.payload.mainThoughtTree[0].label, "STARLING CURRENT");
  assert.equal(JSON.stringify(h.state.adopted.payload).includes("rollback"), false);
});

test("P168 recovery and same-owner reentry remain authority-gated before rollback/current routing", () => {
  const runtime = source("js/pocket-sync-browser-runtime.js");
  const authorityRead = runtime.indexOf("config.persistenceAuthorityService.read");
  const rollbackDecrypt = runtime.indexOf("const payload = await crypto.openContent", authorityRead);
  assert.ok(authorityRead >= 0 && rollbackDecrypt > authorityRead);
  assert.match(runtime, /recovery-starling-authority-attention/);

  const owner = source("js/pocket-starling-owner-successor.js");
  assert.match(owner, /async function rebuildStarlingReentry\(authority\)/);
  assert.match(owner, /if \(wholeSteady\(authority\)\) return result;/);
  assert.match(owner, /if \(!starlingSteady\(authority\) \|\| !await rebuildStarlingReentry\(authority\)\)/);
  assert.match(owner, /async function saveWholeRecordWithMirror\(input\)/);
  assert.match(owner, /async function savePreparedStarling\(payload, preparation, authority, durable\)/);
});
