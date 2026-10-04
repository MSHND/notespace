"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const UI_PATH = path.join(ROOT, "js/pocket-sync-ui.js");
const SECRET = "P331-RAW-OPEN-RESULT-MUST-NOT-RENDER";

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
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
      const diagnostic = new Element("syncOpenDiagnostic");
      diagnostic.hidden = true;
      this.children.set("#syncOpenDiagnostic", diagnostic);
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
  const openQueue = (options.openResults || []).slice();
  let diagnostic = options.diagnostic ?? null;
  let getterCalls = 0;
  let openCalls = 0;
  let activateCalls = 0;
  let resolveOpen = null;

  const context = {
    Object, Array, String, Boolean, Error, Promise,
    HTMLButtonElement: Button,
    HTMLElement: Element,
    document,
    location: { hash: options.hash || "" },
    capturePocketFileSaveSession() { return session; },
    hasPocketUnsavedChanges() { return false; },
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
    activate() {
      activateCalls += 1;
      return Promise.resolve(options.activateResult || { ok: false, reason: "synthetic-activation-failure" });
    },
    resume() { return Promise.resolve({ ok: false }); },
    openExisting() {
      openCalls += 1;
      const next = openQueue.length ? openQueue.shift() : { ok: true };
      if (next && next.pending === true) {
        return new Promise((resolve) => { resolveOpen = resolve; });
      }
      return Promise.resolve(next);
    },
  };

  if (options.getter !== "missing") {
    integration.getLatestOpenDiagnostic = () => {
      getterCalls += 1;
      if (options.getter === "throw") throw new Error("synthetic diagnostic failure");
      if (options.getter === "null") return null;
      return diagnostic;
    };
  }

  assert.equal(context.PocketSyncUi.install(integration), true);
  const overlay = document.body.children[0];
  return {
    context,
    command,
    topbar,
    overlay,
    diagnostic: overlay.querySelector("#syncOpenDiagnostic"),
    get getterCalls() { return getterCalls; },
    get openCalls() { return openCalls; },
    get activateCalls() { return activateCalls; },
    queueOpen(value) { openQueue.push(value); },
    setDiagnostic(value) { diagnostic = value; },
    resolveOpen(value) { resolveOpen?.(value); resolveOpen = null; },
    setSession(value) { session = value; },
    event(type, value = {}) {
      return events.get(type)?.({ preventDefault() {}, key: "", ...value });
    },
  };
}

function openDialog(harness) {
  harness.topbar.fire("click");
  return harness.overlay.querySelector(".vaultDialogPrimary");
}

test("P331 keeps ordinary production UI unchanged when the exact acceptance fragment is absent", async () => {
  const diagnostic = { ok: false, reason: "additional-device-open-failed", sourceOwnerPreserved: true };
  const harness = createHarness({
    openResults: [{ ok: false, reason: "additional-device-open-failed", sourceOwnerPreserved: true }],
    diagnostic,
  });
  openDialog(harness).fire("click");
  await settle();

  assert.equal(harness.overlay.hidden, false);
  assert.equal(harness.overlay.querySelector("#syncSetupStatus").textContent,
    "Sync setup could not finish. Your current Pocket is unchanged.");
  assert.equal(harness.diagnostic.hidden, true);
  assert.equal(harness.diagnostic.textContent, "");
  assert.equal(harness.getterCalls, 0);
});

test("P331 exact fragment renders only the existing sanitised getter projection after failed open", async () => {
  const projected = {
    ok: false,
    reason: "additional-device-open-failed",
    adopted: false,
    sourceOwnerPreserved: true,
    failureStage: "account-passkey-authentication-completion",
    failureCode: "passkey-security-failed",
    authenticationRequest: {
      browserGetStarted: true,
      parserPath: "native",
      challengeBytes: 32,
      rpId: "pocket.example",
      allowCredentialCount: 1,
      allowCredentialIdBytes: 32,
      transports: ["internal"],
      userVerification: "required",
      prfInputBytes: 32,
    },
  };
  const harness = createHarness({
    hash: "#pocket-open-diagnostic",
    openResults: [{
      ok: false,
      reason: "additional-device-open-failed",
      sourceOwnerPreserved: true,
      rawSecret: SECRET,
      accountId: SECRET,
      credentialId: SECRET,
      prfOutput: SECRET,
    }],
    diagnostic: projected,
  });

  openDialog(harness).fire("click");
  await settle();

  assert.equal(harness.getterCalls, 1);
  assert.equal(harness.diagnostic.hidden, false);
  assert.equal(harness.diagnostic.textContent, JSON.stringify(projected, null, 2));
  assert.equal(harness.diagnostic.textContent.includes(SECRET), false);
  assert.equal(harness.overlay.querySelector("#syncSetupStatus").textContent,
    "Sync setup could not finish. Your current Pocket is unchanged.");
});

