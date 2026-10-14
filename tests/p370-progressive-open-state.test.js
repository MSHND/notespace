"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const MODULE = "js/pocket-progressive-open-state.js";
const P368 = path.join(__dirname, "p368-accepted-snapshot-reader.test.js");
const plain = (value) => JSON.parse(JSON.stringify(value));
const node = (id, parentId, order) => ({ id, parentId, order, label: id });

function load(c = {}) {
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(ROOT, MODULE), "utf8"), c, { filename: MODULE });
  return c.PocketProgressiveOpenState;
}
function injected(readChildren, seal = "pinned-seal") {
  return Object.freeze({
    ok: true, scope: "incomplete", acceptedSealRef: seal,
    readChildren,
    async readReachedNode() { throw Error("P370 must not revalidate the reader's accepted nodes"); },
  });
}
const ok = (parentId, nodes) => ({ ok: true, scope: "incomplete", parentId, nodes });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function realHelpers() {
  const content = fs.readFileSync(P368, "utf8");
  const declaration = 'const test = require("node:test");';
  assert.ok(content.includes(declaration), "accepted P368 fixture harness has expected test declaration");
  const quiet = content.replace(declaration, "const test = () => {};");
  const module = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname",
    quiet + "\nmodule.exports = { runtime, fixture, rootReferences, injectedReader };")
    (require, module, module.exports, P368, __dirname);
  return module.exports;
}
const real = realHelpers();
function inRealContext() {
  const c = real.runtime();
  load(c);
  return c;
}

test("P370 starts root unresolved, excludes unreached nodes, and never implies completeness", async () => {
  const api = load(), model = api.createKnowledgeOwner(injected(async () => ok("root", [])));
  assert.deepEqual(plain(model.snapshot()), {
    scope: "incomplete", acceptedSealRef: "pinned-seal",
    root: { scope: "incomplete", acceptedSealRef: "pinned-seal", reached: true,
      id: "root", node: null, childrenState: "unresolved", childIds: null, failureReason: null },
    reached: [],
  });
  assert.equal(model.inspect("unknown"), null);
  assert.equal((await model.requestChildren("unknown")).reason, "unreached-parent");
  assert.throws(() => api.createKnowledgeOwner({ scope: "complete" }), /P368 scoped reader/);
});

test("P370 publishes pending synchronously, deduplicates, then commits known order atomically", async () => {
  const gate = deferred();
  let calls = 0;
  const model = load().createKnowledgeOwner(injected(() => { calls++; return gate.promise; }));
  const first = model.requestChildren("root");
  assert.equal(model.inspect("root").childrenState, "pending");
  assert.equal(model.inspect("root").childIds, null);
  const second = model.requestChildren("root");
  assert.strictEqual(first, second, "same pending promise, not merely same outcome");
  await Promise.resolve();
  assert.equal(calls, 1, "exactly one underlying scoped reader call");
  assert.equal(model.inspect("a"), null, "pending result has no partly reached children");
  gate.resolve(ok("root", [node("b", "root", 0), node("a", "root", 1)]));
  assert.deepEqual(plain((await first).childIds), ["b", "a"]);
  assert.equal(model.inspect("root").childrenState, "ready");
  assert.deepEqual(plain(model.inspect("root").childIds), ["b", "a"]);
  assert.equal(model.inspect("b").childrenState, "unresolved");
  assert.equal(model.inspect("a").childrenState, "unresolved");
  assert.equal(model.inspect("b").childIds, null);
  assert.equal(model.snapshot().scope, "incomplete");
  assert.deepEqual(plain((await model.requestChildren("root")).childIds), ["b", "a"]);
  assert.equal(calls, 1, "ready reuse makes no second read");
});

test("P370 known empty is parent-scoped and not equivalent to unresolved", async () => {
  const model = load().createKnowledgeOwner(injected(async (id) =>
    id === "root" ? ok(id, [node("a", id, 0)]) : ok(id, [])));
  await model.requestChildren("root");
  assert.equal(model.inspect("a").childrenState, "unresolved");
  assert.equal(model.inspect("a").childIds, null);
  await model.requestChildren("a");
  assert.equal(model.inspect("a").childrenState, "ready");
  assert.deepEqual(plain(model.inspect("a").childIds), []);
  assert.equal(model.inspect("root").childrenState, "ready");
  assert.deepEqual(plain(model.inspect("root").childIds), ["a"]);
  assert.equal(model.snapshot().scope, "incomplete");
});

