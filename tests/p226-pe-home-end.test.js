"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createPeTestDom } = require("./helpers/pe-test-dom");

const ROOT = path.resolve(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }

function createHarness(text, options = {}) {
  const controls = new Map();
  const documentListeners = new Map();
  const rafQueue = [];
  const rowBaseTop = new Map();
  let dirtyMarks = 0;
  let clearCount = 0;
  let paneRef = null;

  const peDom = createPeTestDom({
    onClassToggle(name, force) {
      if (name === "isDirty" && force === true) dirtyMarks += 1;
    },
    onInnerHTMLClear() { clearCount += 1; },
    rangeRect(range, dom) {
      let root = range.startContainer;
      while (root) {
        const classes = String(root.className || "").split(/\s+/);
        if (root.nodeType === 1 && classes.includes("lineText") && root.getAttribute?.("data-line-id")) break;
        root = root.parentNode;
      }
      if (!root) return { top: 0, bottom: 0, height: 0 };
      const base = rowBaseTop.get(root.getAttribute("data-line-id"));
      if (!Number.isFinite(base)) return { top: 0, bottom: 0, height: 0 };
      const top = base - (Number(paneRef?.scrollTop) || 0);
      return { top, bottom: top + 16, height: 16 };
    },
  });
  const { Element, Range, selection, absoluteOffset, pointForOffset } = peDom;

  function storeDocumentListener(type, handler, optionsArg) {
    const capture = optionsArg === true || optionsArg?.capture === true;
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push({ handler, capture });
  }

  const document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
    createRange() { return new Range(); },
    getSelection() { return selection; },
    getElementById(id) { return controls.get(id) || null; },
    addEventListener: storeDocumentListener,
  };
  peDom.bindDocument(document);

  function control(id, tagName = "div") {
    const element = new Element(tagName);
    controls.set(id, element);
    return element;
  }

  const title = control("titleInput", "input");
  title.value = "P226";
  const pane = control("outlinePane", "div");
  paneRef = pane;
  pane.scrollTop = 0;
  pane.clientHeight = 120;
  const saveState = control("saveState", "span");
  control("saveBtn", "button");
  control("saveCloseBtn", "button");
  control("closeBtn", "button");
  const unsavedDialog = control("unsavedDialog", "div");
  control("unsavedSaveBtn", "button");
  control("unsavedDiscardBtn", "button");
  control("unsavedCancelBtn", "button");
  unsavedDialog.hidden = true;

  const context = vm.createContext({
    console,
    JSON,
    Object,
    Array,
    Number,
    String,
    Math,
    Set,
    Map,
    Promise,
    Date,
    TextEncoder,
  });
  context.window = context;
  context.globalThis = context;
  context.document = document;
  context.navigator = {};
  context.getSelection = () => selection;
  context.requestAnimationFrame = (callback) => { rafQueue.push(callback); return rafQueue.length; };
  context.setTimeout = (callback) => { if (typeof callback === "function") callback(); return 1; };
  context.alert = () => {};
  context.close = () => {};
  context.opener = null;
  context.addEventListener = () => {};

  vm.runInContext(source("js/pocket-node-content.js"), context, { filename: "js/pocket-node-content.js" });
  const content = context.PocketNodeContent;
  const parsed = content.parseLines(text);
  parsed.forEach((line, index) => {
    const row = new Element("div");
    row.className = "docRow";
    row.setAttribute("data-line-id", `line_${index}`);
    row.setAttribute("data-depth", String(line.depth));
    rowBaseTop.set(`line_${index}`, index * 120);
    row.getBoundingClientRect = () => {
      const top = rowBaseTop.get(`line_${index}`) - (Number(pane.scrollTop) || 0);
      return { top, bottom: top + 22, height: 22 };
    };

    const gutter = new Element("button");
    gutter.className = "lineGutter" + (content.hasChildren(parsed, index) ? " branch" : " empty");
    gutter.setAttribute("data-line-id", `line_${index}`);
    gutter.textContent = content.hasChildren(parsed, index) ? "▾" : "";

    const editable = new Element("div");
    editable.className = "lineText";
    editable.setAttribute("data-line-id", `line_${index}`);
    editable.setAttribute("contenteditable", options.readOnly === true ? "false" : "true");
    editable.contentEditable = options.readOnly === true ? "false" : "true";
    editable.isContentEditable = options.readOnly !== true;
    editable.textContent = line.content;
    editable.getBoundingClientRect = () => {
      const top = rowBaseTop.get(`line_${index}`) - (Number(pane.scrollTop) || 0);
      return { top, bottom: top + 16, height: 16 };
    };

    row.appendChild(gutter);
    row.appendChild(editable);
    pane.appendChild(row);
  });
  pane.scrollHeight = Math.max(pane.clientHeight, ((parsed.length - 1) * 120) + 30);
  const scrollCalls = [];
  pane.getBoundingClientRect = () => ({ top: 0, bottom: pane.clientHeight, height: pane.clientHeight });
  pane.scrollBy = function (arg) {
    scrollCalls.push({ kind: "by", top: Number(arg?.top) || 0, behavior: arg?.behavior || "" });
    const maximum = Math.max(0, Number(this.scrollHeight) - Number(this.clientHeight));
    this.scrollTop = Math.max(0, Math.min(maximum, (Number(this.scrollTop) || 0) + (Number(arg?.top) || 0)));
  };
  pane.scrollTo = function (arg) {
    scrollCalls.push({ kind: "to", top: Number(arg?.top) || 0, behavior: arg?.behavior || "" });
    const maximum = Math.max(0, Number(this.scrollHeight) - Number(this.clientHeight));
    this.scrollTop = Math.max(0, Math.min(maximum, Number(arg?.top) || 0));
  };

  const payload = {
    id: "p226",
    title: "P226",
    text,
    body: text,
    readOnly: options.readOnly === true,
    popupOwnerToken: "owner-p226",
    popupInstanceToken: "popup-p226",
    fileSessionId: 7,
    sourceFileName: "p226-test.pocket",
    sourcePipSession: false,
    sourceOwnerKind: "json",
    sourceVaultSessionId: "",
    originalUpdatedAt: "2026-09-20T00:00:00.000Z",
  };
  const carrier = control("pocketNodePopoutPayload", "textarea");
  carrier.value = JSON.stringify(payload);

  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context, { filename: "js/pocket-node-popout-runtime.js" });
  vm.runInContext(source("js/pocket-node-popout-polish.js"), context, { filename: "js/pocket-node-popout-polish.js" });

  function eventFor(type, target, values = {}) {
    const fnState = values.fnKey === true;
    return {
      type,
      target,
      key: "",
      keyCode: 0,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      defaultPrevented: false,
      propagationStopped: false,
      immediatePropagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; this.propagationStopped = true; },
      getModifierState(name) { return name === "Fn" ? fnState : false; },
      ...values,
    };
  }

  function dispatch(type, target, values = {}) {
    const event = eventFor(type, target, values);
    const docHandlers = documentListeners.get(type) || [];
    for (const entry of docHandlers.filter((entry) => entry.capture)) {
      entry.handler(event);
      if (event.immediatePropagationStopped) return event;
    }
    if (!event.propagationStopped) {
      const path = [];
      let current = target;
      while (current) { path.push(current); current = current.parentNode; }
      for (const node of path) {
        for (const handler of node.listeners?.get(type) || []) {
          handler(event);
          if (event.immediatePropagationStopped) return event;
        }
        if (event.propagationStopped) break;
      }
    }
    if (!event.propagationStopped) {
      for (const entry of docHandlers.filter((entry) => !entry.capture)) {
        entry.handler(event);
        if (event.immediatePropagationStopped) return event;
      }
    }
    return event;
  }

  function lineById(id) {
    return pane.querySelectorAll(".lineText[data-line-id]").find((line) => line.getAttribute("data-line-id") === id) || null;
  }
  function rowById(id) {
    return pane.querySelectorAll(".docRow[data-line-id]").find((row) => row.getAttribute("data-line-id") === id) || null;
  }
  function gutterById(id) {
    return pane.querySelectorAll(".lineGutter[data-line-id]").find((gutter) => gutter.getAttribute("data-line-id") === id) || null;
  }
  function setCaret(id, offset) {
    const target = lineById(id);
    assert.ok(target, `expected visible ${id}`);
    const point = pointForOffset(target, offset);
    const range = new Range();
    range.setStart(point.container, point.offset);
    range.collapse(true);
    target.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function caret() {
    const active = document.activeElement;
    if (!active || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return {
      lineId: active.getAttribute?.("data-line-id") || "",
      offset: absoluteOffset(active, range.startContainer, range.startOffset),
      collapsed: range.collapsed,
    };
  }
  function bodyKey(id, key, modifiers = {}) {
    const target = lineById(id);
    assert.ok(target, `expected visible ${id}`);
    return dispatch("keydown", target, { key, ...modifiers });
  }
  function keyup(id, key, modifiers = {}) {
    const target = lineById(id);
    assert.ok(target, `expected visible ${id}`);
    return dispatch("keyup", target, { key, ...modifiers });
  }
  function titleKey(key, modifiers = {}) { return dispatch("keydown", title, { key, ...modifiers }); }
  function queueSelectionComfort() { return dispatch("selectionchange", document.activeElement || pane); }
  function clickGutter(id) {
    const target = gutterById(id);
    assert.ok(target, `expected visible gutter ${id}`);
    return dispatch("click", target);
  }
  function flushFrames(limit = 20) {
    let count = 0;
    while (rafQueue.length) {
      assert.ok(count < limit, "animation-frame queue exceeded bounded test limit");
      const callback = rafQueue.shift();
      callback();
      count += 1;
    }
    return count;
  }
  function snapshot() {
    return pane.querySelectorAll(".docRow[data-line-id]").map((row) => {
      const id = row.getAttribute("data-line-id");
      return {
        id,
        depth: Number(row.getAttribute("data-depth")),
        text: lineById(id)?.textContent || "",
        row,
      };
    });
  }

  return {
    context,
    document,
    title,
    pane,
    lineById,
    rowById,
    gutterById,
    setCaret,
    caret,
    bodyKey,
    keyup,
    titleKey,
    queueSelectionComfort,
    clickGutter,
    flushFrames,
    snapshot,
    dirtyMarks: () => dirtyMarks,
    clearCount: () => clearCount,
    scrollCalls,
    isDirty: () => context.PocketNodePopoutSession.hasUnsavedChanges(),
  };
}

function plainSnapshot(snapshot) {
  return snapshot.map(({ id, depth, text }) => ({ id, depth, text }));
}

test("P226 Home owns the real PE keydown path and settles first visible row at exact top without mutation", () => {
  const h = createHarness("Alpha\nBravo\nCharlie\nDelta");
  const before = h.snapshot();
  const beforeRows = before.map((entry) => entry.row);
  h.setCaret("line_2", 4);
  h.pane.scrollTop = 180;

  h.queueSelectionComfort();
  const event = h.bodyKey("line_2", "Home");

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.caret(), { lineId: "line_0", offset: 0, collapsed: true });
  assert.equal(h.pane.scrollTop, 0);
  assert.notEqual(h.document.activeElement, h.lineById("line_2"));
  assert.deepEqual(plainSnapshot(h.snapshot()), plainSnapshot(before));
  assert.deepEqual(h.snapshot().map((entry) => entry.row), beforeRows);
  assert.equal(h.dirtyMarks(), 0);
  assert.equal(h.isDirty(), false);
  assert.equal(h.clearCount(), 0);

  h.keyup("line_0", "Home");
  h.queueSelectionComfort();
  h.flushFrames();
  assert.deepEqual(h.caret(), { lineId: "line_0", offset: 0, collapsed: true });
  assert.equal(h.pane.scrollTop, 0, "composed polish comfort must not rebound Home from the top edge");
});

