"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
function load(file, context) { vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file }); }
function context() { const value = { JSON, Object, Array, Map, Set }; value.window = value; value.globalThis = value; vm.createContext(value); load("js/pocket-starling-placement-shadow.js", value); return value; }
function relation(count = 24) { const nodeIds = Array.from({ length: count }, (_, i) => `n${i}`); return { nodeIds, parents: Object.fromEntries(nodeIds.map((id) => [id, "root"])), children: { root: nodeIds.slice() } }; }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
test("P107 projects coherent placement and bounded ordered pages without numeric authority", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow, built = api.build(relation(), { capacity: 4 });
  assert.equal(built.ok, true); assert.deepEqual(plain(api.materialise(built.model).relation), relation());
  assert.ok(built.model.children.root.pages.every((page) => page.items.length <= 4));
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes("pocket-starling-placement-shadow.js"), false);
});
test("P107 repeated same-gap insertion keeps old model immutable and retains distant pages", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow; let model = api.build(relation(32), { capacity: 4 }).model; const original = plain(api.materialise(model).relation); const distant = api.pageIds(model, "root").at(-1);
  for (let i = 0; i < 20; i += 1) { const next = api.insert(model, `x${i}`, "root", 2); assert.equal(next.ok, true); model = next.model; }
  assert.deepEqual(plain(api.materialise(api.build(relation(32), { capacity: 4 }).model).relation), original);
  assert.ok(api.pageIds(model, "root").includes(distant)); assert.equal(api.materialise(model).relation.children.root.length, 52);
});
test("P107 reorder and branch move change only the root attachment, rejecting cycles", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow; const r = relation(12); r.nodeIds.push("branch", "desc", "other"); Object.assign(r.parents, { branch: "root", desc: "branch", other: "root" }); r.children.root.push("branch", "other"); r.children.branch = ["desc"];
  const before = api.build(r, { capacity: 4 }).model; const reordered = api.reorder(before, "n0", 5); assert.equal(reordered.ok, true); assert.equal(api.materialise(reordered.model).relation.children.root[5], "n0");
  const moved = api.move(before, "branch", "other", 0); assert.equal(moved.ok, true); const after = api.materialise(moved.model).relation; assert.equal(after.parents.branch, "other"); assert.equal(after.parents.desc, "branch"); assert.deepEqual(plain(after.children.branch), ["desc"]);
  assert.deepEqual(plain(api.move(before, "branch", "desc", 0)), { ok: false, reason: "move-would-cycle" }); assert.deepEqual(plain(api.materialise(before).relation), plain(r));
});
test("P107 fails closed for contradictory dual placement views", () => {
  const c = context(), api = c.PocketStarlingPlacementShadow; const r = relation(3); r.children.n1 = ["n0"]; assert.deepEqual(plain(api.build(r)), { ok: false, reason: "duplicate-ordered-membership" });
  const mismatch = relation(3); mismatch.parents.n0 = "n1"; assert.deepEqual(plain(api.build(mismatch)), { ok: false, reason: "placement-membership-mismatch" });
});
