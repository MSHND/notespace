"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"), { semanticBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js", IMPORT = "js/pocket-import.js";
const LOGICAL_SCRIPTS = ["js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", IMPORT, "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js", "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-semantic-authority-shadow.js"];

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) { return { id, parentId, order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", ...extra }; }

function runtime(nodes = [node("existing")]) {
  class HTMLElement { focus() {} select() {} }
  class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  let nextId = 0;
  const storage = new Map(), statuses = [], context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: { nodes: plain(nodes), tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "", focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p157.json", writtenAt: "" } },
    lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "", el: { search: new HTMLInputElement() },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } }, DEVICE_CHANGE_SEQUENCE_KEY: "p157.sequence",
    nowIso() { return "2026-09-02T01:00:00.000Z"; }, cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); }, makeId() { nextId += 1; return `node-${nextId}`; },
    compareSiblingOrder(left, right) { return (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.label || "").localeCompare(String(right.label || "")); },
    maxSiblingOrder(parentId) { return Math.max(1000, ...context.state.nodes.filter((entry) => (entry.parentId || "root") === (parentId || "root")).map((entry) => Number(entry.order) || 0)); },
    getPath(nodeId) { return String(nodeId || ""); },
    isManagedSystemBucketNode() { return false; }, isCompletedSystemBucketNode() { return false; }, requirePocketFileForChanges() { return true; }, clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, expandPathToNode() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {}, focusRowByNodeId() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(callback) { callback?.(); return 1; }, flashTouchedRow() {}, setStatus(...args) { statuses.push(plain(args)); }, saveLastSaveSnapshot() {}, saveLocalSafetySnapshot() { return true; },
    PocketDeviceChanges: { cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } }, coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; }, describeDocumentTransition() { return { ok: true, records: [] }; } },
    __statuses: statuses,
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS, IMPORT]) vm.runInContext(source(file), context, { filename: file });
  context.refreshSaveState = context.refreshMeta = context.renderTree = context.persistPipSnapshot = context.refocusTreeNavigation = context.focusRowByNodeId = context.softlyEnsureSelectionVisible = () => {};
  return context;
}

function captured(context, sequence = 99) { const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence); return frozen ? plain(frozen.operations) : null; }
function addPathOperations(context) { return context.state.ops.filter((operation) => operation.type === "add_path"); }
function semanticFor(context, operation) { return captured(context, operation.seq); }

function logicalRuntime() {
  const context = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error, btoa(value) { return Buffer.from(value, "binary").toString("base64"); }, atob(value) { return Buffer.from(value, "base64").toString("binary"); }, console: { log() {}, info() {}, warn() {}, error() {} }, localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of LOGICAL_SCRIPTS) vm.runInContext(source(file), context, { filename: file });
  return context;
}

async function composeCapturedThroughP139(nodes, operations) {
  const context = logicalRuntime(), byId = new Map(nodes.map((entry) => [entry.id, entry])), children = {};
  for (const entry of nodes) children[entry.id] = [];
  for (const entry of nodes) { const parentId = entry.parentId || "root"; if (!children[parentId]) children[parentId] = []; children[parentId].push(entry.id); }
  for (const ids of Object.values(children)) ids.sort((left, right) => (Number(byId.get(left)?.order) || 0) - (Number(byId.get(right)?.order) || 0));
  const relation = { nodeIds: nodes.map((entry) => entry.id), parents: Object.fromEntries(nodes.map((entry) => [entry.id, entry.parentId || "root"])), children }, encoded = context.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-02T00:00:00.000Z", nodes, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), root = context.PocketStarlingRootShadow.build(encoded.bridge), structural = context.PocketStarlingPlacementShadow.build(relation, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded)); assert.equal(root.ok, true, JSON.stringify(root)); assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = context.PocketStarlingRootShadow.diagnosticRootFor({ capacity: root.state.capacity, content: root.state.content, placements: structural.model.placements, children: structural.model.children, preservation: root.state.preservation }), stager = context.PocketStarlingObjectSealShadow.createStager();
  assert.equal(witness.ok, true, JSON.stringify(witness));
  const staged = context.PocketStarlingObjectSealShadow.stageCandidate(stager, { schema: context.PocketStarlingRootShadow.SCHEMA, capacity: root.state.capacity, content: root.state.content, structural: structural.model, preservation: root.state.preservation, root: witness.root }, { previousSealRef: null });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const resolveLogical = (ref) => stager.store.get(ref), semantic = await semanticBase(context, { acceptedSealRef: staged.stage.sealRef, resolveLogical, syncedPocketId: "p157" }), opened = await context.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: staged.stage.sealRef, resolveLogical, ...semantic });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const composed = await context.PocketStarlingLogicalEditShadow.compose(opened.base, operations);
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const resolve = (ref) => composed.candidate.resolveLogical(ref) || resolveLogical(ref), audited = context.PocketStarlingObjectSealShadow.auditCandidateSeal(composed.candidate.sealRef, resolve), materialised = context.PocketStarlingPlacementShadow.materialise(audited.candidate.structural);
  assert.equal(audited.ok, true, JSON.stringify(audited)); assert.equal(materialised.ok, true, JSON.stringify(materialised));
  return { context, candidate: audited.candidate, relation: plain(materialised.relation) };
}

