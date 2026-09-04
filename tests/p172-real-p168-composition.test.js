"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { createSharedDeviceStoreState, createMemoryDeviceStoreDriver } = require("./helpers/p030-memory-device-store-driver.js");

const ROOT = path.resolve(__dirname, "..");
const H = "pocket.starling.head.v1";
const FILES = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js",
  "js/pocket-sync-security-contract.js", "js/pocket-sync-crypto.js", "js/pocket-sync-device-store.js",
  "js/pocket-sync-owner-controller.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
  "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js",
  "js/pocket-starling-object-seal-shadow.js", "js/pocket-starling-semantic-authority-shadow.js",
  "js/pocket-starling-crypto-shadow.js", "js/pocket-starling-storage-shadow.js", "js/pocket-starling-head-shadow.js",
  "js/pocket-sync-remote-client.js", "js/pocket-starling-publication-shadow.js", "js/pocket-starling-remote-open-shadow.js",
  "js/pocket-starling-materialize-shadow.js", "js/pocket-starling-logical-edit-shadow.js",
  "js/pocket-starling-remote-edit-shadow.js", "js/pocket-starling-durable-publication.js",
  "js/pocket-starling-owner-state.js", "js/pocket-starling-owner-bootstrap.js", "js/pocket-starling-owner-successor.js",
];

const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const head = (revision, sealRef) => Object.freeze({ schema: H, revision, sealRef });
const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, index) => (seed + index) & 255);

function runtime() {
  const context = {
    crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL,
    Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error, TypeError,
    structuredClone,
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      currentScript: null,
      body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {}, removeEventListener() {}, createElement() { return {}; },
    },
    navigator: { clipboard: {} }, location: { href: "https://p172.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout, clearTimeout, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    console: { log() {}, info() {}, warn() {}, error() {} },
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of FILES) vm.runInContext(source(file), context, { filename: file });
  return context;
}

function normalisedDocument(context, label, writtenAt, extra = {}) {
  context.__p172Document = {
    schema: "portal.mtt.web.v1", writtenAt,
    nodes: [
      { id: "a", parentId: "root", order: 1001, label, details: extra.details || `details:${label}`,
        updatedAt: writtenAt, source: "manual", future: { exact: label } },
      { id: "b", parentId: "root", order: 1002, label: "Stable",
        updatedAt: "2026-09-04T00:00:00.000Z", source: "manual" },
    ],
    tombstones: [{ id: "gone", retained: { exact: true } }],
    rootExtras: { rootFuture: { exact: true } }, dataExtras: { dataFuture: { exact: true } },
  };
  context.__p172WrittenAt = writtenAt;
  const payload = vm.runInContext("buildCanonicalPocketPayload(__p172Document,{writtenAt:__p172WrittenAt})", context);
  context.__p172Payload = payload;
  const parsed = vm.runInContext("normaliseInput(__p172Payload)", context);
  const dataExtras = vm.runInContext("normaliseRootExtras(__p172Payload.data)||{}", context);
  return { payload, norm: { schema: parsed.schema, writtenAt: parsed.writtenAt, nodes: parsed.nodes,
    tombstones: parsed.tombstones, rootExtras: parsed.rootExtras || {}, dataExtras } };
}