test("P335 safe account suffix is visible only through the exact diagnostic fragment", async () => {
  const projected = {
    ok: false,
    reason: "synced-pocket-not-configured",
    adopted: false,
    authenticatedAccountSuffix: "x2-DE",
  };

  const ordinary = createHarness({
    openResults: [{
      ok: false,
      reason: "synced-pocket-not-configured",
      adopted: false,
      authenticatedAccountSuffix: "x2-DE",
      accountId: SECRET,
      credentialId: SECRET,
      prfOutput: SECRET,
    }],
    diagnostic: projected,
  });
  openDialog(ordinary).fire("click");
  await settle();
  assert.equal(ordinary.getterCalls, 0);
  assert.equal(ordinary.diagnostic.hidden, true);
  assert.equal(ordinary.diagnostic.textContent, "");
  assert.equal(ordinary.overlay.querySelector("#syncSetupStatus").textContent,
    "Sync setup could not finish. Check Storage & Sync before continuing.");

  const diagnostic = createHarness({
    hash: "#pocket-open-diagnostic",
    openResults: [{
      ok: false,
      reason: "synced-pocket-not-configured",
      adopted: false,
      authenticatedAccountSuffix: "x2-DE",
      accountId: SECRET,
      credentialId: SECRET,
      prfOutput: SECRET,
    }],
    diagnostic: projected,
  });
  openDialog(diagnostic).fire("click");
  await settle();
  assert.equal(diagnostic.getterCalls, 1);
  assert.equal(diagnostic.diagnostic.hidden, false);
  assert.equal(diagnostic.diagnostic.textContent, JSON.stringify(projected, null, 2));
  assert.equal(diagnostic.diagnostic.textContent.includes(SECRET), false);
  assert.equal(diagnostic.overlay.querySelector("#syncSetupStatus").textContent,
    "Sync setup could not finish. Check Storage & Sync before continuing.");
});

test("P331 requires the exact fragment and keeps missing null or throwing getters hidden", async () => {
  const wrongFragment = createHarness({
    hash: "#pocket-open-diagnostic-extra",
    openResults: [{ ok: false, reason: "additional-device-open-failed", sourceOwnerPreserved: true }],
    diagnostic: { ok: false, reason: "safe" },
  });
  openDialog(wrongFragment).fire("click");
  await settle();
  assert.equal(wrongFragment.diagnostic.hidden, true);
  assert.equal(wrongFragment.getterCalls, 0);

  for (const getter of ["missing", "null", "throw"]) {
    const harness = createHarness({
      hash: "#pocket-open-diagnostic",
      getter,
      openResults: [{ ok: false, reason: "additional-device-open-failed", sourceOwnerPreserved: true }],
    });
    openDialog(harness).fire("click");
    await settle();
    assert.equal(harness.diagnostic.hidden, true, getter);
    assert.equal(harness.diagnostic.textContent, "", getter);
  }
});

test("P331 never exposes the open diagnostic for non-open failures", async () => {
  const harness = createHarness({
    hash: "#pocket-open-diagnostic",
    diagnostic: { ok: false, reason: "must-not-render" },
    activateResult: { ok: false, reason: "activation-unavailable", sourceOwnerPreserved: true },
  });
  harness.command.fire("click");
  assert.equal(harness.overlay.querySelector(".vaultDialogPrimary").dataset.mode, "activate");
  harness.overlay.querySelector(".vaultDialogPrimary").fire("click");
  await settle();

  assert.equal(harness.activateCalls, 1);
  assert.equal(harness.diagnostic.hidden, true);
  assert.equal(harness.diagnostic.textContent, "");
  assert.equal(harness.getterCalls, 0);
});

test("P331 clears an old diagnostic before another open and on successful open", async () => {
  const first = {
    ok: false,
    reason: "additional-device-open-failed",
    sourceOwnerPreserved: true,
    failureStage: "account-passkey-authentication-completion",
    failureCode: "passkey-security-failed",
  };
  const harness = createHarness({
    hash: "#pocket-open-diagnostic",
    openResults: [
      { ok: false, reason: "additional-device-open-failed", sourceOwnerPreserved: true },
      { pending: true },
    ],
    diagnostic: first,
  });
  const primary = openDialog(harness);
  primary.fire("click");
  await settle();
  assert.equal(harness.diagnostic.hidden, false);

  primary.fire("click");
  assert.equal(harness.openCalls, 2);
  assert.equal(harness.diagnostic.hidden, true);
  assert.equal(harness.diagnostic.textContent, "");

  harness.resolveOpen({ ok: true, reason: "synced-pocket-opened" });
  await settle();
  assert.equal(harness.overlay.hidden, true);
  assert.equal(harness.diagnostic.hidden, true);
  assert.equal(harness.diagnostic.textContent, "");
});

test("P331 Cancel and Escape both clear the diagnostic", async () => {
  for (const closeWith of ["cancel", "escape"]) {
    const harness = createHarness({
      hash: "#pocket-open-diagnostic",
      openResults: [{ ok: false, reason: "additional-device-open-failed", sourceOwnerPreserved: true }],
      diagnostic: {
        ok: false,
        reason: "additional-device-open-failed",
        sourceOwnerPreserved: true,
        failureStage: "account-passkey-authentication-completion",
        failureCode: "account-service-failed",
      },
    });
    openDialog(harness).fire("click");
    await settle();
    assert.equal(harness.diagnostic.hidden, false, closeWith);

    if (closeWith === "cancel") {
      harness.overlay.querySelector(".vaultDialogSecondary").fire("click");
    } else {
      harness.event("keydown", { key: "Escape" });
    }
    assert.equal(harness.overlay.hidden, true, closeWith);
    assert.equal(harness.diagnostic.hidden, true, closeWith);
    assert.equal(harness.diagnostic.textContent, "", closeWith);
  }
});

test("P331 remains presentation-only and keeps the diagnostic screenshot-readable", () => {
  const ui = fs.readFileSync(UI_PATH, "utf8");
  const css = fs.readFileSync(path.join(ROOT, "vault.css"), "utf8");

  assert.match(ui, /global\.location\?\.hash === "#pocket-open-diagnostic"/);
  assert.match(ui, /integration\.getLatestOpenDiagnostic\(\)/);
  assert.match(ui, /JSON\.stringify\(diagnostic, null, 2\)/);
  assert.doesNotMatch(ui, /JSON\.stringify\(result, null, 2\)/);
  assert.match(css, /\.vaultDialogOpenDiagnostic\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*white-space:\s*pre-wrap;/);
});
