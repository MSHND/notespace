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
  let dirtyTrueCount = 0;
  let clearCount = 0;
  let dispatchEvent = null;

  const peDom = createPeTestDom({
    onClassToggle(name, force) {
      if (name === "isDirty" && force === true) dirtyTrueCount += 1;
    },
    onInnerHTMLClear() { clearCount += 1; },
  });
  const { Element, Range, selection, absoluteOffset, pointForOffset } = peDom;

  Element.prototype.getBoundingClientRect = function () {
    return { top: 10, bottom: 30, height: 20 };
  };
  Element.prototype.click = function () {
    return typeof dispatchEvent === "function" ? dispatchEvent("click", this) : null;
  };

  const document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
    createRange() { return new Range(); },
    getSelection() { return selection; },
    getElementById(id) { return controls.get(id) || null; },
    addEventListener(type, handler, optionsArg) {
      const capture = optionsArg === true || optionsArg?.capture === true;
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push({ handler, capture });
    },
  };
  peDom.bindDocument(document);

  function control(id, tagName = "div") {
    const element = new Element(tagName);
    controls.set(id, element);
    return element;
  }

  const title = control("titleInput", "input");
  title.value = "P232";
  const pane = control("outlinePane", "div");
  pane.scrollTop = 0;
  pane.clientHeight = 160;
  pane.scrollHeight = 600;
  pane.scrollBy = function (arg) {
    const maximum = Math.max(0, Number(this.scrollHeight) - Number(this.clientHeight));
    this.scrollTop = Math.max(0, Math.min(maximum, (Number(this.scrollTop) || 0) + (Number(arg?.top) || 0)));
  };
  control("saveState", "span");
  control("saveBtn", "button");
  control("saveCloseBtn", "button");
  control("closeBtn", "button");
  const unsavedDialog = control("unsavedDialog", "div");
  control("unsavedSaveBtn", "button");
  control("unsavedDiscardBtn", "button");
  control("unsavedCancelBtn", "button");
  unsavedDialog.hidden = true;

  const modelContext = vm.createContext({ window: {}, TextEncoder });
  modelContext.globalThis = modelContext;
  vm.runInContext(source("js/pocket-node-content.js"), modelContext, { filename: "js/pocket-node-content.js" });
  const content = modelContext.window.PocketNodeContent;
  const parsed = content.parseLines(text);

  parsed.forEach((line, index) => {
    const row = new Element("div");
    row.className = "docRow";
    row.setAttribute("data-line-id", `line_${index}`);
    row.setAttribute("data-depth", String(line.depth));

    const gutter = new Element("button");
    gutter.className = "lineGutter" + (content.hasChildren(parsed, index) ? " branch" : " empty");
    gutter.setAttribute("data-line-id", `line_${index}`);
    gutter.textContent = content.hasChildren(parsed, index) ? "▾" : "";

    const editable = new Element("div");
    editable.className = "lineText";
    editable.setAttribute("data-line-id", `line_${index}`);
    editable.contentEditable = options.readOnly === true ? "false" : "true";
    editable.textContent = line.content;

    row.appendChild(gutter);
    row.appendChild(editable);
    pane.appendChild(row);
  });

  const payload = {
    id: "p232",
    title: "P232",
    text,
    body: text,
    readOnly: options.readOnly === true,
    popupOwnerToken: "owner-p232",
    popupInstanceToken: "popup-p232",
    fileSessionId: 232,
    sourceFileName: "p232-test.pocket",
    sourcePipSession: false,
    sourceOwnerKind: "json",
    sourceVaultSessionId: "",
    originalUpdatedAt: "2026-09-20T00:00:00.000Z",
  };
  const carrier = control("pocketNodePopoutPayload", "textarea");
  carrier.value = JSON.stringify(payload);

  const context = vm.createContext({
    console, JSON, Object, Array, Number, String, Math, Set, Map, Promise, Date, TextEncoder,
  });
  context.window = context;
  context.globalThis = context;
  context.document = document;
  context.navigator = {};
  context.getSelection = () => selection;
  context.requestAnimationFrame = (callback) => { if (typeof callback === "function") callback(); return 1; };
  context.setTimeout = (callback) => { if (typeof callback === "function") callback(); return 1; };
  context.alert = () => {};
  context.close = () => {};
  context.opener = null;
  context.addEventListener = () => {};

  vm.runInContext(source("js/pocket-node-content.js"), context, { filename: "js/pocket-node-content.js" });
  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context, { filename: "js/pocket-node-popout-runtime.js" });
  vm.runInContext(source("js/pocket-node-popout-polish.js"), context, { filename: "js/pocket-node-popout-polish.js" });

  function eventFor(type, target, values = {}) {
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
      ...values,
    };
  }

  dispatchEvent = function dispatch(type, target, values = {}) {
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
  };

  function rowById(id) {
    return pane.querySelectorAll(".docRow[data-line-id]").find((row) => row.getAttribute("data-line-id") === id) || null;
  }
  function lineById(id) {
    return pane.querySelectorAll(".lineText[data-line-id]").find((line) => line.getAttribute("data-line-id") === id) || null;
  }
  function gutterById(id) {
    return pane.querySelectorAll(".lineGutter[data-line-id]").find((gutter) => gutter.getAttribute("data-line-id") === id) || null;
  }
  function rowIds() {
    return pane.querySelectorAll(".docRow[data-line-id]").map((row) => row.getAttribute("data-line-id"));
  }
  function setCaret(id, offset) {
    const target = lineById(id);
    assert.ok(target, `expected mounted ${id}`);
    const point = pointForOffset(target, offset);
    const range = new Range();
    range.setStart(point.container, point.offset);
    range.collapse(true);
    target.focus();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function setSelection(id, startOffset, endOffset) {
    const target = lineById(id);
    assert.ok(target, `expected mounted ${id}`);
    const start = pointForOffset(target, startOffset);
    const end = pointForOffset(target, endOffset);
    const range = new Range();
    range.setStart(start.container, start.offset);
    range.setEnd(end.container, end.offset);
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
  function key(id, keyName, modifiers = {}) {
    const target = lineById(id);
    assert.ok(target, `expected mounted ${id}`);
    return dispatchEvent("keydown", target, { key: keyName, ...modifiers });
  }
  function titleKey(keyName, modifiers = {}) {
    return dispatchEvent("keydown", title, { key: keyName, ...modifiers });
  }
  function clickGutter(id) {
    const gutter = gutterById(id);
    assert.ok(gutter, `expected gutter ${id}`);
    return gutter.click();
  }
  function snapshot() {
    return pane.querySelectorAll(".docRow[data-line-id]").map((row) => {
      const id = row.getAttribute("data-line-id");
      return { id, depth: Number(row.getAttribute("data-depth")), text: lineById(id)?.textContent || "" };
    });
  }

  return {
    context, document, title, pane, rowById, lineById, gutterById, rowIds, setCaret, setSelection,
    caret, key, titleKey, clickGutter, snapshot,
    dirtyTrueCount: () => dirtyTrueCount,
    clearCount: () => clearCount,
  };
}

test("P232 composed path leaves ordinary text Right native before exact row end", () => {
  const h = createHarness("Parent\n  Child\nPeer");
  h.setCaret("line_0", 2);
  const before = h.snapshot();
  const event = h.key("line_0", "ArrowRight");

  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(h.caret(), { lineId: "line_0", offset: 2, collapsed: true });
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.gutterById("line_0").textContent, "▾");
  assert.equal(h.dirtyTrueCount(), 0);
  assert.equal(h.clearCount(), 0);
});

