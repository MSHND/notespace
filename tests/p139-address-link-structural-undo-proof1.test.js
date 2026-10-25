"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"),
  path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"),
  { semanticBase } = require("./helpers/starling-semantic-test.js"), { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, ".."), MODULE = "js/pocket-starling-logical-edit-shadow.js", SCRIPTS = [
  "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-node-content.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js", MODULE, "js/pocket-starling-semantic-authority-shadow.js",
];
const plain = (value) => JSON.parse(JSON.stringify(value));

function runtime() {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"), atob: (value) => Buffer.from(value, "base64").toString("binary"), console: { log() {}, info() {}, warn() {}, error() {} }, localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  return c;
}

function graph(descendants = 2) {
  const nodes = [
    { id: "source", parentId: "root", order: 0, label: "Source" }, { id: "destination", parentId: "root", order: 1, label: "Destination" }, { id: "unrelated", parentId: "root", order: 2, label: "Unrelated" },
    { id: "first", parentId: "source", order: 0, label: "First" }, { id: "branch", parentId: "source", order: 1, label: "Branch" }, { id: "last", parentId: "source", order: 2, label: "Last" }, { id: "destination-child", parentId: "destination", order: 0, label: "Destination child" }, { id: "unrelated-child", parentId: "unrelated", order: 0, label: "Unrelated child" },
    { id: "retained-old", parentId: "root", order: 3, label: "Earlier retained root" }, { id: "retained-old-child", parentId: "retained-old", order: 0, label: "Earlier retained child" },
    ...Array.from({ length: descendants }, (_, index) => ({ id: `desc-${String(index).padStart(4, "0")}`, parentId: index === 0 ? "branch" : `desc-${String(index - 1).padStart(4, "0")}`, order: 0, label: `Descendant ${index}` })),
  ], nodeIds = nodes.map((node) => node.id), parents = Object.fromEntries(nodes.map((node) => [node.id, node.parentId])), children = { root: ["source", "destination", "unrelated"], source: ["first", "branch", "last"], destination: ["destination-child"], unrelated: ["unrelated-child"], "": ["retained-old"], "retained-old": ["retained-old-child"] };
  if (descendants) {
    children.branch = ["desc-0000"];
    for (let index = 0; index < descendants - 1; index += 1) children[`desc-${String(index).padStart(4, "0")}`] = [`desc-${String(index + 1).padStart(4, "0")}`];
  }
  parents["retained-old"] = "";
  return { nodes, relation: { nodeIds, parents, children } };
}

function stateFor(c, input) {
  const encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-01T00:00:00.000Z", nodes: input.nodes, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), base = encoded.ok && c.PocketStarlingRootShadow.build(encoded.bridge), structural = c.PocketStarlingPlacementShadow.build(input.relation, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded)); assert.equal(base.ok, true, JSON.stringify(base)); assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = c.PocketStarlingRootShadow.diagnosticRootFor({ capacity: base.state.capacity, content: base.state.content, placements: structural.model.placements, children: structural.model.children, preservation: base.state.preservation });
  assert.equal(witness.ok, true, JSON.stringify(witness));
  return { schema: c.PocketStarlingRootShadow.SCHEMA, capacity: base.state.capacity, content: base.state.content, structural: structural.model, preservation: base.state.preservation, root: witness.root };
}

function stage(c, input) {
  const stager = c.PocketStarlingObjectSealShadow.createStager(), result = c.PocketStarlingObjectSealShadow.stageCandidate(stager, stateFor(c, input), { previousSealRef: null });
  assert.equal(result.ok, true, JSON.stringify(result)); return { stager, stage: result.stage };
}

async function open(c, staged, syncedPocketId = "p139", resolver = null) {
  const resolveLogical = resolver || ((ref) => staged.stager.store.get(ref)), semantic = await semanticBase(c, { acceptedSealRef: staged.stage.sealRef, resolveLogical, syncedPocketId }), result = await c.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: staged.stage.sealRef, resolveLogical, ...semantic });
  assert.equal(result.ok, true, JSON.stringify(result)); return { ...result, ...semantic, syncedPocketId };
}

