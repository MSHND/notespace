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

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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

function graph(context, overrides = {}) {
  const logical = context.PocketStarlingObjectSealShadow;
  const store = new Map();
  const placement = new Map();
  const content = new Map();

  const placementObjects = {
    a: overrides.invalidPlacement
      ? { schema: logical.OBJECT_SCHEMA, kind: "placement-record", nodeId: "a", parentId: "wrong" }
      : { schema: logical.OBJECT_SCHEMA, kind: "placement-record", nodeId: "a", parentId: "root" },
    b: { schema: logical.OBJECT_SCHEMA, kind: "placement-record", nodeId: "b", parentId: "a" },
  };
  const contentObjects = {
    a: overrides.invalidContent
      ? { schema: logical.OBJECT_SCHEMA, kind: "content-record", nodeId: "a", payload: null }
      : { schema: logical.OBJECT_SCHEMA, kind: "content-record", nodeId: "a", payload: { label: "A" } },
    b: { schema: logical.OBJECT_SCHEMA, kind: "content-record", nodeId: "b", payload: { label: "B" } },
  };

  for (const nodeId of ["a", "b"]) {
    placement.set(nodeId, put(logical, store, "placement-record", placementObjects[nodeId]));
    content.set(nodeId, put(logical, store, "content-record", contentObjects[nodeId]));
  }

  const placementRef = trie(logical, store, "placement-trie", placement);
  const contentRef = trie(logical, store, "content-trie", content);
  const rootSequence = put(logical, store, "sequence-leaf", {
    schema: logical.SEQUENCE_SCHEMA, kind: "sequence-leaf", capacity: 4, count: 1, items: ["a"],
  });
  const aSequence = put(logical, store, "sequence-leaf", {
    schema: logical.SEQUENCE_SCHEMA, kind: "sequence-leaf", capacity: 4, count: 1, items: ["b"],
  });
  const childrenRef = trie(logical, store, "children-trie", new Map([
    ["root", rootSequence],
    ["a", aSequence],
  ]));
  const preservationRef = put(logical, store, "preservation", {
    schema: logical.OBJECT_SCHEMA,
    kind: "preservation",
    value: {
      source: { schema: "portal.mtt.web.v1", writtenAt: "2048-01-01T00:00:00.000Z" },
      tombstones: [], rootExtras: {}, dataExtras: {},
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
  for (const nodeId of ["a", "b"]) {
    recordInfo.set(placement.get(nodeId), { nodeId, member: "placement" });
    recordInfo.set(content.get(nodeId), { nodeId, member: "content" });
  }
  const recordRefs = new Set(recordInfo.keys());
  const expectedDocument = {
    schema: "portal.mtt.web.v1",
    writtenAt: "2048-01-01T00:00:00.000Z",
    nodes: [
      { id: "a", parentId: "root", order: 0, label: "A" },
      { id: "b", parentId: "a", order: 0, label: "B" },
    ],
    tombstones: [], rootExtras: {}, dataExtras: {},
  };
  return { logical, store, sealRef, recordInfo, recordRefs, expectedDocument };
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
  const instrumented = ADMISSION.replace(marker,
    "  global.__p346eMaterializeCandidate = materializeCandidate;\n\n" + marker);
  vm.runInContext(instrumented, context, { filename: "js/pocket-starling-real-truth-admission.js" });
  assert.equal(typeof context.__p346eMaterializeCandidate, "function");
  return context;
}

function acceptedSession(fixture, controls = {}) {
  const calls = new Map();
  const events = [];
  let active = 0, maxActive = 0;
  const started = controls.started || null;
  const placementGate = controls.placementGate || null;
  const contentGate = controls.contentGate || null;

  function markStart(nodeId, member) {
    const key = nodeId + ":" + member;
    calls.set(key, (calls.get(key) || 0) + 1);
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(key + ":start");
    if (nodeId === "a" && started && (calls.get("a:placement") || 0) === 1
        && (calls.get("a:content") || 0) === 1) started.resolve();
  }
  function markEnd(nodeId, member) {
    events.push(nodeId + ":" + member + ":end");
    active -= 1;
  }
  async function readPlacement(nodeId) {
    markStart(nodeId, "placement");
    try {
      if (nodeId === "a" && placementGate) await placementGate.promise;
      if (controls.placementReject === nodeId) throw new Error("placement rejected");
      const value = controls.invalidPlacement === nodeId
        ? { ok: true, nodeId, parentId: "wrong" }
        : { ok: true, nodeId, parentId: nodeId === "a" ? "root" : "a" };
      markEnd(nodeId, "placement");
      return value;
    } catch (error) {
      markEnd(nodeId, "placement");
      throw error;
    }
  }
  async function readContent(nodeId) {
    markStart(nodeId, "content");
    try {
      if (nodeId === "a" && contentGate) await contentGate.promise;
      if (controls.contentReject === nodeId) throw new Error("content rejected");
      const value = controls.invalidContent === nodeId
        ? { ok: true, nodeId, payload: null }
        : { ok: true, nodeId, payload: { label: nodeId.toUpperCase() } };
      markEnd(nodeId, "content");
      return value;
    } catch (error) {
      markEnd(nodeId, "content");
      throw error;
    }
  }
  return {
    session: {
      acceptedSealRef: fixture.sealRef,
      resolveLogical(ref) { return fixture.store.get(ref); },
      readPlacement,
      readContent,
    },
    calls, events,
    get maxActive() { return maxActive; },
  };
}

function candidateInput(fixture, controls = {}) {
  const calls = new Map();
  const events = [];
  let active = 0, maxActive = 0;
  const started = controls.started || null;
  const placementGate = controls.placementGate || null;
  const contentGate = controls.contentGate || null;

  const candidate = {
    sealRef: fixture.sealRef,
    resolveLogical(ref) {
      return fixture.recordRefs.has(ref) ? undefined : fixture.store.get(ref);
    },
  };
  async function resolveLogical(ref) {
    const info = fixture.recordInfo.get(ref);
    if (!info) return fixture.store.get(ref);
    const key = info.nodeId + ":" + info.member;
    calls.set(key, (calls.get(key) || 0) + 1);
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(key + ":start");
    if (info.nodeId === "a" && started && (calls.get("a:placement") || 0) === 1
        && (calls.get("a:content") || 0) === 1) started.resolve();
    try {
      if (info.nodeId === "a" && info.member === "placement" && placementGate) await placementGate.promise;
      if (info.nodeId === "a" && info.member === "content" && contentGate) await contentGate.promise;
      if (controls.reject === key) throw new Error(key + " rejected");
      events.push(key + ":end");
      active -= 1;
      return fixture.store.get(ref);
    } catch (error) {
      events.push(key + ":end");
      active -= 1;
      throw error;
    }
  }
  return {
    candidate,
    baseSession: { resolveLogical },
    calls, events,
    get maxActive() { return maxActive; },
  };
}

function assertSingleSuccessfulNodeReads(calls) {
  for (const nodeId of ["a", "b"]) {
    assert.equal(calls.get(nodeId + ":placement"), 1, nodeId + " placement count");
    assert.equal(calls.get(nodeId + ":content"), 1, nodeId + " content count");
  }
}

test("P346e accepted materialisation overlaps only the same-node placement/content pair", async () => {
  const context = materializeRuntime();
  const fixture = graph(context);
  const started = deferred(), placementGate = deferred(), contentGate = deferred();
  const observed = acceptedSession(fixture, { started, placementGate, contentGate });
  const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(observed.session);
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(observed.maxActive >= 2 && observed.maxActive <= 4);
  assert.equal(observed.events.some((entry) => entry.startsWith("b:") && entry.endsWith(":start")), true,
    "P346o may start the exact next read-only node after child discovery");
  placementGate.resolve();
  contentGate.resolve();
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(plain(result.document), fixture.expectedDocument);
  assertSingleSuccessfulNodeReads(observed.calls);
  const firstB = observed.events.findIndex((entry) => entry.startsWith("b:") && entry.endsWith(":start"));
  assert.ok(firstB < observed.events.indexOf("a:placement:end"));
  assert.ok(firstB < observed.events.indexOf("a:content:end"));
});

test("P346e candidate semantic materialisation overlaps only the same-node inherited record pair", async () => {
  const context = admissionRuntime();
  const fixture = graph(context);
  const started = deferred(), placementGate = deferred(), contentGate = deferred();
  const observed = candidateInput(fixture, { started, placementGate, contentGate });
  const pending = context.__p346eMaterializeCandidate(observed.candidate, observed.baseSession);
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(observed.maxActive >= 2 && observed.maxActive <= 4);
  assert.equal(observed.events.some((entry) => entry.startsWith("b:") && entry.endsWith(":start")), true,
    "P346o may start the exact next read-only node after child discovery");
  placementGate.resolve();
  contentGate.resolve();
  const bytes = await pending;
  const expected = fixture.logical.canonical(fixture.expectedDocument);
  assert.equal(expected.ok, true);
  assert.equal(bytes, expected.bytes, "semantic admission canonical bytes stay exact");
  assertSingleSuccessfulNodeReads(observed.calls);
  const firstB = observed.events.findIndex((entry) => entry.startsWith("b:") && entry.endsWith(":start"));
  assert.ok(firstB > observed.events.indexOf("a:placement:end"));
  assert.ok(firstB > observed.events.indexOf("a:content:end"));
});

test("P346e accepted materialisation keeps paired rejections fail-closed without retries or unhandled rejection", async () => {
  for (const failing of ["placement", "content"]) {
    const context = materializeRuntime();
    const fixture = graph(context);
    const started = deferred(), placementGate = deferred(), contentGate = deferred();
    const observed = acceptedSession(fixture, {
      started, placementGate, contentGate,
      placementReject: failing === "placement" ? "a" : null,
      contentReject: failing === "content" ? "a" : null,
    });
    const unhandled = [];
    const listener = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(observed.session);
      await started.promise;
      assert.equal(observed.calls.get("a:placement"), 1);
      assert.equal(observed.calls.get("a:content"), 1);
      if (failing === "placement") placementGate.resolve(); else contentGate.resolve();
      const result = await pending;
      assert.deepEqual(plain(result), { ok: false, reason: "session-read-failed" });
      if (failing === "placement") contentGate.reject(new Error("paired late content rejection"));
      else placementGate.reject(new Error("paired late placement rejection"));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
      assert.equal(observed.calls.get("a:placement"), 1);
      assert.equal(observed.calls.get("a:content"), 1);
    } finally {
      process.off("unhandledRejection", listener);
    }
  }
});

test("P346e accepted materialisation preserves exact invalid-record failure mapping", async () => {
  {
    const context = materializeRuntime(), fixture = graph(context);
    const observed = acceptedSession(fixture, { invalidPlacement: "a" });
    const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(observed.session);
    assert.deepEqual(plain(result), { ok: false, reason: "placement-parent-disagreement" });
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(observed.calls.get("a:content"), 1);
  }
  {
    const context = materializeRuntime(), fixture = graph(context);
    const observed = acceptedSession(fixture, { invalidContent: "a" });
    const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(observed.session);
    assert.deepEqual(plain(result), { ok: false, reason: "invalid-content-record" });
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(observed.calls.get("a:content"), 1);
  }
});

test("P346e candidate semantic materialisation remains null/fail-closed for either rejected or invalid pair member", async () => {
  for (const failing of ["a:placement", "a:content"]) {
    const context = admissionRuntime(), fixture = graph(context);
    const started = deferred(), placementGate = deferred(), contentGate = deferred();
    const observed = candidateInput(fixture, { started, placementGate, contentGate, reject: failing });
    const pending = context.__p346eMaterializeCandidate(observed.candidate, observed.baseSession);
    await started.promise;
    placementGate.resolve();
    contentGate.resolve();
    assert.equal(await pending, null);
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(observed.calls.get("a:content"), 1);
  }
  for (const invalid of ["placement", "content"]) {
    const context = admissionRuntime();
    const fixture = graph(context, {
      invalidPlacement: invalid === "placement",
      invalidContent: invalid === "content",
    });
    const observed = candidateInput(fixture);
    assert.equal(await context.__p346eMaterializeCandidate(observed.candidate, observed.baseSession), null);
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(observed.calls.get("a:content"), 1);
  }
});

test("P346e same-node placement/content pair remains inside the bounded P346o workset", () => {
  assert.equal((ADMISSION.match(/Promise\.all/g) || []).length, 1);
  assert.equal((MATERIALIZE.match(/Promise\.all/g) || []).length, 1);
  assert.match(ADMISSION, /record\(root\.placementRef[\s\S]*record\(root\.contentRef/);
  assert.match(MATERIALIZE, /session\.readPlacement\(frame\.nodeId\)[\s\S]*session\.readContent\(frame\.nodeId\)/);
  for (const source of [ADMISSION, MATERIALIZE]) {
    assert.doesNotMatch(source, /concurrencyPool|concurrencyQueue|workerPool|Promise\.allSettled/);
  }
});
