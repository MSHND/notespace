"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  { semanticBase } = require("./helpers/starling-semantic-test.js"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, ".."),
  MODULE = "js/pocket-starling-logical-edit-shadow.js",
  SCRIPTS = [
    "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js",
    "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js",
    "js/pocket-sync-crypto.js", MODULE, "js/pocket-starling-semantic-authority-shadow.js",
  ];

const plain = (value) => JSON.parse(JSON.stringify(value));
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function runtime() {
  const c = {
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON,
    Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} },
    navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null,
    open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(source(file), c, { filename: file });
  return c;
}

function normalised(nodes) {
  return {
    schema: "portal.mtt.web.v1", writtenAt: "2026-09-01T00:00:00.000Z", nodes,
    tombstones: [{ id: "gone" }], rootExtras: { rootMarker: true }, dataExtras: { dataMarker: true },
  };
}

function graph(descendants = 2, includeRetained = true) {
  const nodes = [
      { id: "parent", parentId: "root", order: 0, label: "Parent" },
      { id: "branch", parentId: "root", order: 1, label: "Branch" },
      { id: "sibling", parentId: "root", order: 2, label: "Sibling" },
      { id: "retained", parentId: "root", order: 3, label: "Literal current identity" },
      ...Array.from({ length: descendants }, (_, index) => ({
        id: `desc-${String(index).padStart(4, "0")}`,
        parentId: index === 0 ? "branch" : `desc-${String(index - 1).padStart(4, "0")}`,
        order: 0, label: `Descendant ${index}`,
      })),
    ],
    nodeIds = nodes.map((node) => node.id),
    parents = Object.fromEntries(nodes.map((node) => [node.id, node.parentId])),
    children = { root: ["parent", "branch", "sibling", "retained"] };
  if (descendants) {
    children.branch = ["desc-0000"];
    for (let index = 0; index < descendants - 1; index += 1)
      children[`desc-${String(index).padStart(4, "0")}`] = [`desc-${String(index + 1).padStart(4, "0")}`];
  }
  if (includeRetained) {
    nodes.push({ id: "retained-old", parentId: "root", order: 4, label: "Earlier retained root" });
    nodes.push({ id: "retained-old-child", parentId: "retained-old", order: 0, label: "Earlier retained child" });
    nodeIds.push("retained-old");
    nodeIds.push("retained-old-child");
    parents["retained-old"] = "";
    parents["retained-old-child"] = "retained-old";
    children[""] = ["retained-old"];
    children["retained-old"] = ["retained-old-child"];
  }
  return { nodes, relation: { nodeIds, parents, children } };
}

