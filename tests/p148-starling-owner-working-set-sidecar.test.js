"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), { createProductionReleaseManifest } = require("../sync-service/pocket-sync-production-server.js");
const ROOT = path.resolve(__dirname, ".."), MODULE = "js/pocket-starling-owner-working-set-shadow.js";

function runtime() {
  const context = { Object, Array, String, Number, Boolean, Map, Set, Error, Function, Reflect, JSON };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, MODULE), "utf8"), context, { filename: MODULE });
  return context;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function code(error, value) { return error && error.code === value; }
function deeplyFrozen(value) {
  if (!value || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.keys(value).every((key) => deeplyFrozen(value[key]));
}

test("P148 exposes only the frozen owner-working journal surface", () => {
  const context = runtime(), module = context.PocketStarlingOwnerWorkingSetShadow, journal = module.createJournal();
  assert.deepEqual(Object.keys(module), ["createJournal"]);
  assert.equal(Object.isFrozen(module), true);
  assert.equal(module.createJournal.length, 0);
  assert.equal(Object.isFrozen(journal), true);
  assert.deepEqual(Object.keys(journal), ["capture", "discardUncovered", "retainAfter", "freezeThrough", "reset", "invalidate"]);
  assert.deepEqual(Object.values(journal).map((method) => method.length), [2, 2, 1, 1, 0, 0]);
});

test("P148 captures a detached deeply frozen invocation-time operation list", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  const supplied = [{ arbitrary: { nested: ["first", { stable: true }] }, labels: ["one"] }];
  journal.capture(7, supplied);
  supplied[0].arbitrary.nested[1].stable = false;
  supplied[0].labels.push("caller-only");
  supplied.push({ arbitrary: "caller-only" });
  const frozen = journal.freezeThrough(7);
  assert.deepEqual(plain(frozen), { ceiling: 7, operations: [{ arbitrary: { nested: ["first", { stable: true }] }, labels: ["one"] }] });
  assert.equal(deeplyFrozen(frozen), true);
  assert.notEqual(frozen.operations[0], supplied[0]);
  assert.notEqual(frozen.operations[0].arbitrary, supplied[0].arbitrary);
});

test("P148 replaces a sequence atomically and preserves earlier snapshots", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  journal.capture(12, [{ phase: "draft", nested: { value: 1 } }]);
  const earlier = journal.freezeThrough(12);
  journal.capture(12, [{ phase: "final-one" }, { phase: "final-two", values: [2, 3] }]);
  assert.deepEqual(plain(earlier), { ceiling: 12, operations: [{ phase: "draft", nested: { value: 1 } }] });
  assert.deepEqual(plain(journal.freezeThrough(12)), { ceiling: 12, operations: [{ phase: "final-one" }, { phase: "final-two", values: [2, 3] }] });
});

test("P148 freezes sparse records in numeric sequence order without semantic metadata", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  journal.capture(90, [{ arbitrary: "ninety-a" }, { arbitrary: "ninety-b" }]);
  journal.capture(4, [{ arbitrary: "four" }]);
  journal.capture(31, [{ arbitrary: "thirty-one-a" }, { arbitrary: "thirty-one-b" }]);
  const frozen = journal.freezeThrough(90);
  assert.deepEqual(plain(frozen.operations), [{ arbitrary: "four" }, { arbitrary: "thirty-one-a" }, { arbitrary: "thirty-one-b" }, { arbitrary: "ninety-a" }, { arbitrary: "ninety-b" }]);
  assert.equal(frozen.operations.some((operation) => Object.prototype.hasOwnProperty.call(operation, "seq")), false);
});

test("P148 freezes through a save ceiling while later work stays pending and detached", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  journal.capture(3, [{ value: "below" }]);
  journal.capture(8, [{ value: "at" }]);
  journal.capture(13, [{ value: "future" }]);
  const saved = journal.freezeThrough(8);
  journal.capture(13, [{ value: "replaced-future" }]);
  journal.capture(21, [{ value: "later" }]);
  assert.deepEqual(plain(saved), { ceiling: 8, operations: [{ value: "below" }, { value: "at" }] });
  assert.deepEqual(plain(journal.freezeThrough(21)), { ceiling: 21, operations: [{ value: "below" }, { value: "at" }, { value: "replaced-future" }, { value: "later" }] });
});

