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


// Isolated linked-fractal-text shadow proof; it does not install another editor, Undo
// owner, retained history schema, renderer, persistence path or Sync feature.
// "referenceFixture" is deliberately opaque disposable test data, NOT an accepted link schema.
function linkedFractalFixture() {
  const initial = "Check @Blackwoods before processing the invoice.";
  const child = "Child context";
  const textNode = (id, parentId, order, label, text, extra = {}) => ({
    id, parentId, order, label, details: text,
    editor: { schema: "pocket.nodeEditor.v2", text },
    updatedAt: "2026-10-24T00:00:00.000Z",
    ...extra,
  });
  const nodes = [
    textNode("N", "root", 0, "Check invoice", initial, {
      referenceFixture: { occurrenceId: "L", targetId: "T", alias: "@Blackwoods" },
    }),
    textNode("C", "N", 0, "Nested context", child),
    textNode("T", "root", 1, "J & B Blackwood & Sons", "Creditor target"),
    textNode("U", "root", 2, "Unrelated", "Untouched notes"),
  ];
  return {
    nodes,
    relation: {
      nodeIds: ["N", "C", "T", "U"],
      parents: { N: "root", C: "N", T: "root", U: "root" },
      children: { root: ["N", "T", "U"], N: ["C"], C: [], T: [], U: [] },
    },
  };
}

function linkedFractalPayload(c, staged, candidate, id, extraResolver = null) {
  const read = (ref) => candidate.resolveLogical(ref)
    || (extraResolver && extraResolver(ref)) || staged.stager.store.get(ref);
  const audited = c.PocketStarlingObjectSealShadow.auditCandidateSeal(candidate.sealRef, read);
  assert.equal(audited.ok, true, JSON.stringify(audited));
  const record = c.PocketStarlingRootShadow.getContent(audited.candidate, id);
  assert.equal(record?.nodeId, id);
  return plain(record.payload);
}

async function linkedFractalSuccessor(c, current, candidate) {
  const api = c.PocketStarlingLogicalEditShadow;
  const semantic = c.PocketStarlingSemanticAuthorityShadow;
  const issued = await semantic.issueSuccessor({
    authority: current.authority, semanticBaseProof: current.proof, candidate,
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const binding = api.semanticTransitionBinding(candidate, current.authority, current.proof);
  assert.ok(binding);
  const validity = semantic.attestationForStage({
    authority: current.authority, proof: issued.proof, binding,
  });
  assert.ok(validity);
  const admitted = await semantic.authenticate({
    authority: current.authority, semanticValidity: validity, binding,
  });
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  const resolveLogical = (ref) => candidate.resolveLogical(ref) || current.resolveLogical(ref);
  const base = await api.createBase({
    acceptedSealRef: candidate.sealRef, resolveLogical,
    syncedPocketId: current.pocketId, semanticAuthority: current.authority,
    semanticBaseProof: admitted.semanticBaseProof,
  });
  assert.equal(base.ok, true, JSON.stringify(base));
  return {
    pocketId: current.pocketId, authority: current.authority,
    proof: admitted.semanticBaseProof, resolveLogical,
    base: base.base, head: candidate.sealRef,
  };
}

function linkedFractalTextRange(before, after) {
  if (typeof before !== "string" || typeof after !== "string" || before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let left = before.length, right = after.length;
  while (left > start && right > start && before[left - 1] === after[right - 1]) {
    left -= 1; right -= 1;
  }
  const boundary = (value, offset) => offset === value.length
    || Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value))
      .some((segment) => segment.index === offset);
  if (!boundary(before, start) || !boundary(after, start)
      || !boundary(before, left) || !boundary(after, right)) return null;
  return { start, removed: before.slice(start, left), inserted: after.slice(start, right) };
}

// Intentionally pure: only one node's reversible text evidence is accepted.
// The independent child edit may advance global head, but must not invalidate N.
// No whole-tree snapshot and no source editor state is provided to this planner.
function readSealedFractalNode(c, current, sealRef) {
  if (!c || typeof current?.resolveLogical !== "function"
      || typeof sealRef !== "string" || !sealRef) return null;
  try {
    // The seal and its reachable logical objects are independently hash/audit checked.
    const audited = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
      sealRef, current.resolveLogical
    );
    if (!audited.ok) return null;
    const seal = objectAt(current.resolveLogical, sealRef);
    const node = c.PocketStarlingRootShadow.getContent(audited.candidate, "N");
    return node?.nodeId === "N"
      ? { seal, payload: plain(node.payload) } : null;
  } catch (_error) {
    return null;
  }
}

