"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function cssBlock(css, selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `CSS selector must exist: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open + 1);
  assert.ok(open > start && close > open, `CSS block must be complete: ${selector}`);
  return css.slice(open + 1, close);
}

function runtimeJsFiles() {
  const root = path.join(ROOT, "js");
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
    }
  }
  return files;
}

test("P326 commandCard and controlsCard share exactly the settled temporary-surface shell", () => {
  const polish = source("pocket-ui-polish.css");
  const styles = source("styles.css");

  const expectedTokens = [
    ["--pocket-temporary-surface-border", "1px solid var(--chip-border)"],
    ["--pocket-temporary-surface-radius", "12px"],
    ["--pocket-temporary-surface-bg", "rgba(var(--panel-rgb), 0.96)"],
    ["--pocket-temporary-surface-shadow", "var(--pocket-chip-shadow)"],
  ];

  for (const [name, value] of expectedTokens) {
    assert.ok(polish.includes(`${name}: ${value};`), `${name} keeps the settled value`);
    assert.equal(polish.split(name).length - 1, 2, `${name} is declared once and consumed once`);
  }

  const groupedSelector = ".commandCard,\n.controlsCard {";
  assert.ok(polish.includes(groupedSelector), "commandCard and controlsCard share one explicit shell selector");
  const shell = cssBlock(polish, groupedSelector);
  assert.match(shell, /border:\s*var\(--pocket-temporary-surface-border\)/);
  assert.match(shell, /border-radius:\s*var\(--pocket-temporary-surface-radius\)/);
  assert.match(shell, /background:\s*var\(--pocket-temporary-surface-bg\)/);
  assert.match(shell, /box-shadow:\s*var\(--pocket-temporary-surface-shadow\)/);

  const command = cssBlock(styles, "    .commandCard {");
  const controls = cssBlock(styles, "    .controlsCard {");

  for (const block of [command, controls]) {
    assert.doesNotMatch(block, /(?:^|\n)\s*border\s*:/);
    assert.doesNotMatch(block, /border-radius\s*:/);
    assert.doesNotMatch(block, /background\s*:/);
    assert.doesNotMatch(block, /box-shadow\s*:/);
  }

  assert.match(command, /width:\s*min\(430px, 100%\)/);
  assert.match(command, /padding:\s*8px/);
  assert.match(command, /display:\s*grid/);
  assert.match(command, /gap:\s*4px/);

  assert.match(controls, /width:\s*min\(560px, 100%\)/);
  assert.match(controls, /padding:\s*14px/);
  assert.match(controls, /display:\s*grid/);
  assert.match(controls, /gap:\s*10px/);
});

test("P326 shared shell stays presentation-only and excludes unrelated surfaces", () => {
  const polish = source("pocket-ui-polish.css");
  const index = source("index.html");

  const groupedSelector = ".commandCard,\n.controlsCard {";
  const start = polish.indexOf(groupedSelector);
  assert.ok(start >= 0);
  const end = polish.indexOf("}", start);
  const selectorAndBlock = polish.slice(start, end + 1);

  for (const unrelated of [
    "rowMiniMenu",
    "topStatusToast",
    "detailCard",
    "filePermissionCard",
    "vaultDialogCard",
    "deviceChangesCard",
  ]) {
    assert.doesNotMatch(selectorAndBlock, new RegExp(unrelated));
  }

  assert.doesNotMatch(index, /pocketTemporarySurface|temporarySurface|mobiusCard/i);

  for (const file of runtimeJsFiles()) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /pocket-temporary-surface|temporarySurface|mobiusCard/i, path.relative(ROOT, file));
  }
});
