"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function load(file, context) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
}

function context() {
  const value = { Object, Array, Math, Map, Set, Number };
  value.window = value;
  value.globalThis = value;
  vm.createContext(value);
  load("js/pocket-starling-sequence-shadow.js", value);
  load("js/pocket-starling-placement-shadow.js", value);
  return value;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalRelation(relation) {
  return {
    nodeIds: [...relation.nodeIds].sort(),
    parents: plain(relation.parents),
    children: plain(relation.children)
  };
}

function audited(api, model) {
  const result = api.audit(model);
  assert.equal(result.ok, true);
  return plain(result.relation);
}

function largeRelation(childCount = 1024) {
  const largeChildren = Array.from({ length: childCount }, (_, index) => `child-${index}`);
  const nodeIds = ["large", "other", "other-child", ...largeChildren];
  const parents = {
    large: "root",
    other: "root",
    "other-child": "other"
  };
  for (const nodeId of largeChildren) parents[nodeId] = "large";
  return {
    nodeIds,
    parents,
    children: {
      root: ["large", "other"],
      large: largeChildren,
      other: ["other-child"]
    }
  };
}

function branchRelation(groupCount = 16, leavesPerGroup = 32) {
  const relation = {
    nodeIds: [
      "source",
      "destination",
      "unrelated",
      "branch",
      "source-sibling",
      "destination-sibling",
      "unrelated-child"
    ],
    parents: {
      source: "root",
      destination: "root",
      unrelated: "root",
      branch: "source",
      "source-sibling": "source",
      "destination-sibling": "destination",
      "unrelated-child": "unrelated"
    },
    children: {
      root: ["source", "destination", "unrelated"],
      source: ["branch", "source-sibling"],
      destination: ["destination-sibling"],
      unrelated: ["unrelated-child"],
      branch: []
    }
  };

  for (let group = 0; group < groupCount; group += 1) {
    const groupId = `group-${group}`;
    relation.nodeIds.push(groupId);
    relation.parents[groupId] = "branch";
    relation.children.branch.push(groupId);
    relation.children[groupId] = [];
    for (let leaf = 0; leaf < leavesPerGroup; leaf += 1) {
      const leafId = `leaf-${group}-${leaf}`;
      relation.nodeIds.push(leafId);
      relation.parents[leafId] = groupId;
      relation.children[groupId].push(leafId);
    }
  }
  return relation;
}

function recordReferences(api, model, nodeIds) {
  return new Map(nodeIds.map((nodeId) => [nodeId, api.getPlacement(model, nodeId)]));
}

function assertFrozenTrie(node) {
  assert.ok(Object.isFrozen(node));
  assert.ok(Object.isFrozen(node.children));
  for (const pair of node.children) {
    assert.ok(Object.isFrozen(pair));
    assertFrozenTrie(pair[1]);
  }
}

test("P107a2 builds coherent persistent dual views and fails closed on contradictions", () => {
  const c = context();
  const api = c.PocketStarlingPlacementShadow;
  const sequence = c.PocketStarlingSequenceShadow;
  const relation = largeRelation();
  const built = api.build(relation, { capacity: 4 });

  assert.equal(built.ok, true);
  assert.deepEqual(audited(api, built.model), canonicalRelation(relation));
  assert.ok(sequence.height(api.getChildrenRoot(built.model, "large")) > 2);
  assert.equal(api.getPlacement(built.model, "child-500").parentId, "large");
  assertFrozenTrie(built.model.placements);
  assertFrozenTrie(built.model.children);
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("pocket-starling-placement-shadow.js"), false);

  const duplicate = {
    nodeIds: ["a", "b"],
    parents: { a: "root", b: "root" },
    children: { root: ["a", "b"], a: ["a"] }
  };
  const mismatch = {
    nodeIds: ["a", "b"],
    parents: { a: "root", b: "root" },
    children: { root: ["a"] }
  };
  const unknown = {
    nodeIds: ["a"],
    parents: { a: "gone" },
    children: { gone: ["a"] }
  };
  const cycle = {
    nodeIds: ["a", "b"],
    parents: { a: "b", b: "a" },
    children: { a: ["b"], b: ["a"] }
  };

  assert.deepEqual(plain(api.build(duplicate)), { ok: false, reason: "duplicate-ordered-membership" });
  assert.deepEqual(plain(api.build(mismatch)), { ok: false, reason: "placement-membership-mismatch" });
  assert.deepEqual(plain(api.build(unknown)), { ok: false, reason: "unknown-parent" });
  assert.deepEqual(plain(api.build(cycle)), { ok: false, reason: "parent-cycle" });

  const unicode = api.build({
    nodeIds: ["🪶"],
    parents: { "🪶": "root" },
    children: { root: ["🪶"] }
  });
  assert.equal(unicode.ok, true);
  assert.equal(api.getPlacement(unicode.model, "🪶").parentId, "root");
});

