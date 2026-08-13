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
  assert.match(index, /id="btnOpenSynced"[^>]*hidden disabled/);
  assert.match(index, /js\/pocket-sync-ui\.js/);
  assert.doesNotMatch(index, /pocket-sync-local-integration\.js/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|fetch\(|accountLocator|syncedPocketId|credentialId|deviceId/);
  assert.match(ui, /integration\.activate\(\)/);
  assert.match(ui, /integration\.openExisting\(\)/);
  assert.match(ui, /integration\.resume\(\{ activationId: continuation \}\)/);
  assert.doesNotMatch(ui, /setInterval|setTimeout|MutationObserver/);
});

test("P053 exposes only an injectable installer and does no work while no integration is supplied", () => {
  const context = { Object, Array, String, Boolean, Error };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UI_PATH, "utf8"), context, { filename: "pocket-sync-ui.js" });
  assert.deepEqual(Object.keys(context.PocketSyncUi), ["install", "refresh"]);
  assert.equal(Object.isFrozen(context.PocketSyncUi), true);
  assert.equal(context.PocketSyncUi.install(null), false);
});

function createUiHarness(ownerKind = "json") {
  class Element {
    constructor(id = "") { this.id = id; this.hidden = false; this.disabled = false; this.dataset = {}; this.textContent = ""; this.listeners = new Map(); this.children = new Map(); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    fire(type, event = {}) { return this.listeners.get(type)?.({ preventDefault() {}, key: "", ...event }); }
    focus() { this.focused = true; }
    querySelector(selector) { return this.children.get(selector) || null; }
    set innerHTML(_value) {
      this.children.set("h2", new Element("syncSetupTitle"));
      this.children.set("#syncSetupBody", new Element("syncSetupBody"));
      this.children.set("#syncSetupStatus", new Element("syncSetupStatus"));
      this.children.set(".vaultDialogPrimary", new Button("syncPrimary"));
      this.children.set(".vaultDialogSecondary", new Button("syncCancel"));
    }
  }
  class Button extends Element {}
  const command = new Button("cmdSync");
  command.children.set("span", new Element());
  command.children.set(".commandHint", new Element());
  const topbar = new Button("btnOpenSynced");
  const source = new Element("activeDocumentSource");
  const events = new Map();
  const document = {
    activeElement: new Button("initiator"), body: { children: [], appendChild(value) { this.children.push(value); } },
    getElementById(id) { return ({ cmdSync: command, btnOpenSynced: topbar, activeDocumentSource: source })[id] || null; },
    createElement() { return new Element(); }, addEventListener(type, listener) { events.set(type, listener); },
  };
  let session = { ownerKind, id: 1 };
  let activateCalls = 0; let openCalls = 0; let resumeCalls = 0; let resolveActivate;
  const context = {
    Object, Array, String, Boolean, Error, Promise, HTMLButtonElement: Button, HTMLElement: Element, document,
    capturePocketFileSaveSession() { return session; }, hasPocketUnsavedChanges() { return false; },
    requestAnimationFrame(callback) { callback(); }, addEventListener(type, listener) { events.set(type, listener); },
    closeCommandPalette() { context.paletteClosed = true; },
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UI_PATH, "utf8"), context, { filename: "pocket-sync-ui.js" });
  const integration = {
    activate() { activateCalls += 1; return new Promise((resolve) => { resolveActivate = resolve; }); },
    openExisting() { openCalls += 1; return Promise.resolve({ ok: true }); },
    resume() { resumeCalls += 1; return Promise.resolve({ ok: false }); },
  };
  assert.equal(context.PocketSyncUi.install(integration), true);
  return { context, command, topbar, source, overlay: document.body.children[0], integration,
    setSession(value) { session = value; }, get activateCalls() { return activateCalls; }, get openCalls() { return openCalls; }, get resumeCalls() { return resumeCalls; }, get resolveActivate() { return resolveActivate; } };
}

test("P053a gives JSON owners explicit consent, closes More, and single-flights activation", async () => {
  const harness = createUiHarness("json");
  assert.equal(harness.command.hidden, false);
  assert.equal(harness.topbar.hidden, true);
  harness.command.fire("click");
  assert.equal(harness.context.paletteClosed, true);
  assert.equal(harness.overlay.hidden, false);
  assert.equal(harness.activateCalls, 0);
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  primary.fire("click"); primary.fire("click");
  assert.equal(harness.activateCalls, 1);
  harness.resolveActivate({ ok: false, resumable: true, activationId: "existing-activation" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  primary.fire("click");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.resumeCalls, 1);
  assert.equal(harness.activateCalls, 1);
});

test("P053a exposes fresh-device open directly and updates after an owner transition without a timer", async () => {
  const harness = createUiHarness("none");
  assert.equal(harness.command.hidden, false);
  assert.equal(harness.topbar.hidden, false);
  harness.topbar.fire("click");
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  primary.fire("click");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.openCalls, 1);
  harness.setSession({ ownerKind: "synced", id: 2 });
  harness.context.PocketSyncUi.refresh();
  assert.equal(harness.command.hidden, true);
  assert.equal(harness.topbar.hidden, true);
  assert.equal(harness.source.textContent, "Synced Pocket");
});

test("P053 local composition installs the UI only after an explicit injected create", () => {
  const source = fs.readFileSync(path.join(ROOT, "js/pocket-sync-local-integration.js"), "utf8");
  assert.match(source, /PocketSyncUi\?\.install\?\.\(integration\)/);
  assert.match(
    fs.readFileSync(path.join(ROOT, "sync-service/pocket-sync-local-integration-server.js"), "utf8"),
    /PocketSyncLocalIntegration\.create\(\)/
  );
});
