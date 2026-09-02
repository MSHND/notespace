"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "js/pocket-state.js",
  "js/pocket-data.js",
  "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js",
  "js/pocket-import.js",
  "js/pocket-starling-owner-working-set-shadow.js",
  "js/pocket-history-status.js",
  "js/pocket-io-browser.js",
];

function source(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function runtime() {
  const storage = new Map();
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, Error, Function, Reflect,
    JSON, Date, Promise, URL, Blob, structuredClone,
    localStorage: {
      getItem(key) { return storage.get(String(key)) || null; },
      setItem(key, value) { storage.set(String(key), String(value)); },
      removeItem(key) { storage.delete(String(key)); },
    },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} },
      readyState: "complete", getElementById() { return null; }, querySelector() { return null; },
      querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {},
      createElement() { return { click() {}, remove() {} }; },
    },
    navigator: { clipboard: {} }, location: { href: "https://p160.test" }, indexedDB: null,
    setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, open() { return null; }, close() {}, confirm() { return true; },
    HTMLElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLButtonElement: class {},
    console: { log() {}, info() {}, warn() {}, error() {} },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of FILES) vm.runInContext(source(file), context, { filename: file });
  context.refreshMeta = () => {};
  context.renderTree = () => {};
  context.refocusTreeNavigation = () => {};
  context.persistPipSnapshot = () => {};
  context.setStatus = () => {};
  context.flashSaveChip = () => {};
  context.clearConflictGuard = () => {};
  context.clearLocalSafetySnapshot = () => {};
  context.saveLocalSafetySnapshot = () => true;
  context.markSavedNow = () => {};
  context.establishPocketDocumentBaseline = () => {};
  context.hasUnsavedDetailsEditorChanges = () => false;
  context.hasUnsavedInlineTitleDraft = () => false;
  context.isPocketFilePermissionPromptOpen = () => false;
  context.showPocketFileGatePrompt = () => {};
  context.canModifyPocket = () => true;
  context.isPocketFileSaveSessionCurrent = () => true;
  context.capturePocketFileSaveSession = () => ({ id: 160, ownerKind: "synced", writable: true });
  context.isPocketEditorSourceIdentityCurrent = () => true;
  context.hasPocketUnsavedChanges = () => true;
  context.PocketOwnerSaveBoundary = { save: null };
  vm.runInContext(`
    state.nodes = [
      { id: "one", parentId: "root", order: 0, label: "Before" },
      { id: "two", parentId: "root", order: 1, label: "Second" },
    ];
    state.tombstones = [{ id: "gone", retained: { stable: true } }];
    state.rootExtras = { rootFuture: { value: "root" } };
    state.dataExtras = { dataFuture: { value: "data" } };
    state.ops = [{ type: "covered", seq: 1, at: "2026-09-03T00:00:00.000Z" }];
    state.operationHighWater = 1;
    state.operationDocumentAnchor = null;
    state.activeSaveOperationCeiling = 0;
    state.source = { schema: "portal.mtt.web.v1", fileName: "p160.json", writtenAt: "" };
  `, context);
  return context;
}

function appendCoveredCapture(context) {
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(1, [
    { type: "payload", input: { nodeId: "one", payload: { label: "Before" } } },
    { type: "reorder", input: { nodeId: "one", fromIndex: 0, toIndex: 0 } },
  ]), true);
}

function appendSecondCoveredCapture(context) {
  const state = vm.runInContext("state", context);
  state.ops.push({ type: "covered-second", seq: 2, at: "2026-09-03T00:01:00.000Z" });
  state.operationHighWater = 2;
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(2, [
    { type: "payload", input: { nodeId: "two", payload: { label: "Second" } } },
  ]), true);
}

function p160Payload(context) {
  const state = vm.runInContext("state", context);
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-09-03T01:02:03.000Z",
    rootFuture: plain(state.rootExtras.rootFuture),
    data: {
      dataFuture: plain(state.dataExtras.dataFuture),
      mainThoughtTree: plain(state.nodes),
      mainThoughtTreeTombstones: plain(state.tombstones),
    },
  };
}

