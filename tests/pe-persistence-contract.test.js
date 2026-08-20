"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(__dirname, "fixtures", "pe-persistence");
const EDITOR_SCHEMA = "pocket.nodeEditor.v1";
const UNKNOWN_EDITOR_MESSAGE = "This item uses editor data that this version of Pocket can't safely edit. Its readable text is shown below, and nothing will be changed.";
const CORE_INDEX_SCRIPTS = [
  "js/pocket-state.js",
  "js/pocket-data.js",
  "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js",
  "js/pocket-import.js",
];
const FULL_CONTRACT_SCRIPTS = CORE_INDEX_SCRIPTS.concat([
  "js/pocket-editor-copy.js",
  "js/pocket-history-status.js",
  "js/pocket-io-browser.js",
  "js/pocket-device-changes.js",
  "js/pocket-owner-save-boundary.js",
  "js/pocket-node-popout-model.js",
  "js/pocket-node-popout-target.js",
  "js/pocket-node-popout-editor.js",
]);
const FIXTURE_NAMES = [
  "current-outline-v1.json",
  "empty-text.json",
  "legacy-text.json",
  "malformed-editor.json",
  "root-precedence.json",
  "unknown-editor-schema.json",
];

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function indexScriptSources() {
  return Array.from(source("index.html").matchAll(/<script\s+src="([^"]+)"/g), (match) => match[1]);
}

function createBrowserContext(options = {}) {
  const storage = new Map();
  const storageWrites = [];
  const surfaceCalls = {
    exportTree: 0,
    writeTruthFile: 0,
    showOpenFilePicker: 0,
    showSaveFilePicker: 0,
  };
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const defaultDocument = {
    body: { classList },
    activeElement: null,
    getElementById() { return null; },
    addEventListener() {},
  };
  const context = {
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Promise,
    structuredClone: globalThis.structuredClone,
    location: { href: options.href || "https://example.test/index.html" },
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: options.document || defaultDocument,
    navigator: { clipboard: {} },
    localStorage: {
      getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
      setItem(key, value) {
        const safeKey = String(key);
        const safeValue = String(value);
        storage.set(safeKey, safeValue);
        storageWrites.push({ key: safeKey, value: safeValue });
      },
      removeItem(key) { storage.delete(String(key)); },
      clear() { storage.clear(); },
    },
    HTMLElement: options.HTMLElement || class HTMLElement {},
    HTMLInputElement: options.HTMLInputElement || class HTMLInputElement {},
    open() { return null; },
    close() {},
    confirm() { return true; },
    alert() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    cancelAnimationFrame() {},
    refreshMeta() {},
    renderTree() {},
    refocusTreeNavigation() {},
    softlyEnsureSelectionVisible() {},
    focusRowByNodeId() {},
    setStatus() {},
    flashSaveChip() {},
    requirePocketFileForChanges() { return true; },
    exportTree() {
      surfaceCalls.exportTree += 1;
      return Promise.resolve({ ok: true });
    },
    writeTruthFile() {
      surfaceCalls.writeTruthFile += 1;
      throw new Error("The P010 harness must not write a truth file.");
    },
    showOpenFilePicker() {
      surfaceCalls.showOpenFilePicker += 1;
      throw new Error("The P010 harness must not open a file picker.");
    },
    showSaveFilePicker() {
      surfaceCalls.showSaveFilePicker += 1;
      throw new Error("The P010 harness must not open a file picker.");
    },
    __storage: storage,
    __storageWrites: storageWrites,
    __surfaceCalls: surfaceCalls,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  return context;
}

function runScript(context, relativePath) {
  vm.runInContext(source(relativePath), context, { filename: relativePath });
}

function loadScriptsInIndexOrder(context, requestedScripts) {
  const scripts = indexScriptSources();
  const wanted = new Set(requestedScripts);
  const selected = scripts.filter((script) => wanted.has(script));
  assert.deepEqual(selected, requestedScripts, "requested scripts must follow the active index.html order");
  selected.forEach((script) => runScript(context, script));
  return selected;
}

function createCoreContext(options = {}) {
  const context = createBrowserContext(options);
  loadScriptsInIndexOrder(context, CORE_INDEX_SCRIPTS);
  return context;
}

function createFullContractContext(options = {}) {
  const context = createBrowserContext(options);
  loadScriptsInIndexOrder(context, FULL_CONTRACT_SCRIPTS);
  context.refreshMeta = () => {};
  context.renderTree = () => {};
  context.refocusTreeNavigation = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  context.focusRowByNodeId = () => {};
  context.setStatus = () => {};
  context.flashSaveChip = () => {};
  return context;
}

function lexicalState(context) {
  return vm.runInContext("state", context);
}

function resetState(context, nodes, ops = []) {
  const state = lexicalState(context);
  state.nodes = plain(nodes);
  state.tombstones = [];
  state.rootExtras = {};
  state.dataExtras = {};
  state.selectedId = "";
  state.focusRootId = "";
  state.collapsed = new Set();
  state.ops = plain(ops);
  state.source = { schema: "portal.export.v1", fileName: "synthetic.json", writtenAt: "2026-01-01T00:00:00.000Z" };
  state.conflictGuard = { active: false, reason: "", loadedAt: "", newerAt: "" };
  establishSyntheticSession(context);
  return state;
}

function establishSyntheticSession(context, name = "synthetic.json") {
  if (typeof context.setPocketFileSession !== "function") return null;
  if (!context.__syntheticTruthHandle) context.__syntheticTruthHandle = { name };
  context.setPocketFileSession(context.__syntheticTruthHandle, name, { forceNewSession: true });
  return plain(context.capturePocketEditorSourceIdentity());
}

function editorPayload(context, node, overrides = {}) {
  const current = lexicalState(context).nodes.find((candidate) => candidate.id === node.id) || node;
  return {
    ...plain(context.PocketNodePopoutModel.buildPayload(current)),
    ...plain(overrides),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function installTestSyncedOwner(context, options = {}) {
  let generation = 1;
  let active = true;
  let saves = 0;
  const controller = {
    captureSyncedOwnerSaveSession() {
      return active ? { generation } : null;
    },
    isSyncedOwnerSaveSessionCurrent(session) {
      return active && session?.generation === generation;
    },
    async saveSyncedOwner({ freezePayload }) {
      saves += 1;
      const payload = await freezePayload();
      options.onFrozen?.(payload);
      if (options.gate) await options.gate.promise;
      return options.result || { ok: true, reason: "saved", confirmedRemoteRevision: 2 };
    },
    releaseSyncedOwner() {
      active = false;
      generation += 1;
      return true;
    },
    get saves() { return saves; },
  };
  assert.equal(context.PocketOwnerSaveBoundary.installSyncedOwnerForSave(controller), true);
  return controller;
}

function snapshotSaveBoundary(context, nodeId) {
  const state = lexicalState(context);
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  return {
    node: plain(node),
    ops: plain(state.ops),
    selectedId: state.selectedId,
    storageWrites: context.__storageWrites.length,
    surfaceCalls: plain(context.__surfaceCalls),
  };
}

function assertSaveBoundaryUnchanged(context, nodeId, before) {
  const state = lexicalState(context);
  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  assert.deepEqual(plain(node), before.node);
  assert.deepEqual(plain(state.ops), before.ops);
  assert.equal(state.selectedId, before.selectedId);
  assert.equal(context.__storageWrites.length, before.storageWrites);
  assert.deepEqual(plain(context.__surfaceCalls), before.surfaceCalls);
}

function syntheticNode(id, overrides = {}) {
  return {
    id,
    parentId: "root",
    label: `Synthetic ${id}`,
    order: 1000,
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "fixture",
    ...overrides,
  };
}

function editorObjectAtLength(targetLength) {
  const value = {
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [{ id: "boundary_block", text: "Boundary", depth: 1, collapsed: false, order: 1 }],
    padding: "",
  };
  const baseLength = JSON.stringify(value).length;
  assert.ok(targetLength >= baseLength, "target editor length must fit the base object");
  value.padding = "x".repeat(targetLength - baseLength);
  assert.equal(JSON.stringify(value).length, targetLength);
  return value;
}

function largeCurrentEditor(blockCount = 36, textLength = 320) {
  const editor = {
    schema: EDITOR_SCHEMA,
    mode: "outline",
    futureTopLevel: { preserve: true, version: 2 },
    outline: Array.from({ length: blockCount }, (_, index) => ({
      id: `large_block_${index}`,
      text: `${String(index).padStart(3, "0")}:` + "x".repeat(textLength),
      depth: index === 0 ? 0 : Math.min(8, (index % 4) + 1),
      collapsed: index % 11 === 0,
      order: (blockCount - index) * 1000,
      ...(index === 0 ? { futureBlockField: { preserve: "raw" } } : {}),
    })),
  };
  assert.ok(JSON.stringify(editor).length > 8000);
  return editor;
}

function largeUnknownEditor() {
  const editor = {
    schema: "pocket.nodeEditor.v9",
    mode: "outline",
    futureTopLevel: { preserve: true },
    outline: [{
      id: "large_future_block",
      text: "Future outline content",
      depth: 4,
      collapsed: true,
      order: 9000,
      futureBlockField: true,
    }],
    padding: "u".repeat(9000),
  };
  assert.ok(JSON.stringify(editor).length > 8000);
  return editor;
}

function largeLegacyPe() {
  const pe = {
    schema: "pocket.pe.v1",
    title: "Large legacy PE",
    mode: "outline",
    text: "legacy:" + "p".repeat(12000),
    outline: Array.from({ length: 18 }, (_, index) => ({
      id: `legacy_line_${index}`,
      text: `Legacy ${index} ` + "q".repeat(240),
      depth: index === 0 ? 0 : 1,
      collapsed: index === 0,
      order: (index + 1) * 1000,
    })),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  assert.ok(JSON.stringify(pe).length > 8000);
  return pe;
}

function outlineMeta(outline) {
  return { schema: EDITOR_SCHEMA, mode: "outline", outline };
}

function normaliseOne(context, node) {
  const result = context.normaliseInput({
    schema: "portal.export.v1",
    writtenAt: "2026-01-01T00:00:00.000Z",
    mainThoughtTree: [node],
    mainThoughtTreeTombstones: [],
  });
  assert.equal(result.nodes.length, 1);
  return result.nodes[0];
}

function assertNoRetiredPe(value, label = "value") {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value)) {
    assert.equal(Object.hasOwn(value, "pe"), false, `${label} contains retired pe`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertNoRetiredPe(child, `${label}.${key}`);
  }
}

function loadAndExportFixture(name) {
  const context = createFullContractContext();
  const parsed = fixture(name);
  const normalised = context.normaliseInput(parsed);
  context.applyLoadedState(normalised, {
    schema: normalised.schema,
    fileName: name,
    writtenAt: normalised.writtenAt,
  }, { skipLocalSafetyCheck: true });
  const payload = context.buildPocketPayload("2026-02-01T00:00:00.000Z");
  return { context, parsed, normalised, state: lexicalState(context), payload };
}

function fakeElement(tagName = "div") {
  const element = {
    tagName: String(tagName).toUpperCase(),
    nodeType: 1,
    children: [],
    attributes: {},
    style: {},
    className: "",
    textContent: "",
    contentEditable: "false",
    spellcheck: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] || null; },
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    contains(child) { return this.children.includes(child); },
    focus() {},
  };
  Object.defineProperty(element, "innerHTML", {
    get() { return ""; },
    set() { this.children.length = 0; },
  });
  return element;
}

function createTreeRenderHarness(nodes, query = "", options = {}) {
  class TreeElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.childNodes = this.children;
      this.parentNode = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = { setProperty() {} };
      this.className = "";
      this.textContent = "";
      this.title = "";
      this.value = "";
      this.tabIndex = 0;
      this.scrollWidth = 0;
      this.clientWidth = 0;
      this.classList = {
        add: (...names) => {
          const classes = new Set(this.className.split(/\s+/).filter(Boolean));
          names.forEach((name) => classes.add(name));
          this.className = Array.from(classes).join(" ");
        },
        remove: (...names) => {
          const removed = new Set(names);
          this.className = this.className.split(/\s+/).filter((name) => name && !removed.has(name)).join(" ");
        },
        contains: (name) => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => {
          const next = force === undefined ? !this.classList.contains(name) : !!force;
          if (next) this.classList.add(name);
          else this.classList.remove(name);
          return next;
        },
      };
    }

    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    removeAttribute(name) {
      this.attributes.delete(String(name));
    }

    addEventListener(type, handler, capture = false) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      if (capture) this.listeners.get(type).unshift(handler);
      else this.listeners.get(type).push(handler);
    }

    removeEventListener(type, handler) {
      if (!this.listeners.has(type)) return;
      this.listeners.set(type, this.listeners.get(type).filter((candidate) => candidate !== handler));
    }

    listenerCount(type) {
      return (this.listeners.get(type) || []).length;
    }

    dispatch(type, values = {}) {
      const event = {
        type,
        target: this,
        button: 0,
        clientX: 0,
        clientY: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
        ...values,
      };
      for (const handler of this.listeners.get(type) || []) {
        handler(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      this.children = this.children.filter((candidate) => candidate !== child);
      child.parentNode = null;
      return child;
    }

    contains(candidate) {
      if (this === candidate || this.children.includes(candidate)) return true;
      return this.children.some((child) => typeof child.contains === "function" && child.contains(candidate));
    }

    querySelectorAll(selector) {
      const results = [];
      const matches = (candidate) => {
        const classes = String(candidate.className || "").split(/\s+/);
        if (selector === ".detailBadge") return classes.includes("detailBadge");
        if (selector === ".row") return classes.includes("row");
        if (selector === ".twisty") return classes.includes("twisty");
        if (selector === ".label[data-full-label]") {
          return classes.includes("label") && candidate.getAttribute("data-full-label") !== null;
        }
        const editId = selector.match(/^\[data-edit-id="([^"]+)"\]$/);
        return !!editId && candidate.getAttribute("data-edit-id") === editId[1];
      };
      const visit = (candidate) => {
        for (const child of candidate.children || []) {
          if (matches(child)) results.push(child);
          visit(child);
        }
      };
      visit(this);
      return results;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    closest(selector) {
      let candidate = this;
      while (candidate) {
        if (selector === ".row[data-node-id]"
          && String(candidate.className).split(/\s+/).includes("row")
          && candidate.getAttribute("data-node-id")) return candidate;
        candidate = candidate.parentNode;
      }
      return null;
    }

    getBoundingClientRect() {
      return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
    }

    focus() { document.activeElement = this; }

    select() {}
  }

  Object.defineProperty(TreeElement.prototype, "innerHTML", {
    get() { return ""; },
    set() { this.children.length = 0; },
  });

  const treeRoot = new TreeElement("ul");
  const search = new TreeElement("input");
  search.value = query;
  const elements = new Map([
    ["treeRoot", treeRoot],
    ["search", search],
  ]);
  const documentListeners = new Map();
  const document = {
    activeElement: null,
    body: new TreeElement("body"),
    documentElement: { clientWidth: 1024, clientHeight: 768 },
    createElement(tagName) { return new TreeElement(tagName); },
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!documentListeners.has(type)) return;
      documentListeners.set(type, documentListeners.get(type).filter((candidate) => candidate !== handler));
    },
    dispatch(type, values = {}) {
      const event = {
        type,
        target: values.target || document.body,
        button: 0,
        clientX: 0,
        clientY: 0,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
        ...values,
      };
      for (const handler of [...(documentListeners.get(type) || [])]) {
        handler(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    },
    elementFromPoint() { return document.pointedElement || null; },
  };
  const context = createBrowserContext({
    document,
    HTMLElement: TreeElement,
    HTMLInputElement: TreeElement,
  });
  const zeroTimers = new Map();
  let nextTimerId = 1;
  context.setTimeout = (handler, delay = 0) => {
    const timerId = nextTimerId++;
    if (Number(delay) > 0) {
      if (typeof handler === "function") handler();
      return timerId;
    }
    zeroTimers.set(timerId, handler);
    return timerId;
  };
  context.clearTimeout = (timerId) => zeroTimers.delete(timerId);
  context.canShowPocketTree = () => true;
  context.shouldCopyOnSingleClick = () => false;
  context.getPath = (nodeId) => {
    const node = lexicalState(context).nodes.find((candidate) => candidate.id === nodeId);
    return node ? node.label : "";
  };
  context.repairVisibleSelectionAfterRender = () => {};
  context.focusRowByNodeId = () => {};
  context.refreshMeta = () => {};
  context.scheduleCopyClick = () => {};
  context.cancelPendingCopyClick = () => {};
  loadScriptsInIndexOrder(context, CORE_INDEX_SCRIPTS.concat(options.withDragActions
    ? ["js/pocket-tree-actions.js", "js/pocket-render.js"]
    : ["js/pocket-render.js"]));
  context.repairVisibleSelectionAfterRender = () => {};
  context.focusRowByNodeId = () => {};
  context.refreshMeta = () => {};
  if (options.withDragActions) context.requestAnimationFrame = () => 1;
  if (!options.withDragActions) context.refocusTreeNavigation = () => {};
  const state = resetState(context, nodes);
  context.renderTree();
  return {
    context,
    state,
    treeRoot,
    badges: treeRoot.querySelectorAll(".detailBadge"),
    rows: treeRoot.querySelectorAll(".row"),
    flushZeroTimers() {
      const pending = [...zeroTimers.values()];
      zeroTimers.clear();
      pending.forEach((handler) => { if (typeof handler === "function") handler(); });
    },
    documentListenerCount: (type) => (documentListeners.get(type) || []).length,
  };
}

function loadRuntimeFactory() {
  const context = vm.createContext({ window: {} });
  runScript(context, "js/pocket-node-popout-runtime.js");
  return context.window.PocketNodePopoutRuntime;
}

function runtimeProbe(factory, payload) {
  const program = factory.build(JSON.stringify(payload));
  assert.doesNotThrow(() => new Function(program));
  const marker = "(function () {\n";
  assert.equal(program.indexOf(marker), 0);
  const injection = [
    marker,
    "  globalThis.__peRuntimeProbe = {",
    "    outlineBlocksFromPastedText: outlineBlocksFromPastedText,",
    "    renderEmptyOutline: function (pane) {",
    "      outline = [];",
    "      outlinePane = pane;",
    "      outlineSelectedIds = new Set();",
    "      outlineSelectionAnchorId = '';",
    "      renderOutline();",
    "      return outline;",
    "    }",
    "  };",
    "  return;",
    "",
  ].join("\n");
  const instrumented = program.replace(marker, injection);
  assert.notEqual(instrumented, program);
  const exposed = {};
  const fakeDocument = {
    activeElement: null,
    createElement(tagName) { return fakeElement(tagName); },
  };
  new Function("globalThis", "document", "requestAnimationFrame", instrumented)(exposed, fakeDocument, () => 1);
  return { program, probe: exposed.__peRuntimeProbe };
}

function executeControlledRuntime(payload, options = {}) {
  const factory = loadRuntimeFactory();
  const runtimePayload = {
    ...payload,
    popupOwnerToken: payload.popupOwnerToken || "owner_runtime_harness",
    popupInstanceToken: payload.popupInstanceToken || "popup_runtime_harness",
  };
  const listeners = new Map();
  const windowListeners = new Map();
  const controls = new Map();
  const applyCalls = [];
  const saveCalls = [];
  const alerts = [];
  const clipboardWrites = [];
  const classNames = new Set(["textMode"]);
  const zeroWindowTimers = new Map();
  let nextWindowTimerId = 1;
  let closeCalls = 0;

  function classList(set) {
    return {
      add(...names) { names.forEach((name) => set.add(name)); },
      remove(...names) { names.forEach((name) => set.delete(name)); },
      contains(name) { return set.has(name); },
      toggle(name, force) {
        const next = force === undefined ? !set.has(name) : !!force;
        if (next) set.add(name);
        else set.delete(name);
        return next;
      },
    };
  }

  const document = {
    activeElement: null,
    body: { classList: classList(classNames) },
    documentElement: { clientWidth: 1024, clientHeight: 768 },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((candidate) => candidate !== handler));
    },
    dispatch(type, values = {}) {
      const event = {
        type,
        target: values.target || document.body,
        key: "",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
        ...values,
      };
      for (const handler of [...(listeners.get(type) || [])]) {
        handler(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    },
    getElementById(id) { return controls.get(id) || null; },
    createElement(tagName) { return makeControl("", tagName); },
    elementFromPoint() { return document.pointedElement || null; },
    execCommand() { return true; },
  };

  function makeControl(id, tagName = "div") {
    const ownListeners = new Map();
    const ownClasses = new Set();
    const attributes = new Map();
    const control = {
      id,
      nodeType: 1,
      tagName: String(tagName).toUpperCase(),
      className: "",
      classList: classList(ownClasses),
      style: {},
      children: [],
      parentNode: null,
      hidden: false,
      disabled: false,
      readOnly: false,
      value: "",
      textContent: "",
      contentEditable: "false",
      isConnected: true,
      addEventListener(type, handler, capture = false) {
        if (!ownListeners.has(type)) ownListeners.set(type, []);
        if (capture) ownListeners.get(type).unshift(handler);
        else ownListeners.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        if (!ownListeners.has(type)) return;
        ownListeners.set(type, ownListeners.get(type).filter((candidate) => candidate !== handler));
      },
      listenerCount(type) { return (ownListeners.get(type) || []).length; },
      dispatch(type, values = {}) {
        const event = {
          type,
          target: control,
          key: "",
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() {},
          stopImmediatePropagation() { this.immediatePropagationStopped = true; },
          ...values,
        };
        for (const handler of ownListeners.get(type) || []) {
          handler(event);
          if (event.immediatePropagationStopped) break;
        }
        return event;
      },
      setAttribute(name, value) { attributes.set(String(name), String(value)); },
      getAttribute(name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; },
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; return child; },
      querySelectorAll(selector) {
        const results = [];
        const matches = (candidate) => {
          if (!candidate) return false;
          if (selector === ".outlineText[data-block-id]") return String(candidate.className).split(/\s+/).includes("outlineText") && candidate.getAttribute("data-block-id");
          if (selector === ".outlineRow[data-block-id]") return String(candidate.className).split(/\s+/).includes("outlineRow") && candidate.getAttribute("data-block-id");
          if (selector === ".outlineSelect") return String(candidate.className).split(/\s+/).includes("outlineSelect");
          if (selector === ".outlineToggle") return String(candidate.className).split(/\s+/).includes("outlineToggle");
          if (selector === ".outlineText") return String(candidate.className).split(/\s+/).includes("outlineText");
          if (selector === "button[data-outline-action]") return candidate.tagName === "BUTTON" && !!candidate.getAttribute("data-outline-action");
          return false;
        };
        const visit = (candidate) => {
          for (const child of candidate.children || []) {
            if (matches(child)) results.push(child);
            visit(child);
          }
        };
        visit(this);
        return results;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      closest(selector) {
        let candidate = this;
        while (candidate) {
          if (selector === ".outlineText[data-block-id]" && String(candidate.className).split(/\s+/).includes("outlineText") && candidate.getAttribute("data-block-id")) return candidate;
          if (selector === ".outlineRow[data-block-id]" && String(candidate.className).split(/\s+/).includes("outlineRow") && candidate.getAttribute("data-block-id")) return candidate;
          if (selector === "button[data-outline-action]" && candidate.tagName === "BUTTON" && candidate.getAttribute("data-outline-action")) return candidate;
          candidate = candidate.parentNode;
        }
        return null;
      },
      contains(child) {
        if (this.children.includes(child)) return true;
        return this.children.some((candidate) => candidate.contains && candidate.contains(child));
      },
      focus() { document.activeElement = control; },
      select() {},
      getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }; },
    };
    Object.defineProperty(control, "innerHTML", {
      get() { return ""; },
      set() { control.children.length = 0; },
    });
    return control;
  }

  const tags = {
    titleInput: "input",
    bodyInput: "textarea",
    outlinePane: "div",
    textModeBtn: "button",
    outlineModeBtn: "button",
    saveState: "span",
    saveBtn: "button",
    saveCloseBtn: "button",
    outlineContextMenu: "div",
    unsavedDialog: "div",
    unsavedSaveBtn: "button",
    unsavedDiscardBtn: "button",
    unsavedCancelBtn: "button",
    closeBtn: "button",
  };
  for (const [id, tagName] of Object.entries(tags)) controls.set(id, makeControl(id, tagName));
  controls.get("titleInput").value = payload.title || "";
  controls.get("bodyInput").value = payload.body || "";
  controls.get("outlineContextMenu").hidden = true;
  controls.get("unsavedDialog").hidden = true;

  const openerBridge = {
    closed: options.openerClosed === true,
    PocketNodePopoutWindow: {
      applyAndSaveFromOwnedPopup(ownerToken, popupToken, nextPayload, callerWindow) {
        assert.equal(ownerToken, runtimePayload.popupOwnerToken);
        assert.equal(popupToken, runtimePayload.popupInstanceToken);
        assert.strictEqual(callerWindow, window);
        saveCalls.push(nextPayload);
        if (typeof options.applyAndSave === "function") {
          return Promise.resolve(options.applyAndSave(nextPayload, saveCalls.length));
        }
        return Promise.resolve({
          ok: true,
          applied: true,
          changed: true,
          exported: true,
          reason: "exported",
          nodeUpdatedAt: "2026-01-01T00:00:01.000Z",
          sourceIdentity: {
            fileSessionId: nextPayload.fileSessionId,
            sourceFileName: nextPayload.sourceFileName,
            sourcePipSession: nextPayload.sourcePipSession,
            sourceOwnerKind: nextPayload.sourceOwnerKind,
            sourceVaultSessionId: nextPayload.sourceVaultSessionId,
          },
        });
      },
      completeCloseFromOwnedPopup(ownerToken, popupToken, callerWindow) {
        assert.strictEqual(callerWindow, window);
        return callerWindow.PocketNodePopoutSession.requestOwnedClose(ownerToken, popupToken);
      },
      cancelPendingOpen(ownerToken, popupToken, callerWindow) {
        assert.equal(ownerToken, runtimePayload.popupOwnerToken);
        assert.equal(popupToken, runtimePayload.popupInstanceToken);
        assert.strictEqual(callerWindow, window);
        return true;
      },
    },
  };
  const window = {
    opener: openerBridge,
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    dispatch(type, values = {}) {
      const event = {
        type,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...values,
      };
      for (const handler of windowListeners.get(type) || []) handler(event);
      return event;
    },
    setTimeout(handler, delay = 0) {
      const timerId = nextWindowTimerId++;
      if (Number(delay) > 0) {
        if (typeof handler === "function") handler();
        return timerId;
      }
      zeroWindowTimers.set(timerId, handler);
      return timerId;
    },
    clearTimeout(timerId) { zeroWindowTimers.delete(timerId); },
    close() { closeCalls += 1; },
    focus() {},
  };
  const program = factory.build(JSON.stringify(runtimePayload));
  assert.doesNotThrow(() => new Function(program));
  new Function("window", "document", "navigator", "requestAnimationFrame", "alert", "console", program)(
    window,
    document,
    {
      clipboard: {
        writeText(text) {
          clipboardWrites.push(String(text));
          return Promise.resolve();
        },
        readText() {
          return Promise.resolve(typeof options.clipboardText === "string" ? options.clipboardText : "");
        },
      },
    },
    (callback) => { if (typeof callback === "function") callback(); return 1; },
    (message) => { alerts.push(String(message)); },
    { log() {}, info() {}, warn() {}, error() {} },
  );
  return {
    program,
    window,
    document,
    controls,
    applyCalls,
    saveCalls,
    alerts,
    clipboardWrites,
    classNames,
    closeCalls: () => closeCalls,
    windowListenerCount: (type) => (windowListeners.get(type) || []).length,
    documentListenerCount: (type) => (listeners.get(type) || []).length,
    flushZeroTimers() {
      const pending = [...zeroWindowTimers.values()];
      zeroWindowTimers.clear();
      pending.forEach((handler) => { if (typeof handler === "function") handler(); });
    },
  };
}

async function settleRuntime() {
  await Promise.resolve();
  await Promise.resolve();
}