function canonicalStarlingDocument(context, document) {
  const encoded = context.PocketStarlingBridgeShadow.encode(document, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const audited = context.PocketStarlingPlacementShadow.audit(encoded.bridge.structural);
  assert.equal(audited.ok, true, JSON.stringify(audited));
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const nodes = [], seen = new Set();
  const visit = (parentId) => {
    const children = audited.relation.children[parentId] || [];
    for (let index = 0; index < children.length; index += 1) {
      const nodeId = children[index], node = byId.get(nodeId);
      assert.ok(node && !seen.has(nodeId)); seen.add(nodeId);
      const payload = {};
      for (const key of Object.keys(node)) if (!["id", "parentId", "order"].includes(key)) payload[key] = plain(node[key]);
      nodes.push({ id: nodeId, parentId, order: index, ...payload }); visit(nodeId);
    }
  };
  visit("root"); assert.equal(seen.size, document.nodes.length);
  return { schema: document.schema, writtenAt: document.writtenAt, nodes,
    tombstones: plain(document.tombstones), rootExtras: plain(document.rootExtras), dataExtras: plain(document.dataExtras) };
}

function payloadOnly(node) {
  const payload = {};
  for (const key of Object.keys(node)) if (!["id", "parentId", "order"].includes(key)) payload[key] = plain(node[key]);
  return payload;
}

function preparationFor(target, ceiling) {
  return { ceiling, operations: [{ type: "payload", input: {
    nodeId: "a", payload: payloadOnly(target.norm.nodes.find((node) => node.id === "a")),
  } }], preservationProjection: {
    source: { schema: target.norm.schema, writtenAt: target.norm.writtenAt },
    tombstones: plain(target.norm.tombstones), rootExtras: plain(target.norm.rootExtras), dataExtras: plain(target.norm.dataExtras),
  } };
}

function createOwnerStateStore(context) {
  const records = new Map();
  const driver = {
    async open() { return true; },
    async transaction(mode, work) {
      const working = new Map(Array.from(records, ([key, value]) => [key, plain(value)]));
      const boundary = Object.freeze({
        async get(key) { return working.has(key) ? plain(working.get(key)) : undefined; },
        async add(value) { if (working.has(value.syncedPocketId)) throw new Error("duplicate"); working.set(value.syncedPocketId, plain(value)); return value.syncedPocketId; },
        async put(value) { working.set(value.syncedPocketId, plain(value)); return value.syncedPocketId; }, checkpoint() {},
      });
      const result = await work(boundary);
      if (mode === "readwrite") { records.clear(); for (const [key, value] of working) records.set(key, plain(value)); }
      return result;
    }, close() { return true; },
  };
  const base = context.PocketStarlingOwnerState.createStore(driver);
  return { records, open: () => base.open(), read: (id) => base.read(id), write: (input) => base.write(input), close: () => base.close() };
}

async function createWholeRecord(context, deviceStore, sourceDocument) {
  const syncedPocketId = "p172-pocket", revision = 3;
  const deviceWrappingKey = await context.PocketSyncCrypto.generateDeviceWrappingKey();
  const envelopeContext = { syncedPocketId, envelopeId: "envelope-p172", envelopeKind: "device", envelopeVersion: 1 };
  const bundle = await context.PocketSyncCrypto.createMasterKeyBundle([{ context: envelopeContext, wrappingKey: deviceWrappingKey }]);
  const contentContext = { syncedPocketId, revision, contentType: context.PocketSyncCrypto.FORMAT.contentType };
  const encryptedRecord = await context.PocketSyncCrypto.sealContent(sourceDocument.payload, bundle.masterKey, contentContext);
  const record = {
    kind: "pocket.sync.device-state", schemaVersion: 5, storeRevision: 1, syncedPocketId, deviceId: "device-p172",
    deviceWrappingKey,
    deviceEnvelope: { context: envelopeContext, metadata: { contractVersion: 1, syncedPocketId,
      envelopeId: envelopeContext.envelopeId, kind: "device", version: 1, deviceId: "device-p172",
      createdAt: "2042-01-01T00:00:00.000Z", kdf: "none" }, record: bundle.envelopes[0].record },
    content: { context: contentContext, record: encryptedRecord },
    remote: { confirmedRevision: revision, pending: null, conflict: null },
    usage: { masterKeyGeneration: 1, masterKeyContentEncryptions: 1, masterKeyContentEncryptionLimit: 2 ** 20,
      deviceWrappingKeyEncryptions: 1 },
    activationDraft: null, recoveryDraft: null, additionalDeviceDraft: null,
  };
  await deviceStore.createPocket(record);
  return { syncedPocketId, masterKey: bundle.masterKey, revision, record, encryptedRecord };
}

function sharedRemote(owner) {
  return {
    objects: new Map(), head: null,
    authority: { schema: "pocket.sync.persistence-authority.v1", authorityRevision: 1,
      currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null },
    wholeRevision: owner.revision, wholeEncryptedRecord: owner.encryptedRecord,
    counts: { bootstrapCas: 0, authoritativeCas: 0, wholeUpload: 0, authorityCommit: 0 },
  };
}

function transportFor(remote) {
  return Object.freeze({
    async request(route, body) {
      const common = { apiVersion: 1, operationId: body.operationId, syncedPocketId: body.syncedPocketId };
      if (route === "readPersistenceAuthority") {
        return { status: 200, body: { ...common, ok: true, authority: plain(remote.authority) } };
      }
      if (route === "acquirePersistenceAuthorityFence") {
        if (remote.authority.currentMode !== "whole-record" || remote.authority.transition !== null
            || body.expectedAuthorityRevision !== remote.authority.authorityRevision) {
          return { status: 409, body: { ...common, ok: false, status: "conflict", reason: "authority-conflict", authority: plain(remote.authority) } };
        }
        remote.authority = { schema: remote.authority.schema, authorityRevision: remote.authority.authorityRevision + 1,
          currentMode: "whole-record", transition: { transitionId: body.transitionId,
            expectedAuthorityRevision: body.expectedAuthorityRevision }, rollbackRevision: null, adoptionHead: null };
        return { status: 200, body: { ...common, ok: true, status: "fenced", replayed: false, authority: plain(remote.authority) } };
      }
      if (route === "commitStarlingAuthorityAdoption") {
        const t = remote.authority.transition;
        if (remote.authority.currentMode !== "whole-record" || !t
            || remote.authority.authorityRevision !== body.expectedAuthorityRevision
            || t.transitionId !== body.transitionId || body.rollbackRevision !== remote.wholeRevision
            || !remote.head || body.adoptionHead.revision !== remote.head.revision
            || body.adoptionHead.sealRef !== remote.head.sealRef) {
          return { status: 409, body: { ...common, ok: false, status: "conflict", reason: "authority-conflict", authority: plain(remote.authority) } };
        }
        remote.counts.authorityCommit += 1;
        remote.authority = { schema: remote.authority.schema, authorityRevision: remote.authority.authorityRevision + 1,
          currentMode: "starling", transition: null, rollbackRevision: body.rollbackRevision,
          adoptionHead: plain(body.adoptionHead) };
        return { status: 200, body: { ...common, ok: true, status: "adopted", authority: plain(remote.authority) } };
      }
      if (route === "releasePersistenceAuthorityFence") {
        const t = remote.authority.transition;
        if (!t || t.transitionId !== body.transitionId || remote.authority.authorityRevision !== body.expectedAuthorityRevision) {
          return { status: 409, body: { ...common, ok: false, status: "conflict", reason: "authority-conflict", authority: plain(remote.authority) } };
        }
        remote.authority = { schema: remote.authority.schema, authorityRevision: remote.authority.authorityRevision + 1,
          currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null };
        return { status: 200, body: { ...common, ok: true, status: "released", authority: plain(remote.authority) } };
      }
      if (route === "putOpaqueObject") {
        const created = !remote.objects.has(body.storageRef); remote.objects.set(body.storageRef, body.record);
        return { status: 200, body: { ...common, ok: true, storageRef: body.storageRef, created } };
      }
      if (route === "getOpaqueObject") {
        const record = remote.objects.get(body.storageRef) || null;
        return { status: 200, body: { ...common, ok: true, storageRef: body.storageRef, present: !!record, record } };
      }
      if (route === "objectPresence") {
        return { status: 200, body: { ...common, ok: true,
          rows: body.storageRefs.map((storageRef) => ({ storageRef, present: remote.objects.has(storageRef) })) } };
      }
      if (route === "initialiseShadowHead") {
        if (remote.head === null) remote.head = head(0, null);
        return { status: 200, body: { ...common, ok: true, head: plain(remote.head) } };
      }
      if (route === "readShadowHead") {
        return { status: 200, body: { ...common, ok: true, head: remote.head ? plain(remote.head) : null } };
      }
      if (route === "compareAndSetShadowHead") {
        const authoritative = Object.prototype.hasOwnProperty.call(body, "expectedAuthorityRevision");
        if (authoritative) {
          if (remote.authority.currentMode !== "starling" || remote.authority.transition !== null
              || body.expectedAuthorityRevision !== remote.authority.authorityRevision) {
            return { status: 409, body: { ...common, ok: false, status: "conflict", reason: "authority-conflict",
              authority: plain(remote.authority) } };
          }
        } else if (remote.authority.currentMode !== "whole-record" || remote.authority.transition !== null) {
          return { status: 409, body: { ...common, ok: false, status: "conflict", reason: "authority-conflict",
            authority: plain(remote.authority) } };
        }
        if (!remote.head || remote.head.revision !== body.expectedHead.revision || remote.head.sealRef !== body.expectedHead.sealRef) {
          return { status: 409, body: { ...common, ok: false, reason: "head-conflict" } };
        }
        if (!remote.objects.has(body.candidateSealStorageRef)) {
          return { status: 409, body: { ...common, ok: false, reason: "candidate-object-missing" } };
        }
        remote.head = head(body.expectedHead.revision + 1, body.candidateSealStorageRef);
        if (authoritative) remote.counts.authoritativeCas += 1; else remote.counts.bootstrapCas += 1;
        return { status: 200, body: { ...common, ok: true, head: plain(remote.head) } };
      }
      throw new Error(`unexpected route ${route}`);
    },
  });
}

function wholeContentService(remote) {
  return Object.freeze({
    async readRevision() { return { recordPresent: true, revision: remote.wholeRevision }; },
    async downloadEncryptedRecord(input) {
      assert.equal(input.revision, remote.wholeRevision);
      return { syncedPocketId: input.syncedPocketId, revision: remote.wholeRevision,
        encryptedRecord: remote.wholeEncryptedRecord };
    },
    async conditionalUpload() {
      remote.counts.wholeUpload += 1;
      if (remote.authority.currentMode === "starling") {
        const error = new Error("whole record is no longer authoritative"); error.outcome = "definite-failure"; throw error;
      }
      throw new Error("P172 real cutover unexpectedly fell back to whole-record Save");
    },
  });
}

function installPreparation(context, payload, preparation) {
  const map = context.__p172Preparations || new WeakMap(); context.__p172Preparations = map;
  map.set(payload, plain(preparation));
  context.currentPocketStarlingOwnerSavePreparation = (candidate) => {
    const value = map.get(candidate); return value ? plain(value) : null;
  };
}

function memoisedFreeze(payload) {
  let calls = 0, frozen = null;
  return { get calls() { return calls; }, freezePayload() { calls += 1; if (frozen === null) frozen = payload; return frozen; } };
}

async function materialise(context, owner, remote, objectHeadService) {
  const deviceRecord = await owner.deviceStore.readPocket(owner.syncedPocketId);
  const bundle = await context.PocketSyncCrypto.openMasterKeyBundle(deviceRecord.deviceEnvelope.record,
    deviceRecord.deviceWrappingKey, deviceRecord.deviceEnvelope.context, [], { semanticAuthority: true });
  let ordinal = 0;
  const opened = await context.PocketStarlingRemoteOpenShadow.createRemoteOpener({ objectHeadService,
    operationIdFactory(kind, index) { ordinal += 1; return `material-${kind}-${index}-${ordinal}`; } }).openRemote({
      masterKey: bundle.masterKey, context: { syncedPocketId: owner.syncedPocketId }, semanticAuthority: bundle.semanticAuthority,
    });
  assert.equal(opened.outcome, "opened", JSON.stringify(opened));
  const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(opened.session);
  assert.equal(result.ok, true, JSON.stringify(result)); return result.document;
}

async function harness() {
  const context = runtime();
  const deviceState = createSharedDeviceStoreState();
  const deviceStore = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(deviceState));
  await deviceStore.open();
  const sourceDocument = normalisedDocument(context, "Alpha", "2026-09-04T01:00:00.000Z");
  const targetOne = normalisedDocument(context, "Alpha cut over", "2026-09-04T01:01:00.000Z", { details: "first target" });
  const targetTwo = normalisedDocument(context, "Alpha starling", "2026-09-04T01:02:00.000Z", { details: "second target" });
  const wrongTarget = normalisedDocument(context, "WRONG", "2026-09-04T01:03:00.000Z", { details: "semantic mismatch" });
  const owner = await createWholeRecord(context, deviceStore, sourceDocument); owner.deviceStore = deviceStore;
  const remoteState = sharedRemote(owner); const transport = transportFor(remoteState);
  const originalRemote = context.PocketSyncRemoteClient;
  context.PocketSyncRemoteClient = Object.freeze({
    ...originalRemote,
    createBrowserJsonTransport() { return transport; },
  });
  context.document.currentScript = { dataset: { serviceRoot: "/sync" } };
  vm.runInContext(source("js/pocket-starling-real-truth-admission.js"), context,
    { filename: "js/pocket-starling-real-truth-admission.js" });
  context.document.currentScript = null;

  const objectHeadService = context.PocketSyncRemoteClient.createObjectHeadService({ transport });
  const persistenceAuthorityService = context.PocketSyncRemoteClient.createPersistenceAuthorityService({ transport });
  const ownerStateStore = createOwnerStateStore(context);
  let seed = 30;
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto: context.PocketSyncCrypto, deviceStore, contentService: wholeContentService(remoteState),
    randomBytes(n) { seed += 1; return bytes(n, seed); },
    starlingBootstrap: {
      objectHeadService, persistenceAuthorityService,
      operationIdFactory(kind, index) { seed += 1; return `p172-${kind}-${index}-${seed}`; },
      normaliseInput(value) { context.__value = value; return vm.runInContext("normaliseInput(__value)", context); },
      normaliseRootExtras(value) { context.__value = value; return vm.runInContext("normaliseRootExtras(__value)", context); },
    },
    starlingSuccessor: { ownerStateStore },
  });
  const adopted = await controller.adoptSyncedOwner({ syncedPocketId: owner.syncedPocketId, masterKey: owner.masterKey });
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  assert.equal(controller.getStarlingBootstrapState(), null, "first foreground Save must perform P162 bootstrap");
  return { context, controller, owner, remote: remoteState, objectHeadService, sourceDocument, targetOne, targetTwo, wrongTarget };
}

