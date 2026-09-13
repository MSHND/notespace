"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function classes() {
  const names = new Set();
  return {
    add(...values) { values.forEach((value) => names.add(value)); },
    remove(...values) { values.forEach((value) => names.delete(value)); },
    contains(value) { return names.has(value); },
    toggle(value, present) {
      if (present) names.add(value);
      else names.delete(value);
      return !!present;
    },
  };
}

function createRuntime(saveResult) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source("js/pocket-node-content.js"), context);
  vm.runInContext(source("js/pocket-node-popout-runtime.js"), context);

  const controls = new Map();
  const alerts = [];
  const saveCalls = [];
  let closeCalls = 0;
  const document = {
    activeElement: null,
    body: { classList: classes() },
    addEventListener() {},
    getElementById(id) { return controls.get(id) || null; },
    createElement(tag) { return element(tag); },
  };

  function element(tag) {
    const listeners = new Map();
    const attrs = new Map();
    const node = {
      tagName: String(tag).toUpperCase(), className: "", style: {}, children: [], parentNode: null,
      textContent: "", value: "", hidden: false, disabled: false, readOnly: false,
      contentEditable: "false", classList: classes(),
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      dispatch(type, values = {}) {
        const event = { target: node, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
        for (const listener of listeners.get(type) || []) listener(event);
        return event;
      },
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.get(name) || null; },
      appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
      focus() { document.activeElement = node; },
      select() {},
      contains(child) { return node === child || node.children.some((item) => item.contains(child)); },
      closest(selector) {
        let current = node;
        while (current) {
          const names = String(current.className).split(/\s+/);
          if (selector === ".lineText[data-line-id]" && names.includes("lineText") && current.getAttribute("data-line-id")) return current;
          if (selector === ".lineGutter[data-line-id]" && names.includes("lineGutter") && current.getAttribute("data-line-id")) return current;
          current = current.parentNode;
        }
        return null;
      },
      querySelectorAll(selector) {
        const matches = [];
        const visit = (current) => current.children.forEach((child) => {
          if (selector === ".lineText[data-line-id]" && String(child.className).split(/\s+/).includes("lineText") && child.getAttribute("data-line-id")) matches.push(child);
          visit(child);
        });
        visit(node);
        return matches;
      },
    };
    Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
    return node;
  }

  for (const [id, tag] of Object.entries({
    titleInput: "input", outlinePane: "div", saveState: "span", saveBtn: "button", saveCloseBtn: "button",
    unsavedDialog: "div", unsavedSaveBtn: "button", unsavedDiscardBtn: "button", unsavedCancelBtn: "button", closeBtn: "button",
  })) controls.set(id, element(tag));
  const content = context.window.PocketNodeContent;
  const pane = controls.get("outlinePane");
  content.parseLines("Before").forEach((line, index) => {
    const row = element("div");
    const gutter = element("button");
    const lineText = element("div");
    row.className = "docRow";
    row.setAttribute("data-line-id", `line_${index}`);
    gutter.className = "lineGutter";
    gutter.setAttribute("data-line-id", `line_${index}`);
    lineText.className = "lineText";
    lineText.setAttribute("data-line-id", `line_${index}`);
    lineText.textContent = line.content;
    row.appendChild(gutter);
    row.appendChild(lineText);
    pane.appendChild(row);
  });

  const window = {
    addEventListener() {},
    setTimeout(callback) { callback(); return 1; },
    close() { closeCalls += 1; },
    opener: {
      closed: false,
      PocketNodePopoutWindow: {
        applyAndSaveFromOwnedPopup(_owner, _popup, payload) {
          saveCalls.push(payload);
          return Promise.resolve(saveResult);
        },
        cancelPendingOpen() {},
      },
    },
  };
  assert.equal(context.window.PocketNodePopoutRuntime.initialise({
    id: "fixture", title: "fixture", text: "Before", fileSessionId: 1, sourceFileName: "fixture.json",
    sourcePipSession: false, sourceOwnerKind: "json", sourceVaultSessionId: "", originalUpdatedAt: "2026-09-12T00:00:00.000Z",
    popupOwnerToken: "owner", popupInstanceToken: "popup",
  }, { window, document, content, alert(message) { alerts.push(message); }, requestAnimationFrame(callback) { callback(); return 1; } }), true);
  return { controls, alerts, saveCalls, window, closeCalls: () => closeCalls };
}

function editAndSave(app, closeAfter) {
  const pane = app.controls.get("outlinePane");
  const line = pane.children[0].children[1];
  line.textContent = "Edited locally";
  pane.dispatch("input", { target: line });
  app.controls.get(closeAfter ? "saveCloseBtn" : "saveBtn").dispatch("click");
}

const settleRuntime = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

test("P199e PE presents stale local-file conflict truthfully and keeps the editor open and dirty", async () => {
  const stale = createRuntime({ ok: false, applied: true, changed: true, exported: false, reason: "external-file-changed" });
  editAndSave(stale, true);
  await settleRuntime();

  assert.deepEqual(stale.alerts, ["This Pocket changed elsewhere. Your changes are still here."]);
  assert.equal(stale.controls.get("saveState").textContent, "Pocket changed elsewhere — not saved");
  assert.match(stale.controls.get("saveState").className, /failed/);
  assert.equal(stale.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(stale.closeCalls(), 0);
  assert.equal(stale.saveCalls.length, 1);
  assert.equal(stale.alerts.includes("Pocket did not complete the truth-file save. Your editor changes are still here."), false);

  const unrelated = createRuntime({ ok: false, reason: "write-failed" });
  editAndSave(unrelated, false);
  await settleRuntime();
  assert.deepEqual(unrelated.alerts, ["Pocket did not complete the truth-file save. Your editor changes are still here."]);
  assert.equal(unrelated.controls.get("saveState").textContent, "Save not completed");
  assert.equal(unrelated.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(unrelated.closeCalls(), 0);
});
