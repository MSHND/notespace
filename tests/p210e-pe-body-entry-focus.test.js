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

function createHarness(options = {}) {
  const listeners = new Map();
  const calls = { preventDefault: 0, bodyFocus: 0, gutterFocus: 0 };
  let activeElement = null;
  let currentRange = null;

  const title = {
    id: "titleInput",
    readOnly: options.readOnly === true,
    disabled: false,
    focus() { activeElement = title; },
  };

  const body = {
    id: "line_0",
    isContentEditable: options.invalidBody === true ? false : true,
    contentEditable: options.invalidBody === true ? "false" : "true",
    textContent: "body text",
    focus() { calls.bodyFocus += 1; activeElement = body; },
    getAttribute(name) {
      if (name === "contenteditable") return this.contentEditable;
      return null;
    },
    contains(node) { return node === body; },
  };

  const gutter = {
    id: "gutter_0",
    focus() { calls.gutterFocus += 1; activeElement = gutter; },
  };

  const pane = {
    id: "outlinePane",
    querySelector(selector) {
      if (selector === ".lineGutter[data-line-id]" || selector === ".lineGutter.branch[data-line-id]") return gutter;
      if (selector !== ".lineText[data-line-id]" || options.missingBody === true) return null;
      return body;
    },
    addEventListener() {},
  };

  const dialog = { id: "unsavedDialog", hidden: true };
  const carrier = {
    id: "pocketNodePopoutPayload",
    tagName: "TEXTAREA",
    value: JSON.stringify({ title: "Existing", readOnly: options.readOnly === true }),
  };

  const elements = new Map([
    ["titleInput", title],
    ["outlinePane", pane],
    ["unsavedDialog", dialog],
    ["pocketNodePopoutPayload", carrier],
  ]);

  const selection = {
    rangeCount: 0,
    removeAllRanges() { currentRange = null; this.rangeCount = 0; },
    addRange(range) { currentRange = range; this.rangeCount = 1; },
    getRangeAt(index) {
      if (index !== 0 || this.rangeCount !== 1 || !currentRange) throw new Error("no range");
      return currentRange;
    },
    toString() { return currentRange && currentRange.collapsed ? "" : "selected"; },
  };

  function createRange() {
    return {
      startContainer: null,
      endContainer: null,
      startOffset: 0,
      endOffset: 0,
      collapsed: false,
      selectNodeContents(element) {
        this.startContainer = element;
        this.endContainer = element;
        this.startOffset = 0;
        this.endOffset = String(element.textContent || "").length;
        this.collapsed = false;
      },
      collapse(toStart) {
        this.toStart = toStart;
        this.collapsed = true;
        if (toStart === true) {
          this.endContainer = this.startContainer;
          this.endOffset = this.startOffset;
        } else {
          this.startContainer = this.endContainer;
          this.startOffset = this.endOffset;
        }
      },
    };
  }

  const doc = {
    readyState: "loading",
    get activeElement() { return activeElement; },
    set activeElement(value) { activeElement = value; },
    getElementById(id) { return elements.get(id) || null; },
    createRange,
    addEventListener(type, handler, capture) { listeners.set(`${type}:${capture === true}`, handler); },
    removeEventListener() {},
  };

  const context = vm.createContext({ console, JSON, Object, Array, Number, String, Math, Set });
  context.window = context;
  context.globalThis = context;
  context.document = doc;
  context.getSelection = () => selection;
  context.requestAnimationFrame = () => 1;
  context.setTimeout = () => 1;
  context.addEventListener = () => {};
  context.removeEventListener = () => {};

  vm.runInContext(source("js/pocket-node-popout-polish.js"), context, {
    filename: "js/pocket-node-popout-polish.js",
  });

  activeElement = title;
  calls.bodyFocus = 0;
  selection.removeAllRanges();

  function event(overrides = {}) {
    return {
      key: "Tab",
      target: title,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      isComposing: false,
      preventDefault() { calls.preventDefault += 1; },
      ...overrides,
    };
  }

  return {
    polish: context.PocketNodePopoutPolish,
    doc,
    title,
    body,
    gutter,
    selection,
    calls,
    event,
    getRange() { return currentRange; },
  };
}

