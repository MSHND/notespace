"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function api() {
  const context = { Object, Array, Math };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "js/pocket-starling-sequence-shadow.js"), "utf8"),
    context
  );
  return context.PocketStarlingSequenceShadow;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function validatePage(page, capacity) {
  assert.ok(page.kind === "leaf" || page.kind === "branch");
  assert.equal(page.capacity, capacity);
  assert.ok(Object.isFrozen(page));

  if (page.kind === "leaf") {
    assert.ok(page.items.length <= capacity);
    assert.ok(Object.isFrozen(page.items));
    assert.equal(page.count, page.items.length);
    return page.count;
  }

  assert.ok(page.children.length <= capacity);
  assert.ok(Object.isFrozen(page.children));
  const descendants = page.children.reduce(
    (total, child) => total + validatePage(child, capacity),
    0
  );
  assert.equal(page.count, descendants);
  return descendants;
}

function reachablePages(sequence, root) {
  return new Set(sequence.pages(root));
}

function distantReferences(sequence, root) {
  const pages = sequence.pages(root);
  return {
    leaf: pages.filter((page) => page.kind === "leaf").at(-1),
    branch: pages.filter((page) => page.kind === "branch" && page !== root).at(-1)
  };
}

function newPageCount(before, after) {
  let count = 0;
  for (const page of after) {
    if (!before.has(page)) count += 1;
  }
  return count;
}

function logicalShape(page) {
  if (page.kind === "leaf") {
    return { kind: page.kind, count: page.count, items: [...page.items] };
  }
  return {
    kind: page.kind,
    count: page.count,
    children: page.children.map(logicalShape)
  };
}

test("P107a1b builds a frozen bounded multi-level sequence with exact counts", () => {
  const sequence = api();
  const items = Array.from({ length: 1024 }, (_, index) => `n${index}`);
  const built = sequence.build(items, { capacity: 4 });

  assert.equal(built.ok, true);
  assert.deepEqual(plain(sequence.materialise(built.root)), items);
  assert.ok(sequence.height(built.root) > 2);
  assert.equal(validatePage(built.root, 4), items.length);
});

test("P107a1b same-gap inserts path-copy locally through root growth", () => {
  const sequence = api();
  const items = Array.from({ length: 1024 }, (_, index) => `n${index}`);
  const base = sequence.build(items, { capacity: 4 }).root;
  const distant = distantReferences(sequence, base);
  const baseShape = plain(logicalShape(base));
  const baseHeight = sequence.height(base);
  let root = base;
  const expected = [...items];

  assert.ok(distant.leaf);
  assert.ok(distant.branch);

  for (let index = 0; index < 200; index += 1) {
    const before = reachablePages(sequence, root);
    const oldHeight = sequence.height(root);
    const next = sequence.insertAt(root, 2, `x${index}`);

    assert.equal(next.ok, true);
    if (index === 0 || index === 99 || index === 199) {
      assert.ok(
        newPageCount(before, reachablePages(sequence, next.root)) <= (2 * (oldHeight + 1)) + 1,
        "same-gap insertion only creates a bounded local path"
      );
    }

    root = next.root;
    expected.splice(2, 0, `x${index}`);
    if (index === 0 || index === 99 || index === 199) {
      assert.deepEqual(plain(sequence.materialise(root)), expected);
      assert.equal(validatePage(root, 4), expected.length);
    }
  }

  assert.ok(sequence.height(root) > baseHeight, "a full root splits as the sequence grows");
  const finalPages = reachablePages(sequence, root);
  assert.ok(finalPages.has(distant.leaf));
  assert.ok(finalPages.has(distant.branch));
  assert.deepEqual(plain(sequence.materialise(root)), expected);
  assert.deepEqual(plain(sequence.materialise(base)), items);
  assert.deepEqual(plain(logicalShape(base)), baseShape);
});

test("P107a1b removal path-copies locally and retains untouched distant pages", () => {
  const sequence = api();
  const items = Array.from({ length: 1024 }, (_, index) => `n${index}`);
  const base = sequence.build(items, { capacity: 4 }).root;
  const distant = distantReferences(sequence, base);
  const before = reachablePages(sequence, base);
  const baseShape = plain(logicalShape(base));
  const next = sequence.removeAt(base, 2);
  const after = reachablePages(sequence, next.root);

  assert.equal(next.ok, true);
  assert.ok(newPageCount(before, after) <= sequence.height(base) + 2);
  assert.ok(after.has(distant.leaf));
  assert.ok(after.has(distant.branch));
  assert.deepEqual(
    plain(sequence.materialise(next.root)),
    items.filter((_, index) => index !== 2)
  );
  assert.equal(validatePage(next.root, 4), items.length - 1);
  assert.deepEqual(plain(sequence.materialise(base)), items);
  assert.deepEqual(plain(logicalShape(base)), baseShape);

  const single = sequence.build(["only"], { capacity: 4 }).root;
  const empty = sequence.removeAt(single, 0).root;
  assert.equal(empty.kind, "leaf");
  assert.deepEqual(plain(sequence.materialise(empty)), []);
  assert.equal(validatePage(empty, 4), 0);
});

test("P107a1b repeated operations are repeatable and leave every prior root unchanged", () => {
  const sequence = api();
  const items = Array.from({ length: 64 }, (_, index) => `n${index}`);
  const base = sequence.build(items, { capacity: 4 }).root;
  const baseShape = plain(logicalShape(base));
  const firstInsert = sequence.insertAt(base, 2, "same").root;
  const secondInsert = sequence.insertAt(base, 2, "same").root;
  const firstRemove = sequence.removeAt(base, 2).root;
  const secondRemove = sequence.removeAt(base, 2).root;

  assert.deepEqual(plain(logicalShape(firstInsert)), plain(logicalShape(secondInsert)));
  assert.deepEqual(plain(logicalShape(firstRemove)), plain(logicalShape(secondRemove)));
  assert.deepEqual(plain(logicalShape(base)), baseShape);
  assert.deepEqual(plain(sequence.materialise(base)), items);
});

test("P107a1b retains non-default capacity intrinsically across mutation", () => {
  const sequence = api();
  const items = Array.from({ length: 32 }, (_, index) => `n${index}`);
  const base = sequence.build(items, { capacity: 8 }).root;
  const next = sequence.insertAt(base, 4, "x").root;

  assert.equal(next.capacity, 8);
  assert.equal(validatePage(next, 8), items.length + 1);
  assert.deepEqual(
    plain(sequence.materialise(next)),
    ["n0", "n1", "n2", "n3", "x", ...items.slice(4)]
  );
});