// Test-only semantic equality; keys are made order-independent without losing
// any payload field, including opaque future metadata on the thought itself.
function equalFractalPayload(left, right) {
  if (!left || !right || typeof left !== "object" || typeof right !== "object"
      || Array.isArray(left) || Array.isArray(right)) return false;
  const keys = Object.keys(left).sort();
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(right, key))
    && keys.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

// No Undo action is authorised from the witness alone: sealed history must agree
// on the original AND resulting N payload, and prove the actual causal chain.
// The intervening child revision is permitted but cannot have changed N.
function planLinkedFractalInverse({ c, current, witness, currentN, currentSeal, previousSeal, pocketId }) {
  const fail = (reason) => ({ ok: false, reason });
  if (!Array.isArray(witness) || witness.length !== 1
      || !witness[0] || typeof witness[0] !== "object")
    return fail("missing-or-ambiguous-history");
  const w = witness[0];
  if (w.pocketId !== pocketId || current?.pocketId !== pocketId)
    return fail("incorrect-pocket-authority");
  if (typeof w.transactionId !== "string" || !w.transactionId
      || w.nodeId !== "N" || typeof w.beforeSeal !== "string"
      || typeof w.afterSeal !== "string" || typeof w.appliedSeal !== "string"
      || !w.beforeSeal || !w.afterSeal || w.beforeSeal === w.afterSeal)
    return fail("incomplete-history-identity");
  if (current?.head !== currentSeal || w.afterSeal !== w.appliedSeal
      || currentSeal === w.afterSeal)
    return fail("stale-or-ambiguous-lineage");

  const sealedCurrent = readSealedFractalNode(c, current, currentSeal);
  const sealedAfter = readSealedFractalNode(c, current, w.afterSeal);
  const sealedBefore = readSealedFractalNode(c, current, w.beforeSeal);
  if (!sealedCurrent || !sealedAfter || !sealedBefore)
    return fail("unverified-history-state");
  if (sealedCurrent.seal.previousSealRef !== w.afterSeal
      || previousSeal !== w.afterSeal
      || sealedAfter.seal.previousSealRef !== w.beforeSeal)
    return fail("stale-or-ambiguous-lineage");
  const prior = sealedBefore.payload, after = sealedAfter.payload, now = sealedCurrent.payload;
  if (prior.editor?.schema !== "pocket.nodeEditor.v2"
      || after.editor?.schema !== "pocket.nodeEditor.v2"
      || now.editor?.schema !== "pocket.nodeEditor.v2"
      || typeof prior.editor.text !== "string"
      || typeof after.editor.text !== "string"
      || typeof now.editor.text !== "string")
    return fail("missing-or-unsupported-text-witness");
  if (typeof w.beforeText !== "string" || typeof w.beforeDetails !== "string"
      || typeof w.beforeUpdatedAt !== "string"
      || typeof w.afterText !== "string" || typeof w.afterDetails !== "string"
      || typeof w.afterUpdatedAt !== "string")
    return fail("missing-or-unsupported-text-witness");
  if (w.beforeText !== prior.editor.text || w.beforeDetails !== prior.details
      || w.beforeUpdatedAt !== prior.updatedAt)
    return fail("unauthenticated-before-image");
  if (w.afterText !== after.editor.text || w.afterDetails !== after.details
      || w.afterUpdatedAt !== after.updatedAt)
    return fail("unauthenticated-after-image");
  const expectedAfter = {
    ...prior, details: w.afterDetails,
    editor: { schema: "pocket.nodeEditor.v2", text: w.afterText },
    updatedAt: w.afterUpdatedAt,
  };
  if (!equalFractalPayload(expectedAfter, after))
    return fail("unexplained-forward-mutation");
  if (!equalFractalPayload(now, after) || !equalFractalPayload(currentN, now))
    return fail("conflicting-current-node-or-reference");
  const range = linkedFractalTextRange(w.beforeText, w.afterText);
  if (!range || !w.range || JSON.stringify(w.range) !== JSON.stringify(range))
    return fail("invalid-or-ambiguous-text-anchor");
  if (prior.referenceFixture?.occurrenceId !== "L"
      || prior.referenceFixture?.targetId !== "T"
      || prior.referenceFixture?.alias !== "@Blackwoods"
      || !prior.editor.text.includes("@Blackwoods")
      || !after.editor.text.includes("@Blackwoods")
      || now.editor.text.slice(range.start, range.start + range.inserted.length) !== range.inserted)
    return fail("invalid-or-ambiguous-text-anchor");

  // Undo is a NEW scoped edit, not adoption of the old full document.
  const undoPayload = plain({
    ...now, updatedAt: "2026-10-24T03:00:00.000Z",
    details: prior.details,
    editor: { schema: "pocket.nodeEditor.v2", text: prior.editor.text },
  });
  return { ok: true, operation: { type: "payload", input: { nodeId: "N", payload: undoPayload } } };
}