function stateFor(c, input) {
  const encoded = c.PocketStarlingBridgeShadow.encode(normalised(input.nodes), { capacity: 4 }),
    base = encoded.ok && c.PocketStarlingRootShadow.build(encoded.bridge),
    structural = c.PocketStarlingPlacementShadow.build(input.relation, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  assert.equal(base.ok, true, JSON.stringify(base));
  assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = c.PocketStarlingRootShadow.diagnosticRootFor({
    capacity: base.state.capacity, content: base.state.content, placements: structural.model.placements,
    children: structural.model.children, preservation: base.state.preservation,
  });
  assert.equal(witness.ok, true, JSON.stringify(witness));
  const state = Object.freeze({ schema: c.PocketStarlingRootShadow.SCHEMA, capacity: base.state.capacity,
    content: base.state.content, structural: structural.model, preservation: base.state.preservation, root: witness.root });
  assert.equal(c.PocketStarlingRootShadow.auditCandidate(state).ok, true);
  return state;
}

function stage(c, state) {
  const stager = c.PocketStarlingObjectSealShadow.createStager(),
    result = c.PocketStarlingObjectSealShadow.stageCandidate(stager, state, { previousSealRef: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { stager, stage: result.stage };
}

async function open(c, staged, syncedPocketId = "p133", resolveLogical = null) {
  const resolver = resolveLogical || ((ref) => staged.stager.store.get(ref)),
    semantic = await semanticBase(c, { acceptedSealRef: staged.stage.sealRef, resolveLogical: resolver, syncedPocketId }),
    result = await c.PocketStarlingLogicalEditShadow.createBase({
      acceptedSealRef: staged.stage.sealRef, resolveLogical: resolver, ...semantic,
    });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { ...result, ...semantic, syncedPocketId };
}

function resolve(staged, candidate) {
  return (ref) => candidate.resolveLogical(ref) || staged.stager.store.get(ref);
}

function audit(c, staged, candidate) {
  const result = c.PocketStarlingObjectSealShadow.auditCandidateSeal(candidate.sealRef, resolve(staged, candidate));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.candidate;
}

function objectAt(resolveLogical, ref) {
  const bytes = resolveLogical(ref);
  assert.equal(typeof bytes, "string", ref);
  return JSON.parse(bytes);
}

function trieValue(resolveLogical, rootRef, key) {
  let object = objectAt(resolveLogical, rootRef);
  for (const character of key) {
    const edge = object.children.find((item) => item.key === character);
    assert.ok(edge, `${object.kind}:${key}`);
    object = objectAt(resolveLogical, edge.ref);
  }
  assert.equal(object.hasValue, true, `${object.kind}:${key}`);
  return object.valueRef;
}

function directRefs(object) {
  if (object.kind === "candidate-seal") return [object.rootRef, object.previousSealRef].filter(Boolean);
  if (object.kind === "pocket-root") return [object.contentRef, object.placementRef, object.childrenRef, object.preservationRef];
  if (["content-trie", "placement-trie", "children-trie"].includes(object.kind))
    return [...object.children.map((edge) => edge.ref), ...(object.hasValue ? [object.valueRef] : [])];
  return object.kind === "sequence-branch" ? object.childRefs : [];
}

function reachableOwned(staged, candidate) {
  const seen = new Set(), pending = [candidate.sealRef], owned = new Set(candidate.newLogicalRefs), resolver = resolve(staged, candidate);
  while (pending.length) {
    const ref = pending.pop();
    if (seen.has(ref)) continue;
    seen.add(ref);
    for (const child of directRefs(objectAt(resolver, ref))) pending.push(child);
  }
  return new Set([...seen].filter((ref) => owned.has(ref)));
}

function expectFailure(result, reason) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
  assert.equal("candidate" in result, false);
  assert.equal("newLogicalRefs" in result, false);
}

async function admitSuccessor(c, staged, opened, candidate) {
  const semantic = c.PocketStarlingSemanticAuthorityShadow,
    issued = await semantic.issueSuccessor({ authority: opened.semanticAuthority,
      semanticBaseProof: opened.semanticBaseProof, candidate }),
    binding = c.PocketStarlingLogicalEditShadow.semanticTransitionBinding(
      candidate, opened.semanticAuthority, opened.semanticBaseProof,
    ),
    semanticValidity = semantic.attestationForStage({ authority: opened.semanticAuthority, proof: issued.proof, binding }),
    authenticated = await semantic.authenticate({ authority: opened.semanticAuthority, semanticValidity, binding });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  assert.ok(binding);
  assert.ok(semanticValidity);
  assert.equal(authenticated.ok, true, JSON.stringify(authenticated));
  const successor = await c.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: candidate.sealRef, resolveLogical: resolve(staged, candidate),
    syncedPocketId: opened.syncedPocketId, semanticAuthority: opened.semanticAuthority,
    semanticBaseProof: authenticated.semanticBaseProof,
  });
  assert.equal(successor.ok, true, JSON.stringify(successor));
  return { issued, successor };
}

