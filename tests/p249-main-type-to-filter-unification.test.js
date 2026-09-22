"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ACTIONS = "js/pocket-tree-actions.js";
const SCROLL = "js/pocket-scroll-polish.js";
const RENDER = "js/pocket-render.js";
const SMOOTH = "js/pocket-list-smoothing.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeNode(id, order) {
  return { id, parentId: "root", order, label: id, details: "" };
}

function makeHarness({ unrelatedCount = 0, selectedId = "A", copyIds = [] } = {}) {
  const counters = {
    active: false,
    createElement: 0,
    removeChild: 0,
    reparent: 0,
    innerClear: 0,
    treeQueryAll: 0,
    selectedAdd: 0,
    selectedRemove: 0,
    fullRender: 0,
    projectorCalls: 0,
    refreshMeta: 0,
    focus: 0,
    scroll: 0,
    shouldCopy: 0,
    scheduleCopy: 0,
    cancelCopy: 0,
    saveWorkspace: 0,
    handoffChecks: 0,
    handoffTrue: 0,
    copied: 0,
    menuOpen: 0,
  };
  const sequence = [];
  const copiedTexts = [];
  const timers = new Map();
  let nextTimerId = 1;
  let documentRef = null;
  let treeRoot = null;
  let treeWrap = null;

  function classTokens(element) {
    return String(element?.className || "").split(/\s+/).filter(Boolean);
  }

  function setClassTokens(element, tokens) {
    element.className = Array.from(new Set(tokens.filter(Boolean))).join(" ");
  }

  function selectorMatches(element, selector) {
    if (!(element instanceof HTMLElement)) return false;
    const classes = classTokens(element);
    if (selector === ".row[data-node-id]") {
      return classes.includes("row") && !!element.getAttribute("data-node-id");
    }
    if (selector === ".row.selected") {
      return classes.includes("row") && classes.includes("selected");
    }
    if (selector === ".row.multiSelected") {
      return classes.includes("row") && classes.includes("multiSelected");
    }
    if (selector === ".label[data-full-label]") {
      return classes.includes("label") && element.getAttribute("data-full-label") !== null;
    }
    let match = selector.match(/^\.row\[data-node-id="([^"]+)"\]$/);
    if (match) {
      return classes.includes("row") && element.getAttribute("data-node-id") === match[1];
    }
    match = selector.match(/^\[data-edit-id="([^"]+)"\]$/);
    if (match) return element.getAttribute("data-edit-id") === match[1];
    if (selector.startsWith("input") || selector.startsWith("textarea") || selector.startsWith("select")) {
      return false;
    }
    return false;
  }

  class HTMLElement {
    constructor(tagName = "div") {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this.attributes = new Map();
      this.childNodes = [];
      this.children = this.childNodes;
      this.parentNode = null;
      this.listeners = new Map();
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      this.tabIndex = -1;
      this.textContent = "";
      this.id = "";
      this.scrollWidth = 0;
      this.clientWidth = 0;
      this.scrollTop = 0;
      this.scrollHeight = 1000;
      this.clientHeight = 500;
      this.style = {
        setProperty: (name, value) => {
          this.style[String(name)] = String(value);
        },
      };
      this.classList = {
        add: (...names) => {
          const list = names.map(String);
          if (counters.active && list.includes("selected") && !classTokens(this).includes("selected")) {
            counters.selectedAdd += 1;
          }
          setClassTokens(this, [...classTokens(this), ...list]);
        },
        remove: (...names) => {
          const list = names.map(String);
          if (counters.active && list.includes("selected") && classTokens(this).includes("selected")) {
            counters.selectedRemove += 1;
          }
          const drop = new Set(list);
          setClassTokens(this, classTokens(this).filter((name) => !drop.has(name)));
        },
        contains: (name) => classTokens(this).includes(String(name)),
        toggle: (name, force) => {
          const token = String(name);
          const has = classTokens(this).includes(token);
          const next = force === undefined ? !has : !!force;
          if (next && !has) this.classList.add(token);
          if (!next && has) this.classList.remove(token);
          return next;
        },
      };
    }

    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
      if (String(name) === "id") this.id = String(value);
    }

    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    removeAttribute(name) {
      this.attributes.delete(String(name));
    }

    addEventListener(type, handler, options = false) {
      const key = String(type);
      if (!this.listeners.has(key)) this.listeners.set(key, []);
      const capture = options === true || !!options?.capture;
      this.listeners.get(key).push({ handler, capture });
    }

    removeEventListener(type, handler, options = false) {
      const key = String(type);
      const capture = options === true || !!options?.capture;
      const entries = this.listeners.get(key) || [];
      this.listeners.set(key, entries.filter((entry) => entry.handler !== handler || entry.capture !== capture));
    }

    dispatchEvent(event) {
      if (!event || typeof event !== "object") throw new TypeError("event required");
      if (!event.type) throw new TypeError("event.type required");
      if (!event.target) event.target = this;
      if (event.bubbles === undefined) event.bubbles = true;
      event.defaultPrevented = false;
      event._stopped = false;
      event._immediateStopped = false;
      event.preventDefault = () => { event.defaultPrevented = true; };
      event.stopPropagation = () => { event._stopped = true; };
      event.stopImmediatePropagation = () => { event._immediateStopped = true; event._stopped = true; };

      const path = [];
      let cursor = this;
      while (cursor) {
        path.push(cursor);
        cursor = cursor.parentNode;
      }

      const invoke = (element, capture) => {
        event.currentTarget = element;
        for (const entry of element.listeners.get(String(event.type)) || []) {
          if (entry.capture !== capture) continue;
          entry.handler(event);
          if (event._immediateStopped) break;
        }
      };

      for (let i = path.length - 1; i > 0; i -= 1) {
        invoke(path[i], true);
        if (event._stopped) return !event.defaultPrevented;
      }
      invoke(this, true);
      if (!event._immediateStopped) invoke(this, false);
      if (event._stopped) return !event.defaultPrevented;
      if (event.bubbles) {
        for (let i = 1; i < path.length; i += 1) {
          invoke(path[i], false);
          if (event._stopped) break;
        }
      }
      return !event.defaultPrevented;
    }

    appendChild(child) {
      if (!(child instanceof HTMLElement)) throw new TypeError("appendChild requires HTMLElement");
      if (counters.active && child.parentNode) counters.reparent += 1;
      if (child.parentNode) {
        const old = child.parentNode;
        const oldIndex = old.childNodes.indexOf(child);
        if (oldIndex >= 0) old.childNodes.splice(oldIndex, 1);
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }

    insertBefore(child, before) {
      if (!(child instanceof HTMLElement)) throw new TypeError("insertBefore requires HTMLElement");
      if (before != null && before.parentNode !== this) throw new Error("NotFoundError");
      if (counters.active && child.parentNode) counters.reparent += 1;
      if (child.parentNode) {
        const old = child.parentNode;
        const oldIndex = old.childNodes.indexOf(child);
        if (oldIndex >= 0) old.childNodes.splice(oldIndex, 1);
      }
      const index = before == null ? this.childNodes.length : this.childNodes.indexOf(before);
      if (index < 0) throw new Error("NotFoundError");
      child.parentNode = this;
      this.childNodes.splice(index, 0, child);
      return child;
    }

    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index < 0) throw new Error("NotFoundError");
      if (counters.active) counters.removeChild += 1;
      this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }

    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }

    contains(candidate) {
      if (candidate === this) return true;
      return this.childNodes.some((child) => child.contains(candidate));
    }

    closest(selector) {
      let cursor = this;
      while (cursor) {
        if (selectorMatches(cursor, selector)) return cursor;
        cursor = cursor.parentNode;
      }
      return null;
    }

    querySelectorAll(selector) {
      if (counters.active && this === treeRoot) counters.treeQueryAll += 1;
      const result = [];
      const visit = (parent) => {
        for (const child of parent.childNodes) {
          if (selectorMatches(child, selector)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    focus() {
      if (counters.active) counters.focus += 1;
      if (documentRef) documentRef.activeElement = this;
    }

    select() {}

    scrollIntoView() {
      if (counters.active) counters.scroll += 1;
    }

    scrollBy() {
      if (counters.active) counters.scroll += 1;
    }

    getBoundingClientRect() {
      if (this === treeWrap) {
        return { top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500 };
      }
      return { top: 100, bottom: 124, left: 0, right: 200, width: 200, height: 24 };
    }

    get firstChild() {
      return this.childNodes[0] || null;
    }

    get lastChild() {
      return this.childNodes.length ? this.childNodes[this.childNodes.length - 1] : null;
    }

    get previousSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      const index = siblings.indexOf(this);
      return index > 0 ? siblings[index - 1] : null;
    }

    get nextSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      const index = siblings.indexOf(this);
      return index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;
    }
  }

  Object.defineProperty(HTMLElement.prototype, "innerHTML", {
    get() { return ""; },
    set() {
      if (counters.active) counters.innerClear += 1;
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes.length = 0;
    },
  });

  class HTMLInputElement extends HTMLElement {
    constructor() {
      super("input");
      this.value = "";
    }
  }

  treeRoot = new HTMLElement("ul");
  treeWrap = new HTMLElement("div");
  treeWrap.appendChild(treeRoot);
  const search = new HTMLInputElement();
  const body = new HTMLElement("body");
  const head = new HTMLElement("head");
  const documentElement = new HTMLElement("html");
  documentElement.clientWidth = 1200;
  documentElement.clientHeight = 800;

  const document = {
    activeElement: null,
    body,
    head,
    documentElement,
    readyState: "complete",
    createElement(tagName) {
      if (counters.active) counters.createElement += 1;
      return String(tagName).toLowerCase() === "input"
        ? new HTMLInputElement()
        : new HTMLElement(tagName);
    },
    getElementById(id) {
      const target = String(id);
      const roots = [head, body, treeWrap];
      const visit = (element) => {
        if (element.id === target || element.getAttribute("id") === target) return element;
        for (const child of element.childNodes) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      for (const root of roots) {
        const found = visit(root);
        if (found) return found;
      }
      return null;
    },
    querySelector(selector) { return treeRoot.querySelector(selector); },
    querySelectorAll(selector) { return treeRoot.querySelectorAll(selector); },
    addEventListener() {},
    removeEventListener() {},
  };
  documentRef = document;

  const nodes = [
    makeNode("A", 1001),
    makeNode("B", 1002),
    makeNode("C", 1003),
  ];
  for (let index = 0; index < unrelatedCount; index += 1) {
    nodes.push(makeNode(`U${index}`, 2000 + index));
  }

  const copySet = new Set(copyIds);
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect,
    JSON, Date, Math, Promise, HTMLElement, HTMLInputElement,
    document,
    CSS: { escape(value) { return String(value); } },
    state: {
      nodes: plain(nodes),
      tombstones: [],
      collapsed: new Set(),
      selectedId,
      focusRootId: "",
      rowMiniMenuOpen: false,
      rowMiniMenuNodeId: "",
      inlineEdit: { id: "", isNew: false, autoFocus: false },
      multiSelectedIds: new Set(),
      multiSelectAnchorId: selectedId,
      moveMode: false,
      typeJump: { query: "", cycle: 0, lastAt: 0 },
      navigationMemory: {},
      rootExtras: {},
      dataExtras: {},
    },
    el: { search, treeRoot, treeWrap },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, maximum);
    },
    compareSiblingOrder(left, right) {
      return (Number(left.order) || 0) - (Number(right.order) || 0)
        || String(left.label || "").localeCompare(String(right.label || ""));
    },
    nodeMap() {
      return new Map(context.state.nodes.map((entry) => [entry.id, entry]));
    },
    childrenMap() {
      const map = new Map();
      for (const entry of context.state.nodes) {
        const parentId = entry.parentId || "root";
        if (!map.has(parentId)) map.set(parentId, []);
        map.get(parentId).push(entry);
      }
      for (const siblings of map.values()) siblings.sort(context.compareSiblingOrder);
      return map;
    },
    canShowPocketTree() { return true; },
    normaliseDetails(value) { return String(value || ""); },
    getPath(id) { return String(id || ""); },
    nodeAttentionState() { return ""; },
    shouldCopyOnSingleClick(node) {
      if (counters.active) {
        counters.shouldCopy += 1;
        sequence.push("shouldCopy");
      }
      return copySet.has(node?.id);
    },
    installTreeGutterDrag() {},
    cancelPendingCopyClick() {
      if (counters.active) {
        counters.cancelCopy += 1;
        sequence.push("cancelCopy");
      }
    },
    scheduleCopyClick() {
      if (counters.active) {
        counters.scheduleCopy += 1;
        sequence.push("scheduleCopy");
      }
    },
    refreshMeta() {
      if (counters.active) {
        counters.refreshMeta += 1;
        sequence.push("refreshMeta");
      }
    },
    repairVisibleSelectionAfterRender() {},
    refreshSaveState() {},
    saveWorkspaceState() {
      if (counters.active) counters.saveWorkspace += 1;
    },
    persistPipSnapshot() {},
    softlyEnsureSelectionVisible() {},
    resetTypeJump() {},
    rememberFilterOrigin() {},
    clearFilterMemory() {},
    refocusTreeNavigation() {},
    flashTouchedRow() {},
    isManagedSystemBucketNode() { return false; },
    isCompletedSystemBucketNode() { return false; },
    isDetailsEditorOpen() { return false; },
    isControlsHelpOpen() { return false; },
    isCommandPaletteOpen() { return false; },
    isPocketVaultRecoveryFlowOpen() { return false; },
    isPocketDeviceChangesDecisionOpen() { return false; },
    openRowMiniMenuForSelected() {
      if (counters.active) counters.menuOpen += 1;
      return true;
    },
    findCopyContextRootId(id) {
      return copySet.has(id) ? id : "";
    },
    copyContextPayloadForNode(node) {
      return { text: String(node?.label || ""), preserveLines: false, max: 220 };
    },
    copyText(value) {
      copiedTexts.push(String(value || ""));
      if (counters.active) counters.copied += 1;
      return { then(callback) { callback?.(true); return this; } };
    },
    showCopiedFeedback() {},

    requirePocketFileForChanges() { return true; },
    setStatus() {},
    saveLastSaveSnapshot() {},
    nowIso() { return "2026-09-21T12:00:00.000Z"; },
    confirm() { return true; },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay: Number(delay) || 0 });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval() { return 1; },
    clearInterval() {},
    PocketNodeContent: {
      readNode(entry) { return { text: String(entry?.details || "") }; },
    },
    pendingPathImport: null,
    pendingDeleteConfirmNodeId: "",
    pendingDeleteConfirmExpiresAt: 0,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  vm.runInContext(source(ACTIONS), context, { filename: ACTIONS });
  vm.runInContext(source(SCROLL), context, { filename: SCROLL });
  vm.runInContext(source(RENDER), context, { filename: RENDER });

  const actualRender = context.renderTree;
  context.renderTree = function countedRenderTree() {
    if (counters.active) {
      counters.fullRender += 1;
      sequence.push("renderTree");
    }
    return actualRender.apply(this, arguments);
  };

  const actualProjector = context.projectMainPrimarySelection;
  context.projectMainPrimarySelection = function countedProjector() {
    if (counters.active) {
      counters.projectorCalls += 1;
      sequence.push("projector");
    }
    return actualProjector.apply(this, arguments);
  };

  vm.runInContext(source(SMOOTH), context, { filename: SMOOTH });
  treeWrap.addEventListener("keydown", context.handleTreeKeydown);

  function materialise() {
    counters.active = false;
    context.renderTree();
    counters.active = false;
  }

  function row(id) {
    return context.getMountedMainRowForNodeId(id);
  }

  function branch(id) {
    return row(id)?.parentNode || null;
  }

  function reset() {
    for (const key of Object.keys(counters)) {
      if (key !== "active") counters[key] = 0;
    }
    sequence.length = 0;
    counters.active = true;
  }

  function stop() {
    counters.active = false;
  }

  function click(id, modifiers = {}) {
    const target = row(id);
    assert.ok(target, `mounted row ${id} must exist`);
    const event = {
      type: "click",
      target,
      bubbles: true,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...modifiers,
    };
    target.dispatchEvent(event);
    return event;
  }

  function keydown(id, key, modifiers = {}) {
    const target = id ? row(id) : treeWrap;
    assert.ok(target, `keydown target ${id || "tree"} must exist`);
    const event = {
      type: "keydown",
      target,
      bubbles: true,
      key,
      code: key === " " ? "Space" : key,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      getModifierState() { return false; },
      ...modifiers,
    };
    target.dispatchEvent(event);
    return event;
  }

  function inputFilter(value) {
    search.value = String(value);
    const event = { type: "input", target: search, bubbles: true };
    search.dispatchEvent(event);
    return event;
  }

  function runPendingTimers() {
    let guard = 0;
    while (timers.size > 0) {
      if (guard++ > 50) throw new Error("timer guard exceeded");
      const entries = Array.from(timers.entries()).sort((a, b) => a[0] - b[0]);
      timers.clear();
      for (const [, item] of entries) {
        if (typeof item.callback === "function") item.callback();
      }
    }
  }

  function pendingTimerCount() {
    return timers.size;
  }

  function presentationCounters() {
    return {
      createElement: counters.createElement,
      removeChild: counters.removeChild,
      reparent: counters.reparent,
      innerClear: counters.innerClear,
      treeQueryAll: counters.treeQueryAll,
      selectedAdd: counters.selectedAdd,
      selectedRemove: counters.selectedRemove,
      fullRender: counters.fullRender,
      projectorCalls: counters.projectorCalls,
      refreshMeta: counters.refreshMeta,
      focus: counters.focus,
      scroll: counters.scroll,
      saveWorkspace: counters.saveWorkspace,
      handoffChecks: counters.handoffChecks,
      handoffTrue: counters.handoffTrue,
    };
  }

  return {
    context,
    counters,
    sequence,
    document,
    treeRoot,
    treeWrap,
    body,
    search,
    HTMLElement,
    materialise,
    row,
    branch,
    reset,
    stop,
    click,
    keydown,
    inputFilter,
    runPendingTimers,
    pendingTimerCount,
    copiedTexts,
    presentationCounters,
  };
}


