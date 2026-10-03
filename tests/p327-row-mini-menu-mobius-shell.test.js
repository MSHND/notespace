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

test("P327 shared shell contains exactly commandCard controlsCard and rowMiniMenu", () => {
  const polish = source("pocket-ui-polish.css");
  const selector = ".commandCard,\n.controlsCard,\n.rowMiniMenu {";
  const start = polish.indexOf(selector);
  assert.ok(start >= 0, "three-surface shared shell selector must exist");
  const open = polish.indexOf("{", start);
  const selectorText = polish.slice(start, open).trim();

  assert.equal(
    selectorText,
    ".commandCard,\n.controlsCard,\n.rowMiniMenu",
    "shared selector contains exactly the three settled temporary surfaces"
  );

  const shell = cssBlock(polish, selector);
  assert.match(shell, /border:\s*var\(--pocket-temporary-surface-border\)/);
  assert.match(shell, /border-radius:\s*var\(--pocket-temporary-surface-radius\)/);
  assert.match(shell, /background:\s*var\(--pocket-temporary-surface-bg\)/);
  assert.match(shell, /box-shadow:\s*var\(--pocket-temporary-surface-shadow\)/);

  for (const unrelated of [
    "topStatusToast",
    "detailCard",
    "filePermissionCard",
    "vaultDialogCard",
    "deviceChangesCard",
  ]) {
    assert.doesNotMatch(selectorText, new RegExp(unrelated));
  }
});

test("P327 base rowMiniMenu delegates shell only and preserves desktop structure", () => {
  const styles = source("styles.css");
  const base = cssBlock(styles, "    .rowMiniMenu {");

  assert.doesNotMatch(base, /(?:^|\n)\s*border\s*:/);
  assert.doesNotMatch(base, /border-radius\s*:/);
  assert.doesNotMatch(base, /background\s*:/);
  assert.doesNotMatch(base, /box-shadow\s*:/);

  assert.match(base, /position:\s*fixed/);
  assert.match(base, /z-index:\s*80/);
  assert.match(base, /width:\s*min\(138px, calc\(100vw - 12px\)\)/);
  assert.match(base, /max-height:\s*min\(230px, calc\(100vh - 12px\)\)/);
  assert.match(base, /overflow:\s*auto/);
  assert.match(base, /padding:\s*3px/);
});

test("P327 sheetMode geometry remains unchanged", () => {
  const styles = source("styles.css");
  const sheet = cssBlock(styles, "    .rowMiniMenu.sheetMode {");

  assert.match(sheet, /left:\s*6px !important/);
  assert.match(sheet, /right:\s*6px !important/);
  assert.match(sheet, /bottom:\s*6px !important/);
  assert.match(sheet, /top:\s*auto !important/);
  assert.match(sheet, /width:\s*auto !important/);
  assert.match(sheet, /max-height:\s*min\(48vh, 230px\)/);
  assert.match(sheet, /border-radius:\s*12px/);
  assert.match(sheet, /padding:\s*5px/);
});

test("P327 phone rowMiniMenu keeps bottom-sheet geometry and stronger override shell", () => {
  const phone = source("phone.css");
  const menu = cssBlock(phone, "body.phoneMode .rowMiniMenu {");

  assert.match(menu, /position:\s*fixed !important/);
  assert.match(menu, /left:\s*8px !important/);
  assert.match(menu, /right:\s*8px !important/);
  assert.match(menu, /top:\s*auto !important/);
  assert.match(menu, /bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\) !important/);
  assert.match(menu, /width:\s*auto !important/);
  assert.match(menu, /max-width:\s*none !important/);
  assert.match(menu, /border-radius:\s*18px !important/);
  assert.match(menu, /padding:\s*8px !important/);
  assert.match(menu, /box-shadow:\s*0 18px 42px -24px rgba\(17, 24, 39, 0\.62\) !important/);

  const title = cssBlock(phone, "body.phoneMode .rowMiniMenuTitle {");
  const button = cssBlock(phone, "body.phoneMode .rowMiniMenuBtn {");
  const shortcut = cssBlock(phone, "body.phoneMode .rowMiniMenuShortcut {");
  const sep = cssBlock(phone, "body.phoneMode .rowMiniMenuSep {");

  assert.match(title, /padding:\s*8px 10px 6px !important/);
  assert.match(title, /font-size:\s*13px !important/);
  assert.match(button, /min-height:\s*54px !important/);
  assert.match(button, /border-radius:\s*13px !important/);
  assert.match(button, /padding:\s*13px 15px !important/);
  assert.match(button, /font-size:\s*17px !important/);
  assert.match(shortcut, /display:\s*none !important/);
  assert.match(sep, /margin:\s*5px 0 !important/);
});

test("P327 remains presentation-only with no new HTML or JavaScript owner", () => {
  const index = source("index.html");
  assert.doesNotMatch(index, /pocketTemporarySurface|temporarySurface|mobiusCard/i);

  for (const file of runtimeJsFiles()) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /pocket-temporary-surface|temporarySurface|mobiusCard/i,
      path.relative(ROOT, file)
    );
  }
});
