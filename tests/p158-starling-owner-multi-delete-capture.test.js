"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"), { semanticBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js", MULTI = "js/pocket-multi-select.js";
const LOGICAL = ["js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js", "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-semantic-authority-shadow.js"];

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) { return { id, parentId, order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", ...extra }; }

function runtime(nodes, options = {}) {
  class HTMLElement { focus() {} }
  class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  const storage = new Map(), statuses = [], visible = options.visible || nodes.map((entry) => entry.id);
  const rows = visible.map((id) => ({ getAttribute(name) { return name === "data-node-id" ? id : null; }, classList: { add() {}, remove() {} }, focus() {} }));
  const treeRoot = new HTMLElement(); treeRoot.querySelectorAll = () => rows;
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: { nodes: plain(nodes), tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: options.selectedId || "", multiSelectedIds: new Set(options.multiSelectedIds || []), multiSelectAnchorId: "", focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p158.json", writtenAt: "" } },
    lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "", el: { search: new HTMLInputElement(), treeRoot },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } }, DEVICE_CHANGE_SEQUENCE_KEY: "p158.sequence", nowIso() { return "2026-09-02T01:00:00.000Z"; }, cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); },
    compareSiblingOrder(left, right) { return (Number(left.order) || 0) - (Number(right.order) || 0) || String(left.label || "").localeCompare(String(right.label || "")); }, nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); }, childrenMap() { const result = new Map(); for (const entry of context.state.nodes) { const parent = entry.parentId || "root"; if (!result.has(parent)) result.set(parent, []); result.get(parent).push(entry); } for (const siblings of result.values()) siblings.sort(context.compareSiblingOrder); return result; },
    isManagedSystemBucketNode(entry) { return options.managed === true && entry?.id === "bucket"; }, isCompletedSystemBucketNode() { return false; }, requirePocketFileForChanges() { return true; }, clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, expandPathToNode() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {}, focusRowByNodeId() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(callback) { callback?.(); return 1; }, flashTouchedRow() {}, setStatus(...args) { statuses.push(plain(args)); }, saveLastSaveSnapshot() {}, saveLocalSafetySnapshot() { return true; },
    confirm() { return options.confirm !== false; }, document: { readyState: "loading", addEventListener() {}, getElementById() { return null; }, head: { appendChild() {} }, createElement() { return {}; } }, setTimeout() { return 1; },
    PocketDeviceChanges: { cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } }, coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; }, describeDocumentTransition() { return { ok: true, records: [] }; } },
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS, MULTI]) vm.runInContext(source(file), context, { filename: file });
  context.refreshSaveState = context.refreshMeta = context.renderTree = context.persistPipSnapshot = context.refocusTreeNavigation = context.focusRowByNodeId = context.softlyEnsureSelectionVisible = () => {};
  context.__statuses = () => plain(statuses); return context;
}

function captured(context, sequence) { const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence); return frozen ? plain(frozen.operations) : null; }
function deleteMany(context) { assert.equal(context.deleteMultiSelectionIfActive(), true); return plain(context.state.ops.at(-1)); }

test("P158 captures effective multi roots once in visible order with progressive sibling indices and no descendants", () => {
  const before = [node("a", "root", 10), node("b", "root", 20), node("c", "root", 30), node("d", "root", 40), node("child", "b", 1)], context = runtime(before, { selectedId: "b", multiSelectedIds: ["d"], visible: ["b", "d", "a", "c", "child"] });
  const current = deleteMany(context);
  assert.deepEqual({ type: current.type, ids: current.ids, rootCount: current.rootCount, subtreeCount: current.subtreeCount }, { type: "delete_many", ids: ["b", "d"], rootCount: 2, subtreeCount: 3 });
  assert.deepEqual(captured(context, current.seq), [{ type: "delete", input: { nodeId: "b", fromIndex: 1 } }, { type: "delete", input: { nodeId: "d", fromIndex: 2 } }]);
  assert.equal(captured(context, current.seq).some((entry) => entry.input.nodeId === "child"), false);
  assert.deepEqual(context.state.nodes.map((entry) => entry.id), ["a", "c"]); assert.deepEqual(context.state.tombstones.map((entry) => entry.id), ["b", "d", "child"]);
});

