"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const TOPBAR = "topbar.css";
const STYLES = "styles.css";
const INDEX = "index.html";
const HISTORY = "js/pocket-history-status.js";
const ACTIONS = "js/pocket-tree-actions.js";
const RENDER = "js/pocket-render.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function functionRange(fileSource, startName, endName = "") {
  const start = fileSource.indexOf(`function ${startName}(`);
  assert.ok(start >= 0, `${startName} must exist`);
  if (!endName) return fileSource.slice(start);
  const end = fileSource.indexOf(`\nfunction ${endName}(`, start + 1);
  assert.ok(end > start, `${endName} must follow ${startName}`);
  return fileSource.slice(start, end);
}

function cssBlock(css, selector, fromIndex = 0) {
  const start = css.indexOf(selector, fromIndex);
  assert.ok(start >= 0, `CSS selector must exist: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open + 1);
  assert.ok(open > start && close > open, `CSS block must be complete: ${selector}`);
  return css.slice(open + 1, close);
}

function makeTitleToast() {
  const attributes = new Map();
  const toast = {
    textContent: "",
    className: "topStatusToast",
    setAttribute(name, value) {
      attributes.set(String(name), String(value));
    },
    removeAttribute(name) {
      attributes.delete(String(name));
    },
    getAttribute(name) {
      return attributes.get(String(name)) || null;
    },
  };
  toast.classList = {
    remove(name) {
      const wanted = String(name);
      toast.className = toast.className
        .split(/\s+/)
        .filter(Boolean)
        .filter((entry) => entry !== wanted)
        .join(" ");
    },
  };
  return toast;
}

function makeComposedHarness() {
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
  const target = new HTMLElement("div");
  const titleToast = makeTitleToast();
  const counters = {
    safetySnapshot: 0,
    refreshMeta: 0,
    renderTree: 0,
    refocus: 0,
    persist: 0,
  };
  let timerId = 0;

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect,
    JSON, Date, Math, Promise, HTMLElement, HTMLInputElement,
    state: {
      nodes: [
        {
          id: "A",
          parentId: "root",
          label: "Parent with an intentionally very long label so compact status must protect the safety guidance",
          order: 1001,
          updatedAt: "t0",
        },
        { id: "B", parentId: "A", label: "Child", order: 1001, updatedAt: "t0" },
        { id: "C", parentId: "B", label: "Grandchild", order: 1001, updatedAt: "t0" },
        { id: "D", parentId: "root", label: "Sibling", order: 1002, updatedAt: "t0" },
      ],
      tombstones: [],
      collapsed: new Set(),
      selectedId: "A",
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
    el: { search, titleToast },
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
      return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
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
    saveLastSaveSnapshot() { counters.safetySnapshot += 1; },
    nowIso() { return "2026-09-29T06:30:00.000Z"; },
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
    clearTimeout() {},
  };

  context.window = context;
  context.globalThis = context;
  context.window.setTimeout = () => {
    timerId += 1;
    return timerId;
  };
  context.window.applyPocketFilterQueryValue = (value) => {
    search.value = String(value);
    return true;
  };
  context.window.settlePocketPendingFilterRender = () => false;

  vm.createContext(context);

  const history = source(HISTORY);
  const realStatusFunctions = functionRange(history, "compactTopStatus", "formatSaveClockLabel");
  vm.runInContext(
    `let titleToastTimer = null; let statusActionHandler = null;\n${realStatusFunctions}`,
    context,
    { filename: HISTORY }
  );

  vm.runInContext(source(ACTIONS), context, { filename: ACTIONS });

  const render = source(RENDER);
  const realDeleteSelected = functionRange(render, "deleteSelected");
  vm.runInContext(realDeleteSelected, context, { filename: RENDER });

  context.refocusTreeNavigation = function refocusTreeNavigationHarness() {
    counters.refocus += 1;
  };
  context.softlyEnsureSelectionVisible = function softlyEnsureSelectionVisibleHarness() {};

  function keydown(key) {
    const event = {
      target,
      key,
      code: key,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() { this.defaultPrevented = true; },
      defaultPrevented: false,
    };
    context.handleTreeKeydown(event);
    return event;
  }

  return { context, titleToast, counters, keydown };
}

test("P281d normal open Pocket projects status as an overlay outside the four permanent topbar columns", () => {
  const topbar = source(TOPBAR);
  const styles = source(STYLES);
  const index = source(INDEX);

  assert.ok(
    index.indexOf('href="styles.css"') < index.indexOf('href="topbar.css"'),
    "topbar.css must remain the later shell-specific cascade"
  );

  const openRule = cssBlock(topbar, "body.pocketShellOpen:not(.pipMode) .topbar {");
  assert.match(openRule, /grid-template-columns:\s*repeat\(4,/);
  assert.match(openRule, /position:\s*relative\s*!important/);
  assert.match(openRule, /overflow:\s*visible\s*!important/);

  const p281dStart = topbar.indexOf("/* P281d:");
  assert.ok(p281dStart >= 0, "P281d overlay block must be explicit");

  const laneRule = cssBlock(
    topbar,
    "body.pocketShellOpen:not(.pipMode) .topbar .topStatusLane {",
    p281dStart
  );
  assert.match(laneRule, /display:\s*flex\s*!important/);
  assert.match(laneRule, /position:\s*absolute\s*!important/);
  assert.match(laneRule, /pointer-events:\s*none\s*!important/);
  assert.doesNotMatch(laneRule, /display:\s*none/);
  assert.doesNotMatch(laneRule, /grid-column/);

  const toastRule = cssBlock(
    topbar,
    "body.pocketShellOpen:not(.pipMode) .topbar .topStatusToast {",
    p281dStart
  );
  assert.match(toastRule, /white-space:\s*normal\s*!important/);
  assert.match(toastRule, /overflow:\s*visible\s*!important/);
  assert.match(toastRule, /max-width:\s*100%\s*!important/);

  assert.doesNotMatch(
    topbar,
    /body\.pocketShellOpen:not\(\.pipMode\) \.topbar \.grow\s*,\s*body\.pocketShellOpen:not\(\.pipMode\) \.topbar \.topStatusLane\s*\{[^}]*display:\s*none/is
  );

  assert.match(
    styles,
    /body\.pipMode \.grow,\s*body\.pipMode \.topStatusLane\s*\{\s*display:\s*none;\s*\}/
  );
});

test("P281d real setStatus activates the existing titleToast projection", () => {
  const h = makeComposedHarness();

  h.context.setStatus("Safety feedback is visible.", "warn", { durationMs: 12000 });

  assert.equal(h.titleToast.textContent, "Safety feedback is visible.");
  assert.match(h.titleToast.className, /\btopStatusToast\b/);
  assert.match(h.titleToast.className, /\bwarn\b/);
  assert.match(h.titleToast.className, /\bshow\b/);
});

test("P281d first guarded Delete stays non-mutating, keeps readable confirm/cancel guidance, and Escape cancels", () => {
  const h = makeComposedHarness();
  const beforeNodes = plain(h.context.state.nodes);
  const beforeTombstones = plain(h.context.state.tombstones);
  const beforeHighWater = h.context.state.operationHighWater;

  const first = h.keydown("Delete");

  assert.equal(first.defaultPrevented, true);
  assert.deepEqual(plain(h.context.state.nodes), beforeNodes);
  assert.deepEqual(plain(h.context.state.tombstones), beforeTombstones);
  assert.equal(h.context.state.operationHighWater, beforeHighWater);
  assert.equal(h.counters.safetySnapshot, 0);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
  assert.ok(h.context.pendingDeleteConfirmExpiresAt > Date.now());

  assert.match(h.titleToast.className, /\bwarn\b/);
  assert.match(h.titleToast.className, /\bshow\b/);
  assert.match(h.titleToast.textContent, /Delete again to confirm/i);
  assert.match(h.titleToast.textContent, /Esc cancels/i);
  assert.ok(h.titleToast.textContent.length <= 86, "compact warning must remain bounded");

  const escape = h.keydown("Escape");

  assert.equal(escape.defaultPrevented, true);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "");
  assert.equal(h.context.pendingDeleteConfirmExpiresAt, 0);
  assert.deepEqual(plain(h.context.state.nodes), beforeNodes);
  assert.deepEqual(plain(h.context.state.tombstones), beforeTombstones);
  assert.equal(h.context.state.operationHighWater, beforeHighWater);
  assert.equal(h.counters.safetySnapshot, 0);
  assert.equal(h.titleToast.textContent, "Delete cancelled.");
  assert.match(h.titleToast.className, /\bok\b/);
  assert.match(h.titleToast.className, /\bshow\b/);
});
