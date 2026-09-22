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

function runtime(nodes = [node("a0")]) {
  class HTMLElement { focus() {} select() {} }
  class HTMLInputElement extends HTMLElement {
    constructor() {
      super();
      this.value = "";
      this.tagName = "INPUT";
      this.isContentEditable = false;
    }
    getAttribute() { return ""; }
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
      selectedId: nodes[0]?.id || "",
      focusRootId: "",
      moveMode: false,
      inlineEdit: { id: "", isNew: false },
      captureRhythm: { parentId: "", lastAddedId: "", expiresAt: 0 },
      ops: [],
      operationHighWater: 0,
      operationDocumentAnchor: null,
      activeSaveOperationCeiling: 0,
      documentBaseline: null,
      source: { schema: "portal.export.v1", fileName: "p264.pocket", writtenAt: "" },
    },
    lastMoveUndoSnapshot: null,
    lastEditUndoSnapshot: null,
    lastDeleteUndoSnapshot: null,
    lastTreeUndoKind: "",
    pendingPathImport: null,
    el: {
      search: new HTMLInputElement(),
      treeWrap: new HTMLElement(),
    },
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
    },
    DEVICE_CHANGE_SEQUENCE_KEY: "p264.sequence",
    nowIso() { return "2026-09-22T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, maximum);
    },
    makeId() {
      nextId += 1;
      return `p264-${nextId}`;
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
    isDetailsEditorOpen() { return false; },
    isControlsHelpOpen() { return false; },
    isCommandPaletteOpen() { return false; },
    isPocketVaultRecoveryFlowOpen() { return false; },
    isPocketDeviceChangesDecisionOpen() { return false; },
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

function siblings(context, parentId) {
  return context.sortNodesForParent(parentId).map((entry) => entry.id);
}

function rapidTab(context, value) {
  const id = context.state.inlineEdit.id;
  assert.ok(id, "rapid Tab requires a current inline edit");
  assert.equal(context.state.inlineEdit.isNew, true, "rapid Tab is new-node only");
  const result = context.commitInlineEdit(id, value);
  if (result?.ok && result.kind === "add" && result.id === id) {
    context.insertSiblingBelow(result.id);
  }
  return result;
}

test("P264 single plain Tab commits through ordinary add owner then opens exactly one same-parent sibling", () => {
  const context = runtime([
    node("parent", "root", 1001),
    node("a0", "parent", 1001),
  ]);
  context.state.selectedId = "a0";

  context.insertSiblingBelow("a0");
  const firstId = context.state.inlineEdit.id;
  const firstParent = context.nodeMap().get(firstId).parentId;
  const result = rapidTab(context, "A");

  assert.equal(result.ok, true);
  assert.equal(result.kind, "add");
  assert.equal(result.id, firstId);
  assert.equal(context.nodeMap().get(firstId).label, "A");
  assert.equal(context.nodeMap().get(firstId).parentId, "parent");
  assert.equal(firstParent, "parent");

  const nextId = context.state.inlineEdit.id;
  assert.ok(nextId);
  assert.notEqual(nextId, firstId);
  assert.equal(context.state.inlineEdit.isNew, true);
  assert.equal(context.state.inlineEdit.autoFocus, true);
  assert.equal(context.state.selectedId, nextId);
  assert.equal(context.nodeMap().get(nextId).parentId, "parent");
  assert.deepEqual(siblings(context, "parent"), ["a0", firstId, nextId]);

  const adds = context.state.ops.filter((entry) => entry.type === "add_below");
  assert.equal(adds.length, 1);
  assert.equal(adds[0].id, firstId);
  assert.deepEqual(captured(context, adds[0].seq).map((entry) => entry.type), ["insert"]);
  assert.equal(context.state.ops.some((entry) => ["indent", "outdent"].includes(entry.type)), false);
});

test("P264 A Tab B Tab C Enter yields exactly three committed same-parent siblings and no fourth provisional node", () => {
  const context = runtime([
    node("parent", "root", 1001),
    node("a0", "parent", 1001),
  ]);
  context.state.selectedId = "a0";

  context.insertSiblingBelow("a0");
  const aId = context.state.inlineEdit.id;
  assert.equal(rapidTab(context, "A").ok, true);

  const bId = context.state.inlineEdit.id;
  assert.equal(rapidTab(context, "B").ok, true);

  const cId = context.state.inlineEdit.id;
  const enterResult = context.commitInlineEdit(cId, "C");
  assert.equal(enterResult.ok, true);
  assert.equal(enterResult.kind, "add");

  assert.equal(context.state.inlineEdit.id, "");
  assert.equal(context.state.nodes.filter((entry) => entry.parentId === "parent").length, 4);
  assert.deepEqual(
    context.sortNodesForParent("parent").map((entry) => entry.label),
    ["a0", "A", "B", "C"]
  );
  assert.deepEqual(
    [aId, bId, cId].map((id) => context.nodeMap().get(id).parentId),
    ["parent", "parent", "parent"]
  );

  const adds = context.state.ops.filter((entry) => entry.type === "add_below");
  assert.equal(adds.length, 3);
  assert.deepEqual(adds.map((entry) => entry.label), ["A", "B", "C"]);
  for (const add of adds) {
    assert.deepEqual(captured(context, add.seq).map((entry) => entry.type), ["insert"]);
  }
  assert.equal(context.state.ops.some((entry) => ["indent", "outdent"].includes(entry.type)), false);
});

test("P264 Enter commits current new node and ends entry without opening another sibling", () => {
  const context = runtime([node("a0")]);
  context.insertSiblingBelow("a0");
  const id = context.state.inlineEdit.id;
  const countBeforeCommit = context.state.nodes.length;

  const result = context.commitInlineEdit(id, "Only");

  assert.equal(result.ok, true);
  assert.equal(result.kind, "add");
  assert.equal(context.state.inlineEdit.id, "");
  assert.equal(context.state.nodes.length, countBeforeCommit);
  assert.equal(context.nodeMap().get(id).label, "Only");
  assert.equal(context.state.ops.filter((entry) => entry.type === "add_below").length, 1);
});

test("P264 Escape retains existing provisional-new-node cancellation and creates no sibling", () => {
  const context = runtime([node("a0")]);
  context.insertSiblingBelow("a0");
  const id = context.state.inlineEdit.id;

  context.cancelInlineEdit(id);

  assert.equal(context.state.inlineEdit.id, "");
  assert.equal(context.nodeMap().has(id), false);
  assert.equal(context.state.nodes.length, 1);
  assert.equal(context.state.ops.filter((entry) => entry.type === "add_below").length, 0);
});

test("P264 blank Tab commit fails and therefore creates no follow-on sibling", () => {
  const context = runtime([node("a0")]);
  context.insertSiblingBelow("a0");
  const id = context.state.inlineEdit.id;

  const result = rapidTab(context, "   ");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "blank-title");
  assert.equal(context.nodeMap().has(id), false);
  assert.equal(context.state.inlineEdit.id, "");
  assert.equal(context.state.nodes.length, 1);
  assert.equal(context.state.ops.filter((entry) => entry.type === "add_below").length, 0);
});

