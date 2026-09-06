"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const P180 = path.join(__dirname, "p180-main-save-cutover.test.js");
const MODULE = "js/pocket-starling-save-diagnostic.js";
const TIMEOUT = 30000;
const AUTHORITY_STATE_SCHEMA = "pocket.starling.owner-authority-state.v3";
const SECRET = "P190-PRIVATE-MATERIAL-MUST-NOT-CROSS";

const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function loadP180Helpers() {
  let code = fs.readFileSync(P180, "utf8");
  const outerTest = 'const test = require("node:test");';
  assert.ok(code.includes(outerTest), "P180 test import changed");
  code = code.replace(outerTest, "const test = () => {};");

  const p176Read = '  let code = fs.readFileSync(P176, "utf8");';
  assert.ok(code.includes(p176Read), "P180 P176 loader changed");
  code = code.replace(p176Read, `${p176Read}
  const p190Verifier = 'async verifyAuthentication() { throw new Error("not used"); },';
  const p190Navigator = 'async get() { throw new Error("not used"); },';
  const p190StarlingTail = '  "js/pocket-starling-real-truth-admission.js",\\n];';
  assert.ok(code.includes(p190Verifier), "P176 authentication verifier seam changed");
  assert.ok(code.includes(p190Navigator), "P176 navigator authentication seam changed");
  assert.ok(code.includes(p190StarlingTail), "P176 Starling module tail changed");
  code = code.replace(p190Verifier, 'async verifyAuthentication(input) { return { credentialId: input.credential.id, signCount: input.storedCredential.signCount === 0 ? 1 : input.storedCredential.signCount + 1, backedUp: true }; },');
  code = code.replace(p190Navigator, 'async get() { passkeyCalls += 1; return fixtures.nativeAuthenticationCredential(); },');
  code = code.replace(p190StarlingTail, '  "js/pocket-starling-real-truth-admission.js",\\n  "js/pocket-starling-save-diagnostic.js",\\n];');`);

  code += "\nmodule.exports = { loadP176Harness, installBaselineTree, loadRealMainSaveSurface, rootOrder };\n";
  const localRequire = createRequire(P180);
  const moduleRecord = { exports: {} };
  const execute = new Function("require", "module", "exports", "__filename", "__dirname", code);
  execute(localRequire, moduleRecord, moduleRecord.exports, P180, __dirname);
  return moduleRecord.exports;
}

async function readyPostReentry() {
  const helpers = loadP180Helpers();
  const p176 = helpers.loadP176Harness();
  const h = p176.productionHarness();
  helpers.installBaselineTree(h.context);
  await p176.activateFresh(h);
  helpers.loadRealMainSaveSurface(h.context);

  h.context.moveNodeWithinSiblings("beta", -1);
  assert.deepEqual(helpers.rootOrder(h.context), ["Beta", "Alpha", "Restore Me"]);
  assert.equal(h.context.__p180State.ops.length, 1);
  const wholeBeforeMigration = h.routeCount("/pockets/content/conditional-upload");
  const migrated = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  assert.equal(migrated.ok, true, JSON.stringify(migrated));
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBeforeMigration);
  const h2 = await h.readRemoteState();
  assert.equal(h2.revision, 1);
  assert.equal(h2.authority.currentMode, "starling");
  assert.equal(h2.authority.rollbackRevision, 1);
  assert.equal(h2.head.revision, 2);
  assert.equal(h.context.__p180State.ops.length, 0);

  assert.equal(h.context.PocketOwnerSaveBoundary.retireSyncedOwner(), true);
  h.context.setPocketFileSession(null, "", { ownerKind: "none" });
  vm.runInContext("state.nodes=[];state.tombstones=[];state.rootExtras={};state.dataExtras={};state.ops=[];state.operationHighWater=0;state.operationDocumentAnchor=null;state.activeSaveOperationCeiling=0;", h.context);
  const reopened = await h.context.PocketSyncActiveIntegration.openExisting();
  assert.equal(reopened.ok, true, JSON.stringify(reopened));
  assert.equal(reopened.reason, "synced-pocket-opened");
  assert.equal(h.context.PocketOwnerSaveBoundary.hasSyncedOwner(), true);
  assert.deepEqual(helpers.rootOrder(h.context), ["Beta", "Alpha", "Restore Me"]);
  assert.equal(h.context.__p180State.ops.length, 0);
  const ownerState = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession().controller.getSyncedOwnerState();
  assert.equal(ownerState.pending, false);
  assert.equal(ownerState.confirmedRemoteRevision, 1);
  assert.equal(ownerState.knownRemoteRevision, 1);
  const bootstrap = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession().controller.getStarlingBootstrapState();
  assert.equal(bootstrap?.ready, true);
  assert.equal(bootstrap?.head?.revision, 2);
  return { h, helpers };
}

function requestDelta(h, start) {
  return h.requests.slice(start).map((entry) => ({ url: entry.url, method: entry.method, status: entry.status }));
}

function countIn(entries, suffix) {
  return entries.filter((entry) => entry.url.endsWith(suffix)).length;
}

