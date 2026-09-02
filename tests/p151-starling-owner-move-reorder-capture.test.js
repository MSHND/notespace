"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js";

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) { return { id, parentId, order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", ...extra }; }

function runtime(nodes) {
  const storage = new Map();
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, structuredClone,
    state: { nodes: plain(nodes), tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "", focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p151.json", writtenAt: "" } },
    lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "",
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } }, DEVICE_CHANGE_SEQUENCE_KEY: "p151.sequence",
    nowIso() { return "2026-09-02T01:00:00.000Z"; }, cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); },
    compareSiblingOrder(left, right) { return (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.label || "").localeCompare(String(right.label || "")); },
    nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); },
    childrenMap() { const result = new Map(); for (const entry of context.state.nodes) { const parent = entry.parentId || "root"; if (!result.has(parent)) result.set(parent, []); result.get(parent).push(entry); } for (const entries of result.values()) entries.sort(context.compareSiblingOrder); return result; },
    maxSiblingOrder(parentId) { return Math.max(1000, ...context.state.nodes.filter((entry) => (entry.parentId || "root") === (parentId || "root")).map((entry) => Number(entry.order) || 0)); },
    isManagedSystemBucketNode() { return false; }, isCompletedSystemBucketNode() { return false; },
    requirePocketFileForChanges() { return true; }, clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, expandPathToNode() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(callback) { callback?.(); return 1; }, flashTouchedRow() {}, setStatus() {},
    saveLocalSafetySnapshot() { return true; },
    PocketDeviceChanges: { cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } }, coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; }, describeDocumentTransition() { return { ok: true, records: [] }; } },
    __storage: storage,
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS]) vm.runInContext(source(file), context, { filename: file });
  context.refreshMeta = () => {}; context.refreshSaveState = () => {}; context.renderTree = () => {}; context.persistPipSnapshot = () => {}; context.refocusTreeNavigation = () => {}; context.setStatus = () => {};
  return context;
}

function siblingIds(context, parentId = "root") { return context.sortNodesForParent(parentId).map((entry) => entry.id); }
function captured(context, sequence) { return plain(context.freezePocketStarlingOwnerWorkingSetThrough(sequence).operations); }
function capturedForSequence(context, sequence) { return captured(context, sequence).slice(-2); }
function movement(context) { return context.state.ops.at(-1); }
function assertPayloadThenStructure(operations, expected) {
  assert.equal(operations.length, 2);
  assert.deepEqual(Object.keys(operations[0]), ["type", "input"]);
  assert.equal(operations[0].type, "payload");
  assert.equal(operations[0].input.nodeId, expected.nodeId);
  assert.equal(Object.hasOwn(operations[0].input.payload, "id"), false);
  assert.equal(Object.hasOwn(operations[0].input.payload, "parentId"), false);
  assert.equal(Object.hasOwn(operations[0].input.payload, "order"), false);
  assert.equal(operations[0].input.payload.updatedAt, expected.updatedAt || "2026-09-02T01:00:00.000Z");
  assert.deepEqual(operations[1], expected.structural);
}

test("P151 captures actual same-parent reorder and its witnessed inverse undo under real operation sequences", () => {
  const context = runtime([node("a", "root", 1001), node("b", "root", 1002), node("c", "root", 1003)]);
  context.moveNodeWithinSiblings("b", -1);
  const forward = movement(context);
  assert.equal(forward.type, "move_up");
  assert.equal(Object.keys(context.lastMoveUndoSnapshot).includes("p151MoveUndoWitness"), false);
  assert.deepEqual(plain(context.lastMoveUndoSnapshot.p151MoveUndoWitness), { nodeId: "b", parentId: "root", index: 1 });
  assert.deepEqual(siblingIds(context), ["b", "a", "c"]);
  assertPayloadThenStructure(capturedForSequence(context, forward.seq), { nodeId: "b", structural: { type: "reorder", input: { nodeId: "b", fromIndex: 1, toIndex: 0 } } });
  assert.equal(context.undoLastMoveAction(), undefined);
  const undo = movement(context);
  assert.equal(undo.type, "undo_move_up");
  assert.deepEqual(siblingIds(context), ["a", "b", "c"]);
  assertPayloadThenStructure(capturedForSequence(context, undo.seq), { nodeId: "b", updatedAt: "2026-09-02T00:00:00.000Z", structural: { type: "reorder", input: { nodeId: "b", fromIndex: 0, toIndex: 1 } } });
});

test("P151 captures actual indent and outdent from local sibling positions without descendant operations", () => {
  const indent = runtime([node("a", "root", 1001), node("b", "root", 1002), node("b-child", "b", 1001)]);
  indent.indentNodeById("b");
  const indentOperation = movement(indent);
  assertPayloadThenStructure(capturedForSequence(indent, indentOperation.seq), { nodeId: "b", structural: { type: "move", input: { nodeId: "b", fromIndex: 1, newParentId: "a", toIndex: 0 } } });
  assert.equal(capturedForSequence(indent, indentOperation.seq).some((operation) => operation.input?.nodeId === "b-child"), false);

  const outdent = runtime([node("a", "root", 1001), node("parent", "root", 1002), node("child-a", "parent", 1001), node("child-b", "parent", 1002), node("later", "root", 1003)]);
  outdent.outdentNodeById("child-b");
  const outdentOperation = movement(outdent);
  assertPayloadThenStructure(capturedForSequence(outdent, outdentOperation.seq), { nodeId: "child-b", structural: { type: "move", input: { nodeId: "child-b", fromIndex: 1, newParentId: "root", toIndex: 2 } } });
});

