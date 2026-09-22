"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const DEVICE_CHANGES_TEST = path.join(__dirname, "device-changes-resolution.test.js");

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadBrowserHarness() {
  let code = fs.readFileSync(DEVICE_CHANGES_TEST, "utf8");
  const testDeclaration = 'const test = require("node:test");';
  assert.ok(code.includes(testDeclaration), "P199 harness test import changed");
  code = code.replace(testDeclaration, "const test = () => {};");
  code += "\nmodule.exports = { createIntegrationContext, resetIntegrationState, node };\n";
  const localRequire = createRequire(DEVICE_CHANGES_TEST);
  const moduleRecord = { exports: {} };
  const execute = new Function("require", "module", "exports", "__filename", "__dirname", code);
  execute(localRequire, moduleRecord, moduleRecord.exports, DEVICE_CHANGES_TEST, __dirname);
  return moduleRecord.exports;
}

function payload(label) {
  const updatedAt = "2026-09-13T00:00:00.000Z";
  const nodes = [{
    id: "shared",
    parentId: "root",
    order: 1001,
    label,
    details: label,
    source: "manual",
    updatedAt,
  }];
  return {
    schema: "portal.export.v1",
    writtenAt: updatedAt,
    mainThoughtTree: nodes,
    mainThoughtTreeTombstones: [],
    data: { mainThoughtTree: nodes, mainThoughtTreeTombstones: [] },
  };
}

function sharedHandle(physical, name = "shared.json") {
  const calls = { getFile: 0, createWritable: 0, write: 0, close: 0, abort: 0 };
  return {
    name,
    calls,
    async queryPermission() { return "granted"; },
    async getFile() {
      calls.getFile += 1;
      return {
        name,
        lastModified: physical.lastModified,
        async text() { return physical.text; },
      };
    },
    async createWritable() {
      calls.createWritable += 1;
      let pending = "";
      return {
        async write(text) {
          calls.write += 1;
          pending = String(text);
          if (typeof physical.afterWrite === "function") await physical.afterWrite(pending);
        },
        async close() {
          calls.close += 1;
          physical.text = pending;
          physical.lastModified += 1;
          if (typeof physical.afterClose === "function") await physical.afterClose(pending);
        },
        async abort() { calls.abort += 1; },
      };
    },
  };
}

function change(context, nextDetails, operation) {
  const state = context.__p199State();
  state.nodes[0].details = nextDetails;
  state.nodes[0].updatedAt = "2026-09-13T00:00:01.000Z";
  state.ops.push({ type: operation });
}

test("P199 blocks stale local-file overwrite without a fallback copy and advances the winning baseline", async () => {
  const harness = loadBrowserHarness();
  const physical = { text: `${JSON.stringify(payload("H0"), null, 2)}\n`, lastModified: 1 };
  const handleA = sharedHandle(physical);
  const handleB = sharedHandle(physical);
  const a = harness.createIntegrationContext();
  const b = harness.createIntegrationContext();
  a.__p199State = () => require("node:vm").runInContext("state", a);
  b.__p199State = () => require("node:vm").runInContext("state", b);

  assert.equal(await a.loadFromFileHandle(handleA, { displayName: handleA.name }), true);
  assert.equal(await b.loadFromFileHandle(handleB, { displayName: handleB.name }), true);

  change(a, "H1", "a-h1");
  const aH1 = await a.exportTree({ returnDetails: true });
  assert.equal(aH1.ok, true);
  assert.equal(handleA.calls.write, 1);
  const physicalH1 = physical.text;

  change(b, "B stale", "b-stale");
  const bSave = await b.exportTree({ returnDetails: true });
  assert.deepEqual(plain(bSave), { ok: false, reason: "external-file-changed" });
  assert.equal(handleB.calls.createWritable, 0);
  assert.equal(physical.text, physicalH1);
  assert.equal(b.__p199State().ops.length, 1);
  assert.equal(b.__surfaceCalls.picker, 0);
  assert.equal(b.__surfaceCalls.statuses.at(-1).message,
    "This Pocket changed elsewhere. Your changes are still here.");

  change(a, "H2", "a-h2");
  const aH2 = await a.exportTree({ returnDetails: true });
  assert.equal(aH2.ok, true);
  assert.equal(handleA.calls.write, 2);
});

