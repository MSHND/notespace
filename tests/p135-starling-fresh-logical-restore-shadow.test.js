"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"),
  path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"),
  { semanticBase } = require("./helpers/starling-semantic-test.js"), { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, ".."), MODULE = "js/pocket-starling-logical-edit-shadow.js", SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js", MODULE, "js/pocket-starling-semantic-authority-shadow.js",
];
const plain = (value) => JSON.parse(JSON.stringify(value));

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"), atob: (value) => Buffer.from(value, "base64").toString("binary"), console: { log() {}, info() {}, warn() {}, error() {} }, localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

function graph(descendants = 2, retained = true) {
  const nodes = [
    { id: "source", parentId: "root", order: 0, label: "Source" }, { id: "destination", parentId: "root", order: 1, label: "Destination" }, { id: "retained", parentId: "root", order: 2, label: "Literal current identity" },
    { id: "first", parentId: "source", order: 0, label: "First" }, { id: "branch", parentId: "source", order: 1, label: "Branch" }, { id: "last", parentId: "source", order: 2, label: "Last" }, { id: "destination-child", parentId: "destination", order: 0, label: "Destination child" },
    ...Array.from({ length: descendants }, (_, index) => ({ id: `desc-${String(index).padStart(4, "0")}`, parentId: index === 0 ? "branch" : `desc-${String(index - 1).padStart(4, "0")}`, order: 0, label: `Descendant ${index}` })),
  ], nodeIds = nodes.map((node) => node.id), parents = Object.fromEntries(nodes.map((node) => [node.id, node.parentId])), children = { root: ["source", "destination", "retained"], source: ["first", "branch", "last"], destination: ["destination-child"] };
  if (descendants) {
    children.branch = ["desc-0000"];
    for (let index = 0; index < descendants - 1; index += 1) children[`desc-${String(index).padStart(4, "0")}`] = [`desc-${String(index + 1).padStart(4, "0")}`];
  }
  if (retained) {
    nodes.push({ id: "retained-old", parentId: "root", order: 3, label: "Already retained" }, { id: "retained-old-child", parentId: "retained-old", order: 0, label: "Retained child" });
    nodeIds.push("retained-old", "retained-old-child"); parents["retained-old"] = ""; parents["retained-old-child"] = "retained-old"; children[""] = ["retained-old"]; children["retained-old"] = ["retained-old-child"];
  }
  return { nodes, relation: { nodeIds, parents, children } };
}

function stateFor(c, input) {
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-01T00:00:00.000Z", nodes: input.nodes, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), base = encoded.ok && c.PocketStarlingRootShadow.build(encoded.bridge), structural = c.PocketStarlingPlacementShadow.build(input.relation, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded)); assert.equal(base.ok, true, JSON.stringify(base)); assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = c.PocketStarlingRootShadow.diagnosticRootFor({ capacity: base.state.capacity, content: base.state.content, placements: structural.model.placements, children: structural.model.children, preservation: base.state.preservation });
  assert.equal(witness.ok, true, JSON.stringify(witness));
  return { schema: c.PocketStarlingRootShadow.SCHEMA, capacity: base.state.capacity, content: base.state.content, structural: structural.model, preservation: base.state.preservation, root: witness.root };
}

function stage(c, state) {
  const stager = c.PocketStarlingObjectSealShadow.createStager(), result = c.PocketStarlingObjectSealShadow.stageCandidate(stager, state, { previousSealRef: null });
  assert.equal(result.ok, true, JSON.stringify(result)); return { stager, stage: result.stage };
}

async function open(c, sealRef, resolveLogical, syncedPocketId, authority = null, semanticBaseProof = null) {
  const semantic = authority ? { semanticAuthority: authority, semanticBaseProof } : await semanticBase(c, { acceptedSealRef: sealRef, resolveLogical, syncedPocketId }),
    result = await c.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: sealRef, resolveLogical, syncedPocketId, ...semantic });
  assert.equal(result.ok, true, JSON.stringify(result)); return { ...result, ...semantic, syncedPocketId };
}

