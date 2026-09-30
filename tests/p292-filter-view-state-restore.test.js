"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  makeHarness,
  setLabels,
} = require("./p249-main-type-to-filter-unification.test.js");

const ROOT = path.resolve(__dirname, "..");
const ACTIONS = "js/pocket-tree-actions.js";
const STATE = "js/pocket-state.js";
const STORAGE = "js/pocket-storage.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function node(h, id) {
  const found = h.context.state.nodes.find((entry) => entry.id === id);
  assert.ok(found, `node ${id} exists`);
  return found;
}

function collapsedIds(h) {
  return Array.from(h.context.state.collapsed).sort();
}

function makeMixedHarness(options = {}) {
  const h = makeHarness({
    unrelatedCount: 3,
    selectedId: "A",
    ...options,
  });
  setLabels(h, {
    A: "Already Open",
    B: "Selected Branch",
    C: "Unrelated Branch",
    U0: "Quiet Child",
    U1: "Match Selected",
    U2: "Match Unrelated",
  });
  node(h, "U0").parentId = "A";
  node(h, "U1").parentId = "B";
  node(h, "U2").parentId = "C";
  h.context.state.collapsed = new Set(["B", "C"]);
  h.materialise();
  return h;
}

function beginMatchingFilter(h, query = "match") {
  h.context.applyPocketFilterQueryValue(query, { keepMainFocus: true });
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "U1");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B", "U1", "C", "U2"]);
}

function assertRestoredAroundCurrentSelection(h) {
  assert.equal(h.search.value, "");
  assert.equal(h.context.state.selectedId, "U1", "current filtered selection remains current");
  assert.deepEqual(collapsedIds(h), ["C"], "only the selected path is reopened from the pre-filter snapshot");
  assert.equal(h.context.state.collapsed.has("A"), false, "pre-filter open branch remains open");
  assert.equal(h.context.state.collapsed.has("B"), false, "selected node ancestor opens only as needed");
  assert.equal(h.context.state.collapsed.has("C"), true, "unrelated branch exposed only by filtering closes again");
  assert.deepEqual(
    h.context.getVisibleNodeIdsInRenderOrder(),
    ["A", "U0", "B", "U1", "C"],
    "full tree returns with unrelated collapsed branch hidden",
  );
  assert.equal(h.counters.saveWorkspace, 0, "temporary filter view restoration is not durable workspace persistence");
}

test("P292 Escape restores the exact pre-filter view then opens only the current selected path", () => {
  const h = makeMixedHarness();
  h.reset();
  beginMatchingFilter(h);

  h.keydown("U1", "Escape");
  h.stop();

  assertRestoredAroundCurrentSelection(h);
  assert.equal(h.pendingTimerCount(), 0);
});

test("P292 Backspace-to-empty uses the same restore-before-reveal owner", () => {
  const h = makeMixedHarness();
  h.reset();

  h.context.applyPocketFilterQueryValue("m", { keepMainFocus: true });
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "U1");

  h.keydown("U1", "Backspace");
  h.stop();

  assertRestoredAroundCurrentSelection(h);
  assert.equal(h.pendingTimerCount(), 0);
});

test("P292 visible Search input clear uses the same restore-before-reveal owner", () => {
  const h = makeMixedHarness();
  h.search.focus();
  h.reset();

  h.inputFilter("match");
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "U1");

  h.inputFilter("");
  h.runPendingTimers();
  h.stop();

  assertRestoredAroundCurrentSelection(h);
});

test("P292 copy-loop clear restores pre-filter view without rewinding the current match", () => {
  const h = makeMixedHarness({ copyIds: ["U1"] });
  h.reset();
  beginMatchingFilter(h);

  h.keydown("U1", "Enter");
  h.stop();

  assertRestoredAroundCurrentSelection(h);
  assert.deepEqual(h.copiedTexts, ["Match Selected"]);
  assert.equal(h.pendingTimerCount(), 0);
});

test("P292 filter-session collapse snapshot is captured once and is immutable across later filter activity", () => {
  const h = makeMixedHarness();
  h.reset();

  h.context.applyPocketFilterQueryValue("m", { keepMainFocus: true });
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "U1");

  // Simulate transient filtered-view collapse/navigation changes after the session began.
  h.context.state.collapsed = new Set(["A"]);
  h.context.applyPocketFilterQueryValue("ma", { keepMainFocus: true });
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "U1");

  h.keydown("U1", "Escape");
  h.stop();

  assertRestoredAroundCurrentSelection(h);
});

test("P292 missing current selection restores pre-filter collapse state and leaves fallback to the existing render owner", () => {
  const h = makeMixedHarness();
  h.reset();
  beginMatchingFilter(h);

  h.context.state.nodes = h.context.state.nodes.filter((entry) => entry.id !== "U1");
  h.keydown(null, "Escape");
  h.stop();

  assert.equal(h.search.value, "");
  assert.deepEqual(collapsedIds(h), ["B", "C"], "no selected path is invented when the current result disappeared");
  assert.equal(h.context.state.selectedId, "A", "existing ordinary render fallback chooses a safe visible selection");
  assert.equal(h.context.state.collapsed.has("A"), false);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P292 collapse snapshot remains transient runtime filter memory, not canonical or durable state", () => {
  const actions = source(ACTIONS);
  const stateSource = source(STATE);
  const storage = source(STORAGE);

  assert.match(actions, /let filterCollapsedSnapshot = null;/);
  assert.match(actions, /filterCollapsedSnapshot = Object\.freeze\(/);
  assert.match(actions, /function restoreFilterViewStateOnClear\(\)/);

  const restoreStart = actions.indexOf("function restoreFilterViewStateOnClear()");
  const restoreEnd = actions.indexOf("\nfunction ", restoreStart + 20);
  const restoreBody = actions.slice(restoreStart, restoreEnd);
  assert.match(restoreBody, /state\.collapsed = new Set\(snapshot\.filter/);
  assert.match(restoreBody, /expandPathToNode\(targetId\)/);
  assert.ok(
    restoreBody.indexOf("state.collapsed = new Set") < restoreBody.indexOf("expandPathToNode(targetId)"),
    "restore occurs before the selected ancestor path is reopened",
  );
  assert.doesNotMatch(restoreBody, /saveWorkspaceState|persistPipSnapshot|recordOp|PocketSync|operation/);

  assert.doesNotMatch(stateSource, /filterCollapsedSnapshot/);
  assert.doesNotMatch(storage, /filterCollapsedSnapshot/);
});
