"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ACTIONS = "js/pocket-tree-actions.js";

function source() {
  return fs.readFileSync(path.join(ROOT, ACTIONS), "utf8");
}

function makeHarness({ query = "", moveMode = false, inlineEditId = "", blocked = false } = {}) {
  class HTMLElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.isContentEditable = false;
      this.value = "";
    }
  }
  class HTMLInputElement extends HTMLElement {
    constructor() {
      super("input");
    }
  }

  const search = new HTMLInputElement();
  search.value = query;
  const target = new HTMLElement("div");
  let deletes = 0;
  const applied = [];

  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect,
    JSON, Date, Math, Promise,
    HTMLElement,
    HTMLInputElement,
    state: {
      moveMode,
      inlineEdit: { id: inlineEditId },
      selectedId: "A",
    },
    el: { search },
    cleanText(value, maximum = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, maximum);
    },
    isDetailsEditorOpen() { return false; },
    isControlsHelpOpen() { return blocked; },
    isCommandPaletteOpen() { return false; },
    isPocketVaultRecoveryFlowOpen() { return false; },
    isPocketDeviceChangesDecisionOpen() { return false; },
    deleteSelected() { deletes += 1; },
    pendingPathImport: null,
    pendingDeleteConfirmNodeId: "",
    pendingDeleteConfirmExpiresAt: 0,
  };
  context.window = context;
  context.globalThis = context;
  context.window.applyPocketFilterQueryValue = (value, options) => {
    search.value = String(value);
    applied.push({ value: String(value), options: { ...options } });
    return true;
  };
  context.window.settlePocketPendingFilterRender = () => false;

  vm.createContext(context);
  vm.runInContext(source(), context, { filename: ACTIONS });

  function keydown(key, overrides = {}) {
    const event = {
      target,
      key,
      code: key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() { this.defaultPrevented = true; },
      defaultPrevented: false,
      ...overrides,
    };
    context.handleTreeKeydown(event);
    return event;
  }

  return {
    context,
    search,
    target,
    keydown,
    applied,
    deletes: () => deletes,
  };
}

test("P272 Backspace with a non-empty Filter remains Filter-edit only, including the last character", () => {
  const h = makeHarness({ query: "b" });

  const event = h.keydown("Backspace");

  assert.equal(event.defaultPrevented, true);
  assert.equal(h.search.value, "");
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].value, "");
  assert.equal(h.applied[0].options.keepMainFocus, true);
  assert.equal(h.applied[0].options.immediate, true);
  assert.equal(h.deletes(), 0, "the keypress removing the last Filter character must not become delete intent");
});

test("P281 a subsequent plain Backspace with an already-empty Filter is consumed and inert", () => {
  const h = makeHarness({ query: "" });
  const selectedBefore = h.context.state.selectedId;
  const armedBefore = h.context.pendingDeleteConfirmNodeId;
  const expiresBefore = h.context.pendingDeleteConfirmExpiresAt;

  const event = h.keydown("Backspace");

  assert.equal(event.defaultPrevented, true);
  assert.equal(h.applied.length, 0);
  assert.equal(h.deletes(), 0);
  assert.equal(h.context.state.selectedId, selectedBefore);
  assert.equal(h.context.pendingDeleteConfirmNodeId, armedBefore);
  assert.equal(h.context.pendingDeleteConfirmExpiresAt, expiresBefore);
});

test("P272 existing Delete / minus / Subtract routing remains the same deleteSelected owner", () => {
  const keys = ["Delete", "-", "Subtract"];
  for (const key of keys) {
    const h = makeHarness({ query: "" });
    const event = h.keydown(key);
    assert.equal(event.defaultPrevented, true, key);
    assert.equal(h.deletes(), 1, key);
  }
});

test("P281 Backspace remains untouched outside ordinary Main keyboard ownership", () => {
  const cases = [
    { name: "Move mode", options: { moveMode: true } },
    { name: "inline editing", options: { inlineEditId: "A" } },
    { name: "blocked surface", options: { blocked: true } },
  ];

  for (const entry of cases) {
    const h = makeHarness(entry.options);
    h.keydown("Backspace");
    assert.equal(h.deletes(), 0, entry.name);
  }

  const editable = makeHarness();
  editable.target.isContentEditable = true;
  editable.keydown("Backspace");
  assert.equal(editable.deletes(), 0, "contenteditable");

  const modified = makeHarness();
  modified.keydown("Backspace", { metaKey: true });
  assert.equal(modified.deletes(), 0, "modified Backspace");
});

test("P281 source has no OS-specific routing; Backspace is inert while deliberate delete keys retain deleteSelected", () => {
  const actions = source();
  const handlerStart = actions.indexOf("function handleTreeKeydown(ev)");
  assert.ok(handlerStart >= 0);
  const handler = actions.slice(handlerStart);

  assert.doesNotMatch(handler, /navigator\.(platform|userAgent)|MacIntel|Macintosh|macOS|Windows/i);
  assert.doesNotMatch(handler, /ev\.key === "Backspace"[\s\S]{0,240}deleteSelected\(\)/);
  assert.match(handler, /ev\.key === "-" \|\| ev\.key === "Subtract" \|\| ev\.key === "Delete"/);
  assert.match(handler, /ev\.key === "Backspace"[\s\S]{0,240}ev\.preventDefault\(\);[\s\S]{0,80}return;/);
  assert.match(handler, /if \(isMainImplicitFilterBackspace\(ev\)\)/);
});
