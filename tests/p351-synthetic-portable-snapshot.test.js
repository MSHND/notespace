"use strict";

// P351: synthetic compatibility evidence only. No production export, persistence,
// authenticated-Head claim, browser download, or external service is introduced.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const DATE = "2026-10-10T00:00:00.000Z";
const CODEC = [
  "js/pocket-state.js", "js/pocket-data.js",
  "js/pocket-outline-persistence-policy.js", "js/pocket-node-content.js", "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js", "js/pocket-storage.js", "js/pocket-import.js",
];
const STARLING = [
  "js/pocket-starling-shadow.js", "js/pocket-starling-sequence-shadow.js",
  "js/pocket-starling-placement-shadow.js", "js/pocket-starling-bridge-shadow.js",
  "js/pocket-starling-root-shadow.js", "js/pocket-starling-object-seal-shadow.js",
  "js/pocket-starling-materialize-shadow.js",
];
const clone = (value) => JSON.parse(JSON.stringify(value));
const run = (c, source) => vm.runInContext(source, c);
function runtime(withStarling) {
  const c = {
    URL, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Object, Array, String,
    Number, Boolean, Promise, Error,
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: {
      getItem() { return null; },
      setItem() { throw Error("unexpected local write"); },
      removeItem() { throw Error("unexpected local deletion"); },
    },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() { return null; }, addEventListener() {},
      createElement() { throw Error("unexpected download"); },
    },
    navigator: { clipboard: {} },
    location: { href: "https://synthetic-p351.invalid" },
    indexedDB: null,
    fetch() { throw Error("unexpected remote access"); },
    showSaveFilePicker() { throw Error("unexpected file picker"); },
    open() { throw Error("unexpected window"); },
    close() {},
    setTimeout() { throw Error("unexpected background work"); },
    clearTimeout() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of [...CODEC, ...(withStarling ? STARLING : [])]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, { filename: file });
  }
  return c;
}
function invoke(c, expression, argument) {
  c.__p351Argument = argument;
  try { return run(c, expression); }
  finally { delete c.__p351Argument; }
}
function representative() {
  return {
    schema: "portal.mtt.web.v1", writtenAt: DATE,
    nodes: [
      {
        id: "anchor", parentId: "root", order: 0,
        label: "Anchor", source: "manual", updatedAt: DATE,
        details: "A readable sentence.\nAnother line.", urgent: true,
        editor: {
          schema: "pocket.nodeEditor.v1", mode: "outline",
          outline: [
            { id: "line-1", text: "Nested 🦜", depth: 0, collapsed: false },
            { id: "line-2", text: "Second level", depth: 1, collapsed: true },
          ],
        },
        futureNode: { alpha: [1, "kept", null], enabled: true },
      },
      {
        id: "sibling", parentId: "root", order: 1,
        label: "Sibling", source: "manual", updatedAt: DATE,
        customText: "preserve exactly",
      },
      {
        id: "child-a", parentId: "anchor", order: 0,
        label: "First child", source: "import", updatedAt: DATE,
        details: "Child details", status: { completed: true, completedAt: DATE },
      },
      {
        id: "child-b", parentId: "anchor", order: 1,
        label: "Second child", source: "manual", updatedAt: DATE,
        customNumber: 42,
      },
      {
        id: "grandchild", parentId: "child-a", order: 0,
        label: "Grandchild", source: "manual", updatedAt: DATE,
        futureFlag: false,
      },
    ],
    tombstones: [{ id: "deleted-synthetic", deletedAt: DATE, futureRetention: { exact: true } }],
    rootExtras: { futureRoot: { revision: 7, labels: ["alpha", "beta"] }, rootFlag: true },
    dataExtras: { futureData: { origin: "disposable", nested: [1, null, false] }, dataFlag: 11 },
  };
}

