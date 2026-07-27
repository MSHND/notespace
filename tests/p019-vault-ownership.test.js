"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { TextEncoder, TextDecoder } = require("node:util");

const REPO_ROOT = path.resolve(__dirname, "..");
const P018_FIXTURE_PATH = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "vault",
  "p018-v1-envelope.json",
);
const FIXTURE_PASSPHRASE = "fixture-only-passphrase";
const TEST_PASSPHRASE = "synthetic-vault-password";

function source(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clone(value) {
  return structuredClone(value);
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

async function waitFor(predicate, options = {}) {
  const rounds = options.rounds || 240;
  for (let index = 0; index < rounds; index += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return predicate();
}

function makeNode(id, overrides = {}) {
  return {
    id,
    parentId: "root",
    order: 0,
    label: `Synthetic ${id}`,
    updatedAt: "2026-07-27T00:00:00.000Z",
    source: "manual",
    ...overrides,
  };
}

function outlineEditor(rows) {
  return {
    schema: "pocket.nodeEditor.v1",
    mode: "outline",
    outline: rows.map((row, order) => ({
      id: row.id || `outline_${order}`,
      text: row.text ?? "",
      depth: row.depth ?? 0,
      collapsed: row.collapsed === true,
      order: order + 1,
    })),
  };
}

function pocketPayload(options = {}) {
  const writtenAt = options.writtenAt || "2026-07-27T00:00:00.000Z";
  const nodes = clone(options.nodes || [
    makeNode("vault_root", {
      label: "Synthetic Vault item",
      details: "Synthetic Vault Notes",
    }),
  ]);
  const tombstones = clone(options.tombstones || []);
  const rootExtras = clone(options.rootExtras || {});
  const dataExtras = clone(options.dataExtras || {});
  return {
    ...rootExtras,
    schema: "portal.export.v1",
    exportedAt: writtenAt,
    writtenAt,
    mainThoughtTree: nodes,
    mainThoughtTreeTombstones: tombstones,
    data: {
      ...dataExtras,
      mainThoughtTree: clone(nodes),
      mainThoughtTreeTombstones: clone(tombstones),
    },
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(...names) {
      for (const name of names) values.add(String(name));
    },
    remove(...names) {
      for (const name of names) values.delete(String(name));
    },
    contains(name) {
      return values.has(String(name));
    },
    toggle(name, force) {
      const next = force === undefined ? !values.has(String(name)) : !!force;
      if (next) values.add(String(name));
      else values.delete(String(name));
      return next;
    },
    toString() {
      return [...values].join(" ");
    },
  };
}

function createVaultDom() {
  let documentRef = null;

  class UiElement {
    constructor(tagName = "div", id = "") {
      this.tagName = String(tagName).toUpperCase();
      this.id = id;
      this.type = "";
      this.parentElement = null;
      this.children = [];
      this.hidden = false;
      this.disabled = false;
      this.readOnly = false;
      this.inert = false;
      this.value = "";
      this.checked = false;
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
      this.parentElement?.removeChild(this);
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

    addEventListener(type, listener) {
      const key = String(type);
      if (!this.listeners.has(key)) this.listeners.set(key, []);
      this.listeners.get(key).push(listener);
    }

    removeEventListener(type, listener) {
      const values = this.listeners.get(String(type)) || [];
      const index = values.indexOf(listener);
      if (index >= 0) values.splice(index, 1);
    }

    dispatchEvent(event) {
      const value = event || {};
      if (!value.type) throw new Error("Synthetic event needs a type.");
      if (!value.target) value.target = this;
      for (const listener of this.listeners.get(String(value.type)) || []) listener(value);
      return !value.defaultPrevented;
    }

    async dispatchAsync(event) {
      const value = event || {};
      if (!value.type) throw new Error("Synthetic event needs a type.");
      if (!value.target) value.target = this;
      for (const listener of this.listeners.get(String(value.type)) || []) {
        await listener(value);
      }
      return !value.defaultPrevented;
    }

    click() {
      if (this.disabled) return;
      this.dispatchEvent(syntheticEvent("click", { target: this }));
    }

    focus() {
      if (documentRef) documentRef.activeElement = this;
    }

    select() {
      this.selected = true;
    }

    contains(target) {
      if (target === this) return true;
      return this.children.some((child) => child.contains?.(target));
    }

    closest(selector) {
      if (selector !== "[hidden]") return null;
      let current = this;
      while (current) {
        if (current.hidden) return current;
        current = current.parentElement;
      }
      return null;
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
      if (selector === "input:not([disabled]), button:not([disabled])") {
        return descendants.filter((element) => (
          (element.tagName === "INPUT" || element.tagName === "BUTTON") && !element.disabled
        ));
      }
      if (selector === "button:not([disabled])") {
        return descendants.filter((element) => element.tagName === "BUTTON" && !element.disabled);
      }
      return [];
    }
  }

  class UiInputElement extends UiElement {
    constructor(id = "") {
      super("input", id);
    }
  }

  class UiTextAreaElement extends UiInputElement {
    constructor(id = "") {
      super(id);
      this.tagName = "TEXTAREA";
    }
  }

  class UiButtonElement extends UiElement {
    constructor(id = "") {
      super("button", id);
      this.type = "button";
    }
  }

  const elements = new Map();
  const documentListeners = new Map();
  const register = (element) => {
    if (element.id) elements.set(element.id, element);
    return element;
  };
  const element = (tagName, id, text = "") => {
    let value;
    if (tagName === "input") value = new UiInputElement(id);
    else if (tagName === "textarea") value = new UiTextAreaElement(id);
    else if (tagName === "button") value = new UiButtonElement(id);
    else value = new UiElement(tagName, id);
    value.textContent = text;
    return register(value);
  };

  const body = element("body", "body");
  const surface = element("main", "pocketSurface");
  const allSimpleIds = [
    "btnUnfoldAll",
    "btnAddPrimary",
    "btnMovePrimary",
    "btnRenamePrimary",
    "btnDeletePrimary",
    "btnOpenPrimary",
    "btnLoad",
    "btnPip",
    "btnImportNow",
    "btnCancelImport",
    "btnUndoImport",
    "btnExportTree",
    "btnAddMobile",
    "btnMovePadUp",
    "btnMovePadDown",
    "btnMovePadLeft",
    "btnMovePadRight",
    "btnControlsClose",
    "cmdAddChild",
    "cmdAddSibling",
    "cmdRename",
    "cmdEdit",
    "cmdMove",
    "cmdFocus",
    "cmdSearch",
    "cmdSave",
    "cmdOpenVault",
    "cmdCreateVault",
    "cmdExportVaultJson",
    "cmdHealth",
    "cmdRestoreRecent",
    "cmdHelp",
    "btnDetailSave",
    "btnDetailCancel",
  ];
  for (const id of allSimpleIds) surface.appendChild(element("button", id, id));
  for (const id of [
    "activeDocumentSource",
    "vaultRecoveryNotice",
    "titleToast",
    "focusPath",
    "modePill",
    "treeWrap",
    "treeRoot",
    "commandOverlay",
    "controlsOverlay",
    "deviceChangesOverlay",
    "detailOverlay",
    "detailEditorTitle",
    "detailEditorPath",
  ]) {
    surface.appendChild(element("div", id));
  }
  for (const id of [
    "fileInput",
    "search",
    "detailEditorLabel",
    "detailEditorUrgent",
    "detailEditorCopyContext",
  ]) {
    surface.appendChild(element("input", id));
  }
  surface.appendChild(element("textarea", "detailEditorBody"));

  const permissionOverlay = element("div", "filePermissionOverlay");
  permissionOverlay.hidden = true;
  const permissionCard = element("section", "filePermissionCard");
  permissionOverlay.appendChild(permissionCard);
  permissionCard.appendChild(element("strong", "filePermissionFileName"));
  permissionCard.appendChild(element("button", "filePermissionContinue", "Continue"));
  permissionCard.appendChild(element("button", "filePermissionCancel", "Cancel"));

  const vaultOverlay = element("div", "vaultDialogOverlay");
  vaultOverlay.hidden = true;
  const vaultCard = element("section", "vaultDialogCard");
  vaultCard.setAttribute("role", "dialog");
  vaultCard.setAttribute("aria-modal", "true");
  vaultCard.setAttribute("aria-labelledby", "vaultDialogTitle");
  vaultOverlay.appendChild(vaultCard);
  vaultCard.appendChild(element("h2", "vaultDialogTitle"));
  vaultCard.appendChild(element("p", "vaultDialogBody"));
  vaultCard.appendChild(element("p", "vaultDialogError"));
  const credentialForm = element("form", "vaultCredentialForm");
  credentialForm.hidden = true;
  const password = element("input", "vaultPassword");
  password.type = "password";
  credentialForm.appendChild(password);
  const confirmGroup = element("div", "vaultPasswordConfirmGroup");
  const passwordConfirm = element("input", "vaultPasswordConfirm");
  passwordConfirm.type = "password";
  confirmGroup.appendChild(passwordConfirm);
  credentialForm.appendChild(confirmGroup);
  credentialForm.appendChild(element("button", "vaultCredentialSubmit", "Unlock"));
  credentialForm.appendChild(element("button", "vaultCredentialCancel", "Cancel"));
  vaultCard.appendChild(credentialForm);
  const exportActions = element("div", "vaultExportActions");
  exportActions.hidden = true;
  exportActions.appendChild(element("button", "vaultExportConfirm", "Export copy"));
  exportActions.appendChild(element("button", "vaultExportCancel", "Cancel"));
  vaultCard.appendChild(exportActions);
  const switchActions = element("div", "vaultSwitchActions");
  switchActions.hidden = true;
  switchActions.appendChild(element("button", "vaultSwitchSave", "Save and continue"));
  switchActions.appendChild(element("button", "vaultSwitchDiscard", "Discard and continue"));
  switchActions.appendChild(element("button", "vaultSwitchCancel", "Cancel"));
  vaultCard.appendChild(switchActions);

  body.appendChild(surface);
  body.appendChild(permissionOverlay);
  body.appendChild(vaultOverlay);

  documentRef = {
    body,
    activeElement: null,
    readyState: "complete",
    documentElement: { clientWidth: 1280, clientHeight: 800 },
    getElementById(id) {
      return elements.get(String(id)) || null;
    },
    querySelector(selector) {
      if (selector === ".topbar") return surface;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return element(String(tagName).toLowerCase(), "");
    },
    addEventListener(type, listener) {
      const key = String(type);
      if (!documentListeners.has(key)) documentListeners.set(key, []);
      documentListeners.get(key).push(listener);
    },
    removeEventListener(type, listener) {
      const listeners = documentListeners.get(String(type)) || [];
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatch(type, event = {}) {
      const value = syntheticEvent(type, event);
      for (const listener of documentListeners.get(String(type)) || []) listener(value);
      return value;
    },
  };

  return {
    document: documentRef,
    HTMLElement: UiElement,
    HTMLInputElement: UiInputElement,
    HTMLTextAreaElement: UiTextAreaElement,
    HTMLButtonElement: UiButtonElement,
    elements,
    surface,
    permissionOverlay,
    vaultOverlay,
    documentListeners,
  };
}

function syntheticEvent(type, options = {}) {
  return {
    type,
    key: "",
    target: null,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    immediateStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {
      this.immediateStopped = true;
    },
    ...options,
  };
}

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [String(key), String(value)]));
  const calls = [];
  return {
    values,
    calls,
    api: {
      getItem(key) {
        return values.has(String(key)) ? values.get(String(key)) : null;
      },
      setItem(key, value) {
        const record = { type: "set", key: String(key), value: String(value) };
        calls.push(record);
        values.set(record.key, record.value);
      },
      removeItem(key) {
        const record = { type: "remove", key: String(key) };
        calls.push(record);
        values.delete(record.key);
      },
      clear() {
        calls.push({ type: "clear" });
        values.clear();
      },
    },
  };
}

function createSyntheticHandle(name, options = {}) {
  const handle = {
    kind: "file",
    name,
    entryId: options.entryId || Symbol(name),
    content: String(options.content || ""),
    permission: options.permission || "granted",
    requestedPermission: options.requestedPermission || options.permission || "granted",
    getFileCalls: 0,
    createWritableCalls: 0,
    queryPermissionCalls: 0,
    requestPermissionCalls: 0,
    writes: [],
    abortedWrites: 0,
    closedWrites: 0,
    async queryPermission() {
      this.queryPermissionCalls += 1;
      if (typeof options.queryPermission === "function") return options.queryPermission(this);
      return this.permission;
    },
    async requestPermission() {
      this.requestPermissionCalls += 1;
      if (typeof options.requestPermission === "function") return options.requestPermission(this);
      this.permission = this.requestedPermission;
      return this.permission;
    },
    async getFile() {
      this.getFileCalls += 1;
      if (options.getFileError) throw options.getFileError;
      if (options.getFileDeferred) await options.getFileDeferred.promise;
      const current = this.content;
      return {
        name: this.name,
        async text() {
          if (options.textError) throw options.textError;
          if (options.textDeferred) await options.textDeferred.promise;
          return current;
        },
      };
    },
    async createWritable() {
      this.createWritableCalls += 1;
      if (options.createWritableError) throw options.createWritableError;
      const chunks = [];
      const owner = this;
      return {
        async write(value) {
          if (options.writeDeferred) await options.writeDeferred.promise;
          if (options.writeError) throw options.writeError;
          chunks.push(typeof value === "string" ? value : String(value));
        },
        async close() {
          if (options.closeDeferred) await options.closeDeferred.promise;
          if (options.closeError) throw options.closeError;
          const written = chunks.join("");
          owner.content = written;
          owner.writes.push(written);
          owner.closedWrites += 1;
          options.onClose?.(written, owner);
        },
        async abort() {
          owner.abortedWrites += 1;
        },
      };
    },
    async isSameEntry(other) {
      if (typeof options.isSameEntry === "function") return options.isSameEntry(other);
      return this === other || (!!other && this.entryId === other.entryId);
    },
  };
  return handle;
}

function loadCryptoContext() {
  const context = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Promise,
    Error,
    TypeError,
    btoa(value) {
      return Buffer.from(String(value), "binary").toString("base64");
    },
    atob(value) {
      return Buffer.from(String(value), "base64").toString("binary");
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const relativePath of ["js/pocket-crypto.js", "js/pocket-vault.js"]) {
    vm.runInContext(source(relativePath), context, { filename: relativePath });
  }
  return context;
}

function createVaultContext(options = {}) {
  const ui = createVaultDom();
  const local = createStorage(options.localStorageSeed);
  const session = createStorage(options.sessionStorageSeed);
  const windowListeners = new Map();
  const statuses = [];
  const consoleRecords = [];
  const openPickerQueue = [];
  const savePickerQueue = [];
  const indexedDbCalls = [];
  const pipCalls = {
    requestWindow: 0,
    popup: 0,
    snapshots: 0,
  };

  class VmUrl extends URL {
    static createObjectURL() {
      return "blob:synthetic-vault";
    }

    static revokeObjectURL() {}
  }

  const context = {
    URL: VmUrl,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    Promise,
    Blob,
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
    DOMException,
    structuredClone,
    crypto: webcrypto,
    location: { href: options.href || "https://pocket.test/index.html" },
    document: ui.document,
    HTMLElement: ui.HTMLElement,
    HTMLInputElement: ui.HTMLInputElement,
    HTMLTextAreaElement: ui.HTMLTextAreaElement,
    HTMLButtonElement: ui.HTMLButtonElement,
    navigator: {
      clipboard: {},
      storage: {},
    },
    localStorage: local.api,
    sessionStorage: session.api,
    indexedDB: {
      open(...args) {
        indexedDbCalls.push(args);
        throw new Error("Synthetic IndexedDB access is not available.");
      },
    },
    console: {
      log(...args) {
        consoleRecords.push({ type: "log", args });
      },
      info(...args) {
        consoleRecords.push({ type: "info", args });
      },
      warn(...args) {
        consoleRecords.push({ type: "warn", args });
      },
      error(...args) {
        consoleRecords.push({ type: "error", args });
      },
    },
    btoa(value) {
      return Buffer.from(String(value), "binary").toString("base64");
    },
    atob(value) {
      return Buffer.from(String(value), "base64").toString("binary");
    },
    setTimeout(callback) {
      if (options.runTimeouts && typeof callback === "function") callback();
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
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
    async showOpenFilePicker() {
      if (openPickerQueue.length === 0) {
        throw Object.assign(new Error("Synthetic open picker cancellation."), { name: "AbortError" });
      }
      const next = openPickerQueue.shift();
      if (next instanceof Error) throw next;
      return Array.isArray(next) ? next : [next];
    },
    async showSaveFilePicker() {
      if (savePickerQueue.length === 0) {
        throw Object.assign(new Error("Synthetic save picker cancellation."), { name: "AbortError" });
      }
      const next = savePickerQueue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    confirm() {
      return true;
    },
    alert() {},
    open() {
      pipCalls.popup += 1;
      return null;
    },
    documentPictureInPicture: {
      async requestWindow() {
        pipCalls.requestWindow += 1;
        throw new Error("Synthetic PiP not available.");
      },
    },
    refreshMeta() {},
    renderTree() {},
    refocusTreeNavigation() {},
    softlyEnsureSelectionVisible() {},
    collapseAllNodes() {},
    expandPathToNode() {},
    focusRowByNodeId() {},
    stopMovePadRepeat() {},
    getExpandableIds() {
      return [];
    },
    getPath(id) {
      return String(id || "");
    },
    isDetailsEditorOpen() {
      return false;
    },
    hasUnsavedDetailsEditorChanges() {
      return false;
    },
    saveDetailsEditor() {},
    flashSaveChip() {},
    persistPipSnapshot() {
      pipCalls.snapshots += 1;
      return false;
    },
    setStatus(message, kind, statusOptions) {
      statuses.push({
        message: String(message || ""),
        kind: String(kind || ""),
        options: statusOptions || null,
      });
    },
    btoaTag: "synthetic",
    __ui: ui,
    __localStorage: local,
    __sessionStorage: session,
    __windowListeners: windowListeners,
    __statuses: statuses,
    __consoleRecords: consoleRecords,
    __openPickerQueue: openPickerQueue,
    __savePickerQueue: savePickerQueue,
    __indexedDbCalls: indexedDbCalls,
    __pipCalls: pipCalls,
  };
  context.window = context;
  context.globalThis = context;
  context.parent = options.parent || context;
  vm.createContext(context);

  const productionSources = [
    "js/pocket-state.js",
    "js/pocket-data.js",
    "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js",
    "js/pocket-import.js",
    "js/pocket-editor-copy.js",
    "js/pocket-history-status.js",
    "js/pocket-io-browser.js",
    "js/pocket-device-changes.js",
    "js/pocket-crypto.js",
    "js/pocket-vault.js",
    "js/pocket-vault-io-browser.js",
    "js/pocket-node-popout-model.js",
    "js/pocket-node-popout-target.js",
    "js/pocket-node-popout-editor.js",
  ];
  for (const relativePath of productionSources) {
    vm.runInContext(source(relativePath), context, { filename: relativePath });
  }

  context.__productionPersistPipSnapshot = context.persistPipSnapshot;
  context.__productionRefreshMeta = context.refreshMeta;
  context.refreshMeta = () => {};
  context.renderTree = () => {};
  context.refocusTreeNavigation = () => {};
  context.softlyEnsureSelectionVisible = () => {};
  context.persistPipSnapshot = () => {
    pipCalls.snapshots += 1;
    return false;
  };
  context.setStatus = (message, kind, statusOptions) => {
    statuses.push({
      message: String(message || ""),
      kind: String(kind || ""),
      options: statusOptions || null,
    });
  };
  context.storeRecentPocketFileMeta = async () => true;
  context.readRecentPocketFileMeta = async () => null;
  return context;
}

function lexicalState(context) {
  return vm.runInContext("state", context);
}

function installOwnerDocument(context, handle, payload, options = {}) {
  const state = lexicalState(context);
  const norm = context.normaliseInput(payload);
  context.setPocketFileSession(handle, handle.name, {
    ownerKind: options.ownerKind || "json",
    forceNewSession: true,
    vaultSession: options.vaultSession,
  });
  context.applyLoadedState(norm, {
    schema: norm.schema,
    fileName: handle.name,
    writtenAt: norm.writtenAt || payload.writtenAt || "",
  }, {
    skipLocalSafetyCheck: true,
    establishDocumentBaseline: true,
    baselinePayload: payload,
    storagePrivate: options.ownerKind === "vault" ? "vault" : "",
  });
  state.ops = clone(options.ops || []);
  return state;
}

function currentOwnerSnapshot(context) {
  const state = lexicalState(context);
  const saveSession = context.capturePocketFileSaveSession();
  return {
    sessionId: saveSession.id,
    handle: saveSession.handle,
    ownerKind: saveSession.ownerKind,
    vaultSessionId: saveSession.vaultSessionId,
    tree: plain(state.nodes),
    tombstones: plain(state.tombstones),
    rootExtras: plain(state.rootExtras),
    dataExtras: plain(state.dataExtras),
    ops: plain(state.ops),
    selectedId: state.selectedId,
    source: plain(state.source),
  };
}

function assertOwnerUnchanged(context, before) {
  const after = currentOwnerSnapshot(context);
  assert.equal(after.sessionId, before.sessionId);
  assert.strictEqual(after.handle, before.handle);
  assert.equal(after.ownerKind, before.ownerKind);
  assert.equal(after.vaultSessionId, before.vaultSessionId);
  assert.deepEqual(after.tree, before.tree);
  assert.deepEqual(after.tombstones, before.tombstones);
  assert.deepEqual(after.rootExtras, before.rootExtras);
  assert.deepEqual(after.dataExtras, before.dataExtras);
  assert.deepEqual(after.ops, before.ops);
  assert.equal(after.selectedId, before.selectedId);
  assert.deepEqual(after.source, before.source);
}

async function sealForHandle(context, payload, options = {}) {
  const envelope = await context.PocketCrypto.sealJson(payload, options.passphrase || TEST_PASSPHRASE, {
    vaultId: options.vaultId || "vault_synthetic",
    revision: options.revision || 1,
  });
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

async function submitCredential(context, passphrase = TEST_PASSPHRASE, confirmation = passphrase) {
  const ui = context.__ui;
  assert.equal(
    await waitFor(() => !ui.vaultOverlay.hidden && !ui.elements.get("vaultCredentialForm").hidden),
    true,
    "credential dialog should open",
  );
  ui.elements.get("vaultPassword").value = passphrase;
  ui.elements.get("vaultPasswordConfirm").value = confirmation;
  await ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", { target: ui.elements.get("vaultCredentialForm") }),
  );
  const error = ui.elements.get("vaultDialogError").textContent;
  if (!ui.vaultOverlay.hidden && error) {
    throw new Error(`Synthetic Vault credential action failed: ${error}`);
  }
}

async function openVaultWithPassword(context, handle, passphrase = TEST_PASSPHRASE) {
  context.__openPickerQueue.push(handle);
  const opened = context.PocketVaultBrowserIo.openVault();
  await submitCredential(context, passphrase);
  return opened;
}

async function createVaultWithPassword(context, handle, passphrase = TEST_PASSPHRASE) {
  context.__savePickerQueue.push(handle);
  const created = context.PocketVaultBrowserIo.createActiveVault();
  await submitCredential(context, passphrase, passphrase);
  return created;
}

async function confirmReadableExport(context, handle) {
  context.__savePickerQueue.push(handle);
  const exported = context.PocketVaultBrowserIo.exportUnencryptedJsonCopy();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultExportActions").hidden),
    true,
    "export confirmation should open",
  );
  context.__ui.elements.get("vaultExportConfirm").click();
  return exported;
}

function mutateVaultNode(context, changes = {}) {
  const state = lexicalState(context);
  assert.ok(state.nodes[0], "synthetic Vault needs one node");
  Object.assign(state.nodes[0], changes);
  context.recordOp({ type: "synthetic-vault-edit", id: state.nodes[0].id });
  return state.nodes[0];
}

function parseWrittenEnvelope(handle, index = handle.writes.length - 1) {
  assert.ok(handle.writes[index], `expected encrypted write ${index}`);
  return JSON.parse(handle.writes[index]);
}

function assertNoPlaintextInWrites(handle, needles) {
  const serialised = handle.writes.join("\n");
  for (const needle of needles) {
    assert.equal(serialised.includes(needle), false, `Vault bytes must not contain ${needle}`);
  }
}

test("P018 Vault v1 fixture unlocks into a non-extractable session and resaves compatibly", async () => {
  const context = loadCryptoContext();
  const fixture = JSON.parse(fs.readFileSync(P018_FIXTURE_PATH, "utf8"));
  const unlocked = await context.PocketCrypto.unlockEnvelope(fixture, FIXTURE_PASSPHRASE);

  assert.equal(unlocked.vaultId, "vault_p018_fixture");
  assert.equal(unlocked.revision, 7);
  assert.equal(unlocked.cryptoKey.type, "secret");
  assert.equal(unlocked.cryptoKey.extractable, false);
  assert.deepEqual([...unlocked.cryptoKey.usages].sort(), ["decrypt", "encrypt"]);
  assert.equal(unlocked.payload.schema, "portal.export.v1");
  assert.equal(unlocked.payload.mainThoughtTree[0].id, "vault_fixture_root");

  const next = await context.PocketCrypto.sealWithUnlockedKey(
    unlocked.payload,
    unlocked,
    8,
  );
  assert.equal(next.version, 1);
  assert.equal(next.revision, 8);
  assert.equal(next.vaultId, fixture.vaultId);
  assert.equal(next.crypto.salt, fixture.crypto.salt);
  assert.notEqual(next.crypto.nonce, fixture.crypto.nonce);
  assert.deepEqual(
    plain(await context.PocketCrypto.openJson(next, FIXTURE_PASSPHRASE)),
    plain(unlocked.payload),
  );
});

test("same unlocked key uses a fresh AES-GCM nonce for every encrypted Save", async () => {
  const context = loadCryptoContext();
  const payload = pocketPayload();
  const session = await context.PocketCrypto.createUnlockedSession(TEST_PASSPHRASE, {
    vaultId: "vault_nonce_test",
    revision: 0,
  });
  const first = await context.PocketCrypto.sealWithUnlockedKey(payload, session, 1);
  const second = await context.PocketCrypto.sealWithUnlockedKey(payload, session, 1);

  assert.notEqual(first.crypto.nonce, second.crypto.nonce);
  assert.notEqual(first.payload, second.payload);
  assert.deepEqual(plain(await context.PocketCrypto.openJson(first, TEST_PASSPHRASE)), payload);
  assert.deepEqual(plain(await context.PocketCrypto.openJson(second, TEST_PASSPHRASE)), payload);
});

test("Vault authentication rejects a wrong password and modified ciphertext", async () => {
  const context = loadCryptoContext();
  const envelope = await context.PocketCrypto.sealJson(pocketPayload(), TEST_PASSPHRASE, {
    vaultId: "vault_auth_test",
    revision: 1,
  });

  await assert.rejects(
    context.PocketCrypto.openJson(envelope, "definitely-the-wrong-password"),
  );
  const modified = plain(envelope);
  const last = modified.payload.slice(-1);
  modified.payload = `${modified.payload.slice(0, -1)}${last === "A" ? "B" : "A"}`;
  await assert.rejects(context.PocketCrypto.openJson(modified, TEST_PASSPHRASE));
});

test("Vault v1 parser enforces exact crypto settings and bounded envelope metadata", async () => {
  const context = loadCryptoContext();
  const envelope = await context.PocketCrypto.sealJson(pocketPayload(), TEST_PASSPHRASE, {
    vaultId: "vault_validation_test",
    revision: 1,
  });
  assert.doesNotThrow(() => context.PocketCrypto.validateEnvelope(envelope));

  for (const mutate of [
    (value) => { value.version = 2; },
    (value) => { value.contentType = "text/plain"; },
    (value) => { value.crypto.cipher = "AES-CBC"; },
    (value) => { value.crypto.kdf = "PBKDF2-SHA-1"; },
    (value) => { value.crypto.iterations = 1; },
    (value) => { value.crypto.salt = "AA"; },
    (value) => { value.crypto.nonce = "AA"; },
    (value) => { value.vaultId = "x".repeat(161); },
    (value) => { value.revision = 0; },
    (value) => { value.createdAt = "not-a-date"; },
    (value) => { value.payload = "%%%"; },
  ]) {
    const invalid = plain(envelope);
    mutate(invalid);
    assert.throws(() => context.PocketCrypto.validateEnvelope(invalid));
  }
});

test("unlocked Vault revisions advance by exactly one and never depend on legacy localStorage", async () => {
  const context = loadCryptoContext();
  const session = await context.PocketVault.createUnlockedSession(TEST_PASSPHRASE, {
    vaultId: "vault_revision_test",
    revision: 4,
  });
  const active = context.PocketVault.activateUnlockedSession(session);

  assert.equal(context.PocketVault.readVaultState().vaultId, undefined);
  assert.equal(context.PocketVault.writeVaultState({ vaultId: "forged", revision: 999 }), false);
  assert.equal(context.PocketVault.currentVaultId(), "");
  assert.equal(context.PocketVault.nextRevision(), 0);
  assert.equal(active.revision, 4);
  assert.equal(context.PocketVault.replaceActiveSessionRevision(active.vaultSessionId, 6), null);
  const advanced = context.PocketVault.replaceActiveSessionRevision(active.vaultSessionId, 5);
  assert.equal(advanced.revision, 5);
  assert.notEqual(advanced.vaultSessionId, "");
  assert.equal(advanced.vaultId, "vault_revision_test");
});

test("atomic JSON-to-Vault adoption installs the exact Vault handle and rotates once", async () => {
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("ordinary.json");
  const jsonPayload = pocketPayload({
    nodes: [makeNode("json_owner", { label: "Ordinary owner" })],
  });
  installOwnerDocument(context, jsonHandle, jsonPayload);
  const before = currentOwnerSnapshot(context);

  const vaultPayload = pocketPayload({
    nodes: [
      makeNode("vault_parent", {
        label: "Encrypted owner",
        details: "Encrypted Notes",
        editor: outlineEditor([
          { id: "vault_outline_parent", text: "Parent", depth: 0, collapsed: true },
          { id: "vault_outline_child", text: "Child", depth: 1 },
        ]),
      }),
      makeNode("vault_child", {
        parentId: "vault_parent",
        order: 0,
        label: "Nested child",
      }),
    ],
    rootExtras: { syntheticRootExtra: "root value" },
  });
  const vaultHandle = createSyntheticHandle("active.vault.json", {
    content: await sealForHandle(context, vaultPayload, {
      vaultId: "vault_atomic_owner",
      revision: 4,
    }),
  });
  assert.deepEqual(
    plain(context.PocketDeviceChanges.validateStructure(vaultPayload).errors),
    [],
  );
  vm.runInContext(
    'lastEditUndoSnapshot = createTreeUndoSnapshot("rename"); lastTreeUndoKind = "edit";',
    context,
  );

  const opened = await openVaultWithPassword(context, vaultHandle);
  assert.equal(opened, true);
  const after = currentOwnerSnapshot(context);
  assert.equal(after.sessionId, before.sessionId + 1);
  assert.strictEqual(after.handle, vaultHandle);
  assert.equal(after.ownerKind, "vault");
  assert.notEqual(after.vaultSessionId, "");
  assert.equal(after.tree[0].id, "vault_parent");
  assert.equal(after.tree[1].parentId, "vault_parent");
  assert.deepEqual(after.rootExtras, { syntheticRootExtra: "root value" });
  assert.deepEqual(after.dataExtras, {});
  assert.equal(jsonHandle.writes.length, 0);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(context.PocketVault.getActiveSession().vaultId, "vault_atomic_owner");
  assert.equal(context.PocketVault.getActiveSession().revision, 4);
  assert.equal(context.isPocketVaultOwnerActive(), true);
  context.__productionRefreshMeta();
  assert.equal(
    context.__ui.elements.get("activeDocumentSource").textContent,
    "Encrypted Vault · active.vault.json",
  );
  assert.equal(
    context.__ui.elements.get("btnExportTree").getAttribute("aria-label"),
    "Save encrypted Vault",
  );
  assert.equal(context.undoMostRecentTreeMutation(), false);
  assert.equal(lexicalState(context).nodes[0].id, "vault_parent");
});

test("picker cancellation, permission denial, read failure, and invalid envelopes are atomic", async (t) => {
  const cases = [
    {
      name: "picker cancellation",
      run: async (context) => context.PocketVaultBrowserIo.openVault(),
    },
    {
      name: "permission denial",
      makeHandle: () => createSyntheticHandle("denied.vault.json", {
        permission: "denied",
        content: "{}",
      }),
    },
    {
      name: "read failure",
      makeHandle: () => createSyntheticHandle("unreadable.vault.json", {
        getFileError: new Error("synthetic read failure"),
      }),
    },
    {
      name: "invalid JSON envelope",
      makeHandle: () => createSyntheticHandle("invalid-json.vault.json", {
        content: "{not json",
      }),
    },
    {
      name: "unsupported envelope settings",
      makeHandle: async (context) => {
        const envelope = await context.PocketCrypto.sealJson(pocketPayload(), TEST_PASSPHRASE, {
          vaultId: "vault_unsupported",
          revision: 1,
        });
        envelope.crypto.iterations = 1;
        return createSyntheticHandle("unsupported.vault.json", {
          content: JSON.stringify(envelope),
        });
      },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const context = createVaultContext();
      const activeHandle = createSyntheticHandle("active.json");
      installOwnerDocument(
        context,
        activeHandle,
        pocketPayload({ nodes: [makeNode("still_active", { label: "Still active" })] }),
        { ops: [{ type: "existing-unsaved", seq: 1 }] },
      );
      const before = currentOwnerSnapshot(context);
      let result;
      if (item.run) {
        result = await item.run(context);
      } else {
        const candidate = await item.makeHandle(context);
        context.__openPickerQueue.push(candidate);
        result = await context.PocketVaultBrowserIo.openVault();
        assert.equal(candidate.writes.length, 0);
      }
      assert.equal(result, false);
      assertOwnerUnchanged(context, before);
      assert.equal(activeHandle.writes.length, 0);
      assert.equal(context.__ui.vaultOverlay.hidden, true);
    });
  }
});

test("wrong password, ciphertext tampering, and invalid decrypted content never adopt", async (t) => {
  const cases = [
    {
      name: "wrong password",
      envelope: async (context) => context.PocketCrypto.sealJson(
        pocketPayload(),
        TEST_PASSPHRASE,
        { vaultId: "vault_wrong_password", revision: 1 },
      ),
      passphrase: "wrong-password-value",
    },
    {
      name: "modified ciphertext",
      envelope: async (context) => {
        const envelope = await context.PocketCrypto.sealJson(
          pocketPayload(),
          TEST_PASSPHRASE,
          { vaultId: "vault_tampered", revision: 1 },
        );
        const last = envelope.payload.slice(-1);
        envelope.payload = `${envelope.payload.slice(0, -1)}${last === "A" ? "B" : "A"}`;
        return envelope;
      },
      passphrase: TEST_PASSPHRASE,
    },
    {
      name: "invalid decrypted schema",
      envelope: async (context) => context.PocketCrypto.sealJson(
        { schema: "unsupported.synthetic.v1", value: "not a Pocket tree" },
        TEST_PASSPHRASE,
        { vaultId: "vault_bad_plaintext", revision: 1 },
      ),
      passphrase: TEST_PASSPHRASE,
    },
    {
      name: "destructive normalisation candidate",
      envelope: async (context) => context.PocketCrypto.sealJson(
        pocketPayload({
          nodes: [
            makeNode("duplicate_id", { label: "First duplicate" }),
            makeNode("duplicate_id", { label: "Second duplicate", order: 1 }),
          ],
        }),
        TEST_PASSPHRASE,
        { vaultId: "vault_duplicate_nodes", revision: 1 },
      ),
      passphrase: TEST_PASSPHRASE,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const context = createVaultContext();
      const activeHandle = createSyntheticHandle("active.json");
      installOwnerDocument(
        context,
        activeHandle,
        pocketPayload({ nodes: [makeNode("original_tree")] }),
        { ops: [{ type: "keep-dirty", seq: 1 }] },
      );
      const before = currentOwnerSnapshot(context);
      const candidate = createSyntheticHandle("candidate.vault.json", {
        content: JSON.stringify(await item.envelope(context)),
      });
      context.__openPickerQueue.push(candidate);
      const opening = context.PocketVaultBrowserIo.openVault();
      assert.equal(
        await waitFor(() => !context.__ui.vaultOverlay.hidden),
        true,
      );
      context.__ui.elements.get("vaultPassword").value = item.passphrase;
      await context.__ui.elements.get("vaultCredentialForm").dispatchAsync(
        syntheticEvent("submit", {
          target: context.__ui.elements.get("vaultCredentialForm"),
        }),
      );
      assert.equal(context.__ui.vaultOverlay.hidden, false);
      assert.notEqual(context.__ui.elements.get("vaultDialogError").textContent, "");
      assertOwnerUnchanged(context, before);
      context.__ui.elements.get("vaultCredentialCancel").click();
      assert.equal(await opening, false);
      assertOwnerUnchanged(context, before);
      assert.equal(activeHandle.writes.length, 0);
      assert.equal(candidate.writes.length, 0);
    });
  }
});

test("Vault adoption either preserves canonical data extras or rejects without loss", async () => {
  const context = createVaultContext();
  const activeHandle = createSyntheticHandle("active.json");
  installOwnerDocument(
    context,
    activeHandle,
    pocketPayload({ nodes: [makeNode("active_before_data_extra")] }),
  );
  const before = currentOwnerSnapshot(context);
  const payload = pocketPayload({
    nodes: [makeNode("data_extra_owner")],
    dataExtras: { futureDataMetadata: { preserved: true } },
  });
  const candidate = createSyntheticHandle("data-extra.vault.json", {
    content: await sealForHandle(context, payload, {
      vaultId: "vault_data_extra",
      revision: 2,
    }),
  });

  context.__openPickerQueue.push(candidate);
  const opening = context.PocketVaultBrowserIo.openVault();
  await submitCredential(context);
  const opened = await opening;
  if (opened) {
    assert.deepEqual(
      plain(lexicalState(context).dataExtras),
      { futureDataMetadata: { preserved: true } },
    );
  } else {
    assertOwnerUnchanged(context, before);
  }
  assert.equal(activeHandle.writes.length, 0);
  assert.equal(candidate.writes.length, 0);
});

test("Main Save writes only an authenticated Vault envelope and advances the active revision", async () => {
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("plaintext-owner.json");
  installOwnerDocument(
    context,
    jsonHandle,
    pocketPayload({ nodes: [makeNode("ordinary_before_vault")] }),
  );
  const vaultHandle = createSyntheticHandle("encrypted-owner.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("encrypted_item", { details: "Before Save" })] }),
      { vaultId: "vault_main_save", revision: 6 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);

  const secretLabel = "P019 DISTINCTIVE SECRET LABEL 🔐";
  const secretNotes = "Sensitive Notes should only exist inside AES-GCM ciphertext.";
  mutateVaultNode(context, {
    label: secretLabel,
    details: secretNotes,
    updatedAt: "2026-07-27T01:00:00.000Z",
  });
  const result = await context.exportTree({
    returnDetails: true,
    downloadFallback: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "vault-truth-file");
  assert.equal(result.target, "vault");
  assert.equal(jsonHandle.writes.length, 0);
  assert.equal(vaultHandle.writes.length, 1);
  assertNoPlaintextInWrites(vaultHandle, [secretLabel, secretNotes, "\"portal.export.v1\""]);
  const envelope = parseWrittenEnvelope(vaultHandle);
  assert.equal(envelope.kind, "pocket.vault");
  assert.equal(envelope.version, 1);
  assert.equal(envelope.vaultId, "vault_main_save");
  assert.equal(envelope.revision, 7);
  const decrypted = await context.PocketCrypto.openJson(envelope, TEST_PASSPHRASE);
  assert.equal(decrypted.mainThoughtTree[0].label, secretLabel);
  assert.equal(decrypted.mainThoughtTree[0].details, secretNotes);
  assert.deepEqual(decrypted.mainThoughtTree, decrypted.data.mainThoughtTree);
  assert.equal(context.PocketVault.getActiveSession().revision, 7);
  assert.equal(lexicalState(context).ops.length, 0);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
});

test("two successful Main Saves keep one Vault owner and never reuse a nonce", async () => {
  const context = createVaultContext();
  const vaultHandle = createSyntheticHandle("nonce-owner.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("nonce_item")] }),
      { vaultId: "vault_nonce_owner", revision: 1 },
    ),
  });
  const initialHandle = createSyntheticHandle("initial.json");
  installOwnerDocument(context, initialHandle, pocketPayload());
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  const ownerIdentity = context.capturePocketFileSaveSession();

  mutateVaultNode(context, { details: "First encrypted revision" });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);
  mutateVaultNode(context, {
    details: "Second encrypted revision",
    updatedAt: "2026-07-27T02:00:00.000Z",
  });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);

  assert.equal(vaultHandle.writes.length, 2);
  const first = parseWrittenEnvelope(vaultHandle, 0);
  const second = parseWrittenEnvelope(vaultHandle, 1);
  assert.equal(first.revision, 2);
  assert.equal(second.revision, 3);
  assert.notEqual(first.crypto.nonce, second.crypto.nonce);
  assert.notEqual(first.payload, second.payload);
  assert.equal(
    (await context.PocketCrypto.openJson(first, TEST_PASSPHRASE)).mainThoughtTree[0].details,
    "First encrypted revision",
  );
  assert.equal(
    (await context.PocketCrypto.openJson(second, TEST_PASSPHRASE)).mainThoughtTree[0].details,
    "Second encrypted revision",
  );
  const after = context.capturePocketFileSaveSession();
  assert.strictEqual(after.handle, ownerIdentity.handle);
  assert.equal(after.id, ownerIdentity.id);
  assert.equal(after.vaultSessionId, ownerIdentity.vaultSessionId);
  assert.equal(initialHandle.writes.length, 0);
});

