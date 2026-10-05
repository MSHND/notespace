"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const UI_PATH = path.join(ROOT, "js/pocket-sync-ui.js");

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createHarness(options = {}) {
  class Element {
    constructor(id = "") {
      this.id = id;
      this.hidden = false;
      this.disabled = false;
      this.dataset = {};
      this.textContent = "";
      this.listeners = new Map();
      this.children = new Map();
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    fire(type, event = {}) {
      return this.listeners.get(type)?.({ preventDefault() {}, key: "", ...event });
    }
    focus() {}
    querySelector(selector) { return this.children.get(selector) || null; }
    set innerHTML(_value) {
      this.children.set("h2", new Element("syncSetupTitle"));
      this.children.set("#syncSetupBody", new Element("syncSetupBody"));
      this.children.set("#syncSetupStatus", new Element("syncSetupStatus"));
      const diagnostic = new Element("syncOpenDiagnostic");
      diagnostic.hidden = true;
      this.children.set("#syncOpenDiagnostic", diagnostic);
      this.children.set(".vaultDialogPrimary", new Button("syncPrimary"));
      this.children.set(".vaultDialogCreateAccount", new Button("syncCreateAccount"));
      this.children.set(".vaultDialogRecovery", new Button("syncRecovery"));
      const choose = new Button("syncChooseAccount");
      choose.hidden = true;
      this.children.set(".vaultDialogChooseAccount", choose);
      this.children.set(".vaultDialogRestart", new Button("syncRestart"));
      this.children.set(".vaultDialogSecondary", new Button("syncCancel"));
    }
  }
  class Button extends Element {}

  const command = new Button("cmdSync");
  command.children.set("span", new Element());
  command.children.set(".commandHint", new Element());
  const topbar = new Button("btnOpenSynced");
  const more = new Button("btnMore");
  const source = new Element("activeDocumentSource");
  const events = new Map();
  const document = {
    activeElement: new Button("initiator"),
    body: { children: [], appendChild(value) { this.children.push(value); } },
    getElementById(id) {
      return ({ cmdSync: command, btnOpenSynced: topbar, btnMore: more, activeDocumentSource: source })[id] || null;
    },
    createElement() { return new Element(); },
    addEventListener(type, listener) { events.set(type, listener); },
  };

  let session = { ownerKind: options.ownerKind || "json", id: 1 };
  let dirty = options.dirty === true;
  const openQueue = (options.openResults || []).slice();
  const openInputs = [];
  const pendingOpenResolvers = [];
  const ownerlessStarts = [];
  let discardTarget = options.discardTarget || { ownerKind: session.ownerKind, continuityId: "discard-1" };

  const context = {
    Object, Array, String, Boolean, Error, Promise,
    HTMLButtonElement: Button,
    HTMLElement: Element,
    document,
    location: { hash: options.hash || "" },
    capturePocketFileSaveSession() { return session; },
    hasPocketUnsavedChanges() { return dirty; },
    PocketNodePopoutWindow: { hasUnsavedChanges() { return false; } },
    requestAnimationFrame(callback) { callback(); },
    addEventListener(type, listener) { events.set(type, listener); },
    closeCommandPalette() { return false; },
    isPocketVaultRecoveryFlowOpen() { return false; },
    isPocketFilePermissionPromptOpen() { return false; },
    isPocketDeviceChangesDecisionOpen() { return false; },
    PocketVaultBrowserIo: { isDialogOpen() { return false; } },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UI_PATH, "utf8"), context, { filename: "pocket-sync-ui.js" });

  const integration = {
    activate() { return Promise.resolve({ ok: false, reason: "synthetic-activation-failure" }); },
    resume() { return Promise.resolve({ ok: false }); },
    openExisting(input) {
      openInputs.push(input);
      const next = openQueue.length ? openQueue.shift() : { ok: false, reason: "synthetic-open-failure" };
      if (next?.pending === true) {
        return new Promise((resolve) => pendingOpenResolvers.push(resolve));
      }
      return Promise.resolve(next);
    },
    captureSwitchTarget() {
      return { ownerKind: session.ownerKind, id: session.id };
    },
    saveSwitchTarget() {
      dirty = false;
      return Promise.resolve({ ok: true });
    },
    discardSwitchTarget() {
      return discardTarget;
    },
    recoverExisting() { return Promise.resolve({ ok: false, reason: "recovery-failed" }); },
    resumeRecovery() { return Promise.resolve({ ok: false }); },
    findRecoveryAttempt() { return Promise.resolve({ ok: true }); },
    startOwnerlessFirstCreate(input) {
      ownerlessStarts.push(input);
      return Promise.resolve({ ok: false, reason: "synthetic-ownerless-failure" });
    },
    continueOwnerlessFirstCreate() { return Promise.resolve({ ok: false }); },
    getLatestOpenDiagnostic() {
      return options.diagnostic || null;
    },
  };

  assert.equal(context.PocketSyncUi.install(integration), true);
  const overlay = document.body.children[0];

  return {
    context,
    topbar,
    overlay,
    primary: overlay.querySelector(".vaultDialogPrimary"),
    choose: overlay.querySelector(".vaultDialogChooseAccount"),
    recovery: overlay.querySelector(".vaultDialogRecovery"),
    cancel: overlay.querySelector(".vaultDialogSecondary"),
    createAccount: overlay.querySelector(".vaultDialogCreateAccount"),
    openInputs,
    ownerlessStarts,
    setSession(value) { session = value; },
    setDirty(value) { dirty = value; },
    setDiscardTarget(value) { discardTarget = value; },
    queueOpen(value) { openQueue.push(value); },
    resolveNextOpen(value) { pendingOpenResolvers.shift()?.(value); },
  };
}