test("P107a2 inserts locally while retaining unrelated records, roots and distant pages", () => {
  const c = context();
  const api = c.PocketStarlingPlacementShadow;
  const sequence = c.PocketStarlingSequenceShadow;
  const relation = largeRelation();
  const base = api.build(relation, { capacity: 4 }).model;
  const original = audited(api, base);
  const records = recordReferences(api, base, ["large", "other", "child-10", "child-500", "child-1000"]);
  const unrelatedRoot = api.getChildrenRoot(base, "other");
  const distantPage = sequence.pages(api.getChildrenRoot(base, "large")).at(-1);
  const inserted = api.insert(base, "fresh", "large", 2);
  const expected = largeRelation();
  expected.nodeIds.push("fresh");
  expected.parents.fresh = "large";
  expected.children.large.splice(2, 0, "fresh");

  assert.equal(inserted.ok, true);
  assert.deepEqual(audited(api, inserted.model), canonicalRelation(expected));
  assert.ok(Object.isFrozen(api.getPlacement(inserted.model, "fresh")));
  for (const [nodeId, record] of records) {
    assert.strictEqual(api.getPlacement(inserted.model, nodeId), record);
  }
  assert.strictEqual(api.getChildrenRoot(inserted.model, "other"), unrelatedRoot);
  assert.ok(sequence.pages(api.getChildrenRoot(inserted.model, "large")).includes(distantPage));
  assert.deepEqual(audited(api, base), original);
});

test("P107a2 reorders one large sibling sequence without replacing placement records", () => {
  const c = context();
  const api = c.PocketStarlingPlacementShadow;
  const sequence = c.PocketStarlingSequenceShadow;
  const relation = largeRelation();
  const base = api.build(relation, { capacity: 4 }).model;
  const original = audited(api, base);
  const records = recordReferences(api, base, relation.nodeIds);
  const unrelatedRoot = api.getChildrenRoot(base, "other");
  const distantPage = sequence.pages(api.getChildrenRoot(base, "large")).at(-1);
  const reordered = api.reorder(base, "child-0", 0, 5);
  const expected = largeRelation();
  expected.children.large.splice(0, 1);
  expected.children.large.splice(4, 0, "child-0");

  assert.equal(reordered.ok, true);
  assert.deepEqual(audited(api, reordered.model), canonicalRelation(expected));
  for (const [nodeId, record] of records) {
    assert.strictEqual(api.getPlacement(reordered.model, nodeId), record);
  }
  assert.strictEqual(api.getChildrenRoot(reordered.model, "other"), unrelatedRoot);
  assert.ok(sequence.pages(api.getChildrenRoot(reordered.model, "large")).includes(distantPage));
  assert.deepEqual(audited(api, base), original);
  assert.deepEqual(plain(api.reorder(base, "child-0", 1, 5)), {
    ok: false,
    reason: "placement-membership-mismatch"
  });
  assert.deepEqual(audited(api, base), original);
});

test("P107a2 moves a large branch without touching its descendant records or sequences", () => {
  const c = context();
  const api = c.PocketStarlingPlacementShadow;
  const relation = branchRelation();
  const base = api.build(relation, { capacity: 4 }).model;
  const original = audited(api, base);
  const descendants = ["group-0", "group-8", "group-15", "leaf-0-0", "leaf-8-16", "leaf-15-31"];
  const records = recordReferences(api, base, descendants);
  const branchRecord = api.getPlacement(base, "branch");
  const branchChildren = api.getChildrenRoot(base, "branch");
  const groupChildren = api.getChildrenRoot(base, "group-8");
  const unrelatedRoot = api.getChildrenRoot(base, "unrelated");
  const moved = api.move(base, "branch", 0, "destination", 1);

  assert.equal(moved.ok, true);
  assert.equal(api.getPlacement(moved.model, "branch").nodeId, "branch");
  assert.equal(api.getPlacement(moved.model, "branch").parentId, "destination");
  assert.notStrictEqual(api.getPlacement(moved.model, "branch"), branchRecord);
  for (const [nodeId, record] of records) {
    assert.strictEqual(api.getPlacement(moved.model, nodeId), record);
  }
  assert.strictEqual(api.getChildrenRoot(moved.model, "branch"), branchChildren);
  assert.strictEqual(api.getChildrenRoot(moved.model, "group-8"), groupChildren);
  assert.strictEqual(api.getChildrenRoot(moved.model, "unrelated"), unrelatedRoot);
  assert.deepEqual(audited(api, moved.model).children.source, ["source-sibling"]);
  assert.deepEqual(audited(api, moved.model).children.destination, ["destination-sibling", "branch"]);
  assert.deepEqual(audited(api, base), original);

  assert.deepEqual(plain(api.move(base, "branch", 0, "group-0", 0)), {
    ok: false,
    reason: "move-would-cycle"
  });
  assert.deepEqual(audited(api, base), original);
});

test("P107a2 repeated local mutations are repeatable and never mutate their base", () => {
  const c = context();
  const api = c.PocketStarlingPlacementShadow;
  const large = largeRelation();
  const largeBase = api.build(large, { capacity: 4 }).model;
  const largeOriginal = audited(api, largeBase);
  const firstReorder = api.reorder(largeBase, "child-0", 0, 5).model;
  const secondReorder = api.reorder(largeBase, "child-0", 0, 5).model;

  assert.deepEqual(audited(api, firstReorder), audited(api, secondReorder));
  assert.deepEqual(audited(api, largeBase), largeOriginal);

  const branch = branchRelation();
  const branchBase = api.build(branch, { capacity: 4 }).model;
  const branchOriginal = audited(api, branchBase);
  const firstMove = api.move(branchBase, "branch", 0, "destination", 1).model;
  const secondMove = api.move(branchBase, "branch", 0, "destination", 1).model;

  assert.deepEqual(audited(api, firstMove), audited(api, secondMove));
  assert.deepEqual(audited(api, branchBase), branchOriginal);
});
