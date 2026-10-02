"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const HELPER = path.join(ROOT, "js/pocket-enter-copy-only.js");

function source() {
  return fs.readFileSync(HELPER, "utf8");
}

function makeElement(document, tagName = "div") {
  const listeners = new Map();
  const children = [];
  const element = {
    ownerDocument: document,
    tagName: String(tagName).toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    type: "",
    disabled: false,
    children,
    parentNode: null,
    setAttribute(name, value) {
      this[name] = String(value);
    },
    addEventListener(type, callback) {
      const key = String(type);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(callback);
    },
    appendChild(child) {
      child.parentNode = this;
      children.push(child);
      return child;
    },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    },
    focus() {
      document.activeElement = this;
    },
    click() {
      for (const callback of listeners.get("click") || []) {
        callback({ target: this });
      }
    },
    listenerCount(type) {
      return (listeners.get(String(type)) || []).length;
    },
  };
  return element;
}

function makeDocument() {
  const byId = new Map();
  const document = {
    activeElement: null,
    head: null,
    body: null,
    createElement(tagName) {
      return makeElement(document, tagName);
    },
    getElementById(id) {
      if (byId.has(String(id))) return byId.get(String(id));
      const queue = [document.head, document.body].filter(Boolean);
      while (queue.length) {
        const node = queue.shift();
        if (node.id === id) {
          byId.set(String(id), node);
          return node;
        }
        queue.push(...(node.children || []));
      }
      return null;
    },
    addEventListener() {},
  };
  document.head = makeElement(document, "head");
  document.body = makeElement(document, "body");
  return document;
}

function makePopup(name) {
  const document = makeDocument();
  const keydown = [];
  document.addEventListener = (type, callback) => {
    if (type === "keydown") keydown.push(callback);
  };
  const popup = {
    name,
    closed: false,
    document,
    __pocketPeDirty: false,
    __pocketPeEscCloseInstalled: false,
    closeCount: 0,
    close() {
      this.closeCount += 1;
    },
    setInterval() {
      throw new Error("save polling should not run in this proof");
    },
    clearInterval() {},
  };
  popup.dispatchEscape = () => {
    const event = {
      key: "Escape",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    for (const callback of keydown) callback(event);
    return event;
  };
  popup.keydownListenerCount = () => keydown.length;
  return popup;
}

function makeHarness() {
  const mainDocument = makeDocument();
  const popups = [];
  let originalOpenCalls = 0;

  const context = {
    document: mainDocument,
    console: { info() {} },
    String,
    Object,
    Array,
    Boolean,
    Number,
    Error,
    Map,
    Set,
    Promise,
    open(...args) {
      originalOpenCalls += 1;
      const popup = makePopup(String(args[1] || ""));
      popups.push(popup);
      return popup;
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  return {
    context,
    mainDocument,
    popups,
    originalOpenCalls: () => originalOpenCalls,
    run() {
      vm.runInContext(source(), context, { filename: "js/pocket-enter-copy-only.js" });
    },
  };
}

test("P320 runtime helper contains only live Move-display and PE-Escape responsibilities", () => {
  const helper = source();
  const retired = [
    "clean",
    "isEditableTarget",
    "isOpenElement",
    "hasOpenEnterOwningLayer",
    "shouldIgnoreEnterTarget",
    "selectedNodeWithKids",
    "copyContextRootIdForEnter",
    "shouldCopyOnEnter",
    "copySelectedNodeIfAppropriate",
    "openSelectedPe",
    "handleEnter",
  ];
  for (const name of retired) {
    assert.doesNotMatch(helper, new RegExp(`\\bfunction\\s+${name}\\s*\\(`), name + " is retired");
  }

  assert.match(helper, /function installMoveDisplayGuard\(\)/);
  assert.match(helper, /function installPeEscCloseGuard\(\)/);
  assert.equal((helper.match(/installMoveDisplayGuard\(\);/g) || []).length, 1);
  assert.equal((helper.match(/installPeEscCloseGuard\(\);/g) || []).length, 1);
  assert.doesNotMatch(helper, /Enter capture disabled/);
});

test("P320 PE Escape guard patches global.open once and installs one Escape owner per simple PE", () => {
  const h = makeHarness();
  h.run();
  const patchedOpen = h.context.open;
  assert.equal(h.context.__pocketPeEscCloseGuardInstalled, true);

  h.run();
  assert.equal(h.context.open, patchedOpen, "second script evaluation does not wrap global.open again");

  const popup = h.context.open("about:blank", "pocketSimplePe_nodeA");
  assert.equal(h.originalOpenCalls(), 1);
  assert.equal(popup.__pocketPeEscCloseInstalled, true);
  assert.equal(popup.keydownListenerCount(), 1, "three install timers converge on one Escape listener");
});

test("P320 PE Escape guard preserves clean close and dirty unsaved-choice behaviour", () => {
  const h = makeHarness();
  h.run();

  const clean = h.context.open("about:blank", "pocketSimplePe_clean");
  const cleanEvent = clean.dispatchEscape();
  assert.equal(cleanEvent.defaultPrevented, true);
  assert.equal(cleanEvent.propagationStopped, true);
  assert.equal(clean.closeCount, 1);
  assert.equal(clean.document.getElementById("peUnsavedChoice"), null);

  const dirty = h.context.open("about:blank", "pocketSimplePe_dirty");
  dirty.__pocketPeDirty = true;
  const dirtyEvent = dirty.dispatchEscape();
  assert.equal(dirtyEvent.defaultPrevented, true);
  assert.equal(dirtyEvent.propagationStopped, true);
  assert.equal(dirty.closeCount, 0, "dirty Escape does not close before a user choice");
  const choice = dirty.document.getElementById("peUnsavedChoice");
  assert.ok(choice, "dirty Escape enters the existing unsaved-choice path");
  assert.equal(choice.role, "dialog");
  assert.equal(choice["aria-modal"], "true");
  assert.equal(dirty.document.activeElement?.textContent, "Save and close");
});