test("P172 real foreground Save composes P162 bootstrap, P168 authority adoption, and Starling-authoritative Save", async () => {
  const h = await harness();
  installPreparation(h.context, h.targetOne.payload, preparationFor(h.targetOne, 10));
  const frozen = memoisedFreeze(h.targetOne.payload);
  const result = await h.controller.saveSyncedOwner({ freezePayload: frozen.freezePayload });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(frozen.calls, 1, "Save boundary payload freezes exactly once through bootstrap + cutover + Starling Save");
  assert.equal(h.remote.authority.currentMode, "starling");
  assert.equal(h.remote.authority.authorityRevision, 3, "E -> E+1 fence -> E+2 Starling");
  assert.equal(h.remote.authority.rollbackRevision, 3);
  assert.equal(h.remote.counts.authorityCommit, 1);
  assert.equal(h.remote.counts.bootstrapCas, 1, "P162 publishes exactly one initial Head");
  assert.equal(h.remote.counts.authoritativeCas, 1, "first user payload advances Head only after authority cutover");
  assert.equal(h.remote.counts.wholeUpload, 0);
  assert.equal(h.remote.wholeRevision, 3);
  assert.deepEqual(plain(h.remote.wholeEncryptedRecord), plain(h.owner.encryptedRecord));
  assert.equal(h.context.PocketStarlingRealTruthAdmission.isStarlingUndoGuardActive(), true);
  const materialized = await materialise(h.context, h.owner, h.remote, h.objectHeadService);
  assert.deepEqual(plain(materialized), plain(canonicalStarlingDocument(h.context, h.targetOne.norm)));
});

