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
const OWNER = "js/pocket-owner-save-boundary.js";
const OVERLAYS = "js/pocket-overlays-init.js";
const RENDER = "js/pocket-render.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function node(id, label, parentId = "root", order = 1001) {
  return {
    id,
    parentId,
    order,
    label,
    source: "manual",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

function runtime(nodes = [
  node("a", "Anchor", "root", 10),
  node("b", "Beta", "root", 20),
  node("c", "Charlie", "root", 30),
]) {
  class HTMLElement {
    constructor() {
      this.tagName = "DIV";
      this.isContentEditable = false;
    }
    focus() {}
    select() {}
  }
  class HTMLInputElement extends HTMLElement {
    constructor() {
      super();
      this.tagName = "INPUT";
      this.value = "";
      this.attributes = new Map();
    }
    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  }

  const storage = new Map();
  const input = new HTMLInputElement();
  const session = { id: 270, ownerKind: "json" };
  let sessionCurrent = true;
  let nextId = 0;
  let saveCount = 0;
  let safetyWrites = 0;
  const savedTrees = [];

  const context = {
    console,
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
      source: { schema: "portal.export.v1", fileName: "p270.pocket", writtenAt: "" },
    },
    lastMoveUndoSnapshot: null,
    lastEditUndoSnapshot: null,
    lastDeleteUndoSnapshot: null,
    lastTreeUndoKind: "",
    el: {
      search: new HTMLInputElement(),
      treeRoot: {
        querySelector(selector) {
          const match = String(selector).match(/data-edit-id="([^"]+)"/);
          if (!match) return null;
          return input.getAttribute("data-edit-id") === match[1] ? input : null;
        },
      },
    },
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
    },
    DEVICE_CHANGE_SEQUENCE_KEY: "p270.sequence",
    CSS: { escape(value) { return String(value); } },
    nowIso() { return "2026-09-27T01:00:00.000Z"; },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, maximum);
    },
    makeId() {
      nextId += 1;
      return `p270-new-${nextId}`;
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
    expandPathToNode() {
      const id = context.state.inlineEdit?.id || context.state.selectedId;
      let current = context.nodeMap().get(id) || null;
      while (current) {
        context.state.collapsed.delete(current.id);
        const parentId = current.parentId || "root";
        if (parentId === "root") break;
        current = context.nodeMap().get(parentId) || null;
      }
    },
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
    saveLocalSafetySnapshot() { safetyWrites += 1; return true; },
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
    capturePocketFileSaveSession() { return session; },
    isPocketFileSaveSessionCurrent(candidate) { return candidate === session && sessionCurrent; },
    saveCurrentContext() {
      saveCount += 1;
      savedTrees.push(plain(context.state.nodes));
      return "saved";
    },
    __input: input,
    __setSessionCurrent(value) { sessionCurrent = !!value; },
    __saveCount() { return saveCount; },
    __savedTrees: savedTrees,
    __safetyWrites() { return safetyWrites; },
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

  context.inspectActiveInlineTitleDraft = () => {
    const edit = context.state.inlineEdit || {};
    const id = context.cleanText(edit.id, 80);
    const found = id ? (context.nodeMap().get(id) || null) : null;
    return {
      active: !!id,
      id,
      edit,
      input: id ? input : null,
      node: found,
      value: id ? String(input.value || "") : "",
    };
  };

  vm.runInContext(source(OWNER), context, { filename: OWNER });

  return context;
}

function setDraft(context, value) {
  const id = context.state.inlineEdit.id;
  assert.ok(id, "active inline draft required");
  context.__input.setAttribute("data-edit-id", id);
  context.__input.value = String(value);
  return id;
}

function capturedWorking(context, sequence = 999) {
  const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence);
  return frozen ? plain(frozen.operations) : null;
}

function treeTruth(context) {
  return plain(context.state.nodes.map((entry) => ({
    id: entry.id,
    parentId: entry.parentId,
    order: entry.order,
    label: entry.label,
  })));
}

