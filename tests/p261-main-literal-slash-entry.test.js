"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SHADOW = "js/pocket-starling-owner-working-set-shadow.js";
const HISTORY = "js/pocket-history-status.js";
const ACTIONS = "js/pocket-tree-actions.js";
const RENDER = "js/pocket-render.js";
const IMPORT = "js/pocket-import.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function node(id, parentId = "root", order = 1001, extra = {}) {
  return {
    id,
    parentId,
    order,
    label: id,
    source: "manual",
    updatedAt: "2026-09-22T00:00:00.000Z",
    ...extra,
  };
}

function runtime(nodes = [node("a")]) {
  class HTMLElement { focus() {} select() {} }
  class HTMLInputElement extends HTMLElement {
    constructor() {
      super();
      this.value = "";
    }
  }

  const storage = new Map();
  let nextId = 0;
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect,
    JSON, Date, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: {
      nodes: plain(nodes),
      tombstones: [],
      rootExtras: {},
      dataExtras: {},
      collapsed: new Set(),
      selectedId: "",
      focusRootId: "",
      moveMode: false,
      inlineEdit: { id: "", isNew: false },
      ops: [],
      operationHighWater: 0,
      operationDocumentAnchor: null,
      activeSaveOperationCeiling: 0,
      documentBaseline: null,
      source: { schema: "portal.export.v1", fileName: "p261.pocket", writtenAt: "" },
    },
    lastMoveUndoSnapshot: null,
    lastEditUndoSnapshot: null,
    lastDeleteUndoSnapshot: null,
    lastTreeUndoKind: "",
    el: { search: new HTMLInputElement() },
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
    },
    DEVICE_CHANGE_SEQUENCE_KEY: "p261.sequence",
    nowIso() { return "2026-09-22T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, maximum);
    },
    makeId() {
      nextId += 1;
      return `new-${nextId}`;
    },
    compareSiblingOrder(left, right) {
      return (Number(left.order) || 0) - (Number(right.order) || 0)
        || String(left.label || "").localeCompare(String(right.label || ""));
    },
    nodeMap() {
      return new Map(context.state.nodes.map((entry) => [entry.id, entry]));
    },
    childrenMap() {
      const result = new Map();
      for (const entry of context.state.nodes) {
        const parent = entry.parentId || "root";
        if (!result.has(parent)) result.set(parent, []);
        result.get(parent).push(entry);
      }
      for (const entries of result.values()) entries.sort(context.compareSiblingOrder);
      return result;
    },
    maxSiblingOrder(parentId) {
      return Math.max(
        1000,
        ...context.state.nodes
          .filter((entry) => (entry.parentId || "root") === (parentId || "root"))
          .map((entry) => Number(entry.order) || 0)
      );
    },
    isManagedSystemBucketNode() { return false; },
    isCompletedSystemBucketNode() { return false; },
    requirePocketFileForChanges() { return true; },
    clearInlineEditState() {
      context.state.inlineEdit = { id: "", isNew: false };
    },
    expandPathToNode() {},
    refreshSaveState() {},
    refreshMeta() {},
    renderTree() {},
    persistPipSnapshot() {},
    refocusTreeNavigation() {},
    focusRowByNodeId() {},
    softlyEnsureSelectionVisible() {},
    requestAnimationFrame(callback) { callback?.(); return 1; },
    flashTouchedRow() {},
    setStatus() {},
    saveLastSaveSnapshot() {},
    saveLocalSafetySnapshot() { return true; },
    PocketDeviceChanges: {
      cloneJsonCompatible(value) {
        try { return { ok: true, value: plain(value) }; }
        catch { return { ok: false }; }
      },
      coerceDocument(value) {
        return {
          ok: true,
          document: plain({
            nodes: value.nodes || [],
            tombstones: value.tombstones || [],
            rootExtras: value.rootExtras || {},
            dataExtras: value.dataExtras || {},
          }),
        };
      },
      describeDocumentTransition() { return { ok: true, records: [] }; },
    },
  };

  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS]) {
    vm.runInContext(source(file), context, { filename: file });
  }
  context.refreshSaveState = () => {};
  context.refreshMeta = () => {};
  context.renderTree = () => {};
  context.persistPipSnapshot = () => {};
  context.refocusTreeNavigation = () => {};
  context.focusRowByNodeId = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  context.setStatus = () => {};
  return context;
}

