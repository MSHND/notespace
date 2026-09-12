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
  "js/pocket-outline-persistence-policy.js",
  "js/pocket-node-content.js",
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

function createLocalSafetyIndexedDb() {
  const records = new Map();
  const api = { records, failPut: null, indexedDB: null };
  let created = false;
  const store = {
    keyPath: "key",
    get(key) { const request = {}; queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); }); return request; },
    put(value) { const request = {}; queueMicrotask(() => {
      if (api.failPut) { request.error = api.failPut; request.onerror?.(); return; }
      records.set(value.key, plain(value)); request.onsuccess?.();
    }); return request; },
    delete(key) { const request = {}; queueMicrotask(() => { records.delete(key); request.onsuccess?.(); }); return request; },
  };
  const database = {
    version: 1,
    get objectStoreNames() { return created ? ["current"] : []; },
    createObjectStore(name, options) {
      if (name !== "current" || options?.keyPath !== "key") throw new Error("invalid local safety schema");
      created = true;
      return store;
    },
    transaction() {
      const transaction = { error: null, objectStore: () => store, abort() { queueMicrotask(() => transaction.onabort?.()); } };
      setImmediate(() => transaction.oncomplete?.());
      return transaction;
    },
    close() {},
  };
  api.indexedDB = { open(name, version) {
      if (name !== "pocket.local.safety.v1" || version !== 1) {
        const genericRecords = new Map();
        let genericStoreName = "";
        const genericStore = {
          get(key) { const request = {}; queueMicrotask(() => { request.result = genericRecords.get(key); request.onsuccess?.(); }); return request; },
          put(value) { const request = {}; queueMicrotask(() => { genericRecords.set(value.key || value.name, plain(value)); request.onsuccess?.(); }); return request; },
          delete(key) { const request = {}; queueMicrotask(() => { genericRecords.delete(key); request.onsuccess?.(); }); return request; },
          getAll() { const request = {}; queueMicrotask(() => { request.result = [...genericRecords.values()]; request.onsuccess?.(); }); return request; },
        };
        const genericDb = {
          get objectStoreNames() { return { contains: (candidate) => candidate === genericStoreName }; },
          createObjectStore(storeName) { genericStoreName = storeName; return genericStore; },
          transaction() { const transaction = { objectStore: () => genericStore, abort() {} }; setImmediate(() => transaction.oncomplete?.()); return transaction; },
          close() {},
        };
        const request = { result: genericDb, transaction: { abort() {} } };
        queueMicrotask(() => { request.onupgradeneeded?.({ oldVersion: 0 }); request.onsuccess?.(); });
        return request;
      }
      const request = { result: database, transaction: { abort() {} } };
      queueMicrotask(() => { if (!created) request.onupgradeneeded?.({ oldVersion: 0 }); request.onsuccess?.(); });
      return request;
    } };
  return api;
}