test("P370 reader failure is atomic, preserves other truth, and needs explicit retry", async () => {
  let attempts = 0;
  const model = load().createKnowledgeOwner(injected(async (parentId) => {
    if (parentId === "root") return ok("root", [node("a", "root", 0), node("b", "root", 1)]);
    if (parentId === "b") return ok("b", []);
    attempts++;
    return attempts === 1 ? { ok: false, reason: "placement-parent-disagreement" } :
      ok("a", [node("child", "a", 0)]);
  }));
  await model.requestChildren("root");
  await model.requestChildren("b");
  const failed = await model.requestChildren("a");
  assert.equal(failed.reason, "placement-parent-disagreement");
  assert.equal(model.inspect("a").childrenState, "failed");
  assert.equal(model.inspect("a").childIds, null);
  assert.equal(model.inspect("child"), null, "failed staged child must not be reached");
  assert.deepEqual(plain(model.inspect("root").childIds), ["a", "b"]);
  assert.deepEqual(plain(model.inspect("b").childIds), []);
  assert.equal((await model.requestChildren("a")).reason, "placement-parent-disagreement");
  assert.equal(attempts, 1, "failure does not implicitly retry");
  assert.equal((await model.requestChildren("a", { retry: true })).ok, true);
  assert.equal(attempts, 2);
  assert.equal(model.inspect("a").childrenState, "ready");
  assert.equal(model.inspect("child").childrenState, "unresolved");
  assert.equal(model.snapshot().scope, "incomplete");
});

test("P370 reached parents have independently pending, out-of-order scoped reads", async () => {
  const a = deferred(), b = deferred(), counts = { a: 0, b: 0 };
  const model = load().createKnowledgeOwner(injected((parentId) => {
    if (parentId === "root") return ok("root", [node("a", "root", 0), node("b", "root", 1)]);
    counts[parentId]++;
    return parentId === "a" ? a.promise : b.promise;
  }));
  await model.requestChildren("root");
  const pa = model.requestChildren("a"), pb = model.requestChildren("b");
  await Promise.resolve();
  assert.deepEqual(counts, { a: 1, b: 1 });
  assert.equal(model.inspect("a").childrenState, "pending");
  assert.equal(model.inspect("b").childrenState, "pending");
  b.resolve(ok("b", [node("b-child", "b", 0)]));
  await pb;
  assert.equal(model.inspect("a").childrenState, "pending");
  assert.equal(model.inspect("b-child").childrenState, "unresolved");
  a.resolve({ ok: false, reason: "scoped-list-failed" });
  assert.equal((await pa).reason, "scoped-list-failed");
  assert.equal(model.inspect("a").childrenState, "failed");
  assert.equal(model.inspect("b-child").node.label, "b-child");
  assert.equal(model.snapshot().scope, "incomplete");
});

test("P370 does not share knowledge across model instances or accepted sessions", async () => {
  const api = load(), one = api.createKnowledgeOwner(injected(async (id) =>
    ok(id, [node("a", "root", 0)]), "seal-one"));
  const two = api.createKnowledgeOwner(injected(async (id) =>
    ok(id, [node("b", "root", 0)]), "seal-two"));
  await one.requestChildren("root");
  assert.equal(two.inspect("root").childrenState, "unresolved");
  assert.equal(two.inspect("a"), null);
  await two.requestChildren("root");
  assert.deepEqual(plain(one.inspect("root").childIds), ["a"]);
  assert.deepEqual(plain(two.inspect("root").childIds), ["b"]);
  assert.equal(one.snapshot().acceptedSealRef, "seal-one");
  assert.equal(two.snapshot().acceptedSealRef, "seal-two");
});

test("P370 all returned node/ordering/frontier data is defensive, with no complete-document API", async () => {
  const n = { ...node("a", "root", 0), details: { nested: ["original"] } };
  const model = load().createKnowledgeOwner(injected(async () => ok("root", [n])));
  const result = await model.requestChildren("root");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.childIds));
  assert.throws(() => result.childIds.push("forged"), TypeError);
  n.details.nested[0] = "caller changed original reader result";
  const one = model.inspect("a");
  one.node.details.nested[0] = "caller changed copy";
  const front = model.snapshot();
  front.reached[0].node.details.nested[0] = "changed snapshot";
  assert.ok(Object.isFrozen(front));
  assert.ok(Object.isFrozen(front.reached));
  assert.deepEqual(plain(model.inspect("a").node.details), { nested: ["original"] });
  assert.deepEqual(Object.keys(model).sort(),
    ["inspect", "requestChildren", "retire", "snapshot"]);
  assert.equal("document" in front, false);
  assert.equal("nodes" in front, false);
  assert.equal("canSave" in front, false);
});

