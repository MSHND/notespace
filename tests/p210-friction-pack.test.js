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

function loadOwnerSaveHarness(options = {}) {
  const calls = { capture: 0, commit: 0, save: 0, status: 0 };
  const session = { id: 41, ownerKind: "json" };
  let sessionCurrent = options.sessionCurrent !== false;
  const context = vm.createContext({ console, Object });
  context.window = context;
  context.globalThis = context;
  context.state = { inlineEdit: { id: options.inlineId === undefined ? "draft" : options.inlineId } };
  context.capturePocketFileSaveSession = () => session;
  context.isPocketFileSaveSessionCurrent = (candidate) => candidate === session && sessionCurrent;
  context.captureActiveInlineEditForOwnerSwitch = () => {
    calls.capture += 1;
    return options.captured === undefined
      ? { ok: true, active: true, id: "draft", rawValue: options.value || "Draft title" }
      : options.captured;
  };
  context.commitActiveInlineEditForOwnerSwitch = (captured, commitOptions) => {
    calls.commit += 1;
    assert.equal(commitOptions.isCurrent(), true);
    if (options.staleAfterCommit) sessionCurrent = false;
    return options.committed === undefined
      ? { ok: true, committed: true, id: captured.id }
      : options.committed;
  };
  context.saveCurrentContext = () => { calls.save += 1; return "saved"; };
  context.setStatus = () => { calls.status += 1; };
  vm.runInContext(source("js/pocket-owner-save-boundary.js"), context, {
    filename: "js/pocket-owner-save-boundary.js",
  });
  return { context, calls };
}

test("P210 A valid Main draft commits canonically once, then runs the unchanged ordinary Save", () => {
  for (const value of ["New item", "Renamed item"]) {
    const { context, calls } = loadOwnerSaveHarness({ value });
    assert.equal(context.saveCurrentContext(), "saved");
    assert.deepEqual(calls, { capture: 1, commit: 1, save: 1, status: 0 });
  }
});

test("P210 A blank/invalid, ambiguous and failed commits fail closed before truth Save", () => {
  const refused = [
    { captured: { ok: false, active: true, reason: "blank-title" } },
    { captured: { ok: true, active: false } },
    { committed: { ok: false, active: true, reason: "commit-failed" } },
    { staleAfterCommit: true },
  ];
  for (const options of refused) {
    const { context, calls } = loadOwnerSaveHarness(options);
    assert.equal(context.saveCurrentContext(), false);
    assert.equal(calls.save, 0);
    assert.equal(calls.status, 1);
  }
});

test("P210 A no active Main draft leaves ordinary Save unchanged", () => {
  const { context, calls } = loadOwnerSaveHarness({ inlineId: "" });
  assert.equal(context.saveCurrentContext(), "saved");
  assert.deepEqual(calls, { capture: 0, commit: 0, save: 1, status: 0 });
});

test("P210 A Save button and routed Save action still share saveCurrentContext after resolver installation", () => {
  const index = source("index.html");
  const overlays = source("js/pocket-overlays-init.js");
  assert.ok(index.indexOf("js/pocket-owner-save-boundary.js") < index.indexOf("js/pocket-overlays-init.js"));
  assert.match(overlays, /btnExportTree\.addEventListener\("click", saveCurrentContext\)/);
  assert.match(overlays, /action === "save"\) saveCurrentContext\(\)/);
  const owner = source("js/pocket-owner-save-boundary.js");
  assert.match(owner, /commitActiveInlineEditForOwnerSwitch\(captured/);
  assert.doesNotMatch(owner, /insertSiblingBelow|insertChildUnder|renameNodeById|dispatchEvent|KeyboardEvent/);
});

function loadPePolish() {
  const context = vm.createContext({ console, JSON, Object, Array, Number, String, Math });
  context.window = context;
  context.globalThis = context;
  context.document = null;
  context.setTimeout = (callback) => { if (typeof callback === "function") callback(); return 1; };
  vm.runInContext(source("js/pocket-node-popout-polish.js"), context, {
    filename: "js/pocket-node-popout-polish.js",
  });
  return context.PocketNodePopoutPolish;
}

