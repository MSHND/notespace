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

function loadPolishHarness({
  rangeRect = { top: 0, bottom: 0, height: 0 },
  clientRects = [],
  editableRect = { top: 440, bottom: 460, height: 20 },
  rowRect = editableRect,
  paneRect = { top: 100, bottom: 500, height: 400 },
  scrollTop = 300,
  scrollHeight = 1000,
  clientHeight = 400,
} = {}) {
  const scrollCalls = [];
  const row = {
    getBoundingClientRect() { return rowRect; },
  };
  const editable = {
    className: "lineText",
    getAttribute(name) { return name === "data-line-id" ? "line_last" : null; },
    contains(node) { return node === this; },
    closest(selector) {
      if (selector === ".lineText[data-line-id]") return this;
      if (selector === ".docRow[data-line-id]") return row;
      return null;
    },
    getBoundingClientRect() { return editableRect; },
  };
  const pane = {
    scrollTop,
    scrollHeight,
    clientHeight,
    getBoundingClientRect() { return paneRect; },
    scrollBy(options) {
      scrollCalls.push({ ...options, before: this.scrollTop });
      this.scrollTop += Number(options?.top) || 0;
    },
    addEventListener() {},
  };
  const range = {
    collapsed: true,
    startContainer: editable,
    startOffset: 0,
    getBoundingClientRect() { return rangeRect; },
    getClientRects() { return clientRects; },
  };
  const selection = {
    rangeCount: 1,
    getRangeAt() { return range; },
  };
  const doc = {
    activeElement: editable,
    getSelection() { return selection; },
    getElementById(id) {
      if (id === "outlinePane") return pane;
      return null;
    },
  };
  const context = vm.createContext({
    console,
    document: doc,
    setTimeout(callback) { if (typeof callback === "function") callback(); return 1; },
  });
  context.window = context;
  context.globalThis = context;
  context.getSelection = () => selection;
  context.requestAnimationFrame = (callback) => { if (typeof callback === "function") callback(); return 1; };

  vm.runInContext(source("js/pocket-node-popout-polish.js"), context, {
    filename: "js/pocket-node-popout-polish.js",
  });

  return {
    polish: context.PocketNodePopoutPolish,
    doc,
    pane,
    editable,
    range,
    scrollCalls,
  };
}

test("P214 Phase A: terminal ArrowDown comfort cycles must not walk viewport upward from degenerate caret geometry", () => {
  const h = loadPolishHarness({
    rangeRect: { top: 0, bottom: 0, height: 0 },
    clientRects: [],
    editableRect: { top: 440, bottom: 460, height: 20 },
    rowRect: { top: 438, bottom: 462, height: 24 },
    scrollTop: 300,
  });

  for (let i = 0; i < 5; i += 1) h.polish.keepActiveLineComfortable(h.doc);

  assert.equal(h.pane.scrollTop, 300, "terminal no-op must leave viewport stable");
  assert.deepEqual(h.scrollCalls, [], "degenerate caret geometry must not generate phantom upward scrolls");
});


test("P214 terminal ArrowUp equivalent comfort cycles do not walk viewport downward from degenerate caret geometry", () => {
  const h = loadPolishHarness({
    rangeRect: { top: 900, bottom: 900, height: 0 },
    clientRects: [],
    editableRect: { top: 140, bottom: 160, height: 20 },
    rowRect: { top: 138, bottom: 162, height: 24 },
    scrollTop: 120,
  });

  for (let i = 0; i < 5; i += 1) h.polish.keepActiveLineComfortable(h.doc);

  assert.equal(h.pane.scrollTop, 120);
  assert.deepEqual(h.scrollCalls, []);
});

test("P214 rejects degenerate Range geometry and uses editable fallback for bounded lower comfort correction", () => {
  const h = loadPolishHarness({
    rangeRect: { top: 0, bottom: 0, height: 0 },
    clientRects: [],
    editableRect: { top: 480, bottom: 496, height: 16 },
    rowRect: { top: 478, bottom: 498, height: 20 },
    scrollTop: 300,
  });

  assert.equal(h.polish.keepActiveLineComfortable(h.doc), true);
  assert.equal(h.scrollCalls.length, 1);
  assert.equal(h.scrollCalls[0].top, 26);
  assert.equal(h.scrollCalls[0].behavior, "smooth");
});

test("P214 uses a usable client rect when collapsed Range bounding rect is degenerate", () => {
  const h = loadPolishHarness({
    rangeRect: { top: 0, bottom: 0, height: 0 },
    clientRects: [{ top: 478, bottom: 494, height: 16 }],
    editableRect: { top: 250, bottom: 266, height: 16 },
    scrollTop: 300,
  });

  assert.equal(h.polish.keepActiveLineComfortable(h.doc), true);
  assert.equal(h.scrollCalls.length, 1);
  assert.equal(h.scrollCalls[0].top, 24);
});

test("P214 valid caret geometry preserves lower, upper and comfortable scroll contract", () => {
  const lower = loadPolishHarness({
    rangeRect: { top: 478, bottom: 494, height: 16 },
    editableRect: { top: 250, bottom: 266, height: 16 },
    scrollTop: 300,
  });
  assert.equal(lower.polish.keepActiveLineComfortable(lower.doc), true);
  assert.equal(lower.scrollCalls[0].top, 24);

  const upper = loadPolishHarness({
    rangeRect: { top: 110, bottom: 126, height: 16 },
    editableRect: { top: 250, bottom: 266, height: 16 },
    scrollTop: 300,
  });
  assert.equal(upper.polish.keepActiveLineComfortable(upper.doc), true);
  assert.equal(upper.scrollCalls[0].top, -20);

  const comfortable = loadPolishHarness({
    rangeRect: { top: 250, bottom: 266, height: 16 },
    editableRect: { top: 480, bottom: 496, height: 16 },
    scrollTop: 300,
  });
  assert.equal(comfortable.polish.keepActiveLineComfortable(comfortable.doc), false);
  assert.deepEqual(comfortable.scrollCalls, []);
});

test("P214 does not treat coordinate top zero as invalid when caret height is meaningful", () => {
  const h = loadPolishHarness({
    rangeRect: { top: 0, bottom: 16, height: 16 },
    clientRects: [],
    editableRect: { top: 280, bottom: 296, height: 16 },
    paneRect: { top: -100, bottom: 300, height: 400 },
    scrollTop: 100,
  });
  assert.equal(h.polish.keepActiveLineComfortable(h.doc), false);
  assert.deepEqual(h.scrollCalls, []);
});