test("P264 render owns plain new-node Tab only; Shift+Tab and rename Tab remain native/blur paths", () => {
  const render = source(RENDER);
  const inputStart = render.indexOf('const input = document.createElement("input")');
  const inputEnd = render.indexOf('input.addEventListener("blur"', inputStart);
  assert.ok(inputStart >= 0 && inputEnd > inputStart);
  const setup = render.slice(inputStart, inputEnd);

  assert.equal((setup.match(/ev\.key === "Tab"/g) || []).length, 1);
  assert.match(setup, /ev\.key === "Tab"[\s\S]{0,180}!ev\.shiftKey[\s\S]{0,260}state\.inlineEdit\.isNew === true/);
  assert.match(setup, /const result = finishCommit\(\);[\s\S]{0,180}result\?\.ok[\s\S]{0,120}result\.kind === "add"[\s\S]{0,160}insertSiblingBelow\(result\.id\)/);
  assert.doesNotMatch(setup, /postAction/);
  assert.doesNotMatch(setup, /indentNodeById|outdentNodeById/);
});

test("P264 ordinary Main Tab has no structural owner while explicit structural Arrow and Move-mode owners remain", () => {
  const actions = source(ACTIONS);
  const start = actions.indexOf("function handleTreeKeydown(ev)");
  assert.ok(start >= 0);
  const handler = actions.slice(start);

  assert.doesNotMatch(handler, /ev\.key !== "Tab"[\s\S]{0,180}(?:indentNodeById|outdentNodeById)/);
  assert.doesNotMatch(handler, /ev\.key === "Tab"[\s\S]{0,180}(?:indentNodeById|outdentNodeById|insertSiblingBelow)/);

  assert.match(handler, /\(ev\.metaKey \|\| ev\.ctrlKey\)[\s\S]{0,260}\["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"\][\s\S]{0,400}ArrowLeft"\) outdentNodeById\(state\.selectedId\)[\s\S]{0,80}else indentNodeById\(state\.selectedId\)/);
  assert.match(handler, /if \(state\.moveMode\)[\s\S]{0,420}ArrowLeft"\) outdentNodeById\(state\.selectedId\)[\s\S]{0,120}ArrowRight"\) indentNodeById\(state\.selectedId\)/);
});

test("P264 commitInlineEdit has no hidden postAction structural dispatch", () => {
  const history = source(HISTORY);
  const start = history.indexOf("function commitInlineEdit");
  const end = history.indexOf("\nfunction inlineDraftInputBelongsToNode", start);
  assert.ok(start >= 0 && end > start);
  const commit = history.slice(start, end);

  assert.doesNotMatch(commit, /postAction/);
  assert.doesNotMatch(commit, /indentNodeById|outdentNodeById/);
});

test("P264 P261 literal slash entry remains one ordinary node and never starts Focus", () => {
  const context = runtime([node("a0")]);
  context.insertSiblingBelow("a0");
  const id = context.state.inlineEdit.id;
  const label = "if it is an image file / Word doc / Spreadsheet";

  const result = context.commitInlineEdit(id, label);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "add");
  assert.equal(context.nodeMap().get(id).label, label);
  assert.equal(context.state.nodes.some((entry) => entry.parentId === id), false);
  assert.equal(context.state.focusRootId, "");
  assert.equal(context.state.ops.some((entry) => entry.type === "import_paths_inline"), false);
});

test("P264 does not alter PE Tab indentation owner", () => {
  const peRuntime = source("js/pocket-node-popout-runtime.js");
  assert.match(peRuntime, /if\(ev\.key==="Tab"\)\{ev\.preventDefault\(\);indentBranch\(index,ev\.shiftKey\?-1:1\);return;\}/);
});
