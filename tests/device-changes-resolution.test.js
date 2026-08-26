"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEVICE_CHANGES_SOURCE = "js/pocket-device-changes.js";
const NO_BASE_MESSAGE = "Pocket doesn’t have the earlier shared version needed to combine these safely.";
const UNSAFE_COMBINATION_MESSAGE = "Pocket can’t safely combine these versions automatically. You can still use either version or review the differences.";

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate, rounds = 20) {
  for (let index = 0; index < rounds; index += 1) {
    if (predicate()) return true;
    await flushMicrotasks();
  }
  return predicate();
}

function loadDeviceChangesApi() {
  const context = {
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Symbol,
    Object,
    Array,
    Number,
    String,
    Boolean,
    TypeError,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source(DEVICE_CHANGES_SOURCE), context, { filename: DEVICE_CHANGES_SOURCE });
  assert.ok(context.PocketDeviceChanges, "production comparison API must load");
  return { context, api: context.PocketDeviceChanges };
}

function createClassList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(String(name))); },
    remove(...names) { names.forEach((name) => values.delete(String(name))); },
    contains(name) { return values.has(String(name)); },
    toggle(name, force) {
      const next = force === undefined ? !values.has(String(name)) : !!force;
      if (next) values.add(String(name));
      else values.delete(String(name));
      return next;
    },
  };
}

function createDeviceChangesDom() {
  let documentRef = null;

  class UiElement {
    constructor(tagName = "div", id = "") {
      this.tagName = String(tagName).toUpperCase();
      this.id = id;
      this.parentElement = null;
      this.children = [];
      this.hidden = false;
      this.disabled = false;
      this.inert = false;
      this.dataset = {};
      this.className = "";
      this.classList = createClassList();
      this.attributes = new Map();
      this.listeners = new Map();
      this._textContent = "";
    }

    get firstChild() {
      return this.children[0] || null;
    }

    get childNodes() {
      return this.children;
    }

    get textContent() {
      return this._textContent + this.children.map((child) => child.textContent || "").join("");
    }

    set textContent(value) {
      this._textContent = String(value ?? "");
      this.children = [];
    }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentElement = null;
      return child;
    }

    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    }

    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    addEventListener(type, listener) {
      const key = String(type);
      if (!this.listeners.has(key)) this.listeners.set(key, []);
      this.listeners.get(key).push(listener);
    }

    dispatchEvent(event) {
      const value = event || {};
      if (!value.target) value.target = this;
      for (const listener of this.listeners.get(String(value.type || "")) || []) listener(value);
      return !value.defaultPrevented;
    }

    click() {
      if (this.disabled) return;
      this.dispatchEvent({
        type: "click",
        target: this,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
      });
    }

    focus() {
      if (documentRef) documentRef.activeElement = this;
    }

    contains(target) {
      if (target === this) return true;
      return this.children.some((child) => child.contains && child.contains(target));
    }

    querySelectorAll(selector) {
      const descendants = [];
      const visit = (element) => {
        for (const child of element.children || []) {
          descendants.push(child);
          visit(child);
        }
      };
      visit(this);
      if (selector === "button:not([disabled])") {
        return descendants.filter((element) => element.tagName === "BUTTON" && !element.disabled);
      }
      return [];
    }
  }

  class UiButtonElement extends UiElement {
    constructor(id = "") {
      super("button", id);
      this.type = "button";
    }
  }

  class UiInputElement extends UiElement {
    constructor(id = "") {
      super("input", id);
      this.value = "";
    }
  }

  const elements = new Map();
  const listeners = new Map();
  const register = (element) => {
    if (element.id) elements.set(element.id, element);
    return element;
  };
  const element = (tag, id, text = "") => {
    const value = tag === "button" ? new UiButtonElement(id) : new UiElement(tag, id);
    value.textContent = text;
    return register(value);
  };
  const body = element("body", "body");
  const background = element("main", "syntheticPocketSurface");
  background.appendChild(element("button", "btnLoad", "Choose Pocket file"));
  background.appendChild(element("button", "btnExportTree", "save"));
  const permissionOverlay = element("div", "filePermissionOverlay");
  permissionOverlay.hidden = true;
  const permissionCard = element("section", "filePermissionCard");
  permissionCard.setAttribute("role", "dialog");
  permissionCard.setAttribute("aria-modal", "true");
  permissionCard.setAttribute("aria-labelledby", "filePermissionTitle");
  permissionCard.setAttribute(
    "aria-describedby",
    "filePermissionBody filePermissionFileName filePermissionSupport",
  );
  permissionOverlay.appendChild(permissionCard);
  permissionCard.appendChild(element("h2", "filePermissionTitle", "Let Pocket open this file"));
  permissionCard.appendChild(element(
    "p",
    "filePermissionBody",
    "Chrome may ask if Pocket can save changes to the file you just chose.",
  ));
  permissionCard.appendChild(element("span", "filePermissionFileLabel", "File"));
  permissionCard.appendChild(element("strong", "filePermissionFileName", "Selected Pocket file"));
  permissionCard.appendChild(element(
    "p",
    "filePermissionSupport",
    "Pocket will keep your current file open unless the new file opens successfully.",
  ));
  permissionCard.appendChild(element("button", "filePermissionContinue", "Continue"));
  permissionCard.appendChild(element("button", "filePermissionCancel", "Cancel"));
  const overlay = element("div", "deviceChangesOverlay");
  overlay.hidden = true;
  body.appendChild(background);
  body.appendChild(permissionOverlay);
  body.appendChild(overlay);
  const card = element("section", "deviceChangesCard");
  overlay.appendChild(card);

  const title = element("h2", "deviceChangesTitle");
  const intro = element("p", "deviceChangesIntro");
  const identity = element("div", "deviceChangesIdentity");
  identity.appendChild(element("strong", "deviceChangesFileName"));
  identity.appendChild(element("span", "deviceChangesFileTime"));
  identity.appendChild(element("strong", "deviceChangesDeviceTime"));
  identity.appendChild(element("span", "deviceChangesDeviceSource"));
  const notice = element("p", "deviceChangesNotice");
  const decision = element("div", "deviceChangesDecisionView");
  const choices = element("div", "deviceChangesChoices");
  decision.appendChild(choices);
  for (const [id, text] of [
    ["deviceChangesUseFile", "Use the file"],
    ["deviceChangesUseDevice", "Use the device changes"],
    ["deviceChangesCombine", "Combine what can be combined"],
    ["deviceChangesReviewBtn", "Review the differences"],
    ["deviceChangesBack", "Back"],
  ]) {
    const button = element("button", id, text);
    if (id === "deviceChangesBack") button.hidden = true;
    choices.appendChild(button);
  }
  const review = element("section", "deviceChangesReview");
  review.hidden = true;
  review.appendChild(element("div", "deviceChangesReviewList"));
  const choiceView = element("section", "deviceChangesChoiceView");
  choiceView.hidden = true;
  for (const [tag, id] of [
    ["h3", "deviceChangesChoiceTitle"],
    ["p", "deviceChangesChoiceProgress"],
    ["div", "deviceChangesChoicePath"],
    ["div", "deviceChangesChoiceFields"],
    ["pre", "deviceChangesFileValue"],
    ["pre", "deviceChangesDeviceValue"],
    ["div", "deviceChangesChoiceActions"],
  ]) {
    choiceView.appendChild(element(tag, id));
  }
  for (const child of [title, intro, identity, notice, decision, review, choiceView]) card.appendChild(child);

  documentRef = {
    body,
    activeElement: null,
    documentElement: { clientWidth: 1024, clientHeight: 768 },
    readyState: "complete",
    getElementById(id) {
      return elements.get(String(id)) || null;
    },
    querySelector(selector) {
      if (selector === ".topbar") return background;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return String(tagName).toLowerCase() === "button"
        ? new UiButtonElement()
        : new UiElement(tagName);
    },
    addEventListener(type, listener) {
      const key = String(type);
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(listener);
    },
    removeEventListener(type, listener) {
      const values = listeners.get(String(type)) || [];
      const index = values.indexOf(listener);
      if (index >= 0) values.splice(index, 1);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(String(type)) || []) listener(event);
    },
  };

  return {
    document: documentRef,
    HTMLElement: UiElement,
    HTMLInputElement: UiInputElement,
    HTMLButtonElement: UiButtonElement,
    elements,
    background,
    permissionOverlay,
    overlay,
  };
}

function createIntegrationContext(options = {}) {
  const storage = new Map();
  const storageCalls = [];
  const storageAttempts = [];
  const surfaceCalls = {
    picker: 0,
    openPicker: 0,
    popupOpen: 0,
    render: 0,
    refresh: 0,
    persistPip: 0,
    statuses: [],
  };
  const windowListeners = new Map();
  class DefaultElement {}
  class DefaultInputElement extends DefaultElement {}
  class DefaultTextAreaElement extends DefaultInputElement {}
  class DefaultButtonElement extends DefaultElement {}
  const Element = options.HTMLElement || DefaultElement;
  const InputElement = options.HTMLInputElement || DefaultInputElement;
  const TextAreaElement = options.HTMLTextAreaElement || DefaultTextAreaElement;
  const ButtonElement = options.HTMLButtonElement || DefaultButtonElement;
  const defaultBody = {
    classList: createClassList(),
    appendChild() {},
  };
  const defaultDocument = {
    body: defaultBody,
    activeElement: null,
    documentElement: { clientWidth: 1024, clientHeight: 768 },
    readyState: "complete",
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        href: "",
        download: "",
        click() {},
        remove() {},
      };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const document = options.document || defaultDocument;
  const context = {
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Promise,
    Blob,
    structuredClone: globalThis.structuredClone,
    location: { href: options.href || "https://example.test/index.html" },
    document,
    navigator: { clipboard: {} },
    HTMLElement: Element,
    HTMLInputElement: InputElement,
    HTMLTextAreaElement: TextAreaElement,
    HTMLButtonElement: ButtonElement,
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: {
      getItem(key) {
        return storage.has(String(key)) ? storage.get(String(key)) : null;
      },
      setItem(key, value) {
        const safeKey = String(key);
        const safeValue = String(value);
        storageAttempts.push({ key: safeKey, value: safeValue });
        if (typeof options.failStorageWrite === "function"
            && options.failStorageWrite(safeKey, safeValue, storageCalls.length)) {
          throw new Error("synthetic storage quota");
        }
        storage.set(safeKey, safeValue);
        storageCalls.push({ key: safeKey, value: safeValue });
      },
      removeItem(key) {
        storage.delete(String(key));
      },
    },
    setTimeout(callback) {
      if (options.runTimeouts === true && typeof callback === "function") callback();
      return 1;
    },
    clearTimeout() {},
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    cancelAnimationFrame() {},
    addEventListener(type, listener) {
      const key = String(type);
      if (!windowListeners.has(key)) windowListeners.set(key, []);
      windowListeners.get(key).push(listener);
    },
    removeEventListener(type, listener) {
      const listeners = windowListeners.get(String(type)) || [];
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    open() {
      surfaceCalls.popupOpen += 1;
      return null;
    },
    close() {},
    confirm() { return true; },
    alert() {},
    refreshMeta() { surfaceCalls.refresh += 1; },
    renderTree() { surfaceCalls.render += 1; },
    refocusTreeNavigation() {},
    softlyEnsureSelectionVisible() {},
    stopMovePadRepeat() {},
    collapseAllNodes() {},
    expandPathToNode() {},
    focusRowByNodeId() {},
    setStatus(message, kind, statusOptions) {
      surfaceCalls.statuses.push({
        message: String(message || ""),
        kind: String(kind || ""),
        options: statusOptions || null,
      });
    },
    flashSaveChip() {},
    persistPipSnapshot() { surfaceCalls.persistPip += 1; },
    URL: {
      ...URL,
      createObjectURL() { return "blob:synthetic"; },
      revokeObjectURL() {},
    },
    async showOpenFilePicker() {
      surfaceCalls.openPicker += 1;
      if (typeof options.pickOpenHandles === "function") {
        return options.pickOpenHandles(surfaceCalls.openPicker);
      }
      throw new Error("unexpected open picker");
    },
    async showSaveFilePicker() {
      surfaceCalls.picker += 1;
      if (typeof options.pickSaveHandle === "function") return options.pickSaveHandle(surfaceCalls.picker);
      throw Object.assign(new Error("synthetic cancellation"), { name: "AbortError" });
    },
    __storage: storage,
    __storageCalls: storageCalls,
    __storageAttempts: storageAttempts,
    __surfaceCalls: surfaceCalls,
    __windowListeners: windowListeners,
  };
  // URL must remain constructible for pocket-state.js while exposing Blob helpers.
  context.URL = URL;
  context.URL.createObjectURL = () => "blob:synthetic";
  context.URL.revokeObjectURL = () => {};
  context.window = context;
  context.globalThis = context;
  context.parent = options.parent || context;
  vm.createContext(context);

  for (const relativePath of [
    "js/pocket-state.js",
    "js/pocket-data.js",
    "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js",
    "js/pocket-import.js",
    "js/pocket-editor-copy.js",
    "js/pocket-history-status.js",
    "js/pocket-io-browser.js",
    DEVICE_CHANGES_SOURCE,
    "js/pocket-owner-save-boundary.js",
    "js/pocket-node-popout-model.js",
    "js/pocket-node-popout-target.js",
    "js/pocket-node-popout-editor.js",
  ]) {
    vm.runInContext(source(relativePath), context, { filename: relativePath });
  }
  context.__productionRefreshMeta = context.refreshMeta;
  context.refreshMeta = () => { surfaceCalls.refresh += 1; };
  context.renderTree = () => { surfaceCalls.render += 1; };
  context.refocusTreeNavigation = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  context.persistPipSnapshot = () => { surfaceCalls.persistPip += 1; };
  context.setStatus = (message, kind, statusOptions) => {
    surfaceCalls.statuses.push({
      message: String(message || ""),
      kind: String(kind || ""),
      options: statusOptions || null,
    });
  };
  return context;
}

function lexicalState(context) {
  return vm.runInContext("state", context);
}

function createUiIntegrationContext(options = {}) {
  const ui = createDeviceChangesDom();
  const context = createIntegrationContext({
    ...options,
    document: ui.document,
    HTMLElement: ui.HTMLElement,
    HTMLInputElement: ui.HTMLInputElement,
    HTMLButtonElement: ui.HTMLButtonElement,
  });
  context.__ui = ui;
  context.__dispatchWindowKey = (keyOptions = {}) => {
    const event = {
      key: "",
      target: ui.document.activeElement,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      immediateStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediateStopped = true; },
      ...keyOptions,
    };
    for (const listener of context.__windowListeners.get("keydown") || []) listener(event);
    return event;
  };
  return context;
}

function resetIntegrationState(context, nodes, ops = []) {
  const state = lexicalState(context);
  state.nodes = plain(nodes);
  state.tombstones = [];
  state.rootExtras = {};
  state.dataExtras = {};
  state.selectedId = nodes[0]?.id || "";
  state.focusRootId = "";
  state.collapsed = new Set();
  state.ops = plain(ops);
  state.source = {
    schema: "portal.export.v1",
    fileName: "synthetic.json",
    writtenAt: "2026-07-01T00:00:00.000Z",
  };
  state.documentBaseline = null;
  state.detachedSafetyBase = null;
  state.operationHighWater = 0;
  state.operationDocumentAnchor = null;
  state.activeSaveOperationCeiling = 0;
  return state;
}

function installDetailsEditorHarness(context, nodeId, options = {}) {
  const state = lexicalState(context);
  const current = state.nodes.find((item) => item.id === nodeId);
  assert.ok(current, `details node ${nodeId} must exist`);
  const overlay = new context.HTMLElement();
  const label = new context.HTMLInputElement();
  const body = new context.HTMLTextAreaElement();
  const urgent = new context.HTMLInputElement();
  const copyContext = new context.HTMLInputElement();
  overlay.hidden = false;
  label.value = options.label ?? current.label;
  body.value = options.body ?? current.details ?? "";
  urgent.checked = !!options.urgent;
  copyContext.checked = !!options.copyContext;
  for (const control of [label, body, urgent, copyContext]) {
    control.focus = () => {};
    control.select = () => {};
  }
  context.__detailsHarness = { overlay, label, body, urgent, copyContext };
  vm.runInContext(`
    el.detailOverlay = __detailsHarness.overlay;
    el.detailEditorLabel = __detailsHarness.label;
    el.detailEditorBody = __detailsHarness.body;
    el.detailEditorUrgent = __detailsHarness.urgent;
    el.detailEditorCopyContext = __detailsHarness.copyContext;
  `, context);
  state.detailsEdit = {
    id: nodeId,
    originalLabel: current.label,
    originalDetails: current.details || "",
    originalUrgent: !!current.urgent,
    originalCopyContext: !!current.copyContext,
    draftOpRecorded: false,
    draftOperationSequence: 0,
    draftHadCoveredSave: false,
    opsStartLength: state.ops.length,
  };
  return context.__detailsHarness;
}

function safetySnapshotFor(context, deviceDocument, options = {}) {
  const capturedAt = options.capturedAt || "2026-07-20T12:00:00.000Z";
  const payload = payloadFromDocument(deviceDocument, capturedAt);
  const norm = context.normaliseInput(payload);
  const snapshot = {
    parsed: {
      schema: "pocket.localSafety.v1",
      capturedAt,
      reason: "change",
      source: {
        schema: "portal.export.v1",
        fileName: options.sourceFileName || "device-source.json",
        writtenAt: options.sourceWrittenAt || "2026-07-01T00:00:00.000Z",
      },
      selectedId: deviceDocument.nodes[0]?.id || "",
      collapsedIds: [],
      ops: options.ops || [{ type: "device-edit", at: capturedAt }],
      payload,
    },
    norm,
    capturedAt,
    capturedMs: Date.parse(capturedAt),
    base: null,
  };
  if (options.base) {
    const basePayload = payloadFromDocument(options.base, options.baseWrittenAt || "2026-07-01T00:00:00.000Z");
    const baseNorm = context.normaliseInput(basePayload);
    const normalisedBase = {
      nodes: baseNorm.nodes,
      tombstones: baseNorm.tombstones,
      rootExtras: baseNorm.rootExtras,
      dataExtras: baseNorm.dataExtras,
    };
    snapshot.base = {
      payload: normalisedBase,
      fingerprint: context.PocketDeviceChanges.fingerprintDocument(normalisedBase),
      source: {
        schema: "portal.export.v1",
        fileName: options.baseSourceFileName || options.sourceFileName || "device-source.json",
        writtenAt: options.baseWrittenAt || "2026-07-01T00:00:00.000Z",
      },
    };
    snapshot.parsed.base = plain(snapshot.base);
  }
  return snapshot;
}

function fakeHandle(name, options = {}) {
  const calls = {
    getFile: 0,
    queryPermission: 0,
    requestPermission: 0,
    createWritable: 0,
    write: 0,
    close: 0,
    abort: 0,
    text: [],
  };
  return {
    name,
    calls,
    async getFile() {
      calls.getFile += 1;
      if (typeof options.getFile === "function") return options.getFile(calls);
      if (options.file) return options.file;
      throw new Error("synthetic handle has no readable file");
    },
    async queryPermission() {
      calls.queryPermission += 1;
      if (typeof options.queryPermission === "function") {
        return options.queryPermission(calls);
      }
      return options.queryPermission || "granted";
    },
    async requestPermission() {
      calls.requestPermission += 1;
      if (typeof options.requestPermission === "function") {
        return options.requestPermission(calls);
      }
      return options.requestPermission || "granted";
    },
    async createWritable() {
      calls.createWritable += 1;
      return {
        async write(text) {
          calls.write += 1;
          calls.text.push(String(text));
          if (typeof options.onWrite === "function") await options.onWrite(String(text), calls);
        },
        async close() {
          calls.close += 1;
          if (typeof options.onClose === "function") await options.onClose(calls);
        },
        async abort() {
          calls.abort += 1;
          if (typeof options.onAbort === "function") await options.onAbort(calls);
        },
      };
    },
  };
}

function node(id, overrides = {}) {
  return {
    id,
    parentId: "root",
    label: `Item ${id}`,
    details: `Notes ${id}`,
    order: 1000,
    updatedAt: "2026-07-01T00:00:00.000Z",
    source: "synthetic",
    ...overrides,
  };
}

function documentWith(nodes, overrides = {}) {
  return {
    nodes,
    tombstones: [],
    rootExtras: {},
    dataExtras: {},
    ...overrides,
  };
}

function payloadFromDocument(documentValue, writtenAt = "2026-07-01T00:00:00.000Z") {
  const value = plain(documentValue);
  return {
    ...(value.rootExtras || {}),
    schema: "portal.export.v1",
    exportedAt: writtenAt,
    writtenAt,
    mainThoughtTree: value.nodes || [],
    mainThoughtTreeTombstones: value.tombstones || [],
    data: {
      ...(value.dataExtras || {}),
      mainThoughtTree: value.nodes || [],
      mainThoughtTreeTombstones: value.tombstones || [],
    },
  };
}

function byId(documentValue) {
  return new Map(documentValue.nodes.map((item) => [item.id, item]));
}

function planFor(api, base, file, device) {
  const storedBaseFingerprint = api.fingerprintDocument(base);
  assert.ok(storedBaseFingerprint);
  const result = api.planCombination({ base, file, device, storedBaseFingerprint });
  assert.equal(result.ok, true, result.reason || "combination plan should be available");
  return result;
}