test("P232 first Right at collapsed-branch end expands only through runtime gutter ownership", () => {
  const h = createHarness("Parent\n  Child\n    Grandchild\nPeer");
  const parentRow = h.rowById("line_0");
  const peerRow = h.rowById("line_3");
  h.clickGutter("line_0");
  assert.deepEqual(h.rowIds(), ["line_0", "line_3"]);
  assert.equal(h.gutterById("line_0").textContent, "▸");
  assert.equal(h.dirtyTrueCount(), 0);

  h.setCaret("line_0", "Parent".length);
  const event = h.key("line_0", "ArrowRight");

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.rowIds(), ["line_0", "line_1", "line_2", "line_3"]);
  assert.equal(h.rowById("line_0"), parentRow);
  assert.equal(h.rowById("line_3"), peerRow);
  assert.equal(h.gutterById("line_0").textContent, "▾");
  assert.deepEqual(h.caret(), { lineId: "line_0", offset: "Parent".length, collapsed: true });
  assert.equal(h.document.activeElement, h.lineById("line_0"));
  assert.equal(h.dirtyTrueCount(), 0);
  assert.equal(h.clearCount(), 0);
});

test("P232 Right at expanded-branch end enters first visible direct child at exact offset zero", () => {
  const h = createHarness("Parent\n  Child\n    Grandchild\nPeer");
  const before = h.snapshot();
  h.setCaret("line_0", "Parent".length);
  const event = h.key("line_0", "ArrowRight");

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.caret(), { lineId: "line_1", offset: 0, collapsed: true });
  assert.equal(h.document.activeElement, h.lineById("line_1"));
  assert.notEqual(h.document.activeElement, h.lineById("line_2"), "must not skip direct child for grandchild");
  assert.notEqual(h.document.activeElement, h.lineById("line_3"), "must not jump to following peer");
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.dirtyTrueCount(), 0);
  assert.equal(h.clearCount(), 0);
});

test("P232 leaf and malformed direct-child relationships fail closed to native Right", () => {
  {
    const h = createHarness("Parent\n  Child\nPeer");
    h.setCaret("line_2", "Peer".length);
    const before = h.snapshot();
    const event = h.key("line_2", "ArrowRight");
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(h.caret(), { lineId: "line_2", offset: "Peer".length, collapsed: true });
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.dirtyTrueCount(), 0);
  }
  {
    const h = createHarness("Parent\n  Child\nPeer");
    h.rowById("line_1").setAttribute("data-depth", "2");
    h.setCaret("line_0", "Parent".length);
    const event = h.key("line_0", "ArrowRight");
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(h.caret(), { lineId: "line_0", offset: "Parent".length, collapsed: true });
    assert.equal(h.dirtyTrueCount(), 0);
  }
});

