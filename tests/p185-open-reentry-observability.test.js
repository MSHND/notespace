"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const HEAD_SCHEMA = "pocket.starling.head.v1";
const SYNCED_POCKET_ID = "p185-pocket";
const ROLLBACK_REVISION = 3;
const TIMEOUT = 15000;
const SECRET_SENTINEL = "P185-RAW-PRIVATE-EXCEPTION-MATERIAL-MUST-NOT-CROSS";

const SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js",
  "js/pocket-import.js", "js/pocket-sync-security-contract.js", "js/pocket-sync-crypto.js",
  "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
  "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
  "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js",
  "js/pocket-starling-semantic-authority-shadow.js", "js/pocket-starling-crypto-shadow.js",
  "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
  "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js",
  "js/pocket-starling-remote-open-shadow.js", "js/pocket-starling-materialize-shadow.js",
  "js/pocket-sync-additional-device.js",
];

const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const operationId = (kind, index) => `${kind}-${index}`;
const contextValue = () => ({ syncedPocketId: SYNCED_POCKET_ID });
const keyBundles = new WeakMap();

function runtime() {
  const context = {
    crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet,
    Object, Array, String, Number, Boolean, Promise, Error, TypeError, structuredClone,
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() { return null; }, addEventListener() {},
    },
    navigator: { clipboard: {}, credentials: {} }, location: { href: "https://p185.test" },
    indexedDB: null, open() {}, close() {}, setTimeout, clearTimeout,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of SCRIPTS) vm.runInContext(source(file), context, { filename: file });
  return context;
}

function currentState(context) {
  const encoded = context.PocketStarlingBridgeShadow.encode({
    schema: "portal.mtt.web.v1",
    writtenAt: "2048-01-02T03:04:05.000Z",
    nodes: [
      { id: "current-a", parentId: "root", order: 0, label: "STARLING CURRENT", details: "current Starling truth" },
      { id: "current-b", parentId: "root", order: 1, label: "Stable companion" },
    ],
    tombstones: [{ id: "old-node", retained: { exact: true } }],
    rootExtras: { rootFuture: { exact: true } },
    dataExtras: { dataFuture: { exact: true } },
  }, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const built = context.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true, JSON.stringify(built));
  return built.state;
}

async function genuineStarlingFixture(context) {
  const state = currentState(context);
  const stager = context.PocketStarlingObjectSealShadow.createStager();
  const logicalResult = context.PocketStarlingObjectSealShadow.stageCandidate(stager, state, {
    previousSealRef: null,
  });
  assert.equal(logicalResult.ok, true, JSON.stringify(logicalResult));
  const logical = logicalResult.stage;
  const logicalPresence = context.PocketStarlingObjectSealShadow.verifyNewObjectPresence(
    logical, (ref) => stager.store.has(ref), {}
  );
  assert.equal(logicalPresence.ok, true, JSON.stringify(logicalPresence));

  const wrappingKey = await context.PocketSyncCrypto.generateDeviceWrappingKey();
  const envelopeContext = {
    syncedPocketId: SYNCED_POCKET_ID,
    envelopeId: "device-envelope-p185",
    envelopeKind: "device",
    envelopeVersion: 1,
  };
  const bundle = await context.PocketSyncCrypto.createMasterKeyBundle([
    { context: envelopeContext, wrappingKey },
  ], { semanticAuthority: true });
  keyBundles.set(bundle.masterKey, {
    wrappingKey, envelopeContext, record: bundle.envelopes[0].record,
    semanticAuthority: bundle.semanticAuthority,
  });

  const audit = context.PocketStarlingObjectSealShadow.auditCandidateSeal(
    logical.sealRef, (ref) => stager.store.get(ref)
  );
  assert.equal(audit.ok, true, JSON.stringify(audit));
  const auditProof = context.PocketStarlingObjectSealShadow.semanticAuditProvenance(audit);
  const issued = await context.PocketStarlingSemanticAuthorityShadow.issueInitial({
    authority: bundle.semanticAuthority,
    auditProof,
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const physical = await context.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => stager.store.get(ref),
    masterKey: bundle.masterKey,
    context: contextValue(),
    semanticAuthority: bundle.semanticAuthority,
    semanticValidityProof: issued.proof,
  });
  const remote = {
    objects: new Map(physical.newRecords.map((entry) => [entry.storageRef, entry.record])),
    head: { schema: HEAD_SCHEMA, revision: 1, sealRef: physical.sealStorageRef },
  };
  return { bundle, wrappingKey, envelopeContext, physical, remote };
}

