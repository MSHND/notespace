"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const SCRIPTS = [
  "js/pocket-state.js",
  "js/pocket-data.js",
  "js/pocket-outline-persistence-policy.js",
  "js/pocket-editor-metadata.js",
  "js/pocket-pe-import-preserve.js",
  "js/pocket-storage.js",
  "js/pocket-import.js",
  "js/pocket-starling-shadow.js",
  "js/pocket-starling-sequence-shadow.js",
  "js/pocket-starling-placement-shadow.js",
  "js/pocket-starling-bridge-shadow.js",
  "js/pocket-starling-root-shadow.js",
];
const plain = (v) => JSON.parse(JSON.stringify(v));
function context() {
  const c = {
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
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById() {
        return null;
      },
      addEventListener() {},
    },
    navigator: { clipboard: {} },
    location: { href: "https://example.test" },
    indexedDB: null,
    open() {},
    close() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
  };
  c.window = c;
  c.globalThis = c;
  vm.createContext(c);
  for (const file of SCRIPTS)
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), c, {
      filename: file,
    });
  return c;
}
function normalised(nodes) {
  return {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-08-28T00:00:00.000Z",
    nodes,
    tombstones: [{ id: "gone" }],
    rootExtras: { rootMarker: true },
    dataExtras: { dataMarker: true },
  };
}
function bridge(c, n) {
  const built = c.PocketStarlingBridgeShadow.encode(n, { capacity: 4 });
  assert.equal(built.ok, true);
  return built.bridge;
}
function canonicalIngress(c, n) {
  c.n = n;
  c.t = "2026-08-28T12:00:00.000Z";
  const payload = vm.runInContext(
    "buildCanonicalPocketPayload(n,{writtenAt:t})",
    c,
  );
  c.payload = payload;
  return vm.runInContext("normaliseInput(payload)", c);
}
function rootNodes(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    parentId: "root",
    order: i * 10,
    label: `Node ${String(i).padStart(4, "0")}`,
    value: i,
  }));
}

test("P108 builds a fixed-size witness from real canonical ingress", () => {
  const c = context(),
    n = canonicalIngress(
      c,
      normalised([
        {
          id: "a",
          parentId: "root",
          order: 20,
          label: "A",
          editor: { opaque: true },
        },
        { id: "b", parentId: "root", order: 10, label: "B" },
      ]),
    ),
    b = bridge(c, n),
    built = c.PocketStarlingRootShadow.build(b);
  assert.equal(built.ok, true);
  assert.equal(c.PocketStarlingRootShadow.auditCandidate(built.state).ok, true);
  assert.deepEqual(
    Object.keys(built.state.root).sort(),
    [
      "capacity",
      "childrenDigest",
      "contentDigest",
      "placementDigest",
      "preservationDigest",
      "rootDigest",
      "schema",
    ].sort(),
  );
  assert.strictEqual(built.state.structural, b.structural);
  assert.strictEqual(
    built.state.structural.placements,
    b.structural.placements,
  );
  assert.strictEqual(built.state.structural.children, b.structural.children);
  assert.deepEqual(
    Object.keys(c.PocketStarlingRootShadow.getContent(built.state, "a")).sort(),
    ["nodeId", "payload"],
  );
  assert.equal(
    fs
      .readFileSync(path.join(ROOT, "index.html"), "utf8")
      .includes("pocket-starling-root-shadow.js"),
    false,
  );
});

