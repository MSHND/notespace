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
