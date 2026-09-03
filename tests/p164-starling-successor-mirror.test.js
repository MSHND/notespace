"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const {
  createSharedDeviceStoreState,
  createMemoryDeviceStoreDriver,
} = require("./helpers/p030-memory-device-store-driver.js");

const ROOT = path.resolve(__dirname, "..");
const H = "pocket.starling.head.v1";
const FILES = [
  "js/pocket-state.js",
  "js/pocket-data.js",
  "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js",
  "js/pocket-import.js",
  "js/pocket-sync-security-contract.js",
  "js/pocket-sync-crypto.js",
  "js/pocket-sync-device-store.js",
  "js/pocket-sync-owner-controller.js",
  "js/pocket-starling-shadow.js",
  "js/pocket-starling-sequence-shadow.js",
  "js/pocket-starling-placement-shadow.js",
  "js/pocket-starling-bridge-shadow.js",
  "js/pocket-starling-root-shadow.js",
  "js/pocket-starling-object-seal-shadow.js",
  "js/pocket-starling-semantic-authority-shadow.js",
  "js/pocket-starling-crypto-shadow.js",
  "js/pocket-starling-storage-shadow.js",
  "js/pocket-starling-head-shadow.js",
  "js/pocket-sync-remote-client.js",
  "js/pocket-starling-publication-shadow.js",
  "js/pocket-starling-remote-open-shadow.js",
  "js/pocket-starling-materialize-shadow.js",
  "js/pocket-starling-logical-edit-shadow.js",
  "js/pocket-starling-remote-edit-shadow.js",
  "js/pocket-starling-durable-publication.js",
  "js/pocket-starling-owner-state.js",
  "js/pocket-starling-owner-bootstrap.js",
  "js/pocket-starling-owner-successor.js",
];

const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const head = (revision, sealRef) => Object.freeze({ schema: H, revision, sealRef });
const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, index) => (seed + index) & 255);

function runtime() {
  const context = {
    crypto: webcrypto,
    CryptoKey: globalThis.CryptoKey,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    TypeError,
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
    navigator: { clipboard: {} },
    location: { href: "https://p164.test" },
    indexedDB: null,
    open() {}, close() {}, setTimeout, clearTimeout,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    console: { log() {}, info() {}, warn() {}, error() {} },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of FILES) vm.runInContext(source(file), context, { filename: file });
  return context;
}

function normalisedDocument(context, label, writtenAt, extra = {}) {
  context.__p164Document = {
    schema: "portal.mtt.web.v1",
    writtenAt,
    nodes: [
      {
        id: "a",
        parentId: "root",
        order: 1001,
        label,
        details: extra.details || `details:${label}`,
        updatedAt: extra.updatedAt || writtenAt,
        source: "manual",
        future: { exact: label },
      },
      {
        id: "b",
        parentId: "root",
        order: 1002,
        label: "Stable",
        updatedAt: "2026-09-03T04:00:00.000Z",
        source: "manual",
      },
    ],
    tombstones: [{ id: "gone", retained: { exact: true } }],
    rootExtras: { rootFuture: { exact: true } },
    dataExtras: { dataFuture: { exact: true } },
  };
  context.__p164WrittenAt = writtenAt;
  const payload = vm.runInContext(
    "buildCanonicalPocketPayload(__p164Document,{writtenAt:__p164WrittenAt})",
    context
  );
  context.__p164Payload = payload;
  const parsed = vm.runInContext("normaliseInput(__p164Payload)", context);
  const dataExtras = vm.runInContext("normaliseRootExtras(__p164Payload.data)||{}", context);
  return {
    payload,
    norm: {
      schema: parsed.schema,
      writtenAt: parsed.writtenAt,
      nodes: parsed.nodes,
      tombstones: parsed.tombstones,
      rootExtras: parsed.rootExtras || {},
      dataExtras,
    },
  };
}

function payloadOnly(node) {
  const payload = {};
  for (const key of Object.keys(node)) {
    if (["id", "parentId", "order"].includes(key)) continue;
    payload[key] = plain(node[key]);
  }
  return payload;
}