function resolver(staged, candidate = null) { return (ref) => (candidate && candidate.resolveLogical(ref)) || staged.stager.store.get(ref); }
function retainCandidate(staged, candidate) { for (const ref of candidate.newLogicalRefs) staged.stager.store.set(ref, candidate.resolveLogical(ref)); }
function objectAt(resolveLogical, ref) { const bytes = resolveLogical(ref); assert.equal(typeof bytes, "string", ref); return JSON.parse(bytes); }
function trieValue(resolveLogical, rootRef, key) { let object = objectAt(resolveLogical, rootRef); for (const character of key) { const edge = object.children.find((item) => item.key === character); assert.ok(edge, key); object = objectAt(resolveLogical, edge.ref); } assert.equal(object.hasValue, true, key); return object.valueRef; }
function directRefs(object) { if (object.kind === "candidate-seal") return [object.rootRef, object.previousSealRef].filter(Boolean); if (object.kind === "pocket-root") return [object.contentRef, object.placementRef, object.childrenRef, object.preservationRef]; if (["content-trie", "placement-trie", "children-trie"].includes(object.kind)) return [...object.children.map((edge) => edge.ref), ...(object.hasValue ? [object.valueRef] : [])]; return object.kind === "sequence-branch" ? object.childRefs : []; }
function reachableOwned(staged, candidate) { const seen = new Set(), pending = [candidate.sealRef], owned = new Set(candidate.newLogicalRefs), read = resolver(staged, candidate); while (pending.length) { const ref = pending.pop(); if (seen.has(ref)) continue; seen.add(ref); for (const child of directRefs(objectAt(read, ref))) pending.push(child); } return new Set([...seen].filter((ref) => owned.has(ref))); }
function audit(c, staged, candidate) { const result = c.PocketStarlingObjectSealShadow.auditCandidateSeal(candidate.sealRef, resolver(staged, candidate)); assert.equal(result.ok, true, JSON.stringify(result)); return result.candidate; }
function expectFailure(result, reason) { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.reason, reason, JSON.stringify(result)); assert.equal("candidate" in result, false); assert.equal("newLogicalRefs" in result, false); }

async function admit(c, staged, base, candidate) {
  const semantic = c.PocketStarlingSemanticAuthorityShadow, issued = await semantic.issueSuccessor({ authority: base.semanticAuthority, semanticBaseProof: base.semanticBaseProof, candidate }), binding = c.PocketStarlingLogicalEditShadow.semanticTransitionBinding(candidate, base.semanticAuthority, base.semanticBaseProof), record = semantic.attestationForStage({ authority: base.semanticAuthority, proof: issued.proof, binding }), authenticated = await semantic.authenticate({ authority: base.semanticAuthority, semanticValidity: record, binding });
  assert.equal(issued.ok, true, JSON.stringify(issued)); assert.ok(binding); assert.ok(record); assert.equal(authenticated.ok, true, JSON.stringify(authenticated));
  const next = await open(c, candidate.sealRef, resolver(staged, candidate), base.syncedPocketId, base.semanticAuthority, authenticated.semanticBaseProof);
  return { next, issued };
}

