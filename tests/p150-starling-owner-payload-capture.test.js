"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, ".."), files = {
  shadow: "js/pocket-starling-owner-working-set-shadow.js",
  history: "js/pocket-history-status.js",
  details: "js/pocket-editor-copy.js",
  handoff: "js/pocket-editor-handoff.js",
  popout: "js/pocket-node-popout-editor.js",
};

function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }

function runtime(options = {}) {
  class HTMLElement { focus() {} select() {} }
  class HTMLInputElement extends HTMLElement { constructor(value = "") { super(); this.value = value; this.checked = false; } }
  class HTMLTextAreaElement extends HTMLElement { constructor(value = "") { super(); this.value = value; } }
  const storage = new Map(), overlay = new HTMLElement();
  overlay.hidden = false;
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Promise, structuredClone,
    HTMLElement, HTMLInputElement, HTMLTextAreaElement,
    state: {
      nodes: [options.node || { id: "n1", parentId: "root", order: 0, label: "One", details: "Before", updatedAt: "2026-09-02T00:00:00.000Z" }],
      tombstones: [], rootExtras: {}, dataExtras: {}, collapsed: new Set(), selectedId: "n1", focusRootId: "", moveMode: false,
      inlineEdit: { id: "", isNew: false }, detailsEdit: { id: "", draftOpRecorded: false, draftOperationSequence: 0, draftHadCoveredSave: false },
      ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0, documentBaseline: null,
      source: { schema: "portal.export.v1", fileName: "p150.json", writtenAt: "" },
    },
    el: { detailOverlay: overlay, detailEditorLabel: new HTMLInputElement(), detailEditorBody: new HTMLTextAreaElement(), detailEditorUrgent: new HTMLInputElement(), detailEditorCopyContext: new HTMLInputElement() },
    document: { readyState: "complete", addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } },
    DEVICE_CHANGE_SEQUENCE_KEY: "p150.sequence",
    nowIso() { return "2026-09-02T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); },
    nodeMap() { return new Map(context.state.nodes.map((node) => [node.id, node])); }, getPath(id) { return id; },
    normaliseDetails(value) { return String(value || "").replace(/\r/g, "").trim(); }, normaliseUrgentFlag(value) { return value === true; }, normaliseCopyContextFlag(value) { return value === true; },
    parseUrgentDetailsBody(value) { return { details: String(value || "").trim(), urgent: false }; }, hasCompletionTag() { return false; }, stripCompletionTags(value) { return value; },
    isManagedSystemBucketNode() { return false; }, isCompletedSystemBucketNode() { return false; }, moveNodeIntoCompletedSystemBucket() { return { moved: false, bucketId: "" }; },
    clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; }, refocusTreeNavigation() {}, refreshMeta() {}, renderTree() {}, persistPipSnapshot() {}, focusRowByNodeId() {}, flashTouchedRow() {},
    requestAnimationFrame(callback) { callback?.(); return 1; }, setStatus() {}, requirePocketFileForChanges() { return true; }, saveLocalSafetySnapshot() { return true; }, clearLocalSafetySnapshot() {}, resetPocketOperationAnchor() { return true; },
    PocketDeviceChanges: {
      cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } },
      coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; },
      describeDocumentTransition() { return { ok: true, records: [] }; },
    },
    canModifyPocket() { return true; }, isPocketFilePermissionPromptOpen() { return false; }, isPocketEditorSourceIdentityCurrent() { return true; },
    capturePocketFileSaveSession() { return { ownerKind: "json" }; }, PocketOutlinePersistencePolicy: { allowsLocalFileText() { return true; } }, buildPocketPayload() { return { ok: true }; },
    saveWorkspaceState() {}, exportTree() { return Promise.resolve({ ok: true }); },
    PocketNodePopoutTarget: { getById(id) { return context.nodeMap().get(id) || null; }, get(id) { return context.nodeMap().get(id) || null; } },
    PocketNodePopoutModel: {
      buildPayload() { return {}; }, classifyNodeEditor() { return { kind: "text" }; },
      prepareSave(node, payload) { return { ok: true, changed: true, beforeLabel: node.label, nextLabel: String(payload.title || node.label), titleChanged: String(payload.title || node.label) !== node.label, notesChanged: true, nextDetails: String(payload.body || ""), editorChanged: false }; },
    },
    __storage: storage,
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of [files.shadow, files.history, files.details, files.handoff, files.popout]) vm.runInContext(source(file), context, { filename: file });
  context.refreshMeta = () => {}; context.renderTree = () => {}; context.persistPipSnapshot = () => {}; context.refocusTreeNavigation = () => {}; context.focusRowByNodeId = () => {}; context.setStatus = () => {}; context.PocketDetailDirtyState = { refresh() {} };
  context.parseCaptureSlashPathBatch = () => ({ matched: false, ok: true });
  return context;
}

