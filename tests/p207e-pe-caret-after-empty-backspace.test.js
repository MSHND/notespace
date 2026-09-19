"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createPeTestDom } = require("./helpers/pe-test-dom");

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

function createHarness(text, options = {}) {
  const { content, runtime } = loadModules();
  const controls = new Map();
  let dirtyMarks = 0;
  let document;
  let ranges = [];

  const peDom = createPeTestDom({
    onClassToggle(name, force) {
      if (name === "isDirty" && force === true) dirtyMarks += 1;
    },
  });
  const { Element, Range, selection, absoluteOffset } = peDom;

  document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
    getElementById(id) { return controls.get(id) || null; },
    addEventListener() {},
  };
  peDom.bindDocument(document);
  if (options.selectionSupport !== false) {
    document.createRange = () => new Range();
    document.getSelection = () => selection;
  }

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
  if (options.selectionSupport !== false) window.getSelection = () => selection;

  const payload = { id: "p207e", title: "P207e", text, body: text, readOnly: false };
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

  function caret() {
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return {
      targetId: range.selectedTarget?.getAttribute?.("data-line-id") || null,
      collapsed: range.collapsed,
      collapsedToStart: range.collapsedToStart,
      startOffset: absoluteOffset(range.selectedTarget || document.activeElement, range.startContainer, range.startOffset),
      endOffset: absoluteOffset(range.selectedTarget || document.activeElement, range.endContainer, range.endOffset),
    };
  }

  return {
    pane,
    document,
    lineById,
    gutterById,
    visibleLines,
    key,
    clickGutter,
    caret,
    selectionRangeCount: () => selection.rangeCount,
    dirtyMarks: () => dirtyMarks,
    isDirty: () => window.PocketNodePopoutSession.hasUnsavedChanges(),
  };
}

test("middle empty-line Backspace focuses the previous survivor with a collapsed caret at its text end", () => {
  const harness = createHarness("Alpha\n\nBeta");
  const event = harness.key("line_1", "Backspace");

  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.dirtyMarks(), 1);
  assert.equal(harness.isDirty(), true);
  assert.deepEqual(harness.visibleLines(), [
    { id: "line_0", depth: 0, content: "Alpha" },
    { id: "line_2", depth: 0, content: "Beta" },
  ]);
  assert.equal(harness.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.deepEqual(harness.caret(), {
    targetId: "line_0",
    collapsed: true,
    collapsedToStart: false,
    startOffset: "Alpha".length,
    endOffset: "Alpha".length,
  });
});

test("collapsed previous branch stays collapsed and receives the end caret while its child stays hidden and preserved", () => {
  const harness = createHarness("Parent\n  Child\n\nNext");

  harness.clickGutter("line_0");
  assert.equal(harness.lineById("line_1"), null);
  assert.equal(harness.gutterById("line_0").textContent, "▸");

  const event = harness.key("line_2", "Backspace");
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.dirtyMarks(), 1);
  assert.equal(harness.lineById("line_1"), null, "hidden child must stay hidden");
  assert.equal(harness.gutterById("line_0").textContent, "▸", "branch must stay collapsed");
  assert.equal(harness.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.deepEqual(harness.caret(), {
    targetId: "line_0",
    collapsed: true,
    collapsedToStart: false,
    startOffset: "Parent".length,
    endOffset: "Parent".length,
  });

  harness.clickGutter("line_0");
  const child = harness.lineById("line_1");
  assert.ok(child, "hidden child must remain after re-expanding");
  assert.equal(child.textContent, "Child");
  assert.equal(Number(child.parentNode.getAttribute("data-depth")), 1);
  assert.equal(harness.dirtyMarks(), 1, "fold proof must not add a structural mutation");
});

test("non-empty Backspace stays native and first-line fallback does not receive the previous-line end-caret rule", () => {
  const nativeHarness = createHarness("Alpha\nBeta");
  const nativeEvent = nativeHarness.key("line_0", "Backspace");
  assert.equal(nativeEvent.defaultPrevented, false);
  assert.equal(nativeHarness.dirtyMarks(), 0);
  assert.equal(nativeHarness.selectionRangeCount(), 0);

  const fallbackHarness = createHarness("\nBeta");
  const fallbackEvent = fallbackHarness.key("line_0", "Backspace");
  assert.equal(fallbackEvent.defaultPrevented, true);
  assert.equal(fallbackHarness.dirtyMarks(), 1);
  assert.deepEqual(fallbackHarness.visibleLines(), [
    { id: "line_1", depth: 0, content: "Beta" },
  ]);
  assert.equal(fallbackHarness.document.activeElement?.getAttribute("data-line-id"), "line_1");
  assert.equal(fallbackHarness.selectionRangeCount(), 0, "following-survivor fallback must keep existing focus-only semantics");
});

test("missing Range or Selection support fails safely back to focus-only behaviour", () => {
  const harness = createHarness("Alpha\n\nBeta", { selectionSupport: false });
  const event = harness.key("line_1", "Backspace");

  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.dirtyMarks(), 1);
  assert.equal(harness.document.activeElement?.getAttribute("data-line-id"), "line_0");
  assert.deepEqual(harness.visibleLines(), [
    { id: "line_0", depth: 0, content: "Alpha" },
    { id: "line_2", depth: 0, content: "Beta" },
  ]);
});