test("P160 freezes one payload and P148 working set before a delayed owner observes a later edit", async () => {
  const context = runtime();
  appendCoveredCapture(context);
  appendSecondCoveredCapture(context);
  let builds = 0;
  let builtPayload = null;
  context.buildPocketPayload = () => {
    builds += 1;
    builtPayload = p160Payload(context);
    return builtPayload;
  };
  let ownerPayload = null;
  context.PocketOwnerSaveBoundary.save = async ({ freezePayload }) => {
    const state = vm.runInContext("state", context);
    state.nodes[0].label = "After";
    state.ops.push({ type: "later", seq: 3, at: "2026-09-03T01:03:00.000Z" });
    state.operationHighWater = 3;
    assert.equal(context.capturePocketStarlingOwnerWorkingOperations(3, [
      { type: "payload", input: { nodeId: "one", payload: { label: "After" } } },
    ]), true);
    state.tombstones[0].retained.stable = false;
    state.tombstones.push({ id: "later-gone", retained: { stable: "later" } });
    state.rootExtras.rootFuture.value = "later-root";
    state.dataExtras.dataFuture.value = "later-data";
    ownerPayload = freezePayload();
    assert.strictEqual(ownerPayload, builtPayload);
    return { ok: true, target: "synced" };
  };

  const result = await context.exportTree({ returnDetails: true });
  assert.equal(result.ok, true);
  assert.equal(builds, 1);
  assert.equal(ownerPayload.data.mainThoughtTree[0].label, "Before");
  const preparation = context.currentPocketStarlingOwnerSavePreparation(ownerPayload);
  assert.ok(preparation);
  assert.deepEqual(Object.keys(preparation).sort(), ["ceiling", "operations", "preservationProjection"]);
  assert.equal(preparation.ceiling, 2);
  assert.deepEqual(plain(preparation.operations), [
    { type: "payload", input: { nodeId: "one", payload: { label: "Before" } } },
    { type: "reorder", input: { nodeId: "one", fromIndex: 0, toIndex: 0 } },
    { type: "payload", input: { nodeId: "two", payload: { label: "Second" } } },
  ]);
  assert.equal(preparation.operations.some((operation) => Object.hasOwn(operation, "seq")), false);
  const norm = context.normaliseInput(ownerPayload);
  assert.deepEqual(plain(preparation.preservationProjection), plain({
    source: { schema: norm.schema, writtenAt: norm.writtenAt },
    tombstones: norm.tombstones,
    rootExtras: norm.rootExtras,
    dataExtras: norm.dataExtras,
  }));
  assert.deepEqual(plain(preparation.preservationProjection.tombstones), [
    { id: "gone", retained: { stable: true } },
  ]);
  assert.equal(preparation.preservationProjection.rootExtras.rootFuture.value, "root");
  assert.equal(preparation.preservationProjection.dataExtras.dataFuture.value, "data");
  assert.equal(Object.hasOwn(preparation.preservationProjection, "nodes"), false);
  const state = vm.runInContext("state", context);
  assert.equal(state.nodes[0].label, "After");
  assert.deepEqual(plain(state.tombstones), [
    { id: "gone", retained: { stable: false } },
    { id: "later-gone", retained: { stable: "later" } },
  ]);
  assert.equal(state.rootExtras.rootFuture.value, "later-root");
  assert.equal(state.dataExtras.dataFuture.value, "later-data");
  assert.deepEqual(plain(state.ops.map((operation) => operation.seq)), [3]);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(3).operations), [
    { type: "payload", input: { nodeId: "one", payload: { label: "After" } } },
  ]);
  assert.equal(context.currentPocketStarlingOwnerSavePreparation(plain(ownerPayload)), null);
  const altered = context.currentPocketStarlingOwnerSavePreparation(ownerPayload);
  altered.operations[0].input.payload.label = "caller-only";
  altered.preservationProjection.rootExtras.rootFuture.value = "caller-only";
  assert.equal(context.currentPocketStarlingOwnerSavePreparation(ownerPayload).operations[0].input.payload.label, "Before");
  assert.equal(context.currentPocketStarlingOwnerSavePreparation(ownerPayload).preservationProjection.rootExtras.rootFuture.value, "root");
  assert.equal(JSON.stringify(ownerPayload).includes("preservationProjection"), false);
});