function setLabels(h, labels) {
  for (const [id, label] of Object.entries(labels)) {
    const node = h.context.state.nodes.find((entry) => entry.id === id);
    assert.ok(node, "node " + id + " exists");
    node.label = label;
  }
}

test("P249 Main typing feeds the existing Filter owner and keeps Main keyboard focus", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();
  const originalA = h.row("A");
  originalA.focus();

  const nodesBefore = plain(h.context.state.nodes);
  h.reset();
  h.keydown("A", "b");

  assert.equal(h.search.value, "b");
  assert.equal(h.context.state.selectedId, "A", "typing itself does not prefix-jump selection");
  assert.equal(h.context.state.typeJump.query, "");
  assert.equal(h.context.state.typeJump.lastAt, 0);
  assert.equal(h.pendingTimerCount(), 1);
  assert.equal(h.document.activeElement, originalA, "focus remains in Main before scheduled filter render");
  assert.equal(h.counters.saveWorkspace, 0);

  h.runPendingTimers();
  h.stop();

  assert.equal(h.context.state.selectedId, "B", "existing filter render repairs selection to first visible match");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B", "C"]);
  assert.equal(h.document.activeElement, h.row("B"), "Main owns keyboard again after filter render");
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P249 consecutive Main text extends one Filter query without type-jump timing semantics", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();
  h.row("A").focus();

  h.reset();
  h.keydown("A", "b");
  h.keydown("A", "e");

  assert.equal(h.search.value, "be");
  assert.equal(h.pendingTimerCount(), 1, "second character replaces the pending filter render");
  assert.equal(h.context.state.typeJump.query, "");
  assert.equal(h.context.state.typeJump.cycle, 0);
  assert.equal(h.context.state.typeJump.lastAt, 0);

  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.document.activeElement, h.row("B"));
});

