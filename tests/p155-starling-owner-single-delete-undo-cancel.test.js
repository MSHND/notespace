"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js";
function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) { return { id, parentId, order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", ...extra }; }
function runtime(nodes = [node("a")], managed = false) {
  class HTMLElement { focus() {} } class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  let next = 0; const storage = new Map(), context = { Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: { nodes: plain(nodes), tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "", focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p155.json", writtenAt: "" } }, lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "", el: { search: new HTMLInputElement() },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } }, DEVICE_CHANGE_SEQUENCE_KEY: "p155.sequence", nowIso() { return "2026-09-02T01:00:00.000Z"; }, cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); }, makeId() { next += 1; return `new-${next}`; }, compareSiblingOrder(left, right) { return (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.label || "").localeCompare(String(right.label || "")); }, nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); }, childrenMap() { const result = new Map(); for (const entry of context.state.nodes) { const parent = entry.parentId || "root"; if (!result.has(parent)) result.set(parent, []); result.get(parent).push(entry); } for (const entries of result.values()) entries.sort(context.compareSiblingOrder); return result; }, maxSiblingOrder(parentId) { return Math.max(1000, ...context.state.nodes.filter((entry) => (entry.parentId || "root") === (parentId || "root")).map((entry) => Number(entry.order) || 0)); },
    isManagedSystemBucketNode(entry) { return managed && entry.id === "bucket"; }, isCompletedSystemBucketNode() { return false; }, requirePocketFileForChanges() { return true; }, clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, expandPathToNode() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {}, focusRowByNodeId() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(callback) { callback?.(); return 1; }, flashTouchedRow() {}, setStatus() {}, saveLastSaveSnapshot() {}, saveLocalSafetySnapshot() { return true; }, parseCaptureSlashPathBatch() { return { matched: false, ok: true }; }, findChildByLabel() { return null; }, ensurePathNode() { return null; }, PocketDeviceChanges: { cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } }, coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; }, describeDocumentTransition() { return { ok: true, records: [] }; } },
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS]) vm.runInContext(source(file), context, { filename: file });
  context.refreshSaveState = context.refreshMeta = context.renderTree = context.persistPipSnapshot = context.refocusTreeNavigation = context.focusRowByNodeId = context.softlyEnsureSelectionVisible = context.setStatus = () => {};
  return context;
}
function captured(context, sequence) { const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence); return frozen ? plain(frozen.operations) : null; }
function operationTypes(context) { return plain(context.state.ops).map((operation) => operation.type); }
function add(context) { context.insertSiblingBelow("a"); const id = context.state.inlineEdit.id; assert.equal(context.commitInlineEdit(id, "New").ok, true); return { id, operation: plain(context.state.ops.at(-1)) }; }
function witness(context) { return context.lastDeleteUndoSnapshot?.p155DeleteUndoWitness; }
function hasWitness(context) { return Object.hasOwn(context.lastDeleteUndoSnapshot || {}, "p155DeleteUndoWitness"); }

test("P155 cancels only the captured uncovered leaf Delete after real immediate undo", () => {
  const original = [node("before", "root", 10), node("target", "root", 20), node("after", "root", 90)], context = runtime(original);
  assert.equal(context.deleteNodeById("target", { confirm: false }), true);
  const forward = plain(context.state.ops.at(-1)), snapshot = context.lastDeleteUndoSnapshot;
  assert.deepEqual(captured(context, forward.seq), [{ type: "delete", input: { nodeId: "target", fromIndex: 1 } }]);
  assert.equal(Object.getOwnPropertyDescriptor(snapshot, "p155DeleteUndoWitness").enumerable, false);
  assert.deepEqual(plain(witness(context)), { nodeId: "target", operationSequence: forward.seq, forwardSemanticCaptured: true });
  assert.equal(JSON.stringify({ snapshot, nodes: context.state.nodes, tombstones: context.state.tombstones, ops: context.state.ops }).includes("p155DeleteUndoWitness"), false);
  context.undoLastDeleteAction(); const undo = plain(context.state.ops.at(-1));
  assert.deepEqual(plain(context.state.nodes), original); assert.deepEqual(context.state.tombstones, []); assert.deepEqual(operationTypes(context), ["delete", "undo_delete"]); assert.equal(context.state.operationHighWater, undo.seq); assert.deepEqual(captured(context, undo.seq), []);
});

