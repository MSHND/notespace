"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, ".."),
  MODULE = "js/pocket-starling-logical-edit-shadow.js",
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
    MODULE,
  ];

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function runtime() {
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
  for (const file of SCRIPTS)
    vm.runInContext(source(file), c, { filename: file });
  return c;
}

function nodes(includeLiteral = true) {
  const values = [
    { id: "current", parentId: "root", order: 0, label: "Current" },
    { id: "target", parentId: "root", order: 1, label: "Target" },
    { id: "current-child", parentId: "current", order: 0, label: "Current child" },
    { id: "retained-root", parentId: "root", order: 2, label: "Retained root" },
    { id: "retained-child", parentId: "retained-root", order: 0, label: "Retained child" },
    { id: "retained-deep", parentId: "retained-child", order: 0, label: "Retained deep" },
  ];
  if (includeLiteral)
    values.splice(1, 0, {
      id: "retained",
      parentId: "root",
      order: 1,
      label: "Literal current identity",
    });
  return values;
}

function relation(includeLiteral = true) {
  const nodeIds = nodes(includeLiteral).map((node) => node.id),
    rootChildren = includeLiteral
      ? ["current", "retained", "target"]
      : ["current", "target"],
    parents = {
      current: "root",
      target: "root",
      "current-child": "current",
      "retained-root": "",
      "retained-child": "retained-root",
      "retained-deep": "retained-child",
    };
  if (includeLiteral) parents.retained = "root";
  return {
    nodeIds,
    parents,
    children: {
      root: rootChildren,
      current: ["current-child"],
      "": ["retained-root"],
      "retained-root": ["retained-child"],
      "retained-child": ["retained-deep"],
    },
  };
}

function normalised(input) {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-08-31T00:00:00.000Z",
    nodes: input,
    tombstones: [{ id: "gone" }],
    rootExtras: { rootMarker: true },
    dataExtras: { dataMarker: true },
  };
}