test("P345 ordinary Open exposes explicit reselection only after exact not-configured and never retries automatically", async () => {
  const h = createHarness({
    openResults: [
      { ok: false, reason: "synced-pocket-not-configured", authenticatedAccountSuffix: "x2-DE" },
      { ok: true },
    ],
  });

  h.topbar.fire("click");
  assert.equal(h.choose.hidden, true, "action starts hidden");
  h.primary.fire("click");
  await settle();

  assert.equal(h.openInputs.length, 1, "exact failure does not automatically retry");
  assert.equal(h.openInputs[0], undefined, "ordinary Open sends no accountSelection");
  assert.equal(h.choose.hidden, false, "exact not-configured exposes the action without diagnostics");

  h.choose.fire("click");
  await settle();

  assert.equal(h.openInputs.length, 2, "one click creates exactly one additional Open");
  assert.deepEqual(plain(h.openInputs[1]), { accountSelection: "choose-another" });
  assert.equal(h.overlay.hidden, true, "successful existing Open handling is reused");
});

test("P345 dirty discard retry preserves the exact discard target and only adds accountSelection", async () => {
  const discardTarget = { ownerKind: "json", continuityId: "exact-discard-target", token: { id: 7 } };
  const h = createHarness({
    ownerKind: "json",
    dirty: true,
    discardTarget,
    openResults: [
      { ok: false, reason: "synced-pocket-not-configured" },
      { ok: false, reason: "credential-failed" },
    ],
  });

  h.topbar.fire("click");
  assert.equal(h.primary.dataset.mode, "switch");
  assert.equal(h.choose.hidden, true);
  h.recovery.fire("click");
  await settle();
  assert.equal(h.primary.dataset.mode, "open");

  h.primary.fire("click");
  await settle();

  assert.equal(h.openInputs.length, 1);
  assert.equal(h.openInputs[0].discardTarget, discardTarget, "initial Open owns the exact existing discardTarget");
  assert.equal(Object.prototype.hasOwnProperty.call(h.openInputs[0], "accountSelection"), false);
  assert.equal(h.choose.hidden, false);

  h.choose.fire("click");
  await settle();

  assert.equal(h.openInputs.length, 2);
  assert.equal(h.openInputs[1].discardTarget, discardTarget, "reselection preserves the exact discardTarget object");
  assert.equal(h.openInputs[1].accountSelection, "choose-another");
  assert.equal(h.choose.hidden, true, "non-matching retry result leaves no stale action");
});

