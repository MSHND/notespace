"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const surfaceDependencies = require("../js/pocket-surface-dependencies.js");
const { createReviewedStaticManifest } = require("../sync-service/pocket-sync-static-assets.js");
function source(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }

test("P210n has one canonical ordered PE surface dependency authority", () => {
  const scripts = surfaceDependencies.scriptsFor("pe");
  assert.equal(Object.isFrozen(scripts), true);
  assert.deepEqual([...scripts], [
    "js/pocket-node-content.js",
    "js/pocket-node-popout-runtime.js",
    "js/pocket-node-popout-polish.js",
  ]);
  for (const invalid of [null, [], ["/js/x.js"], ["js/../x.js"], ["js/x.css"], ["https://example.com/x.js"], ["js/x.js", "js/x.js"]]) {
    assert.throws(() => surfaceDependencies.validateScripts(invalid),
      (error) => error?.code === "pocket-surface-dependencies-invalid");
  }
  assert.throws(() => surfaceDependencies.scriptsFor("missing"),
    (error) => error?.code === "pocket-surface-dependencies-invalid");
});

test("P210n popup composition consumes the authority and preserves declared execution order", () => {
  const context = vm.createContext({ console, JSON, Object, Array, Number, String, Math, Set, Map, URL });
  context.window = context;
  context.globalThis = context;
  context.location = { href: "https://example.github.io/notespace/" };
  vm.runInContext(source("js/pocket-node-content.js"), context, { filename: "js/pocket-node-content.js" });
  vm.runInContext(source("js/pocket-surface-dependencies.js"), context, { filename: "js/pocket-surface-dependencies.js" });
  vm.runInContext(source("js/pocket-node-popout-template.js"), context, { filename: "js/pocket-node-popout-template.js" });
  const html = context.PocketNodePopoutTemplate.render({ id: "p210n", title: "Surface", path: "Root / Surface", text: "Body", readOnly: false });
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi)].map((match) => match[1]);
  assert.deepEqual(scripts, [
    "/notespace/js/pocket-node-content.js",
    "/notespace/js/pocket-node-popout-runtime.js",
    "/notespace/js/pocket-node-popout-polish.js",
  ]);
});

test("P210n consumers do not carry a second PE dependency list", () => {
  const index = source("index.html");
  const authorityTag = index.indexOf('<script src="js/pocket-surface-dependencies.js"></script>');
  const templateTag = index.indexOf('<script src="js/pocket-node-popout-template.js"></script>');
  assert.ok(authorityTag >= 0 && templateTag > authorityTag);
  assert.doesNotMatch(index, /<script src="js\/pocket-node-popout-runtime\.js"><\/script>/);
  const template = source("js/pocket-node-popout-template.js");
  const windowSource = source("js/pocket-node-popout-window.js");
  const production = source("sync-service/pocket-sync-production-server.js");
  assert.match(template, /PocketSurfaceDependencies/);
  assert.doesNotMatch(template, /pocket-node-content\.js|pocket-node-popout-runtime\.js|pocket-node-popout-polish\.js/);
  assert.doesNotMatch(windowSource, /contentAssetUrl|runtimeAssetUrl|pocket-node-popout-runtime\.js|pocket-node-popout-polish\.js/);
  assert.match(production, /surfaceDependencies\.scriptsFor\("pe"\)/);
  assert.doesNotMatch(production, /pocket-node-content\.js|pocket-node-popout-runtime\.js|pocket-node-popout-polish\.js|POPUP_POLISH_PATH/);
});

test("P210n a missing contract dependency fails reviewed static manifest generation", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "p210n-surface-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture, "js"));
  fs.writeFileSync(path.join(fixture, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(fixture, "sw.js"), "");
  const missing = surfaceDependencies.validateScripts(["js/missing.js"]).map((asset) => `/${asset}`);
  assert.throws(() => createReviewedStaticManifest({ browserRoot: fixture, additionalAssets: missing }),
    (error) => error?.code === "sync-static-assets-failed");
});
