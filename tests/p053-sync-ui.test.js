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

function createUiHarness(ownerKind = "json", options = {}) {
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
      this.children.set(".vaultDialogRecovery", new Button("syncRecovery"));
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
    activeElement: new Button("initiator"), body: { children: [], appendChild(value) { this.children.push(value); } },
    getElementById(id) { return ({ cmdSync: command, btnOpenSynced: topbar, btnMore: more, activeDocumentSource: source })[id] || null; },
    createElement() { return new Element(); }, addEventListener(type, listener) { events.set(type, listener); },
  };
  let session = { ownerKind, id: 1 };
  let dirty = options.dirty === true;
  let activateCalls = 0; let openCalls = 0; let resumeCalls = 0; let recoveryCalls = 0; let recoveryResumeCalls = 0; let discoveryCalls = 0; let resumeInput; let recoveryResumeInput; let resolveActivate; let resolveOpen; let resolveRecovery; let resolveDiscovery;
  const context = {
    Object, Array, String, Boolean, Error, Promise, HTMLButtonElement: Button, HTMLElement: Element, document,
    capturePocketFileSaveSession() { return session; }, hasPocketUnsavedChanges() { return dirty; },
    requestAnimationFrame(callback) { callback(); }, addEventListener(type, listener) { events.set(type, listener); },
    closeCommandPalette() { context.paletteClosed = true; return options.paletteOpen === true; },
    isPocketVaultRecoveryFlowOpen() { return options.blocker === "recovery"; },
    isPocketFilePermissionPromptOpen() { return options.blocker === "permission"; },
    isPocketDeviceChangesDecisionOpen() { return options.blocker === "device"; },
    PocketVaultBrowserIo: { isDialogOpen() { return options.blocker === "vault"; } },
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UI_PATH, "utf8"), context, { filename: "pocket-sync-ui.js" });
  const integration = {
    activate() { activateCalls += 1; return new Promise((resolve) => { resolveActivate = resolve; }); },
    openExisting() { openCalls += 1; return options.holdOpen ? new Promise((resolve) => { resolveOpen = resolve; }) : Promise.resolve({ ok: true }); },
    resume(input) { resumeCalls += 1; resumeInput = input; return Promise.resolve({ ok: false }); },
    ...(options.recovery === false ? {} : {
      recoverExisting() { recoveryCalls += 1; return new Promise((resolve) => { resolveRecovery = resolve; }); },
    resumeRecovery(input) { recoveryResumeCalls += 1; recoveryResumeInput = input; return Promise.resolve(options.resumeRecoveryResult || { ok: false }); },
    }),
    ...((Object.hasOwn(options, "discoveryResult") || options.discoveryPending === true) ? {
      findRecoveryAttempt() {
        discoveryCalls += 1;
        return options.discoveryPending === true
          ? new Promise((resolve) => { resolveDiscovery = resolve; })
          : Promise.resolve(options.discoveryResult);
      },
    } : {}),
  };
  assert.equal(context.PocketSyncUi.install(integration), true);
  return { context, command, topbar, source, overlay: document.body.children[0], integration,
    setSession(value) { session = value; }, setDirty(value) { dirty = value; }, get activateCalls() { return activateCalls; }, get openCalls() { return openCalls; }, get resumeCalls() { return resumeCalls; }, get recoveryCalls() { return recoveryCalls; }, get recoveryResumeCalls() { return recoveryResumeCalls; }, get discoveryCalls() { return discoveryCalls; }, get recoveryResumeInput() { return recoveryResumeInput; }, get resumeInput() { return resumeInput; }, get resolveActivate() { return resolveActivate; }, get resolveOpen() { return resolveOpen; }, get resolveRecovery() { return resolveRecovery; }, get resolveDiscovery() { return resolveDiscovery; }, event(name, input = {}) { return events.get(name)?.({ preventDefault() {}, key: "", ...input }); }, more };
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
  assert.equal(JSON.stringify(harness.resumeInput), '{"activationId":"existing-activation"}');
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