test("P199 fingerprints content rather than metadata and blocks same-size or malformed replacements", async () => {
  const harness = loadBrowserHarness();
  const physical = { text: `${JSON.stringify(payload("AA"), null, 2)}\n`, lastModified: 1 };
  const metadataOnly = sharedHandle(physical);
  const allowed = harness.createIntegrationContext();
  allowed.__p199State = () => require("node:vm").runInContext("state", allowed);
  assert.equal(await allowed.loadFromFileHandle(metadataOnly, { displayName: metadataOnly.name }), true);
  physical.lastModified += 999;
  change(allowed, "metadata is not content", "metadata-only");
  assert.equal((await allowed.exportTree({ returnDetails: true })).ok, true);

  const sameSize = sharedHandle(physical);
  const stale = harness.createIntegrationContext();
  stale.__p199State = () => require("node:vm").runInContext("state", stale);
  assert.equal(await stale.loadFromFileHandle(sameSize, { displayName: sameSize.name }), true);
  physical.text = physical.text.replace("metadata is not content", "metadata is not contant");
  change(stale, "blocked", "same-size");
  const sameSizeResult = await stale.exportTree({ returnDetails: true });
  assert.equal(sameSizeResult.reason, "external-file-changed");
  assert.equal(sameSize.calls.write, 0);

  const malformed = sharedHandle(physical);
  const malformedContext = harness.createIntegrationContext();
  malformedContext.__p199State = () => require("node:vm").runInContext("state", malformedContext);
  assert.equal(await malformedContext.loadFromFileHandle(malformed, { displayName: malformed.name }), true);
  physical.text = "not Pocket JSON";
  change(malformedContext, "still local", "malformed");
  const malformedResult = await malformedContext.exportTree({ returnDetails: true });
  assert.equal(malformedResult.reason, "external-file-changed");
  assert.equal(malformed.calls.write, 0);
});

test("P199 establishes only valid New and picked baselines, restores them on rollback, and rejects stale completion", async () => {
  const harness = loadBrowserHarness();
  const newPhysical = { text: "", lastModified: 0 };
  const newHandle = sharedHandle(newPhysical, "new.pocket");
  const created = harness.createIntegrationContext({ pickSaveHandle: () => newHandle });
  created.__p199State = () => require("node:vm").runInContext("state", created);

  assert.equal(await created.createNewPocketFile(), true);
  change(created, "new baseline", "new-baseline");
  assert.equal((await created.exportTree({ returnDetails: true })).ok, true);
  assert.equal(newHandle.calls.write, 2);

  const pickedPhysical = { text: "", lastModified: 0 };
  const pickedHandle = sharedHandle(pickedPhysical, "picked.json");
  const picked = harness.createIntegrationContext({ pickSaveHandle: () => pickedHandle });
  const firstPick = await picked.writeTruthFile(payload("picked H0"));
  assert.equal(firstPick.target, "picked-file");
  const pickedSession = picked.capturePocketFileSaveSession();
  const pickedAgain = await picked.writeTruthFile(payload("picked H1"), { expectedSession: pickedSession });
  assert.equal(pickedAgain.target, "opened-file");

  const ownerSnapshot = picked.capturePocketFileOwnerForAdoption();
  picked.clearPocketFileSession();
  picked.restorePocketFileOwnerAfterFailedAdoption(ownerSnapshot);
  const restored = await picked.writeTruthFile(payload("picked H2"), {
    expectedSession: picked.capturePocketFileSaveSession(),
  });
  assert.equal(restored.target, "opened-file");

  const racePhysical = { text: `${JSON.stringify(payload("race H0"), null, 2)}\n`, lastModified: 0 };
  const raceHandle = sharedHandle(racePhysical, "race.json");
  const race = harness.createIntegrationContext();
  race.__p199State = () => require("node:vm").runInContext("state", race);
  assert.equal(await race.loadFromFileHandle(raceHandle, { displayName: raceHandle.name }), true);
  const raceSession = race.capturePocketFileSaveSession();
  racePhysical.afterWrite = () => race.clearPocketFileSession();
  const raceResult = await race.writeTruthFile(payload("race H1"), { expectedSession: raceSession });
  assert.equal(raceResult.reason, "file-session-changed");
  assert.match(racePhysical.text, /race H0/);
  assert.equal(raceHandle.calls.close, 0);

  const closePhysical = { text: `${JSON.stringify(payload("close H0"), null, 2)}\n`, lastModified: 0 };
  const closeHandle = sharedHandle(closePhysical, "close.json");
  const closeRace = harness.createIntegrationContext();
  closeRace.__p199State = () => require("node:vm").runInContext("state", closeRace);
  assert.equal(await closeRace.loadFromFileHandle(closeHandle, { displayName: closeHandle.name }), true);
  closePhysical.afterClose = () => {
    closePhysical.text = `${JSON.stringify(payload("external H1"), null, 2)}\n`;
    closePhysical.lastModified += 1;
  };
  change(closeRace, "local H1", "post-close-race");
  const closeResult = await closeRace.exportTree({ returnDetails: true });
  assert.equal(closeResult.reason, "external-file-changed");
  assert.equal(closeRace.__p199State().ops.length, 1);
  assert.equal(closeRace.__surfaceCalls.picker, 0);
  assert.match(closePhysical.text, /external H1/);
});
