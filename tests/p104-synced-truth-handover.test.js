"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const HANDOVER_PATH = path.join(ROOT, "js/pocket-synced-truth-handover.js");

function payload(label) {
  return {
    schema: "portal.export.v1",
    mainThoughtTree: [{ id: "p104-source", label, details: label, children: [] }],
    mainThoughtTreeTombstones: [],
    data: {
      mainThoughtTree: [{ id: "p104-source", label, details: label, children: [] }],
      mainThoughtTreeTombstones: [],
    },
  };
}

function createHandoverHarness(options = {}) {
  const session = { ownerKind: "synced", id: 104 };
  const statuses = [];
  const commits = [];
  const saves = [];
  let current = true;
  const context = {
    Object, Array, String, Boolean, Error, Promise, JSON,
    confirm() { return options.confirm !== false; },
    capturePocketFileSaveSession() { return session; },
    isPocketFileSaveSessionCurrent(value) { return current && value === session; },
    hasPocketUnsavedChanges() { return options.dirty === true; },
    hasUnsavedDetailsEditorChanges() { return false; },
    hasUnsavedInlineTitleDraft() { return false; },
    isPocketPayloadShape(value) { return value?.schema === "portal.export.v1"; },
    normaliseInput(value) { return JSON.parse(JSON.stringify(value)); },
    setStatus(message) { statuses.push(message); },
    PocketFileOpening: {
      async chooseExistingFile() { return options.inspected; },
    },
    PocketOwnerSaveBoundary: {
      hasSyncedOwner() { return options.hasOwner !== false; },
      async save(input) {
        saves.push(input);
        if (options.staleBeforeSave === true) current = false;
        return options.saveResult || { ok: true, ownerKind: "synced", target: "synced" };
      },
    },
    commitPreparedPocketDocument(norm, metadata, guard) {
      commits.push({ norm, metadata, guard });
      return options.commitResult || { ok: true };
    },
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(HANDOVER_PATH, "utf8"), context, { filename: "pocket-synced-truth-handover.js" });
  return { context, statuses, commits, saves, setCurrent(value) { current = value; } };
}

test("P104 validates and freezes a normal Pocket JSON before replacing the existing synced truth", async () => {
  let sourceWrites = 0;
  const selected = payload("P104 SELECTED LOCAL TRUTH");
  const harness = createHandoverHarness({ inspected: {
    ok: true, kind: "json", fileName: "selected-pocket.json", payload: selected,
    handle: { async createWritable() { sourceWrites += 1; throw new Error("must not write selected source"); } },
  } });
  const result = await harness.context.PocketSyncedTruthHandover.begin();
  assert.equal(result, true);
  assert.equal(harness.saves.length, 1);
  assert.equal(harness.commits.length, 1);
  assert.notEqual(harness.saves[0].freezePayload(), selected);
  assert.deepEqual(harness.saves[0].freezePayload(), selected);
  assert.equal(sourceWrites, 0);
  assert.equal(harness.commits[0].metadata.fileName, "Synced Pocket");
  assert.equal(harness.commits[0].guard.ownerKind, "synced");
  assert.equal(harness.commits[0].guard.canContinue(), true);
});

test("P104 leaves visible synced truth and the selected source untouched on cancel, invalid input, or a failed synced save", async () => {
  const cases = [
    { name: "cancel", inspected: { ok: false, reason: "cancelled" } },
    { name: "vault", inspected: { ok: true, kind: "vault", fileName: "private.pocketvault", payload: payload("vault") } },
    { name: "invalid", inspected: { ok: true, kind: "json", fileName: "bad.json", payload: { schema: "other" } } },
    { name: "confirmation", confirm: false, inspected: { ok: true, kind: "json", fileName: "selected.json", payload: payload("cancel") } },
    { name: "stale", saveResult: { ok: false, reason: "stale-owner-session", ownerKind: "synced", target: "synced" }, inspected: { ok: true, kind: "json", fileName: "selected.json", payload: payload("stale") } },
    { name: "conflict", saveResult: { ok: false, reason: "revision-conflict", ownerKind: "synced", target: "synced" }, inspected: { ok: true, kind: "json", fileName: "selected.json", payload: payload("conflict") } },
    { name: "unknown", saveResult: { ok: false, reason: "remote-outcome-unknown", ownerKind: "synced", target: "synced" }, inspected: { ok: true, kind: "json", fileName: "selected.json", payload: payload("unknown") } },
    { name: "durability", saveResult: { ok: false, reason: "remote-success-local-confirmation-failed", ownerKind: "synced", target: "synced" }, inspected: { ok: true, kind: "json", fileName: "selected.json", payload: payload("durability") } },
  ];
  for (const scenario of cases) {
    const harness = createHandoverHarness(scenario);
    assert.equal(await harness.context.PocketSyncedTruthHandover.begin(), false, scenario.name);
    assert.equal(harness.commits.length, 0, scenario.name);
    if (["stale", "conflict", "unknown", "durability"].includes(scenario.name)) assert.equal(harness.saves.length, 1, scenario.name);
    else assert.equal(harness.saves.length, 0, scenario.name);
  }
});

test("P104 refuses a handover while the existing synced Pocket is dirty or changes during selection", async () => {
  const dirty = createHandoverHarness({ dirty: true, inspected: { ok: true, kind: "json", payload: payload("dirty") } });
  assert.equal(await dirty.context.PocketSyncedTruthHandover.begin(), false);
  assert.equal(dirty.saves.length, 0);
  const stale = createHandoverHarness({ staleBeforeSave: true, inspected: { ok: true, kind: "json", payload: payload("stale") } });
  assert.equal(await stale.context.PocketSyncedTruthHandover.begin(), false);
  assert.equal(stale.commits.length, 0);
});