test("P249 immediate ArrowDown settles filter before navigating filtered visible order", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();
  h.row("A").focus();

  h.reset();
  h.keydown("A", "b");
  assert.equal(h.pendingTimerCount(), 1);

  h.keydown("A", "ArrowDown");
  h.stop();

  assert.equal(h.search.value, "b");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B", "C"]);
  assert.equal(h.context.state.selectedId, "C", "ArrowDown moves from repaired B to next filtered row C");
  assert.equal(h.pendingTimerCount(), 0, "pending filter render was consumed before navigation");
  assert.equal(h.document.activeElement, h.row("C"));

  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "C", "no delayed second settlement");
});

test("P249 immediate Enter uses existing selected-node copy route after filter settlement", () => {
  const h = makeHarness({ selectedId: "A", copyIds: ["B"] });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();
  h.row("A").focus();

  h.reset();
  h.keydown("A", "b");
  assert.equal(h.pendingTimerCount(), 1);

  h.keydown("A", "Enter");
  h.stop();

  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.counters.copied, 1);
  assert.deepEqual(h.copiedTexts, ["Beta"]);
  assert.equal(h.search.value, "", "accepted copy loop continues to clear Filter");
  assert.equal(h.pendingTimerCount(), 0);
  assert.equal(h.document.activeElement, h.row("B"));
  assert.equal(h.counters.saveWorkspace, 0);

  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "B");
});