test("meaningful comparison ignores transport timestamps, guards, object key order, node updatedAt, and retired pe only", () => {
  const { api } = loadDeviceChangesApi();
  const editor = {
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [{ id: "row_a", text: "Outline", depth: 0, collapsed: false, order: 1 }],
  };
  const left = {
    schema: "portal.export.v1",
    exportedAt: "2026-07-01T00:00:00.000Z",
    writtenAt: "2026-07-01T00:00:00.000Z",
    pocketGuard: { instanceId: "left", backupWrittenAt: "2026-07-01T00:00:00.000Z" },
    customRoot: { b: 2, a: 1 },
    mainThoughtTree: [node("same", {
      editor,
      updatedAt: "2026-07-01T00:00:00.000Z",
      pe: { retired: "left" },
      customNode: { beta: 2, alpha: 1 },
    })],
    mainThoughtTreeTombstones: [{ id: "gone", deletedAt: "2026-06-01T00:00:00.000Z" }],
    data: {
      pocketGuard: { instanceId: "left" },
      customData: { z: true, a: false },
      mainThoughtTree: [node("same", { editor })],
      mainThoughtTreeTombstones: [{ id: "gone", deletedAt: "2026-06-01T00:00:00.000Z" }],
    },
  };
  const right = {
    writtenAt: "2026-07-24T12:00:00.000Z",
    exportedAt: "2026-07-24T12:00:00.000Z",
    schema: "portal.export.v1",
    customRoot: { a: 1, b: 2 },
    pocketGuard: { instanceId: "right", backupWrittenAt: "2026-07-24T12:00:00.000Z" },
    mainThoughtTree: [node("same", {
      customNode: { alpha: 1, beta: 2 },
      pe: { retired: "right" },
      updatedAt: "2026-07-23T00:00:00.000Z",
      editor: {
        outline: [{ collapsed: false, depth: 0, text: "Outline", id: "row_a", order: 1 }],
        mode: "outline",
        schema: "pocket.nodeEditor.v1",
      },
    })],
    mainThoughtTreeTombstones: [{ deletedAt: "2026-06-01T00:00:00.000Z", id: "gone" }],
    data: {
      customData: { a: false, z: true },
      pocketGuard: { instanceId: "right" },
      mainThoughtTree: [],
      mainThoughtTreeTombstones: [],
    },
  };

  assert.equal(api.documentsEqual(left, right), true);
  assert.equal(api.fingerprintDocument(left), api.fingerprintDocument(right));

  const notesChanged = plain(right);
  notesChanged.mainThoughtTree[0].details = "Meaningfully different Notes";
  assert.equal(api.documentsEqual(left, notesChanged), false);

  const editorChanged = plain(right);
  editorChanged.mainThoughtTree[0].editor.outline[0].text = "Meaningfully different Outline";
  assert.equal(api.documentsEqual(left, editorChanged), false);

  const extraChanged = plain(right);
  extraChanged.mainThoughtTree[0].customNode.alpha = 9;
  assert.equal(api.documentsEqual(left, extraChanged), false);
});

test("direct review compares two versions without pretending an unavailable BASE exists", () => {
  const { api } = loadDeviceChangesApi();
  const file = documentWith([
    node("shared", { label: "File title" }),
    node("file_only", { label: "Only file" }),
  ]);
  const device = documentWith([
    node("shared", { label: "Device title" }),
    node("device_only", { label: "Only device" }),
  ]);
  const review = plain(api.buildReview({ file, device }));

  assert.equal(review.ok, true);
  assert.equal(review.mode, "two-version");
  assert.equal(review.combineAvailable, false);
  assert.equal(review.combineMessage, NO_BASE_MESSAGE);
  assert.deepEqual(review.groups.map((group) => group.title), ["Differences between the file and device changes"]);
  assert.deepEqual(
    review.groups[0].items.map((item) => item.nodeId).sort(),
    ["device_only", "file_only", "shared"],
  );
});

test("combination eligibility requires a valid matching BASE, credible ancestry, and structurally safe inputs", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([node("anchor")]);
  const file = documentWith([node("anchor", { label: "File label" })]);
  const device = documentWith([node("anchor", { details: "Device Notes" })]);
  const fingerprint = api.fingerprintDocument(base);

  assert.deepEqual(
    plain(api.assessCombinationEligibility({ file, device })),
    { eligible: false, reason: "missing-base", message: NO_BASE_MESSAGE },
  );
  assert.equal(api.assessCombinationEligibility({
    base,
    file,
    device,
    storedBaseFingerprint: `${fingerprint}-wrong`,
  }).reason, "base-fingerprint-mismatch");
  assert.equal(api.assessCombinationEligibility({
    base,
    file: documentWith([node("unrelated_file")]),
    device: documentWith([node("unrelated_device")]),
    storedBaseFingerprint: fingerprint,
  }).reason, "uncertain-ancestry");
  assert.equal(api.assessCombinationEligibility({
    base,
    file,
    device,
    storedBaseFingerprint: fingerprint,
  }).eligible, true);

  const unsafeDevice = documentWith([
    node("anchor"),
    node("orphan", { parentId: "missing" }),
  ]);
  const unsafe = api.assessCombinationEligibility({
    base,
    file,
    device: unsafeDevice,
    storedBaseFingerprint: fingerprint,
  });
  assert.equal(unsafe.eligible, false);
  assert.equal(unsafe.reason, "unsafe-input");
  assert.ok(plain(unsafe.errors.device).includes("orphan-node"));
});

test("three-way combination merges independent node fields, additions, deletions, metadata, and tombstones", () => {
  const { api } = loadDeviceChangesApi();
  const originalOutline = {
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [{ id: "base_row", text: "Base Outline", depth: 0, collapsed: false, order: 1 }],
  };
  const deviceOutline = {
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [{ id: "device_row", text: "Device Outline", depth: 0, collapsed: true, order: 1 }],
  };
  const base = documentWith([
    node("parent_a", { label: "Parent A", details: "" }),
    node("parent_b", { label: "Parent B", details: "" }),
    node("independent", { label: "Base title", details: "Base Notes", editor: originalOutline }),
    node("move_notes", { parentId: "parent_a", label: "Move and Notes", details: "Base move Notes" }),
    node("delete_file", { label: "Delete in file" }),
    node("delete_device", { label: "Delete on device" }),
    node("identical", { label: "Base identical" }),
  ], {
    rootExtras: { shared: "base", fileKey: "base", deviceKey: "base" },
    dataExtras: { fileData: "base", deviceData: "base" },
    tombstones: [{ id: "old", deletedAt: "2026-06-01T00:00:00.000Z" }],
  });
  const file = plain(base);
  const device = plain(base);

  byId(file).get("independent").label = "File title";
  byId(device).get("independent").details = "Device Notes";
  byId(device).get("independent").editor = deviceOutline;
  byId(file).get("move_notes").parentId = "parent_b";
  byId(device).get("move_notes").details = "Device move Notes";
  file.nodes = file.nodes.filter((item) => item.id !== "delete_file");
  device.nodes = device.nodes.filter((item) => item.id !== "delete_device");
  byId(file).get("identical").label = "Same new title";
  byId(device).get("identical").label = "Same new title";
  file.nodes.push(node("file_added", { label: "File addition" }));
  device.nodes.push(node("device_added", { label: "Device addition" }));
  file.nodes.push(node("same_added", { label: "Same addition" }));
  device.nodes.push(node("same_added", { label: "Same addition", updatedAt: "2026-07-22T00:00:00.000Z" }));
  file.rootExtras.fileKey = "file";
  device.rootExtras.deviceKey = "device";
  file.dataExtras.fileData = "file";
  device.dataExtras.deviceData = "device";
  file.tombstones.push({ id: "file_deleted", deletedAt: "2026-07-02T00:00:00.000Z" });
  device.tombstones.push({ id: "device_deleted", deletedAt: "2026-07-03T00:00:00.000Z" });

  const planned = planFor(api, base, file, device);
  assert.equal(planned.unresolvedCount, 0);
  const finalised = plain(api.finaliseCombination(planned.plan));
  assert.equal(finalised.ok, true, JSON.stringify(finalised));
  const merged = byId(finalised.document);

  assert.equal(merged.get("independent").label, "File title");
  assert.equal(merged.get("independent").details, "Device Notes");
  assert.deepEqual(merged.get("independent").editor, deviceOutline);
  assert.equal(merged.get("move_notes").parentId, "parent_b");
  assert.equal(merged.get("move_notes").details, "Device move Notes");
  assert.equal(merged.has("delete_file"), false);
  assert.equal(merged.has("delete_device"), false);
  assert.equal(merged.get("identical").label, "Same new title");
  assert.equal(merged.get("file_added").label, "File addition");
  assert.equal(merged.get("device_added").label, "Device addition");
  assert.equal(Array.from(merged.keys()).filter((id) => id === "same_added").length, 1);
  assert.equal(finalised.document.rootExtras.fileKey, "file");
  assert.equal(finalised.document.rootExtras.deviceKey, "device");
  assert.equal(finalised.document.dataExtras.fileData, "file");
  assert.equal(finalised.document.dataExtras.deviceData, "device");
  assert.deepEqual(
    finalised.document.tombstones.map((item) => item.id).sort(),
    ["device_deleted", "file_deleted", "old"],
  );
});

test("three-way combination reports exact choices for divergent fields, parents, additions, deletion edits, and metadata", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("anchor"),
    node("parent_a", { label: "Parent A" }),
    node("parent_b", { label: "Parent B" }),
    node("field_conflict", { label: "Base" }),
    node("move_conflict", { parentId: "root", label: "Move conflict" }),
    node("delete_edit", { label: "Delete edit", details: "Base" }),
  ], {
    rootExtras: { sharedMeta: "base" },
    dataExtras: { sharedData: "base" },
  });
  const file = plain(base);
  const device = plain(base);
  byId(file).get("field_conflict").label = "File value";
  byId(device).get("field_conflict").label = "Device value";
  byId(file).get("move_conflict").parentId = "parent_a";
  byId(device).get("move_conflict").parentId = "parent_b";
  file.nodes = file.nodes.filter((item) => item.id !== "delete_edit");
  byId(device).get("delete_edit").details = "Edited while file deleted";
  file.nodes.push(node("same_id_add", { label: "File addition" }));
  device.nodes.push(node("same_id_add", { label: "Device addition" }));
  file.rootExtras.sharedMeta = "file";
  device.rootExtras.sharedMeta = "device";
  file.dataExtras.sharedData = "file";
  device.dataExtras.sharedData = "device";

  const planned = planFor(api, base, file, device);
  const choices = plain(planned.plan.choices);
  const deleteChoice = choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "delete_edit");
  assert.equal(planned.unresolvedCount, 6);
  assert.ok(choices.some((choice) =>
    choice.kind === "node-fields"
    && choice.nodeId === "field_conflict"
    && choice.fields.includes("label")
    && choice.options.includes("keep-both")));
  assert.ok(choices.some((choice) =>
    choice.kind === "node-fields"
    && choice.nodeId === "move_conflict"
    && choice.fields.includes("parentId")));
  assert.ok(deleteChoice);
  assert.deepEqual(deleteChoice.options, ["keep-item", "leave-removed"]);
  assert.ok(choices.some((choice) => choice.kind === "concurrent-add" && choice.nodeId === "same_id_add"));
  assert.ok(choices.some((choice) => choice.kind === "metadata" && choice.scope === "rootExtras" && choice.key === "sharedMeta"));
  assert.ok(choices.some((choice) => choice.kind === "metadata" && choice.scope === "dataExtras" && choice.key === "sharedData"));

  const incomplete = api.finaliseCombination(planned.plan);
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.reason, "choices-required");
  assert.equal(incomplete.unresolvedCount, 6);
});

test("file/device choices retain the selected values and delete-versus-edit offers no Keep both", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("anchor"),
    node("anchor_two"),
    node("choose", { label: "Base label" }),
    node("delete_edit", { details: "Base Notes" }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("choose").label = "File label";
  byId(device).get("choose").label = "Device label";
  file.nodes = file.nodes.filter((item) => item.id !== "delete_edit");
  file.tombstones.push({ id: "delete_edit", deletedAt: "2026-07-04T00:00:00.000Z" });
  byId(device).get("delete_edit").details = "Device kept Notes";

  const planned = planFor(api, base, file, device);
  const choose = planned.plan.choices.find((choice) => choice.nodeId === "choose");
  const deletion = planned.plan.choices.find((choice) => choice.nodeId === "delete_edit");
  assert.deepEqual(plain(deletion.options), ["keep-item", "leave-removed"]);
  assert.equal(deletion.options.includes("keep-both"), false);

  assert.equal(api.resolveChoice(planned.plan, choose.id, "device").ok, true);
  assert.equal(api.resolveChoice(planned.plan, deletion.id, "keep-item").ok, true);
  const finalised = plain(api.finaliseCombination(planned.plan));
  assert.equal(finalised.ok, true);
  assert.equal(byId(finalised.document).get("choose").label, "Device label");
  assert.equal(byId(finalised.document).get("delete_edit").details, "Device kept Notes");
  assert.equal(finalised.document.tombstones.some((item) => item.id === "delete_edit"), false);

  const removedPlan = planFor(api, base, file, device);
  const removedChoose = removedPlan.plan.choices.find((choice) => choice.nodeId === "choose");
  const removedDeletion = removedPlan.plan.choices.find((choice) => choice.nodeId === "delete_edit");
  assert.equal(api.resolveChoice(removedPlan.plan, removedChoose.id, "file").ok, true);
  assert.equal(api.resolveChoice(removedPlan.plan, removedDeletion.id, "leave-removed").ok, true);
  const removed = plain(api.finaliseCombination(removedPlan.plan));
  assert.equal(removed.ok, true);
  assert.equal(byId(removed.document).get("choose").label, "File label");
  assert.equal(byId(removed.document).has("delete_edit"), false);
  assert.equal(removed.document.tombstones.some((item) => item.id === "delete_edit"), true);
});

test("Keep both duplicates the device subtree once with fresh IDs, remapped parents, adjacent order, Notes, Outline, and extras", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("anchor", { order: 1 }),
    node("branch", { label: "Same branch", details: "Base branch", order: 10 }),
    node("child", { parentId: "branch", label: "Child", details: "Base child", order: 1 }),
    node("grandchild", { parentId: "child", label: "Grandchild", details: "Base grandchild", order: 1 }),
    node("after", { label: "After", order: 11 }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("branch").details = "File branch";
  byId(device).get("branch").details = "Device branch";
  byId(file).get("child").details = "File child";
  Object.assign(byId(device).get("child"), {
    details: "Device child",
    editor: {
      schema: "pocket.nodeEditor.v1",
      mode: "outline",
      outline: [{ id: "keep_both_row", text: "Device Outline", depth: 0, collapsed: true, order: 1 }],
    },
    deviceExtra: { preserve: true },
  });
  byId(file).get("grandchild").details = "File grandchild";
  byId(device).get("grandchild").details = "Device grandchild";

  const planned = planFor(api, base, file, device);
  assert.equal(planned.unresolvedCount, 3);
  const rootChoice = planned.plan.choices.find((choice) => choice.nodeId === "branch");
  const kept = api.resolveChoice(planned.plan, rootChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `fresh_${sourceId}`;
    },
  });
  assert.equal(kept.ok, true);
  assert.equal(kept.unresolvedCount, 0);
  assert.equal(api.unresolvedChoices(planned.plan).length, 0);
  assert.match(
    planned.plan.choices.find((choice) => choice.nodeId === "child").resolution,
    /^covered-by-keep-both:/,
  );

  const finalised = plain(api.finaliseCombination(planned.plan));
  assert.equal(finalised.ok, true);
  const merged = byId(finalised.document);
  assert.equal(merged.get("branch").details, "File branch");
  assert.equal(merged.get("fresh_branch").details, "Device branch");
  assert.equal(merged.get("fresh_branch").label, "Same branch (device version)");
  assert.equal(merged.get("fresh_branch").parentId, "root");
  assert.equal(merged.get("fresh_branch").order, 11);
  assert.equal(merged.get("after").order, 12);
  assert.equal(merged.get("fresh_child").parentId, "fresh_branch");
  assert.equal(merged.get("fresh_grandchild").parentId, "fresh_child");
  assert.equal(merged.get("fresh_child").details, "Device child");
  assert.equal(merged.get("fresh_child").editor.outline[0].text, "Device Outline");
  assert.deepEqual(merged.get("fresh_child").deviceExtra, { preserve: true });
  assert.equal(finalised.document.nodes.length, base.nodes.length + 3);
  assert.equal(new Set(finalised.document.nodes.map((item) => item.id)).size, finalised.document.nodes.length);
});

test("Keep both preserves the FILE branch and duplicates a DEVICE child moved outside that branch", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("p", { label: "Parent", order: 1 }),
    node("c", { parentId: "p", label: "Child", details: "Child Notes", order: 1 }),
    node("q", { label: "Other parent", order: 2 }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("p").label = "File parent";
  byId(device).get("p").label = "Device parent";
  byId(device).get("c").parentId = "q";

  const planned = planFor(api, base, file, device);
  const parentChoice = planned.plan.choices.find((choice) =>
    choice.nodeId === "p" && choice.fields.includes("label"));
  assert.ok(parentChoice);
  const resolved = api.resolveChoice(planned.plan, parentChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `fresh_${sourceId}`;
    },
  });
  assert.equal(resolved.ok, true);
  const finalised = plain(api.finaliseCombination(planned.plan));
  assert.equal(finalised.ok, true, JSON.stringify(finalised));
  const merged = byId(finalised.document);

  assert.equal(merged.get("p").label, "File parent");
  assert.equal(merged.get("c").parentId, "p");
  assert.equal(merged.get("c").details, "Child Notes");
  assert.equal(merged.get("fresh_p").label, "Device parent");
  assert.equal(merged.get("fresh_c").parentId, "q");
  assert.equal(merged.get("fresh_c").details, "Child Notes");
  assert.equal(finalised.document.nodes.length, 5);
  assert.equal(new Set(finalised.document.nodes.map((item) => item.id)).size, 5);
});

test("keeping an edited child after FILE deletes its subtree restores the required live ancestor chain", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("p", { label: "Parent", order: 1 }),
    node("c", { parentId: "p", label: "Child", details: "Base Notes", order: 1 }),
  ]);
  const file = documentWith([], {
    tombstones: [
      { id: "p", deletedAt: "2026-07-20T00:00:00.000Z" },
      { id: "c", deletedAt: "2026-07-20T00:00:01.000Z" },
    ],
  });
  const device = plain(base);
  byId(device).get("c").details = "Device edited Notes";

  const planned = planFor(api, base, file, device);
  const childChoice = planned.plan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "c");
  assert.ok(childChoice);
  assert.equal(api.resolveChoice(planned.plan, childChoice.id, "keep-item").ok, true);
  const finalised = plain(api.finaliseCombination(planned.plan));
  assert.equal(finalised.ok, true, JSON.stringify(finalised));
  const merged = byId(finalised.document);

  assert.equal(merged.get("p").label, "Parent");
  assert.equal(merged.get("c").parentId, "p");
  assert.equal(merged.get("c").details, "Device edited Notes");
  assert.equal(finalised.document.tombstones.some((item) => item.id === "p"), false);
  assert.equal(finalised.document.tombstones.some((item) => item.id === "c"), false);
  assert.equal(new Set(finalised.document.nodes.map((item) => item.id)).size, 2);
});

