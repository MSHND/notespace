"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CAPABILITIES = "js/pocket-doorway-capabilities.js";
const RENDER = "js/pocket-render.js";
const OVERLAYS = "js/pocket-overlays-init.js";
const SYNC_UI = "js/pocket-sync-ui.js";
const IO = "js/pocket-io-browser.js";
const OPENING = "js/pocket-file-opening.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function capabilityRuntime({ localOpen = false, localNew = false, syncedOpen = false, syncedNew = false } = {}) {
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON, Date, Math,
    showOpenFilePicker: localOpen ? function showOpenFilePicker() {} : undefined,
    showSaveFilePicker: localNew ? function showSaveFilePicker() {} : undefined,
    PocketSyncUi: Object.freeze({
      canOpenExisting() { return syncedOpen; },
      canCreateNew() { return syncedNew; },
    }),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(CAPABILITIES), context, { filename: CAPABILITIES });
  return context;
}

test("P274 capability owner derives Open and New independently from runtime capability plus existing Sync eligibility", () => {
  const matrix = [
    { input: { localOpen: true, localNew: true, syncedOpen: true }, expected: { localOpen: true, localNew: true, syncedOpen: true, syncedNew: false, anyOpen: true, anyNew: true, anyAction: true } },
    { input: { localOpen: true, localNew: false, syncedOpen: false }, expected: { localOpen: true, localNew: false, syncedOpen: false, syncedNew: false, anyOpen: true, anyNew: false, anyAction: true } },
    { input: { localOpen: false, localNew: true, syncedOpen: false }, expected: { localOpen: false, localNew: true, syncedOpen: false, syncedNew: false, anyOpen: false, anyNew: true, anyAction: true } },
    { input: { localOpen: false, localNew: false, syncedOpen: true }, expected: { localOpen: false, localNew: false, syncedOpen: true, syncedNew: false, anyOpen: true, anyNew: false, anyAction: true } },
    { input: { localOpen: false, localNew: false, syncedOpen: false }, expected: { localOpen: false, localNew: false, syncedOpen: false, syncedNew: false, anyOpen: false, anyNew: false, anyAction: false } },
    { input: { localOpen: false, localNew: false, syncedOpen: false, syncedNew: true }, expected: { localOpen: false, localNew: false, syncedOpen: false, syncedNew: true, anyOpen: false, anyNew: true, anyAction: true } },
    { input: { localOpen: true, localNew: true, syncedOpen: false, syncedNew: true }, expected: { localOpen: true, localNew: true, syncedOpen: false, syncedNew: true, anyOpen: true, anyNew: true, anyAction: true } },
  ];

  for (const entry of matrix) {
    const context = capabilityRuntime(entry.input);
    assert.deepEqual(
      JSON.parse(JSON.stringify(context.PocketDoorwayCapabilities.read())),
      entry.expected,
      JSON.stringify(entry.input),
    );
  }
});

class HTMLElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.children = this.childNodes;
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.hidden = false;
    this.disabled = false;
    this.focused = false;
  }
  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }
  addEventListener(type, handler) {
    const key = String(type);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
  }
  click() {
    for (const handler of this.listeners.get("click") || []) {
      handler({
        preventDefault() {},
        stopPropagation() {},
        target: this,
      });
    }
  }
  focus() { this.focused = true; }
  querySelector(selector) {
    if (selector === ".commandBtn:not([disabled]):not([hidden])") {
      return this.childNodes.find((child) =>
        child instanceof HTMLButtonElement
        && child.className.split(/\s+/).includes("commandBtn")
        && !child.hidden
        && !child.disabled
      ) || null;
    }
    return null;
  }
}
class HTMLButtonElement extends HTMLElement {
  constructor() { super("button"); }
}

function gateHarness(options = {}) {
  const document = {
    createElement(tagName) {
      return String(tagName).toLowerCase() === "button"
        ? new HTMLButtonElement()
        : new HTMLElement(tagName);
    },
  };
  let openDoorwayCalls = 0;
  let newDoorwayCalls = 0;
  let openFileCalls = 0;
  let newFileCalls = 0;
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Function, Reflect,
    JSON, Date, Math, Promise, HTMLElement, HTMLButtonElement, document,
    state: { pocketFile: { gateMode: "blocked", recentName: "" } },
    cleanText(value, max = Number.MAX_SAFE_INTEGER) { return String(value || "").trim().slice(0, max); },
    readLocalSafetySnapshot() { return null; },
    openPocketDoorway() { openDoorwayCalls += 1; return true; },
    openPocketNewDoorway() { newDoorwayCalls += 1; return true; },
    openPocketFile() { openFileCalls += 1; return true; },
    createNewPocketFile() { newFileCalls += 1; return true; },
  };
  context.window = context;
  context.globalThis = context;
  context.PocketSyncUi = Object.freeze({
    canOpenExisting: () => options.syncedOpen === true,
    canCreateNew: () => options.syncedNew === true,
  });
  if (options.localOpen) context.showOpenFilePicker = () => {};
  if (options.localNew) context.showSaveFilePicker = () => {};

  vm.createContext(context);
  vm.runInContext(source(CAPABILITIES), context, { filename: CAPABILITIES });
  vm.runInContext(source(RENDER), context, { filename: RENDER });

  const root = context.buildPocketFileGate();
  const all = [];
  const visit = (node) => {
    all.push(node);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(root);
  const buttons = all.filter((node) => node instanceof HTMLButtonElement);
  const text = all.map((node) => node.textContent || "").filter(Boolean);
  return {
    context,
    root,
    buttons,
    labels: buttons.map((button) => button.textContent),
    text,
    counts: () => ({ openDoorwayCalls, newDoorwayCalls, openFileCalls, newFileCalls }),
  };
}

