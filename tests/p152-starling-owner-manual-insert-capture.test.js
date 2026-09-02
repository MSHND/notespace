"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"), { semanticBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js";
const LOGICAL_SCRIPTS = ["js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js", "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-semantic-authority-shadow.js"];

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) { return { id, parentId, order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", ...extra }; }

function runtime(nodes = [node("a")]) {
  class HTMLElement { focus() {} select() {} }
  class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  const storage = new Map(); let nextId = 0;
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: { nodes: plain(nodes), tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "", focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p152.json", writtenAt: "" } },
    lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "", el: { search: new HTMLInputElement() },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } }, DEVICE_CHANGE_SEQUENCE_KEY: "p152.sequence",
    nowIso() { return "2026-09-02T01:00:00.000Z"; }, cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); }, makeId() { nextId += 1; return `new-${nextId}`; },
    compareSiblingOrder(left, right) { return (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.label || "").localeCompare(String(right.label || "")); },
    nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); }, childrenMap() { const result = new Map(); for (const entry of context.state.nodes) { const parent = entry.parentId || "root"; if (!result.has(parent)) result.set(parent, []); result.get(parent).push(entry); } for (const entries of result.values()) entries.sort(context.compareSiblingOrder); return result; }, maxSiblingOrder(parentId) { return Math.max(1000, ...context.state.nodes.filter((entry) => (entry.parentId || "root") === (parentId || "root")).map((entry) => Number(entry.order) || 0)); },
    isManagedSystemBucketNode() { return false; }, isCompletedSystemBucketNode() { return false; }, requirePocketFileForChanges() { return true; }, clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, expandPathToNode() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {}, focusRowByNodeId() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(callback) { callback?.(); return 1; }, flashTouchedRow() {}, setStatus() {}, saveLastSaveSnapshot() {}, saveLocalSafetySnapshot() { return true; },
    parseCaptureSlashPathBatch() { return { matched: false, ok: true }; }, findChildByLabel() { return null; }, ensurePathNode() { return null; },
    PocketDeviceChanges: { cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } }, coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; }, describeDocumentTransition() { return { ok: true, records: [] }; } },
    __storage: storage,
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS]) vm.runInContext(source(file), context, { filename: file });
  context.refreshSaveState = () => {}; context.refreshMeta = () => {}; context.renderTree = () => {}; context.persistPipSnapshot = () => {}; context.refocusTreeNavigation = () => {}; context.focusRowByNodeId = () => {}; context.softlyEnsureSelectionVisible = () => {}; context.setStatus = () => {};
  return context;
}

function siblingIds(context, parentId = "root") { return context.sortNodesForParent(parentId).map((entry) => entry.id); }
function captured(context, sequence) { const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence); return frozen ? plain(frozen.operations) : null; }
function operation(context, id) { return context.state.ops.find((entry) => entry.id === id); }

function logicalRuntime() {
  const context = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error, btoa(value) { return Buffer.from(value, "binary").toString("base64"); }, atob(value) { return Buffer.from(value, "base64").toString("binary"); }, console: { log() {}, info() {}, warn() {}, error() {} }, localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of LOGICAL_SCRIPTS) vm.runInContext(source(file), context, { filename: file });
  return context;
}

function stageSemanticBase(context, nodes) {
  const copy = plain(nodes), byId = new Map(copy.map((entry) => [entry.id, entry])), children = {};
  for (const entry of copy) children[entry.id] = [];
  for (const entry of copy) { const parentId = entry.parentId || "root"; if (!children[parentId]) children[parentId] = []; children[parentId].push(entry.id); }
  for (const ids of Object.values(children)) ids.sort((left, right) => (Number(byId.get(left)?.order) || 0) - (Number(byId.get(right)?.order) || 0));
  const relation = { nodeIds: copy.map((entry) => entry.id), parents: Object.fromEntries(copy.map((entry) => [entry.id, entry.parentId || "root"])), children }, encoded = context.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-02T00:00:00.000Z", nodes: copy, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), root = context.PocketStarlingRootShadow.build(encoded.bridge), structural = context.PocketStarlingPlacementShadow.build(relation, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded)); assert.equal(root.ok, true, JSON.stringify(root)); assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = context.PocketStarlingRootShadow.diagnosticRootFor({ capacity: root.state.capacity, content: root.state.content, placements: structural.model.placements, children: structural.model.children, preservation: root.state.preservation }), stager = context.PocketStarlingObjectSealShadow.createStager();
  assert.equal(witness.ok, true, JSON.stringify(witness));
  const staged = context.PocketStarlingObjectSealShadow.stageCandidate(stager, { schema: context.PocketStarlingRootShadow.SCHEMA, capacity: root.state.capacity, content: root.state.content, structural: structural.model, preservation: root.state.preservation, root: witness.root }, { previousSealRef: null });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  return { stager, stage: staged.stage };
}

