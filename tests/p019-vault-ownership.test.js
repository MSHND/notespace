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
const RECOVERY_OUTPUT_PASSPHRASE = "synthetic-recovered-vault-password";
const VAULT_RECOVERY_STORAGE_KEY = "pocketLite.vaultRecovery.encrypted.v1";

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
      this.style = {
        setProperty(name, value) {
          this[String(name)] = String(value);
        },
        removeProperty(name) {
          delete this[String(name)];
        },
      };
      this.attributes = new Map();
      this.listeners = new Map();
      this._textContent = "";
      this._innerHTML = "";
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
      this._innerHTML = "";
      this.children = [];
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(value) {
      this._innerHTML = String(value ?? "");
      this._textContent = "";
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

    querySelector(selector) {
      const match = String(selector || "").match(/^\[data-edit-id="((?:\\.|[^"])*)"\]$/);
      if (!match) return null;
      const wanted = match[1].replace(/\\(["\\])/g, "$1");
      const descendants = [];
      const visit = (element) => {
        for (const child of element.children || []) {
          descendants.push(child);
          visit(child);
        }
      };
      visit(this);
      return descendants.find((element) => (
        element.getAttribute?.("data-edit-id") === wanted
      )) || null;
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
  const recoveryWarningActions = element("div", "vaultRecoveryWarningActions");
  recoveryWarningActions.hidden = true;
  recoveryWarningActions.appendChild(element("button", "vaultRecoveryUnlock", "View recovery"));
  recoveryWarningActions.appendChild(element("button", "vaultRecoveryNotNow", "Not now"));
  recoveryWarningActions.appendChild(element("button", "vaultRecoveryDelete", "Delete recovery"));
  vaultCard.appendChild(recoveryWarningActions);
  const recoveryConfirmActions = element("div", "vaultRecoveryConfirmActions");
  recoveryConfirmActions.hidden = true;
  recoveryConfirmActions.appendChild(element("button", "vaultRecoveryConfirm", "Continue"));
  recoveryConfirmActions.appendChild(element("button", "vaultRecoveryConfirmCancel", "Cancel"));
  vaultCard.appendChild(recoveryConfirmActions);

  const recoveryViewerOverlay = element("div", "vaultRecoveryViewerOverlay");
  recoveryViewerOverlay.hidden = true;
  const recoveryViewerCard = element("section", "vaultRecoveryViewerCard");
  recoveryViewerOverlay.appendChild(recoveryViewerCard);
  recoveryViewerCard.appendChild(element("p", "vaultRecoveryCaptureTime"));
  recoveryViewerCard.appendChild(element("ul", "vaultRecoveryTree"));
  recoveryViewerCard.appendChild(element("h3", "vaultRecoverySelectedLabel"));
  recoveryViewerCard.appendChild(element("pre", "vaultRecoverySelectedDetails"));
  const recoveryOutlineSection = element("section", "vaultRecoverySelectedOutlineSection");
  recoveryOutlineSection.hidden = true;
  recoveryOutlineSection.appendChild(element("pre", "vaultRecoverySelectedOutline"));
  recoveryViewerCard.appendChild(recoveryOutlineSection);
  const recoveryUnlockedActions = element("div", "vaultRecoveryUnlockedActions");
  recoveryUnlockedActions.appendChild(element("button", "vaultRecoveryKeep", "Keep for later"));
  recoveryUnlockedActions.appendChild(element("button", "vaultRecoverySaveVault", "Save as new encrypted Vault"));
  recoveryUnlockedActions.appendChild(element("button", "vaultRecoverySaveJson", "Save as plain JSON"));
  recoveryUnlockedActions.appendChild(element("button", "vaultRecoveryAddExisting", "Add to existing Pocket file"));
  recoveryUnlockedActions.appendChild(element("button", "vaultRecoveryDiscard", "Discard recovery"));
  recoveryViewerCard.appendChild(recoveryUnlockedActions);

  body.appendChild(surface);
  body.appendChild(permissionOverlay);
  body.appendChild(vaultOverlay);
  body.appendChild(recoveryViewerOverlay);

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
    recoveryViewerOverlay,
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
    repairVisibleSelectionAfterRender() {},
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
    "js/pocket-render.js",
    "js/pocket-io-browser.js",
    "js/pocket-device-changes.js",
    "js/pocket-crypto.js",
    "js/pocket-vault.js",
    "js/pocket-vault-io-browser.js",
    "js/pocket-sync-owner-controller.js",
    "js/pocket-owner-save-boundary.js",
    "js/pocket-file-opening.js",
    "js/pocket-vault-recovery-viewer.js",
    "js/pocket-vault-recovery.js",
    "js/pocket-node-popout-model.js",
    "js/pocket-node-popout-target.js",
    "js/pocket-node-popout-editor.js",
  ];
  for (const relativePath of productionSources) {
    let script = source(relativePath);
    if (relativePath === "js/pocket-vault-io-browser.js"
        && options.exposeVaultDialogTestControl === true) {
      const marker = "  global.PocketVaultBrowserIo = Object.freeze({";
      assert.equal(script.includes(marker), true, "Vault dialog test control marker should exist");
      script = script.replace(
        marker,
        [
          "  global.__closeVaultDialogForTest = function closeVaultDialogForTest() {",
          "    return closeDialog(false, { restoreFocus: false });",
          "  };",
          "",
          marker,
        ].join("\n"),
      );
    }
    vm.runInContext(script, context, { filename: relativePath });
  }

  context.__productionPersistPipSnapshot = context.persistPipSnapshot;
  context.__productionRefreshMeta = context.refreshMeta;
  context.__productionRenderTree = context.renderTree;
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

const VAULT_DIALOG_BUTTON_IDS = Object.freeze([
  "vaultCredentialSubmit",
  "vaultCredentialCancel",
  "vaultExportConfirm",
  "vaultExportCancel",
  "vaultSwitchSave",
  "vaultSwitchDiscard",
  "vaultSwitchCancel",
  "vaultRecoveryUnlock",
  "vaultRecoveryDelete",
  "vaultRecoveryNotNow",
  "vaultRecoveryConfirm",
  "vaultRecoveryConfirmCancel",
]);

function assertVaultDialogButtons(context, disabled) {
  for (const id of VAULT_DIALOG_BUTTON_IDS) {
    assert.equal(
      context.__ui.elements.get(id).disabled,
      disabled,
      `${id} disabled state`,
    );
  }
}

function assertVaultDialogClosedNeutral(context) {
  const ui = context.__ui;
  assert.equal(ui.vaultOverlay.hidden, true);
  assert.equal(context.PocketVaultBrowserIo.isDialogOpen(), false);
  assert.equal(context.PocketVaultBrowserIo.isOwnerActionPending(), false);
  assertVaultDialogButtons(context, false);
  assert.equal(ui.elements.get("vaultPassword").disabled, false);
  assert.equal(ui.elements.get("vaultPassword").value, "");
  assert.equal(ui.elements.get("vaultPasswordConfirm").disabled, true);
  assert.equal(ui.elements.get("vaultPasswordConfirm").value, "");
  assert.equal(ui.elements.get("vaultPasswordConfirmGroup").hidden, true);
  assert.equal(ui.elements.get("vaultCredentialForm").hidden, true);
  assert.equal(ui.elements.get("vaultExportActions").hidden, true);
  assert.equal(ui.elements.get("vaultSwitchActions").hidden, true);
  assert.equal(ui.elements.get("vaultRecoveryWarningActions").hidden, true);
  assert.equal(ui.elements.get("vaultRecoveryConfirmActions").hidden, true);
  assert.equal(ui.elements.get("vaultDialogError").textContent, "");
  assert.equal(ui.vaultOverlay.classList.contains("vaultRecoveryWarningMode"), false);
}

function pressVaultEscape(context) {
  const event = syntheticEvent("keydown", {
    key: "Escape",
    target: context.__ui.document.activeElement,
  });
  for (const listener of context.__windowListeners.get("keydown") || []) listener(event);
  return event;
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

async function recoveryRecordForPayload(payload, options = {}) {
  const context = loadCryptoContext();
  const envelope = await context.PocketCrypto.sealJson(
    payload,
    options.passphrase || TEST_PASSPHRASE,
    {
      vaultId: options.vaultId || "vault_recovery_fixture",
      revision: options.revision || 2,
    },
  );
  return JSON.stringify({
    schema: "pocket.vaultRecovery.encrypted.v1",
    version: 1,
    capturedAt: options.capturedAt || "2026-07-30T06:30:00.000Z",
    highestSequence: options.highestSequence || 1,
    envelope,
  });
}

function storedRecoveryRaw(context) {
  return context.__localStorage.values.get(VAULT_RECOVERY_STORAGE_KEY) || "";
}

async function waitForStoredRecovery(context) {
  await context.PocketVaultRecovery.whenIdle();
  assert.equal(
    await waitFor(() => !!storedRecoveryRaw(context)),
    true,
    "encrypted Vault recovery should be stored",
  );
  return JSON.parse(storedRecoveryRaw(context));
}

async function decryptStoredRecovery(context, passphrase = TEST_PASSPHRASE) {
  const record = await waitForStoredRecovery(context);
  return context.PocketCrypto.openJson(record.envelope, passphrase);
}

async function waitForRecoverySection(context, id) {
  const viewerSection = id === "vaultRecoveryUnlockedActions";
  assert.equal(
    await waitFor(() => (
      !(viewerSection
        ? context.__ui.recoveryViewerOverlay.hidden
        : context.__ui.vaultOverlay.hidden)
      && context.__ui.elements.get(id)?.hidden === false
    )),
    true,
    `${id} should be visible`,
  );
}

async function chooseRecoveryWarningAction(context, id, expectedSection = "") {
  await waitForRecoverySection(context, "vaultRecoveryWarningActions");
  context.__ui.elements.get(id).click();
  if (expectedSection) await waitForRecoverySection(context, expectedSection);
}

async function unlockStoredRecovery(context, passphrase = TEST_PASSPHRASE) {
  await chooseRecoveryWarningAction(
    context,
    "vaultRecoveryUnlock",
    "vaultCredentialForm",
  );
  await submitCredential(context, passphrase, "");
  await waitForRecoverySection(context, "vaultRecoveryUnlockedActions");
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

function attachInlineDraft(context, options = {}) {
  const state = lexicalState(context);
  const id = String(options.id || state.nodes[0]?.id || "");
  const node = state.nodes.find((entry) => entry.id === id) || null;
  assert.ok(node, `synthetic inline node ${id} should exist`);
  state.inlineEdit = {
    id,
    isNew: options.isNew === true,
    originalLabel: options.originalLabel === undefined
      ? String(node.label || "")
      : String(options.originalLabel),
    afterId: String(options.afterId || ""),
    parentId: String(options.parentId || node.parentId || "root"),
    autoFocus: false,
  };
  const treeRoot = context.__ui.elements.get("treeRoot");
  treeRoot.textContent = "";
  const input = context.document.createElement("input");
  input.type = "text";
  input.value = String(options.value ?? node.label ?? "");
  input.setAttribute("data-edit-id", id);
  treeRoot.appendChild(input);
  return input;
}

function removeInlineDraftInput(context) {
  context.__ui.elements.get("treeRoot").textContent = "";
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

async function contextWithCleanVault(options = {}) {
  const context = createVaultContext();
  const initial = createSyntheticHandle("before-vault.json");
  installOwnerDocument(context, initial, pocketPayload());
  const vaultHandle = createSyntheticHandle(options.name || "dirty.vault.json", {
    ...(options.handleOptions || {}),
    content: await sealForHandle(
      context,
      options.payload || pocketPayload({
        nodes: [makeNode("dirty_vault_item", { details: "Before edit" })],
      }),
      { vaultId: options.vaultId || "vault_dirty_switch", revision: options.revision || 5 },
    ),
  });
  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  return { context, initial, vaultHandle };
}

async function contextWithDirtyVault(options = {}) {
  const { context, initial, vaultHandle } = await contextWithCleanVault(options);
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

async function beginJsonOwnerSwitch(context, candidate, options = {}) {
  const opening = context.loadFromFileHandle(candidate, {
    permissionAlreadyGranted: true,
    ...options,
  });
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
    true,
    "dirty Vault switch dialog should open",
  );
  return { opening };
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

test("P020 Save and continue commits the exact inline rename before encrypted persistence and adoption", async () => {
  const writeGate = deferred();
  const { context, vaultHandle } = await contextWithDirtyVault({
    handleOptions: { writeDeferred: writeGate },
  });
  const state = lexicalState(context);
  const nodeId = state.nodes[0].id;
  const input = attachInlineDraft(context, {
    id: nodeId,
    value: "Committed inline title",
  });
  const decoy = context.document.createElement("input");
  decoy.value = "Wrong active-element title";
  context.document.activeElement = decoy;
  const candidate = createSyntheticHandle("after-inline-save.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("after_inline_candidate")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate);

  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(
    await waitFor(() => (
      state.ops.some((operation) => operation.type === "rename" && operation.id === nodeId)
      && vaultHandle.createWritableCalls === 1
    )),
    true,
  );
  assert.equal(input.value, "Committed inline title");
  assert.equal(state.nodes[0].label, "Committed inline title");
  assert.equal(state.ops.filter((operation) => operation.type === "rename" && operation.id === nodeId).length, 1);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
  assert.equal(state.nodes[0].details, "Unsaved Vault edit");
  assert.equal(candidate.writes.length, 0);

  writeGate.resolve();
  assert.equal(await opening, true);
  assert.equal(vaultHandle.writes.length, 1);
  const decrypted = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  const savedNode = decrypted.mainThoughtTree.find((node) => node.id === nodeId);
  assert.equal(savedNode.label, "Committed inline title");
  assert.equal(savedNode.details, "Unsaved Vault edit");
  assert.strictEqual(context.capturePocketFileSaveSession().handle, candidate);
});

test("P020 an inline rename as the only change creates the ordinary operation and cannot become no-changes", async () => {
  const writeGate = deferred();
  const { context, vaultHandle } = await contextWithCleanVault({
    handleOptions: { writeDeferred: writeGate },
  });
  const state = lexicalState(context);
  const nodeId = state.nodes[0].id;
  assert.equal(state.ops.length, 0);
  attachInlineDraft(context, {
    id: nodeId,
    value: "Inline-only saved title",
  });
  const candidate = createSyntheticHandle("inline-only-target.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("inline_only_target")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate);

  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(
    await waitFor(() => (
      state.ops.filter((operation) => operation.type === "rename" && operation.id === nodeId).length === 1
      && vaultHandle.createWritableCalls === 1
    )),
    true,
  );
  assert.equal(state.nodes[0].label, "Inline-only saved title");
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);

  writeGate.resolve();
  assert.equal(await opening, true);
  const decrypted = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  assert.equal(
    decrypted.mainThoughtTree.find((node) => node.id === nodeId).label,
    "Inline-only saved title",
  );
  assert.equal(
    context.__statuses.some((entry) => /already saved/i.test(entry.message)),
    false,
  );
});

test("P020 a valid inline new item is committed once and included in the encrypted Vault", async () => {
  const writeGate = deferred();
  const { context, vaultHandle } = await contextWithCleanVault({
    handleOptions: { writeDeferred: writeGate },
  });
  const state = lexicalState(context);
  const newId = "inline_new_item";
  state.nodes.push(makeNode(newId, {
    label: "",
    order: 1,
    updatedAt: "2026-07-27T07:00:00.000Z",
  }));
  attachInlineDraft(context, {
    id: newId,
    isNew: true,
    originalLabel: "",
    value: "One new inline item",
    afterId: state.nodes[0].id,
  });
  const candidate = createSyntheticHandle("after-inline-new.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("after_inline_new")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate);

  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(
    await waitFor(() => (
      state.ops.filter((operation) => operation.type === "add_below" && operation.id === newId).length === 1
      && vaultHandle.createWritableCalls === 1
    )),
    true,
  );
  assert.equal(state.nodes.filter((node) => node.id === newId).length, 1);
  assert.equal(state.nodes.find((node) => node.id === newId).label, "One new inline item");

  writeGate.resolve();
  assert.equal(await opening, true);
  const decrypted = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  assert.equal(decrypted.mainThoughtTree.filter((node) => node.id === newId).length, 1);
  assert.equal(
    decrypted.mainThoughtTree.find((node) => node.id === newId).label,
    "One new inline item",
  );
});

test("P020 failed encrypted persistence keeps the committed rename dirty and retries without duplication", async () => {
  const { context, vaultHandle } = await contextWithCleanVault();
  const productionCreateWritable = vaultHandle.createWritable.bind(vaultHandle);
  let failNextWrite = true;
  vaultHandle.createWritable = async () => {
    if (!failNextWrite) return productionCreateWritable();
    vaultHandle.createWritableCalls += 1;
    return {
      async write() {
        throw new Error("synthetic first inline Vault write failure");
      },
      async close() {},
      async abort() {
        vaultHandle.abortedWrites += 1;
      },
    };
  };
  const state = lexicalState(context);
  const nodeId = state.nodes[0].id;
  attachInlineDraft(context, { id: nodeId, value: "Retryable inline title" });
  const candidate = createSyntheticHandle("retry-inline-target.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("retry_inline_target")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate);

  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(
    await waitFor(() => /could not save/i.test(
      context.__ui.elements.get("vaultDialogError").textContent,
    )),
    true,
  );
  assert.equal(state.nodes[0].label, "Retryable inline title");
  assert.equal(state.inlineEdit.id, "");
  assert.equal(state.ops.filter((operation) => operation.type === "rename" && operation.id === nodeId).length, 1);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(candidate.writes.length, 0);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);

  failNextWrite = false;
  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(await opening, true);
  assert.equal(vaultHandle.writes.length, 1);
  const decrypted = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  assert.equal(
    decrypted.mainThoughtTree.find((node) => node.id === nodeId).label,
    "Retryable inline title",
  );
});

test("P020 invalid or unresolved inline drafts cancel the switch without mutation or writes", async (t) => {
  const cases = [
    {
      name: "blank existing rename",
      prepare(context, state, input) {
        input.value = "   ";
        return state.inlineEdit.id;
      },
    },
    {
      name: "missing rendered input",
      prepare(context, state) {
        removeInlineDraftInput(context);
        return state.inlineEdit.id;
      },
    },
    {
      name: "title over the current limit",
      cleanVault: true,
      prepare(_context, state, input) {
        input.value = "x".repeat(221);
        return state.inlineEdit.id;
      },
    },
    {
      name: "stale edit ID",
      prepare(_context, state) {
        state.inlineEdit.id = "stale_inline_id";
        return state.inlineEdit.id;
      },
    },
    {
      name: "missing node",
      prepare(_context, state) {
        const id = state.inlineEdit.id;
        state.nodes = state.nodes.filter((node) => node.id !== id);
        return id;
      },
    },
    {
      name: "canonical commit reports failure",
      prepare(context, state) {
        context.commitInlineEdit = () => ({ ok: false, reason: "synthetic-commit-failure" });
        return state.inlineEdit.id;
      },
    },
    {
      name: "canonical commit leaves draft active",
      prepare(context, state) {
        context.commitInlineEdit = () => ({ ok: true, kind: "rename", changed: true });
        return state.inlineEdit.id;
      },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const { context, vaultHandle } = item.cleanVault
        ? await contextWithCleanVault()
        : await contextWithDirtyVault();
      const state = lexicalState(context);
      const nodeId = state.nodes[0].id;
      const input = attachInlineDraft(context, {
        id: nodeId,
        value: "Draft must remain",
      });
      const expectedEditId = item.prepare(context, state, input);
      const expectedInputValue = input.value;
      const beforeNodes = plain(state.nodes);
      const beforeOps = plain(state.ops);
      const candidate = createSyntheticHandle(`blocked-${item.name}.json`, {
        content: JSON.stringify(pocketPayload({ nodes: [makeNode("must_not_adopt")] })),
      });
      const { opening } = await beginJsonOwnerSwitch(context, candidate);

      context.__ui.elements.get("vaultSwitchSave").click();
      assert.equal(await opening, false);
      assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
      assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
      assert.deepEqual(plain(state.nodes), beforeNodes);
      assert.deepEqual(plain(state.ops), beforeOps);
      assert.equal(state.inlineEdit.id, expectedEditId);
      assert.equal(input.value, expectedInputValue);
      assert.equal(vaultHandle.writes.length, 0);
      assert.equal(candidate.writes.length, 0);
      assert.equal(context.PocketVaultBrowserIo.isOwnerActionPending(), false);
      assert.equal(
        context.__statuses.some((entry) => (
          /finish or cancel the current rename/i.test(entry.message)
          && /nothing was saved or changed/i.test(entry.message)
        )),
        true,
      );
    });
  }
});

test("P020 Cancel preserves the inline draft and Discard abandons it without a Vault write", async (t) => {
  await t.test("Cancel", async () => {
    const { context, vaultHandle } = await contextWithCleanVault();
    const state = lexicalState(context);
    const nodeId = state.nodes[0].id;
    const input = attachInlineDraft(context, {
      id: nodeId,
      value: "Exact cancelled draft",
    });
    const candidate = createSyntheticHandle("cancel-inline-target.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("cancel_inline_target")] })),
    });
    const { opening } = await beginJsonOwnerSwitch(context, candidate);
    context.__ui.elements.get("vaultSwitchCancel").click();

    assert.equal(await opening, false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
    assert.equal(state.inlineEdit.id, nodeId);
    assert.equal(input.value, "Exact cancelled draft");
    assert.equal(state.nodes[0].label, "Synthetic dirty_vault_item");
    assert.equal(state.ops.length, 0);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(candidate.writes.length, 0);
  });

  await t.test("Discard and continue", async () => {
    const { context, vaultHandle } = await contextWithCleanVault();
    const state = lexicalState(context);
    attachInlineDraft(context, {
      id: state.nodes[0].id,
      value: "Explicitly discarded draft",
    });
    const candidate = createSyntheticHandle("discard-inline-target.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("discard_inline_target")] })),
    });
    const { opening } = await beginJsonOwnerSwitch(context, candidate);
    context.__ui.elements.get("vaultSwitchDiscard").click();

    assert.equal(await opening, true);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, candidate);
    assert.equal(lexicalState(context).nodes[0].id, "discard_inline_target");
    assert.equal(lexicalState(context).inlineEdit.id, "");
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(candidate.writes.length, 0);
  });
});

test("P020 the production inline input remains committable after a Vault-switch blur and Cancel", async () => {
  const { context, vaultHandle } = await contextWithCleanVault();
  const state = lexicalState(context);
  const nodeId = state.nodes[0].id;
  state.inlineEdit = {
    id: nodeId,
    isNew: false,
    originalLabel: state.nodes[0].label,
    afterId: "",
    parentId: state.nodes[0].parentId,
    autoFocus: false,
  };
  context.__productionRenderTree();
  const input = context.__ui.elements.get("treeRoot").querySelector(
    `[data-edit-id="${nodeId}"]`,
  );
  assert.ok(input, "the production renderer should create the inline input");
  input.value = "Draft still works after Cancel";
  context.document.activeElement = input;

  const candidate = createSyntheticHandle("cancel-real-inline-target.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("cancel_real_inline_target")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate);
  input.dispatchEvent(syntheticEvent("blur", { target: input }));

  assert.equal(state.inlineEdit.id, nodeId);
  assert.equal(state.nodes[0].label, "Synthetic dirty_vault_item");
  assert.equal(state.ops.length, 0);
  context.__ui.elements.get("vaultSwitchCancel").click();
  assert.equal(await opening, false);

  input.dispatchEvent(syntheticEvent("keydown", {
    target: input,
    key: "Enter",
  }));
  assert.equal(state.inlineEdit.id, "");
  assert.equal(state.nodes[0].label, "Draft still works after Cancel");
  assert.equal(
    state.ops.filter((operation) => operation.type === "rename" && operation.id === nodeId).length,
    1,
  );
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(candidate.writes.length, 0);
});

test("P020 P017 permission release still allows dirty-Vault Save and continue for the prepared JSON candidate", async () => {
  const { context, vaultHandle } = await contextWithCleanVault();
  const state = lexicalState(context);
  const nodeId = state.nodes[0].id;
  attachInlineDraft(context, {
    id: nodeId,
    value: "Saved through permission-gated switch",
  });
  const candidate = createSyntheticHandle("permission-gated-target.json", {
    permission: "prompt",
    requestedPermission: "granted",
    content: JSON.stringify(
      pocketPayload({ nodes: [makeNode("permission_gated_target")] }),
    ),
  });

  assert.equal(await context.loadFromFileHandle(candidate), false);
  assert.equal(context.__ui.permissionOverlay.hidden, false);
  const continuing = context.continuePocketFilePermissionRequest();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultSwitchActions").hidden),
    true,
    "dirty Vault switch dialog should follow the granted permission",
  );
  assert.equal(context.__ui.permissionOverlay.hidden, true);

  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(await continuing, true);
  assert.equal(candidate.requestPermissionCalls, 1);
  assert.equal(vaultHandle.writes.length, 1);
  assert.equal(candidate.writes.length, 0);
  const decrypted = await context.PocketCrypto.openJson(
    parseWrittenEnvelope(vaultHandle),
    TEST_PASSPHRASE,
  );
  assert.equal(
    decrypted.mainThoughtTree.find((node) => node.id === nodeId).label,
    "Saved through permission-gated switch",
  );
  assert.strictEqual(context.capturePocketFileSaveSession().handle, candidate);
  assert.equal(state.nodes[0].id, "permission_gated_target");
});

test("P020 Save and continue resolves live Details and inline drafts once before encryption", async (t) => {
  const payload = pocketPayload({
    nodes: [
      makeNode("details_item", { order: 0, details: "Before Details" }),
      makeNode("rename_item", { order: 1, label: "Before rename" }),
    ],
  });

  await t.test("live-staged Details still close before inline commit", async () => {
    const { context, vaultHandle } = await contextWithCleanVault({ payload });
    const state = lexicalState(context);
    state.selectedId = "details_item";
    context.openDetailsEditorForSelectedNode();
    context.__ui.elements.get("detailEditorBody").value = "Staged Details draft";
    assert.equal(context.stageDetailsEditorDraft(), true);
    assert.equal(context.isDetailsEditorOpen(), true);
    assert.equal(context.hasUnsavedDetailsEditorChanges(), false);
    attachInlineDraft(context, {
      id: "rename_item",
      value: "Inline alongside staged Details",
    });
    const candidate = createSyntheticHandle("after-both-staged.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("after_both_staged")] })),
    });
    const { opening } = await beginJsonOwnerSwitch(context, candidate);
    context.__ui.elements.get("vaultSwitchSave").click();

    assert.equal(await opening, true);
    assert.equal(vaultHandle.writes.length, 1);
    const decrypted = await context.PocketCrypto.openJson(
      parseWrittenEnvelope(vaultHandle),
      TEST_PASSPHRASE,
    );
    assert.equal(
      decrypted.mainThoughtTree.find((node) => node.id === "details_item").details,
      "Staged Details draft",
    );
    assert.equal(
      decrypted.mainThoughtTree.find((node) => node.id === "rename_item").label,
      "Inline alongside staged Details",
    );
  });

  await t.test("Details render rebuild cannot replace the captured inline value", async () => {
    const { context, vaultHandle } = await contextWithCleanVault({ payload });
    const state = lexicalState(context);
    state.selectedId = "details_item";
    context.openDetailsEditorForSelectedNode();
    context.__ui.elements.get("detailEditorBody").value = "Unstaged Details draft";
    const originalInput = attachInlineDraft(context, {
      id: "rename_item",
      value: "Captured before Details render",
    });
    context.renderTree = () => {
      const treeRoot = context.__ui.elements.get("treeRoot");
      treeRoot.textContent = "";
      if (!state.inlineEdit.id) return;
      const rebuilt = context.document.createElement("input");
      rebuilt.type = "text";
      rebuilt.value = state.nodes.find((node) => node.id === state.inlineEdit.id)?.label || "";
      rebuilt.setAttribute("data-edit-id", state.inlineEdit.id);
      treeRoot.appendChild(rebuilt);
    };
    const candidate = createSyntheticHandle("after-both-rendered.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("after_both_rendered")] })),
    });
    const { opening } = await beginJsonOwnerSwitch(context, candidate);
    context.__ui.elements.get("vaultSwitchSave").click();

    assert.equal(await opening, true);
    assert.equal(originalInput.value, "Captured before Details render");
    assert.equal(vaultHandle.writes.length, 1);
    const decrypted = await context.PocketCrypto.openJson(
      parseWrittenEnvelope(vaultHandle),
      TEST_PASSPHRASE,
    );
    assert.equal(
      decrypted.mainThoughtTree.find((node) => node.id === "details_item").details,
      "Unstaged Details draft",
    );
    assert.equal(
      decrypted.mainThoughtTree.find((node) => node.id === "rename_item").label,
      "Captured before Details render",
    );
  });
});

test("P020 stale owner and candidate authority fail before inline commit or export", async (t) => {
  await t.test("source session changed", async () => {
    const { context, vaultHandle } = await contextWithCleanVault();
    const state = lexicalState(context);
    const nodeId = state.nodes[0].id;
    attachInlineDraft(context, { id: nodeId, value: "Must not commit after owner change" });
    const candidate = createSyntheticHandle("stale-source-target.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("stale_source_target")] })),
    });
    const { opening } = await beginJsonOwnerSwitch(context, candidate);
    context.renewPocketDocumentSession();
    context.__ui.elements.get("vaultSwitchSave").click();

    assert.equal(await opening, false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
    assert.equal(state.nodes[0].label, "Synthetic dirty_vault_item");
    assert.equal(state.inlineEdit.id, nodeId);
    assert.equal(state.ops.length, 0);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(candidate.writes.length, 0);
  });

  await t.test("prepared candidate changed", async () => {
    const { context, vaultHandle } = await contextWithCleanVault();
    const state = lexicalState(context);
    const nodeId = state.nodes[0].id;
    attachInlineDraft(context, { id: nodeId, value: "Must not commit for stale candidate" });
    let candidateCurrent = true;
    const candidate = createSyntheticHandle("stale-candidate-target.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("stale_candidate_target")] })),
    });
    const { opening } = await beginJsonOwnerSwitch(context, candidate, {
      canContinue: () => candidateCurrent,
    });
    candidateCurrent = false;
    context.__ui.elements.get("vaultSwitchSave").click();

    assert.equal(await opening, false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
    assert.equal(state.nodes[0].label, "Synthetic dirty_vault_item");
    assert.equal(state.inlineEdit.id, nodeId);
    assert.equal(state.ops.length, 0);
    assert.equal(vaultHandle.writes.length, 0);
    assert.equal(candidate.writes.length, 0);
  });

  await t.test("direct stale token cannot bypass the ordinary mutation gate", async () => {
    const { context } = await contextWithCleanVault();
    const state = lexicalState(context);
    const nodeId = state.nodes[0].id;
    attachInlineDraft(context, { id: nodeId, value: "Unauthorised title" });
    const result = context.commitInlineEdit(nodeId, "Unauthorised title", {
      vaultDialogToken: "not-current",
      sourceSession: context.capturePocketFileSaveSession(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "owner-switch-not-current");
    assert.equal(state.nodes[0].label, "Synthetic dirty_vault_item");
    assert.equal(state.inlineEdit.id, nodeId);
    assert.equal(state.ops.length, 0);
  });
});

test("P020 candidate invalidation during encrypted write aborts before persistence or adoption", async () => {
  const writeGate = deferred();
  const { context, vaultHandle } = await contextWithCleanVault({
    handleOptions: { writeDeferred: writeGate },
  });
  const state = lexicalState(context);
  const nodeId = state.nodes[0].id;
  attachInlineDraft(context, { id: nodeId, value: "Committed but still unsaved title" });
  let candidateCurrent = true;
  const candidate = createSyntheticHandle("stale-during-write.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("stale_during_write")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate, {
    canContinue: () => candidateCurrent,
  });
  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(
    await waitFor(() => vaultHandle.createWritableCalls === 1),
    true,
  );
  candidateCurrent = false;
  writeGate.resolve();

  assert.equal(await opening, false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
  assert.equal(state.nodes[0].label, "Committed but still unsaved title");
  assert.equal(state.ops.filter((operation) => operation.type === "rename").length, 1);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(vaultHandle.abortedWrites, 1);
  assert.equal(candidate.writes.length, 0);
});

test("P020 final JSON adoption still honours candidate invalidation after encrypted persistence", async () => {
  const { context, vaultHandle } = await contextWithCleanVault();
  const state = lexicalState(context);
  const nodeId = state.nodes[0].id;
  attachInlineDraft(context, {
    id: nodeId,
    value: "Saved before queued candidate invalidation",
  });
  const transitionGate = deferred();
  const originalTransition = context.enqueuePocketOwnerTransition;
  let transitionQueued = false;
  context.enqueuePocketOwnerTransition = async (task) => {
    transitionQueued = true;
    await transitionGate.promise;
    return originalTransition(task);
  };
  let candidateCurrent = true;
  const candidate = createSyntheticHandle("invalidate-before-adoption.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("must_not_be_adopted")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate, {
    canContinue: () => candidateCurrent,
  });

  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(
    await waitFor(() => vaultHandle.writes.length === 1 && transitionQueued),
    true,
    "encrypted persistence should finish before queued JSON adoption",
  );
  candidateCurrent = false;
  transitionGate.resolve();

  assert.equal(await opening, false);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
  assert.equal(state.nodes[0].id, nodeId);
  assert.equal(state.nodes[0].label, "Saved before queued candidate invalidation");
  assert.equal(state.ops.length, 0);
  assert.equal(candidate.writes.length, 0);
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

test("P022 dirty Vault operations create only authenticated encrypted browser recovery", async () => {
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
  const encryptedRecord = await waitForStoredRecovery(context);

  assert.equal(context.saveWorkspaceState(), false);
  assert.equal(context.saveLocalSafetySnapshot("private-vault-edit"), true);
  await context.PocketVaultRecovery.whenIdle();
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
  assert.equal(encryptedRecord.schema, "pocket.vaultRecovery.encrypted.v1");
  assert.equal(encryptedRecord.version, 1);
  assert.ok(Number.isSafeInteger(encryptedRecord.highestSequence));
  assert.equal(context.PocketCrypto.isVaultEnvelope(encryptedRecord.envelope), true);

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

  const recovered = await context.PocketCrypto.openJson(
    JSON.parse(storedRecoveryRaw(context)).envelope,
    TEST_PASSPHRASE,
  );
  assert.equal(recovered.mainThoughtTree[0].label, secrets.label);
  assert.equal(recovered.mainThoughtTree[0].details, `${secrets.details} edited`);
  assert.equal(recovered.mainThoughtTree[0].editor.outline[0].text, secrets.outline);
  assert.equal(recovered.privateRootExtra, secrets.rootExtra);
  assert.equal(recovered.data.privateDataExtra, secrets.dataExtra);
  assert.equal(
    context.__localStorage.calls.some((call) => (
      call.type === "set" && call.key === VAULT_RECOVERY_STORAGE_KEY
    )),
    true,
  );
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

test("P022 dirty Vault beforeunload warns synchronously without starting another recovery or truth write", async () => {
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
  await context.PocketVaultRecovery.whenIdle();
  const recoveryBefore = storedRecoveryRaw(context);
  assert.ok(recoveryBefore);
  const storageCallsBefore = context.__localStorage.calls.length;
  const event = syntheticEvent("beforeunload");

  const warning = context.handlePocketLiteBeforeUnload(event);
  assert.equal(warning, "You have local changes not backed up yet.");
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, "You have local changes not backed up yet.");
  assert.equal(vaultHandle.createWritableCalls, 0);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(context.__localStorage.calls.length, storageCallsBefore);
  assert.equal(storedRecoveryRaw(context), recoveryBefore);
});

test("P025 Not now preserves encrypted recovery, releases startup once, and offers it again after reload", async () => {
  const recoveredPayload = pocketPayload({
    nodes: [makeNode("deferred_recovery", {
      label: "Deferred recovery item",
      details: "Must remain encrypted and inactive",
    })],
  });
  const recoveryRaw = await recoveryRecordForPayload(recoveredPayload);
  const context = createVaultContext({
    localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
  });
  const state = lexicalState(context);
  const sourceBefore = plain(context.capturePocketFileSaveSession());
  const productionCrypto = context.PocketCrypto;
  let decryptCalls = 0;
  context.PocketCrypto = Object.freeze({
    ...productionCrypto,
    async unlockEnvelope(...args) {
      decryptCalls += 1;
      return productionCrypto.unlockEnvelope(...args);
    },
  });
  let resumedNormalStartup = 0;

  await waitForRecoverySection(context, "vaultRecoveryWarningActions");
  assert.equal(context.__ui.vaultOverlay.classList.contains("vaultRecoveryWarningMode"), true);
  assert.equal(context.__ui.elements.get("vaultDialogTitle").textContent, "Unsaved Vault changes");
  assert.equal(
    context.__ui.elements.get("vaultDialogBody").textContent,
    "Pocket found encrypted recovery data from an earlier session.",
  );
  assert.deepEqual(
    context.__ui.elements.get("vaultRecoveryWarningActions").children.map((button) => button.textContent),
    ["View recovery", "Not now", "Delete recovery"],
  );
  assert.equal(
    context.PocketVaultRecovery.deferNormalStartup(() => {
      resumedNormalStartup += 1;
    }),
    true,
  );
  const storageCallsBefore = context.__localStorage.calls.length;

  context.__ui.elements.get("vaultRecoveryNotNow").click();
  assert.equal(await waitFor(() => !context.PocketVaultRecovery.isFlowOpen()), true);
  assert.equal(context.__ui.vaultOverlay.hidden, true);
  assert.equal(context.__ui.recoveryViewerOverlay.hidden, true);
  assert.equal(context.__ui.surface.inert, false);
  assert.equal(decryptCalls, 0);
  assert.equal(context.__ui.elements.get("vaultCredentialForm").hidden, true);
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  assert.equal(context.__localStorage.calls.length, storageCallsBefore);
  assert.equal(resumedNormalStartup, 1);
  assert.equal(state.nodes.length, 0);
  assert.equal(state.ops.length, 0);
  assert.deepEqual(plain(context.capturePocketFileSaveSession()), sourceBefore);
  assert.equal(context.PocketVault.getActiveSession(), null);
  assert.equal(context.__openPickerQueue.length, 0);
  assert.equal(context.__savePickerQueue.length, 0);
  assert.match(context.__statuses.at(-1).message, /kept for later.*offer it again next time/i);
  assertVaultDialogClosedNeutral(context);

  const reloaded = createVaultContext({
    localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
  });
  await waitForRecoverySection(reloaded, "vaultRecoveryWarningActions");
  assert.deepEqual(
    reloaded.__ui.elements.get("vaultRecoveryWarningActions").children.map((button) => button.textContent),
    ["View recovery", "Not now", "Delete recovery"],
  );
  assert.equal(reloaded.PocketVaultRecovery.isFlowOpen(), true);
  assert.equal(storedRecoveryRaw(reloaded), recoveryRaw);
  reloaded.__ui.elements.get("vaultRecoveryNotNow").click();
  assert.equal(await waitFor(() => !reloaded.PocketVaultRecovery.isFlowOpen()), true);
  assert.equal(storedRecoveryRaw(reloaded), recoveryRaw);
  assertVaultDialogClosedNeutral(reloaded);
});

test("P026 startup recovery offers View, Not now, or Delete while P023 preview remains read-only", async () => {
  const recoveredPayload = pocketPayload({
    nodes: [
      makeNode("startup_recovered", {
        label: "Startup recovered item",
        details: "Readable only after the right password",
      }),
    ],
  });
  const recoveryRaw = await recoveryRecordForPayload(recoveredPayload);
  const context = createVaultContext({
    localStorageSeed: {
      [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw,
    },
    exposeVaultDialogTestControl: true,
  });
  const state = lexicalState(context);

  await waitForRecoverySection(context, "vaultRecoveryWarningActions");
  assert.deepEqual(
    context.__ui.elements.get("vaultRecoveryWarningActions").children.map((button) => button.textContent),
    ["View recovery", "Not now", "Delete recovery"],
  );
  assert.equal(context.PocketVaultRecovery.isFlowOpen(), true);
  assert.equal(context.canModifyPocket(), false);
  assert.equal(state.nodes.length, 0);
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "none");
  assert.equal(context.__ui.surface.inert, true);
  assert.equal(context.__openPickerQueue.length, 0);
  assert.equal(context.__savePickerQueue.length, 0);
  let resumedNormalStartup = 0;
  assert.equal(
    context.PocketVaultRecovery.deferNormalStartup(() => {
      resumedNormalStartup += 1;
    }),
    true,
  );
  assert.equal(resumedNormalStartup, 0);
  assert.match(
    source("js/pocket-overlays-init.js"),
    /PocketVaultRecovery\?\.deferNormalStartup\?\.\(initialisePocketStartupOwner\)/,
  );

  assert.equal(context.__closeVaultDialogForTest(), true);
  await waitForRecoverySection(context, "vaultRecoveryWarningActions");
  assert.equal(context.PocketVaultRecovery.isFlowOpen(), true);
  assert.equal(context.canModifyPocket(), false);
  assert.equal(resumedNormalStartup, 0);

  await chooseRecoveryWarningAction(
    context,
    "vaultRecoveryUnlock",
    "vaultCredentialForm",
  );
  context.__ui.elements.get("vaultCredentialCancel").click();
  await waitForRecoverySection(context, "vaultRecoveryWarningActions");
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  assert.equal(context.PocketVaultRecovery.isFlowOpen(), true);
  assert.equal(resumedNormalStartup, 0);
  assertVaultDialogButtons(context, false);

  await chooseRecoveryWarningAction(
    context,
    "vaultRecoveryUnlock",
    "vaultCredentialForm",
  );
  context.__ui.elements.get("vaultPassword").value = "wrong-recovery-password";
  await context.__ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", {
      target: context.__ui.elements.get("vaultCredentialForm"),
    }),
  );
  assert.match(
    context.__ui.elements.get("vaultDialogError").textContent,
    /did not unlock the recovery/i,
  );
  assert.equal(context.__ui.elements.get("vaultCredentialSubmit").disabled, false);
  assert.equal(context.__ui.elements.get("vaultCredentialCancel").disabled, false);
  assertVaultDialogButtons(context, false);
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  assert.equal(state.nodes.length, 0);

  await submitCredential(context, TEST_PASSPHRASE, "");
  await waitForRecoverySection(context, "vaultRecoveryUnlockedActions");
  assert.equal(state.nodes.length, 0, "decryption must not silently adopt recovered content");
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "none");
  assert.deepEqual(
    plain(context.PocketVaultRecoveryViewer.snapshot()),
    {
      capturedAt: "2026-07-30T06:30:00.000Z",
      nodeCount: 1,
      selectedId: "startup_recovered",
      selectedLabel: "Startup recovered item",
      selectedDetails: "Readable only after the right password",
      selectedOutline: "",
      collapsedIds: [],
    },
  );
  assert.equal(context.__ui.elements.get("vaultRecoverySaveVault").textContent.includes("Save as new encrypted Vault"), true);
  assert.equal(context.__ui.elements.get("vaultRecoverySaveJson").textContent.includes("Save as plain JSON"), true);
  assert.equal(context.__ui.elements.get("vaultRecoveryAddExisting").textContent.includes("Add to existing Pocket file"), true);
  assert.equal(context.__ui.elements.get("vaultRecoveryKeep").textContent.includes("Keep for later"), true);
  assert.equal(context.__ui.elements.get("vaultRecoveryDiscard").textContent.includes("Discard recovery"), true);

  context.__ui.elements.get("vaultRecoveryKeep").click();
  assert.equal(await waitFor(() => context.__ui.recoveryViewerOverlay.hidden), true);
  assert.equal(
    await waitFor(() => !context.PocketVaultRecovery.isFlowOpen()),
    true,
  );
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  assert.equal(state.nodes.length, 0);
  assert.equal(context.__ui.surface.inert, false);
  assert.equal(resumedNormalStartup, 1);
});

test("P026 initial Delete recovery needs confirmation, no password, and changes no saved file", async () => {
  const recoveryRaw = await recoveryRecordForPayload(pocketPayload({
    nodes: [makeNode("delete_only_recovery", { details: "Encrypted delete test" })],
  }));
  const context = createVaultContext({
    localStorageSeed: {
      [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw,
      "pocketLite.localSafety.snapshot.v1": "ordinary-json-safety",
    },
  });
  const savedHandle = createSyntheticHandle("saved-never-touched.json", {
    content: JSON.stringify(pocketPayload()),
  });

  await chooseRecoveryWarningAction(
    context,
    "vaultRecoveryDelete",
    "vaultRecoveryConfirmActions",
  );
  assert.equal(context.__ui.elements.get("vaultDialogTitle").textContent, "Delete encrypted recovery?");
  assert.equal(
    context.__ui.elements.get("vaultDialogBody").textContent,
    "This permanently deletes only the recovery stored in this browser. Saved Pocket files and Vaults are not changed.",
  );
  assert.equal(context.__ui.elements.get("vaultRecoveryConfirm").textContent, "Delete recovery");
  assert.equal(context.__ui.elements.get("vaultRecoveryConfirm").classList.contains("danger"), true);
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  assert.equal(context.__ui.elements.get("vaultCredentialForm").hidden, true);

  context.__ui.elements.get("vaultRecoveryConfirmCancel").click();
  await waitForRecoverySection(context, "vaultRecoveryWarningActions");
  assertVaultDialogButtons(context, false);
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  context.__ui.elements.get("vaultRecoveryDelete").click();
  await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
  context.__ui.elements.get("vaultRecoveryConfirm").click();
  assert.equal(await waitFor(() => !storedRecoveryRaw(context)), true);
  assert.equal(context.__localStorage.values.get("pocketLite.localSafety.snapshot.v1"), "ordinary-json-safety");
  assert.equal(savedHandle.writes.length, 0);
  assert.equal(savedHandle.createWritableCalls, 0);
  assert.equal(context.__openPickerQueue.length, 0);
  assert.equal(context.__savePickerQueue.length, 0);
  assert.equal(context.PocketVaultRecovery.isFlowOpen(), false);
});

test("P022 unlocked Discard recovery requires confirmation and removes only the browser blob", async () => {
  const recoveryRaw = await recoveryRecordForPayload(pocketPayload({
    nodes: [makeNode("discard_unlocked_recovery", { details: "Encrypted discard test" })],
  }));
  const context = createVaultContext({
    localStorageSeed: {
      [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw,
      "pocketLite.localSafety.snapshot.v1": "ordinary-json-safety",
    },
  });

  await unlockStoredRecovery(context);
  context.__ui.elements.get("vaultRecoveryDiscard").click();
  await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
  assert.equal(context.__ui.elements.get("vaultDialogTitle").textContent, "Delete encrypted recovery?");
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  context.__ui.elements.get("vaultRecoveryConfirmCancel").click();
  await waitForRecoverySection(context, "vaultRecoveryUnlockedActions");
  assert.equal(storedRecoveryRaw(context), recoveryRaw);

  context.__ui.elements.get("vaultRecoveryDiscard").click();
  await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
  context.__ui.elements.get("vaultRecoveryConfirm").click();
  assert.equal(await waitFor(() => !storedRecoveryRaw(context)), true);
  assert.equal(
    context.__localStorage.values.get("pocketLite.localSafety.snapshot.v1"),
    "ordinary-json-safety",
  );
  assert.equal(context.__openPickerQueue.length, 0);
  assert.equal(context.__savePickerQueue.length, 0);
  assert.equal(context.PocketVaultRecovery.isFlowOpen(), false);
});

test("P023 a kept earlier recovery cannot be overwritten or cleared by a later same-Vault session", async () => {
  const vaultId = "vault_kept_recovery";
  const keptPayload = pocketPayload({
    nodes: [makeNode("kept_recovery", { details: "Earlier unsaved Vault work" })],
  });
  const recoveryRaw = await recoveryRecordForPayload(keptPayload, {
    vaultId,
    revision: 2,
  });
  const context = createVaultContext({
    localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
  });

  await unlockStoredRecovery(context);
  context.__ui.elements.get("vaultRecoveryKeep").click();
  assert.equal(
    await waitFor(() => !context.PocketVaultRecovery.isFlowOpen()),
    true,
  );
  assert.equal(storedRecoveryRaw(context), recoveryRaw);

  const currentVaultPayload = pocketPayload({
    nodes: [makeNode("current_vault", { details: "Saved Vault content" })],
  });
  const currentVault = createSyntheticHandle("same-vault-later-session.vault.json", {
    content: await sealForHandle(context, currentVaultPayload, {
      vaultId,
      revision: 1,
    }),
  });
  assert.equal(await openVaultWithPassword(context, currentVault), true);
  mutateVaultNode(context, { details: "A later same-Vault session edit" });
  const capture = await context.PocketVaultRecovery.whenIdle();
  assert.equal(capture.ok, false);
  assert.equal(capture.reason, "different-recovery-waiting");
  assert.equal(storedRecoveryRaw(context), recoveryRaw);

  const saveResult = await context.exportTree({ returnDetails: true });
  assert.equal(saveResult.ok, true);
  assert.equal(currentVault.writes.length, 1);
  assert.equal(lexicalState(context).ops.length, 0);
  assert.equal(
    storedRecoveryRaw(context),
    recoveryRaw,
    "a successful later Vault Save must not clear an earlier unowned recovery",
  );
});

test("P023 recovery outputs clear only after successful persistence and adopt the saved destination", async (t) => {
  const recoveredPayload = pocketPayload({
    nodes: [
      makeNode("shared", {
        label: "Recovered parent",
        details: "Recovered Notes",
        editor: outlineEditor([
          { id: "recovered_outline", text: "Recovered Outline", depth: 0, collapsed: true },
        ]),
      }),
      makeNode("recovered_child", {
        parentId: "shared",
        order: 0,
        label: "Recovered child",
        details: "Child Notes",
      }),
    ],
  });
  const recoveryRaw = await recoveryRecordForPayload(recoveredPayload);

  await t.test("cancelled plain JSON output keeps encrypted recovery", async () => {
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    await unlockStoredRecovery(context);
    context.__ui.elements.get("vaultRecoverySaveJson").click();
    await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
    assert.match(context.__ui.elements.get("vaultDialogBody").textContent, /readable plain JSON/i);
    context.__ui.elements.get("vaultRecoveryConfirm").click();
    await waitForRecoverySection(context, "vaultRecoveryUnlockedActions");
    assert.equal(storedRecoveryRaw(context), recoveryRaw);
    context.__ui.elements.get("vaultRecoveryKeep").click();
    await waitFor(() => context.__ui.recoveryViewerOverlay.hidden);
  });

  await t.test("failed plain JSON output keeps encrypted recovery and source ownership", async () => {
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    const sourceBefore = context.capturePocketFileSaveSession();
    const stateBefore = JSON.stringify(lexicalState(context).nodes);
    const output = createSyntheticHandle("recovered-output-fails.json", {
      writeError: new Error("synthetic recovery output failure"),
    });
    await unlockStoredRecovery(context);
    context.__savePickerQueue.push(output);
    context.__ui.elements.get("vaultRecoverySaveJson").click();
    await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
    context.__ui.elements.get("vaultRecoveryConfirm").click();
    await waitForRecoverySection(context, "vaultRecoveryUnlockedActions");
    assert.equal(storedRecoveryRaw(context), recoveryRaw);
    assert.equal(output.writes.length, 0);
    assert.equal(output.abortedWrites, 1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(context.capturePocketFileSaveSession())),
      JSON.parse(JSON.stringify(sourceBefore)),
    );
    assert.equal(JSON.stringify(lexicalState(context).nodes), stateBefore);
    context.__ui.elements.get("vaultRecoveryKeep").click();
    await waitFor(() => context.__ui.recoveryViewerOverlay.hidden);
  });

  await t.test("plain JSON output writes the chosen destination and clears recovery", async () => {
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    const output = createSyntheticHandle("recovered-output.json");
    await unlockStoredRecovery(context);
    context.__savePickerQueue.push(output);
    context.__ui.elements.get("vaultRecoverySaveJson").click();
    await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
    context.__ui.elements.get("vaultRecoveryConfirm").click();
    assert.equal(await waitFor(() => output.writes.length === 1), true);
    assert.equal(await waitFor(() => !storedRecoveryRaw(context)), true);
    const written = JSON.parse(output.writes[0]);
    assert.deepEqual(
      written.mainThoughtTree.map((node) => node.label),
      ["Recovered parent", "Recovered child"],
    );
    assert.strictEqual(context.capturePocketFileSaveSession().handle, output);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
    assert.deepEqual(
      plain(lexicalState(context).nodes.map((node) => node.label)),
      ["Recovered parent", "Recovered child"],
    );
  });

  await t.test("new encrypted Vault output uses a fresh password and clears recovery", async () => {
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    const output = createSyntheticHandle("recovered-output.vault.json");
    await unlockStoredRecovery(context);
    context.__savePickerQueue.push(output);
    context.__ui.elements.get("vaultRecoverySaveVault").click();
    await waitForRecoverySection(context, "vaultCredentialForm");
    await submitCredential(
      context,
      RECOVERY_OUTPUT_PASSPHRASE,
      RECOVERY_OUTPUT_PASSPHRASE,
    );
    assert.equal(await waitFor(() => output.writes.length === 1), true);
    assert.equal(await waitFor(() => !storedRecoveryRaw(context)), true);
    const written = await context.PocketCrypto.openJson(
      JSON.parse(output.writes[0]),
      RECOVERY_OUTPUT_PASSPHRASE,
    );
    assert.deepEqual(
      written.mainThoughtTree.map((node) => node.label),
      ["Recovered parent", "Recovered child"],
    );
    assert.strictEqual(context.capturePocketFileSaveSession().handle, output);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
    assert.ok(context.PocketVault.getActiveSession());
  });

  await t.test("existing Pocket import preserves destination and nests fresh recovered IDs under one root", async () => {
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    const destinationPayload = pocketPayload({
      nodes: [
        makeNode("shared", {
          label: "Destination item",
          details: "Destination Notes",
        }),
      ],
      tombstones: [{ id: "destination_removed", deletedAt: "2026-07-30T00:00:00.000Z" }],
      rootExtras: { destinationRootExtra: "kept" },
      dataExtras: { destinationDataExtra: "kept" },
    });
    const destination = createSyntheticHandle("existing-pocket.json", {
      content: `${JSON.stringify(destinationPayload, null, 2)}\n`,
    });
    const importProbe = context.PocketVaultRecovery.buildRecoveredImport(
      destinationPayload,
      recoveredPayload,
      "2026-07-30T06:30:00.000Z",
    );
    assert.equal(importProbe.ok, true, importProbe.reason);
    await unlockStoredRecovery(context);
    context.__openPickerQueue.push(destination);
    context.__ui.elements.get("vaultRecoveryAddExisting").click();
    await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
    assert.match(context.__ui.elements.get("vaultDialogBody").textContent, /one new top-level Recovered item/i);
    context.__ui.elements.get("vaultRecoveryConfirm").click();
    assert.equal(await waitFor(() => destination.writes.length === 1), true);
    assert.equal(await waitFor(() => !storedRecoveryRaw(context)), true);

    const written = JSON.parse(destination.writes[0]);
    const ids = written.mainThoughtTree.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length);
    const original = written.mainThoughtTree.find((node) => node.id === "shared");
    assert.equal(original.label, "Destination item");
    assert.equal(original.details, "Destination Notes");
    const wrapper = written.mainThoughtTree.find((node) => (
      node.parentId === "root" && /^Recovered /.test(node.label)
    ));
    assert.ok(wrapper);
    const recoveredParent = written.mainThoughtTree.find((node) => (
      node.parentId === wrapper.id && node.label === "Recovered parent"
    ));
    assert.ok(recoveredParent);
    assert.notEqual(recoveredParent.id, "shared");
    assert.equal(recoveredParent.details, "Recovered Notes");
    assert.equal(recoveredParent.editor.outline[0].text, "Recovered Outline");
    const recoveredChild = written.mainThoughtTree.find((node) => node.label === "Recovered child");
    assert.equal(recoveredChild.parentId, recoveredParent.id);
    assert.equal(written.destinationRootExtra, "kept");
    assert.equal(written.data.destinationDataExtra, "kept");
    assert.equal(written.mainThoughtTreeTombstones[0].id, "destination_removed");
    assert.strictEqual(context.capturePocketFileSaveSession().handle, destination);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
    assert.equal(lexicalState(context).nodes.some((node) => node.id === wrapper.id), true);
  });

  await t.test("existing Pocket destination changing during confirmation is not overwritten", async () => {
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    const firstDestination = pocketPayload({
      nodes: [makeNode("first_destination", { label: "First destination version" })],
    });
    const laterDestination = pocketPayload({
      nodes: [makeNode("later_destination", { label: "Changed outside Pocket" })],
    });
    const destination = createSyntheticHandle("changing-pocket.json", {
      content: `${JSON.stringify(firstDestination, null, 2)}\n`,
    });
    await unlockStoredRecovery(context);
    const ownerBefore = currentOwnerSnapshot(context);
    context.__openPickerQueue.push(destination);
    context.__ui.elements.get("vaultRecoveryAddExisting").click();
    await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
    destination.content = `${JSON.stringify(laterDestination, null, 2)}\n`;
    context.__ui.elements.get("vaultRecoveryConfirm").click();
    await waitForRecoverySection(context, "vaultRecoveryUnlockedActions");
    assert.equal(destination.getFileCalls, 2);
    assert.equal(destination.writes.length, 0);
    assert.equal(JSON.parse(destination.content).mainThoughtTree[0].id, "later_destination");
    assert.equal(storedRecoveryRaw(context), recoveryRaw);
    assertOwnerUnchanged(context, ownerBefore);
    context.__ui.elements.get("vaultRecoveryKeep").click();
    await waitFor(() => context.__ui.recoveryViewerOverlay.hidden);
  });
});

test("P023 one smart Choose file path classifies and opens plain JSON or Vault by content", async (t) => {
  await t.test("plain JSON is inspected and adopted", async () => {
    const context = createVaultContext();
    const payload = pocketPayload({
      nodes: [makeNode("smart_json", { label: "Smart plain JSON" })],
    });
    const handle = createSyntheticHandle("ambiguous-name.vault", {
      content: `${JSON.stringify(payload, null, 2)}\n`,
    });
    context.__openPickerQueue.push(handle);
    assert.equal(await context.openPocketFile(), true);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
    assert.equal(lexicalState(context).nodes[0].label, "Smart plain JSON");
  });

  await t.test("encrypted Vault is inspected, unlocked and adopted through the same action", async () => {
    const context = createVaultContext();
    const payload = pocketPayload({
      nodes: [makeNode("smart_vault", { label: "Smart encrypted Vault" })],
    });
    const handle = createSyntheticHandle("ordinary-name.json", {
      content: await sealForHandle(context, payload, {
        vaultId: "vault_smart_choose",
        revision: 3,
      }),
    });
    context.__openPickerQueue.push(handle);
    const opening = context.openPocketFile();
    await submitCredential(context);
    assert.equal(await opening, true);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, handle);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
    assert.equal(context.PocketVault.getActiveSession().vaultId, "vault_smart_choose");
    assert.equal(lexicalState(context).nodes[0].label, "Smart encrypted Vault");
  });

  await t.test("unsupported content fails before permission, write or adoption", async () => {
    const context = createVaultContext();
    const original = createSyntheticHandle("original.json");
    installOwnerDocument(context, original, pocketPayload());
    const before = currentOwnerSnapshot(context);
    const unsupported = createSyntheticHandle("unsupported.json", {
      content: JSON.stringify({ hello: "not Pocket" }),
      permission: "prompt",
    });
    context.__openPickerQueue.push(unsupported);
    assert.equal(await context.openPocketFile(), false);
    assert.equal(unsupported.getFileCalls, 1);
    assert.equal(unsupported.queryPermissionCalls, 0);
    assert.equal(unsupported.requestPermissionCalls, 0);
    assert.equal(unsupported.writes.length, 0);
    assertOwnerUnchanged(context, before);
  });

  const indexSource = source("index.html");
  assert.doesNotMatch(indexSource, /id="cmdOpenVault"/);
  assert.match(indexSource, /id="btnLoad"[^>]*>Choose file<\/button>/);
});

test("P026 offline shell refreshes the tightened recovery prompt", () => {
  const serviceWorkerSource = source("sw.js");
  assert.match(serviceWorkerSource, /const CACHE_NAME = "pocket-shell-v7";/);
  assert.equal(
    (serviceWorkerSource.match(/\.\/vault\.css/g) || []).length,
    1,
  );
  assert.equal(
    (serviceWorkerSource.match(/\.\/js\/pocket-file-opening\.js/g) || []).length,
    1,
  );
  assert.equal(
    (serviceWorkerSource.match(/\.\/js\/pocket-vault-recovery-viewer\.js/g) || []).length,
    1,
  );

  const indexSource = source("index.html");
  assert.ok(
    indexSource.indexOf('src="js/pocket-vault-io-browser.js"')
      < indexSource.indexOf('src="js/pocket-file-opening.js"'),
  );
  assert.ok(
    indexSource.indexOf('src="js/pocket-file-opening.js"')
      < indexSource.indexOf('src="js/pocket-vault-recovery-viewer.js"'),
  );
  assert.ok(
    indexSource.indexOf('src="js/pocket-vault-recovery-viewer.js"')
      < indexSource.indexOf('src="js/pocket-vault-recovery.js"'),
  );
});

test("P026 startup warning uses the compact ordered recovery layout", () => {
  const indexSource = source("index.html");
  const vaultStyles = source("vault.css");
  const recoveryActionLabels = new Map([
    ["vaultRecoveryKeep", "Keep for later"],
    ["vaultRecoverySaveVault", "Save as Vault"],
    ["vaultRecoverySaveJson", "Save as JSON"],
    ["vaultRecoveryAddExisting", "Add to file"],
    ["vaultRecoveryDiscard", "Discard recovery"],
  ]);

  for (const [id, label] of recoveryActionLabels) {
    assert.equal(
      (indexSource.match(new RegExp(`id="${id}"`, "g")) || []).length,
      1,
      `${id} remains a single canonical action`,
    );
    assert.match(
      indexSource,
      new RegExp(`id="${id}"[^>]*>[\\s\\S]*?<strong>${label}</strong>`),
    );
  }

  const initialPrompt = indexSource.match(
    /<div id="vaultRecoveryWarningActions"[\s\S]*?<\/div>/,
  )?.[0] || "";
  assert.equal((initialPrompt.match(/<button\b/g) || []).length, 3);
  assert.match(initialPrompt, /id="vaultRecoveryUnlock"/);
  assert.match(initialPrompt, /id="vaultRecoveryDelete"/);
  assert.match(initialPrompt, /id="vaultRecoveryNotNow"/);
  assert.ok(initialPrompt.indexOf('id="vaultRecoveryUnlock"') < initialPrompt.indexOf('id="vaultRecoveryNotNow"'));
  assert.ok(initialPrompt.indexOf('id="vaultRecoveryNotNow"') < initialPrompt.indexOf('id="vaultRecoveryDelete"'));
  assert.match(initialPrompt, /id="vaultRecoveryDelete" class="vaultDialogSecondary vaultRecoveryQuietDelete"[^>]*>Delete recovery<\/button>/);
  assert.equal((indexSource.match(/id="vaultRecoveryNotNow"/g) || []).length, 1);

  assert.match(vaultStyles, /\.vaultDialogOverlay\s*{[\s\S]*?place-items:\s*start center;/);
  assert.match(vaultStyles, /\.vaultDialogCard\s*{[\s\S]*?overflow:\s*auto;/);
  assert.match(vaultStyles, /\.vaultDialogActions\s*{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(vaultStyles, /\.vaultDialogOverlay\.vaultRecoveryWarningMode \.vaultDialogCard\s*{[\s\S]*?width:\s*min\(356px, 100%\);/);
  assert.match(vaultStyles, /\.vaultDialogOverlay\.vaultRecoveryWarningMode \.vaultRecoveryWarningActions:not\(\[hidden\]\)\s*{[\s\S]*?grid-template-columns:/);
  assert.match(vaultStyles, /\.vaultRecoveryQuietDelete\s*{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?text-decoration:\s*underline;/);
  assert.match(vaultStyles, /\.vaultDialogError:empty\s*{[\s\S]*?display:\s*none;/);
  assert.match(vaultStyles, /\.vaultDialogField input\s*{[\s\S]*?font-size:\s*16px;/);
  assert.match(vaultStyles, /\.vaultRecoveryUnlockedActions\s*{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(vaultStyles, /\.vaultRecoveryViewerBody\s*{[\s\S]*?min-height:\s*0;/);
  assert.match(vaultStyles, /var\(--tree-panel-surface/);
  assert.match(vaultStyles, /var\(--row-on/);
  assert.doesNotMatch(vaultStyles, /align-items:\s*(?:end|stretch)\s*;/);
  assert.doesNotMatch(vaultStyles, /max-height:\s*none\s*;/);
});

test("P023 read-only recovery viewer expands, selects and displays Notes and Outline without adopting", async () => {
  const recoveredPayload = pocketPayload({
    nodes: [
      makeNode("viewer_parent", {
        label: "Recovered viewer parent",
        details: "Parent Notes",
        editor: outlineEditor([
          { id: "viewer_outline_parent", text: "Outline parent", depth: 0 },
          { id: "viewer_outline_child", text: "Outline child", depth: 1 },
        ]),
      }),
      makeNode("viewer_child", {
        parentId: "viewer_parent",
        label: "Recovered viewer child",
        details: "Child Notes",
      }),
    ],
  });
  const recoveryRaw = await recoveryRecordForPayload(recoveredPayload);
  const context = createVaultContext({
    localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
  });
  await unlockStoredRecovery(context);
  const state = lexicalState(context);
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "none");
  assert.equal(state.nodes.length, 0);
  assert.equal(state.ops.length, 0);
  const viewerControls = context.__ui.recoveryViewerOverlay.querySelectorAll(
    "button:not([disabled])",
  );
  const viewerKeep = context.__ui.elements.get("vaultRecoveryKeep");
  const firstViewerControl = viewerControls[0];
  const lastViewerControl = viewerControls[viewerControls.length - 1];
  assert.strictEqual(context.__ui.document.activeElement, viewerKeep);
  lastViewerControl.focus();
  const forwardTab = syntheticEvent("keydown", { key: "Tab", target: lastViewerControl });
  context.__ui.recoveryViewerOverlay.dispatchEvent(forwardTab);
  assert.equal(forwardTab.defaultPrevented, true);
  assert.strictEqual(context.__ui.document.activeElement, firstViewerControl);
  firstViewerControl.focus();
  const reverseTab = syntheticEvent("keydown", {
    key: "Tab",
    shiftKey: true,
    target: firstViewerControl,
  });
  context.__ui.recoveryViewerOverlay.dispatchEvent(reverseTab);
  assert.equal(reverseTab.defaultPrevented, true);
  assert.strictEqual(context.__ui.document.activeElement, lastViewerControl);
  context.__ui.document.activeElement = context.__ui.surface;
  context.__ui.document.dispatch("focusin", { target: context.__ui.surface });
  assert.strictEqual(context.__ui.document.activeElement, viewerKeep);
  assert.match(context.PocketVaultRecoveryViewer.snapshot().selectedOutline, /Outline parent\n  Outline child/);
  assert.equal(context.PocketVaultRecoveryViewer.toggleBranch("viewer_parent"), true);
  assert.deepEqual(
    plain(context.PocketVaultRecoveryViewer.snapshot().collapsedIds),
    ["viewer_parent"],
  );
  assert.equal(context.PocketVaultRecoveryViewer.toggleBranch("viewer_parent"), true);
  assert.equal(context.PocketVaultRecoveryViewer.selectNode("viewer_child"), true);
  assert.equal(context.PocketVaultRecoveryViewer.snapshot().selectedLabel, "Recovered viewer child");
  assert.equal(context.PocketVaultRecoveryViewer.snapshot().selectedDetails, "Child Notes");
  assert.equal(state.nodes.length, 0);
  assert.equal(state.ops.length, 0);
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
  const escapeViewer = syntheticEvent("keydown", {
    key: "Escape",
    target: context.__ui.recoveryViewerOverlay,
  });
  context.__ui.recoveryViewerOverlay.dispatchEvent(escapeViewer);
  assert.equal(escapeViewer.defaultPrevented, true);
  assert.equal(await waitFor(() => !context.PocketVaultRecovery.isFlowOpen()), true);
  assert.equal(storedRecoveryRaw(context), recoveryRaw);
});

test("P023 matching Vault recovery uses Vault ID and revision for clean restore", async () => {
  const vaultId = "vault_same_document";
  const recoveredPayload = pocketPayload({
    nodes: [makeNode("same_recovered", { label: "Recovered original Vault state" })],
  });
  const recoveryRaw = await recoveryRecordForPayload(recoveredPayload, {
    vaultId,
    revision: 6,
  });
  const context = createVaultContext({
    localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
  });
  const savedBase = pocketPayload({
    nodes: [makeNode("same_base", { label: "Saved base state" })],
  });
  const destination = createSyntheticHandle("renamed-original-vault.json", {
    content: await sealForHandle(context, savedBase, {
      vaultId,
      revision: 5,
    }),
  });

  await unlockStoredRecovery(context);
  context.__openPickerQueue.push(destination);
  context.__ui.elements.get("vaultRecoveryAddExisting").click();
  await waitForRecoverySection(context, "vaultCredentialForm");
  await submitCredential(context);
  await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
  assert.match(context.__ui.elements.get("vaultDialogTitle").textContent, /restore recovered changes/i);
  assert.match(context.__ui.elements.get("vaultDialogBody").textContent, /saved revision still matches the base/i);
  assert.equal(destination.writes.length, 0);
  context.__ui.elements.get("vaultRecoveryConfirm").click();
  assert.equal(await waitFor(() => destination.writes.length === 1), true);
  const envelope = JSON.parse(destination.writes[0]);
  assert.equal(envelope.vaultId, vaultId);
  assert.equal(envelope.revision, 6);
  const written = await context.PocketCrypto.openJson(envelope, TEST_PASSPHRASE);
  assert.deepEqual(written.mainThoughtTree.map((node) => node.label), ["Recovered original Vault state"]);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, destination);
  assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
  assert.equal(storedRecoveryRaw(context), "");
});

test("P023 divergent same-Vault and different-Vault recovery preserve destination beneath Recovered", async (t) => {
  await t.test("divergent same Vault offers and performs the safe fallback", async () => {
    const vaultId = "vault_diverged_same";
    const recoveredPayload = pocketPayload({
      nodes: [makeNode("diverged_recovered", { label: "Recovered divergent work" })],
    });
    const recoveryRaw = await recoveryRecordForPayload(recoveredPayload, {
      vaultId,
      revision: 6,
    });
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    const newerPayload = pocketPayload({
      nodes: [makeNode("newer_saved", { label: "Newer saved Vault work" })],
    });
    const destination = createSyntheticHandle("same-name.vault.json", {
      content: await sealForHandle(context, newerPayload, {
        vaultId,
        revision: 8,
      }),
    });
    await unlockStoredRecovery(context);
    context.__openPickerQueue.push(destination);
    context.__ui.elements.get("vaultRecoveryAddExisting").click();
    await waitForRecoverySection(context, "vaultCredentialForm");
    await submitCredential(context);
    await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
    assert.match(context.__ui.elements.get("vaultDialogTitle").textContent, /newer or different changes/i);
    assert.match(context.__ui.elements.get("vaultDialogBody").textContent, /will not overwrite/i);
    assert.equal(destination.writes.length, 0);
    context.__ui.elements.get("vaultRecoveryConfirm").click();
    assert.equal(await waitFor(() => destination.writes.length === 1), true);
    const envelope = JSON.parse(destination.writes[0]);
    assert.equal(envelope.vaultId, vaultId);
    assert.equal(envelope.revision, 9);
    const written = await context.PocketCrypto.openJson(envelope, TEST_PASSPHRASE);
    assert.equal(written.mainThoughtTree.some((node) => node.label === "Newer saved Vault work"), true);
    assert.equal(written.mainThoughtTree.some((node) => /^Recovered /.test(node.label)), true);
    assert.equal(written.mainThoughtTree.some((node) => node.label === "Recovered divergent work"), true);
    assert.equal(storedRecoveryRaw(context), "");
  });

  await t.test("different Vault keeps its own identity and receives one recovered root", async () => {
    const recoveryRaw = await recoveryRecordForPayload(pocketPayload({
      nodes: [makeNode("different_recovered", { label: "Recovered into another Vault" })],
    }), {
      vaultId: "vault_source_different",
      revision: 3,
    });
    const context = createVaultContext({
      localStorageSeed: { [VAULT_RECOVERY_STORAGE_KEY]: recoveryRaw },
    });
    const destinationPayload = pocketPayload({
      nodes: [makeNode("different_destination", { label: "Different Vault original" })],
    });
    const destination = createSyntheticHandle("same-filename.vault.json", {
      content: await sealForHandle(context, destinationPayload, {
        vaultId: "vault_destination_different",
        revision: 4,
      }),
    });
    await unlockStoredRecovery(context);
    context.__openPickerQueue.push(destination);
    context.__ui.elements.get("vaultRecoveryAddExisting").click();
    await waitForRecoverySection(context, "vaultCredentialForm");
    await submitCredential(context);
    await waitForRecoverySection(context, "vaultRecoveryConfirmActions");
    context.__ui.elements.get("vaultRecoveryConfirm").click();
    assert.equal(await waitFor(() => destination.writes.length === 1), true);
    const envelope = JSON.parse(destination.writes[0]);
    assert.equal(envelope.vaultId, "vault_destination_different");
    assert.equal(envelope.revision, 5);
    const written = await context.PocketCrypto.openJson(envelope, TEST_PASSPHRASE);
    assert.equal(written.mainThoughtTree.some((node) => node.label === "Different Vault original"), true);
    assert.equal(written.mainThoughtTree.filter((node) => (
      node.parentId === "root" && /^Recovered /.test(node.label)
    )).length, 1);
    assert.equal(written.mainThoughtTree.some((node) => node.label === "Recovered into another Vault"), true);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, destination);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
    assert.equal(storedRecoveryRaw(context), "");
  });
});

test("P023 Vault-to-JSON conversion adopts only after success and clears only matching recovery", async (t) => {
  await t.test("successful conversion leaves the Vault untouched and opens the new JSON", async () => {
    const context = createVaultContext();
    installOwnerDocument(context, createSyntheticHandle("before-vault.json"), pocketPayload());
    const vaultHandle = createSyntheticHandle("current.vault.json", {
      content: await sealForHandle(context, pocketPayload({
        nodes: [makeNode("convert_vault", { details: "Before conversion" })],
      }), {
        vaultId: "vault_convert_current",
        revision: 2,
      }),
    });
    assert.equal(await openVaultWithPassword(context, vaultHandle), true);
    mutateVaultNode(context, { details: "Unsaved content included in conversion" });
    const matchingRecovery = await waitForStoredRecovery(context);
    assert.equal(matchingRecovery.envelope.vaultId, "vault_convert_current");
    const output = createSyntheticHandle("converted-readable.json");
    context.__savePickerQueue.push(output);
    const converting = context.PocketVaultBrowserIo.convertActiveVaultToJson();
    await waitForRecoverySection(context, "vaultExportActions");
    context.__ui.elements.get("vaultExportConfirm").click();
    assert.equal(await converting, true);
    assert.equal(output.writes.length, 1);
    assert.equal(vaultHandle.writes.length, 0);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, output);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "json");
    assert.equal(JSON.parse(output.writes[0]).mainThoughtTree[0].details, "Unsaved content included in conversion");
    assert.equal(storedRecoveryRaw(context), "");
  });

  await t.test("cancel and write failure keep the Vault active, dirty and recoverable", async () => {
    const context = createVaultContext();
    installOwnerDocument(context, createSyntheticHandle("before-vault.json"), pocketPayload());
    const vaultHandle = createSyntheticHandle("conversion-failure.vault.json", {
      content: await sealForHandle(context, pocketPayload(), {
        vaultId: "vault_convert_failure",
        revision: 1,
      }),
    });
    assert.equal(await openVaultWithPassword(context, vaultHandle), true);
    mutateVaultNode(context, { details: "Still dirty after failed conversion" });
    const recoveryBefore = await waitForStoredRecovery(context);

    const cancelled = context.PocketVaultBrowserIo.convertActiveVaultToJson();
    await waitForRecoverySection(context, "vaultExportActions");
    context.__ui.elements.get("vaultExportCancel").click();
    assert.equal(await cancelled, false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
    assert.equal(lexicalState(context).ops.length, 1);

    const failedOutput = createSyntheticHandle("conversion-failed.json", {
      writeError: new Error("synthetic conversion failure"),
    });
    context.__savePickerQueue.push(failedOutput);
    const failed = context.PocketVaultBrowserIo.convertActiveVaultToJson();
    await waitForRecoverySection(context, "vaultExportActions");
    context.__ui.elements.get("vaultExportConfirm").click();
    assert.equal(await failed, false);
    assert.strictEqual(context.capturePocketFileSaveSession().handle, vaultHandle);
    assert.equal(context.capturePocketFileSaveSession().ownerKind, "vault");
    assert.equal(lexicalState(context).ops.length, 1);
    assert.equal(failedOutput.writes.length, 0);
    assert.equal(storedRecoveryRaw(context), JSON.stringify(recoveryBefore));
  });
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

test("P021 Create completion resets the permanent dialog controls before Unlock", async () => {
  const sealGate = deferred();
  const sealStarted = deferred();
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("p021-create-source.json");
  installOwnerDocument(context, jsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("p021-created.vault.json");
  const productionVault = context.PocketVault;
  let sealCalls = 0;
  context.PocketVault = Object.freeze({
    ...productionVault,
    async sealWithUnlockedKey(...args) {
      sealCalls += 1;
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
  const ui = context.__ui;
  const password = ui.elements.get("vaultPassword");
  const confirmation = ui.elements.get("vaultPasswordConfirm");
  const submit = ui.elements.get("vaultCredentialSubmit");
  const cancel = ui.elements.get("vaultCredentialCancel");
  assertVaultDialogButtons(context, false);
  assert.equal(password.disabled, false);
  assert.equal(confirmation.disabled, false);
  assert.equal(ui.elements.get("vaultPasswordConfirmGroup").hidden, false);
  assert.equal(submit.textContent, "Create encrypted Vault");
  assert.strictEqual(ui.document.activeElement, password);

  password.value = TEST_PASSPHRASE;
  confirmation.value = TEST_PASSPHRASE;
  const submitting = ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", { target: ui.elements.get("vaultCredentialForm") }),
  );
  await sealStarted.promise;
  assertVaultDialogButtons(context, true);
  assert.equal(submit.disabled, true);
  assert.equal(cancel.disabled, true);
  await ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", { target: ui.elements.get("vaultCredentialForm") }),
  );
  assert.equal(sealCalls, 1);
  assert.equal(vaultHandle.createWritableCalls, 0);

  sealGate.resolve();
  await submitting;
  assert.equal(await creating, true);
  assert.equal(vaultHandle.writes.length, 1);
  assertVaultDialogClosedNeutral(context);

  const laterJson = createSyntheticHandle("p021-after-create.json");
  installOwnerDocument(context, laterJson, pocketPayload({
    nodes: [makeNode("p021_after_create")],
  }));
  context.__openPickerQueue.push(vaultHandle);
  const opening = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => !ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  assertVaultDialogButtons(context, false);
  assert.equal(password.disabled, false);
  assert.equal(confirmation.disabled, true);
  assert.equal(ui.elements.get("vaultPasswordConfirmGroup").hidden, true);
  assert.equal(submit.textContent, "Unlock");
  assert.strictEqual(ui.document.activeElement, password);
  password.value = TEST_PASSPHRASE;
  password.dispatchEvent(syntheticEvent("input", { target: password }));
  assert.equal(submit.disabled, false);
  assert.equal(cancel.disabled, false);
  await ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", { target: ui.elements.get("vaultCredentialForm") }),
  );
  assert.equal(await opening, true);
  assert.equal(vaultHandle.writes.length, 1);
  assertVaultDialogClosedNeutral(context);
});

test("P021 Unlock can reopen, Cancel and Escape after an earlier successful action", async () => {
  const { context, vaultHandle } = await contextWithCleanVault({
    name: "p021-reusable-unlock.vault.json",
    vaultId: "vault_p021_reusable_unlock",
  });
  assertVaultDialogClosedNeutral(context);
  const jsonHandle = createSyntheticHandle("p021-unlock-owner.json");
  installOwnerDocument(context, jsonHandle, pocketPayload({
    nodes: [makeNode("p021_unlock_owner")],
  }));
  const before = currentOwnerSnapshot(context);

  context.__openPickerQueue.push(vaultHandle);
  const cancelled = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  assertVaultDialogButtons(context, false);
  context.__ui.elements.get("vaultCredentialCancel").click();
  assert.equal(await cancelled, false);
  assertOwnerUnchanged(context, before);
  assertVaultDialogClosedNeutral(context);

  context.__openPickerQueue.push(vaultHandle);
  const escaped = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  assertVaultDialogButtons(context, false);
  const escape = pressVaultEscape(context);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(await escaped, false);
  assertOwnerUnchanged(context, before);
  assertVaultDialogClosedNeutral(context);

  assert.equal(await openVaultWithPassword(context, vaultHandle), true);
  assertVaultDialogClosedNeutral(context);
  assert.equal(vaultHandle.writes.length, 0);
});

test("P021 failed Unlock re-enables retry and blocks duplicate submission while busy", async () => {
  const unlockGate = deferred();
  const context = createVaultContext();
  const jsonHandle = createSyntheticHandle("p021-retry-owner.json");
  installOwnerDocument(context, jsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("p021-retry.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("p021_retry_target")] }),
      { vaultId: "vault_p021_retry", revision: 1 },
    ),
  });
  const productionVault = context.PocketVault;
  let unlockCalls = 0;
  context.PocketVault = Object.freeze({
    ...productionVault,
    async unlockEnvelope(...args) {
      unlockCalls += 1;
      if (unlockCalls === 1) await unlockGate.promise;
      return productionVault.unlockEnvelope(...args);
    },
  });

  context.__openPickerQueue.push(vaultHandle);
  const opening = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  const ui = context.__ui;
  const password = ui.elements.get("vaultPassword");
  password.value = "wrong-password-for-p021";
  const firstSubmit = ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", { target: ui.elements.get("vaultCredentialForm") }),
  );
  assert.equal(await waitFor(() => unlockCalls === 1), true);
  assertVaultDialogButtons(context, true);
  await ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", { target: ui.elements.get("vaultCredentialForm") }),
  );
  assert.equal(unlockCalls, 1);

  unlockGate.resolve();
  await firstSubmit;
  assert.equal(context.PocketVaultBrowserIo.isDialogOpen(), true);
  assert.match(ui.elements.get("vaultDialogError").textContent, /did not unlock/i);
  assertVaultDialogButtons(context, false);
  assert.equal(password.value, "");
  assert.equal(ui.elements.get("vaultPasswordConfirm").value, "");
  assert.strictEqual(ui.document.activeElement, password);

  await submitCredential(context);
  assert.equal(await opening, true);
  assert.equal(unlockCalls, 2);
  assertVaultDialogClosedNeutral(context);
  assert.equal(vaultHandle.writes.length, 0);
});

test("P021 Export and owner-switch modes reset hidden and visible controls", async (t) => {
  await t.test("Export controls are isolated", async () => {
    const { context } = await contextWithCleanVault({
      name: "p021-export-owner.vault.json",
      vaultId: "vault_p021_export_owner",
    });
    for (const id of VAULT_DIALOG_BUTTON_IDS) {
      context.__ui.elements.get(id).disabled = true;
    }
    const exporting = context.PocketVaultBrowserIo.exportUnencryptedJsonCopy();
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultExportActions").hidden),
      true,
    );
    assertVaultDialogButtons(context, false);
    assert.strictEqual(
      context.__ui.document.activeElement,
      context.__ui.elements.get("vaultExportConfirm"),
    );
    context.__ui.elements.get("vaultSwitchDiscard").click();
    assert.equal(context.PocketVaultBrowserIo.isDialogOpen(), true);
    context.__ui.elements.get("vaultExportCancel").click();
    assert.equal(await exporting, false);
    assertVaultDialogClosedNeutral(context);
  });

  await t.test("owner-switch controls are isolated across repeated opens", async () => {
    const { context } = await contextWithDirtyVault({
      name: "p021-switch-owner.vault.json",
      vaultId: "vault_p021_switch_owner",
    });
    for (const id of VAULT_DIALOG_BUTTON_IDS) {
      context.__ui.elements.get(id).disabled = true;
    }
    const firstCandidate = createSyntheticHandle("p021-switch-first.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("p021_switch_first")] })),
    });
    const first = await beginJsonOwnerSwitch(context, firstCandidate);
    assertVaultDialogButtons(context, false);
    assert.strictEqual(
      context.__ui.document.activeElement,
      context.__ui.elements.get("vaultSwitchSave"),
    );
    context.__ui.elements.get("vaultExportConfirm").click();
    assert.equal(context.PocketVaultBrowserIo.isDialogOpen(), true);
    context.__ui.elements.get("vaultSwitchCancel").click();
    assert.equal(await first.opening, false);
    assertVaultDialogClosedNeutral(context);

    const secondCandidate = createSyntheticHandle("p021-switch-second.json", {
      content: JSON.stringify(pocketPayload({ nodes: [makeNode("p021_switch_second")] })),
    });
    const second = await beginJsonOwnerSwitch(context, secondCandidate);
    assertVaultDialogButtons(context, false);
    context.__ui.elements.get("vaultSwitchCancel").click();
    assert.equal(await second.opening, false);
    assertVaultDialogClosedNeutral(context);
  });
});

test("P021 failed busy owner-switch re-enables its controls and permits Cancel", async () => {
  const writeGate = deferred();
  const { context, vaultHandle } = await contextWithDirtyVault({
    name: "p021-switch-failure.vault.json",
    vaultId: "vault_p021_switch_failure",
    handleOptions: {
      writeDeferred: writeGate,
      writeError: new Error("synthetic P021 Vault write failure"),
    },
  });
  const before = currentOwnerSnapshot(context);
  const candidate = createSyntheticHandle("p021-switch-failure-target.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("p021_switch_failure_target")] })),
  });
  const { opening } = await beginJsonOwnerSwitch(context, candidate);
  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(await waitFor(() => vaultHandle.createWritableCalls === 1), true);
  assertVaultDialogButtons(context, true);
  context.__ui.elements.get("vaultSwitchSave").click();
  assert.equal(vaultHandle.createWritableCalls, 1);

  writeGate.resolve();
  assert.equal(
    await waitFor(() => /could not save/i.test(
      context.__ui.elements.get("vaultDialogError").textContent,
    )),
    true,
  );
  assertVaultDialogButtons(context, false);
  assert.equal(context.PocketVaultBrowserIo.isDialogOpen(), true);
  assert.strictEqual(
    context.__ui.document.activeElement,
    context.__ui.elements.get("vaultSwitchSave"),
  );
  context.__ui.elements.get("vaultSwitchCancel").click();
  assert.equal(await opening, false);
  assertOwnerUnchanged(context, before);
  assert.equal(vaultHandle.writes.length, 0);
  assert.equal(candidate.writes.length, 0);
  assertVaultDialogClosedNeutral(context);

  const retryCandidate = createSyntheticHandle("p021-switch-after-failure.json", {
    content: JSON.stringify(pocketPayload({ nodes: [makeNode("p021_switch_after_failure")] })),
  });
  const retry = await beginJsonOwnerSwitch(context, retryCandidate);
  assertVaultDialogButtons(context, false);
  context.__ui.elements.get("vaultSwitchCancel").click();
  assert.equal(await retry.opening, false);
  assertVaultDialogClosedNeutral(context);
});

test("P021 stale credential completion cannot mutate a newer dialog", async () => {
  const unlockGate = deferred();
  const context = createVaultContext({ exposeVaultDialogTestControl: true });
  const jsonHandle = createSyntheticHandle("p021-stale-owner.json");
  installOwnerDocument(context, jsonHandle, pocketPayload());
  const vaultA = createSyntheticHandle("p021-stale-a.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("p021_stale_a")] }),
      { vaultId: "vault_p021_stale_a", revision: 1 },
    ),
  });
  const vaultB = createSyntheticHandle("p021-stale-b.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("p021_stale_b")] }),
      { vaultId: "vault_p021_stale_b", revision: 1 },
    ),
  });
  const productionVault = context.PocketVault;
  let unlockCalls = 0;
  context.PocketVault = Object.freeze({
    ...productionVault,
    async unlockEnvelope(...args) {
      unlockCalls += 1;
      if (unlockCalls === 1) await unlockGate.promise;
      return productionVault.unlockEnvelope(...args);
    },
  });

  context.__openPickerQueue.push(vaultA);
  const openingA = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  context.__ui.elements.get("vaultPassword").value = TEST_PASSPHRASE;
  const submittingA = context.__ui.elements.get("vaultCredentialForm").dispatchAsync(
    syntheticEvent("submit", { target: context.__ui.elements.get("vaultCredentialForm") }),
  );
  assert.equal(await waitFor(() => unlockCalls === 1), true);
  assertVaultDialogButtons(context, true);
  assert.equal(context.__closeVaultDialogForTest(), true);
  assert.equal(await openingA, false);
  assertVaultDialogClosedNeutral(context);

  context.__openPickerQueue.push(vaultB);
  const openingB = context.PocketVaultBrowserIo.openVault();
  assert.equal(
    await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
    true,
  );
  const newerPassword = "newer-dialog-password";
  context.__ui.elements.get("vaultPassword").value = newerPassword;
  assertVaultDialogButtons(context, false);
  assert.equal(context.__ui.elements.get("vaultDialogError").textContent, "");

  unlockGate.resolve();
  await submittingA;
  assert.equal(context.PocketVaultBrowserIo.isDialogOpen(), true);
  assert.equal(context.__ui.elements.get("vaultPassword").value, newerPassword);
  assert.equal(context.__ui.elements.get("vaultDialogError").textContent, "");
  assertVaultDialogButtons(context, false);
  context.__ui.elements.get("vaultCredentialCancel").click();
  assert.equal(await openingB, false);
  assertVaultDialogClosedNeutral(context);
  assert.equal(vaultA.writes.length, 0);
  assert.equal(vaultB.writes.length, 0);
  assert.strictEqual(context.capturePocketFileSaveSession().handle, jsonHandle);
});

test("P021 repeated initialisation and dialog reuse do not duplicate bindings", async () => {
  const context = createVaultContext();
  const form = context.__ui.elements.get("vaultCredentialForm");
  const initial = {
    submit: (form.listeners.get("submit") || []).length,
    buttons: Object.fromEntries(VAULT_DIALOG_BUTTON_IDS.map((id) => [
      id,
      (context.__ui.elements.get(id).listeners.get("click") || []).length,
    ])),
    keydown: (context.__windowListeners.get("keydown") || []).length,
    focusin: (context.__ui.documentListeners.get("focusin") || []).length,
  };
  assert.equal(initial.submit, 1);
  assert.deepEqual(initial.buttons, {
    vaultCredentialSubmit: 0,
    vaultCredentialCancel: 1,
    vaultExportConfirm: 1,
    vaultExportCancel: 1,
    vaultSwitchSave: 1,
    vaultSwitchDiscard: 1,
    vaultSwitchCancel: 1,
    vaultRecoveryUnlock: 1,
    vaultRecoveryDelete: 1,
    vaultRecoveryNotNow: 1,
    vaultRecoveryConfirm: 1,
    vaultRecoveryConfirmCancel: 1,
  });

  context.PocketVaultBrowserIo.init();
  context.PocketVaultBrowserIo.init();
  context.PocketVaultBrowserIo.init();
  assert.equal((form.listeners.get("submit") || []).length, initial.submit);
  for (const [id, count] of Object.entries(initial.buttons)) {
    assert.equal((context.__ui.elements.get(id).listeners.get("click") || []).length, count);
  }
  assert.equal((context.__windowListeners.get("keydown") || []).length, initial.keydown);
  assert.equal(
    (context.__ui.documentListeners.get("focusin") || []).length,
    initial.focusin,
  );

  const jsonHandle = createSyntheticHandle("p021-binding-owner.json");
  installOwnerDocument(context, jsonHandle, pocketPayload());
  const vaultHandle = createSyntheticHandle("p021-binding.vault.json", {
    content: await sealForHandle(
      context,
      pocketPayload({ nodes: [makeNode("p021_binding")] }),
      { vaultId: "vault_p021_binding", revision: 1 },
    ),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    context.__openPickerQueue.push(vaultHandle);
    const opening = context.PocketVaultBrowserIo.openVault();
    assert.equal(
      await waitFor(() => !context.__ui.elements.get("vaultCredentialForm").hidden),
      true,
    );
    assertVaultDialogButtons(context, false);
    context.__ui.elements.get("vaultCredentialCancel").click();
    assert.equal(await opening, false);
    assertVaultDialogClosedNeutral(context);
  }
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
  const recovered = await decryptStoredRecovery(context);
  assert.equal(
    recovered.mainThoughtTree[0].details,
    "Newer edit while encrypted Save is closing",
  );

  const finalSave = await context.exportTree({ returnDetails: true });
  assert.equal(finalSave.ok, true);
  assert.equal(vaultHandle.writes.length, 2);
  assert.equal(context.PocketVault.getActiveSession().revision, 3);
  assert.equal(state.ops.length, 0);
  assert.equal(storedRecoveryRaw(context), "");
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
