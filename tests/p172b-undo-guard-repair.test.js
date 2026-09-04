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

function runtime(mode, { outerReadFails = false } = {}) {
  class HTMLElement { focus() {} }
  class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  const storage = new Map();
  const statuses = [];
  const rows = ["a", "b", "c"].map((id) => ({
    getAttribute(name) { return name === "data-node-id" ? id : null; },
    classList: { add() {}, remove() {} }, focus() {},
  }));
  const treeRoot = new HTMLElement();
  treeRoot.querySelectorAll = () => rows;
  const authority = mode === "starling" ? {
    schema: "pocket.sync.persistence-authority.v1", authorityRevision: 3,
    currentMode: "starling", transition: null, rollbackRevision: 3,
    adoptionHead: { schema: "pocket.starling.head.v1", revision: 1, sealRef: "seal-1" },
  } : {
    schema: "pocket.sync.persistence-authority.v1", authorityRevision: 1,
    currentMode: "whole-record", transition: null, rollbackRevision: null, adoptionHead: null,
  };
  let outerFails = outerReadFails;
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect,
    JSON, Date, Math, Promise, structuredClone, HTMLElement, HTMLInputElement,
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    state: {
      nodes: [node("a", 10), node("b", 20), node("c", 30)], tombstones: [], rootExtras: {}, dataExtras: {},
      collapsed: new Set(), selectedId: "a", multiSelectedIds: new Set(["b"]), multiSelectAnchorId: "",
      focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0,
      operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null,
      source: { schema: "portal.export.v1", fileName: "p172b.json", writtenAt: "" },
    },
    lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "",
    el: { search: new HTMLInputElement(), treeRoot },
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
    },
    DEVICE_CHANGE_SEQUENCE_KEY: "p172b.sequence",
    nowIso() { return "2026-09-04T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); },
    compareSiblingOrder(left, right) { return (Number(left.order) || 0) - (Number(right.order) || 0); },
    nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); },
    childrenMap() {
      const result = new Map();
      for (const entry of context.state.nodes) {
        const parent = entry.parentId || "root";
        if (!result.has(parent)) result.set(parent, []);
        result.get(parent).push(entry);
      }
      for (const siblings of result.values()) siblings.sort(context.compareSiblingOrder);
      return result;
    },
    isManagedSystemBucketNode() { return false; }, isCompletedSystemBucketNode() { return false; },
    requirePocketFileForChanges() { return true; }, clearInlineEditState() {}, expandPathToNode() {},
    refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {},
    focusRowByNodeId() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(callback) { callback?.(); return 1; },
    flashTouchedRow() {}, setStatus(...args) { statuses.push(plain(args)); }, saveLastSaveSnapshot() {},
    saveLocalSafetySnapshot() { return true; }, confirm() { return true; }, setTimeout() { return 1; }, clearTimeout() {},
    document: {
      readyState: "loading", currentScript: { dataset: { serviceRoot: "/sync" } },
      addEventListener() {}, getElementById() { return null; }, head: { appendChild() {} }, createElement() { return {}; },
    },
    PocketDeviceChanges: {
      cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } },
      coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; },
      describeDocumentTransition() { return { ok: true, records: [] }; },
    },
    normaliseInput(value) { return value; }, normaliseRootExtras() { return {}; },
    PocketStarlingObjectSealShadow: {
      OBJECT_SCHEMA: "object", ROOT_SCHEMA: "root", SEAL_SCHEMA: "seal", SEQUENCE_SCHEMA: "sequence",
      canonical(value) { return { ok: true, bytes: JSON.stringify(value) }; }, refFor() { return "ref"; },
    },
    PocketStarlingBridgeShadow: { encode() { return { ok: false }; } },
    PocketStarlingPlacementShadow: { audit() { return { ok: false }; } },
    PocketStarlingLogicalEditShadow: { async compose() { return { ok: false }; } },
    PocketStarlingRemoteEditShadow: { async createEditor() { return {}; } },
    PocketStarlingDurablePublication: {
      validateDescriptor(value) { return value; }, descriptorFromPrepared(value) { return value; },
      createCoordinator() { return { async ensureObjects() {}, async attemptHead() {}, async reconcile() {} }; },
    },
    PocketSyncCrypto: { encodeBase64Url(value) { return Buffer.from(value).toString("base64url"); } },
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    "js/pocket-starling-owner-working-set-shadow.js",
    "js/pocket-history-status.js",
    "js/pocket-tree-actions.js",
    "js/pocket-multi-select.js",
  ]) vm.runInContext(source(file), context, { filename: file });
  // Keep the real history/multi-delete mutation and undo functions, but replace display-only
  // refresh work that depends on the complete browser chrome outside this focused harness.
  context.refreshMeta = () => {};
  context.renderTree = () => {};
  context.persistPipSnapshot = () => {};
  context.refocusTreeNavigation = () => {};

  const innerAuthorityService = {
    async read(input) { return { authority, syncedPocketId: input.syncedPocketId }; },
    async acquireFence() { return { authority }; }, async commitStarlingAdoption() { return { authority }; },
    async releaseFence() { return { authority }; },
  };
  context.PocketSyncRemoteClient = {
    createBrowserJsonTransport() { return {}; },
    createPersistenceAuthorityService() {
      return {
        async read() { if (outerFails) throw new Error("refresh unavailable"); return { authority }; },
        async acquireFence() { return { authority }; }, async commitStarlingAdoption() { return { authority }; },
        async releaseFence() { return { authority }; },
      };
    },
    createObjectHeadService() { return { async readShadowHead() { return { head: authority.adoptionHead }; } }; },
  };
  context.PocketSyncOwnerController = {
    createSyncedOwnerController(configuration) {
      const service = configuration.starlingBootstrap.persistenceAuthorityService;
      return {
        captureSyncedOwnerSaveSession() { return { syncedPocketId: "pocket-p172b" }; },
        async adoptSyncedOwner() {
          const proved = await service.read({ apiVersion: 1, operationId: "inner", syncedPocketId: "pocket-p172b" });
          assert.equal(proved.authority.currentMode, mode);
          return { ok: true };
        },
        async saveSyncedOwner() { return { ok: false }; }, releaseSyncedOwner() { return true; },
      };
    },
  };
  vm.runInContext(source("js/pocket-starling-real-truth-admission.js"), context,
    { filename: "js/pocket-starling-real-truth-admission.js" });
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({
    starlingBootstrap: {
      objectHeadService: {}, persistenceAuthorityService: innerAuthorityService,
      operationIdFactory() { return "op"; }, normaliseInput(value) { return value; }, normaliseRootExtras() { return {}; },
    },
  });
  return {
    context, controller, statuses,
    failOuterRead() { outerFails = true; },
  };
}