function ciphertextBytes(record) {
  return Math.floor(record.ciphertext.length * 6 / 8);
}

async function completedLocalRecord(context, fixture) {
  const contentContext = {
    syncedPocketId: SYNCED_POCKET_ID,
    revision: ROLLBACK_REVISION,
    contentType: context.PocketSyncCrypto.FORMAT.contentType,
  };
  const rollbackPayload = {
    schema: "portal.export.v1",
    writtenAt: "2048-01-01T00:00:00.000Z",
    mainThoughtTree: [{ id: "rollback", parentId: "root", order: 0, label: "ROLLBACK R MUST NOT WIN" }],
    mainThoughtTreeTombstones: [],
    data: { mainThoughtTree: [], mainThoughtTreeTombstones: [] },
  };
  const rollbackRecord = await context.PocketSyncCrypto.sealContent(
    rollbackPayload, fixture.bundle.masterKey, contentContext
  );
  return {
    record: {
      kind: "pocket.sync.device-state", schemaVersion: 5, storeRevision: 7,
      syncedPocketId: SYNCED_POCKET_ID, deviceId: "device-p185",
      deviceWrappingKey: fixture.wrappingKey,
      deviceEnvelope: {
        context: fixture.envelopeContext,
        metadata: {
          contractVersion: 1, syncedPocketId: SYNCED_POCKET_ID,
          envelopeId: fixture.envelopeContext.envelopeId, kind: "device", version: 1,
          deviceId: "device-p185", createdAt: "2048-01-01T00:00:00.000Z", kdf: "none",
        },
        record: fixture.bundle.envelopes[0].record,
      },
      content: { context: contentContext, record: rollbackRecord },
      remote: { confirmedRevision: ROLLBACK_REVISION, pending: null, conflict: null },
      usage: {
        masterKeyGeneration: 1, masterKeyContentEncryptions: 1,
        masterKeyContentEncryptionLimit: 2 ** 20, deviceWrappingKeyEncryptions: 1,
      },
      activationDraft: null, recoveryDraft: null, additionalDeviceDraft: null,
    },
    rollbackRecord,
  };
}

function responseBase(body) {
  return { apiVersion: 1, ok: true, operationId: body.operationId };
}

