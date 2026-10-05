"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const RENDER = "js/pocket-render.js";
const OVERLAYS = "js/pocket-overlays-init.js";
const ACTIONS = "js/pocket-tree-actions.js";
const PHONE = "js/pocket-phone-menu.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `extractable: ${startMarker}`);
  return text.slice(start, end);
}

test("P273 Main right-click delegates to the existing rowMiniMenu owner with selection, guard, cancellation and pointer coordinates", () => {
  const render = source(RENDER);
  assert.doesNotMatch(render, /rowActionMenu|openRowActionMenu|closeRowActionMenu|positionRowActionMenu|addRowActionButton/);

  const handler = extractBetween(
    render,
    '    row.addEventListener("contextmenu", (ev) => {',
    "\n\n    li.appendChild(row);",
  );

  class HTMLElement {
    constructor(name = "") { this.name = name; this.listeners = new Map(); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
  }

  const oldRow = new HTMLElement("old-row");
  const mountedRow = new HTMLElement("mounted-row");
  let cancelCalls = 0;
  let refreshCalls = 0;
  let renderCalls = 0;
  const opens = [];

  const context = {
    HTMLElement,
    row: oldRow,
    node: { id: "node-B" },
    state: { selectedId: "node-A", inlineEdit: { id: "" } },
    cancelPendingCopyClick() { cancelCalls += 1; },
    refreshMeta() { refreshCalls += 1; },
    renderTree() { renderCalls += 1; },
    getMountedMainRowForNodeId(id) {
      assert.equal(id, "node-B");
      return mountedRow;
    },
    openRowMiniMenu(id, anchor, point) { opens.push({ id, anchor, point }); return true; },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(handler, context, { filename: RENDER });

  const callback = oldRow.listeners.get("contextmenu");
  assert.equal(typeof callback, "function");

  const event = {
    clientX: 321,
    clientY: 222,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
  callback(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.equal(cancelCalls, 1, "pending copy-click is cancelled before menu handoff");
  assert.equal(context.state.selectedId, "node-B", "right-clicked row becomes selected");
  assert.equal(refreshCalls, 1);
  assert.equal(renderCalls, 1);
  assert.equal(opens.length, 1);
  assert.equal(opens[0].id, "node-B");
  assert.equal(opens[0].anchor, mountedRow, "existing rowMiniMenu receives the remounted row");
  assert.equal(opens[0].point.x, 321);
  assert.equal(opens[0].point.y, 222);

  context.state.selectedId = "node-A";
  context.state.inlineEdit.id = "node-B";
  const guarded = {
    clientX: 1,
    clientY: 2,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  };
  callback(guarded);
  assert.equal(guarded.defaultPrevented, false, "inline-edit context menu remains owned by the editor");
  assert.equal(context.state.selectedId, "node-A");
  assert.equal(cancelCalls, 1);
  assert.equal(opens.length, 1);
});

class MiniElement {
  constructor(document, tagName = "div") {
    this.ownerDocument = document;
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this._className = "";
    this._classes = new Set();
    this.classList = {
      contains: (name) => this._classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this._classes.has(name) : !!force;
        if (on) this._classes.add(name); else this._classes.delete(name);
        this._className = Array.from(this._classes).join(" ");
        return on;
      },
    };
  }
  set className(value) {
    this._className = String(value || "");
    this._classes = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  get className() { return this._className; }
  appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.childNodes.indexOf(this);
      if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    }
    this.parentNode = null;
  }
  contains(target) {
    if (target === this) return true;
    return this.childNodes.some((child) => child.contains?.(target));
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    if (name === "data-shortcut") this.dataset.shortcut = String(value);
  }
  getAttribute(name) { return this.attributes.get(String(name)) || null; }
  addEventListener(type, callback) {
    const key = String(type);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(callback);
  }
  emit(type, event = {}) {
    const ev = {
      target: this,
      key: "",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...event,
    };
    for (const callback of this.listeners.get(String(type)) || []) callback(ev);
    return ev;
  }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.emit("click"); }
  getBoundingClientRect() { return { width: 150, height: 210, left: 20, right: 120, top: 30 }; }
  querySelectorAll(selector) {
    const all = [];
    const visit = (node) => {
      for (const child of node.childNodes || []) {
        all.push(child);
        visit(child);
      }
    };
    visit(this);
    if (selector === ".rowMiniMenuBtn:not([disabled])") {
      return all.filter((item) => item._classes?.has("rowMiniMenuBtn") && !item.disabled);
    }
    const shortcut = selector.match(/^\.rowMiniMenuBtn\[data-shortcut="([^"]+)"\]:not\(\[disabled\]\)$/);
    if (shortcut) {
      return all.filter((item) =>
        item._classes?.has("rowMiniMenuBtn")
        && item.dataset.shortcut === shortcut[1]
        && !item.disabled
      );
    }
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeMiniMenuHarness() {
  const document = {
    activeElement: null,
    body: null,
    mountedRow: null,
    documentElement: { clientWidth: 1200, clientHeight: 900 },
    createElement(tagName) { return new MiniElement(document, tagName); },
    querySelector(selector) {
      return /^\[data-node-id=/.test(selector) ? document.mountedRow : null;
    },
  };
  document.body = new MiniElement(document, "body");
  document.mountedRow = new MiniElement(document, "div");

  const commands = [];
  const edits = [];
  const refocused = [];
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Math,
    HTMLElement: MiniElement,
    document,
    CSS: { escape(value) { return String(value); } },
    state: {
      selectedId: "node-A",
      rowMiniMenuOpen: false,
      rowMiniMenuNodeId: "",
    },
    el: {},
    cleanText(value, max = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, max); },
    nodeMap() { return new Map([["node-B", { id: "node-B", name: "Beta" }]]); },
    isDetailsEditorOpen() { return false; },
    renderTree() {},
    refocusTreeNavigation(id) { refocused.push(id); },
    runCommandPaletteAction(action) { commands.push(action); },
    openItemDetailsForNode(id) {
      edits.push(id);
      return typeof context.closeRowMiniMenu === "function"
        ? context.closeRowMiniMenu({ restoreFocus: false })
        : true;
    },
    requestAnimationFrame(callback) { callback(); return 1; },
  };
  context.window = context;
  context.window.innerWidth = 1200;
  context.window.innerHeight = 900;
  context.window.matchMedia = () => ({ matches: false });
  context.globalThis = context;

  const overlays = source(OVERLAYS);
  const miniOwner = extractBetween(overlays, "let rowMiniMenuEl = null;", "\nfunction isCommandPaletteOpen()");
  vm.createContext(context);
  vm.runInContext(miniOwner, context, { filename: OVERLAYS });

  return { context, document, commands, edits, refocused };
}

function currentMenu(h) {
  return h.document.body.childNodes.find((item) => item.classList.contains("rowMiniMenu")) || null;
}

function menuKey(menu, key) {
  const ev = menu.emit("keydown", { key });
  if (key === "Enter" && !ev.defaultPrevented) {
    const active = menu.ownerDocument.activeElement;
    if (active instanceof MiniElement && active._classes.has("rowMiniMenuBtn")) active.click();
  }
  return ev;
}

test("P273 rowMiniMenu owns first focus, wrapped arrows, native Enter single activation, Escape focus return and shortcuts", () => {
  const h = makeMiniMenuHarness();

  assert.equal(h.context.openRowMiniMenu("node-B", h.document.mountedRow, { x: 321, y: 222 }), true);
  let menu = currentMenu(h);
  assert.ok(menu);
  let buttons = menu.querySelectorAll(".rowMiniMenuBtn:not([disabled])");
  assert.equal(h.context.state.selectedId, "node-B");
  assert.equal(h.context.state.rowMiniMenuNodeId, "node-B");
  assert.equal(h.document.activeElement, buttons[0], "first enabled action receives focus");
  assert.equal(menu.style.left, "325px");
  assert.equal(menu.style.top, "226px");

  menuKey(menu, "ArrowUp");
  assert.equal(h.document.activeElement, buttons.at(-1), "ArrowUp wraps first -> last");
  menuKey(menu, "ArrowDown");
  assert.equal(h.document.activeElement, buttons[0], "ArrowDown wraps last -> first");

  menuKey(menu, "Enter");
  assert.deepEqual(h.edits, ["node-B"], "native Enter activates exact-target Edit exactly once");
  assert.deepEqual(h.commands, [], "Edit does not detour through ambient command selection");
  assert.equal(currentMenu(h), null, "the exact-target editor owner closes the menu");

  assert.equal(h.context.openRowMiniMenu("node-B", h.document.mountedRow), true);
  menu = currentMenu(h);
  buttons = menu.querySelectorAll(".rowMiniMenuBtn:not([disabled])");
  menuKey(menu, "ArrowDown");
  assert.equal(h.document.activeElement, buttons[1]);
  menuKey(menu, "Escape");
  assert.equal(currentMenu(h), null);
  assert.deepEqual(h.refocused, ["node-B"], "Escape returns usable Main focus to the same menu node");

  assert.equal(h.context.openRowMiniMenu("node-B", h.document.mountedRow), true);
  menu = currentMenu(h);
  menuKey(menu, "c");
  assert.deepEqual(h.edits, ["node-B"], "non-Edit shortcuts do not reopen the editor");
  assert.deepEqual(h.commands, ["copy_text"], "existing non-Edit shortcut still uses the command path");
});

test("P273 keyboard menu-open routes, semantic command route and phone owner remain unchanged", () => {
  const actions = source(ACTIONS);
  const overlays = source(OVERLAYS);
  const phone = source(PHONE);

  assert.match(actions, /&& ev\.key === "ContextMenu"/);
  assert.doesNotMatch(actions, /ev\.key === "ContextMenu" \|\| ev\.key === "\."/);
  assert.match(actions, /ev\.shiftKey[\s\S]*ev\.key === "F10"[\s\S]*openRowMiniMenuForSelected\(\)/);
  assert.match(actions, /return openRowMiniMenu\(id, anchor instanceof HTMLElement \? anchor : row\)/);

  assert.match(overlays, /if \(action === "edit"\) \{\s*openItemDetailsForNode\(id\);\s*return;\s*\}/);
  assert.match(overlays, /state\.selectedId = id;\s*runCommandPaletteAction\(action\)/);
  for (const shortcut of ["e", "a", "m", "f", "c", "d"]) {
    assert.match(overlays, new RegExp('addButton\\([^\\n]+, "' + shortcut + '"'));
  }

  assert.match(phone, /global\.openRowMiniMenu\(nodeId, button\)/);
  assert.match(phone, /const originalOpenRowMiniMenu = global\.openRowMiniMenu/);
  assert.match(phone, /originalOpenRowMiniMenu\.apply\(this, arguments\)/);
});
