"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadModules() {
  const context = vm.createContext({ window: {}, TextEncoder });
  context.globalThis = context;
  vm.runInContext(source("js/pocket-node-content.js"), context, { filename: "js/pocket-node-content.js" });
  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context, { filename: "js/pocket-node-popout-runtime.js" });
  return {
    content: context.window.PocketNodeContent,
    runtime: context.window.PocketNodePopoutRuntime,
  };
}

function createHarness(text) {
  const { content, runtime } = loadModules();
  const controls = new Map();
  const rafQueue = [];
  let dirtyMarks = 0;
  let document;
  let ranges = [];

  class TextNode {
    constructor(value = "") {
      this.nodeType = 3;
      this.nodeValue = String(value);
      this.parentNode = null;
    }
    get textContent() { return this.nodeValue; }
    set textContent(value) { this.nodeValue = String(value); }
    contains(candidate) { return candidate === this; }
  }

  class Element {
    constructor(tagName = "div") {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this.style = {};
      this.attributes = new Map();
      this.children = [];
      this.childNodes = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      this.readOnly = false;
      this.contentEditable = "false";
      this.spellcheck = false;
      this.draggable = false;
      this.classList = {
        toggle: (name, force) => {
          if (name === "isDirty" && force === true) dirtyMarks += 1;
          return !!force;
        },
        add() {},
        remove() {},
        contains() { return false; },
      };
    }

    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    dispatch(type, values = {}) {
      const event = {
        type,
        target: this,
        key: "",
        keyCode: 0,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
        ...values,
      };
      for (const handler of this.listeners.get(type) || []) {
        handler(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    }
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      if (child.nodeType === 1) this.children.push(child);
      return child;
    }
    contains(candidate) {
      return candidate === this || this.childNodes.some((child) => child.contains?.(candidate));
    }
    closest(selector) {
      let candidate = this;
      while (candidate) {
        const classes = String(candidate.className || "").split(/\s+/);
        if (selector === ".lineText[data-line-id]" && classes.includes("lineText") && candidate.getAttribute?.("data-line-id")) return candidate;
        if (selector === ".lineGutter[data-line-id]" && classes.includes("lineGutter") && candidate.getAttribute?.("data-line-id")) return candidate;
        if (selector === ".docRow[data-line-id]" && classes.includes("docRow") && candidate.getAttribute?.("data-line-id")) return candidate;
        candidate = candidate.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const result = [];
      const visit = (candidate) => {
        for (const child of candidate.childNodes || []) {
          if (child.nodeType !== 1) continue;
          const classes = String(child.className || "").split(/\s+/);
          if (selector === ".lineText[data-line-id]" && classes.includes("lineText") && child.getAttribute("data-line-id")) result.push(child);
          if (selector === ".lineGutter[data-line-id]" && classes.includes("lineGutter") && child.getAttribute("data-line-id")) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }
    focus() { document.activeElement = this; }
    select() {}
  }

  Object.defineProperty(Element.prototype, "textContent", {
    get() { return this.childNodes.map((child) => child.textContent || "").join(""); },
    set(value) {
      this.children.length = 0;
      this.childNodes.length = 0;
      const textValue = String(value == null ? "" : value);
      if (textValue.length > 0) this.appendChild(new TextNode(textValue));
    },
  });

  Object.defineProperty(Element.prototype, "innerHTML", {
    get() { return ""; },
    set() { this.children.length = 0; this.childNodes.length = 0; },
  });

  function textLength(node) {
    return String(node && node.textContent || "").length;
  }

  function absoluteOffset(root, container, offset) {
    let total = 0;
    let found = false;
    const visit = (node) => {
      if (!node || found) return;
      if (node === container) {
        if (node.nodeType === 3) {
          total += Math.max(0, Math.min(Number(offset) || 0, textLength(node)));
        } else {
          const limit = Math.max(0, Math.min(Number(offset) || 0, (node.childNodes || []).length));
          for (let index = 0; index < limit; index += 1) total += textLength(node.childNodes[index]);
        }
        found = true;
        return;
      }
      if (node.nodeType === 3) {
        total += textLength(node);
        return;
      }
      for (const child of node.childNodes || []) visit(child);
    };
    visit(root);
    return found ? total : null;
  }

  function pointForOffset(root, offset) {
    let remaining = Math.max(0, Math.min(Number(offset) || 0, textLength(root)));
    let lastText = null;
    const visit = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) {
          lastText = child;
          const length = textLength(child);
          if (remaining <= length) return { container: child, offset: remaining };
          remaining -= length;
          continue;
        }
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    const point = visit(root);
    if (point) return point;
    if (lastText) return { container: lastText, offset: textLength(lastText) };
    return { container: root, offset: 0 };
  }

  class Range {
    constructor() {
      this.startContainer = null;
      this.endContainer = null;
      this.startOffset = 0;
      this.endOffset = 0;
      this.collapsed = true;
      this.selectedRoot = null;
    }
    cloneRange() {
      const clone = new Range();
      clone.startContainer = this.startContainer;
      clone.endContainer = this.endContainer;
      clone.startOffset = this.startOffset;
      clone.endOffset = this.endOffset;
      clone.collapsed = this.collapsed;
      clone.selectedRoot = this.selectedRoot;
      return clone;
    }
    selectNodeContents(target) {
      this.selectedRoot = target;
      this.startContainer = target;
      this.startOffset = 0;
      this.endContainer = target;
      this.endOffset = (target.childNodes || []).length;
      this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }
    setStart(container, offset) {
      this.startContainer = container;
      this.startOffset = Number(offset) || 0;
      this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }
    setEnd(container, offset) {
      this.endContainer = container;
      this.endOffset = Number(offset) || 0;
      this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }
    collapse(toStart) {
      if (toStart) {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      } else {
        this.startContainer = this.endContainer;
        this.startOffset = this.endOffset;
      }
      this.collapsed = true;
    }
    toString() {
      if (!this.selectedRoot) return "";
      const text = String(this.selectedRoot.textContent || "");
      const start = absoluteOffset(this.selectedRoot, this.startContainer, this.startOffset);
      const end = absoluteOffset(this.selectedRoot, this.endContainer, this.endOffset);
      if (start === null || end === null) return "";
      return text.slice(Math.min(start, end), Math.max(start, end));
    }
  }

  const selection = {
    get rangeCount() { return ranges.length; },
    getRangeAt(index) { return ranges[index]; },
    removeAllRanges() { ranges = []; },
    addRange(range) { ranges = [range]; },
  };

  document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
    createRange() { return new Range(); },
    getSelection() { return selection; },
    getElementById(id) { return controls.get(id) || null; },
    addEventListener() {},
  };

  for (const id of [
    "titleInput", "outlinePane", "saveState", "saveBtn", "saveCloseBtn", "unsavedDialog",
    "unsavedSaveBtn", "unsavedDiscardBtn", "unsavedCancelBtn", "closeBtn",
  ]) controls.set(id, new Element(id === "titleInput" ? "input" : id.includes("Btn") ? "button" : "div"));
  controls.get("unsavedDialog").hidden = true;

  const window = {
    document,
    navigator: {},
    opener: null,
    getSelection() { return selection; },
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
    addEventListener() {},
    close() {},
  };

  const payload = { id: "p209", title: "P209", text, body: text, readOnly: false };
  assert.equal(runtime.initialise(payload, {
    window,
    document,
    content,
    getSelection() { return selection; },
    requestAnimationFrame(callback) { rafQueue.push(callback); return rafQueue.length; },
  }), true);

  const pane = controls.get("outlinePane");
  const parsed = content.parseLines(text);
  pane.innerHTML = "";
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
    editable.contentEditable = "true";
    editable.textContent = line.content;
    row.appendChild(gutter);
    row.appendChild(editable);
    pane.appendChild(row);
  });

  function lineById(id) {
    return pane.querySelectorAll(".lineText[data-line-id]").find((line) => line.getAttribute("data-line-id") === id) || null;
  }

  function gutterById(id) {
    return pane.querySelectorAll(".lineGutter[data-line-id]").find((gutter) => gutter.getAttribute("data-line-id") === id) || null;
  }

  function visibleLines() {
    return pane.querySelectorAll(".lineText[data-line-id]").map((line) => ({
      id: line.getAttribute("data-line-id"),
      depth: Number(line.parentNode.getAttribute("data-depth")),
      content: line.textContent,
    }));
  }

  function setCaret(id, offset) {
    const target = lineById(id);
    assert.ok(target, `expected ${id} to be rendered`);
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
    assert.ok(target, `expected ${id} to be rendered`);
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
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const active = document.activeElement;
    if (!active || !active.getAttribute?.("data-line-id")) return null;
    return {
      lineId: active.getAttribute("data-line-id"),
      offset: absoluteOffset(active, range.startContainer, range.startOffset),
      collapsed: range.collapsed,
    };
  }

  function key(id, keyName, modifiers = {}) {
    const target = lineById(id);
    assert.ok(target, `expected ${id} to be rendered`);
    return pane.dispatch("keydown", { target, key: keyName, ...modifiers });
  }

  function clickGutter(id) {
    const target = gutterById(id);
    assert.ok(target, `expected gutter ${id} to be rendered`);
    return pane.dispatch("click", { target });
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

  return {
    document,
    lineById,
    gutterById,
    visibleLines,
    setCaret,
    setSelection,
    caret,
    key,
    clickGutter,
    flushFrames,
    pendingFrames: () => rafQueue.length,
    dirtyMarks: () => dirtyMarks,
    isDirty: () => window.PocketNodePopoutSession.hasUnsavedChanges(),
  };
}

test("plain ArrowDown bridges only after native movement leaves caret and focus unchanged", () => {
  const harness = createHarness("Alpha\nBeta");
  harness.setCaret("line_0", 3);
  const before = harness.visibleLines();

  const event = harness.key("line_0", "ArrowDown");
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.pendingFrames(), 1);
  assert.deepEqual(harness.caret(), { lineId: "line_0", offset: 3, collapsed: true });

  harness.flushFrames();
  assert.deepEqual(harness.caret(), { lineId: "line_1", offset: 3, collapsed: true });
  assert.deepEqual(harness.visibleLines(), before);
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
});

