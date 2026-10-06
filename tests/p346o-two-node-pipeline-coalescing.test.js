"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const OBJECT_SEAL = fs.readFileSync(path.join(ROOT, "js/pocket-starling-object-seal-shadow.js"), "utf8");
const MATERIALIZE = fs.readFileSync(path.join(ROOT, "js/pocket-starling-materialize-shadow.js"), "utf8");
const ADMISSION = fs.readFileSync(path.join(ROOT, "js/pocket-starling-real-truth-admission.js"), "utf8");
const STORAGE_SOURCE = fs.readFileSync(path.join(ROOT, "js/pocket-starling-storage-shadow.js"), "utf8");

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function waitUntil(predicate, label, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail("timed out waiting for " + label);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function logicalRuntime() {
  const context = {
    Object, Array, String, Number, Boolean, Map, Set, WeakMap, WeakSet, Error, Promise, JSON, Date,
    Math, RegExp, Uint8Array, TextEncoder, TextDecoder, ArrayBuffer, crypto: webcrypto,
    console: { log() {}, warn() {}, error() {} },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(OBJECT_SEAL, context, { filename: "js/pocket-starling-object-seal-shadow.js" });
  return context;
}

function put(logical, store, kind, object) {
  const encoded = logical.canonical(object);
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const ref = logical.refFor(kind, encoded.bytes);
  store.set(ref, encoded.bytes);
  return ref;
}

function trie(logical, store, kind, entries) {
  const root = { hasValue: false, valueRef: null, children: new Map() };
  for (const [key, valueRef] of entries) {
    let current = root;
    for (const character of key) {
      if (!current.children.has(character)) {
        current.children.set(character, { hasValue: false, valueRef: null, children: new Map() });
      }
      current = current.children.get(character);
    }
    current.hasValue = true;
    current.valueRef = valueRef;
  }
  function encode(node) {
    const children = [...node.children.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => ({ key, ref: encode(child) }));
    return put(logical, store, kind, {
      schema: logical.OBJECT_SCHEMA,
      kind,
      hasValue: node.hasValue,
      valueRef: node.hasValue ? node.valueRef : null,
      children,
    });
  }
  return encode(root);
}

function terminalTrieRef(store, rootRef, key) {
  let ref = rootRef;
  for (let index = 0; ; index += 1) {
    const object = JSON.parse(store.get(ref));
    if (index === key.length) return object.hasValue ? ref : null;
    const edge = object.children.find((item) => item.key === key[index]);
    if (!edge) return null;
    ref = edge.ref;
  }
}

function graph(context, overrides = {}) {
  const logical = context.PocketStarlingObjectSealShadow;
  const store = new Map();
  const ids = ["a", "b", "c", "d"];
  const parents = { a: "root", b: "a", c: "root", d: "root" };
  const placementRefs = new Map();
  const contentRefs = new Map();

  for (const nodeId of ids) {
    placementRefs.set(nodeId, put(logical, store, "placement-record", {
      schema: logical.OBJECT_SCHEMA,
      kind: "placement-record",
      nodeId,
      parentId: overrides.invalidPlacement === nodeId ? "wrong" : parents[nodeId],
    }));
    contentRefs.set(nodeId, put(logical, store, "content-record", {
      schema: logical.OBJECT_SCHEMA,
      kind: "content-record",
      nodeId,
      payload: overrides.invalidContent === nodeId ? null : { label: nodeId.toUpperCase() },
    }));
  }

  const placementRef = trie(logical, store, "placement-trie", placementRefs);
  const contentRef = trie(logical, store, "content-trie", contentRefs);
  function sequence(items) {
    return put(logical, store, "sequence-leaf", {
      schema: logical.SEQUENCE_SCHEMA,
      kind: "sequence-leaf",
      capacity: 4,
      count: items.length,
      items,
    });
  }
  const sequences = new Map([
    ["root", sequence(overrides.rootItems || ["a", "c", "d"])],
    ["a", sequence(overrides.aItems || ["b"])],
    ["b", sequence([])],
    ["c", sequence([])],
    ["d", sequence([])],
    ["bq", sequence([])],
    ["cr", sequence([])],
    ["ds", sequence([])],
  ]);
  const childrenRef = trie(logical, store, "children-trie", sequences);
  const childInfo = new Map();
  for (const nodeId of ids) {
    const ref = terminalTrieRef(store, childrenRef, nodeId);
    if (ref) childInfo.set(ref, { nodeId, member: "children" });
  }

  const preservationRef = put(logical, store, "preservation", {
    schema: logical.OBJECT_SCHEMA,
    kind: "preservation",
    value: {
      source: { schema: "portal.mtt.web.v1", writtenAt: "2048-03-03T00:00:00.000Z" },
      tombstones: [],
      rootExtras: {},
      dataExtras: {},
    },
  });
  const rootRef = put(logical, store, "pocket-root", {
    schema: logical.ROOT_SCHEMA,
    kind: "pocket-root",
    capacity: 4,
    contentRef,
    placementRef,
    childrenRef,
    preservationRef,
  });
  const sealRef = put(logical, store, "candidate-seal", {
    schema: logical.SEAL_SCHEMA,
    kind: "candidate-seal",
    rootRef,
    previousSealRef: null,
  });

  const recordInfo = new Map();
  for (const nodeId of ids) {
    recordInfo.set(placementRefs.get(nodeId), { nodeId, member: "placement" });
    recordInfo.set(contentRefs.get(nodeId), { nodeId, member: "content" });
  }

  return {
    logical,
    store,
    sealRef,
    parents,
    recordInfo,
    recordRefs: new Set(recordInfo.keys()),
    childInfo,
    expectedDocument: {
      schema: "portal.mtt.web.v1",
      writtenAt: "2048-03-03T00:00:00.000Z",
      nodes: [
        { id: "a", parentId: "root", order: 0, label: "A" },
        { id: "b", parentId: "a", order: 0, label: "B" },
        { id: "c", parentId: "root", order: 1, label: "C" },
        { id: "d", parentId: "root", order: 2, label: "D" },
      ],
      tombstones: [],
      rootExtras: {},
      dataExtras: {},
    },
  };
}

function materializeRuntime() {
  const context = logicalRuntime();
  vm.runInContext(MATERIALIZE, context, { filename: "js/pocket-starling-materialize-shadow.js" });
  return context;
}

function admissionRuntime() {
  const context = logicalRuntime();
  context.document = { currentScript: null };
  context.PocketSyncOwnerController = { createSyncedOwnerController() { return {}; } };
  context.PocketStarlingLogicalEditShadow = { async compose() { return { ok: true, changed: false, reason: "no-change" }; } };
  context.PocketStarlingRemoteEditShadow = { async createEditor() { return {}; } };
  context.PocketStarlingDurablePublication = {
    validateDescriptor(value) { return value; },
    createCoordinator() { return {}; },
  };
  context.PocketStarlingBridgeShadow = { encode() { return { ok: false }; } };
  context.PocketStarlingPlacementShadow = { audit() { return { ok: false }; } };
  context.PocketSyncRemoteClient = {
    createBrowserJsonTransport() { return {}; },
    createPersistenceAuthorityService() { return {}; },
  };
  context.PocketSyncCrypto = {
    encodeBase64Url(bytes) { return Buffer.from(bytes).toString("base64url"); },
  };
  const marker = "  global.PocketStarlingLogicalEditShadow = Object.freeze({";
  assert.equal(ADMISSION.split(marker).length, 2, "private materializer exposure marker changed");
  const instrumented = ADMISSION.replace(
    marker,
    "  global.__p346oMaterializeCandidate = materializeCandidate;\n\n" + marker
  );
  vm.runInContext(instrumented, context, { filename: "js/pocket-starling-real-truth-admission.js" });
  assert.equal(typeof context.__p346oMaterializeCandidate, "function");
  return context;
}

function tracker(controls = {}) {
  const calls = new Map();
  const events = [];
  const activeByNode = new Map();
  let active = 0;
  let maxActive = 0;
  let maxWorksets = 0;

  function start(nodeId, member) {
    const key = nodeId + ":" + member;
    calls.set(key, (calls.get(key) || 0) + 1);
    events.push(key + ":start");
    active += 1;
    maxActive = Math.max(maxActive, active);
    activeByNode.set(nodeId, (activeByNode.get(nodeId) || 0) + 1);
    maxWorksets = Math.max(maxWorksets,
      [...activeByNode.values()].filter((count) => count > 0).length);
  }
  function end(nodeId, member) {
    events.push(nodeId + ":" + member + ":end");
    active -= 1;
    const next = (activeByNode.get(nodeId) || 1) - 1;
    activeByNode.set(nodeId, next);
  }
  async function run(nodeId, member, value) {
    const key = nodeId + ":" + member;
    start(nodeId, member);
    try {
      const gate = controls.gates && controls.gates.get(key);
      if (gate) await gate.promise;
      if (controls.rejects && controls.rejects.has(key)) throw new Error(key + " rejected");
      end(nodeId, member);
      return value;
    } catch (error) {
      end(nodeId, member);
      throw error;
    }
  }
  return {
    calls,
    events,
    run,
    get maxActive() { return maxActive; },
    get maxWorksets() { return maxWorksets; },
  };
}

function acceptedSession(fixture, controls = {}) {
  const observed = tracker(controls);
  const invalidPlacement = controls.invalidPlacement || new Set();
  const invalidContent = controls.invalidContent || new Set();
  const session = {
    acceptedSealRef: fixture.sealRef,
    async resolveLogical(ref) {
      const info = fixture.childInfo.get(ref);
      if (!info) return fixture.store.get(ref);
      return observed.run(info.nodeId, "children", fixture.store.get(ref));
    },
    readPlacement(nodeId) {
      return observed.run(nodeId, "placement", {
        ok: true,
        nodeId,
        parentId: invalidPlacement.has(nodeId) ? "wrong" : fixture.parents[nodeId],
      });
    },
    readContent(nodeId) {
      return observed.run(nodeId, "content", {
        ok: true,
        nodeId,
        payload: invalidContent.has(nodeId) ? null : { label: nodeId.toUpperCase() },
      });
    },
  };
  return { session, observed };
}

function candidateInput(fixture, controls = {}) {
  const observed = tracker(controls);
  const candidate = {
    sealRef: fixture.sealRef,
    resolveLogical(ref) {
      if (fixture.recordRefs.has(ref) || fixture.childInfo.has(ref)) return undefined;
      return fixture.store.get(ref);
    },
  };
  const baseSession = {
    async resolveLogical(ref) {
      const info = fixture.recordInfo.get(ref) || fixture.childInfo.get(ref);
      if (!info) return fixture.store.get(ref);
      return observed.run(info.nodeId, info.member, fixture.store.get(ref));
    },
  };
  return { candidate, baseSession, observed };
}

function hasStart(events, nodeId, member = null) {
  return events.some((entry) =>
    entry === nodeId + ":" + (member || "placement") + ":start" ||
    (member === null && entry.startsWith(nodeId + ":") && entry.endsWith(":start")));
}

function assertOneTriple(calls, ids = ["a", "b", "c", "d"]) {
  for (const nodeId of ids) {
    for (const member of ["placement", "content", "children"]) {
      assert.equal(calls.get(nodeId + ":" + member), 1, nodeId + " " + member + " count");
    }
  }
}

test("P346o accepted materialiser starts exact child lookahead only, bounded to two worksets", async () => {
  const context = materializeRuntime();
  const fixture = graph(context);
  const aPlacement = deferred(), aContent = deferred();
  const gates = new Map([
    ["a:placement", aPlacement],
    ["a:content", aContent],
  ]);
  const { session, observed } = acceptedSession(fixture, { gates });
  const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session);

  await waitUntil(() => hasStart(observed.events, "b", "children"), "child lookahead");
  assert.equal(hasStart(observed.events, "c"), false, "third node must not start");
  assert.equal(hasStart(observed.events, "d"), false, "later sibling must not start");
  assert.equal(observed.maxWorksets, 2);
  assert.ok(observed.maxActive <= 6, "intentional logical overlap must stay <= 6");

  aPlacement.resolve();
  aContent.resolve();
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(plain(result.document), fixture.expectedDocument);
  assertOneTriple(observed.calls);
});

test("P346o accepted materialiser uses the stack successor when current has no children", async () => {
  const context = materializeRuntime();
  const fixture = graph(context);
  const bPlacement = deferred(), bContent = deferred();
  const gates = new Map([
    ["b:placement", bPlacement],
    ["b:content", bContent],
  ]);
  const { session, observed } = acceptedSession(fixture, { gates });
  const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session);

  await waitUntil(() => hasStart(observed.events, "c", "children"), "stack-successor lookahead");
  assert.equal(hasStart(observed.events, "d"), false, "no third workset while b/c are active");
  assert.equal(observed.maxWorksets, 2);
  assert.ok(observed.maxActive <= 6);

  bPlacement.resolve();
  bContent.resolve();
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(plain(result.document), fixture.expectedDocument);
  assertOneTriple(observed.calls);
});