test("P249 Escape clears Filter and preserves the CURRENT selected filtered node", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();

  h.reset();
  h.keydown("A", "b");
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "B");

  h.keydown("B", "ArrowDown");
  assert.equal(h.context.state.selectedId, "C");

  h.keydown("C", "Escape");
  h.stop();

  assert.equal(h.search.value, "");
  assert.equal(h.context.state.selectedId, "C", "Escape must not rewind to pre-filter A");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B", "C"]);
  assert.equal(h.document.activeElement, h.row("C"));
  assert.equal(h.pendingTimerCount(), 0);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P249 no-match Escape keeps the unchanged current selectedId", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();

  h.reset();
  h.keydown("A", "z");
  h.runPendingTimers();
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), []);
  assert.equal(h.context.state.selectedId, "A");

  h.keydown(null, "Escape");
  h.stop();

  assert.equal(h.search.value, "");
  assert.equal(h.context.state.selectedId, "A");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B", "C"]);
  assert.equal(h.document.activeElement, h.row("A"));
  assert.equal(h.pendingTimerCount(), 0);
});

test("P249 Backspace edits the implicit Filter query and empty restores full tree with current selection", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();

  h.reset();
  h.keydown("A", "b");
  h.keydown("A", "e");
  h.runPendingTimers();
  assert.equal(h.search.value, "be");
  assert.equal(h.context.state.selectedId, "B");

  h.keydown("B", "Backspace");
  assert.equal(h.search.value, "b");
  assert.equal(h.pendingTimerCount(), 1);

  h.keydown("B", "Backspace");
  h.stop();

  assert.equal(h.search.value, "");
  assert.equal(h.pendingTimerCount(), 0);
  assert.equal(h.context.state.selectedId, "B");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B", "C"]);
  assert.equal(h.document.activeElement, h.row("B"));
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P249 filtered Main Left keeps tree semantics instead of Filter caret semantics", () => {
  const h = makeHarness({ selectedId: "B" });
  const parent = h.context.state.nodes.find((node) => node.id === "A");
  const child = h.context.state.nodes.find((node) => node.id === "B");
  const peer = h.context.state.nodes.find((node) => node.id === "C");
  parent.label = "Parent";
  child.label = "Beta";
  child.parentId = "A";
  peer.label = "Bravo";
  h.materialise();
  h.row("B").focus();

  h.reset();
  h.keydown("B", "b");
  h.runPendingTimers();
  assert.equal(h.document.activeElement, h.row("B"));

  h.keydown("B", "ArrowLeft");
  h.stop();

  assert.equal(h.search.value, "b");
  assert.equal(h.context.state.selectedId, "A", "ArrowLeft retains existing parent-selection meaning");
  assert.equal(h.document.activeElement, h.row("A"));
});

