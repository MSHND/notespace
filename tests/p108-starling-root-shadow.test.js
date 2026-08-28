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
function firstContentValueNode(root) {
  if (root.hasValue) return root;
  for (const pair of root.children) {
    const found = firstContentValueNode(pair[1]);
    if (found) return found;
  }
  return null;
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
    oldRoot = plain(state.root),
    distant = c.PocketStarlingRootShadow.getContent(state, "n1999"),
    changed = c.PocketStarlingRootShadow.editPayload(state, "n2", {
      label: "changed",
      value: 2,
    });
  assert.equal(changed.ok, true);
  assert.deepEqual(
    plain(c.PocketStarlingRootShadow.getContent(changed.state, "n2").payload),
    { label: "changed", value: 2 },
  );
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
  assert.deepEqual(plain(state.root), oldRoot);
  // Each nodeId character creates one trie frontier; the multiplier covers
  // its node, child array and edge pair, plus the new record/payload objects.
  const contentFrontierBound = 3 * ("n2".length + 1) + 8;
  assert.ok(changed.diagnostics.newlyDigestedObjects <= contentFrontierBound);
  assert.ok(changed.diagnostics.cacheHits >= 3);
});

test("P108 reorder and huge branch move preserve untouched components", () => {
  const c = context(),
    api = c.PocketStarlingRootShadow,
    p = c.PocketStarlingPlacementShadow,
    seq = c.PocketStarlingSequenceShadow,
    reorderState = api.build(bridge(c, normalised(rootNodes(1024)))).state,
    originalSiblingRoot = p.getChildrenRoot(reorderState.structural, "root"),
    originalPages = seq.pages(originalSiblingRoot),
    distantLeaf = originalPages.filter((page) => page.kind === "leaf").at(-1),
    distantBranch = originalPages
      .filter((page) => page.kind === "branch" && page !== originalSiblingRoot)
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
      .includes(distantLeaf),
  );
  assert.ok(
    seq
      .pages(p.getChildrenRoot(reordered.state.structural, "root"))
      .includes(distantBranch),
  );
  const expectedOrder = rootNodes(1024).map((node) => node.id);
  expectedOrder.splice(0, 1);
  expectedOrder.splice(4, 0, "n0");
  assert.deepEqual(
    plain(p.audit(reordered.state.structural).relation.children.root),
    expectedOrder,
  );
  assert.equal(
    reordered.state.root.contentDigest,
    reorderState.root.contentDigest,
  );
  assert.equal(
    reordered.state.root.placementDigest,
    reorderState.root.placementDigest,
  );
  assert.equal(
    reordered.state.root.preservationDigest,
    reorderState.root.preservationDigest,
  );
  assert.notEqual(
    reordered.state.root.childrenDigest,
    reorderState.root.childrenDigest,
  );
  assert.notEqual(
    reordered.state.root.rootDigest,
    reorderState.root.rootDigest,
  );
  // Reorder changes two sequence paths plus the four-character parent-key trie path.
  const reorderFrontierBound =
    8 * (2 * (seq.height(originalSiblingRoot) + 1) + "root".length + 2);
  assert.ok(reordered.diagnostics.newlyDigestedObjects <= reorderFrontierBound);
  assert.ok(reordered.diagnostics.cacheHits >= 3);
  const nodes = [
      { id: "source", parentId: "root", order: 1, label: "source" },
      { id: "dest", parentId: "root", order: 2, label: "dest" },
      { id: "branch", parentId: "source", order: 1, label: "branch" },
      { id: "unrelated", parentId: "root", order: 3, label: "unrelated" },
      {
        id: "unrelated-child",
        parentId: "unrelated",
        order: 1,
        label: "unrelated child",
      },
      ...Array.from({ length: 512 }, (_, i) => ({
        id: `d${i}`,
        parentId: "branch",
        order: i,
        label: `d${i}`,
      })),
    ],
    state = api.build(bridge(c, normalised(nodes))).state,
    stateStructural = state.structural,
    stateContent = state.content,
    statePreservation = state.preservation,
    descContent = api.getContent(state, "d400"),
    descPlacement = p.getPlacement(state.structural, "d400"),
    branchPlacement = p.getPlacement(state.structural, "branch"),
    branchChildren = p.getChildrenRoot(state.structural, "branch"),
    sourceChildren = p.getChildrenRoot(state.structural, "source"),
    destinationChildren = p.getChildrenRoot(state.structural, "dest"),
    unrelatedChildren = p.getChildrenRoot(state.structural, "unrelated"),
    unrelatedPage = seq.pages(unrelatedChildren).at(-1),
    stateRoot = plain(state.root),
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
  assert.notStrictEqual(
    p.getPlacement(moved.state.structural, "branch"),
    branchPlacement,
  );
  assert.equal(
    p.getPlacement(moved.state.structural, "branch").parentId,
    "dest",
  );
  assert.notStrictEqual(
    p.getChildrenRoot(moved.state.structural, "source"),
    sourceChildren,
  );
  assert.notStrictEqual(
    p.getChildrenRoot(moved.state.structural, "dest"),
    destinationChildren,
  );
  assert.strictEqual(
    p.getChildrenRoot(moved.state.structural, "unrelated"),
    unrelatedChildren,
  );
  assert.ok(
    seq
      .pages(p.getChildrenRoot(moved.state.structural, "unrelated"))
      .includes(unrelatedPage),
  );
  assert.equal(moved.state.root.contentDigest, state.root.contentDigest);
  assert.equal(
    moved.state.root.preservationDigest,
    state.root.preservationDigest,
  );
  assert.notEqual(moved.state.root.placementDigest, state.root.placementDigest);
  assert.notEqual(moved.state.root.childrenDigest, state.root.childrenDigest);
  assert.notEqual(moved.state.root.rootDigest, state.root.rootDigest);
  // Move changes the moved-node placement path, two parent-key paths and two
  // short sequence frontiers; descendant count does not enter this formula.
  const moveFrontierBound =
    10 *
    ("branch".length +
      "source".length +
      "dest".length +
      seq.height(sourceChildren) +
      (destinationChildren ? seq.height(destinationChildren) : 0) +
      6);
  assert.ok(moved.diagnostics.newlyDigestedObjects <= moveFrontierBound);
  assert.ok(moved.diagnostics.cacheHits >= 2);
  const rejected = api.move(state, "branch", 0, "d400", 0);
  assert.equal(rejected.reason, "move-would-cycle");
  assert.strictEqual(state.structural, stateStructural);
  assert.strictEqual(state.content, stateContent);
  assert.strictEqual(state.preservation, statePreservation);
  assert.deepEqual(plain(state.root), stateRoot);
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
  assert.equal(api.move(state, "n0", 0, "n1", 0).ok, true);
});