function resolve(staged, candidate) { return (ref) => candidate.resolveLogical(ref) || staged.stager.store.get(ref); }
function objectAt(resolveLogical, ref) { const bytes = resolveLogical(ref); assert.equal(typeof bytes, "string", ref); return JSON.parse(bytes); }
function trieValue(resolveLogical, rootRef, key) { let object = objectAt(resolveLogical, rootRef); for (const character of key) { const edge = object.children.find((item) => item.key === character); assert.ok(edge, key); object = objectAt(resolveLogical, edge.ref); } assert.equal(object.hasValue, true, key); return object.valueRef; }
function directRefs(object) { if (object.kind === "candidate-seal") return [object.rootRef, object.previousSealRef].filter(Boolean); if (object.kind === "pocket-root") return [object.contentRef, object.placementRef, object.childrenRef, object.preservationRef]; if (["content-trie", "placement-trie", "children-trie"].includes(object.kind)) return [...object.children.map((edge) => edge.ref), ...(object.hasValue ? [object.valueRef] : [])]; return object.kind === "sequence-branch" ? object.childRefs : []; }
function reachableOwned(staged, candidate) { const seen = new Set(), pending = [candidate.sealRef], owned = new Set(candidate.newLogicalRefs), read = resolve(staged, candidate); while (pending.length) { const ref = pending.pop(); if (seen.has(ref)) continue; seen.add(ref); for (const child of directRefs(objectAt(read, ref))) pending.push(child); } return new Set([...seen].filter((ref) => owned.has(ref))); }
function audit(c, staged, candidate) { const result = c.PocketStarlingObjectSealShadow.auditCandidateSeal(candidate.sealRef, resolve(staged, candidate)); assert.equal(result.ok, true, JSON.stringify(result)); return result.candidate; }
function expectFailure(result, reason, operationIndex = null) { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.reason, reason, JSON.stringify(result)); if (operationIndex !== null) assert.equal(result.operationIndex, operationIndex, JSON.stringify(result)); assert.deepEqual([...Object.keys(result)].sort(), (operationIndex === null ? ["ok", "reason"] : ["ok", "operationIndex", "reason"]).sort()); for (const field of ["candidate", "newLogicalRefs", "rootRef", "sealRef", "proof", "binding", "authority", "base"]) assert.equal(field in result, false, field); assert.equal(Object.isFrozen(result), true); }

async function successorBase(c, staged, opened, candidate) {
  const semantic = c.PocketStarlingSemanticAuthorityShadow, issued = await semantic.issueSuccessor({ authority: opened.semanticAuthority, semanticBaseProof: opened.semanticBaseProof, candidate }), binding = c.PocketStarlingLogicalEditShadow.semanticTransitionBinding(candidate, opened.semanticAuthority, opened.semanticBaseProof), validity = semantic.attestationForStage({ authority: opened.semanticAuthority, proof: issued.proof, binding }), authenticated = await semantic.authenticate({ authority: opened.semanticAuthority, semanticValidity: validity, binding }), next = await c.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: candidate.sealRef, resolveLogical: resolve(staged, candidate), syncedPocketId: opened.syncedPocketId, semanticAuthority: opened.semanticAuthority, semanticBaseProof: authenticated.semanticBaseProof });
  assert.equal(issued.ok, true, JSON.stringify(issued)); assert.ok(binding); assert.ok(validity); assert.equal(authenticated.ok, true, JSON.stringify(authenticated)); assert.equal(next.ok, true, JSON.stringify(next)); return { issued, next };
}


// Address-link Structural Undo Proof 1 (TEST ONLY).
// All state, admissions and receipts below are disposable VM fixtures.
// This is not a durable transaction owner, historical Head CAS proof,
// production permission system, model adoption, or executable user Undo.
function stateAt(c, read, sealRef) {
  try {
    const audited = c.PocketStarlingObjectSealShadow.auditCandidateSeal(sealRef, read);
    if (!audited.ok) throw new Error("seal-audit: " + JSON.stringify(audited));
    const seal = objectAt(read, sealRef);
    const root = objectAt(read, seal.rootRef);
    const structural = c.PocketStarlingPlacementShadow.materialise(audited.candidate.structural);
    if (!structural.ok) throw new Error("structural: " + JSON.stringify(structural));
    return {
      sealRef, seal, root, relation: plain(structural.relation),
      content: (id) => {
        const record = c.PocketStarlingRootShadow.getContent(audited.candidate, id);
        return record && record.nodeId === id ? plain(record.payload) : null;
      },
    };
  } catch (error) {
    throw new Error("stateAt diagnostic " + sealRef + ": " + String(error));
  }
}
function placementOf(s, nodeId) {
  if (!s || !Object.prototype.hasOwnProperty.call(s.relation.parents, nodeId))
    return null;
  const parentId = s.relation.parents[nodeId];
  const index = (s.relation.children[parentId] || []).indexOf(nodeId);
  return index >= 0 && parentId !== "" ? { parentId, index } : null;
}
function reject(reason) { return Object.freeze({ ok: false, reason }); }

