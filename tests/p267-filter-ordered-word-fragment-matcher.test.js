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

function filter(h, query) {
  h.inputFilter(query);
  h.runPendingTimers();
}

test("P267 pure ordered word-prefix matcher follows Unicode word boundaries and ordered later-word semantics", () => {
  const h = makeHarness();
  const match = h.context.orderedFilterWordPrefixMatch;
  const words = h.context.filterWordRuns;

  assert.equal(typeof match, "function");
  assert.deepEqual(plain(words("Electrical/Services")), ["electrical", "services"]);
  assert.deepEqual(plain(words("client-follow-up")), ["client", "follow", "up"]);
  assert.deepEqual(plain(words("client’s follow-up")), ["client", "s", "follow", "up"]);
  assert.deepEqual(plain(words("Ångström 123")), ["ångström", "123"]);

  assert.equal(match("ele ser", "Electrical Services"), true);
  assert.equal(match("ele ser", "Electrical Contract Services"), true);
  assert.equal(match("rev reimb", "Revenue reimbursement template"), true);
  assert.equal(match("ser ele", "Electrical Services"), false);
  assert.equal(match("ele tri", "Electrical Services"), false);
  assert.equal(match("ele ele", "Electrical Services"), false, "one word cannot satisfy two fragments");
  assert.equal(match("ELE SER", "electrical services"), true);
  assert.equal(match("ele ser", "Electrical/Services"), true);
  assert.equal(match("client fol up", "client-follow-up"), true);
  assert.equal(match("can t", "can't wait"), true, "apostrophe is a boundary");
  assert.equal(match("tri", "Electrical"), false, "no substring fallback");
  assert.equal(match("ång 12", "Ångström 123"), true, "Unicode letters and numbers are searchable word runs");
  assert.equal(match("   ---   ", "Anything"), true, "punctuation-only query has no searchable fragments");
});

test("P267 renderTree applies ordered prefixes to labels and preserves first actual match over ancestor context", () => {
  const h = makeHarness({ selectedId: "C" });
  setLabels(h, {
    A: "Clients",
    B: "Electrical Contract Services",
    C: "Other",
  });
  node(h, "B").parentId = "A";
  h.materialise();

  const nodesBefore = plain(h.context.state.nodes);
  h.reset();
  filter(h, "ele ser");
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.row("A").classList.contains("selected"), false, "ancestor is context only");
  assert.equal(h.row("B").classList.contains("selected"), true, "first actual match is selected");
  assert.equal(h.counters.saveWorkspace, 0, "Filter stays non-dirty");
  assert.deepEqual(plain(h.context.state.nodes), nodesBefore);
});

test("P267 canonical body text remains part of the existing searchable surface", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Anchor", B: "Unrelated label", C: "Other" });
  node(h, "B").details = "Revenue reimbursement template";
  h.materialise();

  h.reset();
  filter(h, "rev reimb");
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P267 existing path text remains searchable with ordered word prefixes", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Anchor", B: "Unrelated label", C: "Other" });
  h.context.getPath = (id) => id === "B" ? "Clients / Electrical Contract Services" : String(id || "");
  h.materialise();

  h.reset();
  filter(h, "ele ser");
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P267 reverse order and non-prefix fragments fail in the actual Filter owner", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Electrical Services", B: "Electrical Contract Services", C: "Other" });
  h.materialise();

  h.reset();
  filter(h, "ser ele");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), []);

  filter(h, "ele tri");
  h.stop();
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), []);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P267 Main typing still feeds the same Filter owner without focus transfer", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Anchor", B: "Electrical Services", C: "Other" });
  h.materialise();
  h.row("A").focus();

  h.reset();
  for (const ch of "ele") h.keydown("A", ch);
  assert.equal(h.search.value, "ele");
  assert.equal(h.document.activeElement, h.row("A"), "typing does not move focus into Filter input");

  h.runPendingTimers();
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B"]);
  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.document.activeElement, h.treeWrap);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P267 immediate Arrow settlement works over an ordered multi-fragment Filter", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, {
    A: "Anchor",
    B: "Electrical Services",
    C: "Electrical Contract Services",
  });
  h.materialise();
  h.row("A").focus();

  h.reset();
  h.context.applyPocketFilterQueryValue("ele ser", { keepMainFocus: true });
  assert.equal(h.pendingTimerCount(), 1);

  h.keydown("A", "ArrowDown");
  h.stop();

  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["B", "C"]);
  assert.equal(h.context.state.selectedId, "C");
  assert.equal(h.pendingTimerCount(), 0);
  assert.equal(h.document.activeElement, h.row("C"));
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P267 immediate Enter preserves selected-node Copy behaviour after ordered matcher settlement", () => {
  const h = makeHarness({ selectedId: "A", copyIds: ["B"] });
  setLabels(h, { A: "Anchor", B: "Electrical Services", C: "Other" });
  h.materialise();
  h.row("A").focus();

  h.reset();
  h.context.applyPocketFilterQueryValue("ele ser", { keepMainFocus: true });
  assert.equal(h.pendingTimerCount(), 1);
  h.keydown("A", "Enter");
  h.stop();

  assert.equal(h.context.state.selectedId, "B");
  assert.equal(h.counters.copied, 1);
  assert.deepEqual(h.copiedTexts, ["Electrical Services"]);
  assert.equal(h.search.value, "", "existing Copy loop still clears Filter");
  assert.equal(h.pendingTimerCount(), 0);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P267 Escape and Backspace preserve accepted Filter settlement semantics", () => {
  const h = makeHarness({ selectedId: "A" });
  setLabels(h, { A: "Anchor", B: "Electrical Services", C: "Other" });
  h.materialise();

  h.reset();
  h.context.applyPocketFilterQueryValue("ele ser", { keepMainFocus: true });
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "B");

  h.keydown("B", "Backspace");
  assert.equal(h.search.value, "ele se");
  assert.equal(h.pendingTimerCount(), 1);
  h.runPendingTimers();
  assert.equal(h.context.state.selectedId, "B");

  h.keydown("B", "Escape");
  h.stop();

  assert.equal(h.search.value, "");
  assert.equal(h.context.state.selectedId, "B");
  assert.deepEqual(h.context.getVisibleNodeIdsInRenderOrder(), ["A", "B", "C"]);
  assert.equal(h.pendingTimerCount(), 0);
  assert.equal(h.counters.saveWorkspace, 0);
});

test("P267 keeps renderTree as the sole matcher owner with no second query state", () => {
  const render = source(RENDER);
  const actions = source(ACTIONS);
  const smooth = source(SMOOTH);

  assert.match(render, /function filterWordRuns\(value\)/);
  assert.match(render, /function orderedFilterWordPrefixMatch\(query, candidate\)/);
  assert.match(render, /const query = cleanText\(el\.search\.value, 120\)/);
  assert.match(render, /return orderedFilterWordPrefixMatch\(query, nodeSearchText\(node\)\)/);
  assert.doesNotMatch(render, /tokens\.every\(\(t\) => haystack\.includes\(t\)\)/);
  assert.doesNotMatch(render, /state\.(?:filter|searchQuery|filterQuery)\s*=/);

  assert.match(actions, /applyPocketFilterQueryValue/);
  assert.match(actions, /settlePocketPendingFilterRender/);
  assert.match(smooth, /global\.applyPocketFilterQueryValue = applyFilterQueryValue/);
  assert.match(smooth, /global\.settlePocketPendingFilterRender = settlePendingFilterRender/);
});
