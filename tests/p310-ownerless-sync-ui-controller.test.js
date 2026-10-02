"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const UI_PATH = path.join(ROOT, "js/pocket-sync-ui.js");
const SECRET = "P310-PRIVATE-MATERIAL-MUST-NOT-RENDER";

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function createHarness(ownerKind = "none", options = {}) {
  class Element {
    constructor(id = "") {
      this.id = id;
      this.hidden = false;
      this.disabled = false;
      this.dataset = {};
      this.textContent = "";
      this.listeners = new Map();
      this.children = new Map();
      this.focused = false;
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    fire(type, event = {}) {
      return this.listeners.get(type)?.({ preventDefault() {}, key: "", ...event });
    }
    focus() { this.focused = true; }
    querySelector(selector) { return this.children.get(selector) || null; }
    set innerHTML(_value) {
      this.children.set("h2", new Element("syncSetupTitle"));
      this.children.set("#syncSetupBody", new Element("syncSetupBody"));
      this.children.set("#syncSetupStatus", new Element("syncSetupStatus"));
      this.children.set(".vaultDialogPrimary", new Button("syncPrimary"));
      this.children.set(".vaultDialogCreateAccount", new Button("syncCreateAccount"));
      this.children.set(".vaultDialogRecovery", new Button("syncRecovery"));
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
  const sourceNode = new Element("activeDocumentSource");
  const initiator = new Button("initiator");
  const events = new Map();
  const document = {
    activeElement: initiator,
    body: {
      children: [],
      appendChild(value) { this.children.push(value); },
    },
    getElementById(id) {
      return ({
        cmdSync: command,
        btnOpenSynced: topbar,
        btnMore: more,
        activeDocumentSource: sourceNode,
      })[id] || null;
    },
    createElement() { return new Element(); },
    addEventListener(type, listener) { events.set(type, listener); },
  };

  let session = { ownerKind, id: 1 };
  let resolveStart;
  let resolveContinue;
  const startResults = (options.startResults || []).slice();
  const continueResults = (options.continueResults || []).slice();
  const calls = {
    activate: 0,
    resume: 0,
    openExisting: 0,
    start: [],
    continue: [],
  };

  function next(queue, fallback) {
    return queue.length ? queue.shift() : fallback;
  }

  const context = {
    Object, Array, String, Boolean, Error, Promise,
    HTMLButtonElement: Button,
    HTMLElement: Element,
    document,
    capturePocketFileSaveSession() { return session; },
    hasPocketUnsavedChanges() { return false; },
    PocketNodePopoutWindow: { hasUnsavedChanges() { return false; } },
    requestAnimationFrame(callback) { callback(); },
    addEventListener(type, listener) { events.set(type, listener); },
    closeCommandPalette() { return options.paletteOpen === true; },
    isPocketVaultRecoveryFlowOpen() { return options.blocker === "recovery"; },
    isPocketFilePermissionPromptOpen() { return options.blocker === "permission"; },
    isPocketDeviceChangesDecisionOpen() { return options.blocker === "device"; },
    PocketVaultBrowserIo: { isDialogOpen() { return options.blocker === "vault"; } },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UI_PATH, "utf8"), context, { filename: "pocket-sync-ui.js" });

  const integration = {
    activate() { calls.activate += 1; return Promise.resolve({ ok: false }); },
    resume(input) { calls.resume += 1; return Promise.resolve({ ok: false, input }); },
    openExisting(input) { calls.openExisting += 1; return Promise.resolve({ ok: false, input }); },
  };

  if (options.ownerless !== false) {
    integration.startOwnerlessFirstCreate = (input) => {
      calls.start.push(plain(input));
      if (options.holdStart === true) {
        return new Promise((resolve) => { resolveStart = resolve; });
      }
      return Promise.resolve(next(startResults, { ok: false, reason: "synthetic-start-failure" }));
    };
    integration.continueOwnerlessFirstCreate = (input) => {
      calls.continue.push(plain(input));
      if (typeof options.continueOwnerKindOnCall === "string") {
        session = { ownerKind: options.continueOwnerKindOnCall, id: session.id + 1 };
      }
      if (options.holdContinue === true) {
        return new Promise((resolve) => { resolveContinue = resolve; });
      }
      return Promise.resolve(next(continueResults, { ok: false, reason: "synthetic-continue-failure" }));
    };
  }

  assert.equal(context.PocketSyncUi.install(integration), true);
  const overlay = document.body.children[0];
  return {
    context,
    overlay,
    command,
    topbar,
    initiator,
    calls,
    setSession(value) { session = value; },
    resolveStart(value) { resolveStart?.(value); },
    resolveContinue(value) { resolveContinue?.(value); },
    event(type, value = {}) { return events.get(type)?.({ preventDefault() {}, key: "", ...value }); },
  };
}

function textSnapshot(harness) {
  const selectors = [
    "h2",
    "#syncSetupBody",
    "#syncSetupStatus",
    ".vaultDialogPrimary",
    ".vaultDialogCreateAccount",
    ".vaultDialogRecovery",
    ".vaultDialogRestart",
    ".vaultDialogSecondary",
  ];
  return selectors.map((selector) => harness.overlay.querySelector(selector)?.textContent || "").join("\n");
}

test("P310 keeps one frozen product-level Sync UI surface and does not add browser/FSA or Doorway routing ownership", () => {
  const context = { Object, Array, String, Boolean, Error };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UI_PATH, "utf8"), context, { filename: "pocket-sync-ui.js" });

  assert.deepEqual(Object.keys(context.PocketSyncUi), [
    "install", "refresh", "canOpenExisting", "canCreateNew", "beginCreateNew",
  ]);
  assert.equal(Object.isFrozen(context.PocketSyncUi), true);
  assert.equal(context.PocketSyncUi.canCreateNew(), false);
  assert.equal(context.PocketSyncUi.beginCreateNew(), false);

  const ui = source("js/pocket-sync-ui.js");
  assert.doesNotMatch(ui, /navigator|userAgent|platform|showOpenFilePicker|showSaveFilePicker|FileSystem/);
  assert.doesNotMatch(
    ui,
    /accountId|credentialId|ownerlessReadiness|outputBytes|masterKey|recoveryRoot|recoveryAuthorisation|recoveryPackage|ciphertext/
  );
  assert.match(ui, /integration\.startOwnerlessFirstCreate\(\{ accountPath \}\)/);
  assert.match(ui, /integration\.continueOwnerlessFirstCreate\(\{ activationId \}\)/);

  for (const file of [
    "js/pocket-doorway-capabilities.js",
    "js/pocket-render.js",
    "js/pocket-overlays-init.js",
    "index.html",
    "sw.js",
  ]) {
    const value = source(file);
    assert.doesNotMatch(
      value,
      /startOwnerlessFirstCreate|continueOwnerlessFirstCreate/,
      file
    );
  }
  assert.match(source("js/pocket-doorway-capabilities.js"), /canCreateNew/);
  assert.match(source("js/pocket-overlays-init.js"), /beginCreateNew/);
});