test("delete-versus-edit choices keep parent and descendant decisions consistent in either resolution order", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("p", { label: "Parent", details: "Base parent", order: 1 }),
    node("c", { parentId: "p", label: "Child", details: "Base child", order: 1 }),
  ]);
  const file = documentWith([], {
    tombstones: [
      { id: "p", deletedAt: "2026-07-20T00:00:00.000Z" },
      { id: "c", deletedAt: "2026-07-20T00:00:01.000Z" },
    ],
  });
  const device = plain(base);
  byId(device).get("p").details = "Device parent";
  byId(device).get("c").details = "Device child";

  const removedPlan = planFor(api, base, file, device).plan;
  const removedChoices = removedPlan.choices.filter((choice) =>
    choice.kind === "delete-versus-edit");
  assert.deepEqual(plain(removedChoices.map((choice) => choice.nodeId)), ["p", "c"],
    "the UI must ask about the ancestor before its descendant");
  const [removedParent, removedChild] = removedChoices;

  const prematureChild = plain(api.resolveChoice(removedPlan, removedChild.id, "keep-item"));
  assert.equal(prematureChild.ok, false);
  assert.equal(prematureChild.reason, "ancestor-choice-required");
  assert.equal(removedParent.resolution, "");
  assert.equal(removedChild.resolution, "");

  assert.equal(api.resolveChoice(removedPlan, removedParent.id, "leave-removed").ok, true);
  assert.equal(removedChild.resolution, "covered-by-removed-ancestor:p");
  const contradictoryKeep = plain(api.resolveChoice(removedPlan, removedChild.id, "keep-item"));
  assert.equal(contradictoryKeep.ok, false);
  assert.equal(contradictoryKeep.reason, "choice-already-resolved");
  const removed = plain(api.finaliseCombination(removedPlan));
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(removed.document.nodes, []);

  const keptPlan = planFor(api, base, file, device).plan;
  const keptParent = keptPlan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "p");
  const keptChild = keptPlan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "c");
  assert.equal(api.resolveChoice(keptPlan, keptParent.id, "keep-item").ok, true);
  assert.equal(api.resolveChoice(keptPlan, keptChild.id, "keep-item").ok, true);
  const kept = plain(api.finaliseCombination(keptPlan));
  assert.equal(kept.ok, true, JSON.stringify(kept));
  assert.equal(byId(kept.document).get("p").details, "Device parent");
  assert.equal(byId(kept.document).get("c").details, "Device child");

  const interleavedBase = documentWith([
    node("z_parent", { label: "Parent", details: "Base parent", order: 1 }),
    node("a_child", { parentId: "z_parent", label: "Child", details: "Base child", order: 1 }),
    node("b_other", { label: "Other", details: "Base other", order: 2 }),
  ]);
  const interleavedFile = documentWith([
    node("b_other", { label: "Other", details: "File other", order: 2 }),
  ], {
    tombstones: [
      { id: "z_parent", deletedAt: "2026-07-20T00:00:00.000Z" },
      { id: "a_child", deletedAt: "2026-07-20T00:00:01.000Z" },
    ],
  });
  const interleavedDevice = plain(interleavedBase);
  byId(interleavedDevice).get("z_parent").details = "Device parent";
  byId(interleavedDevice).get("a_child").details = "Device child";
  byId(interleavedDevice).get("b_other").details = "Device other";
  const interleavedPlan = planFor(api, interleavedBase, interleavedFile, interleavedDevice).plan;
  assert.deepEqual(
    plain(interleavedPlan.choices.map((choice) => [choice.kind, choice.nodeId])),
    [
      ["delete-versus-edit", "z_parent"],
      ["delete-versus-edit", "a_child"],
      ["node-fields", "b_other"],
    ],
    "an unrelated choice must not break ancestor-first delete-choice ordering"
  );

  const movedBase = documentWith([
    node("move_parent", { label: "Parent", details: "Base parent", order: 1 }),
    node("move_child", { parentId: "move_parent", label: "Child", order: 1 }),
    node("move_target", { label: "Target", order: 2 }),
  ]);
  const movedFile = documentWith([
    node("move_child", { parentId: "move_target", label: "Child", order: 1 }),
    node("move_target", { label: "Target", order: 2 }),
  ], {
    tombstones: [
      { id: "move_parent", deletedAt: "2026-07-20T00:00:00.000Z" },
    ],
  });
  const movedDevice = plain(movedBase);
  byId(movedDevice).get("move_parent").details = "Device parent";
  const movedPlan = planFor(api, movedBase, movedFile, movedDevice).plan;
  const movedParentChoice = movedPlan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "move_parent");
  assert.ok(movedParentChoice);
  assert.equal(api.resolveChoice(movedPlan, movedParentChoice.id, "leave-removed").ok, true);
  const movedFinal = plain(api.finaliseCombination(movedPlan));
  assert.equal(movedFinal.ok, true, JSON.stringify(movedFinal));
  assert.equal(byId(movedFinal.document).has("move_parent"), false);
  assert.equal(byId(movedFinal.document).get("move_child").parentId, "move_target",
    "leaving the parent removed must preserve the deleting side’s independent child move");

  const movedInBase = documentWith([
    node("removed_parent", { label: "Parent", details: "Base parent", order: 1 }),
    node("moved_in_child", { label: "Child", details: "Base child", order: 2 }),
  ]);
  const movedInFile = documentWith([
    node("moved_in_child", { label: "Child", details: "Base child", order: 2 }),
  ], {
    tombstones: [
      { id: "removed_parent", deletedAt: "2026-07-20T00:00:00.000Z" },
    ],
  });
  const movedInDevice = plain(movedInBase);
  byId(movedInDevice).get("removed_parent").details = "Device parent";
  byId(movedInDevice).get("moved_in_child").parentId = "removed_parent";
  byId(movedInDevice).get("moved_in_child").order = 1;
  byId(movedInDevice).get("moved_in_child").details = "Device Notes";
  const movedInPlan = planFor(api, movedInBase, movedInFile, movedInDevice).plan;
  const removedParentChoice = movedInPlan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "removed_parent");
  assert.ok(removedParentChoice);
  assert.equal(api.resolveChoice(movedInPlan, removedParentChoice.id, "leave-removed").ok, true);
  const movedInFinal = plain(api.finaliseCombination(movedInPlan));
  assert.equal(movedInFinal.ok, true, JSON.stringify(movedInFinal));
  const preservedChild = byId(movedInFinal.document).get("moved_in_child");
  assert.equal(byId(movedInFinal.document).has("removed_parent"), false);
  assert.equal(preservedChild.parentId, "root",
    "the retained child must return to the deleting side’s safe location");
  assert.equal(preservedChild.order, 2);
  assert.equal(preservedChild.details, "Device Notes",
    "independently merged Notes must survive the structural fallback");

  const addedBase = documentWith([
    node("added_parent", { label: "Parent", details: "Base parent", order: 1 }),
    node("added_target", { label: "Target", order: 2 }),
  ]);
  const addedFile = documentWith([
    node("added_target", { label: "Target", order: 2 }),
    node("same_added", { parentId: "added_target", label: "Added", details: "File Notes", order: 1 }),
  ], {
    tombstones: [
      { id: "added_parent", deletedAt: "2026-07-20T00:00:00.000Z" },
    ],
  });
  const addedDevice = plain(addedBase);
  byId(addedDevice).get("added_parent").details = "Device parent";
  addedDevice.nodes.push(node("same_added", {
    parentId: "added_parent",
    label: "Added",
    details: "Device Notes",
    order: 1,
  }));
  const addedPlan = planFor(api, addedBase, addedFile, addedDevice).plan;
  const addedParentChoice = addedPlan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "added_parent");
  const addedChildChoice = addedPlan.choices.find((choice) =>
    choice.kind === "concurrent-add" && choice.nodeId === "same_added");
  assert.ok(addedParentChoice);
  assert.ok(addedChildChoice);
  assert.equal(api.resolveChoice(addedPlan, addedParentChoice.id, "leave-removed").ok, true);
  assert.deepEqual(plain(addedChildChoice.fields), ["details"],
    "the unavailable DEVICE parent choice must be removed without hiding the Notes choice");
  assert.equal(api.resolveChoice(addedPlan, addedChildChoice.id, "device").ok, true);
  const addedFinal = plain(api.finaliseCombination(addedPlan));
  assert.equal(addedFinal.ok, true, JSON.stringify(addedFinal));
  assert.equal(byId(addedFinal.document).get("same_added").parentId, "added_target");
  assert.equal(byId(addedFinal.document).get("same_added").details, "Device Notes");

  const keepBothAddedPlan = planFor(api, addedBase, addedFile, addedDevice).plan;
  const keepBothParent = keepBothAddedPlan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "added_parent");
  const keepBothChild = keepBothAddedPlan.choices.find((choice) =>
    choice.kind === "concurrent-add" && choice.nodeId === "same_added");
  assert.equal(api.resolveChoice(keepBothAddedPlan, keepBothParent.id, "leave-removed").ok, true);
  assert.equal(api.resolveChoice(keepBothAddedPlan, keepBothChild.id, "keep-both", {
    makeId: () => "same_added_device",
  }).ok, true);
  const keepBothAddedFinal = plain(api.finaliseCombination(keepBothAddedPlan));
  assert.equal(keepBothAddedFinal.ok, true, JSON.stringify(keepBothAddedFinal));
  assert.equal(byId(keepBothAddedFinal.document).get("same_added").parentId, "added_target");
  assert.equal(byId(keepBothAddedFinal.document).get("same_added_device").parentId, "added_target");
  assert.equal(byId(keepBothAddedFinal.document).get("same_added").details, "File Notes");
  assert.equal(byId(keepBothAddedFinal.document).get("same_added_device").details, "Device Notes");
});

test("Keep both removes a real DEVICE deletion tombstone when preserving the live FILE descendant", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("anchor_one"),
    node("anchor_two"),
    node("branch", { label: "Branch", details: "Base branch" }),
    node("child", { parentId: "branch", label: "Child", details: "Base child" }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("branch").details = "File branch";
  byId(device).get("branch").details = "Device branch";
  byId(file).get("child").details = "File child";
  device.nodes = device.nodes.filter((item) => item.id !== "child");
  device.tombstones.push({ id: "child", deletedAt: "2026-07-05T00:00:00.000Z" });

  const planned = planFor(api, base, file, device);
  const rootChoice = planned.plan.choices.find((choice) => choice.nodeId === "branch");
  assert.ok(rootChoice);
  const kept = api.resolveChoice(planned.plan, rootChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `fresh_${sourceId}`;
    },
  });

  assert.equal(kept.ok, true);
  assert.equal(kept.unresolvedCount, 0);
  const finalised = plain(api.finaliseCombination(planned.plan));
  assert.equal(finalised.ok, true);
  assert.equal(byId(finalised.document).get("child").details, "File child");
  assert.ok(byId(finalised.document).get("fresh_branch"));
  assert.equal(byId(finalised.document).has("fresh_child"), false);
  assert.equal(finalised.document.tombstones.some((item) => item.id === "child"), false);

  const supersededBase = documentWith([
    node("sup_parent", { label: "Parent", details: "Base parent", order: 1 }),
    node("sup_child", { parentId: "sup_parent", label: "Child", details: "Base child", order: 1 }),
  ]);
  const supersededFile = documentWith([
    node("sup_parent", { label: "Parent", details: "File parent", order: 1 }),
  ], {
    tombstones: [
      { id: "sup_child", deletedAt: "2026-07-06T00:00:00.000Z" },
    ],
  });
  const supersededDevice = plain(supersededBase);
  byId(supersededDevice).get("sup_parent").details = "Device parent";
  byId(supersededDevice).get("sup_child").details = "Device child";
  const supersededPlan = planFor(api, supersededBase, supersededFile, supersededDevice).plan;
  const childChoice = supersededPlan.choices.find((choice) =>
    choice.kind === "delete-versus-edit" && choice.nodeId === "sup_child");
  const parentChoice = supersededPlan.choices.find((choice) =>
    choice.kind === "node-fields" && choice.nodeId === "sup_parent");
  assert.ok(childChoice);
  assert.ok(parentChoice);
  assert.equal(api.resolveChoice(supersededPlan, childChoice.id, "keep-item").ok, true);
  assert.equal(supersededPlan.result.tombstones.some((item) => item.id === "sup_child"), false);
  assert.equal(api.resolveChoice(supersededPlan, parentChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `sup_fresh_${sourceId}`;
    },
  }).ok, true);
  assert.equal(childChoice.resolution, "covered-by-keep-both:sup_parent");
  const supersededFinal = plain(api.finaliseCombination(supersededPlan));
  assert.equal(supersededFinal.ok, true, JSON.stringify(supersededFinal));
  assert.equal(byId(supersededFinal.document).has("sup_child"), false);
  assert.equal(byId(supersededFinal.document).get("sup_fresh_sup_child").parentId, "sup_fresh_sup_parent");
  assert.equal(byId(supersededFinal.document).get("sup_fresh_sup_child").details, "Device child");
  assert.equal(supersededFinal.document.tombstones.some((item) => item.id === "sup_child"), true,
    "the broader Keep both choice must restore the FILE branch’s deletion record");

  const siblingBase = documentWith([
    node("sibling_a", { label: "A", details: "Base A", order: 1 }),
    node("sibling_b", { label: "B", details: "Base B", order: 2 }),
    node("sibling_x", { label: "X", details: "Stable X", order: 3 }),
  ]);
  const siblingFile = plain(siblingBase);
  const siblingDevice = plain(siblingBase);
  byId(siblingFile).get("sibling_a").details = "File A";
  byId(siblingDevice).get("sibling_a").details = "Device A";
  byId(siblingFile).get("sibling_b").details = "File B";
  byId(siblingDevice).get("sibling_b").details = "Device B";
  const siblingPlan = planFor(api, siblingBase, siblingFile, siblingDevice).plan;
  const siblingAChoice = siblingPlan.choices.find((choice) => choice.nodeId === "sibling_a");
  const siblingBChoice = siblingPlan.choices.find((choice) => choice.nodeId === "sibling_b");
  assert.ok(siblingAChoice);
  assert.ok(siblingBChoice);
  const siblingIdFactory = (_prefix, sourceId) => `sibling_fresh_${sourceId}`;
  assert.equal(api.resolveChoice(siblingPlan, siblingAChoice.id, "keep-both", {
    makeId: siblingIdFactory,
  }).ok, true);
  assert.equal(api.resolveChoice(siblingPlan, siblingBChoice.id, "keep-both", {
    makeId: siblingIdFactory,
  }).ok, true);
  const siblingFinal = plain(api.finaliseCombination(siblingPlan));
  assert.equal(siblingFinal.ok, true, JSON.stringify(siblingFinal));
  const orderedSiblings = siblingFinal.document.nodes
    .filter((item) => item.parentId === "root")
    .sort((left, right) => left.order - right.order)
    .map((item) => [item.id, item.order]);
  assert.deepEqual(orderedSiblings, [
    ["sibling_a", 1],
    ["sibling_fresh_sibling_a", 2],
    ["sibling_b", 3],
    ["sibling_fresh_sibling_b", 4],
    ["sibling_x", 5],
  ]);
  assert.equal(new Set(orderedSiblings.map((item) => item[1])).size, orderedSiblings.length);

  const crossingBase = documentWith([
    node("cross_p", { label: "P", details: "Base P", order: 1 }),
    node("cross_c", { parentId: "cross_p", label: "C", details: "Base C", order: 1 }),
    node("cross_q", { label: "Q", details: "Base Q", order: 2 }),
  ]);
  const crossingFile = plain(crossingBase);
  const crossingDevice = plain(crossingBase);
  byId(crossingFile).get("cross_p").details = "File P";
  byId(crossingDevice).get("cross_p").details = "Device P";
  byId(crossingFile).get("cross_q").details = "File Q";
  byId(crossingDevice).get("cross_q").details = "Device Q";
  byId(crossingDevice).get("cross_c").parentId = "cross_q";
  const crossingPlan = planFor(api, crossingBase, crossingFile, crossingDevice).plan;
  const crossingPChoice = crossingPlan.choices.find((choice) => choice.nodeId === "cross_p");
  const crossingQChoice = crossingPlan.choices.find((choice) => choice.nodeId === "cross_q");
  assert.ok(crossingPChoice);
  assert.ok(crossingQChoice);
  const crossingIdFactory = (_prefix, sourceId) => `cross_fresh_${sourceId}`;
  assert.equal(api.resolveChoice(crossingPlan, crossingPChoice.id, "keep-both", {
    makeId: crossingIdFactory,
  }).ok, true);
  assert.equal(byId(crossingPlan.result).get("cross_fresh_cross_c").parentId, "cross_q");
  assert.equal(api.resolveChoice(crossingPlan, crossingQChoice.id, "keep-both", {
    makeId: crossingIdFactory,
  }).ok, true);
  const crossingFinal = plain(api.finaliseCombination(crossingPlan));
  assert.equal(crossingFinal.ok, true, JSON.stringify(crossingFinal));
  const crossingNodes = byId(crossingFinal.document);
  assert.equal(crossingNodes.get("cross_c").parentId, "cross_p");
  assert.equal(
    crossingFinal.document.nodes.filter((item) =>
      item.id === "cross_c" || item.id === "cross_fresh_cross_c").length,
    2,
    "overlapping Keep both choices must create only one DEVICE copy of the moved item"
  );
  assert.equal(crossingNodes.get("cross_fresh_cross_c").parentId, "cross_fresh_cross_q");
  assert.equal(
    crossingFinal.document.nodes.some((item) =>
      item.parentId === "cross_q" && item.id !== "cross_q"),
    false,
    "the retained FILE Q branch must not inherit the DEVICE-moved child"
  );

  const reverseCrossingPlan = planFor(
    api,
    crossingBase,
    crossingFile,
    crossingDevice
  ).plan;
  const reversePChoice = reverseCrossingPlan.choices.find((choice) =>
    choice.nodeId === "cross_p");
  const reverseQChoice = reverseCrossingPlan.choices.find((choice) =>
    choice.nodeId === "cross_q");
  assert.equal(api.resolveChoice(reverseCrossingPlan, reverseQChoice.id, "keep-both", {
    makeId: crossingIdFactory,
  }).ok, true);
  assert.equal(api.resolveChoice(reverseCrossingPlan, reversePChoice.id, "keep-both", {
    makeId: crossingIdFactory,
  }).ok, true);
  const reverseCrossingFinal = plain(api.finaliseCombination(reverseCrossingPlan));
  assert.equal(reverseCrossingFinal.ok, true, JSON.stringify(reverseCrossingFinal));
  const reverseCrossingNodes = byId(reverseCrossingFinal.document);
  assert.equal(reverseCrossingNodes.get("cross_c").parentId, "cross_p");
  assert.equal(
    reverseCrossingFinal.document.nodes.filter((item) =>
      item.id === "cross_c" || item.id === "cross_fresh_cross_c").length,
    2,
    "reverse resolution order must still create exactly one DEVICE copy"
  );
  assert.equal(reverseCrossingNodes.get("cross_fresh_cross_c").parentId, "cross_fresh_cross_q");
  assert.equal(
    reverseCrossingFinal.document.nodes.some((item) =>
      item.parentId === "cross_q" && item.id !== "cross_q"),
    false,
    "reverse resolution order must leave retained FILE Q empty"
  );
  assert.equal(
    reverseCrossingFinal.document.nodes.some((item) =>
      item.parentId === "cross_fresh_cross_p" && item.id !== "cross_fresh_cross_p"),
    false,
    "the DEVICE P duplicate must reflect the moved-out child"
  );

  const orderBase = documentWith([
    node("z_parent", { label: "Parent", details: "Base parent", order: 1 }),
    node("a_child", { parentId: "z_parent", label: "Child", details: "Base child", order: 1 }),
    node("q", { label: "Q", order: 2 }),
    node("x", { parentId: "q", label: "External sibling", order: 2 }),
  ]);
  const orderFile = plain(orderBase);
  byId(orderFile).get("z_parent").details = "File parent";
  byId(orderFile).get("a_child").parentId = "q";
  byId(orderFile).get("a_child").details = "File child";
  const orderDevice = plain(orderBase);
  byId(orderDevice).get("z_parent").details = "Device parent";
  byId(orderDevice).get("a_child").details = "Device child";
  const orderPlan = planFor(api, orderBase, orderFile, orderDevice).plan;
  const orderChildChoice = orderPlan.choices.find((choice) => choice.nodeId === "a_child");
  const orderParentChoice = orderPlan.choices.find((choice) => choice.nodeId === "z_parent");
  assert.ok(orderChildChoice);
  assert.ok(orderParentChoice);
  assert.equal(api.resolveChoice(orderPlan, orderChildChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `first_${sourceId}`;
    },
  }).ok, true);
  assert.equal(byId(orderPlan.result).get("x").order, 3);
  assert.equal(api.resolveChoice(orderPlan, orderParentChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `second_${sourceId}`;
    },
  }).ok, true);
  const orderFinal = plain(api.finaliseCombination(orderPlan));
  assert.equal(orderFinal.ok, true, JSON.stringify(orderFinal));
  assert.equal(byId(orderFinal.document).get("x").order, 2,
    "superseding a nested Keep both must undo its external sibling-order shift");

  const explicitOrderBase = plain(orderBase);
  const explicitOrderFile = plain(orderFile);
  const explicitOrderDevice = plain(orderDevice);
  byId(explicitOrderFile).get("x").order = 3;
  byId(explicitOrderDevice).get("x").order = 4;
  const explicitOrderPlan = planFor(
    api,
    explicitOrderBase,
    explicitOrderFile,
    explicitOrderDevice
  ).plan;
  const explicitChildChoice = explicitOrderPlan.choices.find((choice) =>
    choice.nodeId === "a_child");
  const explicitSiblingChoice = explicitOrderPlan.choices.find((choice) =>
    choice.nodeId === "x");
  const explicitParentChoice = explicitOrderPlan.choices.find((choice) =>
    choice.nodeId === "z_parent");
  assert.ok(explicitChildChoice);
  assert.ok(explicitSiblingChoice);
  assert.ok(explicitParentChoice);
  assert.equal(api.resolveChoice(explicitOrderPlan, explicitChildChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `explicit_first_${sourceId}`;
    },
  }).ok, true);
  assert.equal(api.resolveChoice(explicitOrderPlan, explicitSiblingChoice.id, "device").ok, true);
  assert.equal(api.resolveChoice(explicitOrderPlan, explicitParentChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `explicit_second_${sourceId}`;
    },
  }).ok, true);
  const explicitOrderFinal = plain(api.finaliseCombination(explicitOrderPlan));
  assert.equal(explicitOrderFinal.ok, true, JSON.stringify(explicitOrderFinal));
  assert.equal(byId(explicitOrderFinal.document).get("x").order, 4,
    "superseding a nested Keep both must retain an explicit later sibling-order choice");
});

test("a structurally invalid automatic combination is rejected without inventing a repair", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("a", { label: "A" }),
    node("b", { label: "B" }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("a").parentId = "b";
  byId(device).get("b").parentId = "a";

  const planned = planFor(api, base, file, device);
  assert.equal(planned.unresolvedCount, 0);
  const finalised = plain(api.finaliseCombination(planned.plan));
  assert.equal(finalised.ok, false);
  assert.equal(finalised.reason, "invalid-combination");
  assert.ok(finalised.errors.includes("parent-cycle"));
  assert.match(finalised.message, /Nothing was changed/);
});