test("failed Vault permission and write leave owner, revision, edits, and dirty operations intact", async (t) => {
  for (const failure of ["permission", "write"]) {
    await t.test(failure, async () => {
      const context = createVaultContext();
      const jsonHandle = createSyntheticHandle("old.json");
      installOwnerDocument(context, jsonHandle, pocketPayload());
      const vaultHandle = createSyntheticHandle("failure.vault.json", {
        content: await sealForHandle(
          context,
          pocketPayload({ nodes: [makeNode("failure_item", { details: "Before" })] }),
          { vaultId: `vault_${failure}_failure`, revision: 3 },
        ),
      });
      assert.equal(await openVaultWithPassword(context, vaultHandle), true);
      const beforeSession = context.capturePocketFileSaveSession();
      mutateVaultNode(context, { details: `Unsaved after ${failure} failure` });
      const beforeNode = plain(lexicalState(context).nodes[0]);

      if (failure === "permission") {
        vaultHandle.permission = "denied";
        vaultHandle.requestedPermission = "denied";
      } else {
        vaultHandle.createWritable = async () => {
          vaultHandle.createWritableCalls += 1;
          return {
            async write() {
              throw new Error("synthetic encrypted write failure");
            },
            async close() {},
            async abort() {
              vaultHandle.abortedWrites += 1;
            },
          };
        };
      }
      const pickerCallsBefore = context.__savePickerQueue.length;
      const result = await context.exportTree({
        returnDetails: true,
        downloadFallback: true,
      });

      assert.equal(result.ok, false);
      assert.equal(
        result.reason,
        failure === "permission" ? "permission-denied" : "vault-write-failed",
      );
      assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
      assert.equal(context.capturePocketFileSaveSession().id, beforeSession.id);
      assert.equal(context.PocketVault.getActiveSession().revision, 3);
      assert.deepEqual(plain(lexicalState(context).nodes[0]), beforeNode);
      assert.equal(lexicalState(context).ops.length, 1);
      assert.equal(vaultHandle.writes.length, 0);
      assert.equal(jsonHandle.writes.length, 0);
      assert.equal(context.__savePickerQueue.length, pickerCallsBefore);
    });
  }
});

