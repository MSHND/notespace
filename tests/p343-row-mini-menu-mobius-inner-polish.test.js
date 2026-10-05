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

function cssValue(block, property) {
  const match = block.match(new RegExp("(?:^|\\n)\\s*" + property + ":\\s*([^;]+);"));
  assert.ok(match, `CSS property must exist: ${property}`);
  return match[1].trim();
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

test("P343 keeps the exact P327 shared outer shell and desktop geometry ownership", () => {
  const polish = source("pocket-ui-polish.css");
  const styles = source("styles.css");

  const shared = cssBlock(polish, ".commandCard,\n.controlsCard,\n.rowMiniMenu {");
  assert.equal(cssValue(shared, "border"), "var(--pocket-temporary-surface-border)");
  assert.equal(cssValue(shared, "border-radius"), "var(--pocket-temporary-surface-radius)");
  assert.equal(cssValue(shared, "background"), "var(--pocket-temporary-surface-bg)");
  assert.equal(cssValue(shared, "box-shadow"), "var(--pocket-temporary-surface-shadow)");

  const base = cssBlock(styles, "    .rowMiniMenu {");
  assert.equal(cssValue(base, "position"), "fixed");
  assert.equal(cssValue(base, "width"), "min(138px, calc(100vw - 12px))");
  assert.equal(cssValue(base, "max-height"), "min(230px, calc(100vh - 12px))");

  const desktop = cssBlock(polish, "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) {");
  assert.equal(cssValue(desktop, "padding"), "5px");
  assert.doesNotMatch(desktop, /(?:^|\n)\s*(?:position|width|max-height|left|right|top|bottom)\s*:/);
});

test("P343 desktop row-menu actions reuse the existing command button and hint language", () => {
  const styles = source("styles.css");
  const polish = source("pocket-ui-polish.css");

  const command = cssBlock(styles, "    .commandBtn {");
  const mini = cssBlock(polish, "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuBtn {");

  for (const property of ["border", "border-radius", "min-height", "padding", "gap", "font-size"]) {
    assert.equal(cssValue(mini, property), cssValue(command, property), property + " mirrors commandBtn");
  }

  const commandState = cssBlock(styles, "    .commandBtn:hover,\n    .commandBtn:focus {");
  const miniState = cssBlock(
    polish,
    "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuBtn:hover,\nbody:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuBtn:focus-visible {",
  );
  assert.equal(cssValue(miniState, "background"), cssValue(commandState, "background"));
  assert.equal(cssValue(miniState, "border-color"), cssValue(commandState, "border-color"));

  const commandDisabled = cssBlock(styles, "    .commandBtn[disabled] {");
  const miniDisabled = cssBlock(polish, "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuBtn[disabled] {");
  assert.equal(cssValue(miniDisabled, "opacity"), cssValue(commandDisabled, "opacity"));

  const commandHint = cssBlock(styles, "    .commandHint {");
  const miniHint = cssBlock(polish, "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuShortcut {");
  for (const property of ["color", "font-size", "white-space"]) {
    assert.equal(cssValue(miniHint, property), cssValue(commandHint, property), property + " mirrors commandHint");
  }
  assert.equal(cssValue(miniHint, "opacity"), "1");

  const separator = cssBlock(polish, "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuSep {");
  assert.equal(cssValue(separator, "height"), "1px");
  assert.equal(cssValue(separator, "margin"), "4px 10px");
  assert.equal(cssValue(separator, "background"), cssValue(commandState, "border-color"));
  assert.equal(cssValue(separator, "opacity"), "1");
});

test("P343 leaves phone row-menu overrides intact and outside the desktop-only polish", () => {
  const phone = source("phone.css");
  const polish = source("pocket-ui-polish.css");

  const menu = cssBlock(phone, "body.phoneMode .rowMiniMenu {");
  assert.match(menu, /left:\s*8px !important/);
  assert.match(menu, /right:\s*8px !important/);
  assert.match(menu, /bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\) !important/);
  assert.match(menu, /width:\s*auto !important/);
  assert.match(menu, /border-radius:\s*18px !important/);
  assert.match(menu, /padding:\s*8px !important/);

  const button = cssBlock(phone, "body.phoneMode .rowMiniMenuBtn {");
  assert.match(button, /min-height:\s*54px !important/);
  assert.match(button, /border-radius:\s*13px !important/);
  assert.match(button, /padding:\s*13px 15px !important/);
  assert.match(button, /font-size:\s*17px !important/);

  const shortcut = cssBlock(phone, "body.phoneMode .rowMiniMenuShortcut {");
  assert.match(shortcut, /display:\s*none !important/);

  for (const selector of [
    "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) {",
    "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuBtn {",
    "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuShortcut {",
    "body:not(.phoneMode) .rowMiniMenu:not(.sheetMode) .rowMiniMenuSep {",
  ]) {
    assert.ok(polish.includes(selector), selector + " stays explicitly desktop-only");
  }
});

test("P343 introduces no new menu owner and preserves the P342 five-action exact-target contract", () => {
  const overlays = source("js/pocket-overlays-init.js");
  const start = overlays.indexOf("function openRowMiniMenu(");
  const end = overlays.indexOf("\nfunction isCommandPaletteOpen()", start);
  assert.ok(start >= 0 && end > start);
  const owner = overlays.slice(start, end);

  const actions = Array.from(owner.matchAll(/addButton\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g))
    .map((match) => ({ label: match[1], action: match[2], shortcut: match[3] }));

  assert.deepEqual(actions, [
    { label: "Edit", action: "edit", shortcut: "e" },
    { label: "Add below", action: "add_sibling", shortcut: "a" },
    { label: "Move", action: "move", shortcut: "m" },
    { label: "Copy text", action: "copy_text", shortcut: "c" },
    { label: "Delete", action: "delete", shortcut: "d" },
  ]);
  assert.match(owner, /if \(action === "edit"\) \{\s*openItemDetailsForNode\(id\);\s*return;\s*\}/);
  assert.match(owner, /target\.click\(\)/);

  const index = source("index.html");
  assert.doesNotMatch(index, /rowMiniMenuMobius|mobiusInner|p343RowMenu/i);

  for (const file of runtimeJsFiles()) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /rowMiniMenuMobius|mobiusInner|p343RowMenu|pocket-temporary-surface|temporarySurface|mobiusCard/i,
      path.relative(ROOT, file),
    );
  }
});
