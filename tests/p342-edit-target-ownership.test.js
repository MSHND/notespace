"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const RENDER = "js/pocket-render.js";
const OVERLAYS = "js/pocket-overlays-init.js";
const CUTOVER = "js/pocket-editor-cutover-v3.js";
const STATE = "js/pocket-state.js";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, "extractable: " + startMarker);
  return text.slice(start, end);
}

function exactTargetHarness(query = "") {
  const render = source(RENDER);
  const owner = extractBetween(
    render,
    "function openItemDetailsForNode(nodeId) {",
    "\nfunction supportedOutlineForNode",
  );
  const events = [];
  const context = {
    state: { selectedId: "A" },
    el: { search: { value: query } },
    cleanText(value, max = 80) { return String(value || "").trim().slice(0, max); },
    nodeMap() {
      return new Map([
        ["A", { id: "A", label: "Alpha" }],
        ["B", { id: "B", label: "Beta" }],
      ]);
    },
    requirePocketFileForChanges() { events.push("gate"); return true; },
    cancelPendingCopyClick() { events.push("cancel-copy"); },
    closeRowMiniMenu() { events.push("close-row-menu"); return true; },
    closeCommandPalette() { events.push("close-command-palette"); return true; },
    openPocketNodeEditor(id) { events.push("edit:" + id); return true; },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(owner + "\nthis.openItemDetailsForNode = openItemDetailsForNode;", context, { filename: RENDER });
  return { context, events };
}

test("P342 canonical Main Edit owner requires an explicit node target and never rediscovers ambient selection", () => {
  const render = source(RENDER);
  const owner = extractBetween(
    render,
    "function openItemDetailsForNode(nodeId) {",
    "\nfunction supportedOutlineForNode",
  );
  assert.match(owner, /const id = cleanText\(nodeId, 80\)/);
  assert.doesNotMatch(owner, /nodeId \|\| state\.selectedId/);
  assert.doesNotMatch(owner, /search|filter/i);
  assert.match(owner, /window\.openPocketNodeEditor\(id\)/);

  const h = exactTargetHarness("");
  assert.equal(h.context.openItemDetailsForNode("B"), true);
  assert.equal(h.context.state.selectedId, "B");
  assert.deepEqual(h.events, [
    "gate",
    "cancel-copy",
    "close-row-menu",
    "close-command-palette",
    "edit:B",
  ]);

  const before = h.events.length;
  h.context.state.selectedId = "A";
  assert.equal(h.context.openItemDetailsForNode(), false, "missing target does not fall back to A");
  assert.equal(h.context.state.selectedId, "A");
  assert.equal(h.events.length, before + 1, "only the existing file gate runs before target validation");
  assert.equal(h.events.at(-1), "gate");
});

test("P342 exact-target Edit remains independent of Filter presentation", () => {
  for (const query of ["", "bet"]) {
    const h = exactTargetHarness(query);
    h.context.state.selectedId = "A";
    assert.equal(h.context.openItemDetailsForNode("B"), true);
    assert.equal(h.context.state.selectedId, "B", "the explicit target wins over prior selection");
    assert.equal(h.context.el.search.value, query, "Edit does not clear or reinterpret Filter");
    assert.equal(h.events.filter((entry) => entry === "edit:B").length, 1);
  }
});

test("P342 selected-node controls resolve selection once then invoke the same exact-target owner", () => {
  const overlays = source(OVERLAYS);
  const selectedOwner = extractBetween(
    overlays,
    "function openSelectedItemDetailsFromControls() {",
    "\nfunction handleWindowFocusToTree",
  );
  assert.match(selectedOwner, /const id = cleanText\(state\.selectedId, 80\)/);
  assert.match(selectedOwner, /return openItemDetailsForNode\(id\)/);
  assert.doesNotMatch(selectedOwner, /openPocketPeEditor|PocketPeEditor|openPocketNodeEditor|openPocketEditor/);

  const calls = [];
  const statuses = [];
  const context = {
    state: { selectedId: "A" },
    cleanText(value, max = 80) { return String(value || "").trim().slice(0, max); },
    nodeMap() { return new Map([["A", { id: "A" }], ["B", { id: "B" }]]); },
    openItemDetailsForNode(id) { calls.push(id); return true; },
    setStatus(message, tone) { statuses.push({ message, tone }); },
  };
  vm.createContext(context);
  vm.runInContext(selectedOwner + "\nthis.openSelectedItemDetailsFromControls = openSelectedItemDetailsFromControls;", context, { filename: OVERLAYS });

  assert.equal(context.openSelectedItemDetailsFromControls(), true);
  assert.deepEqual(calls, ["A"]);

  context.state.selectedId = "missing";
  assert.equal(context.openSelectedItemDetailsFromControls(), false);
  assert.deepEqual(calls, ["A"]);
  assert.match(statuses.at(-1).message, /select an item first/i);
});

test("P342 row-menu, double-click and selected controls converge on exact-target Edit without capture interception", () => {
  const overlays = source(OVERLAYS);
  const render = source(RENDER);
  const cutover = source(CUTOVER);
  const stateSource = source(STATE);

  const menuOwner = extractBetween(overlays, "function openRowMiniMenu(nodeId, anchorEl, point = null) {", "\nfunction isCommandPaletteOpen()");
  assert.match(menuOwner, /if \(action === "edit"\) \{\s*openItemDetailsForNode\(id\);\s*return;\s*\}/);
  assert.match(menuOwner, /target\.click\(\)/, "keyboard shortcut activates the same Edit button path");
  assert.match(menuOwner, /state\.selectedId = id;\s*runCommandPaletteAction\(action\)/, "non-Edit row-menu actions keep their existing command route");

  for (const expected of [
    'addButton("Edit", "edit", "e")',
    'addButton("Add below", "add_sibling", "a")',
    'addButton("Move", "move", "m")',
    'addButton("Focus here", "focus", "f")',
    'addButton("Copy text", "copy_text", "c")',
    'addButton("Delete", "delete", "d")',
  ]) assert.equal(menuOwner.includes(expected), true, expected);

  const doubleClick = extractBetween(
    render,
    '    row.addEventListener("dblclick", (ev) => {',
    '    row.addEventListener("contextmenu", (ev) => {',
  );
  assert.match(doubleClick, /openItemDetailsForNode\(node\.id\)/);

  assert.match(overlays, /el\.btnOpenPrimary\?\.addEventListener\("click", openSelectedItemDetailsFromControls\)/);
  const commandOwner = extractBetween(overlays, "function runCommandPaletteAction(action) {", "\nfunction moveCommandPaletteFocus");
  assert.match(commandOwner, /if \(action === "edit"\) \{\s*openSelectedItemDetailsFromControls\(\);\s*return;\s*\}/);

  assert.match(stateSource, /const state = \{/);
  assert.doesNotMatch(cutover, /global\.state/);
  assert.doesNotMatch(cutover, /nodeIdFromEvent|rowFromEvent|clickCapture|doubleClickCapture/);
  assert.doesNotMatch(cutover, /document\.addEventListener\("click"|document\.addEventListener\("dblclick"/);
  assert.match(cutover, /function targetNode\(input\)/);
  assert.match(cutover, /const node = targetNode\(input\)/);
});

test("P342 leaves existing Phone and read-only compatibility routing in the canonical editor owner", () => {
  const cutover = source(CUTOVER);
  assert.match(cutover, /function requiresReadOnlyCompatibility\(node\)/);
  assert.match(cutover, /function openPhoneDetails\(node\)/);
  assert.match(cutover, /if \(!readOnlyCompatibility && isPhoneMode\(\)\) return openPhoneDetails\(node\)/);
  assert.match(cutover, /This item requires Pocket's read-only compatibility view/);
  assert.match(cutover, /global\.PocketPeEditor\.open\(node\.id\)/);
});