test("P157 captures each genuinely new shared path component under its existing add_path sequence at the current sibling index", () => {
  const context = runtime([node("first", "root", 7), node("later", "root", 31)]), child = context.ensurePathNodeUnder("root", ["New"]), add = addPathOperations(context)[0];
  assert.ok(child); assert.equal(add.id, child.id); assert.equal(add.parentId, "root"); assert.deepEqual(semanticFor(context, add), [{ type: "insert", input: { nodeId: child.id, parentId: "root", toIndex: 2, payload: { label: "New", source: "manual", updatedAt: "2026-09-02T01:00:00.000Z" } } }]);
  assert.equal(child.order, 1001); assert.notEqual(semanticFor(context, add)[0].input.toIndex, child.order);
});

test("P157 captures a multi-component path parent before child and composes the exact hierarchy through P139", async () => {
  const before = [node("unrelated", "root", 9, { details: "kept" })], context = runtime(before), leaf = context.ensurePathNode(["A", "B", "C"]), adds = addPathOperations(context), operations = captured(context, adds.at(-1).seq);
  assert.equal(adds.length, 3); assert.deepEqual(operations.map((entry) => entry.type), ["insert", "insert", "insert"]);
  assert.deepEqual(operations.map((entry) => [entry.input.parentId, entry.input.toIndex]), [["root", 1], [adds[0].id, 0], [adds[1].id, 0]]);
  assert.equal(operations[0].input.nodeId, adds[0].id); assert.equal(operations[1].input.nodeId, adds[1].id); assert.equal(operations[2].input.nodeId, leaf.id);
  const composed = await composeCapturedThroughP139(before, operations);
  assert.deepEqual(composed.relation.children.root, ["unrelated", adds[0].id]); assert.deepEqual(composed.relation.children[adds[0].id], [adds[1].id]); assert.deepEqual(composed.relation.children[adds[1].id], [leaf.id]); assert.equal(composed.relation.parents.unrelated, "root");
  assert.deepEqual(plain(composed.context.PocketStarlingRootShadow.getContent(composed.candidate, leaf.id)), { nodeId: leaf.id, payload: { label: "C", source: "manual", updatedAt: "2026-09-02T01:00:00.000Z" } });
});

test("P157 leaves existing path components silent while capturing only a missing suffix or no-op existing path", () => {
  const context = runtime([node("A", "root", 10), node("B", "A", 20)]), leaf = context.ensurePathNode(["A", "B", "C", "D"]), adds = addPathOperations(context), operations = captured(context, adds.at(-1).seq);
  assert.equal(adds.length, 2); assert.deepEqual(operations.map((entry) => entry.input.payload.label), ["C", "D"]); assert.deepEqual(operations.map((entry) => entry.input.parentId), ["B", adds[0].id]); assert.equal(leaf.id, adds[1].id);
  const beforeOps = context.state.ops.length, beforeNodes = context.state.nodes.length;
  assert.equal(context.ensurePathNode(["A", "B", "C", "D"]).id, leaf.id); assert.equal(context.state.ops.length, beforeOps); assert.equal(context.state.nodes.length, beforeNodes); assert.deepEqual(captured(context, 99), operations);
});