test("P370 explicit retire stops late completion from installing stale knowledge", async () => {
  const gate = deferred();
  const model = load().createKnowledgeOwner(injected(() => gate.promise));
  const pending = model.requestChildren("root");
  assert.equal(model.inspect("root").childrenState, "pending");
  assert.equal(model.retire(), true);
  assert.equal(model.retire(), false);
  assert.equal(model.inspect("root").childrenState, "failed");
  assert.equal(model.inspect("root").failureReason, "session-retired");
  gate.resolve(ok("root", [node("late", "root", 0)]));
  assert.equal((await pending).reason, "stale-response");
  assert.equal(model.inspect("late"), null);
  assert.equal((await model.requestChildren("root", { retry: true })).reason, "session-retired");
  assert.equal(model.snapshot().scope, "incomplete");
});

test("P370 malformed scoped response and thrown read fail closed without inferred children", async () => {
  let count = 0;
  const model = load().createKnowledgeOwner(injected(async () => {
    count++;
    if (count === 1) return ok("not-root", [node("bad", "root", 0)]);
    throw Object.assign(Error("synthetic"), { code: "transport-failed" });
  }));
  assert.equal((await model.requestChildren("root")).reason, "scoped-result-invalid");
  assert.equal(model.inspect("bad"), null);
  assert.equal((await model.requestChildren("root", { retry: true })).reason, "transport-failed");
  assert.equal(model.inspect("root").childrenState, "failed");
  assert.equal(model.snapshot().scope, "incomplete");
});

test("P370 real P368 reader commits validated reached nodes without whole materialisation", async () => {
  const c = inRealContext(), f = real.fixture(c);
  let wholeCalls = 0;
  const original = c.PocketStarlingMaterializeShadow;
  c.PocketStarlingMaterializeShadow = Object.freeze({ ...original,
    async materializeAccepted() { wholeCalls++; throw Error("whole-read forbidden"); },
  });
  const reader = await original.createAcceptedSnapshotReader(f.session);
  assert.equal(reader.ok, true);
  const model = c.PocketProgressiveOpenState.createKnowledgeOwner(reader);
  assert.deepEqual(plain((await model.requestChildren("root")).childIds), ["visible", "unrelated"]);
  assert.deepEqual(plain((await model.requestChildren("visible")).childIds), ["visible-first", "visible-second"]);
  assert.equal(model.inspect("visible-first").node.label, "visible-first");
  assert.equal(model.inspect("unrelated").childrenState, "unresolved");
  assert.equal(reader.diagnostics().contentReads, 4);
  assert.equal(reader.diagnostics().placementReads, 4);
  assert.equal(wholeCalls, 0);
  assert.equal(model.snapshot().scope, "incomplete");
});