test("P249 genuine editing owners are not hijacked and explicit Filter input keeps text-field focus", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Bravo" });
  h.materialise();

  h.context.state.inlineEdit.id = "A";
  h.reset();
  h.keydown("A", "b");
  assert.equal(h.search.value, "");
  h.context.state.inlineEdit.id = "";

  h.search.focus();
  h.inputFilter("b");
  assert.equal(h.search.value, "b");
  assert.equal(h.document.activeElement, h.search);
  h.runPendingTimers();
  h.stop();

  assert.equal(h.document.activeElement, h.search, "direct Filter input remains the text-editing owner");
});

test("P249 explicit Main commands keep precedence over implicit filter text", () => {
  const h = makeHarness({ selectedId: "A" });
  h.materialise();

  h.reset();
  h.keydown("A", ".");
  h.stop();

  assert.equal(h.search.value, "");
  assert.equal(h.counters.menuOpen, 1);
});

test("P249 source retirement leaves legacy typeJump shape inert but no active Main or scroll timing owner", () => {
  const actions = source(ACTIONS);
  const smooth = source(SMOOTH);
  const scroll = source(SCROLL);

  const handlerStart = actions.indexOf("function handleTreeKeydown(ev)");
  const handler = actions.slice(handlerStart);
  assert.ok(handlerStart >= 0);
  assert.doesNotMatch(handler, /jumpSelectionByTypedChar\s*\(/);
  assert.match(handler, /applyPocketFilterQueryValue/);
  assert.match(handler, /settlePocketPendingFilterRender/);
  assert.match(handler, /isMainImplicitFilterBackspace/);

  assert.match(actions, /function jumpSelectionByTypedChar\(/, "legacy helper may remain for compatibility/history");
  assert.doesNotMatch(smooth, /typeJump\.lastAt|isRecentTypeJumpFor/);
  assert.doesNotMatch(scroll, /typeJump\.lastAt|isRecentTypeJumpFor/);
  assert.match(smooth, /global\.applyPocketFilterQueryValue = applyFilterQueryValue/);
  assert.match(smooth, /global\.settlePocketPendingFilterRender = settlePendingFilterRender/);
  assert.match(actions, /const targetId = hasNodeId\(state\.selectedId\)/);
  const clearStart = actions.indexOf("function clearFilterAndReturnHome");
  const clearEnd = actions.indexOf("\nfunction ", clearStart + 20);
  const clearFilter = actions.slice(clearStart, clearEnd);
  assert.doesNotMatch(clearFilter, /restoreRememberedSelectionAfterFilter|saveWorkspaceState/);
});