test("P157 covers the real slash-path commit route without duplicate manual Insert, Delete, or Restore semantics", () => {
  const context = runtime([node("existing", "root", 10)]);
  context.insertSiblingBelow("existing");
  const provisionalId = context.state.inlineEdit.id, result = context.commitInlineEdit(provisionalId, "/A/B\n/A/C"), adds = addPathOperations(context), aggregate = context.state.ops.find((entry) => entry.type === "import_paths_inline"), operations = captured(context, aggregate.seq);
  assert.equal(result.kind, "path-import"); assert.equal(context.state.nodes.some((entry) => entry.id === provisionalId), false); assert.equal(adds.length, 3); assert.equal(aggregate.created, 3);
  assert.deepEqual(operations.map((entry) => entry.type), ["insert", "insert", "insert"]); assert.deepEqual(operations.map((entry) => entry.input.payload.label), ["A", "B", "C"]); assert.equal(captured(context, aggregate.seq).some((entry) => ["delete", "restore"].includes(entry.type)), false); assert.equal(captured(context, aggregate.seq).filter((entry) => entry.input?.nodeId === provisionalId).length, 0);
});

test("P157 covers the real path-import commit route while keeping its aggregate bookkeeping semantically silent", () => {
  const context = runtime([node("existing", "root", 10)]), count = context.commitPathImport({ entries: [{ effectiveParts: ["A", "B"] }, { effectiveParts: ["A", "C"] }], pathCount: 2, anchorHeadId: "", autoAnchorHeadLabel: "" }), adds = addPathOperations(context), aggregate = context.state.ops.at(-1);
  assert.equal(count, 2); assert.equal(adds.length, 3); assert.equal(aggregate.type, "import_paths");
  assert.deepEqual(captured(context, aggregate.seq), [
    { type: "insert", input: { nodeId: adds[0].id, parentId: "root", toIndex: 1, payload: { label: "A", source: "manual", updatedAt: "2026-09-02T01:00:00.000Z" } } },
    { type: "insert", input: { nodeId: adds[1].id, parentId: adds[0].id, toIndex: 0, payload: { label: "B", source: "manual", updatedAt: "2026-09-02T01:00:00.000Z" } } },
    { type: "insert", input: { nodeId: adds[2].id, parentId: adds[0].id, toIndex: 1, payload: { label: "C", source: "manual", updatedAt: "2026-09-02T01:00:00.000Z" } } },
  ]);
  assert.equal(captured(context, aggregate.seq).length, adds.length);
});

test("P157 leaves path creation and existing add_path bookkeeping intact when capture is unavailable", () => {
  const context = runtime();
  context.PocketStarlingOwnerWorkingSetShadow = undefined;
  assert.equal(context.resetPocketStarlingOwnerWorkingSetJournal(), false);
  const leaf = context.ensurePathNode(["A", "B"]), adds = addPathOperations(context);
  assert.ok(leaf); assert.equal(adds.length, 2); assert.equal(context.state.nodes.length, 3); assert.equal(context.freezePocketStarlingOwnerWorkingSetThrough(adds.at(-1).seq), null); assert.deepEqual(context.state.ops.map((entry) => entry.type), ["add_path", "add_path"]);
});

test("P157 production boundary remains import-only and does not add owner authority", () => {
  const importSource = source(IMPORT);
  assert.match(importSource, /function ensurePathNodeUnder\(rootParentId, labels\)/); assert.match(importSource, /capturePocketStarlingNodeInsert\(addPathOperation\?\.seq, child, parentId, toIndex\)/); assert.doesNotMatch(importSource, /LogicalEdit|RemoteEdit|RemoteSave|PocketOwnerSaveBoundary|compareAndSetShadowHead/);
});