test("P210 B opening-focus policy sends titled PE straight to body and untitled PE to title", () => {
  const polish = loadPePolish();
  assert.equal(polish.openingFocusTarget({ title: "Existing", readOnly: false }), "body");
  assert.equal(polish.openingFocusTarget({ title: "  ", readOnly: false }), "title");
  assert.equal(polish.openingFocusTarget({ title: "", readOnly: false }), "title");
  assert.equal(polish.openingFocusTarget({ title: "Existing", readOnly: true }), "none");

  const template = source("js/pocket-node-popout-template.js");
  const runtimeIndex = template.indexOf("${runtimeAssetUrl}");
  const polishIndex = template.indexOf("${polishAssetUrl}");
  assert.ok(runtimeIndex >= 0 && polishIndex > runtimeIndex, "polish must run synchronously after native runtime");
  assert.match(template, /pocket-node-popout-polish\.js/);
  assert.doesNotMatch(source("js/pocket-node-popout-editor.js"), /pocket-node-popout-polish/);
  assert.doesNotMatch(source("js/pocket-node-popout-window.js"), /focusOpeningSurface/);
});

test("P210 C comfort scroll is bounded and zero while the caret is comfortably visible", () => {
  const polish = loadPePolish();
  const pane = { top: 100, bottom: 500 };
  assert.equal(polish.comfortScrollDelta(pane, { top: 220, bottom: 238 }, 30), 0);
  assert.equal(polish.comfortScrollDelta(pane, { top: 90, bottom: 108 }, 30), -40);
  assert.equal(polish.comfortScrollDelta(pane, { top: 490, bottom: 510 }, 30), 40);
});

function fakeButton(id) {
  return {
    id,
    hidden: false,
    disabled: false,
    focusCount: 0,
    clickCount: 0,
    focus() { this.focusCount += 1; },
    click() { this.clickCount += 1; },
  };
}

test("P210 D dirty-close arrows move among existing commands; Enter/Escape invoke those exact buttons", () => {
  const polish = loadPePolish();
  const save = fakeButton("unsavedSaveBtn");
  const discard = fakeButton("unsavedDiscardBtn");
  const keep = fakeButton("unsavedCancelBtn");
  const dialog = { hidden: false };
  const controls = new Map([
    ["unsavedDialog", dialog],
    ["unsavedSaveBtn", save],
    ["unsavedDiscardBtn", discard],
    ["unsavedCancelBtn", keep],
  ]);
  const doc = {
    activeElement: save,
    getElementById(id) { return controls.get(id) || null; },
  };
  function event(key) {
    return {
      key,
      prevented: 0,
      stopped: 0,
      preventDefault() { this.prevented += 1; },
      stopImmediatePropagation() { this.stopped += 1; },
    };
  }

  let ev = event("ArrowDown");
  assert.equal(polish.handleDirtyDialogKeydown(ev, doc), true);
  assert.equal(discard.focusCount, 1);
  doc.activeElement = discard;
  ev = event("Enter");
  assert.equal(polish.handleDirtyDialogKeydown(ev, doc), true);
  assert.equal(discard.clickCount, 1);
  doc.activeElement = save;
  ev = event("ArrowUp");
  assert.equal(polish.handleDirtyDialogKeydown(ev, doc), true);
  assert.equal(keep.focusCount, 1);
  ev = event("Escape");
  assert.equal(polish.handleDirtyDialogKeydown(ev, doc), true);
  assert.equal(keep.clickCount, 1);
  assert.equal(save.clickCount, 0, "polish never substitutes its own Save command");
});

function row(depth) {
  return { getAttribute(name) { return name === "data-depth" ? String(depth) : null; } };
}

test("P210 E PE parent resolver identifies the nearest structural parent without changing content", () => {
  const polish = loadPePolish();
  const rows = [row(0), row(1), row(2), row(2), row(1), row(0)];
  assert.equal(polish.parentRowIndex(rows, 3), 1);
  assert.equal(polish.parentRowIndex(rows, 4), 0);
  assert.equal(polish.parentRowIndex(rows, 5), -1);
  const polishSource = source("js/pocket-node-popout-polish.js");
  assert.match(polishSource, /gutter\.click\?\.\(\)/);
  assert.match(polishSource, /parentText\.click\?\.\(\)/);
  assert.doesNotMatch(polishSource, /recordOp|applyAndSave|buildPocketPayload|PocketOwnerSaveBoundary/);
});