test("P270 global Ctrl/Cmd+S remains routed to saveCurrentContext with no inline-input Save owner", () => {
  const overlays = source(OVERLAYS);
  const render = source(RENDER);
  assert.match(overlays, /if \(key === "s"\) \{[\s\S]*?saveCurrentContext\(\);/);
  assert.doesNotMatch(render, /(?:metaKey|ctrlKey)[\s\S]{0,160}key === "s"/);
  assert.doesNotMatch(render, /saveCurrentContext\(\)/);
});

test("P270 blank NEW sibling + Save restores exact pre-provisional truth and saves exactly once", () => {
  const context = runtime();
  const beforeTree = treeTruth(context);
  const beforeTombstones = plain(context.state.tombstones);
  const beforeOps = plain(context.state.ops);
  const beforeHighWater = context.state.operationHighWater;
  const beforeWorking = capturedWorking(context);
  const beforeSafety = context.__safetyWrites();

  context.state.selectedId = "a";
  context.insertSiblingBelow("a");
  const provisionalId = setDraft(context, "   ");
  assert.ok(context.nodeMap().has(provisionalId));
  assert.notDeepEqual(treeTruth(context), beforeTree, "staging may renumber siblings");

  assert.equal(context.saveCurrentContext(), "saved");

  assert.equal(context.__saveCount(), 1);
  assert.deepEqual(treeTruth(context), beforeTree);
  assert.deepEqual(plain(context.state.tombstones), beforeTombstones);
  assert.deepEqual(plain(context.state.ops), beforeOps);
  assert.equal(context.state.operationHighWater, beforeHighWater);
  assert.deepEqual(capturedWorking(context), beforeWorking);
  assert.equal(context.__safetyWrites(), beforeSafety);
  assert.equal(context.state.inlineEdit.id, "");
  assert.equal(context.state.selectedId, "a");
  assert.deepEqual(context.__savedTrees[0].map((entry) => entry.id), ["a", "b", "c"]);
});

test("P270 blank NEW child + Save restores staging-only expansion/collapse and selection, then saves once", () => {
  const context = runtime([
    node("parent", "Parent", "root", 10),
    node("existing", "Existing", "parent", 17),
    node("peer", "Peer", "root", 20),
  ]);
  context.state.selectedId = "parent";
  context.state.collapsed = new Set(["parent"]);
  const beforeTree = treeTruth(context);

  context.insertChildUnder("parent");
  const provisionalId = setDraft(context, "");
  assert.equal(context.state.collapsed.has("parent"), false, "staging expands the parent");
  assert.equal(context.state.selectedId, provisionalId);

  assert.equal(context.saveCurrentContext(), "saved");

  assert.equal(context.__saveCount(), 1);
  assert.deepEqual(treeTruth(context), beforeTree);
  assert.equal(context.state.collapsed.has("parent"), true);
  assert.equal(context.state.selectedId, "parent");
  assert.equal(context.state.tombstones.length, 0);
  assert.equal(context.state.ops.length, 0);
  assert.equal(context.state.operationHighWater, 0);
});

test("P270 provisional discard preserves unrelated prior Undo owner and Starling working operations", () => {
  const context = runtime();
  context.state.selectedId = "a";
  context.beginInlineEdit("a", { isNew: false, originalLabel: "Anchor" });
  setDraft(context, "Anchor renamed");
  assert.equal(context.commitInlineEdit("a", "Anchor renamed").ok, true);
  const beforeTree = treeTruth(context);
  const beforeOps = plain(context.state.ops);
  const beforeHighWater = context.state.operationHighWater;
  const beforeWorking = capturedWorking(context, beforeHighWater);
  const priorUndo = context.lastEditUndoSnapshot;
  const priorKind = context.lastTreeUndoKind;

  context.insertSiblingBelow("a");
  setDraft(context, "");
  assert.notStrictEqual(context.lastEditUndoSnapshot, priorUndo, "staging temporarily owns edit Undo");

  assert.equal(context.saveCurrentContext(), "saved");

  assert.deepEqual(treeTruth(context), beforeTree);
  assert.deepEqual(plain(context.state.ops), beforeOps);
  assert.equal(context.state.operationHighWater, beforeHighWater);
  assert.deepEqual(capturedWorking(context, beforeHighWater), beforeWorking);
  assert.strictEqual(context.lastEditUndoSnapshot, priorUndo, "prior edit Undo identity restored");
  assert.equal(context.lastTreeUndoKind, priorKind);
  assert.equal(context.state.tombstones.length, 0);
});

test("P270 Escape on blank NEW uses non-semantic provisional discard", () => {
  const context = runtime();
  const before = treeTruth(context);
  context.state.selectedId = "b";
  context.insertSiblingBelow("b");
  const id = setDraft(context, "");

  context.cancelInlineEdit(id);

  assert.deepEqual(treeTruth(context), before);
  assert.equal(context.state.inlineEdit.id, "");
  assert.equal(context.state.selectedId, "b");
  assert.deepEqual(plain(context.state.tombstones), []);
  assert.deepEqual(plain(context.state.ops), []);
  assert.equal(context.state.operationHighWater, 0);
  assert.deepEqual(capturedWorking(context), []);
});

test("P270 blank-new Enter/blur commit path uses the same non-semantic discard owner", () => {
  const context = runtime();
  const before = treeTruth(context);
  context.state.selectedId = "a";
  context.insertSiblingBelow("a");
  const id = setDraft(context, "");

  const result = context.commitInlineEdit(id, "");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "blank-title");
  assert.equal(result.discarded, true);
  assert.deepEqual(treeTruth(context), before);
  assert.equal(context.state.inlineEdit.id, "");
  assert.deepEqual(plain(context.state.tombstones), []);
  assert.deepEqual(plain(context.state.ops), []);
  assert.equal(context.state.operationHighWater, 0);
});