test("P172 real post-cutover ordinary Save stays on P168 Starling authority and never rewrites rollback whole-record", async () => {
  const h = await harness();
  installPreparation(h.context, h.targetOne.payload, preparationFor(h.targetOne, 10));
  assert.equal((await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetOne.payload).freezePayload })).ok, true);
  const headAfterCutover = plain(h.remote.head);
  installPreparation(h.context, h.targetTwo.payload, preparationFor(h.targetTwo, 11));
  const frozen = memoisedFreeze(h.targetTwo.payload);
  const result = await h.controller.saveSyncedOwner({ freezePayload: frozen.freezePayload });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(frozen.calls, 1);
  assert.equal(h.remote.counts.authorityCommit, 1, "ordinary Starling Save does not repeat mode transition");
  assert.equal(h.remote.counts.bootstrapCas, 1);
  assert.equal(h.remote.counts.authoritativeCas, 2);
  assert.equal(h.remote.head.revision, headAfterCutover.revision + 1);
  assert.equal(h.remote.wholeRevision, 3); assert.equal(h.remote.counts.wholeUpload, 0);
  const materialized = await materialise(h.context, h.owner, h.remote, h.objectHeadService);
  assert.deepEqual(plain(materialized), plain(canonicalStarlingDocument(h.context, h.targetTwo.norm)));
});

test("P172 real semantic mismatch is rejected before authoritative Head CAS", async () => {
  const h = await harness();
  installPreparation(h.context, h.targetOne.payload, preparationFor(h.targetOne, 10));
  assert.equal((await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetOne.payload).freezePayload })).ok, true);
  const beforeHead = plain(h.remote.head), beforeCas = h.remote.counts.authoritativeCas;
  installPreparation(h.context, h.targetTwo.payload, preparationFor(h.wrongTarget, 11));
  const result = await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetTwo.payload).freezePayload });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(h.remote.counts.authoritativeCas, beforeCas, "semantic mismatch must not reach authoritative CAS");
  assert.deepEqual(plain(h.remote.head), beforeHead);
  assert.equal(h.remote.wholeRevision, 3); assert.equal(h.remote.counts.wholeUpload, 0);
});
