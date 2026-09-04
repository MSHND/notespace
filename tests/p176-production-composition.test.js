"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { createHttpAdapter } = require("../sync-service/pocket-sync-http-adapter.js");
const { createServiceCore } = require("../sync-service/pocket-sync-service-core.js");
const { createMemoryServiceStore } = require("./helpers/p034-memory-service-store.js");
const fixtures = require("./helpers/p032-remote-fixtures.js");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://sync.pocket.example";
const SERVICE_ROOT = "/pocket-sync/v1";
const NOW = Date.parse("2044-01-01T00:00:00.000Z");
const HEAD_SCHEMA = "pocket.starling.head.v1";
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const bytes = (length, seed = 1) => Uint8Array.from({ length }, (_value, index) => (seed + index) & 255);
const b64 = (value) => Buffer.from(value).toString("base64url");

class FixedDate extends Date {
  static now() { return NOW; }
}

function memoryObjectHeadStore(options = {}) {
  const objects = new Map();
  const heads = new Map();
  let initialiseFailures = options.initialiseFailures || 0;
  const objectKey = (pocket, ref) => `${pocket}\u0000${ref}`;
  return Object.freeze({
    async putObject(pocket, storageRef, record) {
      const key = objectKey(pocket, storageRef), serialised = JSON.stringify(record);
      if (objects.has(key)) {
        if (JSON.stringify(objects.get(key)) !== serialised) throw new Error("immutable object mismatch");
        return { ok: true, created: false };
      }
      objects.set(key, plain(record));
      return { ok: true, created: true };
    },
    async getObject(pocket, storageRef) {
      const found = objects.get(objectKey(pocket, storageRef));
      return found === undefined ? null : plain(found);
    },
    async presence(pocket, refs) {
      return refs.map((storageRef) => ({ storageRef, present: objects.has(objectKey(pocket, storageRef)) }));
    },
    async initialiseHead(pocket) {
      if (initialiseFailures > 0) { initialiseFailures -= 1; throw new Error("bounded head initialise failure"); }
      if (!heads.has(pocket)) heads.set(pocket, { schema: HEAD_SCHEMA, revision: 0, sealRef: null });
      return plain(heads.get(pocket));
    },
    async readHead(pocket) {
      return heads.has(pocket) ? plain(heads.get(pocket)) : null;
    },
    async compareAndSetHead(pocket, expected, candidate) {
      const current = heads.get(pocket);
      if (!current || current.revision !== expected.revision || current.sealRef !== expected.sealRef) {
        return { ok: false, reason: "head-conflict" };
      }
      if (!objects.has(objectKey(pocket, candidate))) return { ok: false, reason: "candidate-object-missing" };
      const next = { schema: HEAD_SCHEMA, revision: current.revision + 1, sealRef: candidate };
      heads.set(pocket, next);
      return { ok: true, head: plain(next) };
    },
  });
}

function createIndexedDb() {
  const databases = new Map();
  const observations = { opens: [] };

  function createStoreState(keyPath) {
    return { keyPath, records: new Map() };
  }

  function storeFacade(state) {
    function request(work) {
      const pending = { result: undefined, error: null };
      queueMicrotask(() => {
        try { pending.result = work(); pending.onsuccess?.(); }
        catch (error) { pending.error = error; pending.onerror?.(); }
      });
      return pending;
    }
    return {
      keyPath: state.keyPath,
      autoIncrement: false,
      indexNames: [],
      get(key) { return request(() => state.records.get(key)); },
      getAll() { return request(() => [...state.records.values()]); },
      add(value) {
        const key = value?.[state.keyPath];
        if (state.records.has(key)) throw new Error("duplicate");
        return request(() => { state.records.set(key, value); return key; });
      },
      put(value) {
        const key = value?.[state.keyPath];
        return request(() => { state.records.set(key, value); return key; });
      },
      delete(key) { return request(() => state.records.delete(key)); },
    };
  }

  function databaseFor(name, version) {
    const stores = new Map();
    return {
      version,
      get objectStoreNames() { return [...stores.keys()]; },
      createObjectStore(storeName, options) {
        if (stores.has(storeName) || typeof options?.keyPath !== "string") throw new Error("bad store");
        const state = createStoreState(options.keyPath);
        stores.set(storeName, state);
        return storeFacade(state);
      },
      transaction(storeName) {
        const state = stores.get(storeName);
        if (!state) throw new Error("missing store");
        const tx = {
          error: null,
          objectStore() { return storeFacade(state); },
          abort() { queueMicrotask(() => tx.onabort?.()); },
          oncomplete: null, onabort: null, onerror: null,
        };
        setImmediate(() => tx.oncomplete?.());
        return tx;
      },
      close() {},
      onversionchange: null,
    };
  }

  return {
    observations,
    indexedDB: {
      open(name, version) {
        observations.opens.push(name);
        const pending = { result: null, error: null, transaction: { abort() {} } };
        queueMicrotask(() => {
          let database = databases.get(name);
          if (database && database.version !== version) {
            pending.error = Object.assign(new Error("version"), { name: "VersionError" });
            pending.onerror?.();
            return;
          }
          const created = !database;
          if (!database) {
            database = databaseFor(name, version);
            databases.set(name, database);
          }
          pending.result = database;
          if (created) pending.onupgradeneeded?.({ oldVersion: 0 });
          pending.onsuccess?.();
        });
        return pending;
      },
    },
  };
}