test("P108 payload edit is local across two thousand nodes", () => {
  const c = context(),
    built = c.PocketStarlingRootShadow.build(
      bridge(c, normalised(rootNodes(2000))),
    ),
    state = built.state,
    distant = c.PocketStarlingRootShadow.getContent(state, "n1999"),
    changed = c.PocketStarlingRootShadow.editPayload(state, "n2", {
      label: "changed",
      value: 2,
    });
  assert.equal(changed.ok, true);
  assert.strictEqual(changed.state.structural, state.structural);
  assert.strictEqual(changed.state.preservation, state.preservation);
  assert.strictEqual(
    c.PocketStarlingRootShadow.getContent(changed.state, "n1999"),
    distant,
  );
  assert.equal(
    c.PocketStarlingRootShadow.getContent(state, "n2").payload.label,
    "Node 0002",
  );
  assert.equal(changed.state.root.placementDigest, state.root.placementDigest);
  assert.equal(changed.state.root.childrenDigest, state.root.childrenDigest);
  assert.equal(
    changed.state.root.preservationDigest,
    state.root.preservationDigest,
  );
  assert.notEqual(changed.state.root.contentDigest, state.root.contentDigest);
  assert.notEqual(changed.state.root.rootDigest, state.root.rootDigest);
  assert.ok(changed.diagnostics.newlyDigestedObjects <= 20);
});

test("P108 reorder and huge branch move preserve untouched components", () => {
  const c = context(),
    api = c.PocketStarlingRootShadow,
    p = c.PocketStarlingPlacementShadow,
    seq = c.PocketStarlingSequenceShadow,
    reorderState = api.build(bridge(c, normalised(rootNodes(1024)))).state,
    distant = seq
      .pages(p.getChildrenRoot(reorderState.structural, "root"))
      .at(-1),
    reordered = api.reorder(reorderState, "n0", 0, 5);
  assert.equal(reordered.ok, true);
  assert.strictEqual(reordered.state.content, reorderState.content);
  assert.strictEqual(reordered.state.preservation, reorderState.preservation);
  assert.strictEqual(
    reordered.state.structural.placements,
    reorderState.structural.placements,
  );
  assert.ok(
    seq
      .pages(p.getChildrenRoot(reordered.state.structural, "root"))
      .includes(distant),
  );
  assert.deepEqual(
    plain(
      p.audit(reordered.state.structural).relation.children.root.slice(0, 5),
    ),
    ["n1", "n2", "n3", "n4", "n0"],
  );
  assert.ok(reordered.diagnostics.newlyDigestedObjects <= 100);
  const nodes = [
      { id: "source", parentId: "root", order: 1, label: "source" },
      { id: "dest", parentId: "root", order: 2, label: "dest" },
      { id: "branch", parentId: "source", order: 1, label: "branch" },
      ...Array.from({ length: 512 }, (_, i) => ({
        id: `d${i}`,
        parentId: "branch",
        order: i,
        label: `d${i}`,
      })),
    ],
    state = api.build(bridge(c, normalised(nodes))).state,
    descContent = api.getContent(state, "d400"),
    descPlacement = p.getPlacement(state.structural, "d400"),
    branchChildren = p.getChildrenRoot(state.structural, "branch"),
    moved = api.move(state, "branch", 0, "dest", 0);
  assert.equal(moved.ok, true);
  assert.strictEqual(api.getContent(moved.state, "d400"), descContent);
  assert.strictEqual(
    p.getPlacement(moved.state.structural, "d400"),
    descPlacement,
  );
  assert.strictEqual(
    p.getChildrenRoot(moved.state.structural, "branch"),
    branchChildren,
  );
  assert.equal(moved.state.root.contentDigest, state.root.contentDigest);
  assert.equal(
    moved.state.root.preservationDigest,
    state.root.preservationDigest,
  );
  assert.notEqual(moved.state.root.placementDigest, state.root.placementDigest);
  assert.ok(moved.diagnostics.newlyDigestedObjects <= 200);
  const rejected = api.move(state, "branch", 0, "d400", 0);
  assert.equal(rejected.reason, "move-would-cycle");
  assert.equal(api.auditCandidate(state).ok, true);
});

