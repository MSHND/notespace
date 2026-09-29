"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ACTIONS = "js/pocket-tree-actions.js";
const RENDER = "js/pocket-render.js";
const MULTI = "js/pocket-multi-select.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeHarness({ query = "", selectedId = "A" } = {}) {
  class HTMLElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.isContentEditable = false;
      this.value = "";
    }
  }
  class HTMLInputElement extends HTMLElement {
    constructor() {
      super("input");
    }
  }

  const search = new HTMLInputElement();
  search.value = query;
  const target = new HTMLElement("div");
  const statuses = [];
  const applied = [];
  const counters = {
    deleteSelected: 0,
    safetySnapshot: 0,
    refreshMeta: 0,
    renderTree: 0,
    refocus: 0,
    persist: 0,
  };

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect,
    JSON, Date, Math, Promise, HTMLElement, HTMLInputElement,
    state: {
      nodes: [
        { id: "A", parentId: "root", label: "Parent", order: 1001, updatedAt: "t0" },
        { id: "B", parentId: "A", label: "Child", order: 1001, updatedAt: "t0" },
        { id: "C", parentId: "B", label: "Grandchild", order: 1001, updatedAt: "t0" },
        { id: "D", parentId: "root", label: "Sibling", order: 1002, updatedAt: "t0" },
      ],
      tombstones: [],
      collapsed: new Set(),
      selectedId,
      focusRootId: "",
      rowMiniMenuOpen: false,
      rowMiniMenuNodeId: "",
      inlineEdit: { id: "", isNew: false, autoFocus: false },
      moveMode: false,
      typeJump: { query: "", cycle: 0, lastAt: 0 },
      navigationMemory: {},
      rootExtras: {},
      dataExtras: {},
      operationHighWater: 17,
    },
    el: { search },
    pendingPathImport: null,
    pendingDeleteConfirmNodeId: "",
    pendingDeleteConfirmExpiresAt: 0,
    TREE_DELETE_CONFIRM_WINDOW_MS: 12000,
    lastDeleteUndoSnapshot: null,
    lastEditUndoSnapshot: null,
    lastTreeUndoKind: "",
    HTMLElement,
    HTMLInputElement,
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, maximum);
    },
    compareSiblingOrder(left, right) {
      return (Number(left.order) || 0) - (Number(right.order) || 0);
    },
    nodeMap() {
      return new Map(context.state.nodes.map((node) => [node.id, node]));
    },
    childrenMap() {
      const map = new Map();
      for (const node of context.state.nodes) {
        const parentId = node.parentId || "root";
        if (!map.has(parentId)) map.set(parentId, []);
        map.get(parentId).push(node);
      }
      for (const siblings of map.values()) siblings.sort(context.compareSiblingOrder);
      return map;
    },
    requirePocketFileForChanges() { return true; },
    isDetailsEditorOpen() { return false; },
    isControlsHelpOpen() { return false; },
    isCommandPaletteOpen() { return false; },
    isPocketVaultRecoveryFlowOpen() { return false; },
    isPocketDeviceChangesDecisionOpen() { return false; },
    setStatus(message, tone, options) {
      statuses.push({ message: String(message || ""), tone: String(tone || ""), options });
    },
    saveLastSaveSnapshot(payload) {
      counters.safetySnapshot += 1;
      context.lastSafetyPayload = plain(payload);
    },
    nowIso() { return "2026-09-29T02:00:00.000Z"; },
    createTreeUndoSnapshot(kind) {
      return {
        kind,
        nodes: plain(context.state.nodes),
        tombstones: plain(context.state.tombstones),
        selectedId: context.state.selectedId,
        operationHighWater: context.state.operationHighWater,
      };
    },
    currentPocketDirectCreationOperation() { return null; },
    recordOp(operation) {
      context.state.operationHighWater += 1;
      return { ...operation, seq: context.state.operationHighWater };
    },
    capturePocketStarlingNodeDelete() { return false; },
    bindP155DeleteUndoWitness() {},
    isManagedSystemBucketNode() { return false; },
    clearInlineEditState() { context.state.inlineEdit.id = ""; },
    refreshMeta() { counters.refreshMeta += 1; },
    renderTree() { counters.renderTree += 1; },
    refocusTreeNavigation() { counters.refocus += 1; },
    softlyEnsureSelectionVisible() {},
    persistPipSnapshot() { counters.persist += 1; },
    undoLastDeleteAction() {},
    clearFilterAndReturnHome() { return false; },
    clearFocusAndReturnHome() { return false; },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
  };
  context.window = context;
  context.globalThis = context;
  context.window.applyPocketFilterQueryValue = (value, options) => {
    search.value = String(value);
    applied.push({ value: String(value), options: plain(options) });
    return true;
  };
  context.window.settlePocketPendingFilterRender = () => false;

  vm.createContext(context);
  vm.runInContext(source(ACTIONS), context, { filename: ACTIONS });

  context.refocusTreeNavigation = function refocusTreeNavigationHarness() {
    counters.refocus += 1;
  };
  context.softlyEnsureSelectionVisible = function softlyEnsureSelectionVisibleHarness() {};

  context.deleteSelected = function guardedDeleteSelectedHarness() {
    counters.deleteSelected += 1;
    return context.deleteNodeById(context.state.selectedId);
  };

  function keydown(key, overrides = {}) {
    const event = {
      target,
      key,
      code: key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() { this.defaultPrevented = true; },
      defaultPrevented: false,
      ...overrides,
    };
    context.handleTreeKeydown(event);
    return event;
  }

  return { context, target, search, statuses, applied, counters, keydown, HTMLElement, HTMLInputElement };
}

