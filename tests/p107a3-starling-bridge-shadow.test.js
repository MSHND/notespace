"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ROOT = path.resolve(__dirname, ".."),
  CODECS = [
    "js/pocket-state.js",
    "js/pocket-data.js",
    "js/pocket-outline-persistence-policy.js",
    "js/pocket-editor-metadata.js",
    "js/pocket-pe-import-preserve.js",
    "js/pocket-storage.js",
    "js/pocket-import.js",
  ];
const source = (f) => fs.readFileSync(path.join(ROOT, f), "utf8"),
  plain = (v) => JSON.parse(JSON.stringify(v));
function ctx() {
  const c = {
    URL,
    Date,
    Math,
    JSON,
    Map,
    Set,
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
  [
    ...CODECS,
    "js/pocket-starling-shadow.js",
    "js/pocket-starling-sequence-shadow.js",
    "js/pocket-starling-placement-shadow.js",
    "js/pocket-starling-bridge-shadow.js",
  ].forEach((f) => vm.runInContext(source(f), c, { filename: f }));
  return c;
}
function norm(c) {
  c.raw = {
    schema: "portal.mtt.web.v1",
    writtenAt: "2026-08-28T00:00:00.000Z",
    rootExtra: { kept: true },
    data: {
      extra: { kept: true },
      mainThoughtTreeTombstones: [{ id: "gone" }],
      mainThoughtTree: [
        {
          id: "a",
          parentId: "root",
          label: "Zulu",
          order: 10000,
          editor: { opaque: true },
        },
        { id: "b", parentId: "root", label: "Alpha", order: 5000 },
        { id: "c", parentId: "root", label: "Beta", order: 5000 },
        {
          id: "done",
          parentId: "root",
          label: "Completed",
          order: 1000,
          system: {
            kind: "bucket",
            bucketType: "completed",
            managed: true,
            pinnedLast: true,
          },
        },
        { id: "child", parentId: "a", label: "Child", order: 1000 },
      ],
    },
  };
  return vm.runInContext("normaliseInput(raw)", c);
}
function canon(c, n, t) {
  c.n = n;
  c.t = t;
  return vm.runInContext("buildCanonicalPocketPayload(n,{writtenAt:t})", c);
}
test("P107a3a enters from current canonical portal.export.v1 and round-trips exactly", () => {
  const c = ctx(),
    representative = norm(c),
    fixed = "2026-08-28T12:00:00.000Z",
    canonicalInput = canon(c, representative, fixed);
  assert.equal(canonicalInput.schema, "portal.export.v1");
  assert.equal(canonicalInput.writtenAt, fixed);
  assert.equal(canonicalInput.exportedAt, fixed);
  assert.deepEqual(
    plain(canonicalInput.mainThoughtTree),
    plain(canonicalInput.data.mainThoughtTree),
  );
  assert.deepEqual(
    plain(canonicalInput.mainThoughtTreeTombstones),
    plain(canonicalInput.data.mainThoughtTreeTombstones),
  );
  c.ingress = canonicalInput;
  const n = vm.runInContext("normaliseInput(ingress)", c),
    a = c.PocketStarlingBridgeShadow,
    b = a.encode(n, { capacity: 4 });
  assert.equal(b.ok, true);
  assert.deepEqual(plain(a.audit(b.bridge)), { ok: true });
  const decoded = a.decodeExact(b.bridge);
  assert.deepEqual(plain(decoded.norm), plain(n));
  assert.deepEqual(
    plain(canon(c, n, fixed)),
    plain(canon(c, decoded.norm, fixed)),
  );
  assert.deepEqual(plain(decoded.norm.rootExtras), plain(n.rootExtras));
  assert.deepEqual(plain(decoded.norm.dataExtras), plain(n.dataExtras));
  assert.deepEqual(plain(decoded.norm.tombstones), plain(n.tombstones));
  assert.deepEqual(
    plain(decoded.norm.nodes.find((x) => x.id === "a").editor),
    plain(n.nodes.find((x) => x.id === "a").editor),
  );
  const order = plain(
    c.PocketStarlingPlacementShadow.audit(b.bridge.structural).relation.children
      .root,
  );
  assert.deepEqual(order, ["b", "c", "a", "done"]);
  assert.deepEqual(
    Object.keys(
      c.PocketStarlingPlacementShadow.getPlacement(b.bridge.structural, "b"),
    ).sort(),
    ["nodeId", "parentId"],
  );
  assert.equal(
    source("index.html").includes("pocket-starling-bridge-shadow.js"),
    false,
  );
});
test("P107a3 fails closed for parent, membership and order divergence without mutating structure", () => {
  const c = ctx(),
    n = norm(c),
    a = c.PocketStarlingBridgeShadow,
    p = c.PocketStarlingPlacementShadow,
    b = a.encode(n).bridge,
    original = plain(p.audit(b.structural).relation);
  function altered(r) {
    return Object.freeze({
      ...b,
      structural: p.build(r, { capacity: 4 }).model,
    });
  }
  const parent = plain(p.audit(b.structural).relation);
  parent.parents.child = "root";
  parent.children.a = [];
  parent.children.root.push("child");
  assert.equal(a.audit(altered(parent)).reason, "bridge-parent-mismatch");
  const order = plain(p.audit(b.structural).relation);
  [order.children.root[0], order.children.root[1]] = [
    order.children.root[1],
    order.children.root[0],
  ];
  assert.equal(a.audit(altered(order)).reason, "bridge-order-mismatch");
  const membership = plain(p.audit(b.structural).relation);
  membership.nodeIds.push("extra");
  membership.parents.extra = "root";
  membership.children.root.push("extra");
  assert.equal(
    a.audit(altered(membership)).reason,
    "bridge-membership-mismatch",
  );
  assert.deepEqual(plain(p.audit(b.structural).relation), original);
  assert.equal(a.decodeExact(altered(order)).ok, false);
});
test("P107a3 legacy order changes do not mutate the structural projection", () => {
  const c = ctx(),
    n = norm(c),
    a = c.PocketStarlingBridgeShadow,
    p = c.PocketStarlingPlacementShadow,
    b = a.encode(n).bridge,
    root = p.getChildrenRoot(b.structural, "root"),
    variant = plain(b.compatibility);
  variant.placements.find((x) => x.nodeId === "a").order = 1;
  const changed = Object.freeze({ ...b, compatibility: variant });
  assert.equal(a.audit(changed).reason, "bridge-order-mismatch");
  assert.strictEqual(p.getChildrenRoot(changed.structural, "root"), root);
});
test("P107a3a fails closed for missing dependencies and malformed bridge sides", () => {
  const c = ctx(),
    n = norm(c),
    a = c.PocketStarlingBridgeShadow,
    b = a.encode(n).bridge,
    p = c.PocketStarlingPlacementShadow,
    structural = b.structural;
  const sourceSnapshot = plain(n);
  c.compareSiblingOrder = undefined;
  assert.equal(a.encode(n).reason, "bridge-dependency-unavailable");
  assert.deepEqual(plain(n), sourceSnapshot);
  const d = ctx(),
    bridge = d.PocketStarlingBridgeShadow.encode(norm(d)).bridge,
    badCompat = plain(bridge.compatibility);
  const structuralReference = bridge.structural;
  badCompat.placements = [];
  const corruptCompat = Object.freeze({ ...bridge, compatibility: badCompat });
  assert.equal(d.PocketStarlingBridgeShadow.audit(corruptCompat).ok, false);
  assert.equal(
    d.PocketStarlingBridgeShadow.decodeExact(corruptCompat).ok,
    false,
  );
  assert.strictEqual(bridge.structural, structuralReference);
  assert.equal(d.PocketStarlingPlacementShadow.audit(structuralReference).ok, true);
  const corruptStructural = Object.freeze({ ...bridge, structural: {} });
  const compatibilitySnapshot = plain(bridge.compatibility);
  assert.equal(d.PocketStarlingBridgeShadow.audit(corruptStructural).ok, false);
  assert.equal(
    d.PocketStarlingBridgeShadow.decodeExact(corruptStructural).ok,
    false,
  );
  assert.deepEqual(plain(bridge.compatibility), compatibilitySnapshot);
  assert.strictEqual(b.structural, structural);
  assert.equal(p.audit(structural).ok, true);
});
test("P107a3a preserves source order for a true current-comparator tie", () => {
  const c = ctx(),
    n = plain(norm(c));
  n.nodes.find((x) => x.id === "b").label = "Same";
  n.nodes.find((x) => x.id === "c").label = "Same";
  const bridge = c.PocketStarlingBridgeShadow.encode(n).bridge;
  assert.deepEqual(
    plain(
      c.PocketStarlingPlacementShadow.audit(bridge.structural).relation.children
        .root,
    ).slice(0, 2),
    ["b", "c"],
  );
});
test("P107a3b rejects malformed bridge shapes and schemas without touching a valid bridge", () => {
  const c = ctx(),
    n = norm(c),
    api = c.PocketStarlingBridgeShadow,
    bridge = api.encode(n).bridge,
    compatibility = plain(bridge.compatibility),
    structural = bridge.structural;
  for (const malformed of [{}, Object.freeze({ ...bridge, schema: "wrong" })]) {
    assert.equal(api.audit(malformed).reason, "invalid-bridge");
    assert.equal(api.decodeExact(malformed).reason, "invalid-bridge");
  }
  assert.strictEqual(bridge.structural, structural);
  assert.deepEqual(plain(bridge.compatibility), compatibility);
  assert.equal(api.audit(bridge).ok, true);
});
