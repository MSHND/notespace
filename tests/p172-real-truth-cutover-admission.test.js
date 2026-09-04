"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-starling-real-truth-admission.js";
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function canonical(value) { return JSON.stringify(stable(value)); }
function hash(text) {
  let h = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function refFor(kind, bytes) { return `proof-ref:v1:${kind}:${hash(`${kind}:${bytes}`)}`; }
function logicalObject(kind, value, objects) {
  const object = { ...value, kind };
  const bytes = canonical(object), ref = refFor(kind, bytes);
  objects.set(ref, bytes);
  return ref;
}
function trieForKey(kind, key, valueRef, objects) {
  let ref = logicalObject(kind, { schema: "object-v1", hasValue: true, valueRef, children: [] }, objects);
  for (let index = key.length - 1; index >= 0; index -= 1) {
    ref = logicalObject(kind, { schema: "object-v1", hasValue: false, valueRef: null,
      children: [{ key: key[index], ref }] }, objects);
  }
  return ref;
}
function candidateGraph({ writtenAt = "2040-01-01T00:00:00.000Z" } = {}) {
  const objects = new Map();
  const sequenceRef = logicalObject("sequence-leaf", {
    schema: "sequence-v2", capacity: 4, count: 0, items: [],
  }, objects);
  const contentRef = logicalObject("content-trie", {
    schema: "object-v1", hasValue: false, valueRef: null, children: [],
  }, objects);
  const placementRef = logicalObject("placement-trie", {
    schema: "object-v1", hasValue: false, valueRef: null, children: [],
  }, objects);
  const childrenRef = trieForKey("children-trie", "root", sequenceRef, objects);
  const preservationRef = logicalObject("preservation", {
    schema: "object-v1", value: {
      source: { schema: "portal.mtt.web.v1", writtenAt }, tombstones: [], rootExtras: {}, dataExtras: {},
    },
  }, objects);
  const rootRef = logicalObject("pocket-root", {
    schema: "root-v1", capacity: 4, contentRef, placementRef, childrenRef, preservationRef,
  }, objects);
  const sealRef = logicalObject("candidate-seal", {
    schema: "seal-v1", rootRef, previousSealRef: "storage:head-one",
  }, objects);
  return Object.freeze({
    rootRef, sealRef, newLogicalRefs: Object.freeze([...objects.keys()]),
    resolveLogical: (ref) => objects.get(ref), diagnostics: Object.freeze({}),
  });
}

function harness(options = {}) {
  const events = [];
  const counts = { bootstrap: 0, freeze: 0, cas: 0, visibleEditUndo: 0, visibleDeleteUndo: 0 };
  let authorityMode = options.authorityMode || "whole-record";
  let bootstrapState = options.existingBase ? { ready: true, sourceRevision: 4,
    head: { schema: "pocket.starling.head.v1", revision: 1, sealRef: "storage:head-one" } } : null;
  let mismatch = options.mismatch === true;
  let pendingDescriptor = null;
  const expectedHead = { schema: "pocket.starling.head.v1", revision: 1, sealRef: "storage:head-one" };
  const payload = { schema: "portal.export.v1", norm: { schema: "portal.mtt.web.v1",
    writtenAt: "2040-01-01T00:00:00.000Z", nodes: [], tombstones: [], rootExtras: {} }, data: {} };

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Promise, JSON, Date,
    Uint8Array, TextEncoder, TextDecoder, ArrayBuffer, crypto: webcrypto,
    console: { log() {}, warn() {}, error() {} },
    document: { currentScript: { dataset: { serviceRoot: "/sync" } } },
    state: { operationHighWater: 0, activeSaveOperationCeiling: 0, ops: [] },
    lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null,
    nodeMap() { return new Map(); },
    freezePocketStarlingOwnerWorkingSetThrough() { return { operations: [] }; },
    setStatus() {},
    undoLastEditAction() { counts.visibleEditUndo += 1; return true; },
    undoLastDeleteAction() { counts.visibleDeleteUndo += 1; return true; },
    normaliseInput(value) { return value.norm; },
    normaliseRootExtras() { return {}; },
    PocketSyncCrypto: {
      encodeBase64Url(bytes) { return Buffer.from(bytes).toString("base64url"); },
    },
    PocketSyncRemoteClient: {
      createBrowserJsonTransport() { return {}; },
      createPersistenceAuthorityService() {
        return { async read() { return { authority: { authorityRevision: authorityMode === "starling" ? 3 : 1,
          currentMode: authorityMode, transition: null,
          rollbackRevision: authorityMode === "starling" ? 4 : null,
          adoptionHead: authorityMode === "starling" ? expectedHead : null } }; } };
      },
      createObjectHeadService() { return { async readShadowHead() { return { head: expectedHead }; } }; },
    },
    PocketStarlingObjectSealShadow: {
      ROOT_SCHEMA: "root-v1", SEAL_SCHEMA: "seal-v1", OBJECT_SCHEMA: "object-v1", SEQUENCE_SCHEMA: "sequence-v2",
      canonical(value) { return { ok: true, bytes: canonical(value) }; }, refFor,
    },
    PocketStarlingBridgeShadow: {
      encode(document) {
        return { ok: true, bridge: { structural: { relation: {
          nodeIds: document.nodes.map((node) => node.id),
          parents: Object.fromEntries(document.nodes.map((node) => [node.id, node.parentId || "root"])),
          children: { root: document.nodes.filter((node) => (node.parentId || "root") === "root").map((node) => node.id) },
        } } } };
      },
    },
    PocketStarlingPlacementShadow: { audit(structural) { return { ok: true, relation: structural.relation }; } },
    PocketStarlingLogicalEditShadow: {
      async compose() {
        return { ok: true, changed: true, candidate: candidateGraph({
          writtenAt: mismatch ? "2040-01-02T00:00:00.000Z" : "2040-01-01T00:00:00.000Z",
        }) };
      },
    },
    PocketStarlingRemoteEditShadow: {
      async createEditor() {
        return { async prepareWorkingSet() {
          const composed = await context.PocketStarlingLogicalEditShadow.compose();
          return { outcome: "prepared", expectedHead, stage: {}, binding: {}, candidate: composed.candidate };
        } };
      },
    },
    PocketStarlingDurablePublication: {
      validateDescriptor(value) {
        assert.deepEqual(Object.keys(value).sort(),
          ["candidateSealStorageRef", "expectedHead", "newRecords", "schema", "syncedPocketId"].sort());
        return Object.freeze({ ...value });
      },
      descriptorFromPrepared(prepared) {
        return Object.freeze({ schema: "pocket.starling.durable-candidate.v1", syncedPocketId: "pocket",
          expectedHead: prepared.expectedHead, candidateSealStorageRef: "storage:candidate", newRecords: [] });
      },
      createCoordinator() {
        return Object.freeze({
          async ensureObjects() { return { outcome: "objects-present" }; },
          async attemptHead() { counts.cas += 1; return { outcome: "committed" }; },
          async reconcile() { return { outcome: "NOT_COMMITTED" }; },
        });
      },
    },
  };

  const baseController = {
    captureSyncedOwnerSaveSession() { return { syncedPocketId: "pocket", generation: 1 }; },
    isSyncedOwnerSaveSessionCurrent() { return true; },
    getSyncedOwnerState() { return { syncedPocketId: "pocket", confirmedRemoteRevision: 4,
      knownRemoteRevision: 4, pending: false, generation: 1 }; },
    getStarlingBootstrapState() { return bootstrapState; },
    async bootstrapInitialStarlingBase(...args) {
      counts.bootstrap += 1;
      events.push("bootstrap");
      assert.equal(args.length, 0);
      if (options.bootstrapFails) return { ok: false, reason: "failed" };
      bootstrapState = { ready: true, sourceRevision: 4, head: expectedHead };
      return { ok: true, sourceRevision: 4, head: expectedHead };
    },
    async saveSyncedOwner(input) {
      events.push("save");
      await input.freezePayload();
      if (pendingDescriptor) {
        const coordinator = context.PocketStarlingDurablePublication.createCoordinator({});
        try { await coordinator.attemptHead(pendingDescriptor, 3); return { ok: true }; }
        catch (_error) { return { ok: false, reason: "admission-rejected" }; }
      }
      const editor = await context.PocketStarlingRemoteEditShadow.createEditor({
        opened: { outcome: "opened", head: expectedHead, session: {
          acceptedSealRef: "storage:head-one", semanticBaseProof: {},
          async resolveLogical() { return undefined; }, createReuseProof() {}, readContent() {}, readPlacement() {}, diagnostics() {},
        } }, masterKey: {}, context: { syncedPocketId: "pocket" }, semanticAuthority: {},
      });
      const prepared = await editor.prepareWorkingSet([], {});
      if (prepared?.outcome !== "prepared") return { ok: false, reason: prepared?.reason || "prepare-failed" };
      const descriptor = context.PocketStarlingDurablePublication.descriptorFromPrepared(prepared);
      if (options.holdBeforeCas) { pendingDescriptor = descriptor; return { ok: false, reason: "held" }; }
      const coordinator = context.PocketStarlingDurablePublication.createCoordinator({});
      try { await coordinator.attemptHead(descriptor, 3); return { ok: true }; }
      catch (_error) { return { ok: false, reason: "admission-rejected" }; }
    },
    async adoptSyncedOwner() { return { ok: true }; },
    releaseSyncedOwner() { return true; },
  };
  context.PocketSyncOwnerController = { createSyncedOwnerController() { return baseController; } };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(MODULE), context, { filename: MODULE });
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({});
  return {
    context, controller, counts, events, payload,
    setMode(value) { authorityMode = value; },
    setMismatch(value) { mismatch = value; },
    async save(customPayload = payload) {
      return controller.saveSyncedOwner({ async freezePayload() { counts.freeze += 1; return customPayload; } });
    },
  };
}