function loadMainScrollHarness() {
  const listeners = new Map();
  const scrollCalls = [];
  const comfortableCalls = [];
  let activeRowId = "";

  class Element {
    constructor(kind) {
      this.kind = kind;
      this.tagName = "DIV";
      this.isContentEditable = false;
      this.scrollTop = 100;
      this.scrollHeight = 1200;
      this.clientHeight = 400;
    }
    focus() {}
    getBoundingClientRect() {
      if (this.kind === "wrap") return { top: 100, bottom: 500, height: 400 };
      return { top: 410, bottom: 440, height: 30 };
    }
    scrollBy(options) { scrollCalls.push(options); }
    scrollIntoView(options) { scrollCalls.push(options); }
    querySelector(selector) {
      const match = String(selector).match(/data-node-id=\"([^\"]+)/);
      activeRowId = match ? match[1] : activeRowId;
      return rowElement;
    }
  }

  const rowElement = new Element("row");
  const wrapElement = new Element("wrap");
  const rootElement = new Element("root");
  const nodes = new Map([
    ["parent", { id: "parent", parentId: "root" }],
    ["child", { id: "child", parentId: "parent" }],
  ]);
  const state = {
    selectedId: "child",
    typeJump: { lastAt: 0 },
    collapsed: new Set(["child"]),
  };
  const context = vm.createContext({ console, Date, Object, Set });
  context.window = context;
  context.globalThis = context;
  context.HTMLElement = Element;
  context.CSS = { escape(value) { return value; } };
  context.el = { treeRoot: rootElement, treeWrap: wrapElement };
  context.state = state;
  context.cleanText = (value, max) => String(value || "").trim().slice(0, max);
  context.nodeMap = () => nodes;
  context.sortNodesForParent = (id) => id === "parent" ? [{ id: "child" }] : [];
  context.scrollRowComfortably = (_row, options) => comfortableCalls.push(options || {});
  context.requestAnimationFrame = (callback) => { callback(); return 1; };
  context.document = {
    addEventListener(type, handler, capture) { listeners.set(`${type}:${capture === true}`, handler); },
  };
  vm.runInContext(source("js/pocket-scroll-polish.js"), context, {
    filename: "js/pocket-scroll-polish.js",
  });
  return { context, state, listeners, scrollCalls, comfortableCalls, getActiveRowId: () => activeRowId };
}

test("P210 E Main plain Left centres only on a real child-to-parent selection change", () => {
  const h = loadMainScrollHarness();
  const keydown = h.listeners.get("keydown:true");
  assert.equal(typeof keydown, "function");
  keydown({ key: "ArrowLeft", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null });
  h.state.selectedId = "parent";
  h.context.focusRowByNodeId("parent");
  assert.equal(h.scrollCalls.length, 1);
  assert.equal(h.scrollCalls[0].behavior, "smooth");

  h.scrollCalls.length = 0;
  h.comfortableCalls.length = 0;
  h.state.selectedId = "parent";
  h.state.collapsed.delete("parent");
  keydown({ key: "ArrowLeft", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null });
  h.context.focusRowByNodeId("parent");
  assert.equal(h.scrollCalls.length, 0, "collapse-only Left must not soft-centre");
  assert.equal(h.comfortableCalls.length, 1, "ordinary visibility path remains intact");
});

test("P210 F type-ahead preserves selection semantics and changes only viewport timing to direct travel", () => {
  const h = loadMainScrollHarness();
  h.state.selectedId = "child";
  h.state.typeJump.lastAt = Date.now();
  h.context.focusRowByNodeId("child");
  assert.equal(h.scrollCalls.length, 1);
  assert.equal(h.scrollCalls[0].behavior, "auto");
  assert.equal(h.state.selectedId, "child");
  assert.equal(h.comfortableCalls.length, 0);
  const treeActions = source("js/pocket-tree-actions.js");
  assert.match(treeActions, /function jumpSelectionByTypedChar\(/);
  assert.doesNotMatch(source("js/pocket-scroll-polish.js"), /jumpSelectionByTypedChar\s*=|typeJump\.buffer\s*=|state\.selectedId\s*=/);
});

test("P210 preserves P209 native vertical caret owner and avoids duplicate Up/Down handling in the polish layer", () => {
  const runtime = source("js/pocket-node-popout-runtime.js");
  const polish = source("js/pocket-node-popout-polish.js");
  assert.match(runtime, /schedulePlainVerticalCaretBridge/);
  assert.match(runtime, /ev\.key===\"ArrowUp\"\|\|ev\.key===\"ArrowDown\"/);
  assert.doesNotMatch(polish, /schedulePlainVerticalCaretBridge/);
  assert.doesNotMatch(polish, /ev\.key === "ArrowUp".*lineText|ev\.key === "ArrowDown".*lineText/);
});