// Existing production codec owners: normaliseInput intentionally returns
// dataExtras:null for top-level mainThoughtTree. Historical P164/P172 compose
// normaliseRootExtras(payload.data) to retain it. This proof does the same.
function decodeWithExistingImport(c, json) {
  const parsed = JSON.parse(json);
  if (parsed.schema !== "portal.export.v1"
      || parsed.writtenAt !== DATE || parsed.exportedAt !== DATE
      || !Array.isArray(parsed.mainThoughtTree)
      || !Array.isArray(parsed.data?.mainThoughtTree)
      || !Array.isArray(parsed.mainThoughtTreeTombstones)
      || !Array.isArray(parsed.data?.mainThoughtTreeTombstones)
      || JSON.stringify(parsed.mainThoughtTree) !== JSON.stringify(parsed.data.mainThoughtTree)
      || JSON.stringify(parsed.mainThoughtTreeTombstones) !== JSON.stringify(parsed.data.mainThoughtTreeTombstones)) {
    throw Error("ambiguous-portable-representation");
  }
  const norm = invoke(c, "normaliseInput(__p351Argument)", parsed);
  const dataExtras = invoke(c, "normaliseRootExtras(__p351Argument)", parsed.data) || {};
  return clone({
    schema: norm.schema, writtenAt: norm.writtenAt, nodes: norm.nodes,
    tombstones: norm.tombstones, rootExtras: norm.rootExtras || {}, dataExtras,
  });
}
function expectedFromMaterialised(document) {
  return clone({
    schema: "portal.export.v1", writtenAt: DATE,
    nodes: document.nodes, tombstones: document.tombstones,
    rootExtras: document.rootExtras, dataExtras: document.dataExtras,
  });
}
function assertLossless(expected, imported) {
  assert.deepStrictEqual(imported, expected, "unsupported or altered semantic material");
}

function syntheticFixture(c, document = representative()) {
  const bridge = c.PocketStarlingBridgeShadow.encode(document, { capacity: 4 });
  if (!bridge.ok) throw Error("invalid-synthetic-bridge:" + bridge.reason);
  const root = c.PocketStarlingRootShadow.build(bridge.bridge);
  if (!root.ok) throw Error("invalid-synthetic-root:" + root.reason);
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const staged = c.PocketStarlingObjectSealShadow.stageCandidate(stager, root.state,
    { previousSealRef: null });
  if (!staged.ok) throw Error("invalid-synthetic-seal:" + staged.reason);
  const audit = c.PocketStarlingObjectSealShadow.auditCandidateSeal(
    staged.stage.sealRef, (ref) => stager.store.get(ref));
  if (!audit.ok) throw Error("invalid-synthetic-object-graph:" + audit.reason);
  const present = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(
    staged.stage, (ref) => stager.store.has(ref));
  if (!present.ok) throw Error("incomplete-synthetic-object-graph:" + present.reason);
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const readLog = [];
  const session = {
    acceptedSealRef: staged.stage.sealRef,
    async resolveLogical(ref) {
      readLog.push("logical");
      return stager.store.get(ref);
    },
    async readPlacement(nodeId) {
      readLog.push("placement");
      const node = byId.get(nodeId);
      return node ? { ok: true, nodeId, parentId: node.parentId } : { ok: false };
    },
    async readContent(nodeId) {
      readLog.push("content");
      const node = byId.get(nodeId);
      if (!node) return { ok: false };
      const payload = clone(node);
      delete payload.id; delete payload.parentId; delete payload.order;
      return { ok: true, nodeId, payload };
    },
  };
  // A test witness bound to one fixture, NOT a trusted real-world Head grant.
  const syntheticHead = Object.freeze({
    schema: "pocket.starling.head.v1", revision: 1,
    sealRef: staged.stage.sealRef, syntheticOnly: true,
  });
  return { c, stager, staged, audit, syntheticHead, session, readLog };
}
async function produceSnapshot(fixture, options = {}) {
  const { c, session, syntheticHead, staged } = fixture;
  const observedHead = options.head || syntheticHead;
  if (observedHead.syntheticOnly !== true
      || observedHead.schema !== "pocket.starling.head.v1"
      || observedHead.revision !== 1
      || observedHead.sealRef !== staged.stage.sealRef
      || session.acceptedSealRef !== observedHead.sealRef) {
    throw Error("synthetic-accepted-state-unbound");
  }
  const materialised = await c.PocketStarlingMaterializeShadow.materializeAccepted(
    options.session || session);
  if (!materialised.ok) throw Error("materialisation-rejected:" + materialised.reason);
  const document = clone(materialised.document);
  const result = invoke(c,
    "buildPortablePocketSnapshot(__p351Argument, {writtenAt:'" + DATE + "'})",
    document);
  if (!result.ok) throw Error("unsupported or altered semantic material: " + result.reason);
  const json = result.json;
  // Independently reconstruct with the existing import contract, in addition
  // to the checks now enforced by the production-owned pure helper.
  assertLossless(expectedFromMaterialised(document), decodeWithExistingImport(c, json));
  return { json, materialised: document, expected: expectedFromMaterialised(document) };
}