test("P226 End owns the real PE keydown path and settles last visible row at exact bottom without mutation", () => {
  const h = createHarness("Alpha\nBravo\nCharlie\nDelta");
  const before = h.snapshot();
  const beforeRows = before.map((entry) => entry.row);
  h.setCaret("line_0", 2);
  h.pane.scrollTop = 20;
  const maximum = h.pane.scrollHeight - h.pane.clientHeight;

  h.queueSelectionComfort();
  const event = h.bodyKey("line_0", "End");

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.caret(), { lineId: "line_3", offset: "Delta".length, collapsed: true });
  assert.equal(h.pane.scrollTop, maximum);
  assert.deepEqual(plainSnapshot(h.snapshot()), plainSnapshot(before));
  assert.deepEqual(h.snapshot().map((entry) => entry.row), beforeRows);
  assert.equal(h.dirtyMarks(), 0);
  assert.equal(h.isDirty(), false);
  assert.equal(h.clearCount(), 0);

  h.keyup("line_3", "End");
  h.queueSelectionComfort();
  h.flushFrames();
  assert.deepEqual(h.caret(), { lineId: "line_3", offset: "Delta".length, collapsed: true });
  assert.equal(h.pane.scrollTop, maximum, "composed polish comfort must not rebound End from the bottom edge");
});

