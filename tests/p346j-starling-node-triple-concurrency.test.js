"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const P346E = path.join(__dirname, "p346e-starling-node-pair-concurrency.test.js");
const MATERIALIZE_SOURCE = fs.readFileSync(path.join(ROOT, "js/pocket-starling-materialize-shadow.js"), "utf8");
const ADMISSION_SOURCE = fs.readFileSync(path.join(ROOT, "js/pocket-starling-real-truth-admission.js"), "utf8");

function loadP346eHelpers() {
  let code = fs.readFileSync(P346E, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(code.includes(declaration), "P346e helper harness declaration changed");
  code = code.replace(declaration, "const test = () => {};");
  code += "\nmodule.exports = { plain, deferred, put, trie, materializeRuntime, admissionRuntime };\n";
  const localRequire = createRequire(P346E);
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", code)(
    localRequire, moduleRecord, moduleRecord.exports, P346E, __dirname
  );
  return moduleRecord.exports;
}

const {
  plain, deferred, put, trie, materializeRuntime, admissionRuntime,
} = loadP346eHelpers();

function trieTerminalRef(store, rootRef, key) {
  let ref = rootRef;
  for (const character of key) {
    const object = JSON.parse(store.get(ref));
    const edge = object.children.find((entry) => entry.key === character);
    assert.ok(edge, "fixture trie path missing for " + key);
    ref = edge.ref;
  }
  return ref;
}

