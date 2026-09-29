"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ACTIONS = "js/pocket-tree-actions.js";
const RENDER = "js/pocket-render.js";
const HISTORY = "js/pocket-history-status.js";
const IO = "js/pocket-io-browser.js";
const OVERLAYS = "js/pocket-overlays-init.js";
const TOPBAR = "topbar.css";

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

function makeHarness() {
  class HTMLElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.isContentEditable = false;
      this.className = "";
      this.parentElement = null;
      this.children = [];
      this.attributes = new Map();
      this.disabled = false;
      this.type = "";
      this._textContent = "";
      this.value = "";
    }

    get textContent() {
      return this._textContent + this.children.map((child) => child.textContent).join("");
    }

    set textContent(value) {
      this._textContent = String(value == null ? "" : value);
      this.children = [];
    }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    replaceChildren(...children) {
      this._textContent = "";
      this.children = [];
      for (const child of children) this.appendChild(child);
    }

    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    removeAttribute(name) {
      this.attributes.delete(String(name));
    }

    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (selector === "[data-pocket-status-action]"
              && child.getAttribute("data-pocket-status-action") != null) {
            matches.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return matches;
    }

    closest(selector) {
      let current = this;
      while (current) {
        if (selector === "[data-pocket-status-action]"
            && current.getAttribute?.("data-pocket-status-action") != null) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }

    focus() {}

    get classList() {
      return {
        contains: (name) => this.className.split(/\s+/).includes(String(name)),
        remove: (name) => {
          const wanted = String(name);
          this.className = this.className
            .split(/\s+/)
            .filter(Boolean)
            .filter((entry) => entry !== wanted)
            .join(" ");
        },
      };
    }
  }

  class HTMLInputElement extends HTMLElement {
    constructor() {
      super("input");
    }
  }

  const titleToast = new HTMLElement("div");
  titleToast.className = "topStatusToast";
  const treeWrap = new HTMLElement("div");
  treeWrap.className = "treeWrap";
  const search = new HTMLInputElement();
  const counters = {
    safetySnapshot: 0,
    refreshMeta: 0,
    renderTree: 0,
    refocus: 0,
    persist: 0,
    routeEnter: 0,
    clearFilter: 0,
    clearFocus: 0,
  };
  let timerId = 0;
  const activeTimers = new Map();
  const allTimerCallbacks = new Map();

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect,
    JSON, Date, Math, Promise, HTMLElement, HTMLInputElement,
    console,
    document: {
      createElement(tagName) {
        return new HTMLElement(tagName);
      },
    },
    state: {
      nodes: [
        { id: "A", parentId: "root", label: "Parent", order: 1001, updatedAt: "t0" },
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
    el: { search, titleToast, treeWrap },
    pendingPathImport: null,
    pendingDeleteConfirmNodeId: "",
    pendingDeleteConfirmExpiresAt: 0,
    pendingDeleteConfirmProjectionToken: null,
    TREE_DELETE_CONFIRM_WINDOW_MS: 12000,
    lastDeleteUndoSnapshot: null,
    lastEditUndoSnapshot: null,
    lastTreeUndoKind: "",
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
    nowIso() { return "2026-09-29T07:00:00.000Z"; },
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
    clearTimeout(id) {
      activeTimers.delete(id);
    },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
  };

  context.window = context;
  context.globalThis = context;
  context.window.setTimeout = (callback) => {
    timerId += 1;
    activeTimers.set(timerId, callback);
    allTimerCallbacks.set(timerId, callback);
    return timerId;
  };
  context.window.applyPocketFilterQueryValue = (value) => {
    search.value = String(value);
    return true;
  };
  context.window.settlePocketPendingFilterRender = () => false;

  vm.createContext(context);

  const history = source(HISTORY);
  vm.runInContext(
    `let titleToastTimer = null; let statusProjectionToken = null; let statusProjectionDismissHandler = null; let statusActionHandler = null;\n${functionRange(history, "compactTopStatus", "formatSaveClockLabel")}`,
    context,
    { filename: HISTORY }
  );
  vm.runInContext(source(ACTIONS), context, { filename: ACTIONS });

  const render = source(RENDER);
  vm.runInContext(functionRange(render, "deleteSelected"), context, { filename: RENDER });

  const io = source(IO);
  vm.runInContext(functionRange(io, "triggerStatusAction"), context, { filename: IO });

  context.refocusTreeNavigation = () => { counters.refocus += 1; };
  context.softlyEnsureSelectionVisible = () => {};
  context.routeTreeEnterForSelectedNode = () => {
    counters.routeEnter += 1;
    return true;
  };
  context.clearFilterAndReturnHome = () => {
    counters.clearFilter += 1;
    return false;
  };
  context.clearFocusAndReturnHome = () => {
    counters.clearFocus += 1;
    return false;
  };

  function keydown(key, overrides = {}) {
    const event = {
      target: treeWrap,
      key,
      code: key,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
    };
    context.handleTreeKeydown(event);
    return event;
  }

  function actionButtons() {
    return titleToast.querySelectorAll("[data-pocket-status-action]");
  }

  function actionEvent(button) {
    return {
      target: button,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
  }

  function latestTimerId() {
    return timerId;
  }

  function timerCallback(id) {
    return allTimerCallbacks.get(id) || null;
  }

  function runTimer(id) {
    const callback = activeTimers.get(id);
    if (typeof callback !== "function") return false;
    activeTimers.delete(id);
    callback();
    return true;
  }

  return {
    context,
    counters,
    titleToast,
    treeWrap,
    keydown,
    actionButtons,
    actionEvent,
    latestTimerId,
    timerCallback,
    runTimer,
  };
}

function ids(h) {
  return h.context.state.nodes.map((node) => node.id);
}

test("P281g first Delete arms one guard and renders explicit actions with zero mutation", () => {
  const h = makeHarness();
  const nodesBefore = plain(h.context.state.nodes);
  const tombstonesBefore = plain(h.context.state.tombstones);
  const highWaterBefore = h.context.state.operationHighWater;

  const event = h.keydown("Delete");

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
  assert.deepEqual(plain(h.context.state.tombstones), tombstonesBefore);
  assert.equal(h.context.state.operationHighWater, highWaterBefore);
  assert.equal(h.counters.safetySnapshot, 0);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
  assert.ok(h.context.pendingDeleteConfirmExpiresAt > Date.now());

  assert.match(h.titleToast.className, /\bactions\b/);
  assert.match(h.titleToast.className, /\bshow\b/);
  assert.match(h.titleToast.children[0].textContent, /Delete "Parent" and 2 child item\(s\)\?/);
  assert.match(h.titleToast.children[0].textContent, /whole branch/i);
  assert.doesNotMatch(h.titleToast.textContent, /again to confirm/i);

  const buttons = h.actionButtons();
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((button) => button.textContent), ["Confirm delete", "Cancel"]);
});