// Pure test-local *planner*, not a new runtime owner. Every operation returned
// here must still pass existing P139 composition and authority checks.
async function planInverse(f, options = {}) {
  const { c, current, witness, receipts } = f;
  const nodeId = witness.nodeId, pocketId = options.pocketId || f.pocketId;
  if (pocketId !== f.pocketId || current.pocketId !== pocketId)
    return reject("wrong-pocket");
  if (!options.scope || options.scope.pocketId !== pocketId ||
      options.scope.allowStructuralUndo !== true)
    return reject("scope-not-authorised");
  if (options.expectedHead && options.expectedHead !== current.head)
    return reject("stale-head");
  if (!witness.transactionId || witness.beforeSeal === witness.afterSeal ||
      typeof nodeId !== "string")
    return reject("missing-transaction-witness");

  const history = [];
  const visited = new Set();
  let cursor = current.head;
  for (let step = 0; step < 32; step += 1) {
    if (!cursor || visited.has(cursor)) return reject("incomplete-or-cyclic-lineage");
    visited.add(cursor);
    const snapshot = stateAt(c, current.resolveLogical, cursor);
    if (!snapshot) return reject("unverified-sealed-state");
    history.push(snapshot);
    if (cursor === witness.beforeSeal) break;
    const receipt = receipts.get(cursor);
    if (!receipt || !receipt.binding || !receipt.validity ||
        receipt.binding.logicalSealRef !== cursor)
      return reject("missing-or-misbound-admission");
    const authenticated = await c.PocketStarlingSemanticAuthorityShadow.authenticate({
      authority: current.authority, semanticValidity: receipt.validity,
      binding: receipt.binding,
    });
    if (!authenticated.ok) return reject("unauthenticated-admission");
    cursor = snapshot.seal.previousSealRef;
  }
  if (history[history.length - 1]?.sealRef !== witness.beforeSeal)
    return reject("incomplete-or-cyclic-lineage");
  const afterIndex = history.findIndex((s) => s.sealRef === witness.afterSeal);
  if (afterIndex < 0 || afterIndex + 1 >= history.length ||
      history[afterIndex + 1].sealRef !== witness.beforeSeal)
    return reject("nonadjacent-forward-revision");
  const before = history[afterIndex + 1], after = history[afterIndex];
  const original = placementOf(before, nodeId), moved = placementOf(after, nodeId);
  if (!original || !moved || original.parentId === moved.parentId ||
      original.parentId !== witness.oldParentId ||
      original.index !== witness.oldIndex ||
      moved.parentId !== witness.newParentId ||
      moved.index !== witness.newIndex)
    return reject("unverified-forward-relation");
  // The forward edit was solely structural, not a payload or preservation rewrite.
  if (before.root.contentRef !== after.root.contentRef ||
      before.root.preservationRef !== after.root.preservationRef ||
      JSON.stringify(before.content(nodeId)) !== JSON.stringify(after.content(nodeId)))
    return reject("unexplained-forward-content-change");
  for (const s of history.slice(0, afterIndex)) {
    if (JSON.stringify(placementOf(s, nodeId)) !== JSON.stringify(moved))
      return reject("intervening-target-structure-change");
  }
  const now = history[0], at = placementOf(now, nodeId);
  if (!at || JSON.stringify(at) !== JSON.stringify(moved))
    return reject("target-moved-or-deleted");
  // The original parent must still be a current visible addressable chunk.
  if (original.parentId !== "root" &&
      !placementOf(now, original.parentId))
    return reject("original-endpoint-unavailable");
  const beforeSiblings = before.relation.children[original.parentId] || [];
  const expectedSourceAfter = beforeSiblings.filter((id) => id !== nodeId);
  const currentSource = now.relation.children[original.parentId] || [];
  if (JSON.stringify(currentSource) !== JSON.stringify(expectedSourceAfter))
    return reject("original-slot-conflict");

  return Object.freeze({ ok: true, operation: {
    type: "move", input: {
      nodeId, fromIndex: at.index, newParentId: original.parentId,
      toIndex: original.index,
    },
  } });
}