test("P370 propagates P368 malformed, duplicate, cyclic, noncanonical and agreement failures", async () => {
  const cases = [
    { name: "missing structural page", parent: "root", build: async (c, f, r) => ({
      ...f.session, async resolveLogical(ref) {
        return ref === r.rootChildren ? undefined : f.session.resolveLogical(ref);
      },
    }), reason: "missing-logical-object" },
    { name: "malformed sequence count", parent: "root", build: async (c, f, r) => {
      const leaf = JSON.parse(await f.session.resolveLogical(r.rootChildren));
      const bytes = c.PocketStarlingObjectSealShadow.canonical({ ...leaf, count: leaf.count + 1 }).bytes;
      return real.injectedReader(c, f, r.rootChildren, "sequence-leaf", bytes);
    }, reason: "invalid-sequence-object" },
    { name: "duplicate sibling", parent: "root", build: async (c, f, r) => {
      const leaf = JSON.parse(await f.session.resolveLogical(r.rootChildren));
      const bytes = c.PocketStarlingObjectSealShadow.canonical({ ...leaf, count: 2,
        items: ["visible", "visible"] }).bytes;
      return real.injectedReader(c, f, r.rootChildren, "sequence-leaf", bytes);
    }, reason: "duplicate-or-cyclic-current-node" },
    { name: "noncanonical page", parent: "root", build: async (c, f, r) => {
      const bytes = (await f.session.resolveLogical(r.rootChildren)) + "\n";
      return real.injectedReader(c, f, r.rootChildren, "sequence-leaf", bytes);
    }, reason: "noncanonical-logical-object" },
    { name: "cyclic reached node", parent: "visible", build: async (c, f, r) => {
      const leafRef = await (async () => {
        const t = JSON.parse(await f.session.resolveLogical(r.root.childrenRef));
        let ref = r.root.childrenRef;
        for (const ch of "visible") {
          const page = JSON.parse(await f.session.resolveLogical(ref));
          ref = page.children.find((edge) => edge.key === ch).ref;
        }
        return JSON.parse(await f.session.resolveLogical(ref)).valueRef;
      })();
      const leaf = JSON.parse(await f.session.resolveLogical(leafRef));
      const bytes = c.PocketStarlingObjectSealShadow.canonical({
        ...leaf, count: 1, items: ["visible"] }).bytes;
      return real.injectedReader(c, f, leafRef, "sequence-leaf", bytes);
    }, reason: "duplicate-or-cyclic-current-node" },
    { name: "placement mismatch", parent: "visible", build: async (c, f) => ({
      ...f.session, async readPlacement(id) {
        return id === "visible-first" ? { ok: true, nodeId: id, parentId: "wrong" } :
          f.session.readPlacement(id);
      },
    }), reason: "placement-parent-disagreement" },
    { name: "content reservation mismatch", parent: "visible", build: async (c, f) => ({
      ...f.session, async readContent(id) {
        return id === "visible-first" ? { ok: true, nodeId: id, payload: { order: 99 } } :
          f.session.readContent(id);
      },
    }), reason: "reserved-content-payload-key" },
  ];
  for (const scenario of cases) {
    const c = inRealContext(), f = real.fixture(c), refs = await real.rootReferences(f);
    const session = await scenario.build(c, f, refs);
    const reader = await c.PocketStarlingMaterializeShadow.createAcceptedSnapshotReader(session);
    assert.equal(reader.ok, true, scenario.name);
    const model = c.PocketProgressiveOpenState.createKnowledgeOwner(reader);
    if (scenario.parent !== "root") {
      assert.equal((await model.requestChildren("root")).ok, true, scenario.name);
    }
    const before = plain(model.snapshot());
    const failure = await model.requestChildren(scenario.parent);
    assert.equal(failure.reason, scenario.reason, scenario.name);
    assert.equal(model.inspect(scenario.parent).childrenState, "failed", scenario.name);
    assert.equal(model.inspect(scenario.parent).childIds, null, scenario.name);
    assert.equal(model.inspect("visible-first"), null, scenario.name);
    assert.deepEqual(plain(model.snapshot().reached.map((v) => v.id)),
      before.reached.map((v) => v.id), scenario.name + " must not commit staged descendants");
    assert.equal(model.snapshot().scope, "incomplete");
  }
});

test("P370 P368-backed expansion cost stays flat across unrelated 100/500/2000-node tails", async () => {
  const rows = [];
  for (const size of [100, 500, 2000]) {
    const c = inRealContext(), f = real.fixture(c, size);
    const reader = await c.PocketStarlingMaterializeShadow.createAcceptedSnapshotReader(f.session);
    const model = c.PocketProgressiveOpenState.createKnowledgeOwner(reader);
    const before = f.calls.length;
    await model.requestChildren("root");
    await model.requestChildren("visible");
    const diagnostics = plain(reader.diagnostics());
    rows.push({ size, resolved: f.calls.length - before, content: diagnostics.contentReads,
      placement: diagnostics.placementReads, reached: model.snapshot().reached.length });
  }
  assert.equal(new Set(rows.map((r) => r.resolved)).size, 1, JSON.stringify(rows));
  assert.ok(rows.every((r) => r.content === 4 && r.placement === 4 && r.reached === 4),
    JSON.stringify(rows));
  console.log("P370_SCOPED_MEASUREMENTS " + JSON.stringify(rows));
});

test("P370 is dormant: no entry-point wiring, full materialisation, editing or transport owner", () => {
  const text = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.equal(index.includes("pocket-progressive-open-state"), false);
  for (const forbidden of ["materializeAccepted(", "resolveLogical(", "readShadowHead(",
    "getOpaqueObject(", "document.nodes", "state.nodes", "saveEligibility", "fetch(",
    "querySelector(", "addEventListener("]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});
