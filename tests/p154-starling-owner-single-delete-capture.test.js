"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { webcrypto } = require("node:crypto"), { semanticBase } = require("./helpers/starling-semantic-test.js");
const ROOT = path.resolve(__dirname, ".."), SHADOW = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js", ACTIONS = "js/pocket-tree-actions.js";
const LOGICAL = ["js/pocket-state.js", "js/pocket-data.js", "js/pocket-outline-persistence-policy.js", "js/pocket-editor-metadata.js", "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js", "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js", "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js", "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js", "js/pocket-sync-crypto.js", "js/pocket-starling-logical-edit-shadow.js", "js/pocket-starling-semantic-authority-shadow.js"];
function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) { return { id, parentId, order, label: id, updatedAt: "2026-09-02T00:00:00.000Z", ...extra }; }
function runtime(nodes = [node("a")], managed = false) {
  class HTMLElement { focus() {} } class HTMLInputElement extends HTMLElement { constructor() { super(); this.value = ""; } }
  let next = 0; const storage = new Map(), statuses = [], context = { Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: { nodes: plain(nodes), tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "", focusRootId: "", moveMode: false, inlineEdit: { id: "", isNew: false }, ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p154.json", writtenAt: "" } }, lastMoveUndoSnapshot: null, lastEditUndoSnapshot: null, lastDeleteUndoSnapshot: null, lastTreeUndoKind: "", el: { search: new HTMLInputElement() },
    localStorage: { getItem(k) { return storage.get(String(k)) || null; }, setItem(k, v) { storage.set(String(k), String(v)); } }, DEVICE_CHANGE_SEQUENCE_KEY: "p154", nowIso() { return "2026-09-02T01:00:00.000Z"; }, cleanText(v, m = Number.MAX_SAFE_INTEGER) { return String(v || "").trim().slice(0, m); }, makeId() { next += 1; return `new-${next}`; }, compareSiblingOrder(a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.label).localeCompare(String(b.label)); }, nodeMap() { return new Map(context.state.nodes.map((n) => [n.id, n])); }, childrenMap() { const result = new Map(); for (const n of context.state.nodes) { const p = n.parentId || "root"; if (!result.has(p)) result.set(p, []); result.get(p).push(n); } for (const values of result.values()) values.sort(context.compareSiblingOrder); return result; }, maxSiblingOrder(p) { return Math.max(1000, ...context.state.nodes.filter((n) => (n.parentId || "root") === p).map((n) => Number(n.order) || 0)); },
    isManagedSystemBucketNode(n) { return managed && n.id === "bucket"; }, isCompletedSystemBucketNode() { return false; }, requirePocketFileForChanges() { return true; }, clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, expandPathToNode() {}, refreshSaveState() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, refocusTreeNavigation() {}, focusRowByNodeId() {}, softlyEnsureSelectionVisible() {}, requestAnimationFrame(f) { f?.(); }, flashTouchedRow() {}, setStatus(...args) { statuses.push(plain(args)); }, saveLastSaveSnapshot() {}, saveLocalSafetySnapshot() { return true; }, parseCaptureSlashPathBatch() { return { matched: false, ok: true }; }, findChildByLabel() { return null; }, ensurePathNode() { return null; }, PocketDeviceChanges: { cloneJsonCompatible(v) { try { return { ok: true, value: plain(v) }; } catch { return { ok: false }; } }, coerceDocument(v) { return { ok: true, document: plain({ nodes: v.nodes || [], tombstones: v.tombstones || [], rootExtras: v.rootExtras || {}, dataExtras: v.dataExtras || {} }) }; }, describeDocumentTransition() { return { ok: true, records: [] }; } } };
  context.window = context; context.globalThis = context; vm.createContext(context); for (const file of [SHADOW, HISTORY, ACTIONS]) vm.runInContext(source(file), context, { filename: file }); context.refreshSaveState = context.refreshMeta = context.renderTree = context.persistPipSnapshot = context.refocusTreeNavigation = context.focusRowByNodeId = context.softlyEnsureSelectionVisible = () => {}; context.setStatus = (...args) => { statuses.push(plain(args)); }; context.__statuses = () => plain(statuses); return context;
}
function captured(c, seq) { const f = c.freezePocketStarlingOwnerWorkingSetThrough(seq); return f ? plain(f.operations) : null; }
function add(c) { c.insertSiblingBelow("a"); const id = c.state.inlineEdit.id; assert.equal(c.commitInlineEdit(id, "New").ok, true); return { id, op: c.state.ops.at(-1) }; }