function browserFetch(adapter, observations) {
  let cookie = "";
  return async (url, options) => {
    const headers = new Headers(options.headers);
    headers.set("Origin", ORIGIN);
    headers.set("Sec-Fetch-Site", "same-origin");
    if (cookie) headers.set("Cookie", cookie);
    const entry = { url, method: options.method, body: options.body, status: null };
    observations.push(entry);
    const response = await adapter.handle(new Request(`${ORIGIN}${url}`, {
      method: options.method, headers, body: options.body,
    }));
    entry.status = response.status;
    const setCookie = response.headers.get("Set-Cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    return response;
  };
}

function createService(options = {}) {
  const driver = createMemoryServiceStore();
  const objectHeadStore = memoryObjectHeadStore(options);
  let randomCall = 0;
  const core = createServiceCore({
    store: driver.store,
    objectHeadStore,
    webAuthnVerifier: Object.freeze({
      async verifyRegistration(input) {
        return { credentialId: input.credential.id, publicKey: b64(bytes(64, 81)), publicKeyAlgorithm: -7,
          signCount: 0, transports: ["internal"], backupEligible: true, backedUp: false };
      },
      async verifyAuthentication() { throw new Error("not used"); },
    }),
    recoveryProofVerifier: Object.freeze({ async verifyRecoveryProof() { return { verified: true }; } }),
    randomBytes(length) { randomCall += 1; return bytes(length, randomCall * 13); },
    now: () => NOW,
    trustedOrigin: ORIGIN,
    rpId: "sync.pocket.example",
    rpName: "Pocket",
    credentialAlgorithms: [-7],
    ceremonyLifetimeMs: 300000,
    sessionLifetimeMs: 2592000000,
  });
  return { driver, objectHeadStore, adapter: createHttpAdapter({ core, trustedOrigin: ORIGIN, serviceRoot: SERVICE_ROOT }) };
}

const BASE_UI_FILES = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js",
];
const SYNC_BASE_FILES = [
  "js/pocket-sync-security-contract.js", "js/pocket-device-changes.js", "js/pocket-sync-crypto.js",
  "js/pocket-sync-device-store.js", "js/pocket-sync-account-client.js", "js/pocket-sync-remote-client.js",
  "js/pocket-sync-activation.js", "js/pocket-sync-owner-controller.js", "js/pocket-owner-save-boundary.js",
  "js/pocket-sync-activation-owner-bridge.js", "js/pocket-sync-browser-runtime.js",
];
const PRODUCTION_PRE_STARLING = [
  "js/pocket-sync-additional-device.js", "js/pocket-sync-emergency-recovery.js", "js/pocket-sync-local-integration.js",
];
const STARLING_FILES = [
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
  "js/pocket-starling-publication-shadow.js",
  "js/pocket-starling-remote-open-shadow.js",
  "js/pocket-starling-materialize-shadow.js",
  "js/pocket-starling-logical-edit-shadow.js",
  "js/pocket-starling-remote-edit-shadow.js",
  "js/pocket-starling-durable-publication.js",
  "js/pocket-starling-owner-state.js",
  "js/pocket-starling-owner-bootstrap.js",
  "js/pocket-starling-owner-successor.js",
  "js/pocket-starling-real-truth-admission.js",
];
const SERVICE_ROOT_STARLING = new Set([
  "js/pocket-starling-owner-bootstrap.js",
  "js/pocket-starling-owner-successor.js",
  "js/pocket-starling-real-truth-admission.js",
]);