function editorPayload(node, changes = {}) {
  return { id: node.id, title: node.label, body: node.details || "", originalUpdatedAt: node.updatedAt, fileSessionId: 1, sourceFileName: "p150.json", sourcePipSession: false, sourceOwnerKind: "json", sourceVaultSessionId: "", ...changes };
}

function openDetails(context, values = {}) {
  const node = context.state.nodes[0];
  context.state.detailsEdit = { id: node.id, originalLabel: node.label, originalDetails: node.details || "", originalUrgent: !!node.urgent, originalCopyContext: !!node.copyContext, draftOpRecorded: false, draftOperationSequence: 0, draftHadCoveredSave: false };
  context.el.detailOverlay.hidden = false;
  context.el.detailEditorLabel.value = values.label ?? node.label;
  context.el.detailEditorBody.value = values.details ?? node.details ?? "";
  context.el.detailEditorUrgent.checked = values.urgent ?? !!node.urgent;
  context.el.detailEditorCopyContext.checked = values.copyContext ?? !!node.copyContext;
}

test("P150a captures only genuine current sequences, preserves exact own payload keys, and fails observationally for uncapturable material", () => {
  const node = { id: "p150", parentId: "parent", order: 2, label: "Label", details: "Details", urgent: true, copyContext: true, editor: { schema: "current" }, updatedAt: "2026-09-02T01:00:00.000Z", future: { nested: [1, 2] } };
  Object.defineProperty(node, "__proto__", { value: { retained: "as-data" }, enumerable: true, configurable: true, writable: true });
  const context = runtime({ node }), operation = context.recordOp({ type: "legacy" }), before = plain(node);
  assert.equal(context.capturePocketStarlingNodePayload(operation.seq, node), true);
  const captured = context.freezePocketStarlingOwnerWorkingSetThrough(operation.seq).operations[0];
  assert.deepEqual(Object.keys(captured), ["type", "input"]);
  assert.deepEqual(Object.keys(captured.input), ["nodeId", "payload"]);
  assert.equal(captured.input.nodeId, "p150");
  assert.deepEqual(Object.keys(captured.input.payload), ["label", "details", "urgent", "copyContext", "editor", "updatedAt", "future", "__proto__"]);
  assert.deepEqual(plain({ label: captured.input.payload.label, details: captured.input.payload.details, urgent: captured.input.payload.urgent, copyContext: captured.input.payload.copyContext, editor: captured.input.payload.editor, updatedAt: captured.input.payload.updatedAt, future: captured.input.payload.future }), { label: "Label", details: "Details", urgent: true, copyContext: true, editor: { schema: "current" }, updatedAt: "2026-09-02T01:00:00.000Z", future: { nested: [1, 2] } });
  assert.equal(Object.prototype.hasOwnProperty.call(captured.input.payload, "__proto__"), true);
  assert.deepEqual(plain(captured.input.payload.__proto__), { retained: "as-data" });
  assert.notEqual(Object.getPrototypeOf(captured.input.payload), captured.input.payload.__proto__);
  assert.deepEqual(plain(node), before);
  const rejectedState = plain(context.state.ops), rejectedHighWater = context.state.operationHighWater, rejectedAnchor = plain(context.state.operationDocumentAnchor);
  assert.equal(context.capturePocketStarlingNodePayload(operation.seq + 1, node), false);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(operation.seq + 1).operations), [plain(captured)]);
  assert.deepEqual(plain(context.state.ops), rejectedState);
  assert.equal(context.state.operationHighWater, rejectedHighWater);
  assert.deepEqual(plain(context.state.operationDocumentAnchor), rejectedAnchor);
  node.future = { unsafe() {} };
  const uncapturable = context.recordOp({ type: "uncapturable" });
  assert.equal(context.capturePocketStarlingNodePayload(uncapturable.seq, node), false);
  assert.equal(JSON.stringify(context.state.ops).includes("unsafe"), false);
  assert.equal(JSON.stringify([...context.__storage.values()]).includes("unsafe"), false);
});

test("P150 captures existing rename and rename undo only, leaving add undo without semantic Restore", () => {
  const context = runtime(), node = context.state.nodes[0];
  context.state.inlineEdit = { id: node.id, isNew: false, originalLabel: node.label };
  assert.equal(context.commitInlineEdit(node.id, "Renamed").ok, true);
  const rename = context.state.ops.at(-1);
  assert.equal(rename.type, "rename");
  assert.equal(plain(context.freezePocketStarlingOwnerWorkingSetThrough(rename.seq).operations)[0].input.payload.label, "Renamed");
  assert.equal(context.restoreTreeUndoSnapshot({ kind: "rename", nodes: [{ ...node, label: "One" }], tombstones: [], selectedId: node.id, focusRootId: "", collapsed: [] }), true);
  const undo = context.state.ops.at(-1);
  assert.equal(plain(context.freezePocketStarlingOwnerWorkingSetThrough(undo.seq).operations).at(-1).input.payload.label, "One");
  const capturesBeforeAddUndo = plain(context.freezePocketStarlingOwnerWorkingSetThrough(undo.seq).operations);
  assert.equal(context.restoreTreeUndoSnapshot({ kind: "add", nodes: plain(context.state.nodes), tombstones: [], selectedId: node.id, focusRootId: "", collapsed: [] }), true);
  const addUndo = context.state.ops.at(-1);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(addUndo.seq).operations), capturesBeforeAddUndo);
});