test("cleared or stale Vault session rejects Save without plaintext or picker fallback", async () => {
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("never-fallback.json");
  installOwnerDocument(context, jsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("locked.vault.json", {
    content: await sealForHandle(context, pocketPayload(), {
      vaultId: "vault_locked_save",
      revision: 2,
    }),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  mutateVaultNode(context, { details: "Still only in memory" });
  context.PocketVault.clearActiveSession();

  const result = await context.exportTree({
    returnDetails: true,
    downloadFallback: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "vault-locked");
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(jsonHandle.writes.length, 0);
  assert.equal(lexicalState(context).ops.length, 1);
  assert.equal(context.__savePickerQueue.length, 0);
});

test("PE Save from a Vault applies by revision and becomes durable only through encrypted Main Save", async () => {
  const context = createVaultContext();
  const oldJsonHandle = createSyntheticHandle("old-pe-owner.json");
  installOwnerDocument(context, oldJsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("pe-owner.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({
        nodes: [
          makeNode("pe_vault_item", {
            label: "PE before",
            details: "Notes before",
            editor: outlineEditor([
              { id: "pe_outline", text: "Outline before", depth: 0 },
            ]),
          }),
        ],
      }),
      { vaultId: "vault_pe_owner", revision: 9 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  const state = lexicalState(context);
  const openingPayload = plain(context.PocketNodePopoutModel.buildPayload(state.nodes[0]));
  assert.equal(openingPayload.sourceOwnerKind, "vault");
  assert.notEqual(openingPayload.sourceVaultSessionId, "");
  assert.equal(Object.hasOwn(openingPayload, "cryptoKey"), false);
  assert.equal(JSON.stringify(openingPayload).includes(TEST_PASSPHRASE), false);

  const result = await context.PocketNodePopoutEditor.applyAndSave({
    ...openingPayload,
    title: "PE encrypted title",
    body: "PE encrypted Notes",
    outline: [
      {
        id: "pe_outline",
        text: "PE encrypted Outline",
        depth: 0,
        collapsed: false,
        order: 1,
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.exported, true);
  assert.equal(result.target, "vault");
  assert.equal(vaultHandle.writes.length, 1);
  assert.equal(oldJsonHandle.writes.length, 0);
  assert.equal(state.ops.length, 0);
  const decrypted = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  const savedNode = decrypted.mainThoughtTree[0];
  assert.equal(savedNode.label, "PE encrypted title");
  assert.equal(savedNode.details, "PE encrypted Notes");
  assert.equal(savedNode.editor.outline[0].text, "PE encrypted Outline");
  assertNoPlaintextInWrites(vaultHandle, [
    "PE encrypted title",
    "PE encrypted Notes",
    "PE encrypted Outline",
  ]);
});

test("failed Vault PE persistence keeps applied in-memory content dirty and never falls back", async () => {
  const context = createVaultContext();
  const oldJsonHandle = createSyntheticHandle("old-pe-fallback.json");
  installOwnerDocument(context, oldJsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("pe-failure.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("pe_failure_item", { details: "Before" })] }),
      { vaultId: "vault_pe_failure", revision: 2 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  const state = lexicalState(context);
  const openingPayload = plain(context.PocketNodePopoutModel.buildPayload(state.nodes[0]));
  vaultHandle.createWritable = async () => ({
    async write() {
      throw new Error("synthetic PE Vault write failure");
    },
    async close() {},
    async abort() {
      vaultHandle.abortedWrites += 1;
    },
  });

  const result = await context.PocketNodePopoutEditor.applyAndSave({
    ...openingPayload,
    body: "Applied but not encrypted yet",
  });
  assert.equal(result.ok, false);
  assert.equal(result.applied, true);
  assert.equal(result.exported, false);
  assert.equal(result.reason, "vault-write-failed");
  assert.equal(state.nodes[0].details, "Applied but not encrypted yet");
  assert.equal(state.ops.length, 1);
  assert.equal(context.PocketVault.getActiveSession().revision, 2);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(oldJsonHandle.writes.length, 0);
  assert.equal(context.__savePickerQueue.length, 0);
});

test("old PE source identity is rejected across JSON, Vault, owner-switch, and reload boundaries", async (t) => {
  await t.test("JSON PE after Vault adoption", async () => {
    const context = createVaultContext();
    const jsonHandle = createSyntheticHandle("json-pe.json");
    const state = installOwnerDocument(
      context,
      jsonHandle,
      pocketPayload({ nodes: [makeNode("same_node", { details: "JSON Notes" })] }),
    );
    const stale = plain(context.PocketNodePopoutModel.buildPayload(state.nodes[0]));
    const vaultHandle = createSyntheticHandle("vault-pe.vault.json", {
      content: await sealForHandle(
        context,
        pocketPayload({ nodes: [makeNode("same_node", { details: "Vault Notes" })] }),
        { vaultId: "vault_replaces_json_pe", revision: 1 },
      ),
    });
    assert.equal(await openVaultWithPassword(context, vaultHandle), true);
    const before = plain(lexicalState(context).nodes[0]);
    const rejected = context.PocketNodePopoutEditor.apply(
      { ...stale, body: "Wrong-owner mutation" },
      { returnDetails: true },
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "file-session-changed");
    assert.deepEqual(plain(lexicalState(context).nodes[0]), before);
    assert.equal(jsonHandle.writes.length, 0);
    assert.equal(vaultHandle.writes.length, 0);
  });

  await t.test("Vault PE after JSON adoption", async () => {
    const context = createVaultContext();
    const initial = createSyntheticHandle("initial.json");
    installOwnerDocument(context, initial, pocketPayload());
    const vaultHandle = createSyntheticHandle("vault-before-json.vault.json", {
      content: await sealForHandle(
        context,
        pocketPayload({ nodes: [makeNode("same_node", { details: "Vault Notes" })] }),
        { vaultId: "vault_before_json", revision: 1 },
      ),
    });
    assert.equal(await openVaultWithPassword(context, vaultHandle), true);
    const stale = plain(
      context.PocketNodePopoutModel.buildPayload(lexicalState(context).nodes[0]),
    );
    const jsonHandle = createSyntheticHandle("next.json");
    installOwnerDocument(
      context,
      jsonHandle,
      pocketPayload({ nodes: [makeNode("same_node", { details: "New JSON Notes" })] }),
    );
    const before = plain(lexicalState(context).nodes[0]);
    const rejected = context.PocketNodePopoutEditor.apply(
      { ...stale, body: "Stale Vault mutation" },
      { returnDetails: true },
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "file-session-changed");
    assert.deepEqual(plain(lexicalState(context).nodes[0]), before);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(jsonHandle.writes.length, 0);
  });

  await t.test("Vault V1 PE after Vault V2 adoption", async () => {
    const context = createVaultContext();
    installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
    const first = createSyntheticHandle("same-name.vault.json", {
      entryId: "vault-entry-one",
      content: await sealForHandle(
        context,
        pocketPayload({ nodes: [makeNode("same_node", { details: "V1" })] }),
        { vaultId: "vault_one", revision: 3 },
      ),
    });
    const second = createSyntheticHandle("same-name.vault.json", {
      entryId: "vault-entry-two",
      content: await sealForHandle(
        context,
        pocketPayload({ nodes: [makeNode("same_node", { details: "V2" })] }),
        { vaultId: "vault_two", revision: 8 },
      ),
    });
    assert.equal(await openVaultWithPassword(context, first), true);
    const stale = plain(
      context.PocketNodePopoutModel.buildPayload(lexicalState(context).nodes[0]),
    );
    assert.equal(await openVaultWithPassword(context, second), true);
    const before = plain(lexicalState(context).nodes[0]);
    const rejected = context.PocketNodePopoutEditor.apply(
      { ...stale, body: "V1 stale mutation" },
      { returnDetails: true },
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "file-session-changed");
    assert.deepEqual(plain(lexicalState(context).nodes[0]), before);
    assert.equal(first.writes.length, 0);
    assert.equal(second.writes.length, 0);
  });

  await t.test("page reload cannot reuse an old Vault key or source identity", async () => {
    const firstPage = createVaultContext();
    installOwnerDocument(firstPage, createSyntheticHandle("initial.json"), pocketPayload());
    const firstHandle = createSyntheticHandle("reload.vault.json", {
      content: await sealForHandle(
        firstPage,
        pocketPayload({ nodes: [makeNode("reload_node", { details: "First page" })] }),
        { vaultId: "vault_reload", revision: 2 },
      ),
    });
    assert.equal(await openVaultWithPassword(firstPage, firstHandle), true);
    const stale = plain(
      firstPage.PocketNodePopoutModel.buildPayload(lexicalState(firstPage).nodes[0]),
    );

    const secondPage = createVaultContext();
    const secondHandle = createSyntheticHandle("reload.vault.json", {
      content: firstHandle.content,
    });
    installOwnerDocument(secondPage, createSyntheticHandle("other.json"), pocketPayload());
    assert.equal(secondPage.PocketVault.getActiveSession(), null);
    assert.equal(await openVaultWithPassword(secondPage, secondHandle), true);
    const rejected = secondPage.PocketNodePopoutEditor.apply(
      { ...stale, body: "Cross-page mutation" },
      { returnDetails: true },
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "file-session-changed");
    assert.equal(firstHandle.writes.length, 0);
    assert.equal(secondHandle.writes.length, 0);
  });
});

test("creating an active Vault writes revision 1, clears only covered current safety, and next Save writes revision 2", async () => {
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("source-before-create.json");
  const state = installOwnerDocument(
    context,
    jsonHandle,
    pocketPayload({ nodes: [makeNode("created_vault_item", { details: "Create me encrypted" })] }),
    { ops: [{ type: "pending-before-create", seq: 1 }] },
  );
  context.setDetachedPocketDocumentSession("Device changes");
  const currentSafetyKey = "pocketLite.localSafety.snapshot.v1";
  const trailKey = "pocketLite.localSafety.trail.v1";
  context.__localStorage.values.set(currentSafetyKey, "synthetic-current-safety");
  context.__localStorage.values.set(trailKey, "synthetic-historical-trail");
  const before = currentOwnerSnapshot(context);
  const vaultHandle = createSyntheticHandle("new-active.vault.json");

  assert.equal(await createVaultWithPassword(context, vaultHandle), true);
  const afterCreate = context.capturePocketFileSaveSession();
  assert.equal(afterCreate.ownerKind, "vault");
  assert.strictEqual(afterCreate.handle, vaultHandle);
  assert.equal(afterCreate.id, before.sessionId + 1);
  assert.equal(vaultHandle.writes.length, 1);
  assert.equal(jsonHandle.writes.length, 0);
  assert.equal(parseWrittenEnvelope(vaultHandle, 0).revision, 1);
  assert.equal(context.PocketVault.getActiveSession().revision, 1);
  assert.equal(context.__localStorage.values.has(currentSafetyKey), false);
  assert.equal(context.__localStorage.values.get(trailKey), "synthetic-historical-trail");
  assert.equal(state.ops.length, 0);

  mutateVaultNode(context, {
    details: "Second encrypted revision after creation",
    updatedAt: "2026-07-27T03:00:00.000Z",
  });
  const saved = await context.exportTree({ returnDetails: true });
  assert.equal(saved.ok, true);
  assert.equal(vaultHandle.writes.length, 2);
  assert.equal(parseWrittenEnvelope(vaultHandle, 1).revision, 2);
  assert.equal(context.PocketVault.getActiveSession().revision, 2);
  assert.equal(jsonHandle.writes.length, 0);
});

test("Vault creation cancellation and write failure preserve the previous owner atomically", async (t) => {
  await t.test("credential cancellation", async () => {
    const context = createVaultContext();
    const jsonHandle = createSyntheticHandle("keep-after-cancel.json");
    installOwnerDocument(
      context,
      jsonHandle,
      pocketPayload({ nodes: [makeNode("keep_after_cancel")] }),
      { ops: [{ type: "keep-dirty", seq: 1 }] },
    );
    const before = currentOwnerSnapshot(context);
    const candidate = createSyntheticHandle("cancelled.vault.json");
    context.__savePickerQueue.push(candidate);
    const creating = context.PocketVaultBrowserIo.createActiveVault();
    assert.equal(await waitFor(() => !context.__ui.vaultOverlay.hidden), true);
    context.__ui.elements.get("vaultCredentialCancel").click();
    assert.equal(await creating, false);
    assertOwnerUnchanged(context, before);
    assert.equal(candidate.writes.length, 0);
    assert.equal(jsonHandle.writes.length, 0);
  });

  await t.test("encrypted write failure", async () => {
    const context = createVaultContext();
    const jsonHandle = createSyntheticHandle("keep-after-failure.json");
    installOwnerDocument(
      context,
      jsonHandle,
      pocketPayload({ nodes: [makeNode("keep_after_failure")] }),
      { ops: [{ type: "keep-dirty", seq: 1 }] },
    );
    const before = currentOwnerSnapshot(context);
    const candidate = createSyntheticHandle("failed.vault.json", {
      writeError: new Error("synthetic create Vault failure"),
    });
    context.__savePickerQueue.push(candidate);
    const creating = context.PocketVaultBrowserIo.createActiveVault();
    assert.equal(await waitFor(() => !context.__ui.vaultOverlay.hidden), true);
    context.__ui.elements.get("vaultPassword").value = TEST_PASSPHRASE;
    context.__ui.elements.get("vaultPasswordConfirm").value = TEST_PASSPHRASE;
    await context.__ui.elements.get("vaultCredentialForm").dispatchAsync(
      syntheticEvent("submit", {
        target: context.__ui.elements.get("vaultCredentialForm"),
      }),
    );
    assert.equal(context.__ui.vaultOverlay.hidden, false);
    assert.match(
      context.__ui.elements.get("vaultDialogError").textContent,
      /could not write/i,
    );
    assertOwnerUnchanged(context, before);
    context.__ui.elements.get("vaultCredentialCancel").click();
    assert.equal(await creating, false);
    assertOwnerUnchanged(context, before);
    assert.equal(candidate.writes.length, 0);
    assert.equal(jsonHandle.writes.length, 0);
  });
});

test("explicit readable JSON export never becomes Vault Save authority", async () => {
  const context = createVaultContext();
  const oldJsonHandle = createSyntheticHandle("old-readable.json");
  installOwnerDocument(context, oldJsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("owner.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({
        nodes: [makeNode("export_item", { details: "Readable export content" })],
      }),
      { vaultId: "vault_export_owner", revision: 1 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  const vaultOwnerBefore = context.capturePocketFileSaveSession();
  const exportedJsonHandle = createSyntheticHandle("explicit-copy.json");

  assert.equal(await confirmReadableExport(context, exportedJsonHandle), true);
  assert.equal(exportedJsonHandle.writes.length, 1);
  const readablePayload = JSON.parse(exportedJsonHandle.writes[0]);
  assert.equal(readablePayload.schema, "portal.export.v1");
  assert.equal(readablePayload.mainThoughtTree[0].details, "Readable export content");
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
  assert.equal(context.capturePocketFileSaveSession().id, vaultOwnerBefore.id);
  assert.equal(context.capturePocketFileSaveSession().vaultSessionId, vaultOwnerBefore.vaultSessionId);
  assert.equal(oldJsonHandle.writes.length, 0);
  assert.equal(vaultHandle.writes.length, 0);

  mutateVaultNode(context, {
    details: "Later encrypted change",
    updatedAt: "2026-07-27T04:00:00.000Z",
  });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);
  assert.equal(vaultHandle.writes.length, 1);
  assert.equal(exportedJsonHandle.writes.length, 1);
  assert.equal(oldJsonHandle.writes.length, 0);
  assertNoPlaintextInWrites(vaultHandle, ["Later encrypted change"]);
});

test("JSON A, Vault V, readable copy C, then Save V never reuses either JSON handle", async () => {
  const context = createVaultContext();
  const jsonA = createSyntheticHandle("shared-name.json", { entryId: "json-a" });
  installOwnerDocument(
    context,
    jsonA,
    pocketPayload({ nodes: [makeNode("json_a")] }),
  );
  const vaultV = createSyntheticHandle("shared-name.json", {
    entryId: "vault-v",
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("vault_v", { details: "Vault V" })] }),
      { vaultId: "vault_no_reuse", revision: 2 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultV), true);
  mutateVaultNode(context, { details: "Vault V saved first" });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);

  const jsonC = createSyntheticHandle("shared-name.json", { entryId: "json-c" });
  assert.equal(await confirmReadableExport(context, jsonC), true);
  mutateVaultNode(context, {
    details: "Vault V saved second",
    updatedAt: "2026-07-27T05:00:00.000Z",
  });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);

  assert.equal(jsonA.writes.length, 0);
  assert.equal(jsonC.writes.length, 1);
  assert.equal(vaultV.writes.length, 2);
  assert.equal(parseWrittenEnvelope(vaultV, 0).revision, 3);
  assert.equal(parseWrittenEnvelope(vaultV, 1).revision, 4);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultV);
});

async function contextWithDirtyVault(options = {}) {
  const context = createVaultContext();
  const initial = createSyntheticHandle("before-vault.json");
  installOwnerDocument(context, initial, pocketPayload());
  const vaultHandle = createSyntheticHandle("dirty.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("dirty_vault_item", { details: "Before edit" })] }),
      { vaultId: "vault_dirty_switch", revision: 5 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  mutateVaultNode(context, {
    details: "Unsaved Vault edit",
    updatedAt: "2026-07-27T06:00:00.000Z",
  });
  if (options.failSave) {
    vaultHandle.createWritable = async () => ({
      async write() {
        throw new Error("synthetic dirty-switch save failure");
      },
      async close() {},
      async abort() {
        vaultHandle.abortedWrites += 1;
      },
    });
  }
  return { context, initial, vaultHandle };
}

test("dirty Vault owner-switch Cancel retains the Vault and Discard adopts only a ready JSON candidate", async (t) => {
  await t.test("Cancel", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault();
    const before = currentOwnerSnapshot(context);
    const jsonCandidate = createSyntheticHandle("candidate.json", {
      content: JSON.stringify(
        pocketPayload({ nodes: [makeNode("json_candidate", { details: "Candidate" })] }),
      ),
    });
    const opening = context.loadFromFileHandle(jsonCandidate, {
      permissionAlreadyGranted: true,
    });
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    assertOwnerUnchanged(context, before);
    context.__ui.elements.get("vaultSwitchCancel").click();
    assert.equal(await opening, false);
    assertOwnerUnchanged(context, before);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(jsonCandidate.writes.length, 0);
  });

  await t.test("Discard and continue", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault();
    const before = currentOwnerSnapshot(context);
    const jsonCandidate = createSyntheticHandle("candidate.json", {
      content: JSON.stringify(
        pocketPayload({ nodes: [makeNode("json_candidate", { details: "Candidate" })] }),
      ),
    });
    const opening = context.loadFromFileHandle(jsonCandidate, {
      permissionAlreadyGranted: true,
    });
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    assertOwnerUnchanged(context, before);
    context.__ui.elements.get("vaultSwitchDiscard").click();
    assert.equal(await opening, true);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonCandidate);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
    assert.equal(lexicalState(context).nodes[0].id, "json_candidate");
    assert.equal(context.PocketVault.getActiveSession(), null);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(jsonCandidate.writes.length, 0);
  });
});

test("dirty Vault Save and continue waits for encrypted persistence and blocks switch on failure", async (t) => {
  await t.test("successful encrypted Save then JSON adoption", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault();
    const jsonCandidate = createSyntheticHandle("after-save.json", {
      content: JSON.stringify(
        pocketPayload({ nodes: [makeNode("after_save_candidate")] }),
      ),
    });
    const opening = context.loadFromFileHandle(jsonCandidate, {
      permissionAlreadyGranted: true,
    });
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    context.__ui.elements.get("vaultSwitchSave").click();
    assert.equal(await opening, true);
    assert.equal(vaultHandle.writes.length, 1);
    assert.equal(parseWrittenEnvelope(vaultHandle).revision, 6);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonCandidate);
    assert.equal(lexicalState(context).nodes[0].id, "after_save_candidate");
  });

  await t.test("failed encrypted Save keeps Vault and one dialog", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault({ failSave: true });
    const before = currentOwnerSnapshot(context);
    const jsonCandidate = createSyntheticHandle("must-not-adopt.json", {
      content: JSON.stringify(
        pocketPayload({ nodes: [makeNode("must_not_adopt")] }),
      ),
    });
    const opening = context.loadFromFileHandle(jsonCandidate, {
      permissionAlreadyGranted: true,
    });
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    context.__ui.elements.get("vaultSwitchSave").click();
    assert.equal(
      await waitFor(() => /could not save/i.test(
        context.__ui.elements.get("vaultDialogError").textContent,
      )),
      true,
    );
    assertOwnerUnchanged(context, before);
    assert.equal(context.__ui.vaultOverlay.hidden, false);
    assert.equal(context.PocketVaultBrowserIo.isOwnerActionPending(), true);
    assert.equal(await context.PocketVaultBrowserIo.openVault(), false);
    context.__ui.elements.get("vaultSwitchCancel").click();
    assert.equal(await opening, false);
    assertOwnerUnchanged(context, before);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(jsonCandidate.writes.length, 0);
  });
});

test("Create New from a dirty Vault requires Cancel, Discard, or successful encrypted Save", async (t) => {
  await t.test("Cancel keeps the dirty Vault", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault();
    const before = currentOwnerSnapshot(context);
    const jsonCandidate = createSyntheticHandle("cancel-new.json");
    context.__savePickerQueue.push(jsonCandidate);
    const creating = context.createNewPocketFile();
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    context.__ui.elements.get("vaultSwitchCancel").click();
    assert.equal(await creating, false);
    assertOwnerUnchanged(context, before);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(jsonCandidate.writes.length, 0);
  });

  await t.test("Discard creates and adopts only the chosen JSON file", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault();
    const jsonCandidate = createSyntheticHandle("discard-new.json");
    context.__savePickerQueue.push(jsonCandidate);
    const creating = context.createNewPocketFile();
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    context.__ui.elements.get("vaultSwitchDiscard").click();
    assert.equal(await creating, true);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonCandidate);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
    assert.equal(context.PocketVault.getActiveSession(), null);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(jsonCandidate.writes.length, 1);
  });

  await t.test("Save persists the Vault before creating the chosen JSON file", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault();
    const jsonCandidate = createSyntheticHandle("save-new.json");
    context.__savePickerQueue.push(jsonCandidate);
    const creating = context.createNewPocketFile();
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    context.__ui.elements.get("vaultSwitchSave").click();
    assert.equal(await creating, true);
    assert.equal(vaultHandle.writes.length, 1);
    assert.equal(parseWrittenEnvelope(vaultHandle).revision, 6);
    assert.equal(jsonCandidate.writes.length, 1);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonCandidate);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
  });

  await t.test("failed encrypted Save blocks Create New", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault({ failSave: true });
    const before = currentOwnerSnapshot(context);
    const jsonCandidate = createSyntheticHandle("blocked-new.json");
    context.__savePickerQueue.push(jsonCandidate);
    const creating = context.createNewPocketFile();
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    context.__ui.elements.get("vaultSwitchSave").click();
    assert.equal(
      await waitFor(() => /could not save/i.test(
        context.__ui.elements.get("vaultDialogError").textContent,
      )),
      true,
    );
    assertOwnerUnchanged(context, before);
    assert.equal(jsonCandidate.writes.length, 0);
    assert.equal(vaultHandle.writes.length, 0);
    context.__ui.elements.get("vaultSwitchCancel").click();
    assert.equal(await creating, false);
    assertOwnerUnchanged(context, before);
  });
});