test("P151 classifies actual before/inside/after branch drops by final parent and emits root-only work", () => {
  const sameParent = runtime([node("a", "root", 1001), node("b", "root", 1002), node("c", "root", 1003)]);
  assert.equal(sameParent.moveTreeBranchByDrop("c", "a", "before"), true);
  const reorder = movement(sameParent);
  assert.deepEqual(siblingIds(sameParent), ["c", "a", "b"]);
  assertPayloadThenStructure(capturedForSequence(sameParent, reorder.seq), { nodeId: "c", structural: { type: "reorder", input: { nodeId: "c", fromIndex: 2, toIndex: 0 } } });

  const crossParent = runtime([node("parent", "root", 1001), node("branch", "root", 1002), node("branch-child", "branch", 1001), node("branch-grandchild", "branch-child", 1001)]);
  assert.equal(crossParent.moveTreeBranchByDrop("branch", "parent", "inside"), true);
  const move = movement(crossParent);
  const operations = capturedForSequence(crossParent, move.seq);
  assertPayloadThenStructure(operations, { nodeId: "branch", structural: { type: "move", input: { nodeId: "branch", fromIndex: 1, newParentId: "parent", toIndex: 0 } } });
  assert.equal(operations.some((operation) => operation.input?.nodeId === "branch-child" || operation.input?.nodeId === "branch-grandchild"), false);
  assert.equal(crossParent.undoLastMoveAction(), undefined);
  const undo = movement(crossParent);
  assert.deepEqual(siblingIds(crossParent), ["parent", "branch"]);
  assertPayloadThenStructure(capturedForSequence(crossParent, undo.seq), { nodeId: "branch", updatedAt: "2026-09-02T00:00:00.000Z", structural: { type: "move", input: { nodeId: "branch", fromIndex: 0, newParentId: "root", toIndex: 1 } } });
});

test("P151 leaves unrelated undo unclaimed while rename remains P150 payload-only", () => {
  const context = runtime([node("a", "root", 1001), node("b", "root", 1002)]);
  const addSnapshot = context.createTreeUndoSnapshot("add");
  context.moveNodeWithinSiblings("b", -1);
  const beforeAddUndo = captured(context, movement(context).seq);
  assert.equal(context.restoreTreeUndoSnapshot(addSnapshot), true);
  assert.deepEqual(captured(context, movement(context).seq), beforeAddUndo);
  context.state.selectedId = "a";
  const renameSnapshot = context.createTreeUndoSnapshot("rename");
  assert.equal(context.restoreTreeUndoSnapshot(renameSnapshot), true);
  const renameOperations = captured(context, movement(context).seq);
  assert.equal(renameOperations.at(-1).type, "payload");
  assert.equal(renameOperations.some((operation) => operation.type === "move" || operation.type === "reorder"), true, "only the earlier real move remains structural");
});

test("P151 preserves P150a extraction and leaves current movement authoritative when shadow capture is unavailable", () => {
  const exact = runtime([node("special", "root", 1001, { details: "kept", future: { nested: true } })]);
  Object.defineProperty(exact.state.nodes[0], "__proto__", { value: { exact: true }, enumerable: true, configurable: true, writable: true });
  const operation = exact.recordOp({ type: "genuine" });
  assert.equal(exact.capturePocketStarlingNodePayload(operation.seq, exact.state.nodes[0]), true);
  const payload = captured(exact, operation.seq)[0].input.payload;
  assert.equal(Object.hasOwn(payload, "__proto__"), true);
  assert.deepEqual(plain(payload.__proto__), { exact: true });
  assert.notEqual(Object.getPrototypeOf(payload), payload.__proto__);
  assert.equal(exact.capturePocketStarlingNodePayload(operation.seq + 10, exact.state.nodes[0]), false);

  const unavailable = runtime([node("a", "root", 1001), node("b", "root", 1002)]);
  unavailable.PocketStarlingOwnerWorkingSetShadow = undefined;
  assert.equal(unavailable.resetPocketStarlingOwnerWorkingSetJournal(), false);
  unavailable.moveNodeWithinSiblings("b", -1);
  assert.deepEqual(siblingIds(unavailable), ["b", "a"]);
  assert.equal(unavailable.state.ops.length, 1);
  assert.equal(unavailable.freezePocketStarlingOwnerWorkingSetThrough(1), null);
  assert.equal(JSON.stringify(unavailable.state.ops).includes('"type":"reorder"'), false);
});

test("P151 sources remain limited to Move/Reorder capture without completion or owner authority expansion", () => {
  const history = source(HISTORY), actions = source(ACTIONS);
  assert.match(history, /function capturePocketStarlingNodePayloadAndStructure\(sequence, node, structuralOperation\)/);
  assert.match(actions, /p151MoveUndoWitness/);
  assert.doesNotMatch(actions, /moveNodeIntoCompletedSystemBucket|ensureCompletedSystemBucketChildNode/);
  for (const program of [history, actions]) assert.doesNotMatch(program, /LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead/);
});
