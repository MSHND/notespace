"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(
  path.join(ROOT, "js/pocket-starling-durable-publication.js"),
  "utf8"
);
const PREFIX = "storage:";

function storageRef(index) {
  return PREFIX + String(index).padStart(43, "0");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, label, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail("timed out waiting for " + label);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function runtime() {
  const context = {
    Object,
    Array,
    String,
    Number,
    Boolean,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    JSON,
    Math,
    console: { log() {}, warn() {}, error() {} },
  };
  context.window = context;
  context.globalThis = context;
  context.PocketStarlingHeadShadow = {
    OUTCOME: {
      UNKNOWN: "UNKNOWN",
      NOT_COMMITTED: "NOT_COMMITTED",
      COMMITTED: "COMMITTED",
      COMMITTED_AND_SUPERSEDED: "COMMITTED_AND_SUPERSEDED",
      CONFLICT: "CONFLICT",
    },
    validHead(value) {
      return !!value && value.schema === "pocket.starling.head.v1"
        && Number.isSafeInteger(value.revision) && value.revision >= 0
        && (value.sealRef === null || typeof value.sealRef === "string");
    },
  };
  context.PocketStarlingStorageShadow = {
    publicationBinding() { return {}; },
    validateCapsuleBytes(value) { return value; },
  };
  context.PocketStarlingCryptoShadow = {
    REFERENCE_PREFIX: PREFIX,
    async openObject(value) { return value; },
    validateContext(value) { return value; },
  };
  context.PocketSyncCrypto = {
    validateNonExtractableAesKey(value) { return value; },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, {
    filename: "js/pocket-starling-durable-publication.js",
  });
  return context;
}

function descriptor(count) {
  assert.ok(count >= 1);
  const newRecords = Array.from({ length: count }, (_, index) => ({
    storageRef: storageRef(100 + index),
    record: { opaque: "record-" + index },
  }));
  return {
    schema: "pocket.starling.durable-candidate.v1",
    syncedPocketId: "p346t-pocket",
    expectedHead: {
      schema: "pocket.starling.head.v1",
      revision: 7,
      sealRef: storageRef(1),
    },
    candidateSealStorageRef: newRecords[newRecords.length - 1].storageRef,
    newRecords,
  };
}

function harness(options = {}) {
  const context = runtime();
  const gates = options.gates || new Map();
  const failures = options.failures || new Map();
  const state = {
    active: 0,
    maxActive: 0,
    puts: [],
    settled: [],
    presenceCalls: [],
    casCalls: [],
    events: [],
    objects: new Set(options.present || []),
    head: {
      schema: "pocket.starling.head.v1",
      revision: 7,
      sealRef: storageRef(1),
    },
  };
  const service = {
    putOpaqueObject(input) {
      const index = Number(input.operationId.split(":").at(-1));
      state.puts.push({ index, input });
      state.events.push("put-" + index + "-start");
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      return (async () => {
        try {
          const gate = gates.get(index);
          if (gate) await gate.promise;
          if (failures.has(index)) throw failures.get(index);
          state.objects.add(input.storageRef);
          return { ok: true };
        } finally {
          state.active -= 1;
          state.settled.push(index);
          state.events.push("put-" + index + "-settled");
        }
      })();
    },
    async objectPresence(input) {
      state.presenceCalls.push(input);
      state.events.push("presence");
      return {
        rows: input.storageRefs.map((ref) => ({
          storageRef: ref,
          present: state.objects.has(ref),
        })),
      };
    },
    async compareAndSetShadowHead(input) {
      state.casCalls.push(input);
      state.events.push("cas");
      state.head = {
        schema: "pocket.starling.head.v1",
        revision: input.expectedHead.revision + 1,
        sealRef: input.candidateSealStorageRef,
      };
      return { ok: true, head: state.head };
    },
    async readShadowHead() {
      return { head: state.head };
    },
    async getOpaqueObject() {
      return { present: false, record: null };
    },
  };
  const coordinator = context.PocketStarlingDurablePublication.createCoordinator({
    objectHeadService: service,
    operationIdFactory(kind, index) {
      return kind + ":" + index;
    },
  });
  return { context, coordinator, state };
}

test("P346t one-record durable publication preserves single-put behaviour", async () => {
  const h = harness();
  const result = await h.coordinator.ensureObjects(descriptor(1));

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { outcome: "objects-present" });
  assert.equal(h.state.maxActive, 1);
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0]);
  assert.equal(h.state.puts[0].input.operationId, "durable-put-object:0");
  assert.equal(h.state.presenceCalls.length, 1);
  assert.equal(h.state.presenceCalls[0].operationId, "durable-object-presence:0");
  assert.equal(h.state.casCalls.length, 0);
  assert.deepEqual(h.state.events, ["put-0-start", "put-0-settled", "presence"]);
});

