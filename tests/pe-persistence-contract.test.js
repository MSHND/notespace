"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(__dirname, "fixtures", "pe-persistence");
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

function createBrowserContext() {
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
    location: { href: "https://example.test/index.html" },
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

function createCoreContext() {
  const context = createBrowserContext();
  loadScriptsInIndexOrder(context, CORE_INDEX_SCRIPTS);
  return context;
}

function createFullContractContext() {
  const context = createBrowserContext();
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

test("synthetic fixture inventory is compact and valid JSON", () => {
  const names = fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(names, FIXTURE_NAMES);
  for (const name of names) {
    const text = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
    assert.ok(text.length < 5000, `${name} should remain compact`);
    assert.doesNotThrow(() => JSON.parse(text));
  }
});

test("CURRENT-RISK: index load order leaves pocket-import.js as active normaliseNodes owner", () => {
  const context = createBrowserContext();
  const scripts = indexScriptSources();
  const requested = CORE_INDEX_SCRIPTS;
  assert.deepEqual(scripts.filter((script) => requested.includes(script)), requested);

  runScript(context, requested[0]);
  runScript(context, requested[1]);
  runScript(context, requested[2]);
  const metadataOwner = context.normaliseNodes;
  runScript(context, requested[3]);
  const preservingOwner = context.normaliseNodes;
  runScript(context, requested[4]);
  const storageOwner = context.normaliseNodes;
  runScript(context, requested[5]);
  const finalOwner = context.normaliseNodes;

  assert.notEqual(metadataOwner, preservingOwner);
  assert.equal(preservingOwner.__peImportPreserveWrapped, true);
  assert.equal(storageOwner, preservingOwner);
  assert.notEqual(finalOwner, preservingOwner);
  assert.equal(finalOwner.__peImportPreserveWrapped, undefined);
  assert.equal(context.__pocketPeImportPreserveInstalled, true);

  const raw = [syntheticNode("owner_probe", { details: "Fallback", editor: editorObjectAtLength(8001) })];
  const throughPreservingOwner = preservingOwner(raw)[0];
  const throughFinalOwner = finalOwner(raw)[0];
  assert.equal(throughPreservingOwner.editor.schema, "pocket.nodeEditor.v1");
  assert.equal(Object.hasOwn(throughFinalOwner, "editor"), false);

  const smallFutureEditor = { schema: "pocket.nodeEditor.v9", mode: "outline", outline: [{ text: "Future", depth: 1 }], futureField: true };
  const throughMetadataOwner = metadataOwner([syntheticNode("metadata_probe", { editor: smallFutureEditor })])[0];
  assert.deepEqual(plain(throughMetadataOwner.editor), smallFutureEditor);
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

test("CURRENT-RISK: editor and pe share the first-24 generic extras budget", () => {
  const context = createCoreContext();
  const crowded = syntheticNode("crowded");
  for (let index = 0; index < 24; index += 1) crowded[`extra${String(index).padStart(2, "0")}`] = index;
  crowded.editor = { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [{ text: "Kept?", depth: 1 }] };
  crowded.pe = { schema: "pocket.pe.v1", mode: "text", text: "Kept?" };
  const normalised = normaliseOne(context, crowded);
  assert.equal(Object.hasOwn(normalised, "editor"), false);
  assert.equal(Object.hasOwn(normalised, "pe"), false);

  const early = syntheticNode("early", {
    editor: { schema: "pocket.nodeEditor.v1", mode: "outline", outline: [{ text: "Early", depth: 1 }] },
    pe: { schema: "pocket.pe.v1", mode: "text", text: "Early" },
  });
  for (let index = 0; index < 24; index += 1) early[`extra${String(index).padStart(2, "0")}`] = index;
  const earlyNormalised = normaliseOne(context, early);
  assert.equal(earlyNormalised.editor.schema, "pocket.nodeEditor.v1");
  assert.equal(earlyNormalised.pe.schema, "pocket.pe.v1");
  assert.equal(Object.hasOwn(earlyNormalised, "extra22"), false);
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

test("CURRENT-RISK: active load drops editor metadata above the generic 8,000-character object cap", () => {
  const context = createCoreContext();
  const oversized = normaliseOne(context, syntheticNode("oversized_editor", {
    details: "Fallback remains",
    editor: editorObjectAtLength(8001),
  }));
  assert.equal(Object.hasOwn(oversized, "editor"), false);
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

test("active PE model rejects absent, Text, empty, blank, and malformed editor states", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const rejected = [
    undefined,
    null,
    "invalid",
    { mode: "text", outline: [{ text: "Text", depth: 1 }] },
    { mode: "outline", outline: [] },
    { mode: "outline", outline: [{ id: "blank", text: "", depth: 0, collapsed: false }] },
    { mode: "outline", outline: "invalid" },
  ];
  for (const value of rejected) assert.equal(model.normaliseEditorMeta(value), null);
  assert.ok(model.normaliseEditorMeta({ mode: "outline", outline: [{ text: "", depth: 0, collapsed: true }] }));
});

test("CURRENT-RISK: unknown Outline-like schema is accepted, rewritten as v1, and stripped of unknown fields", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta({
    schema: "pocket.nodeEditor.v9",
    mode: "outline",
    futureTopLevel: true,
    outline: [{ id: "future", text: "Future", depth: 1, collapsed: false, order: 77, futureBlockField: true }],
  });
  assert.equal(result.schema, "pocket.nodeEditor.v1");
  assert.deepEqual(Object.keys(result).sort(), ["mode", "outline", "schema"]);
  assert.deepEqual(Object.keys(result.outline[0]).sort(), ["collapsed", "depth", "id", "order", "text"]);
  assert.equal(result.outline[0].order, 1);
});

test("active PE model generates a missing block ID", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta({ mode: "outline", outline: [{ text: "Needs ID", depth: 0 }] });
  assert.equal(typeof result.outline[0].id, "string");
  assert.ok(result.outline[0].id.length > 0);
  assert.ok(result.outline[0].id.length <= 80);
});

test("CURRENT-RISK: active PE model retains duplicate non-empty block IDs", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta({
    mode: "outline",
    outline: [
      { id: "duplicate", text: "First", depth: 0 },
      { id: "duplicate", text: "Second", depth: 1 },
    ],
  });
  assert.deepEqual(plain(result.outline.map((block) => block.id)), ["duplicate", "duplicate"]);
});

test("active PE model clamps depths, rounds fractions, truncates IDs, and regenerates order", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta({
    mode: "outline",
    outline: [
      { id: "a".repeat(81), text: "Low", depth: -2, order: 99, unknown: true },
      { id: "fraction", text: "Fraction", depth: 1.6, collapsed: "true", order: 3 },
      { id: "high", text: "High", depth: 99, order: -7 },
    ],
  });
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
    assert.equal(model.normaliseEditorMeta({ mode: "outline", outline }).outline.length, count);
  }
});

test("CURRENT-RISK: Outline normalisation silently slices block 401", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const outline = Array.from({ length: 401 }, (_, index) => ({ id: `b_${index}`, text: `Block ${index}`, depth: index ? 1 : 0 }));
  const result = model.normaliseEditorMeta({ mode: "outline", outline });
  assert.equal(result.outline.length, 400);
  assert.equal(result.outline[399].id, "b_399");
  assert.equal(result.outline.some((block) => block.id === "b_400"), false);
});

test("active PE model retains block text at 3,999 and 4,000 characters", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  for (const length of [3999, 4000]) {
    const result = model.normaliseEditorMeta({ mode: "outline", outline: [{ id: `text_${length}`, text: "x".repeat(length), depth: 0 }] });
    assert.equal(result.outline[0].text.length, length);
  }
});

