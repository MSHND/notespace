from pathlib import Path

server = r'''"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");

const NOW = Date.parse("2046-01-01T00:00:00.000Z");
const ORIGIN = "https://sync.pocket.example";
const b64 = (n, seed = 1) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (seed + i) & 255)).toString("base64url");
const encrypted = (seed = 1) => ({ format: "pocket.sync.content.opaque", version: 1,
  algorithm: "AES-GCM-256", nonce: b64(12, seed), ciphertext: b64(32, seed + 20) });
const clone = (value) => JSON.parse(JSON.stringify(value));
const call = (body) => ({ context: { method: "POST", origin: ORIGIN, fetchSite: "same-origin",
  contentType: "application/json", sessionId: "session" }, body });

function seed() {
  return {
    accounts: { account: { kind: "pocket.sync.service-account", schemaVersion: 1, storeVersion: 1,
      accountId: "account", accountPolicyVersion: 1, prfEvaluationInput: b64(32, 2),
      credentialIds: ["credential"], syncedPocketId: "pocket", createdAt: "2045-01-01T00:00:00.000Z" } },
    credentials: { credential: { kind: "pocket.sync.service-credential", schemaVersion: 1, storeVersion: 1,
      credentialId: "credential", accountId: "account", credentialVersion: 1, status: "active",
      publicKey: b64(64, 4), publicKeyAlgorithm: -7, signCount: 0, transports: ["internal"],
      backupEligible: true, backedUp: true, createdAt: "2045-01-01T00:00:00.000Z" } },
    sessions: { session: { kind: "pocket.sync.service-session", schemaVersion: 1, storeVersion: 1,
      sessionId: "session", accountId: "account", credentialId: "credential", status: "active",
      createdAt: "2045-01-01T00:00:00.000Z", expiresAt: "2047-01-01T00:00:00.000Z", replacedBy: null } },
    pockets: { pocket: { kind: "pocket.sync.service-pocket", schemaVersion: 1, storeVersion: 1,
      accountId: "account", syncedPocketId: "pocket", revision: 1, encryptedRecordSize: 32,
      encryptedRecord: encrypted(9), createdAt: "2045-01-01T00:00:00.000Z" } },
    persistenceAuthorities: { pocket: { kind: "pocket.sync.persistence-authority", schemaVersion: 1,
      storeVersion: 1, accountId: "account", syncedPocketId: "pocket", authorityRevision: 1,
      currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null } },
  };
}

function headDriver() {
  let head = { schema: "pocket.starling.head.v1", revision: 1, sealRef: "seal-one" };
  return {
    store: Object.freeze({
      async putObject() { return { ok: true, created: true }; },
      async getObject() { return null; },
      async presence(_pocket, refs) { return refs.map((storageRef) => ({ storageRef, present: true })); },
      async initialiseHead() { return head; },
      async readHead() { return head; },
      async compareAndSetHead(_pocket, expected, candidate) {
        if (head.revision !== expected.revision || head.sealRef !== expected.sealRef) {
          return { ok: false, reason: "head-conflict", head };
        }
        head = { schema: head.schema, revision: head.revision + 1, sealRef: candidate };
        return { ok: true, head };
      },
    }),
    head: () => clone(head),
  };
}

function core(driver, heads, store = driver.store) {
  return createServiceCore({ store, objectHeadStore: heads.store,
    webAuthnVerifier: Object.freeze({ async verifyRegistration() { throw new Error("unused"); },
      async verifyAuthentication() { throw new Error("unused"); } }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 1), now: () => NOW,
    trustedOrigin: ORIGIN, rpId: "sync.pocket.example", rpName: "Pocket", credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000, sessionLifetimeMs: 86400000 });
}

function upload(operationId, expectedRevision, attemptKind = "new-change") {
  return { apiVersion: 1, syncedPocketId: "pocket", expectedRevision, operationId,
    logicalChangeId: `${operationId}-change`, attemptKind, encryptedRecord: encrypted(40) };
}

function fence(operationId, expectedAuthorityRevision) {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket",
    expectedAuthorityRevision, transitionId: "transition-one" };
}

function adoption(operationId, expectedAuthorityRevision, rollbackRevision, head) {
  return { apiVersion: 1, operationId, syncedPocketId: "pocket", expectedAuthorityRevision,
    transitionId: "transition-one", rollbackRevision, adoptionHead: head };
}

function cas(operationId, expectedHead, candidateSealStorageRef, expectedAuthorityRevision) {
  const value = { apiVersion: 1, operationId, syncedPocketId: "pocket", expectedHead, candidateSealStorageRef };
  if (expectedAuthorityRevision !== undefined) value.expectedAuthorityRevision = expectedAuthorityRevision;
  return value;
}

test("P168 handoff is content-neutral and Starling authority is exclusive after E+2", async () => {
  const driver = createMemoryServiceStore({ seed: seed() });
  const heads = headDriver();
  const service = core(driver, heads);

  const saved = await service.conditionalUpload(call(upload("whole-save", 1)));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 2);
  const rollback = clone(driver.snapshot().pockets.pocket);
  const headAtHandoff = heads.head();

  const fenced = await service.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  assert.equal(fenced.status, 200);
  assert.equal(fenced.body.authority.authorityRevision, 2);

  const adopted = await service.commitStarlingAuthorityAdoption(call(
    adoption("adopt", 2, 2, headAtHandoff)
  ));
  assert.equal(adopted.status, 200);
  assert.equal(adopted.body.status, "adopted");
  assert.equal(adopted.body.authority.authorityRevision, 3);
  assert.equal(adopted.body.authority.currentMode, "starling");
  assert.equal(adopted.body.authority.rollbackRevision, 2);
  assert.deepEqual(adopted.body.authority.adoptionHead, headAtHandoff);
  assert.deepEqual(driver.snapshot().pockets.pocket, rollback);
  assert.deepEqual(heads.head(), headAtHandoff);

  const replayInput = upload("whole-save", 1, "idempotent-retry");
  const replay = await service.conditionalUpload(call(replayInput));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(driver.snapshot().pockets.pocket, rollback);

  await assert.rejects(service.conditionalUpload(call(upload("forbidden-whole", 2))),
    (error) => error?.code === "service-persistence-authority-transition-active" && error.status === 409);

  const legacy = await service.compareAndSetShadowHead(call(cas("legacy-cas", headAtHandoff, "seal-two")));
  assert.equal(legacy.status, 409);
  assert.equal(legacy.body.reason, "authority-conflict");
  assert.deepEqual(heads.head(), headAtHandoff);

  const stale = await service.compareAndSetShadowHead(call(cas("stale-cas", headAtHandoff, "seal-two", 2)));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, "authority-conflict");
  assert.deepEqual(heads.head(), headAtHandoff);

  const authoritative = await service.compareAndSetShadowHead(call(
    cas("authoritative-cas", headAtHandoff, "seal-two", 3)
  ));
  assert.equal(authoritative.status, 200);
  assert.equal(authoritative.body.head.revision, 2);
  assert.equal(authoritative.body.head.sealRef, "seal-two");
  assert.deepEqual(driver.snapshot().pockets.pocket, rollback);
});

test("P168 adoption conflict cannot alter rollback content or Head", async () => {
  const driver = createMemoryServiceStore({ seed: seed() });
  const heads = headDriver();
  const service = core(driver, heads);
  const before = clone(driver.snapshot().pockets.pocket);
  const head = heads.head();
  await service.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  const conflict = await service.commitStarlingAuthorityAdoption(call(
    adoption("bad-adopt", 2, 1, { ...head, sealRef: "other-seal" })
  ));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.reason, "authority-conflict");
  assert.deepEqual(driver.snapshot().pockets.pocket, before);
  assert.deepEqual(heads.head(), head);
  assert.equal(driver.snapshot().persistenceAuthorities.pocket.currentMode, "whole-record");
  assert.notEqual(driver.snapshot().persistenceAuthorities.pocket.transition, null);
});

test("P168 authority read is barriered behind the same per-Pocket lock", async () => {
  const driver = createMemoryServiceStore({ seed: seed() });
  const heads = headDriver();
  let enteredResolve; let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let ordinal = 0;
  const transact = async (...args) => driver.store.transact(...args);
  Object.defineProperty(transact, "withPocketAuthorityLock", { value(pocket, callback) {
    ordinal += 1;
    const current = ordinal;
    return driver.store.transact.withPocketAuthorityLock(pocket, async () => {
      if (current === 1) { enteredResolve(); await release; }
      return callback();
    });
  } });
  const service = core(driver, heads, Object.freeze({ transact }));
  const fencePromise = service.acquirePersistenceAuthorityFence(call(fence("fence", 1)));
  await entered;
  let readSettled = false;
  const readPromise = service.readPersistenceAuthority(call({ apiVersion: 1,
    operationId: "read", syncedPocketId: "pocket" })).then((value) => { readSettled = true; return value; });
  await Promise.resolve();
  assert.equal(readSettled, false);
  releaseResolve();
  const [, read] = await Promise.all([fencePromise, readPromise]);
  assert.equal(read.body.authority.authorityRevision, 2);
  assert.notEqual(read.body.authority.transition, null);
});
'''

reentry = r'''"use strict";

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
    envelopeService: { async listEnvelopes() { return { keySetVersion: 2, envelopes: [{ status: "active",
      envelopeKind: "device", envelopeId: "envelope", envelopeVersion: 1, deviceId: "device",
      credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null }] }; } },
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
  assert.match(owner, /async function saveStarlingAuthority\(payload, preparation, authority/);
});
'''

Path('tests/p168-authority-adoption.test.js').write_text(server)
Path('tests/p168-starling-reentry.test.js').write_text(reentry)
print('P168 focused proof tests materialized')
