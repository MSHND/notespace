"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  makeHarness,
  setLabels,
  plain,
} = require("./p249-main-type-to-filter-unification.test.js");

const ROOT = path.resolve(__dirname, "..");
const OVERLAYS = "js/pocket-overlays-init.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function bindMainExactlyAsOverlaysDoes(h) {
  const overlays = source(OVERLAYS);
  const match = overlays.match(/el\.treeWrap\?\.addEventListener\("keydown", handleTreeKeydown\);/);
  assert.ok(match, "canonical overlays Main keydown binding exists");

  h.treeWrap.listeners.set("keydown", []);
  vm.runInContext(match[0], h.context, { filename: OVERLAYS });
  assert.equal((h.treeWrap.listeners.get("keydown") || []).length, 1, "one Main keydown binding is installed");
}

test("P272f composed Main binding gives exactly one Backspace semantic effect per event", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Bravo", C: "Charlie" });
  bindMainExactlyAsOverlaysDoes(h);
  h.materialise();
  h.row("A").focus();

  let deletes = 0;
  h.context.deleteSelected = () => {
    deletes += 1;
    return true;
  };

  const originalApply = h.context.applyPocketFilterQueryValue;
  const applied = [];
  h.context.applyPocketFilterQueryValue = (value, options = {}) => {
    applied.push(String(value));
    return originalApply(value, options);
  };

  const nodesBefore = plain(h.context.state.nodes);
  h.reset();

  h.keydown("A", "a");
  h.keydown("A", "l");
  assert.equal(h.search.value, "al", "Main typing composes through the existing Filter owner");
  h.runPendingTimers();
  assert.equal(h.search.value, "al");
  assert.equal(h.context.state.selectedId, "A");

  applied.length = 0;
  h.keydown("A", "Backspace");
  assert.equal(h.search.value, "a", "one composed Backspace must remove exactly one character");
  assert.deepEqual(applied, ["a"], "one event reaches the Filter owner exactly once");
  assert.equal(deletes, 0, "active Filter Backspace must not delete the node");
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
  h.runPendingTimers();
  assert.equal(h.search.value, "a");

  applied.length = 0;
  h.keydown("A", "Backspace");
  assert.equal(h.search.value, "", "final Filter character is removed by one event");
  assert.deepEqual(applied, [""], "final-character event reaches the Filter owner exactly once");
  assert.equal(deletes, 0, "final-character removal must not cascade into delete");
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);

  applied.length = 0;
  h.keydown("A", "Backspace");
  assert.equal(h.search.value, "");
  assert.deepEqual(applied, [], "already-empty Backspace does not re-enter Filter editing");
  assert.equal(deletes, 1, "only the later already-empty Backspace routes once to deleteSelected");
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore, "delete owner is stubbed so only routing is measured");

  h.stop();
  assert.equal(h.counters.saveWorkspace, 0, "Filter editing remains non-dirty");
  assert.ok(
    h.document.activeElement === h.treeWrap || h.document.activeElement === h.row("A"),
    "Main keyboard ownership remains coherent"
  );
});