test("P351 canonical synthetic Head/Seal exports and independently reconstructs every meaningful field", async () => {
  const writer = runtime(true);
  const fixture = syntheticFixture(writer);
  const first = await produceSnapshot(fixture);
  const second = await produceSnapshot(fixture);
  assert.equal(first.json, second.json, "fixed-time portable snapshot must be deterministic");
  assert.equal(JSON.parse(first.json).schema, "portal.export.v1");
  assert.equal(first.materialised.nodes.length, 5);
  assert.deepEqual(first.materialised.nodes.map((n) => [n.id, n.parentId, n.order]), [
    ["anchor", "root", 0], ["child-a", "anchor", 0],
    ["grandchild", "child-a", 0], ["child-b", "anchor", 1], ["sibling", "root", 1],
  ]);
  assert.deepEqual(first.materialised.rootExtras, representative().rootExtras);
  assert.deepEqual(first.materialised.dataExtras, representative().dataExtras);
  assert.deepEqual(first.materialised.tombstones, representative().tombstones);
  assert.deepEqual(first.materialised.nodes[0].editor, representative().nodes[0].editor);
  assert.ok(fixture.readLog.includes("logical"));
  assert.ok(fixture.readLog.includes("content"));
  assert.ok(fixture.readLog.includes("placement"));
  // Starling modules, object stores, services and runtime references are absent.
  const independent = runtime(false);
  assert.equal(independent.PocketStarlingMaterializeShadow, undefined);
  assert.equal(independent.PocketStarlingObjectSealShadow, undefined);
  const imported = decodeWithExistingImport(independent, first.json);
  assertLossless(first.expected, imported);
  const rebuilt = invoke(independent,
    "buildCanonicalPocketPayload(__p351Argument, {writtenAt:'" + DATE + "'})",
    imported);
  assert.deepStrictEqual(clone(rebuilt), JSON.parse(first.json), "standalone rebuild must preserve complete JSON meaning");
});

test("P351 proves existing top-level import needs explicit nested dataExtras composition", async () => {
  const snapshot = await produceSnapshot(syntheticFixture(runtime(true)));
  const fresh = runtime(false);
  const parsed = JSON.parse(snapshot.json);
  const partial = invoke(fresh, "normaliseInput(__p351Argument)", parsed);
  assert.equal(partial.dataExtras, null, "known top-level normaliseInput behaviour");
  assert.deepEqual(decodeWithExistingImport(fresh, snapshot.json).dataExtras,
    snapshot.materialised.dataExtras);
});

test("P351 rejects absent, damaged and contradictory synthetic objects without emitting partial JSON", async () => {
  const f = syntheticFixture(runtime(true));
  const seal = JSON.parse(f.stager.store.get(f.syntheticHead.sealRef));
  const root = JSON.parse(f.stager.store.get(seal.rootRef));
  for (const session of [
    { ...f.session, resolveLogical: (ref) => ref === root.preservationRef
      ? undefined : f.session.resolveLogical(ref) },
    { ...f.session, resolveLogical: (ref) => ref === root.childrenRef
      ? "corrupted logical bytes" : f.session.resolveLogical(ref) },
    { ...f.session, readPlacement: (id) => id === "anchor"
      ? { ok: true, nodeId: id, parentId: "wrong" } : f.session.readPlacement(id) },
    { ...f.session, readContent: (id) => id === "grandchild"
      ? { ok: false } : f.session.readContent(id) },
  ]) {
    await assert.rejects(produceSnapshot(f, { session }), /materialisation-rejected/);
  }
});

test("P351 rejects cyclic/duplicate identity and incomplete accepted-state evidence", async () => {
  const c = runtime(true);
  const dup = representative();
  dup.nodes.push({ ...dup.nodes[0], label: "Duplicate" });
  assert.throws(() => syntheticFixture(c, dup), /invalid-synthetic-/);
  const cyclic = representative();
  cyclic.nodes.find((x) => x.id === "anchor").parentId = "grandchild";
  assert.throws(() => syntheticFixture(c, cyclic), /invalid-synthetic-/);
  const f = syntheticFixture(c);
  await assert.rejects(produceSnapshot(f, { head: { ...f.syntheticHead, sealRef: "other" } }),
    /synthetic-accepted-state-unbound/);
  await assert.rejects(produceSnapshot(f, { head: { ...f.syntheticHead, syntheticOnly: false } }),
    /synthetic-accepted-state-unbound/);
  await assert.rejects(produceSnapshot(f, { session: { ...f.session, acceptedSealRef: "other" } }),
    /materialisation-rejected/);
});

