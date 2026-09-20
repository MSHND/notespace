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
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...extra,
  };
}

function baseNodes(unrelatedCount = 0) {
  const nodes = [
    node("Parent", "root", 1001),
    node("A", "Parent", 1001),
    node("B", "Parent", 1002),
    node("B child", "B", 1001),
    node("B grandchild", "B child", 1001),
    node("C", "Parent", 1003),
    node("Unrelated", "root", 1002),
    node("U0", "Unrelated", 1001),
  ];
  if (unrelatedCount > 0) {
    nodes.push(node("Bulk", "root", 1003));
    for (let index = 0; index < unrelatedCount; index += 1) {
      nodes.push(node(`Bulk ${index}`, "Bulk", 1001 + index));
    }
  }
  return nodes;
}

function createHarness({ unrelatedCount = 0, collapsed = [] } = {}) {
  const counters = {
    active: false,
    createElement: 0,
    insertBefore: 0,
    removeChild: 0,
    innerClear: 0,
    treeQueryAll: 0,
    fullRender: 0,
    refreshSaveState: 0,
    persistPipSnapshot: 0,
    status: 0,
    scroll: 0,
  };
  const statuses = [];
  const scrollRows = [];
  let documentRef = null;
  let treeRoot = null;
  let gate = false;

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
    if (selector === ".label[data-full-label]") {
      return classes.includes("label") && element.getAttribute("data-full-label") !== null;
    }
    if (selector === ".row.selected") {
      return classes.includes("row") && classes.includes("selected");
    }
    let match = selector.match(/^\.row\[data-node-id="([^"]+)"\]$/);
    if (match) {
      return classes.includes("row") && element.getAttribute("data-node-id") === match[1];
    }
    match = selector.match(/^\[data-edit-id="([^"]+)"\]$/);
    if (match) return element.getAttribute("data-edit-id") === match[1];
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
      this.scrollWidth = 0;
      this.clientWidth = 0;
      this.style = {
        setProperty: (name, value) => {
          this.style[String(name)] = String(value);
        },
      };
      this.classList = {
        add: (...names) => setClassTokens(this, [...classTokens(this), ...names.map(String)]),
        remove: (...names) => {
          const drop = new Set(names.map(String));
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
    }

    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    removeAttribute(name) {
      this.attributes.delete(String(name));
    }

    addEventListener(type, handler) {
      const key = String(type);
      if (!this.listeners.has(key)) this.listeners.set(key, []);
      this.listeners.get(key).push(handler);
    }

    dispatch(type, values = {}) {
      const event = {
        type,
        target: this,
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {},
        ...values,
      };
      for (const handler of this.listeners.get(String(type)) || []) handler(event);
      return event;
    }

    appendChild(child) {
      if (!(child instanceof HTMLElement)) throw new TypeError("appendChild requires HTMLElement");
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
      if (before === child && child.parentNode === this) return child;
      if (counters.active) counters.insertBefore += 1;
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

    contains(candidate) {
      if (candidate === this) return true;
      return this.childNodes.some((child) => child.contains(candidate));
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
      if (documentRef) documentRef.activeElement = this;
    }

    select() {}
    scrollIntoView() {}

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
  const treeWrap = new HTMLElement("div");
  const search = new HTMLInputElement();
  const body = new HTMLElement("body");
  const document = {
    activeElement: null,
    body,
    documentElement: new HTMLElement("html"),
    createElement(tagName) {
      if (counters.active) counters.createElement += 1;
      return String(tagName).toLowerCase() === "input"
        ? new HTMLInputElement()
        : new HTMLElement(tagName);
    },
    querySelector(selector) {
      return treeRoot.querySelector(selector);
    },
    querySelectorAll(selector) {
      return treeRoot.querySelectorAll(selector);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  documentRef = document;

  const storage = new Map();
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect,
    JSON, Date, Math, Promise, structuredClone, HTMLElement, HTMLInputElement,
    state: {
      nodes: plain(baseNodes(unrelatedCount)),
      tombstones: [],
      rootExtras: {},
      dataExtras: {},
      collapsed: new Set(collapsed),
      selectedId: "B",
      focusRootId: "",
      rowMiniMenuOpen: false,
      rowMiniMenuNodeId: "",
      moveMode: false,
      inlineEdit: { id: "", isNew: false, autoFocus: false },
      ops: [],
      operationHighWater: 0,
      operationDocumentAnchor: null,
      activeSaveOperationCeiling: 0,
      documentBaseline: null,
      source: { schema: "portal.export.v1", fileName: "p236.json", writtenAt: "" },
      navigationMemory: {},
      typeJump: { query: "", cycle: 0, lastAt: 0 },
      pocketFile: {},
    },
    lastMoveUndoSnapshot: null,
    lastEditUndoSnapshot: null,
    lastDeleteUndoSnapshot: null,
    lastTreeUndoKind: "",
    el: { search, treeRoot, treeWrap },
    document,
    CSS: { escape(value) { return String(value); } },
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
      removeItem(key) { storage.delete(String(key)); },
    },
    DEVICE_CHANGE_SEQUENCE_KEY: "p236.sequence",
    nowIso() { return "2026-09-20T01:00:00.000Z"; },
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
    maxSiblingOrder(parentId) {
      const values = context.state.nodes
        .filter((entry) => (entry.parentId || "root") === (parentId || "root"))
        .map((entry) => Number(entry.order) || 0);
      return Math.max(1000, ...values);
    },
    isManagedSystemBucketNode() { return false; },
    isCompletedSystemBucketNode() { return false; },
    requirePocketFileForChanges() { return true; },
    clearInlineEditState() { context.state.inlineEdit = { id: "", isNew: false, autoFocus: false }; },
    expandPathToNode() {},
    refreshSaveState() { counters.refreshSaveState += 1; },
    refreshMeta() {},
    persistPipSnapshot() { counters.persistPipSnapshot += 1; },
    softlyEnsureSelectionVisible() {},
    flashTouchedRow() {},
    scrollRowComfortably(row) { counters.scroll += 1; scrollRows.push(row); },
    setStatus(...args) { counters.status += 1; statuses.push(args); },
    saveLocalSafetySnapshot() { return true; },
    saveLastSaveSnapshot() {},
    canShowPocketTree() { return !gate; },
    readLocalSafetySnapshot() { return null; },
    normaliseDetails(value) { return String(value || ""); },
    getPath(id) { return String(id || ""); },
    nodeAttentionState() { return ""; },
    shouldCopyOnSingleClick() { return false; },
    installTreeGutterDrag() {},
    cancelPendingCopyClick() {},
    scheduleCopyClick() {},
    isDetailsEditorOpen() { return false; },
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; },
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    confirm() { return true; },
    PocketDeviceChanges: {
      cloneJsonCompatible(value) {
        try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; }
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
    PocketNodeContent: {
      readNode(entry) { return { text: String(entry?.details || "") }; },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of [SHADOW, HISTORY, ACTIONS, RENDER]) {
    vm.runInContext(source(file), context, { filename: file });
  }

  // Keep the real history/tree semantic owners, but replace chrome-only refresh/status
  // work exactly as the historical focused semantic harnesses do.
  context.refreshSaveState = () => { counters.refreshSaveState += 1; };
  context.refreshMeta = () => {};
  context.setStatus = (...args) => { counters.status += 1; statuses.push(args); };

  const fullMaterialise = context.renderTree;
  context.renderTree = function countedRenderTree() {
    counters.fullRender += 1;
    return fullMaterialise.apply(this, arguments);
  };

  function resetCounters() {
    counters.createElement = 0;
    counters.insertBefore = 0;
    counters.removeChild = 0;
    counters.innerClear = 0;
    counters.treeQueryAll = 0;
    counters.fullRender = 0;
    counters.refreshSaveState = 0;
    counters.persistPipSnapshot = 0;
    counters.status = 0;
    counters.scroll = 0;
    statuses.length = 0;
    scrollRows.length = 0;
    counters.active = true;
  }

  function materialise() {
    counters.active = false;
    context.renderTree();
    counters.active = false;
  }

  function rowFor(id) {
    return context.getMountedMainRowForNodeId(id);
  }

  function branchFor(id) {
    return rowFor(id)?.parentNode || null;
  }

  function childListFor(parentId) {
    const branch = branchFor(parentId);
    if (!branch) return null;
    return branch.childNodes.find((child) => classTokens(child).includes("children")) || null;
  }

  function childBranchIds(parentId) {
    const list = childListFor(parentId);
    if (!list) return [];
    return list.childNodes.map((branch) => branch.firstChild?.getAttribute("data-node-id") || "");
  }

  function visibleRowIds() {
    return treeRoot.querySelectorAll(".row[data-node-id]")
      .map((row) => row.getAttribute("data-node-id"));
  }

  function presentationCounts() {
    return {
      createElement: counters.createElement,
      insertBefore: counters.insertBefore,
      removeChild: counters.removeChild,
      innerClear: counters.innerClear,
      treeQueryAll: counters.treeQueryAll,
      fullRender: counters.fullRender,
      scroll: counters.scroll,
    };
  }

  function siblingIds(parentId = "root") {
    return context.sortNodesForParent(parentId).map((entry) => entry.id);
  }

  function capturedForSequence(sequence) {
    const frozen = context.freezePocketStarlingOwnerWorkingSetThrough(sequence);
    return plain(frozen?.operations || []).slice(-2);
  }

  return {
    context,
    counters,
    statuses,
    scrollRows,
    treeRoot,
    treeWrap,
    search,
    document,
    HTMLElement,
    setGate(value) { gate = !!value; },
    materialise,
    resetCounters,
    rowFor,
    branchFor,
    childListFor,
    childBranchIds,
    visibleRowIds,
    presentationCounts,
    siblingIds,
    capturedForSequence,
  };
}

function captureIdentity(h) {
  return {
    bBranch: h.branchFor("B"),
    bRow: h.rowFor("B"),
    childBranch: h.branchFor("B child"),
    childRow: h.rowFor("B child"),
    grandBranch: h.branchFor("B grandchild"),
    grandRow: h.rowFor("B grandchild"),
    aBranch: h.branchFor("A"),
    aRow: h.rowFor("A"),
    cBranch: h.branchFor("C"),
    cRow: h.rowFor("C"),
    unrelatedBranch: h.branchFor("Unrelated"),
    unrelatedRow: h.rowFor("Unrelated"),
    u0Branch: h.branchFor("U0"),
    u0Row: h.rowFor("U0"),
  };
}

function assertIdentity(h, refs) {
  assert.equal(h.branchFor("B"), refs.bBranch);
  assert.equal(h.rowFor("B"), refs.bRow);
  assert.equal(h.branchFor("B child"), refs.childBranch);
  assert.equal(h.rowFor("B child"), refs.childRow);
  assert.equal(h.branchFor("B grandchild"), refs.grandBranch);
  assert.equal(h.rowFor("B grandchild"), refs.grandRow);
  assert.equal(h.branchFor("A"), refs.aBranch);
  assert.equal(h.rowFor("A"), refs.aRow);
  assert.equal(h.branchFor("C"), refs.cBranch);
  assert.equal(h.rowFor("C"), refs.cRow);
  assert.equal(h.branchFor("Unrelated"), refs.unrelatedBranch);
  assert.equal(h.rowFor("Unrelated"), refs.unrelatedRow);
  assert.equal(h.branchFor("U0"), refs.u0Branch);
  assert.equal(h.rowFor("U0"), refs.u0Row);
}

function assertSuccessfulLocalMoveCounts(h) {
  assert.deepEqual(h.presentationCounts(), {
    createElement: 0,
    insertBefore: 1,
    removeChild: 0,
    innerClear: 0,
    treeQueryAll: 0,
    fullRender: 0,
    scroll: 1,
  });
  assert.equal(h.counters.refreshSaveState, 1);
  assert.equal(h.counters.persistPipSnapshot, 1);
  assert.equal(h.counters.status, 1);
}

test("P236 actual moveNodeWithinSiblings move-up uses one bounded branch move and preserves branch/descendant/unrelated identity", () => {
  const h = createHarness();
  h.materialise();
  const refs = captureIdentity(h);

  refs.bRow.classList.add("multiSelected");
  refs.unrelatedRow.classList.add("decorated");
  const phoneButton = new h.HTMLElement("button");
  phoneButton.className = "phoneRowMenuBtn";
  refs.bRow.appendChild(phoneButton);
  let descendantListenerCalls = 0;
  refs.childRow.addEventListener("probe", () => { descendantListenerCalls += 1; });

  h.resetCounters();
  h.context.moveNodeWithinSiblings("B", -1);

  assert.deepEqual(h.siblingIds("Parent"), ["B", "A", "C"]);
  assert.deepEqual(h.childBranchIds("Parent"), ["B", "A", "C"]);
  assert.equal(h.context.nodeMap().get("B").parentId, "Parent");
  assert.equal(h.context.nodeMap().get("B child").parentId, "B");
  assert.equal(h.context.nodeMap().get("B grandchild").parentId, "B child");
  assertIdentity(h, refs);
  assertSuccessfulLocalMoveCounts(h);

  assert.equal(refs.bRow.classList.contains("selected"), true);
  assert.equal(refs.bRow.classList.contains("multiSelected"), true);
  assert.equal(refs.unrelatedRow.classList.contains("decorated"), true);
  assert.equal(phoneButton.parentNode, refs.bRow);
  refs.childRow.dispatch("probe");
  assert.equal(descendantListenerCalls, 1);
  assert.equal(h.scrollRows.at(-1), refs.bRow);
  assert.equal(h.document.activeElement, h.treeWrap);

  const forward = plain(h.context.state.ops.at(-1));
  assert.equal(forward.type, "move_up");
  assert.equal(forward.toIndex, 0);
  assert.deepEqual(plain(h.context.lastMoveUndoSnapshot.p151MoveUndoWitness), {
    nodeId: "B",
    parentId: "Parent",
    index: 1,
    operationSequence: forward.seq,
    forwardSemanticCaptured: true,
  });
  const captured = h.capturedForSequence(forward.seq);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].type, "payload");
  assert.equal(captured[0].input.nodeId, "B");
  assert.deepEqual(captured[1], {
    type: "reorder",
    input: { nodeId: "B", fromIndex: 1, toIndex: 0 },
  });
  assert.equal(h.statuses.at(-1)?.[0], "Moved up.");
  assert.equal(h.statuses.at(-1)?.[2]?.action?.label, "Undo");
  assert.equal(typeof h.statuses.at(-1)?.[2]?.action?.onClick, "function");
});

test("P236 actual moveNodeWithinSiblings move-down uses the same bounded projector and exact existing identities", () => {
  const h = createHarness();
  h.materialise();
  const refs = captureIdentity(h);
  h.resetCounters();

  h.context.moveNodeWithinSiblings("B", 1);

  assert.deepEqual(h.siblingIds("Parent"), ["A", "C", "B"]);
  assert.deepEqual(h.childBranchIds("Parent"), ["A", "C", "B"]);
  assertIdentity(h, refs);
  assertSuccessfulLocalMoveCounts(h);

  const forward = plain(h.context.state.ops.at(-1));
  assert.equal(forward.type, "move_down");
  assert.equal(forward.toIndex, 2);
  const captured = h.capturedForSequence(forward.seq);
  assert.deepEqual(captured[1], {
    type: "reorder",
    input: { nodeId: "B", fromIndex: 1, toIndex: 3 },
  });
});

test("P236 presentation work is fixed-bounded with 1000+ unrelated visible nodes", () => {
  function run(unrelatedCount) {
    const h = createHarness({ unrelatedCount });
    h.materialise();
    const refs = captureIdentity(h);
    const first = unrelatedCount ? h.rowFor("Bulk 0") : null;
    const middle = unrelatedCount ? h.rowFor(`Bulk ${Math.floor(unrelatedCount / 2)}`) : null;
    const last = unrelatedCount ? h.rowFor(`Bulk ${unrelatedCount - 1}`) : null;

    h.resetCounters();
    h.context.moveNodeWithinSiblings("B", -1);

    assertIdentity(h, refs);
    if (unrelatedCount) {
      assert.equal(h.rowFor("Bulk 0"), first);
      assert.equal(h.rowFor(`Bulk ${Math.floor(unrelatedCount / 2)}`), middle);
      assert.equal(h.rowFor(`Bulk ${unrelatedCount - 1}`), last);
    }
    assert.deepEqual(h.siblingIds("Parent"), ["B", "A", "C"]);
    assertSuccessfulLocalMoveCounts(h);
    return h.presentationCounts();
  }

  const tiny = run(0);
  const large = run(1001);
  assert.deepEqual(large, tiny);
});

test("P236 retains P151 forward capture and full-render inverse undo semantics", () => {
  const h = createHarness();
  h.materialise();
  h.resetCounters();
  h.context.moveNodeWithinSiblings("B", -1);
  const forward = plain(h.context.state.ops.at(-1));

  assert.deepEqual(h.capturedForSequence(forward.seq)[1], {
    type: "reorder",
    input: { nodeId: "B", fromIndex: 1, toIndex: 0 },
  });
  assert.equal(h.counters.fullRender, 0);

  h.resetCounters();
  assert.equal(h.context.undoLastMoveAction(), undefined);
  const undo = plain(h.context.state.ops.at(-1));
  assert.equal(undo.type, "undo_move_up");
  assert.deepEqual(h.siblingIds("Parent"), ["A", "B", "C"]);
  assert.equal(h.counters.fullRender, 1, "undo remains on accepted full-render path in P236");
  assert.deepEqual(h.capturedForSequence(undo.seq)[1], {
    type: "reorder",
    input: { nodeId: "B", fromIndex: 0, toIndex: 2 },
  });
});

test("P236 active filter declines before local mutation and performs exactly one authoritative full render", () => {
  const h = createHarness();
  h.materialise();
  h.search.value = "B child";
  h.resetCounters();

  h.context.moveNodeWithinSiblings("B", -1);

  assert.deepEqual(h.siblingIds("Parent"), ["B", "A", "C"]);
  assert.equal(h.counters.insertBefore, 0);
  assert.equal(h.counters.fullRender, 1);
  assert.equal(h.counters.innerClear, 1);
  assert.deepEqual(h.visibleRowIds(), ["Parent", "B", "B child", "B grandchild"]);
});

function runFallbackMutation(setup) {
  const h = createHarness();
  h.materialise();
  setup(h);
  h.resetCounters();
  h.context.moveNodeWithinSiblings("B", -1);
  assert.deepEqual(h.siblingIds("Parent"), ["B", "A", "C"]);
  assert.deepEqual(h.childBranchIds("Parent"), ["B", "A", "C"]);
  assert.equal(h.counters.insertBefore, 0, "projector must not partially move a branch");
  assert.equal(h.counters.fullRender, 1);
  assert.equal(h.counters.innerClear, 1);
  return h;
}

test("P236 stale/missing/split-parent/wrong-adjacency evidence fails closed to full render", () => {
  runFallbackMutation((h) => {
    h.branchFor("B").parentNode.removeChild(h.branchFor("B"));
  });

  runFallbackMutation((h) => {
    h.branchFor("A").parentNode.removeChild(h.branchFor("A"));
  });

  runFallbackMutation((h) => {
    const unrelatedList = h.childListFor("Unrelated");
    unrelatedList.appendChild(h.branchFor("A"));
  });

  runFallbackMutation((h) => {
    const parentList = h.childListFor("Parent");
    parentList.insertBefore(h.branchFor("C"), h.branchFor("B"));
  });

  const hidden = createHarness({ collapsed: ["Parent"] });
  hidden.materialise();
  assert.equal(hidden.rowFor("B"), null);
  hidden.resetCounters();
  hidden.context.moveNodeWithinSiblings("B", -1);
  assert.deepEqual(hidden.siblingIds("Parent"), ["B", "A", "C"]);
  assert.equal(hidden.counters.insertBefore, 0);
  assert.equal(hidden.counters.fullRender, 1);
  assert.equal(hidden.rowFor("B"), null);
});

test("P236 registry is full-render scoped, excludes unmounted rows, and stale row refocus falls back to querySelector", () => {
  const h = createHarness();
  h.materialise();
  const firstB = h.rowFor("B");
  assert.ok(firstB);

  h.materialise();
  const secondB = h.rowFor("B");
  assert.ok(secondB);
  assert.notEqual(secondB, firstB);
  assert.equal(h.treeRoot.contains(firstB), false);

  h.context.state.collapsed.add("Parent");
  h.materialise();
  assert.equal(h.rowFor("Parent") instanceof h.HTMLElement, true);
  assert.equal(h.rowFor("B"), null);

  h.context.state.collapsed.delete("Parent");
  h.search.value = "Unrelated";
  h.materialise();
  assert.equal(h.rowFor("B"), null);
  assert.ok(h.rowFor("Unrelated"));

  h.search.value = "";
  h.setGate(true);
  h.materialise();
  assert.equal(h.rowFor("B"), null);

  h.setGate(false);
  h.materialise();
  const staleRow = h.rowFor("B");
  const staleBranch = h.branchFor("B");
  const parentList = staleBranch.parentNode;
  parentList.removeChild(staleBranch);

  const replacementBranch = new h.HTMLElement("li");
  replacementBranch.className = "treeNode";
  const replacementRow = new h.HTMLElement("div");
  replacementRow.className = "row selected";
  replacementRow.setAttribute("data-node-id", "B");
  replacementBranch.appendChild(replacementRow);
  parentList.appendChild(replacementBranch);

  h.resetCounters();
  h.context.refocusTreeNavigation("B");
  assert.equal(h.rowFor("B"), null, "stale registry entry must not be exposed as current");
  assert.equal(h.counters.treeQueryAll, 1, "existing querySelector fallback must run once");
  assert.equal(h.scrollRows.at(-1), replacementRow);
  assert.notEqual(replacementRow, staleRow);
});

test("P236 source ownership keeps full render global, projector renderer-owned, and tree-actions handoff singular", () => {
  const render = source(RENDER);
  const actions = source(ACTIONS);

  assert.match(render, /const mainMountedNodeRegistry = new Map\(\);/);
  assert.match(render, /function projectMainSameParentReorder\(/);
  assert.match(render, /function renderTree\(\)[\s\S]*?el\.treeRoot\.innerHTML = "";/);

  const projectorStart = render.indexOf("function projectMainSameParentReorder(");
  const projectorEnd = render.indexOf("\nfunction ", projectorStart + 20);
  assert.ok(projectorStart >= 0 && projectorEnd > projectorStart);
  const projector = render.slice(projectorStart, projectorEnd);
  assert.doesNotMatch(projector, /\bstate\.|recordOp|capturePocket|Undo|undoLast|refreshSaveState|persistPipSnapshot/);

  assert.doesNotMatch(actions, /function projectMainSameParentReorder\(/);
  const moveStart = actions.indexOf("function moveNodeWithinSiblings(");
  const moveEnd = actions.indexOf("\nfunction ", moveStart + 20);
  assert.ok(moveStart >= 0 && moveEnd > moveStart);
  const move = actions.slice(moveStart, moveEnd);
  assert.equal((move.match(/projectMainSameParentReorder\(/g) || []).length, 1);
  assert.equal((move.match(/if \(!projected\) renderTree\(\);/g) || []).length, 1);
  assert.match(move, /refreshSaveState[\s\S]*projectMainSameParentReorder[\s\S]*persistPipSnapshot[\s\S]*refocusTreeNavigation[\s\S]*setStatus/);

  for (const untouchedOwner of [
    "indentNodeById",
    "outdentNodeById",
    "moveTreeBranchByDrop",
    "insertSiblingBelow",
    "insertChildUnder",
    "deleteNodeById",
  ]) {
    const start = actions.indexOf(`function ${untouchedOwner}(`);
    const end = actions.indexOf("\nfunction ", start + 20);
    assert.ok(start >= 0, untouchedOwner);
    assert.doesNotMatch(actions.slice(start, end > start ? end : actions.length), /projectMainSameParentReorder/);
  }
});