function transport(context, fixture, local, events, options = {}) {
  const badPrf = options.badPrf === true;
  const activeEnvelope = {
    envelopeId: fixture.envelopeContext.envelopeId,
    envelopeKind: "device", envelopeVersion: 1, status: "active", deviceId: "device-p185",
    credentialId: null, kdf: "none", kdfSalt: null, derivationVersion: null,
    createdAt: "2048-01-01T00:00:00.000Z", revokedAt: null,
  };
  const authority = {
    schema: "pocket.sync.persistence-authority.v1", authorityRevision: 9,
    currentMode: "starling", transition: null, rollbackRevision: ROLLBACK_REVISION,
    adoptionHead: plain(fixture.remote.head),
  };
  return Object.freeze({
    async request(route, body) {
      events.push([route, plain(body)]);
      if (route === "beginAuthentication") {
        return { status: 200, body: fixtures.beginAuthentication({ operationId: body.operationId }) };
      }
      if (route === "finishAuthentication") {
        if (badPrf) throw new Error("finish must not be reached");
        return { status: 200, body: fixtures.finishAuthentication({
          operationId: body.operationId,
          ceremonyId: body.ceremonyId,
          credentialId: body.credential.id,
        }) };
      }
      if (route === "readSyncedPocket") {
        return { status: 200, body: { ...responseBase(body), status: "ready", syncedPocketId: SYNCED_POCKET_ID } };
      }
      if (route === "listEnvelopes") {
        return { status: 200, body: {
          ...responseBase(body), syncedPocketId: SYNCED_POCKET_ID, keySetVersion: 2,
          recoveryStatus: "ready", recoveryVersion: 1, envelopes: [activeEnvelope],
        } };
      }
      if (route === "readPersistenceAuthority") {
        return { status: 200, body: { ...responseBase(body), syncedPocketId: SYNCED_POCKET_ID, authority } };
      }
      if (route === "readRevision") {
        return { status: 200, body: {
          ...responseBase(body), syncedPocketId: SYNCED_POCKET_ID,
          revision: ROLLBACK_REVISION, recordPresent: true,
          contentFormat: "pocket.sync.content.opaque", contentVersion: 1,
          encryptedRecordSize: ciphertextBytes(local.rollbackRecord),
        } };
      }
      if (route === "downloadEncryptedRecord") {
        return { status: 200, body: {
          ...responseBase(body), syncedPocketId: SYNCED_POCKET_ID,
          revision: ROLLBACK_REVISION,
          encryptedRecordSize: ciphertextBytes(local.rollbackRecord),
          encryptedRecord: local.rollbackRecord,
        } };
      }
      if (route === "readShadowHead") {
        return { status: 200, body: { ...responseBase(body), syncedPocketId: SYNCED_POCKET_ID,
          head: plain(fixture.remote.head) } };
      }
      if (route === "getOpaqueObject") {
        const record = fixture.remote.objects.get(body.storageRef) || null;
        return { status: 200, body: { ...responseBase(body), syncedPocketId: SYNCED_POCKET_ID,
          storageRef: body.storageRef, present: !!record, record } };
      }
      throw new Error(`P185 unexpected route ${route}`);
    },
  });
}

function services(context, remoteTransport) {
  const remote = context.PocketSyncRemoteClient;
  return {
    accountService: remote.createAccountService({ transport: remoteTransport }),
    discoveryService: remote.createPocketDiscoveryService({ transport: remoteTransport }),
    contentService: remote.createContentService({ transport: remoteTransport }),
    envelopeService: remote.createEnvelopeService({ transport: remoteTransport }),
    persistenceAuthorityService: remote.createPersistenceAuthorityService({ transport: remoteTransport }),
    objectHeadService: remote.createObjectHeadService({ transport: remoteTransport }),
  };
}

function cryptoForOpen(context, counters) {
  const real = context.PocketSyncCrypto;
  return Object.freeze({
    FORMAT: real.FORMAT,
    generateDeviceWrappingKey: (...args) => real.generateDeviceWrappingKey(...args),
    deriveWrappingKey: (...args) => real.deriveWrappingKey(...args),
    openMasterKeyBundle: (...args) => real.openMasterKeyBundle(...args),
    async openContent(...args) { counters.openContent += 1; return real.openContent(...args); },
    sealContent: (...args) => real.sealContent(...args),
    encodeBase64Url: (...args) => real.encodeBase64Url(...args),
    validateNonExtractableAesKey: (...args) => real.validateNonExtractableAesKey(...args),
  });
}