function captured(context, sequence) {
  const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence);
  return frozen ? plain(frozen.operations) : null;
}

function addSibling(context, label) {
  const beforeIds = new Set(context.state.nodes.map((entry) => entry.id));
  context.insertSiblingBelow("a");
  const id = context.state.inlineEdit.id;
  const result = context.commitInlineEdit(id, label);
  const added = context.state.nodes.filter((entry) => !beforeIds.has(entry.id));
  return { id, result, added, operation: context.state.ops.at(-1) };
}

test("P261 original slash prose becomes one literal node with ordinary add capture and no Focus", () => {
  const context = runtime([node("a")]);
  const label = "if it is an image file / Word doc / Spreadsheet";
  const beforeCount = context.state.nodes.length;
  const { id, result, added, operation } = addSibling(context, label);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "add");
  assert.equal(result.label, label);
  assert.equal(context.state.nodes.length, beforeCount + 1);
  assert.equal(added.length, 1);
  assert.equal(added[0].id, id);
  assert.equal(added[0].label, label);
  assert.equal(context.state.nodes.some((entry) => entry.parentId === id), false);
  assert.equal(context.state.focusRootId, "");
  assert.equal(context.state.selectedId, id);
  assert.equal(operation.type, "add_below");
  assert.equal(operation.label, label);
  assert.equal(context.state.ops.some((entry) => entry.type === "import_paths_inline"), false);
  assert.deepEqual(captured(context, operation.seq).map((entry) => entry.type), ["insert"]);
  assert.equal(captured(context, operation.seq)[0].input.payload.label, label);
});

test("P261 /ignored/path is an ordinary literal add, never hierarchy or path-import semantics", () => {
  const context = runtime([node("a")]);
  const { id, result, added, operation } = addSibling(context, "/ignored/path");

  assert.equal(result.kind, "add");
  assert.equal(result.label, "/ignored/path");
  assert.equal(added.length, 1);
  assert.equal(added[0].label, "/ignored/path");
  assert.equal(context.state.nodes.some((entry) => entry.parentId === id), false);
  assert.equal(operation.type, "add_below");
  assert.equal(operation.label, "/ignored/path");
  assert.equal(context.state.ops.some((entry) => entry.type === "import_paths_inline"), false);
  assert.notEqual(result.kind, "path-import");
  assert.equal(context.state.focusRootId, "");
  assert.deepEqual(captured(context, operation.seq).map((entry) => entry.type), ["insert"]);
});

test("P261 slash rename is one ordinary rename and preserves pre-existing explicit Focus", () => {
  const context = runtime([node("a"), node("focus", "root", 1002)]);
  context.state.selectedId = "a";
  context.state.focusRootId = "focus";
  context.state.inlineEdit = { id: "a", isNew: false, originalLabel: "a" };

  const beforeIds = context.state.nodes.map((entry) => entry.id);
  const result = context.commitInlineEdit("a", "Image / Word / Spreadsheet");

  assert.equal(result.ok, true);
  assert.equal(result.kind, "rename");
  assert.equal(result.label, "Image / Word / Spreadsheet");
  assert.deepEqual(context.state.nodes.map((entry) => entry.id), beforeIds);
  assert.equal(context.nodeMap().get("a").label, "Image / Word / Spreadsheet");
  assert.equal(context.state.focusRootId, "focus");
  assert.equal(context.state.ops.length, 1);
  assert.equal(context.state.ops[0].type, "rename");
  assert.equal(context.state.ops[0].to, "Image / Word / Spreadsheet");
  assert.equal(context.state.ops.some((entry) => entry.type === "import_paths_inline"), false);
  assert.deepEqual(captured(context, context.state.ops[0].seq).map((entry) => entry.type), ["payload"]);
});

