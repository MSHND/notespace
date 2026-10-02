"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
const HELPER = path.join(JS_DIR, "pocket-enter-copy-only.js");
const OVERLAYS = path.join(JS_DIR, "pocket-overlays-init.js");

function source(file) {
  return fs.readFileSync(file, "utf8");
}

function jsFiles(dir = JS_DIR) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name.endsWith(".js")) found.push(target);
    }
  }
  return found;
}

function ownerSource() {
  const overlays = source(OVERLAYS);
  const start = overlays.indexOf("function openRowMiniMenu(");
  const end = overlays.indexOf("\nfunction isCommandPaletteOpen()", start);
  assert.ok(start >= 0 && end > start, "canonical openRowMiniMenu owner is extractable");
  return overlays.slice(start, end);
}

test("P316 legacy row-menu Move injection fallback is absent from runtime JS", () => {
  const runtime = jsFiles().map((file) => ({ file, text: source(file) }));
  const retiredNames = ["rowMenu" + "HasMove", "makeMove" + "Button", "ensureMove" + "InRowMenu"];

  for (const name of retiredNames) {
    const matches = runtime.filter(({ text }) => text.includes(name));
    assert.deepEqual(matches.map(({ file }) => path.relative(ROOT, file)), [], name + " has no runtime definition or use");
  }

  const helper = source(HELPER);
  assert.doesNotMatch(helper, /MutationObserver\([^)]*ensureMove/);
  assert.doesNotMatch(helper, /requestAnimationFrame\([^)]*ensureMove/);
  assert.match(helper, /function installMoveDisplayGuard\(\)/);
  assert.match(helper, /function installPeEscCloseGuard\(\)/);
  assert.match(helper, /function closeMenusAfterMoveClick\(ev\)/);
});

test("P316 openRowMiniMenu remains the single rowMiniMenu constructor with the accepted six actions", () => {
  const runtime = jsFiles().map((file) => ({ file, text: source(file) }));
  const constructors = runtime
    .filter(({ text }) => /className\s*=\s*"rowMiniMenu"/.test(text))
    .map(({ file }) => path.relative(ROOT, file).replace(/\\/g, "/"));

  assert.deepEqual(constructors, ["js/pocket-overlays-init.js"], "rowMiniMenu has one runtime construction owner");

  const owner = ownerSource();
  const actions = Array.from(owner.matchAll(/addButton\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g))
    .map((match) => ({ label: match[1], action: match[2], shortcut: match[3] }));

  assert.deepEqual(actions, [
    { label: "Edit", action: "edit", shortcut: "e" },
    { label: "Add below", action: "add_sibling", shortcut: "a" },
    { label: "Move", action: "move", shortcut: "m" },
    { label: "Focus here", action: "focus", shortcut: "f" },
    { label: "Copy text", action: "copy_text", shortcut: "c" },
    { label: "Delete", action: "delete", shortcut: "d" },
  ]);

  const move = actions.filter((item) => item.label === "Move");
  assert.deepEqual(move, [{ label: "Move", action: "move", shortcut: "m" }], "exactly one Move action remains in the canonical owner");
  assert.match(owner, /btn\.setAttribute\("aria-keyshortcuts", key\.toUpperCase\(\)\)/);
  assert.match(owner, /runCommandPaletteAction\(action\)/);
});
