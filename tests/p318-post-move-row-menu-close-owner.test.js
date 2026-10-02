"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
const HELPER = path.join(JS_DIR, "pocket-enter-copy-only.js");
const OVERLAYS = path.join(JS_DIR, "pocket-overlays-init.js");
const PHONE = path.join(JS_DIR, "pocket-phone-menu.js");

function source(file) {
  return fs.readFileSync(file, "utf8");
}

function jsFiles(dir = JS_DIR) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name.endsWith(".js")) found.push(target);
    }
  }
  return found;
}

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `extractable: ${startMarker}`);
  return text.slice(start, end);
}

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

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      const index = this.parentNode.childNodes.indexOf(this);
      if (index >= 0) this.parentNode.childNodes.splice(index, 1);
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

  getAttribute(name) {
    return this.attributes.get(String(name)) || null;
  }

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
      shiftKey: false,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...event,
    };
    for (const callback of this.listeners.get(String(type)) || []) callback(ev);
    return ev;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  click() {
    return this.emit("click");
  }

  getBoundingClientRect() {
    return { width: 150, height: 210, left: 20, right: 120, top: 30 };
  }

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

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function makeHarness() {
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

  const observations = [];
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
    cleanText(value, max = Number.MAX_SAFE_INTEGER) {
      return String(value || "").trim().slice(0, max);
    },
    nodeMap() {
      return new Map([["node-B", { id: "node-B", name: "Beta" }]]);
    },
    isDetailsEditorOpen() { return false; },
    renderTree() {},
    refocusTreeNavigation() {},
    runCommandPaletteAction(action) {
      observations.push({
        action,
        menuPresent: document.body.childNodes.some((item) => item.classList.contains("rowMiniMenu")),
        menuOpen: context.state.rowMiniMenuOpen,
        menuNodeId: context.state.rowMiniMenuNodeId,
      });
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
  };
  context.window = context;
  context.window.innerWidth = 1200;
  context.window.innerHeight = 900;
  context.window.matchMedia = () => ({ matches: false });
  context.globalThis = context;

  const overlays = source(OVERLAYS);
  const owner = extractBetween(overlays, "let rowMiniMenuEl = null;", "\nfunction isCommandPaletteOpen()");
  vm.createContext(context);
  vm.runInContext(owner, context, { filename: path.relative(ROOT, OVERLAYS) });

  return { context, document, observations };
}

function currentMenu(h) {
  return h.document.body.childNodes.find((item) => item.classList.contains("rowMiniMenu")) || null;
}

function openMoveMenu(h) {
  assert.equal(h.context.openRowMiniMenu("node-B", h.document.mountedRow), true);
  const menu = currentMenu(h);
  assert.ok(menu, "row menu opens");
  const move = menu.querySelector('.rowMiniMenuBtn[data-shortcut="m"]:not([disabled])');
  assert.ok(move, "canonical Move button exists");
  return { menu, move };
}

function assertSingleClosedMove(h) {
  assert.deepEqual(h.observations, [{
    action: "move",
    menuPresent: false,
    menuOpen: false,
    menuNodeId: "",
  }], "Move dispatch occurs exactly once after canonical menu closure");
  assert.equal(currentMenu(h), null, "row menu remains closed");
}

test("P318 runtime has no delayed post-Move row-menu close helper", () => {
  const runtime = jsFiles().map((file) => ({ file, text: source(file) }));
  for (const name of ["forceClose" + "RowMenus", "closeMenusAfter" + "MoveClick"]) {
    const matches = runtime.filter(({ text }) => text.includes(name));
    assert.deepEqual(
      matches.map(({ file }) => path.relative(ROOT, file).replace(/\\/g, "/")),
      [],
      name + " has no runtime definition or use",
    );
  }

  const helper = source(HELPER);
  assert.match(helper, /function installMoveDisplayGuard\(\)/);
  assert.match(helper, /function installPeEscCloseGuard\(\)/);
  assert.doesNotMatch(helper, /document\.addEventListener\("click"[^\n]*Move/);
});

test("P318 direct canonical Move click closes menu before exactly one move dispatch", () => {
  const h = makeHarness();
  const { move } = openMoveMenu(h);
  move.click();
  assertSingleClosedMove(h);
});

test("P318 shortcut M closes menu before exactly one move dispatch", () => {
  const h = makeHarness();
  const { menu } = openMoveMenu(h);
  const ev = menu.emit("keydown", { key: "m" });
  assert.equal(ev.defaultPrevented, true);
  assertSingleClosedMove(h);
});

test("P318 native Enter on focused Move closes menu before exactly one move dispatch", () => {
  const h = makeHarness();
  const { menu, move } = openMoveMenu(h);
  move.focus();
  const ev = menu.emit("keydown", { key: "Enter" });
  assert.equal(ev.defaultPrevented, false, "row menu leaves Enter to native button activation");
  if (!ev.defaultPrevented) h.document.activeElement.click();
  assertSingleClosedMove(h);
});

test("P318 command-palette Move remains independent of row-menu close helpers", () => {
  const overlays = source(OVERLAYS);
  assert.match(
    overlays,
    /el\.cmdMove\?\.addEventListener\("click", \(\) => runCommandPaletteAction\("move"\)\)/,
  );
  const palette = extractBetween(overlays, "function runCommandPaletteAction(action) {", "\nfunction moveCommandPaletteFocus");
  assert.match(palette, /requestAnimationFrame\(\(\) => \{/);
  assert.match(palette, /else if \(action === "move"\) toggleMoveMode\(\)/);
  assert.doesNotMatch(palette, /rowMiniMenu|forceClose|closeMenusAfter/);
});

test("P318 phone selected-row route still delegates to canonical menu and omits only Copy text", () => {
  const phone = source(PHONE);
  assert.match(phone, /global\.openRowMiniMenu\(nodeId, button\)/);
  assert.match(phone, /const originalOpenRowMiniMenu = global\.openRowMiniMenu/);
  assert.match(phone, /originalOpenRowMiniMenu\.apply\(this, arguments\)/);
  assert.match(phone, /if \(!label\.includes\("copy text"\)\) continue/);
  assert.doesNotMatch(phone, /className\s*=\s*"rowMiniMenu"/);
  assert.doesNotMatch(phone, /label\.includes\("move"\)/);
});
