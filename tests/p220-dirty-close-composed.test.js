"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const surfaceDependencies = require("../js/pocket-surface-dependencies.js");

const ROOT = path.resolve(__dirname, "..");
function source(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }

function createComposedPe() {
  let documentRef = null;
  const documentListeners = new Map();
  const controls = new Map();
  const counts = { close: 0, completeClose: 0, cancelPending: 0 };

  function classes(node) { return String(node?.className || "").split(/\s+/).filter(Boolean); }
  function matches(node, selector) {
    if (!node || node.nodeType !== 1) return false;
    const tokens = classes(node);
    const hasId = !!node.getAttribute?.("data-line-id");
    if (selector === ".lineText[data-line-id]") return tokens.includes("lineText") && hasId;
    if (selector === ".lineGutter[data-line-id]") return tokens.includes("lineGutter") && hasId;
    if (selector === ".lineGutter.branch[data-line-id]") return tokens.includes("lineGutter") && tokens.includes("branch") && hasId;
    if (selector === ".docRow[data-line-id]") return tokens.includes("docRow") && hasId;
    return false;
  }

  class Element {
    constructor(tagName = "div") {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this.style = {};
      this.attributes = new Map();
      this.childNodes = [];
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      this.readOnly = false;
      this.contentEditable = "false";
      this.isContentEditable = false;
      this.scrollTop = 0;
      this.scrollHeight = 600;
      this.clientHeight = 400;
      this.focusCount = 0;
      this.clickCount = 0;
      const classState = new Set();
      this.classList = {
        toggle: (name, force) => {
          const next = force === undefined ? !classState.has(name) : !!force;
          if (next) classState.add(name); else classState.delete(name);
          return next;
        },
        add: (...names) => names.forEach((name) => classState.add(name)),
        remove: (...names) => names.forEach((name) => classState.delete(name)),
        contains: (name) => classState.has(name),
      };
    }
    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
    addEventListener(type, handler, options) {
      const capture = options === true || options?.capture === true;
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ handler, capture });
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      if (child.nodeType === 1) this.children.push(child);
      return child;
    }
    removeChild(child) {
      const nodeIndex = this.childNodes.indexOf(child);
      if (nodeIndex >= 0) this.childNodes.splice(nodeIndex, 1);
      const elementIndex = this.children.indexOf(child);
      if (elementIndex >= 0) this.children.splice(elementIndex, 1);
      child.parentNode = null;
      return child;
    }
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const nodeIndex = before == null ? this.childNodes.length : this.childNodes.indexOf(before);
      const elementIndex = before == null ? this.children.length : this.children.indexOf(before);
      child.parentNode = this;
      this.childNodes.splice(nodeIndex < 0 ? this.childNodes.length : nodeIndex, 0, child);
      if (child.nodeType === 1) this.children.splice(elementIndex < 0 ? this.children.length : elementIndex, 0, child);
      return child;
    }
    contains(candidate) { return candidate === this || this.childNodes.some((child) => child.contains?.(candidate)); }
    closest(selector) {
      let current = this;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const found = [];
      const visit = (node) => {
        for (const child of node.childNodes || []) {
          if (matches(child, selector)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { this.focusCount += 1; if (documentRef) documentRef.activeElement = this; }
    select() {}
    click() { this.clickCount += 1; if (documentRef) documentRef.dispatchFrom(this, "click"); }
    dispatch(type, values = {}) { return documentRef.dispatchFrom(this, type, values); }
    getBoundingClientRect() { return { top: 100, bottom: 126, height: 26 }; }
    scrollBy(options) { this.scrollTop += Number(options?.top) || 0; }
  }

  Object.defineProperty(Element.prototype, "textContent", {
    get() { return this._textContent || ""; },
    set(value) { this._textContent = String(value == null ? "" : value); },
  });
  Object.defineProperty(Element.prototype, "firstChild", { get() { return this.childNodes[0] || null; } });
  Object.defineProperty(Element.prototype, "nextSibling", {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      const index = siblings.indexOf(this);
      return index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;
    },
  });
  Object.defineProperty(Element.prototype, "previousSibling", {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      const index = siblings.indexOf(this);
      return index > 0 ? siblings[index - 1] : null;
    },
  });

  const document = {
    activeElement: null,
    body: new Element("body"),
    getElementById(id) { return controls.get(id) || null; },
    createElement(tagName) { return new Element(tagName); },
    addEventListener(type, handler, options) {
      const capture = options === true || options?.capture === true;
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push({ handler, capture });
    },
    dispatchFrom(target, type, values = {}) {
      const event = {
        type,
        target,
        key: "",
        keyCode: 0,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; this.propagationStopped = true; },
        ...values,
      };
      const docHandlers = documentListeners.get(type) || [];
      for (const entry of docHandlers.filter((entry) => entry.capture)) {
        entry.handler(event);
        if (event.immediatePropagationStopped) return event;
      }
      if (!event.propagationStopped) {
        const path = [];
        let current = target;
        while (current) { path.push(current); current = current.parentNode; }
        for (const node of path) {
          for (const entry of (node.listeners.get(type) || []).filter((entry) => !entry.capture)) {
            entry.handler(event);
            if (event.immediatePropagationStopped) return event;
          }
          if (event.propagationStopped) break;
        }
      }
      if (!event.propagationStopped) {
        for (const entry of docHandlers.filter((entry) => !entry.capture)) {
          entry.handler(event);
          if (event.immediatePropagationStopped) return event;
        }
      }
      return event;
    },
  };
  documentRef = document;

  function control(id, tag = "div") {
    const element = new Element(tag);
    controls.set(id, element);
    return element;
  }

  const title = control("titleInput", "input");
  title.value = "P220";
  const pane = control("outlinePane", "div");
  const saveState = control("saveState", "span");
  const save = control("saveBtn", "button");
  const saveClose = control("saveCloseBtn", "button");
  const close = control("closeBtn", "button");
  const dialog = control("unsavedDialog", "div");
  const unsavedSave = control("unsavedSaveBtn", "button");
  const unsavedDiscard = control("unsavedDiscardBtn", "button");
  const unsavedCancel = control("unsavedCancelBtn", "button");
  dialog.hidden = true;

  const row = new Element("div");
  row.className = "docRow";
  row.setAttribute("data-line-id", "line_0");
  row.setAttribute("data-depth", "0");
  const gutter = new Element("button");
  gutter.className = "lineGutter empty";
  gutter.setAttribute("data-line-id", "line_0");
  const line = new Element("div");
  line.className = "lineText";
  line.setAttribute("data-line-id", "line_0");
  line.setAttribute("contenteditable", "true");
  line.contentEditable = "true";
  line.isContentEditable = true;
  line.textContent = "Alpha";
  row.appendChild(gutter);
  row.appendChild(line);
  pane.appendChild(row);

  const payload = {
    id: "p220",
    title: "P220",
    text: "Alpha",
    body: "Alpha",
    readOnly: false,
    popupOwnerToken: "owner-p220",
    popupInstanceToken: "popup-p220",
    fileSessionId: 7,
    sourceFileName: "p220-test.pocket",
    sourcePipSession: false,
    sourceOwnerKind: "json",
    sourceVaultSessionId: "",
    originalUpdatedAt: "2026-09-20T00:00:00.000Z",
  };
  const carrier = control("pocketNodePopoutPayload", "textarea");
  carrier.value = JSON.stringify(payload);

  const context = vm.createContext({
    console,
    JSON,
    Object,
    Array,
    Number,
    String,
    Math,
    Set,
    Map,
    Promise,
    Date,
    TextEncoder,
  });
  context.window = context;
  context.globalThis = context;
  context.document = document;
  context.navigator = {};
  context.requestAnimationFrame = (callback) => { if (typeof callback === "function") callback(); return 1; };
  context.setTimeout = (callback) => { if (typeof callback === "function") callback(); return 1; };
  context.alert = () => {};
  context.close = () => { counts.close += 1; };
  context.opener = {
    closed: false,
    PocketNodePopoutWindow: {
      completeCloseFromOwnedPopup(_owner, _popup, popupWindow) {
        counts.completeClose += 1;
        popupWindow.close();
        return true;
      },
      cancelPendingOpen() { counts.cancelPending += 1; },
    },
  };

  const scripts = [...surfaceDependencies.scriptsFor("pe")];
  assert.deepEqual(scripts, [
    "js/pocket-node-content.js",
    "js/pocket-node-popout-runtime.js",
    "js/pocket-node-popout-polish.js",
  ]);
  for (const script of scripts) vm.runInContext(source(script), context, { filename: script });

  function key(target, keyName, modifiers = {}) {
    return document.dispatchFrom(target, "keydown", { key: keyName, ...modifiers });
  }
  function dirtyAndOpen() {
    line.focus();
    line.dispatch("input");
    assert.equal(context.PocketNodePopoutSession.hasUnsavedChanges(), true);
    const event = key(line, "Escape");
    assert.equal(event.defaultPrevented, true);
    assert.equal(dialog.hidden, false);
    assert.equal(document.activeElement, unsavedSave);
  }

  return {
    context, document, counts, line, dialog,
    save: unsavedSave, discard: unsavedDiscard, cancel: unsavedCancel,
    key, dirtyAndOpen,
  };
}

