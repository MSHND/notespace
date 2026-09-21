"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function renderedPeHtml() {
  const context = vm.createContext({
    console,
    JSON,
    Object,
    Array,
    Number,
    String,
    Math,
    Set,
    Map,
    URL,
  });
  context.window = context;
  context.globalThis = context;
  context.location = { href: "https://example.github.io/notespace/" };
  vm.runInContext(source("js/pocket-node-content.js"), context, {
    filename: "js/pocket-node-content.js",
  });
  vm.runInContext(source("js/pocket-surface-dependencies.js"), context, {
    filename: "js/pocket-surface-dependencies.js",
  });
  vm.runInContext(source("js/pocket-node-popout-template.js"), context, {
    filename: "js/pocket-node-popout-template.js",
  });
  return context.PocketNodePopoutTemplate.render({
    id: "p239",
    title: "Responsive width",
    path: "Root / Responsive width",
    text: "Body",
    readOnly: false,
  });
}

test("P239 Save & Close preserves one-line intrinsic width without container minimums", () => {
  const html = renderedPeHtml();

  assert.match(
    html,
    /<button id="saveCloseBtn" class="toolbarBtn" type="button">save &amp; close<\/button>/
  );

  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  const saveCloseRule = css.match(/#saveCloseBtn\{([^}]*)\}/)?.[1] || "";

  assert.match(saveCloseRule, /(?:^|;)white-space:nowrap(?:;|$)/);
  assert.match(saveCloseRule, /(?:^|;)flex-shrink:0(?:;|$)/);

  assert.doesNotMatch(
    css,
    /(?:\.wrap|\.topbar|\.actions|footer)[^{]*\{[^}]*min-width\s*:\s*\d/i
  );
  assert.doesNotMatch(css, /#saveCloseBtn\{[^}]*min-width\s*:\s*\d/i);
});
