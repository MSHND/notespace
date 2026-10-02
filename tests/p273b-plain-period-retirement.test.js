"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ACTIONS = path.join(ROOT, "js/pocket-tree-actions.js");
const HELPER = path.join(ROOT, "js/pocket-enter-copy-only.js");
const RENDER = path.join(ROOT, "js/pocket-render.js");

function source(file) {
  return fs.readFileSync(file, "utf8");
}

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `extractable: ${startMarker}`);
  return text.slice(start, end);
}

test("P273b plain period has no active Main row-menu owner and remains excluded from implicit Search", () => {
  const actions = source(ACTIONS);

  const handlerStart = actions.indexOf("function handleTreeKeydown(ev) {");
  assert.ok(handlerStart >= 0);
  const handler = actions.slice(handlerStart);

  assert.match(handler, /&& ev\.key === "ContextMenu"[\s\S]*openRowMiniMenuForSelected\(\)/);
  assert.doesNotMatch(handler, /ev\.key === "ContextMenu" \|\| ev\.key === "\."/);
  assert.doesNotMatch(handler, /ev\.key === "\."[\s\S]{0,160}openRowMiniMenuForSelected\(\)/);

  const implicitFilter = extractBetween(
    actions,
    "function isMainImplicitFilterCharacter(ev) {",
    "\nfunction isMainImplicitFilterBackspace",
  );
  assert.match(implicitFilter, /\["\.", "=", "\+", "-", "\/", "\?"\]\.includes\(key\)/);
});

test("P273b Ctrl/Cmd period still owns Unfold all while ContextMenu and Shift+F10 remain standard menu routes", () => {
  const actions = source(ACTIONS);
  const handlerStart = actions.indexOf("function handleTreeKeydown(ev) {");
  assert.ok(handlerStart >= 0);
  const handler = actions.slice(handlerStart);

  assert.match(
    handler,
    /\(ev\.metaKey \|\| ev\.ctrlKey\)[\s\S]*!ev\.shiftKey[\s\S]*!ev\.altKey[\s\S]*\(ev\.key === "," \|\| ev\.key === "\."\)[\s\S]*else unfoldAllNodes\(\)/,
  );
  assert.match(
    handler,
    /!ev\.metaKey[\s\S]*!ev\.ctrlKey[\s\S]*!ev\.altKey[\s\S]*!ev\.shiftKey[\s\S]*&& ev\.key === "ContextMenu"[\s\S]*openRowMiniMenuForSelected\(\)/,
  );
  assert.match(
    handler,
    /!ev\.metaKey[\s\S]*!ev\.ctrlKey[\s\S]*!ev\.altKey[\s\S]*ev\.shiftKey[\s\S]*&& ev\.key === "F10"[\s\S]*openRowMiniMenuForSelected\(\)/,
  );
});

test("P273b helper remains free of a plain-period row-menu trigger", () => {
  const helper = source(HELPER);
  assert.doesNotMatch(helper, /ev\.key === "\."/);
});

test("P273b P273 mouse right-click still delegates to rowMiniMenu with no duplicate rowActionMenu", () => {
  const render = source(RENDER);
  const handler = extractBetween(
    render,
    '    row.addEventListener("contextmenu", (ev) => {',
    "\n\n    li.appendChild(row);",
  );

  assert.match(handler, /cancelPendingCopyClick\(\)/);
  assert.match(handler, /state\.selectedId = node\.id/);
  assert.match(handler, /openRowMiniMenu\(node\.id/);
  assert.match(handler, /x: ev\.clientX/);
  assert.match(handler, /y: ev\.clientY/);
  assert.doesNotMatch(render, /rowActionMenu|openRowActionMenu|closeRowActionMenu/);
});