test("Vault-to-JSON adoption rolls back owner and key if final apply throws", async () => {
  const { context, vaultHandle } = await contextWithDirtyVault();
  lexicalState(context).ops = [];
  const before = currentOwnerSnapshot(context);
  const activeVaultSession = context.PocketVault.getActiveSession();
  const jsonCandidate = createSyntheticHandle("apply-failure.json", {
    content: JSON.stringify(
      pocketPayload({ nodes: [makeNode("never_applied")] }),
    ),
  });
  const productionApplyLoadedState = context.applyLoadedState;
  context.applyLoadedState = () => {
    throw new Error("synthetic final apply failure");
  };

  const opened = await context.loadFromFileHandle(jsonCandidate, {
    permissionAlreadyGranted: true,
  });
  context.applyLoadedState = productionApplyLoadedState;
  assert.equal(opened, false);
  assertOwnerUnchanged(context, before);
  assert.strictEqual(context.PocketVault.getActiveSession(), activeVaultSession);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(jsonCandidate.writes.length, 0);
});

test("P017 permission keeps the current owner authoritative until Vault unlock and validation finish", async () => {
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("active-during-permission.json");
  const state = installOwnerDocument(
    context,
    jsonHandle,
    pocketPayload({ nodes: [makeNode("permission_active", { details: "Current tree" })] }),
  );
  const pePayload = plain(context.PocketNodePopoutModel.buildPayload(state.nodes[0]));
  const before = currentOwnerSnapshot(context);
  const candidate = createSyntheticHandle("permission.vault.json", {
    permission: "prompt",
    requestedPermission: "granted",
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("permission_vault", { details: "Vault tree" })] }),
      { vaultId: "vault_permission", revision: 3 },
    ),
  });
  context.__openPickerQueue.push(candidate);

  assert.equal(await context.PocketVaultBrowserIo.openVault(), false);
  assert.equal(context.isPocketFilePermissionPromptOpen(), true);
  assert.equal(context.__ui.permissionOverlay.hidden, false);
  assertOwnerUnchanged(context, before);
  assert.equal(context.canModifyPocket(), false);
  const blockedSave = await context.exportTree({ returnDetails: true });
  assert.equal(blockedSave.ok, false);
  assert.equal(blockedSave.reason, "file-permission-pending");
  const blockedPe = context.PocketNodePopoutEditor.apply(
    { ...pePayload, body: "Must stay in PE" },
    { returnDetails: true },
  );
  assert.equal(blockedPe.ok, false);
  assert.equal(blockedPe.reason, "file-permission-pending");
  assertOwnerUnchanged(context, before);

  context.__ui.elements.get("filePermissionContinue").click();
  assert.equal(
    await waitFor(() => !context.__ui.vaultOverlay.hidden),
    true,
  );
  assertOwnerUnchanged(context, before);
  assert.equal(candidate.writes.length, 0);
  assert.equal(candidate.requestPermissionCalls, 1);
  await submitCredential(context);
  assert.equal(
    await waitFor(() => context.capturePocketFileSaveSession().handle === candidate),
    true,
  );
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
  assert.equal(lexicalState(context).nodes[0].id, "permission_vault");
  assert.equal(jsonHandle.writes.length, 0);
  assert.equal(candidate.writes.length, 0);
});