test("P158 reduces selected descendants and preserves root order across parents", () => {
  const before = [node("p", "root", 10), node("q", "root", 20), node("x", "p", 10), node("desc", "x", 20), node("y", "p", 30), node("m", "q", 10), node("n", "q", 20)], context = runtime(before, { selectedId: "n", multiSelectedIds: ["x", "desc", "y"], visible: ["n", "x", "desc", "y", "m", "p", "q"] });
  const current = deleteMany(context);
  assert.deepEqual(current.ids, ["n", "x", "y"]); assert.deepEqual(captured(context, current.seq), [{ type: "delete", input: { nodeId: "n", fromIndex: 1 } }, { type: "delete", input: { nodeId: "x", fromIndex: 0 } }, { type: "delete", input: { nodeId: "y", fromIndex: 0 } }]);
  assert.equal(captured(context, current.seq).some((entry) => entry.input.nodeId === "desc"), false);
});

test("P158 lets an existing branch delete fully while capturing only its root and composes genuine P139 deletes", async () => {
  const before = [node("before", "root", 10), node("branch", "root", 20), node("child", "branch", 700), node("grandchild", "child", 3), node("after", "root", 90), node("other", "root", 100)], context = runtime(before, { selectedId: "other", multiSelectedIds: ["branch"], visible: ["branch", "other", "before", "child", "grandchild", "after"] });
  context.recordOp({ type: "add_below", id: "child" });
  const current = deleteMany(context), operations = captured(context, current.seq);
  assert.deepEqual(operations, [{ type: "delete", input: { nodeId: "branch", fromIndex: 1 } }, { type: "delete", input: { nodeId: "other", fromIndex: 2 } }]); assert.deepEqual(context.state.tombstones.map((entry) => entry.id), ["branch", "other", "child", "grandchild"]);
  const relation = await composeCapturedThroughP139(before, operations);
  assert.deepEqual(relation.children.root, ["before", "after"]); assert.equal(relation.parents.branch, ""); assert.equal(relation.parents.child, "branch"); assert.equal(relation.parents.grandchild, "child");
});

test("P158 fails closed for every unsafe root while the current delete_many remains authoritative", () => {
  for (const type of ["add_below", "add_path"]) {
    const context = runtime([node("settled", "root", 10), node("new", "root", 20), node("after", "root", 30)], { selectedId: "settled", multiSelectedIds: ["new"] }); context.recordOp({ type, id: "new" });
    const current = deleteMany(context); assert.equal(current.type, "delete_many"); assert.deepEqual(captured(context, current.seq), []); assert.deepEqual(context.state.nodes.map((entry) => entry.id), ["after"]); assert.deepEqual(context.state.tombstones.map((entry) => entry.id), ["settled", "new"]);
  }
  const bucket = runtime([node("bucket", "root", 10), node("other", "root", 20), node("after", "root", 30)], { selectedId: "bucket", multiSelectedIds: ["other"], managed: true }); const current = deleteMany(bucket);
  assert.deepEqual(captured(bucket, current.seq), []); assert.deepEqual(bucket.state.nodes.map((entry) => entry.id), ["after"]);
});

test("P158 helper validation and unavailable planning/capture seams are observational", () => {
  const helper = runtime([node("a"), node("b")]), helperOperation = helper.recordOp({ type: "delete_many" });
  assert.equal(helper.capturePocketStarlingNodeDeletes(helperOperation.seq, [{ nodeId: "a", fromIndex: 0 }, { nodeId: "a", fromIndex: 1 }]), false); assert.deepEqual(captured(helper, helperOperation.seq), []);
  for (const mutate of [
    (context) => { context.capturePocketStarlingNodeDeletes = undefined; },
    (context) => { context.sortNodesForParent = () => { throw new Error("order unavailable"); }; },
    (context) => { context.isManagedSystemBucketNode = () => { throw new Error("classifier unavailable"); }; },
  ]) {
    const context = runtime([node("a", "root", 10), node("b", "root", 20), node("c", "root", 30)], { selectedId: "a", multiSelectedIds: ["b"] }); mutate(context);
    const current = deleteMany(context); assert.equal(current.type, "delete_many"); assert.deepEqual(captured(context, current.seq), []); assert.deepEqual(context.state.nodes.map((entry) => entry.id), ["c"]);
  }
  const unavailable = runtime([node("a", "root", 10), node("b", "root", 20), node("c", "root", 30)], { selectedId: "a", multiSelectedIds: ["b"] }); unavailable.PocketStarlingOwnerWorkingSetShadow = undefined; assert.equal(unavailable.resetPocketStarlingOwnerWorkingSetJournal(), false);
  const current = deleteMany(unavailable); assert.equal(current.type, "delete_many"); assert.equal(unavailable.freezePocketStarlingOwnerWorkingSetThrough(current.seq), null); assert.deepEqual(unavailable.state.nodes.map((entry) => entry.id), ["c"]);
});