function createBrowserContext(options = {}) {
  const storage = new Map();
  const localSafetyIndexedDb = options.indexedDB || createLocalSafetyIndexedDb().indexedDB;
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
    indexedDB: localSafetyIndexedDb,
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
    HTMLTextAreaElement: options.HTMLTextAreaElement || class HTMLTextAreaElement {},
    HTMLButtonElement: options.HTMLButtonElement || class HTMLButtonElement {},
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
  const payload = { ...plain(context.PocketNodePopoutModel.buildPayload(current)), ...plain(overrides) };
  if (Object.hasOwn(overrides, "body") && !Object.hasOwn(overrides, "text")) payload.text = String(overrides.body ?? "");
  if (Object.hasOwn(overrides, "text") && !Object.hasOwn(overrides, "body")) payload.body = String(overrides.text ?? "");
  return payload;
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

function creditorScaleOutline(groups = 3000) {
  return Array.from({ length: groups }, (_unused, index) => [
    { id: `creditor_${index}_0`, text: `Creditor ${index}`, depth: 0, collapsed: true },
    { id: `creditor_${index}_1`, text: `Datascape ${index}`, depth: 1, collapsed: false },
    { id: `creditor_${index}_2`, text: `Synergy ${index}`, depth: 1, collapsed: false },
    { id: `creditor_${index}_3`, text: `Email creditor${index}@example.test`, depth: 1, collapsed: false },
    { id: `creditor_${index}_4`, text: "Notes:", depth: 1, collapsed: false },
  ]).flat();
}

function assertExactOutline(actual, expected) {
  assert.equal(actual.length, expected.length);
  assert.deepEqual(
    plain(actual.map((block) => [block.id, block.text, block.depth, block.collapsed, block.order])),
    plain(expected.map((block, index) => [block.id, block.text, block.depth, block.collapsed, index + 1]))
  );
}

function quotaExceededError() {
  return new DOMException("Storage quota exceeded", "QuotaExceededError");
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
  let probe = null;
  const fakeDocument = {
    activeElement: null,
    createElement(tagName) { return fakeElement(tagName); },
    getElementById() { return null; },
  };
  assert.equal(factory.initialise(payload, {
    window: { setTimeout(callback) { if (typeof callback === "function") callback(); } },
    document: fakeDocument,
    requestAnimationFrame: () => 1,
    probe(value) { probe = value; },
  }), true);
  return { program: source("js/pocket-node-popout-runtime.js"), probe };
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
  const outlinePaneQueryCounts = new Map();
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
      insertBefore(child, reference) {
        child.parentNode = this;
        const index = reference ? this.children.indexOf(reference) : -1;
        if (index < 0) this.children.push(child);
        else this.children.splice(index, 0, child);
        return child;
      },
      removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; return child; },
      querySelectorAll(selector) {
        if (id === "outlinePane") outlinePaneQueryCounts.set(selector, (outlinePaneQueryCounts.get(selector) || 0) + 1);
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
    Object.defineProperty(control, "nextSibling", {
      get() {
        if (!control.parentNode) return null;
        const index = control.parentNode.children.indexOf(control);
        return index >= 0 ? control.parentNode.children[index + 1] || null : null;
      },
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
  const navigator = {
    clipboard: {
      writeText(text) {
        clipboardWrites.push(String(text));
        return Promise.resolve();
      },
      readText() {
        return Promise.resolve(typeof options.clipboardText === "string" ? options.clipboardText : "");
      },
    },
  };
  assert.equal(factory.initialise(runtimePayload, {
    window,
    document,
    navigator,
    requestAnimationFrame: (callback) => { if (typeof callback === "function") callback(); return 1; },
    alert: (message) => { alerts.push(String(message)); },
    console: { log() {}, info() {}, warn() {}, error() {} },
  }), true);
  return {
    program: source("js/pocket-node-popout-runtime.js"),
    window,
    document,
    controls,
    applyCalls,
    saveCalls,
    alerts,
    clipboardWrites,
    classNames,
    closeCalls: () => closeCalls,
    outlinePaneQueryCount: (selector) => outlinePaneQueryCounts.get(selector) || 0,
    resetOutlinePaneQueryCounts() { outlinePaneQueryCounts.clear(); },
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



test("active PE model retains 400, 401, and 15,000 outline blocks losslessly", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  for (const count of [400, 401, 15000]) {
    const outline = Array.from({ length: count }, (_, index) => ({ id: `b_${index}`, text: `Block ${index}`, depth: index ? 1 : 0 }));
    const result = model.normaliseEditorMeta(outlineMeta(outline));
    assert.equal(result.outline.length, count);
    assert.equal(result.outline.at(-1).id, `b_${count - 1}`);
  }
});

test("Outline normalisation rejects 15,001 blocks without slicing", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const outline = Array.from({ length: 15001 }, (_, index) => ({ id: `b_${index}`, text: `Block ${index}`, depth: index ? 1 : 0 }));
  assert.equal(model.normaliseEditorMeta(outlineMeta(outline)), null);
});

test("P105f enforces the exact 2,000,000-byte canonical Outline boundary", () => {
  const context = createFullContractContext();
  const policy = context.PocketOutlinePersistencePolicy;
  const outline = Array.from({ length: 500 }, (_, index) => ({
    id: `boundary_${index}`,
    text: "",
    depth: index ? 1 : 0,
    collapsed: false,
  }));
  const baseBytes = policy.utf8ByteLength(policy.serialiseEditorMeta(outline));
  const available = policy.LIMITS.editorBytes - baseBytes;
  const each = Math.floor(available / outline.length);
  outline.forEach((block) => { block.text = "x".repeat(each); });
  const remainder = policy.LIMITS.editorBytes - policy.utf8ByteLength(policy.serialiseEditorMeta(outline));
  outline.at(-1).text += "x".repeat(remainder);
  assert.equal(policy.utf8ByteLength(policy.serialiseEditorMeta(outline)), policy.LIMITS.editorBytes);
  assert.equal(policy.assessOutline(outline).ok, true);
  outline.at(-1).text += "x";
  assert.deepEqual(plain(policy.assessOutline(outline)), {
    ok: false,
    reason: "outline-too-large",
    actual: policy.LIMITS.editorBytes + 1,
    limit: policy.LIMITS.editorBytes,
  });
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







test("CURRENT-RISK: portal.export.v1 top-level precedence drops nested data extras on later export", () => {
  const result = loadAndExportFixture("root-precedence.json");
  assert.equal(result.state.nodes.length, 1);
  assert.equal(result.state.nodes[0].id, "fixture_root_winner");
  assert.equal(result.state.nodes[0].fixtureNodeExtra, "root copy");
  assert.equal(result.state.tombstones[0].id, "fixture_root_tombstone");
  assert.equal(result.payload.fixtureRootExtra.keep, true);
  assert.equal(Object.hasOwn(result.payload.data, "fixtureDataExtra"), false);
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

test("P101 removes the private v3 legacy fallback while retaining the live Phone opener", () => {
  const cutover = source("js/pocket-editor-cutover-v3.js");
  assert.doesNotMatch(cutover, /PocketEditorPopout/);
  assert.doesNotMatch(cutover, /openLegacyFallback|forceInlineBridgeToNode|function detailText/);
  assert.match(cutover, /const legacyOpenDetailsForSelectedNode/);
  assert.match(cutover, /function openPhoneDetails\(node\)/);
  assert.match(cutover, /return openPhoneDetails\(node\);/);
  assert.match(cutover, /return !!global\.PocketPeEditor\.open\(node\.id\);/);
});

test("Phone editor cutover uses the in-page detail owner for safe nodes and keeps desktop and unsupported routes", () => {
  const makeContext = (phoneMode) => {
    const context = createFullContractContext({
      document: {
        body: {
          classList: {
            contains(name) { return phoneMode && name === "phoneMode"; },
          },
        },
        getElementById() { return null; },
        addEventListener() {},
      },
    });
    const ordinary = syntheticNode("phone_cutover_ordinary", { details: "Phone Notes" });
    const supported = normaliseOne(context, fixture("current-outline-v1.json").mainThoughtTree[0]);
    supported.id = "phone_cutover_supported";
    const unsupported = normaliseOne(context, fixture("unknown-editor-schema.json").mainThoughtTree[0]);
    unsupported.id = "phone_cutover_unsupported";
    resetState(context, [ordinary, supported, unsupported]);
    let inlineCalls = 0;
    let standaloneCalls = 0;
    context.openDetailsEditorForSelectedNode = () => { inlineCalls += 1; };
    context.PocketPeEditor = {
      open() {
        standaloneCalls += 1;
        return true;
      },
    };
    runScript(context, "js/pocket-editor-cutover-v3.js");
    return { context, ordinary, supported, unsupported, get inlineCalls() { return inlineCalls; }, get standaloneCalls() { return standaloneCalls; } };
  };

  const phone = makeContext(true);
  const supportedEditorBefore = plain(phone.supported.editor);
  assert.equal(phone.context.openPocketNodeEditor(phone.ordinary.id), true);
  assert.equal(phone.inlineCalls, 1);
  assert.equal(phone.standaloneCalls, 0);
  assert.equal(lexicalState(phone.context).selectedId, phone.ordinary.id);

  assert.equal(phone.context.openPocketNodeEditor(phone.supported.id), true);
  assert.equal(phone.inlineCalls, 2);
  assert.equal(phone.standaloneCalls, 0);
  assert.deepEqual(plain(phone.supported.editor), supportedEditorBefore);

  assert.equal(phone.context.openPocketNodeEditor(phone.unsupported.id), true);
  assert.equal(phone.inlineCalls, 2);
  assert.equal(phone.standaloneCalls, 1);

  const desktop = makeContext(false);
  assert.equal(desktop.context.openPocketNodeEditor(desktop.ordinary.id), true);
  assert.equal(desktop.inlineCalls, 0);
  assert.equal(desktop.standaloneCalls, 1);
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

test("P095 routes the real Main-tree plain Enter boundary through canonical editor ownership", () => {
  class KeyboardElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.isContentEditable = false;
    }
  }
  let phoneMode = false;
  const context = createFullContractContext({
    HTMLElement: KeyboardElement,
    document: {
      body: { classList: { contains(name) { return phoneMode && name === "phoneMode"; } } },
      activeElement: null,
      getElementById() { return null; },
      addEventListener() {},
    },
  });
  const ordinary = syntheticNode("p095_ordinary", { label: "Ordinary" });
  const copyRoot = syntheticNode("p095_copy_root", { label: "Copy Templates" });
  const copyLeaf = syntheticNode("p095_copy_leaf", { label: "Copy me", parentId: copyRoot.id });
  const state = resetState(context, [ordinary, copyRoot, copyLeaf]);
  runScript(context, "js/pocket-tree-actions.js");

  context.isDetailsEditorOpen = () => false;
  context.isControlsHelpOpen = () => false;
  context.isCommandPaletteOpen = () => false;
  context.isPocketVaultRecoveryFlowOpen = () => false;
  context.isPocketDeviceChangesDecisionOpen = () => false;
  context.copyText = () => { copyCalls += 1; return Promise.resolve(true); };
  context.showCopiedFeedback = () => {};
  context.openPocketPeEditor = () => { legacyCalls += 1; return true; };
  context.PocketPeEditor = { open() { legacyCalls += 1; return true; } };
  let canonicalResult = true;
  let canonicalCalls = [];
  let legacyCalls = 0;
  let copyCalls = 0;
  context.openPocketNodeEditor = (id) => {
    canonicalCalls.push({ id, phone: phoneMode });
    return canonicalResult;
  };
  context.commitPendingPathImport = () => { pendingImportCommits += 1; };
  let pendingImportCommits = 0;
  vm.runInContext("state.inlineEdit.id = ''; state.detailsEdit.id = '';", context);

  const dispatch = (key, extras = {}) => {
    const event = {
      key,
      code: "",
      ctrlKey: extras.ctrlKey === true,
      metaKey: extras.metaKey === true,
      altKey: extras.altKey === true,
      shiftKey: extras.shiftKey === true,
      target: extras.target || new KeyboardElement("div"),
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    context.handleTreeKeydown(event);
    return event;
  };

  state.selectedId = ordinary.id;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.deepEqual(canonicalCalls, [{ id: ordinary.id, phone: false }]);
  canonicalResult = false;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.equal(canonicalCalls.length, 2);
  assert.equal(legacyCalls, 0);

  state.selectedId = copyRoot.id;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  state.selectedId = copyLeaf.id;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.equal(copyCalls, 2);
  assert.equal(canonicalCalls.length, 2);

  state.selectedId = ordinary.id;
  assert.equal(dispatch("Enter", { target: new KeyboardElement("input") }).defaultPrevented, false);
  state.inlineEdit.id = ordinary.id;
  assert.equal(dispatch("Enter").defaultPrevented, false);
  state.inlineEdit.id = "";
  state.moveMode = true;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.equal(canonicalCalls.length, 2);
  state.moveMode = false;
  vm.runInContext("pendingPathImport = { path: 'pending.json' };", context);
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.equal(pendingImportCommits, 1);
  assert.equal(canonicalCalls.length, 2);
  vm.runInContext("pendingPathImport = null;", context);

  assert.equal(dispatch("Enter", { ctrlKey: true }).defaultPrevented, false);
  phoneMode = true;
  canonicalResult = true;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.deepEqual(canonicalCalls.at(-1), { id: ordinary.id, phone: true });
  assert.equal(legacyCalls, 0);
});

test("P098 executable PE entry-route matrix proves the current owners", () => {
  class RouteElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.isContentEditable = false;
      this.textContent = "";
    }
  }

  let phoneMode = false;
  const listeners = {};
  const context = createFullContractContext({
    HTMLElement: RouteElement,
    document: {
      readyState: "complete",
      body: { classList: { contains(name) { return phoneMode && name === "phoneMode"; } } },
      getElementById() { return null; },
      addEventListener(type, listener) { listeners[type] = listener; },
    },
  });
  const ordinary = syntheticNode("p098_ordinary", { label: "Ordinary" });
  const copyRoot = syntheticNode("p098_copy_root", { label: "Copy context", copyContext: true });
  const copyLeaf = syntheticNode("p098_copy_leaf", { label: "Copy me", parentId: copyRoot.id, copyContext: true });
  const unsupported = normaliseOne(context, fixture("unknown-editor-schema.json").mainThoughtTree[0]);
  unsupported.id = "p098_unsupported";
  const state = resetState(context, [ordinary, copyRoot, copyLeaf, unsupported]);

  const indexScripts = indexScriptSources();
  assert.ok(indexScripts.indexOf("js/pocket-tree-actions.js") < indexScripts.indexOf("js/pocket-editor-cutover-v3.js"));
  assert.ok(indexScripts.indexOf("js/pocket-node-popout-editor.js") < indexScripts.indexOf("js/pocket-pe-node-popout-bridge.js"));
  assert.ok(indexScripts.indexOf("js/pocket-pe-node-popout-bridge.js") < indexScripts.indexOf("js/pocket-editor-cutover-v3.js"));
  assert.ok(indexScripts.includes("js/pocket-editor-popout.js"));
  assert.ok(indexScripts.includes("js/pocket-editor-popout-v2.js"));
  assert.ok(indexScripts.includes("js/pocket-enter-copy-only.js"));

  const canonicalCalls = [];
  const inlineCalls = [];
  const copyCalls = [];
  const statuses = [];
  let canonicalResult = true;
  context.PocketNodePopoutEditor = {
    open(id) {
      canonicalCalls.push(id);
      return canonicalResult;
    },
  };
  context.openDetailsEditorForSelectedNode = () => { inlineCalls.push(state.selectedId); };
  context.copyText = () => { copyCalls.push(state.selectedId); return Promise.resolve(true); };
  context.showCopiedFeedback = () => {};
  context.setStatus = (message, tone) => { statuses.push({ message, tone }); };
  context.isDetailsEditorOpen = () => false;
  context.isControlsHelpOpen = () => false;
  context.isCommandPaletteOpen = () => false;
  context.isPocketVaultRecoveryFlowOpen = () => false;
  context.isPocketDeviceChangesDecisionOpen = () => false;
  context.cancelPendingCopyClick = () => {};
  context.clearFilterForCopyLoop = () => {};
  context.focusRowByNodeId = () => {};
  context.commitPendingPathImport = () => {};
  runScript(context, "js/pocket-tree-actions.js");
  runScript(context, "js/pocket-pe-node-popout-bridge.js");
  runScript(context, "js/pocket-editor-cutover-v3.js");

  const dispatch = (key, extras = {}) => {
    const event = {
      key,
      code: "",
      ctrlKey: extras.ctrlKey === true,
      metaKey: extras.metaKey === true,
      altKey: extras.altKey === true,
      shiftKey: extras.shiftKey === true,
      target: extras.target || new RouteElement("div"),
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    context.handleTreeKeydown(event);
    return event;
  };

  const eventTarget = (kind, id) => {
    const row = new RouteElement("div");
    row.getAttribute = (name) => name === "data-node-id" ? id : null;
    const editButton = new RouteElement("button");
    editButton.textContent = "Edit";
    const target = new RouteElement("button");
    target.closest = (selector) => {
      if (selector === "[data-node-id]") return row;
      if (selector === ".rowMiniMenuBtn") return kind === "row-edit" ? editButton : null;
      if (selector === "#btnOpenPrimary") return kind === "primary" ? target : null;
      if (selector === "#cmdEdit") return kind === "command" ? target : null;
      if (selector === "#btnDetailPopout") return null;
      return null;
    };
    return target;
  };

  state.selectedId = ordinary.id;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.deepEqual(canonicalCalls, [ordinary.id], "plain Enter reaches the canonical desktop owner");
  assert.equal(copyCalls.length, 0);

  state.selectedId = copyLeaf.id;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.deepEqual(copyCalls, [copyLeaf.id], "copy-context Enter copies rather than opening PE");
  assert.equal(canonicalCalls.length, 1);

  state.selectedId = ordinary.id;
  const editableTarget = new RouteElement("input");
  assert.equal(dispatch("Enter", { target: editableTarget }).defaultPrevented, false);
  assert.equal(dispatch("Enter", { ctrlKey: true }).defaultPrevented, false);
  assert.equal(canonicalCalls.length, 1, "editable and modifier Enter do not open PE");

  phoneMode = true;
  assert.equal(dispatch("Enter").defaultPrevented, true);
  assert.deepEqual(inlineCalls, [ordinary.id], "Phone Enter reaches in-page details");
  assert.equal(canonicalCalls.length, 1, "Phone Enter does not open desktop PE");
  phoneMode = false;

  for (const [kind, eventName] of [
    ["primary", "click"],
    ["command", "click"],
    ["row-edit", "click"],
    ["row", "dblclick"],
  ]) {
    const event = {
      target: eventTarget(kind, ordinary.id),
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
    listeners[eventName](event);
  }
  assert.deepEqual(canonicalCalls.slice(1), [ordinary.id, ordinary.id, ordinary.id, ordinary.id],
    "primary Edit, command Edit, row-menu Edit and double-click share the canonical owner");
  assert.equal(inlineCalls.length, 1);

  assert.equal(context.openPocketEditor(ordinary.id), true, "canonical public alias remains supported");
  assert.equal(context.PocketPeEditor.open(ordinary.id), true, "legacy public bridge remains supported");
  assert.equal(canonicalCalls.length, 7);

  canonicalResult = false;
  assert.equal(context.openPocketNodeEditor(unsupported.id), false, "unsupported data fails closed");
  assert.equal(inlineCalls.length, 1, "unsupported desktop data does not enter Phone details");
  assert.equal(canonicalCalls.length, 8, "unsupported data still reaches the canonical validation boundary");
  assert.match(statuses.at(-1).message, /read-only compatibility view/i);
});

test("P100 removes the unreachable human-close target while preserving canonical popup identity", () => {
  const scripts = indexScriptSources();
  assert.equal(scripts.includes("js/pocket-editor-human-close.js"), false);

  const standaloneTargetOpen = /(?:global|window)\.open\([^)]*["']pocketStandalonePe["']/;
  assert.equal(
    scripts.some((script) => standaloneTargetOpen.test(source(script))),
    false,
    "no loaded production source opens the retired standalone PE target",
  );

  const ownerSource = source("js/pocket-node-popout-window.js");
  assert.match(ownerSource, /global\.open\("", "_blank"/);
  assert.match(ownerSource, /const targetName = `pocketPe_\$\{ownerToken\}_\$\{popupToken\}`/);
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

test("P067 repeated main structural arrows stay one-step, persist once, and retain move undo", () => {
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
  const state = resetState(context, [
    syntheticNode("p067_a", { label: "A", parentId: "root", order: 1001 }),
    syntheticNode("p067_b", { label: "B", parentId: "root", order: 1002 }),
    syntheticNode("p067_c", { label: "C", parentId: "root", order: 1003 }),
    syntheticNode("p067_d", { label: "D", parentId: "root", order: 1004 }),
  ]);
  let renders = 0;
  let pipSnapshots = 0;
  let workspaceSaves = 0;
  let refocuses = 0;
  let touchedRows = 0;
  context.cleanText = (value) => String(value || "");
  context.renderTree = () => { renders += 1; };
  context.persistPipSnapshot = () => { pipSnapshots += 1; context.saveWorkspaceState(); };
  context.saveWorkspaceState = () => { workspaceSaves += 1; };
  context.refocusTreeNavigation = () => { refocuses += 1; };
  context.flashTouchedRow = () => { touchedRows += 1; };
  context.recordOp = () => {};
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
  context.nowIso = () => "2026-01-01T00:00:00.000Z";
  context.expandPathToNode = () => {};
  context.requestAnimationFrame = (callback) => callback();
  runScript(context, "js/pocket-history-status.js");
  context.setStatus = () => {};
  context.refreshMeta = () => {};
  context.recordOp = () => {};
  runScript(context, "js/pocket-tree-actions.js");
  context.refocusTreeNavigation = () => { refocuses += 1; };
  context.flashTouchedRow = () => { touchedRows += 1; };
  state.inlineEdit.id = "";
  state.detailsEdit.id = "";

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
  state.selectedId = "p067_d";
  for (let index = 0; index < 3; index += 1) {
    assert.equal(dispatch("ArrowUp", { ctrlKey: true }).defaultPrevented, true, `up ${index}`);
  }
  assert.deepEqual(state.nodes.filter((node) => node.parentId === "root").sort((a, b) => a.order - b.order).map((node) => node.id), [
    "p067_d", "p067_a", "p067_b", "p067_c",
  ]);
  for (let index = 0; index < 2; index += 1) {
    assert.equal(dispatch("ArrowDown", { metaKey: true }).defaultPrevented, true, `down ${index}`);
  }
  assert.deepEqual(state.nodes.filter((node) => node.parentId === "root").sort((a, b) => a.order - b.order).map((node) => node.id), [
    "p067_a", "p067_b", "p067_d", "p067_c",
  ]);
  assert.equal(dispatch("ArrowRight", { ctrlKey: true }).defaultPrevented, true);
  assert.equal(state.nodes.find((node) => node.id === "p067_d").parentId, "p067_b");
  assert.equal(dispatch("ArrowLeft", { ctrlKey: true }).defaultPrevented, true);
  assert.equal(state.nodes.find((node) => node.id === "p067_d").parentId, "root");
  assert.equal(state.selectedId, "p067_d");
  assert.equal(renders, 7);
  assert.equal(pipSnapshots, 7);
  assert.equal(workspaceSaves, 7);
  assert.equal(refocuses, 7);
  assert.equal(touchedRows, 0);

  assert.equal(context.undoLastMoveAction(), undefined);
  assert.equal(state.nodes.find((node) => node.id === "p067_d").parentId, "p067_b");
});

test("P069 Main structural moves mark Save immediately without a selection refresh", () => {
  const saveButton = {
    textContent: "save",
    disabled: false,
    title: "",
    attributes: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const context = createFullContractContext({
    document: {
      body: { classList },
      activeElement: null,
      getElementById(id) { return id === "btnExportTree" ? saveButton : null; },
      addEventListener() {},
    },
  });
  context.renderTree = () => {};
  context.refreshMeta = () => { throw new Error("structural moves must use the small Save refresh"); };
  context.refocusTreeNavigation = () => {};
  context.setStatus = () => {};
  context.persistPipSnapshot = () => {};
  context.flashTouchedRow = () => {};
  context.requestAnimationFrame = (callback) => callback();
  context.requirePocketFileForChanges = () => true;
  context.maxSiblingOrder = (parentId) => Math.max(1000, ...lexicalState(context).nodes
    .filter((node) => (node.parentId || "root") === (parentId || "root"))
    .map((node) => Number(node.order) || 0));
  const state = resetState(context, [
    syntheticNode("p069_a", { label: "A", parentId: "root", order: 1001 }),
    syntheticNode("p069_b", { label: "B", parentId: "root", order: 1002 }),
  ]);
  runScript(context, "js/pocket-tree-actions.js");

  state.selectedId = "p069_b";
  context.moveNodeWithinSiblings("p069_b", -1);
  assert.equal(saveButton.textContent, "save*");
  assert.equal(state.selectedId, "p069_b");
  assert.equal(state.ops.length, 1);

  context.moveTreeBranchByDrop("p069_b", "p069_a", "inside");
  assert.equal(saveButton.textContent, "save*");
  assert.equal(state.selectedId, "p069_b");
  assert.equal(state.ops.length, 2);
});

test("P069a dirty structural state supersedes a saved flash while clean flashes still complete", () => {
  const classes = new Set();
  const saveButton = {
    textContent: "save",
    disabled: false,
    title: "",
    attributes: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const context = createBrowserContext({
    document: {
      body: { classList },
      activeElement: null,
      getElementById(id) { return id === "btnExportTree" ? saveButton : null; },
      addEventListener() {},
    },
  });
  loadScriptsInIndexOrder(context, FULL_CONTRACT_SCRIPTS);
  let nextTimer = 0;
  const timers = new Map();
  const clearedTimers = [];
  context.setTimeout = (callback) => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  };
  context.clearTimeout = (id) => {
    clearedTimers.push(id);
    timers.delete(id);
  };
  let refreshMetaCalls = 0;
  context.refreshMeta = () => { refreshMetaCalls += 1; };
  context.renderTree = () => {};
  context.refocusTreeNavigation = () => {};
  context.setStatus = () => {};
  context.persistPipSnapshot = () => {};
  context.requirePocketFileForChanges = () => true;
  context.nowIso = () => "2026-01-01T00:00:00.000Z";
  context.expandPathToNode = () => {};
  context.compareSiblingOrder = (left, right) => Number(left.order) - Number(right.order);
  context.nodeMap = () => new Map(lexicalState(context).nodes.map((node) => [node.id, node]));
  context.renumberChildren = (parentId) => lexicalState(context).nodes
    .filter((node) => (node.parentId || "root") === (parentId || "root"))
    .sort(context.compareSiblingOrder)
    .forEach((node, index) => { node.order = 1001 + index; });
  context.recordOp = (op) => { lexicalState(context).ops.push(op); };
  const state = resetState(context, [
    syntheticNode("p069a_a", { label: "A", parentId: "root", order: 1001 }),
    syntheticNode("p069a_b", { label: "B", parentId: "root", order: 1002 }),
  ]);
  context.maxSiblingOrder = (parentId) => Math.max(1000, ...state.nodes
    .filter((node) => (node.parentId || "root") === (parentId || "root"))
    .map((node) => Number(node.order) || 0));
  runScript(context, "js/pocket-tree-actions.js");

  context.flashSaveChip("saved");
  const staleTimer = nextTimer;
  assert.equal(saveButton.textContent, "saved");
  assert.equal(classes.has("on"), true);
  const staleCallback = timers.get(staleTimer);

  state.selectedId = "p069a_b";
  context.moveNodeWithinSiblings("p069a_b", -1);
  assert.equal(clearedTimers.includes(staleTimer), true);
  assert.equal(saveButton.textContent, "save*");
  assert.equal(classes.has("on"), false);
  assert.equal(refreshMetaCalls, 0);
  staleCallback();
  assert.equal(saveButton.textContent, "save*");
  assert.equal(refreshMetaCalls, 0);

  state.ops = [];
  context.flashSaveChip("saved");
  const cleanTimer = nextTimer;
  context.refreshSaveState();
  assert.equal(saveButton.textContent, "saved");
  assert.equal(classes.has("on"), true);
  timers.get(cleanTimer)();
  assert.equal(classes.has("on"), false);
  assert.equal(refreshMetaCalls, 1);
});

test("P097 Save-chip state is event-driven without the normalise watchdog", () => {
  assert.doesNotMatch(source("index.html"), /pocket-save-chip-normalise/);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "js/pocket-save-chip-normalise.js")), false);
  assert.doesNotMatch(source("js/pocket-history-status.js"), /setInterval\s*\(/);

  const classes = new Set();
  const saveButton = {
    textContent: "save",
    disabled: false,
    title: "",
    attributes: {},
    classList: {
      add(name) { classes.add(name); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const context = createBrowserContext({
    document: {
      body: { classList },
      activeElement: null,
      getElementById(id) { return id === "btnExportTree" ? saveButton : null; },
      addEventListener() {},
    },
  });
  loadScriptsInIndexOrder(context, FULL_CONTRACT_SCRIPTS);
  let vaultActive = false;
  context.isPocketVaultOwnerActive = () => vaultActive;
  let nextTimer = 0;
  const timers = new Map();
  context.setTimeout = (callback) => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  };
  context.clearTimeout = (id) => timers.delete(id);
  const state = resetState(context, []);

  context.refreshSaveState();
  assert.equal(saveButton.disabled, true);
  assert.equal(saveButton.textContent, "save");
  assert.equal(saveButton.attributes["aria-label"], "Save Pocket file");

  state.nodes = [syntheticNode("p097_a")];
  state.ops = [{ type: "rename" }];
  context.refreshSaveState();
  assert.equal(saveButton.disabled, false);
  assert.equal(saveButton.textContent, "save*");
  assert.equal(classes.has("safetyNeed"), true);

  context.flashSaveChip("save*");
  const dirtyFlashTimer = nextTimer;
  assert.equal(saveButton.textContent, "save*");
  assert.equal(classes.has("safetyNeed"), true);
  assert.equal(classes.has("on"), true);

  state.ops = [];
  context.refreshMeta = () => context.refreshSaveState();
  timers.get(dirtyFlashTimer)();
  state.conflictGuard = { active: true, reason: "", loadedAt: "", newerAt: "" };
  context.refreshSaveState();
  assert.equal(saveButton.textContent, "check");
  assert.equal(classes.has("safetyCheck"), true);
  assert.equal(saveButton.title, "This file looks older than a local/saved copy; save carefully");

  state.conflictGuard.active = false;
  vaultActive = true;
  context.refreshSaveState();
  assert.equal(saveButton.title, "Save encrypted Vault");
  assert.equal(saveButton.attributes["aria-label"], "Save encrypted Vault");

  state.saveInProgress = true;
  context.refreshSaveState();
  assert.equal(saveButton.disabled, true);
  assert.equal(saveButton.textContent, "saving...");
  assert.equal(saveButton.title, "Writing encrypted Vault");

  state.saveInProgress = false;
  vaultActive = false;
  context.flashSaveChip("saved");
  const flashTimer = nextTimer;
  assert.equal(saveButton.textContent, "saved");
  assert.equal(saveButton.disabled, false);
  assert.equal(classes.has("safetyNeed"), false);
  assert.equal(classes.has("safetyCheck"), false);
  assert.equal(classes.has("on"), true);
  assert.equal(saveButton.title, "Save a portable pocket copy");
  timers.get(flashTimer)();
  assert.equal(saveButton.textContent, "save");
  assert.equal(classes.has("on"), false);
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
  assert.equal(leafGutter.textContent, "");
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











test("P105j commits the JSON current safety slot in dedicated IndexedDB without a localStorage duplicate", async () => {
  const idb = createLocalSafetyIndexedDb();
  const context = createFullContractContext({ indexedDB: idb.indexedDB });
  const node = syntheticNode("p105j_current", { details: "IndexedDB safety" });
  resetState(context, [node]);

  assert.equal(await context.saveLocalSafetySnapshotDurably("p105j-current"), true);
  assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), false);
  const current = await context.readLocalSafetySnapshotDurably();
  assert.equal(current.norm.nodes[0].details, "IndexedDB safety");
  assert.equal(idb.records.get("current").entry.reason, "p105j-current");

  const reopened = createFullContractContext({ indexedDB: idb.indexedDB });
  resetState(reopened, [node]);
  const afterRestart = await reopened.readLocalSafetySnapshotDurably();
  assert.equal(afterRestart.norm.nodes[0].details, "IndexedDB safety");
});

test("P105k hydrates committed JSON safety before the real reopened-file stale decision", async () => {
  const idb = createLocalSafetyIndexedDb();
  const fileName = "p105k-local.json";
  const writer = createFullContractContext({ indexedDB: idb.indexedDB });
  const savedNode = syntheticNode("p105k_saved", { details: "Committed IndexedDB safety" });
  const writerState = resetState(writer, [savedNode]);
  writerState.source = { schema: "portal.export.v1", fileName, writtenAt: "2026-08-28T12:00:00.000Z" };
  writer.setPocketFileSession({ name: fileName }, fileName, { forceNewSession: true });
  assert.equal(await writer.saveLocalSafetySnapshotDurably("p105k-current"), true);
  assert.equal(writer.__storage.has("pocketLite.localSafety.snapshot.v1"), false);

  const reopened = createFullContractContext({ indexedDB: idb.indexedDB });
  resetState(reopened, [syntheticNode("p105k_before", { details: "Fresh runtime" })]);
  const handle = {
    name: fileName,
    async queryPermission() { return "granted"; },
    async getFile() {
      return {
        name: fileName,
        async text() {
          return JSON.stringify({
            schema: "portal.export.v1",
            writtenAt: "2000-01-01T00:00:00.000Z",
            mainThoughtTree: [syntheticNode("p105k_file", { details: "Older file truth" })],
            mainThoughtTreeTombstones: [],
          });
        },
      };
    },
  };

  const file = await handle.getFile();
  assert.equal(await reopened.loadFromFile(file, {
    fileSession: { handle, displayName: fileName },
  }), true);
  assert.equal(reopened.readLocalSafetySnapshot().norm.nodes[0].details, "Committed IndexedDB safety");
  assert.equal(lexicalState(reopened).conflictGuard.active, true);
  assert.match(lexicalState(reopened).conflictGuard.reason, /local safety copy is newer/i);
});

test("P105k keeps legacy current safety available when IndexedDB is unavailable and never hydrates private owners", async () => {
  const legacyWriter = createFullContractContext({ indexedDB: createLocalSafetyIndexedDb().indexedDB });
  const node = syntheticNode("p105k_legacy", { details: "Legacy fallback" });
  const state = resetState(legacyWriter, [node]);
  state.source = { schema: "portal.export.v1", fileName: "p105k-legacy.json", writtenAt: "2026-08-28T12:00:00.000Z" };
  assert.equal(await legacyWriter.saveLocalSafetySnapshotDurably("p105k-legacy"), true);
  const legacyRaw = JSON.stringify((await legacyWriter.readLocalSafetySnapshotDurably()).parsed);

  const fallback = createFullContractContext();
  resetState(fallback, [node]);
  fallback.__storage.set("pocketLite.localSafety.snapshot.v1", legacyRaw);
  assert.equal(await fallback.hydrateLocalSafetySnapshotForCurrentJsonOwner(), false);
  assert.equal(fallback.readLocalSafetySnapshot().norm.nodes[0].details, "Legacy fallback");

  for (const ownerKind of ["synced", "vault"]) {
    const idb = createLocalSafetyIndexedDb();
    idb.records.set("current", { key: "current", entry: JSON.parse(legacyRaw) });
    const privateContext = createFullContractContext({ indexedDB: idb.indexedDB });
    resetState(privateContext, [node]);
    if (ownerKind === "synced") {
      privateContext.setPocketFileSession(null, "Synced Pocket", { ownerKind: "synced", forceNewSession: true });
    } else {
      privateContext.isPocketVaultOwnerActive = () => true;
    }
    assert.equal(await privateContext.hydrateLocalSafetySnapshotForCurrentJsonOwner(), false, ownerKind);
    assert.equal(privateContext.readLocalSafetySnapshot(), null, ownerKind);
  }
});

test("P105j retains a legacy current snapshot until IndexedDB commits an equivalent-or-newer entry", async () => {
  const idb = createLocalSafetyIndexedDb();
  const context = createFullContractContext({ indexedDB: idb.indexedDB });
  resetState(context, [syntheticNode("p105j_legacy", { details: "Legacy current" })]);
  assert.equal(await context.saveLocalSafetySnapshotDurably("p105j-legacy"), true);
  const legacyRaw = JSON.stringify(idb.records.get("current").entry);
  idb.records.clear();
  context.__storage.set("pocketLite.localSafety.snapshot.v1", legacyRaw);
  idb.failPut = new DOMException("IndexedDB unavailable", "InvalidStateError");
  assert.equal(await context.saveLocalSafetySnapshotDurably("p105j-migration"), false);
  assert.equal(context.__storage.get("pocketLite.localSafety.snapshot.v1"), legacyRaw);
  idb.failPut = null;
  assert.equal(await context.saveLocalSafetySnapshotDurably("p105j-migration"), true);
  assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), false);
  assert.equal((await context.readLocalSafetySnapshotDurably()).norm.nodes[0].details, "Legacy current");
});

test("P105j never writes plaintext current safety to the local database for Synced or Vault ownership", async () => {
  for (const ownerKind of ["synced", "vault"]) {
    const idb = createLocalSafetyIndexedDb();
    const context = createFullContractContext({ indexedDB: idb.indexedDB });
    resetState(context, [syntheticNode(`p105j_${ownerKind}`, { details: ownerKind })]);
    if (ownerKind === "synced") {
      context.setPocketFileSession(null, "Synced Pocket", { ownerKind: "synced", forceNewSession: true });
    } else {
      context.isPocketVaultOwnerActive = () => true;
    }
    assert.equal(await context.saveLocalSafetySnapshotDurably("p105j-private"), false, ownerKind);
    assert.equal(idb.records.size, 0, ownerKind);
  }
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

test("P094 external PE runtime accepts independent Notes, Outline, both, structural-only, absent, and rejected payloads", () => {
  const runtimeSource = source("js/pocket-node-popout-runtime.js");
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
    assert.equal(typeof payload, "object");
    assert.equal(runtimeSource.includes(JSON.stringify(payload)), false);
  }
});

















































































test("P193k6 New Pocket save picker is untyped while Open remains typed and cancellation is one-shot", async () => {
  const creating = createFullContractContext();
  resetState(creating, [syntheticNode("p193k6_create")]);
  let savePickerCalls = 0;
  let savePickerOptions = null;
  creating.showSaveFilePicker = async (options) => {
    savePickerCalls += 1;
    savePickerOptions = plain(options);
    const error = new Error("synthetic cancellation");
    error.name = "AbortError";
    throw error;
  };

  assert.equal(await creating.createNewPocketFile(), false);
  assert.equal(savePickerCalls, 1);
  assert.deepEqual(savePickerOptions, { suggestedName: "pocket-data.json" });
  assert.equal(Object.prototype.hasOwnProperty.call(savePickerOptions, "types"), false);

  const opening = createFullContractContext();
  resetState(opening, [syntheticNode("p193k6_open")]);
  let openPickerCalls = 0;
  let openPickerOptions = null;
  opening.showOpenFilePicker = async (options) => {
    openPickerCalls += 1;
    openPickerOptions = plain(options);
    return [];
  };

  assert.equal(await opening.openPocketFile(), false);
  assert.equal(openPickerCalls, 1);
  assert.deepEqual(openPickerOptions, {
    types: [{ description: "Pocket file", accept: { "application/json": [".json"] } }],
    multiple: false,
  });
});

// P198a replaces retired P013 Notes/Outline-mode regression assumptions with the one-document v2 contract.
test("P198a regression composition loads the shared content contract before metadata and PE owners", () => {
  const scripts = indexScriptSources();
  const content = scripts.indexOf("js/pocket-node-content.js");
  assert.ok(content > scripts.indexOf("js/pocket-outline-persistence-policy.js"));
  assert.ok(content < scripts.indexOf("js/pocket-editor-metadata.js"));
  assert.ok(content < scripts.indexOf("js/pocket-node-popout-model.js"));
  assert.ok(content < scripts.indexOf("js/pocket-editor-copy.js"));
});

test("P198a regression preserves a large canonical v2 document through export and normalise round-trip", () => {
  const context = createCoreContext();
  const text = "Header\n" + "A".repeat(12000) + "\n  child\n    grandchild";
  const prepared = context.PocketNodeContent.prepareCanonical(text);
  assert.equal(prepared.ok, true);
  assert.ok(prepared.details.length <= 4000);
  const node = syntheticNode("p198a_large_v2", { details: prepared.details, editor: prepared.editor });
  resetState(context, [node]);
  const exported = context.buildPocketPayload("2026-09-12T00:00:00.000Z");
  const exportedNode = exported.mainThoughtTree.find((item) => item.id === node.id);
  assert.equal(exportedNode.editor.schema, "pocket.nodeEditor.v2");
  assert.equal(exportedNode.editor.text, text);
  assert.ok((exportedNode.details || "").length <= 4000);
  const reloaded = context.normaliseInput(exported);
  const reloadedNode = reloaded.nodes.find((item) => item.id === node.id);
  assert.equal(reloadedNode.editor.text, text);
  assert.equal(context.PocketNodeContent.readNode(reloadedNode).text, text);
});

test("P198a regression keeps unknown editor payloads opaque, readable and mutation-blocked", () => {
  const context = createFullContractContext();
  const rawEditor = { schema: "pocket.nodeEditor.v99", future: { opaque: true }, padding: "z".repeat(9000) };
  const node = syntheticNode("p198a_unknown", { details: "Readable fallback", editor: rawEditor });
  resetState(context, [node]);
  const payload = editorPayload(context, node);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.text, "Readable fallback");
  assert.deepEqual(plain(lexicalState(context).nodes[0].editor), rawEditor);
  const attempted = { ...payload, text: "must not apply", body: "must not apply" };
  const result = context.PocketNodePopoutEditor.apply(attempted, { returnDetails: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported-editor");
  assert.deepEqual(plain(lexicalState(context).nodes[0].editor), rawEditor);
});

test("P198a regression enforces node revision rejection against the unified canonical document", () => {
  const context = createFullContractContext();
  const prepared = context.PocketNodeContent.prepareCanonical("Original\n  child");
  const node = syntheticNode("p198a_revision", { details: prepared.details, editor: prepared.editor });
  resetState(context, [node]);
  const payload = editorPayload(context, node, { text: "Edited\n  child", body: "Edited\n  child" });
  lexicalState(context).nodes[0].updatedAt = "2026-01-01T00:00:00.001Z";
  const before = plain(lexicalState(context).nodes[0]);
  const result = context.PocketNodePopoutEditor.apply(payload, { returnDetails: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "node-revision-changed");
  assert.deepEqual(plain(lexicalState(context).nodes[0]), before);
});

test("P198a regression proves the active in-page and Phone-owned body surface round-trips more than 4000 canonical characters without truth-file writes", () => {
  class FakeHTMLElement { constructor() { this.hidden=true; this.textContent=""; this.title=""; this.readOnly=false; this.disabled=false; this.classList={add(){},remove(){},toggle(){},contains(){return false;}}; } addEventListener() {} focus() {} select() {} }
  class FakeInput extends FakeHTMLElement { constructor(){ super(); this.value=""; this.checked=false; } }
  class FakeTextArea extends FakeInput {}
  class FakeButton extends FakeHTMLElement {}
  const elements = new Map([["detailOverlay",new FakeHTMLElement()],["detailEditorTitle",new FakeHTMLElement()],["detailEditorPath",new FakeHTMLElement()],["detailEditorLabel",new FakeInput()],["detailEditorBody",new FakeTextArea()],["detailEditorUrgent",new FakeInput()],["detailEditorCopyContext",new FakeInput()],["btnDetailSave",new FakeButton()]]);
  const context = createFullContractContext({ HTMLElement:FakeHTMLElement, HTMLInputElement:FakeInput, HTMLTextAreaElement:FakeTextArea, HTMLButtonElement:FakeButton, document:{ body:{classList:{add(){},remove(){},toggle(){},contains(name){return name === "phoneMode";}}}, activeElement:null, getElementById(id){return elements.get(id)||null;}, addEventListener(){} } });
  context.flashTouchedRow=()=>{}; context.persistPipSnapshot=()=>{}; context.saveLocalSafetySnapshot=()=>{}; context.clearLocalSafetySnapshot=()=>{};
  const original = "Phone canonical start\n" + "P".repeat(5200) + "\n  child";
  const prepared = context.PocketNodeContent.prepareCanonical(original);
  const node = syntheticNode("p198a_phone_long", { label:"Phone long", details:prepared.details, editor:prepared.editor });
  const state = resetState(context,[node]); state.selectedId=node.id;
  context.openDetailsEditorForSelectedNode();
  assert.equal(elements.get("detailEditorBody").value, original);
  const edited = original + "\n    edited descendant";
  elements.get("detailEditorBody").value = edited;
  context.saveDetailsEditor();
  const saved = state.nodes[0];
  assert.equal(saved.editor.schema, "pocket.nodeEditor.v2");
  assert.equal(saved.editor.text, edited);
  assert.ok((saved.details || "").length <= 4000);
  assert.equal(context.__surfaceCalls.exportTree, 0);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
});

test("P198a regression canonical envelope accepts ordinary long v2 text but rejects material above the shared bound", () => {
  const context = createCoreContext();
  const long = "L".repeat(5200) + "\n  child";
  const accepted = context.PocketNodeContent.prepareCanonical(long);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.editor.text, long);
  assert.ok(accepted.details.length <= 4000);
  const over = "x".repeat(context.PocketNodeContent.LIMITS.canonicalBytes + 1);
  assert.equal(context.PocketNodeContent.prepareCanonical(over).ok, false);
});