function preparationFor(target, ceiling = 7) {
  return {
    ceiling,
    operations: [{
      type: "payload",
      input: { nodeId: "a", payload: payloadOnly(target.norm.nodes.find((node) => node.id === "a")) },
    }],
    preservationProjection: {
      source: { schema: target.norm.schema, writtenAt: target.norm.writtenAt },
      tombstones: plain(target.norm.tombstones),
      rootExtras: plain(target.norm.rootExtras),
      dataExtras: plain(target.norm.dataExtras),
    },
  };
}

function createOwnerStateStore(context, audit = []) {
  const records = new Map();
  const driver = {
    async open() { return true; },
    async transaction(mode, work) {
      const working = new Map(Array.from(records, ([key, value]) => [key, plain(value)]));
      const boundary = Object.freeze({
        async get(key) { return working.has(key) ? plain(working.get(key)) : undefined; },
        async add(value) {
          if (working.has(value.syncedPocketId)) throw Object.assign(new Error("duplicate"), { code: "duplicate" });
          working.set(value.syncedPocketId, plain(value));
          return value.syncedPocketId;
        },
        async put(value) { working.set(value.syncedPocketId, plain(value)); return value.syncedPocketId; },
        checkpoint(label) { audit.push(`state:${label}`); },
      });
      const result = await work(boundary);
      if (mode === "readwrite") {
        records.clear();
        for (const [key, value] of working) records.set(key, plain(value));
      }
      return result;
    },
    close() { return true; },
  };
  const base = context.PocketStarlingOwnerState.createStore(driver);
  return {
    records,
    async open() { return base.open(); },
    async read(id) { return base.read(id); },
    async write(input) {
      audit.push("state:write-start");
      const result = await base.write(input);
      audit.push("state:write-done");
      return result;
    },
    close() { return base.close(); },
  };
}

function remoteState() {
  return {
    objects: new Map(),
    head: null,
    calls: [],
    count: { put: 0, presence: 0, init: 0, read: 0, cas: 0, get: 0 },
    mode: {},
  };
}

function remoteService(context, remote, audit = []) {
  return context.PocketSyncRemoteClient.createObjectHeadService({
    transport: {
      async request(route, body) {
        remote.calls.push([route, plain(body)]);
        const common = {
          apiVersion: 1,
          ok: true,
          operationId: body.operationId,
          syncedPocketId: body.syncedPocketId,
        };
        if (route === "putOpaqueObject") {
          remote.count.put += 1;
          audit.push("starling:put");
          if (remote.mode.failPut) throw new Error("put");
          const created = !remote.objects.has(body.storageRef);
          remote.objects.set(body.storageRef, body.record);
          return { status: 200, body: { ...common, storageRef: body.storageRef, created } };
        }
        if (route === "getOpaqueObject") {
          remote.count.get += 1;
          audit.push("starling:get");
          if (remote.mode.failGet) throw new Error("get");
          const record = remote.objects.get(body.storageRef) || null;
          return { status: 200, body: { ...common, storageRef: body.storageRef, present: !!record, record } };
        }
        if (route === "objectPresence") {
          remote.count.presence += 1;
          audit.push("starling:presence");
          if (remote.mode.failPresence) throw new Error("presence");
          return {
            status: 200,
            body: { ...common, rows: body.storageRefs.map((storageRef) => ({ storageRef, present: remote.objects.has(storageRef) })) },
          };
        }
        if (route === "initialiseShadowHead") {
          remote.count.init += 1;
          audit.push("starling:init");
          if (remote.mode.failInit) throw new Error("init");
          if (remote.head === null) remote.head = head(0, null);
          return { status: 200, body: { ...common, head: remote.head } };
        }
        if (route === "readShadowHead") {
          remote.count.read += 1;
          audit.push("starling:read-head");
          if (remote.mode.failRead) throw new Error("read");
          return { status: 200, body: { ...common, head: remote.head } };
        }
        if (route === "compareAndSetShadowHead") {
          remote.count.cas += 1;
          audit.push("starling:cas");
          if (remote.mode.forceConflict) {
            return { status: 409, body: { ...common, ok: false, reason: "head-conflict" } };
          }
          if (!remote.head || remote.head.revision !== body.expectedHead.revision
              || remote.head.sealRef !== body.expectedHead.sealRef) {
            return { status: 409, body: { ...common, ok: false, reason: "head-conflict" } };
          }
          if (!remote.objects.has(body.candidateSealStorageRef)) {
            return { status: 409, body: { ...common, ok: false, reason: "candidate-object-missing" } };
          }
          if (remote.mode.ambiguousNoApply) throw new Error("lost-before-cas");
          remote.head = head(body.expectedHead.revision + 1, body.candidateSealStorageRef);
          if (remote.mode.ambiguousApply) throw new Error("lost-after-cas");
          return { status: 200, body: { ...common, head: remote.head } };
        }
        throw new Error(route);
      },
    },
  });
}