test("P155 cancels exactly one valid branch-root Delete without descendant semantics", () => {
  const original = [node("before", "root", 10), node("branch", "root", 20), node("child", "branch", 700), node("grandchild", "child", 3), node("after", "root", 90)], context = runtime(original);
  context.deleteNodeById("branch", { confirm: false }); const forward = plain(context.state.ops.at(-1));
  assert.deepEqual(captured(context, forward.seq), [{ type: "delete", input: { nodeId: "branch", fromIndex: 1 } }]); assert.deepEqual(context.state.tombstones.map((entry) => entry.id), ["branch", "child", "grandchild"]);
  assert.deepEqual(plain(witness(context)), { nodeId: "branch", operationSequence: forward.seq, forwardSemanticCaptured: true });
  context.undoLastDeleteAction(); const undo = plain(context.state.ops.at(-1));
  assert.deepEqual(plain(context.state.nodes), original); assert.deepEqual(context.state.tombstones, []); assert.deepEqual(operationTypes(context), ["delete", "undo_delete"]); assert.deepEqual(captured(context, undo.seq), []);
});

test("P155 leaves Save-covered material untouched and P170 refuses a settled Delete without an accepted receipt", async () => {
  const covered = runtime([node("a", "root", 10), node("target", "root", 20)]); covered.deleteNodeById("target", { confirm: false }); const coveredDelete = plain(covered.state.ops.at(-1));
  covered.state.activeSaveOperationCeiling = coveredDelete.seq; covered.undoLastDeleteAction(); const coveredUndo = plain(covered.state.ops.at(-1));
  assert.deepEqual(operationTypes(covered), ["delete", "undo_delete"]); assert.deepEqual(captured(covered, coveredUndo.seq), [{ type: "delete", input: { nodeId: "target", fromIndex: 1 } }]); assert.equal(captured(covered, coveredUndo.seq).some((operation) => operation.type === "restore"), false);
  const settled = runtime([node("a", "root", 10), node("target", "root", 20)]); settled.deleteNodeById("target", { confirm: false }); const settledDelete = plain(settled.state.ops.at(-1));
  assert.equal(settled.retainPocketOperationsAfterSequence(settledDelete.seq), 0); assert.equal(settled.state.operationHighWater, settledDelete.seq); assert.deepEqual(captured(settled, settledDelete.seq), []);
  await settled.undoLastDeleteAction();
  assert.equal(settled.state.ops.length, 0); assert.equal(settled.nodeMap().has("target"), false);
});

test("P170 restores a settled Delete only after guarded admission supplies the retained append slot", async () => {
  const context = runtime([node("before", "root", 10), node("target", "root", 20), node("after", "root", 30)]);
  context.deleteNodeById("target", { confirm: false });
  const deleted = plain(context.state.ops.at(-1));
  assert.equal(context.retainPocketOperationsAfterSequence(deleted.seq), 0);
  let request = null;
  context.PocketSyncActiveIntegration = { async admitAcceptedDeleteRestore(value) {
    request = plain(value);
    return { ok: true, operation: { type: "restore", input: {
      nodeId: "target", fromIndex: 7, newParentId: "root", toIndex: 1,
    } } };
  } };
  assert.equal(await context.undoLastDeleteAction(), true);
  assert.deepEqual(request, { nodeId: "target", operationSequence: deleted.seq, newParentId: "root", toIndex: 1 });
  assert.deepEqual(context.state.nodes.map((entry) => entry.id), ["before", "target", "after"]);
  const undo = plain(context.state.ops.at(-1));
  assert.equal(undo.type, "undo_delete");
  assert.deepEqual(captured(context, undo.seq), [{ type: "restore", input: {
    nodeId: "target", fromIndex: 7, newParentId: "root", toIndex: 1,
  } }]);
});

