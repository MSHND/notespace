"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"), { semanticBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js";
const LOGICAL_SCRIPTS = ["js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js", "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-semantic-authority-shadow.js"];

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

function logicalRuntime() {
  const context = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error, btoa(value) { return Buffer.from(value, "binary").toString("base64"); }, atob(value) { return Buffer.from(value, "base64").toString("binary"); }, console: { log() {}, info() {}, warn() {}, error() {} }, localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of LOGICAL_SCRIPTS) vm.runInContext(source(file), context, { filename: file });
  return context;
}

function semanticInput(nodes) {
  const copy = plain(nodes), byId = new Map(copy.map((entry) => [entry.id, entry])), children = {};
  for (const entry of copy) { children[entry.id] = []; }
  for (const entry of copy) { const parentId = entry.parentId || "root"; if (!children[parentId]) children[parentId] = []; children[parentId].push(entry.id); }
  for (const [parentId, ids] of Object.entries(children)) ids.sort((left, right) => (Number(byId.get(left)?.order) || 0) - (Number(byId.get(right)?.order) || 0));
  return { nodes: copy, relation: { nodeIds: copy.map((entry) => entry.id), parents: Object.fromEntries(copy.map((entry) => [entry.id, entry.parentId || "root"])), children } };
}

function stageSemanticBase(context, nodes) {
  const input = semanticInput(nodes), encoded = context.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-02T00:00:00.000Z", nodes: input.nodes, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), root = context.PocketStarlingRootShadow.build(encoded.bridge), structural = context.PocketStarlingPlacementShadow.build(input.relation, { capacity: 4 });
  assert.equal(encoded.ok, true, JSON.stringify(encoded)); assert.equal(root.ok, true, JSON.stringify(root)); assert.equal(structural.ok, true, JSON.stringify(structural));
  const witness = context.PocketStarlingRootShadow.diagnosticRootFor({ capacity: root.state.capacity, content: root.state.content, placements: structural.model.placements, children: structural.model.children, preservation: root.state.preservation });
  assert.equal(witness.ok, true, JSON.stringify(witness));
  const stager = context.PocketStarlingObjectSealShadow.createStager(), staged = context.PocketStarlingObjectSealShadow.stageCandidate(stager, { schema: context.PocketStarlingRootShadow.SCHEMA, capacity: root.state.capacity, content: root.state.content, structural: structural.model, preservation: root.state.preservation, root: witness.root }, { previousSealRef: null });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  return { stager, stage: staged.stage };
}

async function composeCapturedThroughP139(nodes, operations) {
  const context = logicalRuntime(), staged = stageSemanticBase(context, nodes), resolveLogical = (ref) => staged.stager.store.get(ref), semantic = await semanticBase(context, { acceptedSealRef: staged.stage.sealRef, resolveLogical, syncedPocketId: "p151a" }), opened = await context.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: staged.stage.sealRef, resolveLogical, ...semantic });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const composed = await context.PocketStarlingLogicalEditShadow.compose(opened.base, operations);
  assert.equal(composed.ok, true, JSON.stringify(composed));
  const resolve = (ref) => composed.candidate.resolveLogical(ref) || resolveLogical(ref), audited = context.PocketStarlingObjectSealShadow.auditCandidateSeal(composed.candidate.sealRef, resolve);
  assert.equal(audited.ok, true, JSON.stringify(audited));
  const relation = context.PocketStarlingPlacementShadow.materialise(audited.candidate.structural);
  assert.equal(relation.ok, true, JSON.stringify(relation));
  return { context, candidate: audited.candidate, relation: plain(relation.relation) };
}