async function disposableFixture() {
  const c = runtime(), staged = stage(c, graph(2));
  const opened = await open(c, staged, "undo-proof-disposable-pocket");
  const api = c.PocketStarlingLogicalEditShadow, receipts = new Map();
  const pocketId = opened.syncedPocketId;
  let current = {
    pocketId, head: staged.stage.sealRef, authority: opened.semanticAuthority,
    proof: opened.semanticBaseProof, base: opened.base,
    resolveLogical: (ref) => staged.stager.store.get(ref),
  };
  async function advance(operations) {
    const out = await api.compose(current.base, operations);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.changed, true, JSON.stringify(out));
    const candidate = out.candidate;
    const issued = await c.PocketStarlingSemanticAuthorityShadow.issueSuccessor({
      authority: current.authority, semanticBaseProof: current.proof, candidate,
    });
    assert.equal(issued.ok, true, JSON.stringify(issued));
    const binding = api.semanticTransitionBinding(candidate, current.authority, current.proof);
    assert.ok(binding);
    const validity = c.PocketStarlingSemanticAuthorityShadow.attestationForStage({
      authority: current.authority, proof: issued.proof, binding,
    });
    assert.ok(validity);
    const authenticated = await c.PocketStarlingSemanticAuthorityShadow.authenticate({
      authority: current.authority, semanticValidity: validity, binding,
    });
    assert.equal(authenticated.ok, true, JSON.stringify(authenticated));
    const nextRead = (ref) => candidate.resolveLogical(ref) || current.resolveLogical(ref);
    const next = await api.createBase({
      acceptedSealRef: candidate.sealRef, resolveLogical: nextRead,
      syncedPocketId: pocketId, semanticAuthority: current.authority,
      semanticBaseProof: authenticated.semanticBaseProof,
    });
    assert.equal(next.ok, true, JSON.stringify(next));
    receipts.set(candidate.sealRef, { binding, validity });
    current = {
      pocketId, head: candidate.sealRef, authority: current.authority,
      proof: authenticated.semanticBaseProof, base: next.base, resolveLogical: nextRead,
    };
    return candidate;
  }
  const before = stateAt(c, current.resolveLogical, current.head);
  assert.ok(before);
  const moved = await advance([{
    type: "move", input: {
      nodeId: "branch", fromIndex: 1, newParentId: "destination", toIndex: 1,
    },
  }]);
  const after = stateAt(c, current.resolveLogical, moved.sealRef);
  assert.ok(after);
  const witness = Object.freeze({
    transactionId: "test-only-unretained-intent-1",
    nodeId: "branch", beforeSeal: before.sealRef, afterSeal: after.sealRef,
    oldParentId: "source", oldIndex: 1,
    newParentId: "destination", newIndex: 1,
  });
  const f = {
    c, staged, api, receipts, witness, pocketId, advance,
    get current() { return current; },
    get view() { return stateAt(c, current.resolveLogical, current.head); },
    scope: () => ({ pocketId, allowStructuralUndo: true }),
  };
  return f;
}