test("P281 empty-filter Backspace is consumed without mutation, arming, Filter work or selection/focus change", () => {
  const h = makeHarness({ query: "", selectedId: "A" });
  const nodesBefore = plain(h.context.state.nodes);
  const tombstonesBefore = plain(h.context.state.tombstones);
  const highWaterBefore = h.context.state.operationHighWater;
  const selectedBefore = h.context.state.selectedId;
  const focusBefore = h.counters.refocus;

  const event = h.keydown("Backspace");

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
  assert.deepEqual(plain(h.context.state.tombstones), tombstonesBefore);
  assert.equal(h.context.state.operationHighWater, highWaterBefore);
  assert.equal(h.context.state.selectedId, selectedBefore);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "");
  assert.equal(h.context.pendingDeleteConfirmExpiresAt, 0);
  assert.equal(h.counters.deleteSelected, 0);
  assert.equal(h.counters.safetySnapshot, 0);
  assert.equal(h.applied.length, 0);
  assert.equal(h.counters.refocus, focusBefore);
});

test("P281 implicit Filter Backspace edits query only, final character clears only, next empty Backspace stays inert", () => {
  const h = makeHarness({ query: "ab", selectedId: "A" });
  const nodesBefore = plain(h.context.state.nodes);

  const first = h.keydown("Backspace");
  assert.equal(first.defaultPrevented, true);
  assert.equal(h.search.value, "a");
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].value, "a");
  assert.equal(h.counters.deleteSelected, 0);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "");

  const second = h.keydown("Backspace");
  assert.equal(second.defaultPrevented, true);
  assert.equal(h.search.value, "");
  assert.equal(h.applied.length, 2);
  assert.equal(h.applied[1].value, "");
  assert.equal(h.applied[1].options.immediate, true);
  assert.equal(h.counters.deleteSelected, 0);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "");

  const third = h.keydown("Backspace");
  assert.equal(third.defaultPrevented, true);
  assert.equal(h.search.value, "");
  assert.equal(h.applied.length, 2);
  assert.equal(h.counters.deleteSelected, 0);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "");
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
});

for (const key of ["Delete", "-", "Subtract"]) {
  test(`P281 deliberate ${key} uses existing two-press guarded subtree delete owner`, () => {
    const h = makeHarness({ selectedId: "A" });
    const nodesBefore = plain(h.context.state.nodes);
    const tombstonesBefore = plain(h.context.state.tombstones);
    const highWaterBefore = h.context.state.operationHighWater;

    const first = h.keydown(key);
    assert.equal(first.defaultPrevented, true);
    assert.equal(h.counters.deleteSelected, 1);
    assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
    assert.deepEqual(plain(h.context.state.tombstones), tombstonesBefore);
    assert.equal(h.context.state.operationHighWater, highWaterBefore);
    assert.equal(h.counters.safetySnapshot, 0);
    assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
    assert.ok(h.context.pendingDeleteConfirmExpiresAt > Date.now());
    assert.match(h.statuses.at(-1).message, /Delete "Parent" and 2 child item\(s\)\?/);
    assert.match(h.statuses.at(-1).message, /whole branch/i);
    assert.match(h.statuses.at(-1).message, /again to confirm/i);

    const second = h.keydown(key);
    assert.equal(second.defaultPrevented, true);
    assert.equal(h.counters.deleteSelected, 2);
    assert.deepEqual(h.context.state.nodes.map((node) => node.id), ["D"]);
    assert.deepEqual(h.context.state.tombstones.map((entry) => entry.id), ["A", "B", "C"]);
    assert.equal(h.context.state.operationHighWater, highWaterBefore + 1);
    assert.equal(h.counters.safetySnapshot, 1);
    assert.equal(h.context.pendingDeleteConfirmNodeId, "");
    assert.equal(h.context.pendingDeleteConfirmExpiresAt, 0);
    assert.equal(h.context.lastTreeUndoKind, "delete");
    assert.ok(h.context.lastDeleteUndoSnapshot);
    assert.deepEqual(h.context.lastDeleteUndoSnapshot.nodes, nodesBefore);
    assert.equal(h.context.state.selectedId, "D");
  });
}

