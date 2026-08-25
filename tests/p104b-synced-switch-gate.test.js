"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const GATE_PATH = path.join(ROOT, "js/pocket-synced-switch-gate.js");

function createGate(ownerKind = "json", options = {}) {
  let dirty = true;
  let session = { ownerKind, id: 42, vaultSessionId: ownerKind === "vault" ? "vault-session" : "" };
  let saves = 0;
  const context = {
    Object, Array, String, Number, Boolean, Error, Promise,
    capturePocketFileSaveSession() { return session; },
    hasPocketUnsavedChanges() { return dirty; },
    hasUnsavedDetailsEditorChanges() { return options.detailsDraft === true; },
    hasUnsavedInlineTitleDraft() { return options.inlineDraft === true; },
    async exportTree(input) {
      saves += 1;
      assert.deepEqual(JSON.parse(JSON.stringify(input)), { returnDetails: true, downloadFallback: false });
      if (options.saveResult) return options.saveResult;
      dirty = false;
      return { ok: true };
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(GATE_PATH, "utf8"), context, { filename: "pocket-synced-switch-gate.js" });
  return { gate: context.PocketSyncedSwitchGate, setDirty(value) { dirty = value; }, setSession(value) { session = value; }, get saves() { return saves; } };
}

test("P104b delegates JSON and Vault Save to the active owner and verifies its completed clean state", async () => {
  for (const ownerKind of ["json", "vault"]) {
    const harness = createGate(ownerKind);
    const target = harness.gate.capture();
    assert.equal(Object.isFrozen(target), true);
    assert.deepEqual(JSON.parse(JSON.stringify(await harness.gate.save(target))), { ok: true });
    assert.equal(harness.saves, 1);
    assert.equal(harness.gate.isDirty(target), false);
  }
});

test("P104b refuses discard and Save around editor drafts or a changed local session", async () => {
  const draft = createGate("json", { detailsDraft: true });
  const draftTarget = draft.gate.capture();
  assert.equal(draft.gate.discardPermit(draftTarget), null);
  assert.deepEqual(JSON.parse(JSON.stringify(await draft.gate.save(draftTarget))), { ok: false, reason: "editor-draft-active" });
  assert.equal(draft.saves, 0);

  const stale = createGate("vault");
  const staleTarget = stale.gate.capture();
  stale.setSession({ ownerKind: "vault", id: 43, vaultSessionId: "vault-session" });
  assert.equal(stale.gate.discardPermit(staleTarget), null);
  assert.deepEqual(JSON.parse(JSON.stringify(await stale.gate.save(staleTarget))), { ok: false, reason: "source-session-changed" });
  assert.equal(stale.saves, 0);
});