test("P017 permission Cancel and stale completion clear only the Vault candidate", async (t) => {
  await t.test("Cancel before requesting permission", async () => {
    const context = createVaultContext();
    const active = createSyntheticHandle("active.json");
    installOwnerDocument(context, active, pocketPayload(), {
      ops: [{ type: "keep", seq: 1 }],
    });
    const before = currentOwnerSnapshot(context);
    const candidate = createSyntheticHandle("cancel.vault.json", {
      permission: "prompt",
      requestedPermission: "granted",
      content: await sealForHandle(context, pocketPayload(), {
        vaultId: "vault_permission_cancel",
        revision: 1,
      }),
    });
    context.__openPickerQueue.push(candidate);
    assert.equal(await context.PocketVaultBrowserIo.openVault(), false);
    context.__ui.elements.get("filePermissionCancel").click();
    assert.equal(context.isPocketFilePermissionPromptOpen(), false);
    assertOwnerUnchanged(context, before);
    assert.equal(candidate.requestPermissionCalls, 0);
    assert.equal(candidate.writes.length, 0);
    assert.equal(active.writes.length, 0);
  });

  await t.test("Cancel while permission completion is pending", async () => {
    const permission = deferred();
    const context = createVaultContext();
    const active = createSyntheticHandle("active.json");
    installOwnerDocument(context, active, pocketPayload(), {
      ops: [{ type: "keep", seq: 1 }],
    });
    const before = currentOwnerSnapshot(context);
    const candidate = createSyntheticHandle("stale-permission.vault.json", {
      permission: "prompt",
      requestPermission: async () => permission.promise,
      content: await sealForHandle(context, pocketPayload(), {
        vaultId: "vault_stale_permission",
        revision: 1,
      }),
    });
    context.__openPickerQueue.push(candidate);
    assert.equal(await context.PocketVaultBrowserIo.openVault(), false);
    context.__ui.elements.get("filePermissionContinue").click();
    assert.equal(await waitFor(() => candidate.requestPermissionCalls === 1), true);
    context.__ui.elements.get("filePermissionCancel").click();
    permission.resolve("granted");
    await waitFor(() => !context.isPocketFilePermissionPromptOpen());
    assertOwnerUnchanged(context, before);
    assert.equal(candidate.getFileCalls, 0);
    assert.equal(candidate.writes.length, 0);
    assert.equal(active.writes.length, 0);
  });
});