test("P232 modifier, composition, selection, title and read-only guards remain outside Right owner", () => {
  for (const modifiers of [
    { shiftKey: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { isComposing: true },
    { keyCode: 229 },
  ]) {
    const h = createHarness("Parent\n  Child\nPeer");
    h.setCaret("line_0", "Parent".length);
    const event = h.key("line_0", "ArrowRight", modifiers);
    assert.equal(event.defaultPrevented, false, JSON.stringify(modifiers));
    assert.deepEqual(h.caret(), { lineId: "line_0", offset: "Parent".length, collapsed: true }, JSON.stringify(modifiers));
    assert.equal(h.dirtyTrueCount(), 0, JSON.stringify(modifiers));
  }

  {
    const h = createHarness("Parent\n  Child\nPeer");
    h.setSelection("line_0", 1, "Parent".length);
    const event = h.key("line_0", "ArrowRight");
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.document.activeElement, h.lineById("line_0"));
    assert.equal(h.dirtyTrueCount(), 0);
  }

  {
    const h = createHarness("Parent\n  Child\nPeer");
    h.title.focus();
    const event = h.titleKey("ArrowRight");
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.document.activeElement, h.title);
    assert.equal(h.dirtyTrueCount(), 0);
  }

  {
    const h = createHarness("Parent\n  Child\nPeer", { readOnly: true });
    h.setCaret("line_0", "Parent".length);
    const event = h.key("line_0", "ArrowRight");
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(h.caret(), { lineId: "line_0", offset: "Parent".length, collapsed: true });
    assert.equal(h.dirtyTrueCount(), 0);
  }
});

test("P232 preserves accepted plain-Left collapse and child-to-parent boundary behaviour", () => {
  {
    const h = createHarness("Parent\n  Child\nPeer");
    h.setCaret("line_0", 0);
    const event = h.key("line_0", "ArrowLeft");
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(h.rowIds(), ["line_0", "line_2"]);
    assert.equal(h.gutterById("line_0").textContent, "▸");
    assert.deepEqual(h.caret(), { lineId: "line_0", offset: 0, collapsed: true });
    assert.equal(h.dirtyTrueCount(), 0);
    assert.equal(h.clearCount(), 0);
  }

  {
    const h = createHarness("Parent\n  Child\nPeer");
    h.setCaret("line_1", 0);
    const event = h.key("line_1", "ArrowLeft");
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(h.caret(), { lineId: "line_0", offset: "Parent".length, collapsed: true });
    assert.equal(h.dirtyTrueCount(), 0);
    assert.equal(h.clearCount(), 0);
  }
});

test("P232 source guard keeps one polish Right owner, delegates expansion, and leaves runtime/Main competitors untouched", () => {
  const polish = source("js/pocket-node-popout-polish.js");
  const runtime = source("js/pocket-node-popout-runtime.js");
  const main = source("js/pocket-tree-actions.js");

  assert.equal((polish.match(/function handlePlainRight\(/g) || []).length, 1);
  assert.equal((polish.match(/ev\.key !== "ArrowRight"/g) || []).length, 1);
  assert.equal((polish.match(/^\s*handlePlainRight\(ev, doc, payload\);$/gm) || []).length, 1);

  const rightStart = polish.indexOf("function handlePlainRight(");
  const rightEnd = polish.indexOf("function install(", rightStart);
  assert.ok(rightStart >= 0 && rightEnd > rightStart);
  const rightBody = polish.slice(rightStart, rightEnd);
  assert.match(rightBody, /gutter\.click\(\)/);
  assert.match(rightBody, /firstVisibleDirectChildRow/);
  assert.match(rightBody, /placeCaretInElement\(doc, childText, false\)/);
  assert.doesNotMatch(rightBody, /markMutation|innerHTML|applyAndSave|recordOp|collapsed\.(?:add|delete)|lines\.(?:splice|push|pop|shift|unshift)/);

  const runtimeKeyStart = runtime.indexOf('pane.addEventListener("keydown"');
  const runtimeKeyEnd = runtime.indexOf('pane.addEventListener("dragstart"', runtimeKeyStart);
  assert.ok(runtimeKeyStart >= 0 && runtimeKeyEnd > runtimeKeyStart);
  assert.doesNotMatch(runtime.slice(runtimeKeyStart, runtimeKeyEnd), /ArrowRight/);
  assert.match(runtime, /pane\.addEventListener\("click"[\s\S]*toggleBranch\(gi\)/);

  assert.match(main, /if \(ev\.key === "ArrowRight"\)/);
  assert.match(main, /state\.collapsed\.delete\(current\.id\)/);
  assert.match(main, /selectNodeById\(kids\[0\]\.id, \{ expandPath: true \}\)/);
});