test("P150 coalesces Details and handoff payloads by their real draft sequence, then removes uncovered cancellation work", () => {
  const context = runtime(), node = context.state.nodes[0];
  openDetails(context, { details: "First" });
  assert.equal(context.stageDetailsEditorDraft(), true);
  const draftSequence = context.state.detailsEdit.draftOperationSequence;
  context.el.detailEditorBody.value = "Latest";
  assert.equal(context.stageDetailsEditorDraft(), true);
  assert.equal(context.state.ops.length, 1);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(draftSequence).operations), [{ type: "payload", input: { nodeId: node.id, payload: { label: "One", details: "Latest", updatedAt: "2026-09-02T01:00:00.000Z" } } }]);
  assert.equal(context.restoreDetailsDraftOriginal(), true);
  assert.equal(context.state.ops.length, 0);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(draftSequence).operations), []);
  openDetails(context, { details: "Handoff one" });
  context.stageDetailsEditorDraft = undefined;
  context.PocketEditorHandoff.prepare();
  const handoffSequence = context.state.detailsEdit.draftOperationSequence;
  context.el.detailEditorBody.value = "Handoff latest";
  context.PocketEditorHandoff.prepare();
  assert.equal(context.state.ops.length, 1);
  assert.equal(context.state.ops[0].seq, handoffSequence);
  assert.equal(plain(context.freezePocketStarlingOwnerWorkingSetThrough(handoffSequence).operations)[0].input.payload.details, "Handoff latest");
});

test("P150 captures Details final and covered-draft revert under new sequences without inventing bookkeeping semantics", () => {
  const context = runtime(), node = context.state.nodes[0];
  openDetails(context, { details: "Draft" });
  context.stageDetailsEditorDraft();
  const covered = context.state.detailsEdit.draftOperationSequence;
  context.state.activeSaveOperationCeiling = covered;
  assert.equal(context.restoreDetailsDraftOriginal(), true);
  const revert = context.state.ops.at(-1);
  assert.equal(revert.type, "details_draft_reverted");
  assert.equal(plain(context.freezePocketStarlingOwnerWorkingSetThrough(revert.seq).operations).at(-1).input.payload.details, "Before");
  openDetails(context, { details: "Final" });
  context.saveDetailsEditor();
  const final = context.state.ops.at(-1);
  assert.equal(final.type, "details_edit");
  assert.equal(plain(context.freezePocketStarlingOwnerWorkingSetThrough(final.seq).operations).at(-1).input.payload.details, "Final");
});

test("P150 captures changed PE payloads but rejects stale applies and discards a large-outline rollback capture", async () => {
  const context = runtime(), node = context.state.nodes[0];
  const applied = context.PocketNodePopoutEditor.apply(editorPayload(node, { body: "PE final" }), { returnDetails: true });
  assert.equal(applied.ok, true);
  const pe = context.state.ops.at(-1);
  assert.equal(plain(context.freezePocketStarlingOwnerWorkingSetThrough(pe.seq).operations).at(-1).input.payload.details, "PE final");
  const before = plain(context.freezePocketStarlingOwnerWorkingSetThrough(pe.seq).operations);
  assert.equal(context.PocketNodePopoutEditor.apply(editorPayload(node, { originalUpdatedAt: "stale", body: "Rejected" }), { returnDetails: true }).ok, false);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(pe.seq).operations), before);
  context.PocketNodePopoutModel.prepareSave = (current) => ({ ok: true, changed: true, beforeLabel: current.label, nextLabel: current.label, titleChanged: false, notesChanged: false, nextDetails: "", editorChanged: true, editorMeta: { outline: Array.from({ length: 401 }, (_, index) => ({ id: String(index) })) } });
  context.saveLocalSafetySnapshotDurably = async () => false;
  const rollback = await context.PocketNodePopoutEditor.applyAndSave(editorPayload(node));
  assert.equal(rollback.reason, "large-outline-safety-copy-failed");
  assert.equal(context.state.ops.length, 1);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(99).operations), before);
});

test("P150 production seams remain payload-only and do not add Starling authority calls", () => {
  const history = source(files.history), details = source(files.details), handoff = source(files.handoff), popout = source(files.popout);
  assert.match(history, /function capturePocketStarlingNodePayload\(sequence, node\)/);
  assert.match(history, /type: "payload"[\s\S]*input: \{ nodeId, payload \}/);
  for (const program of [history, details, handoff, popout]) assert.doesNotMatch(program, /LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead/);
  assert.match(popout, /discardPocketStarlingOwnerWorkingOperations/);
});