test("plain ArrowUp bridges symmetrically to the previous visible line", () => {
  const harness = createHarness("Alpha\nBeta");
  harness.setCaret("line_1", 2);

  const event = harness.key("line_1", "ArrowUp");
  assert.equal(event.defaultPrevented, false);
  harness.flushFrames();

  assert.deepEqual(harness.caret(), { lineId: "line_0", offset: 2, collapsed: true });
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
});

test("bridge preserves a practical character offset and clamps safely for a shorter destination", () => {
  const harness = createHarness("Longer\nHi");
  harness.setCaret("line_0", 5);

  harness.key("line_0", "ArrowDown");
  harness.flushFrames();

  assert.deepEqual(harness.caret(), { lineId: "line_1", offset: 2, collapsed: true });
  assert.equal(harness.dirtyMarks(), 0);
});

test("collapsed descendants are skipped without changing collapse state", () => {
  const harness = createHarness("Parent\n  Hidden\nNext");
  const click = harness.clickGutter("line_0");
  assert.equal(click.defaultPrevented, true);
  harness.flushFrames();
  assert.equal(harness.lineById("line_1"), null);
  assert.equal(harness.gutterById("line_0").textContent, "▸");

  harness.setCaret("line_0", 4);
  const event = harness.key("line_0", "ArrowDown");
  assert.equal(event.defaultPrevented, false);
  harness.flushFrames();

  assert.deepEqual(harness.caret(), { lineId: "line_2", offset: 4, collapsed: true });
  assert.equal(harness.lineById("line_1"), null);
  assert.equal(harness.gutterById("line_0").textContent, "▸");
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
});