test("Vault plaintext, password, key, extras, and operations never enter browser recovery storage", async () => {
  const currentSafetyKey = "pocketLite.localSafety.snapshot.v1";
  const jsonRecovery = JSON.stringify({
    schema: "pocket.localSafety.v2",
    payload: pocketPayload({
      nodes: [makeNode("existing_json_recovery", { details: "Existing JSON recovery" })],
    }),
  });
  const context = createVaultContext({
    localStorageSeed: {
      [currentSafetyKey]: jsonRecovery,
      "pocket.vault.state.v1": JSON.stringify({
        vaultId: "forged-global-vault",
        revision: 999,
      }),
    },
  });
  const initial = createSyntheticHandle("initial.json");
  installOwnerDocument(context, initial, pocketPayload());
  context.__localStorage.values.set(currentSafetyKey, jsonRecovery);
  context.__localStorage.calls.length = 0;

  const secrets = {
    label: "SECRET VAULT LABEL Ω",
    details: "SECRET VAULT NOTES 漢字",
    outline: "SECRET VAULT OUTLINE 🧭",
    operation: "SECRET VAULT OPERATION",
    rootExtra: "SECRET VAULT ROOT EXTRA",
    dataExtra: "SECRET VAULT DATA EXTRA",
  };
  const vaultPayload = pocketPayload({
    nodes: [
      makeNode("private_vault_item", {
        label: secrets.label,
        details: secrets.details,
        editor: outlineEditor([
          { id: "private_outline", text: secrets.outline, depth: 0, collapsed: true },
        ]),
      }),
    ],
    rootExtras: { privateRootExtra: secrets.rootExtra },
  });
  const vaultHandle = createSyntheticHandle("private.vault.json", {
    content: await sealForHandle(context, vaultPayload, {
      vaultId: "vault_private_storage",
      revision: 4,
    }),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  const state = lexicalState(context);
  state.dataExtras = { privateDataExtra: secrets.dataExtra };
  state.nodes[0].details = `${secrets.details} edited`;
  context.recordOp({
    type: "private-vault-edit",
    diagnostic: secrets.operation,
  });

  assert.equal(context.saveWorkspaceState(), false);
  assert.equal(context.saveLocalSafetySnapshot("private-vault-edit"), false);
  assert.equal(
    context.saveAutoCache(
      {
        schema: "portal.export.v1",
        nodes: state.nodes,
        tombstones: state.tombstones,
      },
      state.source,
    ),
    false,
  );
  assert.equal(context.saveLastSaveSnapshot(context.buildPocketPayload()), false);
  assert.equal(context.__productionPersistPipSnapshot(), false);
  assert.equal(context.__localStorage.values.get(currentSafetyKey), jsonRecovery);
  assert.equal(context.__indexedDbCalls.length, 0);

  const persisted = JSON.stringify([
    [...context.__localStorage.values.entries()],
    [...context.__sessionStorage.values.entries()],
    context.__localStorage.calls,
    context.__sessionStorage.calls,
    context.__consoleRecords,
    context.__statuses,
  ]);
  for (const secret of Object.values(secrets)) {
    assert.equal(persisted.includes(secret), false, `browser surfaces must not persist ${secret}`);
  }
  assert.equal(JSON.stringify(state).includes(TEST_PASSPHRASE), false);
  assert.equal(JSON.stringify(context.buildPocketPayload()).includes(TEST_PASSPHRASE), false);
  assert.equal(JSON.stringify(context.PocketNodePopoutModel.buildPayload(state.nodes[0])).includes(TEST_PASSPHRASE), false);
  assert.equal(Object.hasOwn(state.pocketFile, "cryptoKey"), false);
  assert.equal(Object.hasOwn(state.pocketFile, "passphrase"), false);
  assert.equal(context.PocketVault.getActiveSession().cryptoKey.extractable, false);
  assert.equal(context.PocketVault.getActiveSession().revision, 4);
});

test("opening a Vault suppresses but does not delete existing ordinary JSON recovery", async () => {
  const currentSafetyKey = "pocketLite.localSafety.snapshot.v1";
  const trailKey = "pocketLite.localSafety.trail.v1";
  const jsonRecovery = JSON.stringify({ payload: pocketPayload(), source: { fileName: "json.json" } });
  const jsonTrail = JSON.stringify([{ payload: pocketPayload(), source: { fileName: "json.json" } }]);
  const context = createVaultContext({
    localStorageSeed: {
      [currentSafetyKey]: jsonRecovery,
      [trailKey]: jsonTrail,
    },
  });
  installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
  context.__localStorage.values.set(currentSafetyKey, jsonRecovery);
  context.__localStorage.values.set(trailKey, jsonTrail);
  const vaultHandle = createSyntheticHandle("recovery-private.vault.json", {
    content: await sealForHandle(context, pocketPayload(), {
      vaultId: "vault_recovery_private",
      revision: 1,
    }),
  });

  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  assert.equal(context.maybeOfferLocalSafetyRestore(lexicalState(context).source), false);
  assert.equal(context.__localStorage.values.get(currentSafetyKey), jsonRecovery);
  assert.equal(context.__localStorage.values.get(trailKey), jsonTrail);
  context.setPocketFileSession(createSyntheticHandle("back-to-json.json"), "back-to-json.json", {
    ownerKind: "json",
    forceNewSession: true,
  });
  assert.equal(context.PocketVault.getActiveSession(), null);
  assert.equal(context.__localStorage.values.get(currentSafetyKey), jsonRecovery);
  assert.equal(context.__localStorage.values.get(trailKey), jsonTrail);
});

test("dirty Vault beforeunload warns synchronously without saving or writing recovery", async () => {
  const context = createVaultContext();
  installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
  const vaultHandle = createSyntheticHandle("beforeunload.vault.json", {
    content: await sealForHandle(context, pocketPayload(), {
      vaultId: "vault_beforeunload",
      revision: 1,
    }),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  mutateVaultNode(context, { details: "Unsaved in-memory Vault edit" });
  const storageCallsBefore = context.__localStorage.calls.length;
  const event = syntheticEvent("beforeunload");

  const warning = context.handlePocketLiteBeforeUnload(event);
  assert.equal(warning, "You have local changes not backed up yet.");
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, "You have local changes not backed up yet.");
  assert.equal(vaultHandle.createWritableCalls, 0);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(context.__localStorage.calls.length, storageCallsBefore);
});

test("Vault owner blocks Document PiP and plaintext PiP snapshots while JSON behaviour remains", async () => {
  const vaultContext = createVaultContext();
  installOwnerDocument(vaultContext, createSyntheticHandle("initial.json"), pocketPayload());
  const vaultHandle = createSyntheticHandle("pip-private.vault.json", {
    content: await sealForHandle(vaultContext, pocketPayload(), {
      vaultId: "vault_pip_private",
      revision: 1,
    }),
  });
  assert.equal(await openVaultWithPassword(vaultContext, vaultHandle), true);
  vaultContext.__pipCalls.snapshots = 0;
  mutateVaultNode(vaultContext, { details: "Never send this to PiP" });
  await vaultContext.openPipWindow();
  assert.equal(vaultContext.__pipCalls.snapshots, 0);
  assert.equal(vaultContext.__pipCalls.requestWindow, 0);
  assert.equal(vaultContext.__pipCalls.popup, 0);
  assert.equal(vaultContext.adoptPocketDocumentFromPip({ dirty: true }), false);
  assert.match(
    vaultContext.__statuses.at(-1).message,
    /not available for encrypted Vaults/i,
  );

  const jsonContext = createVaultContext();
  installOwnerDocument(
    jsonContext,
    createSyntheticHandle("ordinary-pip.json"),
    pocketPayload(),
  );
  jsonContext.__pipCalls.snapshots = 0;
  await jsonContext.openPipWindow();
  assert.equal(jsonContext.__pipCalls.snapshots, 1);
  assert.equal(jsonContext.__pipCalls.requestWindow, 1);
  assert.equal(jsonContext.__pipCalls.popup, 1);
});

test("queued JSON Save completes before Vault adoption, so no JSON write occurs after ownership changes", async () => {
  const writeGate = deferred();
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("queued-json.json", {
    writeDeferred: writeGate,
  });
  installOwnerDocument(
    context,
    jsonHandle,
    pocketPayload({ nodes: [makeNode("queued_json")] }),
  );
  lexicalState(context).nodes[0].details = "JSON change already saving";
  context.recordOp({ type: "queued-json-save" });
  const saving = context.exportTree({ returnDetails: true });
  assert.equal(await waitFor(() => jsonHandle.createWritableCalls === 1), true);

  const vaultHandle = createSyntheticHandle("after-queue.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("after_queue_vault")] }),
      { vaultId: "vault_after_json_queue", revision: 1 },
    ),
  });
  context.__openPickerQueue.push(vaultHandle);
  const opening = context.PocketVaultBrowserIo.openVault();
  await submitCredential(context);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonHandle);
  assert.equal(vaultHandle.writes.length, 0);

  writeGate.resolve();
  assert.equal((await saving).ok, true);
  assert.equal(await opening, false);
  assert.equal(jsonHandle.writes.length, 1);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonHandle);
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
  mutateVaultNode(context, { details: "Encrypted after adoption" });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);
  assert.equal(jsonHandle.writes.length, 1);
  assert.equal(vaultHandle.writes.length, 1);
});