test("Linked fractal text: scoped parent Undo preserves a newer child edit and two view projections", async () => {
  const c = runtime(), fixture = linkedFractalFixture(), staged = stage(c, fixture);
  const api = c.PocketStarlingLogicalEditShadow;
  const opened = await open(c, staged, "fractal-test-pocket");
  let current = {
    pocketId: opened.syncedPocketId, authority: opened.semanticAuthority,
    proof: opened.semanticBaseProof, resolveLogical: (ref) => staged.stager.store.get(ref),
    base: opened.base, head: staged.stage.sealRef,
  };
  const before = plain(fixture.nodes.find((node) => node.id === "N"));
  const afterText = "Check @Blackwoods before processing the payment.";
  const parentAfter = {
    label: before.label, details: afterText,
    editor: { schema: "pocket.nodeEditor.v2", text: afterText },
    updatedAt: "2026-10-24T01:00:00.000Z",
    referenceFixture: plain(before.referenceFixture),
  };
  const forward = await api.compose(current.base, [{
    type: "payload", input: { nodeId: "N", payload: parentAfter },
  }]);
  assert.equal(forward.ok, true, JSON.stringify(forward));
  assert.deepEqual(linkedFractalPayload(c, staged, forward.candidate, "N"), parentAfter);
  const evidence = [{
    transactionId: "disposable-parent-edit-1", nodeId: "N",
    pocketId: current.pocketId, beforeSeal: current.head,
    afterSeal: forward.candidate.sealRef, appliedSeal: forward.candidate.sealRef,
    beforeText: before.editor.text, afterText,
    beforeDetails: before.details, afterDetails: parentAfter.details,
    beforeUpdatedAt: before.updatedAt, afterUpdatedAt: parentAfter.updatedAt,
    range: linkedFractalTextRange(before.editor.text, afterText),
  }];
  current = await linkedFractalSuccessor(c, current, forward.candidate);
  const childOriginal = plain(fixture.nodes.find((node) => node.id === "C"));
  const childChanged = {
    label: childOriginal.label, details: "Child context revised independently",
    editor: { schema: "pocket.nodeEditor.v2", text: "Child context revised independently" },
    updatedAt: "2026-10-24T02:00:00.000Z",
  };
  const childUpdate = await api.compose(current.base, [{
    type: "payload", input: { nodeId: "C", payload: childChanged },
  }]);
  assert.equal(childUpdate.ok, true, JSON.stringify(childUpdate));
  const chain = current.resolveLogical;
  assert.deepEqual(linkedFractalPayload(c, staged, childUpdate.candidate, "C", chain), childChanged);
  current = await linkedFractalSuccessor(c, current, childUpdate.candidate);
  const parentNow = linkedFractalPayload(c, staged, childUpdate.candidate, "N", chain);
  const previousSeal = objectAt(current.resolveLogical, childUpdate.candidate.sealRef).previousSealRef;
  const plan = planLinkedFractalInverse({
    c, current, witness: evidence, currentN: parentNow,
    currentSeal: childUpdate.candidate.sealRef, previousSeal,
    pocketId: "fractal-test-pocket",
  });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  const undone = await api.compose(current.base, [plan.operation]);
  assert.equal(undone.ok, true, JSON.stringify(undone));
  const finalResolver = (ref) => undone.candidate.resolveLogical(ref) || current.resolveLogical(ref);
  const finalAudit = c.PocketStarlingObjectSealShadow.auditCandidateSeal(undone.candidate.sealRef, finalResolver);
  assert.equal(finalAudit.ok, true, JSON.stringify(finalAudit));
  const final = finalAudit.candidate;
  const relationships = c.PocketStarlingPlacementShadow.materialise(final.structural);
  assert.equal(relationships.ok, true, JSON.stringify(relationships));
  assert.deepEqual(plain(relationships.relation.parents), fixture.relation.parents);
  assert.deepEqual(plain(relationships.relation.children), fixture.relation.children);
  const content = (id) => plain(c.PocketStarlingRootShadow.getContent(final, id).payload);
  assert.equal(content("N").editor.text, before.editor.text);
  assert.equal(content("N").details, before.details);
  assert.equal(content("N").updatedAt, "2026-10-24T03:00:00.000Z");
  assert.deepEqual(content("N").referenceFixture, before.referenceFixture);
  assert.deepEqual(content("C"), childChanged, "newer independent child edit must survive parent Undo");
  for (const id of ["T", "U"]) {
    const original = fixture.nodes.find((node) => node.id === id);
    const { id: ignoredId, parentId: ignoredParent, order: ignoredOrder, ...payload } = original;
    assert.deepEqual(content(id), payload);
  }
  function projection(expanded) {
    return { nodeId: "N", text: content("N").editor.text,
      children: expanded ? plain(relationships.relation.children.N) : undefined };
  }
  assert.deepEqual(projection(false), { nodeId: "N", text: before.editor.text, children: undefined });
  assert.deepEqual(projection(true), { nodeId: "N", text: before.editor.text, children: ["C"] });
  assert.equal(objectAt(finalResolver, undone.candidate.sealRef).previousSealRef, childUpdate.candidate.sealRef);
  assert.equal(objectAt(current.resolveLogical, childUpdate.candidate.sealRef).previousSealRef, forward.candidate.sealRef);
});