async function composeCapturedThroughP139(nodes, operations) {
  const context = logicalRuntime(), staged = stageSemanticBase(context, nodes), resolveLogical = (ref) => staged.stager.store.get(ref), semantic = await semanticBase(context, { acceptedSealRef: staged.stage.sealRef, resolveLogical, syncedPocketId: "p152" }), opened = await context.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: staged.stage.sealRef, resolveLogical, ...semantic });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const composed = await context.PocketStarlingLogicalEditShadow.compose(opened.base, operations);
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const resolve = (ref) => composed.candidate.resolveLogical(ref) || resolveLogical(ref), audited = context.PocketStarlingObjectSealShadow.auditCandidateSeal(composed.candidate.sealRef, resolve), materialised = context.PocketStarlingPlacementShadow.materialise(audited.candidate.structural);
  assert.equal(audited.ok, true, JSON.stringify(audited)); assert.equal(materialised.ok, true, JSON.stringify(materialised));
  return { context, candidate: audited.candidate, relation: plain(materialised.relation) };
}

test("P152 captures a real sibling-below commit only after its title is committed at the actual local index", () => {
  const context = runtime([node("a", "root", 41), node("later", "root", 84)]);
  context.insertSiblingBelow("a");
  const provisional = context.state.nodes.find((entry) => entry.id === context.state.inlineEdit.id);
  assert.ok(provisional); assert.deepEqual(captured(context, 99), []);
  assert.equal(context.commitInlineEdit(provisional.id, "Committed").ok, true);
  const add = operation(context, provisional.id), operations = captured(context, add.seq);
  assert.equal(add.type, "add_below"); assert.equal(operations.length, 1);
  assert.deepEqual(operations[0], { type: "insert", input: { nodeId: provisional.id, parentId: "root", toIndex: 1, payload: { label: "Committed", source: "manual", updatedAt: "2026-09-02T01:00:00.000Z" } } });
  assert.deepEqual(siblingIds(context), ["a", provisional.id, "later"]);
  assert.notEqual(operations[0].input.toIndex, provisional.order);
});

test("P152 captures a real child commit with exact payload data and an isolated frozen snapshot", () => {
  const context = runtime([node("parent", "root", 19), node("child-a", "parent", 7)]);
  context.insertChildUnder("parent");
  const provisional = context.state.nodes.find((entry) => entry.id === context.state.inlineEdit.id);
  Object.defineProperty(provisional, "__proto__", { value: { retained: "as-data" }, enumerable: true, configurable: true, writable: true });
  provisional.future = { nested: [1, 2] };
  assert.equal(context.commitInlineEdit(provisional.id, "Child").ok, true);
  const add = operation(context, provisional.id), inserted = captured(context, add.seq)[0];
  assert.equal(inserted.type, "insert"); assert.equal(inserted.input.parentId, "parent"); assert.equal(inserted.input.toIndex, 1);
  assert.deepEqual(Object.keys(inserted.input.payload), ["label", "source", "updatedAt", "__proto__", "future"]);
  assert.equal(Object.hasOwn(inserted.input.payload, "__proto__"), true); assert.deepEqual(plain(inserted.input.payload.__proto__), { retained: "as-data" });
  provisional.future.nested.push(3); provisional.label = "Mutated";
  assert.deepEqual(captured(context, add.seq)[0].input.payload.future, { nested: [1, 2] });
  assert.equal(captured(context, add.seq)[0].input.payload.label, "Child");
});

