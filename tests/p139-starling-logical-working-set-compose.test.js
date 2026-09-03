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

test("P139 composes an isolated bounded working set through one final candidate", async () => {
  const c = runtime(), staged = stage(c, graph(2000)), api = c.PocketStarlingLogicalEditShadow, baseRoot = staged.stage.rootObject, baseRead = (ref) => staged.stager.store.get(ref), deep = { content: trieValue(baseRead, baseRoot.contentRef, "desc-1000"), placement: trieValue(baseRead, baseRoot.placementRef, "desc-1000"), children: trieValue(baseRead, baseRoot.childrenRef, "desc-1000") }, unrelated = { content: trieValue(baseRead, baseRoot.contentRef, "unrelated"), placement: trieValue(baseRead, baseRoot.placementRef, "unrelated"), children: trieValue(baseRead, baseRoot.childrenRef, "unrelated") }, guarded = new Set(Object.values(deep)), measurement = { active: false }, opened = await open(c, staged, "p139", (ref) => { if (measurement.active && guarded.has(ref)) throw new Error(`deep descendant read: ${ref}`); return baseRead(ref); }), intermediate = await api.editPayload(opened.base, "first", { label: "First edited" }), before = api.diagnostics(opened.base), operations = [
    { type: "payload", input: { nodeId: "first", payload: { label: "First edited" } } }, { type: "move", input: { nodeId: "branch", fromIndex: 1, newParentId: "destination", toIndex: 1 } }, { type: "insert", input: { nodeId: "P", parentId: "root", toIndex: 1, payload: { label: "Parent" } } }, { type: "insert", input: { nodeId: "C", parentId: "P", toIndex: 0, payload: { label: "Child" } } }, { type: "payload", input: { nodeId: "C", payload: { label: "Child edited" } } }, { type: "move", input: { nodeId: "C", fromIndex: 0, newParentId: "destination", toIndex: 2 } }, { type: "reorder", input: { nodeId: "C", fromIndex: 2, toIndex: 1 } }, { type: "delete", input: { nodeId: "C", fromIndex: 1 } }, { type: "restore", input: { nodeId: "C", fromIndex: 1, newParentId: "P", toIndex: 0 } }, { type: "reorder", input: { nodeId: "P", fromIndex: 1, toIndex: 0 } },
  ];
  assert.equal(intermediate.ok, true, JSON.stringify(intermediate)); measurement.active = true; const pending = api.compose(opened.base, operations); operations[0].input.payload.label = "caller mutation"; operations[2].input.nodeId = "redirected"; operations.push({ type: "insert", input: { nodeId: "never", parentId: "root", toIndex: 0, payload: {} } }); const result = await pending; measurement.active = false;
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.changed, true); assert.deepEqual([...Object.keys(result)].sort(), ["candidate", "changed", "ok"]); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.candidate), true); assert.deepEqual([...Object.keys(result.candidate)].sort(), ["diagnostics", "newLogicalRefs", "resolveLogical", "rootRef", "sealRef"]); assert.equal(Object.isFrozen(result.candidate.newLogicalRefs), true); assert.equal(objectAt(result.candidate.resolveLogical, result.candidate.sealRef).previousSealRef, staged.stage.sealRef); assert.equal(result.candidate.resolveLogical(intermediate.candidate.rootRef), undefined); assert.equal(result.candidate.newLogicalRefs.includes(intermediate.candidate.rootRef), false);
  const fetchDelta = result.candidate.diagnostics.logicalFetches - before.logicalFetches; assert.ok(fetchDelta < 400, `compose logical fetches ${fetchDelta}`); assert.ok(result.candidate.newLogicalRefs.length < 400, `compose frontier ${result.candidate.newLogicalRefs.length}`); for (const ref of result.candidate.newLogicalRefs) assert.equal(typeof result.candidate.resolveLogical(ref), "string", ref); assert.deepEqual([...reachableOwned(staged, result.candidate)].sort(), [...result.candidate.newLogicalRefs].sort());
  const candidate = audit(c, staged, result.candidate), relation = c.PocketStarlingPlacementShadow.materialise(candidate.structural), finalRoot = objectAt(resolve(staged, result.candidate), result.candidate.rootRef);
  assert.equal(relation.ok, true, JSON.stringify(relation)); assert.deepEqual(plain(relation.relation.children.root), ["P", "source", "destination", "unrelated"]); assert.deepEqual(plain(relation.relation.children.source), ["first", "last"]); assert.deepEqual(plain(relation.relation.children.destination), ["destination-child", "branch"]); assert.deepEqual(plain(relation.relation.children[""]), ["retained-old"]); assert.deepEqual(plain(relation.relation.children.P), ["C"]); assert.equal(relation.relation.parents.branch, "destination"); assert.equal(relation.relation.parents.C, "P"); assert.equal(relation.relation.parents["retained-old"], ""); assert.equal(relation.relation.parents["retained-old-child"], "retained-old");
  assert.deepEqual(plain(c.PocketStarlingRootShadow.getContent(candidate, "first")), { nodeId: "first", payload: { label: "First edited" } }); assert.deepEqual(plain(c.PocketStarlingRootShadow.getContent(candidate, "C")), { nodeId: "C", payload: { label: "Child edited" } }); assert.equal(finalRoot.preservationRef, baseRoot.preservationRef); for (const [kind, ref] of Object.entries(unrelated)) assert.equal(trieValue(resolve(staged, result.candidate), finalRoot[`${kind}Ref`], "unrelated"), ref, kind); for (const [kind, ref] of Object.entries(deep)) { assert.equal(trieValue(resolve(staged, result.candidate), finalRoot[`${kind}Ref`], "desc-1000"), ref, kind); assert.equal(result.candidate.newLogicalRefs.includes(ref), false, kind); }
  const admitted = await successorBase(c, staged, opened, result.candidate); assert.ok(api.semanticTransitionBinding(result.candidate, opened.semanticAuthority, opened.semanticBaseProof)); assert.equal((await c.PocketStarlingSemanticAuthorityShadow.issueSuccessor({ authority: opened.semanticAuthority, semanticBaseProof: opened.semanticBaseProof, candidate: { ...result.candidate } })).ok, false); assert.equal((await api.editPayload(admitted.next.base, "unrelated", { label: "Successor current" })).ok, true);
});

