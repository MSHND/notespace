"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function api() {
  const context = { Object, Array, Math, Number, Set };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "js/pocket-starling-sequence-shadow.js"), "utf8"),
    context,
  );
  return context.PocketStarlingSequenceShadow;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function depths(page, depth = 0, out = []) {
  if (page.kind === "leaf") out.push(depth);
  else page.children.forEach((child) => depths(child, depth + 1, out));
  return out;
}

function heightBound(count, capacity) {
  if (count <= capacity) return 0;
  return Math.floor(Math.log(count / 2) / Math.log(Math.ceil(capacity / 2)));
}

function reorder(sequence, root, fromIndex, toIndex) {
  const requested = Math.max(0, Math.min(toIndex, root.count));
  const adjusted = requested > fromIndex ? requested - 1 : requested;
  const before = sequence.materialise(root, []);
  if (adjusted === fromIndex) return { root, order: before };
  const removed = sequence.removeAt(root, fromIndex);
  assert.equal(removed.ok, true);
  const inserted = sequence.insertAt(removed.root, adjusted, before[fromIndex]);
  assert.equal(inserted.ok, true);
  before.splice(fromIndex, 1);
  before.splice(adjusted, 0, inserted.root ? sequence.materialise(inserted.root, [])[adjusted] : "");
  return { root: inserted.root, order: before };
}

test("P132e rejects capacity two and builds only balanced C=3/C=4 roots", () => {
  const sequence = api();
  assert.deepEqual(plain(sequence.build(["a"], { capacity: 2 })), { ok: false, reason: "invalid-capacity" });
  assert.deepEqual(plain(sequence.build(["a"], { capacity: 2.5 })), { ok: false, reason: "invalid-capacity" });
  assert.equal(sequence.build([]).capacity, 4);
  for (const capacity of [3, 4]) {
    for (let size = 0; size <= 40; size += 1) {
      const items = Array.from({ length: size }, (_, index) => `n${index}`);
      const built = sequence.build(items, { capacity });
      assert.equal(built.ok, true, `${capacity}/${size}`);
      assert.equal(sequence.audit(built.root).ok, true, `${capacity}/${size}`);
      assert.deepEqual(plain(sequence.materialise(built.root)), items);
      const leafDepths = depths(built.root);
      assert.equal(Math.min(...leafDepths), Math.max(...leafDepths));
      assert.ok(sequence.height(built.root) <= heightBound(size, capacity));
    }
  }
});

test("P132e preserves B+ validity through adversarial fixed-size reorder and changing-size history", () => {
  const sequence = api();
  for (const capacity of [3, 4]) {
    let root = sequence.build(Array.from({ length: 24 }, (_, index) => `n${index}`), { capacity }).root;
    let expected = sequence.materialise(root, []);
    for (let step = 0; step < 160; step += 1) {
      const from = (step * 7 + 3) % expected.length, to = (step * 11 + 1) % (expected.length + 1);
      const requested = Math.max(0, Math.min(to, expected.length));
      const adjusted = requested > from ? requested - 1 : requested;
      const item = expected[from];
      const removed = sequence.removeAt(root, from);
      assert.equal(removed.ok, true);
      const inserted = sequence.insertAt(removed.root, adjusted, item);
      assert.equal(inserted.ok, true);
      root = inserted.root;
      expected.splice(from, 1); expected.splice(adjusted, 0, item);
      assert.equal(sequence.audit(root).ok, true, `${capacity}/reorder/${step}`);
      assert.deepEqual(plain(sequence.materialise(root)), expected);
      const leafDepths = depths(root);
      assert.equal(Math.min(...leafDepths), Math.max(...leafDepths));
      if (expected.length > capacity) assert.ok(sequence.height(root) <= heightBound(expected.length, capacity));
    }
    for (let step = 0; step < 120; step += 1) {
      if (step % 3 === 0 || expected.length === 0) {
        const item = `fresh-${capacity}-${step}`;
        const at = (step * 5) % (expected.length + 1);
        const inserted = sequence.insertAt(root, at, item);
        assert.equal(inserted.ok, true); root = inserted.root; expected.splice(at, 0, item);
      } else {
        const at = (step * 9 + 1) % expected.length;
        const removed = sequence.removeAt(root, at);
        assert.equal(removed.ok, true); root = removed.root; expected.splice(at, 1);
      }
      assert.equal(sequence.audit(root).ok, true, `${capacity}/mixed/${step}`);
      assert.deepEqual(plain(sequence.materialise(root)), expected);
      const leafDepths = depths(root);
      assert.equal(Math.min(...leafDepths), Math.max(...leafDepths));
      if (expected.length > capacity) assert.ok(sequence.height(root) <= heightBound(expected.length, capacity));
    }
  }
});

test("P132e full audit rejects repeated reachability and cycles", () => {
  const sequence = api();
  const shared = Object.freeze({ kind: "leaf", capacity: 3, count: 2, items: Object.freeze(["a", "b"]) });
  const repeated = Object.freeze({ kind: "branch", capacity: 3, count: 4, children: Object.freeze([shared, shared]) });
  assert.deepEqual(plain(sequence.audit(repeated)), { ok: false, reason: "invalid-sequence" });
  const loop = { kind: "branch", capacity: 3, count: 1, children: [] };
  loop.children.push(loop, shared);
  assert.deepEqual(plain(sequence.audit(loop)), { ok: false, reason: "invalid-sequence" });
});