function graph(context, overrides = {}) {
  const logical = context.PocketStarlingObjectSealShadow;
  const store = new Map();
  const placementRefs = new Map();
  const contentRefs = new Map();

  const parentByNode = { a: "root", b: "a", c: "root" };
  for (const nodeId of ["a", "b", "c"]) {
    const placementObject = {
      schema: logical.OBJECT_SCHEMA,
      kind: "placement-record",
      nodeId,
      parentId: overrides.invalidPlacement === nodeId ? "wrong" : parentByNode[nodeId],
    };
    const contentObject = {
      schema: logical.OBJECT_SCHEMA,
      kind: "content-record",
      nodeId,
      payload: overrides.invalidContent === nodeId ? null : { label: nodeId.toUpperCase() },
    };
    placementRefs.set(nodeId, put(logical, store, "placement-record", placementObject));
    contentRefs.set(nodeId, put(logical, store, "content-record", contentObject));
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
  const emptySequence = sequence([]);
  const sequences = new Map([
    ["root", sequence(["a", "c"])],
    ["a", sequence(["b"])],
    ["b", emptySequence],
    ["bx", emptySequence],
    ["c", emptySequence],
    ["cy", emptySequence],
  ]);
  if (overrides.invalidChildSequence === "a") sequences.set("a", "invalid-sequence-ref");
  if (overrides.missingChildSequence === "a") {
    sequences.set("a", "proof-ref:v1:sequence-leaf:deadbeef");
  }

  const childrenRef = trie(logical, store, "children-trie", sequences);
  const childDiscoveryRefs = new Map();
  for (const nodeId of ["a", "b", "c"]) {
    childDiscoveryRefs.set(nodeId, trieTerminalRef(store, childrenRef, nodeId));
  }

  const preservationRef = put(logical, store, "preservation", {
    schema: logical.OBJECT_SCHEMA,
    kind: "preservation",
    value: {
      source: { schema: "portal.mtt.web.v1", writtenAt: "2048-02-02T00:00:00.000Z" },
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
  for (const nodeId of ["a", "b", "c"]) {
    recordInfo.set(placementRefs.get(nodeId), { nodeId, member: "placement" });
    recordInfo.set(contentRefs.get(nodeId), { nodeId, member: "content" });
  }
  const childInfo = new Map(
    [...childDiscoveryRefs.entries()].map(([nodeId, ref]) => [ref, { nodeId, member: "children" }])
  );

  return {
    logical,
    store,
    sealRef,
    recordInfo,
    recordRefs: new Set(recordInfo.keys()),
    childInfo,
    childDiscoveryRefs,
    expectedDocument: {
      schema: "portal.mtt.web.v1",
      writtenAt: "2048-02-02T00:00:00.000Z",
      nodes: [
        { id: "a", parentId: "root", order: 0, label: "A" },
        { id: "b", parentId: "a", order: 0, label: "B" },
        { id: "c", parentId: "root", order: 1, label: "C" },
      ],
      tombstones: [],
      rootExtras: {},
      dataExtras: {},
    },
  };
}

function tracker(controls = {}) {
  const calls = new Map();
  const events = [];
  let active = 0;
  let maxActive = 0;

  function start(nodeId, member) {
    const key = nodeId + ":" + member;
    calls.set(key, (calls.get(key) || 0) + 1);
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(key + ":start");
    if (nodeId === "a" && controls.started
        && (calls.get("a:placement") || 0) === 1
        && (calls.get("a:content") || 0) === 1
        && (calls.get("a:children") || 0) === 1) controls.started.resolve();
  }

  function end(nodeId, member) {
    events.push(nodeId + ":" + member + ":end");
    active -= 1;
  }

  function gateFor(nodeId, member) {
    if (nodeId !== "a") return null;
    if (member === "placement") return controls.placementGate || null;
    if (member === "content") return controls.contentGate || null;
    if (member === "children") return controls.childrenGate || null;
    return null;
  }

  return {
    calls,
    events,
    start,
    end,
    gateFor,
    get maxActive() { return maxActive; },
  };
}

function acceptedSession(fixture, controls = {}) {
  const observed = tracker(controls);

  async function member(nodeId, kind, value, rejectNode) {
    observed.start(nodeId, kind);
    try {
      const gate = observed.gateFor(nodeId, kind);
      if (gate) await gate.promise;
      if (rejectNode === nodeId) throw new Error(kind + " rejected");
      observed.end(nodeId, kind);
      return value;
    } catch (error) {
      observed.end(nodeId, kind);
      throw error;
    }
  }

  const session = {
    acceptedSealRef: fixture.sealRef,
    async resolveLogical(ref) {
      const info = fixture.childInfo.get(ref);
      if (!info) return fixture.store.get(ref);
      observed.start(info.nodeId, "children");
      try {
        const gate = observed.gateFor(info.nodeId, "children");
        if (gate) await gate.promise;
        if (controls.childReject === info.nodeId) throw new Error("children rejected");
        observed.end(info.nodeId, "children");
        return fixture.store.get(ref);
      } catch (error) {
        observed.end(info.nodeId, "children");
        throw error;
      }
    },
    readPlacement(nodeId) {
      const value = {
        ok: true,
        nodeId,
        parentId: controls.invalidPlacement === nodeId
          ? "wrong" : ({ a: "root", b: "a", c: "root" })[nodeId],
      };
      return member(nodeId, "placement", value, controls.placementReject);
    },
    readContent(nodeId) {
      const value = {
        ok: true,
        nodeId,
        payload: controls.invalidContent === nodeId ? null : { label: nodeId.toUpperCase() },
      };
      return member(nodeId, "content", value, controls.contentReject);
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
      observed.start(info.nodeId, info.member);
      try {
        const gate = observed.gateFor(info.nodeId, info.member);
        if (gate) await gate.promise;
        if (controls.reject === info.nodeId + ":" + info.member) {
          throw new Error(info.member + " rejected");
        }
        observed.end(info.nodeId, info.member);
        return fixture.store.get(ref);
      } catch (error) {
        observed.end(info.nodeId, info.member);
        throw error;
      }
    },
  };

  return { candidate, baseSession, observed };
}

function releaseTriple(placementGate, contentGate, childrenGate) {
  placementGate.resolve();
  contentGate.resolve();
  childrenGate.resolve();
}

function assertNoLaterNodeStart(events) {
  assert.equal(events.some((entry) => entry.startsWith("b:") || entry.startsWith("c:")), false,
    "no descendant/sibling member may start while node a triple is unresolved");
}

function assertSingleTriplePerNode(calls) {
  for (const nodeId of ["a", "b", "c"]) {
    assert.equal(calls.get(nodeId + ":placement"), 1, nodeId + " placement count");
    assert.equal(calls.get(nodeId + ":content"), 1, nodeId + " content count");
    assert.equal(calls.get(nodeId + ":children"), 1, nodeId + " child discovery count");
  }
}

function assertNodeSetsDoNotOverlap(events) {
  function first(nodeId) {
    return events.findIndex((entry) => entry.startsWith(nodeId + ":") && entry.endsWith(":start"));
  }
  function lastEnd(nodeId) {
    let index = -1;
    for (let i = 0; i < events.length; i += 1) {
      if (events[i].startsWith(nodeId + ":") && events[i].endsWith(":end")) index = i;
    }
    return index;
  }
  assert.ok(first("b") > lastEnd("a"), "node b work starts only after node a triple settles");
  assert.ok(first("c") > lastEnd("b"), "root sibling c starts only after depth-first node b settles");
}

test("P346j accepted materialiser starts placement, content and same-node children discovery together only", async () => {
  const context = materializeRuntime();
  const fixture = graph(context);
  const started = deferred(), placementGate = deferred(), contentGate = deferred(), childrenGate = deferred();
  const { session, observed } = acceptedSession(fixture, {
    started, placementGate, contentGate, childrenGate,
  });

  const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session);
  await started.promise;
  assert.equal(observed.maxActive, 3);
  assertNoLaterNodeStart(observed.events);

  releaseTriple(placementGate, contentGate, childrenGate);
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(plain(result.document), fixture.expectedDocument);
  assertSingleTriplePerNode(observed.calls);
  assertNodeSetsDoNotOverlap(observed.events);
});

test("P346j candidate semantic materialiser starts inherited placement, content and children discovery together only", async () => {
  const context = admissionRuntime();
  const fixture = graph(context);
  const started = deferred(), placementGate = deferred(), contentGate = deferred(), childrenGate = deferred();
  const { candidate, baseSession, observed } = candidateInput(fixture, {
    started, placementGate, contentGate, childrenGate,
  });

  const pending = context.__p346eMaterializeCandidate(candidate, baseSession);
  await started.promise;
  assert.equal(observed.maxActive, 3);
  assertNoLaterNodeStart(observed.events);

  releaseTriple(placementGate, contentGate, childrenGate);
  const bytes = await pending;
  const expected = fixture.logical.canonical(fixture.expectedDocument);
  assert.equal(expected.ok, true);
  assert.equal(bytes, expected.bytes);
  assertSingleTriplePerNode(observed.calls);
  assertNodeSetsDoNotOverlap(observed.events);
});

test("P346j accepted materialiser preserves record failure mapping and starts no later node", async () => {
  for (const failing of ["placement", "content"]) {
    const context = materializeRuntime();
    const fixture = graph(context);
    const started = deferred(), placementGate = deferred(), contentGate = deferred(), childrenGate = deferred();
    const { session, observed } = acceptedSession(fixture, {
      started, placementGate, contentGate, childrenGate,
      placementReject: failing === "placement" ? "a" : null,
      contentReject: failing === "content" ? "a" : null,
    });
    const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session);
    await started.promise;
    releaseTriple(placementGate, contentGate, childrenGate);
    const result = await pending;
    assert.deepEqual(plain(result), { ok: false, reason: "session-read-failed" });
    assertNoLaterNodeStart(observed.events);
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(observed.calls.get("a:content"), 1);
    assert.equal(observed.calls.get("a:children"), 1);
  }

  {
    const context = materializeRuntime(), fixture = graph(context);
    const { session, observed } = acceptedSession(fixture, { invalidPlacement: "a" });
    const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(session);
    assert.deepEqual(plain(result), { ok: false, reason: "placement-parent-disagreement" });
    assertNoLaterNodeStart(observed.events);
  }
  {
    const context = materializeRuntime(), fixture = graph(context);
    const { session, observed } = acceptedSession(fixture, { invalidContent: "a" });
    const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(session);
    assert.deepEqual(plain(result), { ok: false, reason: "invalid-content-record" });
    assertNoLaterNodeStart(observed.events);
  }
});

test("P346j accepted materialiser preserves child discovery failures after valid records", async () => {
  {
    const context = materializeRuntime(), fixture = graph(context);
    const { session, observed } = acceptedSession(fixture, { childReject: "a" });
    const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(session);
    assert.deepEqual(plain(result), { ok: false, reason: "logical-resolution-failed" });
    assertNoLaterNodeStart(observed.events);
  }
  {
    const context = materializeRuntime(), fixture = graph(context, { invalidChildSequence: "a" });
    const { session, observed } = acceptedSession(fixture);
    const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(session);
    assert.deepEqual(plain(result), { ok: false, reason: "invalid-sequence-object" });
    assertNoLaterNodeStart(observed.events);
  }
  {
    const context = materializeRuntime(), fixture = graph(context, { missingChildSequence: "a" });
    const { session, observed } = acceptedSession(fixture);
    const result = await context.PocketStarlingMaterializeShadow.materializeAccepted(session);
    assert.deepEqual(plain(result), { ok: false, reason: "missing-logical-object" });
    assertNoLaterNodeStart(observed.events);
  }
});

test("P346j candidate semantic materialiser remains null/fail-closed for any same-node member failure", async () => {
  for (const failing of ["placement", "content", "children"]) {
    const context = admissionRuntime();
    const fixture = graph(context);
    const started = deferred(), placementGate = deferred(), contentGate = deferred(), childrenGate = deferred();
    const { candidate, baseSession, observed } = candidateInput(fixture, {
      started, placementGate, contentGate, childrenGate,
      reject: "a:" + failing,
    });
    const pending = context.__p346eMaterializeCandidate(candidate, baseSession);
    await started.promise;
    releaseTriple(placementGate, contentGate, childrenGate);
    assert.equal(await pending, null);
    assertNoLaterNodeStart(observed.events);
    assert.equal(observed.calls.get("a:placement"), 1);
    assert.equal(observed.calls.get("a:content"), 1);
    assert.equal(observed.calls.get("a:children"), 1);
  }

  for (const invalid of ["placement", "content"]) {
    const context = admissionRuntime();
    const fixture = graph(context, {
      invalidPlacement: invalid === "placement" ? "a" : null,
      invalidContent: invalid === "content" ? "a" : null,
    });
    const { candidate, baseSession, observed } = candidateInput(fixture);
    assert.equal(await context.__p346eMaterializeCandidate(candidate, baseSession), null);
    assertNoLaterNodeStart(observed.events);
  }

  for (const childFailure of ["invalidChildSequence", "missingChildSequence"]) {
    const context = admissionRuntime();
    const fixture = graph(context, { [childFailure]: "a" });
    const { candidate, baseSession, observed } = candidateInput(fixture);
    assert.equal(await context.__p346eMaterializeCandidate(candidate, baseSession), null);
    assertNoLaterNodeStart(observed.events);
  }
});

test("P346j already-started triple members never leak an unhandled rejection or retry", async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    {
      const context = materializeRuntime(), fixture = graph(context);
      const started = deferred(), placementGate = deferred(), contentGate = deferred(), childrenGate = deferred();
      const { session, observed } = acceptedSession(fixture, {
        started, placementGate, contentGate, childrenGate,
        placementReject: "a", contentReject: "a", childReject: "a",
      });
      const pending = context.PocketStarlingMaterializeShadow.materializeAccepted(session);
      await started.promise;
      releaseTriple(placementGate, contentGate, childrenGate);
      assert.deepEqual(plain(await pending), { ok: false, reason: "session-read-failed" });
      assert.equal(observed.calls.get("a:placement"), 1);
      assert.equal(observed.calls.get("a:content"), 1);
      assert.equal(observed.calls.get("a:children"), 1);
      assertNoLaterNodeStart(observed.events);
    }
    {
      const context = admissionRuntime(), fixture = graph(context);
      const started = deferred(), placementGate = deferred(), contentGate = deferred(), childrenGate = deferred();
      const { candidate, baseSession, observed } = candidateInput(fixture, {
        started, placementGate, contentGate, childrenGate,
        reject: "a:placement",
      });
      const originalResolve = baseSession.resolveLogical.bind(baseSession);
      baseSession.resolveLogical = async (ref) => {
        const info = fixture.recordInfo.get(ref) || fixture.childInfo.get(ref);
        if (info?.nodeId === "a") {
          if (info.member === "placement") return originalResolve(ref);
          observed.start(info.nodeId, info.member);
          try {
            const gate = observed.gateFor(info.nodeId, info.member);
            if (gate) await gate.promise;
            throw new Error(info.member + " rejected");
          } finally {
            observed.end(info.nodeId, info.member);
          }
        }
        return originalResolve(ref);
      };
      const pending = context.__p346eMaterializeCandidate(candidate, baseSession);
      await started.promise;
      releaseTriple(placementGate, contentGate, childrenGate);
      assert.equal(await pending, null);
      assert.equal(observed.calls.get("a:placement"), 1);
      assert.equal(observed.calls.get("a:content"), 1);
      assert.equal(observed.calls.get("a:children"), 1);
      assertNoLaterNodeStart(observed.events);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("P346j production source contains exactly one bounded same-node triple and no broader concurrency owner", () => {
  assert.equal((MATERIALIZE_SOURCE.match(/Promise\.all/g) || []).length, 1);
  assert.equal((ADMISSION_SOURCE.match(/Promise\.all/g) || []).length, 1);

  assert.match(MATERIALIZE_SOURCE,
    /Promise\.all\(\[\s*session\.readPlacement\(frame\.nodeId\)[\s\S]*session\.readContent\(frame\.nodeId\)[\s\S]*childrenFor\(frame\.nodeId\)[\s\S]*\]\)/);
  assert.match(ADMISSION_SOURCE,
    /Promise\.all\(\[\s*record\(root\.placementRef[\s\S]*record\(root\.contentRef[\s\S]*childrenFor\(nodeId\)[\s\S]*\]\)/);

  for (const source of [MATERIALIZE_SOURCE, ADMISSION_SOURCE]) {
    assert.doesNotMatch(source, /concurrencyPool|concurrencyQueue|concurrencyScheduler|prefetch|Promise\.allSettled/);
  }

  const materializeTrie = MATERIALIZE_SOURCE.slice(
    MATERIALIZE_SOURCE.indexOf("async function trieValue"),
    MATERIALIZE_SOURCE.indexOf("async function sequenceItems")
  );
  const materializeSequence = MATERIALIZE_SOURCE.slice(
    MATERIALIZE_SOURCE.indexOf("async function sequenceItems"),
    MATERIALIZE_SOURCE.indexOf("try {", MATERIALIZE_SOURCE.indexOf("async function sequenceItems"))
  );
  assert.doesNotMatch(materializeTrie, /Promise\.all/);
  assert.doesNotMatch(materializeSequence, /Promise\.all/);

  const admissionTrie = ADMISSION_SOURCE.slice(
    ADMISSION_SOURCE.indexOf("async function trieValue"),
    ADMISSION_SOURCE.indexOf("async function sequenceItems")
  );
  const admissionSequence = ADMISSION_SOURCE.slice(
    ADMISSION_SOURCE.indexOf("async function sequenceItems"),
    ADMISSION_SOURCE.indexOf("async function record")
  );
  assert.doesNotMatch(admissionTrie, /Promise\.all/);
  assert.doesNotMatch(admissionSequence, /Promise\.all/);
});