test("P210q editable title plain Tab bypasses gutter and lands at start of first editable body line", () => {
  const h = createHarness();
  const ev = h.event();

  assert.equal(h.polish.handleTitleBodyTab(ev, h.doc, { title: "Existing", readOnly: false }), true);
  assert.equal(h.doc.activeElement, h.body);
  assert.equal(h.calls.preventDefault, 1);
  assert.equal(h.calls.bodyFocus, 1);
  assert.equal(h.calls.gutterFocus, 0);
  assert.equal(h.selection.rangeCount, 1);

  const range = h.getRange();
  assert.ok(range);
  assert.equal(range.collapsed, true);
  assert.equal(range.toStart, true, "title Tab must collapse the body range toward its start");
  assert.equal(range.startContainer, h.body);
  assert.equal(range.endContainer, h.body);
  assert.equal(range.startOffset, 0);
  assert.equal(range.endOffset, 0);
  assert.equal(h.selection.toString(), "", "body content must not be preselected");

  const immediateTextInputTarget = h.doc.activeElement;
  assert.equal(immediateTextInputTarget, h.body, "typing immediately after Tab targets the body without a click");
});
test("P210e Shift+Tab is left native", () => {
  const h = createHarness();
  const ev = h.event({ shiftKey: true });
  assert.equal(h.polish.handleTitleBodyTab(ev, h.doc, { title: "Existing", readOnly: false }), false);
  assert.equal(h.doc.activeElement, h.title);
  assert.equal(h.calls.preventDefault, 0);
  assert.equal(h.selection.rangeCount, 0);
});

test("P210q modified Tab and composition remain native", () => {
  for (const overrides of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
  ]) {
    const h = createHarness();
    const ev = h.event(overrides);
    assert.equal(h.polish.handleTitleBodyTab(ev, h.doc, { title: "Existing", readOnly: false }), false);
    assert.equal(h.doc.activeElement, h.title);
    assert.equal(h.calls.preventDefault, 0);
    assert.equal(h.calls.bodyFocus, 0);
    assert.equal(h.calls.gutterFocus, 0);
    assert.equal(h.selection.rangeCount, 0);
  }
});

test("P210e read-only title/body handoff is not overridden", () => {
  const h = createHarness({ readOnly: true });
  const ev = h.event();
  assert.equal(h.polish.handleTitleBodyTab(ev, h.doc, { title: "Existing", readOnly: true }), false);
  assert.equal(h.doc.activeElement, h.title);
  assert.equal(h.calls.preventDefault, 0);
  assert.equal(h.selection.rangeCount, 0);
});

test("P210e missing or non-editable body target does not trap focus", () => {
  for (const options of [{ missingBody: true }, { invalidBody: true }]) {
    const h = createHarness(options);
    const ev = h.event();
    assert.equal(h.polish.handleTitleBodyTab(ev, h.doc, { title: "Existing", readOnly: false }), false);
    assert.equal(h.doc.activeElement, h.title);
    assert.equal(h.calls.preventDefault, 0);
    assert.equal(h.calls.bodyFocus, 0);
    assert.equal(h.calls.gutterFocus, 0);
    assert.equal(h.selection.rangeCount, 0);
  }
});

test("P210q changes only title-Tab caret direction and preserves opening-focus end placement", () => {
  const polish = source("js/pocket-node-popout-polish.js");
  assert.match(polish, /return first \? placeCaretInElement\(doc, first, true\) : false;/);
  assert.match(polish, /placeCaretInElement\(doc, body, false\)/);
});

test("P210e new path is title-only and leaves runtime body Tab indentation ownership unchanged", () => {
  const polish = source("js/pocket-node-popout-polish.js");
  assert.match(polish, /doc\.activeElement !== title \|\| ev\.target !== title/);
  assert.doesNotMatch(polish, /indentBranch|markMutation|applyAndSave|recordOp|buildPocketPayload/);

  const runtime = source("js/pocket-node-popout-runtime.js");
  assert.match(runtime, /if\(ev\.key===\"Tab\"\)\{ev\.preventDefault\(\);indentBranch\(index,ev\.shiftKey\?-1:1\);return;\}/);
});