test("P310 preserves legacy installation while canCreateNew is exact owner/capability/busy state", async () => {
  const legacy = createHarness("none", { ownerless: false });
  assert.equal(legacy.context.PocketSyncUi.canOpenExisting(), true);
  assert.equal(legacy.context.PocketSyncUi.canCreateNew(), false);
  assert.equal(legacy.context.PocketSyncUi.beginCreateNew(), false);
  assert.equal(legacy.calls.start.length, 0);

  for (const [ownerKind, expected] of [
    ["none", true],
    ["json", false],
    ["vault", false],
    ["detached", false],
    ["synced", false],
  ]) {
    const h = createHarness(ownerKind);
    assert.equal(h.context.PocketSyncUi.canCreateNew(), expected, ownerKind);
  }

  const blocked = createHarness("none", { blocker: "recovery" });
  assert.equal(blocked.context.PocketSyncUi.canCreateNew(), true);
  assert.equal(blocked.context.PocketSyncUi.beginCreateNew(), false);
  assert.equal(blocked.overlay.hidden, true);
  assert.equal(blocked.calls.start.length, 0);

  const modal = createHarness("none");
  modal.topbar.fire("click");
  assert.equal(modal.overlay.hidden, false);
  assert.equal(modal.context.PocketSyncUi.beginCreateNew(), false);
  assert.equal(modal.calls.start.length, 0);

  const busy = createHarness("none", { holdStart: true });
  assert.equal(busy.context.PocketSyncUi.beginCreateNew(), true);
  busy.overlay.querySelector(".vaultDialogPrimary").fire("click");
  assert.equal(busy.calls.start.length, 1);
  assert.equal(busy.context.PocketSyncUi.canCreateNew(), false);
  assert.equal(busy.context.PocketSyncUi.beginCreateNew(), false);
  busy.resolveStart({ ok: false, reason: "synthetic-stop" });
  await settle();
});

test("P310 requires explicit account intent and dispatches exactly one start with no fallback or Open call", async () => {
  const existing = createHarness("none", {
    startResults: [{ ok: false, reason: "synthetic-existing-failure" }],
  });
  assert.equal(existing.context.PocketSyncUi.beginCreateNew(), true);
  assert.equal(existing.overlay.querySelector("h2").textContent, "New Synced Pocket");
  assert.equal(
    existing.overlay.querySelector("#syncSetupBody").textContent,
    "Use an existing Pocket account, or create a new one."
  );
  existing.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.deepEqual(existing.calls.start, [{ accountPath: "existing-unbound" }]);
  assert.equal(existing.calls.continue.length, 0);
  assert.equal(existing.calls.openExisting, 0);

  const fresh = createHarness("none", {
    startResults: [{ ok: false, reason: "synthetic-new-failure" }],
  });
  fresh.context.PocketSyncUi.beginCreateNew();
  fresh.overlay.querySelector(".vaultDialogCreateAccount").fire("click");
  await settle();
  assert.deepEqual(fresh.calls.start, [{ accountPath: "new-account" }]);
  assert.equal(fresh.calls.continue.length, 0);
  assert.equal(fresh.calls.openExisting, 0);
});

