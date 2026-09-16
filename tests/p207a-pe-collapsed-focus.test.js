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

function loadContent() {
  const context = vm.createContext({ window: {}, TextEncoder });
  context.globalThis = context;
  vm.runInContext(source("js/pocket-node-content.js"), context, { filename: "js/pocket-node-content.js" });
  return context.window.PocketNodeContent;
}

function loadRuntime() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context, { filename: "js/pocket-node-popout-runtime.js" });
  return context.window.PocketNodePopoutRuntime;
}

function createHarness(text) {
  const content = loadContent();
  const runtime = loadRuntime();
  const controls = new Map();
  let dirtyMarks = 0;
  let document;

  class Element {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this.style = {};
      this.attributes = new Map();
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.textContent = "";
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
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
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
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    contains(candidate) {
      return candidate === this || this.children.some((child) => child.contains?.(candidate));
    }
    closest(selector) {
      let candidate = this;
      while (candidate) {
        const classes = String(candidate.className || "").split(/\s+/);
        if (selector === ".lineText[data-line-id]" && classes.includes("lineText") && candidate.getAttribute("data-line-id")) return candidate;
        if (selector === ".lineGutter[data-line-id]" && classes.includes("lineGutter") && candidate.getAttribute("data-line-id")) return candidate;
        if (selector === ".docRow[data-line-id]" && classes.includes("docRow") && candidate.getAttribute("data-line-id")) return candidate;
        candidate = candidate.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const result = [];
      const visit = (candidate) => {
        for (const child of candidate.children || []) {
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

  Object.defineProperty(Element.prototype, "innerHTML", {
    get() { return ""; },
    set() { this.children.length = 0; },
  });

  document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
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
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
    addEventListener() {},
    close() {},
  };

  const payload = { id: "p207a", title: "P207a", text, body: text, readOnly: false };
  assert.equal(runtime.initialise(payload, {
    window,
    document,
    content,
    requestAnimationFrame(callback) { if (typeof callback === "function") callback(); return 1; },
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

  function key(id, keyName) {
    const target = lineById(id);
    assert.ok(target, `expected ${id} to be rendered`);
    return pane.dispatch("keydown", { target, key: keyName });
  }

  function clickGutter(id) {
    const target = gutterById(id);
    assert.ok(target, `expected gutter ${id} to be rendered`);
    return pane.dispatch("click", { target });
  }

  return {
    pane,
    document,
    window,
    lineById,
    gutterById,
    visibleLines,
    key,
    clickGutter,
    dirtyMarks: () => dirtyMarks,
    isDirty: () => window.PocketNodePopoutSession.hasUnsavedChanges(),
  };
}

test("empty-line Backspace focuses the nearest visible survivor before a hidden collapsed descendant", () => {
  const harness = createHarness("Parent\n  Child\n\nNext");

  const collapseEvent = harness.clickGutter("line_0");
  assert.equal(collapseEvent.defaultPrevented, true);
  assert.equal(harness.lineById("line_1"), null, "collapsed child must be hidden before removal");
  assert.ok(harness.lineById("line_2"), "empty sibling must remain visible beside collapsed branch");
  assert.equal(harness.gutterById("line_0").textContent, "▸", "branch must be collapsed");
  assert.equal(harness.dirtyMarks(), 0, "folding is not a PE content mutation");

  const event = harness.key("line_2", "Backspace");
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.dirtyMarks(), 1, "removal must record exactly one PE mutation");
  assert.equal(harness.isDirty(), true);
  assert.deepEqual(harness.visibleLines(), [
    { id: "line_0", depth: 0, content: "Parent" },
    { id: "line_3", depth: 0, content: "Next" },
  ]);
  assert.equal(harness.lineById("line_2"), null, "only the empty line is removed");
  assert.equal(harness.lineById("line_1"), null, "child remains hidden while branch stays collapsed");
  assert.equal(harness.gutterById("line_0").textContent, "▸", "removal must not unfold the branch");
  assert.equal(harness.document.activeElement?.getAttribute("data-line-id"), "line_0", "focus must land on visible collapsed branch head");

  harness.clickGutter("line_0");
  const child = harness.lineById("line_1");
  assert.ok(child, "hidden child must still exist after expanding the preserved branch");
  assert.equal(child.textContent, "Child");
  assert.equal(Number(child.parentNode.getAttribute("data-depth")), 1);
  assert.deepEqual(harness.visibleLines(), [
    { id: "line_0", depth: 0, content: "Parent" },
    { id: "line_1", depth: 1, content: "Child" },
    { id: "line_3", depth: 0, content: "Next" },
  ]);
  assert.equal(harness.dirtyMarks(), 1, "expanding for proof must not add a content mutation");
});
