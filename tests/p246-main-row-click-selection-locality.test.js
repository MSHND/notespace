"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const RENDER = "js/pocket-render.js";
const SMOOTH = "js/pocket-list-smoothing.js";
const MULTI = "js/pocket-multi-select.js";

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
  };
  const sequence = [];
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
    isManagedSystemBucketNode() { return false; },
    requirePocketFileForChanges() { return true; },
    setStatus() {},
    saveLastSaveSnapshot() {},
    nowIso() { return "2026-09-21T12:00:00.000Z"; },
    confirm() { return true; },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    setTimeout(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    PocketNodeContent: {
      readNode(entry) { return { text: String(entry?.details || "") }; },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

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
  vm.runInContext(source(MULTI), context, { filename: MULTI });

  const actualConsume = context.consumePocketOrdinaryRowClickMultiClear;
  context.consumePocketOrdinaryRowClickMultiClear = function countedConsume(ev) {
    if (counters.active) counters.handoffChecks += 1;
    const result = actualConsume(ev);
    if (counters.active && result) counters.handoffTrue += 1;
    return result;
  };

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
    presentationCounters,
  };
}

test("P246 actual plain desktop row click is fixed-bounded from tiny to 1000+ unrelated mounted rows", () => {
  function run(unrelatedCount) {
    const h = makeHarness({ unrelatedCount, selectedId: "A" });
    h.materialise();

    const identities = {
      aRow: h.row("A"), aBranch: h.branch("A"),
      bRow: h.row("B"), bBranch: h.branch("B"),
      cRow: h.row("C"), cBranch: h.branch("C"),
      unrelated: unrelatedCount > 0
        ? [
            ["U0", h.row("U0"), h.branch("U0")],
            [`U${Math.floor(unrelatedCount / 2)}`, h.row(`U${Math.floor(unrelatedCount / 2)}`), h.branch(`U${Math.floor(unrelatedCount / 2)}`)],
            [`U${unrelatedCount - 1}`, h.row(`U${unrelatedCount - 1}`), h.branch(`U${unrelatedCount - 1}`)],
          ]
        : [],
    };
    const nodesBefore = plain(h.context.state.nodes);

    h.reset();
    h.click("B");
    h.stop();

    assert.equal(h.context.state.selectedId, "B");
    assert.equal(identities.aRow.classList.contains("selected"), false);
    assert.equal(identities.bRow.classList.contains("selected"), true);
    assert.equal(h.counters.selectedRemove, 1);
    assert.equal(h.counters.selectedAdd, 1);
    assert.equal(h.counters.fullRender, 0);
    assert.equal(h.counters.projectorCalls, 1);
    assert.equal(h.counters.refreshMeta, 1);
    assert.equal(h.counters.treeQueryAll, 0);
    assert.equal(h.counters.createElement, 0);
    assert.equal(h.counters.removeChild, 0);
    assert.equal(h.counters.reparent, 0);
    assert.equal(h.counters.innerClear, 0);
    assert.equal(h.counters.saveWorkspace, 0);
    assert.equal(h.counters.handoffChecks, 1);
    assert.equal(h.counters.handoffTrue, 0);
    assert.equal(h.document.activeElement, identities.bRow);
    assert.equal(h.row("A"), identities.aRow);
    assert.equal(h.branch("A"), identities.aBranch);
    assert.equal(h.row("B"), identities.bRow);
    assert.equal(h.branch("B"), identities.bBranch);
    assert.equal(h.row("C"), identities.cRow);
    assert.equal(h.branch("C"), identities.cBranch);
    for (const [id, row, branch] of identities.unrelated) {
      assert.equal(h.row(id), row, `${id} row identity survives`);
      assert.equal(h.branch(id), branch, `${id} branch identity survives`);
    }
    assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
    assert.equal(h.counters.shouldCopy, 1);
    assert.equal(h.counters.scheduleCopy + h.counters.cancelCopy, 1);
    assert.ok(h.sequence.indexOf("shouldCopy") < h.sequence.indexOf("projector"));
    return h.presentationCounters();
  }

  const tiny = run(0);
  const large = run(1001);
  assert.deepEqual(large, tiny, "plain row-click presentation work must stay fixed-bounded as unrelated rows grow");
});