test("P281 Escape and existing expiry both cancel/restart guarded delete without mutation", () => {
  const h = makeHarness({ selectedId: "A" });
  const nodesBefore = plain(h.context.state.nodes);

  h.keydown("Delete");
  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");

  const escape = h.keydown("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "");
  assert.equal(h.context.pendingDeleteConfirmExpiresAt, 0);
  assert.match(h.statuses.at(-1).message, /Delete cancelled/);
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);

  h.keydown("-");
  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);

  h.context.pendingDeleteConfirmExpiresAt = 1;
  h.keydown("-");
  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
  assert.ok(h.context.pendingDeleteConfirmExpiresAt > Date.now());
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
  assert.equal(h.counters.safetySnapshot, 0);
});

test("P281 genuine text-editing/modal owners retain Backspace and Main does not consume it", () => {
  const cases = [
    { name: "inline edit", setup(h) { h.context.state.inlineEdit.id = "A"; } },
    { name: "contenteditable", setup(h) { h.target.isContentEditable = true; } },
    { name: "input", setup(h) { h.target.tagName = "INPUT"; } },
    { name: "textarea", setup(h) { h.target.tagName = "TEXTAREA"; } },
    { name: "select", setup(h) { h.target.tagName = "SELECT"; } },
    { name: "Filter input", setup(h) { h.target = h.search; } },
    { name: "details owner", setup(h) { h.context.isDetailsEditorOpen = () => true; } },
    { name: "blocked modal", setup(h) { h.context.isControlsHelpOpen = () => true; } },
  ];

  for (const entry of cases) {
    const h = makeHarness();
    entry.setup(h);
    const event = {
      target: h.target,
      key: "Backspace",
      code: "Backspace",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() { this.defaultPrevented = true; },
      defaultPrevented: false,
    };
    h.context.handleTreeKeydown(event);
    assert.equal(event.defaultPrevented, false, entry.name);
    assert.equal(h.counters.deleteSelected, 0, entry.name);
  }
});

test("P281 static ownership has no Backspace delete path, keeps deliberate delete routing and restores guarded deleteSelected", () => {
  const actions = source(ACTIONS);
  const render = source(RENDER);
  const multi = source(MULTI);

  const handlerStart = actions.indexOf("function handleTreeKeydown(ev)");
  assert.ok(handlerStart >= 0);
  const handler = actions.slice(handlerStart);

  assert.doesNotMatch(handler, /navigator\.(?:platform|userAgent)|MacIntel|Macintosh|macOS|Windows/i);
  assert.doesNotMatch(handler, /ev\.key === "Backspace"[\s\S]{0,260}deleteSelected\(\)/);
  assert.match(handler, /ev\.key === "Backspace"[\s\S]{0,260}ev\.preventDefault\(\);[\s\S]{0,80}return;/);
  assert.match(handler, /ev\.key === "-" \|\| ev\.key === "Subtract" \|\| ev\.key === "Delete"[\s\S]{0,180}deleteSelected\(\)/);

  const selectedStart = render.indexOf("function deleteSelected()");
  const selectedEnd = render.indexOf("\nfunction ", selectedStart + 20);
  const deleteSelectedSource = render.slice(selectedStart, selectedEnd > selectedStart ? selectedEnd : undefined);
  assert.match(deleteSelectedSource, /deleteNodeById\(state\.selectedId\);/);
  assert.doesNotMatch(deleteSelectedSource, /confirm\s*:\s*false/);

  const ownerStart = actions.indexOf("function deleteNodeById(");
  const ownerEnd = actions.indexOf("\nfunction ", ownerStart + 20);
  const deleteOwner = actions.slice(ownerStart, ownerEnd);
  assert.match(deleteOwner, /const opts = \{ confirm: true, \.\.\.options \}/);
  assert.match(deleteOwner, /pendingDeleteConfirmNodeId === node\.id/);
  assert.match(deleteOwner, /TREE_DELETE_CONFIRM_WINDOW_MS/);
  assert.match(deleteOwner, /saveLastSaveSnapshot\(safetyPayload\)/);
  assert.match(deleteOwner, /createTreeUndoSnapshot\("delete"\)/);

  assert.match(multi, /global\.deleteSelected = function deleteSelectedWithMultiSelection\(\)/);
  assert.match(multi, /deleteMultiSelectionIfActive\(\)/);
  assert.match(multi, /global\.confirm\(/);
});