function stateFor(c, includeLiteral = true) {
  const encoded = c.PocketStarlingBridgeShadow.encode(
      normalised(nodes(includeLiteral)),
      { capacity: 4 },
    ),
    base = encoded.ok && c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  assert.equal(base.ok, true, JSON.stringify(base));
  const structural = c.PocketStarlingPlacementShadow.build(
    relation(includeLiteral),
    { capacity: 4 },
  );
  assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = c.PocketStarlingRootShadow.diagnosticRootFor({
    capacity: base.state.capacity,
    content: base.state.content,
    placements: structural.model.placements,
    children: structural.model.children,
    preservation: base.state.preservation,
  });
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

function stage(c, state) {
  const stager = c.PocketStarlingObjectSealShadow.createStager(),
    result = c.PocketStarlingObjectSealShadow.stageCandidate(stager, state, {
      previousSealRef: null,
    });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { stager, stage: result.stage };
}

async function open(c, staged) {
  const result = await c.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: staged.stage.sealRef,
    resolveLogical: (ref) => staged.stager.store.get(ref),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function expectFailure(result, reason) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
  assert.equal("candidate" in result, false);
  assert.equal("newLogicalRefs" in result, false);
}

function auditCandidate(c, staged, candidate) {
  const result = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
    candidate.sealRef,
    (ref) => candidate.resolveLogical(ref) || staged.stager.store.get(ref),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.candidate;
}

function objectAt(entries, ref) {
  const bytes = entries.get(ref);
  assert.equal(typeof bytes, "string", ref);
  return JSON.parse(bytes);
}

function put(c, entries, kind, object) {
  const encoded = c.PocketStarlingObjectSealShadow.canonical(object);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const ref = c.PocketStarlingObjectSealShadow.refFor(kind, encoded.bytes);
  entries.set(ref, encoded.bytes);
  return ref;
}

function rewriteTrieValue(c, entries, ref, key, valueRef, offset = 0) {
  const object = objectAt(entries, ref);
  if (offset === key.length)
    return put(c, entries, object.kind, { ...object, hasValue: true, valueRef });
  const index = object.children.findIndex((edge) => edge.key === key[offset]);
  assert.notEqual(index, -1);
  const childRef = rewriteTrieValue(
      c,
      entries,
      object.children[index].ref,
      key,
      valueRef,
      offset + 1,
    ),
    children = object.children.map((edge, item) =>
      item === index ? { ...edge, ref: childRef } : edge,
    );
  return put(c, entries, object.kind, { ...object, children });
}

function placementRefAt(entries, placementTrieRef, nodeId) {
  let object = objectAt(entries, placementTrieRef);
  for (const character of nodeId) {
    const edge = object.children.find((item) => item.key === character);
    assert.ok(edge);
    object = objectAt(entries, edge.ref);
  }
  assert.equal(object.hasValue, true);
  return object.valueRef;
}

function forgePlacement(c, staged, nodeId, mutate) {
  const entries = new Map(staged.stager.store),
    root = staged.stage.rootObject,
    oldPlacementRef = placementRefAt(entries, root.placementRef, nodeId),
    oldPlacement = objectAt(entries, oldPlacementRef),
    replacementRef = put(c, entries, "placement-record", mutate(oldPlacement)),
    placementRef = rewriteTrieValue(
      c,
      entries,
      root.placementRef,
      nodeId,
      replacementRef,
    ),
    rootRef = put(c, entries, "pocket-root", { ...root, placementRef }),
    sealRef = put(c, entries, "candidate-seal", {
      ...staged.stage.sealObject,
      rootRef,
    });
  return { entries, sealRef };
}

test("P132a opens a genuine two-domain Seal while keeping retained truth readable but not ordinarily editable", async () => {
  const writer = runtime(), staged = stage(writer, stateFor(writer)),
    reader = runtime(), opened = await open(reader, staged),
    sealApi = reader.PocketStarlingObjectSealShadow,
    openedSeal = sealApi.openFromAcceptedSealRef(
      staged.stage.sealRef,
      (ref) => staged.stager.store.get(ref),
    );
  assert.equal(openedSeal.ok, true, JSON.stringify(openedSeal));
  assert.deepEqual(Object.keys(staged.stage.rootObject).sort(), [
    "capacity",
    "childrenRef",
    "contentRef",
    "kind",
    "placementRef",
    "preservationRef",
    "schema",
  ]);
  assert.equal("retainedRootsRef" in staged.stage.rootObject, false);
  const content = sealApi.readContent(openedSeal.handle, "retained-deep"),
    placement = sealApi.readPlacement(openedSeal.handle, "retained-root");
  assert.equal(content.ok, true, JSON.stringify(content));
  assert.equal(placement.ok, true, JSON.stringify(placement));
  assert.equal(content.nodeId, "retained-deep");
  assert.equal(placement.parentId, "");
  assert.equal(opened.diagnostics.logicalFetches, 2);
});

test("P132a rejects retained payload edits without a candidate", async () => {
  const c = runtime(), staged = stage(c, stateFor(c)), opened = await open(c, staged),
    api = c.PocketStarlingLogicalEditShadow,
    handle = c.PocketStarlingObjectSealShadow.openFromAcceptedSealRef(
      staged.stage.sealRef,
      (ref) => staged.stager.store.get(ref),
    ).handle,
    retainedPayload = c.PocketStarlingObjectSealShadow.readContent(
      handle,
      "retained-root",
    ).payload;
  expectFailure(
    await api.editPayload(opened.base, "retained-root", retainedPayload),
    "retained-node-not-current",
  );
  expectFailure(
    await api.editPayload(opened.base, "retained-root", { label: "blocked" }),
    "retained-node-not-current",
  );
  expectFailure(
    await api.editPayload(opened.base, "retained-deep", { label: "blocked" }),
    "retained-node-not-current",
  );
  const edited = await api.editPayload(opened.base, "current", { label: "changed" });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.equal(edited.changed, true);
  const candidate = auditCandidate(c, staged, edited.candidate);
  assert.deepEqual(c.PocketStarlingRootShadow.getContent(candidate, "current").payload, { label: "changed" });
});

test("P132a rejects retained Insert destinations and preserves literal retained identity", async () => {
  const c = runtime(), staged = stage(c, stateFor(c)), opened = await open(c, staged),
    api = c.PocketStarlingLogicalEditShadow,
    input = { nodeId: "fresh", parentId: "current", toIndex: 0, payload: { label: "Fresh" } };
  expectFailure(await api.insert(opened.base, { ...input, parentId: "" }), "retained-parent-not-current");
  expectFailure(await api.insert(opened.base, { ...input, parentId: "retained-root" }), "retained-parent-not-current");
  expectFailure(await api.insert(opened.base, { ...input, parentId: "retained-deep" }), "retained-parent-not-current");
  const beneathLiteral = await api.insert(opened.base, {
    ...input,
    nodeId: "fresh-under-literal",
    parentId: "retained",
  });
  assert.equal(beneathLiteral.ok, true, JSON.stringify(beneathLiteral));
  const noLiteral = stage(c, stateFor(c, false)), noLiteralOpened = await open(c, noLiteral),
    literalInserted = await api.insert(noLiteralOpened.base, {
      ...input,
      nodeId: "retained",
      parentId: "current",
    });
  assert.equal(literalInserted.ok, true, JSON.stringify(literalInserted));
  const candidate = auditCandidate(c, noLiteral, literalInserted.candidate);
  assert.equal(c.PocketStarlingObjectSealShadow.readPlacement(
    c.PocketStarlingObjectSealShadow.openFromAcceptedSealRef(
      literalInserted.candidate.sealRef,
      (ref) => literalInserted.candidate.resolveLogical(ref) || noLiteral.stager.store.get(ref),
    ).handle,
    "retained",
  ).parentId, "current");
  assert.equal(c.PocketStarlingRootShadow.getContent(candidate, "retained").nodeId, "retained");
});

test("P132a prevents Move from becoming hidden Delete or Restore", async () => {
  const c = runtime(), staged = stage(c, stateFor(c)), opened = await open(c, staged),
    api = c.PocketStarlingLogicalEditShadow;
  expectFailure(await api.move(opened.base, "retained-root", 0, "target", 0), "retained-node-not-current");
  expectFailure(await api.move(opened.base, "retained-deep", 0, "target", 0), "retained-node-not-current");
  expectFailure(await api.move(opened.base, "current-child", 0, "", 0), "retained-parent-not-current");
  expectFailure(await api.move(opened.base, "current-child", 0, "retained-root", 0), "retained-parent-not-current");
  const moved = await api.move(opened.base, "current-child", 0, "target", 0);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  const candidate = auditCandidate(c, staged, moved.candidate),
    relation = c.PocketStarlingPlacementShadow.audit(candidate.structural);
  assert.equal(relation.ok, true, JSON.stringify(relation));
  assert.equal(relation.relation.parents["current-child"], "target");
});

test("P132a rejects retained Reorder before no-change or structural work", async () => {
  const c = runtime(), staged = stage(c, stateFor(c)), opened = await open(c, staged),
    api = c.PocketStarlingLogicalEditShadow;
  expectFailure(await api.reorder(opened.base, "retained-root", 0, 0), "retained-node-not-current");
  expectFailure(await api.reorder(opened.base, "retained-deep", 0, 0), "retained-node-not-current");
  const noChange = await api.reorder(opened.base, "current-child", 0, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(noChange)), { ok: true, changed: false, reason: "no-change" });
});