test("P346t success publishes ordered pairs with max two active puts and original indices", async () => {
  const gate0 = deferred();
  const gate1 = deferred();
  const h = harness({ gates: new Map([[0, gate0], [1, gate1]]) });
  const pending = h.coordinator.ensureObjects(descriptor(5));

  await waitUntil(() => h.state.puts.length === 2, "first pair start");
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0, 1]);
  assert.equal(h.state.maxActive, 2);
  assert.equal(h.state.puts.length, 2);

  gate0.resolve();
  await waitUntil(() => h.state.settled.includes(0), "first member settle");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.puts.length, 2, "pair 2 cannot start until both pair-1 puts settle");

  gate1.resolve();
  const result = await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { outcome: "objects-present" });
  assert.equal(h.state.maxActive, 2, "publication must never reach three active puts");
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(
    h.state.puts.map((entry) => entry.input.operationId),
    [
      "durable-put-object:0",
      "durable-put-object:1",
      "durable-put-object:2",
      "durable-put-object:3",
      "durable-put-object:4",
    ]
  );
  assert.equal(new Set(h.state.puts.map((entry) => entry.index)).size, 5);
  assert.equal(h.state.presenceCalls.length, 1, "<=512 records retain one existing presence proof");
  assert.equal(h.state.events.at(-1), "presence");
  assert.equal(h.state.casCalls.length, 0);
});

test("P346t first-member failure waits for its sibling and starts no later publication pair", async () => {
  const gate0 = deferred();
  const gate1 = deferred();
  const failure0 = new Error("record-0-failed");
  const d = descriptor(4);
  const h = harness({
    gates: new Map([[0, gate0], [1, gate1]]),
    failures: new Map([[0, failure0]]),
  });
  let settled = false;
  let rejection = null;
  const pending = h.coordinator.ensureObjects(d).then(
    () => { settled = true; },
    (error) => { settled = true; rejection = error; }
  );

  await waitUntil(() => h.state.puts.length === 2, "failed pair start");
  gate0.resolve();
  await waitUntil(() => h.state.settled.includes(0), "failed first member settle");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false, "failure must wait for already-started sibling");
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0, 1]);
  assert.equal(h.state.presenceCalls.length, 0);
  assert.equal(h.state.casCalls.length, 0);

  gate1.resolve();
  await pending;
  assert.equal(rejection, failure0);
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0, 1], "no later pair may start");
  assert.equal(h.state.presenceCalls.length, 0);
  assert.equal(h.state.casCalls.length, 0);
  assert.equal(h.state.objects.has(d.newRecords[1].storageRef), true,
    "successful sibling may remain as an unreachable object");
  assert.deepEqual(h.state.head, {
    schema: "pocket.starling.head.v1",
    revision: 7,
    sealRef: storageRef(1),
  }, "successful sibling cannot advance accepted Head");
});