test("P246 same-target plain click avoids render/projector/class churn while preserving click side effects", () => {
  const h = makeHarness({ selectedId: "B", copyIds: ["B"] });
  h.materialise();
  const bRow = h.row("B");
  const bBranch = h.branch("B");
  const nodesBefore = plain(h.context.state.nodes);

  h.reset();
  h.click("B");
  h.stop();

  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.row("B"), bRow);
  assert.equal(h.branch("B"), bBranch);
  assert.equal(bRow.classList.contains("selected"), true);
  assert.equal(h.counters.fullRender, 0);
  assert.equal(h.counters.projectorCalls, 0);
  assert.equal(h.counters.selectedAdd, 0);
  assert.equal(h.counters.selectedRemove, 0);
  assert.equal(h.counters.refreshMeta, 1);
  assert.equal(h.counters.focus, 2, "clicked row focus plus accepted registry-first focus owner");
  assert.equal(h.document.activeElement, bRow);
  assert.equal(h.counters.shouldCopy, 1);
  assert.equal(h.counters.scheduleCopy, 1);
  assert.equal(h.counters.cancelCopy, 0);
  assert.equal(h.counters.saveWorkspace, 0);
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
});

test("P246 genuine modifier selection then ordinary capture→bubble click hands multi-clear to one full-render fallback", () => {
  const h = makeHarness({ selectedId: "A" });
  h.materialise();

  h.reset();
  h.click("B", { ctrlKey: true });
  h.stop();

  assert.equal(h.context.state.selectedId, "B");
  assert.deepEqual(Array.from(h.context.state.multiSelectedIds), ["A"]);
  assert.equal(h.context.state.multiSelectAnchorId, "B");
  assert.equal(h.row("A").classList.contains("multiSelected"), true, "genuine Ctrl-click establishes mounted extra presentation");

  h.reset();
  h.click("C");
  h.stop();

  assert.equal(h.context.state.selectedId, "C");
  assert.equal(h.context.state.multiSelectedIds.size, 0);
  assert.equal(h.context.state.multiSelectAnchorId, "C");
  assert.equal(h.counters.handoffChecks, 1);
  assert.equal(h.counters.handoffTrue, 1, "capture→bubble handoff is consumed on this click");
  assert.equal(h.counters.projectorCalls, 0, "primary projector must not partially run before multi-clear fallback");
  assert.equal(h.counters.selectedAdd, 0);
  assert.equal(h.counters.selectedRemove, 0);
  assert.equal(h.counters.fullRender, 1);
  assert.equal(h.treeRoot.querySelectorAll(".row.multiSelected").length, 0);
  assert.equal(h.row("C").classList.contains("selected"), true);
  assert.equal(h.treeRoot.querySelectorAll(".row.selected").length, 1);
  assert.equal(h.document.activeElement, h.row("C"));
  assert.equal(h.counters.saveWorkspace, 0, "ordinary clear click adds no persistence call");

  h.reset();
  h.click("B");
  h.stop();
  assert.equal(h.counters.handoffTrue, 0, "handoff does not survive beyond the clearing gesture");
});

test("P246 projector refusal on an active filter uses authoritative full render with no partial primary-class mutation", () => {
  const h = makeHarness({ selectedId: "A" });
  h.materialise();
  const oldA = h.row("A");
  const oldB = h.row("B");
  h.search.value = "B";

  h.reset();
  h.click("B");
  h.stop();

  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.counters.projectorCalls, 1);
  assert.equal(h.counters.selectedRemove, 0, "projector refuses before partial class mutation");
  assert.equal(h.counters.selectedAdd, 0, "projector refuses before partial class mutation");
  assert.equal(h.counters.fullRender, 1);
  assert.equal(h.treeRoot.contains(oldA), false);
  assert.equal(h.treeRoot.contains(oldB), false);
  assert.equal(h.row("B").classList.contains("selected"), true);
  assert.equal(h.document.activeElement, h.row("B"));
});