test("P088 offers one locally discovered Recovery attempt without starting it", async () => {
  const harness = createUiHarness("none", { discoveryResult: {
    ok: true, recoveryAttemptId: "opaque-recovery-after-reload",
  } });
  harness.topbar.fire("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  assert.equal(harness.discoveryCalls, 1);
  assert.equal(primary.textContent, "Continue recovery");
  assert.equal(primary.dataset.mode, "recovery-continue");
  assert.equal(harness.openCalls, 0);
  assert.equal(harness.recoveryCalls, 0);
  primary.fire("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.recoveryResumeCalls, 1);
  assert.equal(JSON.stringify(harness.recoveryResumeInput),
    '{"recoveryAttemptId":"opaque-recovery-after-reload"}');
});

test("P088 leaves zero matches ordinary and fails ambiguous local Recovery closed", async () => {
  const none = createUiHarness("none", { discoveryResult: { ok: true } });
  none.topbar.fire("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(none.overlay.querySelector(".vaultDialogPrimary").textContent, "Open synced Pocket");
  assert.equal(none.overlay.querySelector(".vaultDialogRecovery").hidden, false);
  const ambiguous = createUiHarness("none", { discoveryResult: {
    ok: false, reason: "recovery-discovery-needs-attention",
  } });
  ambiguous.topbar.fire("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(ambiguous.overlay.querySelector("h2").textContent, "Recovery needs attention");
  assert.equal(ambiguous.overlay.querySelector(".vaultDialogPrimary").hidden, true);
  assert.equal(ambiguous.overlay.querySelector(".vaultDialogRecovery").hidden, true);
  assert.equal(ambiguous.overlay.querySelector("#syncSetupStatus").textContent,
    "Recovery on this device needs attention before it can continue.");
  ambiguous.overlay.querySelector(".vaultDialogPrimary").fire("click");
  ambiguous.overlay.querySelector(".vaultDialogRecovery").fire("click");
  assert.equal(ambiguous.openCalls, 0);
  assert.equal(ambiguous.recoveryCalls, 0);
});

test("P088a keeps Recovery discovery pending local and cancellable", async () => {
  const harness = createUiHarness("none", { discoveryPending: true });
  harness.topbar.fire("click");
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  const recovery = harness.overlay.querySelector(".vaultDialogRecovery");
  assert.equal(harness.discoveryCalls, 1);
  assert.equal(primary.hidden, true);
  assert.equal(recovery.hidden, true);
  primary.fire("click");
  recovery.fire("click");
  assert.equal(harness.openCalls, 0);
  assert.equal(harness.recoveryCalls, 0);
  assert.equal(harness.recoveryResumeCalls, 0);
  harness.overlay.querySelector(".vaultDialogSecondary").fire("click");
  assert.equal(harness.overlay.hidden, true);
  harness.resolveDiscovery({ ok: true, recoveryAttemptId: "stale-recovery-attempt" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.overlay.hidden, true);
  assert.equal(primary.textContent, "");
});

test("P088a ignores a discovery result after its target session changes", async () => {
  const harness = createUiHarness("none", { discoveryPending: true });
  harness.topbar.fire("click");
  harness.setSession({ ownerKind: "none", id: 2 });
  harness.resolveDiscovery({ ok: true, recoveryAttemptId: "stale-recovery-attempt" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.overlay.querySelector(".vaultDialogPrimary").hidden, true);
  assert.equal(harness.openCalls, 0);
  assert.equal(harness.recoveryCalls, 0);
});

test("P086 gives recovery-required its specific mobile guidance before generic ownership copy", async () => {
  const harness = createUiHarness("none", { holdOpen: true });
  harness.topbar.fire("click");
  harness.overlay.querySelector(".vaultDialogPrimary").fire("click");
  harness.resolveOpen({ ok: false, reason: "recovery-required", adopted: false });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.overlay.querySelector("#syncSetupStatus").textContent,
    "A recovery copy is needed to open this synced Pocket on this device.");
});

test("P086 keeps recovery picker cancellation and replacement-copy failure truthful", async () => {
  for (const [reason, expected] of [
    ["recovery-package-invalid", "Recovery copy could not be used. Your current Pocket is unchanged."],
    ["replacement-recovery-copy-not-stored", "Save the replacement recovery copy, then continue recovery. Continue recovery will retry this same recovery attempt."],
  ]) {
    const harness = createUiHarness("none");
    harness.topbar.fire("click");
    harness.overlay.querySelector(".vaultDialogRecovery").fire("click");
    harness.overlay.querySelector(".vaultDialogPrimary").fire("click");
    harness.resolveRecovery({ ok: false, reason, resumable: reason === "replacement-recovery-copy-not-stored",
      recoveryAttemptId: "opaque-recovery-attempt" });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(harness.overlay.querySelector("#syncSetupStatus").textContent, expected);
  }
});

test("P087 presents resumable recovery boundaries without exposing recovery internals", async () => {
  for (const [reason, expected] of [
    ["recovery-begin-unavailable", "Pocket could not start recovery with the synced service."],
    ["recovery-finish-unavailable", "Pocket could not finish this device’s recovery passkey with the synced service."],
    ["remote-content-unavailable", "Pocket could not read the synced content for recovery."],
    ["device-finalisation-failed", "Pocket could not finalise recovery on this device."],
  ]) {
    const harness = createUiHarness("none");
    harness.topbar.fire("click");
    harness.overlay.querySelector(".vaultDialogRecovery").fire("click");
    const primary = harness.overlay.querySelector(".vaultDialogPrimary");
    primary.fire("click");
    harness.resolveRecovery({ ok: false, reason, resumable: true, recoveryAttemptId: "opaque-recovery-attempt" });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const status = harness.overlay.querySelector("#syncSetupStatus").textContent;
    assert.equal(status, `${expected} Continue recovery will retry this same recovery attempt.`);
    assert.equal(primary.textContent, "Continue recovery");
    assert.equal(primary.dataset.mode, "recovery-continue");
    assert.doesNotMatch(status, /opaque-recovery-attempt|recovery-begin-unavailable|credential|locator|proof/i);
  }
});

test("P087 keeps non-resumable recovery failures out of Continue recovery", async () => {
  const harness = createUiHarness("none", { resumeRecoveryResult: {
    ok: false, reason: "recovery-begin-failed", resumable: false,
  } });
  harness.topbar.fire("click");
  harness.overlay.querySelector(".vaultDialogRecovery").fire("click");
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  primary.fire("click");
  harness.resolveRecovery({ ok: false, reason: "recovery-begin-unavailable", resumable: true,
    recoveryAttemptId: "opaque-recovery-attempt" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  primary.fire("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(primary.textContent, "Use recovery copy");
  assert.equal(primary.dataset.mode, "recovery");
  assert.equal(harness.overlay.querySelector("h2").textContent, "Use recovery copy");
  assert.doesNotMatch(harness.overlay.querySelector("#syncSetupStatus").textContent, /Continue recovery|Sync setup could not finish/);
});

test("P090 holds a durable non-resumable Recovery attempt for attention", async () => {
  const harness = createUiHarness("none");
  harness.topbar.fire("click");
  harness.overlay.querySelector(".vaultDialogRecovery").fire("click");
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  const recovery = harness.overlay.querySelector(".vaultDialogRecovery");
  primary.fire("click");
  harness.resolveRecovery({ ok: false, reason: "recovery-begin-expired", locallyDurable: true,
    resumable: false, recoveryAttemptId: "opaque-recovery-attempt" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.overlay.querySelector("h2").textContent, "Recovery needs attention");
  assert.equal(primary.hidden, true);
  assert.equal(recovery.hidden, true);
  assert.equal(harness.overlay.querySelector("#syncSetupStatus").textContent,
    "The saved recovery request expired and needs attention.");
  primary.fire("click");
  recovery.fire("click");
  assert.equal(harness.recoveryCalls, 1);
  assert.equal(harness.recoveryResumeCalls, 0);
  harness.event("keydown", { key: "Escape" });
  assert.equal(harness.overlay.hidden, true);
});

test("P090a reopens durable Recovery attention without offering a new action", async () => {
  const harness = createUiHarness("none", { discoveryResult: {
    ok: false, reason: "recovery-begin-not-found", locallyDurable: true,
    resumable: false, recoveryAttemptId: "opaque-recovery-attempt",
  } });
  for (const close of ["cancel", "escape"]) {
    harness.topbar.fire("click");
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const primary = harness.overlay.querySelector(".vaultDialogPrimary");
    const recovery = harness.overlay.querySelector(".vaultDialogRecovery");
    assert.equal(harness.overlay.querySelector("h2").textContent, "Recovery needs attention");
    assert.equal(primary.hidden, true);
    assert.equal(recovery.hidden, true);
    assert.equal(harness.overlay.querySelector("#syncSetupStatus").textContent,
      "This Recovery Copy is not available for this synced Pocket.");
    primary.fire("click");
    recovery.fire("click");
    assert.equal(harness.recoveryCalls, 0);
    assert.equal(harness.recoveryResumeCalls, 0);
    if (close === "cancel") harness.overlay.querySelector(".vaultDialogSecondary").fire("click");
    else harness.event("keydown", { key: "Escape" });
    assert.equal(harness.overlay.hidden, true);
  }
  assert.equal(harness.discoveryCalls, 2);
});

test("P091 presents each bounded Recovery rejection as attention only", async () => {
  for (const [reason, expected] of [
    ["recovery-begin-request-rejected", "Pocket could not accept this recovery request."],
    ["recovery-begin-authentication-rejected", "Pocket could not authenticate this recovery request."],
    ["recovery-begin-authorisation-rejected", "Pocket could not authorise this recovery request."],
    ["recovery-begin-conflict", "This recovery request conflicts with existing recovery state."],
  ]) {
    const harness = createUiHarness("none", { discoveryResult: {
      ok: false, reason, locallyDurable: true, resumable: false,
      recoveryAttemptId: "opaque-recovery-attempt",
    } });
    harness.topbar.fire("click");
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(harness.overlay.querySelector("h2").textContent, "Recovery needs attention");
    assert.equal(harness.overlay.querySelector(".vaultDialogPrimary").hidden, true);
    assert.equal(harness.overlay.querySelector(".vaultDialogRecovery").hidden, true);
    assert.equal(harness.overlay.querySelector("#syncSetupStatus").textContent, expected);
    assert.equal(harness.recoveryCalls, 0);
    assert.equal(harness.recoveryResumeCalls, 0);
  }
});

test("P055a opens recovery only after explicit confirmation, and Cancel or idle Escape leave it untouched", () => {
  const cancel = createUiHarness("none", { paletteOpen: true });
  cancel.topbar.fire("click");
  const cancelRecovery = cancel.overlay.querySelector(".vaultDialogRecovery");
  cancelRecovery.fire("click");
  assert.equal(cancel.overlay.querySelector(".vaultDialogPrimary").dataset.mode, "recovery");
  assert.equal(cancel.recoveryCalls, 0);
  cancel.overlay.querySelector(".vaultDialogSecondary").fire("click");
  assert.equal(cancel.overlay.hidden, true);
  assert.equal(cancel.recoveryCalls, 0);
  assert.equal(cancel.more.focused, true);

  const escape = createUiHarness("none", { paletteOpen: true });
  escape.topbar.fire("click");
  escape.overlay.querySelector(".vaultDialogRecovery").fire("click");
  assert.equal(escape.recoveryCalls, 0);
  escape.event("keydown", { key: "Escape" });
  assert.equal(escape.overlay.hidden, true);
  assert.equal(escape.recoveryCalls, 0);
  assert.equal(escape.more.focused, true);
});

test("P055a recovery is unavailable behind dirty work or every existing blocking overlay", () => {
  const dirty = createUiHarness("detached", { dirty: true });
  assert.equal(dirty.command.hidden, true);
  assert.equal(dirty.topbar.hidden, true);
  dirty.topbar.fire("click");
  dirty.overlay.querySelector(".vaultDialogRecovery").fire("click");
  assert.equal(dirty.overlay.hidden, true);
  assert.equal(dirty.recoveryCalls, 0);

  for (const blocker of ["recovery", "permission", "device", "vault"]) {
    const harness = createUiHarness("none", { blocker });
    harness.topbar.fire("click");
    harness.overlay.querySelector(".vaultDialogRecovery").fire("click");
    assert.equal(harness.overlay.hidden, true, blocker);
    assert.equal(harness.recoveryCalls, 0, blocker);
  }
});

test("P055a keeps recovery optional, single-flight, and resumes only with its opaque attempt ID", async () => {
  const unavailable = createUiHarness("none", { recovery: false });
  unavailable.topbar.fire("click");
  assert.equal(unavailable.overlay.querySelector(".vaultDialogRecovery").hidden, true);
  unavailable.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(unavailable.openCalls, 1);

  const harness = createUiHarness("none");
  harness.topbar.fire("click");
  const recovery = harness.overlay.querySelector(".vaultDialogRecovery");
  recovery.fire("click");
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  primary.fire("click"); primary.fire("click");
  assert.equal(harness.recoveryCalls, 1);
  harness.event("keydown", { key: "Escape" });
  assert.equal(harness.overlay.hidden, false);
  assert.equal(harness.overlay.querySelector(".vaultDialogSecondary").disabled, true);
  harness.resolveRecovery({ ok: false, resumable: true, recoveryAttemptId: "existing-recovery" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.recoveryCalls, 1);
  primary.fire("click");
  await Promise.resolve();
  assert.equal(harness.recoveryResumeCalls, 1);
  assert.equal(JSON.stringify(harness.recoveryResumeInput), '{"recoveryAttemptId":"existing-recovery"}');
  assert.equal(harness.recoveryCalls, 1);
  for (const element of [
    harness.overlay.querySelector("h2"),
    harness.overlay.querySelector("#syncSetupBody"),
    harness.overlay.querySelector("#syncSetupStatus"),
    primary,
  ]) assert.doesNotMatch(element.textContent, /existing-recovery/);
});

test("P055a successful recovery closes and refreshes after the owner state becomes synced", async () => {
  const harness = createUiHarness("none");
  harness.topbar.fire("click");
  harness.overlay.querySelector(".vaultDialogRecovery").fire("click");
  const primary = harness.overlay.querySelector(".vaultDialogPrimary");
  primary.fire("click");
  assert.equal(harness.recoveryCalls, 1);
  harness.setSession({ ownerKind: "synced", id: 2 });
  harness.event("pocket-owner-state-changed");
  harness.resolveRecovery({ ok: true });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.overlay.hidden, true);
  assert.equal(harness.command.hidden, true);
  assert.equal(harness.topbar.hidden, true);
  assert.equal(harness.source.textContent, "Synced Pocket");
});

test("P053b keeps dirty detached work out of Sync open and single-flights a fresh open", async () => {
  const dirty = createUiHarness("detached", { dirty: true });
  assert.equal(dirty.command.hidden, true);
  assert.equal(dirty.topbar.hidden, true);
  dirty.command.fire("click");
  assert.equal(dirty.openCalls, 0);

  const clean = createUiHarness("detached", { holdOpen: true });
  assert.equal(clean.topbar.hidden, false);
  clean.topbar.fire("click");
  const primary = clean.overlay.querySelector(".vaultDialogPrimary");
  primary.fire("click"); primary.fire("click");
  assert.equal(clean.openCalls, 1);
  clean.resolveOpen({ ok: true });
  await Promise.resolve(); await Promise.resolve();
});

test("P053c idle Escape restores visible focus and busy Escape keeps Sync truthful", async () => {
  const idle = createUiHarness("json", { paletteOpen: true });
  idle.command.fire("click");
  idle.event("keydown", { key: "Escape" });
  assert.equal(idle.overlay.hidden, true);
  assert.equal(idle.activateCalls, 0);
  assert.equal(idle.openCalls, 0);
  assert.equal(idle.resumeCalls, 0);
  assert.equal(idle.more.focused, true);
  idle.command.fire("click");
  const primary = idle.overlay.querySelector(".vaultDialogPrimary");
  primary.fire("click");
  idle.event("keydown", { key: "Escape" });
  assert.equal(idle.overlay.querySelector(".vaultDialogSecondary").disabled, true);
  assert.equal(idle.overlay.hidden, false);
  idle.resolveActivate({ ok: false });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(idle.overlay.hidden, false);
});

test("P084 only claims the source survived when the activation result proves it", async () => {
  const finalised = createUiHarness("json");
  finalised.command.fire("click");
  finalised.overlay.querySelector(".vaultDialogPrimary").fire("click");
  finalised.resolveActivate({ ok: false, reason: "owner-adoption-finalisation-failed",
    adopted: true, sourceOwnerPreserved: false });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const finalisedCopy = finalised.overlay.querySelector("#syncSetupStatus").textContent;
  assert.match(finalisedCopy, /Synced Pocket is now the owner/);
  assert.doesNotMatch(finalisedCopy, /unchanged/);

  const unknown = createUiHarness("json");
  unknown.command.fire("click");
  unknown.overlay.querySelector(".vaultDialogPrimary").fire("click");
  unknown.resolveActivate({ ok: false, reason: "sync-unavailable" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.doesNotMatch(unknown.overlay.querySelector("#syncSetupStatus").textContent, /unchanged/);
});

test("P053b blocking overlays prevent Sync stacking and owner events refresh immediately", () => {
  for (const blocker of ["recovery", "permission", "device", "vault"]) {
    const harness = createUiHarness("json", { blocker });
    harness.command.fire("click");
    assert.equal(harness.overlay.hidden, true, blocker);
    assert.equal(harness.activateCalls, 0, blocker);
  }
  const harness = createUiHarness("none");
  harness.setSession({ ownerKind: "synced", id: 2 });
  harness.event("pocket-owner-state-changed");
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
