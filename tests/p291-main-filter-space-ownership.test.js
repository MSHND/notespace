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

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function node(h, id) {
  const found = h.context.state.nodes.find((entry) => entry.id === id);
  assert.ok(found, `node ${id} exists`);
  return found;
}

test("P291 Main routes in-query Space through the existing implicit Filter owner", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, {
    A: "Anchor",
    B: "Electrical Services",
    C: "Other",
  });
  h.materialise();
  h.row("A").focus();

  const statuses = [];
  h.context.setStatus = (message, kind) => {
    statuses.push({ message: String(message || ""), kind: String(kind || "") });
  };

  h.reset();
  for (const key of ["e", "l", "e", " ", "s", "e", "r"]) {
    const event = h.keydown("A", key);
    assert.equal(event.defaultPrevented, true, `${JSON.stringify(key)} is consumed by the existing filter owner`);
  }

  assert.equal(h.search.value, "ele ser");
  assert.equal(h.pendingTimerCount(), 1, "rapid typing still converges to one pending Filter repaint");
  assert.equal(h.document.activeElement, h.treeWrap);
  assert.deepEqual(statuses, [], "in-query Space must not reach fold/unfold feedback");
  assert.equal(h.context.state.collapsed.size, 0, "in-query Space must not mutate fold state");

  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B"]);
  assert.equal(h.context.state.selectedId, "B", "existing P267 matcher selects the actual multi-term match");
  assert.equal(h.document.activeElement, h.treeWrap);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P291 initial Space with an empty implicit query keeps the existing fold/unfold owner", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Parent", B: "Child", C: "Other" });
  node(h, "B").parentId = "A";
  h.materialise();
  h.row("A").focus();

  h.reset();
  const event = h.keydown("A", " ");
  h.stop();

  assert.equal(event.defaultPrevented, true);
  assert.equal(h.search.value, "");
  assert.equal(h.context.state.collapsed.has("A"), true, "initial Space still folds the selected parent");
  assert.equal(h.pendingTimerCount(), 0);
});

test("P291 preserves Backspace, Escape, immediate Arrow and Enter behaviour after an in-query Space", () => {
  const arrow = makeHarness({ selectedId: "A" });
  setLabels(arrow, {
    A: "Anchor",
    B: "Electrical Services",
    C: "Electrical Contract Services",
  });
  arrow.materialise();
  arrow.row("A").focus();

  arrow.reset();
  for (const key of ["e", "l", "e", " ", "s", "e", "r"]) arrow.keydown("A", key);
  arrow.keydown("A", "ArrowDown");
  assert.equal(arrow.search.value, "ele ser");
  assert.deepEqual(arrow.context.getVisibleNodeIdsInRenderOrder(), ["B", "C"]);
  assert.equal(arrow.context.state.selectedId, "C");
  assert.equal(arrow.pendingTimerCount(), 0);

  arrow.keydown("C", "Backspace");
  assert.equal(arrow.search.value, "ele se");
  arrow.runPendingTimers();
  arrow.keydown("C", "Escape");
  arrow.stop();

  assert.equal(arrow.search.value, "");
  assert.equal(arrow.context.state.selectedId, "C");

  const enter = makeHarness({ selectedId: "A", copyIds: ["B"] });
  setLabels(enter, { A: "Anchor", B: "Electrical Services", C: "Other" });
  enter.materialise();
  enter.row("A").focus();

  enter.reset();
  for (const key of ["e", "l", "e", " ", "s", "e", "r"]) enter.keydown("A", key);
  enter.keydown("A", "Enter");
  enter.stop();

  assert.equal(enter.context.state.selectedId, "B");
  assert.equal(enter.counters.copied, 1);
  assert.deepEqual(enter.copiedTexts, ["Electrical Services"]);
  assert.equal(enter.search.value, "");
  assert.equal(enter.pendingTimerCount(), 0);
});

test("P291 keeps exactly one implicit-filter owner and one selected-node Space owner", () => {
  const actions = source(ACTIONS);

  assert.equal((actions.match(/function isMainImplicitFilterCharacter\(/g) || []).length, 1);
  assert.equal((actions.match(/function settlePendingFilterBeforeMainCommand\(/g) || []).length, 1);
  assert.match(
    actions,
    /if \(key === " "\) return cleanText\(currentMainFilterQueryRaw\(\), 120\)\.length > 0;/,
  );

  const handlerStart = actions.indexOf("function handleTreeKeydown(ev)");
  assert.ok(handlerStart >= 0);
  const handler = actions.slice(handlerStart);
  assert.equal(
    (handler.match(/&& \(ev\.key === " " \|\| ev\.code === "Space"\)/g) || []).length,
    1,
    "selected-node fold/unfold keeps one Space owner",
  );
});