test("P346o candidate materialiser pipelines exact child and stack successor with canonical parity", async () => {
  for (const gatedNode of ["a", "b"]) {
    const context = admissionRuntime();
    const fixture = graph(context);
    const placementGate = deferred(), contentGate = deferred();
    const gates = new Map([
      [gatedNode + ":placement", placementGate],
      [gatedNode + ":content", contentGate],
    ]);
    const { candidate, baseSession, observed } = candidateInput(fixture, { gates });
    const pending = context.__p346oMaterializeCandidate(candidate, baseSession);

    const expectedNext = gatedNode === "a" ? "b" : "c";
    await waitUntil(() => hasStart(observed.events, expectedNext, "children"),
      "candidate " + expectedNext + " lookahead");
    if (gatedNode === "a") assert.equal(hasStart(observed.events, "c"), false);
    if (gatedNode === "b") assert.equal(hasStart(observed.events, "d"), false);
    assert.equal(observed.maxWorksets, 2);
    assert.ok(observed.maxActive <= 6);

    placementGate.resolve();
    contentGate.resolve();
    const bytes = await pending;
    const expected = fixture.logical.canonical(fixture.expectedDocument);
    assert.equal(expected.ok, true);
    assert.equal(bytes, expected.bytes);
    assertOneTriple(observed.calls);
  }
});

