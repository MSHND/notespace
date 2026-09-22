"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = "js/pocket-node-popout-runtime.js";
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function classList() {
  const names = new Set();
  return {
    add(...values) { values.forEach((value) => names.add(value)); },
    remove(...values) { values.forEach((value) => names.delete(value)); },
    contains(value) { return names.has(value); },
    toggle(value, present) {
      const next = present === undefined ? !names.has(value) : !!present;
      if (next) names.add(value); else names.delete(value);
      return next;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createRuntime() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(source("js/pocket-node-content.js"), context);
  vm.runInContext(source(RUNTIME), context);

  const contentApi = context.window.PocketNodeContent;
  const controls = new Map();
  const documentListeners = new Map();
  const alerts = [];
  const saveCalls = [];
  const pendingSaves = [];
  const counts = { close: 0, completeClose: 0, cancelPending: 0, timeout: 0 };
  let documentRef = null;

  class Element {
    constructor(tag = "div") {
      this.tagName = String(tag).toUpperCase();
      this.nodeType = 1;
      this.className = "";
      this.style = {};
      this.children = [];
      this.childNodes = this.children;
      this.parentNode = null;
      this.listeners = new Map();
      this.attrs = new Map();
      this.textContent = "";
      this.value = "";
      this.hidden = false;
      this.disabled = false;
      this.readOnly = false;
      this.contentEditable = "false";
      this.classList = classList();
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = before == null ? this.children.length : this.children.indexOf(before);
      child.parentNode = this;
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      return child;
    }
    setAttribute(name, value) { this.attrs.set(String(name), String(value)); }
    getAttribute(name) { return this.attrs.has(String(name)) ? this.attrs.get(String(name)) : null; }
    contains(candidate) { return candidate === this || this.children.some((child) => child.contains?.(candidate)); }
    closest(selector) {
      let current = this;
      while (current) {
        const tokens = String(current.className || "").split(/\s+/);
        if (selector === ".lineText[data-line-id]" && tokens.includes("lineText") && current.getAttribute("data-line-id")) return current;
        if (selector === ".lineGutter[data-line-id]" && tokens.includes("lineGutter") && current.getAttribute("data-line-id")) return current;
        if (selector === ".docRow[data-line-id]" && tokens.includes("docRow") && current.getAttribute("data-line-id")) return current;
        current = current.parentNode;
      }
      return null;
    }
    focus() { documentRef.activeElement = this; }
    click() { this.dispatch("click"); }
    dispatch(type, values = {}) {
      const event = makeEvent(this, type, values);
      for (const handler of this.listeners.get(type) || []) {
        handler(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    }
  }

  Object.defineProperty(Element.prototype, "innerHTML", {
    get() { return ""; },
    set() { this.children.length = 0; },
  });
  Object.defineProperty(Element.prototype, "firstChild", { get() { return this.children[0] || null; } });
  Object.defineProperty(Element.prototype, "nextSibling", {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      const index = siblings.indexOf(this);
      return index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;
    },
  });
  Object.defineProperty(Element.prototype, "previousSibling", {
    get() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children;
      const index = siblings.indexOf(this);
      return index > 0 ? siblings[index - 1] : null;
    },
  });

  function makeEvent(target, type, values = {}) {
    return {
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
  }

  const document = {
    activeElement: null,
    body: new Element("body"),
    getElementById(id) { return controls.get(id) || null; },
    createElement(tag) { return new Element(tag); },
    createRange() { return null; },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
  };
  documentRef = document;

  function control(id, tag = "div") {
    const item = new Element(tag);
    controls.set(id, item);
    return item;
  }

  const titleInput = control("titleInput", "input");
  titleInput.value = "P258";
  const pane = control("outlinePane", "div");
  control("saveState", "span");
  control("saveBtn", "button");
  control("saveCloseBtn", "button");
  control("closeBtn", "button");
  const dialog = control("unsavedDialog", "div");
  dialog.hidden = true;
  control("unsavedSaveBtn", "button");
  control("unsavedDiscardBtn", "button");
  control("unsavedCancelBtn", "button");

  const row = new Element("div");
  row.className = "docRow";
  row.setAttribute("data-line-id", "line_0");
  const gutter = new Element("button");
  gutter.className = "lineGutter empty";
  gutter.setAttribute("data-line-id", "line_0");
  const line = new Element("div");
  line.className = "lineText";
  line.setAttribute("data-line-id", "line_0");
  line.textContent = "Before";
  row.appendChild(gutter);
  row.appendChild(line);
  pane.appendChild(row);

  const window = {
    addEventListener() {},
    setTimeout(callback, ms) { counts.timeout += 1; callback(); return ms || 1; },
    close() { counts.close += 1; },
    opener: {
      closed: false,
      PocketNodePopoutWindow: {
        applyAndSaveFromOwnedPopup(_owner, _popup, outgoing) {
          saveCalls.push(JSON.parse(JSON.stringify(outgoing)));
          const pending = deferred();
          pendingSaves.push(pending);
          return pending.promise;
        },
        completeCloseFromOwnedPopup(_owner, _popup, popupWindow) {
          counts.completeClose += 1;
          popupWindow.close();
          return true;
        },
        cancelPendingOpen() { counts.cancelPending += 1; },
      },
    },
  };

  const payload = {
    id: "p258",
    title: "P258",
    text: "Before",
    body: "Before",
    readOnly: false,
    fileSessionId: 7,
    sourceFileName: "p258.pocket",
    sourcePipSession: false,
    sourceOwnerKind: "json",
    sourceVaultSessionId: "",
    originalUpdatedAt: "2026-09-22T00:00:00.000Z",
    popupOwnerToken: "owner-p258",
    popupInstanceToken: "popup-p258",
  };

  assert.equal(context.window.PocketNodePopoutRuntime.initialise(payload, {
    window,
    document,
    content: contentApi,
    navigator: {},
    requestAnimationFrame(callback) { callback(); return 1; },
    alert(message) { alerts.push(message); },
    console,
  }), true);

  function documentKey(key, modifiers = {}) {
    const event = makeEvent(document.activeElement || line, "keydown", { key, ...modifiers });
    for (const handler of documentListeners.get("keydown") || []) {
      handler(event);
      if (event.immediatePropagationStopped) break;
    }
    return event;
  }
  function mutate(text = "Edited") {
    line.textContent = text;
    pane.dispatch("input", { target: line });
  }
  function saveShortcut() { return documentKey("s", { ctrlKey: true }); }
  function escape() { return documentKey("Escape"); }
  function settle() { return new Promise((resolve) => setImmediate(() => setImmediate(resolve))); }
  function success() { return { ok: true, exported: true, applied: true }; }

  return {
    context, controls, line, pane, dialog, alerts, saveCalls, pendingSaves, counts,
    mutate, saveShortcut, escape, settle, success, documentKey,
  };
}

test("P258 covered Ctrl+S then immediate Escape attaches close to the same one in-flight save", async () => {
  const app = createRuntime();
  app.mutate("Generation N");
  assert.equal(app.context.window.PocketNodePopoutSession.hasUnsavedChanges(), true);

  const saveEvent = app.saveShortcut();
  assert.equal(saveEvent.defaultPrevented, true);
  assert.equal(app.saveCalls.length, 1);
  assert.equal(app.pendingSaves.length, 1);

  const escapeEvent = app.escape();
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(app.dialog.hidden, true);
  assert.equal(app.counts.close, 0);
  assert.equal(app.counts.completeClose, 0);
  assert.equal(app.saveCalls.length, 1, "Escape must not start a second save");

  app.pendingSaves[0].resolve(app.success());
  await app.settle();

  assert.equal(app.counts.completeClose, 1);
  assert.equal(app.counts.close, 1);
  assert.equal(app.context.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
});

test("P258 newer edit before Escape uses normal dirty protection and old save cannot close it", async () => {
  const app = createRuntime();
  app.mutate("Generation N");
  app.saveShortcut();
  app.mutate("Generation N+1");

  app.escape();
  assert.equal(app.dialog.hidden, false);
  assert.equal(app.counts.close, 0);
  assert.equal(app.saveCalls.length, 1);

  app.pendingSaves[0].resolve(app.success());
  await app.settle();

  assert.equal(app.counts.close, 0);
  assert.equal(app.counts.completeClose, 0);
  assert.equal(app.context.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(app.controls.get("saveState").textContent, "earlier changes saved — newer edits remain");
});

test("P258 edit after Escape queues close invalidates the queued close before older save settles", async () => {
  const app = createRuntime();
  app.mutate("Generation N");
  app.saveShortcut();
  app.escape();
  assert.equal(app.dialog.hidden, true);

  app.mutate("Generation N+1");
  app.pendingSaves[0].resolve(app.success());
  await app.settle();

  assert.equal(app.counts.close, 0);
  assert.equal(app.counts.completeClose, 0);
  assert.equal(app.context.window.PocketNodePopoutSession.hasUnsavedChanges(), true);

  app.escape();
  assert.equal(app.dialog.hidden, false);
});

test("P258 failed in-flight save after Escape stays open/dirty, preserves feedback, and later Escape protects", async () => {
  const app = createRuntime();
  app.mutate("Generation N");
  app.saveShortcut();
  app.escape();

  app.pendingSaves[0].resolve({
    ok: false,
    exported: false,
    reason: "external-file-changed",
  });
  await app.settle();

  assert.equal(app.counts.close, 0);
  assert.equal(app.context.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(app.controls.get("saveState").textContent, "Pocket changed elsewhere — not saved");
  assert.deepEqual(app.alerts, ["This Pocket changed elsewhere. Your changes are still here."]);

  app.escape();
  assert.equal(app.dialog.hidden, false);
});

test("P258 ordinary Escape stays unchanged for dirty and clean PE", () => {
  const dirty = createRuntime();
  dirty.mutate("Dirty");
  dirty.escape();
  assert.equal(dirty.dialog.hidden, false);
  assert.equal(dirty.counts.close, 0);

  const clean = createRuntime();
  clean.escape();
  assert.equal(clean.dialog.hidden, true);
  assert.equal(clean.counts.close, 1);
});

test("P258 unsaved-dialog Escape still cancels dialog and keeps dirty editor open", () => {
  const app = createRuntime();
  app.mutate("Dirty");
  app.escape();
  assert.equal(app.dialog.hidden, false);

  app.escape();
  assert.equal(app.dialog.hidden, true);
  assert.equal(app.counts.close, 0);
  assert.equal(app.context.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
});

test("P258 existing Save & Close still waits for success and generation mismatch still refuses close", async () => {
  const success = createRuntime();
  success.mutate("Save close");
  success.controls.get("saveCloseBtn").dispatch("click");
  assert.equal(success.saveCalls.length, 1);
  assert.equal(success.counts.close, 0);
  success.pendingSaves[0].resolve(success.success());
  await success.settle();
  assert.equal(success.counts.completeClose, 1);
  assert.equal(success.counts.close, 1);
  assert.equal(success.context.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  const mismatch = createRuntime();
  mismatch.mutate("Generation N");
  mismatch.controls.get("saveCloseBtn").dispatch("click");
  mismatch.mutate("Generation N+1");
  mismatch.pendingSaves[0].resolve(mismatch.success());
  await mismatch.settle();
  assert.equal(mismatch.counts.close, 0);
  assert.equal(mismatch.counts.completeClose, 0);
  assert.equal(mismatch.context.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
});

test("P258 close settlement is generation-owned, not a new timer/poll/save owner", () => {
  const runtime = source(RUNTIME);
  const start = runtime.indexOf("function closeSafely()");
  const end = runtime.indexOf("\n\n    seedPresentationIndex", start);
  assert.ok(start >= 0 && end > start);
  const closeOwner = runtime.slice(start, end);

  assert.match(runtime, /saveGeneration = generation/);
  assert.match(runtime, /closeAfterSaveGeneration === generation && editGeneration === generation/);
  assert.match(closeOwner, /saveInFlight && saveGeneration === editGeneration/);
  assert.match(closeOwner, /closeAfterSaveGeneration = saveGeneration/);
  assert.doesNotMatch(closeOwner, /setTimeout|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(closeOwner, /\bsave\s*\(/);
  assert.equal((runtime.match(/window\.setTimeout\(function \(\) \{ window\.close\(\); \}, 80\)/g) || []).length, 1,
    "only the pre-existing successful-close fallback timer remains");
});