function runtimeEditablePayload(overrides = {}) {
  return {
    id: "runtime_editable",
    title: "Runtime editable",
    body: "Before",
    mode: "text",
    outline: null,
    fileSessionId: 7,
    sourceFileName: "runtime.json",
    sourcePipSession: false,
    sourceOwnerKind: "json",
    sourceVaultSessionId: "",
    originalUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("synthetic fixture inventory is compact and valid JSON", () => {
  const names = fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(names, FIXTURE_NAMES);
  for (const name of names) {
    const text = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
    assert.ok(text.length < 5000, `${name} should remain compact`);
    assert.doesNotThrow(() => JSON.parse(text));
  }
});

test("index load order establishes pocket-import.js as the deliberate first-class normaliseNodes owner", () => {
  const context = createBrowserContext();
  const scripts = indexScriptSources();
  const requested = CORE_INDEX_SCRIPTS;
  assert.deepEqual(scripts.filter((script) => requested.includes(script)), requested);

  runScript(context, requested[0]);
  runScript(context, requested[1]);
  assert.equal(typeof context.normaliseNodes, "undefined");
  runScript(context, requested[2]);
  assert.equal(typeof context.normaliseNodes, "undefined");
  assert.equal(context.PocketEditorMetadata.EDITOR_SCHEMA, EDITOR_SCHEMA);
  assert.equal(typeof context.PocketEditorMetadata.classifyEditorMeta, "function");
  assert.equal(typeof context.PocketEditorMetadata.copyFirstClassNodeFields, "function");
  runScript(context, requested[3]);
  assert.equal(typeof context.normaliseNodes, "undefined");
  assert.equal(context.__pocketPeImportPreserveInstalled, undefined);
  runScript(context, requested[4]);
  assert.equal(typeof context.normaliseNodes, "undefined");
  runScript(context, requested[5]);
  const finalOwner = context.normaliseNodes;

  assert.equal(typeof finalOwner, "function");
  assert.equal(vm.runInContext("normaliseNodes === window.normaliseNodes", context), true);

  const raw = [syntheticNode("owner_probe", { details: "Fallback", editor: editorObjectAtLength(8001) })];
  const throughFinalOwner = finalOwner(raw)[0];
  assert.equal(throughFinalOwner.editor.schema, EDITOR_SCHEMA);
  assert.equal(JSON.stringify(throughFinalOwner.editor).length, 8001);

  const smallFutureEditor = { schema: "pocket.nodeEditor.v9", mode: "outline", outline: [{ text: "Future", depth: 1 }], futureField: true };
  const throughFinalUnknown = finalOwner([syntheticNode("metadata_probe", { editor: smallFutureEditor })])[0];
  assert.deepEqual(plain(throughFinalUnknown.editor), smallFutureEditor);
  assert.notStrictEqual(throughFinalUnknown.editor, smallFutureEditor);
});

test("generic node extras enforce the 24-field and scalar boundaries", () => {
  const context = createCoreContext();
  const raw = {};
  for (let index = 0; index < 25; index += 1) raw[`extra${String(index).padStart(2, "0")}`] = index;
  const extras = context.normaliseNodeExtras(raw);
  assert.equal(Object.keys(extras).length, 24);
  assert.equal(extras.extra23, 23);
  assert.equal(Object.hasOwn(extras, "extra24"), false);

  const scalars = context.normaliseNodeExtras({
    longString: "x".repeat(1201),
    finite: 12.5,
    invalidNumber: Infinity,
    boolean: true,
    nullable: null,
    "invalid key": "drop",
  });
  assert.equal(scalars.longString.length, 1200);
  assert.equal(scalars.finite, 12.5);
  assert.equal(Object.hasOwn(scalars, "invalidNumber"), false);
  assert.equal(scalars.boolean, true);
  assert.equal(scalars.nullable, null);
  assert.equal(Object.hasOwn(scalars, "invalid key"), false);
  const longKey = "k".repeat(49);
  const truncatedKeyExtras = context.normaliseNodeExtras({ [longKey]: "kept" });
  assert.equal(truncatedKeyExtras["k".repeat(48)], "kept");
});

test("editor remains first-class while retired pe stays reserved outside generic extras regardless of property order", () => {
  const context = createCoreContext();
  const crowded = syntheticNode("crowded");
  for (let index = 0; index < 24; index += 1) crowded[`extra${String(index).padStart(2, "0")}`] = index;
  crowded.editor = { schema: EDITOR_SCHEMA, mode: "outline", outline: [{ text: "Kept?", depth: 1 }] };
  crowded.pe = { schema: "pocket.pe.v1", mode: "text", text: "Kept?" };
  const normalised = normaliseOne(context, crowded);
  assert.equal(normalised.editor.schema, EDITOR_SCHEMA);
  assert.equal(Object.hasOwn(normalised, "pe"), false);
  assert.equal(normalised.extra23, 23);
  assert.equal(Object.keys(context.normaliseNodeExtras(crowded)).length, 24);
  assert.equal(Object.hasOwn(context.normaliseNodeExtras(crowded), "editor"), false);
  assert.equal(Object.hasOwn(context.normaliseNodeExtras(crowded), "pe"), false);

  const early = syntheticNode("early", {
    editor: { schema: EDITOR_SCHEMA, mode: "outline", outline: [{ text: "Kept?", depth: 1 }] },
    pe: { schema: "pocket.pe.v1", mode: "text", text: "Kept?" },
  });
  for (let index = 0; index < 24; index += 1) early[`extra${String(index).padStart(2, "0")}`] = index;
  const earlyNormalised = normaliseOne(context, early);
  assert.equal(earlyNormalised.editor.schema, EDITOR_SCHEMA);
  assert.equal(Object.hasOwn(earlyNormalised, "pe"), false);
  assert.equal(earlyNormalised.extra23, 23);
  assert.deepEqual(plain(earlyNormalised.editor), plain(normalised.editor));
});

test("root extras enforce the current 32-field, string, and object boundaries", () => {
  const context = createCoreContext();
  const raw = {};
  for (let index = 0; index < 33; index += 1) raw[`rootExtra${String(index).padStart(2, "0")}`] = index;
  const extras = context.normaliseRootExtras(raw);
  assert.equal(Object.keys(extras).length, 32);
  assert.equal(Object.hasOwn(extras, "rootExtra32"), false);
  assert.equal(context.normaliseRootExtras({ text: "x".repeat(2001) }).text.length, 2000);
  const longKey = "k".repeat(65);
  assert.equal(context.normaliseRootExtras({ [longKey]: "kept" })["k".repeat(64)], "kept");

  const accepted = { padding: "" };
  accepted.padding = "x".repeat(12000 - JSON.stringify(accepted).length);
  assert.equal(JSON.stringify(accepted).length, 12000);
  const rejected = { ...accepted, padding: accepted.padding + "x" };
  assert.deepEqual(plain(context.normaliseRootExtras({ accepted })), { accepted });
  assert.equal(context.normaliseRootExtras({ rejected }), null);
});

test("normaliseInput applies current schema-specific root precedence", () => {
  const context = createCoreContext();
  const rootTree = [syntheticNode("root_winner")];
  const dataTree = [syntheticNode("data_winner")];
  const snapshotTree = [syntheticNode("snapshot_winner")];
  const cases = [
    {
      input: { schema: "portal.export.v1", mainThoughtTree: rootTree, data: { mainThoughtTree: dataTree } },
      schema: "portal.export.v1",
      winner: "root_winner",
    },
    {
      input: { schema: "portal.mtt.web.v1", mainThoughtTree: rootTree, data: { mainThoughtTree: dataTree } },
      schema: "portal.mtt.web.v1",
      winner: "data_winner",
    },
    {
      input: { schema: "portal.sync.v1", mainThoughtTree: rootTree, data: { mainThoughtTree: dataTree } },
      schema: "portal.sync.v1",
      winner: "data_winner",
    },
    {
      input: { schema: "portal.pocketlite.changes.v1", snapshot: { data: { mainThoughtTree: snapshotTree } } },
      schema: "portal.pocketlite.changes.v1",
      winner: "snapshot_winner",
    },
    { input: rootTree, schema: "array.nodes", winner: "root_winner" },
    { input: { schema: "future.root.v9", mainThoughtTree: rootTree }, schema: "future.root.v9", winner: "root_winner" },
  ];
  for (const item of cases) {
    const result = context.normaliseInput(item.input);
    assert.equal(result.schema, item.schema);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].id, item.winner);
  }

  const unsupportedNestedOnly = context.normaliseInput({ schema: "future.root.v9", data: { mainThoughtTree: dataTree } });
  assert.equal(unsupportedNestedOnly.schema, "");
  assert.equal(unsupportedNestedOnly.nodes.length, 0);
});

test("ordinary, alternate-root, change-log, and array normalisation all discard pe centrally", () => {
  const context = createCoreContext();
  const rawNode = syntheticNode("alternate_pe", {
    details: "Current alternate Notes",
    editor: outlineMeta([{ id: "alternate_outline", text: "Current alternate Outline", depth: 0, collapsed: false }]),
    pe: { schema: "pocket.pe.v1", text: "Retired alternate shadow" },
  });
  const cases = [
    { schema: "portal.export.v1", mainThoughtTree: [rawNode], mainThoughtTreeTombstones: [] },
    { schema: "portal.mtt.web.v1", data: { mainThoughtTree: [rawNode], mainThoughtTreeTombstones: [] } },
    { schema: "portal.sync.v1", data: { mainThoughtTree: [rawNode], mainThoughtTreeTombstones: [] } },
    {
      schema: "portal.pocketlite.changes.v1",
      snapshot: { data: { mainThoughtTree: [rawNode], mainThoughtTreeTombstones: [] } },
    },
    [rawNode],
    { schema: "future.root.v9", mainThoughtTree: [rawNode], mainThoughtTreeTombstones: [] },
  ];
  for (const [index, input] of cases.entries()) {
    const result = context.normaliseInput(input);
    assert.equal(result.nodes.length, 1, `case ${index}`);
    assert.equal(result.nodes[0].details, "Current alternate Notes", `case ${index}`);
    assert.equal(result.nodes[0].editor.outline[0].text, "Current alternate Outline", `case ${index}`);
    assert.equal(Object.hasOwn(result.nodes[0], "pe"), false, `case ${index}`);
  }
});

test("normaliseDetails applies the current whitespace policy", () => {
  const context = createCoreContext();
  assert.equal(context.normaliseDetails(""), "");
  assert.equal(context.normaliseDetails("  \n\t  "), "");
  assert.equal(context.normaliseDetails("A\rB\r\nC"), "AB\nC");
  assert.equal(context.normaliseDetails("A\tB\n\tChild"), "A  B\n  Child");
  assert.equal(context.normaliseDetails("Line one   \nLine two\t  "), "Line one\nLine two");
  assert.equal(context.normaliseDetails("  Outer\nInner  "), "Outer\nInner");
  assert.equal(context.normaliseDetails("A\n\n\n\nB"), "A\n\nB");
});

test("normaliseDetails enforces the 3,999, 4,000, and 4,001-character boundary", () => {
  const context = createCoreContext();
  assert.equal(context.normaliseDetails("x".repeat(3999)).length, 3999);
  assert.equal(context.normaliseDetails("x".repeat(4000)).length, 4000);
  assert.equal(context.normaliseDetails("x".repeat(4001)).length, 4000);
});

test("active node load omits empty and whitespace-only details", () => {
  const context = createCoreContext();
  const empty = normaliseOne(context, syntheticNode("empty", { details: "" }));
  const whitespace = normaliseOne(context, syntheticNode("whitespace", { details: " \n\t " }));
  assert.equal(Object.hasOwn(empty, "details"), false);
  assert.equal(Object.hasOwn(whitespace, "details"), false);
});

test("active node normalisation enforces current core-field cleaning boundaries", () => {
  const context = createCoreContext();
  const bounded = normaliseOne(context, syntheticNode("i".repeat(81), {
    parentId: "p".repeat(81),
    label: "L".repeat(221),
    order: 1.6,
    updatedAt: "u".repeat(41),
    source: "s".repeat(31),
  }));
  assert.equal(bounded.id.length, 80);
  assert.equal(bounded.parentId.length, 80);
  assert.equal(bounded.label.length, 220);
  assert.equal(bounded.order, 2);
  assert.equal(bounded.updatedAt.length, 40);
  assert.equal(bounded.source.length, 30);

  const defaults = normaliseOne(context, syntheticNode("defaults", { parentId: "", updatedAt: "", source: "" }));
  assert.equal(defaults.parentId, "root");
  assert.equal(defaults.source, "manual");
  assert.ok(Number.isFinite(Date.parse(defaults.updatedAt)));
});

test("active load preserves small and exactly 8,000-character editor objects", () => {
  const context = createCoreContext();
  const smallEditor = { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [{ id: "small", text: "Small", depth: 1 }] };
  const small = normaliseOne(context, syntheticNode("small_editor", { details: "Fallback", editor: smallEditor }));
  assert.deepEqual(plain(small.editor), smallEditor);
  assert.equal(small.details, "Fallback");

  const boundaryEditor = editorObjectAtLength(8000);
  const boundary = normaliseOne(context, syntheticNode("boundary_editor", { details: "Fallback", editor: boundaryEditor }));
  assert.equal(JSON.stringify(boundary.editor).length, 8000);
  assert.equal(boundary.details, "Fallback");
});

test("active load preserves editor metadata above the generic 8,000-character object cap", () => {
  const context = createCoreContext();
  const sourceEditor = editorObjectAtLength(8001);
  const oversized = normaliseOne(context, syntheticNode("oversized_editor", {
    details: "Fallback remains",
    editor: sourceEditor,
  }));
  assert.equal(Object.hasOwn(oversized, "editor"), true);
  assert.equal(JSON.stringify(oversized.editor).length, 8001);
  assert.deepEqual(plain(oversized.editor), sourceEditor);
  assert.notStrictEqual(oversized.editor, sourceEditor);
  assert.equal(oversized.details, "Fallback remains");
});

test("large current v1 Outline survives load, export, reload, and active model opening", () => {
  const context = createFullContractContext();
  const editor = largeCurrentEditor();
  const input = {
    schema: "portal.export.v1",
    writtenAt: "2026-01-01T00:00:00.000Z",
    mainThoughtTree: [syntheticNode("large_current", {
      details: "Readable large Outline fallback",
      editor,
      pe: null,
    })],
    mainThoughtTreeTombstones: [],
  };
  const first = context.normaliseInput(input);
  assert.equal(JSON.stringify(first.nodes[0].editor), JSON.stringify(editor));
  assert.notStrictEqual(first.nodes[0].editor, editor);
  assert.equal(context.PocketNodePopoutModel.classifyNodeEditor(first.nodes[0]).kind, "supported-v1-outline");

  const opening = context.PocketNodePopoutModel.buildPayload(first.nodes[0]);
  assert.equal(opening.mode, "outline");
  assert.equal(opening.schema, EDITOR_SCHEMA);
  assert.equal(opening.outline.length, editor.outline.length);
  assert.equal(opening.outline.at(-1).text, editor.outline.at(-1).text);
  assert.equal(Object.hasOwn(opening, "futureTopLevel"), false);
  assert.equal(Object.hasOwn(opening.outline[0], "futureBlockField"), false);
  assert.deepEqual(plain(opening.outline.map((block) => block.order)), editor.outline.map((_block, index) => index + 1));
  assert.notEqual(opening.outline[0].order, editor.outline[0].order);

  context.applyLoadedState(first, {
    schema: first.schema,
    fileName: "large-current.json",
    writtenAt: first.writtenAt,
  }, { skipLocalSafetyCheck: true });
  establishSyntheticSession(context, "large-current.json");
  const exported = context.buildPocketPayload("2026-02-01T00:00:00.000Z");
  assert.equal(JSON.stringify(exported.mainThoughtTree[0].editor), JSON.stringify(editor));
  const reloaded = context.normaliseInput(exported);
  assert.equal(JSON.stringify(reloaded.nodes[0].editor), JSON.stringify(editor));
  assert.equal(context.PocketNodePopoutModel.buildPayload(reloaded.nodes[0]).outline.length, editor.outline.length);

  const editedPayload = context.PocketNodePopoutModel.buildPayload(lexicalState(context).nodes[0]);
  editedPayload.body = "Explicitly edited projection";
  editedPayload.outline[0].text = "Explicitly edited Outline";
  assert.equal(context.PocketNodePopoutEditor.apply(editedPayload), true);
  const editedNode = lexicalState(context).nodes[0];
  assert.deepEqual(Object.keys(editedNode.editor).sort(), ["mode", "outline", "schema"]);
  assert.equal(Object.hasOwn(editedNode.editor, "futureTopLevel"), false);
  assert.equal(Object.hasOwn(editedNode.editor.outline[0], "futureBlockField"), false);
  assert.deepEqual(Object.keys(editedNode.editor.outline[0]).sort(), ["collapsed", "depth", "id", "order", "text"]);
  assert.deepEqual(plain(editedNode.editor.outline.map((block) => block.order)), editor.outline.map((_block, index) => index + 1));
  assert.equal(editedNode.details, "Explicitly edited projection");
  assert.equal(Object.hasOwn(editedNode, "pe"), false);
  assert.equal(context.__surfaceCalls.exportTree, 0);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
});

test("large unknown-schema editor survives load, export, and reload while opening read-only rather than as v1", () => {
  const context = createFullContractContext();
  const editor = largeUnknownEditor();
  const input = {
    schema: "portal.export.v1",
    writtenAt: "2026-01-01T00:00:00.000Z",
    mainThoughtTree: [syntheticNode("large_unknown", {
      details: "Readable future projection",
      editor,
      pe: null,
    })],
    mainThoughtTreeTombstones: [],
  };
  const first = context.normaliseInput(input);
  assert.equal(JSON.stringify(first.nodes[0].editor), JSON.stringify(editor));
  assert.notStrictEqual(first.nodes[0].editor, editor);
  assert.equal(context.PocketNodePopoutModel.classifyNodeEditor(first.nodes[0]).kind, "unsupported-or-malformed");

  const opening = context.PocketNodePopoutModel.buildPayload(first.nodes[0]);
  assert.equal(opening.mode, "text");
  assert.equal(opening.outline, null);
  assert.equal(opening.body, "Readable future projection");
  assert.equal(opening.readOnly, true);
  assert.equal(opening.readOnlyReason, "unsupported-editor");
  assert.equal(opening.editorSchema, "pocket.nodeEditor.v9");
  assert.equal(Object.hasOwn(opening, "schema"), false);
  assert.equal(Object.hasOwn(opening, "editor"), false);

  context.applyLoadedState(first, {
    schema: first.schema,
    fileName: "large-unknown.json",
    writtenAt: first.writtenAt,
  }, { skipLocalSafetyCheck: true });
  const exported = context.buildPocketPayload("2026-02-01T00:00:00.000Z");
  assert.equal(JSON.stringify(exported.mainThoughtTree[0].editor), JSON.stringify(editor));
  const reloaded = context.normaliseInput(exported);
  assert.equal(JSON.stringify(reloaded.nodes[0].editor), JSON.stringify(editor));
  assert.equal(context.PocketNodePopoutModel.buildPayload(reloaded.nodes[0]).readOnly, true);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
});

test("large legacy pe is discarded on load, export, and reload without affecting current Notes", () => {
  const context = createFullContractContext();
  const pe = largeLegacyPe();
  const input = {
    schema: "portal.export.v1",
    writtenAt: "2026-01-01T00:00:00.000Z",
    mainThoughtTree: [syntheticNode("large_pe", { details: "Current readable Text", pe })],
    mainThoughtTreeTombstones: [],
  };
  const first = context.normaliseInput(input);
  assert.equal(Object.hasOwn(first.nodes[0], "pe"), false);

  const opening = context.PocketNodePopoutModel.buildPayload(first.nodes[0]);
  assert.equal(opening.mode, "text");
  assert.equal(opening.outline, null);
  assert.equal(opening.body, "Current readable Text");
  assert.equal(Object.hasOwn(opening, "pe"), false);
  assert.equal(Object.hasOwn(opening, "readOnly"), false);

  context.applyLoadedState(first, {
    schema: first.schema,
    fileName: "large-pe.json",
    writtenAt: first.writtenAt,
  }, { skipLocalSafetyCheck: true });
  const exported = context.buildPocketPayload("2026-02-01T00:00:00.000Z");
  assert.equal(Object.hasOwn(exported.mainThoughtTree[0], "pe"), false);
  assert.equal(Object.hasOwn(exported.data.mainThoughtTree[0], "pe"), false);
  const reloaded = context.normaliseInput(exported);
  assert.equal(Object.hasOwn(reloaded.nodes[0], "pe"), false);
  assert.equal(context.PocketNodePopoutModel.buildPayload(reloaded.nodes[0]).mode, "text");
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
});

test("first-class editor values survive while pe null, scalar, and array values are discarded", () => {
  const context = createFullContractContext();
  const cases = [
    { id: "first_class_null", editor: null, pe: null, readOnly: false },
    { id: "first_class_scalar", editor: "future-editor-scalar", pe: 27, readOnly: true },
    { id: "first_class_array", editor: ["future", { nested: true }], pe: ["legacy", 4], readOnly: true },
  ];
  const input = {
    schema: "portal.export.v1",
    writtenAt: "2026-01-01T00:00:00.000Z",
    mainThoughtTree: cases.map((item) => syntheticNode(item.id, {
      details: `Readable ${item.id}`,
      editor: item.editor,
      pe: item.pe,
    })),
    mainThoughtTreeTombstones: [],
  };

  const first = context.normaliseInput(input);
  for (const item of cases) {
    const node = first.nodes.find((candidate) => candidate.id === item.id);
    assert.equal(JSON.stringify(node.editor), JSON.stringify(item.editor));
    assert.equal(Object.hasOwn(node, "pe"), false);
    const opening = context.PocketNodePopoutModel.buildPayload(node);
    assert.equal(opening.mode, "text");
    assert.equal(opening.outline, null);
    assert.equal(opening.readOnly === true, item.readOnly);
    assert.equal(Object.hasOwn(opening, "editor"), false);
  }

  context.applyLoadedState(first, {
    schema: first.schema,
    fileName: "first-class-values.json",
    writtenAt: first.writtenAt,
  }, { skipLocalSafetyCheck: true });
  const exported = context.buildPocketPayload("2026-02-01T00:00:00.000Z");
  const reloaded = context.normaliseInput(exported);
  for (const item of cases) {
    const exportedNode = exported.mainThoughtTree.find((candidate) => candidate.id === item.id);
    const reloadedNode = reloaded.nodes.find((candidate) => candidate.id === item.id);
    assert.equal(JSON.stringify(exportedNode.editor), JSON.stringify(item.editor));
    assert.equal(JSON.stringify(reloadedNode.editor), JSON.stringify(item.editor));
    assert.equal(Object.hasOwn(exportedNode, "pe"), false);
    assert.equal(Object.hasOwn(reloadedNode, "pe"), false);
  }
  const nullOpening = context.PocketNodePopoutModel.buildPayload(reloaded.nodes.find((node) => node.id === "first_class_null"));
  assert.equal(Object.hasOwn(nullOpening, "readOnly"), false);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
});

test("non-JSON editor fails closed while a cyclic pe value is ignored without discarding the node", async () => {
  const context = createFullContractContext();
  const cyclicEditor = {
    schema: EDITOR_SCHEMA,
    mode: "outline",
    outline: [{ id: "cyclic_block", text: "Must not become editable", depth: 1 }],
  };
  cyclicEditor.self = cyclicEditor;
  const loaded = normaliseOne(context, syntheticNode("cyclic_editor", {
    details: "Readable cyclic fallback",
    editor: cyclicEditor,
    pe: null,
  }));

  assert.equal(loaded.label, "Synthetic cyclic_editor");
  assert.equal(loaded.details, "Readable cyclic fallback");
  assert.strictEqual(loaded.editor, cyclicEditor);
  assert.equal(context.PocketNodePopoutModel.classifyNodeEditor(loaded).kind, "unsupported-or-malformed");
  const opening = context.PocketNodePopoutModel.buildPayload(loaded);
  assert.equal(opening.readOnly, true);
  assert.equal(opening.mode, "text");
  assert.equal(opening.outline, null);
  assert.equal(opening.body, "Readable cyclic fallback");

  const state = lexicalState(context);
  state.nodes = [loaded];
  state.ops = [];
  state.selectedId = loaded.id;
  establishSyntheticSession(context);
  const boundOpening = context.PocketNodePopoutModel.buildPayload(loaded);
  let exportCalls = 0;
  context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
  const rejected = await context.PocketNodePopoutEditor.applyAndSave(boundOpening);
  assert.equal(rejected.reason, "unsupported-editor");
  assert.equal(rejected.applied, false);
  assert.equal(rejected.exported, false);
  assert.equal(state.nodes[0].label, "Synthetic cyclic_editor");
  assert.equal(state.nodes[0].details, "Readable cyclic fallback");
  assert.strictEqual(state.nodes[0].editor, cyclicEditor);
  assert.equal(state.ops.length, 0);
  assert.equal(exportCalls, 0);

  const cyclicPe = { schema: "pocket.pe.v1", mode: "text", text: "Legacy cyclic value" };
  cyclicPe.self = cyclicPe;
  const loadedPe = normaliseOne(context, syntheticNode("cyclic_pe", {
    details: "Readable cyclic pe fallback",
    pe: cyclicPe,
  }));
  assert.equal(Object.hasOwn(loadedPe, "pe"), false);
  assert.equal(Object.hasOwn(loadedPe, "editor"), false);
  assert.equal(context.PocketNodePopoutModel.classifyNodeEditor(loadedPe).kind, "none");
  const peOpening = context.PocketNodePopoutModel.buildPayload(loadedPe);
  assert.equal(Object.hasOwn(peOpening, "readOnly"), false);
  assert.equal(peOpening.body, "Readable cyclic pe fallback");
  state.nodes = [loadedPe];
  state.ops = [];
  state.selectedId = loadedPe.id;
  const boundPeOpening = context.PocketNodePopoutModel.buildPayload(loadedPe);
  boundPeOpening.body = "Editable current Notes";
  const savedPe = await context.PocketNodePopoutEditor.applyAndSave(boundPeOpening);
  assert.equal(savedPe.ok, true);
  assert.equal(savedPe.applied, true);
  assert.equal(Object.hasOwn(state.nodes[0], "pe"), false);
  assert.equal(state.nodes[0].details, "Editable current Notes");
  assert.equal(state.ops.length, 1);
  assert.equal(exportCalls, 1);
});

test("active PE model accepts current flat and nested non-empty Outlines", () => {
  const context = createFullContractContext();
  const model = context.PocketNodePopoutModel;
  const flat = model.normaliseEditorMeta({
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [{ id: "flat", text: "Flat", depth: 0, collapsed: false, order: 90 }],
  });
  assert.equal(flat.schema, "pocket.nodeEditor.v1");
  assert.equal(flat.outline.length, 1);
  assert.equal(flat.outline[0].order, 1);

  const nested = model.normaliseEditorMeta({
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [
      { id: "parent", text: "Parent", depth: 0, collapsed: true },
      { id: "child", text: "Child", depth: 1, collapsed: false },
    ],
  });
  assert.deepEqual(plain(nested.outline.map((block) => block.depth)), [0, 1]);
  assert.equal(nested.outline[0].collapsed, true);
});

test("active PE model exact-gates v1 and rejects absent, Text, empty, blank, unknown, and malformed states", () => {
  const context = createFullContractContext();
  const model = context.PocketNodePopoutModel;
  const rejected = [
    undefined,
    null,
    "invalid",
    { schema: EDITOR_SCHEMA, mode: "text", outline: [{ text: "Text", depth: 1 }] },
    { schema: EDITOR_SCHEMA, mode: "outline", outline: [] },
    { schema: EDITOR_SCHEMA, mode: "outline", outline: [{ id: "blank", text: "", depth: 0, collapsed: false }] },
    { schema: EDITOR_SCHEMA, mode: "outline", outline: "invalid" },
    { mode: "outline", outline: [{ text: "Missing schema", depth: 1 }] },
    { schema: "pocket.nodeEditor.v9", mode: "outline", outline: [{ text: "Future", depth: 1 }] },
  ];
  for (const value of rejected) assert.equal(model.normaliseEditorMeta(value), null);
  assert.ok(model.normaliseEditorMeta(outlineMeta([{ text: "", depth: 0, collapsed: true }])));

  assert.equal(model.classifyEditorMeta(undefined, { present: false }).kind, "none");
  assert.equal(model.classifyEditorMeta(null, { present: true }).kind, "none");
  assert.equal(model.classifyEditorMeta(rejected[3], { present: true }).kind, "unsupported-or-malformed");
  assert.equal(model.classifyEditorMeta(rejected.at(-1), { present: true }).schema, "pocket.nodeEditor.v9");
});

test("unknown Outline-like schemas are classified unsupported without v1 rewrite", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const unknown = {
    schema: "pocket.nodeEditor.v9",
    mode: "outline",
    futureTopLevel: true,
    outline: [{ id: "future", text: "Future", depth: 1, collapsed: false, order: 77, futureBlockField: true }],
  };
  const classification = model.classifyEditorMeta(unknown, { present: true });
  assert.deepEqual(plain(classification), {
    kind: "unsupported-or-malformed",
    supported: false,
    schema: "pocket.nodeEditor.v9",
    normalised: null,
  });
  assert.equal(model.normaliseEditorMeta(unknown), null);
  assert.equal(unknown.futureTopLevel, true);
  assert.equal(unknown.outline[0].futureBlockField, true);
});

test("active PE model generates a missing block ID", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta(outlineMeta([{ text: "Needs ID", depth: 0 }]));
  assert.equal(typeof result.outline[0].id, "string");
  assert.ok(result.outline[0].id.length > 0);
  assert.ok(result.outline[0].id.length <= 80);
});

test("CURRENT-RISK: active PE model retains duplicate non-empty block IDs", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta(outlineMeta([
      { id: "duplicate", text: "First", depth: 0 },
      { id: "duplicate", text: "Second", depth: 1 },
  ]));
  assert.deepEqual(plain(result.outline.map((block) => block.id)), ["duplicate", "duplicate"]);
});

test("active PE model clamps depths, rounds fractions, truncates IDs, and regenerates order", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta(outlineMeta([
      { id: "a".repeat(81), text: "Low", depth: -2, order: 99, unknown: true },
      { id: "fraction", text: "Fraction", depth: 1.6, collapsed: "true", order: 3 },
      { id: "high", text: "High", depth: 99, order: -7 },
  ]));
  assert.deepEqual(plain(result.outline.map((block) => block.depth)), [0, 2, 8]);
  assert.deepEqual(plain(result.outline.map((block) => block.order)), [1, 2, 3]);
  assert.equal(result.outline[0].id.length, 80);
  assert.equal(result.outline[1].collapsed, false);
  assert.equal(Object.hasOwn(result.outline[0], "unknown"), false);
});

test("active PE model retains 399 and 400 outline blocks", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  for (const count of [399, 400]) {
    const outline = Array.from({ length: count }, (_, index) => ({ id: `b_${index}`, text: `Block ${index}`, depth: index ? 1 : 0 }));
    assert.equal(model.normaliseEditorMeta(outlineMeta(outline)).outline.length, count);
  }
});

test("CURRENT-RISK: Outline normalisation silently slices block 401", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const outline = Array.from({ length: 401 }, (_, index) => ({ id: `b_${index}`, text: `Block ${index}`, depth: index ? 1 : 0 }));
  const result = model.normaliseEditorMeta(outlineMeta(outline));
  assert.equal(result.outline.length, 400);
  assert.equal(result.outline[399].id, "b_399");
  assert.equal(result.outline.some((block) => block.id === "b_400"), false);
});

test("active PE model retains block text at 3,999 and 4,000 characters", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  for (const length of [3999, 4000]) {
    const result = model.normaliseEditorMeta(outlineMeta([{ id: `text_${length}`, text: "x".repeat(length), depth: 0 }]));
    assert.equal(result.outline[0].text.length, length);
  }
});

test("CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta(outlineMeta([{ id: "oversized_text", text: "x".repeat(4001), depth: 0 }]));
  assert.equal(result.outline[0].text.length, 4000);
});

test("native Outline payload preserves accepted IDs, depths, collapse state, and independent details", () => {
  const context = createFullContractContext();
  const node = fixture("current-outline-v1.json").mainThoughtTree[0];
  resetState(context, [node]);
  const payload = context.PocketNodePopoutModel.buildPayload(node);
  assert.equal(payload.mode, "outline");
  assert.equal(payload.schema, EDITOR_SCHEMA);
  assert.equal(payload.body, "Compatibility projection intentionally differs");
  assert.deepEqual(plain(payload.outline.map((block) => block.id)), ["fixture_block_parent", "fixture_block_child"]);
  assert.deepEqual(plain(payload.outline.map((block) => block.depth)), [0, 1]);
  assert.deepEqual(plain(payload.outline.map((block) => block.collapsed)), [true, false]);
});