test("P135 restores a genuine Delete successor into a present-day current destination", async () => {
  const c = runtime(), staged = stage(c, stateFor(c, graph())), base = await open(c, staged.stage.sealRef, (ref) => staged.stager.store.get(ref), "p135"), api = c.PocketStarlingLogicalEditShadow,
    deleted = await api.deleteBranch(base.base, "branch", 1); assert.equal(deleted.ok, true, JSON.stringify(deleted)); audit(c, staged, deleted.candidate); retainCandidate(staged, deleted.candidate);
  const retained = await admit(c, staged, base, deleted.candidate), deletedRelation = c.PocketStarlingPlacementShadow.materialise(audit(c, staged, deleted.candidate).structural); assert.equal(deletedRelation.ok, true); assert.equal(deletedRelation.relation.parents.branch, "");
  const retainedRoot = objectAt(resolver(staged, deleted.candidate), deleted.candidate.rootRef), branchChildren = trieValue(resolver(staged, deleted.candidate), retainedRoot.childrenRef, "branch"), descendantPlacement = trieValue(resolver(staged, deleted.candidate), retainedRoot.placementRef, "desc-0001"), restored = await api.restoreBranch(retained.next.base, "branch", 1, "destination", 0);
  assert.equal(restored.ok, true, JSON.stringify(restored)); assert.equal(objectAt(restored.candidate.resolveLogical, restored.candidate.sealRef).previousSealRef, deleted.candidate.sealRef); assert.deepEqual([...reachableOwned(staged, restored.candidate)].sort(), [...restored.candidate.newLogicalRefs].sort());
  const candidate = audit(c, staged, restored.candidate), relation = c.PocketStarlingPlacementShadow.materialise(candidate.structural); retainCandidate(staged, restored.candidate); assert.equal(relation.ok, true, JSON.stringify(relation));
  assert.deepEqual(plain(relation.relation.children[""]), ["retained-old"]); assert.deepEqual(plain(relation.relation.children.destination), ["branch", "destination-child"]); assert.equal(relation.relation.parents.branch, "destination"); assert.equal(relation.relation.parents["desc-0001"], "desc-0000");
  const restoredRoot = objectAt(resolver(staged, restored.candidate), restored.candidate.rootRef); assert.equal(restoredRoot.contentRef, retainedRoot.contentRef); assert.equal(restoredRoot.preservationRef, retainedRoot.preservationRef); assert.equal(trieValue(resolver(staged, restored.candidate), restoredRoot.childrenRef, "branch"), branchChildren); assert.equal(trieValue(resolver(staged, restored.candidate), restoredRoot.placementRef, "desc-0001"), descendantPlacement);
  const admitted = await admit(c, staged, retained.next, restored.candidate); assert.equal(admitted.issued.ok, true); assert.equal((await c.PocketStarlingSemanticAuthorityShadow.issueSuccessor({ authority: retained.next.semanticAuthority, semanticBaseProof: retained.next.semanticBaseProof, candidate: { ...restored.candidate } })).ok, false);
  const editedBranch = await api.editPayload(admitted.next.base, "branch", { label: "restored" }), editedDescendant = await api.editPayload(admitted.next.base, "desc-0001", { label: "current descendant" }), editedSibling = await api.editPayload(admitted.next.base, "first", { label: "still current" });
  assert.equal(editedBranch.ok, true, JSON.stringify(editedBranch));
  assert.equal(editedDescendant.ok, true, JSON.stringify(editedDescendant));
  expectFailure(await api.editPayload(admitted.next.base, "retained-old", { label: "blocked" }), "retained-node-not-current");
  assert.equal(editedSibling.ok, true, JSON.stringify(editedSibling));
});

test("P135 preserves the canonical empty retained sequence after restoring its sole root", async () => {
  const c = runtime(), staged = stage(c, stateFor(c, graph(2, false))), base = await open(c, staged.stage.sealRef, (ref) => staged.stager.store.get(ref), "p135-empty"), deleted = await c.PocketStarlingLogicalEditShadow.deleteBranch(base.base, "branch", 1); audit(c, staged, deleted.candidate); retainCandidate(staged, deleted.candidate);
  const retained = await admit(c, staged, base, deleted.candidate), restored = await c.PocketStarlingLogicalEditShadow.restoreBranch(retained.next.base, "branch", 0, "destination", 1), candidate = audit(c, staged, restored.candidate), relation = c.PocketStarlingPlacementShadow.materialise(candidate.structural);
  assert.equal(restored.ok, true, JSON.stringify(restored)); assert.equal(relation.ok, true, JSON.stringify(relation)); assert.deepEqual(plain(relation.relation.children[""]), []); assert.deepEqual(plain(relation.relation.children.destination), ["destination-child", "branch"]);
});