test("P261 ordinary non-slash labels still use the same add and rename owners", () => {
  const context = runtime([node("a")]);
  const added = addSibling(context, "Ordinary label");
  assert.equal(added.result.kind, "add");
  assert.equal(added.operation.type, "add_below");
  assert.equal(added.added[0].label, "Ordinary label");

  context.state.inlineEdit = { id: "a", isNew: false, originalLabel: "a" };
  const renamed = context.commitInlineEdit("a", "Ordinary rename");
  assert.equal(renamed.kind, "rename");
  assert.equal(context.state.ops.at(-1).type, "rename");
});

test("P261 owner-switch draft validation treats slash text exactly like an ordinary label", () => {
  const context = runtime();
  const direct = context.validateCapturedInlineDraftValue("/ignored/path");
  assert.equal(direct.ok, true);
  assert.equal(direct.value, "/ignored/path");
  assert.equal(Object.prototype.hasOwnProperty.call(direct, "slashBatch"), false);

  const prose = context.validateCapturedInlineDraftValue("if it is an image file / Word doc / Spreadsheet");
  assert.equal(prose.ok, true);
  assert.equal(prose.value, "if it is an image file / Word doc / Spreadsheet");
  assert.equal(Object.prototype.hasOwnProperty.call(prose, "slashBatch"), false);
});

test("P261 Main inline paste has no structural interception and therefore feeds normal input/commit semantics", () => {
  const render = source(RENDER);
  const editStart = render.indexOf('const input = document.createElement("input")');
  const editEnd = render.indexOf('input.addEventListener("keydown"', editStart);
  assert.ok(editStart >= 0 && editEnd > editStart);
  const inlineInputSetup = render.slice(editStart, editEnd);

  assert.doesNotMatch(inlineInputSetup, /addEventListener\("paste"/);
  assert.doesNotMatch(inlineInputSetup, /parseCaptureSlashPathBatch/);
  assert.doesNotMatch(inlineInputSetup, /preventDefault\(\).*paste/s);

  const context = runtime([node("a")]);
  const pastedText = "if it is an image file / Word doc / Spreadsheet";
  const result = addSibling(context, pastedText);
  assert.equal(result.result.kind, "add");
  assert.equal(result.added[0].label, pastedText);
});

test("P261 Main inline production owns no slash parser, path-import op, or Focus assignment", () => {
  const history = source(HISTORY);
  const render = source(RENDER);

  assert.doesNotMatch(history, /parseCaptureSlashPathBatch/);
  assert.doesNotMatch(render, /parseCaptureSlashPathBatch/);
  assert.doesNotMatch(history, /import_paths_inline/);
  assert.doesNotMatch(history, /kind:\s*"path-import"/);

  const commitStart = history.indexOf("function commitInlineEdit");
  const commitEnd = history.indexOf("\nfunction inlineDraftInputBelongsToNode", commitStart);
  assert.ok(commitStart >= 0 && commitEnd > commitStart);
  const commitSource = history.slice(commitStart, commitEnd);
  assert.doesNotMatch(commitSource, /focusRootId\s*=/);
  assert.doesNotMatch(commitSource, /ensurePathNode/);
});

test("P261 slash parser remains only for the explicit import owner chain", () => {
  const importSource = source(IMPORT);
  assert.match(importSource, /function parseCaptureSlashPathBatch\(rawText\)/);
  assert.match(importSource, /function extractSlashPathsFromText\(rawText\)[\s\S]*?parseCaptureSlashPathBatch\(text\)/);
  assert.match(importSource, /function queuePathImport\(rawText, options = \{\}\)[\s\S]*?extractSlashPathsFromText\(rawText\)/);

  const production = {
    history: source(HISTORY),
    render: source(RENDER),
    import: importSource,
  };
  assert.equal((production.history.match(/parseCaptureSlashPathBatch/g) || []).length, 0);
  assert.equal((production.render.match(/parseCaptureSlashPathBatch/g) || []).length, 0);
  assert.equal((production.import.match(/parseCaptureSlashPathBatch/g) || []).length, 2);
});