test("P154 captures valid existing leaf and branch-root Delete operations before later undo handling", () => {
  const leaf = runtime([node("a", "root", 30), node("target", "root", 70), node("later", "root", 90)]);
  assert.equal(leaf.deleteNodeById("target", { confirm: false }), true); const deleted = leaf.state.ops.at(-1), leafOps = captured(leaf, deleted.seq);
  assert.deepEqual(leafOps, [{ type: "delete", input: { nodeId: "target", fromIndex: 1 } }]); assert.notEqual(leafOps[0].input.fromIndex, 70); assert.equal(leaf.nodeMap().has("target"), false); assert.equal(leaf.state.tombstones.some((entry) => entry.id === "target"), true);
  const original = [node("before", "root", 10), node("branch", "root", 20), node("child", "branch", 700), node("grandchild", "child", 3), node("after", "root", 90)], branch = runtime(original);
  assert.equal(branch.deleteNodeById("branch", { confirm: false }), true); const forward = branch.state.ops.at(-1), branchOps = captured(branch, forward.seq);
  assert.deepEqual(branchOps, [{ type: "delete", input: { nodeId: "branch", fromIndex: 1 } }]); assert.notEqual(branchOps[0].input.fromIndex, 20);
  assert.deepEqual(branch.state.nodes.map((entry) => entry.id), ["before", "after"]); assert.deepEqual(branch.state.tombstones.map((entry) => entry.id), ["branch", "child", "grandchild"]);
  assert.equal(branchOps.some((entry) => entry.input.nodeId === "child" || entry.input.nodeId === "grandchild"), false);
  branch.undoLastDeleteAction(); const undo = branch.state.ops.at(-1), afterUndo = captured(branch, undo.seq);
  assert.equal(undo.type, "undo_delete"); assert.equal(undo.seq, forward.seq + 1); assert.equal(branch.state.operationHighWater, undo.seq); assert.deepEqual(plain(branch.state.nodes), original); assert.deepEqual(branch.state.tombstones, []);
  assert.deepEqual(afterUndo, []); assert.equal(afterUndo.some((entry) => entry.type === "restore" || entry.type === "insert"), false);
});

test("P154 cancels only an exact immediate uncovered manual Insert and fails closed for covered or newer creations", () => {
  const immediate = runtime(), inserted = add(immediate); assert.equal(immediate.deleteNodeById(inserted.id, { confirm: false }), true); const cancelled = immediate.state.ops.at(-1);
  assert.equal(cancelled.type, "delete"); assert.deepEqual(captured(immediate, cancelled.seq), []);
  const covered = runtime(), saved = add(covered); covered.state.activeSaveOperationCeiling = saved.op.seq; covered.deleteNodeById(saved.id, { confirm: false }); assert.deepEqual(captured(covered, covered.state.ops.at(-1).seq).map((entry) => entry.type), ["insert"]);
  const newer = runtime(), stale = add(newer); const later = newer.recordOp({ type: "later" }); newer.deleteNodeById(stale.id, { confirm: false }); assert.deepEqual(captured(newer, newer.state.ops.at(-1).seq).map((entry) => entry.type), ["insert"]); assert.equal(later.seq > stale.op.seq, true);
});

test("P154 treats settled creation as ordinary delete and leaves Cancel and blank provisional cleanup semantically absent", () => {
  const settled = runtime(), created = add(settled); settled.retainPocketOperationsAfterSequence(created.op.seq); settled.deleteNodeById(created.id, { confirm: false }); assert.deepEqual(captured(settled, settled.state.ops.at(-1).seq), [{ type: "delete", input: { nodeId: created.id, fromIndex: 1 } }]);
  const provisional = runtime(); provisional.insertSiblingBelow("a"); provisional.cancelInlineEdit(provisional.state.inlineEdit.id); assert.deepEqual(captured(provisional, 99), []);
  const blank = runtime(); blank.insertSiblingBelow("a"); const blankId = blank.state.inlineEdit.id;
  assert.deepEqual(plain(blank.commitInlineEdit(blankId, "")), { ok: false, reason: "blank-title" }); assert.equal(blank.nodeMap().has(blankId), false); assert.equal(blank.state.ops.at(-1).type, "delete"); assert.deepEqual(blank.state.tombstones.map((entry) => entry.id), [blankId]); assert.deepEqual(captured(blank, blank.state.operationHighWater), []);
  assert.equal(JSON.stringify({ nodes: blank.state.nodes, ops: blank.state.ops, tombstones: blank.state.tombstones }).includes("provisionalCleanup"), false);
  const path = runtime([node("path")]); path.recordOp({ type: "add_path", id: "path" }); path.deleteNodeById("path", { confirm: false }); assert.deepEqual(captured(path, path.state.ops.at(-1).seq), []);
  const bucket = runtime([node("bucket")], true); bucket.deleteNodeById("bucket", { confirm: false }); assert.deepEqual(captured(bucket, bucket.state.ops.at(-1).seq), []);
});