test("P274 full local-capable no-document gate preserves Open / New", () => {
  const h = gateHarness({ localOpen: true, localNew: true, syncedOpen: true });
  assert.deepEqual(h.labels, ["Open", "New"]);
  h.buttons[0].click();
  h.buttons[1].click();
  assert.deepEqual(h.counts(), { openDoorwayCalls: 1, newDoorwayCalls: 1, openFileCalls: 0, newFileCalls: 0 });
  assert.ok(h.text.includes("Open an existing Pocket, or start a new one."));
});

test("P274 Sync-only no-document gate exposes Open but no dead local New", () => {
  const h = gateHarness({ localOpen: false, localNew: false, syncedOpen: true });
  assert.deepEqual(h.labels, ["Open"]);
  h.buttons[0].click();
  assert.deepEqual(h.counts(), { openDoorwayCalls: 1, newDoorwayCalls: 0, openFileCalls: 0, newFileCalls: 0 });
  assert.ok(h.text.includes("Open an existing Pocket to continue."));
});

test("P274 partial local capability is represented independently", () => {
  const openOnly = gateHarness({ localOpen: true, localNew: false, syncedOpen: false });
  assert.deepEqual(openOnly.labels, ["Open"]);
  openOnly.buttons[0].click();
  assert.equal(openOnly.counts().openDoorwayCalls, 1);

  const newOnly = gateHarness({ localOpen: false, localNew: true, syncedOpen: false });
  assert.deepEqual(newOnly.labels, ["New"]);
  newOnly.buttons[0].click();
  assert.equal(newOnly.counts().newDoorwayCalls, 1);
  assert.equal(newOnly.counts().newFileCalls, 0);
});

test("P274 Synced New alone makes gate New available through the normal New doorway", () => {
  const h = gateHarness({ localOpen: false, localNew: false, syncedOpen: false, syncedNew: true });
  assert.deepEqual(h.labels, ["New"]);
  assert.ok(h.text.includes("Start a new Pocket to continue."));
  h.buttons[0].click();
  assert.deepEqual(h.counts(), { openDoorwayCalls: 0, newDoorwayCalls: 1, openFileCalls: 0, newFileCalls: 0 });
});

test("P274 no usable owner gives durable in-gate explanation and no inert action", () => {
  const h = gateHarness({ localOpen: false, localNew: false, syncedOpen: false });
  assert.deepEqual(h.labels, []);
  assert.ok(h.text.includes("Pocket cannot open or create a persistent local file here, and Synced Pocket is not available."));
});

function extractOpenPocketDoorway() {
  const overlays = source(OVERLAYS);
  const start = overlays.indexOf("function openPocketDoorway() {");
  const end = overlays.indexOf("\nfunction closePocketNewDoorway", start);
  assert.ok(start >= 0 && end > start, "openPocketDoorway source is extractable");
  return overlays.slice(start, end);
}

function doorwayHarness({ localOpen = false, localNew = false, syncedOpen = false, syncedNew = false } = {}) {
  const cmdOpenFile = new HTMLButtonElement();
  cmdOpenFile.className = "commandBtn";
  const cmdOpenSyncedPocket = new HTMLButtonElement();
  cmdOpenSyncedPocket.className = "commandBtn";
  const cmdOpenCancel = new HTMLButtonElement();
  cmdOpenCancel.className = "commandBtn";
  const btnOpenSynced = new HTMLButtonElement();
  const overlay = new HTMLElement("div");
  overlay.hidden = true;
  overlay.appendChild(cmdOpenFile);
  overlay.appendChild(cmdOpenSyncedPocket);
  overlay.appendChild(cmdOpenCancel);

  let openFileCalls = 0;
  let syncClicks = 0;
  let syncRefreshes = 0;
  btnOpenSynced.addEventListener("click", () => { syncClicks += 1; });

  const anyOpen = localOpen || syncedOpen;
  const anyNew = localNew || syncedNew;
  const caps = { localOpen, localNew, syncedOpen, syncedNew, anyOpen, anyNew, anyAction: anyOpen || anyNew };
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON,
    HTMLElement, HTMLButtonElement,
    el: { cmdOpenFile, cmdOpenSyncedPocket, cmdOpenCancel, btnOpenSynced, pocketOpenOverlay: overlay },
    pocketAppSurfaceBlocked() { return false; },
    closeCommandPalette() { return true; },
    closePocketNewDoorway() { return true; },
    closeStorageMenu() { return true; },
    openPocketFile() { openFileCalls += 1; return true; },
    requestAnimationFrame(callback) { callback(); return 1; },
  };
  context.window = context;
  context.globalThis = context;
  context.PocketSyncUi = { refresh() { syncRefreshes += 1; } };
  context.PocketDoorwayCapabilities = { read() { return Object.freeze({ ...caps }); } };

  vm.createContext(context);
  vm.runInContext(extractOpenPocketDoorway(), context, { filename: OVERLAYS });

  return {
    context,
    cmdOpenFile,
    cmdOpenSyncedPocket,
    overlay,
    result: () => context.openPocketDoorway(),
    counts: () => ({ openFileCalls, syncClicks, syncRefreshes }),
  };
}