function opener(context, fixture, local, events, options = {}) {
  const remoteTransport = transport(context, fixture, local, events, options);
  const remoteServices = services(context, remoteTransport);
  const browserEvents = events;
  const native = options.badPrf === true
    ? (() => {
      const credential = fixtures.nativeAuthenticationCredential();
      return {
        getClientExtensionResults() {
          return { prf: { results: { first: fixtures.bytes(31, 101).buffer } } };
        },
        toJSON() { return credential.toJSON(); },
      };
    })()
    : fixtures.nativeAuthenticationCredential();
  const webAuthn = context.PocketSyncAccountClient.createBrowserWebAuthnAdapter({
    navigator: { credentials: {
      async get(optionsValue) {
        browserEvents.push(["nativeCredential", {
          hasPublicKey: !!optionsValue?.publicKey,
          conditionalMediation: Object.prototype.hasOwnProperty.call(optionsValue || {}, "mediation"),
        }]);
        return native;
      },
    } },
  });
  const accountClient = context.PocketSyncAccountClient.createClient({
    accountService: remoteServices.accountService,
    webAuthn,
    now: () => fixtures.NOW,
  });
  const writes = { create: 0, replace: 0, reserve: 0 };
  const deviceStore = {
    async open() { events.push(["deviceStoreOpen", {}]); },
    async readPocket(id) { events.push(["deviceStoreRead", { id }]); return local.record; },
    async createPocket() { writes.create += 1; throw new Error("ordinary same-device reopen must not create local truth"); },
    async replacePocket() { writes.replace += 1; throw new Error("ordinary Starling reopen must not replace local truth"); },
    async reservePocketEncryptionUsage() { writes.reserve += 1; throw new Error("ordinary reopen must not reserve writes"); },
  };
  const counters = { openContent: 0 };
  const additional = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: cryptoForOpen(context, counters), deviceStore, accountClient,
    discoveryService: remoteServices.discoveryService,
    contentService: remoteServices.contentService,
    envelopeService: remoteServices.envelopeService,
    persistenceAuthorityService: remoteServices.persistenceAuthorityService,
    objectHeadService: remoteServices.objectHeadService,
    randomBytes(length) {
      opener.random = (opener.random || 0) + 1;
      return Uint8Array.from({ length }, (_, index) => (opener.random + index) & 255);
    },
    now: () => fixtures.NOW,
  });
  let adopted = null;
  const dependencies = {
    captureTarget() { return { ownerKind: "none", continuityId: "same-device-target" }; },
    isTargetCurrent() { return true; },
    validatePayload(payload) {
      return payload?.mainThoughtTree?.[0]?.label === "STARLING CURRENT";
    },
    async adoptOpenedPocket(input) { adopted = input; events.push(["ownerAdoption", { label: input.payload.mainThoughtTree[0].label }]); return true; },
  };
  return { additional, dependencies, writes, counters, getAdopted: () => adopted };
}

function eventIndex(events, name) {
  return events.findIndex(([event]) => event === name);
}

function mutationRoutes(events) {
  return events.filter(([name]) => [
    "conditionalUpload", "addEnvelope", "revokeEnvelope", "putOpaqueObject",
    "objectPresence", "initialiseShadowHead", "compareAndSetShadowHead",
    "acquirePersistenceAuthorityFence", "commitStarlingAuthorityAdoption",
    "releasePersistenceAuthorityFence",
  ].includes(name));
}

function localIntegrationProjection(results) {
  const context = {
    Object, Array, Number, String, Boolean, Date, Promise, Error, Uint8Array,
    document: { currentScript: { dataset: { serviceRoot: "/sync" } } },
    PocketSyncRemoteClient: {
      createBrowserJsonTransport() { return {}; },
      createAccountService() { return {}; }, createContentService() { return {}; },
      createEnvelopeService() { return {}; }, createRecoveryService() { return {}; },
    },
    PocketSyncBrowserRuntime: {
      createRuntime() {
        let index = 0;
        return {
          async openExisting() { return results[Math.min(index++, results.length - 1)]; },
          async activate() { return { ok: false }; }, async resume() { return { ok: false }; },
          async recoverExisting() { return { ok: false }; }, async resumeRecovery() { return { ok: false }; },
          async findRecoveryAttempt() { return { ok: true }; },
        };
      },
    },
    PocketSyncUi: { install() {} },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-sync-local-integration.js"), context,
    { filename: "js/pocket-sync-local-integration.js" });
  return context.PocketSyncLocalIntegration.create();
}

