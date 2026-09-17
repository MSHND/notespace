"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

function installLexicalState(context, stateValue) {
  context.__pocketLexicalState = stateValue;
  vm.runInContext("const state = __pocketLexicalState; delete globalThis.__pocketLexicalState;", context);
  assert.equal(context.state, undefined, "browser-style top-level const must not become window.state");
}

test("P210 A ordinary Save resolver sees Pocket's top-level lexical state", () => {
  const calls = { capture: 0, commit: 0, save: 0 };
  const session = { id: 17, ownerKind: "json" };
  const context = vm.createContext({ console, Object });
  context.window = context;
  context.globalThis = context;
  installLexicalState(context, { inlineEdit: { id: "lexical-draft" } });
  context.capturePocketFileSaveSession = () => session;
  context.isPocketFileSaveSessionCurrent = (candidate) => candidate === session;
  context.captureActiveInlineEditForOwnerSwitch = () => {
    calls.capture += 1;
    return { ok: true, active: true, id: "lexical-draft", rawValue: "Lexical title" };
  };
  context.commitActiveInlineEditForOwnerSwitch = (_captured, options) => {
    calls.commit += 1;
    assert.equal(options.isCurrent(), true);
    return { ok: true, committed: true };
  };
  context.saveCurrentContext = () => { calls.save += 1; return "saved"; };
  context.setStatus = () => {};
  vm.runInContext(source("js/pocket-owner-save-boundary.js"), context, {
    filename: "js/pocket-owner-save-boundary.js",
  });

  assert.equal(context.saveCurrentContext(), "saved");
  assert.deepEqual(calls, { capture: 1, commit: 1, save: 1 });
});

test("P210 E/F Main travel polish sees Pocket's top-level lexical state", () => {
  const listeners = new Map();
  const scrollCalls = [];
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
    querySelector() { return row; }
    getBoundingClientRect() {
      return this.kind === "wrap"
        ? { top: 100, bottom: 500, height: 400 }
        : { top: 410, bottom: 440, height: 30 };
    }
    scrollBy(options) { scrollCalls.push(options); }
    scrollIntoView(options) { scrollCalls.push(options); }
  }

  const row = new Element("row");
  const wrap = new Element("wrap");
  const root = new Element("root");
  const stateValue = {
    selectedId: "child",
    collapsed: new Set(["child"]),
    typeJump: { lastAt: 0 },
  };
  const nodes = new Map([
    ["parent", { id: "parent", parentId: "root" }],
    ["child", { id: "child", parentId: "parent" }],
  ]);
  const context = vm.createContext({ console, Date, Object, Set });
  context.window = context;
  context.globalThis = context;
  installLexicalState(context, stateValue);
  context.HTMLElement = Element;
  context.CSS = { escape(value) { return value; } };
  context.el = { treeRoot: root, treeWrap: wrap };
  context.cleanText = (value, max) => String(value || "").trim().slice(0, max);
  context.nodeMap = () => nodes;
  context.sortNodesForParent = (id) => id === "parent" ? [{ id: "child" }] : [];
  context.scrollRowComfortably = () => {};
  context.requestAnimationFrame = (callback) => { callback(); return 1; };
  context.document = {
    addEventListener(type, handler, capture) { listeners.set(`${type}:${capture === true}`, handler); },
  };
  vm.runInContext(source("js/pocket-scroll-polish.js"), context, {
    filename: "js/pocket-scroll-polish.js",
  });

  const keydown = listeners.get("keydown:true");
  keydown({ key: "ArrowLeft", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null });
  stateValue.selectedId = "parent";
  context.focusRowByNodeId("parent");
  assert.equal(scrollCalls.at(-1).behavior, "smooth");

  scrollCalls.length = 0;
  stateValue.selectedId = "child";
  stateValue.typeJump.lastAt = Date.now();
  context.focusRowByNodeId("child");
  assert.equal(scrollCalls.at(-1).behavior, "auto");
});