test("P274 Open doorway preserves desktop choice when local and Synced owners are both usable", () => {
  const h = doorwayHarness({ localOpen: true, localNew: true, syncedOpen: true });
  assert.equal(h.result(), true);
  assert.equal(h.overlay.hidden, false);
  assert.equal(h.cmdOpenFile.hidden, false);
  assert.equal(h.cmdOpenSyncedPocket.hidden, false);
  assert.equal(h.cmdOpenFile.focused, true);
  assert.deepEqual(h.counts(), { openFileCalls: 0, syncClicks: 0, syncRefreshes: 1 });
});

test("P274 Open doorway routes directly to existing Synced owner when it is the sole usable Open owner", () => {
  const h = doorwayHarness({ localOpen: false, localNew: false, syncedOpen: true });
  assert.equal(h.result(), true);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.cmdOpenFile.hidden, true);
  assert.equal(h.cmdOpenFile.disabled, true);
  assert.equal(h.cmdOpenSyncedPocket.hidden, false);
  assert.deepEqual(h.counts(), { openFileCalls: 0, syncClicks: 1, syncRefreshes: 1 });
});

test("P274 Open doorway routes directly to existing local owner when Sync open is unavailable", () => {
  const h = doorwayHarness({ localOpen: true, localNew: false, syncedOpen: false });
  assert.equal(h.result(), true);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.cmdOpenSyncedPocket.hidden, true);
  assert.equal(h.cmdOpenSyncedPocket.disabled, true);
  assert.deepEqual(h.counts(), { openFileCalls: 1, syncClicks: 0, syncRefreshes: 1 });
});

test("P274 Open doorway fails truthfully when there is no usable Open owner even when Synced New is available", () => {
  const h = doorwayHarness({ localOpen: false, localNew: false, syncedOpen: false, syncedNew: true });
  assert.equal(h.result(), false);
  assert.equal(h.overlay.hidden, true);
  assert.deepEqual(h.counts(), { openFileCalls: 0, syncClicks: 0, syncRefreshes: 1 });
});

test("P274 reuses existing Sync eligibility and storage owners without device/browser sniffing", () => {
  const capabilities = source(CAPABILITIES);
  const render = source(RENDER);
  const doorway = extractOpenPocketDoorway();
  const sync = source(SYNC_UI);
  const io = source(IO);
  const opening = source(OPENING);
  const index = source("index.html");
  const sw = source("sw.js");

  assert.match(capabilities, /PocketSyncUi\?\.canOpenExisting\?\.\(\) === true/);
  assert.match(capabilities, /PocketSyncUi\?\.canCreateNew\?\.\(\) === true/);
  assert.match(capabilities, /const anyNew = localNew \|\| syncedNew/);
  assert.match(capabilities, /anyAction: anyOpen \|\| anyNew/);
  assert.match(sync, /canOpenExistingInstalled = \(\) => eligibleOpen\(owner\(\)\)/);
  assert.match(sync, /canOpenExisting: \(\) => canOpenExistingInstalled\(\) === true/);
  assert.match(doorway, /el\.btnOpenSynced\?\.click\?\.\(\)/);
  assert.doesNotMatch(doorway, /openExisting\(|recoverExisting\(|activate\(/);

  assert.match(opening, /typeof global\.showOpenFilePicker !== "function"/);
  assert.match(io, /async function createNewPocketFile\(\)/);
  assert.match(io, /typeof window\.showSaveFilePicker !== "function"/);
  assert.match(source(OVERLAYS), /btnExportTree\.addEventListener\("click", saveCurrentContext\)/);

  const decisionSurface = capabilities + "\n" + render.slice(render.indexOf("function buildPocketFileGateState()"), render.indexOf("\nlet rowActionMenuEl"))
    + "\n" + doorway;
  assert.doesNotMatch(decisionSurface, /navigator\.|userAgent|platform|iPad|iPhone|Safari|Chrome|DuckDuckGo|Android|Macintosh/i);

  assert.ok(index.indexOf("js/pocket-doorway-capabilities.js") < index.indexOf("js/pocket-render.js"));
  assert.match(sw, /pocket-shell-v11/);
  assert.match(sw, /\.\/js\/pocket-doorway-capabilities\.js/);
});
