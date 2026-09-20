"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ACTIONS = "js/pocket-tree-actions.js";
const SHADOW = "js/pocket-starling-owner-working-set-shadow.js";
const HISTORY = "js/pocket-history-status.js";

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function node(id, parentId = "root", order = 1001, extra = {}) {
  return { id, parentId, order, label: id, updatedAt: "2026-09-20T00:00:00.000Z", ...extra };
}

class FakeHTMLElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.isContentEditable = false;
    this.focusCount = 0;
    this.selectCount = 0;
  }
  focus() { this.focusCount += 1; }
  select() { this.selectCount += 1; }
}
class FakeInput extends FakeHTMLElement {
  constructor() { super("input"); }
}

function runtime(nodes, selectedId) {
  const storage = new Map();
  const search = new FakeInput();
  const treeTarget = new FakeHTMLElement("div");
  const counts = {
    refreshSaveState: 0,
    renderTree: 0,
    persistPipSnapshot: 0,
    refocus: 0,
    rename: 0,
    focusHere: 0,
    status: [],
  };

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, structuredClone,
    HTMLElement: FakeHTMLElement,
    HTMLInputElement: FakeInput,
    CSS: { escape(value) { return String(value); } },
    document: { querySelector() { return null; }, body: new FakeHTMLElement("body") },
    el: { search, treeWrap: treeTarget },
    state: {
      nodes: plain(nodes),
      tombstones: [],
      rootExtras: {},
      dataExtras: {},
      collapsed: new Set(),
      selectedId,
      focusRootId: "",
      moveMode: false,
      inlineEdit: { id: "", isNew: false },
      typeJump: { query: "", cycle: 0, lastAt: 0 },
      ops: [],
      operationHighWater: 0,
      operationDocumentAnchor: null,
      activeSaveOperationCeiling: 0,
      documentBaseline: null,
      source: { schema: "portal.export.v1", fileName: "p229.json", writtenAt: "" },
    },
    lastMoveUndoSnapshot: null,
    lastEditUndoSnapshot: null,
    lastDeleteUndoSnapshot: null,
    lastTreeUndoKind: "",
    pendingPathImport: null,
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
    },
    DEVICE_CHANGE_SEQUENCE_KEY: "p229.sequence",
    nowIso() { return "2026-09-20T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, maximum); },
    compareSiblingOrder(left, right) {
      return (Number(left.order) || 0) - (Number(right.order) || 0)
        || String(left.label || "").localeCompare(String(right.label || ""));
    },
    nodeMap() { return new Map(context.state.nodes.map((entry) => [entry.id, entry])); },
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
    clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false }; },
    expandPathToNode() {},
    refreshSaveState() { counts.refreshSaveState += 1; },
    refreshMeta() {},
    renderTree() { counts.renderTree += 1; },
    persistPipSnapshot() { counts.persistPipSnapshot += 1; },
    refocusTreeNavigation(id) { counts.refocus += 1; context.__lastRefocus = id; },
    softlyEnsureSelectionVisible() {},
    requestAnimationFrame(callback) { callback?.(); return 1; },
    flashTouchedRow() {},
    setStatus(message, kind, options) { counts.status.push({ message, kind, options: !!options }); },
    saveLocalSafetySnapshot() { return true; },
    isDetailsEditorOpen() { return false; },
    renameSelected() { counts.rename += 1; },
    toggleFocusHere() { counts.focusHere += 1; },
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
  for (const file of [SHADOW, HISTORY, ACTIONS]) vm.runInContext(source(file), context, { filename: file });
  return { context, counts, search, treeTarget };
}

function key(target, keyName, modifiers = {}) {
  return {
    target,
    key: keyName,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    getModifierState() { return false; },
    ...modifiers,
  };
}

function byId(context, id) { return context.state.nodes.find((entry) => entry.id === id); }

test("P229 actual Main Shift+Tab path reaches existing outdent owner exactly once and preserves branch structure", () => {
  const initial = [
    node("grand", "root", 1001),
    node("parent", "grand", 1001),
    node("selected", "parent", 1001),
    node("descendant", "selected", 1001),
    node("parent-peer", "parent", 1002),
    node("unrelated", "grand", 1002),
    node("unrelated-child", "unrelated", 1001),
  ];
  const h = runtime(initial, "selected");
  const beforeUnrelated = plain([
    byId(h.context, "unrelated"),
    byId(h.context, "unrelated-child"),
  ]);

  const event = key(h.treeTarget, "Tab", { shiftKey: true });
  h.context.handleTreeKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(byId(h.context, "selected").parentId, "grand");
  assert.equal(byId(h.context, "descendant").parentId, "selected");
  assert.equal(byId(h.context, "parent-peer").parentId, "parent");
  assert.deepEqual(plain([
    byId(h.context, "unrelated"),
    byId(h.context, "unrelated-child"),
  ]), beforeUnrelated);
  assert.equal(h.context.state.selectedId, "selected");
  assert.equal(h.context.__lastRefocus, "selected");
  assert.equal(h.search.focusCount, 0);
  assert.equal(h.search.selectCount, 0);

  const outdentOps = h.context.state.ops.filter((entry) => entry.type === "outdent");
  assert.equal(outdentOps.length, 1, "one Shift+Tab must cause exactly one outdent operation");
  assert.equal(h.counts.refreshSaveState, 1);
  assert.equal(h.context.lastTreeUndoKind, "move");
  assert.equal(h.context.lastMoveUndoSnapshot?.kind, "outdent");

  const seq = outdentOps[0].seq;
  const captured = plain(h.context.freezePocketStarlingOwnerWorkingSetThrough(seq).operations);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].type, "payload");
  assert.equal(captured[0].input.nodeId, "selected");
  assert.deepEqual(captured[1], {
    type: "move",
    input: { nodeId: "selected", fromIndex: 0, newParentId: "grand", toIndex: 1 },
  });

  h.context.undoLastMoveAction();
  assert.equal(byId(h.context, "selected").parentId, "parent");
  assert.equal(byId(h.context, "descendant").parentId, "selected");
  assert.deepEqual(plain([
    byId(h.context, "unrelated"),
    byId(h.context, "unrelated-child"),
  ]), beforeUnrelated);
});