test("P281j leaf Delete card is only the target question plus the existing two actions", () => {
  const h = makeHarness();
  h.context.state.selectedId = "D";
  const before = plain(h.context.state.nodes);

  const event = h.keydown("Delete");

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(plain(h.context.state.nodes), before);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "D");
  assert.equal(h.titleToast.children[0].textContent, 'Delete "Sibling"?');
  assert.doesNotMatch(h.titleToast.textContent, /cannot be undone|except via Undo|whole branch/i);

  const buttons = h.actionButtons();
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((button) => button.textContent), ["Confirm delete", "Cancel"]);
});

test("P281m natural Möbius expiry invalidates its exact Delete arm and restores ordinary Enter", () => {
  const h = makeHarness();
  const before = plain(h.context.state.nodes);

  h.keydown("Delete");
  const expiryTimer = h.latestTimerId();

  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
  assert.ok(h.context.pendingDeleteConfirmProjectionToken);
  assert.match(h.titleToast.className, /\bshow\b/);

  assert.equal(h.runTimer(expiryTimer), true);

  assert.equal(h.context.pendingDeleteConfirmNodeId, "");
  assert.equal(h.context.pendingDeleteConfirmExpiresAt, 0);
  assert.equal(h.context.pendingDeleteConfirmProjectionToken, null);
  assert.doesNotMatch(h.titleToast.className, /\bshow\b/);
  assert.deepEqual(plain(h.context.state.nodes), before);

  const enter = h.keydown("Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.equal(h.counters.routeEnter, 1);
  assert.deepEqual(plain(h.context.state.nodes), before);
  assert.equal(h.counters.safetySnapshot, 0);
});

test("P281m unrelated replacement or explicit clear immediately invalidates the visible Delete arm", () => {
  const replacement = makeHarness();
  const beforeReplacement = plain(replacement.context.state.nodes);

  replacement.keydown("Delete");
  const armedToken = replacement.context.pendingDeleteConfirmProjectionToken;
  assert.ok(armedToken);

  replacement.context.setStatus("Unrelated status.", "ok");

  assert.equal(replacement.context.pendingDeleteConfirmNodeId, "");
  assert.equal(replacement.context.pendingDeleteConfirmProjectionToken, null);
  assert.equal(replacement.titleToast.textContent, "Unrelated status.");
  assert.deepEqual(plain(replacement.context.state.nodes), beforeReplacement);

  const enterAfterReplacement = replacement.keydown("Enter");
  assert.equal(enterAfterReplacement.defaultPrevented, true);
  assert.equal(replacement.counters.routeEnter, 1);
  assert.deepEqual(plain(replacement.context.state.nodes), beforeReplacement);

  replacement.keydown("Delete");
  assert.equal(replacement.context.pendingDeleteConfirmNodeId, "A");
  assert.ok(replacement.context.pendingDeleteConfirmProjectionToken);
  assert.notEqual(replacement.context.pendingDeleteConfirmProjectionToken, armedToken);
  assert.match(replacement.titleToast.className, /\bshow\b/);

  const cleared = makeHarness();
  const beforeClear = plain(cleared.context.state.nodes);
  cleared.keydown("Delete");
  cleared.context.setStatus("");

  assert.equal(cleared.context.pendingDeleteConfirmNodeId, "");
  assert.equal(cleared.context.pendingDeleteConfirmProjectionToken, null);
  assert.equal(cleared.titleToast.className, "topStatusToast");
  const enterAfterClear = cleared.keydown("Enter");
  assert.equal(enterAfterClear.defaultPrevented, true);
  assert.equal(cleared.counters.routeEnter, 1);
  assert.deepEqual(plain(cleared.context.state.nodes), beforeClear);
});

test("P281m repeated Delete refreshes the visible arm and stale old expiry cannot clear the fresh projection", () => {
  const h = makeHarness();
  const before = plain(h.context.state.nodes);

  h.keydown("Delete");
  const firstTimerId = h.latestTimerId();
  const staleExpiry = h.timerCallback(firstTimerId);
  const firstArmToken = h.context.pendingDeleteConfirmProjectionToken;

  assert.equal(typeof staleExpiry, "function");
  assert.ok(firstArmToken);

  h.keydown("Delete");

  const secondTimerId = h.latestTimerId();
  const secondArmToken = h.context.pendingDeleteConfirmProjectionToken;
  assert.ok(secondTimerId > firstTimerId);
  assert.ok(secondArmToken);
  assert.notEqual(secondArmToken, firstArmToken);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
  assert.deepEqual(plain(h.context.state.nodes), before);
  assert.equal(h.counters.safetySnapshot, 0);

  staleExpiry();

  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");
  assert.equal(h.context.pendingDeleteConfirmProjectionToken, secondArmToken);
  assert.match(h.titleToast.className, /\bshow\b/);
  assert.deepEqual(plain(h.context.state.nodes), before);

  const enter = h.keydown("Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(ids(h), ["D"]);
  assert.equal(h.counters.safetySnapshot, 1);
});

test("P281m status lifecycle hook remains generic and Delete semantics stay in the one guard owner", () => {
  const history = source(HISTORY);
  const actions = source(ACTIONS);

  assert.match(history, /opts\.onDismiss/);
  assert.match(history, /finishStatusProjection\(/);
  assert.doesNotMatch(history, /pendingDeleteConfirm|confirmPendingDelete|cancelPendingDelete/i);

  assert.equal((actions.match(/function invalidatePendingDeleteGuardForProjection\(/g) || []).length, 1);
  assert.match(actions, /onDismiss:\s*\(\{ token \}\) => invalidatePendingDeleteGuardForProjection\(token\)/);
  const deleteGuardOwner = functionRange(actions, "clearPendingDeleteGuardState", "indentNodeById");
  assert.doesNotMatch(deleteGuardOwner, /setTimeout\s*\(/);
});

test("P281g Enter and Confirm delete converge on the same one-shot confirm semantic", () => {
  const keyboard = makeHarness();
  keyboard.keydown("Delete");
  const enter = keyboard.keydown("Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(ids(keyboard), ["D"]);
  assert.equal(keyboard.counters.safetySnapshot, 1);
  assert.equal(keyboard.context.state.operationHighWater, 18);
  assert.equal(keyboard.context.pendingDeleteConfirmNodeId, "");

  const pointer = makeHarness();
  pointer.keydown("Delete");
  const confirmButton = pointer.actionButtons()[0];
  const click = pointer.actionEvent(confirmButton);
  const firstClick = pointer.context.triggerStatusAction(click);
  assert.equal(firstClick, true);
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.propagationStopped, true);
  assert.deepEqual(ids(pointer), ["D"]);
  assert.equal(pointer.counters.safetySnapshot, 1);
  assert.equal(pointer.context.state.operationHighWater, 18);
  assert.equal(pointer.context.pendingDeleteConfirmNodeId, "");

  const staleClick = pointer.actionEvent(confirmButton);
  assert.equal(pointer.context.triggerStatusAction(staleClick), false);
  assert.deepEqual(ids(pointer), ["D"]);
  assert.equal(pointer.counters.safetySnapshot, 1);
  assert.equal(pointer.context.state.operationHighWater, 18);
});

test("P281g Escape and Cancel converge on the same non-mutating cancel semantic", () => {
  const keyboard = makeHarness();
  const keyboardBefore = plain(keyboard.context.state.nodes);
  keyboard.keydown("Delete");
  const escape = keyboard.keydown("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(keyboard.context.pendingDeleteConfirmNodeId, "");
  assert.equal(keyboard.context.pendingDeleteConfirmExpiresAt, 0);
  assert.deepEqual(plain(keyboard.context.state.nodes), keyboardBefore);
  assert.equal(keyboard.counters.safetySnapshot, 0);
  assert.equal(keyboard.titleToast.textContent, "Delete cancelled.");

  const pointer = makeHarness();
  const pointerBefore = plain(pointer.context.state.nodes);
  pointer.keydown("Delete");
  const cancelButton = pointer.actionButtons()[1];
  const click = pointer.actionEvent(cancelButton);
  assert.equal(pointer.context.triggerStatusAction(click), true);
  assert.equal(pointer.context.pendingDeleteConfirmNodeId, "");
  assert.equal(pointer.context.pendingDeleteConfirmExpiresAt, 0);
  assert.deepEqual(plain(pointer.context.state.nodes), pointerBefore);
  assert.equal(pointer.counters.safetySnapshot, 0);
  assert.equal(pointer.titleToast.textContent, "Delete cancelled.");

  const staleClick = pointer.actionEvent(cancelButton);
  assert.equal(pointer.context.triggerStatusAction(staleClick), false);
  assert.deepEqual(plain(pointer.context.state.nodes), pointerBefore);
});

test("P281g repeated Delete remains an arm gesture; Enter is the explicit keyboard confirmation", () => {
  const h = makeHarness();
  const before = plain(h.context.state.nodes);

  h.keydown("Delete");
  h.keydown("Delete");

  assert.deepEqual(plain(h.context.state.nodes), before);
  assert.equal(h.counters.safetySnapshot, 0);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "A");

  h.keydown("Enter");
  assert.deepEqual(ids(h), ["D"]);
  assert.equal(h.counters.safetySnapshot, 1);
});

test("P281g ordinary Enter and Escape ownership remains unchanged outside an armed guard", () => {
  const h = makeHarness();
  const before = plain(h.context.state.nodes);

  const enter = h.keydown("Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.equal(h.counters.routeEnter, 1);
  assert.deepEqual(plain(h.context.state.nodes), before);

  const escape = h.keydown("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(h.counters.clearFilter, 1);
  assert.equal(h.counters.clearFocus, 1);
  assert.deepEqual(plain(h.context.state.nodes), before);
  assert.equal(h.context.pendingDeleteConfirmNodeId, "");
});

test("P281g source keeps one guard owner and the transient card outside the four-column topbar layout", () => {
  const actions = source(ACTIONS);
  const overlays = source(OVERLAYS);
  const topbar = source(TOPBAR);

  assert.equal((actions.match(/let pendingDeleteConfirmNodeId/g) || []).length, 0);
  assert.equal((actions.match(/function confirmPendingDeleteGuard\(/g) || []).length, 1);
  assert.equal((actions.match(/function cancelPendingDeleteGuard\(/g) || []).length, 1);
  assert.match(actions, /deleteNodeById\(nodeId, \{ confirm: false \}\)/);
  assert.match(actions, /actions:\s*\[[\s\S]*Confirm delete[\s\S]*Cancel/);
  assert.doesNotMatch(actions, /Delete again to confirm/i);

  const capturedDeleteCancel = overlays.indexOf('typeof cancelPendingDeleteGuard === "function"');
  const ordinaryEscape = overlays.indexOf('if (key === "escape") {', capturedDeleteCancel + 1);
  assert.ok(capturedDeleteCancel >= 0);
  assert.ok(ordinaryEscape > capturedDeleteCancel, "armed delete Escape must precede ordinary global Escape routing");

  const openRule = cssBlock(topbar, "body.pocketShellOpen:not(.pipMode) .topbar {");
  assert.match(openRule, /grid-template-columns:\s*repeat\(4,/);

  const laneRule = cssBlock(
    topbar,
    "body.pocketShellOpen:not(.pipMode) .topbar .topStatusLane {",
    topbar.indexOf("/* P281d:")
  );
  assert.match(laneRule, /position:\s*absolute\s*!important/);
  assert.doesNotMatch(laneRule, /grid-column/);

  const cardRule = cssBlock(
    topbar,
    "body.pocketShellOpen:not(.pipMode) .topbar .topStatusToast.actions {"
  );
  assert.match(cardRule, /border-radius:\s*12px\s*!important/);
});