test("native caret movement inside the same editable wins and Pocket does not override it", () => {
  const harness = createHarness("Alpha\nBeta");
  harness.setCaret("line_0", 1);

  const event = harness.key("line_0", "ArrowDown");
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.pendingFrames(), 1);

  harness.setCaret("line_0", 4);
  harness.flushFrames();

  assert.deepEqual(harness.caret(), { lineId: "line_0", offset: 4, collapsed: true });
  assert.equal(harness.dirtyMarks(), 0);
});

test("native focus or selection movement to another editable wins and Pocket does not override it", () => {
  const harness = createHarness("Alpha\nBeta");
  harness.setCaret("line_0", 2);

  const event = harness.key("line_0", "ArrowDown");
  assert.equal(event.defaultPrevented, false);
  harness.setCaret("line_1", 1);
  harness.flushFrames();

  assert.deepEqual(harness.caret(), { lineId: "line_1", offset: 1, collapsed: true });
  assert.equal(harness.dirtyMarks(), 0);
});

test("first and last visible boundaries remain harmless native no-ops", () => {
  const harness = createHarness("Alpha\nBeta");
  harness.setCaret("line_0", 2);

  const up = harness.key("line_0", "ArrowUp");
  assert.equal(up.defaultPrevented, false);
  harness.flushFrames();
  assert.deepEqual(harness.caret(), { lineId: "line_0", offset: 2, collapsed: true });

  harness.setCaret("line_1", 2);
  const down = harness.key("line_1", "ArrowDown");
  assert.equal(down.defaultPrevented, false);
  harness.flushFrames();
  assert.deepEqual(harness.caret(), { lineId: "line_1", offset: 2, collapsed: true });
  assert.equal(harness.dirtyMarks(), 0);
});