test("P351 rejects unsupported loss, preserved-metadata corruption and ambiguous double tree", async () => {
  const unsupported = representative();
  unsupported.nodes[0].futureTextTooLong = "x".repeat(1201);
  await assert.rejects(produceSnapshot(syntheticFixture(runtime(true), unsupported)),
    /unsupported or altered semantic material/);
  const f = syntheticFixture(runtime(true));
  const snap = await produceSnapshot(f);
  const independent = runtime(false);
  const modified = JSON.parse(snap.json);
  modified.data.futureData.origin = "tampered";
  assert.throws(() => assertLossless(snap.expected,
    decodeWithExistingImport(independent, JSON.stringify(modified))),
  /unsupported or altered semantic material/);
  const ambiguous = JSON.parse(snap.json);
  ambiguous.data.mainThoughtTree[0].label = "different duplicate";
  assert.throws(() => decodeWithExistingImport(independent, JSON.stringify(ambiguous)),
    /ambiguous-portable-representation/);
  const wrongRevision = JSON.parse(snap.json);
  wrongRevision.exportedAt = "2026-10-11T00:00:00.000Z";
  assert.throws(() => decodeWithExistingImport(independent, JSON.stringify(wrongRevision)),
    /ambiguous-portable-representation/);
});


test("P352 pure owner works directly on materialised in-memory Pocket data", async () => {
  const f = syntheticFixture(runtime(true));
  const materialised = await f.c.PocketStarlingMaterializeShadow.materializeAccepted(f.session);
  assert.equal(materialised.ok, true);
  const input = clone(materialised.document);
  const original = clone(input);
  const first = invoke(f.c,
    "buildPortablePocketSnapshot(__p351Argument,{writtenAt:'" + DATE + "'})", input);
  const second = invoke(f.c,
    "buildPortablePocketSnapshot(__p351Argument,{writtenAt:'" + DATE + "'})", input);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepStrictEqual(clone(first), clone(second));
  assert.deepStrictEqual(input, original, "pure contract must not mutate input");
  const offline = runtime(false);
  assertLossless(expectedFromMaterialised(input), decodeWithExistingImport(offline, first.json));
  assert.equal(offline.PocketStarlingMaterializeShadow, undefined);
});

test("P352 pure owner rejects ambiguous, truncated and malformed inputs without JSON", () => {
  const c = runtime(false);
  const base = representative();
  // A fixed-time pure helper must reject incomplete, unsupported and lossy inputs.
  const apply = (modify) => {
    const input = clone(base);
    modify(input);
    const output = invoke(c,
      "buildPortablePocketSnapshot(__p351Argument,{writtenAt:'" + DATE + "'})", input);
    assert.equal(output.ok, false, "invalid input unexpectedly exported");
    assert.deepStrictEqual(Object.keys(output).sort(), ["ok", "reason"]);
  };
  apply((x) => { delete x.dataExtras; });
  apply((x) => { x.dataExtras.futureData.nested = ["x".repeat(12001)]; });
  apply((x) => { x.nodes[0].futureNode = "x".repeat(1201); });
  apply((x) => { x.nodes[0].label = "x".repeat(221); });
  apply((x) => { x.nodes.push({ ...x.nodes[0] }); });
  apply((x) => { x.nodes.find(n => n.id === "anchor").parentId = "grandchild"; });
  apply((x) => { x.nodes.find(n => n.id === "grandchild").parentId = "missing"; });
  apply((x) => { x.nodes.find(n => n.id === "sibling").order = 0; });
  apply((x) => { x.rootExtras.schema = "future.schema"; });
  // Opaque editor material is intentionally retained by the current import
  // contract; large supported editor content must not be rejected arbitrarily.
  const supportedEditor = clone(base);
  supportedEditor.nodes[0].editor.outline[0].text = "x".repeat(9000);
  const supported = invoke(c,
    "buildPortablePocketSnapshot(__p351Argument,{writtenAt:'" + DATE + "'})",
    supportedEditor);
  assert.equal(supported.ok, true, JSON.stringify(supported));
  assert.equal(decodeWithExistingImport(runtime(false), supported.json)
    .nodes[0].editor.outline[0].text.length, 9000);
  apply((x) => { x.nodes[0].newField = undefined; });
  apply((x) => { x.writtenAt = "2026-10-11T00:00:00.000Z"; });
  const invalidTime = invoke(c,
    "buildPortablePocketSnapshot(__p351Argument,{writtenAt:'invalid'})", clone(base));
  assert.equal(invalidTime.ok, false);
  assert.deepStrictEqual(Object.keys(invalidTime).sort(), ["ok", "reason"]);
});

test("P351 remains purely a synthetic, memory-only compatibility proof", async () => {
  const f = syntheticFixture(runtime(true));
  const original = clone(representative());
  await produceSnapshot(f);
  assert.deepEqual(representative(), original);
  assert.equal(f.readLog.every((action) => ["logical", "content", "placement"].includes(action)), true);
  assert.equal(f.readLog.length > 0, true);
  assert.equal(f.c.PocketSyncRemoteClient, undefined, "no remote service exists in the proof runtime");
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
    .includes("p351-synthetic-portable-snapshot"), false);
});
