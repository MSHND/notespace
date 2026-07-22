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
    document: {
      body: { classList },
      activeElement: null,
      getElementById() { return null; },
      addEventListener() {},
    },
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
    HTMLElement: class HTMLElement {},
    HTMLInputElement: class HTMLInputElement {},
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
  return state;
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
    "    textToOutline: textToOutline,",
    "    outlineToText: outlineToText,",
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

function executeControlledRuntime(payload) {
  const factory = loadRuntimeFactory();
  const listeners = new Map();
  const windowListeners = new Map();
  const controls = new Map();
  const applyCalls = [];
  const saveCalls = [];
  const classNames = new Set(["textMode"]);
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
        stopImmediatePropagation() {},
        ...values,
      };
      for (const handler of listeners.get(type) || []) handler(event);
      return event;
    },
    getElementById(id) { return controls.get(id) || null; },
    createElement(tagName) { return makeControl("", tagName); },
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
      hidden: false,
      disabled: false,
      readOnly: false,
      value: "",
      textContent: "",
      contentEditable: "false",
      isConnected: true,
      addEventListener(type, handler) {
        if (!ownListeners.has(type)) ownListeners.set(type, []);
        ownListeners.get(type).push(handler);
      },
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
          stopImmediatePropagation() {},
          ...values,
        };
        for (const handler of ownListeners.get(type) || []) handler(event);
        return event;
      },
      setAttribute(name, value) { attributes.set(String(name), String(value)); },
      getAttribute(name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; },
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((item) => item !== child); return child; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      closest() { return null; },
      contains(child) { return this.children.includes(child); },
      focus() { document.activeElement = control; },
      select() {},
      getBoundingClientRect() { return { width: 100, height: 30 }; },
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

  const window = {
    opener: {
      closed: false,
      PocketNodePopoutEditor: {
        apply(nextPayload) {
          applyCalls.push(nextPayload);
          return true;
        },
        applyAndSave(nextPayload) {
          saveCalls.push(nextPayload);
          return Promise.resolve({ ok: true, exported: true });
        },
      },
    },
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
    setTimeout(handler) { if (typeof handler === "function") handler(); return 1; },
    close() { closeCalls += 1; },
    focus() {},
  };
  const program = factory.build(JSON.stringify(payload));
  assert.doesNotThrow(() => new Function(program));
  new Function("window", "document", "navigator", "requestAnimationFrame", "alert", "console", program)(
    window,
    document,
    { clipboard: {} },
    (callback) => { if (typeof callback === "function") callback(); return 1; },
    () => {},
    { log() {}, info() {}, warn() {}, error() {} },
  );
  return {
    program,
    window,
    document,
    controls,
    applyCalls,
    saveCalls,
    classNames,
    closeCalls: () => closeCalls,
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

test("editor and pe are reserved outside the generic extras budget regardless of property order", () => {
  const context = createCoreContext();
  const crowded = syntheticNode("crowded");
  for (let index = 0; index < 24; index += 1) crowded[`extra${String(index).padStart(2, "0")}`] = index;
  crowded.editor = { schema: EDITOR_SCHEMA, mode: "outline", outline: [{ text: "Kept?", depth: 1 }] };
  crowded.pe = { schema: "pocket.pe.v1", mode: "text", text: "Kept?" };
  const normalised = normaliseOne(context, crowded);
  assert.equal(normalised.editor.schema, EDITOR_SCHEMA);
  assert.equal(normalised.pe.schema, "pocket.pe.v1");
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
  assert.equal(earlyNormalised.pe.schema, "pocket.pe.v1");
  assert.equal(earlyNormalised.extra23, 23);
  assert.deepEqual(plain(earlyNormalised.editor), plain(normalised.editor));
  assert.deepEqual(plain(earlyNormalised.pe), plain(normalised.pe));
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
  assert.equal(editedNode.pe, null);
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

test("large legacy pe survives load, export, reload, and remains outside the active PE model", () => {
  const context = createFullContractContext();
  const pe = largeLegacyPe();
  const input = {
    schema: "portal.export.v1",
    writtenAt: "2026-01-01T00:00:00.000Z",
    mainThoughtTree: [syntheticNode("large_pe", { details: "Current readable Text", pe })],
    mainThoughtTreeTombstones: [],
  };
  const first = context.normaliseInput(input);
  assert.equal(JSON.stringify(first.nodes[0].pe), JSON.stringify(pe));
  assert.notStrictEqual(first.nodes[0].pe, pe);

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
  assert.equal(JSON.stringify(exported.mainThoughtTree[0].pe), JSON.stringify(pe));
  const reloaded = context.normaliseInput(exported);
  assert.equal(JSON.stringify(reloaded.nodes[0].pe), JSON.stringify(pe));
  assert.equal(context.PocketNodePopoutModel.buildPayload(reloaded.nodes[0]).mode, "text");
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
});

test("first-class editor and pe null, scalar, and array values survive load, export, and reload", () => {
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
    assert.equal(JSON.stringify(node.pe), JSON.stringify(item.pe));
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
    assert.equal(JSON.stringify(exportedNode.pe), JSON.stringify(item.pe));
    assert.equal(JSON.stringify(reloadedNode.editor), JSON.stringify(item.editor));
    assert.equal(JSON.stringify(reloadedNode.pe), JSON.stringify(item.pe));
  }
  const nullOpening = context.PocketNodePopoutModel.buildPayload(reloaded.nodes.find((node) => node.id === "first_class_null"));
  assert.equal(Object.hasOwn(nullOpening, "readOnly"), false);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
});

test("non-JSON in-memory editor or pe values fail closed without discarding the node", async () => {
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
  let exportCalls = 0;
  context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
  const rejected = await context.PocketNodePopoutEditor.applyAndSave(opening);
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
  assert.strictEqual(loadedPe.pe, cyclicPe);
  assert.equal(Object.hasOwn(loadedPe, "editor"), false);
  assert.equal(context.PocketNodePopoutModel.classifyNodeEditor(loadedPe).kind, "unsupported-or-malformed");
  const peOpening = context.PocketNodePopoutModel.buildPayload(loadedPe);
  assert.equal(peOpening.readOnly, true);
  assert.equal(peOpening.body, "Readable cyclic pe fallback");
  state.nodes = [loadedPe];
  state.ops = [];
  state.selectedId = loadedPe.id;
  const rejectedPe = await context.PocketNodePopoutEditor.applyAndSave(peOpening);
  assert.equal(rejectedPe.reason, "unsupported-editor");
  assert.equal(rejectedPe.applied, false);
  assert.strictEqual(state.nodes[0].pe, cyclicPe);
  assert.equal(state.ops.length, 0);
  assert.equal(exportCalls, 0);
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

test("CURRENT-RISK: load-time pe synthesis changes a later explicit export shape without a truth write on open", () => {
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
  assert.deepEqual(plain(state.nodes[0].pe), {
    schema: "pocket.pe.v1",
    title: "Synthetic text note",
    mode: "text",
    text: "Parent\n  Child",
    outline: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
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
  assert.equal(exported.mainThoughtTree[0].pe.schema, "pocket.pe.v1");
  assert.equal(exported.data.mainThoughtTree[0].pe.text, "Parent\n  Child");
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("buildPocketPayload emits the current guarded dual-tree export shape", () => {
  const context = createFullContractContext();
  const node = syntheticNode("exported", {
    details: "Projection",
    editor: { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [{ id: "block", text: "Outline", depth: 0 }] },
    pe: { schema: "pocket.pe.v1", mode: "text", text: "Legacy shadow" },
    unknownNodeField: { keep: true },
  });
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
  assert.equal(payload.mainThoughtTree[0].pe.schema, "pocket.pe.v1");
  assert.equal(payload.mainThoughtTree[0].unknownNodeField.keep, true);

  state.nodes[0].label = "Mutated after build";
  assert.equal(payload.mainThoughtTree[0].label, "Synthetic exported");
  assert.equal(vm.runInContext("truthFileHandle === null", context), true);
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("ordinary Text and empty Text fixtures characterise current load/export round trips", () => {
  const text = loadAndExportFixture("legacy-text.json");
  assert.equal(text.state.nodes[0].details, "Parent\n  Child");
  assert.equal(text.state.nodes[0].pe.schema, "pocket.pe.v1");
  assert.equal(text.payload.mainThoughtTree[0].details, "Parent\n  Child");

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

test("CURRENT-RISK: accepted Outline and details drift remain independent and Outline wins PE mode", () => {
  const result = loadAndExportFixture("current-outline-v1.json");
  const node = result.state.nodes[0];
  assert.equal(node.details, "Compatibility projection intentionally differs");
  assert.equal(node.editor.outline[0].text, "Outline parent");
  assert.equal(node.pe.mode, "text");
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

test("CURRENT-RISK: PE opening payload has no file-session or original-revision identity", () => {
  const context = createFullContractContext();
  const node = syntheticNode("payload_text", { label: "  Text   title  ", details: "Text body" });
  resetState(context, [node]);
  const payload = context.PocketNodePopoutModel.buildPayload(node);
  assert.deepEqual(Object.keys(payload).sort(), ["body", "id", "mode", "openedAt", "outline", "path", "title", "updatedAt"]);
  assert.equal(payload.id, "payload_text");
  assert.equal(payload.title, "Text title");
  assert.equal(payload.body, "Text body");
  assert.equal(payload.mode, "text");
  assert.equal(payload.outline, null);
  assert.equal(Object.hasOwn(payload, "fileSessionId"), false);
  assert.equal(Object.hasOwn(payload, "sourceFileName"), false);
  assert.equal(Object.hasOwn(payload, "originalUpdatedAt"), false);
  assert.ok(Number.isFinite(Date.parse(payload.openedAt)));
  assert.ok(Number.isFinite(Date.parse(payload.updatedAt)));
});

test("CURRENT-RISK: Outline apply accepts independent details/editor content and silently enforces title/body limits", () => {
  const context = createFullContractContext();
  const state = resetState(context, [
    syntheticNode("other", { details: "Other" }),
    syntheticNode("apply_outline", {
      details: "Before",
      pe: { schema: "pocket.pe.v1", mode: "text", text: "Legacy remains" },
    }),
  ]);
  state.selectedId = "other";
  const ok = context.PocketNodePopoutEditor.apply({
    id: "apply_outline",
    title: "T".repeat(221),
    body: "B".repeat(4001),
    schema: EDITOR_SCHEMA,
    mode: "outline",
    outline: [
      { id: "parent", text: "Parent", depth: 0, collapsed: true, order: 50 },
      { id: "child", text: "Child", depth: 1, collapsed: false, order: 60 },
    ],
  });
  assert.equal(ok, true);
  const changed = state.nodes.find((node) => node.id === "apply_outline");
  assert.equal(changed.label.length, 220);
  assert.equal(changed.details.length, 4000);
  assert.equal(changed.editor.schema, "pocket.nodeEditor.v1");
  assert.deepEqual(plain(changed.editor.outline.map((block) => block.order)), [1, 2]);
  assert.equal(changed.pe.text, "Legacy remains");
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].type, "details_edit");
  assert.equal(state.ops[0].id, "apply_outline");
  assert.equal(state.ops[0].changed, "outline");
});

test("CURRENT-RISK: changed Text apply deletes accepted Outline metadata and blank details", () => {
  const context = createFullContractContext();
  const outlineNode = fixture("current-outline-v1.json").mainThoughtTree[0];
  const state = resetState(context, [outlineNode]);
  const ok = context.PocketNodePopoutEditor.apply({
    id: outlineNode.id,
    title: outlineNode.label,
    body: "   \n\t ",
    mode: "text",
    outline: null,
  });
  assert.equal(ok, true);
  assert.equal(Object.hasOwn(state.nodes[0], "editor"), false);
  assert.equal(Object.hasOwn(state.nodes[0], "details"), false);
  assert.equal(state.ops.length, 1);
  assert.equal(state.ops[0].changed, "details");
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
    assert.deepEqual(plain(detailed), {
      ok: false,
      changed: false,
      id: state.nodes[0].id,
      label: state.nodes[0].label,
      readOnly: true,
      reason: "unsupported-editor",
    });
    const saved = await context.PocketNodePopoutEditor.applyAndSave(payload);
    assert.deepEqual(plain(saved), {
      ok: false,
      applied: false,
      changed: false,
      exported: false,
      reason: "unsupported-editor",
    });
    assert.equal(JSON.stringify(state.nodes[0]), before);
    assert.equal(state.ops.length, 0);
    assert.equal(exportCalls, 0);
    assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  }
});

test("editor cutover attempts canonical read-only open and never falls back to the legacy editable popup", () => {
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

  assert.equal(context.openPocketEditor(ordinary.id), true);
  assert.equal(standaloneCalls, 2);
  assert.equal(legacyBridgeCalls, 1);
  assert.equal(legacyPopupCalls, 1);

  assert.equal(context.openPocketNodeEditor(supported.id), true);
  assert.equal(standaloneCalls, 3);
  assert.equal(legacyBridgeCalls, 2);
  assert.equal(legacyPopupCalls, 2);
});

test("an unrelated edit and explicit export preserve raw unsupported and large first-class metadata", () => {
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
  const state = lexicalState(context);
  const changed = context.PocketNodePopoutEditor.apply({
    id: "unrelated_target",
    title: "Synthetic unrelated_target",
    body: "After",
    mode: "text",
    outline: null,
  });
  assert.equal(changed, true);
  assert.equal(state.ops.length, 1);

  const exported = context.buildPocketPayload("2026-02-03T00:00:00.000Z");
  const byId = new Map(exported.mainThoughtTree.map((node) => [node.id, node]));
  assert.equal(JSON.stringify(byId.get(unknown.id).editor), JSON.stringify(unknown.editor));
  assert.equal(JSON.stringify(byId.get(malformed.id).editor), JSON.stringify(malformed.editor));
  assert.equal(JSON.stringify(byId.get("unrelated_large_editor").editor), JSON.stringify(largeEditor));
  assert.equal(JSON.stringify(byId.get("unrelated_large_pe").pe), JSON.stringify(largePe));
  assert.equal(byId.get("unrelated_target").details, "After");
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("local safety, trail, auto-cache, and PiP recovery routes retain large and unknown first-class metadata", () => {
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
    assert.equal(JSON.stringify(byId.get("recovery_pe").pe), JSON.stringify(legacyPe));
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

  assert.equal(context.restoreLocalSafetySnapshot(snapshot), true);
  const restoredState = lexicalState(context);
  assertRecoveredMetadata(restoredState.nodes);
  assert.equal(restoredState.selectedId, "recovery_unknown");
  assert.equal(restoredState.collapsed.has("recovery_current"), true);
  assert.deepEqual(plain(restoredState.ops), [{ type: "synthetic_recovery" }]);
  assert.equal(context.PocketNodePopoutModel.buildPayload(restoredState.nodes.find((node) => node.id === "recovery_unknown")).readOnly, true);

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
  const pipState = lexicalState(pipContext);
  assertRecoveredMetadata(pipState.nodes);
  assert.equal(pipNormaliseCalls, 1);
  assert.equal(pipState.selectedId, "recovery_unknown");
  assert.equal(pipState.collapsed.has("recovery_current"), true);
  assert.equal(pipContext.PocketNodePopoutModel.buildPayload(pipState.nodes.find((node) => node.id === "recovery_unknown")).readOnly, true);
  assert.equal(pipContext.__surfaceCalls.writeTruthFile, 0);
  assert.equal(pipContext.__surfaceCalls.showOpenFilePicker, 0);
  assert.equal(pipContext.__surfaceCalls.showSaveFilePicker, 0);
});

test("unchanged PE apply records no operation", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("unchanged", { details: "Same" });
  const state = resetState(context, [node]);
  let exportCalls = 0;
  context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
  const result = await context.PocketNodePopoutEditor.applyAndSave({
    id: node.id,
    title: node.label,
    body: node.details,
    mode: "text",
    outline: null,
  });
  assert.deepEqual(plain(result), { ok: true, applied: false, changed: false, exported: false, reason: "unchanged" });
  assert.equal(state.ops.length, 0);
  assert.equal(exportCalls, 0);
});

test("CURRENT-RISK: unchanged PE save cannot see lexical unsaved operations through window.state", async () => {
  const context = createFullContractContext();
  const node = syntheticNode("lexical_state", { details: "Same" });
  const state = resetState(context, [node], [{ type: "synthetic_unsaved" }]);
  let exportCalls = 0;
  context.exportTree = async () => { exportCalls += 1; return { ok: true }; };
  assert.equal(vm.runInContext("typeof state", context), "object");
  assert.equal(typeof context.state, "undefined");
  assert.equal(context.PocketNodePopoutTarget.get(), null);

  const result = await context.PocketNodePopoutEditor.applyAndSave({
    id: node.id,
    title: node.label,
    body: node.details,
    mode: "text",
    outline: null,
  });
  assert.equal(result.reason, "unchanged");
  assert.equal(result.exported, false);
  assert.equal(exportCalls, 0);
  assert.equal(state.ops.length, 1);
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
    return { ok: true };
  };
  const result = await context.PocketNodePopoutEditor.applyAndSave({
    id: node.id,
    title: node.label,
    body: "After",
    mode: "text",
    outline: null,
  }, { exportOptions: { synthetic: true, returnDetails: false } });
  assert.deepEqual(plain(result), { ok: true, applied: true, changed: true, exported: true, reason: "exported" });
  assert.equal(state.nodes[0].details, "After");
  assert.equal(state.ops.length, 1);
  assert.equal(exportCalls, 1);
  assert.deepEqual(receivedOptions, { synthetic: true, returnDetails: true });
  assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  assert.equal(context.__surfaceCalls.showSaveFilePicker, 0);
});

test("applyAndSave characterises cancelled, downloaded-copy, thrown, and unavailable export results in memory", async () => {
  const cases = [
    { response: false, reason: "export-failed-or-cancelled" },
    { response: { ok: false, cancelled: true }, reason: "export-failed-or-cancelled" },
    { response: { downloaded: true }, reason: "downloaded-copy", downloaded: true },
  ];
  for (const [index, item] of cases.entries()) {
    const context = createFullContractContext();
    const node = syntheticNode(`save_result_${index}`, { details: "Before" });
    const state = resetState(context, [node]);
    context.exportTree = async () => item.response;
    const result = await context.PocketNodePopoutEditor.applyAndSave({ id: node.id, title: node.label, body: "After", mode: "text", outline: null });
    assert.equal(result.ok, false);
    assert.equal(result.applied, true);
    assert.equal(result.exported, false);
    assert.equal(result.reason, item.reason);
    assert.equal(result.downloaded === true, item.downloaded === true);
    assert.equal(state.nodes[0].details, "After");
    assert.equal(state.ops.length, 1);
    assert.equal(context.__surfaceCalls.writeTruthFile, 0);
  }

  const thrownContext = createFullContractContext();
  const thrownNode = syntheticNode("save_thrown", { details: "Before" });
  const thrownState = resetState(thrownContext, [thrownNode]);
  thrownContext.exportTree = async () => { throw new Error("synthetic export failure"); };
  const thrown = await thrownContext.PocketNodePopoutEditor.applyAndSave({ id: thrownNode.id, title: thrownNode.label, body: "After", mode: "text", outline: null });
  assert.equal(thrown.reason, "export-failed");
  assert.equal(thrownState.ops.length, 1);

  const unavailableContext = createFullContractContext();
  const unavailableNode = syntheticNode("save_unavailable", { details: "Before" });
  const unavailableState = resetState(unavailableContext, [unavailableNode]);
  delete unavailableContext.exportTree;
  const unavailable = await unavailableContext.PocketNodePopoutEditor.applyAndSave({ id: unavailableNode.id, title: unavailableNode.label, body: "After", mode: "text", outline: null });
  assert.equal(unavailable.reason, "export-unavailable");
  assert.equal(unavailableState.ops.length, 1);
});

test("generated PE runtime builds and compiles for Text, saved Outline, and rejected metadata payloads", () => {
  const factory = loadRuntimeFactory();
  const modelContext = createFullContractContext();
  const rejected = modelContext.PocketNodePopoutModel.buildPayload(syntheticNode("rejected", {
    details: "",
    editor: { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [] },
  }));
  const payloads = [
    { id: "runtime_text", title: "Text", body: "Body", mode: "text", outline: null },
    {
      id: "runtime_outline",
      title: "Outline",
      body: "Parent\n  Child",
      mode: "outline",
      outline: [
        { id: "stable_parent", text: "Parent", depth: 0, collapsed: true },
        { id: "stable_child", text: "Child", depth: 1, collapsed: false },
      ],
    },
    rejected,
  ];
  for (const payload of payloads) {
    const program = factory.build(JSON.stringify(payload));
    assert.equal(typeof program, "string");
    assert.doesNotThrow(() => new Function(program));
  }
});

test("generated editable Outline runtime emits the exact v1 schema on save", () => {
  const runtime = executeControlledRuntime({
    id: "runtime_schema_save",
    title: "Schema save",
    body: "Parent\n  Child",
    mode: "outline",
    outline: [
      { id: "runtime_parent", text: "Parent", depth: 0, collapsed: true, order: 90 },
      { id: "runtime_child", text: "Child", depth: 1, collapsed: false, order: 80 },
    ],
  });
  runtime.controls.get("saveBtn").dispatch("click");
  assert.equal(runtime.applyCalls.length, 0);
  assert.equal(runtime.saveCalls.length, 1);
  assert.equal(runtime.saveCalls[0].schema, EDITOR_SCHEMA);
  assert.equal(runtime.saveCalls[0].mode, "outline");
  assert.equal(runtime.saveCalls[0].outline.length, 2);
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
  assert.match(html, /Read only · select text to copy/);
  assert.equal(html.includes("preserve-if-untouched"), false);
  assert.equal(html.includes("Future outline content"), false);
  assert.equal(html.includes(rawEditor.padding.slice(0, 128)), false);
});

test("generated PE runtime shared parser handles spaces, tabs, mixed indentation, common indentation, blanks, and depth clamp", () => {
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
    const blocks = probe.textToOutline(input);
    assert.deepEqual(blocks.map((block) => block.depth), depths);
    assert.equal(blocks.length, depths.length);
    assert.equal(new Set(blocks.map((block) => block.id)).size, blocks.length);
    assert.equal(blocks.every((block) => block.collapsed === false), true);
  }

  const pasted = probe.outlineBlocksFromPastedText("    Parent\n      Child\n        Grandchild", 5);
  assert.deepEqual(pasted.map((block) => block.depth), [5, 6, 7]);
});

test("generated PE runtime Text-to-Outline-to-Text round trips preserve hierarchy with two-space projection", () => {
  const factory = loadRuntimeFactory();
  const { probe } = runtimeProbe(factory, { id: "round_trip", title: "Round trip", body: "", mode: "text", outline: null });
  const inputs = [
    "Parent\n  Child\n    Grandchild",
    "Parent\n    Child\n        Grandchild",
    "Parent\n\tChild\n\t\tGrandchild",
    "Parent\n\tChild\n\t  Grandchild",
    "    Parent\n      Child\n        Grandchild",
  ];
  const canonical = "Parent\n  Child\n    Grandchild";
  for (const input of inputs) {
    const first = probe.textToOutline(input);
    const projected = probe.outlineToText(first);
    const second = probe.textToOutline(projected);
    assert.equal(projected, canonical);
    assert.deepEqual(second.map((block) => ({ text: block.text, depth: block.depth })), first.map((block) => ({ text: block.text, depth: block.depth })));
  }
});

test("generated PE runtime renders one fresh blank row for empty or whitespace-only Text", () => {
  const factory = loadRuntimeFactory();
  const { probe } = runtimeProbe(factory, { id: "empty_runtime", title: "Empty", body: "", mode: "text", outline: null });
  assert.deepEqual(probe.textToOutline(" \n\t "), []);
  const pane = fakeElement("section");
  const rendered = probe.renderEmptyOutline(pane);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].text, "");
  assert.equal(rendered[0].depth, 0);
  assert.equal(rendered[0].collapsed, false);
  assert.ok(rendered[0].id);
  assert.equal(pane.children.length, 1);
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