test("selection-extension, Alt, composition and ambiguous selection remain native and unclaimed", () => {
  const harness = createHarness("Alpha\nBeta");
  harness.setCaret("line_0", 2);

  for (const modifiers of [
    { shiftKey: true },
    { altKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true },
    { isComposing: true },
    { keyCode: 229 },
  ]) {
    const event = harness.key("line_0", "ArrowDown", modifiers);
    assert.equal(event.defaultPrevented, false);
    assert.equal(harness.pendingFrames(), 0);
  }

  harness.setSelection("line_0", 1, 3);
  const selected = harness.key("line_0", "ArrowDown");
  assert.equal(selected.defaultPrevented, false);
  assert.equal(harness.pendingFrames(), 0);
  assert.deepEqual(harness.caret(), { lineId: "line_0", offset: 1, collapsed: false });
  assert.equal(harness.dirtyMarks(), 0);
});

test("Ctrl/Cmd Arrow movement remains the existing structural route", () => {
  const ctrlHarness = createHarness("One\nTwo");
  ctrlHarness.setCaret("line_0", 1);
  const ctrlEvent = ctrlHarness.key("line_0", "ArrowDown", { ctrlKey: true });
  assert.equal(ctrlEvent.defaultPrevented, true);
  assert.deepEqual(ctrlHarness.visibleLines().map(({ id, content }) => ({ id, content })), [
    { id: "line_1", content: "Two" },
    { id: "line_0", content: "One" },
  ]);
  assert.equal(ctrlHarness.dirtyMarks(), 1);
  assert.equal(ctrlHarness.isDirty(), true);

  const metaHarness = createHarness("One\nTwo");
  metaHarness.setCaret("line_1", 1);
  const metaEvent = metaHarness.key("line_1", "ArrowUp", { metaKey: true });
  assert.equal(metaEvent.defaultPrevented, true);
  assert.deepEqual(metaHarness.visibleLines().map(({ id, content }) => ({ id, content })), [
    { id: "line_1", content: "Two" },
    { id: "line_0", content: "One" },
  ]);
  assert.equal(metaHarness.dirtyMarks(), 1);
  assert.equal(metaHarness.isDirty(), true);
});