test("P108 continuity rejects lookalikes and does not hide whole audits", () => {
  const c = context(),
    api = c.PocketStarlingRootShadow,
    state = api.build(bridge(c, normalised(rootNodes(16)))).state,
    lookalike = { ...state };
  assert.equal(
    api.editPayload(lookalike, "n1", {}).reason,
    "unproved-root-state",
  );
  const originalBridge = c.PocketStarlingBridgeShadow,
    originalPlacement = c.PocketStarlingPlacementShadow;
  c.PocketStarlingBridgeShadow = Object.freeze({
    ...originalBridge,
    audit() {
      throw new Error("whole audit");
    },
  });
  c.PocketStarlingPlacementShadow = Object.freeze({
    ...originalPlacement,
    audit() {
      throw new Error("whole audit");
    },
    materialise() {
      throw new Error("whole materialise");
    },
  });
  assert.equal(api.editPayload(state, "n1", { value: 1 }).ok, true);
  assert.equal(api.reorder(state, "n0", 0, 2).ok, true);
});

test("P108 audit rejects damage even when supplied digests are recomputed", () => {
  const c = context(),
    api = c.PocketStarlingRootShadow,
    p = c.PocketStarlingPlacementShadow,
    state = api.build(bridge(c, normalised(rootNodes(8)))).state,
    original = plain(state.root);
  assert.equal(
    api.auditCandidate({ ...state, root: { ...state.root, rootDigest: "bad" } })
      .reason,
    "root-digest-mismatch",
  );
  assert.equal(
    api.auditCandidate({ ...state, root: { ...state.root, contentDigest: "bad" } })
      .reason,
    "component-digest-mismatch",
  );
  assert.equal(
    api.auditCandidate({ ...state, content: null }).reason,
    "invalid-root-candidate",
  );
  const relation = plain(p.audit(state.structural).relation);
  relation.parents.n0 = "n1";
  relation.children.root = relation.children.root.filter((id) => id !== "n0");
  relation.children.n1 = ["n0"];
  const contradictory = p.build(relation, { capacity: 4 }).model;
  const components = {
      capacity: state.capacity,
      content: state.content,
      placements: contradictory.placements,
      children: state.structural.children,
      preservation: state.preservation,
    },
    root = api.diagnosticRootFor(components).root,
    candidate = {
      ...state,
      structural: Object.freeze({
        capacity: 4,
        placements: contradictory.placements,
        children: state.structural.children,
      }),
      root,
  };
  assert.equal(api.auditCandidate(candidate).ok, false);
  const smaller = api.build(bridge(c, normalised(rootNodes(7)))).state;
  const missingComponents = {
    capacity: state.capacity,
    content: smaller.content,
    placements: state.structural.placements,
    children: state.structural.children,
    preservation: state.preservation,
  };
  const missingMembership = {
    ...state,
    content: smaller.content,
    root: api.diagnosticRootFor(missingComponents).root,
  };
  assert.equal(
    api.auditCandidate(missingMembership).reason,
    "root-membership-mismatch",
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(
    api.editPayload(state, "n1", cyclic).reason,
    "unsupported-digest-material",
  );
  assert.deepEqual(plain(state.root), original);
  assert.equal(api.auditCandidate(state).ok, true);
});

test("P108 proof digests are deterministic and respect semantic boundaries", () => {
  const a = context(),
    b = context(),
    one = a.PocketStarlingRootShadow.build(
      bridge(a, normalised(rootNodes(20))),
    ).state,
    two = b.PocketStarlingRootShadow.build(
      bridge(b, normalised(rootNodes(20))),
    ).state;
  assert.deepEqual(plain(one.root), plain(two.root));
  const api = a.PocketStarlingRootShadow,
    x = api.editPayload(one, "n1", { a: 1, b: 2 }).state,
    y = api.editPayload(one, "n1", { b: 2, a: 1 }).state,
    z = api.editPayload(one, "n1", [1, 2]).state,
    w = api.editPayload(one, "n1", [2, 1]).state;
  assert.equal(x.root.contentDigest, y.root.contentDigest);
  assert.notEqual(z.root.contentDigest, w.root.contentDigest);
});