test("Keep both sibling placement is deterministic across choice order when FILE orders are duplicated", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("anchor", { label: "Anchor", order: 1 }),
    node("r0", { label: "R0", details: "Base R0", order: 1 }),
    node("r1", { label: "R1", details: "Base R1", order: 2 }),
    node("r2", { label: "R2", details: "Base R2", order: 3 }),
  ]);
  const file = plain(base);
  const device = plain(base);
  for (const id of ["r0", "r1", "r2"]) {
    byId(file).get(id).details = `File ${id}`;
    byId(device).get(id).details = `Device ${id}`;
  }

  const combineInOrder = (resolutionOrder) => {
    const plan = planFor(api, base, file, device).plan;
    for (const id of resolutionOrder) {
      const choice = plan.choices.find((candidate) => candidate.nodeId === id);
      assert.ok(choice);
      assert.equal(api.resolveChoice(plan, choice.id, "keep-both", {
        makeId(_prefix, sourceId) {
          return `deterministic_fresh_${sourceId}`;
        },
      }).ok, true);
    }
    const finalised = plain(api.finaliseCombination(plan));
    assert.equal(finalised.ok, true, JSON.stringify(finalised));
    return finalised.document;
  };

  const forward = combineInOrder(["r0", "r1", "r2"]);
  const reverse = combineInOrder(["r2", "r1", "r0"]);
  assert.equal(api.fingerprintDocument(forward), api.fingerprintDocument(reverse));
  assert.deepEqual(
    forward.nodes
      .filter((item) => item.parentId === "root")
      .sort((left, right) => left.order - right.order)
      .map((item) => [item.id, item.order]),
    reverse.nodes
      .filter((item) => item.parentId === "root")
      .sort((left, right) => left.order - right.order)
      .map((item) => [item.id, item.order]),
  );

  const movedBase = documentWith([
    node("a", { label: "A", details: "Base A", order: 1 }),
    node("b", { label: "B", details: "Stable B", order: 2 }),
    node("c", { label: "C", details: "Stable C", order: 3 }),
  ]);
  const movedFile = plain(movedBase);
  const movedDevice = plain(movedBase);
  byId(movedFile).get("a").details = "File A";
  byId(movedDevice).get("a").details = "Device A";
  byId(movedDevice).get("a").order = 4;
  const movedPlan = planFor(api, movedBase, movedFile, movedDevice).plan;
  const movedChoice = movedPlan.choices.find((choice) => choice.nodeId === "a");
  assert.deepEqual(plain(movedChoice.fields), ["details"]);
  assert.equal(api.resolveChoice(movedPlan, movedChoice.id, "keep-both", {
    makeId(_prefix, sourceId) {
      return `moved_fresh_${sourceId}`;
    },
  }).ok, true);
  const movedFinal = plain(api.finaliseCombination(movedPlan));
  assert.equal(movedFinal.ok, true, JSON.stringify(movedFinal));
  assert.deepEqual(
    movedFinal.document.nodes
      .filter((item) => item.parentId === "root")
      .sort((left, right) => left.order - right.order)
      .map((item) => [item.id, item.order]),
    [
      ["a", 1],
      ["moved_fresh_a", 2],
      ["b", 3],
      ["c", 4],
    ],
    "Keep both must retain FILE placement and put the DEVICE copy immediately after it",
  );
});

test("manual node-field choices adopt timestamps from the content that actually contributes", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("revision", {
      label: "Base title",
      details: "Base Notes",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("revision").details = "File Notes";
  byId(file).get("revision").updatedAt = "2026-02-01T00:00:00.000Z";
  byId(device).get("revision").details = "Device Notes";
  byId(device).get("revision").updatedAt = "2026-03-01T00:00:00.000Z";

  const filePlan = planFor(api, base, file, device).plan;
  const fileChoice = filePlan.choices.find((choice) => choice.nodeId === "revision");
  assert.equal(api.resolveChoice(filePlan, fileChoice.id, "file").ok, true);
  const fileFinal = plain(api.finaliseCombination(filePlan));
  assert.equal(fileFinal.ok, true);
  assert.equal(byId(fileFinal.document).get("revision").details, "File Notes");
  assert.equal(byId(fileFinal.document).get("revision").updatedAt, "2026-02-01T00:00:00.000Z");

  const devicePlan = planFor(api, base, file, device).plan;
  const deviceChoice = devicePlan.choices.find((choice) => choice.nodeId === "revision");
  assert.equal(api.resolveChoice(devicePlan, deviceChoice.id, "device").ok, true);
  const deviceFinal = plain(api.finaliseCombination(devicePlan));
  assert.equal(deviceFinal.ok, true);
  assert.equal(byId(deviceFinal.document).get("revision").details, "Device Notes");
  assert.equal(byId(deviceFinal.document).get("revision").updatedAt, "2026-03-01T00:00:00.000Z");
});

test("actual active normalisers reject a combined result that would silently exceed extras budgets", () => {
  const context = createIntegrationContext();
  const api = context.PocketDeviceChanges;
  assert.equal(typeof context.normaliseNodes, "function");
  assert.equal(typeof context.normaliseRootExtras, "function");

  const makeExtras = (prefix, count) => Object.fromEntries(
    Array.from({ length: count }, (_unused, index) => [`${prefix}_${index}`, `${prefix} value ${index}`]),
  );
  const buildVersions = (nodeExtraCount, rootExtraCount) => {
    const base = documentWith([node("shared", { label: "Shared item" })]);
    const file = plain(base);
    const device = plain(base);
    Object.assign(byId(file).get("shared"), makeExtras("file_node", nodeExtraCount));
    Object.assign(byId(device).get("shared"), makeExtras("device_node", nodeExtraCount));
    file.rootExtras = makeExtras("file_root", rootExtraCount);
    device.rootExtras = makeExtras("device_root", rootExtraCount);
    file.dataExtras = makeExtras("file_data", rootExtraCount);
    device.dataExtras = makeExtras("device_data", rootExtraCount);
    return { base, file, device };
  };

  const unsafe = buildVersions(24, 24);
  const unsafePlan = planFor(api, unsafe.base, unsafe.file, unsafe.device);
  assert.equal(unsafePlan.unresolvedCount, 0);
  const rejected = plain(api.finaliseCombination(unsafePlan.plan));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "invalid-combination");
  assert.ok(rejected.errors.includes("lossy-normalisation"));
  assert.match(rejected.message, /Nothing was changed/);

  const safe = buildVersions(12, 16);
  const safePlan = planFor(api, safe.base, safe.file, safe.device);
  assert.equal(safePlan.unresolvedCount, 0);
  const accepted = plain(api.finaliseCombination(safePlan.plan));
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(
    Object.keys(byId(accepted.document).get("shared"))
      .filter((key) => key.startsWith("file_node_") || key.startsWith("device_node_")).length,
    24,
  );
  assert.equal(Object.keys(accepted.document.rootExtras).length, 32);
  assert.equal(Object.keys(accepted.document.dataExtras).length, 32);
});

test("three-version review groups file, device, both, move, add, and remove changes in ordinary language", () => {
  const { api } = loadDeviceChangesApi();
  const base = documentWith([
    node("parent"),
    node("file_changed"),
    node("device_changed"),
    node("both_changed"),
    node("moved"),
    node("file_removed"),
    node("device_removed"),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("file_changed").label = "File changed";
  byId(device).get("device_changed").details = "Device changed";
  byId(file).get("both_changed").label = "File both";
  byId(device).get("both_changed").label = "Device both";
  byId(file).get("moved").parentId = "parent";
  file.nodes = file.nodes.filter((item) => item.id !== "file_removed");
  device.nodes = device.nodes.filter((item) => item.id !== "device_removed");
  file.nodes.push(node("file_added"));
  device.nodes.push(node("device_added"));

  const review = plain(api.buildReview({
    base,
    file,
    device,
    storedBaseFingerprint: api.fingerprintDocument(base),
  }));
  assert.equal(review.ok, true);
  assert.equal(review.mode, "three-version");
  assert.equal(review.combineAvailable, true);
  assert.deepEqual(
    review.groups.map((group) => group.title),
    [
      "Changed in the file",
      "Changed on this device",
      "Added in the file",
      "Added on this device",
      "Removed in the file",
      "Removed on this device",
      "Changed in both versions",
      "Moved in one version",
    ],
  );
  assert.ok(review.groups.every((group) => group.items.every((item) => typeof item.path === "string")));
});

test("detached device session clears the old handle, rotates identity, remains editable, and invalidates earlier PE identity", () => {
  const context = createIntegrationContext();
  const state = resetIntegrationState(context, [node("detached")], [{ type: "device-change" }]);
  const oldHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  const before = plain(context.capturePocketEditorSourceIdentity());

  context.setDetachedPocketDocumentSession("Device changes");
  const saveSession = context.capturePocketFileSaveSession();
  const after = plain(context.capturePocketEditorSourceIdentity());

  assert.equal(saveSession.handle, null);
  assert.equal(saveSession.detachedDeviceChanges, true);
  assert.equal(saveSession.writable, false);
  assert.equal(state.pocketFile.detachedDeviceChanges, true);
  assert.equal(context.canShowPocketTree(), true);
  assert.equal(context.canModifyPocket(), true);
  assert.ok(after.fileSessionId > before.fileSessionId);
  assert.equal(after.sourceFileName, "Device changes");
  assert.equal(after.sourcePipSession, false);
  assert.equal(context.isPocketEditorSourceIdentityCurrent(before), false);
  assert.equal(context.isPocketEditorSourceIdentityCurrent(after), true);
  assert.equal(oldHandle.calls.createWritable, 0);
});

test("a PE opened before device adoption is rejected by the actual apply owner before mutation or export", async () => {
  const context = createIntegrationContext();
  const fileNode = node("shared_pe", { label: "File title", details: "File Notes" });
  const state = resetIntegrationState(context, [fileNode]);
  const oldHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  const stalePayload = plain(context.PocketNodePopoutModel.buildPayload(state.nodes[0]));
  stalePayload.body = "Stale PE Notes";

  const snapshot = safetySnapshotFor(
    context,
    documentWith([node("shared_pe", { label: "Device title", details: "Device Notes" })]),
  );
  assert.equal(context.restoreLocalSafetySnapshot(snapshot), true);
  const beforeNode = plain(state.nodes[0]);
  const beforeOps = plain(state.ops);

  const result = await context.PocketNodePopoutEditor.applyAndSave(stalePayload);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "file-session-changed");
  assert.equal(result.applied, false);
  assert.deepEqual(plain(state.nodes[0]), beforeNode);
  assert.deepEqual(plain(state.ops), beforeOps);
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.equal(context.__surfaceCalls.picker, 0);
});

test("a PE opened after detached adoption edits safely and saves only to its newly picked destination", async () => {
  const oldHandle = fakeHandle("file-a.json");
  const pickedHandle = fakeHandle("file-c.json");
  const context = createIntegrationContext({
    pickSaveHandle() {
      return pickedHandle;
    },
  });
  const state = resetIntegrationState(context, [
    node("detached_pe", { label: "File title", details: "File Notes" }),
  ]);
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  const snapshot = safetySnapshotFor(
    context,
    documentWith([node("detached_pe", { label: "Device title", details: "Device Notes" })]),
  );
  assert.equal(context.restoreLocalSafetySnapshot(snapshot), true);
  const payload = plain(context.PocketNodePopoutModel.buildPayload(state.nodes[0]));
  payload.body = "Edited from the detached PE";

  const result = await context.PocketNodePopoutEditor.applyAndSave(payload);

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.exported, true);
  assert.equal(result.target, "picked-file");
  assert.equal(state.nodes[0].details, "Edited from the detached PE");
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.equal(oldHandle.calls.write, 0);
  assert.equal(pickedHandle.calls.createWritable, 1);
  assert.equal(pickedHandle.calls.write, 1);
  assert.match(pickedHandle.calls.text[0], /Edited from the detached PE/);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, pickedHandle);
});

test("detached Save cancellation keeps device changes dirty and safe without writing the previously selected file", async () => {
  const oldHandle = fakeHandle("file-a.json");
  const context = createUiIntegrationContext({
    async pickSaveHandle() {
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    },
  });
  const state = resetIntegrationState(context, [node("cancelled", { details: "Unsaved device Notes" })], [
    { type: "device-changes-adopted" },
  ]);
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([node("cancelled", { details: "Last written Notes" })])),
    { schema: "portal.export.v1", fileName: oldHandle.name, writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  context.setDetachedPocketDocumentSession("Device changes");
  assert.equal(context.saveLocalSafetySnapshot("device-changes"), true);
  const identityBefore = plain(context.capturePocketEditorSourceIdentity());
  const baselineBefore = plain(context.capturePocketDocumentBaseline());
  const payloadBefore = context.__storage.get("pocketLite.localSafety.snapshot.v1");

  const result = await context.exportTree({ returnDetails: true, downloadFallback: false });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "cancelled");
  assert.deepEqual(plain(context.capturePocketEditorSourceIdentity()), identityBefore);
  assert.equal(state.pocketFile.detachedDeviceChanges, true);
  assert.equal(state.ops.length, 1);
  assert.deepEqual(plain(context.capturePocketDocumentBaseline()), baselineBefore);
  assert.equal(context.__storage.get("pocketLite.localSafety.snapshot.v1"), payloadBefore);
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.equal(context.__surfaceCalls.picker, 1);
});

test("a failed detached write keeps its prior BASE, dirty state, safety copy, and handle isolation", async () => {
  const oldHandle = fakeHandle("file-a.json");
  const failedHandle = fakeHandle("failed.json", {
    async onWrite() {
      throw new Error("synthetic write failure");
    },
  });
  const context = createIntegrationContext({
    pickSaveHandle() {
      return failedHandle;
    },
  });
  const state = resetIntegrationState(context, [
    node("failed_write", { details: "Unsaved device Notes" }),
  ], [{ type: "device-changes-adopted" }]);
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([node("failed_write", { details: "Last written Notes" })])),
    { schema: "portal.export.v1", fileName: oldHandle.name, writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  context.setDetachedPocketDocumentSession("Device changes");
  assert.equal(context.saveLocalSafetySnapshot("device-changes"), true);
  const baselineBefore = plain(context.capturePocketDocumentBaseline());
  const safetyBefore = context.__storage.get("pocketLite.localSafety.snapshot.v1");

  const result = await context.exportTree({ returnDetails: true, downloadFallback: false });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "write-failed");
  assert.equal(state.pocketFile.detachedDeviceChanges, true);
  assert.equal(state.ops.length, 1);
  assert.deepEqual(plain(context.capturePocketDocumentBaseline()), baselineBefore);
  assert.equal(context.__storage.get("pocketLite.localSafety.snapshot.v1"), safetyBefore);
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.equal(failedHandle.calls.createWritable, 1);
  assert.equal(failedHandle.calls.write, 1);
  assert.equal(failedHandle.calls.close, 0);
  assert.equal(failedHandle.calls.abort, 1);
});

test("detached Save writes only the picked destination and adopts it after confirmed close", async () => {
  for (const [oldName, pickedName] of [
    ["file-a.json", "file-c.json"],
    ["pocket-data.json", "pocket-data.json"],
  ]) {
    const oldHandle = fakeHandle(oldName);
    const pickedHandle = fakeHandle(pickedName);
    const context = createIntegrationContext({
      pickSaveHandle() {
        return pickedHandle;
      },
    });
    const state = resetIntegrationState(context, [node(`saved_${oldName}`, { details: "Device version" })], [
      { type: "device-changes-adopted" },
    ]);
    context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
    context.setDetachedPocketDocumentSession("Device changes");
    assert.equal(context.saveLocalSafetySnapshot("device-changes"), true);
    const detachedSession = context.capturePocketFileSaveSession();

    const result = await context.exportTree({ returnDetails: true, downloadFallback: false });

    assert.equal(result.ok, true, `${oldName} → ${pickedName}`);
    assert.equal(result.reason, "truth-file");
    assert.equal(result.target, "picked-file");
    assert.equal(oldHandle.calls.createWritable, 0);
    assert.equal(oldHandle.calls.write, 0);
    assert.equal(pickedHandle.calls.createWritable, 1);
    assert.equal(pickedHandle.calls.write, 1);
    assert.equal(pickedHandle.calls.close, 1);
    assert.match(pickedHandle.calls.text[0], /Device version/);
    const currentSession = context.capturePocketFileSaveSession();
    assert.strictEqual(currentSession.handle, pickedHandle);
    assert.equal(currentSession.detachedDeviceChanges, false);
    assert.ok(currentSession.id > detachedSession.id);
    assert.equal(state.ops.length, 0);
    assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), false);
    const writtenPayload = JSON.parse(pickedHandle.calls.text[0]);
    const baseline = plain(context.capturePocketDocumentBaseline());
    assert.ok(baseline);
    assert.equal(
      context.PocketDeviceChanges.fingerprintDocument(baseline.payload),
      context.PocketDeviceChanges.fingerprintDocument(writtenPayload),
    );
  }
});

test("a successful selected-file load establishes the canonical normalised baseline without broadening root/data precedence", async () => {
  const fileDocument = documentWith([
    node("loaded", { label: "Loaded file", details: "Shared baseline Notes" }),
  ], {
    rootExtras: { rootFlag: "file" },
    dataExtras: { dataFlag: "file" },
  });
  const filePayload = payloadFromDocument(fileDocument, "2026-07-15T01:02:03.000Z");
  const file = {
    name: "chosen.json",
    async text() {
      return JSON.stringify(filePayload);
    },
  };
  const handle = fakeHandle(file.name, { file });
  const context = createIntegrationContext();
  resetIntegrationState(context, []);

  const loaded = await context.loadFromFileHandle(handle, { displayName: file.name });

  assert.equal(loaded, true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
  assert.equal(handle.calls.createWritable, 0);
  const baseline = plain(context.capturePocketDocumentBaseline());
  assert.ok(baseline);
  assert.equal(baseline.source.fileName, file.name);
  const normalisedFile = context.normaliseInput(filePayload);
  assert.equal(normalisedFile.dataExtras, null, "canonical portal.export tree precedence remains unchanged");
  assert.deepEqual(plain(lexicalState(context).dataExtras), {});
  assert.deepEqual(plain(baseline.payload.dataExtras), {});
  const comparison = plain(context.buildLoadedPocketComparisonDocument(normalisedFile, filePayload));
  assert.equal(comparison.combinationSafe, false);
  assert.notEqual(
    context.PocketDeviceChanges.fingerprintDocument(baseline.payload),
    context.PocketDeviceChanges.fingerprintDocument(filePayload),
  );
  assert.equal(lexicalState(context).nodes[0].details, "Shared baseline Notes");
});

test("browser safety stores a valid BASE and falls back to the device copy when BASE storage hits pressure", () => {
  const baselineDocument = documentWith([
    node("baseline", { label: "Shared baseline", details: "Baseline Notes" }),
  ]);
  const changedNodes = [
    node("baseline", { label: "Shared baseline", details: "Device-only Notes" }),
  ];

  const normal = createIntegrationContext();
  const normalState = resetIntegrationState(normal, changedNodes, [{ type: "device-edit" }]);
  assert.equal(normal.establishPocketDocumentBaseline(
    payloadFromDocument(baselineDocument),
    { schema: "portal.export.v1", fileName: "source.json", writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  assert.equal(normal.saveLocalSafetySnapshot("change"), true);
  const stored = plain(normal.readLocalSafetySnapshot());
  assert.ok(stored.base);
  assert.equal(stored.base.fingerprint, normal.PocketDeviceChanges.fingerprintDocument(stored.base.payload));
  assert.equal(stored.norm.nodes[0].details, normalState.nodes[0].details);

  const pressured = createIntegrationContext({
    failStorageWrite(key, value) {
      return key === "pocketLite.localSafety.snapshot.v1"
        && value.includes("\"base\"");
    },
  });
  const pressuredState = resetIntegrationState(pressured, changedNodes, [{ type: "device-edit" }]);
  assert.equal(pressured.establishPocketDocumentBaseline(
    payloadFromDocument(baselineDocument),
    { schema: "portal.export.v1", fileName: "source.json", writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  assert.equal(pressured.saveLocalSafetySnapshot("change"), true);
  const fallbackRaw = JSON.parse(pressured.__storage.get("pocketLite.localSafety.snapshot.v1"));
  const fallback = plain(pressured.readLocalSafetySnapshot());
  assert.equal(Object.hasOwn(fallbackRaw, "base"), false);
  assert.equal(fallback.base, null);
  assert.equal(fallback.norm.nodes[0].details, pressuredState.nodes[0].details);
  const review = plain(pressured.PocketDeviceChanges.buildReview({
    file: baselineDocument,
    device: {
      nodes: fallback.norm.nodes,
      tombstones: fallback.norm.tombstones,
      rootExtras: fallback.norm.rootExtras,
      dataExtras: fallback.norm.dataExtras,
    },
  }));
  assert.equal(review.combineAvailable, false);
  assert.equal(review.combineMessage, NO_BASE_MESSAGE);
});

test("P104i-b retires an already-archived JSON current-safety entry without rewriting the trail", () => {
  const context = createIntegrationContext();
  const state = resetIntegrationState(context, [node("p104i", { details: "Discarded JSON safety" })], [
    { type: "p104i-edit" },
  ]);
  const handle = fakeHandle("p104i-local.json");
  context.setPocketFileSession(handle, handle.name, { ownerKind: "json", forceNewSession: true });
  assert.equal(context.saveLocalSafetySnapshot("p104i-edit"), true);
  const capturedRaw = context.__storage.get("pocketLite.localSafety.snapshot.v1");
  const archivedTrail = context.__storage.get("pocketLite.localSafety.trail.v1");
  const token = context.captureJsonSafetyForSyncedDiscard();
  assert.ok(token);

  context.setPocketFileSession(null, "Synced Pocket", { ownerKind: "synced", forceNewSession: true });
  let trailWrites = 0;
  const setItem = context.localStorage.setItem;
  context.localStorage.setItem = (key, value) => {
    if (key === "pocketLite.localSafety.trail.v1") {
      trailWrites += 1;
      throw new Error("redundant trail write");
    }
    return setItem(key, value);
  };
  assert.equal(context.retireJsonSafetyForSyncedDiscard(token), true);
  assert.equal(trailWrites, 0);
  assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), false);
  assert.equal(context.__storage.get("pocketLite.localSafety.trail.v1"), archivedTrail);
  const trail = JSON.parse(context.__storage.get("pocketLite.localSafety.trail.v1"));
  assert.ok(trail.some((entry) => JSON.stringify(entry) === capturedRaw));
  assert.equal(handle.calls.createWritable, 0);
  assert.equal(state.nodes[0].details, "Discarded JSON safety");
});

test("P104i never clears a changed JSON current-safety entry or an entry it cannot archive", () => {
  const changed = createIntegrationContext();
  resetIntegrationState(changed, [node("p104i-changed")], [{ type: "p104i-edit" }]);
  changed.setPocketFileSession(fakeHandle("p104i-changed.json"), "p104i-changed.json", {
    ownerKind: "json", forceNewSession: true,
  });
  assert.equal(changed.saveLocalSafetySnapshot("p104i-edit"), true);
  const token = changed.captureJsonSafetyForSyncedDiscard();
  const newer = JSON.parse(changed.__storage.get("pocketLite.localSafety.snapshot.v1"));
  newer.reason = "newer-p104i-edit";
  changed.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(newer));
  changed.setPocketFileSession(null, "Synced Pocket", { ownerKind: "synced", forceNewSession: true });
  assert.equal(changed.retireJsonSafetyForSyncedDiscard(token), false);
  assert.equal(changed.__storage.get("pocketLite.localSafety.snapshot.v1"), JSON.stringify(newer));

  const pressured = createIntegrationContext();
  resetIntegrationState(pressured, [node("p104i-pressure")], [{ type: "p104i-edit" }]);
  pressured.setPocketFileSession(fakeHandle("p104i-pressure.json"), "p104i-pressure.json", {
    ownerKind: "json", forceNewSession: true,
  });
  assert.equal(pressured.saveLocalSafetySnapshot("p104i-edit"), true);
  const pressuredToken = pressured.captureJsonSafetyForSyncedDiscard();
  const safetyRaw = pressured.__storage.get("pocketLite.localSafety.snapshot.v1");
  pressured.__storage.delete("pocketLite.localSafety.trail.v1");
  const setItem = pressured.localStorage.setItem;
  pressured.localStorage.setItem = (key, value) => {
    if (key === "pocketLite.localSafety.trail.v1") throw new Error("synthetic trail failure");
    return setItem(key, value);
  };
  pressured.setPocketFileSession(null, "Synced Pocket", { ownerKind: "synced", forceNewSession: true });
  assert.equal(pressured.retireJsonSafetyForSyncedDiscard(pressuredToken), false);
  assert.equal(pressured.__storage.get("pocketLite.localSafety.snapshot.v1"), safetyRaw);
});

test("P104i-a honours the canonical safety-trail entry bound before retiring JSON safety", () => {
  const context = createIntegrationContext();
  resetIntegrationState(context, [node("p104i-a-oversized")], [{ type: "p104i-edit" }]);
  context.setPocketFileSession(fakeHandle("p104i-a-oversized.json"), "p104i-a-oversized.json", {
    ownerKind: "json", forceNewSession: true,
  });
  assert.equal(context.saveLocalSafetySnapshot("p104i-edit"), true);
  const currentKey = "pocketLite.localSafety.snapshot.v1";
  const oversized = JSON.parse(context.__storage.get(currentKey));
  oversized.payload.p104iOversized = "x".repeat(900000);
  const oversizedRaw = JSON.stringify(oversized);
  context.__storage.set(currentKey, oversizedRaw);
  const token = context.captureJsonSafetyForSyncedDiscard();
  assert.ok(token);

  context.setPocketFileSession(null, "Synced Pocket", { ownerKind: "synced", forceNewSession: true });
  assert.equal(context.retireJsonSafetyForSyncedDiscard(token), false);
  assert.equal(context.__storage.get(currentKey), oversizedRaw);
});

test("opening a stored device version detaches from the active file, preserves operations, and writes neither handle", () => {
  const context = createIntegrationContext();
  const deviceNodes = [node("shared", { label: "Device title", details: "Device Notes" })];
  const state = resetIntegrationState(context, deviceNodes, [{ type: "device-edit", at: "2026-07-20T00:00:00.000Z" }]);
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([node("shared", { label: "Base title", details: "Base Notes" })])),
    { schema: "portal.export.v1", fileName: "file-a.json", writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  assert.equal(context.saveLocalSafetySnapshot("change"), true);
  const snapshotEntry = JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1"));
  snapshotEntry.payload.data.deviceOnlyMeta = { preserved: true };
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshotEntry));
  const snapshot = context.readLocalSafetySnapshot();
  assert.ok(snapshot);

  const oldHandle = fakeHandle("file-b.json");
  resetIntegrationState(context, [
    node("shared", { label: "File B title", details: "File B Notes" }),
  ]);
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  const identityBefore = plain(context.capturePocketEditorSourceIdentity());

  const restored = context.restoreLocalSafetySnapshot(snapshot);

  assert.equal(restored, true);
  assert.equal(state.nodes[0].label, "Device title");
  assert.equal(state.nodes[0].details, "Device Notes");
  assert.deepEqual(plain(state.dataExtras), { deviceOnlyMeta: { preserved: true } });
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].type, "device-edit");
  assert.equal(state.ops[0].at, "2026-07-20T00:00:00.000Z");
  assert.ok(Number.isSafeInteger(state.ops[0].seq) && state.ops[0].seq > 0);
  const session = context.capturePocketFileSaveSession();
  assert.equal(session.handle, null);
  assert.equal(session.detachedDeviceChanges, true);
  assert.ok(session.id > identityBefore.fileSessionId);
  assert.equal(context.isPocketEditorSourceIdentityCurrent(identityBefore), false);
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.ok(context.readLocalSafetySnapshot());
  assert.ok(context.readLocalSafetyTrail().length >= 1);
});