test("details-only load does not synthesise pe, record an operation, or write truth", () => {
  const context = createFullContractContext();
  const parsed = fixture("legacy-text.json");
  assert.equal(Object.hasOwn(parsed.mainThoughtTree[0], "pe"), false);
  const normalised = context.normaliseInput(parsed);
  const state = lexicalState(context);
  state.ops = [{ type: "pre-load" }];

  context.applyLoadedState(normalised, {
    schema: normalised.schema,
    fileName: "legacy-text.json",
    writtenAt: normalised.writtenAt,
  }, { skipLocalSafetyCheck: true });

  assert.equal(state.ops.length, 0);
  assert.equal(state.nodes[0].details, "Parent\n  Child");
  assert.equal(Object.hasOwn(state.nodes[0], "pe"), false);
  assert.equal(context.__surfaceCalls.exportTree, 0);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showOpenFilePicker, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
  assert.deepEqual(Array.from(context.__storage.keys()).sort(), [
    "pocketLite.lastSaveSnapshot.v1",
    "pocketLite.pip.snapshot.v1",
    "pocketLite.workspace.state.v1",
  ]);

  const exported = context.buildPocketPayload("2026-02-01T00:00:00.000Z");
  assert.equal(Object.hasOwn(exported.mainThoughtTree[0], "pe"), false);
  assert.equal(Object.hasOwn(exported.data.mainThoughtTree[0], "pe"), false);
  assert.equal(exported.mainThoughtTree[0].details, "Parent\n  Child");
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("Outline-only and combined current sections load independently without pe, Notes synthesis, operations, or writes", () => {
  const context = createFullContractContext();
  const outlineOnlyEditor = outlineMeta([{
    id: "outline_only_current",
    text: "Outline-only current content",
    depth: 0,
    collapsed: false,
  }]);
  const combinedEditor = outlineMeta([{
    id: "combined_current",
    text: "Combined current Outline",
    depth: 0,
    collapsed: true,
  }]);
  const normalised = context.normaliseInput({
    schema: "portal.export.v1",
    writtenAt: "2026-03-01T00:00:00.000Z",
    mainThoughtTree: [
      syntheticNode("outline_only_load", { editor: outlineOnlyEditor }),
      syntheticNode("combined_load", { details: "Combined current Notes", editor: combinedEditor }),
    ],
    mainThoughtTreeTombstones: [],
  });
  const state = lexicalState(context);
  state.ops = [{ type: "must-clear" }];
  context.applyLoadedState(normalised, {
    schema: normalised.schema,
    fileName: "current-sections.json",
    writtenAt: normalised.writtenAt,
  }, { skipLocalSafetyCheck: true });

  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const outlineOnly = byId.get("outline_only_load");
  assert.equal(Object.hasOwn(outlineOnly, "details"), false);
  assert.equal(Object.hasOwn(outlineOnly, "pe"), false);
  assert.deepEqual(plain(outlineOnly.editor), outlineOnlyEditor);
  assert.equal(context.PocketNodePopoutModel.buildPayload(outlineOnly).mode, "outline");

  const combined = byId.get("combined_load");
  assert.equal(combined.details, "Combined current Notes");
  assert.equal(Object.hasOwn(combined, "pe"), false);
  assert.deepEqual(plain(combined.editor), combinedEditor);
  const combinedOpening = context.PocketNodePopoutModel.buildPayload(combined);
  assert.equal(combinedOpening.mode, "outline");
  assert.equal(combinedOpening.body, "Combined current Notes");
  assert.equal(combinedOpening.outline[0].text, "Combined current Outline");

  assert.equal(state.ops.length, 0);
  assert.deepEqual(plain(context.__surfaceCalls), {
    exportTree: 0,
    writeTruthFile: 0,
    showOpenFilePicker: 0,
    showSaveFilePicker: 0,
  });
});

test("all legacy pe shapes are discarded without throwing, leaking into extras, or weakening editor preservation", () => {
  const context = createFullContractContext();
  const supportedEditor = {
    schema: EDITOR_SCHEMA,
    mode: "outline",
    outline: [{
      id: "shape_supported",
      text: "Supported current Outline",
      depth: 0,
      collapsed: false,
      order: 41,
      futureBlockField: { preserved: true },
    }],
    futureTopLevel: { preserved: true },
  };
  const shapes = [
    null,
    "retired scalar",
    [],
    {},
    { schema: "pocket.pe.v1", title: "Legacy", mode: "text", text: "Legacy text", outline: [] },
    { schema: "pocket.pe.v99", future: true },
    largeLegacyPe(),
    { schema: "extension.rich", nested: { one: { two: [{ three: "retired" }] } }, extensions: { keep: false } },
  ];
  const input = {
    schema: "portal.export.v1",
    mainThoughtTree: shapes.map((pe, index) => syntheticNode(`shape_${index}`, {
      details: `Current Notes ${index}`,
      ...(index === shapes.length - 1 ? { editor: supportedEditor } : {}),
      pe,
      unrelatedExtra: `extra-${index}`,
    })),
    mainThoughtTreeTombstones: [],
  };

  const normalised = context.normaliseInput(input);
  assert.equal(normalised.nodes.length, shapes.length);
  for (const [index, node] of normalised.nodes.entries()) {
    assert.equal(Object.hasOwn(node, "pe"), false, `shape ${index}`);
    assert.equal(node.details, `Current Notes ${index}`, `shape ${index}`);
    assert.equal(node.unrelatedExtra, `extra-${index}`, `shape ${index}`);
    assert.equal(Object.hasOwn(context.normaliseNodeExtras(input.mainThoughtTree[index]), "pe"), false, `shape ${index}`);
  }
  assert.deepEqual(plain(normalised.nodes.at(-1).editor), supportedEditor);
  assert.notStrictEqual(normalised.nodes.at(-1).editor, supportedEditor);
  assertNoRetiredPe(normalised, "normalised shapes");
});

test("current Notes and editor content win over matching or conflicting pe across opening, search, badges, and copy context", () => {
  const context = createFullContractContext();
  const supported = (id, text) => outlineMeta([{ id, text, depth: 0, collapsed: false }]);
  const rawNodes = [
    syntheticNode("matching_notes", {
      details: "Current matching Notes needle",
      pe: { title: "Legacy matching title", text: "Current matching Notes needle" },
    }),
    syntheticNode("conflicting_notes", {
      details: "Authoritative Notes needle",
      pe: { title: "Stale title needle", text: "Retired conflicting needle" },
    }),
    syntheticNode("conflicting_outline", {
      editor: supported("conflicting_outline_block", "Authoritative Outline needle"),
      pe: { text: "Retired outline shadow needle", outline: [{ text: "Stale nested needle" }] },
    }),
    syntheticNode("both_current", {
      details: "Independent Notes needle",
      editor: supported("both_current_block", "Independent Outline needle"),
      pe: { text: "Retired combined needle" },
    }),
    syntheticNode("unsupported_with_pe", {
      details: "Readable unsupported Notes",
      editor: { schema: "pocket.nodeEditor.v9", mode: "outline", outline: [{ text: "Future opaque text" }] },
      pe: { text: "Retired unsupported needle" },
    }),
    syntheticNode("pe_only", {
      label: "Title-only survivor",
      pe: { title: "Retired title needle", text: "Retired pe-only needle", outline: [{ text: "Retired row needle" }] },
    }),
  ];
  const normalised = context.normaliseInput({
    schema: "portal.export.v1",
    mainThoughtTree: rawNodes,
    mainThoughtTreeTombstones: [],
  });
  assertNoRetiredPe(normalised.nodes, "current-content matrix");
  const matrixState = lexicalState(context);
  matrixState.ops = [{ type: "must-clear" }];
  context.applyLoadedState(normalised, {
    schema: normalised.schema,
    fileName: "current-content-matrix.json",
    writtenAt: normalised.writtenAt,
  }, { skipLocalSafetyCheck: true });
  assert.equal(matrixState.ops.length, 0);
  assert.equal(context.__surfaceCalls.exportTree, 0);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showOpenFilePicker, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
  const byId = new Map(normalised.nodes.map((node) => [node.id, node]));

  assert.equal(byId.get("matching_notes").details, "Current matching Notes needle");
  assert.equal(byId.get("conflicting_notes").details, "Authoritative Notes needle");
  assert.equal(byId.get("conflicting_outline").editor.outline[0].text, "Authoritative Outline needle");
  assert.equal(byId.get("both_current").details, "Independent Notes needle");
  assert.equal(byId.get("both_current").editor.outline[0].text, "Independent Outline needle");
  assert.equal(context.PocketNodePopoutModel.buildPayload(byId.get("both_current")).mode, "outline");
  assert.equal(context.PocketNodePopoutModel.buildPayload(byId.get("unsupported_with_pe")).readOnly, true);

  const peOnly = byId.get("pe_only");
  assert.equal(peOnly.label, "Title-only survivor");
  assert.equal(Object.hasOwn(peOnly, "details"), false);
  assert.equal(Object.hasOwn(peOnly, "editor"), false);
  const peOnlyOpening = context.PocketNodePopoutModel.buildPayload(peOnly);
  assert.equal(peOnlyOpening.mode, "text");
  assert.equal(peOnlyOpening.body, "");
  assert.equal(Object.hasOwn(peOnlyOpening, "readOnly"), false);
  const copy = context.copyContextPayloadForNode(peOnly);
  assert.equal(copy.kind, "label");
  assert.equal(copy.text, "Title-only survivor");

  for (const [query, expectedRows] of [
    ["authoritative notes needle", 1],
    ["authoritative outline needle", 1],
    ["independent notes needle", 1],
    ["independent outline needle", 1],
    ["retired conflicting needle", 0],
    ["retired outline shadow needle", 0],
    ["retired combined needle", 0],
    ["retired unsupported needle", 0],
    ["retired pe-only needle", 0],
    ["title-only survivor", 1],
  ]) {
    assert.equal(createTreeRenderHarness(normalised.nodes, query).rows.length, expectedRows, query);
  }

  const badgeExpectations = new Map([
    ["matching_notes", ["Current matching Notes needle"]],
    ["conflicting_notes", ["Authoritative Notes needle"]],
    ["conflicting_outline", ["Authoritative Outline needle"]],
    ["both_current", ["Independent Notes needle"]],
    ["unsupported_with_pe", ["Readable unsupported Notes"]],
    ["pe_only", []],
  ]);
  for (const node of normalised.nodes) {
    const before = plain(node);
    const rendered = createTreeRenderHarness([node]);
    const expectedTitles = badgeExpectations.get(node.id);
    assert.deepEqual(rendered.badges.map((badge) => badge.title), expectedTitles, node.id);
    assert.deepEqual(plain(node), before, `${node.id}: source`);
    assert.deepEqual(plain(rendered.state.nodes[0]), before, `${node.id}: rendered state`);
  }
});

test("normalised search retains label, Notes, supported Outline, task, and profile fields without pe mutation", () => {
  const context = createFullContractContext();
  const raw = syntheticNode("search_owners", {
    label: "Label owner needle",
    details: "Notes owner needle",
    editor: outlineMeta([{ id: "search_owner_outline", text: "Outline owner needle", depth: 0, collapsed: false }]),
    task: { notes: "Task owner needle" },
    profile: {
      keywords: ["Keyword owner needle"],
      entities: ["Entity owner needle"],
      people: ["Person owner needle"],
    },
    pe: {
      title: "Retired title-only search",
      text: "Retired text-only search",
      outline: [{ text: "Retired outline-only search" }],
    },
  });
  const node = normaliseOne(context, raw);
  const before = plain(node);
  for (const query of [
    "label owner needle",
    "notes owner needle",
    "outline owner needle",
    "task owner needle",
    "keyword owner needle",
    "entity owner needle",
    "person owner needle",
  ]) {
    assert.equal(createTreeRenderHarness([node], query).rows.length, 1, query);
  }
  for (const query of [
    "retired title-only search",
    "retired text-only search",
    "retired outline-only search",
  ]) {
    assert.equal(createTreeRenderHarness([node], query).rows.length, 0, query);
  }
  assert.deepEqual(plain(node), before);
  assert.equal(Object.hasOwn(node, "pe"), false);
});

test("pe retirement is load-only normalisation until a real edit, and all newly built snapshots omit pe", async () => {
  const context = createFullContractContext();
  const rawNode = syntheticNode("retirement_flow", {
    details: "Current Notes before edit",
    editor: outlineMeta([{ id: "retirement_outline", text: "Current Outline survives", depth: 0, collapsed: true }]),
    pe: { schema: "pocket.pe.v1", title: "Retired", text: "Retired shadow", outline: [{ text: "Retired row" }] },
  });
  const input = {
    schema: "portal.export.v1",
    writtenAt: "2026-03-01T00:00:00.000Z",
    mainThoughtTree: [rawNode],
    mainThoughtTreeTombstones: [],
    data: {
      mainThoughtTree: [syntheticNode("nested_loser", { pe: { text: "Nested retired shadow" } })],
      mainThoughtTreeTombstones: [],
    },
  };
  const inputBefore = plain(input);
  const normalised = context.normaliseInput(input);
  const beforeLoadIdentity = establishSyntheticSession(context, "retirement-flow.json");
  const state = lexicalState(context);
  state.ops = [{ type: "must-clear-on-load" }];

  context.applyLoadedState(normalised, {
    schema: normalised.schema,
    fileName: "retirement-flow.json",
    writtenAt: normalised.writtenAt,
  }, { skipLocalSafetyCheck: true });

  assert.deepEqual(plain(input), inputBefore);
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].id, "retirement_flow");
  assert.equal(state.nodes[0].details, "Current Notes before edit");
  assert.equal(state.nodes[0].editor.outline[0].text, "Current Outline survives");
  assert.equal(Object.hasOwn(state.nodes[0], "pe"), false);
  assert.equal(state.ops.length, 0);
  assert.deepEqual(plain(context.capturePocketEditorSourceIdentity()), beforeLoadIdentity);
  assert.deepEqual(plain(context.__surfaceCalls), {
    exportTree: 0,
    writeTruthFile: 0,
    showOpenFilePicker: 0,
    showSaveFilePicker: 0,
  });

  for (const key of ["pocketLite.lastSaveSnapshot.v1", "pocketLite.pip.snapshot.v1"]) {
    assertNoRetiredPe(JSON.parse(context.__storage.get(key)), key);
  }
  assert.equal(context.saveLocalSafetySnapshot("p014"), true);
  assertNoRetiredPe(JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1")), "new local safety");
  assertNoRetiredPe(JSON.parse(context.__storage.get("pocketLite.localSafety.trail.v1")), "new local safety trail");
  context.saveAutoCache(normalised, {
    schema: normalised.schema,
    fileName: "retirement-flow.json",
    writtenAt: normalised.writtenAt,
  });
  assertNoRetiredPe(JSON.parse(context.__storage.get("pocketLite.auto.cache.v1")), "new auto cache");
  assertNoRetiredPe(context.buildPocketPayload("2026-03-02T00:00:00.000Z"), "new truth payload");
  runScript(context, "js/pocket-vault.js");
  assertNoRetiredPe(context.PocketVault.buildCurrentPocketPayload(), "new Vault payload");

  let truthWrites = 0;
  context.writeTruthFile = async () => {
    truthWrites += 1;
    return { ok: true, target: "opened-file" };
  };
  const unchangedSave = await context.exportTree({ returnDetails: true });
  assert.equal(unchangedSave.ok, false);
  assert.equal(unchangedSave.reason, "no-changes");
  assert.equal(truthWrites, 0);
  assert.equal(state.ops.length, 0);

  let exportedPayload = null;
  let exportCalls = 0;
  context.exportTree = async () => {
    exportCalls += 1;
    exportedPayload = context.buildPocketPayload("2026-03-03T00:00:00.000Z");
    state.ops = [];
    return {
      ok: true,
      reason: "truth-file",
      sourceIdentity: plain(context.capturePocketEditorSourceIdentity()),
    };
  };
  const edited = editorPayload(context, state.nodes[0], { body: "Current Notes after edit" });
  const result = await context.PocketNodePopoutEditor.applyAndSave(edited);
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.exported, true);
  assert.equal(exportCalls, 1);
  assert.equal(state.nodes[0].details, "Current Notes after edit");
  assert.equal(state.nodes[0].editor.outline[0].text, "Current Outline survives");
  assert.equal(state.ops.length, 0);
  assertNoRetiredPe(exportedPayload, "controlled explicit export");
  assert.equal(exportedPayload.mainThoughtTree[0].details, "Current Notes after edit");
  assert.equal(exportedPayload.data.mainThoughtTree[0].details, "Current Notes after edit");
});

