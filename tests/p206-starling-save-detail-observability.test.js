"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const DIAGNOSTIC = fs.readFileSync(path.join(ROOT, "js/pocket-starling-save-diagnostic.js"), "utf8");
const AUTHORITY_STATE_SCHEMA = "pocket.starling.owner-authority-state.v3";
const DETAIL_KEYS = Object.freeze([
  "sourceAccepted", "prepareSourceAccepted", "workingSetPrepared", "descriptorPrepared",
  "objectsEnsured", "headCommitted", "proofOpened", "proofMaterialized", "proofVerified",
]);
const HEAD = Object.freeze({ schema: "pocket.starling.head.v1", revision: 2, sealRef: "opaque-ref" });

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function makeRuntime({ diagnostic = true, mode = "success", throwingClock = false } = {}) {
  let now = 0;
  const log = [];
  const writes = [];
  const advance = (ms) => { now += ms; };
  const ownerStateStore = {
    async open() {}, async read() { return null; },
    async write(value) { log.push("state-write"); writes.push(plain(value)); },
  };
  const crypto = {
    async sealContent(value) { log.push(`seal:${value.saveWitness?.phase || "accepted"}`); return { opaque: true }; },
  };
  const context = {
    Object, Array, Number, String, Boolean, JSON, Date, Math, Promise, Error, Set, Uint8Array,
    performance: { now() { if (throwingClock) throw new Error("clock unavailable"); return now; } },
    PocketStarlingOwnerState: ownerStateStore,
    currentPocketStarlingOwnerSavePreparation() {
      return { ceiling: 1, operations: [{ type: "reorder" }], preservationProjection: {} };
    },
  };
  context.window = context;
  context.globalThis = context;
  context.PocketStarlingRemoteOpenShadow = Object.freeze({
    createRemoteOpener() {
      return Object.freeze({
        async openRemote() {
          log.push("openRemote");
          const count = log.filter((entry) => entry === "openRemote").length;
          advance(count === 1 ? 5 : count === 2 ? 11 : count === 3 ? 13 : 31);
          return { outcome: "opened", head: HEAD, session: { opaque: true } };
        },
      });
    },
  });
  context.PocketStarlingRemoteEditShadow = Object.freeze({
    async createEditor() {
      log.push("createEditor");
      return Object.freeze({
        async prepareWorkingSet() {
          log.push("prepareWorkingSet"); advance(17);
          return { outcome: "prepared", expectedHead: HEAD };
        },
      });
    },
  });
  context.PocketStarlingDurablePublication = Object.freeze({
    descriptorFromPrepared(prepared) {
      log.push("descriptorFromPrepared"); advance(19);
      return prepared?.outcome === "prepared" ? { expectedHead: prepared.expectedHead } : null;
    },
    createCoordinator() {
      log.push("createCoordinator");
      return Object.freeze({
        async ensureObjects() {
          log.push("ensureObjects"); advance(23);
          if (mode === "objects-fail") throw new Error("expected object failure");
        },
        async attemptHead() {
          log.push("attemptHead"); advance(29);
          return { outcome: mode === "head-fail" ? "not-committed" : "committed" };
        },
        async reconcile() { log.push("reconcile"); return { outcome: "not-committed" }; },
      });
    },
  });
  context.PocketStarlingMaterializeShadow = Object.freeze({
    async materializeAccepted() {
      log.push("materializeAccepted"); advance(37);
      return { ok: true, document: { opaque: true } };
    },
  });

  context.PocketSyncOwnerController = Object.freeze({
    createSyncedOwnerController(configuration) {
      const persist = async (phase) => {
        const saveWitness = phase === null ? null : { phase };
        const state = { schema: AUTHORITY_STATE_SCHEMA, authority: { currentMode: "starling" }, saveWitness };
        const sealed = await configuration.crypto.sealContent(state, null, null);
        await configuration.starlingSuccessor.ownerStateStore.write(sealed);
      };
      const open = () => context.PocketStarlingRemoteOpenShadow.createRemoteOpener({}).openRemote({});
      return Object.freeze({
        async saveSyncedOwner(input) {
          await open();
          await input.freezePayload();
          await open();
          await persist("captured");
          await open();
          const editor = await context.PocketStarlingRemoteEditShadow.createEditor({});
          const prepared = await editor.prepareWorkingSet([], {});
          const descriptor = context.PocketStarlingDurablePublication.descriptorFromPrepared(prepared);
          if (!descriptor) return { ok: false, reason: "starling-save-unsettled" };
          await persist("prepared");
          const coordinator = context.PocketStarlingDurablePublication.createCoordinator({});
          try { await coordinator.ensureObjects(descriptor); }
          catch (_error) { return { ok: false, reason: "starling-save-unsettled" }; }
          await persist("objects-present");
          await persist("cas-ambiguous");
          const head = await coordinator.attemptHead(descriptor, 1);
          if (head?.outcome !== "committed") return { ok: false, reason: "starling-save-unsettled" };
          const opened = await open();
          const materialized = await context.PocketStarlingMaterializeShadow.materializeAccepted(opened.session);
          if (!materialized?.ok) return { ok: false, reason: "starling-save-unsettled" };
          await persist(null);
          return { ok: true };
        },
      });
    },
  });

  vm.createContext(context);
  if (diagnostic) vm.runInContext(DIAGNOSTIC, context, { filename: "pocket-starling-save-diagnostic.js" });
  const controller = context.PocketSyncOwnerController.createSyncedOwnerController({
    crypto,
    deviceStore: {}, contentService: {}, randomBytes() { return new Uint8Array(1); },
    starlingSuccessor: { ownerStateStore },
  });
  return { context, controller, log, writes, advance };
}

