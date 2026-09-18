"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const surfaceDependencies = require("../js/pocket-surface-dependencies.js");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    toggle(name, force) {
      const next = force === undefined ? !values.has(name) : !!force;
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
    contains(name) { return values.has(name); },
  };
}

function productionOrderHarness(payload) {
  const listeners = new Map();
  const calls = { titleFocus: 0, titleSelect: 0, bodyFocus: 0 };
  let currentRange = null;

  const doc = {
    activeElement: null,
    body: { classList: classList() },
    getElementById(id) { return controls.get(id) || null; },
    createElement(tag) { return element(tag); },
    createRange() {
      return {
        startContainer: null,
        endContainer: null,
        startOffset: 0,
        endOffset: 0,
        collapsed: false,
        selectNodeContents(target) {
          this.startContainer = target;
          this.endContainer = target;
          this.startOffset = 0;
          this.endOffset = String(target.textContent || "").length;
          this.collapsed = false;
        },
        collapse(toStart) {
          this.collapsed = true;
          if (toStart) {
            this.endContainer = this.startContainer;
            this.endOffset = this.startOffset;
          } else {
            this.startContainer = this.endContainer;
            this.startOffset = this.endOffset;
          }
        },
      };
    },
    addEventListener(type, handler, capture) {
      const key = `${type}:${capture === true}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
    },
    removeEventListener(type, handler, capture) {
      const key = `${type}:${capture === true}`;
      listeners.set(key, (listeners.get(key) || []).filter((entry) => entry !== handler));
    },
  };

  function element(tag) {
    const attrs = new Map();
    const children = [];
    return {
      tagName: String(tag).toUpperCase(),
      id: "",
      className: "",
      style: {},
      children,
      parentNode: null,
      value: "",
      textContent: "",
      hidden: false,
      disabled: false,
      readOnly: false,
      contentEditable: "false",
      isContentEditable: false,
      classList: classList(),
      addEventListener() {},
      setAttribute(name, value) {
        attrs.set(String(name), String(value));
        if (String(name).toLowerCase() === "contenteditable") {
          this.contentEditable = String(value);
          this.isContentEditable = String(value).toLowerCase() === "true";
        }
      },
      getAttribute(name) { return attrs.get(String(name)) || null; },
      appendChild(child) { child.parentNode = this; children.push(child); return child; },
      focus() { doc.activeElement = this; },
      select() {},
      click() {},
      contains(node) {
        if (node === this) return true;
        return children.some((child) => child.contains?.(node));
      },
      closest(selector) {
        let current = this;
        while (current) {
          const names = String(current.className || "").split(/\s+/);
          if (selector === ".lineText[data-line-id]" && names.includes("lineText") && current.getAttribute?.("data-line-id")) return current;
          if (selector === ".docRow[data-line-id]" && names.includes("docRow") && current.getAttribute?.("data-line-id")) return current;
          current = current.parentNode;
        }
        return null;
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const found = [];
        const visit = (node) => {
          for (const child of node.children || []) {
            const names = String(child.className || "").split(/\s+/);
            if (selector === ".lineText[data-line-id]" && names.includes("lineText") && child.getAttribute?.("data-line-id")) found.push(child);
            if (selector === ".docRow[data-line-id]" && names.includes("docRow") && child.getAttribute?.("data-line-id")) found.push(child);
            visit(child);
          }
        };
        visit(this);
        return found;
      },
      getBoundingClientRect() { return { top: 0, bottom: 24 }; },
      scrollBy() {},
    };
  }

  const controls = new Map();
  for (const [id, tag] of Object.entries({
    titleInput: "input",
    outlinePane: "div",
    saveState: "span",
    saveBtn: "button",
    saveCloseBtn: "button",
    unsavedDialog: "div",
    unsavedSaveBtn: "button",
    unsavedDiscardBtn: "button",
    unsavedCancelBtn: "button",
    closeBtn: "button",
  })) {
    const control = element(tag);
    control.id = id;
    controls.set(id, control);
  }
  controls.get("unsavedDialog").hidden = true;

  const title = controls.get("titleInput");
  title.value = payload.title || "";
  title.focus = () => { calls.titleFocus += 1; doc.activeElement = title; };
  title.select = () => { calls.titleSelect += 1; };

  const pane = controls.get("outlinePane");
  pane.scrollTop = 0;
  pane.scrollHeight = 200;
  pane.clientHeight = 100;

  const row = element("div");
  row.className = "docRow";
  row.setAttribute("data-line-id", "line_0");
  row.setAttribute("data-depth", "0");
  const gutter = element("button");
  gutter.className = "lineGutter";
  gutter.setAttribute("data-line-id", "line_0");
  const body = element("div");
  body.className = "lineText";
  body.setAttribute("data-line-id", "line_0");
  body.setAttribute("contenteditable", payload.readOnly === true ? "false" : "true");
  body.textContent = "Body";
  body.focus = () => { calls.bodyFocus += 1; doc.activeElement = body; };
  row.appendChild(gutter);
  row.appendChild(body);
  pane.appendChild(row);

  const carrier = element("textarea");
  carrier.id = "pocketNodePopoutPayload";
  carrier.value = JSON.stringify({
    id: "fixture",
    title: payload.title || "",
    text: "Body",
    readOnly: payload.readOnly === true,
    fileSessionId: 1,
    sourceFileName: "fixture.json",
    sourcePipSession: false,
    sourceOwnerKind: "json",
    sourceVaultSessionId: "",
    originalUpdatedAt: "2026-09-18T00:00:00.000Z",
    popupOwnerToken: "owner",
    popupInstanceToken: "popup",
  });
  controls.set("pocketNodePopoutPayload", carrier);

  const selection = {
    rangeCount: 0,
    removeAllRanges() { currentRange = null; this.rangeCount = 0; },
    addRange(range) { currentRange = range; this.rangeCount = 1; },
    getRangeAt(index) {
      if (index !== 0 || !currentRange) throw new Error("no range");
      return currentRange;
    },
  };

  const windowListeners = new Map();
  const content = {
    parseLines(text) { return [{ depth: 0, content: String(text || "") }]; },
    serialiseLines(lines) { return lines.map((line) => line.content).join("\n"); },
    hasChildren() { return false; },
    subtreeEnd(index) { return index + 1; },
    visibleIndexes(lines) { return lines.map((_line, index) => index); },
    smartContinuation() { return { content: "", exitList: false }; },
  };

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
    Date,
    Promise,
  });
  context.window = context;
  context.globalThis = context;
  context.document = doc;
  context.navigator = {};
  context.PocketNodeContent = content;
  context.getSelection = () => selection;
  context.requestAnimationFrame = () => 1;
  context.setTimeout = () => 1;
  context.clearTimeout = () => {};
  context.close = () => {};
  context.addEventListener = (type, handler) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  };
  context.removeEventListener = (type, handler) => {
    windowListeners.set(type, (windowListeners.get(type) || []).filter((entry) => entry !== handler));
  };
  context.fireWindow = (type) => {
    for (const handler of [...(windowListeners.get(type) || [])]) handler({ type });
  };

  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context, {
    filename: "js/pocket-node-popout-runtime.js",
  });
  const afterRuntime = { activeElement: doc.activeElement, titleFocus: calls.titleFocus, titleSelect: calls.titleSelect, bodyFocus: calls.bodyFocus };

  vm.runInContext(source("js/pocket-node-popout-polish.js"), context, {
    filename: "js/pocket-node-popout-polish.js",
  });

  return {
    context,
    doc,
    title,
    body,
    selection,
    calls,
    afterRuntime,
    getRange() { return currentRange; },
    fireWindow(type) { context.fireWindow(type); },
    typeImmediately(text) {
      const target = doc.activeElement;
      if (target === title) title.value += String(text);
      else if (target === body) body.textContent += String(text);
      return target;
    },
  };
}

test("P210h PE surface contract keeps runtime before polish", () => {
  const scripts = [...surfaceDependencies.scriptsFor("pe")];
  assert.ok(scripts.indexOf("js/pocket-node-popout-runtime.js") >= 0);
  assert.ok(scripts.indexOf("js/pocket-node-popout-polish.js") > scripts.indexOf("js/pocket-node-popout-runtime.js"));
  assert.match(source("js/pocket-node-popout-template.js"), /PocketSurfaceDependencies/);
});

test("P210h runtime no longer creates unconditional title-first startup focus", () => {
  const runtime = source("js/pocket-node-popout-runtime.js");
  assert.doesNotMatch(runtime, /applyReadOnlyState\(\);\s*if\(!readOnly\)\{titleInput\.focus/);
  assert.doesNotMatch(runtime, /titleInput\.focus\?\.\(\);\s*titleInput\.select\?\.\(\);/);

  const h = productionOrderHarness({ title: "Existing", readOnly: false });
  assert.equal(h.afterRuntime.activeElement, null);
  assert.equal(h.afterRuntime.titleFocus, 0);
  assert.equal(h.afterRuntime.titleSelect, 0);
});

test("P210h real production order gives titled editable body a usable collapsed caret before immediate typing", () => {
  const h = productionOrderHarness({ title: "Existing", readOnly: false });
  assert.equal(h.doc.activeElement, h.body);
  assert.equal(h.calls.bodyFocus, 1);
  assert.equal(h.calls.titleFocus, 0);
  assert.equal(h.selection.rangeCount, 1);
  const range = h.getRange();
  assert.ok(range);
  assert.equal(range.collapsed, true);
  assert.equal(range.startContainer, h.body);

  const originalTitle = h.title.value;
  const target = h.typeImmediately("xyz");
  assert.equal(target, h.body);
  assert.equal(h.body.textContent, "Bodyxyz");
  assert.equal(h.title.value, originalTitle);
});

test("P210h real production order keeps genuinely untitled editable popup title-first", () => {
  const h = productionOrderHarness({ title: "", readOnly: false });
  assert.equal(h.afterRuntime.activeElement, null);
  assert.equal(h.doc.activeElement, h.title);
  assert.equal(h.calls.titleFocus, 1);
  assert.equal(h.calls.titleSelect, 1);
  assert.equal(h.calls.bodyFocus, 0);
});

test("P210h read-only popup receives no editing-focus override", () => {
  const h = productionOrderHarness({ title: "Existing", readOnly: true });
  assert.equal(h.afterRuntime.activeElement, null);
  assert.equal(h.doc.activeElement, null);
  assert.equal(h.calls.titleFocus, 0);
  assert.equal(h.calls.bodyFocus, 0);
});

test("P210h later manual focus is not stolen by a load-time reassertion", () => {
  const h = productionOrderHarness({ title: "Existing", readOnly: false });
  assert.equal(h.doc.activeElement, h.body);
  h.title.focus();
  assert.equal(h.doc.activeElement, h.title);
  h.fireWindow("load");
  assert.equal(h.doc.activeElement, h.title);
  assert.equal(h.calls.bodyFocus, 1, "opening focus is one-shot");
});

test("P210h polish owns startup focus synchronously without timing correction machinery", () => {
  const polish = source("js/pocket-node-popout-polish.js");
  assert.match(polish, /function installOpeningFocus\(doc, payload\) \{\s*return focusOpeningSurface\(doc, payload\);\s*\}/);
  assert.doesNotMatch(polish, /finishOpeningFocus|userInteracted|addEventListener\("load"|setInterval|MutationObserver/);
  assert.doesNotMatch(polish, /applyAndSave|recordOp|buildPocketPayload/);
});