test("P139 preserves direct primitive results for a single operation", async () => {
  const c = runtime(), staged = stage(c, graph()), api = c.PocketStarlingLogicalEditShadow, cases = [
    ["payload", { nodeId: "first", payload: { label: "changed" } }, (base, input) => api.editPayload(base, input.nodeId, input.payload)],
    ["move", { nodeId: "branch", fromIndex: 1, newParentId: "destination", toIndex: 1 }, (base, input) => api.move(base, input.nodeId, input.fromIndex, input.newParentId, input.toIndex)],
    ["reorder", { nodeId: "last", fromIndex: 2, toIndex: 0 }, (base, input) => api.reorder(base, input.nodeId, input.fromIndex, input.toIndex)],
    ["delete", { nodeId: "branch", fromIndex: 1 }, (base, input) => api.deleteBranch(base, input.nodeId, input.fromIndex)],
    ["restore", { nodeId: "retained-old", fromIndex: 0, newParentId: "destination", toIndex: 1 }, (base, input) => api.restoreBranch(base, input.nodeId, input.fromIndex, input.newParentId, input.toIndex)],
    ["insert", { nodeId: "fresh", parentId: "root", toIndex: 1, payload: { label: "Fresh" } }, (base, input) => api.insert(base, input)],
  ];
  for (const [type, input, directCall] of cases) {
    const directOpened = await open(c, staged, `p139-direct-${type}`), composedOpened = await open(c, staged, `p139-compose-${type}`), direct = await directCall(directOpened.base, input), composed = await api.compose(composedOpened.base, [{ type, input }]);
    assert.equal(direct.ok, true, `${type}: ${JSON.stringify(direct)}`); assert.equal(composed.ok, true, `${type}: ${JSON.stringify(composed)}`); assert.equal(composed.changed, direct.changed !== false, type);
    if (direct.changed !== false) { assert.equal(composed.candidate.rootRef, direct.candidate.rootRef, type); assert.equal(composed.candidate.sealRef, direct.candidate.sealRef, type); assert.deepEqual([...composed.candidate.newLogicalRefs].sort(), [...direct.candidate.newLogicalRefs].sort(), type); }
  }
});

test("P139 keeps no-change and exact lower-layer failure parity", async () => {
  const c = runtime(), staged = stage(c, graph()), api = c.PocketStarlingLogicalEditShadow, failures = [
    ["payload", { nodeId: "missing", payload: {} }, (base, input) => api.editPayload(base, input.nodeId, input.payload)],
    ["move", { nodeId: "missing", fromIndex: 0, newParentId: "root", toIndex: 0 }, (base, input) => api.move(base, input.nodeId, input.fromIndex, input.newParentId, input.toIndex)],
    ["reorder", { nodeId: "missing", fromIndex: 0, toIndex: 0 }, (base, input) => api.reorder(base, input.nodeId, input.fromIndex, input.toIndex)],
    ["delete", { nodeId: "missing", fromIndex: 0 }, (base, input) => api.deleteBranch(base, input.nodeId, input.fromIndex)],
    ["restore", { nodeId: "first", fromIndex: 0, newParentId: "root", toIndex: 0 }, (base, input) => api.restoreBranch(base, input.nodeId, input.fromIndex, input.newParentId, input.toIndex)],
    ["insert", { nodeId: "first", parentId: "root", toIndex: 0, payload: {} }, (base, input) => api.insert(base, input)],
  ];
  for (const [type, input, directCall] of failures) {
    const directOpened = await open(c, staged, `p139-failure-direct-${type}`), composedOpened = await open(c, staged, `p139-failure-compose-${type}`), direct = await directCall(directOpened.base, input), composed = await api.compose(composedOpened.base, [{ type, input }]);
    assert.equal(direct.ok, false, `${type}: ${JSON.stringify(direct)}`); expectFailure(composed, direct.reason, 0);
  }
  for (const [type, input, directCall] of [["payload", { nodeId: "first", payload: { label: "First" } }, (base, value) => api.editPayload(base, value.nodeId, value.payload)], ["reorder", { nodeId: "first", fromIndex: 0, toIndex: 0 }, (base, value) => api.reorder(base, value.nodeId, value.fromIndex, value.toIndex)]]) {
    const directOpened = await open(c, staged, `p139-no-change-direct-${type}`), composedOpened = await open(c, staged, `p139-no-change-compose-${type}`), direct = await directCall(directOpened.base, input), composed = await api.compose(composedOpened.base, [{ type, input }]);
    assert.deepEqual(plain(composed), plain(direct), type); assert.equal(Object.isFrozen(composed), true);
  }
});