test("active production sources have no remaining node.pe content path or legacy search wrapper", () => {
  const indexScripts = indexScriptSources();
  assert.equal(indexScripts.includes("js/pocket-filter-pe-search.js"), false);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "js", "pocket-filter-pe-search.js")), false);

  const metadata = source("js/pocket-editor-metadata.js");
  assert.equal(metadata.includes("pocket.pe.v1"), false);
  assert.equal(metadata.includes("normalisePocketPe"), false);
  assert.equal(metadata.includes('FIRST_CLASS_NODE_FIELDS = ["editor", "pe"]'), false);
  assert.match(metadata, /FIRST_CLASS_NODE_FIELDS\s*=\s*\["editor"\]/);

  const storage = source("js/pocket-storage.js");
  assert.equal(storage.includes("buildPeFromLegacyDetails"), false);
  assert.equal(storage.includes("ensurePeFromLegacyDetails"), false);
  assert.equal(storage.includes(".pe"), false);

  const importer = source("js/pocket-import.js");
  assert.equal(/\bitem\.pe\b|\bpayload\.pe\b/.test(importer), false);
  assert.match(importer, /retired node\.pe.+omitted/);

  for (const file of ["js/pocket-render.js", "js/pocket-node-popout-model.js", "js/pocket-editor-copy.js"]) {
    assert.equal(/\bnode\??\.pe\b|\bnode\[['"]pe['"]\]/.test(source(file)), false, file);
  }

  const data = source("js/pocket-data.js");
  assert.match(data, /Retired node\.pe stays reserved/);
  assert.match(data, /"pe",/);
});

test("buildPocketPayload emits the current guarded dual-tree export shape", () => {
  const context = createFullContractContext();
  const node = normaliseOne(context, syntheticNode("exported", {
    details: "Projection",
    editor: { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [{ id: "block", text: "Outline", depth: 0 }] },
    pe: { schema: "pocket.pe.v1", mode: "text", text: "Legacy shadow" },
    unknownNodeField: { keep: true },
  }));
  const state = resetState(context, [node]);
  state.tombstones = [{ id: "deleted_fixture" }];
  state.rootExtras = { rootExtension: { keep: true } };
  state.dataExtras = { dataExtension: "keep" };
  state.source = { schema: "portal.export.v1", fileName: "synthetic.json", writtenAt: "2026-01-01T00:00:00.000Z" };

  const payload = context.buildPocketPayload("2026-02-02T03:04:05.000Z");
  assert.equal(payload.schema, "portal.export.v1");
  assert.equal(payload.exportedAt, payload.writtenAt);
  assert.equal(payload.writtenAt, "2026-02-02T03:04:05.000Z");
  assert.deepEqual(plain(payload.pocketGuard), plain(payload.data.pocketGuard));
  assert.equal(payload.pocketGuard.schema, "pocket.guard.v1");
  assert.ok(payload.pocketGuard.instanceId);
  assert.equal(payload.pocketGuard.sourceFileName, "synthetic.json");
  assert.equal(payload.pocketGuard.sourceWrittenAt, "2026-01-01T00:00:00.000Z");
  assert.equal(payload.pocketGuard.backupWrittenAt, payload.writtenAt);
  assert.deepEqual(plain(payload.mainThoughtTree), plain(payload.data.mainThoughtTree));
  assert.deepEqual(plain(payload.mainThoughtTreeTombstones), plain(payload.data.mainThoughtTreeTombstones));
  assert.equal(payload.rootExtension.keep, true);
  assert.equal(payload.data.dataExtension, "keep");
  assert.equal(payload.mainThoughtTree[0].editor.schema, "pocket.nodeEditor.v1");
  assert.equal(Object.hasOwn(payload.mainThoughtTree[0], "pe"), false);
  assert.equal(Object.hasOwn(payload.data.mainThoughtTree[0], "pe"), false);
  assert.equal(payload.mainThoughtTree[0].unknownNodeField.keep, true);

  state.nodes[0].label = "Mutated after build";
  assert.equal(payload.mainThoughtTree[0].label, "Synthetic exported");
  assert.equal(vm.runInContext("truthFileHandle !== null", context), true);
  assert.equal(Number.isSafeInteger(context.capturePocketEditorSourceIdentity().fileSessionId), true);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("ordinary Text and empty Text fixtures round trip without synthesising pe", () => {
  const text = loadAndExportFixture("legacy-text.json");
  assert.equal(text.state.nodes[0].details, "Parent\n  Child");
  assert.equal(Object.hasOwn(text.state.nodes[0], "pe"), false);
  assert.equal(text.payload.mainThoughtTree[0].details, "Parent\n  Child");
  assert.equal(Object.hasOwn(text.payload.mainThoughtTree[0], "pe"), false);

  const empty = loadAndExportFixture("empty-text.json");
  assert.equal(Object.hasOwn(empty.state.nodes[0], "details"), false);
  assert.equal(Object.hasOwn(empty.state.nodes[0], "pe"), false);
  assert.equal(Object.hasOwn(empty.payload.mainThoughtTree[0], "details"), false);
});

test("ordinary absent and null editor values open as editable Text without read-only metadata", () => {
  const context = createFullContractContext();
  const nodes = [
    syntheticNode("absent_editor", { details: "Absent editor Text" }),
    syntheticNode("null_editor", { details: "Null editor Text", editor: null }),
  ];
  const normalised = context.normaliseInput({
    schema: "portal.export.v1",
    mainThoughtTree: nodes,
    mainThoughtTreeTombstones: [],
  });
  assert.equal(Object.hasOwn(normalised.nodes[0], "editor"), false);
  assert.equal(Object.hasOwn(normalised.nodes[1], "editor"), true);
  assert.equal(normalised.nodes[1].editor, null);

  for (const node of normalised.nodes) {
    const classification = context.PocketNodePopoutModel.classifyNodeEditor(node);
    assert.equal(classification.kind, "none");
    const payload = context.PocketNodePopoutModel.buildPayload(node);
    assert.equal(payload.mode, "text");
    assert.equal(payload.outline, null);
    assert.equal(Object.hasOwn(payload, "readOnly"), false);
    assert.equal(Object.hasOwn(payload, "readOnlyReason"), false);
    assert.equal(Object.hasOwn(payload, "editorSchema"), false);
    assert.equal(Object.hasOwn(payload, "schema"), false);
  }
});

test("accepted Outline and independent Notes both load while Outline owns the opening tab", () => {
  const result = loadAndExportFixture("current-outline-v1.json");
  const node = result.state.nodes[0];
  assert.equal(node.details, "Compatibility projection intentionally differs");
  assert.equal(node.editor.outline[0].text, "Outline parent");
  assert.equal(Object.hasOwn(node, "pe"), false);
  const openingPayload = result.context.PocketNodePopoutModel.buildPayload(node);
  assert.equal(openingPayload.mode, "outline");
  assert.equal(openingPayload.body, node.details);
  assert.equal(openingPayload.outline[0].text, "Outline parent");
  assert.deepEqual(plain(result.payload.mainThoughtTree[0].editor), plain(fixture("current-outline-v1.json").mainThoughtTree[0].editor));
});

test("malformed and unknown editor objects survive raw while PE exposes read-only Text payloads", () => {
  const factory = loadRuntimeFactory();
  const malformed = loadAndExportFixture("malformed-editor.json");
  const rawMalformed = fixture("malformed-editor.json").mainThoughtTree[0].editor;
  assert.equal(JSON.stringify(malformed.state.nodes[0].editor), JSON.stringify(rawMalformed));
  assert.equal(JSON.stringify(malformed.payload.mainThoughtTree[0].editor), JSON.stringify(rawMalformed));
  const malformedOpening = malformed.context.PocketNodePopoutModel.buildPayload(malformed.state.nodes[0]);
  assert.equal(malformedOpening.mode, "text");
  assert.equal(malformedOpening.outline, null);
  assert.equal(malformedOpening.readOnly, true);
  assert.equal(malformedOpening.readOnlyReason, "unsupported-editor");
  assert.equal(malformedOpening.readOnlyMessage, UNKNOWN_EDITOR_MESSAGE);
  assert.equal(malformedOpening.editorSchema, EDITOR_SCHEMA);
  assert.equal(Object.hasOwn(malformedOpening, "editor"), false);
  assert.equal(factory.build(JSON.stringify(malformedOpening)).includes("fixtureMarker"), false);

  const unknown = loadAndExportFixture("unknown-editor-schema.json");
  const rawUnknown = fixture("unknown-editor-schema.json").mainThoughtTree[0].editor;
  assert.equal(JSON.stringify(unknown.state.nodes[0].editor), JSON.stringify(rawUnknown));
  assert.equal(JSON.stringify(unknown.payload.mainThoughtTree[0].editor), JSON.stringify(rawUnknown));
  const openingPayload = unknown.context.PocketNodePopoutModel.buildPayload(unknown.state.nodes[0]);
  assert.equal(openingPayload.mode, "text");
  assert.equal(openingPayload.outline, null);
  assert.equal(openingPayload.body, "Future-readable projection");
  assert.equal(openingPayload.readOnly, true);
  assert.equal(openingPayload.readOnlyReason, "unsupported-editor");
  assert.equal(openingPayload.readOnlyMessage, UNKNOWN_EDITOR_MESSAGE);
  assert.equal(openingPayload.editorSchema, "pocket.nodeEditor.v9");
  assert.equal(Object.hasOwn(openingPayload, "editor"), false);
  assert.equal(Object.hasOwn(openingPayload, "futureTopLevel"), false);
  const program = factory.build(JSON.stringify(openingPayload));
  assert.equal(program.includes("preserve-if-untouched"), false);
  assert.equal(program.includes("Future outline content"), false);
});

test("CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export", () => {
  const result = loadAndExportFixture("root-precedence.json");
  assert.equal(result.state.nodes.length, 1);
  assert.equal(result.state.nodes[0].id, "fixture_root_winner");
  assert.equal(result.state.nodes[0].fixtureNodeExtra, "root copy");
  assert.equal(result.state.tombstones[0].id, "fixture_root_tombstone");
  assert.equal(result.payload.fixtureRootExtra.keep, true);
  assert.equal(Object.hasOwn(result.payload.data, "fixtureDataExtra"), false);
});

test("PE opening payload carries safe file-session identity and the exact original node revision", () => {
  const context = createFullContractContext();
  const node = syntheticNode("payload_text", { label: "  Text   title  ", details: "Text body" });
  resetState(context, [node]);
  const payload = context.PocketNodePopoutModel.buildPayload(node);
  assert.deepEqual(Object.keys(payload).sort(), [
    "body",
    "fileSessionId",
    "id",
    "mode",
    "openedAt",
    "originalUpdatedAt",
    "outline",
    "path",
    "sourceFileName",
    "sourceOwnerKind",
    "sourcePipSession",
    "sourceVaultSessionId",
    "title",
    "updatedAt",
  ]);
  assert.equal(payload.id, "payload_text");
  assert.equal(payload.title, "Text title");
  assert.equal(payload.body, "Text body");
  assert.equal(payload.mode, "text");
  assert.equal(payload.outline, null);
  assert.equal(Number.isSafeInteger(payload.fileSessionId), true);
  assert.equal(payload.sourceFileName, "synthetic.json");
  assert.equal(payload.sourcePipSession, false);
  assert.equal(payload.sourceOwnerKind, "json");
  assert.equal(payload.sourceVaultSessionId, "");
  assert.equal(payload.originalUpdatedAt, node.updatedAt);
  assert.equal(payload.updatedAt, node.updatedAt);
  assert.equal(context.isPocketEditorSourceIdentityCurrent({
    fileSessionId: payload.fileSessionId,
    sourceFileName: payload.sourceFileName,
    sourcePipSession: payload.sourcePipSession,
    sourceOwnerKind: payload.sourceOwnerKind,
    sourceVaultSessionId: payload.sourceVaultSessionId,
  }), true);
  assert.ok(Number.isFinite(Date.parse(payload.openedAt)));
  assert.equal(Object.values(payload).includes(context.__syntheticTruthHandle), false);
});

test("raw PE save preflight accepts exact independent Notes and Outline limits", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const outline = Array.from({ length: 400 }, (_, index) => ({
    id: index === 0 ? "i".repeat(80) : `block_${index}`,
    text: index === 0 ? "x".repeat(4000) : `Block ${index}`,
    depth: index === 399 ? 8 : 0,
    collapsed: index % 2 === 0,
  }));
  for (const titleLength of [219, 220]) {
    for (const bodyLength of [3999, 4000]) {
      const result = model.validateSavePayload({
        title: "T".repeat(titleLength),
        body: "B".repeat(bodyLength),
        schema: EDITOR_SCHEMA,
        mode: "outline",
        outline,
      });
      assert.equal(result.ok, true);
    }
  }
  for (const blockCount of [399, 400]) {
    for (const blockTextLength of [3999, 4000]) {
      const boundaryOutline = Array.from({ length: blockCount }, (_, index) => ({
        id: `boundary_${index}`,
        text: index === 0 ? "x".repeat(blockTextLength) : `Block ${index}`,
        depth: index === blockCount - 1 ? 8 : 0,
        collapsed: false,
      }));
      assert.equal(model.validateSavePayload({
        title: "Boundary",
        body: "Body",
        schema: EDITOR_SCHEMA,
        mode: "outline",
        outline: boundaryOutline,
      }).ok, true);
    }
  }
  for (const depth of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const rejected = model.validateSavePayload({
      title: "Non-finite",
      body: "Body",
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline: [{ id: "non_finite", text: "Row", depth, collapsed: false }],
    });
    assert.equal(rejected.reason, "invalid-outline-depth");
  }
  assert.equal(model.validateSavePayload({
    title: "Text",
    body: "Body",
    mode: "text",
    outline: "ignored in Text mode",
  }).ok, false);
  for (const outlineValue of [null, [], [{ id: "placeholder", text: "", depth: 0, collapsed: false }]]) {
    const accepted = model.validateSavePayload({
      title: "Independent content",
      body: "Notes",
      schema: EDITOR_SCHEMA,
      mode: "text",
      outline: outlineValue,
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.editorMeta, null);
  }
  for (const structural of [
    [{ id: "blank_depth", text: "", depth: 1, collapsed: false }],
    [{ id: "blank_collapsed", text: "", depth: 0, collapsed: true }],
  ]) {
    const accepted = model.validateSavePayload({
      title: "Structural Outline",
      body: "Notes",
      schema: EDITOR_SCHEMA,
      mode: "text",
      outline: structural,
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.editorMeta.outline.length, 1);
  }
});

test("lossy PE save preflight rejects over-limit and structurally unsafe payloads before mutation or export", async () => {
  const baseOutline = [{ id: "safe", text: "Safe", depth: 0, collapsed: false }];
  const cases = [
    ["title 221", { title: "T".repeat(221), mode: "text", body: "Body" }, "title-too-long"],
    ["body 4001", { title: "Title", mode: "text", body: "B".repeat(4001) }, "details-too-long"],
    ["Outline 401", {
      title: "Title",
      body: "Body",
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline: Array.from({ length: 401 }, (_, index) => ({ id: `b_${index}`, text: "B", depth: 0, collapsed: false })),
    }, "outline-too-many-blocks"],
    ["block text 4001", {
      title: "Title",
      body: "Body",
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline: [{ id: "long", text: "x".repeat(4001), depth: 0, collapsed: false }],
    }, "outline-block-text-too-long"],
    ["duplicate IDs", {
      title: "Title",
      body: "Body",
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline: [
        { id: "duplicate", text: "One", depth: 0, collapsed: false },
        { id: "duplicate", text: "Two", depth: 1, collapsed: false },
      ],
    }, "duplicate-outline-block-id"],
    ["missing ID", {
      title: "Title",
      body: "Body",
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline: [{ text: "Missing", depth: 0, collapsed: false }],
    }, "invalid-outline-id"],
    ["ID 81", {
      title: "Title",
      body: "Body",
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline: [{ id: "i".repeat(81), text: "Long ID", depth: 0, collapsed: false }],
    }, "outline-id-too-long"],
    ["depth -1", { title: "Title", body: "Body", schema: EDITOR_SCHEMA, mode: "outline", outline: [{ ...baseOutline[0], depth: -1 }] }, "invalid-outline-depth"],
    ["depth 9", { title: "Title", body: "Body", schema: EDITOR_SCHEMA, mode: "outline", outline: [{ ...baseOutline[0], depth: 9 }] }, "invalid-outline-depth"],
    ["fractional depth", { title: "Title", body: "Body", schema: EDITOR_SCHEMA, mode: "outline", outline: [{ ...baseOutline[0], depth: 1.5 }] }, "invalid-outline-depth"],
    ["non-finite depth", { title: "Title", body: "Body", schema: EDITOR_SCHEMA, mode: "outline", outline: [{ ...baseOutline[0], depth: Infinity }] }, "invalid-outline-depth"],
    ["malformed Outline", { title: "Title", body: "Body", schema: EDITOR_SCHEMA, mode: "outline", outline: {} }, "invalid-outline"],
    ["scalar block", { title: "Title", body: "Body", schema: EDITOR_SCHEMA, mode: "outline", outline: ["row"] }, "invalid-outline-block"],
    ["invalid collapse state", {
      title: "Title",
      body: "Body",
      schema: EDITOR_SCHEMA,
      mode: "outline",
      outline: [{ id: "collapse", text: "Row", depth: 0, collapsed: "false" }],
    }, "invalid-outline-block"],
    ["wrong schema", { title: "Title", body: "Body", schema: "pocket.nodeEditor.v9", mode: "outline", outline: baseOutline }, "invalid-outline"],
  ];

  for (const [label, overrides, reason] of cases) {
    const context = createFullContractContext();
    const node = syntheticNode(`reject_${reason}`, {
      details: "Before",
    });
    const state = resetState(context, [node]);
    state.selectedId = node.id;
    let exportCalls = 0;
    let workspaceCalls = 0;
    let pipCalls = 0;
    context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
    context.saveWorkspaceState = () => { workspaceCalls += 1; };
    context.persistPipSnapshot = () => { pipCalls += 1; };
    const payload = editorPayload(context, node, overrides);
    const before = snapshotSaveBoundary(context, node.id);
    const result = await context.PocketNodePopoutEditor.applyAndSave(payload);
    assert.equal(result.ok, false, label);
    assert.equal(result.reason, reason, label);
    assert.equal(result.applied, false, label);
    assert.equal(result.exported, false, label);
    assertSaveBoundaryUnchanged(context, node.id, before);
    assert.equal(exportCalls, 0, label);
    assert.equal(workspaceCalls, 0, label);
    assert.equal(pipCalls, 0, label);
    assert.equal(context.__surfaceCalls.showSaveFilePicker, 0, label);
    assert.equal(context.__surfaceCalls.writeTruthFile, 0, label);
  }
});

test("unchanged unsafe raw Outline survives Notes and title saves while actual Outline edits remain blocked", async () => {
  const cases = [
    ["401 rows", Array.from({ length: 401 }, (_, index) => ({
      id: `loaded_${index}`,
      text: `Loaded ${index}`,
      depth: index === 0 ? 0 : 1,
      collapsed: false,
    })), "outline-too-many-blocks"],
    ["4,001-character row", [{
      id: "loaded_long",
      text: "x".repeat(4001),
      depth: 0,
      collapsed: false,
    }], "outline-block-text-too-long"],
    ["duplicate IDs", [
      { id: "loaded_duplicate", text: "One", depth: 0, collapsed: false },
      { id: "loaded_duplicate", text: "Two", depth: 1, collapsed: false },
    ], "duplicate-outline-block-id"],
  ];

  for (const [label, outline, reason] of cases) {
    const rawNode = syntheticNode(`loaded_${reason}`, {
      details: "Readable projection",
      editor: outlineMeta(outline),
    });

    for (const [changeLabel, overrides] of [
      ["Notes", { body: "Changed Notes" }],
      ["title", { title: "Changed title" }],
    ]) {
      const context = createFullContractContext();
      const state = resetState(context, [rawNode]);
      const opening = editorPayload(context, state.nodes[0], overrides);
      let exportCalls = 0;
      context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
      const result = await context.PocketNodePopoutEditor.applyAndSave(opening);
      assert.equal(result.ok, true, `${label}: ${changeLabel}`);
      assert.equal(result.changed, true, `${label}: ${changeLabel}`);
      assert.deepEqual(plain(state.nodes[0].editor), plain(rawNode.editor), `${label}: ${changeLabel}`);
      assert.equal(exportCalls, 1, `${label}: ${changeLabel}`);
    }

    const context = createFullContractContext();
    const state = resetState(context, [rawNode]);
    const opening = editorPayload(context, state.nodes[0]);
    opening.outline[0].text = `${opening.outline[0].text}!`;
    const before = snapshotSaveBoundary(context, rawNode.id);
    let exportCalls = 0;
    context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
    const result = await context.PocketNodePopoutEditor.applyAndSave(opening);
    assert.equal(result.reason, reason, label);
    assert.equal(result.applied, false, label);
    assertSaveBoundaryUnchanged(context, rawNode.id, before);
    assert.equal(exportCalls, 0, label);
  }
});

test("clearing Notes removes only details and preserves accepted Outline metadata", () => {
  const context = createFullContractContext();
  const outlineNode = fixture("current-outline-v1.json").mainThoughtTree[0];
  const state = resetState(context, [outlineNode]);
  const rawEditor = plain(state.nodes[0].editor);
  const ok = context.PocketNodePopoutEditor.apply(editorPayload(context, outlineNode, {
    title: outlineNode.label,
    body: "   \n\t ",
    mode: "text",
    outline: context.PocketNodePopoutModel.buildPayload(state.nodes[0]).outline,
    schema: EDITOR_SCHEMA,
  }));
  assert.equal(ok, true);
  assert.deepEqual(plain(state.nodes[0].editor), rawEditor);
  assert.equal(Object.hasOwn(state.nodes[0], "details"), false);
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].changed, "notes");
});

test("apply and applyAndSave defend unsupported and malformed editor nodes without mutation or export", async () => {
  for (const name of ["unknown-editor-schema.json", "malformed-editor.json"]) {
    const context = createFullContractContext();
    const rawNode = fixture(name).mainThoughtTree[0];
    const normalised = normaliseOne(context, rawNode);
    const state = resetState(context, [normalised]);
    const before = JSON.stringify(state.nodes[0]);
    let exportCalls = 0;
    context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
    const payload = context.PocketNodePopoutModel.buildPayload(state.nodes[0]);
    assert.equal(payload.readOnly, true);

    assert.equal(context.PocketNodePopoutEditor.apply(payload), false);
    const detailed = context.PocketNodePopoutEditor.apply(payload, { returnDetails: true });
    assert.equal(detailed.ok, false);
    assert.equal(detailed.changed, false);
    assert.equal(detailed.id, state.nodes[0].id);
    assert.equal(detailed.label, state.nodes[0].label);
    assert.equal(detailed.readOnly, true);
    assert.equal(detailed.reason, "unsupported-editor");
    assert.match(detailed.message, /cannot safely edit/i);
    const saved = await context.PocketNodePopoutEditor.applyAndSave(payload);
    assert.equal(saved.ok, false);
    assert.equal(saved.applied, false);
    assert.equal(saved.changed, false);
    assert.equal(saved.exported, false);
    assert.equal(saved.reason, "unsupported-editor");
    assert.equal(JSON.stringify(state.nodes[0]), before);
    assert.equal(state.ops.length, 0);
    assert.equal(exportCalls, 0);
    assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  }
});

test("editor cutover fails closed when the canonical editor cannot open and never uses a legacy save bypass", () => {
  const context = createFullContractContext();
  const unsupported = normaliseOne(context, fixture("unknown-editor-schema.json").mainThoughtTree[0]);
  const ordinary = syntheticNode("cutover_ordinary", { details: "Editable Text" });
  const supported = normaliseOne(context, fixture("current-outline-v1.json").mainThoughtTree[0]);
  resetState(context, [unsupported, ordinary, supported]);
  let standaloneCalls = 0;
  let legacyBridgeCalls = 0;
  let legacyPopupCalls = 0;
  const statuses = [];
  context.PocketPeEditor = {
    open() {
      standaloneCalls += 1;
      return false;
    },
  };
  context.openDetailsEditorForSelectedNode = () => { legacyBridgeCalls += 1; };
  context.PocketEditorPopout = {
    open() {
      legacyPopupCalls += 1;
      return true;
    },
  };
  context.setStatus = (message, tone) => { statuses.push({ message, tone }); };
  context.document.readyState = "complete";
  runScript(context, "js/pocket-editor-cutover-v3.js");

  assert.equal(context.openPocketNodeEditor(unsupported.id), false);
  assert.equal(standaloneCalls, 1);
  assert.equal(legacyBridgeCalls, 0);
  assert.equal(legacyPopupCalls, 0);
  assert.deepEqual(statuses.at(-1), {
    message: "This item requires Pocket's read-only compatibility view. Its editor data was not changed.",
    tone: "warn",
  });

  assert.equal(context.openPocketEditor(ordinary.id), false);
  assert.equal(standaloneCalls, 2);
  assert.equal(legacyBridgeCalls, 0);
  assert.equal(legacyPopupCalls, 0);
  assert.match(statuses.at(-1).message, /safe editor could not open/i);

  assert.equal(context.openPocketNodeEditor(supported.id), false);
  assert.equal(standaloneCalls, 3);
  assert.equal(legacyBridgeCalls, 0);
  assert.equal(legacyPopupCalls, 0);
});

test("active and compatibility popouts contain no Notes-Outline conversion route", () => {
  for (const file of [
    "js/pocket-node-popout-runtime.js",
    "js/pocket-editor-popout.js",
    "js/pocket-editor-popout-v2.js",
  ]) {
    const program = source(file);
    assert.equal(program.includes("function textToOutline"), false, file);
    assert.equal(program.includes("function outlineToText"), false, file);
  }
  for (const file of [
    "js/pocket-node-popout-template.js",
    "js/pocket-editor-popout.js",
    "js/pocket-editor-popout-v2.js",
  ]) {
    const program = source(file);
    assert.equal(program.includes(">Notes<"), true, file);
    assert.equal(program.includes(">Outline<"), true, file);
  }
  const activeRuntime = source("js/pocket-node-popout-runtime.js");
  assert.equal(activeRuntime.includes("outlineBlocksFromPastedText"), true);
  assert.equal(activeRuntime.includes("outlineBlocksFromPastedText(bodyInput.value"), false);
});

test("legacy PE bridge and dirty-save route delegate to canonical identity validation and fail closed unbound", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("legacy_unbound", { details: "Before" });
  const state = resetState(context, [node]);
  runScript(context, "js/pocket-pe-node-popout-bridge.js");
  runScript(context, "js/pocket-pe-save-dirty.js");
  const unbound = {
    id: node.id,
    title: node.label,
    body: "Must not apply",
    mode: "text",
    outline: null,
  };
  assert.equal(context.PocketPeEditor.apply(unbound), false);
  const result = await context.__pocketPeApplyAndSave(unbound);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing-source-identity");
  assert.equal(result.applied, false);
  assert.equal(state.nodes[0].details, "Before");
  assert.equal(state.ops.length, 0);
});

test("main-tree Enter remains owned only by handleTreeKeydown in the active script set", () => {
  const scripts = indexScriptSources();
  assert.ok(scripts.includes("js/pocket-overlays-init.js"));
  assert.ok(scripts.includes("js/pocket-enter-copy-only.js"));
  assert.equal(scripts.includes("js/pocket-enter-preflight.js"), false);
  const overlays = source("js/pocket-overlays-init.js");
  const guard = source("js/pocket-enter-copy-only.js");
  assert.equal(overlays.split('el.treeWrap?.addEventListener("keydown", handleTreeKeydown)').length - 1, 1);
  assert.equal(guard.includes('addEventListener("keydown", handleEnter'), false);
  assert.match(guard, /Enter capture disabled/);
});

test("P056 main-tree collapse and expand shortcuts respect keyboard ownership and preserve arrow shortcuts", () => {
  class KeyboardElement {
    constructor(tagName = "div") { this.tagName = String(tagName).toUpperCase(); this.isContentEditable = false; }
  }
  const search = new KeyboardElement("input");
  const context = {
    URL, Date, Math, JSON, Map, Set, Promise, Object, Array, String, Number, Boolean,
    location: { href: "https://example.test/index.html" },
    HTMLElement: KeyboardElement, HTMLInputElement: KeyboardElement, document: {
      getElementById(id) { return id === "search" ? search : null; },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  runScript(context, "js/pocket-state.js");
  const calls = { collapse: 0, expand: 0, render: 0 };
  context.isDetailsEditorOpen = () => false;
  context.isControlsHelpOpen = () => false;
  context.isCommandPaletteOpen = () => false;
  context.isPocketVaultRecoveryFlowOpen = () => false;
  context.isPocketDeviceChangesDecisionOpen = () => false;
  context.collapseAllNodes = () => { calls.collapse += 1; };
  context.unfoldAllNodes = () => { calls.expand += 1; };
  context.refreshMeta = () => {};
  context.renderTree = () => { calls.render += 1; };
  context.refocusTreeNavigation = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  context.persistPipSnapshot = () => {};
  context.setStatus = () => {};
  runScript(context, "js/pocket-tree-actions.js");
  context.refocusTreeNavigation = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  vm.runInContext("state.inlineEdit.id = ''; state.selectedId = 'selected';", context);
  const dispatch = (key, extras = {}) => {
    const event = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extras };
    context.handleTreeKeydown(event);
    return event;
  };
  assert.equal(dispatch(",", { ctrlKey: true }).defaultPrevented, true);
  assert.equal(calls.collapse, 1);
  assert.equal(calls.expand, 0);
  assert.equal(calls.render, 1);
  assert.equal(dispatch(".", { metaKey: true }).defaultPrevented, true);
  assert.equal(calls.expand, 1);
  assert.equal(calls.render, 2);
  const editable = new KeyboardElement("input");
  assert.equal(dispatch(",", { ctrlKey: true, target: editable }).defaultPrevented, false);
  assert.equal(calls.collapse, 1);
  assert.equal(dispatch(",", { ctrlKey: true, target: search }).defaultPrevented, false);
  assert.equal(calls.collapse, 1);
  vm.runInContext("state.inlineEdit.id = 'renaming';", context);
  assert.equal(dispatch(",", { ctrlKey: true }).defaultPrevented, false);
  assert.equal(calls.collapse, 1);
  vm.runInContext("state.inlineEdit.id = '';", context);
});

test("P058 main-tree Ctrl/Cmd arrows move whole branches while plain arrows stay navigational", () => {
  class TreeKeyboardElement {}
  const search = new TreeKeyboardElement();
  const context = {
    URL, Date, Math, JSON, Map, Set, Promise, Object, Array, String, Number, Boolean,
    location: { href: "https://example.test/index.html" },
    HTMLElement: TreeKeyboardElement,
    HTMLInputElement: TreeKeyboardElement,
    document: { getElementById(id) { return id === "search" ? search : null; } },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  runScript(context, "js/pocket-state.js");
  context.renderTree = () => {};
  context.refreshMeta = () => {};
  context.refocusTreeNavigation = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  context.persistPipSnapshot = () => {};
  context.setStatus = () => {};
  context.saveWorkspaceState = () => {};
  context.flashTouchedRow = () => {};
  context.recordOp = () => {};
  context.createTreeUndoSnapshot = () => null;
  context.nowIso = () => "2026-01-01T00:00:00.000Z";
  context.expandPathToNode = () => {};
  context.requestAnimationFrame = (callback) => callback();
  context.requirePocketFileForChanges = () => true;
  context.isDetailsEditorOpen = () => false;
  context.isControlsHelpOpen = () => false;
  context.isCommandPaletteOpen = () => false;
  context.isPocketVaultRecoveryFlowOpen = () => false;
  context.isPocketDeviceChangesDecisionOpen = () => false;
  context.nodeMap = () => new Map(lexicalState(context).nodes.map((node) => [node.id, node]));
  context.compareSiblingOrder = (left, right) => Number(left.order) - Number(right.order);
  context.renumberChildren = (parentId) => {
    lexicalState(context).nodes
      .filter((node) => (node.parentId || "root") === (parentId || "root"))
      .sort(context.compareSiblingOrder)
      .forEach((node, index) => { node.order = 1001 + index; });
  };
  context.maxSiblingOrder = (parentId) => Math.max(1000, ...lexicalState(context).nodes
    .filter((node) => (node.parentId || "root") === (parentId || "root"))
    .map((node) => Number(node.order) || 0));
  const state = resetState(context, [
    syntheticNode("p058_a", { label: "A", parentId: "root", order: 1001 }),
    syntheticNode("p058_a_child", { label: "A child", parentId: "p058_a", order: 1001 }),
    syntheticNode("p058_b", { label: "B", parentId: "root", order: 1002 }),
    syntheticNode("p058_b_child", { label: "B child", parentId: "p058_b", order: 1001 }),
  ]);
  runScript(context, "js/pocket-tree-actions.js");
  context.refocusTreeNavigation = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  state.inlineEdit.id = "";
  state.detailsEdit.id = "";
  let visibleDelta = 0;
  context.moveSelectionByVisibleDelta = (delta) => { visibleDelta += delta; };
  const dispatch = (key, extras = {}) => {
    const event = {
      key,
      ctrlKey: extras.ctrlKey === true,
      metaKey: extras.metaKey === true,
      altKey: false,
      shiftKey: false,
      target: null,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    context.handleTreeKeydown(event);
    return event;
  };
  state.selectedId = "p058_b";
  assert.equal(vm.runInContext("isDetailsEditorOpen()", context), false);
  assert.equal(vm.runInContext("state.inlineEdit.id", context), "");
  assert.equal(vm.runInContext("pendingPathImport", context), null);
  assert.equal(vm.runInContext("state.moveMode", context), false);
  let event = dispatch("ArrowUp", { ctrlKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(state.nodes.filter((node) => node.parentId === "root").sort((a, b) => a.order - b.order).map((node) => node.id), ["p058_b", "p058_a"]);
  assert.equal(state.nodes.find((node) => node.id === "p058_b_child").parentId, "p058_b");
  event = dispatch("ArrowDown", { metaKey: true });
  assert.deepEqual(state.nodes.filter((node) => node.parentId === "root").sort((a, b) => a.order - b.order).map((node) => node.id), ["p058_a", "p058_b"]);
  event = dispatch("ArrowLeft", { ctrlKey: true });
  assert.equal(state.nodes.find((node) => node.id === "p058_b").parentId, "root");
  event = dispatch("ArrowRight", { ctrlKey: true });
  assert.equal(state.nodes.find((node) => node.id === "p058_b").parentId, "p058_a");
  assert.equal(state.nodes.find((node) => node.id === "p058_b_child").parentId, "p058_b");
  state.selectedId = "p058_a";
  event = dispatch("ArrowDown");
  assert.equal(visibleDelta, 1);
});

test("P060 main-tree disclosure owns selection and navigation while leaf gutters keep a structural marker", () => {
  const harness = createTreeRenderHarness([
    syntheticNode("p060_parent", { label: "Parent", parentId: "root", order: 1001 }),
    syntheticNode("p060_child", { label: "Child", parentId: "p060_parent", order: 1001 }),
    syntheticNode("p060_leaf", { label: "Leaf", parentId: "root", order: 1002 }),
  ]);
  const row = (id) => harness.treeRoot.querySelectorAll(".row").find((candidate) => candidate.getAttribute("data-node-id") === id);
  const parentGutter = row("p060_parent").children[0];
  const leafGutter = row("p060_leaf").children[0];
  assert.equal(parentGutter.textContent, "▾");
  assert.equal(leafGutter.textContent, "▸");
  assert.equal(leafGutter.classList.contains("empty"), true);

  let refocusedId = "";
  let copied = 0;
  let opened = 0;
  harness.context.refocusTreeNavigation = (id) => { refocusedId = id; };
  harness.context.shouldCopyOnSingleClick = () => true;
  harness.context.scheduleCopyClick = () => { copied += 1; };
  harness.context.openPocketPeEditor = () => { opened += 1; return true; };
  const event = parentGutter.dispatch("click");
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.state.selectedId, "p060_parent");
  assert.equal(harness.state.collapsed.has("p060_parent"), true);
  assert.equal(refocusedId, "p060_parent");
  assert.equal(copied, 0);
  assert.equal(opened, 0);
});

test("P060a main-tree gutter drops allow canonical depth while preserving branch and safety contracts", () => {
  const context = createFullContractContext();
  context.renderTree = () => {};
  context.refreshMeta = () => {};
  context.refocusTreeNavigation = () => {};
  context.setStatus = () => {};
  context.flashTouchedRow = () => {};
  context.requirePocketFileForChanges = () => true;
  context.maxSiblingOrder = (parentId) => Math.max(1000, ...lexicalState(context).nodes
    .filter((node) => (node.parentId || "root") === (parentId || "root"))
    .map((node) => Number(node.order) || 0));
  const state = resetState(context, [
    syntheticNode("p060_a", { label: "A", parentId: "root", order: 1001 }),
    syntheticNode("p060_a_child", { label: "A child", parentId: "p060_a", order: 1001 }),
    syntheticNode("p060_b", { label: "B", parentId: "root", order: 1002 }),
    syntheticNode("p060_b_child", { label: "B child", parentId: "p060_b", order: 1001 }),
  ]);
  runScript(context, "js/pocket-tree-actions.js");
  assert.equal(context.moveTreeBranchByDrop("p060_a", "p060_b", "inside"), true);
  assert.equal(state.nodes.find((node) => node.id === "p060_a").parentId, "p060_b");
  assert.equal(state.nodes.find((node) => node.id === "p060_a_child").parentId, "p060_a");
  assert.equal(state.selectedId, "p060_a");
  const beforeIllegalDrop = plain(state.nodes);
  assert.equal(context.moveTreeBranchByDrop("p060_b", "p060_a_child", "inside"), false);
  assert.deepEqual(plain(state.nodes), beforeIllegalDrop);
  assert.equal(context.moveTreeBranchByDrop("p060_a", "p060_b", "before"), true);
  assert.equal(state.nodes.find((node) => node.id === "p060_a").parentId, "root");
  assert.equal(state.nodes.find((node) => node.id === "p060_a_child").parentId, "p060_a");

  resetState(context, [
    ...Array.from({ length: 10 }, (_, index) => syntheticNode(`p060a_deep_${index}`, {
      parentId: index === 0 ? "root" : `p060a_deep_${index - 1}`,
      order: 1001,
    })),
    syntheticNode("p060a_moving", { parentId: "root", order: 1002 }),
    syntheticNode("p060a_moving_child", { parentId: "p060a_moving", order: 1001 }),
    syntheticNode("p060a_managed", {
      parentId: "root",
      order: 1003,
      system: { kind: "bucket", managed: true },
    }),
  ]);
  assert.equal(context.moveTreeBranchByDrop("p060a_moving", "p060a_deep_9", "inside"), true);
  assert.equal(state.nodes.find((node) => node.id === "p060a_moving").parentId, "p060a_deep_9");
  assert.equal(state.nodes.find((node) => node.id === "p060a_moving_child").parentId, "p060a_moving");
  assert.equal(state.selectedId, "p060a_moving");
  const beforeManagedDrop = plain(state.nodes);
  assert.equal(context.moveTreeBranchByDrop("p060a_managed", "p060a_deep_0", "inside"), false);
  assert.deepEqual(plain(state.nodes), beforeManagedDrop);
});

test("P060a main-tree drag suppression is gesture-scoped and fully cleans up", () => {
  const makeHarness = () => createTreeRenderHarness([
    syntheticNode("p060a_parent", { label: "Parent", parentId: "root", order: 1001 }),
    syntheticNode("p060a_child", { label: "Child", parentId: "p060a_parent", order: 1001 }),
    syntheticNode("p060a_leaf", { label: "Leaf", parentId: "root", order: 1002 }),
  ], "", { withDragActions: true });
  const row = (harness, id) => harness.treeRoot.querySelectorAll(".row")
    .find((candidate) => candidate.getAttribute("data-node-id") === id);

  const belowThreshold = makeHarness();
  const leafGutter = row(belowThreshold, "p060a_leaf").children[0];
  leafGutter.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  belowThreshold.context.document.pointedElement = row(belowThreshold, "p060a_parent").children[0];
  belowThreshold.context.document.dispatch("pointermove", { clientX: 3, clientY: 4 });
  belowThreshold.context.document.dispatch("pointerup", { clientX: 3, clientY: 4 });
  leafGutter.dispatch("click");
  assert.equal(belowThreshold.state.selectedId, "p060a_leaf");
  assert.equal(belowThreshold.documentListenerCount("pointermove"), 0);

  const syntheticClick = makeHarness();
  const syntheticSource = row(syntheticClick, "p060a_parent").children[0];
  syntheticSource.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  syntheticClick.context.document.dispatch("pointermove", { clientX: 7, clientY: 0 });
  syntheticClick.context.document.pointedElement = row(syntheticClick, "p060a_child").children[0];
  syntheticClick.context.document.dispatch("pointerup", { clientX: 7, clientY: 15 });
  assert.equal(syntheticSource.listenerCount("click"), 2);
  assert.equal(syntheticSource.dispatch("click").defaultPrevented, true);
  assert.equal(syntheticClick.state.collapsed.has("p060a_parent"), false);
  assert.equal(syntheticSource.listenerCount("click"), 1);

  const expired = makeHarness();
  const expiredSource = row(expired, "p060a_parent").children[0];
  expiredSource.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  expired.context.document.dispatch("pointermove", { clientX: 7, clientY: 0 });
  expired.context.document.pointedElement = row(expired, "p060a_child").children[0];
  expired.context.document.dispatch("pointerup", { clientX: 7, clientY: 15 });
  expired.flushZeroTimers();
  assert.equal(expiredSource.listenerCount("click"), 1);
  expiredSource.dispatch("click");
  assert.equal(expired.state.collapsed.has("p060a_parent"), true);
  assert.equal(expired.documentListenerCount("pointermove"), 0);

  const cancelled = makeHarness();
  const cancelledSource = row(cancelled, "p060a_parent").children[0];
  cancelledSource.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  cancelled.context.document.dispatch("pointermove", { clientX: 7, clientY: 0 });
  cancelled.context.document.dispatch("pointercancel");
  assert.equal(cancelled.documentListenerCount("pointermove"), 0);
  assert.equal(cancelled.documentListenerCount("pointerup"), 0);
  assert.equal(cancelled.documentListenerCount("pointercancel"), 0);
  cancelledSource.dispatch("click");
  assert.equal(cancelled.state.collapsed.has("p060a_parent"), true);
});

test("P063 main-tree drag feedback follows the existing threshold and destination calculation", () => {
  const harness = createTreeRenderHarness([
    syntheticNode("p063_main_a", { label: "A", parentId: "root", order: 1001 }),
    syntheticNode("p063_main_b", { label: "B", parentId: "root", order: 1002 }),
  ], "", { withDragActions: true });
  const row = (id) => harness.treeRoot.querySelectorAll(".row")
    .find((candidate) => candidate.getAttribute("data-node-id") === id);
  harness.context.createTreeUndoSnapshot = () => null;
  harness.context.recordOp = () => {};
  harness.context.saveWorkspaceState = () => {};
  harness.context.persistPipSnapshot = () => {};
  harness.context.flashTouchedRow = () => {};
  harness.context.expandPathToNode = () => {};
  const source = row("p063_main_b").children[0];
  const target = row("p063_main_a");

  source.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  harness.context.document.pointedElement = target.children[0];
  harness.context.document.dispatch("pointermove", { clientX: 3, clientY: 4 });
  assert.equal(source.classList.contains("branchDragSource"), false);
  harness.context.document.dispatch("pointermove", { clientX: 7, clientY: 2 });
  assert.equal(source.classList.contains("branchDragSource"), true);
  assert.equal(row("p063_main_b").classList.contains("branchDragLifted"), true);
  assert.equal(target.classList.contains("branchDropBefore"), true);
  assert.equal(harness.context.document.body.children.some((child) => child.classList.contains("branchDragGhost")), true);
  harness.context.document.dispatch("pointerup", { clientX: 7, clientY: 2 });
  assert.equal(source.classList.contains("branchDragSource"), false);
  assert.equal(target.classList.contains("branchDropBefore"), false);
  assert.equal(harness.context.document.body.children.some((child) => child.classList.contains("branchDragGhost")), false);
});

test("an unrelated edit preserves raw editor metadata while later export omits retired pe", () => {
  const context = createFullContractContext();
  const unknown = fixture("unknown-editor-schema.json").mainThoughtTree[0];
  const malformed = fixture("malformed-editor.json").mainThoughtTree[0];
  const largeEditor = largeCurrentEditor();
  const largePe = largeLegacyPe();
  const input = {
    schema: "portal.export.v1",
    writtenAt: "2026-01-01T00:00:00.000Z",
    mainThoughtTree: [
      unknown,
      malformed,
      syntheticNode("unrelated_large_editor", { details: "Large fallback", editor: largeEditor, pe: null }),
      syntheticNode("unrelated_large_pe", { details: "Legacy fallback", pe: largePe }),
      syntheticNode("unrelated_target", { details: "Before", pe: null }),
    ],
    mainThoughtTreeTombstones: [],
  };
  const normalised = context.normaliseInput(input);
  context.applyLoadedState(normalised, {
    schema: normalised.schema,
    fileName: "unrelated.json",
    writtenAt: normalised.writtenAt,
  }, { skipLocalSafetyCheck: true });
  establishSyntheticSession(context, "unrelated.json");
  const state = lexicalState(context);
  const target = state.nodes.find((node) => node.id === "unrelated_target");
  const changed = context.PocketNodePopoutEditor.apply(editorPayload(context, target, {
    title: "Synthetic unrelated_target",
    body: "After",
    mode: "text",
    outline: null,
  }));
  assert.equal(changed, true);
  assert.equal(state.ops.length, 1);

  const exported = context.buildPocketPayload("2026-02-03T00:00:00.000Z");
  const byId = new Map(exported.mainThoughtTree.map((node) => [node.id, node]));
  assert.equal(JSON.stringify(byId.get(unknown.id).editor), JSON.stringify(unknown.editor));
  assert.equal(JSON.stringify(byId.get(malformed.id).editor), JSON.stringify(malformed.editor));
  assert.equal(JSON.stringify(byId.get("unrelated_large_editor").editor), JSON.stringify(largeEditor));
  assert.equal(Object.hasOwn(byId.get("unrelated_large_pe"), "pe"), false);
  assert.equal(byId.get("unrelated_target").details, "After");
  assert.equal(exported.mainThoughtTree.every((node) => !Object.hasOwn(node, "pe")), true);
  assert.equal(exported.data.mainThoughtTree.every((node) => !Object.hasOwn(node, "pe")), true);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("local safety, trail, auto-cache, and PiP recovery retain editor metadata while discarding pe", () => {
  const currentEditor = largeCurrentEditor();
  const unknownEditor = largeUnknownEditor();
  const legacyPe = largeLegacyPe();
  const rawNodes = [
    syntheticNode("recovery_current", { details: "Current recovery view", editor: currentEditor, pe: null }),
    syntheticNode("recovery_unknown", { details: "Unknown recovery view", editor: unknownEditor, pe: null }),
    syntheticNode("recovery_pe", { details: "Legacy recovery view", editor: null, pe: legacyPe }),
  ];
  const payload = {
    schema: "portal.export.v1",
    writtenAt: "2026-02-04T00:00:00.000Z",
    mainThoughtTree: rawNodes,
    mainThoughtTreeTombstones: [],
  };

  function assertRecoveredMetadata(nodes) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    assert.equal(JSON.stringify(byId.get("recovery_current").editor), JSON.stringify(currentEditor));
    assert.equal(JSON.stringify(byId.get("recovery_unknown").editor), JSON.stringify(unknownEditor));
    assert.equal(Object.hasOwn(byId.get("recovery_pe"), "pe"), false);
    assert.equal(byId.get("recovery_pe").details, "Legacy recovery view");
  }

  const context = createFullContractContext();
  let normaliseCalls = 0;
  const canonicalOwner = context.normaliseNodes;
  context.normaliseNodes = function countedNormaliseNodes(raw) {
    normaliseCalls += 1;
    return canonicalOwner(raw);
  };
  const safetyEntry = {
    schema: "pocket.localSafety.v1",
    capturedAt: "2026-02-04T00:01:00.000Z",
    reason: "test",
    source: { schema: "portal.export.v1", fileName: "recovery.json", writtenAt: payload.writtenAt },
    selectedId: "recovery_unknown",
    focusRootId: "",
    collapsedIds: ["recovery_current"],
    ops: [{ type: "synthetic_recovery" }],
    payload,
  };
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(safetyEntry));
  const snapshot = context.readLocalSafetySnapshot();
  assert.ok(snapshot);
  assertRecoveredMetadata(snapshot.norm.nodes);
  assert.ok(normaliseCalls >= 1);

  context.__storage.set("pocketLite.localSafety.trail.v1", JSON.stringify([safetyEntry]));
  const trail = context.readLocalSafetyTrail();
  assert.equal(trail.length, 1);
  assertRecoveredMetadata(trail[0].norm.nodes);
  assert.ok(normaliseCalls >= 2);

  const beforeRecoveryIdentity = establishSyntheticSession(context, "recovery.json");
  assert.equal(context.restoreLocalSafetySnapshot(snapshot), true);
  const recoveredIdentity = plain(context.capturePocketEditorSourceIdentity());
  assert.ok(recoveredIdentity.fileSessionId > beforeRecoveryIdentity.fileSessionId);
  const restoredState = lexicalState(context);
  assertRecoveredMetadata(restoredState.nodes);
  assert.equal(restoredState.selectedId, "recovery_unknown");
  assert.equal(restoredState.collapsed.has("recovery_current"), true);
  assert.equal(restoredState.ops.length, 1);
  assert.equal(restoredState.ops[0].type, "synthetic_recovery");
  assert.ok(Number.isSafeInteger(restoredState.ops[0].seq) && restoredState.ops[0].seq > 0);
  assert.equal(context.PocketNodePopoutModel.buildPayload(restoredState.nodes.find((node) => node.id === "recovery_unknown")).readOnly, true);
  assert.equal(context.saveLocalSafetySnapshot("p014-recovered"), true);
  assertNoRetiredPe(JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1")), "rewritten recovered safety");
  const rewrittenTrail = JSON.parse(context.__storage.get("pocketLite.localSafety.trail.v1"));
  const rewrittenEntry = rewrittenTrail.find((entry) => entry?.reason === "p014-recovered");
  assert.ok(rewrittenEntry);
  assertNoRetiredPe(rewrittenEntry, "new rewritten recovered trail entry");

  context.__storage.set("pocketLite.auto.cache.v1", JSON.stringify({
    cachedAt: "2026-02-04T00:02:00.000Z",
    source: { schema: "portal.export.v1", fileName: "recovery-cache.json", writtenAt: payload.writtenAt },
    data: { mainThoughtTree: rawNodes, mainThoughtTreeTombstones: [] },
  }));
  const cache = context.restoreAutoCache();
  assert.ok(cache);
  assertRecoveredMetadata(cache.norm.nodes);
  assert.ok(normaliseCalls >= 3);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showOpenFilePicker, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);

  const pipContext = createFullContractContext({ href: "https://example.test/index.html?pip=1" });
  let pipNormaliseCalls = 0;
  const pipCanonicalOwner = pipContext.normaliseNodes;
  pipContext.normaliseNodes = function countedPipNormaliseNodes(raw) {
    pipNormaliseCalls += 1;
    return pipCanonicalOwner(raw);
  };
  pipContext.__storage.set("pocketLite.pip.snapshot.v1", JSON.stringify({
    savedAt: "2026-02-04T00:03:00.000Z",
    source: { schema: "portal.export.v1", fileName: "recovery-pip.json", writtenAt: payload.writtenAt },
    nodes: rawNodes,
    tombstones: [],
    rootExtras: {},
    dataExtras: {},
    selectedId: "recovery_unknown",
    focusRootId: "",
    collapsedIds: ["recovery_current"],
    ops: [{ type: "synthetic_pip" }],
  }));
  assert.equal(pipContext.restoreFromPipSnapshot(), true);
  const pipIdentity = plain(pipContext.capturePocketEditorSourceIdentity());
  assert.equal(pipIdentity.sourcePipSession, true);
  assert.ok(pipIdentity.fileSessionId > 0);
  const pipState = lexicalState(pipContext);
  assertRecoveredMetadata(pipState.nodes);
  assert.equal(pipNormaliseCalls, 1);
  assert.equal(pipState.selectedId, "recovery_unknown");
  assert.equal(pipState.collapsed.has("recovery_current"), true);
  assert.equal(pipContext.PocketNodePopoutModel.buildPayload(pipState.nodes.find((node) => node.id === "recovery_unknown")).readOnly, true);
  pipContext.persistPipSnapshot();
  assertNoRetiredPe(JSON.parse(pipContext.__storage.get("pocketLite.pip.snapshot.v1")), "rewritten PiP snapshot");
  assert.equal(pipContext.__surfaceCalls.writeTruthFile, 0);
  assert.equal(pipContext.__surfaceCalls.showOpenFilePicker, 0);
  assert.equal(pipContext.__surfaceCalls.showSaveFilePicker, 0);
});

test("returned PiP whole-document adoption renews the editor source session", async () => {
  const pipContext = createFullContractContext();
  resetState(pipContext, [syntheticNode("pip_before", { details: "Before PiP return" })]);
  const pipBefore = plain(pipContext.capturePocketEditorSourceIdentity());
  const pipAdopted = pipContext.adoptPocketLiteSessionState({
    source: {
      schema: "portal.export.v1",
      fileName: "pip-return.json",
      writtenAt: "2026-02-01T00:00:00.000Z",
    },
    nodes: [syntheticNode("pip_after", { details: "After PiP return" })],
    tombstones: [],
    rootExtras: {},
    dataExtras: {},
    selectedId: "pip_after",
    focusRootId: "",
    collapsedIds: [],
    ops: [{ type: "synthetic_pip_change" }],
  });
  const pipAfter = plain(pipContext.capturePocketEditorSourceIdentity());
  assert.equal(pipAdopted, true);
  assert.ok(pipAfter.fileSessionId > pipBefore.fileSessionId);
  assert.equal(lexicalState(pipContext).nodes[0].id, "pip_after");
  assert.equal(pipContext.__surfaceCalls.writeTruthFile, 0);
  assert.equal(pipContext.__surfaceCalls.showSaveFilePicker, 0);
});

test("document sessions renew on each successful load but not on a routine same-handle session refresh", async () => {
  const context = createFullContractContext();
  const handle = { name: "same.json" };
  const makeFile = (label) => ({
    name: "same.json",
    async text() {
      return JSON.stringify({
        schema: "portal.export.v1",
        writtenAt: "2026-01-01T00:00:00.000Z",
        mainThoughtTree: [syntheticNode("same_handle", { label, details: label })],
        mainThoughtTreeTombstones: [],
      });
    },
  });

  assert.equal(await context.loadFromFile(makeFile("First"), {
    fileSession: { handle, displayName: "same.json" },
  }), true);
  const first = plain(context.capturePocketEditorSourceIdentity());
  context.setPocketFileSession(handle, "same.json");
  assert.deepEqual(plain(context.capturePocketEditorSourceIdentity()), first);

  assert.equal(await context.loadFromFile(makeFile("Second"), {
    fileSession: { handle, displayName: "same.json" },
  }), true);
  const second = plain(context.capturePocketEditorSourceIdentity());
  assert.ok(second.fileSessionId > first.fileSessionId);
  assert.equal(second.sourceFileName, first.sourceFileName);
  assert.equal(lexicalState(context).nodes[0].label, "Second");
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showOpenFilePicker, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("successful write to the already active handle keeps the document session identity", async () => {
  const context = createFullContractContext();
  resetState(context, [syntheticNode("same_write", { details: "Write safely" })], [{ type: "same_write_change" }]);
  let writes = 0;
  const handle = {
    name: "same-write.json",
    async queryPermission() { return "granted"; },
    async createWritable() {
      return {
        async write(value) {
          writes += 1;
          assert.match(String(value), /"same_write"/);
        },
        async close() {},
      };
    },
  };
  context.setPocketFileSession(handle, "same-write.json", { forceNewSession: true });
  const beforeIdentity = plain(context.capturePocketEditorSourceIdentity());
  const saveSession = context.capturePocketFileSaveSession();
  const payload = context.buildPocketPayload("2026-01-02T00:00:00.000Z");
  const result = await context.writeTruthFile(payload, { expectedSession: saveSession });
  const afterIdentity = plain(context.capturePocketEditorSourceIdentity());
  assert.equal(result.ok, true);
  assert.equal(result.target, "opened-file");
  assert.equal(writes, 1);
  assert.deepEqual(afterIdentity, beforeIdentity);
  assert.deepEqual(plain(result.sourceIdentity), beforeIdentity);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("PE apply fails closed for no file, missing or malformed identity, and a wrong document session", async () => {
  const cases = [
    ["missing identity", (payload) => {
      delete payload.fileSessionId;
      delete payload.sourceFileName;
      delete payload.sourcePipSession;
    }, "missing-source-identity"],
    ["malformed identity", (payload) => {
      payload.fileSessionId = "1";
    }, "missing-source-identity"],
    ["missing revision", (payload) => {
      delete payload.originalUpdatedAt;
    }, "missing-node-revision"],
    ["wrong session", (payload) => {
      payload.fileSessionId += 1;
    }, "file-session-changed"],
  ];

  for (const [label, mutate, reason] of cases) {
    const context = createFullContractContext();
    const node = syntheticNode(`identity_${reason}`, { details: "Before" });
    const state = resetState(context, [node]);
    state.selectedId = node.id;
    const payload = editorPayload(context, node, { body: "After" });
    mutate(payload);
    const before = snapshotSaveBoundary(context, node.id);
    let exportCalls = 0;
    context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
    const result = await context.PocketNodePopoutEditor.applyAndSave(payload);
    assert.equal(result.reason, reason, label);
    assert.equal(result.applied, false, label);
    assertSaveBoundaryUnchanged(context, node.id, before);
    assert.equal(exportCalls, 0, label);
  }

  const noFileContext = createFullContractContext();
  const noFileNode = syntheticNode("identity_no_file", { details: "Before" });
  resetState(noFileContext, [noFileNode]);
  const noFilePayload = editorPayload(noFileContext, noFileNode, { body: "After" });
  noFileContext.clearPocketFileSession();
  const noFileBefore = snapshotSaveBoundary(noFileContext, noFileNode.id);
  const noFileResult = await noFileContext.PocketNodePopoutEditor.applyAndSave(noFilePayload);
  assert.equal(noFileResult.reason, "no-pocket-file");
  assertSaveBoundaryUnchanged(noFileContext, noFileNode.id, noFileBefore);
});

test("file A editor cannot mutate file B even when filename and node ID are identical", async () => {
  const context = createFullContractContext();
  const nodeA = syntheticNode("shared_id", { label: "File A", details: "A body" });
  resetState(context, [nodeA]);
  const stalePayload = editorPayload(context, nodeA, { title: "Old editor", body: "Old editor body" });

  const state = lexicalState(context);
  const nodeB = syntheticNode("shared_id", { label: "File B", details: "B body" });
  state.nodes = [plain(nodeB)];
  state.ops = [];
  state.selectedId = nodeB.id;
  const handleB = { name: "synthetic.json" };
  context.setPocketFileSession(handleB, "synthetic.json", { forceNewSession: true });
  const before = snapshotSaveBoundary(context, nodeB.id);
  let exportCalls = 0;
  context.exportTree = async () => { exportCalls += 1; return { ok: true }; };

  const result = await context.PocketNodePopoutEditor.applyAndSave(stalePayload);
  assert.equal(result.reason, "file-session-changed");
  assert.equal(result.applied, false);
  assertSaveBoundaryUnchanged(context, nodeB.id, before);
  assert.equal(exportCalls, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("PiP editor identity is JSON-safe and authoritative without exposing a file handle", () => {
  const context = createFullContractContext({ href: "https://example.test/index.html?pip=1" });
  const node = syntheticNode("pip_identity", { details: "PiP body" });
  const state = resetState(context, [node]);
  context.setPocketFileSession(null, "PiP synthetic.json", { pipSession: true, forceNewSession: true });
  const payload = context.PocketNodePopoutModel.buildPayload(state.nodes[0]);
  assert.equal(payload.sourcePipSession, true);
  assert.equal(payload.sourceFileName, "PiP synthetic.json");
  assert.equal(Number.isSafeInteger(payload.fileSessionId), true);
  assert.equal(context.isPocketEditorSourceIdentityCurrent({
    fileSessionId: payload.fileSessionId,
    sourceFileName: payload.sourceFileName,
    sourcePipSession: payload.sourcePipSession,
    sourceOwnerKind: payload.sourceOwnerKind,
    sourceVaultSessionId: payload.sourceVaultSessionId,
  }), true);
  assert.equal(JSON.stringify(payload).includes("createWritable"), false);
});

test("node revision binding rejects changed labels, details, and supported editor content", async () => {
  const variants = [
    ["label", (payload) => { payload.title = "Changed elsewhere"; }],
    ["details", (payload) => { payload.body = "Changed elsewhere"; }],
    ["editor", (payload) => {
      payload.outline[0].text = "Changed elsewhere";
      payload.body = "Changed elsewhere projection";
    }],
  ];

  for (const [label, mutateNewer] of variants) {
    const context = createFullContractContext();
    const raw = label === "editor"
      ? fixture("current-outline-v1.json").mainThoughtTree[0]
      : syntheticNode(`revision_${label}`, { details: "Original" });
    const state = resetState(context, [raw]);
    const target = state.nodes[0];
    const stale = editorPayload(context, target, { body: label === "editor" ? target.details : "Stale editor value" });
    const newer = editorPayload(context, target);
    mutateNewer(newer);
    assert.equal(context.PocketNodePopoutEditor.apply(newer), true);
    let workspaceCalls = 0;
    let pipCalls = 0;
    context.saveWorkspaceState = () => { workspaceCalls += 1; };
    context.persistPipSnapshot = () => { pipCalls += 1; };
    const beforeStaleSave = snapshotSaveBoundary(context, target.id);
    let exportCalls = 0;
    context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
    const result = await context.PocketNodePopoutEditor.applyAndSave(stale);
    assert.equal(result.reason, "node-revision-changed", label);
    assertSaveBoundaryUnchanged(context, target.id, beforeStaleSave);
    assert.equal(exportCalls, 0, label);
    assert.equal(workspaceCalls, 0, label);
    assert.equal(pipCalls, 0, label);
    assert.equal(context.__surfaceCalls.showSaveFilePicker, 0, label);
  }
});

test("an unrelated node revision does not stale the target editor, while deletion rejects missing-node", async () => {
  const context = createFullContractContext();
  const nodeX = syntheticNode("revision_x", { details: "X before" });
  const nodeY = syntheticNode("revision_y", { details: "Y before" });
  const state = resetState(context, [nodeX, nodeY]);
  const openingX = editorPayload(context, nodeX, { body: "X after" });
  const newerY = editorPayload(context, nodeY, { body: "Y after" });
  assert.equal(context.PocketNodePopoutEditor.apply(newerY), true);
  context.exportTree = async () => ({
    ok: true,
    reason: "truth-file",
    sourceIdentity: plain(context.capturePocketEditorSourceIdentity()),
  });
  const savedX = await context.PocketNodePopoutEditor.applyAndSave(openingX);
  assert.equal(savedX.ok, true);
  assert.equal(savedX.exported, true);
  assert.equal(state.nodes.find((node) => node.id === nodeX.id).details, "X after");

  const missingOpening = editorPayload(context, state.nodes.find((node) => node.id === nodeX.id), { body: "Unsaved deletion edit" });
  state.nodes = state.nodes.filter((node) => node.id !== nodeX.id);
  let missingExportCalls = 0;
  context.exportTree = async () => { missingExportCalls += 1; return { ok: true }; };
  const missingBefore = snapshotSaveBoundary(context, nodeX.id);
  const missing = await context.PocketNodePopoutEditor.applyAndSave(missingOpening);
  assert.equal(missing.reason, "missing-node");
  assertSaveBoundaryUnchanged(context, nodeX.id, missingBefore);
  assert.equal(missingExportCalls, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("unchanged PE apply records no operation", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("unchanged", { details: "Same" });
  const state = resetState(context, [node]);
  let exportCalls = 0;
  context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
  const payload = editorPayload(context, node);
  payload.sourceFileName = "diagnostic-name-does-not-own-identity.json";
  const result = await context.PocketNodePopoutEditor.applyAndSave(payload);
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.equal(result.changed, false);
  assert.equal(result.exported, false);
  assert.equal(result.reason, "unchanged");
  assert.equal(result.nodeUpdatedAt, node.updatedAt);
  assert.equal(state.ops.length, 0);
  assert.equal(exportCalls, 0);
});

test("unchanged PE save sees pending lexical operations without exposing mutable state", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("lexical_state", { details: "Same" });
  const state = resetState(context, [node], [{ type: "synthetic_unsaved" }]);
  let exportCalls = 0;
  context.exportTree = async () => {
    exportCalls += 1;
    return {
      ok: true,
      reason: "truth-file",
      sourceIdentity: plain(context.capturePocketEditorSourceIdentity()),
    };
  };
  assert.equal(vm.runInContext("typeof state", context), "object");
  assert.equal(typeof context.state, "undefined");
  assert.equal(context.getPocketUnsavedOperationCount(), 1);
  assert.equal(context.PocketNodePopoutTarget.get(), null);

  const result = await context.PocketNodePopoutEditor.applyAndSave(editorPayload(context, node));
  assert.equal(result.reason, "exported");
  assert.equal(result.changed, false);
  assert.equal(result.exported, true);
  assert.equal(exportCalls, 1);
  assert.equal(state.ops.length, 1);
});

test("P013 opening payload keeps Notes and Outline independent and chooses only the initial tab", () => {
  const context = createFullContractContext();
  resetState(context, []);

  const notesOnly = context.PocketNodePopoutModel.buildPayload(syntheticNode("p013_notes_open", {
    details: "Notes only\n  with indentation",
  }));
  assert.equal(notesOnly.mode, "text");
  assert.equal(notesOnly.body, "Notes only\n  with indentation");
  assert.equal(notesOnly.outline, null);

  const outlineOnly = context.PocketNodePopoutModel.buildPayload(syntheticNode("p013_outline_open", {
    editor: outlineMeta([{ id: "outline_only", text: "Outline only", depth: 0, collapsed: true }]),
  }));
  assert.equal(outlineOnly.mode, "outline");
  assert.equal(outlineOnly.body, "");
  assert.equal(outlineOnly.outline[0].text, "Outline only");

  const oldProjection = "Parent\n  Child";
  const both = context.PocketNodePopoutModel.buildPayload(syntheticNode("p013_both_open", {
    details: oldProjection,
    editor: outlineMeta([{ id: "different_outline", text: "Different Outline", depth: 0, collapsed: true }]),
  }));
  assert.equal(both.mode, "outline");
  assert.equal(both.body, oldProjection);
  assert.equal(both.outline[0].text, "Different Outline");
  assert.equal(both.outline[0].collapsed, true);
});

test("P013 main apply compares title, Notes, and Outline independently across edits and clears", () => {
  const baseOutline = [
    { id: "p013_parent", text: "Parent", depth: 0, collapsed: true, order: 90, rowExtension: "preserve" },
    { id: "p013_child", text: "Child", depth: 1, collapsed: false, order: 80 },
  ];

  function applyCase(id, overrides) {
    const context = createFullContractContext();
    const rawEditor = {
      ...outlineMeta(baseOutline),
      extension: { preserve: "raw" },
    };
    const rawNode = syntheticNode(id, {
      details: "Original Notes\n  second line",
      editor: rawEditor,
    });
    const state = resetState(context, [rawNode]);
    const beforeUpdatedAt = state.nodes[0].updatedAt;
    const payload = editorPayload(context, state.nodes[0], overrides);
    const result = context.PocketNodePopoutEditor.apply(payload, { returnDetails: true });
    return { state, node: state.nodes[0], result, rawNode, rawEditor, beforeUpdatedAt };
  }

  const notesOnly = applyCase("p013_notes", { body: "Changed Notes" });
  assert.equal(notesOnly.result.ok, true);
  assert.equal(notesOnly.node.details, "Changed Notes");
  assert.deepEqual(plain(notesOnly.node.editor), plain(notesOnly.rawEditor));
  assert.equal(notesOnly.state.ops.length, 1);
  assert.equal(notesOnly.state.ops[0].changed, "notes");

  const changedRows = baseOutline.map((block, index) => index === 1
    ? { ...block, text: "Changed child" }
    : block);
  const outlineOnly = applyCase("p013_outline", {
    schema: EDITOR_SCHEMA,
    outline: changedRows,
  });
  assert.equal(outlineOnly.node.details, "Original Notes\n  second line");
  assert.equal(outlineOnly.node.editor.outline[1].text, "Changed child");
  assert.equal(Object.hasOwn(outlineOnly.node.editor, "extension"), false);
  assert.equal(outlineOnly.state.ops[0].changed, "outline");

  const titleOnly = applyCase("p013_title", { title: "Changed title" });
  assert.equal(titleOnly.node.label, "Changed title");
  assert.equal(titleOnly.node.details, titleOnly.rawNode.details);
  assert.deepEqual(plain(titleOnly.node.editor), plain(titleOnly.rawEditor));
  assert.equal(titleOnly.state.ops[0].changed, "title");

  const combined = applyCase("p013_combined", {
    title: "Combined title",
    body: "Combined Notes",
    schema: EDITOR_SCHEMA,
    outline: changedRows,
  });
  assert.equal(combined.node.label, "Combined title");
  assert.equal(combined.node.details, "Combined Notes");
  assert.equal(combined.node.editor.outline[1].text, "Changed child");
  assert.equal(combined.state.ops.length, 1);
  assert.equal(combined.state.ops[0].changed, "title-and-notes-and-outline");
  assert.notEqual(combined.node.updatedAt, combined.beforeUpdatedAt);

  const clearNotes = applyCase("p013_clear_notes", { body: " \n\t" });
  assert.equal(Object.hasOwn(clearNotes.node, "details"), false);
  assert.deepEqual(plain(clearNotes.node.editor), plain(clearNotes.rawEditor));

  const clearOutline = applyCase("p013_clear_outline", {
    schema: EDITOR_SCHEMA,
    outline: [{ id: "fresh_placeholder", text: "", depth: 0, collapsed: false }],
  });
  assert.equal(clearOutline.node.details, clearOutline.rawNode.details);
  assert.equal(Object.hasOwn(clearOutline.node, "editor"), false);

  const clearBoth = applyCase("p013_clear_both", {
    body: " \n\t",
    schema: EDITOR_SCHEMA,
    outline: [],
  });
  assert.equal(Object.hasOwn(clearBoth.node, "details"), false);
  assert.equal(Object.hasOwn(clearBoth.node, "editor"), false);
  assert.equal(clearBoth.node.label, clearBoth.rawNode.label);
  assert.equal(clearBoth.state.ops.length, 1);
});

test("structural-only blank Outlines are meaningful, preserve raw data, and clear only at an explicit safe edit boundary", () => {
  for (const [label, structuralBlock] of [
    ["depth", { id: "blank_depth", text: "", depth: 1, collapsed: false, rawRowExtension: "depth" }],
    ["collapse", { id: "blank_collapse", text: "", depth: 0, collapsed: true, rawRowExtension: "collapse" }],
  ]) {
    const rawEditor = {
      ...outlineMeta([structuralBlock]),
      rawExtension: { preserve: label },
    };

    for (const overrides of [{ body: `Changed ${label} Notes` }, { title: `Changed ${label} title` }]) {
      const context = createFullContractContext();
      const rawNode = syntheticNode(`p013_structural_${label}`, { details: "Original Notes", editor: rawEditor });
      const state = resetState(context, [rawNode]);
      const payload = editorPayload(context, state.nodes[0], overrides);
      assert.equal(context.PocketNodePopoutModel.classifyNodeEditor(state.nodes[0]).kind, "supported-v1-outline");
      const result = context.PocketNodePopoutEditor.apply(payload, { returnDetails: true });
      assert.equal(result.ok, true, label);
      assert.deepEqual(plain(state.nodes[0].editor), plain(rawEditor), label);
    }

    const clearContext = createFullContractContext();
    const clearNode = syntheticNode(`p013_structural_clear_${label}`, { details: "Keep Notes", editor: rawEditor });
    const clearState = resetState(clearContext, [clearNode]);
    const cleared = clearContext.PocketNodePopoutEditor.apply(editorPayload(clearContext, clearState.nodes[0], {
      schema: EDITOR_SCHEMA,
      outline: [{ id: "blank_placeholder", text: "", depth: 0, collapsed: false }],
    }), { returnDetails: true });
    assert.equal(cleared.ok, true, label);
    assert.equal(Object.hasOwn(clearState.nodes[0], "editor"), false, label);
    assert.equal(clearState.nodes[0].details, "Keep Notes", label);
  }

  const unsafeContext = createFullContractContext();
  const unsafeNode = syntheticNode("p013_unsafe_clear", {
    details: "Keep unsafe Notes",
    editor: outlineMeta(Array.from({ length: 401 }, (_, index) => ({
      id: `unsafe_clear_${index}`,
      text: index === 0 ? "Root" : "",
      depth: index === 0 ? 0 : 1,
      collapsed: false,
    }))),
  });
  const unsafeState = resetState(unsafeContext, [unsafeNode]);
  const before = snapshotSaveBoundary(unsafeContext, unsafeNode.id);
  const rejected = unsafeContext.PocketNodePopoutEditor.apply(editorPayload(unsafeContext, unsafeState.nodes[0], {
    schema: EDITOR_SCHEMA,
    outline: [],
  }), { returnDetails: true });
  assert.equal(rejected.reason, "outline-too-many-blocks");
  assertSaveBoundaryUnchanged(unsafeContext, unsafeNode.id, before);
});

test("opening an absent Outline placeholder and saving without edits remains a no-operation", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("p013_absent_placeholder", { details: "Notes stay independent" });
  const state = resetState(context, [node]);
  let exportCalls = 0;
  context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
  const payload = editorPayload(context, state.nodes[0], {
    mode: "outline",
    schema: EDITOR_SCHEMA,
    outline: [{ id: "runtime_placeholder", text: "", depth: 0, collapsed: false }],
  });
  const result = await context.PocketNodePopoutEditor.applyAndSave(payload);
  assert.equal(result.reason, "unchanged");
  assert.equal(state.ops.length, 0);
  assert.equal(exportCalls, 0);
  assert.equal(state.nodes[0].details, "Notes stay independent");
  assert.equal(Object.hasOwn(state.nodes[0], "editor"), false);
});

test("applyAndSave requests the controlled export surface after a changed apply", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("save_success", { details: "Before" });
  const state = resetState(context, [node]);
  let exportCalls = 0;
  let receivedOptions = null;
  context.exportTree = async (options) => {
    exportCalls += 1;
    receivedOptions = plain(options);
    return {
      ok: true,
      reason: "truth-file",
      sourceIdentity: plain(context.capturePocketEditorSourceIdentity()),
    };
  };
  const result = await context.PocketNodePopoutEditor.applyAndSave(editorPayload(context, node, {
    body: "After",
    mode: "text",
    outline: null,
  }), { exportOptions: { synthetic: true, returnDetails: false } });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.changed, true);
  assert.equal(result.exported, true);
  assert.equal(result.reason, "exported");
  assert.equal(result.exportReason, "truth-file");
  assert.equal(result.nodeUpdatedAt, state.nodes[0].updatedAt);
  assert.deepEqual(plain(result.sourceIdentity), plain(context.capturePocketEditorSourceIdentity()));
  assert.equal(state.nodes[0].details, "After");
  assert.equal(state.ops.length, 1);
  assert.equal(exportCalls, 1);
  assert.deepEqual(receivedOptions, { synthetic: true, returnDetails: true });
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("P043a PE Save under synced ownership reaches exportTree and the P042 save seam", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("synced_pe", { details: "Before" });
  const state = resetState(context, [node]);
  let frozenPayload = null;
  const controller = installTestSyncedOwner(context, {
    onFrozen(payload) { frozenPayload = plain(payload); },
  });
  let exportCalls = 0;
  const actualExportTree = context.exportTree;
  context.exportTree = async (options) => {
    exportCalls += 1;
    return actualExportTree(options);
  };
  let fileWrites = 0;
  context.writeTruthFile = async () => { fileWrites += 1; return { ok: false, reason: "must-not-write-file" }; };

  const opening = editorPayload(context, node, { body: "Synced PE change" });
  assert.equal(opening.sourceOwnerKind, "synced");
  const result = await context.PocketNodePopoutEditor.applyAndSave(opening);

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.exported, true);
  assert.equal(result.exportReason, "synced-save");
  assert.equal(exportCalls, 1);
  assert.equal(controller.saves, 1);
  assert.equal(fileWrites, 0);
  assert.equal(state.nodes[0].details, "Synced PE change");
  assert.equal(state.ops.length, 0);
  assert.equal(frozenPayload.mainThoughtTree[0].details, "Synced PE change");
});

test("P043a synced PE non-success remains applied but unconfirmed without owner fallback", async () => {
  for (const reason of [
    "revision-conflict",
    "remote-outcome-unknown",
    "stale-owner-session",
    "remote-success-local-confirmation-failed",
  ]) {
    const context = createFullContractContext();
    const node = syntheticNode(`synced_pe_${reason}`, { details: "Before" });
    const state = resetState(context, [node]);
    const controller = installTestSyncedOwner(context, { result: { ok: false, reason } });
    let fileWrites = 0;
    context.writeTruthFile = async () => { fileWrites += 1; return { ok: true, target: "opened-file" }; };

    const result = await context.PocketNodePopoutEditor.applyAndSave(editorPayload(context, node, {
      body: `Unconfirmed ${reason}`,
    }));

    assert.equal(result.ok, false, reason);
    assert.equal(result.applied, true, reason);
    assert.equal(result.exported, false, reason);
    assert.equal(result.reason, reason, reason);
    assert.equal(controller.saves, 1, reason);
    assert.equal(fileWrites, 0, reason);
    assert.equal(state.nodes[0].details, `Unconfirmed ${reason}`, reason);
    assert.equal(state.ops.length, 1, reason);
  }
});

test("P043a rejects stale synced PE identities before applying or saving", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("synced_pe_stale", { details: "Before" });
  const state = resetState(context, [node]);
  const first = installTestSyncedOwner(context);
  const opening = editorPayload(context, node, { body: "Must not apply" });
  const second = installTestSyncedOwner(context);

  const result = await context.PocketNodePopoutEditor.applyAndSave(opening);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "file-session-changed");
  assert.equal(state.nodes[0].details, "Before");
  assert.equal(state.ops.length, 0);
  assert.equal(first.saves, 0);
  assert.equal(second.saves, 0);
});

test("P043a synced Save retains edits made after its frozen payload", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("synced_newer_edit", { details: "Before" });
  const state = resetState(context, [node]);
  context.recordOp({ type: "details_edit", id: node.id, path: "Synthetic", changed: "notes" });
  const frozen = deferred();
  const gate = deferred();
  installTestSyncedOwner(context, {
    onFrozen() { frozen.resolve(); },
    gate,
  });

  const saving = context.exportTree({ returnDetails: true, downloadFallback: false });
  await frozen.promise;
  state.nodes[0].details = "Newer local edit";
  state.nodes[0].updatedAt = "2026-01-01T00:00:01.000Z";
  context.recordOp({ type: "details_edit", id: node.id, path: "Synthetic", changed: "notes" });
  gate.resolve();
  const result = await saving;

  assert.equal(result.ok, true);
  assert.equal(result.reason, "synced-save");
  assert.equal(state.nodes[0].details, "Newer local edit");
  assert.equal(state.ops.length, 1);
});

test("native v1 Outline save keeps canonical IDs, depths, collapse state, and independently edited Notes", async () => {
  const context = createFullContractContext();
  const rawNode = fixture("current-outline-v1.json").mainThoughtTree[0];
  const state = resetState(context, [rawNode]);
  const payload = editorPayload(context, rawNode);
  payload.body = "Updated independent Notes";
  payload.outline[1].text = "Updated child";
  context.exportTree = async () => ({
    ok: true,
    reason: "truth-file",
    sourceIdentity: plain(context.capturePocketEditorSourceIdentity()),
  });
  const result = await context.PocketNodePopoutEditor.applyAndSave(payload);
  assert.equal(result.ok, true);
  assert.equal(result.exported, true);
  assert.equal(state.nodes[0].details, "Updated independent Notes");
  assert.equal(state.nodes[0].editor.schema, EDITOR_SCHEMA);
  assert.deepEqual(plain(state.nodes[0].editor.outline.map((block) => block.id)), ["fixture_block_parent", "fixture_block_child"]);
  assert.deepEqual(plain(state.nodes[0].editor.outline.map((block) => block.depth)), [0, 1]);
  assert.deepEqual(plain(state.nodes[0].editor.outline.map((block) => block.collapsed)), [true, false]);
  assert.equal(state.nodes[0].editor.outline[1].text, "Updated child");
});

test("applyAndSave propagates precise export failure reasons while retaining the applied revision", async () => {
  const cases = [
    { response: { ok: false, reason: "cancelled" }, reason: "cancelled" },
    { response: { ok: false, reason: "stale-guard" }, reason: "stale-guard" },
    { response: { ok: false, reason: "file-session-changed" }, reason: "file-session-changed" },
    { response: { ok: false, reason: "no-pocket-file" }, reason: "no-pocket-file" },
    { response: { ok: false, reason: "write-failed" }, reason: "write-failed" },
    { response: { ok: false, reason: "unsupported" }, reason: "export-unavailable" },
    { response: { downloaded: true }, reason: "downloaded-copy", downloaded: true },
  ];
  for (const [index, item] of cases.entries()) {
    const context = createFullContractContext();
    const node = syntheticNode(`save_result_${index}`, { details: "Before" });
    const state = resetState(context, [node]);
    context.exportTree = async () => item.response;
    const opening = editorPayload(context, node, { body: "After" });
    const result = await context.PocketNodePopoutEditor.applyAndSave(opening);
    assert.equal(result.ok, false);
    assert.equal(result.applied, true);
    assert.equal(result.exported, false);
    assert.equal(result.reason, item.reason);
    assert.equal(result.nodeUpdatedAt, state.nodes[0].updatedAt);
    assert.notEqual(result.nodeUpdatedAt, opening.originalUpdatedAt);
    assert.equal(result.downloaded === true, item.downloaded === true);
    assert.equal(state.nodes[0].details, "After");
    assert.equal(state.ops.length, 1);
    assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  }

  const thrownContext = createFullContractContext();
  const thrownNode = syntheticNode("save_thrown", { details: "Before" });
  const thrownState = resetState(thrownContext, [thrownNode]);
  thrownContext.exportTree = async () => { throw new Error("synthetic export failure"); };
  const thrown = await thrownContext.PocketNodePopoutEditor.applyAndSave(editorPayload(thrownContext, thrownNode, { body: "After" }));
  assert.equal(thrown.reason, "write-failed");
  assert.equal(thrown.nodeUpdatedAt, thrownState.nodes[0].updatedAt);
  assert.equal(thrownState.ops.length, 1);

  const unavailableContext = createFullContractContext();
  const unavailableNode = syntheticNode("save_unavailable", { details: "Before" });
  const unavailableState = resetState(unavailableContext, [unavailableNode]);
  unavailableContext.exportTree = undefined;
  const unavailable = await unavailableContext.PocketNodePopoutEditor.applyAndSave(editorPayload(unavailableContext, unavailableNode, { body: "After" }));
  assert.equal(unavailable.reason, "export-unavailable");
  assert.equal(unavailable.nodeUpdatedAt, unavailableState.nodes[0].updatedAt);
  assert.equal(unavailableState.ops.length, 1);
});

test("cancelled, stale-guard, and thrown exports adopt the applied revision and retry pending lexical operations", async () => {
  const scenarios = [
    ["cancelled", { ok: false, reason: "cancelled" }, false, "cancelled"],
    ["stale guard", { ok: false, reason: "stale-guard" }, false, "stale-guard"],
    ["thrown write", null, true, "write-failed"],
  ];
  for (const [label, firstResponse, shouldThrow, expectedReason] of scenarios) {
    const context = createFullContractContext();
    const node = syntheticNode(`retry_${expectedReason}`, { details: "Before" });
    const state = resetState(context, [node]);
    const identity = plain(context.capturePocketEditorSourceIdentity());
    let exportCalls = 0;
    context.exportTree = async () => {
      exportCalls += 1;
      if (exportCalls === 1) {
        if (shouldThrow) throw new Error("synthetic write failure");
        return firstResponse;
      }
      return { ok: true, reason: "truth-file", sourceIdentity: identity };
    };

    const opening = editorPayload(context, node, { body: "After" });
    const first = await context.PocketNodePopoutEditor.applyAndSave(opening);
    assert.equal(first.ok, false, label);
    assert.equal(first.applied, true, label);
    assert.equal(first.reason, expectedReason, label);
    assert.equal(state.nodes[0].details, "After", label);
    assert.equal(state.ops.length, 1, label);
    assert.notEqual(first.nodeUpdatedAt, opening.originalUpdatedAt, label);

    const retry = { ...opening, originalUpdatedAt: first.nodeUpdatedAt };
    const second = await context.PocketNodePopoutEditor.applyAndSave(retry);
    assert.equal(second.ok, true, label);
    assert.equal(second.applied, true, label);
    assert.equal(second.changed, false, label);
    assert.equal(second.exported, true, label);
    assert.equal(second.reason, "exported", label);
    assert.equal(second.nodeUpdatedAt, first.nodeUpdatedAt, label);
    assert.equal(exportCalls, 2, label);
  }
});

test("first and second changed saves succeed when the caller adopts the returned node revision", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("two_saves", { details: "Before" });
  const state = resetState(context, [node]);
  context.exportTree = async () => ({
    ok: true,
    reason: "truth-file",
    sourceIdentity: plain(context.capturePocketEditorSourceIdentity()),
  });
  const opening = editorPayload(context, node, { body: "First" });
  const first = await context.PocketNodePopoutEditor.applyAndSave(opening);
  assert.equal(first.ok, true);
  const secondPayload = {
    ...opening,
    body: "Second",
    originalUpdatedAt: first.nodeUpdatedAt,
  };
  const second = await context.PocketNodePopoutEditor.applyAndSave(secondPayload);
  assert.equal(second.ok, true);
  assert.notEqual(second.nodeUpdatedAt, first.nodeUpdatedAt);
  assert.equal(state.nodes[0].details, "Second");
  assert.equal(state.ops.length, 2);
});

test("queued truth write reports file-session-changed and never writes the newly active file", async () => {
  const context = createFullContractContext();
  const state = resetState(context, [syntheticNode("queued_x", { details: "File A" })], [{ type: "queued_change" }]);
  let releaseWrite;
  let signalWriteStarted;
  const writeStarted = new Promise((resolve) => { signalWriteStarted = resolve; });
  const holdWrite = new Promise((resolve) => { releaseWrite = resolve; });
  let writesA = 0;
  let writesB = 0;
  const handleA = {
    name: "A.json",
    async queryPermission() { return "granted"; },
    async createWritable() {
      return {
        async write() {
          writesA += 1;
          signalWriteStarted();
          await holdWrite;
        },
        async close() {},
      };
    },
  };
  const handleB = {
    name: "B.json",
    async queryPermission() { return "granted"; },
    async createWritable() {
      return {
        async write() { writesB += 1; },
        async close() {},
      };
    },
  };
  context.setPocketFileSession(handleA, "A.json", { forceNewSession: true });
  const savePromise = context.exportTree({ returnDetails: true, downloadFallback: false });
  await writeStarted;
  state.nodes = [syntheticNode("queued_x", { details: "File B" })];
  state.ops = [];
  context.setPocketFileSession(handleB, "B.json", { forceNewSession: true });
  releaseWrite();
  const result = await savePromise;

  assert.equal(result.ok, false);
  assert.equal(result.reason, "file-session-changed");
  assert.equal(writesA, 1);
  assert.equal(writesB, 0);
  assert.equal(state.nodes[0].details, "File B");
  assert.equal(state.ops.length, 0);
});

test("P061 fresh new-Pocket truth contains exactly four ordinary starter nodes", () => {
  const context = createFullContractContext();
  const writtenAt = "2026-08-14T03:04:05.000Z";
  const payload = context.buildEmptyPocketPayload(writtenAt);
  const nodes = plain(payload.mainThoughtTree);
  const byLabel = new Map(nodes.map((node) => [node.label, node]));
  const mind = byLabel.get("Things on my mind");

  assert.equal(payload.schema, "portal.export.v1");
  assert.equal(payload.exportedAt, writtenAt);
  assert.equal(payload.writtenAt, writtenAt);
  assert.deepEqual(plain(payload.data.mainThoughtTree), nodes);
  assert.deepEqual(plain(payload.mainThoughtTreeTombstones), []);
  assert.deepEqual(plain(payload.data.mainThoughtTreeTombstones), []);
  assert.deepEqual(nodes.map((node) => node.label), [
    "Things on my mind",
    "Something I want to think about",
    "Something I don’t want to forget",
    "Things I might do",
  ]);
  assert.equal(new Set(nodes.map((node) => node.id)).size, 4);
  assert.equal(nodes.every((node) => /^node_[a-z0-9]+_[a-z0-9]+$/.test(node.id)), true);
  assert.deepEqual(nodes.map((node) => node.parentId), ["root", mind.id, mind.id, "root"]);
  assert.deepEqual(nodes.map((node) => node.order), [1001, 1001, 1002, 1002]);
  for (const node of nodes) {
    assert.deepEqual(Object.keys(node).sort(), ["id", "label", "order", "parentId", "source", "updatedAt"]);
    assert.equal(node.source, "manual");
    assert.equal(node.updatedAt, writtenAt);
  }
  const normalised = context.normaliseInput(payload);
  assert.equal(normalised.schema, "portal.export.v1");
  assert.deepEqual(plain(normalised.nodes), nodes);
});

test("P061 retained recovery truth always outranks first-use seeding, including an empty tree", () => {
  const context = createFullContractContext();
  const recoveredNode = syntheticNode("p061_recovered", { label: "Retained recovery" });
  const recovered = {
    schema: "portal.export.v1",
    exportedAt: "2026-08-13T00:00:00.000Z",
    writtenAt: "2026-08-13T00:00:00.000Z",
    mainThoughtTree: [recoveredNode],
    mainThoughtTreeTombstones: [],
    data: { mainThoughtTree: [recoveredNode], mainThoughtTreeTombstones: [] },
  };
  context.readLocalSafetySnapshot = () => ({ parsed: { payload: recovered } });
  assert.deepEqual(plain(context.payloadForNewPocketFile()), recovered);

  const emptyRecovered = {
    ...recovered,
    mainThoughtTree: [],
    data: { mainThoughtTree: [], mainThoughtTreeTombstones: [] },
  };
  context.readLocalSafetySnapshot = () => ({ parsed: { payload: emptyRecovered } });
  assert.deepEqual(plain(context.payloadForNewPocketFile()), emptyRecovered);
});

test("P061 existing empty Pocket truth stays empty and keeps the normal owned-empty UI", () => {
  const context = createFullContractContext();
  const existingEmpty = {
    schema: "portal.export.v1",
    exportedAt: "2026-08-13T00:00:00.000Z",
    writtenAt: "2026-08-13T00:00:00.000Z",
    mainThoughtTree: [],
    mainThoughtTreeTombstones: [],
    data: { mainThoughtTree: [], mainThoughtTreeTombstones: [] },
  };
  const normalised = context.normaliseInput(existingEmpty);
  context.applyLoadedState(normalised, {
    schema: normalised.schema,
    fileName: "deliberately-empty.json",
    writtenAt: normalised.writtenAt,
  }, { skipLocalSafetyCheck: true });
  const saved = context.buildPocketPayload("2026-08-14T00:00:00.000Z");
  const reopened = context.normaliseInput(plain(saved));
  assert.deepEqual(plain(saved.mainThoughtTree), []);
  assert.deepEqual(plain(saved.data.mainThoughtTree), []);
  assert.deepEqual(plain(reopened.nodes), []);

  const deletedContext = createFullContractContext();
  const starter = deletedContext.buildEmptyPocketPayload("2026-08-13T01:00:00.000Z");
  const starterNormalised = deletedContext.normaliseInput(starter);
  deletedContext.applyLoadedState(starterNormalised, {
    schema: starterNormalised.schema,
    fileName: "starter-deleted.json",
    writtenAt: starterNormalised.writtenAt,
  }, { skipLocalSafetyCheck: true });
  lexicalState(deletedContext).nodes = [];
  const afterDeletion = deletedContext.buildPocketPayload("2026-08-14T01:00:00.000Z");
  assert.deepEqual(plain(deletedContext.normaliseInput(afterDeletion).nodes), []);

  const rendered = createTreeRenderHarness([]);
  const card = rendered.treeRoot.children[0].children[0];
  assert.equal(card.children[0].textContent, "Nothing here yet.");
  assert.equal(card.children[1].textContent, "Add the first item when you're ready.");
});

test("P061 creation keeps the old owner intact on cancel, write failure, or adoption failure and adopts clean starter truth on success", async () => {
  const activeNode = syntheticNode("p061_active", { label: "Existing active truth" });

  const cancelled = createFullContractContext();
  const cancelledState = resetState(cancelled, [activeNode], [{ type: "existing-edit", seq: 1 }]);
  const cancelledBefore = {
    nodes: plain(cancelledState.nodes),
    ops: plain(cancelledState.ops),
    session: cancelled.capturePocketFileSaveSession(),
  };
  cancelled.showSaveFilePicker = async () => {
    const error = new Error("cancelled");
    error.name = "AbortError";
    throw error;
  };
  assert.equal(await cancelled.createNewPocketFile(), false);
  assert.deepEqual(plain(cancelledState.nodes), cancelledBefore.nodes);
  assert.deepEqual(plain(cancelledState.ops), cancelledBefore.ops);
  assert.strictEqual(cancelled.capturePocketFileSaveSession().handle, cancelledBefore.session.handle);
  assert.equal(cancelled.capturePocketFileSaveSession().id, cancelledBefore.session.id);

  const failed = createFullContractContext();
  const failedState = resetState(failed, [activeNode], [{ type: "existing-edit", seq: 1 }]);
  const failedBefore = {
    nodes: plain(failedState.nodes),
    ops: plain(failedState.ops),
    session: failed.capturePocketFileSaveSession(),
  };
  const failedHandle = {
    name: "failed-new.json",
    async isSameEntry(other) { return other === this; },
    async createWritable() {
      return {
        async write() { throw new Error("synthetic write failure"); },
        async abort() {},
      };
    },
  };
  failed.showSaveFilePicker = async () => failedHandle;
  assert.equal(await failed.createNewPocketFile(), false);
  assert.deepEqual(plain(failedState.nodes), failedBefore.nodes);
  assert.deepEqual(plain(failedState.ops), failedBefore.ops);
  assert.strictEqual(failed.capturePocketFileSaveSession().handle, failedBefore.session.handle);
  assert.equal(failed.capturePocketFileSaveSession().id, failedBefore.session.id);

  const adoptionFailed = createFullContractContext();
  const adoptionFailedState = resetState(adoptionFailed, [activeNode], [{ type: "existing-edit", seq: 1 }]);
  const adoptionFailedBefore = {
    nodes: plain(adoptionFailedState.nodes),
    ops: plain(adoptionFailedState.ops),
    session: adoptionFailed.capturePocketFileSaveSession(),
  };
  const adoptionFailedHandle = {
    name: "adoption-failed-new.json",
    async isSameEntry(other) { return other === this; },
    async createWritable() {
      return {
        async write() {},
        async close() {},
      };
    },
  };
  adoptionFailed.showSaveFilePicker = async () => adoptionFailedHandle;
  adoptionFailed.finishLoadedStateAdoption = () => false;
  assert.equal(await adoptionFailed.createNewPocketFile(), false);
  assert.deepEqual(plain(adoptionFailedState.nodes), adoptionFailedBefore.nodes);
  assert.deepEqual(plain(adoptionFailedState.ops), adoptionFailedBefore.ops);
  assert.strictEqual(adoptionFailed.capturePocketFileSaveSession().handle, adoptionFailedBefore.session.handle);
  assert.equal(adoptionFailed.capturePocketFileSaveSession().id, adoptionFailedBefore.session.id);

  const successful = createFullContractContext();
  const successfulState = resetState(successful, [activeNode]);
  let writtenPayload = null;
  let writeCount = 0;
  const successfulHandle = {
    name: "first-use.json",
    async isSameEntry(other) { return other === this; },
    async createWritable() {
      return {
        async write(value) {
          writeCount += 1;
          writtenPayload = JSON.parse(String(value));
        },
        async close() {},
      };
    },
  };
  successful.showSaveFilePicker = async () => successfulHandle;
  assert.equal(await successful.createNewPocketFile(), true);
  assert.equal(writeCount, 1);
  assert.equal(writtenPayload.mainThoughtTree.length, 4);
  assert.deepEqual(plain(successfulState.nodes), plain(writtenPayload.mainThoughtTree));
  assert.deepEqual(plain(successfulState.ops), []);
  assert.equal(successfulState.documentBaseline.payload.nodes.length, 4);
  assert.strictEqual(successful.capturePocketFileSaveSession().handle, successfulHandle);
});

test("successful picked and newly created truth-file targets establish new editor source identities", async () => {
  const context = createFullContractContext();
  const state = resetState(context, [syntheticNode("save_as", { details: "Save as" })], [{ type: "save_as_change" }]);
  const beforeIdentity = plain(context.capturePocketEditorSourceIdentity());
  let pickerCalls = 0;
  let writes = 0;
  const pickedHandle = {
    name: "picked.json",
    async isSameEntry(other) { return other === this; },
    async queryPermission() { return "granted"; },
    async createWritable() {
      return {
        async write(value) {
          writes += 1;
          assert.match(String(value), /"save_as"/);
        },
        async close() {},
      };
    },
  };
  context.showSaveFilePicker = async () => {
    pickerCalls += 1;
    return pickedHandle;
  };

  const result = await context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(result.ok, true);
  assert.equal(result.target, "picked-file");
  assert.equal(pickerCalls, 1);
  assert.equal(writes, 1);
  assert.ok(result.sourceIdentity.fileSessionId > beforeIdentity.fileSessionId);
  assert.equal(result.sourceIdentity.sourceFileName, "picked.json");
  assert.equal(result.sourceIdentity.sourcePipSession, false);
  assert.equal(context.isPocketEditorSourceIdentityCurrent(result.sourceIdentity), true);
  assert.equal(state.ops.length, 0);

  let createdWrites = 0;
  const createdHandle = {
    name: "created.json",
    async isSameEntry(other) { return other === this; },
    async queryPermission() { return "granted"; },
    async createWritable() {
      return {
        async write(value) {
          createdWrites += 1;
          assert.equal(String(value).includes('"portal.export.v1"'), true);
        },
        async close() {},
      };
    },
  };
  context.showSaveFilePicker = async () => {
    pickerCalls += 1;
    return createdHandle;
  };
  assert.equal(await context.createNewPocketFile(), true);
  const createdIdentity = plain(context.capturePocketEditorSourceIdentity());
  assert.ok(createdIdentity.fileSessionId > result.sourceIdentity.fileSessionId);
  assert.equal(createdIdentity.sourceFileName, "created.json");
  assert.equal(createdWrites, 1);
  assert.equal(pickerCalls, 2);
});

test("generated PE runtime builds and compiles for independent Notes, Outline, both, structural-only, absent, and rejected payloads", () => {
  const factory = loadRuntimeFactory();
  const modelContext = createFullContractContext();
  const rejected = modelContext.PocketNodePopoutModel.buildPayload(syntheticNode("rejected", {
    details: "",
    editor: { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [] },
  }));
  const payloads = [
    { id: "runtime_notes", title: "Notes", body: "Notes body", mode: "text", outline: null },
    {
      id: "runtime_outline_only",
      title: "Outline only",
      body: "",
      mode: "outline",
      outline: [
        { id: "stable_parent", text: "Parent", depth: 0, collapsed: true },
        { id: "stable_child", text: "Child", depth: 1, collapsed: false },
      ],
    },
    {
      id: "runtime_both",
      title: "Both",
      body: "Independent Notes",
      mode: "outline",
      outline: [{ id: "both_outline", text: "Independent Outline", depth: 0, collapsed: false }],
    },
    {
      id: "runtime_blank_depth",
      title: "Structural depth",
      body: "Notes",
      mode: "outline",
      outline: [{ id: "blank_depth", text: "", depth: 1, collapsed: false }],
    },
    {
      id: "runtime_blank_collapse",
      title: "Structural collapse",
      body: "Notes",
      mode: "outline",
      outline: [{ id: "blank_collapse", text: "", depth: 0, collapsed: true }],
    },
    {
      id: "runtime_absent",
      title: "Absent Outline",
      body: "Notes only",
      mode: "text",
      outline: null,
    },
    rejected,
  ];
  for (const payload of payloads) {
    const program = factory.build(JSON.stringify(payload));
    assert.equal(typeof program, "string");
    assert.doesNotThrow(() => new Function(program));
  }
});

test("generated editable Outline runtime emits the exact v1 schema and both independent sections on save", () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    id: "runtime_schema_save",
    title: "Schema save",
    body: "Parent\n  Child",
    mode: "outline",
    outline: [
      { id: "runtime_parent", text: "Parent", depth: 0, collapsed: true, order: 90 },
      { id: "runtime_child", text: "Child", depth: 1, collapsed: false, order: 80 },
    ],
  }));
  runtime.controls.get("saveBtn").dispatch("click");
  assert.equal(runtime.applyCalls.length, 0);
  assert.equal(runtime.saveCalls.length, 1);
  assert.equal(runtime.saveCalls[0].schema, EDITOR_SCHEMA);
  assert.equal(runtime.saveCalls[0].mode, "outline");
  assert.equal(runtime.saveCalls[0].body, "Parent\n  Child");
  assert.equal(runtime.saveCalls[0].outline.length, 2);
});

test("P056 PE Outline shortcuts collapse and expand branches once, while Text and editable contexts keep their keys", () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p056_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "p056_child", text: "Child", depth: 1, collapsed: false },
      { id: "p056_sibling", text: "Sibling", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  let event = runtime.document.dispatch("keydown", {
    key: ",", ctrlKey: true, target: pane.children[0].children[0],
  });
  assert.equal(event.defaultPrevented, true);
  assert.equal(pane.children.length, 2);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  event = runtime.document.dispatch("keydown", {
    key: ",", ctrlKey: true, target: pane.children[0].children[0],
  });
  assert.equal(event.defaultPrevented, true);
  assert.equal(pane.children.length, 2);
  event = runtime.document.dispatch("keydown", {
    key: ".", metaKey: true, target: pane.children[0].children[0],
  });
  assert.equal(event.defaultPrevented, true);
  assert.equal(pane.children.length, 3);
  runtime.controls.get("saveBtn").dispatch("click");
  assert.deepEqual(runtime.saveCalls[0].outline.map((block) => block.collapsed), [false, false, false]);

  const editable = pane.children[0].children[1];
  editable.isContentEditable = true;
  event = runtime.document.dispatch("keydown", { key: ",", ctrlKey: true, target: editable });
  assert.equal(event.defaultPrevented, false);
  assert.equal(pane.children.length, 3);

  const textRuntime = executeControlledRuntime(runtimeEditablePayload({ mode: "text", outline: null }));
  event = textRuntime.document.dispatch("keydown", {
    key: ",", ctrlKey: true, target: textRuntime.controls.get("bodyInput"),
  });
  assert.equal(event.defaultPrevented, false);
  assert.equal(textRuntime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
});

test("P057 PE Outline is selection-first while retaining editing, hierarchy, context insertion, shortcuts, and save", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p057_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "p057_child", text: "Child", depth: 1, collapsed: false },
      { id: "p057_grandchild", text: "Grandchild", depth: 2, collapsed: false },
      { id: "p057_sibling", text: "Sibling", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  const text = (id) => row(id).children[1];
  const select = (id) => row(id).children[0];

  assert.ok(rows().every((candidate) => candidate.children[1].contentEditable === "false"));
  row("p057_child").dispatch("click", { target: row("p057_child") });
  assert.equal(row("p057_child").getAttribute("aria-selected"), "true");

  let event = runtime.document.dispatch("keydown", { key: "ArrowUp", target: select("p057_child") });
  assert.equal(event.defaultPrevented, true);
  assert.equal(row("p057_parent").getAttribute("aria-selected"), "true");
  event = runtime.document.dispatch("keydown", { key: "ArrowRight", target: select("p057_parent") });
  assert.equal(event.defaultPrevented, true);
  assert.equal(row("p057_child").getAttribute("aria-selected"), "true");
  event = runtime.document.dispatch("keydown", { key: "ArrowLeft", target: select("p057_child") });
  assert.equal(event.defaultPrevented, true);
  assert.equal(row("p057_child").getAttribute("aria-selected"), "true");
  event = runtime.document.dispatch("keydown", { key: "ArrowLeft", target: select("p057_child") });
  assert.equal(event.defaultPrevented, true);
  assert.equal(row("p057_parent").getAttribute("aria-selected"), "true");
  runtime.document.dispatch("keydown", { key: "ArrowLeft", target: select("p057_parent") });
  assert.deepEqual(rows().map((candidate) => candidate.children[1].textContent), ["Parent", "Sibling"]);
  runtime.document.dispatch("keydown", { key: "ArrowRight", target: select("p057_parent") });
  assert.equal(rows().length, 3);
  runtime.document.dispatch("keydown", { key: "ArrowRight", target: select("p057_child") });
  runtime.document.dispatch("keydown", { key: "ArrowRight", target: select("p057_child") });
  assert.equal(rows().length, 4);
  row("p057_parent").dispatch("click", { target: row("p057_parent") });

  runtime.document.dispatch("keydown", { key: "Enter", target: select("p057_parent") });
  assert.equal(text("p057_parent").contentEditable, "true");
  assert.equal(text("p057_parent").dispatch("keydown", { key: "ArrowLeft" }).defaultPrevented, false);
  text("p057_parent").textContent = "Parent revised";
  text("p057_parent").dispatch("input");
  assert.equal(text("p057_parent").dispatch("keydown", { key: "Enter" }).defaultPrevented, true);
  assert.equal(text("p057_parent").contentEditable, "false");
  assert.equal(text("p057_parent").textContent, "Parent revised");
  assert.strictEqual(runtime.document.activeElement, select("p057_parent"));

  text("p057_child").dispatch("click", { target: text("p057_child") });
  assert.equal(text("p057_child").contentEditable, "true");
  text("p057_child").dispatch("keydown", { key: "Enter", ctrlKey: true });
  const insertedByEnter = rows().find((candidate) => candidate.children[1].contentEditable === "true");
  insertedByEnter.children[1].textContent = "Inserted";
  insertedByEnter.children[1].dispatch("input");
  insertedByEnter.children[1].dispatch("keydown", { key: "Enter" });

  row("p057_parent").dispatch("click", { target: row("p057_parent") });
  row("p057_child").dispatch("click", { target: row("p057_child"), shiftKey: true });
  assert.deepEqual([row("p057_parent"), row("p057_child")].map((candidate) => candidate.getAttribute("aria-selected")), ["true", "true"]);
  event = runtime.document.dispatch("keydown", { key: ",", ctrlKey: true, target: select("p057_child") });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(rows().map((candidate) => candidate.children[1].textContent), ["Parent revised", "Sibling"]);
  event = runtime.document.dispatch("keydown", { key: ".", metaKey: true, target: select("p057_parent") });
  assert.equal(event.defaultPrevented, true);
  assert.equal(rows().length, 5);

  const insertAbove = runtime.document.createElement("button");
  insertAbove.setAttribute("data-outline-action", "insert-above");
  runtime.controls.get("outlineContextMenu").appendChild(insertAbove);
  pane.dispatch("contextmenu", { target: text("p057_sibling"), clientX: 20, clientY: 20 });
  runtime.controls.get("outlineContextMenu").dispatch("click", { target: insertAbove });
  const insertedByContext = rows().find((candidate) => candidate.children[1].contentEditable === "true");
  insertedByContext.children[1].textContent = "Context";
  insertedByContext.children[1].dispatch("input");
  insertedByContext.children[1].dispatch("keydown", { key: "Escape" });
  text(insertedByContext.getAttribute("data-block-id")).dispatch("click", { target: text(insertedByContext.getAttribute("data-block-id")) });
  text(insertedByContext.getAttribute("data-block-id")).textContent = "";
  text(insertedByContext.getAttribute("data-block-id")).dispatch("input");
  text(insertedByContext.getAttribute("data-block-id")).dispatch("keydown", { key: "Backspace" });
  assert.equal(rows().some((candidate) => candidate.children[1].textContent === "Context"), false);
  const continuedEditing = rows().find((candidate) => candidate.children[1].contentEditable === "true");
  assert.equal(continuedEditing.children[1].textContent, "Inserted");
  continuedEditing.children[1].dispatch("keydown", { key: "Escape" });

  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.deepEqual(runtime.saveCalls[0].outline.map((block) => [block.text, block.depth, block.collapsed]), [
    ["Parent revised", 0, false], ["Child", 1, false], ["Grandchild", 2, false], ["Inserted", 1, false], ["Sibling", 0, false],
  ]);
});

test("P058 PE Outline separates navigation edits from branch movement and preserves active-save text", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p058_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "p058_child", text: "Child", depth: 1, collapsed: false },
      { id: "p058_next", text: "Next", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  const text = (id) => row(id).children[1];
  const select = (id) => row(id).children[0];
  const key = (keyName, extras = {}) => runtime.document.dispatch("keydown", { key: keyName, target: runtime.document.activeElement || select("p058_parent"), ...extras });

  row("p058_parent").dispatch("click", { target: row("p058_parent") });
  key("Enter", { target: select("p058_parent") });
  text("p058_parent").textContent = "Cancelled";
  text("p058_parent").dispatch("input");
  assert.equal(text("p058_parent").dispatch("keydown", { key: "Escape" }).defaultPrevented, true);
  assert.equal(text("p058_parent").textContent, "Parent");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  key("Enter", { target: select("p058_parent") });
  text("p058_parent").textContent = "Committed";
  text("p058_parent").dispatch("input");
  text("p058_parent").dispatch("keydown", { key: "Enter" });
  assert.equal(text("p058_parent").textContent, "Committed");
  assert.equal(text("p058_parent").contentEditable, "false");

  key("Enter", { target: select("p058_parent") });
  text("p058_parent").dispatch("keydown", { key: "Tab" });
  assert.equal(text("p058_child").contentEditable, "true");
  text("p058_child").dispatch("keydown", { key: "Tab", shiftKey: true });
  assert.equal(text("p058_parent").contentEditable, "true");
  assert.equal(text("p058_parent").dispatch("keydown", { key: "Enter", altKey: true }).defaultPrevented, true);
  assert.equal(text("p058_parent").textContent, "Committed\n");
  text("p058_parent").dispatch("keydown", { key: "Enter", ctrlKey: true });
  const created = rows().find((candidate) => candidate.children[1].contentEditable === "true");
  assert.equal(Number(created.style.paddingLeft.replace("px", "")), 4);
  created.children[1].textContent = "Created";
  created.children[1].dispatch("input");
  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.saveCalls[0].outline.some((block) => block.text === "Created"), true);
  created.children[1].dispatch("keydown", { key: "Enter" });
  row("p058_next").dispatch("click", { target: row("p058_next") });
  runtime.document.dispatch("keydown", { key: "+", shiftKey: true, target: select("p058_next") });
  const createdByPlus = rows().find((candidate) => candidate.children[1].contentEditable === "true");
  assert.ok(createdByPlus);
  assert.equal(runtime.document.dispatch("keydown", { key: "ArrowLeft", ctrlKey: true, target: createdByPlus.children[1] }).defaultPrevented, false);
  createdByPlus.children[1].dispatch("keydown", { key: "Enter" });
  const beforeDelete = rows().length;
  runtime.document.dispatch("keydown", { key: "Delete", target: runtime.document.activeElement });
  assert.equal(rows().length, beforeDelete - 1);

  const structural = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p058_a", text: "A", depth: 0, collapsed: false },
      { id: "p058_a_child", text: "A child", depth: 1, collapsed: true },
      { id: "p058_b", text: "B", depth: 0, collapsed: false },
      { id: "p058_b_child", text: "B child", depth: 1, collapsed: false },
    ],
  }));
  const structuralPane = structural.controls.get("outlinePane");
  const structuralRows = () => structuralPane.querySelectorAll(".outlineRow[data-block-id]");
  const structuralRow = (id) => structuralRows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  structuralRow("p058_b").dispatch("click", { target: structuralRow("p058_b") });
  structural.document.dispatch("keydown", { key: "ArrowUp", ctrlKey: true, target: structuralRow("p058_b").children[0] });
  assert.deepEqual(structuralRows().map((candidate) => candidate.children[1].textContent), ["B", "B child", "A", "A child"]);
  structural.document.dispatch("keydown", { key: "ArrowRight", ctrlKey: true, target: structuralRow("p058_b").children[0] });
  assert.deepEqual(structuralRows().map((candidate) => candidate.children[1].textContent), ["B", "B child", "A", "A child"]);
  structuralRow("p058_a").dispatch("click", { target: structuralRow("p058_a") });
  structural.document.dispatch("keydown", { key: "ArrowRight", ctrlKey: true, target: structuralRow("p058_a").children[0] });
  structural.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.deepEqual(structural.saveCalls[0].outline.map((block) => [block.id, block.depth, block.collapsed]), [
    ["p058_b", 0, false], ["p058_b_child", 1, false], ["p058_a", 1, false], ["p058_a_child", 2, true],
  ]);
});