test("P346o earlier current-node failure remains authoritative over an already-failed lookahead", async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    const context = materializeRuntime();
    const fixture = graph(context);
    const aPlacement = deferred();
    const gates = new Map([["a:placement", aPlacement]]);
    const rejects = new Set(["b:content"]);
    const { session, observed } = acceptedSession(fixture, {
      gates,
      rejects,
      invalidPlacement: new Set(["a"]),
    });
    let settled = false;
    const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session)
      .then((value) => { settled = true; return value; });

    await waitUntil(() => observed.events.includes("b:content:end"), "lookahead failure");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "later failure must remain contained while current is unresolved");

    aPlacement.resolve();
    const result = await pending;
    assert.deepEqual(plain(result), { ok: false, reason: "placement-parent-disagreement" });
    assert.equal(hasStart(observed.events, "c"), false);

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("P346o a failed lookahead surfaces only on its own turn after predecessors succeed", async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    const context = materializeRuntime();
    const fixture = graph(context);
    const aPlacement = deferred();
    const gates = new Map([["a:placement", aPlacement]]);
    const rejects = new Set(["b:content"]);
    const { session, observed } = acceptedSession(fixture, { gates, rejects });
    let settled = false;
    const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session)
      .then((value) => { settled = true; return value; });

    await waitUntil(() => observed.events.includes("b:content:end"), "prefetched b failure");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);

    aPlacement.resolve();
    const result = await pending;
    assert.deepEqual(plain(result), { ok: false, reason: "session-read-failed" });
    assert.equal(hasStart(observed.events, "c"), false);

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("P346o candidate keeps speculative failure contained until exact turn and remains fail-closed", async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    for (const invalidCurrent of [true, false]) {
      const context = admissionRuntime();
      const fixture = graph(context, { invalidPlacement: invalidCurrent ? "a" : null });
      const aPlacement = deferred();
      const gates = new Map([["a:placement", aPlacement]]);
      const rejects = new Set(["b:content"]);
      const { candidate, baseSession, observed } = candidateInput(fixture, { gates, rejects });
      let settled = false;
      const pending = context.__p346oMaterializeCandidate(candidate, baseSession)
        .then((value) => { settled = true; return value; });

      await waitUntil(() => observed.events.includes("b:content:end"), "candidate lookahead failure");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false);
      aPlacement.resolve();
      assert.equal(await pending, null);
      assert.equal(hasStart(observed.events, "c"), false);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("P346o duplicate ordering is unchanged and known duplicates are never prefetched", async () => {
  {
    const context = materializeRuntime();
    const fixture = graph(context, { rootItems: ["a", "a", "c"], aItems: [] });
    const aPlacement = deferred(), aContent = deferred();
    const gates = new Map([["a:placement", aPlacement], ["a:content", aContent]]);
    const { session, observed } = acceptedSession(fixture, { gates });
    const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session);
    await waitUntil(() => observed.calls.get("a:children") === 1, "duplicate child discovery");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(hasStart(observed.events, "c"), false);
    aPlacement.resolve();
    aContent.resolve();
    assert.deepEqual(plain(await pending), { ok: false, reason: "duplicate-or-cyclic-current-node" });
    assert.equal(observed.calls.get("a:placement"), 1, "duplicate a must not receive a second workset");
  }
  {
    const context = materializeRuntime();
    const fixture = graph(context, { rootItems: ["a", "a", "c"], aItems: [] });
    const { session, observed } = acceptedSession(fixture, { invalidPlacement: new Set(["a"]) });
    assert.deepEqual(
      plain(await context.PocketStarlingMaterializeShadow.materializeAccepted(session)),
      { ok: false, reason: "placement-parent-disagreement" }
    );
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(hasStart(observed.events, "c"), false);
  }
  {
    const context = admissionRuntime();
    const fixture = graph(context, { rootItems: ["a", "a", "c"], aItems: [] });
    const { candidate, baseSession, observed } = candidateInput(fixture);
    assert.equal(await context.__p346oMaterializeCandidate(candidate, baseSession), null);
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(hasStart(observed.events, "c"), false);
  }
});