test("legacy lossy device adoption stores the exact visible document and fails closed when that safety copy cannot be replaced", () => {
  const longDetails = "x".repeat(4001);
  const deviceDocument = documentWith([
    node("lossy_device", { label: "Legacy device item", details: longDetails }),
  ]);

  const normal = createIntegrationContext();
  const normalState = resetIntegrationState(normal, [
    node("lossy_device", { label: "Selected file item", details: "Selected file Notes" }),
  ]);
  const normalHandle = fakeHandle("selected.json");
  normal.setPocketFileSession(normalHandle, normalHandle.name, { forceNewSession: true });
  const normalSnapshot = safetySnapshotFor(normal, deviceDocument);
  assert.equal(normalSnapshot.parsed.payload.mainThoughtTree[0].details.length, 4001);
  assert.equal(normalSnapshot.norm.nodes[0].details.length, 4000);

  assert.equal(normal.restoreLocalSafetySnapshot(normalSnapshot), true);
  const stored = normal.readLocalSafetySnapshot();
  const visible = {
    nodes: normalState.nodes,
    tombstones: normalState.tombstones,
    rootExtras: normalState.rootExtras,
    dataExtras: normalState.dataExtras,
  };
  assert.equal(normalState.nodes[0].details.length, 4000);
  assert.equal(stored.norm.nodes[0].details.length, 4000);
  assert.equal(normal.PocketDeviceChanges.documentsEqual(stored.parsed.payload, visible), true);
  assert.equal(normalHandle.calls.createWritable, 0);

  const pressured = createUiIntegrationContext({
    failStorageWrite(key) {
      return key === "pocketLite.localSafety.snapshot.v1";
    },
  });
  const pressuredState = resetIntegrationState(pressured, [
    node("lossy_device", { label: "Selected file item", details: "Selected file Notes" }),
  ]);
  const pressuredHandle = fakeHandle("selected.json");
  pressured.setPocketFileSession(pressuredHandle, pressuredHandle.name, { forceNewSession: true });
  const pressuredSnapshot = safetySnapshotFor(pressured, deviceDocument);
  pressured.__storage.set(
    "pocketLite.localSafety.snapshot.v1",
    JSON.stringify(pressuredSnapshot.parsed),
  );
  const sessionBefore = pressured.capturePocketFileSaveSession();
  assert.equal(pressured.openPocketDeviceChangesDecision(pressuredSnapshot, {
    candidateKind: "current-safety",
    fileDocument: documentWith(plain(pressuredState.nodes)),
  }), true);

  pressured.__ui.elements.get("deviceChangesUseDevice").click();

  assert.equal(pressured.isPocketDeviceChangesDecisionOpen(), true);
  assert.equal(pressuredState.nodes[0].details, "Selected file Notes");
  assert.strictEqual(pressured.capturePocketFileSaveSession().handle, pressuredHandle);
  assert.equal(pressured.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.equal(pressuredHandle.calls.createWritable, 0);
  assert.equal(pressured.__surfaceCalls.picker, 0);
  assert.match(
    pressured.__ui.elements.get("deviceChangesNotice").textContent,
    /couldn’t keep those device changes safe enough/i,
  );
});

test("manual previous-version review invokes the shared decision owner without adopting or writing", () => {
  const context = createIntegrationContext();
  const state = resetIntegrationState(context, [node("current", { label: "Current file" })]);
  const handle = fakeHandle("current.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const nodesBefore = plain(state.nodes);
  const now = Date.now();
  const makeEntry = (capturedAt, label) => ({
    schema: "pocket.localSafety.v1",
    capturedAt,
    reason: "change",
    source: { fileName: "device.json" },
    ops: [{ type: "edit" }],
    payload: payloadFromDocument(documentWith([node(label, { label })]), capturedAt),
  });
  context.__storage.set(
    "pocketLite.localSafety.snapshot.v1",
    JSON.stringify(makeEntry(new Date(now).toISOString(), "latest")),
  );
  context.__storage.set(
    "pocketLite.localSafety.trail.v1",
    JSON.stringify([makeEntry(new Date(now - 120000).toISOString(), "previous")]),
  );
  let offered = null;
  context.openPocketDeviceChangesDecision = (candidate, options) => {
    offered = { candidate, options };
    return true;
  };

  const opened = context.restorePreviousLocalSafetyVersion();

  assert.equal(opened, true);
  assert.ok(offered);
  assert.equal(offered.options.origin, "manual-trail");
  assert.equal(offered.options.candidateKind, "trail");
  assert.equal(offered.candidate.norm.nodes[0].label, "previous");
  assert.deepEqual(plain(state.nodes), nodesBefore);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, sessionBefore.handle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.equal(handle.calls.createWritable, 0);
});

test("describeDocumentTransition deterministically records add, title, Notes, Outline, move, order, delete, subtree, root, data, and tombstone semantics", () => {
  const { api } = loadDeviceChangesApi();
  assert.equal(typeof api.describeDocumentTransition, "function");
  const outlineBefore = {
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [{ id: "row_before", text: "Before", depth: 0, collapsed: false, order: 1 }],
  };
  const outlineAfter = {
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: [{ id: "row_after", text: "After", depth: 0, collapsed: true, order: 1 }],
  };
  const base = documentWith([
    node("parent_a", { label: "Parent A", details: "" }),
    node("parent_b", { label: "Parent B", details: "" }),
    node("changed", {
      parentId: "parent_a",
      label: "Before title",
      details: "Before Notes",
      editor: outlineBefore,
      order: 1,
      customExtra: { value: "before" },
      task: { status: "open" },
    }),
    node("deleted_leaf", { label: "Deleted leaf", order: 2 }),
    node("deleted_branch", { label: "Deleted branch", order: 3 }),
    node("deleted_child", { parentId: "deleted_branch", label: "Deleted child", order: 1 }),
  ], {
    rootExtras: { rootFlag: "before" },
    dataExtras: { dataFlag: "before" },
    tombstones: [],
  });
  const device = plain(base);
  Object.assign(byId(device).get("changed"), {
    parentId: "parent_b",
    label: "After title",
    details: "After Notes",
    editor: outlineAfter,
    order: 7,
    urgent: true,
    copyContext: true,
    customExtra: { value: "after" },
    task: { status: "in_progress" },
  });
  device.nodes = device.nodes.filter((item) =>
    !["deleted_leaf", "deleted_branch", "deleted_child"].includes(item.id));
  device.nodes.push(node("added", { label: "Added item", details: "Added Notes", order: 8 }));
  device.rootExtras.rootFlag = "after";
  device.dataExtras.dataFlag = "after";
  device.tombstones = [
    { id: "deleted_leaf", deletedAt: "2026-07-20T00:00:00.000Z" },
    { id: "deleted_branch", deletedAt: "2026-07-20T00:00:01.000Z" },
    { id: "deleted_child", deletedAt: "2026-07-20T00:00:02.000Z" },
  ];

  const first = plain(api.describeDocumentTransition(base, device, { reason: "synthetic-transition" }));
  const second = plain(api.describeDocumentTransition(base, device, { reason: "synthetic-transition" }));
  assert.deepEqual(first, second, "the same semantic transition must produce deterministic descriptors");
  const records = Array.isArray(first) ? first : first.records;
  assert.ok(Array.isArray(records) && records.length >= 11);
  const semanticText = (record) => JSON.stringify({
    scope: record.scope,
    kind: record.kind,
    field: record.field,
    fields: record.fields,
    id: record.id,
    nodeId: record.nodeId,
    key: record.key,
  }).toLowerCase();
  const has = (...tokens) => records.some((record) => {
    const text = semanticText(record);
    return tokens.every((token) => text.includes(String(token).toLowerCase()));
  });

  assert.equal(has("node", "added", "add"), true);
  assert.equal(has("node", "changed", "label") || has("node", "changed", "title"), true);
  assert.equal(has("node", "changed", "details") || has("node", "changed", "notes"), true);
  assert.equal(has("node", "changed", "editor") || has("node", "changed", "outline"), true);
  assert.equal(has("node", "changed", "parent") || has("node", "changed", "move"), true);
  assert.equal(has("node", "changed", "order"), true);
  assert.equal(has("node", "changed", "urgent"), true);
  assert.equal(has("node", "changed", "copy-context") || has("node", "changed", "copycontext"), true);
  assert.equal(has("node", "changed", "customextra"), true);
  assert.equal(has("node", "changed", "task"), true);
  assert.equal(has("node", "deleted_leaf", "delete") || has("node", "deleted_leaf", "remove"), true);
  assert.equal(has("subtree", "deleted_branch") || has("deleted_branch", "subtree"), true);
  assert.equal(has("root", "rootflag"), true);
  assert.equal(has("data", "dataflag"), true);
  assert.equal(has("tombstone", "deleted_leaf"), true);
  assert.doesNotThrow(() => JSON.stringify(records));
  assert.equal(records.some((record) => Object.hasOwn(record, "before")
    || Object.hasOwn(record, "after")), false,
  "descriptors identify change semantics without duplicating full before/after values");
});

test("browser device-change metadata assigns one monotonic sequence per transition and survives snapshot adoption", () => {
  const context = createIntegrationContext();
  const baselineNode = node("tracked", {
    label: "Base title",
    details: "Base Notes",
    order: 1,
  });
  const state = resetIntegrationState(context, [plain(baselineNode)]);
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([baselineNode])),
    { schema: "portal.export.v1", fileName: "records.json", writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);

  state.nodes[0].label = "First title";
  state.nodes[0].details = "First Notes";
  context.recordOp({ type: "details_edit", id: "tracked" });
  const firstSafety = JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1"));
  assert.equal(firstSafety.deviceChanges.schema, "pocket.deviceChanges.v1");
  assert.equal(firstSafety.deviceChanges.baseFingerprint, context.capturePocketDocumentBaseline().fingerprint);
  assert.equal(firstSafety.deviceChanges.sourceFileName, "synthetic.json");
  assert.ok(firstSafety.deviceChanges.capturedAt);
  assert.ok(firstSafety.deviceChanges.baseSource);
  const firstRecords = firstSafety.deviceChanges.records;
  assert.ok(Array.isArray(firstRecords) && firstRecords.length >= 2);
  const firstSequences = new Set(firstRecords.map((record) => record.sequence));
  assert.equal(firstSequences.size, 1, "title and Notes from one transition share one sequence");
  const firstSequence = firstRecords[0].sequence;
  assert.equal(firstSafety.deviceChanges.highestSequence, firstSequence);

  state.nodes[0].order = 9;
  context.recordOp({ type: "move_down", id: "tracked" });
  const secondSafety = JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1"));
  const retainedFirstRecords = secondSafety.deviceChanges.records
    .filter((record) => record.sequence === firstSequence);
  const laterRecords = secondSafety.deviceChanges.records
    .filter((record) => record.sequence > firstSequence);
  assert.deepEqual(retainedFirstRecords, firstRecords, "existing record descriptors keep their stable sequence");
  assert.ok(laterRecords.length >= 1);
  assert.equal(new Set(laterRecords.map((record) => record.sequence)).size, 1);
  assert.equal(secondSafety.deviceChanges.highestSequence, laterRecords[0].sequence);

  const restoredContext = createIntegrationContext();
  const restoredState = resetIntegrationState(restoredContext, [node("selected-file")]);
  const handle = fakeHandle("selected.json");
  restoredContext.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  restoredContext.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(secondSafety));
  const snapshot = restoredContext.readLocalSafetySnapshot();
  assert.ok(snapshot);
  assert.equal(restoredContext.restoreLocalSafetySnapshot(snapshot), true);
  restoredState.nodes[0].details = "Notes after restore";
  restoredContext.recordOp({ type: "details_edit", id: "tracked" });
  const afterRestore = JSON.parse(restoredContext.__storage.get("pocketLite.localSafety.snapshot.v1"));
  assert.ok(afterRestore.deviceChanges.highestSequence > secondSafety.deviceChanges.highestSequence);
  assert.ok(afterRestore.deviceChanges.records.some((record) =>
    record.sequence > secondSafety.deviceChanges.highestSequence));
  assert.equal(handle.calls.createWritable, 0);

  const truthPayload = restoredContext.buildPocketPayload("2026-07-21T00:00:00.000Z");
  assert.equal(Object.hasOwn(truthPayload, "deviceChanges"), false);
  assert.equal(JSON.stringify(truthPayload).includes("pocket.deviceChanges.v1"), false);
});

test("the full DEVICE payload remains primary when browser change metadata is incomplete or misleading", () => {
  const context = createIntegrationContext();
  const state = resetIntegrationState(context, [node("device", {
    label: "Device payload title",
    details: "Device payload Notes",
  })], [{ type: "device-edit", at: "2026-07-20T00:00:00.000Z" }]);
  assert.equal(context.saveLocalSafetySnapshot("device"), true);
  const raw = JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1"));
  raw.deviceChanges = {
    schema: "pocket.deviceChanges.v1",
    baseFingerprint: "synthetic-mismatch",
    baseSource: {},
    capturedAt: raw.capturedAt,
    sourceFileName: "other.json",
    highestSequence: 7,
    records: [{
      sequence: 7,
      scope: "node",
      kind: "notes",
      nodeId: "device",
      before: { details: "File Notes" },
      after: { details: "Wrong metadata Notes" },
    }],
  };
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(raw));
  const snapshot = context.readLocalSafetySnapshot();
  assert.ok(snapshot);

  const selectedHandle = fakeHandle("selected.json");
  resetIntegrationState(context, [node("device", {
    label: "Selected file title",
    details: "Selected file Notes",
  })]);
  context.setPocketFileSession(selectedHandle, selectedHandle.name, { forceNewSession: true });
  assert.equal(context.restoreLocalSafetySnapshot(snapshot), true);

  assert.equal(state.nodes[0].label, "Device payload title");
  assert.equal(state.nodes[0].details, "Device payload Notes");
  assert.notEqual(state.nodes[0].details, raw.deviceChanges.records[0].after.details);
  assert.equal(selectedHandle.calls.createWritable, 0);
});

test("storage pressure may drop browser change metadata but must keep the complete DEVICE payload", () => {
  const context = createIntegrationContext({
    failStorageWrite(key, value) {
      return key === "pocketLite.localSafety.snapshot.v1"
        && value.includes("\"deviceChanges\":");
    },
  });
  const state = resetIntegrationState(context, [node("pressure", {
    label: "Device title",
    details: "Complete device Notes",
  })]);
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([node("pressure", {
      label: "Base title",
      details: "Base Notes",
    })])),
    { schema: "portal.export.v1", fileName: "pressure.json", writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);

  context.recordOp({ type: "details_edit", id: "pressure" });
  assert.ok(context.__storageAttempts.some(({ key, value }) =>
    key === "pocketLite.localSafety.snapshot.v1"
      && value.includes("\"deviceChanges\":")),
  "Pocket first attempts the richer safety entry before falling back");
  const raw = JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1"));
  assert.equal(raw.payload.mainThoughtTree[0].details, "Complete device Notes");
  assert.equal(Object.hasOwn(raw, "deviceChanges"), false);
  const safety = context.readLocalSafetySnapshot();
  assert.ok(safety);
  assert.equal(safety.norm.nodes[0].details, state.nodes[0].details);
});