async function createWholeRecord(context, deviceStore, sourceDocument) {
  const syncedPocketId = "p164-pocket";
  const revision = 3;
  const deviceWrappingKey = await context.PocketSyncCrypto.generateDeviceWrappingKey();
  const envelopeContext = {
    syncedPocketId,
    envelopeId: "envelope-p164",
    envelopeKind: "device",
    envelopeVersion: 1,
  };
  const bundle = await context.PocketSyncCrypto.createMasterKeyBundle([
    { context: envelopeContext, wrappingKey: deviceWrappingKey },
  ]);
  const contentContext = {
    syncedPocketId,
    revision,
    contentType: context.PocketSyncCrypto.FORMAT.contentType,
  };
  const record = {
    kind: "pocket.sync.device-state",
    schemaVersion: 5,
    storeRevision: 1,
    syncedPocketId,
    deviceId: "device-p164",
    deviceWrappingKey,
    deviceEnvelope: {
      context: envelopeContext,
      metadata: {
        contractVersion: 1,
        syncedPocketId,
        envelopeId: envelopeContext.envelopeId,
        kind: "device",
        version: 1,
        deviceId: "device-p164",
        createdAt: "2042-01-01T00:00:00.000Z",
        kdf: "none",
      },
      record: bundle.envelopes[0].record,
    },
    content: {
      context: contentContext,
      record: await context.PocketSyncCrypto.sealContent(sourceDocument.payload, bundle.masterKey, contentContext),
    },
    remote: { confirmedRevision: revision, pending: null, conflict: null },
    usage: {
      masterKeyGeneration: 1,
      masterKeyContentEncryptions: 1,
      masterKeyContentEncryptionLimit: 2 ** 20,
      deviceWrappingKeyEncryptions: 1,
    },
    activationDraft: null,
    recoveryDraft: null,
    additionalDeviceDraft: null,
  };
  await deviceStore.createPocket(record);
  return { syncedPocketId, masterKey: bundle.masterKey, revision, record };
}

function wholeContentService(audit = []) {
  const state = { calls: [], mode: "success" };
  return {
    state,
    service: Object.freeze({
      async conditionalUpload(input) {
        state.calls.push(input);
        audit.push("whole:remote");
        if (state.mode === "unknown-once") {
          state.mode = "success";
          throw new Error("unknown");
        }
        if (state.mode === "definite") {
          const error = new Error("definite");
          error.outcome = "definite-failure";
          throw error;
        }
        if (state.mode === "conflict") {
          return { conflict: true, actualRevision: input.expectedRevision + 1 };
        }
        return {
          status: "committed",
          wrote: true,
          operationId: input.operationId,
          revision: input.expectedRevision + 1,
        };
      },
    }),
  };
}

function installPreparation(context, targetPayload, preparation, calls = { count: 0, payload: null }) {
  const map = new WeakMap();
  map.set(targetPayload, plain(preparation));
  context.currentPocketStarlingOwnerSavePreparation = (payload) => {
    calls.count += 1;
    calls.payload = payload;
    const value = map.get(payload);
    return value ? plain(value) : null;
  };
  return calls;
}

function memoisedFreeze(payload, stats = { builds: 0 }) {
  let frozen = null;
  return {
    stats,
    freezePayload() {
      if (frozen === null) {
        stats.builds += 1;
        frozen = payload;
      }
      return frozen;
    },
  };
}