test("P270 blank EXISTING rename + Save remains invalid and does not delete, blank or Save truth", () => {
  const context = runtime();
  const before = treeTruth(context);
  context.state.selectedId = "b";
  context.beginInlineEdit("b", { isNew: false, originalLabel: "Beta" });
  setDraft(context, "   ");

  assert.equal(context.saveCurrentContext(), false);

  assert.equal(context.__saveCount(), 0);
  assert.deepEqual(treeTruth(context), before);
  assert.equal(context.nodeMap().get("b").label, "Beta");
  assert.equal(context.state.inlineEdit.id, "b", "draft remains available for correction");
  assert.equal(context.state.tombstones.length, 0);
  assert.equal(context.state.ops.length, 0);
});

test("P270 valid NEW + Save still commits once then ordinary Save once", () => {
  const context = runtime();
  context.state.selectedId = "a";
  context.insertSiblingBelow("a");
  const id = setDraft(context, "Fresh");

  assert.equal(context.saveCurrentContext(), "saved");

  assert.equal(context.__saveCount(), 1);
  assert.equal(context.state.inlineEdit.id, "");
  assert.equal(context.nodeMap().get(id).label, "Fresh");
  assert.equal(context.state.ops.filter((entry) => entry.type === "add_below" && entry.id === id).length, 1);
  assert.equal(context.state.tombstones.length, 0);
});

test("P270 valid EXISTING rename + Save still commits once then ordinary Save once", () => {
  const context = runtime();
  context.state.selectedId = "b";
  context.beginInlineEdit("b", { isNew: false, originalLabel: "Beta" });
  setDraft(context, "Beta renamed");

  assert.equal(context.saveCurrentContext(), "saved");

  assert.equal(context.__saveCount(), 1);
  assert.equal(context.nodeMap().get("b").label, "Beta renamed");
  assert.equal(context.state.ops.filter((entry) => entry.type === "rename" && entry.id === "b").length, 1);
  assert.equal(context.state.tombstones.length, 0);
});

test("P270 no active draft remains ordinary Save exactly once", () => {
  const context = runtime();
  assert.equal(context.saveCurrentContext(), "saved");
  assert.equal(context.__saveCount(), 1);
});

test("P270 stale owner/session protection blocks blank-new discard and Save", () => {
  const context = runtime();
  context.state.selectedId = "a";
  context.insertSiblingBelow("a");
  const id = setDraft(context, "");
  context.__setSessionCurrent(false);

  assert.equal(context.saveCurrentContext(), false);

  assert.equal(context.__saveCount(), 0);
  assert.equal(context.state.inlineEdit.id, id);
  assert.ok(context.nodeMap().has(id), "stale session leaves the draft untouched rather than guessing");
  assert.equal(context.state.tombstones.length, 0);
  assert.equal(context.state.ops.length, 0);
});

test("P270 committed-node delete semantics remain semantic and unchanged", () => {
  const context = runtime();
  assert.equal(context.deleteNodeById("b", { confirm: false }), true);
  assert.equal(context.nodeMap().has("b"), false);
  assert.equal(context.state.tombstones.some((entry) => entry.id === "b"), true);
  assert.equal(context.state.ops.filter((entry) => entry.type === "delete" && entry.id === "b").length, 1);
  assert.ok(context.state.operationHighWater > 0);
});

test("P270 source has one provisional discard owner and no provisional route through semantic delete", () => {
  const history = source(HISTORY);
  const actions = source(ACTIONS);
  const owner = source(OWNER);

  assert.match(history, /function discardNewInlineProvisional\(nodeId, options = \{\}\)/);
  assert.match(history, /function discardActiveNewInlineEditForOwnerSwitch\(/);
  assert.match(history, /cancelInlineEdit[\s\S]*?discardNewInlineProvisional\(nodeId/);
  assert.match(history, /commitInlineEdit[\s\S]*?discardNewInlineProvisional\(nodeId/);
  assert.doesNotMatch(history, /deleteNodeById\(nodeId, \{ confirm: false, provisionalCleanup: true \}\)/);
  assert.match(actions, /captureNewInlineProvisionalContinuity\(\)/);
  assert.match(owner, /blankNewProvisional/);
  assert.match(owner, /discardActiveNewInlineEditForOwnerSwitch/);
});
