"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js";

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) { return { id, parentId, order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", ...extra }; }

function runtime(nodes = [node("a")]) {
  class HTMLElement { focus() {} select() {} }
  class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  const storage = new Map(); let nextId = 0, safetyWrites = 0;
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: { nodes: plain(nodes), tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "", focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p153.json", writtenAt: "" } },
    lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "", el: { search: new HTMLInputElement() },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } }, DEVICE_CHANGE_SEQUENCE_KEY: "p153.sequence",
    nowIso() { return "2026-09-02T01:00:00.000Z"; }, cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); }, makeId() { nextId += 1; return `new-${nextId}`; },
    compareSiblingOrder(left, right) { return (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.label || "").localeCompare(String(right.label || "")); },
    nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); }, childrenMap() { const result = new Map(); for (const entry of context.state.nodes) { const parent = entry.parentId || "root"; if (!result.has(parent)) result.set(parent, []); result.get(parent).push(entry); } for (const entries of result.values()) entries.sort(context.compareSiblingOrder); return result; }, maxSiblingOrder(parentId) { return Math.max(1000, ...context.state.nodes.filter((entry) => (entry.parentId || "root") === (parentId || "root")).map((entry) => Number(entry.order) || 0)); },
    isManagedSystemBucketNode() { return false; }, isCompletedSystemBucketNode() { return false; }, requirePocketFileForChanges() { return true; }, clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, expandPathToNode() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {}, focusRowByNodeId() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(callback) { callback?.(); return 1; }, flashTouchedRow() {}, setStatus() {}, saveLastSaveSnapshot() {}, saveLocalSafetySnapshot() { safetyWrites += 1; return true; },
    parseCaptureSlashPathBatch() { return { matched: false, ok: true }; }, findChildByLabel() { return null; }, ensurePathNode() { return null; },
    PocketDeviceChanges: { cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } }, coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; }, describeDocumentTransition() { return { ok: true, records: [] }; } },
    __storage: storage, __safetyWrites() { return safetyWrites; },
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS]) vm.runInContext(source(file), context, { filename: file });
  context.refreshSaveState = () => {}; context.refreshMeta = () => {}; context.renderTree = () => {}; context.persistPipSnapshot = () => {}; context.refocusTreeNavigation = () => {}; context.focusRowByNodeId = () => {}; context.softlyEnsureSelectionVisible = () => {}; context.setStatus = () => {};
  return context;
}

function captured(context, sequence) { const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence); return frozen ? plain(frozen.operations) : null; }
function siblingIds(context, parentId = "root") { return context.sortNodesForParent(parentId).map((entry) => entry.id); }
function commitSibling(context, label = "Committed", options = {}) { context.insertSiblingBelow("a"); const id = context.state.inlineEdit.id; assert.equal(context.commitInlineEdit(id, label, options).ok, true); return { id, add: context.state.ops.find((entry) => entry.id === id) }; }
function undoTypes(context) { return context.state.ops.map((entry) => entry.type); }

test("P153 cancels an immediate uncovered sibling Insert only after ordinary add undo bookkeeping", () => {
  const context = runtime([node("a"), node("later", "root", 1002)]), { id, add } = commitSibling(context), witness = context.lastEditUndoSnapshot.p153InsertUndoWitness;
  assert.equal(Object.keys(context.lastEditUndoSnapshot).includes("p153InsertUndoWitness"), false);
  assert.deepEqual(plain(witness), { nodeId: id, operationSequence: add.seq, forwardSemanticCaptured: true });
  assert.equal(JSON.stringify(context.lastEditUndoSnapshot).includes("p153InsertUndoWitness"), false);
  assert.equal(JSON.stringify(context.state.ops).includes("forwardSemanticCaptured"), false);
  assert.deepEqual(captured(context, add.seq).map((entry) => entry.type), ["insert"]);
  const safetyBefore = context.__safetyWrites();
  context.undoLastEditAction();
  const undo = context.state.ops.at(-1);
  assert.deepEqual(siblingIds(context), ["a", "later"]); assert.deepEqual(undoTypes(context), ["add_below", "undo_add"]); assert.equal(undo.seq, add.seq + 1); assert.equal(context.state.operationHighWater, undo.seq); assert.equal(context.__safetyWrites(), safetyBefore + 1);
  assert.deepEqual(captured(context, undo.seq), []);
});

test("P153 cancels an immediate uncovered child Insert without parent, index or descendant residue", () => {
  const context = runtime([node("a"), node("child", "a", 1001)]);
  context.insertChildUnder("a");
  const id = context.state.inlineEdit.id;
  assert.equal(context.commitInlineEdit(id, "Committed child").ok, true);
  const add = context.state.ops.at(-1);
  assert.deepEqual(captured(context, add.seq).map((entry) => entry.type), ["insert"]);
  context.undoLastEditAction();
  assert.deepEqual(siblingIds(context, "a"), ["child"]); assert.deepEqual(captured(context, context.state.ops.at(-1).seq), []);
});

test("P153 does not discard Insert semantics when the active Save ceiling covers the add", () => {
  const context = runtime(), { id, add } = commitSibling(context);
  context.state.activeSaveOperationCeiling = add.seq;
  context.undoLastEditAction();
  const undo = context.state.ops.at(-1), operations = captured(context, undo.seq);
  assert.equal(context.nodeMap().has(id), false); assert.deepEqual(undoTypes(context), ["add_below", "undo_add"]); assert.deepEqual(operations.map((entry) => entry.type), ["insert"]);
  assert.equal(operations[0].input.nodeId, id); assert.equal(operations.some((entry) => entry.type === "delete" || entry.type === "restore"), false);
});