async function controllerFor(context, shared) {
  let seed = shared.seed || 20;
  const objectHeadService = remoteService(context, shared.remote, shared.audit);
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto: context.PocketSyncCrypto,
    deviceStore: shared.deviceStore,
    contentService: shared.whole.service,
    randomBytes(n) { seed += 1; shared.seed = seed; return bytes(n, seed); },
    starlingBootstrap: {
      objectHeadService,
      operationIdFactory(kind, index) { seed += 1; shared.seed = seed; return `p164-${kind}-${index}-${seed}`; },
      normaliseInput(value) { context.__value = value; return vm.runInContext("normaliseInput(__value)", context); },
      normaliseRootExtras(value) { context.__value = value; return vm.runInContext("normaliseRootExtras(__value)", context); },
    },
    starlingSuccessor: { ownerStateStore: shared.ownerStateStore },
  });
  const adopted = await controller.adoptSyncedOwner({
    syncedPocketId: shared.owner.syncedPocketId,
    masterKey: shared.owner.masterKey,
  });
  assert.equal(adopted.ok, true, JSON.stringify(adopted));
  return controller;
}

async function harness() {
  const context = runtime();
  const deviceState = createSharedDeviceStoreState();
  const deviceStore = context.PocketSyncDeviceStore.createStore(createMemoryDeviceStoreDriver(deviceState));
  await deviceStore.open();
  const sourceDocument = normalisedDocument(context, "Alpha", "2026-09-03T05:00:00.000Z");
  const targetDocument = normalisedDocument(context, "Alpha next", "2026-09-03T05:01:00.000Z", {
    details: "target detail",
  });
  const audit = [];
  const ownerStateStore = createOwnerStateStore(context, audit);
  const whole = wholeContentService(audit);
  const remote = remoteState();
  const owner = await createWholeRecord(context, deviceStore, sourceDocument);
  const shared = { context, deviceState, deviceStore, ownerStateStore, whole, remote, owner, audit, seed: 20 };
  const controller = await controllerFor(context, shared);
  const boot = await controller.bootstrapInitialStarlingBase();
  assert.equal(boot.ok, true, JSON.stringify(boot));
  assert.equal(boot.sourceRevision, owner.revision);
  return { ...shared, controller, sourceDocument, targetDocument, boot };
}

async function materialise(context, shared) {
  const record = await shared.deviceStore.readPocket(shared.owner.syncedPocketId);
  const bundle = await context.PocketSyncCrypto.openMasterKeyBundle(
    record.deviceEnvelope.record,
    record.deviceWrappingKey,
    record.deviceEnvelope.context,
    [],
    { semanticAuthority: true }
  );
  const objectHeadService = remoteService(context, shared.remote, shared.audit);
  const opened = await context.PocketStarlingRemoteOpenShadow.createRemoteOpener({
    objectHeadService,
    operationIdFactory: (kind, index) => `material-${kind}-${index}-${shared.remote.count.get}`,
  }).openRemote({
    masterKey: bundle.masterKey,
    context: { syncedPocketId: shared.owner.syncedPocketId },
    semanticAuthority: bundle.semanticAuthority,
  });
  assert.equal(opened.outcome, "opened", JSON.stringify(opened));
  const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(opened.session);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.document;
}

async function rawPrivateState(h) {
  return h.ownerStateStore.records.get(h.owner.syncedPocketId) || null;
}

async function decryptedPrivateState(context, h) {
  const stored = await h.ownerStateStore.read(h.owner.syncedPocketId);
  if (!stored) return null;
  const record = await h.deviceStore.readPocket(h.owner.syncedPocketId);
  return context.PocketSyncCrypto.openContent(
    stored.encrypted.record,
    record.deviceWrappingKey,
    stored.encrypted.context
  );
}

