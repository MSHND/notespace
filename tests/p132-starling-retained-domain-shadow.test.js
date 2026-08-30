"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, ".."),
  SCRIPTS = [
    "js/pocket-state.js",
    "js/pocket-data.js",
    "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js",
    "js/pocket-import.js",
    "js/pocket-starling-shadow.js",
    "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js",
    "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js",
    "js/pocket-starling-object-seal-shadow.js",
  ];

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function context(logical = false) {
  const c = {
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
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} },
    location: { href: "https://example.test" },
    indexedDB: null,
    open() {},
    close() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(source(file), c, { filename: file });
  if (logical)
    vm.runInContext(source("js/pocket-starling-logical-edit-shadow.js"), c, {
      filename: "js/pocket-starling-logical-edit-shadow.js",
    });
  return c;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalRelation(relation) {
  return {
    nodeIds: [...relation.nodeIds].sort(),
    parents: plain(relation.parents),
    children: plain(relation.children),
  };
}

function normalised(nodes) {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-08-31T00:00:00.000Z",
    nodes,
    tombstones: [{ id: "gone" }],
    rootExtras: { rootMarker: true },
    dataExtras: { dataMarker: true },
  };
}

function seedNodes() {
  return [
    { id: "current", parentId: "root", order: 0, label: "Current" },
    { id: "retained", parentId: "root", order: 1, label: "Literal retained" },
    { id: "target", parentId: "root", order: 2, label: "Target" },
    { id: "current-child", parentId: "current", order: 0, label: "Current child" },
    { id: "retained-root", parentId: "root", order: 3, label: "Retained root" },
    { id: "retained-child", parentId: "retained-root", order: 0, label: "Retained child" },
  ];
}

function currentRelation() {
  return {
    nodeIds: ["current", "retained", "target", "current-child", "retained-root", "retained-child"],
    parents: {
      current: "root",
      retained: "root",
      target: "root",
      "current-child": "current",
      "retained-root": "root",
      "retained-child": "retained-root",
    },
    children: {
      root: ["current", "retained", "target", "retained-root"],
      current: ["current-child"],
      "retained-root": ["retained-child"],
    },
  };
}

function retainedRelation() {
  const relation = currentRelation();
  relation.parents["retained-root"] = "";
  relation.children.root = ["current", "retained", "target"];
  relation.children[""] = ["retained-root"];
  return relation;
}

function stateFor(c, relation = currentRelation(), nodes = seedNodes()) {
  const encoded = c.PocketStarlingBridgeShadow.encode(normalised(nodes), { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const base = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(base.ok, true, JSON.stringify(base));
  const structural = c.PocketStarlingPlacementShadow.build(relation, { capacity: 4 });
  assert.equal(structural.ok, true, JSON.stringify(structural));
  const components = {
      capacity: base.state.capacity,
      content: base.state.content,
      placements: structural.model.placements,
      children: structural.model.children,
      preservation: base.state.preservation,
    },
    witness = c.PocketStarlingRootShadow.diagnosticRootFor(components);
  assert.equal(witness.ok, true, JSON.stringify(witness));
  const state = Object.freeze({
    schema: c.PocketStarlingRootShadow.SCHEMA,
    capacity: base.state.capacity,
    content: base.state.content,
    structural: structural.model,
    preservation: base.state.preservation,
    root: witness.root,
  });
  assert.equal(c.PocketStarlingRootShadow.auditCandidate(state).ok, true);
  return state;
}

function audit(api, model) {
  const result = api.audit(model);
  assert.equal(result.ok, true, JSON.stringify(result));
  return plain(result.relation);
}

function expectFailure(result, reason) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
}

test("P132 represents current and retained roots in one collision-free Placement relation", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow,
    relation = retainedRelation(), built = api.build(relation, { capacity: 4 });
  assert.equal(api.ROOT, "root");
  assert.equal(api.RETAINED_PARENT, "");
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.deepEqual(audit(api, built.model), canonicalRelation(relation));
  assert.equal(api.getPlacement(built.model, "retained-root").parentId, api.RETAINED_PARENT);
  assert.deepEqual(plain(c.PocketStarlingSequenceShadow.materialise(api.getChildrenRoot(built.model, api.RETAINED_PARENT))), ["retained-root"]);
  assert.equal(api.getPlacement(built.model, "retained-child").parentId, "retained-root");
  assert.equal(api.build({ nodeIds: ["root"], parents: { root: "root" }, children: { root: ["root"] } }).ok, false);
  assert.equal(api.build({ nodeIds: [""], parents: { "": "root" }, children: { root: [""] } }).ok, false);
  assert.equal(api.build({ nodeIds: ["retained"], parents: { retained: "root" }, children: { root: ["retained"] } }).ok, true);
});

test("P132 rejects contradictory corrupt and ambiguous retained membership", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow,
    missingRetainedMembership = retainedRelation(),
    wrongRetainedMembership = retainedRelation(),
    duplicateMembership = retainedRelation(),
    unknownParent = retainedRelation(),
    retainedCycle = retainedRelation(),
    brokenDescendant = retainedRelation();
  delete missingRetainedMembership.children[""];
  wrongRetainedMembership.parents["retained-root"] = "root";
  duplicateMembership.children.root.push("retained-root");
  unknownParent.parents["retained-root"] = "missing";
  unknownParent.children[""] = [];
  retainedCycle.parents["retained-root"] = "retained-child";
  retainedCycle.parents["retained-child"] = "retained-root";
  retainedCycle.children[""] = [];
  retainedCycle.children["retained-root"] = ["retained-child"];
  retainedCycle.children["retained-child"] = ["retained-root"];
  brokenDescendant.parents["retained-child"] = "missing";
  brokenDescendant.children["retained-root"] = [];

  expectFailure(api.build(missingRetainedMembership), "placement-membership-mismatch");
  expectFailure(api.build(wrongRetainedMembership), "placement-membership-mismatch");
  expectFailure(api.build(duplicateMembership), "duplicate-ordered-membership");
  expectFailure(api.build(unknownParent), "unknown-parent");
  expectFailure(api.build(retainedCycle), "parent-cycle");
  expectFailure(api.build(brokenDescendant), "unknown-parent");
  expectFailure(api.build({ nodeIds: ["a"], parents: { a: "" }, children: { "": "not-an-array" } }), "invalid-child-sequence");
});