test("P139 snapshots unsupported and ordinary nested later payloads before the first await", async () => {
  const c = runtime(), staged = stage(c, graph()), opened = await open(c, staged), api = c.PocketStarlingLogicalEditShadow, cyclic = { label: "before" }; cyclic.self = cyclic;
  const rejected = api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: { label: "earlier" } } }, { type: "payload", input: { nodeId: "last", payload: cyclic } }]);
  cyclic.self = null; cyclic.label = "caller redirected"; expectFailure(await rejected, "unsupported-payload-material", 1);
  const nonPlain = Object.create({ inherited: true }); nonPlain.label = "before"; const rejectedNonPlain = api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: { label: "earlier" } } }, { type: "payload", input: { nodeId: "last", payload: nonPlain } }]);
  Object.setPrototypeOf(nonPlain, Object.prototype); nonPlain.label = "caller redirected"; expectFailure(await rejectedNonPlain, "unsupported-payload-material", 1);
  const nested = { items: [{ label: "before" }] }, changed = api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: { label: "earlier" } } }, { type: "insert", input: { nodeId: "later", parentId: "root", toIndex: 0, payload: nested } }]);
  nested.items[0].label = "caller redirected"; nested.items.push({ label: "new" }); const result = await changed;
  assert.equal(result.ok, true, JSON.stringify(result)); const candidate = audit(c, staged, result.candidate); assert.deepEqual(plain(c.PocketStarlingRootShadow.getContent(candidate, "later")), { nodeId: "later", payload: { items: [{ label: "before" }] } });
});

test("P139 rejects invalid compose grammar and stops on the exact lower-layer failure", async () => {
  const c = runtime(), staged = stage(c, graph()), opened = await open(c, staged), api = c.PocketStarlingLogicalEditShadow;
  expectFailure(await api.compose({}, []), "invalid-base-token");
  for (const operations of [null, {}, [{ type: "missing", input: {} }], [{ type: "payload", input: { nodeId: "first" } }], [{ type: "payload", input: { nodeId: "first", payload: {} }, candidate: {} }]]) expectFailure(await api.compose(opened.base, operations), "invalid-compose-input");
  for (const injected of ["candidate", "stage", "binding", "sealRef", "head", "proof", "baseAuthority"]) expectFailure(await api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: {}, [injected]: "injected" } }]), "invalid-compose-input");
  const noChange = await api.compose(opened.base, []); assert.deepEqual(plain(noChange), { ok: true, changed: false, reason: "no-change" }); assert.equal(Object.isFrozen(noChange), true);
  const semanticNoChange = await api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: { label: "First" } } }, { type: "reorder", input: { nodeId: "first", fromIndex: 0, toIndex: 0 } }]); assert.deepEqual(plain(semanticNoChange), { ok: true, changed: false, reason: "no-change" });
  expectFailure(await api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: { unsupported: Infinity } } }]), "unsupported-payload-material", 0);
  const failed = await api.compose(opened.base, [
    { type: "payload", input: { nodeId: "first", payload: { label: "earlier" } } },
    { type: "delete", input: { nodeId: "retained-old", fromIndex: 0 } },
    { type: "insert", input: { nodeId: "later", parentId: "root", toIndex: 0, payload: { label: "must not run" } } },
  ]);
  expectFailure(failed, "retained-node-not-current", 1); assert.equal((await api.editPayload(opened.base, "later", { label: "not present" })).reason, "unknown-node"); assert.deepEqual(plain(await api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: { label: "First" } } }])), { ok: true, changed: false, reason: "no-change" }); assert.equal((await api.compose(opened.base, [{ type: "payload", input: { nodeId: "first", payload: { label: "reusable" } } }])).ok, true);
});

test("P139 is production-bounded beneath the P164 successor composer", () => {
  const manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" }), paths = manifest.map((entry) => entry.path); assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes(MODULE), false); assert.equal(paths.includes(`/${MODULE}`), true); assert.equal(paths.includes("/js/pocket-starling-remote-save-shadow.js"), false);
});