test("P164 mirrors one exact P160 explicit Save only after durable witness and whole-record authority", async () => {
  const h = await harness();
  h.audit.length = 0;
  const prepCalls = installPreparation(h.context, h.targetDocument.payload, preparationFor(h.targetDocument));
  const frozen = memoisedFreeze(h.targetDocument.payload);
  const result = await h.controller.saveSyncedOwner({ freezePayload: frozen.freezePayload });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.confirmedRemoteRevision, 4);
  assert.equal(frozen.stats.builds, 1, "same memoised P160 payload is reused by owner");
  assert.strictEqual(prepCalls.payload, h.targetDocument.payload, "P160 lookup uses exact frozen object identity");
  assert.equal(h.remote.count.cas, 2, "one genesis CAS + one successor CAS");
  assert.equal(h.audit.indexOf("state:write-done") < h.audit.indexOf("whole:remote"), true, h.audit.join(" | "));
  assert.equal(h.audit.indexOf("whole:remote") < h.audit.indexOf("starling:cas"), true, h.audit.join(" | "));
  assert.deepEqual(plain(await materialise(h.context, h)), plain(h.targetDocument.norm));
  const accepted = h.controller.getStarlingBootstrapState();
  assert.equal(accepted.sourceRevision, 4);
  assert.deepEqual(plain(accepted.head), plain(h.remote.head));
  const durable = await decryptedPrivateState(h.context, h);
  assert.equal(durable.accepted.sourceRevision, 4);
  assert.equal(durable.migration, null);
  const raw = JSON.stringify(await rawPrivateState(h));
  for (const forbidden of ["Alpha next", "target detail", "operations", "preservationProjection", "semanticAuthority", "masterKey", "session"]) {
    assert.equal(raw.includes(forbidden), false, forbidden);
  }
  assert.equal(source("js/pocket-starling-owner-successor.js").includes("PocketOwnerSaveBoundary"), false);
});

test("P164 fails closed for invalid P160 preparation and stale Starling base while whole-record Save continues", async () => {
  const invalid = await harness();
  const initialHead = plain(invalid.remote.head);
  invalid.context.currentPocketStarlingOwnerSavePreparation = () => null;
  const invalidSave = await invalid.controller.saveSyncedOwner({
    freezePayload: memoisedFreeze(invalid.targetDocument.payload).freezePayload,
  });
  assert.equal(invalidSave.ok, true);
  assert.equal(invalidSave.confirmedRemoteRevision, 4);
  assert.deepEqual(plain(invalid.remote.head), initialHead);
  assert.equal(invalid.remote.count.cas, 1);

  const stale = await harness();
  stale.context.currentPocketStarlingOwnerSavePreparation = () => null;
  assert.equal((await stale.controller.saveSyncedOwner({
    freezePayload: memoisedFreeze(stale.targetDocument.payload).freezePayload,
  })).ok, true);
  const newer = normalisedDocument(stale.context, "Alpha newer", "2026-09-03T05:02:00.000Z");
  installPreparation(stale.context, newer.payload, preparationFor(newer, 8));
  const staleSave = await stale.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(newer.payload).freezePayload });
  assert.equal(staleSave.ok, true);
  assert.equal(staleSave.confirmedRemoteRevision, 5);
  assert.equal(stale.remote.count.cas, 1, "stale R=3 Starling base cannot mirror whole-record R=4 -> R=5");
});

test("P164 leaves Head unchanged when whole-record Save is not confirmed and pending retry reuses durable migration without fresh P160 freeze", async () => {
  const h = await harness();
  installPreparation(h.context, h.targetDocument.payload, preparationFor(h.targetDocument));
  h.whole.state.mode = "unknown-once";
  const first = await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetDocument.payload).freezePayload });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "remote-outcome-unknown");
  assert.equal(h.remote.count.cas, 1, "no successor Head mutation before whole confirmation");
  let durable = await decryptedPrivateState(h.context, h);
  assert.ok(durable.migration);
  assert.equal(durable.migration.sourceRevision, 3);
  assert.equal(durable.migration.targetRevision, 4);
  const persistedCandidate = plain(durable.migration.descriptor);

  let freezeCalled = 0;
  h.context.currentPocketStarlingOwnerSavePreparation = () => { throw new Error("must not prepare pending retry"); };
  const retried = await h.controller.saveSyncedOwner({
    freezePayload() { freezeCalled += 1; throw new Error("must not freeze pending retry"); },
  });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.reason, "pending-reconciled");
  assert.equal(freezeCalled, 0);
  assert.equal(h.remote.count.cas, 2, "exact durable candidate gets one successor CAS after whole retry confirms");
  assert.deepEqual(plain(await materialise(h.context, h)), plain(h.targetDocument.norm));
  durable = await decryptedPrivateState(h.context, h);
  assert.equal(durable.migration, null);
  assert.equal(durable.accepted.sourceRevision, 4);
  assert.ok(persistedCandidate.candidateSealStorageRef);
});