const STORAGE_SCRIPTS = [
  "js/pocket-state.js",
  "js/pocket-data.js",
  "js/pocket-outline-persistence-policy.js",
  "js/pocket-node-content.js",
  "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js",
  "js/pocket-import.js",
  "js/pocket-starling-shadow.js",
  "js/pocket-starling-sequence-shadow.js",
  "js/pocket-starling-placement-shadow.js",
  "js/pocket-starling-bridge-shadow.js",
  "js/pocket-starling-root-shadow.js",
  "js/pocket-starling-object-seal-shadow.js",
  "js/pocket-sync-crypto.js",
  "js/pocket-starling-crypto-shadow.js",
  "js/pocket-starling-storage-shadow.js",
  "js/pocket-starling-materialize-shadow.js",
];

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function storageRuntime() {
  const c = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem() {}, setItem() {}, removeItem() {} },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() {},
      addEventListener() {},
    },
    navigator: { clipboard: {} },
    location: { href: "https://example.test" },
    indexedDB: null,
    open() {},
    close() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of STORAGE_SCRIPTS) vm.runInContext(source(file), c, { filename: file });
  return c;
}

function normalised(nodes) {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2048-04-04T00:00:00.000Z",
    nodes,
    tombstones: [],
    rootExtras: {},
    dataExtras: {},
  };
}