test("P160 prepares an empty but valid P148 working set at a positive Save ceiling", async () => {
  const context = runtime();
  let builds = 0;
  let ownerPayload = null;
  context.buildPocketPayload = () => { builds += 1; return p160Payload(context); };
  context.PocketOwnerSaveBoundary.save = async ({ freezePayload }) => {
    ownerPayload = freezePayload();
    return { ok: true, target: "synced" };
  };

  const result = await context.exportTree({ returnDetails: true });
  assert.equal(result.ok, true);
  assert.equal(builds, 1);
  const preparation = context.currentPocketStarlingOwnerSavePreparation(ownerPayload);
  assert.ok(preparation);
  assert.equal(preparation.ceiling, 1);
  assert.deepEqual(plain(preparation.operations), []);
  const norm = context.normaliseInput(ownerPayload);
  assert.deepEqual(plain(preparation.preservationProjection), plain({
    source: { schema: norm.schema, writtenAt: norm.writtenAt },
    tombstones: norm.tombstones,
    rootExtras: norm.rootExtras,
    dataExtras: norm.dataExtras,
  }));
  assert.equal(context.currentPocketStarlingOwnerSavePreparation(plain(ownerPayload)), null);
  assert.deepEqual(plain(vm.runInContext("state.ops", context)), []);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(1)), {
    ceiling: 1,
    operations: [],
  });
});

test("P160 leaves the authoritative Save and pending operations intact when preparation is unavailable or persistence fails", async () => {
  const unavailable = runtime();
  unavailable.PocketStarlingOwnerWorkingSetShadow = undefined;
  assert.equal(unavailable.resetPocketStarlingOwnerWorkingSetJournal(), false);
  let payload = null;
  unavailable.buildPocketPayload = () => p160Payload(unavailable);
  unavailable.PocketOwnerSaveBoundary.save = async ({ freezePayload }) => {
    payload = freezePayload();
    return { ok: true, target: "synced" };
  };
  assert.equal((await unavailable.exportTree({ returnDetails: true })).ok, true);
  assert.ok(payload);
  assert.equal(unavailable.currentPocketStarlingOwnerSavePreparation(payload), null);
  assert.deepEqual(plain(vm.runInContext("state.ops.map((operation) => operation.seq)", unavailable)), []);

  const failed = runtime();
  appendCoveredCapture(failed);
  let failedPayload = null;
  failed.buildPocketPayload = () => p160Payload(failed);
  failed.PocketOwnerSaveBoundary.save = async ({ freezePayload }) => {
    failedPayload = freezePayload();
    return { ok: false, reason: "persistence-failed" };
  };
  assert.equal((await failed.exportTree({ returnDetails: true, downloadFallback: false })).ok, false);
  assert.deepEqual(plain(vm.runInContext("state.ops.map((operation) => operation.seq)", failed)), [1]);
  assert.ok(failed.currentPocketStarlingOwnerSavePreparation(failedPayload));
  let retryPayload = null;
  failed.PocketOwnerSaveBoundary.save = async ({ freezePayload }) => {
    retryPayload = freezePayload();
    return { ok: true, target: "synced" };
  };
  assert.equal((await failed.exportTree({ returnDetails: true })).ok, true);
  assert.notEqual(retryPayload, failedPayload);
  assert.ok(failed.currentPocketStarlingOwnerSavePreparation(retryPayload));
});

test("P160 keeps the existing payload-freeze failure result and makes no Starling authority calls", async () => {
  const context = runtime();
  let calls = 0;
  context.buildPocketPayload = () => { calls += 1; throw new Error("existing freeze failure"); };
  context.PocketOwnerSaveBoundary.save = async ({ freezePayload }) => {
    try { freezePayload(); }
    catch { return { ok: false, reason: "payload-freeze-failed" }; }
    return { ok: false, reason: "unexpected" };
  };
  assert.equal((await context.exportTree({ returnDetails: true, downloadFallback: false })).reason, "payload-freeze-failed");
  assert.equal(calls, 1);
  const io = source("js/pocket-io-browser.js");
  assert.doesNotMatch(io, /LogicalEdit|RemoteEdit|RemoteSave|compareAndSetShadowHead|Storage\.write/);
});