function productionHarness(options = {}) {
  const service = createService(options);
  const requests = [];
  const idb = createIndexedDb();
  let ownerKind = "json", sessionId = 1, freezeCalls = 0, pickerCalls = 0, passkeyCalls = 0;
  const recoveryWrites = [];
  const context = {
    crypto: webcrypto, CryptoKey: globalThis.CryptoKey, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    URL, Request, Response, Headers, Buffer, Date: FixedDate, Math, JSON, Map, Set, WeakMap, WeakSet,
    Object, Array, String, Number, Boolean, Promise, Error, TypeError, structuredClone,
    setTimeout, clearTimeout, queueMicrotask,
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { href: ORIGIN },
    document: {
      currentScript: null,
      body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener() {}, removeEventListener() {}, createElement() { return {}; },
    },
    console: { log() {}, info() {}, warn() {}, error() {} },
    indexedDB: idb.indexedDB,
    fetch: browserFetch(service.adapter, requests),
    navigator: { clipboard: {}, credentials: {
      async create() { passkeyCalls += 1; return fixtures.nativeRegistrationCredential(); },
      async get() { throw new Error("not used"); },
    } },
    async showSaveFilePicker() {
      pickerCalls += 1;
      return { async createWritable() { return {
        async write(value) { recoveryWrites.push(value); }, async close() {}, async abort() {},
      }; } };
    },
    open() {}, close() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    capturePocketFileSaveSession() {
      return { id: sessionId, handle: ownerKind === "json" ? { local: true } : null, ownerKind,
        vaultSessionId: "", pipSession: false, detachedDeviceChanges: false, storagePrivacy: ownerKind === "synced" ? "synced" : "" };
    },
    isPocketFileSaveSessionCurrent(value) { return !!value && value.id === sessionId && value.ownerKind === ownerKind; },
    setPocketFileSession(_handle, _name, setup = {}) { ownerKind = setup.ownerKind || "json"; sessionId += 1; },
    capturePocketFileOwnerForAdoption() { return { ownerKind, id: sessionId }; },
    restorePocketFileOwnerAfterFailedAdoption() { return true; },
    hasPocketUnsavedChanges() { return false; },
    hasUnsavedDetailsEditorChanges() { return false; },
    hasUnsavedInlineTitleDraft() { return false; },
    captureActiveInlineEditForOwnerSwitch() { return { ok: true, active: false }; },
    commitActiveInlineEditForOwnerSwitch() { return { ok: true, changed: false }; },
    isPocketEditorSourceIdentityCurrent() { return false; },
    async exportTree() { return { ok: true }; },
    setStatus() {}, undoLastEditAction() { return true; }, undoLastDeleteAction() { return true; },
    nodeMap() { return new Map(); }, freezePocketStarlingOwnerWorkingSetThrough() { return { operations: [] }; },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of BASE_UI_FILES) vm.runInContext(source(file), context, { filename: file });
  context.__initialNodes = [{ id: "a", parentId: "root", order: 1001, label: "Alpha",
    details: "initial", updatedAt: new FixedDate(NOW).toISOString(), source: "manual" }];
  vm.runInContext("state.nodes=__initialNodes;state.tombstones=[];state.rootExtras={};state.dataExtras={};state.ops=[];state.operationHighWater=0;state.activeSaveOperationCeiling=0;state.source={schema:'portal.mtt.web.v1',fileName:'throwaway.json',writtenAt:''};", context);

  const originalBuildPayload = context.buildPocketPayload;
  context.buildPocketPayload = function observedBuildPocketPayload(...args) {
    freezeCalls += 1;
    return originalBuildPayload(...args);
  };
  for (const file of SYNC_BASE_FILES) vm.runInContext(source(file), context, { filename: file });
  for (const file of PRODUCTION_PRE_STARLING) {
    context.document.currentScript = file === "js/pocket-sync-local-integration.js"
      ? { dataset: { serviceRoot: SERVICE_ROOT } } : null;
    vm.runInContext(source(file), context, { filename: file });
  }
  for (const file of STARLING_FILES) {
    context.document.currentScript = SERVICE_ROOT_STARLING.has(file)
      ? { dataset: { serviceRoot: SERVICE_ROOT } } : null;
    vm.runInContext(source(file), context, { filename: file });
  }
  context.document.currentScript = null;
  vm.runInContext(source("js/pocket-sync-production-bootstrap.js"), context,
    { filename: "js/pocket-sync-production-bootstrap.js" });

  function currentPayload() {
    return context.buildPocketPayload(new FixedDate(NOW).toISOString());
  }
  function normalised(payload) {
    context.__p176Payload = payload;
    const parsed = vm.runInContext("normaliseInput(__p176Payload)", context);
    const dataExtras = vm.runInContext("normaliseRootExtras(__p176Payload.data)||{}", context);
    return { schema: parsed.schema, writtenAt: parsed.writtenAt, nodes: parsed.nodes,
      tombstones: parsed.tombstones, rootExtras: parsed.rootExtras || {}, dataExtras };
  }
  function payloadOnly(node) {
    const result = {};
    for (const key of Object.keys(node)) if (!["id", "parentId", "order"].includes(key)) result[key] = plain(node[key]);
    return result;
  }
  function installPreparation(payload, ceiling) {
    const target = normalised(payload);
    const node = target.nodes.find((entry) => entry.id === "a");
    const preparation = { ceiling, operations: [{ type: "payload", input: { nodeId: "a", payload: payloadOnly(node) } }],
      preservationProjection: { source: { schema: target.schema, writtenAt: target.writtenAt },
        tombstones: plain(target.tombstones), rootExtras: plain(target.rootExtras), dataExtras: plain(target.dataExtras) } };
    context.__p176PreparationPayload = payload;
    context.__p176Preparation = preparation;
    context.currentPocketStarlingOwnerSavePreparation = (candidate) => candidate === context.__p176PreparationPayload
      ? plain(context.__p176Preparation) : null;
  }
  function setLabel(label) {
    context.__p176Label = label;
    vm.runInContext("state.nodes[0].label=__p176Label;state.nodes[0].updatedAt=new Date().toISOString();", context);
  }
  function routeCount(suffix) { return requests.filter((entry) => entry.url.endsWith(suffix)).length; }
  function routeIndex(suffix, occurrence = 0) {
    const indexes = requests.map((entry, index) => entry.url.endsWith(suffix) ? index : -1).filter((index) => index >= 0);
    return indexes[occurrence] ?? -1;
  }
  async function readRemoteState() {
    const remote = context.PocketSyncRemoteClient;
    const transport = remote.createBrowserJsonTransport({ serviceRoot: SERVICE_ROOT });
    const session = context.PocketOwnerSaveBoundary.captureOwnerSaveSession();
    assert.equal(session?.ownerKind, "synced");
    const syncedPocketId = session.controllerSession.syncedPocketId;
    const authorityService = remote.createPersistenceAuthorityService({ transport });
    const objectHeadService = remote.createObjectHeadService({ transport });
    const contentService = remote.createContentService({ transport });
    const authority = await authorityService.read({ apiVersion: 1, operationId: `p176-authority-${requests.length}`, syncedPocketId });
    const head = await objectHeadService.readShadowHead({ apiVersion: 1, operationId: `p176-head-${requests.length}`, syncedPocketId });
    const revision = await contentService.readRevision({ apiVersion: 1, operationId: `p176-revision-${requests.length}`, syncedPocketId });
    return { syncedPocketId, authority: authority.authority, head: head.head, revision: revision.revision };
  }
  return {
    context, requests, idb, service, currentPayload, installPreparation, setLabel, routeCount, routeIndex, readRemoteState,
    get ownerKind() { return ownerKind; }, get freezeCalls() { return freezeCalls; },
    get pickerCalls() { return pickerCalls; }, get passkeyCalls() { return passkeyCalls; }, get recoveryWrites() { return recoveryWrites; },
  };
}