test("a save race baselines exactly the written payload and keeps newer operations and safety data", async () => {
  let releaseWrite;
  let signalWriteStarted;
  const writeStarted = new Promise((resolve) => { signalWriteStarted = resolve; });
  const heldWrite = new Promise((resolve) => { releaseWrite = resolve; });
  const handle = fakeHandle("race.json", {
    async onWrite() {
      signalWriteStarted();
      await heldWrite;
    },
  });
  const context = createIntegrationContext();
  const state = resetIntegrationState(context, [
    node("race", { label: "Before save", details: "Payload at save start" }),
  ]);
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([node("race", { label: "Baseline", details: "Old Notes" })])),
    { schema: "portal.export.v1", fileName: handle.name, writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  context.recordOp({ type: "first-edit", id: "race" });
  const safetyAtSaveStart = JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1"));
  const coveredSequence = safetyAtSaveStart.deviceChanges.highestSequence;
  assert.ok(Number.isSafeInteger(coveredSequence) && coveredSequence > 0);

  const saving = context.exportTree({ returnDetails: true, downloadFallback: false });
  await writeStarted;
  assert.equal(state.activeSaveOperationCeiling, coveredSequence);
  assert.equal(context.discardPocketOperationSequence(coveredSequence), false,
    "an in-flight save protects operations covered by its frozen payload");
  state.nodes[0].details = "Newer edit made during write";
  context.recordOp({ type: "newer-edit", id: "race" });
  const safetyDuringWrite = JSON.parse(context.__storage.get("pocketLite.localSafety.snapshot.v1"));
  const newerSequence = safetyDuringWrite.deviceChanges.highestSequence;
  assert.ok(newerSequence > coveredSequence);
  releaseWrite();
  const result = await saving;

  assert.equal(result.ok, true);
  assert.equal(state.activeSaveOperationCeiling, 0);
  assert.equal(handle.calls.write, 1);
  const written = JSON.parse(handle.calls.text[0]);
  assert.equal(written.mainThoughtTree[0].details, "Payload at save start");
  assert.equal(state.nodes[0].details, "Newer edit made during write");
  assert.deepEqual(state.ops.map((operation) => operation.type), ["newer-edit"]);
  const baseline = plain(context.capturePocketDocumentBaseline());
  assert.equal(
    baseline.fingerprint,
    context.PocketDeviceChanges.fingerprintDocument(written),
  );
  const safety = plain(context.readLocalSafetySnapshot());
  assert.ok(safety);
  assert.equal(safety.norm.nodes[0].details, "Newer edit made during write");
  assert.equal(safety.parsed.deviceChanges.highestSequence, newerSequence);
  assert.ok(safety.parsed.deviceChanges.records.length >= 1);
  assert.ok(safety.parsed.deviceChanges.records.every((record) => record.sequence > coveredSequence));
  assert.ok(safety.parsed.deviceChanges.records.some((record) => record.sequence === newerSequence));
  assert.ok(safety.base);
  assert.equal(safety.base.fingerprint, baseline.fingerprint);
  assert.equal(
    context.PocketDeviceChanges.fingerprintDocument(safety.base.payload),
    context.PocketDeviceChanges.fingerprintDocument(written),
  );
});

test("zero-node DEVICE safety can be stored, read, adopted, combined, and explicitly saved without the old handle", async () => {
  const oldHandle = fakeHandle("selected.json");
  const destination = fakeHandle("empty-device.json");
  const context = createUiIntegrationContext({
    async pickSaveHandle() {
      return destination;
    },
  });
  const original = documentWith([
    node("last", { label: "Last item", details: "Delete me" }),
  ]);
  const emptyDevice = documentWith([], {
    tombstones: [{ id: "last", deletedAt: "2026-07-20T00:00:00.000Z" }],
  });
  const state = resetIntegrationState(context, original.nodes);
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(original),
    { schema: "portal.export.v1", fileName: oldHandle.name, writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  const baseline = plain(context.capturePocketDocumentBaseline());
  const saved = context.saveDetachedPocketSafetySnapshot(emptyDevice, baseline, {
    reason: "final-node-deleted",
    source: { schema: "portal.export.v1", fileName: oldHandle.name },
    ops: [{ type: "delete", seq: 1, at: "2026-07-20T00:00:00.000Z" }],
    operationHighWater: 1,
  });
  assert.equal(saved.ok, true);

  const snapshot = context.readLocalSafetySnapshot();
  assert.ok(snapshot);
  assert.deepEqual(plain(snapshot.norm.nodes), []);
  assert.equal(snapshot.norm.tombstones[0].id, "last");
  assert.equal(snapshot.base.fingerprint, baseline.fingerprint);

  const plan = planFor(context.PocketDeviceChanges, original, original, emptyDevice);
  const finalised = plain(context.PocketDeviceChanges.finaliseCombination(plan.plan));
  assert.equal(finalised.ok, true, JSON.stringify(finalised));
  assert.deepEqual(finalised.document.nodes, []);
  assert.equal(finalised.document.tombstones[0].id, "last");

  assert.equal(context.restoreLocalSafetySnapshot(snapshot), true);
  assert.deepEqual(plain(state.nodes), []);
  assert.equal(state.tombstones[0].id, "last");
  assert.equal(context.capturePocketFileSaveSession().handle, null);
  assert.equal(context.capturePocketFileSaveSession().detachedDeviceChanges, true);
  assert.equal(oldHandle.calls.createWritable, 0);
  context.__productionRefreshMeta();
  assert.equal(context.__ui.elements.get("btnExportTree").disabled, false);

  const result = await context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(result.ok, true);
  assert.equal(destination.calls.write, 1);
  const written = JSON.parse(destination.calls.text[0]);
  assert.deepEqual(written.mainThoughtTree, []);
  assert.equal(written.mainThoughtTreeTombstones[0].id, "last");
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, destination);
});

test("corrupted empty safety payloads are rejected while explicit zero-node safety, trail, and PiP documents remain valid", () => {
  const context = createIntegrationContext();
  resetIntegrationState(context, []);
  const capturedAt = "2026-07-20T12:00:00.000Z";
  const corrupt = {
    schema: "pocket.localSafety.v1",
    capturedAt,
    payload: {},
  };
  const valid = {
    schema: "pocket.localSafety.v1",
    capturedAt: "2026-07-20T12:01:00.000Z",
    payload: payloadFromDocument(documentWith([]), "2026-07-20T12:01:00.000Z"),
  };
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(corrupt));
  context.__storage.set("pocketLite.localSafety.trail.v1", JSON.stringify([corrupt, valid]));

  assert.equal(context.readLocalSafetySnapshot(), null);
  const trail = context.readLocalSafetyTrail();
  assert.equal(trail.length, 1);
  assert.deepEqual(plain(trail[0].norm.nodes), []);
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(valid));
  const accepted = context.readLocalSafetySnapshot();
  assert.ok(accepted);
  assert.deepEqual(plain(accepted.norm.nodes), []);

  const pip = createIntegrationContext({ href: "https://example.test/index.html?pip=1" });
  const pipState = resetIntegrationState(pip, []);
  pip.__storage.set("pocketLite.pip.snapshot.v1", JSON.stringify({
    savedAt: capturedAt,
    source: { schema: "portal.export.v1", fileName: "empty-pip.json", writtenAt: capturedAt },
    nodes: [],
    tombstones: [],
    rootExtras: {},
    dataExtras: {},
    selectedId: "",
    focusRootId: "",
    collapsedIds: [],
    ops: [],
    operationHighWater: 0,
  }));
  assert.equal(pip.restoreFromPipSnapshot(), true);
  assert.deepEqual(plain(pipState.nodes), []);
  assert.equal(pip.capturePocketFileSaveSession().pipSession, true);
  assert.equal(pip.canShowPocketTree(), true);
});

test("explicit Save persists deletion of the final node and clears only the covered safety state", async () => {
  const handle = fakeHandle("empty-pocket.json");
  const context = createUiIntegrationContext();
  const last = node("last", { label: "Last item" });
  const state = resetIntegrationState(context, [last]);
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([last])),
    { schema: "portal.export.v1", fileName: handle.name, writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);

  state.nodes = [];
  state.tombstones = [{ id: "last", deletedAt: "2026-07-20T00:00:00.000Z" }];
  context.recordOp({ type: "delete", id: "last" });
  const safetyBeforeSave = context.readLocalSafetySnapshot();
  assert.ok(safetyBeforeSave);
  assert.deepEqual(plain(safetyBeforeSave.norm.nodes), []);
  context.__productionRefreshMeta();
  assert.equal(context.__ui.elements.get("btnExportTree").disabled, false);

  const result = await context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(result.ok, true);
  assert.equal(handle.calls.write, 1);
  const written = JSON.parse(handle.calls.text[0]);
  assert.deepEqual(written.mainThoughtTree, []);
  assert.equal(written.mainThoughtTreeTombstones[0].id, "last");
  assert.deepEqual(plain(state.ops), []);
  assert.equal(context.readLocalSafetySnapshot(), null);
});

test("an empty-operations detached adoption retains its trustworthy BASE after creating the dirty marker", () => {
  const context = createIntegrationContext();
  const baseDocument = documentWith([node("shared", { label: "Base item" })]);
  const deviceDocument = documentWith([node("shared", { label: "Device item" })]);
  const state = resetIntegrationState(context, baseDocument.nodes);
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(baseDocument),
    { schema: "portal.export.v1", fileName: "base.json", writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  const baseline = plain(context.capturePocketDocumentBaseline());
  const stored = context.saveDetachedPocketSafetySnapshot(deviceDocument, baseline, {
    reason: "empty-ops-device",
    source: { schema: "portal.export.v1", fileName: "base.json" },
    ops: [],
    operationHighWater: 0,
  });
  assert.equal(stored.ok, true);
  const snapshot = context.readLocalSafetySnapshot();
  assert.ok(snapshot?.base);

  assert.equal(context.restoreLocalSafetySnapshot(snapshot), true);
  assert.equal(state.nodes[0].label, "Device item");
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].type, "device_changes_opened");
  const safetyAfterAdoption = context.readLocalSafetySnapshot();
  assert.ok(safetyAfterAdoption?.base);
  assert.equal(safetyAfterAdoption.base.fingerprint, baseline.fingerprint);
  assert.equal(state.detachedSafetyBase.fingerprint, baseline.fingerprint);
});

test("continued details typing refreshes the full DEVICE safety payload without creating another pending sequence", () => {
  const context = createIntegrationContext();
  const original = node("draft", { label: "Draft item", details: "Original Notes" });
  const state = resetIntegrationState(context, [original]);
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([original])),
    { schema: "portal.export.v1", fileName: "draft.json", writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  const controls = installDetailsEditorHarness(context, "draft", { body: "First draft Notes" });

  assert.equal(context.stageDetailsEditorDraft(), true);
  assert.equal(state.ops.length, 1);
  const pendingSequence = state.ops[0].seq;
  assert.equal(context.readLocalSafetySnapshot().norm.nodes[0].details, "First draft Notes");

  controls.body.value = "Second and latest draft Notes";
  assert.equal(context.stageDetailsEditorDraft(), true);
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].seq, pendingSequence);
  const latestSafety = context.readLocalSafetySnapshot();
  assert.ok(latestSafety);
  assert.equal(latestSafety.norm.nodes[0].details, "Second and latest draft Notes");
  assert.equal(latestSafety.parsed.deviceChanges.highestSequence, pendingSequence);
});

test("cancelling a continued details draft during a save race retains a post-save operation and safety copy", async () => {
  let releaseWrite;
  let signalWriteStarted;
  const writeStarted = new Promise((resolve) => { signalWriteStarted = resolve; });
  const heldWrite = new Promise((resolve) => { releaseWrite = resolve; });
  const handle = fakeHandle("details-race.json", {
    async onWrite() {
      signalWriteStarted();
      await heldWrite;
    },
  });
  const context = createIntegrationContext();
  const state = resetIntegrationState(context, [
    node("draft", { label: "Draft item", details: "Original Notes" }),
  ]);
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  assert.equal(context.establishPocketDocumentBaseline(
    payloadFromDocument(documentWith([
      node("draft", { label: "Draft item", details: "Original Notes" }),
    ])),
    { schema: "portal.export.v1", fileName: handle.name, writtenAt: "2026-07-01T00:00:00.000Z" },
  ), true);
  const controls = installDetailsEditorHarness(context, "draft", { body: "Draft at save start" });
  assert.equal(context.stageDetailsEditorDraft(), true);
  const coveredSequence = state.detailsEdit.draftOperationSequence;

  const saving = context.exportTree({ returnDetails: true, downloadFallback: false });
  await writeStarted;
  assert.equal(state.activeSaveOperationCeiling, coveredSequence);
  controls.body.value = "Continued draft during write";
  assert.equal(context.stageDetailsEditorDraft(), true);
  assert.ok(state.detailsEdit.draftOperationSequence > coveredSequence);
  assert.equal(state.detailsEdit.draftHadCoveredSave, true);
  context.closeDetailsEditor({ revertDraft: true, restoreFocus: false });
  assert.equal(state.nodes[0].details, "Original Notes");
  assert.ok(state.ops.some((operation) =>
    operation.type === "details_draft_reverted" && operation.seq > coveredSequence));

  releaseWrite();
  const result = await saving;
  assert.equal(result.ok, true);
  const written = JSON.parse(handle.calls.text[0]);
  assert.equal(written.mainThoughtTree[0].details, "Draft at save start");
  assert.equal(state.nodes[0].details, "Original Notes");
  assert.ok(state.ops.length >= 1);
  assert.ok(state.ops.every((operation) => operation.seq > coveredSequence));
  assert.ok(state.ops.some((operation) => operation.type === "details_draft_reverted"));
  const safety = context.readLocalSafetySnapshot();
  assert.ok(safety);
  assert.equal(safety.norm.nodes[0].details, "Original Notes");
});

test("PiP adoption is rejected without mutation while the file/device decision is open", () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("shared", { label: "Selected file item", details: "Selected Notes" }),
  ]);
  const handle = fakeHandle("selected.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  const identity = plain(context.capturePocketEditorSourceIdentity());
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device item", details: "Device Notes" }),
  ]));
  assert.equal(context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  }), true);

  const adopted = context.adoptPocketDocumentFromPip({
    nodes: [node("shared", { label: "PiP item", details: "PiP Notes" })],
    ops: [{ type: "pip-edit", seq: 7 }],
    operationHighWater: 7,
  });
  assert.equal(adopted, false);
  assert.equal(state.nodes[0].label, "Selected file item");
  assert.equal(state.nodes[0].details, "Selected Notes");
  assert.deepEqual(plain(state.ops), []);
  assert.equal(context.capturePocketEditorSourceIdentity().fileSessionId, identity.fileSessionId);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
  assert.equal(handle.calls.createWritable, 0);
  assert.equal(context.isPocketDeviceChangesDecisionOpen(), true);
});

test("PiP host-save coverage includes the details operation created by commitDetails", async () => {
  let received = null;
  const host = {
    async __pocketLiteSaveFromPip(snapshot) {
      received = plain(snapshot);
      return { ok: true };
    },
  };
  const context = createIntegrationContext({
    href: "https://example.test/index.html?pip=1",
    parent: host,
  });
  const state = resetIntegrationState(context, [
    node("pip-draft", { label: "PiP item", details: "Original Notes" }),
  ]);
  context.setPocketFileSession(null, "Pocket popout", {
    pipSession: true,
    forceNewSession: true,
  });
  installDetailsEditorHarness(context, "pip-draft", { body: "Committed from PiP" });

  const saved = await context.saveThroughPipHost();
  assert.equal(saved, true);
  assert.ok(received);
  assert.equal(received.nodes[0].details, "Committed from PiP");
  assert.equal(received.ops.length, 1);
  assert.equal(received.ops[0].type, "details_edit");
  assert.ok(Number.isSafeInteger(received.ops[0].seq) && received.ops[0].seq > 0);
  assert.equal(received.operationHighWater, received.ops[0].seq);
  assert.deepEqual(plain(state.ops), []);
});

test("the decision overlay has the required accessible structure and calm Pocket wording", () => {
  const html = source("index.html");
  const start = html.indexOf('<div id="deviceChangesOverlay"');
  const end = html.indexOf('<div id="controlsOverlay"', start);
  assert.ok(start >= 0 && end > start);
  const overlay = html.slice(start, end);

  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-modal="true"/);
  assert.match(overlay, /aria-labelledby="deviceChangesTitle"/);
  assert.match(overlay, /Pocket found changes on this device that aren’t in the file you opened\./);
  assert.match(overlay, /How would you like to handle the difference\?/);
  assert.match(overlay, /Use the file/);
  assert.match(overlay, /Open the version in the file you chose\./);
  assert.match(overlay, /Use the device changes/);
  assert.match(overlay, /Open the changes Pocket kept safe on this device\./);
  assert.match(overlay, /Combine what can be combined/);
  assert.match(overlay, /Keep changes from both versions where Pocket can do that safely\./);
  assert.match(overlay, /Review the differences/);
  assert.match(overlay, /See what changed before deciding\./);
  assert.doesNotMatch(overlay, /aria-label="close"|class="[^"]*close/i);
  for (const internalTerm of [
    "recovery snapshot",
    "truth-file connection",
    "document ownership",
    "stale handle",
    "three-way merge",
    "merge base",
    "conflict object",
  ]) {
    assert.equal(overlay.toLowerCase().includes(internalTerm), false, internalTerm);
  }
});

test("no safety copy and semantically identical safety content do not open the decision screen", () => {
  const context = createUiIntegrationContext();
  const fileNodes = [node("same", { label: "Same title", details: "Same Notes" })];
  resetIntegrationState(context, fileNodes);
  const handle = fakeHandle("same.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });

  assert.equal(context.reviewCurrentPocketDeviceChanges({ origin: "test" }), false);
  assert.equal(context.__ui.overlay.hidden, true);

  const device = documentWith([
    node("same", {
      label: "Same title",
      details: "Same Notes",
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
  ]);
  const snapshot = safetySnapshotFor(context, device);
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshot.parsed));
  const opened = context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  });

  assert.equal(opened, false);
  assert.equal(context.__ui.overlay.hidden, true);
  assert.equal(context.isPocketDeviceChangesDecisionOpen(), false);
  assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), false);
  assert.equal(handle.calls.createWritable, 0);
});

test("an actual selected-file load opens the shared decision screen for meaningful device differences without writing", async () => {
  const context = createUiIntegrationContext();
  resetIntegrationState(context, []);
  const fileDocument = documentWith([
    node("shared", { label: "File title", details: "File Notes" }),
  ]);
  const filePayload = payloadFromDocument(fileDocument, "2026-07-15T00:00:00.000Z");
  const file = {
    name: "selected.json",
    async text() {
      return JSON.stringify(filePayload);
    },
  };
  const handle = fakeHandle(file.name, { file });
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device title", details: "Device Notes" }),
  ]), {
    sourceFileName: "another-source.json",
  });
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshot.parsed));

  const loaded = await context.loadFromFileHandle(handle, { displayName: file.name });

  assert.equal(loaded, true);
  assert.equal(context.isPocketDeviceChangesDecisionOpen(), true);
  assert.equal(context.__ui.overlay.hidden, false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
  assert.equal(lexicalState(context).nodes[0].label, "File title");
  assert.equal(handle.calls.createWritable, 0);
  assert.equal(context.__surfaceCalls.picker, 0);
});

test("ambiguous top-level and nested FILE nodes or tombstones disable combination while keeping review and either version available", async () => {
  const context = createUiIntegrationContext();
  resetIntegrationState(context, []);
  const base = documentWith([
    node("shared", { label: "Base title", details: "Base Notes" }),
  ]);
  const topTree = plain(base.nodes);
  topTree[0].label = "Top-level file title";
  const nestedTree = plain(base.nodes);
  nestedTree[0].label = "Different nested title";
  const filePayload = payloadFromDocument(documentWith(topTree), "2026-07-15T00:00:00.000Z");
  filePayload.data.mainThoughtTree = nestedTree;
  const file = {
    name: "ambiguous.json",
    async text() {
      return JSON.stringify(filePayload);
    },
  };
  const handle = fakeHandle(file.name, { file });
  const device = plain(base);
  byId(device).get("shared").details = "Device Notes";
  const snapshot = safetySnapshotFor(context, device, { base });
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshot.parsed));
  const comparison = plain(context.buildLoadedPocketComparisonDocument(
    context.normaliseInput(filePayload),
    filePayload,
  ));
  assert.equal(comparison.schema, "pocket.deviceChanges.comparisonInput.v1");
  assert.equal(comparison.combinationSafe, false);
  assert.ok(context.readLocalSafetySnapshot().base);

  const tombstoneAmbiguity = payloadFromDocument(base, "2026-07-15T00:00:00.000Z");
  tombstoneAmbiguity.mainThoughtTreeTombstones = [
    { id: "top_removed", deletedAt: "2026-07-14T00:00:00.000Z" },
  ];
  tombstoneAmbiguity.data.mainThoughtTreeTombstones = [
    { id: "nested_removed", deletedAt: "2026-07-14T00:00:00.000Z" },
  ];
  const tombstoneComparison = plain(context.buildLoadedPocketComparisonDocument(
    context.normaliseInput(tombstoneAmbiguity),
    tombstoneAmbiguity,
  ));
  assert.equal(tombstoneComparison.combinationSafe, false);

  const loaded = await context.loadFromFileHandle(handle, { displayName: file.name });

  assert.equal(loaded, true);
  assert.equal(context.isPocketDeviceChangesDecisionOpen(), true);
  assert.equal(context.__ui.elements.get("deviceChangesCombine").disabled, true);
  assert.equal(context.__ui.elements.get("deviceChangesNotice").textContent, UNSAFE_COMBINATION_MESSAGE);
  assert.equal(context.__ui.elements.get("deviceChangesUseFile").disabled, false);
  assert.equal(context.__ui.elements.get("deviceChangesUseDevice").disabled, false);
  context.__ui.elements.get("deviceChangesReviewBtn").click();
  assert.equal(context.__ui.elements.get("deviceChangesReview").hidden, false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
  assert.equal(handle.calls.createWritable, 0);
});

test("Use the file keeps the selected session and tree, writes nothing, clears only the current safety copy, and preserves the trail", () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("shared", { label: "File title", details: "File Notes" }),
  ]);
  const fileBefore = plain(state.nodes);
  const handle = fakeHandle("selected.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device title", details: "Device Notes" }),
  ]));
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshot.parsed));

  const opened = context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  });

  assert.equal(opened, true);
  assert.equal(context.__ui.overlay.hidden, false);
  assert.equal(context.__ui.background.inert, true);
  assert.strictEqual(context.document.activeElement, context.__ui.elements.get("deviceChangesUseFile"));
  assert.equal(context.canModifyPocket(), false);
  assert.equal(handle.calls.createWritable, 0);

  context.__ui.elements.get("deviceChangesUseFile").click();

  assert.equal(context.__ui.overlay.hidden, true);
  assert.equal(context.__ui.background.inert, false);
  assert.deepEqual(plain(state.nodes), fileBefore);
  const sessionAfter = context.capturePocketFileSaveSession();
  assert.strictEqual(sessionAfter.handle, sessionBefore.handle);
  assert.equal(sessionAfter.id, sessionBefore.id);
  assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), false);
  assert.ok(context.readLocalSafetyTrail().length >= 1);
  assert.equal(handle.calls.createWritable, 0);
  assert.equal(context.__surfaceCalls.statuses.at(-1).message, "Opened the file.");
});