test("P108 audit rejects damage even when supplied digests are recomputed", () => {
  const c = context(),
    api = c.PocketStarlingRootShadow,
    p = c.PocketStarlingPlacementShadow,
    state = api.build(bridge(c, normalised(rootNodes(8)))).state,
    original = plain(state.root),
    originalContent = state.content,
    originalStructural = state.structural,
    originalPreservation = state.preservation;
  assert.equal(
    api.auditCandidate({ ...state, root: { ...state.root, rootDigest: "bad" } })
      .reason,
    "root-digest-mismatch",
  );
  assert.equal(
    api.auditCandidate({
      ...state,
      root: { ...state.root, contentDigest: "bad" },
    }).reason,
    "component-digest-mismatch",
  );
  assert.equal(
    api.auditCandidate({ ...state, content: null }).reason,
    "invalid-root-candidate",
  );
  assert.equal(
    api.auditCandidate({ ...state, root: { ...state.root, extra: [] } }).reason,
    "invalid-root-witness",
  );
  const missingKeyRoot = plain(state.root);
  delete missingKeyRoot.childrenDigest;
  assert.equal(
    api.auditCandidate({ ...state, root: missingKeyRoot }).reason,
    "invalid-root-witness",
  );
  assert.equal(
    api.auditCandidate({ ...state, root: { ...state.root, schema: "wrong" } })
      .reason,
    "invalid-root-witness",
  );
  assert.equal(
    api.auditCandidate({ ...state, capacity: 8 }).reason,
    "invalid-root-config",
  );
  assert.equal(
    api.auditCandidate({ ...state, schema: "wrong" }).reason,
    "invalid-root-candidate",
  );
  assert.equal(
    api.auditCandidate({
      ...state,
      structural: Object.freeze({ ...state.structural, capacity: 8 }),
    }).reason,
    "invalid-root-config",
  );
  assert.equal(
    api.auditCandidate({
      ...state,
      content: { hasValue: false, value: null, children: "bad" },
    }).reason,
    "invalid-content-root",
  );
  const keyMismatchContent = plain(state.content);
  firstContentValueNode(keyMismatchContent).value.nodeId = "wrong";
  assert.equal(
    api.auditCandidate({ ...state, content: keyMismatchContent }).reason,
    "invalid-content-record",
  );
  const extraFieldContent = plain(state.content);
  firstContentValueNode(extraFieldContent).value.parentId = "root";
  assert.equal(
    api.auditCandidate({ ...state, content: extraFieldContent }).reason,
    "invalid-content-record",
  );
  const unsupportedContent = plain(state.content);
  firstContentValueNode(unsupportedContent).value.payload = new Date();
  assert.equal(
    api.auditCandidate({ ...state, content: unsupportedContent }).reason,
    "unsupported-digest-material",
  );
  const cyclicContent = { hasValue: false, value: null, children: [] };
  cyclicContent.children.push(["x", cyclicContent]);
  assert.equal(
    api.auditCandidate({ ...state, content: cyclicContent }).reason,
    "invalid-content-root",
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
  assert.equal(
    api.auditCandidate(candidate).reason,
    "placement-membership-mismatch",
  );
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
  const mutablePreservation = plain(state.preservation);
  const mutableComponents = {
    capacity: state.capacity,
    content: state.content,
    placements: state.structural.placements,
    children: state.structural.children,
    preservation: mutablePreservation,
  };
  const staleWitness = api.diagnosticRootFor(mutableComponents).root;
  mutablePreservation.rootExtras.changedAfterDigest = true;
  assert.equal(
    api.auditCandidate({
      ...state,
      preservation: mutablePreservation,
      root: staleWitness,
    }).reason,
    "component-digest-mismatch",
  );
  assert.deepEqual(plain(state.root), original);
  assert.strictEqual(state.content, originalContent);
  assert.strictEqual(state.structural, originalStructural);
  assert.strictEqual(state.preservation, originalPreservation);
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