async function activateFresh(h) {
  assert.ok(h.context.PocketSyncActiveIntegration, "production bootstrap must create active integration");
  const result = await h.context.PocketSyncActiveIntegration.activate();
  assert.equal(result.ok, true, JSON.stringify({ result, routes: h.requests.map((entry) => [entry.url, entry.status]) }));
  assert.equal(h.ownerKind, "synced");
  assert.equal(h.context.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.equal(h.passkeyCalls, 1);
  assert.equal(h.pickerCalls, 1);
  assert.equal(h.recoveryWrites.length, 1);
  const roundTrip = await h.context.PocketSyncActiveIntegration.verifyRoundTrip();
  assert.deepEqual(plain(roundTrip), { ok: true, revision: 1, matchesCurrentSavedPocket: true });
  return result;
}

test("P176 exact production fresh activation bootstraps H, adopts authority, then saves dirty payload only through Starling", async () => {
  const h = productionHarness();
  await activateFresh(h);
  const ownerSession = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession();
  assert.equal(ownerSession.controller.getStarlingBootstrapState(), null,
    "fresh activation starts with whole-record R=1 and no accepted Starling base");
  const wholeUploadsBefore = h.routeCount("/pockets/content/conditional-upload");
  assert.equal(wholeUploadsBefore, 1, "activation establishes exactly R=1");

  h.setLabel("Alpha migrated");
  const target = h.currentPayload();
  h.installPreparation(target, 1);
  let boundaryFreezeCalls = 0;
  const saved = await h.context.PocketOwnerSaveBoundary.save({
    expectedSession: h.context.capturePocketFileSaveSession(),
    freezePayload: async () => { boundaryFreezeCalls += 1; return target; },
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(boundaryFreezeCalls, 1, "P172 freezes intended payload exactly once through bootstrap and cutover");
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeUploadsBefore,
    "migration-triggering Save must not create R=2");

  const state = await h.readRemoteState();
  assert.equal(state.revision, 1, "whole-record R stays retained at the activation revision");
  assert.equal(state.authority.currentMode, "starling");
  assert.equal(state.authority.transition, null);
  assert.equal(state.authority.rollbackRevision, 1);
  assert.equal(state.authority.authorityRevision, 3);
  assert.equal(state.head.revision, 2, "H bootstrap is revision 1 and dirty successor H1 is revision 2");
  assert.equal(state.authority.adoptionHead.revision, 1);
  assert.notEqual(state.authority.adoptionHead.sealRef, state.head.sealRef);
  assert.equal(h.context.PocketStarlingRealTruthAdmission.isStarlingUndoGuardActive(), true);
  assert.equal(ownerSession.controller.getStarlingBootstrapState()?.ready, true);
  assert.ok(h.idb.observations.opens.includes("pocket.sync.device.v1"));
  assert.ok(h.idb.observations.opens.includes("pocket.starling.owner-state.v1"));

  assert.ok(h.routeCount("/pockets/head/initialise") >= 1);
  assert.ok(h.routeCount("/pockets/objects/put") >= 1);
  assert.equal(h.routeCount("/pockets/head/compare-and-set"), 2);
  assert.equal(h.routeCount("/pockets/authority/fence/acquire"), 1);
  assert.equal(h.routeCount("/pockets/authority/starling/adopt"), 1);
  const bootstrapCas = h.routeIndex("/pockets/head/compare-and-set", 0);
  const fence = h.routeIndex("/pockets/authority/fence/acquire");
  const adoption = h.routeIndex("/pockets/authority/starling/adopt");
  const authoritativeCas = h.routeIndex("/pockets/head/compare-and-set", 1);
  assert.ok(bootstrapCas >= 0 && bootstrapCas < fence && fence < adoption && adoption < authoritativeCas,
    "accepted P162 bootstrap precedes P168 fence/adoption and dirty authoritative CAS");
  assert.ok(h.requests.slice(bootstrapCas + 1, fence).some((entry) => entry.url.endsWith("/pockets/objects/get")),
    "fresh-open/equality proof reads accepted encrypted objects before authority adoption");

  const roundTrip = await h.context.PocketSyncActiveIntegration.verifyRoundTrip();
  assert.deepEqual(plain(roundTrip), { ok: false, reason: "round-trip-starling-authority" });
});

test("P176 exact production failure at initial Head establishment is bounded and cannot advance whole-record R", async () => {
  const h = productionHarness({ initialiseFailures: 1 });
  await activateFresh(h);
  const wholeUploadsBefore = h.routeCount("/pockets/content/conditional-upload");
  h.setLabel("Must not become R=2");
  const target = h.currentPayload();
  h.installPreparation(target, 1);
  const saved = await h.context.PocketOwnerSaveBoundary.save({
    expectedSession: h.context.capturePocketFileSaveSession(),
    freezePayload: async () => target,
  });
  assert.deepEqual(plain({ ok: saved.ok, reason: saved.reason, bootstrapReason: saved.bootstrapReason }), {
    ok: false, reason: "starling-cutover-bootstrap-failed", bootstrapReason: "bootstrap-head-outcome-unknown",
  });
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeUploadsBefore);
  assert.equal(h.routeCount("/pockets/authority/fence/acquire"), 0);
  assert.equal(h.routeCount("/pockets/authority/starling/adopt"), 0);
  const state = await h.readRemoteState();
  assert.equal(state.revision, 1);
  assert.equal(state.authority.currentMode, "whole-record");
  assert.equal(state.authority.transition, null);
  assert.equal(state.head, null);
  const roundTrip = await h.context.PocketSyncActiveIntegration.verifyRoundTrip();
  assert.deepEqual(plain(roundTrip), { ok: true, revision: 1, matchesCurrentSavedPocket: true });
});