test("P154 leaves current deletion authoritative when the P148 sidecar capture is unavailable", () => {
  const unavailable = runtime([node("before", "root", 10), node("target", "root", 20), node("after", "root", 30)]);
  unavailable.PocketStarlingOwnerWorkingSetShadow = undefined;
  assert.equal(unavailable.resetPocketStarlingOwnerWorkingSetJournal(), false);
  for (const name of ["PocketOwnerSaveBoundary", "PocketStarlingLogicalEditShadow", "PocketStarlingRemoteEditShadow", "PocketStarlingRemoteSaveShadow", "fetch"]) {
    Object.defineProperty(unavailable, name, { configurable: true, get() { throw new Error(`unexpected ${name} access`); } });
  }
  assert.equal(unavailable.deleteNodeById("target", { confirm: false }), true);
  const current = unavailable.state.ops.at(-1);
  assert.deepEqual(unavailable.state.nodes.map((entry) => entry.id), ["before", "after"]); assert.deepEqual(unavailable.state.tombstones.map((entry) => entry.id), ["target"]);
  assert.deepEqual({ type: current.type, id: current.id, subtreeCount: current.subtreeCount, seq: current.seq, highWater: unavailable.state.operationHighWater }, { type: "delete", id: "target", subtreeCount: 1, seq: 1, highWater: 1 });
  assert.equal(unavailable.freezePocketStarlingOwnerWorkingSetThrough(current.seq), null);
  assert.deepEqual(unavailable.__statuses().at(-1).slice(0, 2), ["Deleted 1 item. Ctrl+Z to undo.", "ok"]);
});

async function composeDelete(nodes, operations) {
  const c = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String, Number, Boolean, Promise, Error, btoa(v) { return Buffer.from(v, "binary").toString("base64"); }, atob(v) { return Buffer.from(v, "base64").toString("binary"); }, console: { log() {}, info() {}, warn() {}, error() {} }, localStorage: { getItem() {}, setItem() {}, removeItem() {} }, document: { body: { classList: { add() {}, remove() {}, toggle() {} } }, getElementById() {}, addEventListener() {} }, navigator: { clipboard: {} }, location: { href: "https://example.test" }, indexedDB: null, open() {}, close() {}, setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} }; c.window = c; c.globalThis = c; vm.createContext(c); for (const file of LOGICAL) vm.runInContext(source(file), c, { filename: file });
  const copy = plain(nodes), byId = new Map(copy.map((n) => [n.id, n])), children = {}; for (const n of copy) children[n.id] = []; for (const n of copy) { const p = n.parentId || "root"; if (!children[p]) children[p] = []; children[p].push(n.id); } for (const ids of Object.values(children)) ids.sort((a, b) => Number(byId.get(a).order) - Number(byId.get(b).order)); const relation = { nodeIds: copy.map((n) => n.id), parents: Object.fromEntries(copy.map((n) => [n.id, n.parentId || "root"])), children }, encoded = c.PocketStarlingBridgeShadow.encode({ schema: "portal.mtt.web.v1", writtenAt: "2026-09-02T00:00:00.000Z", nodes: copy, tombstones: [], rootExtras: {}, dataExtras: {} }, { capacity: 4 }), root = c.PocketStarlingRootShadow.build(encoded.bridge), structural = c.PocketStarlingPlacementShadow.build(relation, { capacity: 4 }), witness = c.PocketStarlingRootShadow.diagnosticRootFor({ capacity: root.state.capacity, content: root.state.content, placements: structural.model.placements, children: structural.model.children, preservation: root.state.preservation }), stager = c.PocketStarlingObjectSealShadow.createStager(), staged = c.PocketStarlingObjectSealShadow.stageCandidate(stager, { schema: c.PocketStarlingRootShadow.SCHEMA, capacity: root.state.capacity, content: root.state.content, structural: structural.model, preservation: root.state.preservation, root: witness.root }, { previousSealRef: null }), resolve = (ref) => stager.store.get(ref), semantic = await semanticBase(c, { acceptedSealRef: staged.stage.sealRef, resolveLogical: resolve, syncedPocketId: "p154" }), base = await c.PocketStarlingLogicalEditShadow.createBase({ acceptedSealRef: staged.stage.sealRef, resolveLogical: resolve, ...semantic }), composed = await c.PocketStarlingLogicalEditShadow.compose(base.base, operations), audit = c.PocketStarlingObjectSealShadow.auditCandidateSeal(composed.candidate.sealRef, (ref) => composed.candidate.resolveLogical(ref) || resolve(ref)); return plain(c.PocketStarlingPlacementShadow.materialise(audit.candidate.structural).relation);
}

test("P154 composes the actual branch-root Delete through genuine P139 retained ancestry", async () => {
  const before = [node("before", "root", 10), node("branch", "root", 20), node("child", "branch", 700), node("grandchild", "child", 3), node("after", "root", 90)], context = runtime(before);
  assert.equal(context.deleteNodeById("branch", { confirm: false }), true); const relation = await composeDelete(before, captured(context, context.state.ops.at(-1).seq));
  assert.equal(relation.parents.branch, ""); assert.equal(relation.parents.child, "branch"); assert.equal(relation.parents.grandchild, "child"); assert.deepEqual(relation.children.root, ["before", "after"]);
});

test("P154 stays restricted to the canonical single-root delete seam", () => {
  const history = source(HISTORY), actions = source(ACTIONS);
  assert.match(history, /function capturePocketStarlingNodeDelete\(sequence, nodeId, fromIndex\)/); assert.match(actions, /provisionalCleanup/); assert.match(actions, /capturePocketStarlingNodeDelete/);
  assert.doesNotMatch(history, /LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead/); assert.doesNotMatch(actions, /LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead/);
});