test("P132 keeps an empty retained domain byte-compatible with accepted all-current grammar", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow,
    relation = currentRelation(), before = api.build(relation, { capacity: 4 });
  assert.equal(before.ok, true, JSON.stringify(before));
  assert.equal(before.model.children.hasValue, false);
  assert.equal(api.getChildrenRoot(before.model, api.RETAINED_PARENT), null);
  assert.deepEqual(audit(api, before.model), canonicalRelation(relation));
  const after = api.build(relation, { capacity: 4 });
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.deepEqual(plain(after.model), plain(before.model));
  assert.equal(api.getPlacement(after.model, "retained").parentId, "root");
});

test("P132 composes retained Placement through existing Root and Seal grammar without a new root field", () => {
  const c = context(), state = stateFor(c, retainedRelation()),
    sealApi = c.PocketStarlingObjectSealShadow,
    stager = sealApi.createStager(),
    staged = sealApi.stageCandidate(stager, state, { previousSealRef: null });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const rootKeys = Object.keys(staged.stage.rootObject).sort();
  assert.deepEqual(rootKeys, ["capacity", "childrenRef", "contentRef", "kind", "placementRef", "preservationRef", "schema"]);
  assert.equal("retainedRootsRef" in staged.stage.rootObject, false);
  assert.equal([...stager.store.values()].some((bytes) => bytes.includes("retainedRootsRef")), false);
  const fresh = sealApi.auditCandidateSeal(staged.stage.sealRef, (ref) => stager.store.get(ref));
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.equal(c.PocketStarlingPlacementShadow.audit(fresh.candidate.structural).ok, true);
  const missing = new Map(stager.store);
  missing.delete(staged.stage.rootObject.childrenRef);
  assert.equal(sealApi.auditCandidateSeal(staged.stage.sealRef, (ref) => missing.get(ref)).ok, false);
  const contradictory = retainedRelation();
  contradictory.children[""] = [];
  assert.equal(c.PocketStarlingPlacementShadow.build(contradictory).ok, false);
});

test("P132 fences existing mutation APIs to the current domain", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow,
    state = stateFor(c, retainedRelation()), base = state.structural,
    unchanged = audit(api, base);
  assert.equal(api.insert(base, "fresh", "current", 0).ok, true);
  assert.equal(api.reorder(base, "current", 0, 3).ok, true);
  assert.equal(api.move(base, "current-child", 0, "target", 0).ok, true);
  expectFailure(api.insert(base, "blocked-insert", "retained-root", 0), "retained-parent-not-current");
  expectFailure(api.move(base, "current-child", 0, "retained-root", 0), "retained-parent-not-current");
  expectFailure(api.move(base, "current-child", 0, api.RETAINED_PARENT, 0), "retained-parent-not-current");
  expectFailure(api.move(base, "retained-root", 0, "target", 0), "retained-node-not-current");
  expectFailure(api.reorder(base, "retained-child", 0, 0), "retained-node-not-current");
  assert.deepEqual(audit(api, base), unchanged);
});

test("P132 retains P130 Insert compatibility including literal retained identity", async () => {
  const writer = context(true),
    sealApi = writer.PocketStarlingObjectSealShadow,
    literalBase = stateFor(writer, {
    nodeIds: ["target"],
    parents: { target: "root" },
    children: { root: ["target"] },
  }, [{ id: "target", parentId: "root", order: 0, label: "Target" }]);
  const literalStager = sealApi.createStager(), literalStage = sealApi.stageCandidate(literalStager, literalBase, { previousSealRef: null });
  assert.equal(literalStage.ok, true, JSON.stringify(literalStage));
  const literalReader = context(true), literalOpened = await literalReader.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: literalStage.stage.sealRef,
    resolveLogical: (ref) => literalStager.store.get(ref),
  });
  assert.equal(literalOpened.ok, true, JSON.stringify(literalOpened));
  const literalInserted = await literalReader.PocketStarlingLogicalEditShadow.insert(literalOpened.base, {
    nodeId: "retained",
    parentId: "target",
    toIndex: 0,
    payload: { label: "P132 literal retained identity" },
  });
  assert.equal(literalInserted.ok, true, JSON.stringify(literalInserted));
  const audited = literalReader.PocketStarlingObjectSealShadow.auditCandidateSeal(
    literalInserted.candidate.sealRef,
    (ref) => literalInserted.candidate.resolveLogical(ref) || literalStager.store.get(ref),
  );
  assert.equal(audited.ok, true, JSON.stringify(audited));
  assert.equal(literalReader.PocketStarlingPlacementShadow.getPlacement(audited.candidate.structural, "retained").parentId, "target");
});

test("P132 remains genuinely dormant in production", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" });
  assert.equal(source("index.html").includes("pocket-starling-placement-shadow.js"), false);
  assert.equal(manifest.some((entry) => entry.path === "/js/pocket-starling-placement-shadow.js"), false);
  for (const entry of manifest.filter((value) => value.path.endsWith(".js")))
    assert.equal(source(`.${entry.path}`).includes("PocketStarlingPlacementShadow"), false, entry.path);
});