test("P058a PE Outline outdents a whole branch structurally and persists explicit Alt/Option+Enter newlines", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p058a_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "p058a_a", text: "A", depth: 1, collapsed: false },
      { id: "p058a_a_child", text: "A child", depth: 2, collapsed: false },
      { id: "p058a_b", text: "B", depth: 1, collapsed: false },
      { id: "p058a_outer", text: "Outer", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  const text = (id) => row(id).children[1];
  const select = (id) => row(id).children[0];

  row("p058a_a").dispatch("click", { target: row("p058a_a") });
  let event = runtime.document.dispatch("keydown", { key: "ArrowLeft", ctrlKey: true, target: select("p058a_a") });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(rows().map((candidate) => candidate.children[1].textContent), ["Parent", "B", "A", "A child", "Outer"]);
  assert.equal(row("p058a_a").getAttribute("aria-selected"), "true");
  assert.strictEqual(runtime.document.activeElement, select("p058a_a"));

  const beforeInvalidOutdent = rows().map((candidate) => candidate.children[1].textContent);
  row("p058a_parent").dispatch("click", { target: row("p058a_parent") });
  event = runtime.document.dispatch("keydown", { key: "ArrowLeft", ctrlKey: true, target: select("p058a_parent") });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(rows().map((candidate) => candidate.children[1].textContent), beforeInvalidOutdent);

  text("p058a_a").dispatch("click", { target: text("p058a_a") });
  event = text("p058a_a").dispatch("keydown", { key: "Enter", altKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(text("p058a_a").contentEditable, "true");
  assert.equal(text("p058a_a").textContent, "A\n");
  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.deepEqual(runtime.saveCalls[0].outline.map((block) => [block.id, block.text, block.depth, block.collapsed]), [
    ["p058a_parent", "Parent", 0, false], ["p058a_b", "B", 1, false], ["p058a_a", "A\n", 0, false], ["p058a_a_child", "A child", 1, false], ["p058a_outer", "Outer", 0, false],
  ]);
});

test("P060 PE Outline wakes structural navigation, edits text on one click, and keeps a structural marker without selection chrome", () => {
  assert.doesNotMatch(source("js/pocket-node-popout-template.js"), /outlineSelect/);
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p060_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "p060_child", text: "Child", depth: 1, collapsed: false },
      { id: "p060_leaf", text: "Leaf", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  assert.strictEqual(runtime.document.activeElement, row("p060_parent").children[0]);
  assert.equal(row("p060_parent").getAttribute("aria-selected"), "true");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
  assert.equal(pane.querySelector(".outlineSelect"), null);
  assert.equal(row("p060_leaf").children[0].textContent, "▸");

  row("p060_leaf").children[0].dispatch("click", { target: row("p060_leaf").children[0] });
  assert.equal(row("p060_leaf").getAttribute("aria-selected"), "true");
  assert.equal(row("p060_leaf").children[1].contentEditable, "false");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  row("p060_child").children[1].dispatch("click", { target: row("p060_child").children[1] });
  assert.equal(row("p060_child").children[1].contentEditable, "true");
  row("p060_child").children[1].dispatch("keydown", { key: "Escape" });
  assert.equal(row("p060_child").children[1].contentEditable, "false");
  assert.strictEqual(runtime.document.activeElement, row("p060_child").children[0]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  runtime.controls.get("textModeBtn").dispatch("click");
  runtime.controls.get("outlineModeBtn").dispatch("click");
  assert.strictEqual(runtime.document.activeElement, row("p060_parent").children[0]);
  assert.equal(row("p060_parent").getAttribute("aria-selected"), "true");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  row("p060_parent").children[0].dispatch("click", { target: row("p060_parent").children[0] });
  assert.equal(row("p060_parent").getAttribute("aria-selected"), "true");
  assert.equal(row("p060_parent").children[1].contentEditable, "false");
  assert.deepEqual(rows().map((candidate) => candidate.children[1].textContent), ["Parent", "Leaf"]);
});

test("P060 PE gutter drag honours its threshold, moves subtrees, and rejects descendant drops", () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p060_drag_a", text: "A", depth: 0, collapsed: false },
      { id: "p060_drag_a_child", text: "A child", depth: 1, collapsed: false },
      { id: "p060_drag_b", text: "B", depth: 0, collapsed: false },
      { id: "p060_drag_b_child", text: "B child", depth: 1, collapsed: false },
      { id: "p060_drag_c", text: "C", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  const labels = () => rows().map((candidate) => candidate.children[1].textContent);

  row("p060_drag_b").children[0].dispatch("pointerdown", { clientX: 0, clientY: 0 });
  runtime.document.dispatch("pointermove", { clientX: 3, clientY: 4 });
  runtime.document.pointedElement = row("p060_drag_a").children[0];
  runtime.document.dispatch("pointerup", { clientX: 3, clientY: 2, target: runtime.document.pointedElement });
  assert.deepEqual(labels(), ["A", "A child", "B", "B child", "C"]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  row("p060_drag_b").children[0].dispatch("pointerdown", { clientX: 0, clientY: 0 });
  runtime.document.dispatch("pointermove", { clientX: 7, clientY: 0 });
  runtime.document.pointedElement = row("p060_drag_a").children[0];
  runtime.document.dispatch("pointerup", { clientX: 7, clientY: 2, target: runtime.document.pointedElement });
  assert.deepEqual(labels(), ["B", "B child", "A", "A child", "C"]);
  assert.equal(row("p060_drag_b").getAttribute("aria-selected"), "true");
  assert.strictEqual(runtime.document.activeElement, row("p060_drag_b").children[0]);

  const beforeIllegalDrop = labels();
  row("p060_drag_b").children[0].dispatch("pointerdown", { clientX: 0, clientY: 0 });
  runtime.document.dispatch("pointermove", { clientX: 8, clientY: 0 });
  runtime.document.pointedElement = row("p060_drag_b_child").children[0];
  runtime.document.dispatch("pointerup", { clientX: 8, clientY: 15, target: runtime.document.pointedElement });
  assert.deepEqual(labels(), beforeIllegalDrop);
});

test("P060a PE drag suppression expires after its gesture and pointercancel leaves no residue", () => {
  const makeRuntime = () => executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p060a_pe_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "p060a_pe_child", text: "Child", depth: 1, collapsed: false },
      { id: "p060a_pe_leaf", text: "Leaf", depth: 0, collapsed: false },
    ],
  }));
  const row = (runtime, id) => runtime.controls.get("outlinePane")
    .querySelectorAll(".outlineRow[data-block-id]")
    .find((candidate) => candidate.getAttribute("data-block-id") === id);

  const belowThreshold = makeRuntime();
  const leafGutter = row(belowThreshold, "p060a_pe_leaf").children[0];
  leafGutter.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  belowThreshold.document.dispatch("pointermove", { clientX: 3, clientY: 4 });
  belowThreshold.document.pointedElement = row(belowThreshold, "p060a_pe_parent").children[0];
  belowThreshold.document.dispatch("pointerup", { clientX: 3, clientY: 4 });
  leafGutter.dispatch("click");
  assert.equal(row(belowThreshold, "p060a_pe_leaf").getAttribute("aria-selected"), "true");
  assert.equal(belowThreshold.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
  assert.equal(belowThreshold.documentListenerCount("pointermove"), 0);

  const syntheticClick = makeRuntime();
  const syntheticSource = row(syntheticClick, "p060a_pe_parent").children[0];
  syntheticSource.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  syntheticClick.document.dispatch("pointermove", { clientX: 7, clientY: 0 });
  syntheticClick.document.pointedElement = row(syntheticClick, "p060a_pe_child").children[0];
  syntheticClick.document.dispatch("pointerup", { clientX: 7, clientY: 15 });
  assert.equal(syntheticSource.listenerCount("click"), 2);
  assert.equal(syntheticSource.dispatch("click").defaultPrevented, true);
  assert.equal(syntheticSource.listenerCount("click"), 1);
  assert.equal(syntheticClick.controls.get("outlinePane").children.length, 3);
  assert.equal(syntheticClick.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  const expired = makeRuntime();
  const expiredSource = row(expired, "p060a_pe_parent").children[0];
  expiredSource.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  expired.document.dispatch("pointermove", { clientX: 7, clientY: 0 });
  expired.document.pointedElement = row(expired, "p060a_pe_child").children[0];
  expired.document.dispatch("pointerup", { clientX: 7, clientY: 15 });
  expired.flushZeroTimers();
  assert.equal(expiredSource.listenerCount("click"), 1);
  expiredSource.dispatch("click");
  assert.deepEqual(expired.controls.get("outlinePane").children.map((candidate) => candidate.children[1].textContent), ["Parent", "Leaf"]);
  assert.equal(expired.documentListenerCount("pointermove"), 0);

  const cancelled = makeRuntime();
  const cancelledSource = row(cancelled, "p060a_pe_parent").children[0];
  cancelledSource.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  cancelled.document.dispatch("pointermove", { clientX: 7, clientY: 0 });
  cancelled.document.dispatch("pointercancel");
  assert.equal(cancelled.documentListenerCount("pointermove"), 0);
  assert.equal(cancelled.documentListenerCount("pointerup"), 0);
  assert.equal(cancelled.documentListenerCount("pointercancel"), 0);
  cancelledSource.dispatch("click");
  assert.deepEqual(cancelled.controls.get("outlinePane").children.map((candidate) => candidate.children[1].textContent), ["Parent", "Leaf"]);
});