function firstIndex(entries, suffix) {
  return entries.findIndex((entry) => entry.url.endsWith(suffix));
}

test("P190 production-shaped ordinary post-reentry Main Save advances H2 to remotely proved H3, retires the witness, cleans Main and never writes R", { timeout: TIMEOUT }, async () => {
  const { h, helpers } = await readyPostReentry();
  h.context.moveNodeWithinSiblings("beta", 1);
  assert.deepEqual(helpers.rootOrder(h.context), ["Alpha", "Beta", "Restore Me"]);
  assert.equal(h.context.__p180State.ops.length, 1, "exactly one structural dirty operation must be pending");

  const wholeBefore = h.routeCount("/pockets/content/conditional-upload");
  const casBefore = h.routeCount("/pockets/head/compare-and-set");
  const requestStart = h.requests.length;
  const startedAt = Date.now();
  const saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });
  const elapsedMs = Date.now() - startedAt;
  const saveRequests = requestDelta(h, requestStart);

  assert.equal(saved.ok, true, JSON.stringify({ saved, saveRequests }));
  assert.equal(h.context.__p180State.ops.length, 0, "successful Main Save must retire the covered dirty operation");
  assert.equal(h.context.hasPocketUnsavedChanges(), false, "Main must be clean after accepted H3");
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBefore,
    "steady-Starling Save must never revive whole-record R");
  assert.equal(h.routeCount("/pockets/head/compare-and-set"), casBefore + 1,
    "one ordinary H2 to H3 Save owns exactly one Head CAS");
  assert.ok(countIn(saveRequests, "/pockets/objects/presence") >= 1,
    "authoritative Save must reach deterministic object presence proof");
  assert.ok(countIn(saveRequests, "/pockets/objects/put") >= 1,
    "authoritative Save must publish at least one new immutable object");

  const casIndex = firstIndex(saveRequests, "/pockets/head/compare-and-set");
  assert.ok(casIndex >= 0, "H3 CAS must be present in deterministic request events");
  assert.ok(saveRequests.slice(casIndex + 1).some((entry) => entry.url.endsWith("/pockets/head/read")),
    "accepted Save must re-read remote Head after CAS for proof");
  assert.ok(saveRequests.slice(casIndex + 1).some((entry) => entry.url.endsWith("/pockets/objects/get")),
    "accepted Save must re-open/materialise remote H3 objects after CAS");

  const remote = await h.readRemoteState();
  assert.equal(remote.revision, 1, "legacy whole-record R1 remains rollback-only");
  assert.equal(remote.authority.currentMode, "starling");
  assert.equal(remote.authority.rollbackRevision, 1);
  assert.equal(remote.head.revision, 3, "remote accepted Head must be H3");
  const localAccepted = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession().controller.getStarlingBootstrapState();
  assert.equal(localAccepted?.head?.revision, 3, "local accepted Starling Head must be H3");

  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.deepEqual(Object.keys(diagnostic).sort(), ["elapsedMs", "failureCode", "highestStage", "outcome"]);
  assert.equal(diagnostic.outcome, "accepted");
  assert.equal(diagnostic.highestStage, "accepted",
    "accepted diagnostic is emitted only after remote proof and durable save-witness retirement");
  assert.equal(diagnostic.failureCode, null);
  assert.equal(Number.isSafeInteger(diagnostic.elapsedMs), true);
  assert.ok(diagnostic.elapsedMs >= 0 && diagnostic.elapsedMs <= 86400000);
  assert.equal(Object.isFrozen(diagnostic), true);
  assert.notEqual(h.context.PocketStarlingSaveDiagnostic.getLatest(), diagnostic,
    "each diagnostic read must be a fresh frozen copy");
  assert.equal(JSON.stringify(diagnostic).includes(SECRET), false);
  assert.ok(elapsedMs >= 0 && elapsedMs < TIMEOUT, "bounded elapsed timing is evidence only, not a performance target");
});

test("P190 production-shaped early private-owner failure stays dirty, performs no publication/CAS/R write and exposes only the typed safe failure", { timeout: TIMEOUT }, async () => {
  const { h, helpers } = await readyPostReentry();
  const session = h.context.PocketOwnerSaveBoundary.captureOwnerSaveSession();
  const syncedPocketId = session.controllerSession.syncedPocketId;
  assert.equal(h.idb.mutateRecord("pocket.sync.device.v1", "pockets", syncedPocketId, (record) => ({
    ...record,
    deviceId: `${record.deviceId}-p190-mismatch`,
  })), true);

  h.context.moveNodeWithinSiblings("beta", 1);
  assert.deepEqual(helpers.rootOrder(h.context), ["Alpha", "Beta", "Restore Me"]);
  assert.equal(h.context.__p180State.ops.length, 1);
  const wholeBefore = h.routeCount("/pockets/content/conditional-upload");
  const casBefore = h.routeCount("/pockets/head/compare-and-set");
  const putBefore = h.routeCount("/pockets/objects/put");
  const saved = await h.context.exportTree({ returnDetails: true, downloadFallback: false });

  assert.equal(saved.ok, false, JSON.stringify(saved));
  assert.equal(saved.reason, "authority-owner-state-unavailable");
  assert.equal(h.context.__p180State.ops.length, 1, "failed Save must preserve truthful dirty state");
  assert.equal(h.routeCount("/pockets/content/conditional-upload"), wholeBefore);
  assert.equal(h.routeCount("/pockets/head/compare-and-set"), casBefore);
  assert.equal(h.routeCount("/pockets/objects/put"), putBefore);
  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.deepEqual(plain(diagnostic), {
    outcome: "failed", highestStage: "authority-read",
    failureCode: "authority-owner-state-unavailable", elapsedMs: diagnostic.elapsedMs,
  });
  assert.equal(Object.isFrozen(diagnostic), true);
  assert.equal(JSON.stringify(diagnostic).includes(syncedPocketId), false,
    "latest-Save projection must not expose synced Pocket locators");
});