test("stale Vault Save is rejected before writing when its owner changes during encryption", async () => {
  const context = createVaultContext();
  installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
  const vaultHandle = createSyntheticHandle("stale-save.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("stale_save_node")] }),
      { vaultId: "vault_stale_save", revision: 1 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  mutateVaultNode(context, { details: "Must not write after owner change" });
  const sealGate = deferred();
  const sealStarted = deferred();
  const productionVault = context.PocketVault;
  context.PocketVault = Object.freeze({
    ...productionVault,
    async sealWithUnlockedKey(...args) {
      sealStarted.resolve();
      await sealGate.promise;
      return productionVault.sealWithUnlockedKey(...args);
    },
  });
  const saving = context.exportTree({ returnDetails: true });
  await sealStarted.promise;

  const replacementHandle = createSyntheticHandle("replacement.json");
  context.setPocketFileSession(replacementHandle, replacementHandle.name, {
    ownerKind: "json",
    forceNewSession: true,
  });
  sealGate.resolve();
  const result = await saving;
  assert.equal(result.ok, false);
  assert.equal(result.reason, "file-session-changed");
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(replacementHandle.writes.length, 0);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, replacementHandle);
});

test("two independent pages own same-name Vaults, keys, sessions, and PE Saves independently", async () => {
  const pageA = createVaultContext({ href: "https://pocket.test/index.html?page=A" });
  const pageB = createVaultContext({ href: "https://pocket.test/index.html?page=B" });
  installOwnerDocument(pageA, createSyntheticHandle("initial-a.json"), pocketPayload());
  installOwnerDocument(pageB, createSyntheticHandle("initial-b.json"), pocketPayload());
  const handleA = createSyntheticHandle("same-name.vault.json", {
    entryId: "same-name-a",
    content: await sealForHandle(
      pageA,
      pocketPayload({ nodes: [makeNode("page_a_node", { details: "Page A" })] }),
      { vaultId: "vault_page_a", revision: 1 },
    ),
  });
  const handleB = createSyntheticHandle("same-name.vault.json", {
    entryId: "same-name-b",
    content: await sealForHandle(
      pageB,
      pocketPayload({ nodes: [makeNode("page_b_node", { details: "Page B" })] }),
      { vaultId: "vault_page_b", revision: 6 },
    ),
  });
  assert.equal(await openVaultWithPassword(pageA, handleA), true);
  assert.equal(await openVaultWithPassword(pageB, handleB), true);
  assert.notEqual(
    pageA.capturePocketFileSaveSession().vaultSessionId,
    pageB.capturePocketFileSaveSession().vaultSessionId,
  );
  assert.notStrictEqual(
    pageA.PocketVault.getActiveSession().cryptoKey,
    pageB.PocketVault.getActiveSession().cryptoKey,
  );

  const payloadA = plain(
    pageA.PocketNodePopoutModel.buildPayload(lexicalState(pageA).nodes[0]),
  );
  const payloadB = plain(
    pageB.PocketNodePopoutModel.buildPayload(lexicalState(pageB).nodes[0]),
  );
  assert.equal((await pageA.PocketNodePopoutEditor.applyAndSave({
    ...payloadA,
    body: "Page A encrypted PE",
  })).ok, true);
  assert.equal((await pageB.PocketNodePopoutEditor.applyAndSave({
    ...payloadB,
    body: "Page B encrypted PE",
  })).ok, true);

  assert.equal(handleA.writes.length, 1);
  assert.equal(handleB.writes.length, 1);
  assert.equal(
    (await pageA.PocketCrypto.openJson(parseWrittenEnvelope(handleA), TEST_PASSPHRASE))
      .mainThoughtTree[0].details,
    "Page A encrypted PE",
  );
  assert.equal(
    (await pageB.PocketCrypto.openJson(parseWrittenEnvelope(handleB), TEST_PASSPHRASE))
      .mainThoughtTree[0].details,
    "Page B encrypted PE",
  );
});

test("ordinary JSON, detached Save picker, and no-file gate remain intact", async () => {
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("ordinary.json");
  const state = installOwnerDocument(
    context,
    jsonHandle,
    pocketPayload({ nodes: [makeNode("ordinary_json")] }),
  );
  state.nodes[0].details = "Ordinary readable JSON";
  context.recordOp({ type: "ordinary-json-save" });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);
  assert.equal(jsonHandle.writes.length, 1);
  assert.equal(JSON.parse(jsonHandle.writes[0]).mainThoughtTree[0].details, "Ordinary readable JSON");

  context.setDetachedPocketDocumentSession("Detached device changes");
  state.nodes[0].details = "Detached explicit destination";
  context.recordOp({ type: "detached-save" });
  const detachedDestination = createSyntheticHandle("detached-destination.json");
  context.__savePickerQueue.push(detachedDestination);
  const detachedResult = await context.exportTree({ returnDetails: true });
  assert.equal(detachedResult.ok, true);
  assert.equal(detachedDestination.writes.length, 1);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, detachedDestination);
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
  assert.equal(jsonHandle.writes.length, 1);

  context.clearPocketFileSession();
  assert.equal(context.canShowPocketTree(), false);
  assert.equal(context.canModifyPocket(), false);
  assert.equal(context.requirePocketFileForChanges(), false);
});

test("Vault round trip preserves nested Unicode, empty Notes, structural Outline, and accepted text limits", async () => {
  const context = createVaultContext();
  installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
  const maximumTitle = "Ｔ".repeat(220);
  const maximumNotes = "語".repeat(4000);
  const maximumOutlineText = "界".repeat(4000);
  const payload = pocketPayload({
    nodes: [
      makeNode("unicode_parent", {
        label: maximumTitle,
        details: maximumNotes,
        editor: outlineEditor([
          {
            id: "maximum_outline",
            text: maximumOutlineText,
            depth: 0,
            collapsed: true,
          },
          {
            id: "structural_outline",
            text: "",
            depth: 1,
            collapsed: false,
          },
        ]),
      }),
      makeNode("unicode_child", {
        parentId: "unicode_parent",
        label: "Nested café 🌏 مرحبا",
        order: 0,
      }),
      makeNode("empty_notes", {
        label: "Empty Notes",
      }),
    ],
    rootExtras: { unicodeExtra: "naïve Ω" },
  });
  assert.deepEqual(
    plain(context.PocketDeviceChanges.validateStructure(payload).errors),
    [],
  );
  const vaultHandle = createSyntheticHandle("coverage.vault.json", {
    content: await sealForHandle(context, payload, {
      vaultId: "vault_data_coverage",
      revision: 10,
    }),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  const state = lexicalState(context);
  assert.equal(state.nodes[0].label.length, 220);
  assert.equal(state.nodes[0].details.length, 4000);
  assert.equal(state.nodes[0].editor.outline[0].text.length, 4000);
  assert.equal(state.nodes[0].editor.outline[1].text, "");
  assert.equal(state.nodes[0].editor.outline[1].depth, 1);
  assert.equal(state.nodes[1].label, "Nested café 🌏 مرحبا");
  assert.equal(Object.hasOwn(state.nodes[2], "details"), false);
  mutateVaultNode(context, {
    updatedAt: "2026-07-27T07:00:00.000Z",
  });
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);
  const reopened = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  assert.equal(reopened.mainThoughtTree[0].label, maximumTitle);
  assert.equal(reopened.mainThoughtTree[0].details, maximumNotes);
  assert.equal(reopened.mainThoughtTree[0].editor.outline[0].text, maximumOutlineText);
  assert.equal(reopened.mainThoughtTree[1].label, "Nested café 🌏 مرحبا");
  assert.equal(Object.hasOwn(reopened.mainThoughtTree[2], "details"), false);
});

test("successful Vault adoption invalidates any earlier inline Details editor", async () => {
  const context = createVaultContext();
  const initial = createSyntheticHandle("inline-before.json");
  const state = installOwnerDocument(
    context,
    initial,
    pocketPayload({ nodes: [makeNode("shared_inline_id", { details: "JSON original" })] }),
  );
  state.selectedId = "shared_inline_id";
  context.openDetailsEditorForSelectedNode();
  assert.equal(state.detailsEdit.id, "shared_inline_id");
  assert.equal(context.__ui.elements.get("detailOverlay").hidden, false);

  const vaultHandle = createSyntheticHandle("inline-after.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("shared_inline_id", { details: "Vault original" })] }),
      { vaultId: "vault_inline_guard", revision: 1 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  assert.equal(state.nodes[0].details, "Vault original");
  assert.equal(state.detailsEdit.id, "");
  assert.equal(context.__ui.elements.get("detailOverlay").hidden, true);
  assert.equal(initial.writes.length, 0);
  assert.equal(vaultHandle.writes.length, 0);
});

test("Vault credential dialog is accessible, modal, keyboard-cancellable, and clears passwords", async () => {
  const index = source("index.html");
  assert.match(index, /id="vaultDialogOverlay"/);
  assert.match(index, /id="vaultDialogCard"[^>]*role="dialog"/);
  assert.match(index, /id="vaultDialogCard"[^>]*aria-modal="true"/);
  assert.match(index, /id="vaultDialogCard"[^>]*aria-labelledby="vaultDialogTitle"/);
  assert.match(index, /id="vaultPassword"[^>]*type="password"/);
  assert.match(index, /id="vaultPasswordConfirm"[^>]*type="password"/);
  assert.equal(/\bprompt\s*\(/.test(source("js/pocket-vault-io-browser.js")), false);

  const context = createVaultContext();
  installOwnerDocument(context, createSyntheticHandle("active.json"), pocketPayload());
  const candidate = createSyntheticHandle("keyboard.vault.json", {
    content: await sealForHandle(context, pocketPayload(), {
      vaultId: "vault_keyboard",
      revision: 1,
    }),
  });
  context.__openPickerQueue.push(candidate);
  const opening = context.PocketVaultBrowserIo.openVault();
  assert.equal(await waitFor(() => !context.__ui.vaultOverlay.hidden), true);
  assert.strictEqual(
    context.__ui.document.activeElement,
    context.__ui.elements.get("vaultPassword"),
  );
  assert.equal(context.__ui.surface.inert, true);
  context.__ui.elements.get("vaultPassword").value = "must-be-cleared";
  const escape = syntheticEvent("keydown", {
    key: "Escape",
    target: context.__ui.elements.get("vaultPassword"),
  });
  for (const listener of context.__windowListeners.get("keydown") || []) listener(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(await opening, false);
  assert.equal(context.__ui.vaultOverlay.hidden, true);
  assert.equal(context.__ui.surface.inert, false);
  assert.equal(context.__ui.elements.get("vaultPassword").value, "");
  assert.equal(context.__ui.elements.get("vaultPasswordConfirm").value, "");
  assert.equal(candidate.writes.length, 0);
});

test("create Vault forgets raw password fields immediately after key derivation, before sealing or writing", async () => {
  const sealGate = deferred();
  const sealStarted = deferred();
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("credential-source.json");
  installOwnerDocument(context, jsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("credential-created.vault.json");
  const productionVault = context.PocketVault;
  context.PocketVault = Object.freeze({
    ...productionVault,
    async sealWithUnlockedKey(...args) {
      sealStarted.resolve();
      await sealGate.promise;
      return productionVault.sealWithUnlockedKey(...args);
    },
  });

  context.__savePickerQueue.push(vaultHandle);
  const creating = context.PocketVaultBrowserIo.createActiveVault();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  const passwordInput = context.__ui.elements.get("vaultPassword");
  const confirmInput = context.__ui.elements.get("vaultPasswordConfirm");
  passwordInput.value = TEST_PASSPHRASE;
  confirmInput.value = TEST_PASSPHRASE;
  const submitting = context.__ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", {
      target: context.__ui.elements.get("vaultCredentialForm"),
    }),
  );

  await sealStarted.promise;
  assert.equal(passwordInput.value, "");
  assert.equal(confirmInput.value, "");
  assert.equal(vaultHandle.createWritableCalls, 0);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonHandle);

  sealGate.resolve();
  await submitting;
  assert.equal(await creating, true);
  assert.equal(vaultHandle.writes.length, 1);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
});

test("open Vault forgets the raw password before queued adoption work can continue", async () => {
  const adoptionGate = deferred();
  const adoptionStarted = deferred();
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("unlock-source.json");
  installOwnerDocument(context, jsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("credential-opened.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("credential_opened")] }),
      { vaultId: "vault_credential_opened", revision: 1 },
    ),
  });
  const blockingTransition = context.enqueuePocketOwnerTransition(async () => {
    adoptionStarted.resolve();
    await adoptionGate.promise;
    return { ok: true };
  });
  await adoptionStarted.promise;

  context.__openPickerQueue.push(vaultHandle);
  const opening = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  const passwordInput = context.__ui.elements.get("vaultPassword");
  const confirmInput = context.__ui.elements.get("vaultPasswordConfirm");
  passwordInput.value = TEST_PASSPHRASE;
  confirmInput.value = "must-also-be-forgotten";
  const submitting = context.__ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", {
      target: context.__ui.elements.get("vaultCredentialForm"),
    }),
  );

  await submitting;
  assert.equal(passwordInput.value, "");
  assert.equal(confirmInput.value, "");
  assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonHandle);
  assert.equal(vaultHandle.writes.length, 0);

  adoptionGate.resolve();
  await blockingTransition;
  assert.equal(await opening, true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
  assert.equal(vaultHandle.writes.length, 0);
});

test("one main-page beforeunload owner warns for unsaved Vault edits without duplicate registration", () => {
  const overlays = source("js/pocket-overlays-init.js");
  assert.equal(
    (overlays.match(/addEventListener\("beforeunload",\s*handlePocketLiteBeforeUnload\)/g) || []).length,
    1,
  );
  assert.equal(
    /onbeforeunload\s*=\s*handlePocketLiteBeforeUnload/.test(overlays),
    false,
  );
});

test("readable export cancellation and failure leave Vault ownership and dirty state unchanged", async (t) => {
  for (const mode of ["cancel", "failure"]) {
    await t.test(mode, async () => {
      const context = createVaultContext();
      installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
      const vaultHandle = createSyntheticHandle("export-owner.vault.json", {
        content: await sealForHandle(
          context,
          pocketPayload({ nodes: [makeNode("export_cancel_item")] }),
          { vaultId: `vault_export_${mode}`, revision: 1 },
        ),
      });
      assert.equal(await openVaultWithPassword(context, vaultHandle), true);
      mutateVaultNode(context, { details: "Still unsaved in Vault" });
      const before = currentOwnerSnapshot(context);
      const candidate = mode === "cancel"
        ? Object.assign(new Error("synthetic picker cancellation"), { name: "AbortError" })
        : createSyntheticHandle("failed-readable.json", {
          writeError: new Error("synthetic readable export failure"),
        });
      context.__savePickerQueue.push(candidate);
      const exporting = context.PocketVaultBrowserIo.exportUnencryptedJsonCopy();
      assert.equal(
        await waitFor(() => !context.__ui.elements.get("vaultExportActions").hidden),
        true,
      );
      context.__ui.elements.get("vaultExportConfirm").click();
      assert.equal(await exporting, false);
      assertOwnerUnchanged(context, before);
      assert.equal(vaultHandle.writes.length, 0);
      if (mode === "failure") assert.equal(candidate.writes.length, 0);
    });
  }
});

test("Vault Save race advances BASE only to written payload and retains newer in-memory operations", async () => {
  const closeGate = deferred();
  const context = createVaultContext();
  installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
  const vaultHandle = createSyntheticHandle("save-race.vault.json", {
    closeDeferred: closeGate,
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("race_item", { details: "Initial" })] }),
      { vaultId: "vault_save_race", revision: 1 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  const state = lexicalState(context);
  state.nodes[0].details = "Covered by first encrypted Save";
  context.recordOp({ type: "covered-race-change" });
  const firstSequence = context.getPocketHighestOperationSequence();
  const saving = context.exportTree({ returnDetails: true });
  assert.equal(await waitFor(() => vaultHandle.createWritableCalls === 1), true);

  state.nodes[0].details = "Newer edit while encrypted Save is closing";
  context.recordOp({ type: "newer-race-change" });
  const secondSequence = context.getPocketHighestOperationSequence();
  assert.ok(secondSequence > firstSequence);
  closeGate.resolve();
  const result = await saving;
  assert.equal(result.ok, true);
  assert.equal(vaultHandle.writes.length, 1);
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].seq, secondSequence);
  assert.equal(state.nodes[0].details, "Newer edit while encrypted Save is closing");
  assert.equal(
    state.documentBaseline.payload.nodes[0].details,
    "Covered by first encrypted Save",
  );
  const written = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  assert.equal(written.mainThoughtTree[0].details, "Covered by first encrypted Save");
  assert.equal(context.PocketVault.getActiveSession().revision, 2);
  context.__productionRefreshMeta();
  assert.equal(context.__ui.elements.get("vaultRecoveryNotice").hidden, false);
  const stored = JSON.stringify([...context.__localStorage.values.entries()]);
  assert.equal(stored.includes("Newer edit while encrypted Save is closing"), false);
});