test("P346t second-member failure waits for first member and starts no later work", async () => {
  const gate0 = deferred();
  const gate1 = deferred();
  const failure1 = new Error("record-1-failed");
  const h = harness({
    gates: new Map([[0, gate0], [1, gate1]]),
    failures: new Map([[1, failure1]]),
  });
  let settled = false;
  let rejection = null;
  const pending = h.coordinator.ensureObjects(descriptor(4)).then(
    () => { settled = true; },
    (error) => { settled = true; rejection = error; }
  );

  await waitUntil(() => h.state.puts.length === 2, "second-member failure pair start");
  gate1.resolve();
  await waitUntil(() => h.state.settled.includes(1), "failed second member settle");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false, "pair must fully settle before failure escapes");
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0, 1]);
  assert.equal(h.state.presenceCalls.length, 0);

  gate0.resolve();
  await pending;
  assert.equal(rejection, failure1);
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0, 1]);
  assert.equal(h.state.presenceCalls.length, 0);
  assert.equal(h.state.casCalls.length, 0);
});

test("P346t dual failure deterministically throws the lower descriptor-index failure", async () => {
  const gate0 = deferred();
  const gate1 = deferred();
  const failure0 = new Error("lower-index-failure");
  const failure1 = new Error("higher-index-failure");
  const h = harness({
    gates: new Map([[0, gate0], [1, gate1]]),
    failures: new Map([[0, failure0], [1, failure1]]),
  });
  let settled = false;
  let rejection = null;
  const pending = h.coordinator.ensureObjects(descriptor(4)).then(
    () => { settled = true; },
    (error) => { settled = true; rejection = error; }
  );

  await waitUntil(() => h.state.puts.length === 2, "dual-failure pair start");
  gate1.resolve();
  await waitUntil(() => h.state.settled.includes(1), "higher-index failure settle first");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  gate0.resolve();
  await pending;
  assert.equal(rejection, failure0, "lowest descriptor-index failure must win deterministically");
  assert.deepEqual(h.state.puts.map((entry) => entry.index), [0, 1]);
  assert.equal(h.state.presenceCalls.length, 0);
  assert.equal(h.state.casCalls.length, 0);
});

test("P346t existing pre-CAS presence proof and Head/CAS remain serial after publication", async () => {
  const d = descriptor(3);
  const h = harness({ present: d.newRecords.map((entry) => entry.storageRef) });

  const result = await h.coordinator.attemptHead(d);
  assert.equal(result.outcome, "committed");
  assert.equal(h.state.presenceCalls.length, 1);
  assert.equal(h.state.presenceCalls[0].operationId, "pre-cas-presence:0");
  assert.equal(h.state.casCalls.length, 1);
  assert.equal(h.state.casCalls[0].operationId, "durable-compare-and-set-head:0");
  assert.deepEqual(h.state.events, ["presence", "cas"]);
});

test("P346t source owns only a bounded ordered pair frontier", () => {
  const ensureStart = SOURCE.indexOf("async function ensureObjects");
  const attemptStart = SOURCE.indexOf("async function attemptHead", ensureStart);
  assert.ok(ensureStart >= 0 && attemptStart > ensureStart);
  const ensureSource = SOURCE.slice(ensureStart, attemptStart);

  assert.match(ensureSource, /start \+= 2/);
  assert.match(ensureSource, /slice\(start, start \+ 2\)/);
  assert.match(ensureSource, /Promise\.allSettled\(attempts\)/);
  assert.match(ensureSource, /freshOperationId\("durable-put-object", index\)/);
  assert.match(ensureSource, /await provePresence\(descriptor, "durable-object"\)/);
  assert.doesNotMatch(ensureSource, /worker|pool|queue|all\(descriptor\.newRecords|presence.*Promise\.all/i);

  const presenceIndex = ensureSource.indexOf('await provePresence(descriptor, "durable-object")');
  const settledIndex = ensureSource.indexOf("Promise.allSettled(attempts)");
  assert.ok(presenceIndex > settledIndex, "presence proof must remain after all publication pairs");
});