test("P063 PE drag feedback is cleaned up and Ctrl/Cmd+Z restores the exact moved subtree", () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p063_pe_a", text: "A", depth: 0, collapsed: false },
      { id: "p063_pe_a_child", text: "A child", depth: 1, collapsed: false },
      { id: "p063_pe_b", text: "B", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  const labels = () => rows().map((candidate) => candidate.children[1].textContent);
  const source = row("p063_pe_b").children[0];
  const target = row("p063_pe_a");

  assert.equal(source.textContent, "▸");
  source.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  runtime.document.pointedElement = target.children[0];
  runtime.document.dispatch("pointermove", { clientX: 3, clientY: 4 });
  assert.equal(source.classList.contains("branchDragSource"), false);
  runtime.document.dispatch("pointermove", { clientX: 7, clientY: 2 });
  assert.equal(source.classList.contains("branchDragSource"), true);
  assert.equal(row("p063_pe_b").classList.contains("branchDragLifted"), true);
  assert.equal(target.classList.contains("branchDropBefore"), true);
  runtime.document.dispatch("pointerup", { clientX: 7, clientY: 2 });
  assert.deepEqual(labels(), ["B", "A", "A child"]);
  assert.equal(source.classList.contains("branchDragSource"), false);
  assert.equal(target.classList.contains("branchDropBefore"), false);

  const undo = runtime.document.dispatch("keydown", { key: "z", ctrlKey: true, target: row("p063_pe_b").children[0] });
  assert.equal(undo.defaultPrevented, true);
  assert.deepEqual(labels(), ["A", "A child", "B"]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  const noOpSource = row("p063_pe_b").children[0];
  noOpSource.dispatch("pointerdown", { clientX: 0, clientY: 0 });
  runtime.document.pointedElement = row("p063_pe_a").children[0];
  runtime.document.dispatch("pointermove", { clientX: 7, clientY: 28 });
  runtime.document.dispatch("pointerup", { clientX: 7, clientY: 28 });
  assert.deepEqual(labels(), ["A", "A child", "B"]);
  assert.equal(runtime.document.dispatch("keydown", { key: "z", ctrlKey: true, target: row("p063_pe_b").children[0] }).defaultPrevented, false);

  row("p063_pe_b").children[1].dispatch("click");
  const textUndo = runtime.document.dispatch("keydown", { key: "z", metaKey: true, target: row("p063_pe_b").children[1] });
  assert.equal(textUndo.defaultPrevented, false);
});

test("P063a keeps a saved PE drag undoable and protects its restored unsaved structure", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p063a_saved_a", text: "A", depth: 0, collapsed: false },
      { id: "p063a_saved_a_child", text: "A child", depth: 1, collapsed: false },
      { id: "p063a_saved_b", text: "B", depth: 0, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  const labels = () => rows().map((candidate) => candidate.children[1].textContent);

  row("p063a_saved_b").children[0].dispatch("pointerdown", { clientX: 0, clientY: 0 });
  runtime.document.pointedElement = row("p063a_saved_a").children[0];
  runtime.document.dispatch("pointermove", { clientX: 7, clientY: 2 });
  runtime.document.dispatch("pointerup", { clientX: 7, clientY: 2 });
  assert.deepEqual(labels(), ["B", "A", "A child"]);

  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  const undo = runtime.document.dispatch("keydown", { key: "z", ctrlKey: true, target: row("p063a_saved_b").children[0] });
  assert.equal(undo.defaultPrevented, true);
  assert.deepEqual(labels(), ["A", "A child", "B"]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(runtime.window.dispatch("beforeunload").defaultPrevented, true);

  runtime.controls.get("closeBtn").dispatch("click");
  assert.equal(runtime.controls.get("unsavedDialog").hidden, false);
});

test("P063a preserves PE drag undo across an unchanged failed save and invalidates it for a later outline edit", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "p063a_failed_a", text: "A", depth: 0, collapsed: false },
      { id: "p063a_failed_a_child", text: "A child", depth: 1, collapsed: false },
      { id: "p063a_failed_b", text: "B", depth: 0, collapsed: false },
    ],
  }), {
    applyAndSave() {
      return { ok: false, applied: false, changed: false, exported: false, reason: "cancelled" };
    },
  });
  const pane = runtime.controls.get("outlinePane");
  const rows = () => pane.querySelectorAll(".outlineRow[data-block-id]");
  const row = (id) => rows().find((candidate) => candidate.getAttribute("data-block-id") === id);
  const labels = () => rows().map((candidate) => candidate.children[1].textContent);
  const dragBBeforeA = () => {
    row("p063a_failed_b").children[0].dispatch("pointerdown", { clientX: 0, clientY: 0 });
    runtime.document.pointedElement = row("p063a_failed_a").children[0];
    runtime.document.dispatch("pointermove", { clientX: 7, clientY: 2 });
    runtime.document.dispatch("pointerup", { clientX: 7, clientY: 2 });
  };

  dragBBeforeA();
  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  const undoAfterFailedSave = runtime.document.dispatch("keydown", { key: "z", ctrlKey: true, target: row("p063a_failed_b").children[0] });
  assert.equal(undoAfterFailedSave.defaultPrevented, true);
  assert.deepEqual(labels(), ["A", "A child", "B"]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  dragBBeforeA();
  row("p063a_failed_a").children[0].dispatch("click");
  assert.deepEqual(labels(), ["B", "A"]);
  const staleUndo = runtime.document.dispatch("keydown", { key: "z", ctrlKey: true, target: row("p063a_failed_b").children[0] });
  assert.equal(staleUndo.defaultPrevented, false);
  assert.deepEqual(labels(), ["B", "A"]);
});

