"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ROOT = path.resolve(__dirname, "../../..");
const P360 = path.join(ROOT, "tests/p360-main-pe-owner-save-admission.test.js");
const range = require("../range-owner.cjs");

// Reuses accepted Pocket's real canonical PE, owner journal, P160 and P172
// Save machinery. This test harness is research only.
function productionHelpers() {
  let source = fs.readFileSync(P360, "utf8");
  const marker = 'const test = require("node:test");';
  assert.ok(source.includes(marker), "Accepted P360 harness has changed");
  source = source.replace(marker, "const test = () => {};");
  source += "\nmodule.exports={loadP180Helpers,installFixture,state,loadRealPeSurface,installPeSourceIdentity,materialiseAccepted};\n";
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", source)(
    createRequire(P360), moduleRecord, moduleRecord.exports, P360, path.dirname(P360)
  );
  return moduleRecord.exports;
}
async function openPocket() {
  const api = productionHelpers();
  const p180 = api.loadP180Helpers();
  const p176 = p180.loadP176Harness();
  const h = p176.productionHarness();
  api.installFixture(h.context);
  await p176.activateFresh(h);
  h.context.__p180State = api.state(h.context);
  p180.loadRealMainSaveSurface(h.context);
  api.installPeSourceIdentity(h.context);
  api.loadRealPeSurface(h.context);
  const node = h.context.nodeMap().get("b");
  assert.ok(node);
  const opened = JSON.parse(JSON.stringify(h.context.PocketNodePopoutModel.buildPayload(node)));
  assert.equal(opened.text, "Before\n  child");
  return { api, h, node, opened, state: api.state(h.context) };
}
function separateEdits(opened) {
  const a = range.startEditor("yjs", opened, "alice");
  const b = range.startEditor("automerge", opened, "bob");
  assert.equal(a.stage({
    id: "alice-word", start: 0, end: 6, before: "Before", after: "After"
  }).ok, true);
  assert.equal(b.stage({
    id: "bob-word", start: 9, end: 14, before: "child", after: "branch"
  }).ok, true);
  return [a.proposal(), b.proposal()];
}
for (const engine of ["yjs", "automerge"]) {
  test(engine + " reconciles disjoint human intents through real Pocket explicit Save",
    { timeout: 60000 }, async () => {
      const { api, h, node, opened, state } = await openPocket();
      const startingOps = state.ops.length;
      const startingCAS = h.routeCount("/pockets/head/compare-and-set");
      const prepared = await range.prepare(opened, separateEdits(opened), engine);
      assert.equal(prepared.ok, true, JSON.stringify(prepared));
      assert.equal(prepared.payload.text, "After\n  branch");
      assert.equal(node.details, "Before\n  child");
      assert.equal(state.ops.length, startingOps);
      assert.equal(h.routeCount("/pockets/head/compare-and-set"), startingCAS);
      const applied = h.context.PocketNodePopoutEditor.apply(prepared.payload, { returnDetails: true });
      assert.equal(applied.ok, true, JSON.stringify(applied));
      assert.equal(state.ops.length, startingOps + 1, "Pocket owns single canonical journal capture");
      const captured = state.ops.at(-1);
      const frozen = JSON.parse(JSON.stringify(
        h.context.freezePocketStarlingOwnerWorkingSetThrough(captured.seq).operations
      ));
      assert.deepEqual(frozen.map(o => o.type), ["payload"]);
      assert.equal(frozen[0].input.nodeId, "b");
      assert.equal(frozen[0].input.payload.editor.text, "After\n  branch");
      assert.equal(h.context.nodeMap().get("b-child").parentId, "b");
      assert.equal(h.context.nodeMap().get("unrelated").details, "unrelated content");
      assert.equal(h.routeCount("/pockets/head/compare-and-set"), startingCAS, "No implicit remote Save");
      const saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.equal(state.ops.length, 0, "Accepted Save retires only covered journal");
      assert.ok(h.routeCount("/pockets/head/compare-and-set") > startingCAS);
      const accepted = await api.materialiseAccepted(h.context);
      assert.equal(accepted.nodes.find(n => n.id === "b").editor.text, "After\n  branch");
      assert.equal(accepted.nodes.find(n => n.id === "b-child").parentId, "b");
      assert.equal(accepted.nodes.find(n => n.id === "unrelated").details, "unrelated content");
    }
  );
  test(engine + " explicit Undo reverses just Alice's change and preserves Bob's work",
    { timeout: 60000 }, async () => {
      const { api, h, node, opened, state } = await openPocket();
      const proposals = separateEdits(opened);
      const prepared = await range.prepare(opened, proposals, engine);
      assert.equal(prepared.ok, true);
      assert.equal(h.context.PocketNodePopoutEditor.apply(prepared.payload, { returnDetails: true }).ok, true);
      const firstSave = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
      assert.equal(firstSave.ok, true, JSON.stringify(firstSave));
      const latest = JSON.parse(JSON.stringify(h.context.PocketNodePopoutModel.buildPayload(node)));
      const inverse = range.proposeUndo(opened.text,
        proposals.flatMap(p => p.intents), "alice-word", latest
      );
      assert.equal(inverse.ok, true, JSON.stringify(inverse));
      const undoEditor = range.startEditor(engine, latest, "pocket-undo");
      assert.equal(undoEditor.stage(inverse.intent).ok, true);
      const undone = await range.prepare(latest, [undoEditor.proposal()], engine);
      assert.equal(undone.ok, true, JSON.stringify(undone));
      assert.equal(undone.payload.text, "Before\n  branch");
      assert.equal(state.ops.length, 0, "Undo proposal does not implicitly Save");
      assert.equal(h.context.PocketNodePopoutEditor.apply(undone.payload, { returnDetails: true }).ok, true);
      assert.equal(state.ops.length, 1);
      const secondSave = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
      assert.equal(secondSave.ok, true, JSON.stringify(secondSave));
      const accepted = await api.materialiseAccepted(h.context);
      assert.equal(accepted.nodes.find(n => n.id === "b").editor.text, "Before\n  branch");
      assert.equal(accepted.nodes.find(n => n.id === "unrelated").details, "unrelated content");
    }
  );
  test(engine + " holds overlapping intents without touching Pocket or Head",
    { timeout: 60000 }, async () => {
      const { h, opened, node, state } = await openPocket();
      const a = range.startEditor("yjs", opened, "alice");
      const b = range.startEditor("automerge", opened, "bob");
      assert.equal(a.stage({ id: "a", start: 0, end: 6, before: "Before", after: "After" }).ok, true);
      assert.equal(b.stage({ id: "b", start: 0, end: 6, before: "Before", after: "Other" }).ok, true);
      const casBefore = h.routeCount("/pockets/head/compare-and-set");
      const result = await range.prepare(opened, [a.proposal(), b.proposal()], engine);
      assert.equal(result.ok, false);
      assert.equal(result.reason, "human-conflict-hold");
      assert.deepEqual(result.ids, ["a", "b"]);
      assert.equal(node.details, opened.text);
      assert.equal(state.ops.length, 0);
      assert.equal(h.routeCount("/pockets/head/compare-and-set"), casBefore);
    }
  );
}
test("Same-position insertion by independent editors requires Pocket decision", async () => {
  const opened = { id: "b", text: "Hello world", originalUpdatedAt: "r1" };
  const a = range.startEditor("yjs", opened, "alice");
  const b = range.startEditor("automerge", opened, "bob");
  assert.equal(a.stage({ id: "a", start: 6, end: 6, before: "", after: "A" }).ok, true);
  assert.equal(b.stage({ id: "b", start: 6, end: 6, before: "", after: "B" }).ok, true);
  assert.equal((await range.prepare(opened, [a.proposal(), b.proposal()], "yjs")).reason,
    "human-conflict-hold");
});
test("Grapheme boundaries protect emoji and decomposed accents", async () => {
  const text = "Say 👩🏽‍💻 and cafe\u0301.";
  const opened = { id: "b", text, originalUpdatedAt: "r1" };
  const editor = range.startEditor("yjs", opened, "alice");
  const start = text.indexOf("👩");
  assert.equal(editor.stage({
    id: "bad", start: start + 1, end: start + 2,
    before: text.slice(start + 1, start + 2), after: "X"
  }).reason, "invalid-or-stale-range");
  const accent = text.indexOf("\u0301");
  assert.equal(editor.stage({
    id: "bad2", start: accent, end: accent + 1, before: "\u0301", after: "!"
  }).reason, "invalid-or-stale-range");
  assert.equal(editor.stage({
    id: "good", start, end: start + "👩🏽‍💻".length, before: "👩🏽‍💻", after: "person"
  }).ok, true);
  const prepared = await range.prepare(opened, [editor.proposal()], "yjs");
  assert.equal(prepared.ok, true);
  assert.equal(prepared.payload.text, "Say person and cafe\u0301.");
});
test("Duplicate IDs, changed target, stale revision, and forged preimage fail closed", async () => {
  const opened = { id: "b", text: "Before\n  child", originalUpdatedAt: "r1" };
  const editor = range.startEditor("yjs", opened, "alice");
  assert.equal(editor.stage({ id: "one", start: 0, end: 6, before: "Before", after: "After" }).ok, true);
  assert.equal(editor.stage({ id: "one", start: 9, end: 14, before: "child", after: "branch" }).reason,
    "overlap-or-duplicate");
  assert.equal(editor.stage({ id: "two", start: 0, end: 3, before: "Bef", after: "No" }).reason,
    "overlap-or-duplicate");
  const p = editor.proposal();
  assert.equal((await range.prepare({ ...opened, id: "other" }, [p], "yjs")).reason,
    "wrong-target-or-proposal");
  assert.equal((await range.prepare({ ...opened, originalUpdatedAt: "r2" }, [p], "yjs")).reason,
    "stale-opening");
  assert.equal((await range.prepare({ ...opened, text: "Elsewhere" }, [p], "yjs")).reason,
    "stale-opening");
  assert.equal((await range.prepare(opened, [{ ...p, intents: [{ ...p.intents[0], before: "WRONG" }] }], "yjs")).reason,
    "invalid-or-duplicate-intent");
});
test("Undo refuses unknown newer edits instead of guessing a rebased range", () => {
  const original = "Before\n  child";
  const latest = { id: "b", text: "After\n  elsewhere", originalUpdatedAt: "r2" };
  const intents = [
    { id: "a", actor: "alice", start: 0, end: 6, before: "Before", after: "After" },
    { id: "b", actor: "bob", start: 9, end: 14, before: "child", after: "branch" }
  ];
  assert.equal(range.proposeUndo(original, intents, "a", latest).reason,
    "newer-work-requires-rebase");
});
test("Research adapter cannot Save, Sync, publish or grant permissions", () => {
  const editor = range.startEditor("yjs",
    { id: "b", text: "Before", originalUpdatedAt: "r1" }, "alice");
  for (const action of ["save", "sync", "publish", "grant", "apply", "exportTree"]) {
    assert.equal(typeof editor[action], "undefined");
    assert.equal(typeof range[action], "undefined");
  }
});
