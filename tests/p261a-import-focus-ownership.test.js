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
const IMPORT = "js/pocket-import.js";
const RENDER = "js/pocket-render.js";
const IO = "js/pocket-io-browser.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function node(id, label = id, parentId = "root", order = 1001) {
  return {
    id,
    parentId,
    order,
    label,
    source: "manual",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

function runtime(nodes) {
  class HTMLElement { focus() {} select() {} }
  class HTMLInputElement extends HTMLElement {
    constructor() {
      super();
      this.value = "";
    }
  }

  const storage = new Map();
  const snapshots = [];
  const statuses = [];
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
      source: { schema: "portal.export.v1", fileName: "p261a.pocket", writtenAt: "" },
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
    DEVICE_CHANGE_SEQUENCE_KEY: "p261a.sequence",
    nowIso() { return "2026-09-22T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, maximum);
    },
    makeId() {
      nextId += 1;
      return `p261a-${nextId}`;
    },
    compareSiblingOrder(left, right) {
      return (Number(left.order) || 0) - (Number(right.order) || 0)
        || String(left.label || "").localeCompare(String(right.label || ""));
    },
    maxSiblingOrder(parentId) {
      return Math.max(
        1000,
        ...context.state.nodes
          .filter((entry) => (entry.parentId || "root") === (parentId || "root"))
          .map((entry) => Number(entry.order) || 0)
      );
    },
    getPath(nodeId) { return String(nodeId || ""); },
    isManagedSystemBucketNode() { return false; },
    isCompletedSystemBucketNode() { return false; },
    requirePocketFileForChanges() { return true; },
    clearInlineEditState() {
      context.state.inlineEdit = { id: "", isNew: false };
    },
    expandPathToNode() {},
    refreshSaveState() {},
    refreshMeta() {},
    renderTree() {
      snapshots.push({
        selectedId: context.state.selectedId,
        focusRootId: context.state.focusRootId,
        labels: context.state.nodes.map((entry) => [entry.id, entry.parentId, entry.label]),
      });
    },
    persistPipSnapshot() {},
    refocusTreeNavigation() {},
    focusRowByNodeId() {},
    softlyEnsureSelectionVisible() {},
    requestAnimationFrame(callback) { callback?.(); return 1; },
    flashTouchedRow() {},
    setStatus(...args) { statuses.push(plain(args)); },
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
    __snapshots: snapshots,
    __statuses: statuses,
  };

  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [SHADOW, HISTORY, ACTIONS, IMPORT]) {
    vm.runInContext(source(file), context, { filename: file });
  }

  context.renderTree = () => {
    snapshots.push({
      selectedId: context.state.selectedId,
      focusRootId: context.state.focusRootId,
      labels: context.state.nodes.map((entry) => [entry.id, entry.parentId, entry.label]),
    });
  };
  context.refreshSaveState = () => {};
  context.refreshMeta = () => {};
  context.persistPipSnapshot = () => {};
  context.refocusTreeNavigation = () => {};
  context.focusRowByNodeId = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  return context;
}

function findByLabel(context, label, parentId = null) {
  return context.state.nodes.find((entry) => (
    entry.label === label
    && (parentId === null || (entry.parentId || "root") === parentId)
  )) || null;
}

test("P261a queue + commit with empty Focus preserve empty Focus while selecting/revealing and importing", () => {
  const context = runtime([node("a", "A")]);

  const result = context.queuePathImport("/A/B");

  assert.equal(result, 1);
  assert.ok(context.__snapshots.length >= 2);
  assert.equal(context.__snapshots[0].selectedId, "a", "queue stage still selects existing import target");
  assert.equal(context.__snapshots[0].focusRootId, "", "queue stage must not start Focus");
  assert.equal(context.state.focusRootId, "", "commit must leave empty Focus empty");

  const b = findByLabel(context, "B", "a");
  assert.ok(b, "explicit import still creates intended hierarchy");
  assert.equal(context.state.selectedId, b.id, "commit still selects imported result");
  assert.equal(context.state.ops.some((entry) => entry.type === "add_path" && entry.id === b.id), true);

  const aggregate = context.state.ops.at(-1);
  assert.equal(aggregate.type, "import_paths");
  assert.equal(aggregate.pathCount, 1);
  assert.equal(aggregate.created, 1);
});

test("P261a direct commit with empty Focus creates hierarchy and records normal import without entering Focus", () => {
  const context = runtime([node("existing", "Existing")]);

  const result = context.commitPathImport({
    entries: [{ effectiveParts: ["C", "D"] }],
    pathCount: 1,
    anchorHeadId: "",
    autoAnchorHeadLabel: "",
  });

  assert.equal(result, 1);
  const c = findByLabel(context, "C", "root");
  const d = c ? findByLabel(context, "D", c.id) : null;
  assert.ok(c);
  assert.ok(d);
  assert.equal(context.state.selectedId, c.id);
  assert.equal(context.state.focusRootId, "");
  assert.equal(context.state.ops.at(-1).type, "import_paths");
  assert.equal(context.state.ops.at(-1).created, 2);
});