test("P153 treats retained Insert material as settled rather than cancellable", () => {
  const context = runtime(), { add } = commitSibling(context);
  assert.equal(context.retainPocketOperationsAfterSequence(add.seq), 0); assert.equal(context.state.operationHighWater, add.seq); assert.equal(context.state.ops.length, 0); assert.deepEqual(captured(context, add.seq), []);
  context.undoLastEditAction();
  const undo = context.state.ops.at(-1);
  assert.equal(undo.type, "undo_add"); assert.deepEqual(captured(context, undo.seq), []); assert.equal(captured(context, undo.seq).some((entry) => entry.type === "delete" || entry.type === "restore"), false);
});

test("P153 refuses cancellation after a newer actual operation while preserving broad add undo", () => {
  const context = runtime(), { id, add } = commitSibling(context), existing = context.nodeMap().get("a");
  existing.label = "Later";
  const newer = context.recordOp({ type: "rename", id: existing.id, from: "a", to: "Later" });
  assert.equal(context.capturePocketStarlingNodePayload(newer.seq, existing), true); assert.equal(context.state.operationHighWater, newer.seq);
  const beforeUndo = captured(context, newer.seq);
  context.undoLastEditAction();
  const undo = context.state.ops.at(-1);
  assert.equal(context.nodeMap().has(id), false); assert.deepEqual(undoTypes(context), ["add_below", "rename", "undo_add"]); assert.deepEqual(captured(context, undo.seq), beforeUndo);
  assert.equal(captured(context, undo.seq).some((entry) => entry.type === "delete" || entry.type === "restore"), false);
});

test("P153 cannot cancel when forward Insert capture failed", () => {
  const context = runtime(), factory = context.PocketStarlingOwnerWorkingSetShadow;
  context.PocketStarlingOwnerWorkingSetShadow = undefined; assert.equal(context.resetPocketStarlingOwnerWorkingSetJournal(), false);
  const { id, add } = commitSibling(context);
  assert.deepEqual(plain(context.lastEditUndoSnapshot.p153InsertUndoWitness), { nodeId: id, operationSequence: add.seq, forwardSemanticCaptured: false });
  context.PocketStarlingOwnerWorkingSetShadow = factory; assert.equal(context.resetPocketStarlingOwnerWorkingSetJournal(), true);
  context.undoLastEditAction();
  assert.equal(context.state.ops.at(-1).type, "undo_add"); assert.deepEqual(captured(context, context.state.ops.at(-1).seq), []);
});

test("P153 leaves a post-action P151 movement frontier and its Insert semantic material untouched", () => {
  const context = runtime(), { id, add } = commitSibling(context, "Child", { postAction: "indent" }), movement = context.state.ops.at(-1);
  assert.ok(movement.seq > add.seq); assert.equal(context.state.operationHighWater, movement.seq);
  const beforeUndo = captured(context, movement.seq);
  context.undoLastEditAction();
  const undo = context.state.ops.at(-1);
  assert.equal(context.nodeMap().has(id), false); assert.deepEqual(captured(context, undo.seq), beforeUndo); assert.equal(captured(context, undo.seq).some((entry) => entry.type === "delete" || entry.type === "restore"), false);
});

test("P153 leaves provisional, slash and existing rename boundaries without a cancellation witness", () => {
  const context = runtime();
  context.insertSiblingBelow("a"); const provisional = context.state.inlineEdit.id;
  assert.equal(Object.hasOwn(context.lastEditUndoSnapshot, "p153InsertUndoWitness"), false); context.cancelInlineEdit(provisional); assert.deepEqual(captured(context, 99), []);
  context.insertSiblingBelow("a"); const slash = context.state.inlineEdit.id;
  context.parseCaptureSlashPathBatch = () => ({ matched: true, ok: true, entries: [] });
  assert.equal(context.commitInlineEdit(slash, "/ignored/path").kind, "path-import"); assert.deepEqual(captured(context, 99), []);
  const renamed = runtime();
  renamed.state.selectedId = "a";
  renamed.state.inlineEdit = { id: "a", isNew: false, originalLabel: "a" };
  assert.equal(renamed.commitInlineEdit("a", "Renamed").ok, true); assert.equal(Object.hasOwn(renamed.lastEditUndoSnapshot || {}, "p153InsertUndoWitness"), false); renamed.undoLastEditAction();
  assert.deepEqual(captured(renamed, renamed.state.ops.at(-1).seq).map((entry) => entry.type), ["payload", "payload"]);
});

test("P153 production remains an add-only sidecar cancellation boundary", () => {
  const history = source(HISTORY);
  assert.match(history, /function bindP153InsertUndoWitness\(snapshot, nodeId, operationSequence, forwardSemanticCaptured\)/);
  assert.match(history, /snapshot\.kind === "add" \? snapshot\.p153InsertUndoWitness : null/);
  assert.match(history, /discardPocketStarlingOwnerWorkingOperations\(insertUndoWitness\.operationSequence\)/);
  assert.doesNotMatch(source(ACTIONS), /p153InsertUndoWitness|discardPocketStarlingOwnerWorkingOperations/);
  assert.doesNotMatch(history, /p153InsertUndoWitness[\s\S]*?(?:LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead)/);
});
