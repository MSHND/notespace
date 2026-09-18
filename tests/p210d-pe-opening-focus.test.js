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

function listenerStore() {
  const entries = [];
  return {
    add(type, handler, options) {
      entries.push({ type, handler, once: options === true ? false : options?.once === true });
    },
    remove(type, handler) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].type === type && entries[index].handler === handler) entries.splice(index, 1);
      }
    },
    fire(type, event = {}) {
      const current = entries.filter((entry) => entry.type === type);
      for (const entry of current) {
        entry.handler(event);
        if (entry.once) this.remove(type, entry.handler);
      }
    },
    count(type) {
      return entries.filter((entry) => entry.type === type).length;
    },
  };
}

function loadStartupHarness(payload, options = {}) {
  const windowEvents = listenerStore();
  const documentEvents = listenerStore();
  const calls = { ownerLoad: 0, titleFocus: 0, titleSelect: 0, bodyFocus: 0 };
  const userSurface = { id: "userSurface" };
  let doc;

  const title = {
    id: "titleInput",
    focus() { calls.titleFocus += 1; doc.activeElement = title; },
    select() { calls.titleSelect += 1; },
  };
  const body = {
    id: "line_0",
    focus() { calls.bodyFocus += 1; doc.activeElement = body; },
  };
  const pane = {
    id: "outlinePane",
    querySelector(selector) {
      return selector === ".lineText[data-line-id]" ? body : null;
    },
    addEventListener() {},
  };
  const dialog = { id: "unsavedDialog", hidden: true };
  const carrier = {
    id: "pocketNodePopoutPayload",
    tagName: "TEXTAREA",
    value: JSON.stringify(payload),
  };
  const elements = new Map([
    ["titleInput", title],
    ["outlinePane", pane],
    ["unsavedDialog", dialog],
    ["pocketNodePopoutPayload", carrier],
  ]);

  doc = {
    readyState: options.readyState || "loading",
    activeElement: payload.readOnly === true ? userSurface : title,
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, handler, capture) { documentEvents.add(type, handler, capture); },
    removeEventListener(type, handler) { documentEvents.remove(type, handler); },
  };

  const context = vm.createContext({ console, JSON, Object, Array, Number, String, Math, Set });
  context.window = context;
  context.globalThis = context;
  context.document = doc;
  context.getSelection = () => null;
  context.requestAnimationFrame = () => 1;
  context.setTimeout = () => 1;
  context.addEventListener = (type, handler, optionsValue) => windowEvents.add(type, handler, optionsValue);
  context.removeEventListener = (type, handler) => windowEvents.remove(type, handler);
  doc.defaultView = context;

  windowEvents.add("load", () => {
    calls.ownerLoad += 1;
    if (options.ownerRestoresTitle === true) doc.activeElement = title;
  });

  vm.runInContext(source("js/pocket-node-popout-polish.js"), context, {
    filename: "js/pocket-node-popout-polish.js",
  });

  return {
    polish: context.PocketNodePopoutPolish,
    calls,
    doc,
    title,
    body,
    userSurface,
    fireLoad() { windowEvents.fire("load"); },
    fireDocument(type, event = {}) { documentEvents.fire(type, event); },
    loadListenerCount() { return windowEvents.count("load"); },
  };
}

test("P210d titled editable popup finishes real startup body-first after earlier owner load focus", () => {
  const h = loadStartupHarness({ title: "Existing", readOnly: false }, { ownerRestoresTitle: true });
  assert.equal(h.doc.activeElement, h.title, "native startup still begins title-first");
  assert.equal(h.calls.bodyFocus, 0, "polish must wait for the real startup boundary");

  h.fireLoad();

  assert.equal(h.calls.ownerLoad, 1);
  assert.equal(h.doc.activeElement, h.body);
  assert.equal(h.calls.bodyFocus, 1);

  h.fireLoad();
  assert.equal(h.calls.bodyFocus, 1, "opening focus runs at most once");
});

test("P210d genuinely untitled editable popup finishes startup title-first", () => {
  const h = loadStartupHarness({ title: "   ", readOnly: false }, { ownerRestoresTitle: true });
  h.fireLoad();
  assert.equal(h.doc.activeElement, h.title);
  assert.equal(h.calls.bodyFocus, 0);
  assert.equal(h.calls.titleFocus, 1);
  assert.equal(h.calls.titleSelect, 1);
});

test("P210d read-only popup receives no opening-focus override", () => {
  const h = loadStartupHarness({ title: "Existing", readOnly: true });
  const before = h.doc.activeElement;
  h.fireLoad();
  assert.equal(h.doc.activeElement, before);
  assert.equal(h.calls.titleFocus, 0);
  assert.equal(h.calls.bodyFocus, 0);
});

test("P210d user interaction before deferred opening focus is never overwritten", () => {
  const h = loadStartupHarness({ title: "Existing", readOnly: false });
  h.doc.activeElement = h.userSurface;
  h.fireDocument("pointerdown", { target: h.userSurface });
  h.fireLoad();
  assert.equal(h.doc.activeElement, h.userSurface);
  assert.equal(h.calls.bodyFocus, 0);
  assert.equal(h.calls.titleFocus, 0);
});

test("P210d repair remains presentation-only and binds once to startup readiness", () => {
  const polish = source("js/pocket-node-popout-polish.js");
  assert.match(polish, /installOpeningFocus\(doc, payloadFromDocument\(doc\), global\)/);
  assert.match(polish, /addEventListener\("load", finishOpeningFocus, \{ once: true \}\)/);
  assert.doesNotMatch(polish, /setInterval|MutationObserver|applyAndSave|recordOp|buildPocketPayload/);

  const runtime = source("js/pocket-node-popout-runtime.js");
  assert.match(runtime, /PocketNodePopoutRuntime=Object\.freeze\(\{initialise\}\)/);
  assert.match(runtime, /titleInput\.focus\?\.\(\); titleInput\.select\?\.\(\);/);
});