test("P164 never turns confirmed whole-record Save into failure when post-confirmation Starling publication fails", async () => {
  const h = await harness();
  installPreparation(h.context, h.targetDocument.payload, preparationFor(h.targetDocument));
  h.remote.mode.failPut = true;
  const result = await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetDocument.payload).freezePayload });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.confirmedRemoteRevision, 4);
  assert.equal(h.remote.count.cas, 1, "Head is still the accepted P162 base");
  const durable = await decryptedPrivateState(h.context, h);
  assert.ok(durable.migration, "reentry evidence remains durable");
  assert.equal(durable.migration.targetRevision, 4);
  assert.equal(h.controller.getSyncedOwnerState().confirmedRemoteRevision, 4);
});

test("P164 persists exact candidate before ambiguous CAS, attempts it once, and reconstructs after a fresh runtime without blind retry", async () => {
  const h = await harness();
  installPreparation(h.context, h.targetDocument.payload, preparationFor(h.targetDocument));
  h.remote.mode.ambiguousApply = true;
  h.remote.mode.failRead = true;
  const result = await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetDocument.payload).freezePayload });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.remote.count.cas, 2, "ambiguous successor was attempted exactly once");
  const appliedHead = plain(h.remote.head);
  let durable = await decryptedPrivateState(h.context, h);
  assert.ok(durable.migration);
  assert.equal(durable.migration.phase, "cas-ambiguous");
  assert.equal(durable.migration.casMayHaveRun, true);
  assert.equal(durable.migration.descriptor.candidateSealStorageRef, appliedHead.sealRef);

  h.controller.releaseSyncedOwner();
  h.remote.mode.ambiguousApply = false;
  h.remote.mode.failRead = false;
  const freshContext = runtime();
  const fresh = await controllerFor(freshContext, h);
  freshContext.currentPocketStarlingOwnerSavePreparation = () => null;
  const followOn = normalisedDocument(freshContext, "Whole only after reload", "2026-09-03T05:03:00.000Z");
  const casBefore = h.remote.count.cas;
  const reentered = await fresh.saveSyncedOwner({ freezePayload: memoisedFreeze(followOn.payload).freezePayload });
  assert.equal(reentered.ok, true, JSON.stringify(reentered));
  assert.equal(h.remote.count.cas, casBefore, "reentry authenticates applied lineage; it does not blind-retry Head");
  assert.deepEqual(plain(h.remote.head), appliedHead);
  const accepted = fresh.getStarlingBootstrapState();
  assert.equal(accepted.sourceRevision, 4, "accepted Starling source advances after fresh proof");
  durable = await decryptedPrivateState(freshContext, h);
  assert.equal(durable.migration, null);
  assert.equal(durable.accepted.sourceRevision, 4);
  assert.deepEqual(plain(await materialise(freshContext, h)), plain(h.targetDocument.norm));
});

test("P164 reconstructs a crash-after-witness successor from durable P160 operations rather than whole-document diff", async () => {
  const h = await harness();
  const preparation = preparationFor(h.targetDocument);
  installPreparation(h.context, h.targetDocument.payload, preparation);
  const realRemoteEdit = h.context.PocketStarlingRemoteEditShadow;
  h.context.PocketStarlingRemoteEditShadow = Object.freeze({
    async createEditor() { throw new Error("crash-before-stage"); },
  });
  const result = await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetDocument.payload).freezePayload });
  assert.equal(result.ok, true);
  assert.equal(h.remote.count.cas, 1);
  let durable = await decryptedPrivateState(h.context, h);
  assert.equal(durable.migration.phase, "captured");
  assert.equal(durable.migration.descriptor, null);
  assert.deepEqual(plain(durable.migration.operations), plain(preparation.operations));
  h.context.PocketStarlingRemoteEditShadow = realRemoteEdit;

  h.controller.releaseSyncedOwner();
  const freshContext = runtime();
  const fresh = await controllerFor(freshContext, h);
  freshContext.currentPocketStarlingOwnerSavePreparation = () => null;
  const nextWhole = normalisedDocument(freshContext, "Later whole only", "2026-09-03T05:04:00.000Z");
  const recovered = await fresh.saveSyncedOwner({ freezePayload: memoisedFreeze(nextWhole.payload).freezePayload });
  assert.equal(recovered.ok, true);
  assert.equal(h.remote.count.cas, 2, "old durable P160 witness creates its exact missing successor once");
  durable = await decryptedPrivateState(freshContext, h);
  assert.equal(durable.migration, null);
  assert.equal(durable.accepted.sourceRevision, 4);
  assert.deepEqual(plain(await materialise(freshContext, h)), plain(h.targetDocument.norm));
});