test("P226 Home/End use accepted visible indexes and never target a hidden collapsed descendant", () => {
  const h = createHarness("First\nParent\n  HiddenLast");
  const collapse = h.clickGutter("line_1");
  assert.equal(collapse.defaultPrevented, true);
  assert.equal(h.lineById("line_2"), null);
  assert.equal(h.gutterById("line_1").textContent, "▸");
  assert.equal(h.isDirty(), false);

  h.setCaret("line_0", 2);
  const end = h.bodyKey("line_0", "End");
  assert.equal(end.defaultPrevented, true);
  assert.deepEqual(h.caret(), { lineId: "line_1", offset: "Parent".length, collapsed: true });
  assert.equal(h.lineById("line_2"), null);

  const home = h.bodyKey("line_1", "Home");
  assert.equal(home.defaultPrevented, true);
  assert.deepEqual(h.caret(), { lineId: "line_0", offset: 0, collapsed: true });
  assert.equal(h.lineById("line_2"), null);
  assert.equal(h.gutterById("line_1").textContent, "▸");
  assert.equal(h.isDirty(), false);
  assert.equal(h.clearCount(), 0);
});

test("P226 fail-closes modifiers, composition, Fn alias, title and non-target keys without claiming them", () => {
  for (const modifiers of [
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
    { ctrlKey: true },
    { isComposing: true },
    { keyCode: 229 },
    { fnKey: true },
  ]) {
    const h = createHarness("Alpha\nBravo");
    h.setCaret("line_1", 2);
    h.pane.scrollTop = 30;
    const before = h.caret();
    const event = h.bodyKey("line_1", "Home", modifiers);
    assert.equal(event.defaultPrevented, false, JSON.stringify(modifiers));
    assert.deepEqual(h.caret(), before, JSON.stringify(modifiers));
    assert.equal(h.pane.scrollTop, 30, JSON.stringify(modifiers));
    assert.equal(h.isDirty(), false, JSON.stringify(modifiers));
  }

  {
    const h = createHarness("Alpha\nBravo");
    h.title.focus();
    const event = h.titleKey("Home");
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.document.activeElement, h.title);
  }

  {
    const h = createHarness("Alpha\nBravo", { readOnly: true });
    h.setCaret("line_1", 2);
    h.pane.scrollTop = 30;
    const event = h.bodyKey("line_1", "End");
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(h.caret(), { lineId: "line_1", offset: 2, collapsed: true });
    assert.equal(h.pane.scrollTop, 30);
    assert.equal(h.isDirty(), false);
  }

  {
    const h = createHarness("Alpha\nBravo");
    h.setCaret("line_1", 2);
    const pageUp = h.bodyKey("line_1", "PageUp");
    assert.equal(pageUp.defaultPrevented, false);
    assert.deepEqual(h.caret(), { lineId: "line_1", offset: 2, collapsed: true });
  }
});