test("CURRENT-RISK: Outline normalisation silently slices block text at 4,001 characters", () => {
  const model = createFullContractContext().PocketNodePopoutModel;
  const result = model.normaliseEditorMeta({ mode: "outline", outline: [{ id: "oversized_text", text: "x".repeat(4001), depth: 0 }] });
  assert.equal(result.outline[0].text.length, 4000);
});

test("native Outline payload preserves accepted IDs, depths, collapse state, and independent details", () => {
  const context = createFullContractContext();
  const node = fixture("current-outline-v1.json").mainThoughtTree[0];
  resetState(context, [node]);
  const payload = context.PocketNodePopoutModel.buildPayload(node);
  assert.equal(payload.mode, "outline");
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

test("CURRENT-RISK: small malformed and unknown editor objects survive load but PE interprets only their shape", () => {
  const malformed = loadAndExportFixture("malformed-editor.json");
  assert.equal(malformed.state.nodes[0].editor.fixtureMarker, true);
  assert.equal(malformed.context.PocketNodePopoutModel.buildPayload(malformed.state.nodes[0]).mode, "text");
  assert.equal(malformed.payload.mainThoughtTree[0].editor.outline, "not-an-array");

  const unknown = loadAndExportFixture("unknown-editor-schema.json");
  assert.equal(unknown.state.nodes[0].editor.schema, "pocket.nodeEditor.v9");
  const openingPayload = unknown.context.PocketNodePopoutModel.buildPayload(unknown.state.nodes[0]);
  assert.equal(openingPayload.mode, "outline");
  assert.equal(openingPayload.outline[0].id, "fixture_future_block");
  assert.equal(openingPayload.outline[0].order, 1);
  assert.equal(unknown.payload.mainThoughtTree[0].editor.schema, "pocket.nodeEditor.v9");
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