test("P133 deletes exactly one current branch into retained roots with semantic provenance", async () => {
  const c = runtime(), input = graph(), staged = stage(c, stateFor(c, input)), opened = await open(c, staged), api = c.PocketStarlingLogicalEditShadow,
    baseRoot = staged.stage.rootObject,
    basePlacementRef = trieValue((ref) => staged.stager.store.get(ref), baseRoot.placementRef, "branch"),
    baseBranchChildrenRef = trieValue((ref) => staged.stager.store.get(ref), baseRoot.childrenRef, "branch"),
    deleted = await api.deleteBranch(opened.base, "branch", 1);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(deleted.retainedIndex, 1, "the retained append slot is not the source fromIndex");
  assert.equal(Object.isFrozen(deleted.candidate), true);
  assert.equal(objectAt(deleted.candidate.resolveLogical, deleted.candidate.sealRef).previousSealRef, staged.stage.sealRef);
  assert.deepEqual([...reachableOwned(staged, deleted.candidate)].sort(), [...deleted.candidate.newLogicalRefs].sort());
  const candidate = audit(c, staged, deleted.candidate), relation = c.PocketStarlingPlacementShadow.materialise(candidate.structural);
  assert.equal(relation.ok, true, JSON.stringify(relation));
  assert.deepEqual(plain(relation.relation.children.root), ["parent", "sibling", "retained"]);
  assert.deepEqual(plain(relation.relation.children[""]), ["retained-old", "branch"]);
  assert.equal(relation.relation.parents.branch, "");
  assert.equal(relation.relation.parents["desc-0000"], "branch");
  assert.equal(relation.relation.parents["desc-0001"], "desc-0000");
  assert.deepEqual(plain(relation.relation.children.branch), ["desc-0000"]);
  assert.equal(relation.relation.parents.retained, "root");
  const successorRoot = objectAt(resolve(staged, deleted.candidate), deleted.candidate.rootRef);
  assert.equal(successorRoot.contentRef, baseRoot.contentRef);
  assert.equal(successorRoot.preservationRef, baseRoot.preservationRef);
  assert.equal(trieValue(resolve(staged, deleted.candidate), successorRoot.childrenRef, "branch"), baseBranchChildrenRef);
  assert.notEqual(trieValue(resolve(staged, deleted.candidate), successorRoot.placementRef, "branch"), basePlacementRef);
  assert.equal(objectAt(resolve(staged, deleted.candidate), trieValue(resolve(staged, deleted.candidate), successorRoot.placementRef, "branch")).parentId, "");
  for (const nodeId of ["desc-0000", "desc-0001"])
    assert.equal(
      trieValue(resolve(staged, deleted.candidate), successorRoot.placementRef, nodeId),
      trieValue((ref) => staged.stager.store.get(ref), baseRoot.placementRef, nodeId),
    );
  const admitted = await admitSuccessor(c, staged, opened, deleted.candidate);
  assert.equal(admitted.issued.ok, true);
  assert.equal((await c.PocketStarlingSemanticAuthorityShadow.issueSuccessor({ authority: opened.semanticAuthority,
    semanticBaseProof: opened.semanticBaseProof, candidate: { ...deleted.candidate } })).ok, false);
  expectFailure(await api.editPayload(admitted.successor.base, "branch", { label: "blocked" }), "retained-node-not-current");
  expectFailure(await api.move(admitted.successor.base, "desc-0000", 0, "root", 0), "retained-node-not-current");
  const changed = await api.editPayload(admitted.successor.base, "sibling", { label: "still current" });
  assert.equal(changed.ok, true, JSON.stringify(changed));
});

