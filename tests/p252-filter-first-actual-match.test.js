"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  makeHarness,
  setLabels,
  plain,
} = require("./p249-main-type-to-filter-unification.test.js");

const ROOT = path.resolve(__dirname, "..");
const RENDER = "js/pocket-render.js";
const ACTIONS = "js/pocket-tree-actions.js";
const SMOOTH = "js/pocket-list-smoothing.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function node(h, id) {
  const found = h.context.state.nodes.find((entry) => entry.id === id);
  assert.ok(found, `node ${id} exists`);
  return found;
}

function configureContextMatchTree(h) {
  setLabels(h, {
    A: "Copy",
    B: "P252 COPIED OK",
    C: "Anchor",
  });
  node(h, "B").parentId = "A";
}

function typeMain(h, rowId, text) {
  for (const ch of String(text)) h.keydown(rowId, ch);
}

test("P252 context ancestor stays rendered but first actual descendant match becomes repaired selection", () => {
  const h = makeHarness({ selectedId: "C" });
  configureContextMatchTree(h);
  h.materialise();
  h.row("C").focus();

  const nodesBefore = plain(h.context.state.nodes);
  h.reset();
  typeMain(h, "C", "copied");
  assert.equal(h.search.value, "copied");
  assert.equal(h.pendingTimerCount(), 1);
  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.row("A").classList.contains("selected"), false, "context-only parent must not remain selected");
  assert.equal(h.row("B").classList.contains("selected"), true, "actual matching descendant is selected");
  assert.equal(h.document.activeElement, h.treeWrap, "Main keeps keyboard ownership after implicit Filter render");
  assert.equal(h.counters.saveWorkspace, 0);
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
});

test("P252 current visible actual match remains selected even when an earlier actual match exists", () => {
  const h = makeHarness({ selectedId: "B" });
  setLabels(h, {
    A: "Match First",
    B: "Match Current",
    C: "Other",
  });
  h.materialise();

  h.reset();
  h.inputFilter("match");
  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.row("B").classList.contains("selected"), true);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P252 visible context-only current selection is repaired to first actual match", () => {
  const h = makeHarness({ selectedId: "A" });
  configureContextMatchTree(h);
  h.materialise();

  h.reset();
  h.inputFilter("copied");
  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.row("A").classList.contains("selected"), false);
  assert.equal(h.row("B").classList.contains("selected"), true);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P252 multiple actual matches choose first actual match in rendered order, excluding context ancestors", () => {
  const h = makeHarness({ selectedId: "A" });
  configureContextMatchTree(h);
  node(h, "C").label = "Copied Second";
  h.materialise();

  h.reset();
  h.inputFilter("copied");
  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B", "C"]);
  assert.equal(h.context.state.selectedId, "B", "first actual match wins, not context A or later actual C");
  assert.equal(h.row("A").classList.contains("selected"), false);
  assert.equal(h.row("B").classList.contains("selected"), true);
  assert.equal(h.row("C").classList.contains("selected"), false);
});

test("P252 PE-body-only match is an actual match and can become repaired selection", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, {
    A: "Anchor",
    B: "PE Search Target",
    C: "Other",
  });
  node(h, "B").details = "purple platypus lantern";
  h.materialise();

  h.reset();
  h.inputFilter("platypus");
  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.row("B").classList.contains("selected"), true);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P252 no-match render preserves accepted selectedId and does not invent a replacement", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Gamma" });
  h.materialise();

  h.reset();
  h.inputFilter("unfindable");
  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), []);
  assert.equal(h.context.state.selectedId, "A");
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P252 no-filter render preserves ordinary existing first-visible repair semantics", () => {
  const h = makeHarness({ selectedId: "missing" });
  setLabels(h, { A: "Alpha", B: "Beta", C: "Gamma" });

  h.reset();
  h.context.renderTree();
  h.stop();

  assert.equal(h.search.value, "");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B", "C"]);
  assert.equal(h.context.state.selectedId, "A");
  assert.equal(h.row("A").classList.contains("selected"), true);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P252 context ancestor remains part of ordinary filtered arrow navigation after initial repair", () => {
  const h = makeHarness({ selectedId: "C" });
  configureContextMatchTree(h);
  h.materialise();
  h.row("C").focus();

  h.reset();
  typeMain(h, "C", "copied");
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "B");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B"]);

  h.keydown("B", "ArrowUp");
  h.stop();

  assert.equal(h.context.state.selectedId, "A", "ArrowUp can intentionally select the context ancestor");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B"]);
  assert.equal(h.row("A").classList.contains("selected"), true);
  assert.equal(h.row("B").classList.contains("selected"), false);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P252 keeps renderTree as the sole Filter matcher and passes only ordered match identities to repair", () => {
  const render = source(RENDER);
  const actions = source(ACTIONS);
  const smooth = source(SMOOTH);

  assert.match(render, /function matches\(node\)/);
  assert.match(render, /const haystack = nodeSearchText\(node\)/);
  assert.match(render, /if \(filtering && nodeMatches\) actualMatchIds\.push\(node\.id\)/);
  assert.match(render, /repairVisibleSelectionAfterRender\(\{[\s\S]*actualMatchIds/);

  const repairStart = actions.indexOf("function repairVisibleSelectionAfterRender");
  const repairEnd = actions.indexOf("\nfunction ", repairStart + 20);
  assert.ok(repairStart >= 0);
  const repair = actions.slice(repairStart, repairEnd);
  assert.match(repair, /actualMatchIds/);
  assert.doesNotMatch(repair, /nodeSearchText|tokens\s*=|haystack|task\.notes|profile\.keywords|PocketNodeContent/);

  assert.match(smooth, /renderTree\(\{ repairFilteredSelection: request\.hasFilter === true \}\)/);
});
