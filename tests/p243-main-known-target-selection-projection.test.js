"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const RENDER = "js/pocket-render.js";
const ACTIONS = "js/pocket-tree-actions.js";
const SMOOTH = "js/pocket-list-smoothing.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function makeHarness({ unrelatedCount = 0, loadActions = true, loadSmoothing = false } = {}) {
  const counters = {
    create: 0,
    remove: 0,
    reparent: 0,
    query: 0,
    querySelected: 0,
    queryVisible: 0,
    queryVisibleRows: 0,
    selectedAdd: 0,
    selectedRemove: 0,
    render: 0,
    refreshMeta: 0,
    focus: 0,
    scroll: 0,
    saveWorkspace: 0,
    discoveryCalls: 0,
    discoveryVisited: 0,
    projectorCalls: 0,
  };
  let active = false;
  let documentRef = null;
  let treeRoot = null;

  function classes(el) {
    return String(el?.className || "").split(/\s+/).filter(Boolean);
  }
  function setClasses(el, values) {
    el.className = Array.from(new Set(values.filter(Boolean))).join(" ");
  }
  function matches(el, selector) {
    if (!(el instanceof HTMLElement)) return false;
    const tokens = classes(el);
    if (selector === ".row[data-node-id]") {
      return tokens.includes("row") && !!el.getAttribute("data-node-id");
    }
    if (selector === ".row.selected") {
      return tokens.includes("row") && tokens.includes("selected");
    }
    const rowMatch = selector.match(/^\.row\[data-node-id="([^"]+)"\]$/);
    if (rowMatch) {
      return tokens.includes("row") && el.getAttribute("data-node-id") === rowMatch[1];
    }
    return false;
  }

  class HTMLElement {
    constructor(tag = "div") {
      this.tagName = String(tag).toUpperCase();
      this.className = "";
      this.attributes = new Map();
      this.childNodes = [];
      this.parentNode = null;
      this.value = "";
      this.hidden = false;
      this.scrollTop = 0;
      this.scrollHeight = 1000;
      this.clientHeight = 500;
      this.listeners = new Map();
      this.style = {};
      this.classList = {
        add: (...names) => {
          if (active && names.map(String).includes("selected") && !classes(this).includes("selected")) counters.selectedAdd += 1;
          setClasses(this, [...classes(this), ...names.map(String)]);
        },
        remove: (...names) => {
          if (active && names.map(String).includes("selected") && classes(this).includes("selected")) counters.selectedRemove += 1;
          const drop = new Set(names.map(String));
          setClasses(this, classes(this).filter((name) => !drop.has(name)));
        },
        contains: (name) => classes(this).includes(String(name)),
        toggle: (name, force) => {
          const has = classes(this).includes(String(name));
          const next = force === undefined ? !has : !!force;
          if (next && !has) this.classList.add(name);
          if (!next && has) this.classList.remove(name);
          return next;
        },
      };
    }
    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
    addEventListener(type, handler) {
      const key = String(type);
      if (!this.listeners.has(key)) this.listeners.set(key, []);
      this.listeners.get(key).push(handler);
    }
    appendChild(child) {
      if (active) {
        counters.reparent += child.parentNode ? 1 : 0;
        counters.create += child.parentNode ? 0 : 1;
      }
      if (child.parentNode) {
        const old = child.parentNode;
        const index = old.childNodes.indexOf(child);
        if (index >= 0) old.childNodes.splice(index, 1);
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index < 0) throw new Error("NotFoundError");
      if (active) counters.remove += 1;
      this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    contains(candidate) {
      if (candidate === this) return true;
      return this.childNodes.some((child) => child.contains(candidate));
    }
    querySelectorAll(selector) {
      const countedRootQuery = active && this === treeRoot;
      if (countedRootQuery) {
        counters.query += 1;
        if (selector === ".row.selected") counters.querySelected += 1;
        if (selector === ".row[data-node-id]") counters.queryVisible += 1;
      }
      const found = [];
      const visit = (parent) => {
        for (const child of parent.childNodes) {
          if (matches(child, selector)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      if (countedRootQuery && selector === ".row[data-node-id]") counters.queryVisibleRows += found.length;
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() {
      counters.focus += active ? 1 : 0;
      if (documentRef) documentRef.activeElement = this;
    }
    getBoundingClientRect() {
      return { top: 100, bottom: 124, left: 0, right: 200, width: 200, height: 24 };
    }
    scrollIntoView() { if (active) counters.scroll += 1; }
  }

  class HTMLInputElement extends HTMLElement {
    constructor() {
      super("input");
      this.value = "";
    }
  }

  treeRoot = new HTMLElement("ul");
  const treeWrap = new HTMLElement("div");
  treeWrap.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500 });
  treeWrap.scrollBy = () => { if (active) counters.scroll += 1; };
  const search = new HTMLInputElement();
  const body = new HTMLElement("body");

  const document = {
    body,
    activeElement: null,
    readyState: "complete",
    createElement(tag) {
      if (active) counters.create += 1;
      return String(tag).toLowerCase() === "input" ? new HTMLInputElement() : new HTMLElement(tag);
    },
    querySelector(selector) { return treeRoot.querySelector(selector); },
    querySelectorAll(selector) { return treeRoot.querySelectorAll(selector); },
    addEventListener() {},
    removeEventListener() {},
  };
  documentRef = document;

  const nodes = [
    { id: "A", parentId: "root", order: 1001, label: "A" },
    { id: "B", parentId: "root", order: 1002, label: "B" },
    { id: "C", parentId: "root", order: 1003, label: "C" },
  ];
  for (let i = 0; i < unrelatedCount; i += 1) {
    nodes.push({ id: `U${i}`, parentId: "root", order: 2000 + i, label: `U${i}` });
  }

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect,
    JSON, Date, Math, Promise, HTMLElement, HTMLInputElement,
    document,
    CSS: { escape(value) { return String(value); } },
    el: { treeRoot, treeWrap, search },
    state: {
      nodes,
      collapsed: new Set(),
      selectedId: "A",
      focusRootId: "",
      inlineEdit: { id: "" },
      rowMiniMenuOpen: false,
      rowMiniMenuNodeId: "",
      multiSelectedIds: new Set(),
      typeJump: { query: "", cycle: 0, lastAt: 0 },
      navigationMemory: {},
      moveMode: false,
    },
    cleanText(value, max = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, max);
    },
    canShowPocketTree() { return true; },
    refreshMeta() { counters.refreshMeta += active ? 1 : 0; },
    renderTree() { counters.render += active ? 1 : 0; },
    focusRowByNodeId() {},
    saveWorkspaceState() { counters.saveWorkspace += active ? 1 : 0; },
    expandPathToNode() {},
    requestAnimationFrame(callback) { callback?.(); return 1; },
    setTimeout(callback) { callback?.(); return 1; },
    clearTimeout() {},
    resetTypeJump() {},
    rememberFilterOrigin() {},
    clearFilterMemory() {},
    refocusTreeNavigation() {},
    getVisibleNodeIdsInRenderOrder() {
      counters.discoveryCalls += active ? 1 : 0;
      const ids = context.__visibleIds();
      counters.discoveryVisited += active ? ids.length : 0;
      return ids;
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  vm.runInContext(source(RENDER), context, { filename: RENDER });
  if (loadActions) vm.runInContext(source(ACTIONS), context, { filename: ACTIONS });

  function mount(id, selected = false) {
    const branch = new HTMLElement("li");
    branch.className = "treeNode";
    const row = new HTMLElement("div");
    row.className = `row${selected ? " selected" : ""}`;
    row.setAttribute("data-node-id", id);
    branch.appendChild(row);
    treeRoot.appendChild(branch);
    context.registerMainMountedNode(id, branch, row);
    return { branch, row };
  }

  const mounted = new Map();
  for (const node of nodes) mounted.set(node.id, mount(node.id, node.id === "A"));

  context.__visibleIds = () => nodes.map((node) => node.id);

  const baseRender = context.renderTree;
  context.renderTree = function authoritativeFallbackRender() {
    if (active) counters.render += 1;
    for (const [id, entry] of mounted.entries()) {
      if (id === context.state.selectedId) entry.row.classList.add("selected");
      else entry.row.classList.remove("selected");
    }
    return undefined;
  };

  const originalProjector = context.projectMainPrimarySelection;
  context.projectMainPrimarySelection = function countedProjector() {
    if (active) counters.projectorCalls += 1;
    return originalProjector.apply(this, arguments);
  };

  if (loadSmoothing) vm.runInContext(source(SMOOTH), context, { filename: SMOOTH });

  function row(id) { return mounted.get(id)?.row || null; }
  function branch(id) { return mounted.get(id)?.branch || null; }
  function reset() {
    for (const key of Object.keys(counters)) counters[key] = 0;
    active = true;
  }
  function stop() { active = false; }
  function counts() {
    return {
      create: counters.create,
      remove: counters.remove,
      reparent: counters.reparent,
      query: counters.query,
      querySelected: counters.querySelected,
      queryVisible: counters.queryVisible,
      queryVisibleRows: counters.queryVisibleRows,
      selectedAdd: counters.selectedAdd,
      selectedRemove: counters.selectedRemove,
      render: counters.render,
      refreshMeta: counters.refreshMeta,
      focus: counters.focus,
      scroll: counters.scroll,
      saveWorkspace: counters.saveWorkspace,
      discoveryCalls: counters.discoveryCalls,
      discoveryVisited: counters.discoveryVisited,
      projectorCalls: counters.projectorCalls,
    };
  }
  function replaceMountedRowWithoutRegistry(id, selected = false) {
    const old = mounted.get(id);
    if (!old) throw new Error("missing mounted row");
    treeRoot.removeChild(old.branch);
    const replacementBranch = new HTMLElement("li");
    replacementBranch.className = "treeNode";
    const replacementRow = new HTMLElement("div");
    replacementRow.className = `row${selected ? " selected" : ""}`;
    replacementRow.setAttribute("data-node-id", id);
    replacementBranch.appendChild(replacementRow);
    treeRoot.appendChild(replacementBranch);
    mounted.set(id, { branch: replacementBranch, row: replacementRow });
    return replacementRow;
  }

  return { context, counters, document, treeRoot, treeWrap, search, body, nodes, mounted, row, branch, reset, stop, counts, replaceMountedRowWithoutRegistry };
}

function selectPresentation(h, previousId = "A", nextId = "B") {
  h.context.state.selectedId = nextId;
  h.reset();
  const ok = h.context.projectMainPrimarySelection(previousId, nextId);
  h.stop();
  return ok;
}

test("P243 renderer projector is presentation-only and fixed-bounded", () => {
  function run(unrelatedCount) {
    const h = makeHarness({ unrelatedCount, loadActions: false });
    const prevRow = h.row("A");
    const nextRow = h.row("B");
    const prevBranch = h.branch("A");
    const nextBranch = h.branch("B");
    const unrelated = unrelatedCount ? h.row(`U${Math.floor(unrelatedCount / 2)}`) : h.row("C");

    assert.equal(selectPresentation(h), true);
    assert.equal(h.context.state.selectedId, "B");
    assert.equal(h.row("A"), prevRow);
    assert.equal(h.row("B"), nextRow);
    assert.equal(h.branch("A"), prevBranch);
    assert.equal(h.branch("B"), nextBranch);
    assert.equal(unrelatedCount ? h.row(`U${Math.floor(unrelatedCount / 2)}`) : h.row("C"), unrelated);
    assert.equal(prevRow.classList.contains("selected"), false);
    assert.equal(nextRow.classList.contains("selected"), true);

    const c = h.counts();
    assert.deepEqual({
      create: c.create,
      remove: c.remove,
      reparent: c.reparent,
      query: c.query,
      querySelected: c.querySelected,
      queryVisible: c.queryVisible,
      queryVisibleRows: c.queryVisibleRows,
      selectedAdd: c.selectedAdd,
      selectedRemove: c.selectedRemove,
      render: c.render,
      refreshMeta: c.refreshMeta,
      focus: c.focus,
      scroll: c.scroll,
      saveWorkspace: c.saveWorkspace,
    }, {
      create: 0, remove: 0, reparent: 0, query: 0, querySelected: 0,
      queryVisible: 0, queryVisibleRows: 0,
      selectedAdd: 1, selectedRemove: 1, render: 0, refreshMeta: 0,
      focus: 0, scroll: 0, saveWorkspace: 0,
    });
    return c;
  }

  const tiny = run(0);
  const large = run(1001);
  assert.equal(tiny.selectedAdd, large.selectedAdd);
  assert.equal(tiny.selectedRemove, large.selectedRemove);
  assert.equal(tiny.query, large.query);
  assert.equal(tiny.render, large.render);
});

test("P243 direct projector guards fail closed before any class mutation", () => {
  const cases = [
    ["filter", (h) => { h.search.value = "x"; }],
    ["focus-root", (h) => { h.context.state.focusRootId = "A"; }],
    ["inline-edit", (h) => { h.context.state.inlineEdit.id = "A"; }],
    ["row-mini-menu", (h) => { h.context.state.rowMiniMenuOpen = true; }],
    ["phone", (h) => { h.body.classList.add("phoneMode"); }],
    ["multi-set", (h) => { h.context.state.multiSelectedIds.add("C"); }],
    ["multi-array", (h) => { h.context.state.multiSelectedIds = ["C"]; }],
    ["previous-not-selected", (h) => { h.row("A").classList.remove("selected"); }],
    ["stale-previous", (h) => { h.replaceMountedRowWithoutRegistry("A", true); }],
    ["stale-next", (h) => { h.replaceMountedRowWithoutRegistry("B", false); }],
  ];

  for (const [label, setup] of cases) {
    const h = makeHarness({ loadActions: false });
    setup(h);
    h.context.state.selectedId = "B";
    const a = h.row("A");
    const b = h.row("B");
    const beforeA = a.classList.contains("selected");
    const beforeB = b.classList.contains("selected");
    h.reset();
    assert.equal(h.context.projectMainPrimarySelection("A", "B"), false, label);
    h.stop();
    assert.equal(a.classList.contains("selected"), beforeA, label);
    assert.equal(b.classList.contains("selected"), beforeB, label);
    assert.equal(h.counters.selectedAdd, 0, label);
    assert.equal(h.counters.selectedRemove, 0, label);
  }
});

test("P243 selectNodeById composes local projection only when expandPath keeps collapsed size unchanged", () => {
  const h = makeHarness({ loadSmoothing: true });
  h.context.expandPathToNode = () => {};
  h.reset();
  assert.equal(h.context.selectNodeById("B", { expandPath: true }), true);
  h.stop();

  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.row("A").classList.contains("selected"), false);
  assert.equal(h.row("B").classList.contains("selected"), true);
  assert.equal(h.counters.projectorCalls, 1);
  assert.equal(h.counters.render, 0);
  assert.equal(h.counters.refreshMeta, 1);
  assert.equal(h.counters.saveWorkspace, 1);

  const fallback = makeHarness({ loadSmoothing: true });
  fallback.context.state.collapsed.add("B");
  fallback.context.expandPathToNode = (id) => { fallback.context.state.collapsed.delete(id); };
  const prev = fallback.row("A");
  const next = fallback.row("B");
  fallback.context.renderTree = function checkedFallback() {
    assert.equal(prev.classList.contains("selected"), true, "no partial projector mutation before fallback");
    assert.equal(next.classList.contains("selected"), false, "no partial projector mutation before fallback");
    fallback.counters.render += 1;
    prev.classList.remove("selected");
    next.classList.add("selected");
  };

  fallback.reset();
  assert.equal(fallback.context.selectNodeById("B", { expandPath: true }), true);
  fallback.stop();
  assert.equal(fallback.counters.projectorCalls, 0);
  assert.equal(fallback.counters.render, 1);
  assert.equal(prev.classList.contains("selected"), false);
  assert.equal(next.classList.contains("selected"), true);
  assert.equal(fallback.counters.refreshMeta, 1);
  assert.equal(fallback.counters.saveWorkspace, 1);
});

test("P243 active list smoothing keeps discovery O(n) but repaint/focus registry-bounded", () => {
  function run(unrelatedCount) {
    const h = makeHarness({ unrelatedCount, loadSmoothing: true });
    const prev = h.row("A");
    const next = h.row("B");
    const unrelated = unrelatedCount ? h.row(`U${Math.floor(unrelatedCount / 2)}`) : h.row("C");

    h.reset();
    assert.equal(h.context.moveSelectionByVisibleDelta(1), true);
    h.stop();

    assert.equal(h.context.state.selectedId, "B");
    assert.equal(prev.classList.contains("selected"), false);
    assert.equal(next.classList.contains("selected"), true);
    assert.equal(unrelatedCount ? h.row(`U${Math.floor(unrelatedCount / 2)}`) : h.row("C"), unrelated);
    assert.equal(h.counters.projectorCalls, 1);
    assert.equal(h.counters.render, 0);
    assert.equal(h.counters.querySelected, 0);
    assert.equal(h.counters.query, 1, "the only tree query is unchanged visible-target discovery");
    assert.equal(h.counters.queryVisible, 1);
    assert.equal(h.counters.queryVisibleRows, unrelatedCount + 3);
    assert.equal(h.counters.refreshMeta, 1);
    assert.ok(h.counters.focus >= 1);
    return h.counts();
  }

  const tiny = run(0);
  const large = run(1001);
  assert.equal(tiny.selectedAdd, large.selectedAdd);
  assert.equal(tiny.selectedRemove, large.selectedRemove);
  assert.equal(tiny.render, large.render);
  assert.equal(tiny.query, large.query);
  assert.equal(tiny.queryVisible, large.queryVisible);
  assert.equal(tiny.projectorCalls, large.projectorCalls);
  assert.ok(large.queryVisibleRows > tiny.queryVisibleRows, "target discovery intentionally remains proportional to visible rows");
});

test("P243 list-smoothing guards fall back to authoritative render without partial projector mutation", () => {
  const cases = [
    ["filter", (h) => { h.search.value = "x"; }],
    ["focus-root", (h) => { h.context.state.focusRootId = "A"; }],
    ["inline-edit", (h) => { h.context.state.inlineEdit.id = "A"; }],
    ["row-mini-menu", (h) => { h.context.state.rowMiniMenuOpen = true; }],
    ["phone", (h) => { h.body.classList.add("phoneMode"); }],
    ["multi", (h) => { h.context.state.multiSelectedIds.add("C"); }],
    ["previous-not-selected", (h) => { h.row("A").classList.remove("selected"); }],
    ["stale-previous", (h) => { h.replaceMountedRowWithoutRegistry("A", true); }],
    ["stale-next", (h) => { h.replaceMountedRowWithoutRegistry("B", false); }],
  ];

  for (const [label, setup] of cases) {
    const h = makeHarness({ loadSmoothing: true });
    setup(h);
    const previous = h.row("A");
    const next = h.row("B");
    let checkedBeforeFallback = false;
    h.context.renderTree = function guardedFallback() {
      checkedBeforeFallback = true;
      if (label !== "previous-not-selected") {
        assert.equal(previous.classList.contains("selected"), true, label);
      }
      assert.equal(next.classList.contains("selected"), false, label);
      h.counters.render += 1;
      previous.classList.remove("selected");
      next.classList.add("selected");
    };

    h.reset();
    assert.equal(h.context.PocketListSmoothing.paintSelectionOnly("B"), true, label);
    h.stop();
    assert.equal(checkedBeforeFallback, true, label);
    assert.equal(h.counters.render, 1, label);
    assert.equal(next.classList.contains("selected"), true, label);
  }
});

test("P243 Home/End workspace-save contract is preserved exactly", () => {
  const h = makeHarness({ loadSmoothing: true });

  h.reset();
  assert.equal(h.context.moveSelectionToVisibleEdge("end"), true);
  h.stop();
  assert.equal(h.context.state.selectedId, h.nodes.at(-1).id);
  assert.equal(h.counters.saveWorkspace, 1);

  h.reset();
  assert.equal(h.context.moveSelectionToVisibleEdge("end"), false);
  h.stop();
  assert.equal(h.counters.saveWorkspace, 0, "same-target edge remains a no-op with no save");

  h.reset();
  assert.equal(h.context.moveSelectionToVisibleEdge("start"), true);
  h.stop();
  assert.equal(h.context.state.selectedId, "A");
  assert.equal(h.counters.saveWorkspace, 1);
});

test("P243 active focus lookup is registry-first with querySelector fallback only on stale/missing evidence", () => {
  const h = makeHarness({ loadSmoothing: true });

  h.reset();
  h.context.focusRowByNodeId("B");
  h.stop();
  assert.equal(h.counters.query, 0);
  assert.equal(h.document.activeElement, h.row("B"));

  const replacement = h.replaceMountedRowWithoutRegistry("B", false);
  h.reset();
  h.context.focusRowByNodeId("B");
  h.stop();
  assert.equal(h.counters.query, 1);
  assert.equal(h.document.activeElement, replacement);
});

test("P243 source ownership stays bounded and out-of-scope owners remain untouched", () => {
  const render = source(RENDER);
  const actions = source(ACTIONS);
  const smooth = source(SMOOTH);
  const multi = source("js/pocket-multi-select.js");
  const phoneMenu = source("js/pocket-phone-menu.js");
  const phoneTap = source("js/pocket-phone-tap.js");
  const overlays = source("js/pocket-overlays-init.js");

  const projectorStart = render.indexOf("function projectMainPrimarySelection(");
  const projectorEnd = render.indexOf("\nfunction ", projectorStart + 20);
  assert.ok(projectorStart >= 0 && projectorEnd > projectorStart);
  const projector = render.slice(projectorStart, projectorEnd);

  assert.doesNotMatch(projector, /state\.selectedId\s*=/);
  assert.doesNotMatch(projector, /querySelector|querySelectorAll|renderTree\(|innerHTML|appendChild|removeChild|insertBefore|replaceChild/);
  assert.doesNotMatch(projector, /focus\(|scroll|refreshMeta|saveWorkspaceState/);
  assert.match(projector, /currentMainMountedNodeEntry\(previousId\)/);
  assert.match(projector, /currentMainMountedNodeEntry\(nextId\)/);

  const selectStart = actions.indexOf("function selectNodeById(");
  const selectEnd = actions.indexOf("\nfunction ", selectStart + 20);
  const selectNode = actions.slice(selectStart, selectEnd);
  assert.match(selectNode, /const previousId = cleanText\(state\.selectedId, 80\)/);
  assert.match(selectNode, /const collapsedSizeBefore = state\.collapsed instanceof Set \? state\.collapsed\.size : null/);
  assert.match(selectNode, /state\.selectedId = id/);
  assert.match(selectNode, /projectMainPrimarySelection\(previousId, id\)/);
  assert.match(selectNode, /if \(!projected\) renderTree\(\)/);
  assert.match(selectNode, /focusRowByNodeId[\s\S]*saveWorkspaceState/);

  assert.doesNotMatch(smooth, /querySelectorAll\("\.row\.selected"\)/);
  assert.match(smooth, /getMountedMainRowForNodeId\(id\)/);
  assert.match(smooth, /projectMainPrimarySelection\(previousId, id\)/);
  assert.match(smooth, /if \(!projected\) renderTree\(\)/);

  const rowClick = render.slice(render.indexOf('row.addEventListener("click"'), render.indexOf('row.addEventListener("dblclick"'));
  const dblClick = render.slice(render.indexOf('row.addEventListener("dblclick"'), render.indexOf('row.addEventListener("contextmenu"'));
  const contextMenu = render.slice(render.indexOf('row.addEventListener("contextmenu"'), render.indexOf("\n\n    li.appendChild", render.indexOf('row.addEventListener("contextmenu"')));
  assert.match(rowClick, /renderTree\(\)/);
  assert.match(dblClick, /renderTree\(\)/);
  assert.match(contextMenu, /renderTree\(\)/);

  const jumpStart = actions.indexOf("function jumpSelectionByTypedChar(");
  const jumpEnd = actions.indexOf("\nfunction ", jumpStart + 20);
  assert.match(actions.slice(jumpStart, jumpEnd), /renderTree\(\)/);
  assert.match(actions, /function getVisibleNodeIdsInRenderOrder\(\)[\s\S]*querySelectorAll\("\.row\[data-node-id\]"\)/);

  for (const untouched of [multi, phoneMenu, phoneTap, overlays]) {
    assert.doesNotMatch(untouched, /projectMainPrimarySelection/);
  }
  assert.doesNotMatch(render + actions + smooth, /visibleOrderIndex|visibleNodeOrderIndex/);
});


test("P243a actual composed selectNodeById presentation work is fixed-bounded from tiny to 1000+ visible rows", () => {
  function run(unrelatedCount) {
    const h = makeHarness({ unrelatedCount, loadSmoothing: true });
    h.context.expandPathToNode = () => {};

    const aRow = h.row("A");
    const aBranch = h.branch("A");
    const bRow = h.row("B");
    const bBranch = h.branch("B");
    const cRow = h.row("C");
    const cBranch = h.branch("C");
    const largeIdentity = unrelatedCount > 0
      ? [
          ["U0", h.row("U0"), h.branch("U0")],
          [`U${Math.floor(unrelatedCount / 2)}`, h.row(`U${Math.floor(unrelatedCount / 2)}`), h.branch(`U${Math.floor(unrelatedCount / 2)}`)],
          [`U${unrelatedCount - 1}`, h.row(`U${unrelatedCount - 1}`), h.branch(`U${unrelatedCount - 1}`)],
        ]
      : [];

    const collapsedSizeBefore = h.context.state.collapsed.size;
    h.reset();
    const result = h.context.selectNodeById("B", { expandPath: true });
    h.stop();
    const collapsedSizeAfter = h.context.state.collapsed.size;

    assert.equal(result, true);
    assert.equal(h.context.state.selectedId, "B");
    assert.equal(collapsedSizeAfter, collapsedSizeBefore);
    assert.equal(h.counters.projectorCalls, 1);
    assert.equal(h.counters.refreshMeta, 1);
    assert.equal(h.counters.saveWorkspace, 1);
    assert.equal(h.counters.render, 0);
    assert.equal(h.counters.create, 0);
    assert.equal(h.counters.remove, 0);
    assert.equal(h.counters.reparent, 0);
    assert.equal(h.counters.query, 0, "composed repaint/focus must perform zero tree queries");
    assert.equal(h.counters.querySelected, 0);
    assert.equal(h.counters.queryVisible, 0);
    assert.equal(h.counters.queryVisibleRows, 0);
    assert.equal(h.counters.selectedRemove, 1);
    assert.equal(h.counters.selectedAdd, 1);
    assert.equal(h.counters.discoveryCalls, 0);
    assert.equal(h.counters.discoveryVisited, 0);
    assert.equal(h.document.activeElement, bRow, "active list-smoothing focus owner remains usable");

    assert.equal(h.row("A"), aRow);
    assert.equal(h.branch("A"), aBranch);
    assert.equal(h.row("B"), bRow);
    assert.equal(h.branch("B"), bBranch);
    assert.equal(h.row("C"), cRow);
    assert.equal(h.branch("C"), cBranch);
    assert.equal(aRow.classList.contains("selected"), false);
    assert.equal(bRow.classList.contains("selected"), true);

    for (const [id, row, branch] of largeIdentity) {
      assert.equal(h.row(id), row, `${id} row identity survives`);
      assert.equal(h.branch(id), branch, `${id} branch identity survives`);
    }

    return {
      create: h.counters.create,
      remove: h.counters.remove,
      reparent: h.counters.reparent,
      query: h.counters.query,
      querySelected: h.counters.querySelected,
      queryVisible: h.counters.queryVisible,
      queryVisibleRows: h.counters.queryVisibleRows,
      selectedAdd: h.counters.selectedAdd,
      selectedRemove: h.counters.selectedRemove,
      render: h.counters.render,
      refreshMeta: h.counters.refreshMeta,
      focus: h.counters.focus,
      scroll: h.counters.scroll,
      saveWorkspace: h.counters.saveWorkspace,
      discoveryCalls: h.counters.discoveryCalls,
      discoveryVisited: h.counters.discoveryVisited,
      projectorCalls: h.counters.projectorCalls,
    };
  }

  const tiny = run(0);
  const large = run(1001);

  assert.deepEqual(large, tiny, "composed presentation work must remain fixed-bounded as unrelated mounted rows grow");

  assert.deepEqual(tiny, {
    create: 0,
    remove: 0,
    reparent: 0,
    query: 0,
    querySelected: 0,
    queryVisible: 0,
    queryVisibleRows: 0,
    selectedAdd: 1,
    selectedRemove: 1,
    render: 0,
    refreshMeta: 1,
    focus: 1,
    scroll: 0,
    saveWorkspace: 1,
    discoveryCalls: 0,
    discoveryVisited: 0,
    projectorCalls: 1,
  });

  // This is a presentation-locality proof only. selectNodeById's state.nodes
  // semantic validation may still be O(n), and keyboard target discovery remains
  // separately O(n) exactly as proved/acknowledged by the existing P243 tests.
});