test("P135 rejects non-retained sources, non-root retained sources, and invalid destinations", async () => {
  const c = runtime(), staged = stage(c, stateFor(c, graph())), base = await open(c, staged.stage.sealRef, (ref) => staged.stager.store.get(ref), "p135-fail"), api = c.PocketStarlingLogicalEditShadow, deleted = await api.deleteBranch(base.base, "branch", 1), retained = await admit(c, staged, base, deleted.candidate);
  expectFailure(await api.restoreBranch({}, "branch", 1, "destination", 0), "invalid-base-token");
  for (const nodeId of ["", "root"]) expectFailure(await api.restoreBranch(retained.next.base, nodeId, 1, "destination", 0), "invalid-node-id");
  expectFailure(await api.restoreBranch(retained.next.base, "missing", 0, "destination", 0), "unknown-node"); expectFailure(await api.restoreBranch(retained.next.base, "destination", 0, "source", 0), "current-node-not-retained"); expectFailure(await api.restoreBranch(retained.next.base, "retained-old-child", 0, "destination", 0), "retained-node-not-root"); expectFailure(await api.restoreBranch(retained.next.base, "branch", 0, "destination", 0), "placement-membership-mismatch"); expectFailure(await api.restoreBranch(retained.next.base, "branch", 1, "", 0), "retained-parent-not-current"); expectFailure(await api.restoreBranch(retained.next.base, "branch", 1, "missing", 0), "unknown-parent"); expectFailure(await api.restoreBranch(retained.next.base, "branch", 1, "desc-0000", 0), "move-would-cycle");
});

test("P135 Restore work remains bounded for a two-thousand-descendant retained branch", async () => {
  const c = runtime(), staged = stage(c, stateFor(c, graph(2000))), base = await open(c, staged.stage.sealRef, (ref) => staged.stager.store.get(ref), "p135-large"), api = c.PocketStarlingLogicalEditShadow, deleted = await api.deleteBranch(base.base, "branch", 1); audit(c, staged, deleted.candidate); retainCandidate(staged, deleted.candidate);
  const retained = await admit(c, staged, base, deleted.candidate), deletedRoot = objectAt(resolver(staged, deleted.candidate), deleted.candidate.rootRef), guarded = new Set(["desc-0000", "desc-1000", "desc-1999"].flatMap((nodeId) => [trieValue(resolver(staged, deleted.candidate), deletedRoot.contentRef, nodeId), trieValue(resolver(staged, deleted.candidate), deletedRoot.placementRef, nodeId)])), measurement = { active: false }, guardedResolver = (ref) => { if (measurement.active && guarded.has(ref)) throw new Error(`descendant read: ${ref}`); return resolver(staged, deleted.candidate)(ref); }, restoreBase = await open(c, deleted.candidate.sealRef, guardedResolver, "p135-large", retained.next.semanticAuthority, retained.next.semanticBaseProof), before = api.diagnostics(restoreBase.base);
  measurement.active = true; const restored = await api.restoreBranch(restoreBase.base, "branch", 1, "destination", 1), delta = restored.candidate.diagnostics.logicalFetches - before.logicalFetches;
  assert.equal(restored.ok, true, JSON.stringify(restored)); assert.ok(delta < 100, `Restore logical fetches ${delta}`); assert.ok(restored.candidate.newLogicalRefs.length < 200, `Restore frontier ${restored.candidate.newLogicalRefs.length}`); assert.equal(restored.candidate.diagnostics.descendantReads, 0);
  const candidate = audit(c, staged, restored.candidate), relation = c.PocketStarlingPlacementShadow.materialise(candidate.structural); assert.equal(relation.ok, true, JSON.stringify(relation)); assert.equal(relation.relation.parents["desc-1999"], "desc-1998"); assert.deepEqual(plain(relation.relation.children.branch), ["desc-0000"]);
});

test("P135 remains dormant in production", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" }); assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes(MODULE), false); assert.equal(manifest.some((entry) => entry.path === `/${MODULE}`), false);
});