test("P158 cancellation is silent and bulk undo stays unclaimed", () => {
  const cancelled = runtime([node("a"), node("b")], { selectedId: "a", multiSelectedIds: ["b"], confirm: false }); assert.equal(cancelled.deleteMultiSelectionIfActive(), true); assert.deepEqual(cancelled.state.ops, []); assert.deepEqual(captured(cancelled, 1), []);
  const undoable = runtime([node("a"), node("b"), node("c")], { selectedId: "a", multiSelectedIds: ["b"] }); const forward = deleteMany(undoable); const forwards = captured(undoable, forward.seq); undoable.undoLastDeleteAction(); const undo = plain(undoable.state.ops.at(-1)); assert.equal(undo.type, "undo_delete_many"); assert.deepEqual(captured(undoable, undo.seq), forwards); assert.equal(captured(undoable, undo.seq).some((entry) => entry.type === "restore"), false);
});

function logicalRuntime() {
  const context = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error, btoa(value) { return Buffer.from(value, "binary").toString("base64"); }, atob(value) { return Buffer.from(value, "base64").toString("binary"); }, console: { log() {}, info() {}, warn() {}, error() {} }, localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  context.window = context; context.globalThis = context; vm.createContext(context); for (const file of LOGICAL) vm.runInContext(source(file), context, { filename: file }); return context;
}

async function composeCapturedThroughP139(nodes, operations) {
  const context = logicalRuntime(), byId = new Map(nodes.map((entry) => [entry.id, entry])), children = {};
  for (const entry of nodes) children[entry.id] = [];
  for (const entry of nodes) { const parentId = entry.parentId || "root"; if (!children[parentId]) children[parentId] = []; children[parentId].push(entry.id); }
  for (const ids of Object.values(children)) ids.sort((left, right) => (Number(byId.get(left)?.order) || 0) - (Number(byId.get(right)?.order) || 0));
  const relation = { nodeIds: nodes.map((entry) => entry.id), parents: Object.fromEntries(nodes.map((entry) => [entry.id, entry.parentId || "root"])), children }, encoded = context.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-02T00:00:00.000Z", nodes, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), root = context.PocketStarlingRootShadow.build(encoded.bridge), structural = context.PocketStarlingPlacementShadow.build(relation, { capacity: 4 }), witness = context.PocketStarlingRootShadow.diagnosticRootFor({ capacity: root.state.capacity, content: root.state.content, placements: structural.model.placements, children: structural.model.children, preservation: root.state.preservation }), stager = context.PocketStarlingObjectSealShadow.createStager(), staged = context.PocketStarlingObjectSealShadow.stageCandidate(stager, { schema: context.PocketStarlingRootShadow.SCHEMA, capacity: root.state.capacity, content: root.state.content, structural: structural.model, preservation: root.state.preservation, root: witness.root }, { previousSealRef: null }), resolveLogical = (ref) => stager.store.get(ref), semantic = await semanticBase(context, { acceptedSealRef: staged.stage.sealRef, resolveLogical, syncedPocketId: "p158" }), opened = await context.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: staged.stage.sealRef, resolveLogical, ...semantic }), composed = await context.PocketStarlingLogicalEditShadow.compose(opened.base, operations), resolve = (ref) => composed.candidate.resolveLogical(ref) || resolveLogical(ref), audited = context.PocketStarlingObjectSealShadow.auditCandidateSeal(composed.candidate.sealRef, resolve), materialised = context.PocketStarlingPlacementShadow.materialise(audited.candidate.structural);
  assert.equal(encoded.ok && root.ok && structural.ok && witness.ok && staged.ok && opened.ok && composed.ok && audited.ok && materialised.ok, true); return plain(materialised.relation);
}

test("P158 remains limited to its multi-delete capture seam", () => {
  const history = source(HISTORY), multi = source(MULTI), actions = source(ACTIONS);
  assert.match(history, /function capturePocketStarlingNodeDeletes\(sequence, deletes\)/); assert.match(multi, /function deleteMultiSelectionIfActive\(\)/); assert.match(multi, /capturePocketStarlingNodeDeletes\(deleteManyOperation\?\.seq, completePlan\)/);
  assert.doesNotMatch(multi, /LogicalEdit|RemoteEdit|RemoteSave|PocketOwnerSaveBoundary|compareAndSetShadowHead/); assert.match(actions, /capturePocketStarlingNodeDelete/); assert.match(history, /function capturePocketStarlingNodeDelete\(sequence, nodeId, fromIndex\)/);
});