test("generated PE runtime accepts and forwards a synced source identity", () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    sourceOwnerKind: "synced",
    sourceVaultSessionId: "",
  }));
  runtime.controls.get("saveBtn").dispatch("click");
  assert.equal(runtime.saveCalls.length, 1);
  assert.equal(runtime.saveCalls[0].sourceOwnerKind, "synced");
});

test("generated runtime carries source identity, adopts successful revision and save-as identity, then saves again", async () => {
  const revisions = [
    "2026-01-01T00:00:01.000Z",
    "2026-01-01T00:00:02.000Z",
  ];
  const runtime = executeControlledRuntime(runtimeEditablePayload(), {
    applyAndSave(payload, callCount) {
      return {
        ok: true,
        applied: true,
        changed: true,
        exported: true,
        reason: "exported",
        nodeUpdatedAt: revisions[callCount - 1],
        sourceIdentity: callCount === 1
          ? { fileSessionId: 8, sourceFileName: "picked.json", sourcePipSession: false, sourceOwnerKind: "json", sourceVaultSessionId: "" }
          : { fileSessionId: 8, sourceFileName: "picked.json", sourcePipSession: false, sourceOwnerKind: "json", sourceVaultSessionId: "" },
      };
    },
  });
  const body = runtime.controls.get("bodyInput");
  body.value = "First";
  body.dispatch("input");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.saveCalls.length, 1);
  assert.equal(runtime.saveCalls[0].fileSessionId, 7);
  assert.equal(runtime.saveCalls[0].sourceFileName, "runtime.json");
  assert.equal(runtime.saveCalls[0].sourcePipSession, false);
  assert.equal(runtime.saveCalls[0].originalUpdatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  body.value = "Second";
  body.dispatch("input");
  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.saveCalls.length, 2);
  assert.equal(runtime.saveCalls[1].fileSessionId, 8);
  assert.equal(runtime.saveCalls[1].sourceFileName, "picked.json");
  assert.equal(runtime.saveCalls[1].originalUpdatedAt, revisions[0]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  body.value = "Third";
  body.dispatch("input");
  runtime.controls.get("saveCloseBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.closeCalls(), 1);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
});

test("generated runtime retains dirty content after applied export failure, adopts only its revision, and retries", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload(), {
    applyAndSave(payload, callCount) {
      if (callCount === 1) {
        return {
          ok: false,
          applied: true,
          changed: true,
          exported: false,
          reason: "cancelled",
          nodeUpdatedAt: "2026-01-01T00:00:01.000Z",
          sourceIdentity: { fileSessionId: 99, sourceFileName: "must-not-adopt.json", sourcePipSession: false, sourceOwnerKind: "json", sourceVaultSessionId: "" },
        };
      }
      return {
        ok: true,
        applied: true,
        changed: false,
        exported: true,
        reason: "exported",
        nodeUpdatedAt: "2026-01-01T00:00:01.000Z",
        sourceIdentity: { fileSessionId: 7, sourceFileName: "runtime.json", sourcePipSession: false, sourceOwnerKind: "json", sourceVaultSessionId: "" },
      };
    },
  });
  const body = runtime.controls.get("bodyInput");
  body.value = "Keep this content";
  body.dispatch("input");
  runtime.controls.get("saveCloseBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.closeCalls(), 0);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(body.value, "Keep this content");
  assert.match(runtime.controls.get("saveState").textContent, /cancelled/i);
  assert.match(runtime.alerts.at(-1), /cancelled/i);

  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.saveCalls.length, 2);
  assert.equal(runtime.saveCalls[1].originalUpdatedAt, "2026-01-01T00:00:01.000Z");
  assert.equal(runtime.saveCalls[1].fileSessionId, 7);
  assert.equal(runtime.saveCalls[1].sourceFileName, "runtime.json");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
});

test("generated runtime keeps stale, switched-file, missing-node, and lossy-save rejections dirty and open", async () => {
  const cases = [
    ["file-permission-pending", /finish opening the new file/i],
    ["file-session-changed", /different file/i],
    ["node-revision-changed", /changed after/i],
    ["missing-node", /no longer exists/i],
    ["details-too-long", /4,001 characters/i],
    ["outline-too-many-blocks", /401 rows/i],
    ["duplicate-outline-block-id", /duplicate internal row IDs/i],
  ];
  for (const [reason, messagePattern] of cases) {
    const runtime = executeControlledRuntime(runtimeEditablePayload(), {
      applyAndSave() {
        return {
          ok: false,
          applied: false,
          changed: false,
          exported: false,
          reason,
          status: `${reason} — not saved`,
          message: reason === "file-permission-pending"
            ? "Finish opening the new file, or cancel, before saving this editor. Your editor changes are still here."
            : reason === "details-too-long"
              ? "The readable text contains 4,001 characters. Pocket can safely save up to 4,000. Nothing was changed."
              : reason === "outline-too-many-blocks"
                ? "This outline has 401 rows. Pocket can safely save up to 400. Nothing was changed."
                : reason === "duplicate-outline-block-id"
                  ? "This outline contains duplicate internal row IDs. Pocket did not save it because doing so could alter the wrong row. Nothing was changed."
                  : "",
        };
      },
    });
    const body = runtime.controls.get("bodyInput");
    body.value = `Unsaved ${reason}`;
    body.dispatch("input");
    runtime.controls.get("saveCloseBtn").dispatch("click");
    await settleRuntime();
    assert.equal(runtime.closeCalls(), 0, reason);
    assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true, reason);
    assert.equal(body.value, `Unsaved ${reason}`, reason);
    assert.match(runtime.alerts.at(-1), messagePattern, reason);
    const escape = runtime.document.dispatch("keydown", { key: "Escape", target: body });
    assert.equal(escape.defaultPrevented, true, reason);
    assert.equal(runtime.controls.get("unsavedDialog").hidden, false, reason);
    assert.equal(runtime.closeCalls(), 0, reason);
  }
});

test("generated runtime exposes transient popup identity and sends saves only through the owner bridge", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    popupOwnerToken: "owner_transient_runtime",
    popupInstanceToken: "popup_transient_runtime",
  }));
  const identity = runtime.window.PocketNodePopoutSession.getIdentity();
  assert.deepEqual(identity, {
    ownerToken: "owner_transient_runtime",
    popupToken: "popup_transient_runtime",
  });
  assert.equal(runtime.window.PocketNodePopoutSession.matches(identity.ownerToken, identity.popupToken), true);
  assert.equal(runtime.window.PocketNodePopoutSession.matches("owner_foreign", identity.popupToken), false);
  assert.equal(runtime.window.PocketNodePopoutSession.matches(identity.ownerToken, "popup_foreign"), false);
  assert.equal(runtime.program.includes("applyAndSaveFromOwnedPopup"), true);
  assert.equal(runtime.program.includes("window.opener.PocketNodePopoutEditor"), false);
  assert.equal(runtime.windowListenerCount("beforeunload"), 1);

  const body = runtime.controls.get("bodyInput");
  body.value = "Transient identity must not persist";
  body.dispatch("input");
  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.saveCalls.length, 1);
  assert.equal(Object.hasOwn(runtime.saveCalls[0], "popupOwnerToken"), false);
  assert.equal(Object.hasOwn(runtime.saveCalls[0], "popupInstanceToken"), false);
  assert.equal(JSON.stringify(runtime.saveCalls[0]).includes(identity.ownerToken), false);
  assert.equal(JSON.stringify(runtime.saveCalls[0]).includes(identity.popupToken), false);
});

test("generated runtime remains responsive and dirty when its opener is gone", () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload(), { openerClosed: true });
  const body = runtime.controls.get("bodyInput");
  body.value = "Keep this disconnected draft";
  body.dispatch("input");

  runtime.controls.get("saveCloseBtn").dispatch("click");
  assert.equal(runtime.saveCalls.length, 0);
  assert.equal(runtime.closeCalls(), 0);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.match(runtime.controls.get("saveState").textContent, /earlier Pocket window/i);
  assert.match(runtime.alerts.at(-1), /nothing was changed/i);
  assert.equal(runtime.windowListenerCount("beforeunload"), 1);
  assert.equal(runtime.window.dispatch("beforeunload").defaultPrevented, true);

  runtime.controls.get("closeBtn").dispatch("click");
  assert.equal(runtime.controls.get("unsavedDialog").hidden, false);
  runtime.controls.get("unsavedCancelBtn").dispatch("click");
  assert.equal(runtime.controls.get("unsavedDialog").hidden, true);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(runtime.closeCalls(), 0);

  runtime.controls.get("closeBtn").dispatch("click");
  runtime.controls.get("unsavedDiscardBtn").dispatch("click");
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
  assert.equal(runtime.closeCalls(), 1);
});

test("generated runtime rejects incomplete local save identity without calling the opener", () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({ fileSessionId: null }));
  const body = runtime.controls.get("bodyInput");
  body.value = "Keep local edit";
  body.dispatch("input");
  runtime.controls.get("saveCloseBtn").dispatch("click");
  assert.equal(runtime.saveCalls.length, 0);
  assert.equal(runtime.closeCalls(), 0);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.match(runtime.controls.get("saveState").textContent, /source could not be verified/i);
  assert.match(runtime.alerts.at(-1), /could not verify/i);
});