test("P229 plain Tab still reaches existing indent owner exactly once", () => {
  const h = runtime([
    node("first", "root", 1001),
    node("selected", "root", 1002),
    node("descendant", "selected", 1001),
    node("other", "root", 1003),
  ], "selected");

  const event = key(h.treeTarget, "Tab");
  h.context.handleTreeKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(byId(h.context, "selected").parentId, "first");
  assert.equal(byId(h.context, "descendant").parentId, "selected");
  assert.equal(byId(h.context, "other").parentId, "root");
  assert.equal(h.context.state.ops.filter((entry) => entry.type === "indent").length, 1);
  assert.equal(h.context.state.selectedId, "selected");
  assert.equal(h.context.__lastRefocus, "selected");
  assert.equal(h.counts.refreshSaveState, 1);
});

test("P229 top-level Shift+Tab retains existing fail-safe without structural corruption", () => {
  const initial = [node("selected", "root", 1001), node("other", "root", 1002)];
  const h = runtime(initial, "selected");
  const event = key(h.treeTarget, "Tab", { shiftKey: true });

  h.context.handleTreeKeydown(event);

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(plain(h.context.state.nodes), initial);
  assert.equal(h.context.state.ops.length, 0);
  assert.equal(h.counts.refreshSaveState, 0);
  assert.match(h.counts.status.at(-1)?.message || "", /already at the top level/i);
  assert.equal(h.search.focusCount, 0);
  assert.equal(h.search.selectCount, 0);
});

test("P229 search/input-owned Shift+Tab remains outside Main structural ownership", () => {
  const h = runtime([node("a"), node("b")], "b");
  const before = plain(h.context.state.nodes);
  const event = key(h.search, "Tab", { shiftKey: true });

  h.context.handleTreeKeydown(event);

  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(plain(h.context.state.nodes), before);
  assert.equal(h.context.state.ops.length, 0);
  assert.equal(h.search.focusCount, 0);
  assert.equal(h.search.selectCount, 0);
});

test("P229 preserves F2, Shift+F and modified-arrow routes", () => {
  {
    const h = runtime([node("a")], "a");
    const event = key(h.treeTarget, "F2");
    h.context.handleTreeKeydown(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.counts.rename, 1);
  }
  {
    const h = runtime([node("a")], "a");
    const event = key(h.treeTarget, "F", { shiftKey: true });
    h.context.handleTreeKeydown(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.counts.focusHere, 1);
  }
  {
    const h = runtime([node("a", "root", 1001), node("b", "root", 1002)], "b");
    const event = key(h.treeTarget, "ArrowUp", { ctrlKey: true });
    h.context.handleTreeKeydown(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(h.context.sortNodesForParent("root").map((entry) => entry.id), ["b", "a"]);
    assert.equal(h.context.state.ops.filter((entry) => entry.type === "move_up").length, 1);
  }
});

test("P229 source guard leaves one Main structural Tab owner and no Shift+Tab search-focus competitor", () => {
  const actions = source(ACTIONS);
  const start = actions.indexOf("function handleTreeKeydown(ev)");
  assert.ok(start >= 0);
  const handler = actions.slice(start);

  assert.doesNotMatch(handler, /ev\.shiftKey[\s\S]{0,120}ev\.key === "Tab"[\s\S]{0,240}el\.search\.(?:focus|select)/);
  assert.equal((handler.match(/if \(ev\.key !== "Tab"\) return;/g) || []).length, 1);
  assert.equal((handler.match(/if \(ev\.shiftKey\) outdentNodeById\(state\.selectedId\);/g) || []).length, 1);
  assert.equal((handler.match(/else indentNodeById\(state\.selectedId\);/g) || []).length, 1);

  const peRuntime = source("js/pocket-node-popout-runtime.js");
  assert.match(peRuntime, /if\(ev\.key==="Tab"\)\{ev\.preventDefault\(\);indentBranch\(index,ev\.shiftKey\?-1:1\);return;\}/);
});
