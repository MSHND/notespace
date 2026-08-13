"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const UI_PATH = path.join(ROOT, "js/pocket-sync-ui.js");

test("P053 leaves static Pocket inert and keeps the Sync doorway provider-neutral", () => {
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const ui = fs.readFileSync(UI_PATH, "utf8");
  assert.match(index, /id="cmdSync"[^>]*hidden disabled/);
  assert.match(index, /js\/pocket-sync-ui\.js/);
  assert.doesNotMatch(index, /pocket-sync-local-integration\.js/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|fetch\(|accountLocator|syncedPocketId|credentialId|deviceId/);
  assert.match(ui, /integration\.activate\(\)/);
  assert.match(ui, /integration\.openExisting\(\)/);
  assert.match(ui, /integration\.resume\(\{ activationId: continuation \}\)/);
});

test("P053 exposes only an injectable installer and does no work while no integration is supplied", () => {
  const context = { Object, Array, String, Boolean, Error };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UI_PATH, "utf8"), context, { filename: "pocket-sync-ui.js" });
  assert.deepEqual(Object.keys(context.PocketSyncUi), ["install"]);
  assert.equal(Object.isFrozen(context.PocketSyncUi), true);
  assert.equal(context.PocketSyncUi.install(null), false);
});

test("P053 local composition installs the UI only after an explicit injected create", () => {
  const source = fs.readFileSync(path.join(ROOT, "js/pocket-sync-local-integration.js"), "utf8");
  assert.match(source, /PocketSyncUi\?\.install\?\.\(integration\)/);
  assert.match(
    fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-local-integration-server.js"), "utf8"),
    /PocketSyncLocalIntegration\.create\(\)/
  );
});