function deleteMany(context) {
  assert.equal(context.deleteMultiSelectionIfActive(), true);
  const forward = plain(context.state.ops.at(-1));
  assert.equal(forward.type, "delete_many");
  return forward;
}

test("P172b real delete_many undo is blocked before visible mutation under proved Starling authority", async () => {
  const harness = runtime("starling");
  assert.equal((await harness.controller.adoptSyncedOwner()).ok, true);
  assert.equal(harness.context.PocketStarlingRealTruthAdmission.isStarlingUndoGuardActive(), true);
  deleteMany(harness.context);
  const afterDelete = plain(harness.context.state.nodes);
  const operationCount = harness.context.state.ops.length;
  const result = harness.context.undoLastDeleteAction();
  assert.equal(result, false);
  assert.deepEqual(plain(harness.context.state.nodes), afterDelete);
  assert.equal(harness.context.state.ops.length, operationCount);
  assert.equal(harness.context.state.ops.some((operation) => operation.type === "undo_delete_many"), false);
});

test("P172b controller-proved Starling authority survives failed follow-up refresh for the same active owner", async () => {
  const harness = runtime("starling", { outerReadFails: true });
  assert.equal((await harness.controller.adoptSyncedOwner()).ok, true);
  assert.equal(harness.context.PocketStarlingRealTruthAdmission.isStarlingUndoGuardActive(), true);
  deleteMany(harness.context);
  const afterDelete = plain(harness.context.state.nodes);
  assert.equal(harness.context.undoLastDeleteAction(), false);
  assert.deepEqual(plain(harness.context.state.nodes), afterDelete);
});

test("P172b proved whole-record owner retains legacy bulk undo compatibility when refresh is unavailable", async () => {
  const harness = runtime("whole-record", { outerReadFails: true });
  assert.equal((await harness.controller.adoptSyncedOwner()).ok, true);
  assert.equal(harness.context.PocketStarlingRealTruthAdmission.isStarlingUndoGuardActive(), false);
  deleteMany(harness.context);
  const result = harness.context.undoLastDeleteAction();
  assert.notEqual(result, false);
  assert.deepEqual(plain(harness.context.state.nodes.map((entry) => entry.id)), ["a", "b", "c"]);
  assert.equal(harness.context.state.ops.at(-1).type, "undo_delete_many");
});
