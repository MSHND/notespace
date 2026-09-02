"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");
const ROOT = path.resolve(__dirname, ".."), MODULE = "js/pocket-starling-owner-working-set-shadow.js", HISTORY = "js/pocket-history-status.js";

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function frozen(value) { return !value || typeof value !== "object" ? true : Object.isFrozen(value) && Object.keys(value).every((key) => frozen(value[key])); }

function runtime() {
  const safety = [], storage = new Map();
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON,
    state: {
      nodes: [{ id: "n1", parentId: "root", order: 0, label: "One" }], tombstones: [], rootExtras: {}, dataExtras: {},
      ops: [], operationHighWater: 0, operationDocumentAnchor: null, activeSaveOperationCeiling: 0,
      documentBaseline: null, source: { schema: "portal.export.v1", fileName: "p149", writtenAt: "" },
    },
    localStorage: { getItem(key) { return storage.get(String(key)) || null; }, setItem(key, value) { storage.set(String(key), String(value)); } },
    DEVICE_CHANGE_SEQUENCE_KEY: "p149.sequence",
    nowIso() { return "2026-09-02T05:00:00.000Z"; },
    cleanText(value) { return String(value || ""); },
    saveLocalSafetySnapshot(reason) { safety.push(reason); return true; },
    PocketDeviceChanges: {
      cloneJsonCompatible(value) { try { return { ok: true, value: plain(value) }; } catch { return { ok: false }; } },
      coerceDocument(value) { return { ok: true, document: plain({ nodes: value.nodes || [], tombstones: value.tombstones || [], rootExtras: value.rootExtras || {}, dataExtras: value.dataExtras || {} }) }; },
      describeDocumentTransition() { return { ok: true, records: [] }; },
    },
    __safety: safety,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [MODULE, HISTORY]) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  return context;
}

function record(context, type) { return context.recordOp({ type, note: `legacy-${type}` }); }

test("P149 loads the reviewed sidecar once before operation history without loading other dormant Starling modules", () => {
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), scripts = [...index.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1]), manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" }), worker = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.equal(scripts.filter((script) => script === MODULE).length, 1);
  assert.ok(scripts.indexOf(MODULE) + 1 === scripts.indexOf(HISTORY));
  assert.equal(manifest.some((entry) => entry.path === `/${MODULE}`), true);
  assert.equal(worker.includes(`./${MODULE}`), true);
  for (const file of ["pocket-starling-logical-edit-shadow.js", "pocket-starling-remote-open-shadow.js", "pocket-starling-remote-edit-shadow.js", "pocket-starling-remote-save-shadow.js", "pocket-starling-storage-shadow.js"]) assert.equal(scripts.includes(`js/${file}`), false, file);
});

test("P149 preserves ordinary recordOp behaviour and leaves the sidecar empty until direct capture", () => {
  const context = runtime(), entry = record(context, "ordinary");
  assert.equal(context.recordOp.length, 1);
  assert.equal(entry.seq, 1);
  assert.equal(context.state.ops.length, 1);
  assert.equal(context.state.operationDocumentAnchor.nodes[0].id, "n1");
  assert.deepEqual(context.__safety, ["ordinary"]);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(entry.seq)), { ceiling: 1, operations: [] });
});

test("P149 directly bridges detached frozen working material and same-sequence replacement", () => {
  const context = runtime(), entry = record(context, "bridge"), before = plain(context.state.ops);
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(entry.seq, [{ arbitrary: { value: "first" } }]), true);
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(entry.seq, [{ arbitrary: { value: "replacement" } }, { later: [1, 2] }]), true);
  const frozenSnapshot = context.freezePocketStarlingOwnerWorkingSetThrough(entry.seq);
  assert.deepEqual(plain(frozenSnapshot), { ceiling: entry.seq, operations: [{ arbitrary: { value: "replacement" } }, { later: [1, 2] }] });
  assert.equal(frozen(frozenSnapshot), true);
  assert.equal(frozenSnapshot.operations.some((operation) => Object.hasOwn(operation, "seq")), false);
  assert.deepEqual(plain(context.state.ops), before);
});

test("P149 mirrors retain and discard only after the current operation lifecycle succeeds", () => {
  const context = runtime(), first = record(context, "one"), second = record(context, "two"), third = record(context, "three");
  for (const entry of [first, second, third]) assert.equal(context.capturePocketStarlingOwnerWorkingOperations(entry.seq, [{ marker: entry.type }]), true);
  assert.equal(context.retainPocketOperationsAfterSequence(second.seq), 1);
  assert.deepEqual(context.state.ops.map((entry) => entry.seq), [third.seq]);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(third.seq).operations), [{ marker: "three" }]);
  assert.equal(context.retainPocketOperationsAfterSequence(0), 1);
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(third.seq, [{ marker: "discard" }]), true);
  assert.equal(context.discardPocketOperationSequence(third.seq), true);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(third.seq).operations), []);
  const covered = record(context, "covered");
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(covered.seq, [{ marker: "covered" }]), true);
  context.state.activeSaveOperationCeiling = covered.seq;
  assert.equal(context.discardPocketOperationSequence(covered.seq), false);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(covered.seq).operations), [{ marker: "covered" }]);
});

test("P149 adoption resets the journal while an anchor refresh leaves it intact", () => {
  const context = runtime(), entry = record(context, "anchor");
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(entry.seq, [{ marker: "survives-anchor" }]), true);
  assert.equal(context.resetPocketOperationAnchor(), true);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(entry.seq).operations), [{ marker: "survives-anchor" }]);
  const adopted = context.adoptPocketOperations([{ type: "adopted", seq: 40, at: "2026-09-02T05:00:00.000Z" }], 40);
  assert.deepEqual(adopted.operations.map((operation) => operation.seq), [40]);
  assert.deepEqual(context.state.ops.map((operation) => operation.seq), [40]);
  assert.deepEqual(plain(context.freezePocketStarlingOwnerWorkingSetThrough(40)), { ceiling: 40, operations: [] });
});

test("P149 shadow failure is observational and does not create fallback history material", () => {
  const context = runtime(), initial = record(context, "before-failure");
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(initial.seq, [{ marker: "existing" }]), true);
  context.PocketStarlingOwnerWorkingSetShadow = undefined;
  assert.equal(context.resetPocketStarlingOwnerWorkingSetJournal(), false);
  assert.equal(context.capturePocketStarlingOwnerWorkingOperations(initial.seq + 1, [{ marker: "blocked" }]), false);
  assert.equal(context.freezePocketStarlingOwnerWorkingSetThrough(initial.seq + 1), null);
  const next = record(context, "after-failure");
  assert.equal(next.seq, initial.seq + 1);
  assert.deepEqual(context.state.ops.map((entry) => entry.type), ["before-failure", "after-failure"]);
  assert.deepEqual(context.__safety, ["before-failure", "after-failure"]);
  assert.equal(context.retainPocketOperationsAfterSequence(initial.seq), 1);
  assert.deepEqual(context.state.ops.map((entry) => entry.type), ["after-failure"]);
  assert.equal(JSON.stringify(context.state.ops).includes("blocked"), false);
});