test("generated runtime sends unsliced oversized and duplicate Outline payloads to authoritative main-window preflight", async () => {
  const cases = [
    ["body", runtimeEditablePayload({ body: "B".repeat(4001) }), (payload) => payload.body.length, 4001],
    ["rows", runtimeEditablePayload({
      mode: "outline",
      schema: EDITOR_SCHEMA,
      body: "Rows",
      outline: Array.from({ length: 401 }, (_, index) => ({
        id: `runtime_row_${index}`,
        text: "R",
        depth: 0,
        collapsed: false,
      })),
    }), (payload) => payload.outline.length, 401],
    ["block text", runtimeEditablePayload({
      mode: "outline",
      schema: EDITOR_SCHEMA,
      body: "Long row",
      outline: [{ id: "runtime_long", text: "x".repeat(4001), depth: 0, collapsed: false }],
    }), (payload) => payload.outline[0].text.length, 4001],
    ["duplicate IDs", runtimeEditablePayload({
      mode: "outline",
      schema: EDITOR_SCHEMA,
      body: "One\nTwo",
      outline: [
        { id: "runtime_duplicate", text: "One", depth: 0, collapsed: false },
        { id: "runtime_duplicate", text: "Two", depth: 0, collapsed: false },
      ],
    }), (payload) => payload.outline.map((block) => block.id), ["runtime_duplicate", "runtime_duplicate"]],
  ];
  for (const [label, payload, readActual, expected] of cases) {
    const runtime = executeControlledRuntime(payload, {
      applyAndSave() {
        return {
          ok: false,
          applied: false,
          changed: false,
          exported: false,
          reason: "invalid-save-payload",
          status: "Payload rejected — not saved",
          message: "Nothing was changed.",
        };
      },
    });
    runtime.controls.get("saveBtn").dispatch("click");
    await settleRuntime();
    assert.equal(runtime.saveCalls.length, 1, label);
    assert.deepEqual(readActual(runtime.saveCalls[0]), expected, label);
    assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true, label);
    assert.doesNotThrow(() => new Function(runtime.program), label);
  }
});

test("generated Outline runtime retains subtree Copy, Paste-after-selection, Duplicate, and Delete operations", async () => {
  const payload = runtimeEditablePayload({
    id: "runtime_outline_actions",
    title: "Outline actions",
    body: "Parent\n  Child\nSibling",
    mode: "outline",
    outline: [
      { id: "action_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "action_child", text: "Child", depth: 1, collapsed: false },
      { id: "action_sibling", text: "Sibling", depth: 0, collapsed: false },
    ],
  });
  const runtime = executeControlledRuntime(payload, { clipboardText: "Pasted\n  Pasted child" });
  const pane = runtime.controls.get("outlinePane");
  assert.equal(pane.children.length, 3);
  pane.children[0].dispatch("click", { target: pane.children[0] });

  const copy = runtime.document.dispatch("keydown", { key: "c", metaKey: true, target: pane });
  await settleRuntime();
  assert.equal(copy.defaultPrevented, true);
  assert.equal(runtime.clipboardWrites.at(-1), "Parent\n  Child");

  const duplicate = runtime.document.dispatch("keydown", { key: "d", metaKey: true, target: pane });
  assert.equal(duplicate.defaultPrevented, true);
  assert.equal(pane.children.length, 5);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);

  const removeDuplicate = runtime.document.dispatch("keydown", { key: "Delete", target: pane });
  assert.equal(removeDuplicate.defaultPrevented, true);
  assert.equal(pane.children.length, 3);

  pane.children[0].dispatch("click", { target: pane.children[0] });
  const pasteButton = runtime.document.createElement("button");
  pasteButton.setAttribute("data-outline-action", "paste");
  runtime.controls.get("outlineContextMenu").appendChild(pasteButton);
  runtime.controls.get("outlineContextMenu").dispatch("click", { target: pasteButton });
  await settleRuntime();
  await settleRuntime();
  assert.equal(pane.children.length, 5);
  assert.deepEqual(
    pane.children.map((row) => row.children[1].textContent),
    ["Parent", "Child", "Pasted", "Pasted child", "Sibling"],
  );
});

test("generated Outline runtime inserts context siblings at the target row with selection, focus, and save integrity", async () => {
  const template = source("js/pocket-node-popout-template.js");
  assert.match(template, /data-outline-action="insert-above"/);
  assert.match(template, /data-outline-action="insert-below"/);
  const payload = runtimeEditablePayload({
    id: "runtime_outline_siblings",
    title: "Outline siblings",
    body: "A\n  B\nC",
    mode: "outline",
    outline: [
      { id: "sibling_a", text: "A", depth: 0, collapsed: false },
      { id: "sibling_b", text: "B", depth: 1, collapsed: false },
      { id: "sibling_c", text: "C", depth: 0, collapsed: false },
    ],
  });
  const runtime = executeControlledRuntime(payload);
  const pane = runtime.controls.get("outlinePane");
  const insertBelow = runtime.document.createElement("button");
  insertBelow.setAttribute("data-outline-action", "insert-below");
  const insertAbove = runtime.document.createElement("button");
  insertAbove.setAttribute("data-outline-action", "insert-above");
  runtime.controls.get("outlineContextMenu").appendChild(insertBelow);
  runtime.controls.get("outlineContextMenu").appendChild(insertAbove);

  pane.children[0].dispatch("click", { target: pane.children[0] });
  pane.children[1].dispatch("click", { target: pane.children[1], ctrlKey: true });
  pane.dispatch("contextmenu", { target: pane.children[1].children[1], clientX: 20, clientY: 20 });
  runtime.controls.get("outlineContextMenu").dispatch("click", { target: insertBelow });

  assert.deepEqual(pane.children.map((row) => row.children[1].textContent), ["A", "B", "", "C"]);
  const insertedBelow = pane.children[2];
  const insertedBelowId = insertedBelow.getAttribute("data-block-id");
  assert.notEqual(insertedBelowId, "sibling_a");
  assert.notEqual(insertedBelowId, "sibling_b");
  assert.notEqual(insertedBelowId, "sibling_c");
  assert.equal(Number(insertedBelow.style.paddingLeft.replace("px", "")), 26);
  assert.equal(insertedBelow.getAttribute("aria-selected"), "true");
  assert.equal(pane.children.filter((row) => row.getAttribute("aria-selected") === "true").length, 1);
  assert.strictEqual(runtime.document.activeElement, insertedBelow.children[1]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(runtime.saveCalls.length, 0);

  pane.children[3].children[0].dispatch("click", { shiftKey: true });
  assert.deepEqual(pane.children.map((row) => row.getAttribute("aria-selected")), ["false", "false", "true", "true"]);

  pane.dispatch("contextmenu", { target: pane.children[1].children[1], clientX: 20, clientY: 20 });
  runtime.controls.get("outlineContextMenu").dispatch("click", { target: insertAbove });
  assert.deepEqual(pane.children.map((row) => row.children[1].textContent), ["A", "", "B", "", "C"]);
  assert.equal(Number(pane.children[1].style.paddingLeft.replace("px", "")), 26);
  assert.strictEqual(runtime.document.activeElement, pane.children[1].children[1]);

  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.equal(runtime.saveCalls.length, 1);
  assert.deepEqual(runtime.saveCalls[0].outline.map((block) => [block.text, block.depth, block.collapsed]), [
    ["A", 0, false], ["", 1, false], ["B", 1, false], ["", 1, false], ["C", 0, false],
  ]);
  assert.equal(runtime.saveCalls[0].outline.filter((block) => block.text === "").length, 2);
});

test("generated Outline runtime inserts above a parent without splitting its branch", async () => {
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    mode: "outline",
    outline: [
      { id: "above_a", text: "A", depth: 0, collapsed: false },
      { id: "above_b", text: "B", depth: 1, collapsed: false },
      { id: "above_b1", text: "B1", depth: 2, collapsed: true },
      { id: "above_c", text: "C", depth: 1, collapsed: false },
    ],
  }));
  const pane = runtime.controls.get("outlinePane");
  const insertAbove = runtime.document.createElement("button");
  insertAbove.setAttribute("data-outline-action", "insert-above");
  runtime.controls.get("outlineContextMenu").appendChild(insertAbove);

  pane.dispatch("contextmenu", { target: pane.children[1].children[1], clientX: 20, clientY: 20 });
  runtime.controls.get("outlineContextMenu").dispatch("click", { target: insertAbove });
  assert.deepEqual(pane.children.map((row) => row.children[1].textContent), ["A", "", "B", "B1", "C"]);
  assert.strictEqual(runtime.document.activeElement, pane.children[1].children[1]);

  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.deepEqual(runtime.saveCalls[0].outline.map((block) => [block.id, block.text, block.depth, block.collapsed]), [
    ["above_a", "A", 0, false],
    [runtime.saveCalls[0].outline[1].id, "", 1, false],
    ["above_b", "B", 1, false],
    ["above_b1", "B1", 2, true],
    ["above_c", "C", 1, false],
  ]);
});

test("generated Outline runtime routes Ctrl/Cmd+Enter through below-sibling subtree insertion", async () => {
  const payload = runtimeEditablePayload({
    id: "runtime_outline_enter_sibling",
    title: "Outline Enter sibling",
    body: "A\n  B\n    B1\n      B1a\n    B2\n  C",
    mode: "outline",
    outline: [
      { id: "enter_a", text: "A", depth: 0, collapsed: false },
      { id: "enter_b", text: "B", depth: 1, collapsed: true },
      { id: "enter_b1", text: "B1", depth: 2, collapsed: false },
      { id: "enter_b1a", text: "B1a", depth: 3, collapsed: true },
      { id: "enter_b2", text: "B2", depth: 2, collapsed: false },
      { id: "enter_c", text: "C", depth: 1, collapsed: false },
    ],
  });
  const runtime = executeControlledRuntime(payload);
  const pane = runtime.controls.get("outlinePane");
  assert.deepEqual(pane.children.map((row) => row.children[1].textContent), ["A", "B", "C"]);

  pane.children[1].children[1].dispatch("click", { target: pane.children[1].children[1] });
  const enter = pane.children[1].children[1].dispatch("keydown", { key: "Enter", ctrlKey: true });
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(pane.children.map((row) => row.children[1].textContent), ["A", "B", "", "C"]);
  assert.strictEqual(runtime.document.activeElement, pane.children[2].children[1]);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), true);
  assert.equal(runtime.saveCalls.length, 0);

  runtime.controls.get("saveBtn").dispatch("click");
  await settleRuntime();
  assert.deepEqual(runtime.saveCalls[0].outline.map((block) => [block.id, block.text, block.depth, block.collapsed]), [
    ["enter_a", "A", 0, false],
    ["enter_b", "B", 1, true],
    ["enter_b1", "B1", 2, false],
    ["enter_b1a", "B1a", 3, true],
    ["enter_b2", "B2", 2, false],
    [runtime.saveCalls[0].outline[5].id, "", 1, false],
    ["enter_c", "C", 1, false],
  ]);
  assert.notEqual(runtime.saveCalls[0].outline[5].id, "enter_b");
});

test("generated runtime preserves P007 Escape ordering for menu, dialog, row editing, and close", () => {
  const payload = runtimeEditablePayload({
    id: "runtime_escape",
    title: "Escape",
    body: "Parent\n  Child",
    mode: "outline",
    outline: [
      { id: "escape_parent", text: "Parent", depth: 0, collapsed: false },
      { id: "escape_child", text: "Child", depth: 1, collapsed: false },
    ],
  });
  const runtime = executeControlledRuntime(payload);
  const pane = runtime.controls.get("outlinePane");
  const row = pane.children[0];
  const text = row.children[1];
  pane.dispatch("contextmenu", { target: text, clientX: 20, clientY: 20 });
  assert.equal(runtime.controls.get("outlineContextMenu").hidden, false);
  runtime.document.dispatch("keydown", { key: "Escape", target: text });
  assert.equal(runtime.controls.get("outlineContextMenu").hidden, true);
  assert.equal(runtime.closeCalls(), 0);

  runtime.controls.get("bodyInput").dispatch("input");
  runtime.controls.get("closeBtn").dispatch("click");
  assert.equal(runtime.controls.get("unsavedDialog").hidden, false);
  runtime.document.dispatch("keydown", { key: "Escape", target: runtime.controls.get("unsavedCancelBtn") });
  assert.equal(runtime.controls.get("unsavedDialog").hidden, true);
  assert.equal(runtime.closeCalls(), 0);

  text.dispatch("click", { target: text });
  const editingText = pane.children[0].children[1];
  runtime.document.activeElement = editingText;
  runtime.document.dispatch("keydown", { key: "Escape", target: editingText });
  assert.strictEqual(runtime.document.activeElement, pane.children[0].children[0]);
  assert.equal(runtime.closeCalls(), 0);

  runtime.document.dispatch("keydown", { key: "Escape", target: pane.children[0].children[0] });
  assert.equal(runtime.controls.get("unsavedDialog").hidden, false);
  assert.equal(runtime.closeCalls(), 0);

  const cleanRuntime = executeControlledRuntime(payload);
  cleanRuntime.document.dispatch("keydown", { key: "Escape", target: cleanRuntime.controls.get("titleInput") });
  assert.equal(cleanRuntime.closeCalls(), 1);
});

test("generated read-only runtime disables mutation and save paths while keeping readable Text closable", () => {
  const context = createFullContractContext();
  const rawEditor = largeUnknownEditor();
  const rawNode = syntheticNode("runtime_large_unknown", {
    details: "Future-readable projection",
    editor: rawEditor,
    pe: null,
  });
  const node = normaliseOne(context, rawNode);
  const payload = context.PocketNodePopoutModel.buildPayload(node);
  const runtime = executeControlledRuntime(payload);
  const title = runtime.controls.get("titleInput");
  const body = runtime.controls.get("bodyInput");
  const save = runtime.controls.get("saveBtn");
  const saveClose = runtime.controls.get("saveCloseBtn");
  const textMode = runtime.controls.get("textModeBtn");
  const outlineMode = runtime.controls.get("outlineModeBtn");

  assert.equal(payload.readOnly, true);
  assert.equal(payload.mode, "text");
  assert.equal(payload.outline, null);
  assert.equal(runtime.classNames.has("readOnly"), true);
  assert.equal(runtime.classNames.has("textMode"), true);
  assert.equal(runtime.classNames.has("outlineMode"), false);
  assert.equal(runtime.classNames.has("isDirty"), false);
  assert.equal(title.value, "Synthetic runtime_large_unknown");
  assert.equal(body.value, "Future-readable projection");
  assert.equal(title.readOnly, true);
  assert.equal(body.readOnly, true);
  assert.equal(save.disabled, true);
  assert.equal(saveClose.disabled, true);
  assert.equal(textMode.disabled, true);
  assert.equal(outlineMode.disabled, true);
  assert.strictEqual(runtime.document.activeElement, body);

  title.value = "Programmatic mutation attempt";
  body.value = "Programmatic body attempt";
  title.dispatch("input");
  body.dispatch("input");
  outlineMode.dispatch("click");
  save.dispatch("click");
  saveClose.dispatch("click");
  const shortcut = runtime.document.dispatch("keydown", { key: "s", metaKey: true, target: body });
  assert.equal(shortcut.defaultPrevented, true);
  assert.equal(runtime.applyCalls.length, 0);
  assert.equal(runtime.saveCalls.length, 0);
  assert.equal(runtime.controls.get("outlinePane").children.length, 0);
  assert.equal(runtime.classNames.has("outlineMode"), false);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
  assert.equal(runtime.window.PocketNodePopoutSession.requestUnsavedProtection(), false);
  assert.equal(runtime.controls.get("unsavedDialog").hidden, true);
  assert.equal(runtime.window.dispatch("beforeunload").defaultPrevented, false);

  const escape = runtime.document.dispatch("keydown", { key: "Escape", target: body });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(runtime.closeCalls(), 1);
  assert.equal(runtime.applyCalls.length, 0);
  assert.equal(runtime.saveCalls.length, 0);
  assert.equal(runtime.controls.get("unsavedDialog").hidden, true);
  assert.equal(runtime.program.includes("preserve-if-untouched"), false);
  assert.equal(runtime.program.includes("Future outline content"), false);
  assert.equal(runtime.program.includes(rawEditor.padding.slice(0, 128)), false);

  const closeRuntime = executeControlledRuntime(payload);
  const closeButton = closeRuntime.controls.get("closeBtn");
  assert.equal(closeButton.disabled, false);
  closeButton.dispatch("click");
  assert.equal(closeRuntime.closeCalls(), 1);
  assert.equal(closeRuntime.applyCalls.length, 0);
  assert.equal(closeRuntime.saveCalls.length, 0);
  assert.equal(closeRuntime.controls.get("unsavedDialog").hidden, true);
  assert.equal(closeRuntime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  const templateContext = vm.createContext({ window: {} });
  runScript(templateContext, "js/pocket-node-popout-template.js");
  const html = templateContext.window.PocketNodePopoutTemplate.render(payload, { runtimeScript: "void 0;" });
  assert.match(html, /id="readOnlyBanner"/);
  assert.equal(html.includes(UNKNOWN_EDITOR_MESSAGE), true);
  assert.match(html, /readonly aria-readonly="true"/);
  assert.match(html, /id="saveBtn"[^>]* disabled/);
  assert.match(html, /id="outlineModeBtn"[^>]* disabled/);
  assert.match(html, /aria-label="Content sections"/);
  assert.match(html, /id="textModeBtn"[^>]*>Notes<\/button>/);
  assert.match(html, /id="outlineModeBtn"[^>]*>Outline<\/button>/);
  assert.match(html, /textarea id="bodyInput" aria-label="Notes"/);
  assert.match(html, /Read only · select text to copy/);
  assert.equal(html.includes("preserve-if-untouched"), false);
  assert.equal(html.includes("Future outline content"), false);
  assert.equal(html.includes(rawEditor.padding.slice(0, 128)), false);
});

test("generated PE runtime structured-paste parser retains spaces, tabs, mixed indentation, blanks, and depth clamp", () => {
  const factory = loadRuntimeFactory();
  const { probe } = runtimeProbe(factory, { id: "parser", title: "Parser", body: "", mode: "text", outline: null });
  const cases = [
    ["Parent\n  Child\n    Grandchild", [0, 1, 2]],
    ["Parent\n    Child\n        Grandchild", [0, 1, 2]],
    ["Parent\n\tChild\n\t\tGrandchild", [0, 1, 2]],
    ["Parent\n\tChild\n\t  Grandchild", [0, 1, 2]],
    ["    Parent\n      Child\n        Grandchild", [0, 1, 2]],
    ["Parent\n\n  Child\n \t \n    Grandchild", [0, 1, 2]],
    ["Parent\n  Child\n                    Grandchild", [0, 1, 8]],
  ];
  for (const [input, depths] of cases) {
    const blocks = probe.outlineBlocksFromPastedText(input, 0);
    assert.deepEqual(blocks.map((block) => block.depth), depths);
    assert.equal(blocks.length, depths.length);
    assert.equal(new Set(blocks.map((block) => block.id)).size, blocks.length);
    assert.equal(blocks.every((block) => block.collapsed === false), true);
  }

  const pasted = probe.outlineBlocksFromPastedText("    Parent\n      Child\n        Grandchild", 5);
  assert.deepEqual(pasted.map((block) => block.depth), [5, 6, 7]);
});

test("generated PE runtime renders one fresh blank row for an absent independent Outline", () => {
  const factory = loadRuntimeFactory();
  const { probe } = runtimeProbe(factory, { id: "empty_runtime", title: "Empty", body: "", mode: "text", outline: null });
  const pane = fakeElement("section");
  const rendered = probe.renderEmptyOutline(pane);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].text, "");
  assert.equal(rendered[0].depth, 0);
  assert.equal(rendered[0].collapsed, false);
  assert.ok(rendered[0].id);
  assert.equal(pane.children.length, 1);
});

test("generated PE tabs preserve independent unsaved Notes and Outline without dirtying or converting", () => {
  const notes = "Notes stay exactly here\n  including indentation";
  const runtime = executeControlledRuntime(runtimeEditablePayload({
    body: notes,
    mode: "text",
    outline: null,
  }));
  const body = runtime.controls.get("bodyInput");
  const pane = runtime.controls.get("outlinePane");
  assert.equal(runtime.classNames.has("textMode"), true);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);

  runtime.controls.get("outlineModeBtn").dispatch("click");
  assert.equal(runtime.classNames.has("outlineMode"), true);
  assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false);
  assert.equal(pane.children.length, 1);
  assert.equal(pane.children[0].children[1].textContent, "");
  assert.equal(body.value, notes);

  pane.children[0].children[1].textContent = "Independent outline";
  pane.children[0].children[1].dispatch("input");
  body.value = "Changed independent Notes";
  body.dispatch("input");
  runtime.controls.get("textModeBtn").dispatch("click");
  runtime.controls.get("outlineModeBtn").dispatch("click");
  assert.equal(body.value, "Changed independent Notes");
  assert.equal(pane.children[0].children[1].textContent, "Independent outline");
  runtime.controls.get("saveBtn").dispatch("click");
  assert.equal(runtime.saveCalls.length, 1);
  assert.equal(runtime.saveCalls[0].body, "Changed independent Notes");
  assert.equal(runtime.saveCalls[0].outline[0].text, "Independent outline");
  assert.equal(runtime.saveCalls[0].schema, EDITOR_SCHEMA);
});

test("generated PE saves submit independent clear-Notes and clear-Outline intent together with the other section", () => {
  const payload = runtimeEditablePayload({
    body: "Keep or clear Notes",
    mode: "outline",
    outline: [{ id: "clear_runtime_outline", text: "Keep or clear Outline", depth: 0, collapsed: false }],
  });

  const clearNotes = executeControlledRuntime(payload);
  const clearNotesBody = clearNotes.controls.get("bodyInput");
  clearNotesBody.value = " \n\t";
  clearNotesBody.dispatch("input");
  clearNotes.controls.get("saveBtn").dispatch("click");
  assert.equal(clearNotes.saveCalls[0].body, " \n\t");
  assert.equal(clearNotes.saveCalls[0].outline[0].text, "Keep or clear Outline");

  const clearOutline = executeControlledRuntime(payload);
  const outlineText = clearOutline.controls.get("outlinePane").children[0].children[1];
  outlineText.textContent = "";
  outlineText.dispatch("input");
  clearOutline.controls.get("saveBtn").dispatch("click");
  assert.equal(clearOutline.saveCalls[0].body, "Keep or clear Notes");
  assert.equal(clearOutline.saveCalls[0].outline[0].text, "");
  assert.equal(clearOutline.saveCalls[0].outline[0].depth, 0);
  assert.equal(clearOutline.saveCalls[0].outline[0].collapsed, false);
});

test("generated PE tabs preserve structural-only blank Outlines and do not classify them by text alone", () => {
  for (const [label, block] of [
    ["depth", { id: "runtime_structural_depth", text: "", depth: 1, collapsed: false }],
    ["collapse", { id: "runtime_structural_collapse", text: "", depth: 0, collapsed: true }],
  ]) {
    const runtime = executeControlledRuntime(runtimeEditablePayload({
      id: `runtime_structural_${label}`,
      body: "Independent Notes",
      mode: "outline",
      outline: [block],
    }));
    const pane = runtime.controls.get("outlinePane");
    assert.equal(pane.children.length, 1, label);
    assert.equal(pane.children[0].children[1].textContent, "", label);
    assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false, label);
    runtime.controls.get("textModeBtn").dispatch("click");
    runtime.controls.get("outlineModeBtn").dispatch("click");
    assert.equal(runtime.window.PocketNodePopoutSession.hasUnsavedChanges(), false, label);
    runtime.controls.get("saveBtn").dispatch("click");
    assert.equal(runtime.saveCalls[0].outline[0].depth, block.depth, label);
    assert.equal(runtime.saveCalls[0].outline[0].collapsed, block.collapsed, label);
    assert.equal(runtime.saveCalls[0].body, "Independent Notes", label);
  }
});

test("main-tree content indicator renders one existing badge for meaningful Notes or supported Outline without mutation", () => {
  const cases = [
    {
      name: "Notes only",
      node: syntheticNode("indicator_notes", { details: "  First Notes line  \nSecond Notes line" }),
      count: 1,
      title: "First Notes line",
    },
    {
      name: "textual Outline only",
      node: syntheticNode("indicator_outline", {
        editor: outlineMeta([
          { id: "indicator_blank_first", text: "  ", depth: 0, collapsed: false },
          { id: "indicator_first_text", text: "  First   Outline row  ", depth: 0, collapsed: false },
        ]),
      }),
      count: 1,
      title: "First Outline row",
    },
    {
      name: "Outline tooltip length",
      node: syntheticNode("indicator_outline_limit", {
        editor: outlineMeta([{ id: "indicator_long_row", text: "x".repeat(220), depth: 0, collapsed: false }]),
      }),
      count: 1,
      title: "x".repeat(180),
    },
    {
      name: "Notes and Outline",
      node: syntheticNode("indicator_both", {
        details: "Notes tooltip wins\nSecond line",
        editor: outlineMeta([{ id: "indicator_both_outline", text: "Outline tooltip loses", depth: 0, collapsed: false }]),
      }),
      count: 1,
      title: "Notes tooltip wins",
    },
    {
      name: "structural depth Outline",
      node: syntheticNode("indicator_depth", {
        editor: outlineMeta([{ id: "indicator_depth_row", text: "", depth: 1, collapsed: false }]),
      }),
      count: 1,
      title: "Has outline",
    },
    {
      name: "structural collapsed Outline",
      node: syntheticNode("indicator_collapsed", {
        editor: outlineMeta([{ id: "indicator_collapsed_row", text: "", depth: 0, collapsed: true }]),
      }),
      count: 1,
      title: "Has outline",
    },
    {
      name: "absent content",
      node: syntheticNode("indicator_absent"),
      count: 0,
      title: "",
    },
    {
      name: "blank Outline placeholder",
      node: syntheticNode("indicator_placeholder", {
        editor: outlineMeta([{ id: "indicator_placeholder_row", text: "", depth: 0, collapsed: false }]),
      }),
      count: 0,
      title: "",
    },
    {
      name: "empty Outline array",
      node: syntheticNode("indicator_empty", { editor: outlineMeta([]) }),
      count: 0,
      title: "",
    },
    {
      name: "unsupported editor without Notes",
      node: syntheticNode("indicator_unsupported", {
        editor: { schema: "future.editor.v9", mode: "outline", outline: [{ text: "Do not interpret" }] },
      }),
      count: 0,
      title: "",
    },
    {
      name: "malformed editor without Notes",
      node: syntheticNode("indicator_malformed", {
        editor: { schema: EDITOR_SCHEMA, mode: "outline", outline: "not-an-array" },
      }),
      count: 0,
      title: "",
    },
    {
      name: "unsupported editor with Notes",
      node: syntheticNode("indicator_unsupported_notes", {
        details: "Supported Notes fallback",
        editor: { schema: "future.editor.v9", mode: "outline", outline: [{ text: "Do not interpret" }] },
      }),
      count: 1,
      title: "Supported Notes fallback",
    },
    {
      name: "malformed editor with Notes",
      node: syntheticNode("indicator_malformed_notes", {
        details: "Malformed fallback Notes",
        editor: { schema: EDITOR_SCHEMA, mode: "outline", outline: "not-an-array" },
      }),
      count: 1,
      title: "Malformed fallback Notes",
    },
  ];

  for (const expected of cases) {
    const before = plain(expected.node);
    const rendered = createTreeRenderHarness([expected.node]);
    assert.equal(rendered.rows.length, 1, expected.name);
    assert.equal(rendered.badges.length, expected.count, expected.name);
    if (expected.count === 1) {
      assert.equal(rendered.badges[0].className, "detailBadge", expected.name);
      assert.equal(rendered.badges[0].textContent, "...", expected.name);
      assert.equal(rendered.badges[0].title, expected.title, expected.name);
    }
    assert.deepEqual(plain(expected.node), before, `${expected.name}: source node`);
    assert.deepEqual(plain(rendered.state.nodes[0]), before, `${expected.name}: rendered state node`);
    assert.equal(rendered.state.ops.length, 0, expected.name);
    assert.equal(rendered.context.__storageWrites.length, 0, expected.name);
    assert.deepEqual(plain(rendered.context.__surfaceCalls), {
      exportTree: 0,
      writeTruthFile: 0,
      showOpenFilePicker: 0,
      showSaveFilePicker: 0,
    }, expected.name);
  }
});

test("successful Outline save and clear add then remove the tree indicator without creating Notes", async () => {
  const context = createFullContractContext();
  const state = resetState(context, [syntheticNode("indicator_save_refresh")]);
  context.exportTree = async () => ({ ok: true });

  const addResult = await context.PocketNodePopoutEditor.applyAndSave(editorPayload(context, state.nodes[0], {
    mode: "outline",
    schema: EDITOR_SCHEMA,
    outline: [{ id: "indicator_saved_row", text: "Saved Outline row", depth: 0, collapsed: false }],
  }));
  assert.equal(addResult.ok, true);
  assert.equal(addResult.exported, true);
  assert.equal(Object.hasOwn(state.nodes[0], "details"), false);
  assert.equal(state.nodes[0].editor.outline[0].text, "Saved Outline row");

  const afterAdd = createTreeRenderHarness([state.nodes[0]]);
  assert.equal(afterAdd.badges.length, 1);
  assert.equal(afterAdd.badges[0].title, "Saved Outline row");

  const clearResult = await context.PocketNodePopoutEditor.applyAndSave(editorPayload(context, state.nodes[0], {
    mode: "outline",
    schema: EDITOR_SCHEMA,
    outline: [],
  }));
  assert.equal(clearResult.ok, true);
  assert.equal(clearResult.exported, true);
  assert.equal(Object.hasOwn(state.nodes[0], "details"), false);
  assert.equal(Object.hasOwn(state.nodes[0], "editor"), false);

  const afterClear = createTreeRenderHarness([state.nodes[0]]);
  assert.equal(afterClear.badges.length, 0);
});

test("tree correction retains Outline search, details-first copy context, and row interaction owners", () => {
  const searchableNode = syntheticNode("indicator_search", {
    editor: outlineMeta([{ id: "indicator_search_row", text: "Searchable Outline needle", depth: 0, collapsed: false }]),
  });
  const searched = createTreeRenderHarness([searchableNode], "outline needle");
  assert.equal(searched.rows.length, 1);
  assert.equal(searched.badges.length, 1);
  assert.equal(searched.rows[0].listeners.get("click")?.length, 1);
  assert.equal(searched.rows[0].listeners.get("dblclick")?.length, 1);
  assert.equal(searched.rows[0].listeners.get("contextmenu")?.length, 1);

  const copyContext = createFullContractContext();
  const payload = copyContext.copyContextPayloadForNode({
    label: "Label fallback",
    details: "Notes remain first\nSecond Notes line",
    editor: searchableNode.editor,
  });
  assert.equal(payload.kind, "details");
  assert.equal(payload.text, "Notes remain first\nSecond Notes line");
});

test("details-first copy context ignores editor metadata and falls back only to the label", () => {
  const context = createFullContractContext();
  const detailsFirst = context.copyContextPayloadForNode({
    label: "Label text",
    details: "  Details line\n    Child  ",
    editor: { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [{ text: "Outline text", depth: 0 }] },
  });
  assert.equal(detailsFirst.kind, "details");
  assert.equal(detailsFirst.text, "Details line\n    Child");
  assert.equal(detailsFirst.preserveLines, true);
  assert.equal(detailsFirst.max, 4000);

  const labelFallback = context.copyContextPayloadForNode({
    label: "  Label   fallback ",
    details: " \n\t ",
    editor: { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [{ text: "Must not win", depth: 0 }] },
  });
  assert.equal(labelFallback.kind, "label");
  assert.equal(labelFallback.text, "Label fallback");
  assert.equal(labelFallback.preserveLines, false);
  assert.equal(labelFallback.max, 220);
});