test("delayed handle comparison plus owner change clears the stale Vault candidate", async () => {
  const comparison = deferred();
  const context = createVaultContext();
  const firstOwner = createSyntheticHandle("comparison-owner.json");
  installOwnerDocument(context, firstOwner, pocketPayload());
  const staleCandidate = createSyntheticHandle("comparison-stale.vault.json", {
    isSameEntry: async () => comparison.promise,
  });
  context.__openPickerQueue.push(staleCandidate);
  const opening = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => context.PocketVaultBrowserIo.isOwnerActionPending()),
    true,
  );

  const nextOwner = createSyntheticHandle("comparison-next.json");
  context.setPocketFileSession(nextOwner, nextOwner.name, {
    ownerKind: "json",
    forceNewSession: true,
  });
  comparison.resolve(false);
  assert.equal(await opening, false);
  assert.equal(context.PocketVaultBrowserIo.isOwnerActionPending(), false);
  assert.equal(staleCandidate.getFileCalls, 0);
  assert.equal(staleCandidate.writes.length, 0);
  assert.equal(firstOwner.writes.length, 0);
  assert.equal(nextOwner.writes.length, 0);

  const currentCandidate = createSyntheticHandle("comparison-current.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("comparison_current")] }),
      { vaultId: "vault_comparison_current", revision: 1 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, currentCandidate), true);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, currentCandidate);
});

test("same or unverifiable destination identity fails closed before readable or encrypted writes", async (t) => {
  for (const relationship of ["same", "throws", "unavailable"]) {
    await t.test(`readable JSON export: ${relationship}`, async () => {
      const context = createVaultContext();
      installOwnerDocument(context, createSyntheticHandle("initial.json"), pocketPayload());
      const sharedEntryId = `vault-export-${relationship}`;
      const vaultHandle = createSyntheticHandle("identity-owner.vault.json", {
        entryId: sharedEntryId,
        content: await sealForHandle(
          context,
          pocketPayload({ nodes: [makeNode(`identity_export_${relationship}`)] }),
          { vaultId: `vault_identity_export_${relationship}`, revision: 1 },
        ),
      });
      assert.equal(await openVaultWithPassword(context, vaultHandle), true);
      const candidate = createSyntheticHandle("identity-copy.json", {
        entryId: relationship === "same" ? sharedEntryId : `copy-${relationship}`,
        isSameEntry: relationship === "throws"
          ? async () => { throw new Error("synthetic identity lookup failure"); }
          : undefined,
      });
      if (relationship === "unavailable") {
        delete vaultHandle.isSameEntry;
        delete candidate.isSameEntry;
      }
      const before = currentOwnerSnapshot(context);

      assert.equal(await confirmReadableExport(context, candidate), false);

      assertOwnerUnchanged(context, before);
      assert.equal(candidate.createWritableCalls, 0);
      assert.equal(candidate.writes.length, 0);
      assert.equal(vaultHandle.writes.length, 0);
      assert.match(
        context.__statuses.at(-1).message,
        relationship === "same"
          ? /choose a different file/i
          : /could not verify that destination is a different file/i,
      );
    });
  }

  for (const relationship of ["same", "throws", "unavailable"]) {
    await t.test(`new encrypted Vault: ${relationship}`, async () => {
      const sharedEntryId = `vault-create-${relationship}`;
      const context = createVaultContext();
      const active = createSyntheticHandle("identity-source.json", {
        entryId: sharedEntryId,
      });
      installOwnerDocument(context, active, pocketPayload(), {
        ops: [{ type: "keep-unsaved", seq: 1 }],
      });
      const candidate = createSyntheticHandle("identity-target.vault.json", {
        entryId: relationship === "same" ? sharedEntryId : `target-${relationship}`,
        isSameEntry: relationship === "throws"
          ? async () => { throw new Error("synthetic identity lookup failure"); }
          : undefined,
      });
      if (relationship === "unavailable") {
        delete active.isSameEntry;
        delete candidate.isSameEntry;
      }
      const before = currentOwnerSnapshot(context);
      context.__savePickerQueue.push(candidate);

      assert.equal(await context.PocketVaultBrowserIo.createActiveVault(), false);

      assertOwnerUnchanged(context, before);
      assert.equal(context.__ui.vaultOverlay.hidden, true);
      assert.equal(candidate.createWritableCalls, 0);
      assert.equal(candidate.writes.length, 0);
      assert.equal(active.writes.length, 0);
      assert.match(
        context.__statuses.at(-1).message,
        relationship === "same"
          ? /choose a different file/i
          : /could not verify that destination is a different file/i,
      );
    });
  }
});

test("encrypted open, PE apply, and Save never log Vault plaintext or credentials", async () => {
  const context = createVaultContext();
  installOwnerDocument(context, createSyntheticHandle("logging-source.json"), pocketPayload());
  const secrets = {
    passphrase: TEST_PASSPHRASE,
    label: "CONSOLE SECRET TITLE Ω",
    details: "CONSOLE SECRET NOTES 漢字",
    outline: "CONSOLE SECRET OUTLINE 🧭",
    updatedDetails: "CONSOLE SECRET PE UPDATE 🔐",
    rootExtra: "CONSOLE SECRET ROOT EXTRA",
    dataExtra: "CONSOLE SECRET DATA EXTRA",
    nodeId: "console_private_item",
  };
  const payload = pocketPayload({
    nodes: [
      makeNode("console_private_item", {
        label: secrets.label,
        details: secrets.details,
        editor: outlineEditor([
          { id: "console_private_outline", text: secrets.outline, depth: 0 },
        ]),
      }),
    ],
    rootExtras: { consolePrivateRoot: secrets.rootExtra },
    dataExtras: { consolePrivateData: secrets.dataExtra },
  });
  const vaultHandle = createSyntheticHandle("logging-owner.vault.json", {
    content: await sealForHandle(context, payload, {
      vaultId: "vault_console_privacy",
      revision: 1,
    }),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);

  const node = lexicalState(context).nodes[0];
  const opening = context.PocketNodePopoutModel.buildPayload(node);
  const applied = context.PocketNodePopoutEditor.apply({
    ...opening,
    title: node.label,
    body: secrets.updatedDetails,
    mode: "text",
  }, { returnDetails: true });
  assert.equal(applied.ok, true);
  assert.equal((await context.exportTree({ returnDetails: true })).ok, true);

  const observableDiagnostics = JSON.stringify(context.__consoleRecords);
  for (const secret of Object.values(secrets)) {
    assert.equal(
      observableDiagnostics.includes(secret),
      false,
      `console diagnostics must not expose ${secret}`,
    );
  }
  assert.equal(JSON.stringify(context.__statuses).includes(TEST_PASSPHRASE), false);
  assert.equal(vaultHandle.writes.length, 1);
  assertNoPlaintextInWrites(vaultHandle, Object.values(secrets));
});

test("unsupported File System Access API fails calmly without decrypting or adopting", async () => {
  const context = createVaultContext();
  const active = createSyntheticHandle("active.json");
  installOwnerDocument(context, active, pocketPayload(), {
    ops: [{ type: "keep-dirty", seq: 1 }],
  });
  const before = currentOwnerSnapshot(context);
  delete context.showOpenFilePicker;
  assert.equal(await context.PocketVaultBrowserIo.openVault(), false);
  assertOwnerUnchanged(context, before);
  assert.match(
    context.__statuses.at(-1).message,
    /require supported local file access/i,
  );
  delete context.showSaveFilePicker;
  assert.equal(await context.PocketVaultBrowserIo.createActiveVault(), false);
  assertOwnerUnchanged(context, before);
  assert.equal(active.writes.length, 0);
});

test("prepared document adoption uses an opaque lease which unrelated cleanup cannot release", async () => {
  const context = createVaultContext();
  installOwnerDocument(context, createSyntheticHandle("lease-owner.json"), pocketPayload());

  const lease = await context.PocketVaultBrowserIo.beforeAdoptPreparedDocument({
    kind: "json",
    displayName: "lease-candidate.json",
  });
  assert.ok(lease && typeof lease === "object");
  assert.equal(context.PocketVaultBrowserIo.isOwnerActionPending(), true);
  assert.equal(
    await context.PocketVaultBrowserIo.beforeAdoptPreparedDocument({
      kind: "json",
      displayName: "unrelated.json",
    }),
    false,
  );
  assert.equal(context.PocketVaultBrowserIo.finishPreparedDocumentAdoption({}), false);
  assert.equal(context.PocketVaultBrowserIo.isOwnerActionPending(), true);
  assert.equal(context.PocketVaultBrowserIo.finishPreparedDocumentAdoption(lease), true);
  assert.equal(context.PocketVaultBrowserIo.isOwnerActionPending(), false);
  assert.equal(context.PocketVaultBrowserIo.finishPreparedDocumentAdoption(lease), false);
});

test("Create New rechecks source identity after delayed handle comparison and before dirty-owner resolution", async () => {
  const comparison = deferred();
  let comparisonStarted = false;
  const { context, vaultHandle } = await contextWithDirtyVault();
  const candidate = createSyntheticHandle("stale-create-new.json", {
    isSameEntry: async () => {
      comparisonStarted = true;
      return comparison.promise;
    },
  });
  context.__savePickerQueue.push(candidate);

  const creating = context.createNewPocketFile();
  assert.equal(await waitFor(() => comparisonStarted), true);
  const nextOwner = createSyntheticHandle("new-current-owner.json");
  context.setPocketFileSession(nextOwner, nextOwner.name, {
    ownerKind: "json",
    forceNewSession: true,
  });
  comparison.resolve(false);

  assert.equal(await creating, false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, nextOwner);
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
  assert.equal(context.__ui.elements.get("vaultSwitchActions").hidden, true);
  assert.equal(candidate.writes.length, 0);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(nextOwner.writes.length, 0);
});

test("final adoption effect failure atomically restores the exact prior owner, Vault key, and document", async () => {
  const { context, vaultHandle } = await contextWithDirtyVault();
  lexicalState(context).ops = [];
  const before = currentOwnerSnapshot(context);
  const activeVaultSession = context.PocketVault.getActiveSession();
  const candidate = createSyntheticHandle("finish-failure.json", {
    content: JSON.stringify(
      pocketPayload({ nodes: [makeNode("must_not_finish_adoption")] }),
    ),
  });
  const productionFinish = context.finishLoadedStateAdoption;
  context.finishLoadedStateAdoption = () => {
    throw new Error("synthetic final adoption effect failure");
  };

  const opened = await context.loadFromFileHandle(candidate, {
    permissionAlreadyGranted: true,
  });
  context.finishLoadedStateAdoption = productionFinish;

  assert.equal(opened, false);
  assertOwnerUnchanged(context, before);
  assert.strictEqual(context.PocketVault.getActiveSession(), activeVaultSession);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(candidate.writes.length, 0);
});

test("active inline-title draft gates owner switching and successful adoption clears stale navigation work", async (t) => {
  await t.test("inline-title draft is included in dirty owner-switch gating", async () => {
    const { context, vaultHandle } = await contextWithDirtyVault();
    const state = lexicalState(context);
    state.ops = [];
    state.inlineEdit = {
      id: state.nodes[0].id,
      isNew: false,
      originalLabel: state.nodes[0].label,
      afterId: "",
      parentId: "root",
      autoFocus: false,
    };
    context.__ui.elements.get("treeRoot").querySelector = () => ({
      value: "Unsaved inline title draft",
    });
    assert.equal(context.hasUnsavedPocketLiteChanges(), true);

    const candidate = createSyntheticHandle("inline-gated.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("inline_candidate")] })),
    });
    const opening = context.loadFromFileHandle(candidate, {
      permissionAlreadyGranted: true,
    });
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
      true,
    );
    context.__ui.elements.get("vaultSwitchCancel").click();
    assert.equal(await opening, false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
    assert.equal(candidate.writes.length, 0);
    assert.equal(vaultHandle.writes.length, 0);
  });

  await t.test("successful adoption cancels delayed copy and resets type-jump and navigation memory", async () => {
    const context = createVaultContext();
    const active = createSyntheticHandle("transient-owner.json");
    const state = installOwnerDocument(context, active, pocketPayload());
    state.typeJump = { query: "synthetic", cycle: 3, lastAt: 12345 };
    state.navigationMemory = {
      filterSelectedId: state.nodes[0].id,
      filterFocusRootId: state.nodes[0].id,
      preFocusSelectedId: state.nodes[0].id,
    };
    context.scheduleCopyClick(state.nodes[0].id);
    assert.equal(vm.runInContext("pendingCopyClickTimer", context), 1);

    const candidate = createSyntheticHandle("transient-target.vault.json", {
      content: await sealForHandle(
        context,
        pocketPayload({ nodes: [makeNode("transient_target")] }),
        { vaultId: "vault_transient_target", revision: 1 },
      ),
    });
    assert.equal(await openVaultWithPassword(context, candidate), true);
    assert.equal(vm.runInContext("pendingCopyClickTimer", context), null);
    assert.deepEqual(plain(state.typeJump), { query: "", cycle: 0, lastAt: 0 });
    assert.deepEqual(plain(state.navigationMemory), {
      filterSelectedId: "",
      filterFocusRootId: "",
      preFocusSelectedId: "",
    });
    assert.equal(state.focusRootId, "");
    assert.equal(active.writes.length, 0);
    assert.equal(candidate.writes.length, 0);
  });
});