test("P151 captures actual same-parent reorder and its witnessed inverse undo under real operation sequences", () => {
  const context = runtime([node("a", "root", 1001), node("b", "root", 1002), node("c", "root", 1003)]);
  context.moveNodeWithinSiblings("b", -1);
  const forward = movement(context);
  assert.equal(forward.type, "move_up");
  assert.equal(Object.keys(context.lastMoveUndoSnapshot).includes("p151MoveUndoWitness"), false);
  assert.deepEqual(plain(context.lastMoveUndoSnapshot.p151MoveUndoWitness), { nodeId: "b", parentId: "root", index: 1, operationSequence: forward.seq, forwardSemanticCaptured: true });
  assert.equal(JSON.stringify(context.lastMoveUndoSnapshot).includes("forwardSemanticCaptured"), false);
  assert.equal(JSON.stringify(context.state.ops).includes("forwardSemanticCaptured"), false);
  assert.deepEqual(siblingIds(context), ["b", "a", "c"]);
  assertPayloadThenStructure(capturedForSequence(context, forward.seq), { nodeId: "b", structural: { type: "reorder", input: { nodeId: "b", fromIndex: 1, toIndex: 0 } } });
  assert.equal(context.undoLastMoveAction(), undefined);
  const undo = movement(context);
  assert.equal(undo.type, "undo_move_up");
  assert.deepEqual(siblingIds(context), ["a", "b", "c"]);
  assertPayloadThenStructure(capturedForSequence(context, undo.seq), { nodeId: "b", updatedAt: "2026-09-02T00:00:00.000Z", structural: { type: "reorder", input: { nodeId: "b", fromIndex: 0, toIndex: 2 } } });
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

test("P151a retains exact inverse capture after lifecycle settlement when high-water still proves the movement frontier", () => {
  const context = runtime([node("a", "root", 1001), node("b", "root", 1002)]);
  context.moveNodeWithinSiblings("b", -1);
  const movementOperation = movement(context);
  assert.equal(context.retainPocketOperationsAfterSequence(movementOperation.seq), 0);
  assert.equal(context.state.operationHighWater, movementOperation.seq);
  assert.equal(context.state.ops.length, 0);
  assert.equal(context.undoLastMoveAction(), undefined);
  const undo = movement(context);
  assert.equal(undo.type, "undo_move_up");
  assertPayloadThenStructure(captured(context, undo.seq), { nodeId: "b", updatedAt: "2026-09-02T00:00:00.000Z", structural: { type: "reorder", input: { nodeId: "b", fromIndex: 0, toIndex: 2 } } });
});

test("P151a suppresses inverse capture after a newer unrelated operation while preserving current broad undo", () => {
  const context = runtime([node("a", "root", 1001), node("b", "root", 1002), node("unrelated", "root", 1003, { details: "before" })]);
  context.moveNodeWithinSiblings("b", -1);
  const movementOperation = movement(context), unrelated = context.state.nodes.find((entry) => entry.id === "unrelated");
  unrelated.details = "later";
  const newer = context.recordOp({ type: "unrelated", id: unrelated.id });
  assert.equal(context.capturePocketStarlingNodePayload(newer.seq, unrelated), true);
  const beforeUndoCapture = captured(context, newer.seq);
  assert.ok(context.state.operationHighWater > movementOperation.seq);
  assert.equal(context.undoLastMoveAction(), undefined);
  const undo = movement(context);
  assert.equal(undo.type, "undo_move_up");
  assert.deepEqual(siblingIds(context), ["a", "b", "unrelated"]);
  assert.equal(context.state.nodes.find((entry) => entry.id === "unrelated").details, "before");
  assert.deepEqual(captured(context, undo.seq), beforeUndoCapture);
});

test("P151a never permits a lone inverse after forward shadow capture failure", () => {
  const context = runtime([node("a", "root", 1001), node("b", "root", 1002)]), factory = context.PocketStarlingOwnerWorkingSetShadow;
  context.PocketStarlingOwnerWorkingSetShadow = undefined;
  assert.equal(context.resetPocketStarlingOwnerWorkingSetJournal(), false);
  context.moveNodeWithinSiblings("b", -1);
  const movementOperation = movement(context);
  assert.deepEqual(plain(context.lastMoveUndoSnapshot.p151MoveUndoWitness), { nodeId: "b", parentId: "root", index: 1, operationSequence: movementOperation.seq, forwardSemanticCaptured: false });
  context.PocketStarlingOwnerWorkingSetShadow = factory;
  assert.equal(context.resetPocketStarlingOwnerWorkingSetJournal(), true);
  assert.equal(context.undoLastMoveAction(), undefined);
  const undo = movement(context);
  assert.equal(undo.type, "undo_move_up");
  assert.deepEqual(captured(context, undo.seq), []);
});

test("P151a composes real captured immediate reorder and move inverses through genuine P139", async () => {
  const reorderNodes = [node("a", "root", 1001, { details: "A" }), node("b", "root", 1002, { details: "B" }), node("c", "root", 1003, { details: "C" })], reorder = runtime(reorderNodes);
  reorder.moveNodeWithinSiblings("b", -1);
  reorder.undoLastMoveAction();
  const reorderComposed = await composeCapturedThroughP139(reorderNodes, captured(reorder, movement(reorder).seq));
  assert.deepEqual(reorderComposed.relation.children.root, ["a", "b", "c"]);
  assert.equal(reorderComposed.relation.parents.b, "root");
  assert.deepEqual(plain(reorderComposed.context.PocketStarlingRootShadow.getContent(reorderComposed.candidate, "b")), { nodeId: "b", payload: { label: "b", updatedAt: "2026-09-02T00:00:00.000Z", details: "B" } });

  const moveNodes = [node("parent", "root", 1001), node("branch", "root", 1002, { details: "Branch" }), node("child", "branch", 1001)], move = runtime(moveNodes);
  assert.equal(move.moveTreeBranchByDrop("branch", "parent", "inside"), true);
  move.undoLastMoveAction();
  const moveComposed = await composeCapturedThroughP139(moveNodes, captured(move, movement(move).seq));
  assert.deepEqual(moveComposed.relation.children.root, ["parent", "branch"]);
  assert.equal(moveComposed.relation.parents.branch, "root");
  assert.deepEqual(plain(moveComposed.context.PocketStarlingRootShadow.getContent(moveComposed.candidate, "branch")), { nodeId: "branch", payload: { label: "branch", updatedAt: "2026-09-02T00:00:00.000Z", details: "Branch" } });
});

test("P151 sources remain limited to Move/Reorder capture without completion or owner authority expansion", () => {
  const history = source(HISTORY), actions = source(ACTIONS);
  assert.match(history, /function capturePocketStarlingNodePayloadAndStructure\(sequence, node, structuralOperation\)/);
  assert.match(actions, /p151MoveUndoWitness/);
  assert.doesNotMatch(actions, /moveNodeIntoCompletedSystemBucket|ensureCompletedSystemBucketChildNode/);
  for (const program of [history, actions]) assert.doesNotMatch(program, /LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead/);
});
