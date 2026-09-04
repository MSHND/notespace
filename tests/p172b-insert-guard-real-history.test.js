"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const node = (id, order) => ({ id, parentId: "root", order, label: id, updatedAt: "2026-09-04T00:00:00.000Z" });

function runtime() {
  class HTMLElement { focus() {} }
  class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  const storage = new Map(), statuses = [];
  const treeRoot = new HTMLElement(); treeRoot.querySelectorAll = () => [];
  const authority = { schema: "pocket.sync.persistence-authority.v1", authorityRevision: 3,
    currentMode: "starling", transition: null, rollbackRevision: 3,
    adoptionHead: { schema: "pocket.starling.head.v1", revision: 2, sealRef: "seal-2" } };
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect, JSON, Date, Math,
    Promise, structuredClone, HTMLElement, HTMLInputElement, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    state: { nodes: [node("a", 10)], tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "a",
      focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0,
      operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null,
      source: { schema: "portal.export.v1", fileName: "p172b-insert.json", writtenAt: "" } },
    lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "",
    el: { search: new HTMLInputElement(), treeRoot },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } },
    DEVICE_CHANGE_SEQUENCE_KEY: "p172b.insert.sequence", nowIso() { return "2026-09-04T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); },
    nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); },
    requirePocketFileForChanges() { return true; }, clearInlineEditState() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {},
    persistPipSnapshot() {}, refocusTreeNavigation() {}, saveLocalSafetySnapshot() { return true; },
    setStatus(...args) { statuses.push(plain(args)); }, requestAnimationFrame(callback) { callback?.(); return 1; },
    document: { readyState: "loading", currentScript: { dataset: { serviceRoot: "/sync" } }, addEventListener() {},
      getElementById() { return null; }, head: { appendChild() {} }, createElement() { return {}; } },
    setTimeout() { return 1; }, clearTimeout() {},
    PocketDeviceChanges: {
      cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } },
      coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; },
      describeDocumentTransition() { return { ok: true, records: [] }; },
    },
    normaliseInput(value) { return value; }, normaliseRootExtras() { return {}; },
    PocketStarlingObjectSealShadow: { OBJECT_SCHEMA: "object", ROOT_SCHEMA: "root", SEAL_SCHEMA: "seal", SEQUENCE_SCHEMA: "sequence",
      canonical(value) { return { ok: true, bytes: JSON.stringify(value) }; }, refFor() { return "ref"; } },
    PocketStarlingBridgeShadow: { encode() { return { ok: false }; } }, PocketStarlingPlacementShadow: { audit() { return { ok: false }; } },
    PocketStarlingLogicalEditShadow: { async compose() { return { ok: false }; } },
    PocketStarlingRemoteEditShadow: { async createEditor() { return {}; } },
    PocketStarlingDurablePublication: { validateDescriptor(value) { return value; }, descriptorFromPrepared(value) { return value; },
      createCoordinator() { return { async ensureObjects() {}, async attemptHead() {}, async reconcile() {} }; } },
    PocketSyncCrypto: { encodeBase64Url(value) { return Buffer.from(value).toString("base64url"); } },
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of ["js/pocket-starling-owner-working-set-shadow.js", "js/pocket-history-status.js"])
    vm.runInContext(source(file), context, { filename: file });
  context.PocketSyncRemoteClient = {
    createBrowserJsonTransport() { return {}; },
    createPersistenceAuthorityService() { return { async read() { return { authority }; }, async acquireFence() { return { authority }; },
      async commitStarlingAdoption() { return { authority }; }, async releaseFence() { return { authority }; } }; },
    createObjectHeadService() { return { async readShadowHead() { return { head: authority.adoptionHead }; } }; },
  };
  context.PocketSyncOwnerController = {
    createSyncedOwnerController(configuration) {
      const service = configuration.starlingBootstrap.persistenceAuthorityService;
      return { captureSyncedOwnerSaveSession() { return { syncedPocketId: "pocket-p172b-insert" }; },
        async adoptSyncedOwner() { await service.read({ syncedPocketId: "pocket-p172b-insert" }); return { ok: true }; },
        async saveSyncedOwner() { return { ok: false }; }, releaseSyncedOwner() { return true; } };
    },
  };
  vm.runInContext(source("js/pocket-starling-real-truth-admission.js"), context,
    { filename: "js/pocket-starling-real-truth-admission.js" });
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({ starlingBootstrap: {
    objectHeadService: {}, persistenceAuthorityService: { async read() { return { authority }; }, async acquireFence() { return { authority }; },
      async commitStarlingAdoption() { return { authority }; }, async releaseFence() { return { authority }; } },
    operationIdFactory() { return "op"; }, normaliseInput(value) { return value; }, normaliseRootExtras() { return {}; },
  } });
  return { context, controller, statuses };
}

function createCapturedInsert(context) {
  const snapshot = context.createTreeUndoSnapshot("add");
  const fresh = node("new", 20); context.state.nodes.push(fresh); context.state.selectedId = "new";
  const operation = context.recordOp({ type: "add_below", id: "new" });
  assert.equal(context.capturePocketStarlingNodeInsert(operation.seq, fresh, "root", 1), true);
  assert.equal(context.bindP153InsertUndoWitness(snapshot, "new", operation.seq, true), true);
  context.lastEditUndoSnapshot = snapshot; context.lastTreeUndoKind = "edit";
  return operation;
}

test("P172b real P153 immediate uncovered Insert undo still cancels before Save coverage", async () => {
  const h = runtime(); assert.equal((await h.controller.adoptSyncedOwner()).ok, true);
  const operation = createCapturedInsert(h.context);
  assert.deepEqual(plain(h.context.freezePocketStarlingOwnerWorkingSetThrough(operation.seq).operations),
    [{ type: "insert", input: { nodeId: "new", parentId: "root", toIndex: 1,
      payload: { label: "new", updatedAt: "2026-09-04T00:00:00.000Z" } } }]);
  const result = h.context.undoLastEditAction();
  assert.notEqual(result, false);
  assert.equal(h.context.nodeMap().has("new"), false);
  assert.deepEqual(plain(h.context.freezePocketStarlingOwnerWorkingSetThrough(h.context.state.operationHighWater).operations), []);
});

test("P172b real P153 covered Insert undo is refused before visible mutation in Starling mode", async () => {
  const h = runtime(); assert.equal((await h.controller.adoptSyncedOwner()).ok, true);
  const operation = createCapturedInsert(h.context); h.context.state.activeSaveOperationCeiling = operation.seq;
  const beforeNodes = plain(h.context.state.nodes), beforeOps = plain(h.context.state.ops);
  const result = h.context.undoLastEditAction();
  assert.equal(result, false);
  assert.deepEqual(plain(h.context.state.nodes), beforeNodes);
  assert.deepEqual(plain(h.context.state.ops), beforeOps);
  assert.equal(h.context.nodeMap().has("new"), true);
});