function diagnosticUnitRuntime(mode) {
  let writeCount = 0;
  const ownerStateStore = {
    async open() {}, async read() { return null; },
    async write() {
      writeCount += 1;
      if (mode === "prepared-write-fails" && writeCount === 2) throw new Error(SECRET);
    },
  };
  const crypto = {
    FORMAT: { contentType: "opaque" },
    async sealContent() { return { opaque: true }; },
  };
  const context = {
    Object, Array, Number, String, Boolean, JSON, Date, Math, Promise, Error, Set,
    performance: { now: (() => { let value = 100; return () => ++value; })() },
    PocketStarlingOwnerState: ownerStateStore,
    currentPocketStarlingOwnerSavePreparation() {
      return { ceiling: 1, operations: [{ type: "reorder" }], preservationProjection: {} };
    },
  };
  context.window = context;
  context.globalThis = context;
  context.PocketSyncOwnerController = Object.freeze({
    createSyncedOwnerController(configuration) {
      const persist = async (phase) => {
        const saveWitness = phase === null ? null : { phase };
        await configuration.crypto.sealContent({
          schema: AUTHORITY_STATE_SCHEMA,
          authority: { currentMode: "starling" },
          saveWitness,
        }, null, null);
        await configuration.starlingSuccessor.ownerStateStore.write({ opaque: true });
      };
      return Object.freeze({
        async saveSyncedOwner(input) {
          await input.freezePayload();
          if (mode === "unknown-error") return { ok: false, reason: SECRET, private: SECRET };
          await persist("captured");
          if (mode === "prepared-write-fails") {
            try { await persist("prepared"); } catch (_error) {}
            return { ok: false, reason: "starling-save-local-confirmation-unsettled", private: SECRET };
          }
          await persist("prepared");
          await persist("objects-present");
          await persist("cas-ambiguous");
          if (mode === "conflict") {
            await persist("conflict");
            return { ok: false, reason: "starling-save-unsettled", private: SECRET };
          }
          await persist(null);
          return { ok: true, private: SECRET };
        },
      });
    },
  });
  vm.createContext(context);
  vm.runInContext(source(MODULE), context, { filename: MODULE });
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto,
    deviceStore: {}, contentService: {}, randomBytes() { return new Uint8Array(1); },
  });
  return { context, controller };
}

test("P190 diagnostic retains only the highest successfully durable captured phase when prepared local confirmation fails", { timeout: 5000 }, async () => {
  const h = diagnosticUnitRuntime("prepared-write-fails");
  const result = await h.controller.saveSyncedOwner({ async freezePayload() { return { marker: true }; } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "starling-save-local-confirmation-unsettled");
  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.equal(diagnostic.outcome, "failed");
  assert.equal(diagnostic.highestStage, "captured");
  assert.equal(diagnostic.failureCode, "starling-save-local-confirmation-unsettled");
  assert.equal(JSON.stringify(diagnostic).includes(SECRET), false);
});

test("P190 conflict diagnostic remains failed at conflict and never self-promotes to accepted", { timeout: 5000 }, async () => {
  const h = diagnosticUnitRuntime("conflict");
  const result = await h.controller.saveSyncedOwner({ async freezePayload() { return { marker: true }; } });
  assert.equal(result.ok, false);
  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.equal(diagnostic.outcome, "failed");
  assert.equal(diagnostic.highestStage, "conflict");
  assert.equal(diagnostic.failureCode, "starling-save-unsettled");
  assert.notEqual(diagnostic.highestStage, "accepted");
});

test("P190 diagnostic maps unknown/private failure material to one fixed generic code and returns copy-safe frozen projections", { timeout: 5000 }, async () => {
  const h = diagnosticUnitRuntime("unknown-error");
  const result = await h.controller.saveSyncedOwner({ async freezePayload() { return { marker: true }; } });
  assert.equal(result.ok, false);
  const first = h.context.PocketStarlingSaveDiagnostic.getLatest();
  const second = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.equal(first.outcome, "failed");
  assert.equal(first.failureCode, "save-failed");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(second), true);
  assert.notEqual(first, second);
  assert.equal(JSON.stringify(first).includes(SECRET), false);
  assert.deepEqual(Object.keys(first).sort(), ["elapsedMs", "failureCode", "highestStage", "outcome"]);
});