test("P345 action is exact-reason scoped, hidden at every new Open execution, and single-flights while busy", async () => {
  const h = createHarness({
    openResults: [
      { ok: false, reason: "additional-device-open-failed" },
      { ok: false, reason: "synced-pocket-not-configured" },
      { pending: true },
    ],
  });

  h.topbar.fire("click");
  h.primary.fire("click");
  await settle();
  assert.equal(h.choose.hidden, true, "generic failure does not expose reselection");

  h.primary.fire("click");
  await settle();
  assert.equal(h.choose.hidden, false);

  h.choose.fire("click");
  assert.equal(h.choose.hidden, true, "new Open hides the action immediately");
  assert.equal(h.choose.disabled, true, "same busy state disables the action");
  h.choose.fire("click");
  assert.equal(h.openInputs.length, 3, "busy duplicate click cannot create another Open");

  h.resolveNextOpen({ ok: false, reason: "credential-failed" });
  await settle();
  assert.equal(h.choose.hidden, true, "non-matching completion cannot revive stale action");
});


test("P345 stale visible action cannot run after the current owner stops being eligible for Open", async () => {
  const h = createHarness({
    openResults: [{ ok: false, reason: "synced-pocket-not-configured" }],
  });

  h.topbar.fire("click");
  h.primary.fire("click");
  await settle();
  assert.equal(h.choose.hidden, false);
  assert.equal(h.openInputs.length, 1);

  h.setSession({ ownerKind: "synced", id: 99 });
  h.choose.fire("click");
  await settle();

  assert.equal(h.openInputs.length, 1, "stale action does not invoke Open after owner eligibility changes");
});

test("P345 Cancel closes and clears Open-local reselection input", async () => {
  const h = createHarness({
    openResults: [
      { ok: false, reason: "synced-pocket-not-configured" },
      { ok: false, reason: "synced-pocket-not-configured" },
      { ok: false, reason: "generic-after-reopen" },
    ],
  });

  h.topbar.fire("click");
  h.primary.fire("click");
  await settle();
  h.choose.fire("click");
  await settle();
  assert.deepEqual(plain(h.openInputs[1]), { accountSelection: "choose-another" });
  assert.equal(h.choose.hidden, false);

  h.cancel.fire("click");
  assert.equal(h.overlay.hidden, true);

  h.topbar.fire("click");
  assert.equal(h.choose.hidden, true);
  h.primary.fire("click");
  await settle();
  assert.equal(h.openInputs[2], undefined, "fresh Open after Cancel has no stale accountSelection");
});

test("P345 keeps the action out of ownerless and Recovery composition", async () => {
  const ownerless = createHarness({ ownerKind: "none" });
  assert.equal(ownerless.context.PocketSyncUi.beginCreateNew(), true);
  assert.equal(ownerless.primary.dataset.mode, "ownerless-create");
  assert.equal(ownerless.choose.hidden, true);
  ownerless.createAccount.fire("click");
  await settle();
  assert.equal(ownerless.ownerlessStarts.length, 1);
  assert.deepEqual(plain(ownerless.ownerlessStarts[0]), { accountPath: "new-account" });
  assert.equal(ownerless.choose.hidden, true);

  const recovery = createHarness({ ownerKind: "json" });
  recovery.topbar.fire("click");
  assert.equal(recovery.primary.dataset.mode, "open");
  assert.equal(recovery.choose.hidden, true);
  recovery.recovery.fire("click");
  assert.equal(recovery.primary.dataset.mode, "recovery");
  assert.equal(recovery.choose.hidden, true);
});

test("P345 eligibility is diagnostic-independent and creates no new account authority", () => {
  const ui = fs.readFileSync(UI_PATH, "utf8");
  assert.match(ui, /result\?\.reason === "synced-pocket-not-configured"/);
  assert.match(ui, /accountSelection: "choose-another"/);
  assert.doesNotMatch(ui, /authenticatedAccountSuffix/);
  assert.doesNotMatch(ui, /document\.cookie|localStorage|sessionStorage|logout/i);
  assert.match(ui, /integration\.openExisting\(openExistingInput \|\| undefined\)/);
  assert.equal((ui.match(/integration\.openExisting\(/g) || []).length, 1, "UI keeps one Open service call owner");
});