test("Use the file fails closed instead of discarding the only device copy when the trail cannot preserve it", () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("shared", { label: "File title", details: "File Notes" }),
  ]);
  const handle = fakeHandle("selected.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device title", details: "Device Notes" }),
  ]));
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshot.parsed));
  context.appendLocalSafetyTrail = () => false;
  context.readLocalSafetyTrail = () => [];

  assert.equal(context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  }), true);
  context.__ui.elements.get("deviceChangesUseFile").click();

  assert.equal(context.isPocketDeviceChangesDecisionOpen(), true);
  assert.equal(context.__ui.overlay.hidden, false);
  assert.equal(state.nodes[0].label, "File title");
  assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
  assert.equal(handle.calls.createWritable, 0);
  assert.match(context.__ui.elements.get("deviceChangesNotice").textContent, /Nothing was changed/);
});

test("Use the file may preserve a BASE-heavy device version in the trail without BASE before clearing the current copy", () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("shared", { label: "File title", details: "File Notes" }),
  ]);
  const handle = fakeHandle("selected.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  const base = documentWith([
    node("shared", { label: "Base title", details: "Base Notes" }),
  ]);
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device title", details: "Device Notes" }),
  ]), { base });
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshot.parsed));
  let storedWithoutBase = null;
  context.appendLocalSafetyTrail = (entry) => {
    if (Object.hasOwn(entry, "base")) return false;
    storedWithoutBase = plain(entry);
    return true;
  };

  assert.equal(context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  }), true);
  context.__ui.elements.get("deviceChangesUseFile").click();

  assert.equal(context.isPocketDeviceChangesDecisionOpen(), false);
  assert.equal(state.nodes[0].label, "File title");
  assert.ok(storedWithoutBase);
  assert.equal(Object.hasOwn(storedWithoutBase, "base"), false);
  assert.equal(context.PocketDeviceChanges.documentsEqual(
    storedWithoutBase.payload,
    snapshot.parsed.payload,
  ), true);
  assert.equal(context.__storage.has("pocketLite.localSafety.snapshot.v1"), false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
  assert.equal(handle.calls.createWritable, 0);
});

test("Use the device changes opens a detached dirty document and gives the selected file zero write authority", () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("shared", { label: "File title", details: "File Notes" }),
  ]);
  const oldHandle = fakeHandle("selected.json");
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  const oldIdentity = plain(context.capturePocketEditorSourceIdentity());
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device title", details: "Device Notes" }),
  ]), {
    ops: [{ type: "device-edit" }],
  });

  assert.equal(context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  }), true);
  context.__ui.elements.get("deviceChangesUseDevice").click();

  assert.equal(context.__ui.overlay.hidden, true);
  assert.equal(state.nodes[0].label, "Device title");
  assert.equal(state.nodes[0].details, "Device Notes");
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].type, "device-edit");
  assert.ok(Number.isSafeInteger(state.ops[0].seq) && state.ops[0].seq > 0);
  const detached = context.capturePocketFileSaveSession();
  assert.equal(detached.handle, null);
  assert.equal(detached.detachedDeviceChanges, true);
  assert.equal(context.isPocketEditorSourceIdentityCurrent(oldIdentity), false);
  assert.equal(context.canShowPocketTree(), true);
  assert.equal(context.canModifyPocket(), true);
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.ok(context.readLocalSafetySnapshot());
  assert.equal(context.__surfaceCalls.statuses.at(-1).message, "Device changes opened. Save when ready.");
});

test("legacy safety without BASE keeps review and either version available while disabling Combine with the exact explanation", () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("shared", { label: "File title", details: "File Notes" }),
  ]);
  const handle = fakeHandle("legacy.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device title", details: "Device Notes" }),
  ]));
  assert.equal(snapshot.base, null);

  assert.equal(context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  }), true);
  const combine = context.__ui.elements.get("deviceChangesCombine");
  assert.equal(combine.disabled, true);
  assert.equal(context.__ui.elements.get("deviceChangesNotice").textContent, NO_BASE_MESSAGE);

  context.__ui.elements.get("deviceChangesReviewBtn").click();
  assert.equal(context.__ui.elements.get("deviceChangesReview").hidden, false);
  assert.equal(context.__ui.elements.get("deviceChangesBack").hidden, false);
  assert.match(context.__ui.elements.get("deviceChangesReviewList").textContent, /shared|File title|Device title/i);
  assert.doesNotMatch(context.__ui.elements.get("deviceChangesReviewList").textContent, /[{[]/);
  context.__ui.elements.get("deviceChangesBack").click();
  assert.equal(context.__ui.elements.get("deviceChangesReview").hidden, true);

  context.__ui.elements.get("deviceChangesUseFile").click();
  assert.equal(state.nodes[0].label, "File title");
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
  assert.equal(handle.calls.createWritable, 0);
});

test("automatic combination opens a detached dirty result with independent file and device changes", () => {
  const context = createUiIntegrationContext();
  const base = documentWith([
    node("shared", { label: "Base title", details: "Base Notes" }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("shared").label = "File title";
  byId(device).get("shared").details = "Device Notes";
  const state = resetIntegrationState(context, file.nodes);
  const oldHandle = fakeHandle("file.json");
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  const snapshot = safetySnapshotFor(context, device, { base });

  assert.equal(context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  }), true);
  assert.equal(context.__ui.elements.get("deviceChangesCombine").disabled, false);
  context.__ui.elements.get("deviceChangesCombine").click();

  assert.equal(context.__ui.overlay.hidden, true);
  assert.equal(state.nodes[0].label, "File title");
  assert.equal(state.nodes[0].details, "Device Notes");
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].type, "combined_device_changes_opened");
  const detached = context.capturePocketFileSaveSession();
  assert.equal(detached.handle, null);
  assert.equal(detached.detachedDeviceChanges, true);
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.ok(context.readLocalSafetySnapshot());
  assert.equal(
    context.__surfaceCalls.statuses.at(-1).message,
    "Pocket combined the changes. Nothing else needs your choice. Combined changes opened. Save when ready.",
  );
});

test("automatic combination fails closed when the combined device safety copy cannot be stored", () => {
  const context = createUiIntegrationContext({
    failStorageWrite(key) {
      return key === "pocketLite.localSafety.snapshot.v1";
    },
  });
  const base = documentWith([
    node("shared", { label: "Base title", details: "Base Notes" }),
  ]);
  const file = plain(base);
  const device = plain(base);
  byId(file).get("shared").label = "File title";
  byId(device).get("shared").details = "Device Notes";
  const state = resetIntegrationState(context, file.nodes);
  const fileBefore = plain(state.nodes);
  const oldHandle = fakeHandle("file.json");
  context.setPocketFileSession(oldHandle, oldHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const snapshot = safetySnapshotFor(context, device, { base });

  assert.equal(context.openPocketDeviceChangesDecision(snapshot, {
    origin: "file-load",
    candidateKind: "current-safety",
  }), true);
  context.__ui.elements.get("deviceChangesCombine").click();

  assert.equal(context.isPocketDeviceChangesDecisionOpen(), true);
  assert.equal(context.__ui.overlay.hidden, false);
  assert.deepEqual(plain(state.nodes), fileBefore);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, sessionBefore.handle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.equal(oldHandle.calls.createWritable, 0);
  assert.match(context.__ui.elements.get("deviceChangesNotice").textContent, /Nothing was changed/);
});

test("the difference-choice UI supports Keep both and excludes it for delete-versus-edit", () => {
  {
    const context = createUiIntegrationContext();
    const base = documentWith([node("shared", { label: "Base title", details: "Base Notes" })]);
    const file = plain(base);
    const device = plain(base);
    byId(file).get("shared").label = "File title";
    byId(device).get("shared").label = "Device title";
    const state = resetIntegrationState(context, file.nodes);
    const handle = fakeHandle("choice.json");
    context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
    const snapshot = safetySnapshotFor(context, device, { base });
    assert.equal(context.openPocketDeviceChangesDecision(snapshot, { candidateKind: "current-safety" }), true);
    context.__ui.elements.get("deviceChangesCombine").click();
    const actions = context.__ui.elements.get("deviceChangesChoiceActions");
    assert.match(actions.textContent, /Use the file version/);
    assert.match(actions.textContent, /Use the device version/);
    assert.match(actions.textContent, /Keep both/);
    const keepBoth = actions.children.find((button) => button.textContent === "Keep both");
    assert.ok(keepBoth);
    keepBoth.click();
    assert.equal(context.__ui.overlay.hidden, true);
    assert.equal(state.nodes.length, 2);
    assert.equal(new Set(state.nodes.map((item) => item.id)).size, 2);
    assert.equal(state.nodes.some((item) => item.id === "shared" && item.label === "File title"), true);
    assert.equal(state.nodes.some((item) => item.id !== "shared" && item.label === "Device title"), true);
    assert.equal(handle.calls.createWritable, 0);
  }

  {
    const context = createUiIntegrationContext();
    const base = documentWith([
      node("anchor_one"),
      node("anchor_two"),
      node("anchor_three"),
      node("removed_or_edited", { label: "Target", details: "Base Notes" }),
    ]);
    const file = plain(base);
    const device = plain(base);
    file.nodes = file.nodes.filter((item) => item.id !== "removed_or_edited");
    byId(device).get("removed_or_edited").details = "Device edit";
    resetIntegrationState(context, file.nodes);
    context.setPocketFileSession(fakeHandle("delete-edit.json"), "delete-edit.json", { forceNewSession: true });
    const snapshot = safetySnapshotFor(context, device, { base });
    assert.equal(context.openPocketDeviceChangesDecision(snapshot, { candidateKind: "current-safety" }), true);
    context.__ui.elements.get("deviceChangesCombine").click();
    const actions = context.__ui.elements.get("deviceChangesChoiceActions");
    assert.match(actions.textContent, /Keep the item/);
    assert.match(actions.textContent, /Leave it removed/);
    assert.doesNotMatch(actions.textContent, /Keep both/);
  }
});

test("the modal traps focus, ignores Escape as a choice, and blocks Save shortcuts while open", () => {
  const context = createUiIntegrationContext();
  resetIntegrationState(context, [node("shared", { label: "File" })], [{ type: "file-edit" }]);
  const handle = fakeHandle("keyboard.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  const snapshot = safetySnapshotFor(context, documentWith([
    node("shared", { label: "Device" }),
  ]));
  assert.equal(context.openPocketDeviceChangesDecision(snapshot, { candidateKind: "current-safety" }), true);
  const useFile = context.__ui.elements.get("deviceChangesUseFile");
  const useDevice = context.__ui.elements.get("deviceChangesUseDevice");
  assert.strictEqual(context.document.activeElement, useFile);

  const tab = context.__dispatchWindowKey({ key: "Tab", target: useFile });
  assert.equal(tab.defaultPrevented, true);
  assert.strictEqual(context.document.activeElement, useDevice);
  const shiftTab = context.__dispatchWindowKey({ key: "Tab", shiftKey: true, target: useDevice });
  assert.equal(shiftTab.defaultPrevented, true);
  assert.strictEqual(context.document.activeElement, useFile);
  useDevice.focus();
  const escape = context.__dispatchWindowKey({ key: "Escape", target: useDevice });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(context.isPocketDeviceChangesDecisionOpen(), true);
  assert.strictEqual(context.document.activeElement, useFile);
  const save = context.__dispatchWindowKey({ key: "s", metaKey: true, target: useFile });
  assert.equal(save.defaultPrevented, true);
  assert.equal(context.__surfaceCalls.picker, 0);
  assert.equal(handle.calls.createWritable, 0);
});

test("P017: pending permission for File B stays visible over active File A without changing ownership", async () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("file_a", { label: "File A item", details: "Unsaved File A Notes" }),
  ], [{ type: "file-a-edit", seq: 1 }]);
  const fileABefore = plain(state.nodes);
  const opsBefore = plain(state.ops);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const identityBefore = plain(context.capturePocketEditorSourceIdentity());
  const fileBPayload = payloadFromDocument(documentWith([
    node("file_b", { label: "File B item" }),
  ]));
  const fileBHandle = fakeHandle("file-b.json", {
    queryPermission: "prompt",
    file: {
      name: "file-b.json",
      async text() { return JSON.stringify(fileBPayload); },
    },
  });

  const loaded = await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });

  assert.equal(loaded, false);
  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  assert.equal(context.__ui.permissionOverlay.hidden, false);
  assert.equal(context.__ui.elements.get("filePermissionFileName").textContent, "file-b.json");
  assert.equal(context.__ui.background.inert, true);
  assert.deepEqual(plain(state.nodes), fileABefore);
  assert.deepEqual(plain(state.ops), opsBefore);
  const sessionPending = context.capturePocketFileSaveSession();
  assert.strictEqual(sessionPending.handle, fileAHandle);
  assert.equal(sessionPending.id, sessionBefore.id);
  assert.deepEqual(plain(context.capturePocketEditorSourceIdentity()), identityBefore);
  assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), fileBHandle);
  assert.equal(context.canShowPocketTree(), true);
  assert.equal(context.canModifyPocket(), false);
  assert.equal(fileBHandle.calls.getFile, 0);
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
  assert.strictEqual(
    context.document.activeElement,
    context.__ui.elements.get("filePermissionContinue"),
  );
});

test("P017: the canonical permission gate blocks tree, Save, popout, open, and create actions", async () => {
  const context = createUiIntegrationContext({
    pickOpenHandles() {
      throw new Error("permission gate must block another open picker");
    },
    pickSaveHandle() {
      throw new Error("permission gate must block a save picker");
    },
  });
  const state = resetIntegrationState(context, [
    node("file_a_one", { label: "File A one", order: 1001 }),
    node("file_a_two", { label: "File A two", order: 1002 }),
  ], [{ type: "file-a-edit", seq: 1 }]);
  const nodesBefore = plain(state.nodes);
  const opsBefore = plain(state.ops);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const fileBHandle = fakeHandle("file-b.json", {
    queryPermission: "prompt",
    file: {
      name: "file-b.json",
      async text() { return JSON.stringify(payloadFromDocument(documentWith([node("file_b")]))); },
    },
  });
  await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });
  vm.runInContext(source("js/pocket-tree-actions.js"), context, {
    filename: "js/pocket-tree-actions.js",
  });

  context.insertSiblingBelow("file_a_one");
  context.moveNodeWithinSiblings("file_a_one", "down");
  context.deleteNodeById("file_a_one", { confirm: false });
  assert.equal(context.PocketNodePopoutEditor.open("file_a_one"), false);
  const peApplyResult = context.PocketNodePopoutEditor.apply({}, { returnDetails: true });
  await context.openPipWindow();
  assert.equal(await context.openPocketFile(), false);
  assert.equal(await context.createNewPocketFile(), false);
  const saveResult = await context.exportTree({ returnDetails: true });
  const saveKey = context.__dispatchWindowKey({
    key: "s",
    metaKey: true,
    target: context.__ui.elements.get("filePermissionContinue"),
  });

  assert.deepEqual(plain(state.nodes), nodesBefore);
  assert.deepEqual(plain(state.ops), opsBefore);
  assert.equal(saveResult.ok, false);
  assert.equal(saveResult.reason, "file-permission-pending");
  assert.equal(peApplyResult.ok, false);
  assert.equal(peApplyResult.reason, "file-permission-pending");
  assert.equal(saveKey.defaultPrevented, true);
  assert.equal(context.__surfaceCalls.openPicker, 0);
  assert.equal(context.__surfaceCalls.picker, 0);
  assert.equal(context.__surfaceCalls.popupOpen, 0);
  assert.equal(context.__surfaceCalls.persistPip, 0);
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
});

test("P017: Continue is single-flight and File A stays active until delayed valid File B adoption", async () => {
  const permission = deferred();
  const fileText = deferred();
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("file_a", { label: "File A item" }),
  ], [{ type: "file-a-edit", seq: 1 }]);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const fileBPayload = payloadFromDocument(documentWith([
    node("file_b", { label: "File B item", details: "File B Notes" }),
  ]));
  const fileBHandle = fakeHandle("file-b.json", {
    queryPermission: "prompt",
    requestPermission() { return permission.promise; },
    file: {
      name: "file-b.json",
      text() { return fileText.promise; },
    },
  });
  await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });
  let refocusCalls = 0;
  context.refocusTreeNavigation = () => { refocusCalls += 1; };

  const first = context.continuePocketFilePermissionRequest();
  const duplicate = context.continuePocketFilePermissionRequest();
  assert.equal(await duplicate, false);
  assert.equal(fileBHandle.calls.requestPermission, 1);
  assert.equal(context.__ui.elements.get("filePermissionContinue").disabled, true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);

  permission.resolve("granted");
  assert.equal(await waitFor(() => fileBHandle.calls.getFile === 1), true);
  assert.equal(fileBHandle.calls.getFile, 1);
  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  assert.equal(context.__ui.permissionOverlay.hidden, false);
  assert.equal(context.canModifyPocket(), false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.equal(state.nodes[0].label, "File A item");

  fileText.resolve(JSON.stringify(fileBPayload));
  assert.equal(await first, true);
  assert.equal(context.isPocketFilePermissionPromptOpen(), false);
  assert.equal(context.__ui.permissionOverlay.hidden, true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileBHandle);
  assert.ok(context.capturePocketFileSaveSession().id > sessionBefore.id);
  assert.equal(state.nodes[0].label, "File B item");
  assert.equal(state.nodes[0].details, "File B Notes");
  assert.equal(fileBHandle.calls.requestPermission, 1);
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
  assert.equal(refocusCalls, 1);
});

test("P017: denial, dismissal, and permission failure leave File A exactly unchanged", async () => {
  const cases = [
    {
      label: "denied",
      requestPermission: "denied",
    },
    {
      label: "dismissed",
      requestPermission() {
        throw Object.assign(new Error("synthetic permission dismissal"), { name: "AbortError" });
      },
    },
    {
      label: "failed",
      requestPermission() {
        throw Object.assign(new Error("synthetic permission failure"), { name: "NotAllowedError" });
      },
    },
  ];

  for (const scenario of cases) {
    const context = createUiIntegrationContext();
    const state = resetIntegrationState(context, [
      node(`file_a_${scenario.label}`, { label: "File A item", details: "Unsaved A" }),
    ], [{ type: "file-a-edit", seq: 7 }]);
    const nodesBefore = plain(state.nodes);
    const opsBefore = plain(state.ops);
    const fileAHandle = fakeHandle("file-a.json");
    context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
    const sessionBefore = context.capturePocketFileSaveSession();
    const fileBHandle = fakeHandle("file-b.json", {
      queryPermission: "prompt",
      requestPermission: scenario.requestPermission,
      file: {
        name: "file-b.json",
        async text() { return JSON.stringify(payloadFromDocument(documentWith([node("file_b")]))); },
      },
    });
    await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });

    assert.equal(
      await context.continuePocketFilePermissionRequest(),
      false,
      scenario.label,
    );
    assert.equal(context.isPocketFilePermissionPromptOpen(), false, scenario.label);
    assert.equal(context.__ui.permissionOverlay.hidden, true, scenario.label);
    assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), null, scenario.label);
    assert.equal(lexicalState(context).pocketFile.pendingName, "", scenario.label);
    assert.deepEqual(plain(state.nodes), nodesBefore, scenario.label);
    assert.deepEqual(plain(state.ops), opsBefore, scenario.label);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle, scenario.label);
    assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id, scenario.label);
    assert.equal(fileBHandle.calls.getFile, 0, scenario.label);
    assert.equal(fileAHandle.calls.createWritable, 0, scenario.label);
    assert.equal(fileBHandle.calls.createWritable, 0, scenario.label);
    assert.equal(context.__surfaceCalls.picker, 0, scenario.label);
    assert.equal(
      context.__surfaceCalls.statuses.at(-1).message,
      "That file was not opened. Your current Pocket file is unchanged.",
      scenario.label,
    );
  }
});

test("P017: Cancel and Escape clear only pending File B and never request permission", async () => {
  for (const action of ["button", "escape"]) {
    const context = createUiIntegrationContext();
    const state = resetIntegrationState(context, [
      node(`file_a_${action}`, { label: "File A item", details: "Unsaved A" }),
    ], [{ type: "file-a-edit", seq: 2 }]);
    const nodesBefore = plain(state.nodes);
    const opsBefore = plain(state.ops);
    const fileAHandle = fakeHandle("file-a.json");
    context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
    const sessionBefore = context.capturePocketFileSaveSession();
    let refocusCalls = 0;
    context.refocusTreeNavigation = () => { refocusCalls += 1; };
    const fileBHandle = fakeHandle("file-b.json", {
      queryPermission: "prompt",
      requestPermission: "granted",
    });
    await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });

    if (action === "button") {
      context.__ui.elements.get("filePermissionCancel").click();
    } else {
      const event = context.__dispatchWindowKey({
        key: "Escape",
        target: context.__ui.elements.get("filePermissionContinue"),
      });
      assert.equal(event.defaultPrevented, true);
    }

    assert.equal(context.isPocketFilePermissionPromptOpen(), false, action);
    assert.equal(context.__ui.permissionOverlay.hidden, true, action);
    assert.equal(context.__ui.background.inert, false, action);
    assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), null, action);
    assert.deepEqual(plain(state.nodes), nodesBefore, action);
    assert.deepEqual(plain(state.ops), opsBefore, action);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle, action);
    assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id, action);
    assert.equal(fileBHandle.calls.requestPermission, 0, action);
    assert.equal(fileBHandle.calls.getFile, 0, action);
    assert.equal(fileAHandle.calls.createWritable, 0, action);
    assert.equal(fileBHandle.calls.createWritable, 0, action);
    assert.equal(refocusCalls, 1, action);
    assert.equal(
      context.__surfaceCalls.statuses.at(-1).message,
      "Open cancelled. Your current Pocket file is unchanged.",
      action,
    );
  }
});