test("P220 composed runtime+polish route owns dirty-dialog Down/Up/Enter exactly once", () => {
  const h = createComposedPe();
  h.dirtyAndOpen();
  assert.equal(h.save.focusCount, 1, "dialog opens with Save focused");

  h.key(h.save, "ArrowDown");
  assert.equal(h.document.activeElement, h.discard);
  h.key(h.discard, "ArrowDown");
  assert.equal(h.document.activeElement, h.cancel);
  h.key(h.cancel, "ArrowDown");
  assert.equal(h.document.activeElement, h.save);
  h.key(h.save, "ArrowUp");
  assert.equal(h.document.activeElement, h.cancel);
  assert.deepEqual([h.save.clickCount, h.discard.clickCount, h.cancel.clickCount], [0, 0, 0], "arrows only move focus");

  h.key(h.cancel, "ArrowDown");
  assert.equal(h.document.activeElement, h.save);
  h.key(h.save, "ArrowDown");
  assert.equal(h.document.activeElement, h.discard);
  h.key(h.discard, "Enter");

  assert.equal(h.discard.clickCount, 1, "focused Discard action invoked once");
  assert.equal(h.save.clickCount, 0);
  assert.equal(h.cancel.clickCount, 0);
  assert.equal(h.counts.completeClose, 1);
  assert.equal(h.counts.close, 1);
  assert.equal(h.context.PocketNodePopoutSession.hasUnsavedChanges(), false);
});