test("P310 routes existing-pocket safely and never turns it into continuation or Open", async () => {
  const h = createHarness("none", {
    startResults: [{
      ok: true,
      status: "existing-pocket",
      syncedPocketId: "existing-pocket-id",
    }],
  });
  h.context.PocketSyncUi.beginCreateNew();
  h.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();

  assert.equal(h.calls.start.length, 1);
  assert.equal(h.calls.continue.length, 0);
  assert.equal(h.calls.openExisting, 0);
  assert.equal(
    h.overlay.querySelector("#syncSetupStatus").textContent,
    "This account already has a Synced Pocket. Use Open to open it."
  );
  assert.equal(h.overlay.querySelector(".vaultDialogPrimary").hidden, true);
});

test("P310 makes ownerless-attempt-exists and fresh account-ready explicit one-click continuations only", async () => {
  const existingAttempt = createHarness("none", {
    startResults: [{
      ok: false,
      reason: "ownerless-attempt-exists",
      activationId: "activation-existing",
    }],
  });
  existingAttempt.context.PocketSyncUi.beginCreateNew();
  existingAttempt.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(existingAttempt.calls.continue.length, 0);
  assert.equal(existingAttempt.overlay.querySelector("h2").textContent, "Continue Synced Pocket setup");
  assert.equal(existingAttempt.overlay.querySelector(".vaultDialogPrimary").textContent, "Continue setup");
  existingAttempt.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.deepEqual(existingAttempt.calls.continue, [{ activationId: "activation-existing" }]);

  const accountReady = createHarness("none", {
    startResults: [{
      ok: true,
      reason: "ownerless-account-ready",
      activationId: "activation-ready",
      accountPath: "new-account",
      stage: "account-ready",
      locallyDurable: true,
      adopted: false,
    }],
  });
  accountReady.context.PocketSyncUi.beginCreateNew();
  accountReady.overlay.querySelector(".vaultDialogCreateAccount").fire("click");
  await settle();
  assert.equal(accountReady.calls.continue.length, 0);
  assert.equal(accountReady.overlay.querySelector(".vaultDialogPrimary").textContent, "Continue setup");
  accountReady.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.deepEqual(accountReady.calls.continue, [{ activationId: "activation-ready" }]);
});

test("P310 requires a new explicit click after every canonical intermediate ownerless stage", async () => {
  const activationId = "activation-stages";
  const stages = [
    "account-ready",
    "content-committed",
    "device-envelope-committed",
    "prf-envelope-committed",
    "prf-envelope-skipped",
    "recovery-initialised",
    "recovery-copy-pending",
    "ready-for-adoption",
  ];
  const h = createHarness("none", {
    startResults: [{
      ok: true,
      reason: "ownerless-account-ready",
      activationId,
      stage: "account-ready",
      locallyDurable: true,
      adopted: false,
    }],
    continueResults: stages.map((stage) => ({
      ok: true,
      activationId,
      stage,
      locallyDurable: true,
      adopted: false,
    })),
  });

  h.context.PocketSyncUi.beginCreateNew();
  h.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(h.calls.continue.length, 0);

  for (let i = 0; i < stages.length; i += 1) {
    h.overlay.querySelector(".vaultDialogPrimary").fire("click");
    await settle();
    assert.equal(h.calls.continue.length, i + 1, stages[i]);
    assert.deepEqual(h.calls.continue[i], { activationId });
    assert.equal(h.overlay.querySelector(".vaultDialogPrimary").textContent, "Continue setup");
  }
  assert.equal(h.calls.continue.length, stages.length, "no automatic continuation");
});