test("P017: read and parse failures after permission grant never adopt File B", async () => {
  const cases = [
    {
      label: "getFile failure",
      getFile() { throw new Error("synthetic getFile failure"); },
    },
    {
      label: "file text failure",
      file: {
        name: "file-b.json",
        async text() { throw new Error("synthetic read failure"); },
      },
    },
    {
      label: "invalid JSON",
      file: {
        name: "file-b.json",
        async text() { return "{ definitely not Pocket JSON"; },
      },
    },
  ];

  for (const scenario of cases) {
    const context = createUiIntegrationContext();
    const state = resetIntegrationState(context, [
      node(`file_a_${scenario.label}`, { label: "File A item", details: "Unsaved A" }),
    ], [{ type: "file-a-edit", seq: 5 }]);
    const nodesBefore = plain(state.nodes);
    const opsBefore = plain(state.ops);
    const fileAHandle = fakeHandle("file-a.json");
    context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
    const sessionBefore = context.capturePocketFileSaveSession();
    const fileBHandle = fakeHandle("file-b.json", {
      queryPermission: "prompt",
      requestPermission: "granted",
      getFile: scenario.getFile,
      file: scenario.file,
    });
    await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });

    assert.equal(
      await context.continuePocketFilePermissionRequest(),
      false,
      scenario.label,
    );
    assert.equal(context.isPocketFilePermissionPromptOpen(), false, scenario.label);
    assert.equal(context.__ui.permissionOverlay.hidden, true, scenario.label);
    assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), null, scenario.label);
    assert.deepEqual(plain(state.nodes), nodesBefore, scenario.label);
    assert.deepEqual(plain(state.ops), opsBefore, scenario.label);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle, scenario.label);
    assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id, scenario.label);
    assert.equal(fileBHandle.calls.getFile, 1, scenario.label);
    assert.equal(fileAHandle.calls.createWritable, 0, scenario.label);
    assert.equal(fileBHandle.calls.createWritable, 0, scenario.label);
    assert.equal(context.__surfaceCalls.picker, 0, scenario.label);
    assert.equal(
      context.__surfaceCalls.statuses.at(-1).message,
      "That file was not opened. Your current Pocket file is unchanged.",
      scenario.label,
    );
  }
});

test("P017: initial open uses the same permission modal and exposes no editable tree before success", async () => {
  {
    const context = createUiIntegrationContext();
    resetIntegrationState(context, []);
    context.clearPocketFileSession();
    const fileBHandle = fakeHandle("initial.json", {
      queryPermission: "prompt",
      requestPermission: "granted",
    });

    await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });
    assert.equal(context.isPocketFilePermissionPromptOpen(), true);
    assert.equal(context.__ui.permissionOverlay.hidden, false);
    assert.equal(context.canShowPocketTree(), false);
    assert.equal(context.canModifyPocket(), false);
    context.__ui.elements.get("filePermissionCancel").click();
    assert.equal(context.isPocketFilePermissionPromptOpen(), false);
    assert.equal(context.canShowPocketTree(), false);
    assert.equal(context.canModifyPocket(), false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, null);
    assert.strictEqual(
      context.document.activeElement,
      context.__ui.elements.get("btnLoad"),
    );
  }

  {
    const context = createUiIntegrationContext();
    const state = resetIntegrationState(context, []);
    context.clearPocketFileSession();
    const payload = payloadFromDocument(documentWith([
      node("initial", { label: "Initial file item" }),
    ]));
    const fileBHandle = fakeHandle("initial.json", {
      queryPermission: "prompt",
      requestPermission: "granted",
      file: {
        name: "initial.json",
        async text() { return JSON.stringify(payload); },
      },
    });

    await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });
    assert.equal(context.canShowPocketTree(), false);
    assert.equal(await context.continuePocketFilePermissionRequest(), true);
    assert.equal(context.isPocketFilePermissionPromptOpen(), false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, fileBHandle);
    assert.equal(context.canShowPocketTree(), true);
    assert.equal(context.canModifyPocket(), true);
    assert.equal(state.nodes[0].label, "Initial file item");
    assert.equal(fileBHandle.calls.createWritable, 0);
  }
});

test("P017: successful File B permission closes before the existing P016 decision owner takes focus", async () => {
  const context = createUiIntegrationContext();
  const base = documentWith([
    node("shared", { label: "Base title", details: "Base Notes" }),
  ]);
  const fileB = plain(base);
  const device = plain(base);
  byId(fileB).get("shared").label = "File B title";
  byId(device).get("shared").details = "Device Notes";
  resetIntegrationState(context, [
    node("file_a", { label: "File A currently open" }),
  ], [{ type: "file-a-edit", seq: 4 }]);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const fileBPayload = payloadFromDocument(fileB, "2026-07-25T00:00:00.000Z");
  const fileBHandle = fakeHandle("file-b.json", {
    queryPermission: "prompt",
    requestPermission: "granted",
    file: {
      name: "file-b.json",
      async text() { return JSON.stringify(fileBPayload); },
    },
  });
  const snapshot = safetySnapshotFor(context, device, { base });
  context.__storage.set("pocketLite.localSafety.snapshot.v1", JSON.stringify(snapshot.parsed));
  await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });

  assert.equal(await context.continuePocketFilePermissionRequest(), true);
  assert.equal(context.isPocketFilePermissionPromptOpen(), false);
  assert.equal(context.__ui.permissionOverlay.hidden, true);
  assert.equal(context.isPocketDeviceChangesDecisionOpen(), true);
  assert.equal(context.__ui.overlay.hidden, false);
  assert.strictEqual(
    context.document.activeElement,
    context.__ui.elements.get("deviceChangesUseFile"),
  );
  assert.equal(context.__ui.elements.get("deviceChangesCombine").disabled, false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileBHandle);
  assert.equal(lexicalState(context).nodes[0].label, "File B title");
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
});

test("P017: identical filenames never make the pending handle active before successful load", async () => {
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("file_a", { label: "Same-name File A" }),
  ]);
  const fileAHandle = fakeHandle("pocket-data.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const fileBPayload = payloadFromDocument(documentWith([
    node("file_b", { label: "Same-name File B" }),
  ]));
  const fileBHandle = fakeHandle("pocket-data.json", {
    queryPermission: "prompt",
    requestPermission: "granted",
    file: {
      name: "pocket-data.json",
      async text() { return JSON.stringify(fileBPayload); },
    },
  });
  assert.notStrictEqual(fileAHandle, fileBHandle);

  await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), fileBHandle);
  assert.equal(state.nodes[0].label, "Same-name File A");

  assert.equal(await context.continuePocketFilePermissionRequest(), true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileBHandle);
  assert.ok(context.capturePocketFileSaveSession().id > sessionBefore.id);
  assert.equal(state.nodes[0].label, "Same-name File B");
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
});

test("P017: permission modal copy, focus trap, external-focus guard, and Escape are accessible and canonical", async () => {
  const html = source("index.html");
  const start = html.indexOf('<div id="filePermissionOverlay"');
  const end = html.indexOf('<div id="deviceChangesOverlay"', start);
  assert.ok(start >= 0 && end > start);
  const overlayHtml = html.slice(start, end);
  assert.match(overlayHtml, /role="dialog"/);
  assert.match(overlayHtml, /aria-modal="true"/);
  assert.match(overlayHtml, /aria-labelledby="filePermissionTitle"/);
  assert.match(
    overlayHtml,
    /aria-describedby="filePermissionBody filePermissionFileName filePermissionSupport"/,
  );
  assert.match(overlayHtml, /Let Pocket open this file/);
  assert.match(overlayHtml, /Chrome may ask if Pocket can save changes to the file you just chose\./);
  assert.match(overlayHtml, />File</);
  assert.match(overlayHtml, /id="filePermissionFileName"/);
  assert.match(overlayHtml, /Pocket will keep your current file open unless the new file opens successfully\./);
  assert.match(overlayHtml, />Continue</);
  assert.match(overlayHtml, />Cancel</);
  assert.doesNotMatch(overlayHtml, /aria-label="close"|class="[^"]*close/i);
  assert.equal((html.match(/id="filePermissionContinue"/g) || []).length, 1);
  assert.equal((html.match(/id="filePermissionCancel"/g) || []).length, 1);

  const context = createUiIntegrationContext();
  resetIntegrationState(context, [node("file_a")]);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const fileBHandle = fakeHandle("folder-b-file.json", {
    queryPermission: "prompt",
    requestPermission: "granted",
  });
  await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });
  const continueButton = context.__ui.elements.get("filePermissionContinue");
  const cancelButton = context.__ui.elements.get("filePermissionCancel");
  assert.strictEqual(context.document.activeElement, continueButton);

  const tab = context.__dispatchWindowKey({ key: "Tab", target: continueButton });
  assert.equal(tab.defaultPrevented, true);
  assert.strictEqual(context.document.activeElement, cancelButton);
  const wrap = context.__dispatchWindowKey({ key: "Tab", target: cancelButton });
  assert.equal(wrap.defaultPrevented, true);
  assert.strictEqual(context.document.activeElement, continueButton);
  const reverse = context.__dispatchWindowKey({
    key: "Tab",
    shiftKey: true,
    target: continueButton,
  });
  assert.equal(reverse.defaultPrevented, true);
  assert.strictEqual(context.document.activeElement, cancelButton);
  context.__ui.document.dispatch("focusin", { target: context.__ui.background });
  assert.strictEqual(context.document.activeElement, continueButton);
  const escape = context.__dispatchWindowKey({ key: "Escape", target: continueButton });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(fileBHandle.calls.requestPermission, 0);
  assert.equal(context.isPocketFilePermissionPromptOpen(), false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
});

test("P017: the no-file gate has no duplicate hidden Continue or Cancel permission owner", () => {
  const context = createUiIntegrationContext();
  resetIntegrationState(context, []);
  context.clearPocketFileSession();
  vm.runInContext(source("js/pocket-render.js"), context, {
    filename: "js/pocket-render.js",
  });
  const state = lexicalState(context);
  state.pocketFile.gateMode = "permission";
  state.pocketFile.pendingName = "pending.json";
  const gate = context.buildPocketFileGate();

  assert.match(gate.textContent, /PocketOpen an existing Pocket/);
  assert.match(gate.textContent, /Open/);
  assert.match(gate.textContent, /New/);
  assert.doesNotMatch(gate.textContent, /Continue|Cancel|Chrome may ask/);
  const renderSource = source("js/pocket-render.js");
  assert.doesNotMatch(renderSource, /continuePocketFilePermissionRequest/);
  assert.doesNotMatch(renderSource, /cancelPocketFilePermissionRequest/);
  assert.doesNotMatch(renderSource, /gate\.permission/);
});

test("P062 shell state follows proven Pocket ownership without changing the owner contract", () => {
  const context = createUiIntegrationContext();
  resetIntegrationState(context, []);
  context.clearPocketFileSession();
  context.__productionRefreshMeta();
  assert.equal(context.document.body.classList.contains("pocketShellClosed"), true);
  assert.equal(context.document.body.classList.contains("pocketShellOpen"), false);

  const handle = fakeHandle("p062-open.json");
  context.setPocketFileSession(handle, handle.name, { forceNewSession: true });
  context.__productionRefreshMeta();
  assert.equal(context.document.body.classList.contains("pocketShellClosed"), false);
  assert.equal(context.document.body.classList.contains("pocketShellOpen"), true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
});

test("P017: cancelling an in-flight permission request revokes its async adoption", async () => {
  const permission = deferred();
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("file_a", { label: "File A remains active", details: "Unsaved A" }),
  ], [{ type: "file-a-edit", seq: 3 }]);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const fileBHandle = fakeHandle("file-b.json", {
    queryPermission: "prompt",
    requestPermission() { return permission.promise; },
    file: {
      name: "file-b.json",
      async text() {
        return JSON.stringify(payloadFromDocument(documentWith([
          node("file_b", { label: "Stale File B" }),
        ])));
      },
    },
  });
  await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });

  const pendingRequest = context.continuePocketFilePermissionRequest();
  assert.equal(await waitFor(() => fileBHandle.calls.requestPermission === 1), true);
  context.cancelPocketFilePermissionRequest();
  permission.resolve("granted");

  assert.equal(await pendingRequest, false);
  assert.equal(context.isPocketFilePermissionPromptOpen(), false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.equal(state.nodes[0].label, "File A remains active");
  assert.equal(state.nodes[0].details, "Unsaved A");
  assert.equal(fileBHandle.calls.getFile, 0);
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
});

test("P017: a routine active-file session refresh cannot dismiss a pending candidate", async () => {
  const context = createUiIntegrationContext();
  resetIntegrationState(context, [node("file_a", { label: "File A" })]);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const fileBHandle = fakeHandle("file-b.json", { queryPermission: "prompt" });
  await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name });

  context.setPocketFileSession(fileAHandle, fileAHandle.name);

  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  assert.equal(context.__ui.permissionOverlay.hidden, false);
  assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), fileBHandle);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
});

test("P017: a granted concurrent candidate cannot overtake a visible permission decision", async () => {
  const grantedFileText = deferred();
  const context = createUiIntegrationContext();
  const state = resetIntegrationState(context, [
    node("file_a", { label: "File A remains active", details: "Unsaved A" }),
  ], [{ type: "file-a-edit", seq: 8 }]);
  const nodesBefore = plain(state.nodes);
  const opsBefore = plain(state.ops);
  const fileAHandle = fakeHandle("file-a.json");
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const grantedHandle = fakeHandle("already-granted.json", {
    queryPermission: "granted",
    file: {
      name: "already-granted.json",
      text() { return grantedFileText.promise; },
    },
  });
  const pendingHandle = fakeHandle("needs-permission.json", {
    queryPermission: "prompt",
  });

  const grantedLoad = context.loadFromFileHandle(grantedHandle, {
    displayName: grantedHandle.name,
  });
  assert.equal(await waitFor(() => grantedHandle.calls.getFile === 1), true);
  assert.equal(
    await context.loadFromFileHandle(pendingHandle, { displayName: pendingHandle.name }),
    false,
  );
  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), pendingHandle);

  grantedFileText.resolve(JSON.stringify(payloadFromDocument(documentWith([
    node("overtaking_file", { label: "Must not overtake" }),
  ]))));
  assert.equal(await grantedLoad, false);

  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), pendingHandle);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.deepEqual(plain(state.nodes), nodesBefore);
  assert.deepEqual(plain(state.ops), opsBefore);
  assert.equal(grantedHandle.calls.createWritable, 0);
  assert.equal(pendingHandle.calls.getFile, 0);
  assert.equal(pendingHandle.calls.createWritable, 0);
  assert.equal(fileAHandle.calls.createWritable, 0);
});

test("P017: an in-flight File A save cannot fall through to a picker after File B becomes pending", async () => {
  const activePermission = deferred();
  const context = createUiIntegrationContext({
    pickSaveHandle() {
      throw new Error("pending File B must block a fallback save picker");
    },
  });
  const state = resetIntegrationState(context, [
    node("file_a", { label: "File A", details: "Unsaved A" }),
  ], [{ type: "file-a-edit", seq: 11 }]);
  const opsBefore = plain(state.ops);
  const fileAHandle = fakeHandle("file-a.json", {
    queryPermission() { return activePermission.promise; },
    requestPermission: "denied",
  });
  context.setPocketFileSession(fileAHandle, fileAHandle.name, { forceNewSession: true });
  const sessionBefore = context.capturePocketFileSaveSession();
  const saveAttempt = context.exportTree({ returnDetails: true });
  assert.equal(await waitFor(() => fileAHandle.calls.queryPermission === 1), true);

  const fileBHandle = fakeHandle("file-b.json", { queryPermission: "prompt" });
  assert.equal(
    await context.loadFromFileHandle(fileBHandle, { displayName: fileBHandle.name }),
    false,
  );
  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  activePermission.resolve("denied");

  const result = await saveAttempt;
  assert.equal(result.ok, false);
  assert.equal(result.reason, "file-permission-pending");
  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  assert.strictEqual(vm.runInContext("pendingPocketFileHandle", context), fileBHandle);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, fileAHandle);
  assert.equal(context.capturePocketFileSaveSession().id, sessionBefore.id);
  assert.deepEqual(plain(state.ops), opsBefore);
  assert.equal(context.__surfaceCalls.picker, 0);
  assert.equal(fileAHandle.calls.createWritable, 0);
  assert.equal(fileAHandle.calls.write, 0);
  assert.equal(fileBHandle.calls.createWritable, 0);
  assert.equal(fileBHandle.calls.write, 0);
});

test("Phone mode invokes the shared difference review and never directly restores browser-held content", () => {
  const storage = new Map();
  const body = { classList: createClassList() };
  const button = {
    classList: createClassList(),
    dataset: {},
    setAttribute() {},
    addEventListener() {},
  };
  const more = {
    classList: createClassList(),
    dataset: {},
    setAttribute() {},
    addEventListener() {},
  };
  let reviewCalls = 0;
  let restoreCalls = 0;
  const state = { nodes: [node("phone", { label: "Current file" })] };
  const context = {
    window: null,
    globalThis: null,
    Date,
    document: {
      body,
      readyState: "loading",
      getElementById(id) {
        if (id === "btnPhoneMode") return button;
        if (id === "btnMore") return more;
        return null;
      },
      querySelector() { return null; },
      createElement() { throw new Error("unexpected element creation"); },
      addEventListener() {},
    },
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    canShowPocketTree() { return true; },
    readLocalSafetySnapshot() { return { synthetic: true }; },
    reviewCurrentPocketDeviceChanges(options) {
      reviewCalls += 1;
      assert.equal(options.origin, "phone-mode");
      return true;
    },
    restoreLocalSafetySnapshot() {
      restoreCalls += 1;
      state.nodes = [node("wrong", { label: "Silently restored" })];
      return true;
    },
    state,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source("js/pocket-phone-mode.js"), context, { filename: "js/pocket-phone-mode.js" });

  context.PocketPhoneMode.set(true);

  assert.equal(reviewCalls, 1);
  assert.equal(restoreCalls, 0);
  assert.equal(state.nodes[0].label, "Current file");
  assert.equal(body.classList.contains("phoneMode"), true);
});

test("Phone mode auto-enters only for coarse phone-sized input and remains ephemeral", () => {
  const makeContext = ({ saved = null, matches = false, throws = false } = {}) => {
    const storage = new Map(saved === null ? [] : [["pocket.phoneMode.v1", saved]]);
    const body = { classList: createClassList() };
    const button = {
      classList: createClassList(),
      dataset: {},
      setAttribute() {},
      addEventListener() {},
    };
    const more = {
      classList: createClassList(),
      dataset: { moreButtonWired: "1" },
      setAttribute() {},
      addEventListener() {},
    };
    let changeListener = null;
    const context = {
      window: null,
      globalThis: null,
      Date,
      document: {
        body,
        readyState: "complete",
        getElementById(id) {
          if (id === "btnPhoneMode") return button;
          if (id === "btnMore") return more;
          return null;
        },
        querySelector() { return null; },
        createElement() { throw new Error("unexpected element creation"); },
        addEventListener() {},
      },
      localStorage: {
        getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
        setItem(key, value) { storage.set(String(key), String(value)); },
      },
      matchMedia() {
        if (throws) throw new Error("matchMedia unavailable");
        return {
          matches,
          addEventListener(_type, callback) { changeListener = callback; },
        };
      },
      requestAnimationFrame(callback) { callback(); return 1; },
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source("js/pocket-phone-mode.js"), context, { filename: "js/pocket-phone-mode.js" });
    return {
      context,
      body,
      storage,
      trigger(matchesNow) {
        if (changeListener) changeListener({ matches: matchesNow });
      },
    };
  };

  const freshPhone = makeContext({ matches: true });
  assert.equal(freshPhone.body.classList.contains("phoneMode"), true);
  assert.equal(freshPhone.storage.has("pocket.phoneMode.v1"), false);

  const legacyOffPhone = makeContext({ saved: "0", matches: true });
  assert.equal(legacyOffPhone.body.classList.contains("phoneMode"), true);
  assert.equal(legacyOffPhone.storage.get("pocket.phoneMode.v1"), "0");

  const fineDesktop = makeContext({ matches: false });
  assert.equal(fineDesktop.body.classList.contains("phoneMode"), false);

  const legacyOnDesktop = makeContext({ saved: "1", matches: false });
  assert.equal(legacyOnDesktop.body.classList.contains("phoneMode"), true);

  const rotatedPhone = makeContext({ matches: false });
  assert.equal(rotatedPhone.body.classList.contains("phoneMode"), false);
  rotatedPhone.trigger(true);
  assert.equal(rotatedPhone.body.classList.contains("phoneMode"), true);
  assert.equal(rotatedPhone.storage.has("pocket.phoneMode.v1"), false);
  rotatedPhone.trigger(false);
  assert.equal(rotatedPhone.body.classList.contains("phoneMode"), true);

  const unavailableMedia = makeContext({ matches: true, throws: true });
  assert.equal(unavailableMedia.body.classList.contains("phoneMode"), false);
});