test("Address-link structural inverse preserves later target and independent edits without restoring a snapshot", async () => {
  const f = await disposableFixture();
  await f.advance([{ type: "payload", input: {
    nodeId: "branch", payload: { label: "C changed after moving", note: "keep this" },
  } }]);
  await f.advance([{ type: "payload", input: {
    nodeId: "destination", payload: { label: "B changed independently" },
  } }]);
  await f.advance([{ type: "reorder", input: {
    nodeId: "unrelated", fromIndex: 2, toIndex: 0,
  } }]);
  const latest = f.view, beforeHead = f.current.head;
  assert.deepEqual(latest.relation.children.root, ["unrelated", "source", "destination"]);
  const plan = await planInverse(f, { scope: f.scope(), expectedHead: beforeHead });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.deepEqual(plan.operation, {
    type: "move", input: {
      nodeId: "branch", fromIndex: 1, newParentId: "source", toIndex: 1,
    },
  });
  const undone = await f.api.compose(f.current.base, [plan.operation]);
  assert.equal(undone.ok, true, JSON.stringify(undone));
  const resulting = stateAt(f.c,
    (ref) => undone.candidate.resolveLogical(ref) || f.current.resolveLogical(ref),
    undone.candidate.sealRef);
  assert.ok(resulting);
  assert.equal(resulting.seal.previousSealRef, beforeHead);
  assert.deepEqual(resulting.relation.children.source, ["first", "branch", "last"]);
  assert.deepEqual(resulting.relation.children.destination, ["destination-child"]);
  assert.deepEqual(resulting.relation.children.root, ["unrelated", "source", "destination"]);
  assert.deepEqual(resulting.relation.children.branch, latest.relation.children.branch);
  assert.deepEqual(resulting.content("branch"), latest.content("branch"));
  assert.deepEqual(resulting.content("destination"), latest.content("destination"));
  assert.deepEqual(resulting.content("unrelated"), latest.content("unrelated"));
  assert.equal(resulting.root.contentRef, latest.root.contentRef);
  assert.equal(resulting.root.preservationRef, latest.root.preservationRef);
  assert.notEqual(resulting.sealRef, f.witness.beforeSeal);
});

test("Address-link inverse fails closed for changed relations, history gaps, wrong authority and scope", async () => {
  const safe = await disposableFixture();
  const check = async (options, reason, f = safe) => {
    const snapshot = f.current.head, result = await planInverse(f, options);
    assert.deepEqual(result, { ok: false, reason });
    assert.equal(f.current.head, snapshot, "refusal must not mutate head");
    assert.equal("operation" in result, false);
  };
  await check({ scope: { pocketId: safe.pocketId, allowStructuralUndo: false } }, "scope-not-authorised");
  await check({ scope: safe.scope(), pocketId: "other-pocket" }, "wrong-pocket");
  await check({ scope: safe.scope(), expectedHead: "stale-head" }, "stale-head");

  const absent = await disposableFixture();
  absent.receipts.delete(absent.witness.afterSeal);
  await check({ scope: absent.scope() }, "missing-or-misbound-admission", absent);

  const forged = await disposableFixture();
  const receipt = forged.receipts.get(forged.witness.afterSeal);
  forged.receipts.set(forged.witness.afterSeal, {
    validity: receipt.validity,
    binding: { ...receipt.binding, syncedPocketId: "foreign-pocket" },
  });
  await check({ scope: forged.scope() }, "unauthenticated-admission", forged);

  const altered = await disposableFixture();
  const normal = altered.current;
  const failRead = (ref) => ref === altered.current.head ? "{}" : normal.resolveLogical(ref);
  const tampered = {
    ...altered, current: { ...normal, resolveLogical: failRead },
  };
  await check({ scope: altered.scope() }, "unverified-sealed-state", tampered);

  const conflict = await disposableFixture();
  await conflict.advance([{ type: "reorder", input: {
    nodeId: "branch", fromIndex: 1, toIndex: 0,
  } }]);
  await check({ scope: conflict.scope() }, "intervening-target-structure-change", conflict);

  const changedBack = await disposableFixture();
  await changedBack.advance([{ type: "move", input: {
    nodeId: "branch", fromIndex: 1, newParentId: "unrelated", toIndex: 1,
  } }]);
  await changedBack.advance([{ type: "move", input: {
    nodeId: "branch", fromIndex: 1, newParentId: "destination", toIndex: 1,
  } }]);
  await check({ scope: changedBack.scope() }, "intervening-target-structure-change", changedBack);

  const removedParent = await disposableFixture();
  await removedParent.advance([{ type: "delete", input: {
    nodeId: "source", fromIndex: 0,
  } }]);
  await check({ scope: removedParent.scope() }, "original-endpoint-unavailable", removedParent);

  const ambiguousSlot = await disposableFixture();
  await ambiguousSlot.advance([{ type: "reorder", input: {
    nodeId: "last", fromIndex: 1, toIndex: 0,
  } }]);
  await check({ scope: ambiguousSlot.scope() }, "original-slot-conflict", ambiguousSlot);
});
