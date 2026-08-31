"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { webcrypto } = require("node:crypto"),
  { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");

const ROOT = path.resolve(__dirname, ".."),
  MODULE = "js/pocket-starling-logical-edit-shadow.js",
  SCRIPTS = [
    "js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js",
    "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
    "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", MODULE,
  ];

const plain = (value) => JSON.parse(JSON.stringify(value));
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function runtime() {
  const c = {
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON,
    Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
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
    schema: "portal.mtt.web.v1", writtenAt: "2026-08-30T00:00:00.000Z", nodes,
    tombstones: [{ id: "gone" }], rootExtras: { rootMarker: true }, dataExtras: { dataMarker: true },
  };
}

function nodes(parentSiblings = 20, descendants = 8, unrelated = 12) {
  return [
    { id: "parent", parentId: "root", order: 0, label: "Parent", value: 1 },
    { id: "branch", parentId: "root", order: 20, label: "Branch", value: 2 },
    { id: "other", parentId: "root", order: 40, label: "Other", value: 3 },
    ...Array.from({ length: parentSiblings }, (_, index) => ({
      id: `p${String(index).padStart(2, "0")}`, parentId: "parent", order: index,
      label: `Parent ${index}`, value: index,
    })),
    ...Array.from({ length: descendants }, (_, index) => ({
      id: `d${String(index).padStart(4, "0")}`, parentId: "branch", order: index,
      label: `Descendant ${index}`, value: index,
    })),
    ...Array.from({ length: unrelated }, (_, index) => ({
      id: `u${String(index).padStart(4, "0")}`, parentId: "other", order: index,
      label: `Unrelated ${index}`, value: index,
    })),
  ];
}

function stateFor(c, input) {
  const encoded = c.PocketStarlingBridgeShadow.encode(normalised(input), { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true, JSON.stringify(built));
  return built.state;
}

function stage(c, stager, state, base = null) {
  const result = c.PocketStarlingObjectSealShadow.stageCandidate(
    stager, state, base ? { previousSealRef: base.sealRef, baseStage: base } : { previousSealRef: null },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.stage;
}

function confirm(c, stager, logicalStage) {
  const result = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(
    logicalStage, (ref) => stager.store.has(ref), logicalStage.sealObject.previousSealRef === null ? {} : { baseComplete: true },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function open(c, logicalStage, store) {
  const result = await c.PocketStarlingLogicalEditShadow.createBase({
    acceptedSealRef: logicalStage.sealRef, resolveLogical: (ref) => store.get(ref),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function materialise(c, baseStore, candidate) {
  const result = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
    candidate.sealRef, (ref) => candidate.resolveLogical(ref) || baseStore.get(ref),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.candidate;
}

function candidateObject(candidate, ref) {
  const bytes = candidate.resolveLogical(ref);
  assert.equal(typeof bytes, "string", ref);
  return JSON.parse(bytes);
}

function directRefs(object) {
  if (object.kind === "candidate-seal") return [object.rootRef, object.previousSealRef].filter(Boolean);
  if (object.kind === "pocket-root") return [object.contentRef, object.placementRef, object.childrenRef, object.preservationRef];
  if (["content-trie", "placement-trie", "children-trie"].includes(object.kind)) return [...object.children.map((edge) => edge.ref), ...(object.hasValue ? [object.valueRef] : [])];
  if (object.kind === "sequence-branch") return object.childRefs;
  return [];
}

function reachableCandidateRefs(baseStore, candidate) {
  const seen = new Set(), stack = [candidate.sealRef], owned = new Set(candidate.newLogicalRefs);
  while (stack.length) {
    const ref = stack.pop(); if (seen.has(ref)) continue; seen.add(ref);
    const bytes = candidate.resolveLogical(ref) || baseStore.get(ref);
    assert.equal(typeof bytes, "string", ref);
    for (const next of directRefs(JSON.parse(bytes))) stack.push(next);
  }
  return new Set([...seen].filter((ref) => owned.has(ref)));
}

function relation(c, candidate) {
  const result = c.PocketStarlingPlacementShadow.materialise(candidate.structural);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.relation;
}

function expectFailure(result, reason) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
  assert.equal("candidate" in result, false);
  assert.equal("newLogicalRefs" in result, false);
}

test("P130 inserts a fresh root child with exact canonical oracle equivalence", async () => {
  const writer = runtime(), input = [
      { id: "root-first", parentId: "root", order: 0, label: "First", value: 1 },
      { id: "root-last", parentId: "root", order: 20, label: "Last", value: 2 },
    ],
    state = stateFor(writer, input), stager = writer.PocketStarlingObjectSealShadow.createStager(), base = stage(writer, stager, state);
  confirm(writer, stager, base);
  const baseStore = new Map(stager.store), reader = runtime(), opened = await open(reader, base, baseStore), inserted = await reader.PocketStarlingLogicalEditShadow.insert(opened.base, {
    nodeId: "fresh-root", parentId: "root", toIndex: 1, payload: { label: "Fresh root", value: 130, flags: ["new"] },
  });
  assert.equal(inserted.ok, true, JSON.stringify(inserted));
  const candidate = inserted.candidate, expectedNodes = [
      input[0], { id: "fresh-root", parentId: "root", order: 10, label: "Fresh root", value: 130, flags: ["new"] }, input[1],
    ],
    oracle = stage(writer, stager, stateFor(writer, expectedNodes), base), reconstructed = materialise(reader, baseStore, candidate), expected = writer.PocketStarlingObjectSealShadow.auditCandidateSeal(oracle.sealRef, (ref) => stager.store.get(ref));
  assert.equal(Object.isFrozen(inserted), true);
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.newLogicalRefs), true);
  assert.deepEqual(Object.keys(candidate), ["rootRef", "sealRef", "newLogicalRefs", "resolveLogical", "diagnostics"]);
  assert.equal(expected.ok, true, JSON.stringify(expected));
  assert.equal(candidate.rootRef, oracle.rootRef);
  assert.equal(candidate.sealRef, oracle.sealRef);
  assert.deepEqual(plain(reconstructed), plain(expected.candidate));
  assert.deepEqual(plain(relation(reader, reconstructed).children.root), ["root-first", "fresh-root", "root-last"]);
  assert.deepEqual(plain(reader.PocketStarlingRootShadow.getContent(reconstructed, "fresh-root")), { nodeId: "fresh-root", payload: { label: "Fresh root", value: 130, flags: ["new"] } });
  assert.equal(candidateObject(candidate, candidate.sealRef).previousSealRef, base.sealRef);
});

test("P130 inserts a fresh nested child at a bounded middle position", async () => {
  const writer = runtime(), input = nodes(24, 8, 8), state = stateFor(writer, input), stager = writer.PocketStarlingObjectSealShadow.createStager(), base = stage(writer, stager, state);
  confirm(writer, stager, base);
  const reader = runtime(), opened = await open(reader, base, stager.store), result = await reader.PocketStarlingLogicalEditShadow.insert(opened.base, {
    nodeId: "fresh-nested", parentId: "parent", toIndex: 12, payload: { label: "Fresh nested", marker: "P130" },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const reconstructed = materialise(reader, stager.store, result.candidate), structural = relation(reader, reconstructed);
  assert.equal(structural.parents["fresh-nested"], "parent");
  assert.deepEqual(plain(structural.children.parent), [...Array.from({ length: 12 }, (_, index) => `p${String(index).padStart(2, "0")}`), "fresh-nested", ...Array.from({ length: 12 }, (_, index) => `p${String(index + 12).padStart(2, "0")}`)]);
  for (const nodeId of ["p11", "p12", "d0004", "u0004"]) assert.deepEqual(plain(reader.PocketStarlingRootShadow.getContent(reconstructed, nodeId)), plain(writer.PocketStarlingRootShadow.getContent(state, nodeId)));
  assert.deepEqual(plain(reader.PocketStarlingRootShadow.getContent(reconstructed, "fresh-nested")), { nodeId: "fresh-nested", payload: { label: "Fresh nested", marker: "P130" } });
});

test("P130 insertion rewrites only the bounded changed frontier", async () => {
  const writer = runtime(), input = nodes(80, 1100, 900), state = stateFor(writer, input), stager = writer.PocketStarlingObjectSealShadow.createStager(), base = stage(writer, stager, state);
  confirm(writer, stager, base);
  const reader = runtime(), opened = await open(reader, base, stager.store), result = await reader.PocketStarlingLogicalEditShadow.insert(opened.base, {
    nodeId: "fresh-large", parentId: "parent", toIndex: 40, payload: { label: "Fresh large", value: 130 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const candidate = result.candidate, parsed = candidate.newLogicalRefs.map((ref) => candidateObject(candidate, ref)), descendantRef = stager.cache.get(writer.PocketStarlingRootShadow.getContent(state, "d0500")).get("content-record"), unrelatedRef = stager.cache.get(writer.PocketStarlingRootShadow.getContent(state, "u0500")).get("content-record"), bound = 15 * ("fresh-large".length + "parent".length + 16);
  assert.equal(parsed.filter((object) => object.kind === "content-record").length, 1);
  assert.equal(parsed.find((object) => object.kind === "content-record").nodeId, "fresh-large");
  assert.equal(candidate.newLogicalRefs.includes(descendantRef), false);
  assert.equal(candidate.newLogicalRefs.includes(unrelatedRef), false);
  assert.ok(candidate.newLogicalRefs.length < bound);
  assert.ok(candidate.diagnostics.logicalFetches < bound);
  assert.ok(candidate.newLogicalRefs.length * 20 < base.newRefs.length);
  for (const ref of candidate.newLogicalRefs) assert.equal(typeof candidate.resolveLogical(ref), "string");
});

test("P132f fresh logical Insert and Reorder retain v2 balance across reopened candidates", async () => {
  const c = runtime(), state = stateFor(c, nodes(48, 8, 12)), stager = c.PocketStarlingObjectSealShadow.createStager();
  let current = stage(c, stager, state), store = new Map(stager.store), expected = Array.from({ length: 48 }, (_, index) => `p${String(index).padStart(2, "0")}`);
  confirm(c, stager, current);
  for (let step = 0; step < 16; step += 1) {
    const opened = await open(c, current, store), from = (step * 7 + 3) % expected.length, requested = (step * 11 + 1) % (expected.length + 1), adjusted = requested > from ? requested - 1 : requested;
    const result = await c.PocketStarlingLogicalEditShadow.reorder(opened.base, expected[from], from, requested);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.changed) { assert.equal(adjusted, from); continue; }
    const candidate = result.candidate, reconstructed = materialise(c, store, candidate);
    expected.splice(adjusted, 0, expected.splice(from, 1)[0]);
    assert.deepEqual(plain(relation(c, reconstructed).children.parent), expected);
    assert.ok(candidate.newLogicalRefs.length < 16 * ("parent".length + 8));
    assert.deepEqual([...reachableCandidateRefs(store, candidate)].sort(), [...candidate.newLogicalRefs].sort());
    for (const ref of candidate.newLogicalRefs) store.set(ref, candidate.resolveLogical(ref));
    current = { sealRef: candidate.sealRef };
  }
  const opened = await open(c, current, store), inserted = await c.PocketStarlingLogicalEditShadow.insert(opened.base, {
    nodeId: "fresh-balanced", parentId: "parent", toIndex: 17, payload: { label: "Fresh balanced" },
  });
  assert.equal(inserted.ok, true, JSON.stringify(inserted));
  const reconstructed = materialise(c, store, inserted.candidate);
  expected.splice(17, 0, "fresh-balanced");
  assert.deepEqual(plain(relation(c, reconstructed).children.parent), expected);
  assert.ok(inserted.candidate.newLogicalRefs.length < 16 * ("parent".length + 8));
});

test("P130 rejects duplicate invalid and unknown-parent insertion without a candidate", async () => {
  const c = runtime(), state = stateFor(c, nodes(4, 2, 2)), stager = c.PocketStarlingObjectSealShadow.createStager(), base = stage(c, stager, state);
  confirm(c, stager, base);
  const opened = await open(c, base, stager.store), api = c.PocketStarlingLogicalEditShadow, input = { nodeId: "fresh", parentId: "parent", toIndex: 1, payload: { label: "Fresh" } }, before = new Map(stager.store);
  expectFailure(await api.insert(opened.base, { ...input, nodeId: "p00" }), "duplicate-node-id");
  for (const nodeId of ["", "root", null]) expectFailure(await api.insert(opened.base, { ...input, nodeId }), "invalid-node-id");
  expectFailure(await api.insert(opened.base, { ...input, parentId: "missing" }), "unknown-parent");
  expectFailure(await api.insert(opened.base, { ...input, payload: { unsupported: Infinity } }), "unsupported-payload-material");
  for (const field of ["acceptedSealRef", "expectedHead", "sealRef", "baseStage", "freshBaseProof", "binding", "candidate", "newLogicalRefs"]) expectFailure(await api.insert(opened.base, { ...input, [field]: "authority-looking" }), "invalid-insert-input");
  assert.deepEqual(stager.store, before);
});

test("P130 preserves accepted base authority across caller mutation and fresh reuse", async () => {
  const writer = runtime(), input = nodes(12, 4, 4), state = stateFor(writer, input), stager = writer.PocketStarlingObjectSealShadow.createStager(), base = stage(writer, stager, state);
  confirm(writer, stager, base);
  const originalSeal = base.sealRef, baseStore = new Map(stager.store), reader = runtime(), callerOwned = { acceptedSealRef: originalSeal, resolveLogical: (ref) => baseStore.get(ref) }, opened = await reader.PocketStarlingLogicalEditShadow.createBase(callerOwned);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  callerOwned.acceptedSealRef = "proof-ref:v1:candidate-seal:00000000";
  callerOwned.resolveLogical = () => undefined;
  const result = await reader.PocketStarlingLogicalEditShadow.insert(opened.base, { nodeId: "fresh-authority", parentId: "parent", toIndex: 3, payload: { label: "Authority survives" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(candidateObject(result.candidate, result.candidate.sealRef).previousSealRef, originalSeal);
  const successor = runtime(), reconstructed = materialise(successor, baseStore, result.candidate), structural = relation(successor, reconstructed);
  assert.equal(structural.parents["fresh-authority"], "parent");
  assert.equal(structural.children.parent[3], "fresh-authority");
  assert.deepEqual(plain(successor.PocketStarlingRootShadow.getContent(reconstructed, "fresh-authority")), { nodeId: "fresh-authority", payload: { label: "Authority survives" } });
});

test("P130 keeps existing payload move and reorder behaviour unchanged", async () => {
  const c = runtime(), api = c.PocketStarlingLogicalEditShadow;
  assert.deepEqual(Object.keys(api), ["createBase", "insert", "editPayload", "move", "reorder", "diagnostics", "semanticTransitionBinding"]);
  assert.equal(Object.isFrozen(api), true);
  for (const method of ["createBase", "editPayload", "move", "reorder", "diagnostics"]) assert.equal(typeof api[method], "function");
});

test("P130 remains genuinely dormant in production", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" });
  assert.equal(source("index.html").includes(MODULE), false);
  assert.equal(manifest.some((entry) => entry.path === "/js/pocket-starling-logical-edit-shadow.js"), false);
  for (const entry of manifest.filter((value) => value.path.endsWith(".js"))) assert.equal(source(`.${entry.path}`).includes("PocketStarlingLogicalEditShadow"), false, entry.path);
});