test("P164 retains accepted-Head evidence when final proof fails and a later fresh runtime proves exact target without another CAS", async () => {
  const h = await harness();
  installPreparation(h.context, h.targetDocument.payload, preparationFor(h.targetDocument));
  const originalMaterialize = h.context.PocketStarlingMaterializeShadow;
  h.context.PocketStarlingMaterializeShadow = Object.freeze({
    async materializeAccepted() { return Object.freeze({ ok: false, reason: "proof-crash" }); },
  });
  const result = await h.controller.saveSyncedOwner({ freezePayload: memoisedFreeze(h.targetDocument.payload).freezePayload });
  assert.equal(result.ok, true);
  assert.equal(h.remote.count.cas, 2);
  let durable = await decryptedPrivateState(h.context, h);
  assert.ok(durable.migration);
  assert.equal(durable.migration.phase, "cas-ambiguous");
  const acceptedHead = plain(h.remote.head);
  h.context.PocketStarlingMaterializeShadow = originalMaterialize;
  h.controller.releaseSyncedOwner();

  const freshContext = runtime();
  const fresh = await controllerFor(freshContext, h);
  freshContext.currentPocketStarlingOwnerSavePreparation = () => null;
  const wholeOnly = normalisedDocument(freshContext, "After proof recovery", "2026-09-03T05:05:00.000Z");
  const casBefore = h.remote.count.cas;
  assert.equal((await fresh.saveSyncedOwner({ freezePayload: memoisedFreeze(wholeOnly.payload).freezePayload })).ok, true);
  assert.equal(h.remote.count.cas, casBefore);
  assert.deepEqual(plain(h.remote.head), acceptedHead);
  durable = await decryptedPrivateState(freshContext, h);
  assert.equal(durable.migration, null);
  assert.equal(durable.accepted.sourceRevision, 4);
});

test("P164 owner-private store is strict revision-CAS ciphertext storage and production does not load RemoteSave", async () => {
  const context = runtime();
  const audit = [];
  const store = createOwnerStateStore(context, audit);
  await store.open();
  const wrappingKey = await context.PocketSyncCrypto.generateDeviceWrappingKey();
  const c1 = { syncedPocketId: "strict-pocket", revision: 1, contentType: context.PocketSyncCrypto.FORMAT.contentType };
  const r1 = await context.PocketSyncCrypto.sealContent({ safe: true }, wrappingKey, c1);
  const first = {
    kind: context.PocketStarlingOwnerState.FORMAT.kind,
    schemaVersion: context.PocketStarlingOwnerState.FORMAT.schemaVersion,
    revision: 1,
    syncedPocketId: "strict-pocket",
    deviceId: "strict-device",
    encrypted: { context: c1, record: r1 },
  };
  await store.write({ expectedRevision: null, record: first });
  await assert.rejects(store.write({ expectedRevision: null, record: first }), (error) => error?.code === "revision-conflict");
  const c2 = { ...c1, revision: 2 };
  const second = { ...first, revision: 2, encrypted: { context: c2, record: await context.PocketSyncCrypto.sealContent({ safe: 2 }, wrappingKey, c2) } };
  await assert.rejects(store.write({ expectedRevision: 9, record: second }), (error) => error?.code === "revision-conflict");
  await store.write({ expectedRevision: 1, record: second });
  assert.equal((await store.read("strict-pocket")).revision, 2);

  const production = source("sync-service/pocket-sync-production-server.js");
  assert.match(production, /pocket-starling-owner-successor\.js/);
  assert.match(production, /pocket-starling-durable-publication\.js/);
  assert.match(production, /pocket-starling-owner-state\.js/);
  assert.doesNotMatch(production, /STARLING_BOOTSTRAP_PATHS[\s\S]*pocket-starling-remote-save-shadow\.js/);
  const boundary = source("js/pocket-owner-save-boundary.js");
  assert.equal((boundary.match(/PocketOwnerSaveBoundary/g) || []).length > 0, true);
  assert.doesNotMatch(source("js/pocket-starling-owner-successor.js"), /PocketOwnerSaveBoundary/);
});