test("P261a queue + commit preserve an existing explicit Focus root exactly", () => {
  const context = runtime([
    node("focus", "Focus", "root", 1001),
    node("other", "Other", "root", 1002),
  ]);
  context.state.focusRootId = "focus";
  context.state.selectedId = "other";

  const result = context.queuePathImport("/Focus/New");

  assert.equal(result, 1);
  assert.ok(context.__snapshots.length >= 2);
  assert.equal(context.__snapshots[0].selectedId, "focus", "queue still selects resolved import target");
  assert.equal(context.__snapshots[0].focusRootId, "focus", "queue must preserve explicit Focus");
  assert.equal(context.state.focusRootId, "focus", "commit must preserve explicit Focus");

  const created = findByLabel(context, "New", "focus");
  assert.ok(created);
  assert.equal(context.state.selectedId, created.id);
  assert.equal(context.state.ops.at(-1).type, "import_paths");
});

test("P261a direct commit does not replace or clear an existing explicit Focus root", () => {
  const context = runtime([
    node("focus", "Focus", "root", 1001),
    node("other", "Other", "root", 1002),
  ]);
  context.state.focusRootId = "focus";

  const result = context.commitPathImport({
    entries: [{ effectiveParts: ["More", "Leaf"] }],
    pathCount: 1,
    anchorHeadId: "focus",
    autoAnchorHeadLabel: "",
  });

  assert.equal(result, 1);
  const more = findByLabel(context, "More", "focus");
  const leaf = more ? findByLabel(context, "Leaf", more.id) : null;
  assert.ok(more);
  assert.ok(leaf);
  assert.equal(context.state.selectedId, more.id);
  assert.equal(context.state.focusRootId, "focus");
  assert.equal(context.state.ops.at(-1).type, "import_paths");
});

test("P261a import owner contains no Focus assignment while selection/reveal machinery remains", () => {
  const importSource = source(IMPORT);
  const queueStart = importSource.indexOf("function queuePathImport");
  const queueEnd = importSource.indexOf("\nfunction commitPendingPathImport", queueStart);
  const commitStart = importSource.indexOf("function commitPathImport");
  const commitEnd = importSource.indexOf("\n}", commitStart) + 2;
  assert.ok(queueStart >= 0 && queueEnd > queueStart && commitStart >= 0 && commitEnd > commitStart);

  const queueSource = importSource.slice(queueStart, queueEnd);
  const commitSource = importSource.slice(commitStart, importSource.length);

  assert.doesNotMatch(queueSource, /state\.focusRootId\s*=/);
  assert.doesNotMatch(commitSource, /state\.focusRootId\s*=/);
  assert.match(queueSource, /state\.selectedId = importTargetNode\.id/);
  assert.match(commitSource, /state\.selectedId = focusNode\.id/);
  assert.match(queueSource, /expandPathToNode\(importTargetNode\.id\)/);
  assert.match(commitSource, /expandPathToNode\(focusNode\.id\)/);
  assert.match(commitSource, /type:\s*"import_paths"/);
});

test("P261a explicit slash importer remains intact and browser import callers still use it", () => {
  const importSource = source(IMPORT);
  const ioSource = source(IO);

  assert.match(importSource, /function parseCaptureSlashPathBatch\(rawText\)/);
  assert.match(importSource, /function extractSlashPathsFromText\(rawText\)[\s\S]*?parseCaptureSlashPathBatch\(text\)/);
  assert.match(importSource, /function queuePathImport\(rawText, options = \{\}\)[\s\S]*?extractSlashPathsFromText\(rawText\)/);
  assert.ok((ioSource.match(/queuePathImport\(text, \{/g) || []).length >= 2);
});

test("P261a preserves reviewed P261 literal Main-entry ownership", () => {
  const history = source(HISTORY);
  const render = source(RENDER);

  assert.doesNotMatch(history, /parseCaptureSlashPathBatch/);
  assert.doesNotMatch(render, /parseCaptureSlashPathBatch/);
  assert.doesNotMatch(history, /import_paths_inline/);
  assert.doesNotMatch(history, /kind:\s*"path-import"/);

  const context = runtime([node("a", "A")]);
  context.insertSiblingBelow("a");
  const id = context.state.inlineEdit.id;
  const prose = "if it is an image file / Word doc / Spreadsheet";
  const result = context.commitInlineEdit(id, prose);

  assert.equal(result.kind, "add");
  assert.equal(context.nodeMap().get(id).label, prose);
  assert.equal(context.state.nodes.some((entry) => (entry.parentId || "root") === id), false);
  assert.equal(context.state.focusRootId, "");
  assert.equal(context.state.ops.some((entry) => entry.type === "import_paths_inline"), false);
});