test("P185 ordinary same-device reentry authenticates, discovers, materialises current Starling truth, reads rollback R only as evidence, and mutates no truth", { timeout: TIMEOUT }, async () => {
  opener.random = 0;
  const context = runtime();
  const fixture = await genuineStarlingFixture(context);
  const local = await completedLocalRecord(context, fixture);
  const events = [];
  const harness = opener(context, fixture, local, events);
  const result = await harness.additional.openExisting(harness.dependencies);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reason, "synced-pocket-opened");
  assert.equal(result.confirmedRemoteRevision, ROLLBACK_REVISION);
  const adopted = harness.getAdopted();
  assert.ok(adopted);
  assert.equal(adopted.payload.mainThoughtTree[0].label, "STARLING CURRENT");
  assert.equal(JSON.stringify(adopted.payload).includes("ROLLBACK R MUST NOT WIN"), false);
  assert.equal(harness.counters.openContent, 0, "rollback whole-record evidence must never be decrypted as current truth");
  assert.deepEqual(harness.writes, { create: 0, replace: 0, reserve: 0 });
  assert.deepEqual(mutationRoutes(events), []);

  const begin = eventIndex(events, "beginAuthentication");
  const nativeCredential = eventIndex(events, "nativeCredential");
  const finish = eventIndex(events, "finishAuthentication");
  const discovery = eventIndex(events, "readSyncedPocket");
  const authority = eventIndex(events, "readPersistenceAuthority");
  const head = eventIndex(events, "readShadowHead");
  const object = eventIndex(events, "getOpaqueObject");
  const rollbackRead = eventIndex(events, "readRevision");
  const rollbackDownload = eventIndex(events, "downloadEncryptedRecord");
  const adoption = eventIndex(events, "ownerAdoption");
  assert.ok(begin >= 0 && nativeCredential > begin && finish > nativeCredential,
    JSON.stringify(events.map(([name]) => name)));
  assert.ok(discovery > finish, "discovery must occur only after successful authentication completion");
  assert.ok(authority > discovery && head > authority && object > head,
    "steady authority must gate real Head/object Starling materialisation");
  assert.ok(rollbackRead > object && rollbackDownload > rollbackRead && adoption > rollbackDownload,
    "rollback evidence is read only after current Starling materialisation and before owner adoption");

  const finishBody = events.find(([name]) => name === "finishAuthentication")[1];
  assert.equal(JSON.stringify(finishBody).includes(fixtures.PRF_OUTPUT_TEXT), false,
    "native PRF output must not cross the finish service boundary");
  assert.equal(events.find(([name]) => name === "nativeCredential")[1].conditionalMediation, false);
  assert.equal(events.filter(([name]) => name === "readRevision").length, 1);
  assert.equal(events.filter(([name]) => name === "downloadEncryptedRecord").length, 1);
  assert.ok(events.filter(([name]) => name === "getOpaqueObject").length >= 2,
    "real Starling materialisation must resolve opaque Head/object records");
});