function stateFor(c, nodes) {
  const encoded = c.PocketStarlingBridgeShadow.encode(normalised(nodes), { capacity: 4 });
  assert.equal(encoded.ok, true);
  const built = c.PocketStarlingRootShadow.build(encoded.bridge);
  assert.equal(built.ok, true);
  return built.state;
}

function logicalStage(c, stager, state, base = null) {
  const result = c.PocketStarlingObjectSealShadow.stageCandidate(
    stager,
    state,
    base ? { previousSealRef: base.sealRef, baseStage: base } : { previousSealRef: null },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.stage;
}

function logicalConfirm(c, stager, stage) {
  const result = c.PocketStarlingObjectSealShadow.verifyNewObjectPresence(
    stage,
    (ref) => stager.store.has(ref),
    stage.sealObject.previousSealRef === null ? {} : { baseComplete: true },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function masterKey(c, syncedPocketId = "pocket-p346o-tests") {
  const wrappingKey = await c.PocketSyncCrypto.generateDeviceWrappingKey();
  const envelopeContext = {
    syncedPocketId,
    envelopeId: "device-envelope",
    envelopeKind: "device",
    envelopeVersion: 1,
  };
  const bundle = await c.PocketSyncCrypto.createMasterKeyBundle([
    { context: envelopeContext, wrappingKey },
  ]);
  return bundle.masterKey;
}

const storageContext = (syncedPocketId = "pocket-p346o-tests") => ({ syncedPocketId });

async function physicalGenesis(c, logicalStager, logical, key, syncedPocketId = "pocket-p346o-tests") {
  return c.PocketStarlingStorageShadow.stageCandidate({
    sealRef: logical.sealRef,
    resolveLogical: (ref) => logicalStager.store.get(ref),
    masterKey: key,
    context: storageContext(syncedPocketId),
  });
}

function publicStore(...stages) {
  return new Map(stages.flatMap((stage) =>
    stage.newRecords.map((entry) => [entry.storageRef, entry.record])));
}

async function capsuleAt(c, store, storageRef, key, syncedPocketId = "pocket-p346o-tests") {
  const bytes = await c.PocketStarlingCryptoShadow.openObject(
    store.get(storageRef),
    storageRef,
    key,
    storageContext(syncedPocketId),
  );
  return c.PocketStarlingStorageShadow.validateCapsuleBytes(bytes);
}

function linkFor(capsule, logicalRef) {
  return capsule.links.find((link) => link.logicalRef === logicalRef);
}

async function simplePhysicalBase(c, nodes = [{ id: "aa", parentId: "root", order: 0, label: "AA" }]) {
  const state = stateFor(c, nodes);
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const logical = logicalStage(c, stager, state);
  logicalConfirm(c, stager, logical);
  const key = await masterKey(c);
  const physical = await physicalGenesis(c, stager, logical, key);
  return { state, stager, logical, key, physical, store: publicStore(physical) };
}

test("P346o resolver coalesces two same-ref misses without counting a pending waiter as a cache hit", async () => {
  const c = storageRuntime();
  const base = await simplePhysicalBase(c);
  const seal = await capsuleAt(c, base.store, base.physical.sealStorageRef, base.key);
  const rootStorageRef = linkFor(seal, base.logical.rootRef).storageRef;
  const gate = deferred();
  const calls = new Map();
  const resolver = await c.PocketStarlingStorageShadow.createResolver({
    acceptedSealStorageRef: base.physical.sealStorageRef,
    acceptedBaseComplete: true,
    async resolveStorage(ref) {
      calls.set(ref, (calls.get(ref) || 0) + 1);
      if (ref === rootStorageRef) await gate.promise;
      return base.store.get(ref);
    },
    masterKey: base.key,
    context: storageContext(),
  });
  const before = resolver.diagnostics();
  const left = resolver.resolveLogical(base.logical.rootRef);
  const right = resolver.resolveLogical(base.logical.rootRef);

  await waitUntil(() => calls.get(rootStorageRef) === 1, "one pending root fetch");
  assert.equal(calls.get(rootStorageRef), 1);
  assert.deepEqual(plain(resolver.diagnostics()), {
    physicalFetches: before.physicalFetches + 1,
    decryptions: before.decryptions,
    cacheHits: before.cacheHits,
  });

  gate.resolve();
  const [leftBytes, rightBytes] = await Promise.all([left, right]);
  assert.equal(leftBytes, base.stager.store.get(base.logical.rootRef));
  assert.equal(rightBytes, leftBytes);
  const after = resolver.diagnostics();
  assert.equal(after.physicalFetches, before.physicalFetches + 1);
  assert.equal(after.decryptions, before.decryptions + 1);
  assert.equal(after.cacheHits, before.cacheHits);

  assert.equal(await resolver.resolveLogical(base.logical.rootRef), leftBytes);
  assert.equal(resolver.diagnostics().cacheHits, after.cacheHits + 1);
});

test("P346o shared physical load still enforces each waiter's expected logical ref", async () => {
  const c = storageRuntime();
  const state = stateFor(c, [{ id: "aa", parentId: "root", order: 0, label: "AA" }]);
  const stager = c.PocketStarlingObjectSealShadow.createStager();
  const logicalBase = logicalStage(c, stager, state);
  logicalConfirm(c, stager, logicalBase);
  const logicalNext = logicalStage(c, stager, state, logicalBase);
  logicalConfirm(c, stager, logicalNext);
  const key = await masterKey(c);
  const physicalBase = await physicalGenesis(c, stager, logicalBase, key);
  const baseStore = publicStore(physicalBase);
  const baseSeal = await capsuleAt(c, baseStore, physicalBase.sealStorageRef, key);
  const rootStorageRef = linkFor(baseSeal, logicalBase.rootRef).storageRef;

  const links = [
    { logicalRef: logicalNext.rootRef, storageRef: rootStorageRef },
    { logicalRef: logicalBase.sealRef, storageRef: rootStorageRef },
  ].sort((a, b) => a.logicalRef.localeCompare(b.logicalRef));
  const acceptedBytes = c.PocketStarlingStorageShadow.canonicalCapsule({
    schema: c.PocketStarlingStorageShadow.CAPSULE_SCHEMA,
    logicalKind: "candidate-seal",
    logicalRef: logicalNext.sealRef,
    logicalBytes: stager.store.get(logicalNext.sealRef),
    links,
  });
  const acceptedPhysical = await c.PocketStarlingCryptoShadow.sealObject(
    acceptedBytes, key, storageContext()
  );
  const store = new Map(baseStore);
  store.set(acceptedPhysical.ref, acceptedPhysical.record);

  const gate = deferred();
  let rootCalls = 0;
  const resolver = await c.PocketStarlingStorageShadow.createResolver({
    acceptedSealStorageRef: acceptedPhysical.ref,
    acceptedBaseComplete: true,
    async resolveStorage(ref) {
      if (ref === rootStorageRef) {
        rootCalls += 1;
        await gate.promise;
      }
      return store.get(ref);
    },
    masterKey: key,
    context: storageContext(),
  });
  const before = resolver.diagnostics();
  const good = resolver.resolveLogical(logicalNext.rootRef);
  const wrong = resolver.resolveLogical(logicalBase.sealRef);

  await waitUntil(() => rootCalls === 1, "shared mismatched waiter fetch");
  gate.resolve();
  assert.equal(await good, stager.store.get(logicalNext.rootRef));
  await assert.rejects(wrong, (error) => error && error.code === "capsule-logical-mismatch");
  const after = resolver.diagnostics();
  assert.equal(rootCalls, 1);
  assert.equal(after.physicalFetches, before.physicalFetches + 1);
  assert.equal(after.decryptions, before.decryptions + 1);
});

test("P346o failed pending load clears, rejects all waiters, and permits one later explicit retry", async () => {
  const c = storageRuntime();
  const base = await simplePhysicalBase(c);
  const seal = await capsuleAt(c, base.store, base.physical.sealStorageRef, base.key);
  const rootStorageRef = linkFor(seal, base.logical.rootRef).storageRef;
  const gate = deferred();
  let rootCalls = 0;
  const resolver = await c.PocketStarlingStorageShadow.createResolver({
    acceptedSealStorageRef: base.physical.sealStorageRef,
    acceptedBaseComplete: true,
    async resolveStorage(ref) {
      if (ref === rootStorageRef) {
        rootCalls += 1;
        if (rootCalls === 1) {
          await gate.promise;
          throw new Error("expected first physical failure");
        }
      }
      return base.store.get(ref);
    },
    masterKey: base.key,
    context: storageContext(),
  });
  const before = resolver.diagnostics();
  const first = resolver.resolveLogical(base.logical.rootRef);
  const second = resolver.resolveLogical(base.logical.rootRef);
  await waitUntil(() => rootCalls === 1, "failed shared pending fetch");
  gate.resolve();

  const outcomes = await Promise.allSettled([first, second]);
  assert.deepEqual(outcomes.map((item) => item.status), ["rejected", "rejected"]);
  assert.equal(rootCalls, 1, "no automatic retry");
  const failed = resolver.diagnostics();
  assert.equal(failed.physicalFetches, before.physicalFetches + 1);
  assert.equal(failed.decryptions, before.decryptions);

  const bytes = await resolver.resolveLogical(base.logical.rootRef);
  assert.equal(bytes, base.stager.store.get(base.logical.rootRef));
  assert.equal(rootCalls, 2, "later explicit call may retry once pending state is gone");
  const retried = resolver.diagnostics();
  assert.equal(retried.physicalFetches, before.physicalFetches + 2);
  assert.equal(retried.decryptions, before.decryptions + 1);
});

test("P346o fresh resolver sessions never share pending or completed cache state", async () => {
  const c = storageRuntime();
  const base = await simplePhysicalBase(c);
  const seal = await capsuleAt(c, base.store, base.physical.sealStorageRef, base.key);
  const rootStorageRef = linkFor(seal, base.logical.rootRef).storageRef;
  let rootCalls = 0;

  async function makeResolver() {
    return c.PocketStarlingStorageShadow.createResolver({
      acceptedSealStorageRef: base.physical.sealStorageRef,
      acceptedBaseComplete: true,
      async resolveStorage(ref) {
        if (ref === rootStorageRef) rootCalls += 1;
        return base.store.get(ref);
      },
      masterKey: base.key,
      context: storageContext(),
    });
  }

  const one = await makeResolver();
  const two = await makeResolver();
  await Promise.all([
    one.resolveLogical(base.logical.rootRef),
    two.resolveLogical(base.logical.rootRef),
  ]);
  assert.equal(rootCalls, 2, "one root fetch per fresh resolver");
  assert.equal(one.diagnostics().physicalFetches, 2);
  assert.equal(two.diagnostics().physicalFetches, 2);
});

test("P346o production-shaped node overlap coalesces shared trie-prefix physical loads", async () => {
  const c = storageRuntime();
  const nodes = [
    { id: "aa", parentId: "root", order: 0, label: "AA" },
    { id: "ab", parentId: "aa", order: 0, label: "AB" },
  ];
  const base = await simplePhysicalBase(c, nodes);
  const seal = await capsuleAt(c, base.store, base.physical.sealStorageRef, base.key);
  const rootStorageRef = linkFor(seal, base.logical.rootRef).storageRef;
  const rootCapsule = await capsuleAt(c, base.store, rootStorageRef, base.key);
  const rootObject = JSON.parse(rootCapsule.logicalBytes);
  const placementStorageRef = linkFor(rootCapsule, rootObject.placementRef).storageRef;
  const contentStorageRef = linkFor(rootCapsule, rootObject.contentRef).storageRef;

  const placementGate = deferred(), contentGate = deferred();
  const calls = new Map();
  const resolver = await c.PocketStarlingStorageShadow.createResolver({
    acceptedSealStorageRef: base.physical.sealStorageRef,
    acceptedBaseComplete: true,
    async resolveStorage(ref) {
      calls.set(ref, (calls.get(ref) || 0) + 1);
      if (ref === placementStorageRef) await placementGate.promise;
      if (ref === contentStorageRef) await contentGate.promise;
      return base.store.get(ref);
    },
    masterKey: base.key,
    context: storageContext(),
  });
  const opened = await resolver.openAccepted();
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const events = [];
  const session = {
    acceptedSealRef: resolver.acceptedSealRef,
    resolveLogical: (ref) => resolver.resolveLogical(ref),
    readPlacement(nodeId) {
      events.push(nodeId + ":placement:start");
      return resolver.readPlacement(opened.handle, nodeId);
    },
    readContent(nodeId) {
      events.push(nodeId + ":content:start");
      return resolver.readContent(opened.handle, nodeId);
    },
  };

  const pending = c.PocketStarlingMaterializeShadow.materializeAccepted(session);
  await waitUntil(
    () => events.includes("ab:placement:start") && events.includes("ab:content:start"),
    "overlapping adjacent node worksets"
  );
  assert.equal(calls.get(placementStorageRef), 1,
    "shared unresolved placement prefix must have one physical GET");
  assert.equal(calls.get(contentStorageRef), 1,
    "shared unresolved content prefix must have one physical GET");

  placementGate.resolve();
  contentGate.resolve();
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(plain(result.document), normalised(nodes));

  for (const count of calls.values()) assert.equal(count, 1, "no physical ref should be fetched twice");
  const diagnostics = resolver.diagnostics();
  const totalCalls = [...calls.values()].reduce((sum, count) => sum + count, 0);
  assert.equal(diagnostics.physicalFetches, totalCalls);
  assert.equal(diagnostics.decryptions, diagnostics.physicalFetches);
  assert.ok(diagnostics.cacheHits > 0);
});

test("P346o source keeps the new concurrency dimension tightly bounded and sequence pages serial", () => {
  for (const sourceText of [MATERIALIZE, ADMISSION]) {
    assert.equal((sourceText.match(/Promise\.all/g) || []).length, 1);
    assert.match(sourceText, /let lookahead = null/);
    assert.match(sourceText, /Promise\.race/);
    assert.match(sourceText, /Promise\.all\(\[placement, content, children\]\)/);
    assert.doesNotMatch(sourceText, /workerPool|concurrencyPool|concurrencyQueue|prefetchWindow|allSettled/);
  }

  const materializeSequence = MATERIALIZE.slice(
    MATERIALIZE.indexOf("async function sequenceItems"),
    MATERIALIZE.indexOf("try {", MATERIALIZE.indexOf("async function sequenceItems"))
  );
  const admissionSequence = ADMISSION.slice(
    ADMISSION.indexOf("async function sequenceItems"),
    ADMISSION.indexOf("async function record")
  );
  assert.doesNotMatch(materializeSequence, /Promise\.all|Promise\.race/);
  assert.doesNotMatch(admissionSequence, /Promise\.all|Promise\.race/);

  const resolverSource = STORAGE_SOURCE.slice(
    STORAGE_SOURCE.indexOf("async function createResolver"),
    STORAGE_SOURCE.indexOf("global.PocketStarlingStorageShadow")
  );
  assert.match(resolverSource, /pendingLoads = new Map\(\)/);
  assert.match(resolverSource, /pendingLoads\.get\(physicalRef\)/);
  assert.match(resolverSource, /pendingLoads\.delete\(physicalRef\)/);
  assert.doesNotMatch(resolverSource, /global\./);
});