test("P246 copy/focus/meta/persistence semantics remain on exactly one ordinary-click path", () => {
  for (const [copyReady, expected] of [[false, "cancelCopy"], [true, "scheduleCopy"]]) {
    const h = makeHarness({ selectedId: "A", copyIds: copyReady ? ["B"] : [] });
    h.materialise();
    const nodesBefore = plain(h.context.state.nodes);

    h.reset();
    h.click("B");
    h.stop();

    assert.equal(h.counters.shouldCopy, 1);
    assert.equal(h.counters.refreshMeta, 1);
    assert.equal(h.counters.focus, 2);
    assert.equal(h.counters.scheduleCopy, copyReady ? 1 : 0);
    assert.equal(h.counters.cancelCopy, copyReady ? 0 : 1);
    assert.equal(h.counters.saveWorkspace, 0);
    assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
    assert.ok(h.sequence.indexOf("shouldCopy") < h.sequence.indexOf("projector"));
    assert.ok(h.sequence.indexOf(expected) > h.sequence.indexOf("projector"));
  }
});

test("P246 source ownership is limited to ordinary row-click handoff and leaves out-of-scope owners intact", () => {
  const render = source(RENDER);
  const multi = source(MULTI);

  const clickStart = render.indexOf('row.addEventListener("click"');
  const clickEnd = render.indexOf('row.addEventListener("dblclick"', clickStart);
  const rowClick = render.slice(clickStart, clickEnd);
  assert.match(rowClick, /const previousId = cleanText\(state\.selectedId, 80\)/);
  assert.match(rowClick, /consumePocketOrdinaryRowClickMultiClear\(ev\)/);
  assert.match(rowClick, /plainDesktopClick/);
  assert.match(rowClick, /projectMainPrimarySelection\(previousId, node\.id\)/);
  assert.match(rowClick, /if \(!settledLocally\) renderTree\(\)/);
  assert.doesNotMatch(rowClick, /saveWorkspaceState|persistPipSnapshot|recordOp/);

  const dblStart = clickEnd;
  const dblEnd = render.indexOf('row.addEventListener("contextmenu"', dblStart);
  const dbl = render.slice(dblStart, dblEnd);
  assert.match(dbl, /renderTree\(\)/);
  assert.doesNotMatch(dbl, /projectMainPrimarySelection|consumePocketOrdinaryRowClickMultiClear/);

  const contextStart = dblEnd;
  const contextEnd = render.indexOf("\n\n    li.appendChild", contextStart);
  const contextMenu = render.slice(contextStart, contextEnd);
  assert.match(contextMenu, /renderTree\(\)/);
  assert.doesNotMatch(contextMenu, /projectMainPrimarySelection|consumePocketOrdinaryRowClickMultiClear/);

  const handleStart = multi.indexOf("function handleTreeClick(");
  const handleEnd = multi.indexOf("\n  function ", handleStart + 20);
  const handle = multi.slice(handleStart, handleEnd);
  assert.match(handle, /const clearedMultiSelection = clearMultiSelection\(\{ silent: true \}\)/);
  assert.match(handle, /ordinaryRowClickMultiClearEvents\.add\(ev\)/);
  assert.match(handle, /state\.multiSelectAnchorId = id/);
  assert.match(handle, /if \(rangeKey\) applyShiftSelection\(id\)/);
  assert.match(handle, /else applyCtrlSelection\(id\)/);
  assert.doesNotMatch(handle, /querySelectorAll\("\.row\.multiSelected"\)/);

  assert.match(multi, /const ordinaryRowClickMultiClearEvents = new WeakSet\(\)/);
  assert.match(multi, /ordinaryRowClickMultiClearEvents\.delete\(ev\)/);
});