test("P310 exposes only explicit resumable retry and fail-closes non-resumable, malformed, or mismatched continuation results", async () => {
  const activationId = "activation-retry";
  const h = createHarness("none", {
    startResults: [{
      ok: false,
      reason: "synthetic-resumable-start",
      activationId,
      locallyDurable: true,
      resumable: true,
    }],
    continueResults: [
      { ok: false, reason: "synthetic-resumable", activationId, resumable: true },
      { ok: false, reason: "synthetic-mismatch", activationId: "other", resumable: true },
    ],
  });

  h.context.PocketSyncUi.beginCreateNew();
  h.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(h.calls.continue.length, 0);
  assert.equal(h.overlay.querySelector(".vaultDialogPrimary").textContent, "Continue setup");

  h.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(h.calls.continue.length, 1);
  assert.equal(h.overlay.querySelector(".vaultDialogPrimary").textContent, "Continue setup");

  h.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(h.calls.continue.length, 2);
  assert.equal(h.overlay.querySelector(".vaultDialogPrimary").hidden, true);
  assert.equal(h.calls.continue.length, 2);

  const nonResumable = createHarness("none", {
    startResults: [{
      ok: false,
      reason: "synthetic-attention",
      activationId: "must-not-enable-continue",
      locallyDurable: true,
      resumable: false,
    }],
  });
  nonResumable.context.PocketSyncUi.beginCreateNew();
  nonResumable.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(nonResumable.overlay.querySelector(".vaultDialogPrimary").hidden, true);
  assert.equal(nonResumable.calls.continue.length, 0);

  const malformed = createHarness("none", {
    startResults: [{
      ok: true,
      reason: "ownerless-account-ready",
      activationId: " ",
      stage: "account-ready",
      locallyDurable: true,
      adopted: false,
    }],
  });
  malformed.context.PocketSyncUi.beginCreateNew();
  malformed.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(malformed.overlay.querySelector(".vaultDialogPrimary").hidden, true);
  assert.equal(malformed.calls.continue.length, 0);
});

test("P310 treats only exact adopted success as completion and never renders private result material", async () => {
  const activationId = "activation-adopt";
  const adopted = {
    ok: true,
    reason: "ownerless-activated",
    activationId,
    accountPath: "new-account",
    syncedPocketId: "canonical-pocket",
    stage: "adopted",
    adopted: true,
  };
  const good = createHarness("none", {
    startResults: [{
      ok: true,
      reason: "ownerless-account-ready",
      activationId,
      stage: "account-ready",
      locallyDurable: true,
      adopted: false,
      accountId: SECRET,
      credentialId: SECRET,
      outputBytes: SECRET,
      recoveryPackage: SECRET,
      ciphertext: SECRET,
    }],
    continueResults: [adopted],
    continueOwnerKindOnCall: "synced",
  });

  good.context.PocketSyncUi.beginCreateNew();
  good.overlay.querySelector(".vaultDialogCreateAccount").fire("click");
  await settle();
  assert.equal(textSnapshot(good).includes(SECRET), false);
  good.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(good.calls.continue.length, 1);
  assert.equal(good.overlay.hidden, true);
  assert.equal(good.context.PocketSyncUi.canCreateNew(), false);

  for (const badResult of [
    {
      ok: false,
      reason: "ownerless-adoption-finalisation-failed",
      activationId,
      syncedPocketId: "not-authoritative",
      stage: "adopted",
      adopted: true,
      resumable: false,
    },
    {
      ok: true,
      reason: "ownerless-activated",
      activationId,
      syncedPocketId: "   ",
      stage: "adopted",
      adopted: true,
    },
    {
      ok: true,
      reason: "ownerless-activated",
      activationId: "wrong-activation",
      syncedPocketId: "not-authoritative",
      stage: "adopted",
      adopted: true,
    },
  ]) {
    const h = createHarness("none", {
      startResults: [{
        ok: true,
        reason: "ownerless-account-ready",
        activationId,
        stage: "account-ready",
        locallyDurable: true,
        adopted: false,
      }],
      continueResults: [badResult],
    });
    h.context.PocketSyncUi.beginCreateNew();
    h.overlay.querySelector(".vaultDialogPrimary").fire("click");
    await settle();
    h.overlay.querySelector(".vaultDialogPrimary").fire("click");
    await settle();
    assert.equal(h.overlay.hidden, false);
    assert.equal(h.overlay.querySelector(".vaultDialogPrimary").hidden, true);
  }
});

test("P310 Cancel/Escape clears transient ownerless continuation and preserves the original focus target", async () => {
  const h = createHarness("none", {
    startResults: [{
      ok: true,
      reason: "ownerless-account-ready",
      activationId: "activation-cancel",
      stage: "account-ready",
      locallyDurable: true,
      adopted: false,
    }],
  });
  h.context.PocketSyncUi.beginCreateNew();
  h.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();
  assert.equal(h.overlay.querySelector(".vaultDialogPrimary").textContent, "Continue setup");

  h.overlay.querySelector(".vaultDialogSecondary").fire("click");
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.initiator.focused, true);

  assert.equal(h.context.PocketSyncUi.beginCreateNew(), true);
  assert.equal(h.overlay.querySelector("h2").textContent, "New Synced Pocket");
  assert.equal(h.overlay.querySelector(".vaultDialogPrimary").textContent, "Use existing account");
  assert.equal(h.calls.continue.length, 0);

  h.event("keydown", { key: "Escape" });
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.calls.continue.length, 0);
});
