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

function createHarness(text) {
  const { content, runtime } = loadModules();
  const controls = new Map();
  const rafQueue = [];
  const visualRows = new Map();
  let dirtyMarks = 0;
  let document;
  let ranges = [];

  const peDom = createPeTestDom({
    onClassToggle(name, force) {
      if (name === "isDirty" && force === true) dirtyMarks += 1;
    },
    rangeRect(range, dom) {
      let root = range.startContainer;
      while (root) {
        const classes = String(root.className || "").split(/\s+/);
        if (root.nodeType === 1 && classes.includes("lineText") && root.getAttribute?.("data-line-id")) break;
        root = root.parentNode;
      }
      if (!root) return { top: 0, bottom: 0, height: 0 };
      const offset = dom.absoluteOffset(root, range.startContainer, range.startOffset);
      const top = visualRows.get(`${root.getAttribute("data-line-id")}:${offset}`);
      if (!Number.isFinite(top)) return { top: 0, bottom: 0, height: 0 };
      return { top, bottom: top + 16, height: 16 };
    },
  });
  const { Element, Range, selection, absoluteOffset, pointForOffset } = peDom;

  document = {
    activeElement: null,
    body: new Element("body"),
    createElement(tagName) { return new Element(tagName); },
    createRange() { return new Range(); },
    getSelection() { return selection; },
    getElementById(id) { return controls.get(id) || null; },
    addEventListener() {},
  };
  peDom.bindDocument(document);

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
  pane.scrollTop = 222;
  const viewportScrollCalls = [];
  pane.scrollBy = function (options) {
    viewportScrollCalls.push({ ...options });
    this.scrollTop += Number(options?.top) || 0;
  };
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

  function setVisualRow(id, offset, top) {
    visualRows.set(`${id}:${Number(offset) || 0}`, Number(top));
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
    setVisualRow,
    setCaret,
    setSelection,
    caret,
    key,
    clickGutter,
    flushFrames,
    pendingFrames: () => rafQueue.length,
    dirtyMarks: () => dirtyMarks,
    viewport: () => ({ scrollTop: pane.scrollTop, scrollCalls: viewportScrollCalls.slice() }),
    isDirty: () => window.PocketNodePopoutSession.hasUnsavedChanges(),
  };
}

test("physical regression: first ArrowDown bridges when Chrome snaps to the end of the same visual row", () => {
  const harness = createHarness("Alpha\nBravoBravo\nCharlie");
  harness.setVisualRow("line_1", 5, 40);
  harness.setVisualRow("line_1", 10, 40.8);
  harness.setCaret("line_1", 5);
  const before = harness.visibleLines();

  const event = harness.key("line_1", "ArrowDown");
  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.pendingFrames(), 1);

  // Simulate Chrome consuming the first Down by snapping to this same row's end.
  harness.setCaret("line_1", 10);
  harness.flushFrames();

  assert.deepEqual(harness.caret(), { lineId: "line_2", offset: 5, collapsed: true });
  assert.deepEqual(harness.visibleLines(), before);
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
});

test("same-row ArrowUp snap bridges to the previous visible line using the original intent", () => {
  const harness = createHarness("AlphaAlpha\nBravoBravo\nCharlie");
  harness.setVisualRow("line_1", 6, 40);
  harness.setVisualRow("line_1", 0, 40);
  harness.setCaret("line_1", 6);

  const event = harness.key("line_1", "ArrowUp");
  assert.equal(event.defaultPrevented, false);
  harness.setCaret("line_1", 0);
  harness.flushFrames();

  assert.deepEqual(harness.caret(), { lineId: "line_0", offset: 6, collapsed: true });
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
});

test("genuine wrapped-row native movement inside the same editable wins in both directions", () => {
  const harness = createHarness("Alpha\nWrappedSourceText\nCharlie");
  harness.setVisualRow("line_1", 4, 20);
  harness.setVisualRow("line_1", 8, 40);
  harness.setCaret("line_1", 4);

  const down = harness.key("line_1", "ArrowDown");
  assert.equal(down.defaultPrevented, false);
  harness.setCaret("line_1", 8);
  harness.flushFrames();
  assert.deepEqual(harness.caret(), { lineId: "line_1", offset: 8, collapsed: true });

  const up = harness.key("line_1", "ArrowUp");
  assert.equal(up.defaultPrevented, false);
  harness.setCaret("line_1", 4);
  harness.flushFrames();
  assert.deepEqual(harness.caret(), { lineId: "line_1", offset: 4, collapsed: true });
  assert.equal(harness.dirtyMarks(), 0);
  assert.equal(harness.isDirty(), false);
});

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

test("first and last visible boundaries remain harmless native no-ops with stable runtime viewport", () => {
  const harness = createHarness("Alpha\nBeta");
  const initialViewport = harness.viewport();
  harness.setCaret("line_0", 2);

  const up = harness.key("line_0", "ArrowUp");
  assert.equal(up.defaultPrevented, false);
  harness.flushFrames();
  assert.deepEqual(harness.caret(), { lineId: "line_0", offset: 2, collapsed: true });
  assert.deepEqual(harness.viewport(), initialViewport, "first-node boundary must not move viewport");

  harness.setCaret("line_1", 2);
  const down = harness.key("line_1", "ArrowDown");
  assert.equal(down.defaultPrevented, false);
  harness.flushFrames();
  assert.deepEqual(harness.caret(), { lineId: "line_1", offset: 2, collapsed: true });
  assert.deepEqual(harness.viewport(), initialViewport, "last-node boundary must not move viewport");
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