test("P172 foreground whole-record Save bootstraps P162 before the existing Save and freezes once", async () => {
  const h = harness();
  const result = await h.save();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(h.events, ["bootstrap", "save"]);
  assert.equal(h.counts.bootstrap, 1);
  assert.equal(h.counts.freeze, 1);
  assert.equal(h.counts.cas, 1);
});

test("P172 does not duplicate bootstrap for an existing base or an already-Starling owner", async () => {
  const existing = harness({ existingBase: true });
  assert.equal((await existing.save()).ok, true);
  assert.equal(existing.counts.bootstrap, 0);
  const starling = harness({ authorityMode: "starling" });
  assert.equal((await starling.save()).ok, true);
  assert.equal(starling.counts.bootstrap, 0);
});

test("P172 rejects a candidate mismatch before any authoritative Head CAS", async () => {
  const h = harness({ existingBase: true, mismatch: true });
  const result = await h.save();
  assert.equal(result.ok, false);
  assert.equal(h.counts.cas, 0);
});

test("P172 durable admission cannot be borrowed by a different frozen payload", async () => {
  const h = harness({ authorityMode: "starling", holdBeforeCas: true });
  const first = await h.save();
  assert.equal(first.ok, false);
  assert.equal(h.counts.cas, 0);
  const changed = { ...h.payload, norm: { ...h.payload.norm, writtenAt: "2040-01-03T00:00:00.000Z" } };
  const second = await h.save(changed);
  assert.equal(second.ok, false);
  assert.equal(h.counts.cas, 0);
});