test("P155 does not cancel after a newer operation or an unavailable forward capture", () => {
  const newer = runtime([node("before", "root", 10), node("target", "root", 20)]); newer.deleteNodeById("target", { confirm: false }); const forward = plain(newer.state.ops.at(-1));
  const later = newer.recordOp({ type: "later" }); assert.equal(newer.capturePocketStarlingNodePayload(later.seq, newer.nodeMap().get("before")), true); const beforeUndo = captured(newer, later.seq);
  newer.undoLastDeleteAction(); const undo = plain(newer.state.ops.at(-1));
  assert.equal(undo.type, "undo_delete"); assert.deepEqual(captured(newer, undo.seq), beforeUndo); assert.equal(captured(newer, undo.seq).some((operation) => operation.type === "restore"), false);
  const failed = runtime([node("a", "root", 10), node("target", "root", 20)]), factory = failed.PocketStarlingOwnerWorkingSetShadow;
  failed.PocketStarlingOwnerWorkingSetShadow = undefined; assert.equal(failed.resetPocketStarlingOwnerWorkingSetJournal(), false); failed.deleteNodeById("target", { confirm: false }); const failedDelete = plain(failed.state.ops.at(-1));
  assert.deepEqual(plain(witness(failed)), { nodeId: "target", operationSequence: failedDelete.seq, forwardSemanticCaptured: false });
  failed.PocketStarlingOwnerWorkingSetShadow = factory; assert.equal(failed.resetPocketStarlingOwnerWorkingSetJournal(), true); failed.undoLastDeleteAction(); const failedUndo = plain(failed.state.ops.at(-1));
  assert.equal(failedUndo.type, "undo_delete"); assert.equal(failed.nodeMap().has("target"), true); assert.deepEqual(captured(failed, failedUndo.seq), []);
});

test("P155 excludes P154 Insert cancellation and other unclaimed delete boundaries", () => {
  const insert = runtime(), added = add(insert); insert.deleteNodeById(added.id, { confirm: false });
  assert.equal(hasWitness(insert), false); assert.deepEqual(captured(insert, insert.state.ops.at(-1).seq), []); insert.undoLastDeleteAction(); assert.equal(insert.nodeMap().has(added.id), true); assert.deepEqual(captured(insert, insert.state.ops.at(-1).seq), []);
  const provisional = runtime(); provisional.insertSiblingBelow("a"); provisional.cancelInlineEdit(provisional.state.inlineEdit.id); assert.equal(hasWitness(provisional), false); assert.deepEqual(captured(provisional, provisional.state.operationHighWater), []);
  const blank = runtime(); blank.insertSiblingBelow("a"); const blankId = blank.state.inlineEdit.id; blank.commitInlineEdit(blankId, ""); assert.equal(hasWitness(blank), false); assert.deepEqual(captured(blank, blank.state.operationHighWater), []);
  const path = runtime([node("path")]); path.recordOp({ type: "add_path", id: "path" }); path.deleteNodeById("path", { confirm: false }); assert.equal(hasWitness(path), false); assert.deepEqual(captured(path, path.state.ops.at(-1).seq), []);
  const bucket = runtime([node("bucket")], true); bucket.deleteNodeById("bucket", { confirm: false }); assert.equal(hasWitness(bucket), false); assert.deepEqual(captured(bucket, bucket.state.ops.at(-1).seq), []);
  const history = source(HISTORY), actions = source(ACTIONS); assert.match(history, /bindP153InsertUndoWitness/); assert.match(actions, /bindP151MoveUndoWitness/); assert.doesNotMatch(history, /type:\s*["']restore/); assert.doesNotMatch(actions, /LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead/);
});