test("Linked fractal text shadow rejects forged preimages and unauthenticated lineage", async () => {
  // Actual sealed, authenticated two-step logical history; never fake "s0/s1/s2".
  const c = runtime(), fixture = linkedFractalFixture(), staged = stage(c, fixture);
  const api = c.PocketStarlingLogicalEditShadow;
  const opened = await open(c, staged, "fractal-test-pocket-negative");
  let current = {
    pocketId: opened.syncedPocketId, authority: opened.semanticAuthority,
    proof: opened.semanticBaseProof, resolveLogical: (ref) => staged.stager.store.get(ref),
    base: opened.base, head: staged.stage.sealRef,
  };
  const before = plain(fixture.nodes.find((node) => node.id === "N"));
  const nextText = "Check @Blackwoods before processing the payment.";
  const parentAfter = {
    label: before.label, details: nextText,
    editor: { schema: "pocket.nodeEditor.v2", text: nextText },
    updatedAt: "2026-10-24T01:00:00.000Z",
    referenceFixture: plain(before.referenceFixture),
  };
  const originalSeal = current.head;
  const forward = await api.compose(current.base, [{
    type: "payload", input: { nodeId: "N", payload: parentAfter },
  }]);
  assert.equal(forward.ok, true);
  current = await linkedFractalSuccessor(c, current, forward.candidate);
  const child = plain(fixture.nodes.find((node) => node.id === "C"));
  const childAfter = {
    label: child.label, details: "A changed child, without changing N",
    editor: { schema: "pocket.nodeEditor.v2", text: "A changed child, without changing N" },
    updatedAt: "2026-10-24T02:00:00.000Z",
  };
  const childEdit = await api.compose(current.base, [{
    type: "payload", input: { nodeId: "C", payload: childAfter },
  }]);
  assert.equal(childEdit.ok, true);
  const parentNow = linkedFractalPayload(c, staged, childEdit.candidate, "N", current.resolveLogical);
  current = await linkedFractalSuccessor(c, current, childEdit.candidate);
  const witness = {
    transactionId: "fixture-parent-edit", nodeId: "N", pocketId: current.pocketId,
    beforeSeal: originalSeal,
    afterSeal: forward.candidate.sealRef, appliedSeal: forward.candidate.sealRef,
    beforeText: before.editor.text, beforeDetails: before.details,
    beforeUpdatedAt: before.updatedAt,
    afterText: nextText, afterDetails: nextText, afterUpdatedAt: parentAfter.updatedAt,
    range: linkedFractalTextRange(before.editor.text, nextText),
  };
  const defaults = {
    c, current, witness: [witness], currentN: parentNow,
    currentSeal: childEdit.candidate.sealRef,
    previousSeal: forward.candidate.sealRef, pocketId: current.pocketId,
  };
  assert.equal(planLinkedFractalInverse(defaults).ok, true);

  const counterfeit = "Check @Blackwoods before processing the wages.";
  const caseInputs = [
    ["missing-or-ambiguous-history", { witness: [] }],
    ["missing-or-ambiguous-history", { witness: [witness, witness] }],
    ["incorrect-pocket-authority", { pocketId: "a-different-pocket" }],
    ["stale-or-ambiguous-lineage", { previousSeal: originalSeal }],
    ["stale-or-ambiguous-lineage", { currentSeal: originalSeal }],
    ["incomplete-history-identity", { witness: [{ ...witness, transactionId: "" }] }],
    ["unauthenticated-before-image", { witness: [{
      ...witness, beforeText: counterfeit,
      beforeDetails: counterfeit,
      range: linkedFractalTextRange(counterfeit, nextText),
    }] }],
    ["unauthenticated-before-image", { witness: [{
      ...witness, beforeDetails: "Forged original details",
    }] }],
    ["unauthenticated-before-image", { witness: [{
      ...witness, beforeUpdatedAt: "2026-10-23T23:59:00.000Z",
    }] }],
    ["unauthenticated-after-image", { witness: [{
      ...witness, afterText: nextText + " false",
      range: linkedFractalTextRange(before.editor.text, nextText + " false"),
    }] }],
    ["unauthenticated-after-image", { witness: [{
      ...witness, afterDetails: "False after details",
    }] }],
    ["stale-or-ambiguous-lineage", { witness: [{
      ...witness, beforeSeal: childEdit.candidate.sealRef,
    }] }],
    ["stale-or-ambiguous-lineage", { witness: [{
      ...witness, afterSeal: childEdit.candidate.sealRef,
      appliedSeal: childEdit.candidate.sealRef,
    }] }],
    ["conflicting-current-node-or-reference", { currentN: {
      ...parentNow, editor: { ...parentNow.editor, text: nextText + " another edit" },
    } }],
    ["conflicting-current-node-or-reference", { currentN: {
      ...parentNow, updatedAt: "2026-10-24T04:00:00.000Z",
    } }],
    ["conflicting-current-node-or-reference", { currentN: {
      ...parentNow, referenceFixture: { ...parentNow.referenceFixture, targetId: "wrong" },
    } }],
    ["invalid-or-ambiguous-text-anchor", { witness: [{
      ...witness, range: { ...witness.range, start: witness.range.start + 1 },
    }] }],
    ["missing-or-unsupported-text-witness", { witness: [{
      ...witness, beforeText: null,
    }] }],
    ["unverified-history-state", { witness: [{
      ...witness, beforeSeal: "missing-content-addressed-seal",
    }] }],
  ];
  for (const [reason, altered] of caseInputs) {
    const args = { ...defaults, ...altered };
    const beforeArgs = JSON.stringify({
      currentN: args.currentN, witness: args.witness, pocketId: args.pocketId,
      head: args.current.head, currentSeal: args.currentSeal,
      previousSeal: args.previousSeal,
    });
    const refused = planLinkedFractalInverse(args);
    assert.deepEqual(refused, { ok: false, reason }, reason);
    assert.equal(Object.prototype.hasOwnProperty.call(refused, "operation"), false);
    assert.equal(JSON.stringify({
      currentN: args.currentN, witness: args.witness, pocketId: args.pocketId,
      head: args.current.head, currentSeal: args.currentSeal,
      previousSeal: args.previousSeal,
    }), beforeArgs, reason + ": refusal must not mutate inputs");
    assert.deepEqual(linkedFractalPayload(
      c, staged, childEdit.candidate, "C", current.resolveLogical
    ), childAfter, "refusal must not change the independently edited child");
  }
  assert.equal(linkedFractalTextRange("X😀Y", "X😇Y"), null);
});