test("P172 Starling undo guard preserves exact immediate Insert cancellation but blocks unsupported Add and bulk Delete undo", async () => {
  const h = harness({ authorityMode: "starling" });
  await h.controller.adoptSyncedOwner({});
  assert.equal(h.context.PocketStarlingRealTruthAdmission.isStarlingUndoGuardActive(), true);

  h.context.lastEditUndoSnapshot = { kind: "add", p153InsertUndoWitness: {
    nodeId: "new", operationSequence: 1, forwardSemanticCaptured: true,
  } };
  h.context.state.operationHighWater = 1;
  h.context.state.activeSaveOperationCeiling = 0;
  h.context.state.ops = [{ seq: 1, type: "add_below", id: "new" }];
  h.context.nodeMap = () => new Map([["new", { id: "new" }]]);
  h.context.freezePocketStarlingOwnerWorkingSetThrough = () => ({
    operations: [{ type: "insert", input: { nodeId: "new" } }],
  });
  assert.equal(h.context.undoLastEditAction(), true);
  assert.equal(h.counts.visibleEditUndo, 1);

  h.context.lastEditUndoSnapshot = { kind: "add", p153InsertUndoWitness: {
    nodeId: "new", operationSequence: 1, forwardSemanticCaptured: true,
  } };
  h.context.state.ops = [];
  assert.equal(h.context.undoLastEditAction(), false);
  assert.equal(h.counts.visibleEditUndo, 1);

  h.context.lastDeleteUndoSnapshot = { kind: "delete" };
  assert.equal(h.context.undoLastDeleteAction(), false);
  assert.equal(h.counts.visibleDeleteUndo, 0);
  h.context.lastDeleteUndoSnapshot = { kind: "delete", p155DeleteUndoWitness: { nodeId: "one", operationSequence: 2 } };
  assert.equal(h.context.undoLastDeleteAction(), true);
  assert.equal(h.counts.visibleDeleteUndo, 1);
});

test("P172 production composition serves the admission module after the owner successor with the service root", () => {
  const production = source("sync-service/pocket-sync-production-server.js");
  assert.match(production, /pocket-starling-owner-successor\.js/);
  assert.match(production, /pocket-starling-real-truth-admission\.js/);
  assert.ok(production.indexOf("pocket-starling-owner-successor.js")
    < production.indexOf("pocket-starling-real-truth-admission.js"));
  assert.match(production, /SERVICE_ROOT_MODULE_PATHS[\s\S]*pocket-starling-real-truth-admission\.js/);
});