test("P148 retains only post-save work and blocks settled sequence resurrection", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  journal.capture(2, [{ value: "two" }]);
  journal.capture(9, [{ value: "nine" }]);
  journal.capture(15, [{ value: "fifteen" }]);
  assert.equal(journal.retainAfter(9), 1);
  assert.deepEqual(plain(journal.freezeThrough(15)), { ceiling: 15, operations: [{ value: "fifteen" }] });
  assert.equal(journal.retainAfter(4), 1);
  assert.throws(() => journal.capture(9, [{ value: "resurrect" }]), (error) => code(error, "owner-working-set-sequence-settled"));
  assert.throws(() => journal.capture(4, [{ value: "old" }]), (error) => code(error, "owner-working-set-sequence-settled"));
  journal.capture(16, [{ value: "sixteen" }]);
  assert.deepEqual(plain(journal.freezeThrough(16).operations), [{ value: "fifteen" }, { value: "sixteen" }]);
});

test("P148 discards only uncovered currently pending material", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  journal.capture(4, [{ value: "four" }]);
  journal.capture(7, [{ value: "seven" }]);
  journal.capture(10, [{ value: "ten" }]);
  assert.equal(journal.discardUncovered(7, 0), true);
  assert.equal(journal.discardUncovered(7, 0), false);
  assert.equal(journal.discardUncovered(4, 4), false);
  assert.deepEqual(plain(journal.freezeThrough(10).operations), [{ value: "four" }, { value: "ten" }]);
  assert.equal(journal.retainAfter(4), 1);
  assert.equal(journal.discardUncovered(4, 0), false);
  assert.deepEqual(plain(journal.freezeThrough(10).operations), [{ value: "ten" }]);
});

test("P148 reset keeps a journal usable while invalidation is terminal and idempotent", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  journal.capture(5, [{ value: "pending" }]);
  journal.retainAfter(5);
  assert.equal(journal.reset(), true);
  journal.capture(5, [{ value: "reusable" }]);
  assert.deepEqual(plain(journal.freezeThrough(5).operations), [{ value: "reusable" }]);
  assert.equal(journal.invalidate(), true);
  assert.equal(journal.invalidate(), true);
  for (const call of [
    () => journal.capture(6, [{ value: "blocked" }]),
    () => journal.freezeThrough(6),
    () => journal.retainAfter(6),
    () => journal.discardUncovered(6, 0),
    () => journal.reset(),
  ]) assert.throws(call, (error) => code(error, "owner-working-set-invalidated"));
});

test("P148 rejects invalid inputs atomically while preserving arbitrary JSON-compatible fields", () => {
  const journal = runtime().PocketStarlingOwnerWorkingSetShadow.createJournal();
  journal.capture(20, [{ unexpected: { fields: ["remain", 42, false, null] } }]);
  const before = plain(journal.freezeThrough(20));
  const invalidSequences = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1];
  for (const sequence of invalidSequences) assert.throws(() => journal.capture(sequence, [{ value: "bad" }]), (error) => code(error, "owner-working-set-input-invalid"));
  for (const ceiling of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => journal.freezeThrough(ceiling), (error) => code(error, "owner-working-set-input-invalid"));
  for (const ceiling of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => journal.discardUncovered(20, ceiling), (error) => code(error, "owner-working-set-input-invalid"));
  const cyclic = {}; cyclic.self = cyclic;
  for (const operations of [null, [], ["not-object"], [{ value: undefined }], [{ value: () => {} }], [{ value: Symbol("x") }], [{ value: 1n }], [{ value: NaN }], [{ value: Infinity }], [cyclic]]) assert.throws(() => journal.capture(21, operations), (error) => code(error, "owner-working-set-input-invalid"));
  assert.deepEqual(plain(journal.freezeThrough(20)), before);
});

test("P148 remains memory-only, dormant, and proportional to pending records", () => {
  const context = runtime(), journal = context.PocketStarlingOwnerWorkingSetShadow.createJournal();
  for (let index = 1; index <= 4000; index += 1) journal.capture(index * 3, [{ marker: index, nested: { stable: true } }]);
  const frozen = journal.freezeThrough(12000);
  assert.equal(frozen.operations.length, 4000);
  assert.equal(journal.retainAfter(6000), 2000);
  assert.equal(journal.freezeThrough(12000).operations.length, 2000);
  const source = fs.readFileSync(path.join(ROOT, MODULE), "utf8"), manifest = createProductionReleaseManifest({ browserRoot: ROOT, serviceRoot: "/pocket-sync/v1" });
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").includes(MODULE), false);
  assert.equal(manifest.some((entry) => entry.path === `/${MODULE}`), false);
  for (const entry of manifest.filter((value) => value.path.endsWith(".js"))) assert.equal(fs.readFileSync(path.join(ROOT, `.${entry.path}`), "utf8").includes("PocketStarlingOwnerWorkingSetShadow"), false, entry.path);
  for (const forbidden of ["state", "localStorage", "indexedDB", "PictureInPicture", "Vault", "Recovery", "RemoteSave", "fetch(", "XMLHttpRequest", "WebSocket"]) assert.equal(source.includes(forbidden), false, forbidden);
});