test("P226 source contract keeps singular runtime ownership, polish presentation-only, and no mutation/rebuild path", () => {
  const runtime = source("js/pocket-node-popout-runtime.js");
  const polish = source("js/pocket-node-popout-polish.js");
  const tree = source("js/pocket-tree-actions.js");

  const keydownStart = runtime.indexOf('pane.addEventListener("keydown"');
  const keydownEnd = runtime.indexOf('pane.addEventListener("dragstart"', keydownStart);
  assert.ok(keydownStart >= 0 && keydownEnd > keydownStart);
  const paneKeydown = runtime.slice(keydownStart, keydownEnd);
  assert.equal((paneKeydown.match(/ev\.key==="Home"/g) || []).length, 2, "Home appears only in the one owner condition and destination choice");
  assert.equal((paneKeydown.match(/ev\.key==="End"/g) || []).length, 1);
  assert.match(paneKeydown, /moveToVisibleDocumentEdge\(ev\.key==="Home"\?"start":"end"\)/);

  const documentKeydownStart = runtime.indexOf('document.addEventListener("keydown"');
  const documentKeydownEnd = runtime.indexOf('if\(typeof window.addEventListener', documentKeydownStart);
  assert.ok(documentKeydownStart >= 0 && documentKeydownEnd > documentKeydownStart);
  assert.doesNotMatch(runtime.slice(documentKeydownStart, documentKeydownEnd), /Home|End/);
  assert.doesNotMatch(polish, /\bHome\b|\bEnd\b/);

  const edgeStart = runtime.indexOf("function moveToVisibleDocumentEdge(");
  const edgeEnd = runtime.indexOf("function schedulePlainVerticalCaretBridge(", edgeStart);
  assert.ok(edgeStart >= 0 && edgeEnd > edgeStart);
  const edgeBody = runtime.slice(edgeStart, edgeEnd);
  assert.match(edgeBody, /content\.visibleIndexes\(lines, collapsed\)/);
  assert.match(edgeBody, /focusLineAtOffset\(targetLine\.id, offset\)/);
  assert.match(edgeBody, /pane\.scrollTop = edge === "start" \? 0 : maximum/);
  assert.doesNotMatch(edgeBody, /markMutation|editGeneration|pane\.innerHTML|collapsed\.(?:add|delete)|lines\.(?:splice|push|pop|shift|unshift)/);

  assert.match(tree, /\["Home", "End", "PageUp", "PageDown"\]\.includes\(ev\.key\)/);
});
