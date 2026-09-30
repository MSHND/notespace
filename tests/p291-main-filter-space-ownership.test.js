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

test("P291 initial plain Space is quietly consumed while Left/Right retain structural ownership", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Parent", B: "Child", C: "Other" });
  node(h, "B").parentId = "A";
  h.materialise();
  h.row("A").focus();

  const statuses = [];
  h.context.setStatus = (message, kind) => {
    statuses.push({ message: String(message || ""), kind: String(kind || "") });
  };

  h.reset();
  const space = h.keydown("A", " ");

  assert.equal(space.defaultPrevented, true, "plain Space is consumed so the page cannot scroll");
  assert.equal(h.search.value, "", "initial Space must not start a blank implicit filter");
  assert.equal(h.context.state.collapsed.has("A"), false, "plain Space no longer folds the selected node");
  assert.deepEqual(statuses, [], "plain Space must not emit fold-related Möbius feedback");
  assert.equal(h.counters.refreshMeta, 0);
  assert.equal(h.counters.fullRender, 0);
  assert.equal(h.pendingTimerCount(), 0);

  h.keydown(null, "ArrowLeft");
  assert.equal(h.context.state.collapsed.has("A"), true, "Left Arrow still collapses the selected parent");

  h.keydown(null, "ArrowRight");
  h.stop();

  assert.equal(h.context.state.collapsed.has("A"), false, "Right Arrow still expands the selected parent");
});

test("P291 Shift+Space remains unclaimed even when an implicit query exists", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Anchor", B: "Electrical Services", C: "Other" });
  h.materialise();
  h.row("A").focus();

  h.reset();
  for (const key of ["e", "l", "e"]) h.keydown("A", key);
  assert.equal(h.search.value, "ele");

  const event = h.keydown("A", " ", { shiftKey: true });
  h.stop();

  assert.equal(event.defaultPrevented, false, "Shift+Space stays unclaimed");
  assert.equal(h.search.value, "ele", "Shift+Space is not appended to the implicit filter");
  assert.equal(h.context.state.collapsed.size, 0);
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

test("P291 retires structural Space without adding another Space or filter owner", () => {
  const actions = source(ACTIONS);

  assert.equal((actions.match(/function isMainImplicitFilterCharacter\(/g) || []).length, 1);
  assert.equal((actions.match(/function settlePendingFilterBeforeMainCommand\(/g) || []).length, 1);
  assert.match(
    actions,
    /if \(key === " "\) return !ev\.shiftKey && cleanText\(currentMainFilterQueryRaw\(\), 120\)\.length > 0;/,
  );

  const handlerStart = actions.indexOf("function handleTreeKeydown(ev)");
  assert.ok(handlerStart >= 0);
  const handler = actions.slice(handlerStart);
  assert.equal(
    (handler.match(/&& \(ev\.key === " " \|\| ev\.code === "Space"\)/g) || []).length,
    1,
    "Main keeps one plain-Space routing branch",
  );

  const spaceStart = handler.indexOf('&& (ev.key === " " || ev.code === "Space")');
  const arrowStart = handler.indexOf('&& ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)', spaceStart);
  assert.ok(spaceStart >= 0 && arrowStart > spaceStart);
  const spaceBranch = handler.slice(spaceStart, arrowStart);
  assert.match(spaceBranch, /ev\.preventDefault\(\);\s*return;/);
  assert.doesNotMatch(spaceBranch, /collapsed|sortNodesForParent|renderTree|refreshMeta|persistPipSnapshot|setStatus/);

  assert.doesNotMatch(actions, /state\.(?:filter|searchQuery|filterQuery)\s*=/);
  assert.match(
    handler,
    /target\?\.isContentEditable \|\| \["input", "textarea", "select"\]\.includes\(targetTag\)[\s\S]{0,80}target === el\.search\) return;/,
    "focused Search/input ownership remains native",
  );
});