test("P185 exact pre-finish seam preserves bounded safe failure truth, stops before discovery, and exposes only a frozen latest-open projection", { timeout: TIMEOUT }, async () => {
  opener.random = 0;
  const context = runtime();
  const fixture = await genuineStarlingFixture(context);
  const local = await completedLocalRecord(context, fixture);
  const events = [];
  const harness = opener(context, fixture, local, events, { badPrf: true });
  const result = await harness.additional.openExisting(harness.dependencies);

  assert.deepEqual(plain(result), {
    ok: false,
    reason: "additional-device-open-failed",
    adopted: false,
    sourceOwnerPreserved: true,
    failureStage: "account-passkey-authentication-completion",
    failureCode: "prf-output-invalid",
  });
  assert.equal(eventIndex(events, "beginAuthentication") >= 0, true);
  assert.equal(eventIndex(events, "nativeCredential") > eventIndex(events, "beginAuthentication"), true);
  assert.equal(eventIndex(events, "finishAuthentication"), -1);
  assert.equal(eventIndex(events, "readSyncedPocket"), -1);
  assert.equal(eventIndex(events, "readPersistenceAuthority"), -1);
  assert.equal(eventIndex(events, "readShadowHead"), -1);
  assert.equal(eventIndex(events, "getOpaqueObject"), -1);
  assert.deepEqual(mutationRoutes(events), []);
  assert.deepEqual(harness.writes, { create: 0, replace: 0, reserve: 0 });

  const augmented = {
    ...plain(result),
    rawException: SECRET_SENTINEL,
    accountLocator: "private-account-locator",
    syncedPocketId: "private-pocket-id",
    payload: { secret: SECRET_SENTINEL },
    prfOutput: fixtures.PRF_OUTPUT_TEXT,
  };
  const success = { ok: true, reason: "synced-pocket-opened", privateRef: SECRET_SENTINEL };
  const integration = localIntegrationProjection([augmented, success]);
  await integration.openExisting();
  const first = integration.getLatestOpenDiagnostic();
  assert.deepEqual(plain(first), plain(result));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(JSON.stringify(first).includes(SECRET_SENTINEL), false);
  assert.equal(JSON.stringify(first).includes(fixtures.PRF_OUTPUT_TEXT), false);
  assert.equal(JSON.stringify(first).includes("private-account-locator"), false);
  assert.notEqual(integration.getLatestOpenDiagnostic(), first, "diagnostic reads return frozen copy-safe projections");

  await integration.openExisting();
  const latest = integration.getLatestOpenDiagnostic();
  assert.deepEqual(plain(latest), { ok: true, reason: "synced-pocket-opened" });
  assert.equal(Object.isFrozen(latest), true);
  assert.equal(JSON.stringify(latest).includes(SECRET_SENTINEL), false);
});

test("P185 unexpected authentication exceptions collapse to one Pocket-owned generic code without raw exception material", { timeout: TIMEOUT }, async () => {
  const context = runtime();
  let discovery = 0;
  const error = new Error(SECRET_SENTINEL);
  error.name = "PrivateProviderFailureName";
  error.stack = `${SECRET_SENTINEL}:private-stack`;
  const additional = context.PocketSyncAdditionalDevice.createAdditionalDeviceOpener({
    crypto: {
      FORMAT: { contentType: "portal.export.v1+json" },
      async generateDeviceWrappingKey() {}, async deriveWrappingKey() {}, async openMasterKeyBundle() {},
      async openContent() {}, async sealContent() {}, encodeBase64Url(bytes) { return Buffer.from(bytes).toString("base64url"); },
      validateNonExtractableAesKey() {},
    },
    deviceStore: {
      async open() {}, async readPocket() {}, async createPocket() {}, async replacePocket() {},
      async reservePocketEncryptionUsage() {},
    },
    accountClient: { async authenticatePasskey() { throw error; } },
    discoveryService: { async readSyncedPocket() { discovery += 1; } },
    contentService: { async readRevision() {}, async downloadEncryptedRecord() {} },
    envelopeService: { async listEnvelopes() {}, async downloadEnvelope() {}, async addEnvelope() {} },
    randomBytes(length) { return Uint8Array.from({ length }, (_, index) => index + 1); },
    now: () => fixtures.NOW,
  });
  const result = await additional.openExisting({
    captureTarget() { return { ownerKind: "none", continuityId: "target" }; },
    isTargetCurrent() { return true; }, validatePayload() { return true; }, async adoptOpenedPocket() { return true; },
  });
  assert.deepEqual(plain(result), {
    ok: false, reason: "additional-device-open-failed", adopted: false,
    sourceOwnerPreserved: true,
    failureStage: "account-passkey-authentication-completion",
    failureCode: "account-authentication-failed",
  });
  assert.equal(discovery, 0);
  assert.equal(JSON.stringify(result).includes(SECRET_SENTINEL), false);
  assert.equal(JSON.stringify(result).includes("PrivateProviderFailureName"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "message"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "stack"), false);
});