test("P133 creates the first retained-root sequence and fails closed before a candidate", async () => {
  const c = runtime(), staged = stage(c, stateFor(c, graph(2, false))), opened = await open(c, staged), api = c.PocketStarlingLogicalEditShadow;
  expectFailure(await api.deleteBranch({}, "branch", 1), "invalid-base-token");
  for (const [nodeId, fromIndex, reason] of [["", 1, "invalid-node-id"], ["root", 1, "invalid-node-id"], ["missing", 1, "unknown-node"], ["branch", 0, "placement-membership-mismatch"]])
    expectFailure(await api.deleteBranch(opened.base, nodeId, fromIndex), reason);
  const deleted = await api.deleteBranch(opened.base, "branch", 1);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  const candidate = audit(c, staged, deleted.candidate), relation = c.PocketStarlingPlacementShadow.materialise(candidate.structural);
  assert.equal(relation.ok, true, JSON.stringify(relation));
  assert.deepEqual(plain(relation.relation.children[""]), ["branch"]);
  expectFailure(await api.deleteBranch(opened.base, "branch", Number.NaN), "placement-membership-mismatch");
});

test("P133 refuses retained roots and descendants, and missing source material", async () => {
  const c = runtime(), staged = stage(c, stateFor(c, graph())), opened = await open(c, staged), api = c.PocketStarlingLogicalEditShadow;
  expectFailure(await api.deleteBranch(opened.base, "retained-old", 0), "retained-node-not-current");
  expectFailure(await api.deleteBranch(opened.base, "retained-old-child", 0), "retained-node-not-current");
  const root = staged.stage.rootObject,
    sourceSequenceRef = trieValue((ref) => staged.stager.store.get(ref), root.childrenRef, "root");
  staged.stager.store.delete(sourceSequenceRef);
  const missing = await api.deleteBranch(opened.base, "branch", 1);
  assert.equal(missing.ok, false, JSON.stringify(missing));
  assert.equal("candidate" in missing, false);
  assert.equal("newLogicalRefs" in missing, false);
});

test("P133 Delete work stays bounded for a two-thousand-descendant branch", async () => {
  const c = runtime(), input = graph(2000, true), staged = stage(c, stateFor(c, input)), baseRoot = staged.stage.rootObject,
    descendantRefs = new Set(["desc-0000", "desc-1000", "desc-1999"].flatMap((nodeId) => [
      trieValue((ref) => staged.stager.store.get(ref), baseRoot.contentRef, nodeId),
      trieValue((ref) => staged.stager.store.get(ref), baseRoot.placementRef, nodeId),
    ])),
    touched = [], measurement = { active: false }, resolver = (ref) => {
      touched.push(ref);
      if (measurement.active && descendantRefs.has(ref)) throw new Error(`descendant read: ${ref}`);
      return staged.stager.store.get(ref);
    }, opened = await open(c, staged, "p133-large", resolver), before = apiDiagnostics(c, opened.base);
  touched.length = 0;
  measurement.active = true;
  const
    deleted = await c.PocketStarlingLogicalEditShadow.deleteBranch(opened.base, "branch", 1), delta = deleted.candidate.diagnostics.logicalFetches - before.logicalFetches;
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.ok(delta < 80, `Delete logical fetches ${delta}`);
  assert.ok(deleted.candidate.newLogicalRefs.length < 150, `Delete frontier ${deleted.candidate.newLogicalRefs.length}`);
  assert.equal(deleted.candidate.diagnostics.descendantReads, 0);
  assert.equal(touched.some((ref) => descendantRefs.has(ref)), false);
  const candidate = audit(c, staged, deleted.candidate), relation = c.PocketStarlingPlacementShadow.materialise(candidate.structural);
  assert.equal(relation.ok, true, JSON.stringify(relation));
  assert.equal(relation.relation.parents["desc-1999"], "desc-1998");
  assert.deepEqual(plain(relation.relation.children.branch), ["desc-0000"]);
});

function apiDiagnostics(c, base) {
  const result = c.PocketStarlingLogicalEditShadow.diagnostics(base);
  assert.equal(result.ok, undefined);
  return result;
}

test("P170 makes the P133 Delete primitive available to the live Starling owner", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" });
  assert.equal(source("index.html").includes(MODULE), false);
  assert.equal(manifest.some((entry) => entry.path === "/js/pocket-starling-logical-edit-shadow.js"), true);
});