test("P152 keeps provisional cancellation, blank cleanup, slash import and existing rename outside Insert capture", () => {
  const context = runtime([node("a")]);
  context.insertSiblingBelow("a");
  const cancelled = context.state.inlineEdit.id;
  context.cancelInlineEdit(cancelled);
  assert.deepEqual(captured(context, 99), []);
  context.insertChildUnder("a");
  const blank = context.state.inlineEdit.id;
  assert.equal(context.commitInlineEdit(blank, "   ").reason, "blank-title");
  assert.deepEqual(captured(context, 99), []);
  context.insertSiblingBelow("a");
  const slash = context.state.inlineEdit.id;
  context.parseCaptureSlashPathBatch = () => ({ matched: true, ok: true, entries: [] });
  assert.equal(context.commitInlineEdit(slash, "/ignored/path").kind, "path-import");
  assert.deepEqual(captured(context, 99), []);
  context.state.inlineEdit = { id: "a", isNew: false, originalLabel: "a" };
  context.parseCaptureSlashPathBatch = () => ({ matched: false, ok: true });
  assert.equal(context.commitInlineEdit("a", "Renamed").ok, true);
  const rename = context.state.ops.at(-1);
  assert.deepEqual(captured(context, rename.seq).map((entry) => entry.type), ["payload"]);
});

test("P152 preserves add undo bookkeeping while P153 cancels the uncovered Insert semantics", () => {
  const context = runtime([node("a")]);
  context.insertSiblingBelow("a");
  const committed = context.state.inlineEdit.id;
  assert.equal(context.commitInlineEdit(committed, "Committed").ok, true);
  const add = operation(context, committed);
  context.undoLastEditAction();
  const undo = context.state.ops.at(-1);
  assert.equal(undo.type, "undo_add"); assert.deepEqual(captured(context, undo.seq), []);
  const failing = runtime([node("a")]), factory = failing.PocketStarlingOwnerWorkingSetShadow;
  failing.PocketStarlingOwnerWorkingSetShadow = undefined; assert.equal(failing.resetPocketStarlingOwnerWorkingSetJournal(), false);
  failing.insertSiblingBelow("a");
  const failedId = failing.state.inlineEdit.id, beforeHighWater = failing.state.operationHighWater;
  assert.equal(failing.commitInlineEdit(failedId, "Still committed").ok, true);
  assert.equal(failing.state.ops.at(-1).type, "add_below"); assert.equal(failing.state.operationHighWater, beforeHighWater + 1); assert.equal(failing.freezePocketStarlingOwnerWorkingSetThrough(99), null);
  failing.PocketStarlingOwnerWorkingSetShadow = factory;
});

test("P152 composes actual committed Insert then P151 post-action movement through genuine P139", async () => {
  const before = [node("parent", "root", 1001, { details: "Parent" })], context = runtime(before);
  context.insertSiblingBelow("parent");
  const insertedId = context.state.inlineEdit.id;
  assert.equal(context.commitInlineEdit(insertedId, "Child", { postAction: "indent" }).ok, true);
  const move = context.state.ops.at(-1), operations = captured(context, move.seq);
  assert.deepEqual(operations.map((entry) => entry.type), ["insert", "payload", "move"]);
  assert.equal(operations[0].input.nodeId, insertedId); assert.equal(operations[2].input.nodeId, insertedId);
  const composed = await composeCapturedThroughP139(before, operations);
  assert.deepEqual(composed.relation.children.root, ["parent"]); assert.deepEqual(composed.relation.children.parent, [insertedId]); assert.equal(composed.relation.parents[insertedId], "parent");
  assert.deepEqual(plain(composed.context.PocketStarlingRootShadow.getContent(composed.candidate, insertedId)), { nodeId: insertedId, payload: { label: "Child", source: "manual", updatedAt: "2026-09-02T01:00:00.000Z" } });
});

test("P152 sources retain the manual Insert boundary without new owner, Delete, Restore, import or Save authority", () => {
  const history = source(HISTORY);
  assert.match(history, /function capturePocketStarlingNodeInsert\(sequence, node, parentId, toIndex\)/);
  assert.match(history, /type: "insert"/);
  assert.doesNotMatch(history, /capturePocketStarlingNodeInsert[\s\S]*?(?:LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead)/);
  assert.doesNotMatch(source(ACTIONS), /capturePocketStarlingNodeInsert/);
});
