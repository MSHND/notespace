"use strict";
// P356: deterministic OFFLINE contract witness. No product-code modifications.
const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  { createBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), plain = (v) => JSON.parse(JSON.stringify(v)),
  SCRIPTS = [
    "js/pocket-state.js", "js/pocket-data.js",
    "js/pocket-outline-persistence-policy.js", "js/pocket-node-content.js", "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js",
    "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js",
    "js/pocket-sync-crypto.js", "js/pocket-starling-logical-edit-shadow.js",
    "js/pocket-starling-semantic-authority-shadow.js",
  ];
function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String,
    Number, Boolean, Promise, Error,
    btoa(v) { return Buffer.from(v, "binary").toString("base64"); },
    atob(v) { return Buffer.from(v, "base64").toString("binary"); },
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" },
    indexedDB: null, open() {}, close() {}, setTimeout() { return 1; },
    clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS)
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}
function graph(extra = 0) {
  const nodes = [
    { id: "source", parentId: "root", order: 0, label: "Source" },
    { id: "destination", parentId: "root", order: 1, label: "Destination" },
    { id: "unrelated", parentId: "root", order: 2, label: "Unrelated" },
    { id: "first", parentId: "source", order: 0, label: "First" },
    { id: "branch", parentId: "source", order: 1, label: "Branch",
      details: "Keep body", pe: { schema: "pocket.pe.v1", title: "Branch",
        mode: "text", text: "Live PE text", outline: [],
        updatedAt: "2026-09-01T00:00:00.000Z" } },
    { id: "last", parentId: "source", order: 2, label: "Last" },
    { id: "child", parentId: "branch", order: 0, label: "Child" },
    { id: "grandchild", parentId: "child", order: 0, label: "Grandchild" },
    { id: "destination-child", parentId: "destination", order: 0, label: "Destination child" },
    { id: "unrelated-child", parentId: "unrelated", order: 0, label: "Unrelated child" },
    ...Array.from({ length: extra }, (_, i) => ({
      id: "filler-" + String(i).padStart(4, "0"),
      parentId: "root", order: i + 10, label: "Unrelated " + i,
    })),
  ];
  return { nodes, relation: {
    nodeIds: nodes.map((n) => n.id),
    parents: Object.fromEntries(nodes.map((n) => [n.id, n.parentId])),
    children: {
      root: ["source", "destination", "unrelated",
        ...nodes.filter((n) => n.id.startsWith("filler-")).map((n) => n.id)],
      source: ["first", "branch", "last"], branch: ["child"],
      child: ["grandchild"], destination: ["destination-child"],
      unrelated: ["unrelated-child"],
    },
  } };
}
function stage(c, graphInput) {
  const encoded = c.PocketStarlingBridgeShadow.encode({
    schema: "portal.mtt.web.v1", writtenAt: "2026-09-01T00:00:00.000Z",
    nodes: graphInput.nodes, tombstones: [],
    rootExtras: { keep: true }, dataExtras: { keep: true },
  }, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const built = c.PocketStarlingRootShadow.build(encoded.bridge),
    placement = c.PocketStarlingPlacementShadow.build(graphInput.relation, { capacity: 4 });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(placement.ok, true, JSON.stringify(placement));
  const witness = c.PocketStarlingRootShadow.diagnosticRootFor({
    capacity: built.state.capacity, content: built.state.content,
    placements: placement.model.placements, children: placement.model.children,
    preservation: built.state.preservation,
  });
  assert.equal(witness.ok, true, JSON.stringify(witness));
  const stager = c.PocketStarlingObjectSealShadow.createStager(),
    result = c.PocketStarlingObjectSealShadow.stageCandidate(stager, {
      schema: c.PocketStarlingRootShadow.SCHEMA, capacity: built.state.capacity,
      content: built.state.content, structural: placement.model,
      preservation: built.state.preservation, root: witness.root,
    }, { previousSealRef: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { stager, accepted: result.stage };
}
async function open(c, staged) {
  const result = await createBase(c, {
    acceptedSealRef: staged.accepted.sealRef,
    resolveLogical: (ref) => staged.stager.store.get(ref),
    syncedPocketId: "p356-offline",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.base;
}
function resolve(staged, candidate) {
  return (ref) => candidate.resolveLogical(ref) || staged.stager.store.get(ref);
}
function trieValue(read, rootRef, key) {
  let node = JSON.parse(read(rootRef));
  for (const letter of key) {
    const edge = node.children.find((entry) => entry.key === letter);
    assert.ok(edge, "missing trie edge: " + key);
    node = JSON.parse(read(edge.ref));
  }
  assert.equal(node.hasValue, true, key);
  return node.valueRef;
}
function inspect(c, staged, candidate) {
  const audited = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
    candidate.sealRef, resolve(staged, candidate));
  assert.equal(audited.ok, true, JSON.stringify(audited));
  const materialised = c.PocketStarlingPlacementShadow.materialise(audited.candidate.structural);
  assert.equal(materialised.ok, true, JSON.stringify(materialised));
  return { tree: audited.candidate, relation: plain(materialised.relation),
    root: JSON.parse(resolve(staged, candidate)(candidate.rootRef)) };
}
function failure(result, reason) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (reason) assert.equal(result.reason, reason);
  assert.equal("candidate" in result, false);
  assert.equal("sealRef" in result, false);
}
test("P356 Move: stable identity, content, descendants, unrelated refs, bounded locality", async () => {
  const measurements = [];
  for (const extra of [0, 256]) {
    const c = runtime(), staged = stage(c, graph(extra)), api = c.PocketStarlingLogicalEditShadow,
      original = new Map(staged.stager.store), originalRoot = staged.accepted.rootObject,
      baseRead = (ref) => staged.stager.store.get(ref);
    const untouched = ["child", "grandchild", "unrelated", "unrelated-child"].map((id) => ({
      id, content: trieValue(baseRead, originalRoot.contentRef, id),
      placement: trieValue(baseRead, originalRoot.placementRef, id),
    }));
    const auditedOriginal = c.PocketStarlingObjectSealShadow.auditCandidateSeal(staged.accepted.sealRef, baseRead);
    assert.equal(auditedOriginal.ok, true);
    const originalBranch = plain(c.PocketStarlingRootShadow.getContent(auditedOriginal.candidate, "branch"));
    const result = await api.move(await open(c, staged), "branch", 1, "destination", 1);
    assert.equal(result.ok, true, JSON.stringify(result));
    const moved = inspect(c, staged, result.candidate);
    assert.notEqual(result.candidate.sealRef, staged.accepted.sealRef);
    assert.equal(JSON.parse(resolve(staged, result.candidate)(result.candidate.sealRef)).previousSealRef,
      staged.accepted.sealRef);
    assert.equal(moved.root.contentRef, originalRoot.contentRef);
    assert.equal(moved.root.preservationRef, originalRoot.preservationRef);
    assert.deepEqual(moved.relation.children.source, ["first", "last"]);
    assert.deepEqual(moved.relation.children.destination, ["destination-child", "branch"]);
    assert.deepEqual(moved.relation.children.branch, ["child"]);
    assert.deepEqual(moved.relation.children.child, ["grandchild"]);
    assert.equal(moved.relation.parents.branch, "destination");
    assert.equal(moved.relation.parents.child, "branch");
    assert.equal(moved.relation.parents.grandchild, "child");
    assert.deepEqual(plain(c.PocketStarlingRootShadow.getContent(moved.tree, "branch")), originalBranch);
    for (const u of untouched) {
      assert.equal(trieValue(resolve(staged, result.candidate), moved.root.contentRef, u.id), u.content);
      assert.equal(trieValue(resolve(staged, result.candidate), moved.root.placementRef, u.id), u.placement);
      assert.equal(result.candidate.newLogicalRefs.includes(u.content), false);
      assert.equal(result.candidate.newLogicalRefs.includes(u.placement), false);
    }
    assert.equal(result.candidate.diagnostics.descendantReads, 0);
    assert.deepEqual(staged.stager.store, original, "candidate must not mutate the accepted store");
    await open(c, staged); // Unchanged accepted seal remains independently reopenable.
    measurements.push({ extra, fetches: result.candidate.diagnostics.logicalFetches,
      frontier: result.candidate.newLogicalRefs.length });
  }
  assert.ok(measurements[1].fetches <= measurements[0].fetches + 12, JSON.stringify(measurements));
  assert.ok(measurements[1].frontier <= measurements[0].frontier + 12, JSON.stringify(measurements));
});
test("P356 same-parent Reorder uses pre-removal toIndex, including no-change", async () => {
  const c = runtime(), staged = stage(c, graph()), api = c.PocketStarlingLogicalEditShadow,
    base = await open(c, staged);
  for (const [toIndex, expected] of [
    [0, ["branch", "first", "last"]], [3, ["first", "last", "branch"]],
  ]) {
    const result = await api.reorder(base, "branch", 1, toIndex);
    assert.equal(result.ok, true, JSON.stringify(result));
    const moved = inspect(c, staged, result.candidate);
    assert.deepEqual(moved.relation.children.source, expected);
    assert.equal(moved.root.contentRef, staged.accepted.rootObject.contentRef);
    assert.equal(moved.root.placementRef, staged.accepted.rootObject.placementRef);
    assert.equal(result.candidate.diagnostics.descendantReads, 0);
  }
  for (const toIndex of [1, 2]) {
    const noChange = await api.reorder(base, "branch", 1, toIndex);
    assert.deepEqual(plain(noChange), { ok: true, changed: false, reason: "no-change" });
    assert.equal("candidate" in noChange, false);
  }
  failure(await api.move(base, "branch", 1, "source", 0), "same-parent-reorder-not-in-scope");
});
test("P356 invalid Move is fail-closed, without candidate or accepted mutation", async () => {
  const c = runtime(), staged = stage(c, graph()), api = c.PocketStarlingLogicalEditShadow,
    base = await open(c, staged), original = new Map(staged.stager.store);
  failure(await api.move(base, "branch", 1, "child", 0), "move-would-cycle");
  failure(await api.move(base, "branch", 1, "grandchild", 0), "move-would-cycle");
  failure(await api.move(base, "branch", 1, "branch", 0), "move-would-cycle");
  failure(await api.move(base, "branch", 1, "missing-parent", 0), "unknown-parent");
  failure(await api.move(base, "missing", 0, "destination", 0), "unknown-node");
  failure(await api.move(base, "branch", 0, "destination", 0));
  failure(await api.move({ ...base }, "branch", 1, "destination", 0), "invalid-base-token");
  assert.deepEqual(staged.stager.store, original);
});
test("P356 content and placement are distinct; working-set composition does not accept/save", async () => {
  const c = runtime(), staged = stage(c, graph()), api = c.PocketStarlingLogicalEditShadow,
    base = await open(c, staged), original = staged.accepted.rootObject,
    edited = await api.editPayload(base, "branch", {
      label: "Edited", details: "new body",
      pe: { schema: "pocket.pe.v1", title: "Edited", mode: "text",
        text: "different text", outline: [], updatedAt: "2026-09-01T00:00:00.000Z" },
    });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  const editedRoot = JSON.parse(resolve(staged, edited.candidate)(edited.candidate.rootRef));
  assert.notEqual(editedRoot.contentRef, original.contentRef);
  assert.equal(editedRoot.placementRef, original.placementRef);
  assert.equal(editedRoot.childrenRef, original.childrenRef);
  const movement = { type: "move", input: {
    nodeId: "branch", fromIndex: 1, newParentId: "destination", toIndex: 1,
  } }, reorder = { type: "reorder", input: { nodeId: "branch", fromIndex: 1, toIndex: 0 } };
  const composed = await api.compose(base, [movement, reorder]);
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const result = inspect(c, staged, composed.candidate);
  assert.deepEqual(result.relation.children.source, ["first", "last"]);
  assert.deepEqual(result.relation.children.destination, ["branch", "destination-child"]);
  assert.equal(result.root.contentRef, original.contentRef);
  assert.equal(JSON.parse(resolve(staged, composed.candidate)(composed.candidate.sealRef)).previousSealRef,
    staged.accepted.sealRef);
  const bad = await api.compose(base, [movement, { type: "move", input: {
    nodeId: "destination", fromIndex: 1, newParentId: "child", toIndex: 0,
  } }]);
  failure(bad, "move-would-cycle");
  assert.equal(bad.operationIndex, 1);
  const originalAgain = await api.reorder(await open(c, staged), "branch", 1, 2);
  assert.equal(originalAgain.changed, false, "candidate is not saved truth");
  assert.equal(staged.accepted.rootObject.contentRef, original.contentRef);
});