test("P206 successful steady Save exposes exact bounded ordered detail timings", async () => {
  const h = makeRuntime();
  const result = await h.controller.saveSyncedOwner({ async freezePayload() { return { schema: "portal.export.v1" }; } });
  assert.equal(result.ok, true);
  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "detailElapsedMs", "elapsedMs", "failureCode", "highestStage", "outcome", "stageElapsedMs",
  ]);
  assert.deepEqual(Object.keys(diagnostic.detailElapsedMs), DETAIL_KEYS);
  assert.deepEqual(plain(diagnostic.detailElapsedMs), {
    sourceAccepted: 16,
    prepareSourceAccepted: 29,
    workingSetPrepared: 46,
    descriptorPrepared: 65,
    objectsEnsured: 88,
    headCommitted: 117,
    proofOpened: 148,
    proofMaterialized: 185,
    proofVerified: 185,
  });
  assert.equal(Object.isFrozen(diagnostic.detailElapsedMs), true);
  const values = DETAIL_KEYS.map((key) => diagnostic.detailElapsedMs[key]);
  values.forEach((value, index) => {
    assert.equal(Number.isSafeInteger(value), true);
    assert.ok(value >= 0 && value <= 86400000);
    if (index) assert.ok(value >= values[index - 1]);
  });
});

test("P206 failure leaves later detail markers null and preserves failure truth", async () => {
  const h = makeRuntime({ mode: "objects-fail" });
  const result = await h.controller.saveSyncedOwner({ async freezePayload() { return { schema: "portal.export.v1" }; } });
  assert.deepEqual(result, { ok: false, reason: "starling-save-unsettled" });
  const diagnostic = h.context.PocketStarlingSaveDiagnostic.getLatest();
  assert.equal(diagnostic.outcome, "failed");
  assert.equal(diagnostic.failureCode, "starling-save-unsettled");
  assert.deepEqual(plain(diagnostic.detailElapsedMs), {
    sourceAccepted: 16,
    prepareSourceAccepted: 29,
    workingSetPrepared: 46,
    descriptorPrepared: 65,
    objectsEnsured: null,
    headCommitted: null,
    proofOpened: null,
    proofMaterialized: null,
    proofVerified: null,
  });
});

test("P206 stale post-Save activity cannot overwrite first-reach detail values", async () => {
  const h = makeRuntime();
  await h.controller.saveSyncedOwner({ async freezePayload() { return { schema: "portal.export.v1" }; } });
  const before = plain(h.context.PocketStarlingSaveDiagnostic.getLatest().detailElapsedMs);
  h.advance(1000);
  await h.context.PocketStarlingRemoteOpenShadow.createRemoteOpener({}).openRemote({});
  const editor = await h.context.PocketStarlingRemoteEditShadow.createEditor({});
  await editor.prepareWorkingSet([], {});
  const prepared = { outcome: "prepared", expectedHead: HEAD };
  h.context.PocketStarlingDurablePublication.descriptorFromPrepared(prepared);
  const coordinator = h.context.PocketStarlingDurablePublication.createCoordinator({});
  await coordinator.ensureObjects({ expectedHead: HEAD });
  await coordinator.attemptHead({ expectedHead: HEAD }, 1);
  await h.context.PocketStarlingMaterializeShadow.materializeAccepted({});
  assert.deepEqual(plain(h.context.PocketStarlingSaveDiagnostic.getLatest().detailElapsedMs), before);
  assert.equal(h.context.PocketStarlingSaveDetailObserver, undefined,
    "P206 exposes no generic marker or telemetry injection surface");
});

test("P206 observer wrapping preserves Save result, external operation order/count and durable writes", async () => {
  const baseline = makeRuntime({ diagnostic: false });
  const observed = makeRuntime({ diagnostic: true });
  const baselineResult = await baseline.controller.saveSyncedOwner({ async freezePayload() { return { schema: "portal.export.v1" }; } });
  const observedResult = await observed.controller.saveSyncedOwner({ async freezePayload() { return { schema: "portal.export.v1" }; } });
  assert.deepEqual(observedResult, baselineResult);
  assert.deepEqual(observed.log, baseline.log);
  assert.deepEqual(observed.writes, baseline.writes);
});

test("P206 monotonic-clock unavailability cannot change Save outcome or external calls", async () => {
  const normal = makeRuntime();
  const unavailable = makeRuntime({ throwingClock: true });
  const normalResult = await normal.controller.saveSyncedOwner({ async freezePayload() { return { schema: "portal.export.v1" }; } });
  const unavailableResult = await unavailable.controller.saveSyncedOwner({ async freezePayload() { return { schema: "portal.export.v1" }; } });
  assert.deepEqual(unavailableResult, normalResult);
  assert.deepEqual(unavailable.log, normal.log);
  assert.deepEqual(unavailable.writes, normal.writes);
  const diagnostic = unavailable.context.PocketStarlingSaveDiagnostic.getLatest();
  Object.values(diagnostic.detailElapsedMs).forEach((value) => {
    assert.ok(value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 86400000));
  });
});