test("P132a fails closed on broken domain chains without classifying corruption as retention", async () => {
  const c = runtime(), staged = stage(c, stateFor(c)),
    missing = new Map(staged.stager.store),
    root = staged.stage.rootObject,
    deepRef = placementRefAt(missing, root.placementRef, "retained-deep");
  missing.delete(deepRef);
  const missingBase = await c.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: staged.stage.sealRef,
    resolveLogical: (ref) => missing.get(ref),
  });
  assert.equal(missingBase.ok, true, JSON.stringify(missingBase));
  const missingResult = await c.PocketStarlingLogicalEditShadow.editPayload(
    missingBase.base,
    "retained-deep",
    { label: "blocked" },
  );
  assert.notEqual(missingResult.reason, "retained-node-not-current");
  assert.notEqual(missingResult.reason, "retained-parent-not-current");
  assert.equal(missingResult.ok, false);

  const malformed = forgePlacement(c, staged, "retained-deep", (record) => ({
      ...record,
      nodeId: "wrong-node-id",
    })),
    malformedBase = await c.PocketStarlingLogicalEditShadow.createBase({
      acceptedSealRef: malformed.sealRef,
      resolveLogical: (ref) => malformed.entries.get(ref),
    });
  assert.equal(malformedBase.ok, true, JSON.stringify(malformedBase));
  expectFailure(
    await c.PocketStarlingLogicalEditShadow.editPayload(
      malformedBase.base,
      "retained-deep",
      { label: "blocked" },
    ),
    "invalid-placement-record",
  );

  const firstCycle = forgePlacement(c, staged, "retained-root", (record) => ({
      ...record,
      parentId: "retained-child",
    })),
    secondCycle = forgePlacement(c, {
      stager: { store: firstCycle.entries },
      stage: {
        rootObject: { ...staged.stage.rootObject, placementRef: objectAt(firstCycle.entries, objectAt(firstCycle.entries, firstCycle.sealRef).rootRef).placementRef },
        sealObject: objectAt(firstCycle.entries, firstCycle.sealRef),
      },
    }, "retained-child", (record) => ({ ...record, parentId: "retained-root" })),
    cycleBase = await c.PocketStarlingLogicalEditShadow.createBase({
      acceptedSealRef: secondCycle.sealRef,
      resolveLogical: (ref) => secondCycle.entries.get(ref),
    });
  assert.equal(cycleBase.ok, true, JSON.stringify(cycleBase));
  expectFailure(
    await c.PocketStarlingLogicalEditShadow.editPayload(
      cycleBase.base,
      "retained-root",
      { label: "blocked" },
    ),
    "invalid-parent-chain",
  );
});

test("P132a remains genuinely dormant in production", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" });
  assert.equal(source("index.html").includes(MODULE), false);
  assert.equal(manifest.some((entry) => entry.path === "/js/pocket-starling-logical-edit-shadow.js"), false);
  for (const entry of manifest.filter((value) => value.path.endsWith(".js")))
    assert.equal(source(`.${entry.path}`).includes("PocketStarlingLogicalEditShadow"), false, entry.path);
});