test("P220 composed Escape invokes Keep editing once and restores the prior editor focus", () => {
  const h = createComposedPe();
  h.dirtyAndOpen();
  assert.equal(h.document.activeElement, h.save);

  const event = h.key(h.save, "Escape");
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.cancel.clickCount, 1, "Keep editing action invoked once");
  assert.equal(h.save.clickCount, 0);
  assert.equal(h.discard.clickCount, 0);
  assert.equal(h.counts.cancelPending, 1, "no duplicate runtime Escape fire");
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.counts.close, 0, "PE remains open");
  assert.equal(h.document.activeElement, h.line, "focus returns to pre-dialog editor target");
  assert.equal(h.context.PocketNodePopoutSession.hasUnsavedChanges(), true, "Escape neither saves nor discards");
});

test("P220 closed-dialog ordinary PE Escape stays unchanged", () => {
  const h = createComposedPe();
  h.line.focus();
  assert.equal(h.context.PocketNodePopoutSession.hasUnsavedChanges(), false);
  const event = h.key(h.line, "Escape");
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.counts.close, 1, "clean PE Escape still closes");
});

test("P220 source invariant leaves dirty-dialog key meaning only in runtime", () => {
  const runtime = source("js/pocket-node-popout-runtime.js");
  const polish = source("js/pocket-node-popout-polish.js");
  assert.equal((runtime.match(/function handleUnsavedDialogKeydown\(/g) || []).length, 1);
  assert.equal((runtime.match(/document\.addEventListener\("keydown"/g) || []).length, 1);
  assert.match(runtime, /if\(handleUnsavedDialogKeydown\(ev\)\)return;/);
  assert.doesNotMatch(polish, /handleDirtyDialogKeydown|nextDialogActionIndex|unsavedDialog|unsavedSaveBtn|unsavedDiscardBtn|unsavedCancelBtn/);
});
